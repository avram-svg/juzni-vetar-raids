// Pulls upcoming Raid-Helper events for the Juzni Vetar Discord server and writes
// docs/data.json, which the page in docs/ shows with a "Copy all raids" button.
// Runs on GitHub Actions (Node 20+, no packages needed).

import { readFile, writeFile } from "node:fs/promises";

const SERVER_ID = process.env.RH_SERVER_ID || "897135062951276604";
const API_KEY = (process.env.RH_API_KEY || "").trim();
const WEBHOOK = (process.env.DISCORD_WEBHOOK || "").trim();
const REPO = process.env.GITHUB_REPOSITORY || "";
const PAGE_URL = process.env.PAGE_URL ||
  (REPO ? `https://${REPO.split("/")[0].toLowerCase()}.github.io/${REPO.split("/")[1]}/` : "");
const KEEP_AFTER_START = 6 * 3600;           // keep a raid on the page until 6h after it starts
const DATA_FILE = new URL("../docs/data.json", import.meta.url);
const EXTRA_FILE = new URL("../events.txt", import.meta.url);

const now = Math.floor(Date.now() / 1000);
const log = (...a) => console.log(...a);

// ---------- Raid-Helper ----------
async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { "User-Agent": "juzni-vetar-raids", ...headers } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${url}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

// All event IDs on the server (needs the server API key from /apikey)
async function listServerEvents() {
  if (!API_KEY) { log("No RH_API_KEY set: only events listed in events.txt are used."); return []; }
  const ids = [];
  for (let page = 1; page <= 10; page++) {
    const data = await getJson(`https://raid-helper.dev/api/v3/servers/${SERVER_ID}/events`,
      { Authorization: API_KEY, Page: String(page) });
    const list = data.postedEvents || data.events || [];
    for (const e of list) {
      const start = Number(e.startTime || e.unixtime || 0);
      if (!start || start > now - KEEP_AFTER_START) ids.push(String(e.id || e.raidid || e.eventId));
    }
    const pages = Number(data.pages || 1);
    if (page >= pages || list.length === 0) break;
  }
  log(`Server listing: ${ids.length} upcoming event(s).`);
  return ids;
}

// Extra events: message links or IDs, one per line (works without an API key)
async function extraEvents() {
  try {
    const text = await readFile(EXTRA_FILE, "utf8");
    return text.split(/\r?\n/).map(l => l.replace(/#.*/, "").trim()).filter(Boolean)
      .map(l => (l.match(/(\d{15,22})\D*$/) || [])[1]).filter(Boolean);
  } catch { return []; }
}

async function getEvent(id) {
  const tries = [
    [`https://raid-helper.dev/api/v2/events/${id}`, API_KEY ? { Authorization: API_KEY } : {}],
    [`https://raid-helper.dev/api/event/${id}`, {}],
  ];
  let lastErr;
  for (const [url, headers] of tries) {
    try {
      let d = await getJson(url, headers);
      if (d.event && typeof d.event === "object") d = d.event;
      if (d.signUps || d.signups) return d;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error(`No data for event ${id}`);
}

// ---------- Mapping (same rules as the importer page) ----------
const clean = s => String(s ?? "").replace(/[\^~;|\r\n\t]/g, " ").replace(/\s+/g, " ").trim();

const CLASS = {
  warrior: "WARRIOR", paladin: "PALADIN", hunter: "HUNTER", rogue: "ROGUE", priest: "PRIEST",
  shaman: "SHAMAN", mage: "MAGE", warlock: "WARLOCK", druid: "DRUID",
  dk: "DEATHKNIGHT", deathknight: "DEATHKNIGHT", "death knight": "DEATHKNIGHT",
};
// Raid-Helper spec names; "1" marks the second class with the same spec name
const SPEC = {
  protection: "WARRIOR", arms: "WARRIOR", fury: "WARRIOR",
  protection1: "PALADIN", holy1: "PALADIN", retribution: "PALADIN",
  guardian: "DRUID", feral: "DRUID", balance: "DRUID", restoration: "DRUID",
  restoration1: "SHAMAN", elemental: "SHAMAN", enhancement: "SHAMAN",
  holy: "PRIEST", discipline: "PRIEST", shadow: "PRIEST",
  blood: "DEATHKNIGHT", frost1: "DEATHKNIGHT", unholy: "DEATHKNIGHT",
  arcane: "MAGE", fire: "MAGE", frost: "MAGE",
  affliction: "WARLOCK", demonology: "WARLOCK", destruction: "WARLOCK",
  assassination: "ROGUE", combat: "ROGUE", subtlety: "ROGUE",
  beastmastery: "HUNTER", marksmanship: "HUNTER", survival: "HUNTER",
};

function classOf(s) {
  for (const c of [s.cClass, s.className, s.class]) {
    const k = String(c || "").toLowerCase().replace(/[\s_]/g, "");
    if (CLASS[k]) return CLASS[k];
  }
  const spec = String(s.cSpec || s.specName || s.spec || "").toLowerCase().replace(/[\s_]/g, "");
  return SPEC[spec] || "";
}
function statusOf(s) {
  const c = String(s.className || s.class || "").toLowerCase();
  const st = String(s.status || "").toLowerCase();
  if (["absence", "absent", "declined"].includes(c)) return "N";
  if (c === "tentative") return "T";
  if (c === "late") return "L";
  if (c === "bench" || st === "bench" || st === "queued") return "B";
  return "Y";
}
function roleOf(s) {
  const txt = [s.roleName, s.role, s.className, s.class].map(x => String(x || "")).join(" ").toLowerCase();
  if (/tank/.test(txt)) return "T";
  if (/heal/.test(txt)) return "H";
  const spec = String(s.specName || s.spec || "").toLowerCase();
  if (/^(protection|guardian|blood)\d*$/.test(spec)) return "T";
  if (/^(holy|restoration|discipline)\d*$/.test(spec)) return "H";
  return "D";
}
function startOf(d) {
  for (const k of ["startTime", "unixtime", "startTimestamp"]) {
    const n = Number(d[k]); if (n > 1e9) return n > 1e12 ? Math.floor(n / 1000) : n;
  }
  return null;
}

function toRaid(d, fallbackId) {
  const start = startOf(d);
  const id = String(d.raidid || d.id || fallbackId);
  const list = d.signUps || d.signups || [];
  const signups = list.map(s => ({
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
  return {
    id, title, start, size, link, leader: clean(d.leadername || d.leaderName || ""),
    counts: {
      signed: count("Y") + count("L"), late: count("L"), tentative: count("T"), bench: count("B"), declined: count("N"),
      tanks: signups.filter(s => (s.status === "Y" || s.status === "L") && s.role === "T").length,
      healers: signups.filter(s => (s.status === "Y" || s.status === "L") && s.role === "H").length,
    },
    signups, import: importLine,
  };
}

// ---------- Discord (optional) ----------
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

// ---------- Main ----------
const ids = [...new Set([...(await listServerEvents()), ...(await extraEvents())])];
const raids = [];
const problems = [];
for (const id of ids) {
  try {
    const raid = toRaid(await getEvent(id), id);
    if (raid.start && raid.start > now - KEEP_AFTER_START) raids.push(raid);
  } catch (e) { problems.push(`${id}: ${e.message}`); }
}
raids.sort((a, b) => a.start - b.start);

let previous = { raids: [] };
try { previous = JSON.parse(await readFile(DATA_FILE, "utf8")); } catch {}
const before = JSON.stringify(previous.raids);
const after = JSON.stringify(raids);

if (before === after && !problems.length) {
  log(`No changes (${raids.length} raid(s)).`);
} else {
  const out = {
    updated: new Date().toISOString(),
    server: SERVER_ID,
    raids,
    all: raids.map(r => r.import).join("\n"),
    problems,
  };
  await writeFile(DATA_FILE, JSON.stringify(out, null, 2) + "\n");
  log(`Wrote ${raids.length} raid(s).`);
  const oldIds = new Set((previous.raids || []).map(r => r.id));
  await notifyNew(raids.filter(r => !oldIds.has(r.id) && r.start > now));
}
if (problems.length) { console.error("Problems:\n" + problems.join("\n")); }
if (ids.length && !raids.length && problems.length === ids.length) process.exit(1);
