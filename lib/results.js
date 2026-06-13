// Real + fallback lottery results, normalized to the bolitero shape the app
// already consumes: { ts, draws:[{ board, date, session, pick3, pick4, source }] }.
//
// REAL sources (free, no key):
//   • newyork  → NY open data (Daily Numbers = pick3, Win 4 = pick4), midday/evening.
// Boards without a free official feed (labolita/florida/chicago/georgia) use a
// deterministic engine and are tagged source:"demo" until a paid multi-state
// feed (e.g. MAGAYO_API_KEY) is wired in.

const BOARD_SESSIONS = {
  labolita: ["Mañana", "Mediodía", "Tarde", "Noche"],
  florida: ["Mediodía", "Noche"],
  chicago: ["Mediodía", "Noche"],
  georgia: ["Mediodía", "Tarde", "Noche"],
  newyork: ["Mediodía", "Noche"],
};

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function demoDraw(board, dk, session) {
  const rng = mulberry32(hashStr(`${board}|${dk}|${session}`));
  const pick3 = String(Math.floor(rng() * 1000)).padStart(3, "0");
  const pick4 = String(Math.floor(rng() * 10000)).padStart(4, "0");
  return { pick3, pick4 };
}

function dkOf(d) { return d.toISOString().slice(0, 10); }

// New York Daily Numbers + Win 4 (official open data, current, no key).
async function fetchNewYork() {
  const url = "https://data.ny.gov/resource/hsys-3def.json?$limit=5&$order=draw_date%20DESC";
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error("ny_" + r.status);
  const rows = await r.json();
  const out = [];
  for (const row of rows) {
    const date = String(row.draw_date || "").slice(0, 10);
    if (!date) continue;
    const p3 = (v) => String(v).padStart(3, "0");
    const p4 = (v) => String(v).padStart(4, "0");
    if (row.midday_daily) out.push({ board: "newyork", date, session: "Mediodía", pick3: p3(row.midday_daily), pick4: p4(row.midday_win_4 || ""), source: "real" });
    if (row.evening_daily) out.push({ board: "newyork", date, session: "Noche", pick3: p3(row.evening_daily), pick4: p4(row.evening_win_4 || ""), source: "real" });
  }
  return out;
}

async function buildResults() {
  const today = new Date();
  const y = new Date(today); y.setUTCDate(today.getUTCDate() - 1);
  const days = [dkOf(today), dkOf(y)];

  const draws = [];
  for (const dk of days) {
    for (const board of Object.keys(BOARD_SESSIONS)) {
      for (const session of BOARD_SESSIONS[board]) {
        const { pick3, pick4 } = demoDraw(board, dk, session);
        draws.push({ board, date: dk, session, pick3, pick4, source: "demo" });
      }
    }
  }

  // Overlay real feeds, replacing the demo placeholders for matching slots.
  const realBoards = [];
  let real = [];
  try { real = await fetchNewYork(); if (real.length) realBoards.push("newyork"); } catch { /* keep demo */ }

  const realKeys = new Set(real.map(d => `${d.board}|${d.date}|${d.session}`));
  const merged = draws.filter(d => !realKeys.has(`${d.board}|${d.date}|${d.session}`));
  merged.push(...real);

  return { ts: Date.now(), draws: merged, realBoards };
}

module.exports = { buildResults, BOARD_SESSIONS };
