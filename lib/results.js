// Multi-region lottery results, normalized to the bolitero shape the app uses:
//   { ts, draws:[{ board, date, session, pick3, pick4, source }], realBoards, boards }
//
// PROVIDERS (in priority order per board):
//   • New York  → REAL, free, no key (data.ny.gov: Daily Numbers + Win 4).
//   • magayo    → REAL, needs MAGAYO_API_KEY (covers US states + Puerto Rico + intl).
//                 Game codes live in lib/magayo-codes.js (fill from your magayo dashboard).
//   • demo      → deterministic reference numbers (source:"demo") when no live feed.

let MAGAYO_CODES = {};
try { MAGAYO_CODES = require("./magayo-codes"); } catch { MAGAYO_CODES = {}; }

const MD_N = ["Mediodía", "Noche"];

// Board roster (id must match the frontend LOTTERIES list).
const US_BOARDS = [
  ["newyork", "New York", MD_N], ["florida", "Florida", MD_N], ["georgia", "Georgia", ["Mediodía", "Tarde", "Noche"]],
  ["chicago", "Illinois", MD_N], ["california", "California", MD_N], ["texas", "Texas", ["Mañana", "Mediodía", "Tarde", "Noche"]],
  ["newjersey", "New Jersey", MD_N], ["pennsylvania", "Pennsylvania", MD_N], ["ohio", "Ohio", MD_N],
  ["michigan", "Michigan", MD_N], ["virginia", "Virginia", MD_N], ["northcarolina", "North Carolina", MD_N],
  ["southcarolina", "South Carolina", MD_N], ["tennessee", "Tennessee", ["Mañana", "Mediodía", "Noche"]], ["maryland", "Maryland", MD_N],
  ["massachusetts", "Massachusetts", MD_N], ["connecticut", "Connecticut", MD_N], ["dc", "Washington DC", MD_N],
  ["indiana", "Indiana", MD_N], ["missouri", "Missouri", MD_N], ["wisconsin", "Wisconsin", ["Noche"]],
  ["minnesota", "Minnesota", ["Noche"]], ["louisiana", "Louisiana", ["Noche"]], ["arizona", "Arizona", ["Noche"]],
  ["colorado", "Colorado", ["Noche"]], ["kentucky", "Kentucky", MD_N], ["arkansas", "Arkansas", MD_N],
  ["kansas", "Kansas", ["Noche"]], ["iowa", "Iowa", MD_N], ["oklahoma", "Oklahoma", ["Noche"]],
  ["oregon", "Oregon", ["Mañana", "Mediodía", "Tarde", "Noche"]], ["newmexico", "New Mexico", ["Noche"]], ["delaware", "Delaware", MD_N],
  ["rhodeisland", "Rhode Island", ["Noche"]], ["maine", "Maine", MD_N], ["newhampshire", "New Hampshire", MD_N],
  ["vermont", "Vermont", MD_N], ["westvirginia", "West Virginia", ["Noche"]], ["idaho", "Idaho", ["Noche"]],
  ["montana", "Montana", ["Noche"]], ["northdakota", "North Dakota", ["Noche"]], ["southdakota", "South Dakota", ["Noche"]],
  ["nebraska", "Nebraska", ["Noche"]], ["mississippi", "Mississippi", MD_N], ["washington", "Washington", ["Noche"]],
];
const INTL_BOARDS = [
  ["pr", "Puerto Rico", MD_N], ["rd", "Rep. Dominicana", MD_N],
  ["venezuela", "Venezuela", MD_N], ["espana", "España", MD_N],
];

const CATALOG = [
  { id: "labolita", region: "Bolita", sessions: ["Mañana", "Mediodía", "Tarde", "Noche"] },
  ...US_BOARDS.map(([id, , sessions]) => ({ id, region: "USA", sessions })),
  ...INTL_BOARDS.map(([id, , sessions]) => ({ id, region: "Internacional", sessions })),
];

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function demoDraw(board, dk, session) {
  const rng = mulberry32(hashStr(`${board}|${dk}|${session}`));
  return { pick3: String(Math.floor(rng() * 1000)).padStart(3, "0"), pick4: String(Math.floor(rng() * 10000)).padStart(4, "0") };
}
function dkOf(d) { return d.toISOString().slice(0, 10); }

// New York Daily Numbers + Win 4 (official open data, current, no key).
async function fetchNewYork() {
  const url = "https://data.ny.gov/resource/hsys-3def.json?$limit=5&$order=draw_date%20DESC";
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error("ny_" + r.status);
  const rows = await r.json();
  const out = [];
  const p3 = (v) => String(v).padStart(3, "0"), p4 = (v) => String(v).padStart(4, "0");
  for (const row of rows) {
    const date = String(row.draw_date || "").slice(0, 10);
    if (!date) continue;
    if (row.midday_daily) out.push({ board: "newyork", date, session: "Mediodía", pick3: p3(row.midday_daily), pick4: p4(row.midday_win_4 || ""), source: "real" });
    if (row.evening_daily) out.push({ board: "newyork", date, session: "Noche", pick3: p3(row.evening_daily), pick4: p4(row.evening_win_4 || ""), source: "real" });
  }
  return out;
}

// magayo.com — real results for US states + Puerto Rico + intl, when MAGAYO_API_KEY
// and game codes (lib/magayo-codes.js) are configured. Endpoint returns
// { error, draw, results } with results as comma/space separated digits.
async function fetchMagayoGame(code) {
  const key = process.env.MAGAYO_API_KEY;
  const url = `https://www.magayo.com/api/results.php?api_key=${encodeURIComponent(key)}&game=${encodeURIComponent(code)}`;
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  const d = await r.json().catch(() => ({}));
  if (!d || d.error || !d.results || d.results === "-") return null;
  const digits = String(d.results).replace(/[^0-9]/g, "");
  return { date: String(d.draw || "").slice(0, 10), digits };
}
async function fetchMagayoBoard(board, sessions) {
  const map = MAGAYO_CODES[board];
  if (!map) return [];
  const out = [];
  for (const session of sessions) {
    const codes = map[session] || map.default;
    if (!codes) continue;
    try {
      const p3res = codes.p3 ? await fetchMagayoGame(codes.p3) : null;
      const p4res = codes.p4 ? await fetchMagayoGame(codes.p4) : null;
      const base = p3res || p4res;
      if (!base) continue;
      out.push({
        board, date: base.date, session,
        pick3: (p3res ? p3res.digits : "").padStart(3, "0").slice(-3),
        pick4: (p4res ? p4res.digits : "").padStart(4, "0").slice(-4),
        source: "real",
      });
    } catch { /* skip; demo stays */ }
  }
  return out;
}

async function buildResults() {
  const today = new Date();
  const y = new Date(today); y.setUTCDate(today.getUTCDate() - 1);
  const days = [dkOf(today), dkOf(y)];

  const draws = [];
  for (const dk of days) for (const b of CATALOG) for (const session of b.sessions) {
    const { pick3, pick4 } = demoDraw(b.id, dk, session);
    draws.push({ board: b.id, date: dk, session, pick3, pick4, source: "demo" });
  }

  // Collect real feeds.
  const realBoards = new Set();
  const real = [];
  try { const ny = await fetchNewYork(); if (ny.length) { real.push(...ny); realBoards.add("newyork"); } } catch { /* keep demo */ }

  if (process.env.MAGAYO_API_KEY && Object.keys(MAGAYO_CODES).length) {
    const targets = CATALOG.filter(b => MAGAYO_CODES[b.id] && b.id !== "newyork");
    const got = await Promise.all(targets.map(b => fetchMagayoBoard(b.id, b.sessions).catch(() => [])));
    got.forEach((arr, i) => { if (arr.length) { real.push(...arr); realBoards.add(targets[i].id); } });
  }

  const realKeys = new Set(real.map(d => `${d.board}|${d.date}|${d.session}`));
  const merged = draws.filter(d => !realKeys.has(`${d.board}|${d.date}|${d.session}`)).concat(real);

  return { ts: Date.now(), draws: merged, realBoards: [...realBoards] };
}

module.exports = { buildResults, CATALOG };
