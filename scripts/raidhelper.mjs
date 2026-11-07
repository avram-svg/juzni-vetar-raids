// Shared Raid-Helper helpers for build.mjs (page data) and send.mjs (signups back to Discord).

export const SERVER_ID = process.env.RH_SERVER_ID || "897135062951276604";
export const API_KEY = (process.env.RH_API_KEY || "").trim();
export const log = (...a) => console.log(...a);

export async function request(url, { method = "GET", headers = {}, body } = {}) {
  const res = await fetch(url, {
    method,
    headers: { "User-Agent": "juzni-vetar-raids", ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${method} ${url}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

// ---------- Listing the server's events ----------
const LIST_ENDPOINTS = [
  ["POST", `https://raid-helper.dev/api/v3/servers/${SERVER_ID}/events`],
  ["POST", `https://raid-helper.dev/api/v2/servers/${SERVER_ID}/events`],
  ["GET", `https://raid-helper.dev/api/v4/servers/${SERVER_ID}/events`],
  ["GET", `https://raid-helper.dev/api/v3/servers/${SERVER_ID}/scheduledevents`],
  ["GET", `https://raid-helper.dev/api/v2/servers/${SERVER_ID}/events`],
  ["GET", `https://raid-helper.dev/api/v3/servers/${SERVER_ID}/events`],
];

function eventsIn(data) {
  if (Array.isArray(data)) return data;
  return data.postedEvents || data.events || data.scheduledEvents || [];
}

// Returns [{ id, start }] for all events the listing shows (needs the server API key).
export async function listServerEvents(problems) {
  if (!API_KEY) { log("No RH_API_KEY set: only events listed in events.txt are used."); return []; }
  const headers = page => ({ Authorization: API_KEY, Page: String(page), IncludeSignUps: "false" });
  let found = null;
  for (const [method, url] of LIST_ENDPOINTS) {
    try {
      const data = await request(url, { method, headers: headers(1) });
      log(`OK   ${method} ${url}`);
      found = { method, url, data };
      break;
    } catch (e) {
      log(`fail ${e.message.slice(0, 160)}`);
    }
  }
  if (!found) {
    problems.push("Couldn't list the server's events with the API key (see the run log). Using events.txt only.");
    return [];
  }
  const out = [];
  let data = found.data;
  for (let page = 1; page <= 10; page++) {
    const list = eventsIn(data);
    for (const e of list) {
      const id = e.id || e.raidid || e.eventId || e.messageId;
      if (id) out.push({ id: String(id), start: Number(e.startTime || e.unixtime || 0) });
    }
    const pages = Number(data.pages || 1);
    if (page >= pages || list.length === 0) break;
    data = await request(found.url, { method: found.method, headers: headers(page + 1) });
  }
  return out;
}

// Full event with signups
export async function getEvent(id) {
  const tries = [
    [`https://raid-helper.dev/api/v2/events/${id}`, API_KEY ? { Authorization: API_KEY } : {}],
    [`https://raid-helper.dev/api/event/${id}`, {}],
  ];
  let lastErr;
  for (const [url, headers] of tries) {
    try {
      let d = await request(url, { headers });
      if (d.event && typeof d.event === "object") d = d.event;
      if (d.signUps || d.signups) return d;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error(`No data for event ${id}`);
}

// ---------- Mapping between Raid-Helper and the addon ----------
export const clean = s => String(s ?? "").replace(/[\^~;|\r\n\t]/g, " ").replace(/\s+/g, " ").trim();

const CLASS = {
  warrior: "WARRIOR", paladin: "PALADIN", hunter: "HUNTER", rogue: "ROGUE", priest: "PRIEST",
  shaman: "SHAMAN", mage: "MAGE", warlock: "WARLOCK", druid: "DRUID",
  dk: "DEATHKNIGHT", deathknight: "DEATHKNIGHT",
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
const norm = x => String(x || "").toLowerCase().replace(/[\s_]/g, "");

export function classOf(s) {
  for (const c of [s.cClass, s.className, s.class]) if (CLASS[norm(c)]) return CLASS[norm(c)];
  return SPEC[norm(s.cSpec || s.specName || s.spec)] || "";
}
export function specOf(s) { return String(s.cSpec || s.specName || s.spec || ""); }
export function statusOf(s) {
  const c = String(s.className || s.class || "").toLowerCase();
  const st = String(s.status || "").toLowerCase();
  if (["absence", "absent", "declined"].includes(c)) return "N";
  if (c === "tentative") return "T";
  if (c === "late") return "L";
  if (c === "bench" || st === "bench" || st === "queued") return "B";
  return "Y";
}
export function roleOf(s) {
  const txt = [s.roleName, s.role, s.className, s.class].map(x => String(x || "")).join(" ").toLowerCase();
  if (/tank/.test(txt)) return "T";
  if (/heal/.test(txt)) return "H";
  const spec = norm(s.specName || s.spec);
  if (/^(protection|guardian|blood)\d*$/.test(spec)) return "T";
  if (/^(holy|restoration|discipline)\d*$/.test(spec)) return "H";
  return "D";
}
export function startOf(d) {
  for (const k of ["startTime", "unixtime", "startTimestamp"]) {
    const n = Number(d[k]); if (n > 1e9) return n > 1e12 ? Math.floor(n / 1000) : n;
  }
  return null;
}
export const signupsOf = d => d.signUps || d.signups || [];
export const userIdOf = s => String(s.userId || s.userid || s.user_id || "");

// What to send Raid-Helper for a wanted status/role/class: { className, specName }
const RH_CLASS_NAME = {
  WARRIOR: "Warrior", PALADIN: "Paladin", HUNTER: "Hunter", ROGUE: "Rogue", PRIEST: "Priest",
  SHAMAN: "Shaman", MAGE: "Mage", WARLOCK: "Warlock", DRUID: "Druid", DEATHKNIGHT: "DK",
};
const DEFAULT_SPEC = {
  T: { WARRIOR: "Protection", PALADIN: "Protection1", DRUID: "Guardian", DEATHKNIGHT: "Blood" },
  H: { PRIEST: "Holy", PALADIN: "Holy1", DRUID: "Restoration", SHAMAN: "Restoration1" },
  D: { WARRIOR: "Fury", PALADIN: "Retribution", DRUID: "Balance", SHAMAN: "Elemental", PRIEST: "Shadow",
       MAGE: "Fire", WARLOCK: "Destruction", ROGUE: "Combat", HUNTER: "Marksmanship", DEATHKNIGHT: "Unholy" },
};
const PSEUDO = { N: "Absence", T: "Tentative", L: "Late", B: "Bench" };

export function wantedSignup({ status, role, cls }, current) {
  // keep the spec they already chose on Discord when the class still fits
  let spec = current && classOf(current) === cls && roleOf(current) === role ? specOf(current) : "";
  if (!spec) spec = (DEFAULT_SPEC[role] || {})[cls] || (DEFAULT_SPEC.D[cls] || "");
  let className;
  if (PSEUDO[status]) className = PSEUDO[status];
  else if (role === "T") className = "Tank";
  else className = RH_CLASS_NAME[cls] || "";
  return { className, specName: spec };
}
