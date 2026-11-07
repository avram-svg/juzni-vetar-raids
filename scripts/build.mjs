// Pulls upcoming Raid-Helper events for the Juzni Vetar Discord server and writes
// docs/data.json, which the page in docs/ shows with a "Copy all raids" button.
// Runs on GitHub Actions (Node 20+, no packages needed).

import { readFile, writeFile } from "node:fs/promises";
import {
  SERVER_ID, API_KEY, log, listServerEvents, getEvent, clean,
  classOf, statusOf, roleOf, startOf, signupsOf,
} from "./raidhelper.mjs";

const WEBHOOK = (process.env.DISCORD_WEBHOOK || "").trim();
const REPO = process.env.GITHUB_REPOSITORY || "";
const PAGE_URL = process.env.PAGE_URL ||
  (REPO ? `https://${REPO.split("/")[0].toLowerCase()}.github.io/${REPO.split("/")[1]}/` : "");
const KEEP_AFTER_START = 6 * 3600;           // keep a raid on the page until 6h after it starts
const DATA_FILE = new URL("../docs/data.json", import.meta.url);
const EXTRA_FILE = new URL("../events.txt", import.meta.url);
const now = Math.floor(Date.now() / 1000);

// Extra events: message links or IDs, one per line (works without an API key)
async function extraEvents() {
  try {
    const text = await readFile(EXTRA_FILE, "utf8");
    return text.split(/\r?\n/).map(l => l.replace(/#.*/, "").trim()).filter(Boolean)
      .map(l => (l.match(/(\d{15,22})\D*$/) || [])[1]).filter(Boolean);
  } catch { return []; }
}

function toRaid(d, fallbackId) {
  const start = startOf(d);
  const id = String(d.raidid || d.id || fallbackId);
  const signups = signupsOf(d).map(s => ({
    name: clean(s.name || s.userName || s.displayName),
    cls: classOf(s), role: roleOf(s), status: statusOf(s),
  })).filter(s => s.name);
  const title = clean(d.title || d.displayTitle || "Raid");
  const sid = d.serverId || d.serverid || SERVER_ID, cid = d.channelId || d.channelid;
  const link = cid ? `https://discord.com/channels/${sid}/${cid}/${id}` : "";
  const limit = Number(d.advancedSettings?.limit || d.advanced?.limit || 0);
  const size = limit > 0 && limit <= 40 ? limit : (/\b10\b/.test(title) ? 10 : 25);
  const importLine = ["GR1", id, start, size, title, clean(link),
    signups.map(s => `${s.name}~${s.status}~${s.role}~${s.cls}`).join(";")].join("^");
  const count = k => signups.filter(s => s.status === k).length;
  const active = s => s.status === "Y" || s.status === "L";
  return {
    id, title, start, size, link, leader: clean(d.leadername || d.leaderName || ""),
    counts: {
      signed: count("Y") + count("L"), late: count("L"), tentative: count("T"), bench: count("B"), declined: count("N"),
      tanks: signups.filter(s => active(s) && s.role === "T").length,
      healers: signups.filter(s => active(s) && s.role === "H").length,
    },
    signups, import: importLine,
  };
}

async function notifyNew(newRaids) {
  if (!WEBHOOK || newRaids.length === 0) return;
  const lines = newRaids.map(r => `• **${r.title}** – <t:${r.start}:F> (${r.counts.signed} signed)`);
  const content = `New raid${newRaids.length > 1 ? "s" : ""} ready to import in game:\n${lines.join("\n")}` +
    (PAGE_URL ? `\nCopy here: ${PAGE_URL}` : "");
  const res = await fetch(WEBHOOK, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, username: "Juzni Vetar Raids", allowed_mentions: { parse: [] } }),
  });
  log(`Discord webhook: ${res.status}`);
}

const problems = [];
const listed = (await listServerEvents(problems))
  .filter(e => !e.start || e.start > now - KEEP_AFTER_START).map(e => e.id);
log(`Server listing: ${listed.length} upcoming event(s).`);
const ids = [...new Set([...listed, ...(await extraEvents())])];
const raids = [];
for (const id of ids) {
  try {
    const raid = toRaid(await getEvent(id), id);
    if (raid.start && raid.start > now - KEEP_AFTER_START) raids.push(raid);
  } catch (e) { problems.push(`${id}: ${e.message}`); }
}
raids.sort((a, b) => a.start - b.start);

let previous = { raids: [] };
try { previous = JSON.parse(await readFile(DATA_FILE, "utf8")); } catch {}

if (JSON.stringify(previous.raids) === JSON.stringify(raids) && !problems.length) {
  log(`No changes (${raids.length} raid(s)).`);
} else {
  const out = { updated: new Date().toISOString(), server: SERVER_ID, raids, all: raids.map(r => r.import).join("\n"), problems };
  await writeFile(DATA_FILE, JSON.stringify(out, null, 2) + "\n");
  log(`Wrote ${raids.length} raid(s).`);
  const oldIds = new Set((previous.raids || []).map(r => r.id));
  await notifyNew(raids.filter(r => !oldIds.has(r.id) && r.start > now));
}
if (problems.length) console.error("Problems:\n" + problems.join("\n"));
if (!ids.length && API_KEY) process.exit(1);   // nothing found at all: fail so it gets noticed
