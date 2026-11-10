// Sends in-game signups (the addon's "Raid-Helper sync" line) to the Raid-Helper events,
// so the Discord posts show them. Run from the "Send to Raid-Helper" workflow.
//
// Line format: GRX1^eventId^char~status~role~CLASS~discordName;...
// status: Y signed, L late, T tentative, B bench, N declined, X removed

import {
  API_KEY, log, request, listServerEvents, getEvent, signupsOf, userIdOf,
  classOf, specOf, wantedSignup,
} from "./raidhelper.mjs";

const INPUT = process.env.SYNC_LINE || "";
const DRY_RUN = /^(true|1|yes)$/i.test(process.env.DRY_RUN || "");

if (!API_KEY) { console.error("RH_API_KEY secret is missing."); process.exit(1); }

const blocks = INPUT.replace(/\s*GRX1\^/g, "\nGRX1^").split("\n").map(l => l.trim()).filter(l => l.startsWith("GRX1^"));
if (!blocks.length) { console.error("No GRX1^ line found. Copy it from the addon: Export > Raid-Helper sync."); process.exit(1); }

// same cleanup as the addon: "Rott | Rotina" and "Rott Rotina" are the same name
const norm = s => String(s || "").toLowerCase().replace(/[\^~;|\r\n\t]/g, " ").replace(/\s+/g, " ").trim();

// Discord name -> userId, learned from everyone who has signed up on any listed event
async function buildDirectory(extraEvents) {
  const dir = new Map();
  const add = d => {
    for (const s of signupsOf(d)) {
      const id = userIdOf(s);
      if (id && s.name) dir.set(norm(s.name), id);
    }
  };
  for (const d of extraEvents) add(d);
  const problems = [];
  for (const e of (await listServerEvents(problems)).slice(0, 30)) {
    try { add(await getEvent(e.id)); } catch {}
  }
  return dir;
}

// Raid-Helper's signup endpoints differ between API versions; try the likely ones.
async function writeSignup(eventId, userId, body, current) {
  const h = { Authorization: API_KEY };
  const base = v => `https://raid-helper.dev/api/${v}/events/${eventId}/signups`;
  const attempts = current
    ? [
        ["PATCH", `${base("v4")}/${userId}`], ["PUT", `${base("v4")}/${userId}`], ["POST", base("v4")],
        ["PATCH", `${base("v2")}/${userId}`], ["PUT", `${base("v2")}/${userId}`],
      ]
    : [["POST", base("v4")], ["PUT", `${base("v4")}/${userId}`], ["POST", base("v2")]];
  const errors = [];
  for (const [method, url] of attempts) {
    try {
      await request(url, { method, headers: h, body: { userId, ...body, notify: false } });
      return `${method} ok`;
    } catch (e) { errors.push(e.message.slice(0, 180)); }
  }
  throw new Error(errors.join("\n      "));
}

async function deleteSignup(eventId, userId) {
  const errors = [];
  for (const v of ["v4", "v2"]) {
    try {
      await request(`https://raid-helper.dev/api/${v}/events/${eventId}/signups/${userId}`, { method: "DELETE", headers: { Authorization: API_KEY } });
      return `DELETE ${v} ok`;
    } catch (e) { errors.push(e.message.slice(0, 180)); }
  }
  throw new Error(errors.join("\n      "));
}

// One Discord account can have several characters in the line (main + alts).
// Keep the strongest answer: anyone coming beats a decline on an alt.
const RANK = { Y: 5, L: 4, T: 3, B: 2, N: 1, X: 0 };

let done = 0, skipped = 0, failed = 0;
const summary = [];

for (const block of blocks) {
  const [, eventId, list = ""] = block.split("^");
  let event;
  try { event = await getEvent(eventId); }
  catch (e) {
    failed++;
    summary.push(`! Raid ${eventId}: not found on Raid-Helper (deleted or reposted on Discord?). Skipped it.`);
    log(`\n== ${eventId}: not found on Raid-Helper, skipping`);
    continue;
  }
  log(`\n== ${event.title || eventId} (${eventId})`);
  const current = new Map();          // userId -> current signup
  for (const s of signupsOf(event)) if (userIdOf(s)) current.set(userIdOf(s), s);
  const directory = await buildDirectory([event]);

  const byUser = new Map();
  for (const entry of list.split(";").filter(Boolean)) {
    const [char, status, role, cls, discord] = entry.split("~");
    const userId = directory.get(norm(discord)) || directory.get(norm(char));
    const who = `${char}${discord && norm(discord) !== norm(char) ? ` (${discord})` : ""}`;
    if (!userId) {
      skipped++; summary.push(`? ${who}: no Discord account known. They need to sign up on Discord once, or link their Discord name in the addon.`);
      continue;
    }
    const prev = byUser.get(userId);
    if (prev && (RANK[prev.status] ?? 0) >= (RANK[status] ?? 0)) {
      skipped++; summary.push(`= ${who}: same person as ${prev.who}, keeping their answer`); continue;
    }
    if (prev) { skipped++; summary.push(`= ${prev.who}: same person as ${who}, using ${who}'s answer`); }
    byUser.set(userId, { char, status, role, cls, who });
  }

  for (const [userId, { char, status, role, cls, who }] of byUser) {
    const cur = current.get(userId);
    try {
      if (status === "X") {
        if (!cur) { skipped++; summary.push(`= ${who}: already not signed up`); continue; }
        const r = DRY_RUN ? "dry run" : await deleteSignup(eventId, userId);
        done++; summary.push(`- ${who}: removed (${r})`);
        continue;
      }
      const want = wantedSignup({ status, role, cls }, cur);
      if (!want.className || !want.specName) {
        skipped++; summary.push(`? ${who}: don't know the Raid-Helper class for ${cls || "unknown class"}`); continue;
      }
      if (cur && (cur.className || cur.class) === want.className && specOf(cur) === want.specName) {
        skipped++; summary.push(`= ${who}: already ${want.className}/${want.specName}`); continue;
      }
      const r = DRY_RUN ? "dry run" : await writeSignup(eventId, userId, want, cur);
      done++; summary.push(`+ ${who}: ${want.className}/${want.specName} (${r})`);
    } catch (e) {
      failed++; summary.push(`! ${who}: failed\n      ${e.message}`);
    }
  }
}

log("\n" + summary.join("\n"));
log(`\n${DRY_RUN ? "[dry run] " : ""}${done} sent, ${skipped} skipped, ${failed} failed.`);
if (failed && !done && !skipped) process.exit(1);
