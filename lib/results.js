// Multi-region lottery results, normalized to the bolitero shape the app uses:
//   { ts, draws:[{ board, date, session, pick3, pick4, source }], realBoards, boards }
//
// PROVIDERS (in priority order per board):
//   • New York  → REAL, free, no key (data.ny.gov: Daily Numbers + Win 4).
//   • magayo    → REAL, needs MAGAYO_API_KEY (covers US states + Puerto Rico + intl).
//                 Game codes live in lib/magayo-codes.js.
//   • demo      → deterministic reference numbers (source:"demo") when no live feed.
//
// ─────────────────────────────────────────────────────────────────────────────
// QUOTA STRATEGY (why this file looks the way it does)
// magayo paid plans are billed per API request per calendar month (Silver = 1,000).
// With 118 distinct game codes a naive "re-poll everything every 30 min" design
// burns ~170,000 calls/month — the quota is gone in hours (error 303). But a
// lottery draw RESULT IS IMMUTABLE once published, so we never need to poll a game
// twice for the same draw. Four rules keep us inside any plan:
//   1. CAPTURE-ONCE   — poll a game only until we hold its latest expected draw,
//                       then freeze it until the next draw is due (see gameDue).
//   2. TIME-GATED     — never poll before a session's result could be posted
//                       (expectedDate); no daytime polling of evening games.
//   3. TRAFFIC-DECOUPLED — visitor page-loads read cache only; polling happens in
//                       a throttled sweep (MAGAYO_SWEEP_MIN) + a daily cron, so a
//                       traffic spike can't drain the quota.
//   4. BUDGET GUARD   — a per-month Redis counter hard-caps calls at
//                       MAGAYO_MONTHLY_CAP (default 950); once hit, ALL upstream
//                       calls stop until the next calendar month → 303 impossible.
// Net: ~118 calls/day worst case (≈3,500/month) to keep ALL 33 boards real, and
// far less in steady state. The cap + MAGAYO_PRIORITY decide who stays real first
// when a plan is too small for everything.
//   5. BOARD ALLOWLIST — MAGAYO_BOARDS limits polling to the boards actually in
//                       use (default: florida,georgia,chicago,pr,texas,newjersey).
//                       Those 6 boards = ~30 game codes → ≈30 calls/day (~900/mo
//                       worst case), still under the 950 cap. Texas alone is 4
//                       draws/day (8 codes); drop it to ~22 codes if a tighter
//                       margin is wanted. New York is free; other boards show DEMO.
// ─────────────────────────────────────────────────────────────────────────────

let MAGAYO_CODES = {};
try { MAGAYO_CODES = require("./magayo-codes"); } catch { MAGAYO_CODES = {}; }

const store = require("./store");
const cleanEnv = (v) => String(v || "").replace(/[^\x21-\x7E]/g, "").replace(/["']/g, "");
const NUM = (v, d) => { const n = Number(cleanEnv(v)); return Number.isFinite(n) && n > 0 ? n : d; };

// Tunable knobs (all optional env; defaults sized for the Silver plan).
const MONTHLY_CAP = NUM(process.env.MAGAYO_MONTHLY_CAP, 950);          // hard ceiling / month
const SWEEP_MS    = NUM(process.env.MAGAYO_SWEEP_MIN, 20) * 60 * 1000; // min gap between sweeps
const RETRY_MS    = NUM(process.env.MAGAYO_RETRY_MIN, 45) * 60 * 1000; // backoff per game when no result yet
const MAX_POLLS   = NUM(process.env.MAGAYO_MAX_POLLS_PER_SWEEP, 30);   // bound a single (non-cron) sweep
// Boards to keep real FIRST when the budget can't cover everything (ids; rest
// follow in catalog order). New York is free and never counted here.
const PRIORITY = cleanEnv(process.env.MAGAYO_PRIORITY ||
  "florida,georgia,pr,chicago,newjersey,pennsylvania,texas,california,connecticut,ohio")
  .split(",").map((s) => s.trim()).filter(Boolean);

// ACTIVE BOARDS allowlist — the only magayo boards we actually poll (quota saver).
// Default = the boards the business uses today (Florida, Georgia, Illinois,
// Puerto Rico, Texas, New Jersey); New York is free/unmetered and always on
// regardless. Every other board falls back to the clearly-labeled DEMO engine —
// zero API calls. Widen/trim the roster WITHOUT a code change by setting
// MAGAYO_BOARDS (comma list of ids), or MAGAYO_BOARDS="all" to poll every board.
const BOARDS_ALLOW = cleanEnv(process.env.MAGAYO_BOARDS || "florida,georgia,chicago,pr,texas,newjersey")
  .split(",").map((s) => s.trim()).filter(Boolean);
const ALLOW_ALL = BOARDS_ALLOW.length === 1 && BOARDS_ALLOW[0].toLowerCase() === "all";
const boardAllowed = (id) => ALLOW_ALL || BOARDS_ALLOW.includes(id);

const SWEEP_KEY = "magayo:sweep";
const budgetKey = (now) => `magayo:budget:${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

// UTC hours AFTER a US draw-date's 00:00 UTC by which that session's result is
// reliably posted (conservative/late to avoid wasted early polls). Evening draws
// run late and lag a few hours, so "Noche" is >24h.
const SESSION_READY_H = { "Mañana": 17, "Mediodía": 20, "Tarde": 24, "Noche": 30 };

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

// New York Daily Numbers + Win 4 (official open data, current, no key, no quota).
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

// ── magayo upstream + cache ──────────────────────────────────────────────────

// One raw magayo call (counts as 1 API request, success or not). Returns
// { date, digits } on a real draw, { limited:true } on a 303 quota error, or null.
async function fetchMagayoGameLive(code) {
  const key = cleanEnv(process.env.MAGAYO_API_KEY);
  const url = `https://www.magayo.com/api/results.php?api_key=${encodeURIComponent(key)}&game=${encodeURIComponent(code)}`;
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  const d = await r.json().catch(() => ({}));
  const err = (d && typeof d.error !== "undefined") ? Number(d.error) : 0;
  if (err === 303) return { limited: true };               // quota reached — back off
  if (!d || err || !d.results || d.results === "-") return null;
  return { date: String(d.draw || "").slice(0, 10), digits: String(d.results).replace(/[^0-9]/g, "") };
}

// Per-game cache record: { date, digits, lastAttempt }.
async function readGame(code) {
  try { const raw = await store.get("magayo:g:" + code); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
async function getCachedGame(code) {
  const c = await readGame(code);
  return c && c.date ? { date: c.date, digits: c.digits } : null;
}
async function writeGame(code, patch) {
  const prev = (await readGame(code)) || {};
  try { await store.set("magayo:g:" + code, JSON.stringify({ ...prev, ...patch })); } catch { /* fail-soft */ }
}

// The latest US draw DATE for `session` whose result should be posted by `now`.
function expectedDate(session, now) {
  const readyMs = (SESSION_READY_H[session] ?? 24) * 3600 * 1000;
  return dkOf(new Date(now.getTime() - readyMs));
}

// A game needs an upstream poll iff we don't yet hold its latest expected draw
// AND we haven't just tried (per-game backoff while a result is still pending).
async function gameDue(code, session, now) {
  const c = await readGame(code);
  const have = c && c.date ? c.date : "";
  if (have >= expectedDate(session, now)) return false;            // already captured
  const lastAtt = c && c.lastAttempt ? c.lastAttempt : 0;
  if (Date.now() - lastAtt < RETRY_MS) return false;              // backing off
  return true;
}

// Boards in priority order (configured first, then catalog order), de-duped.
function orderedBoards() {
  const ids = CATALOG.map((b) => b.id).filter((id) => MAGAYO_CODES[id] && boardAllowed(id));
  const head = PRIORITY.filter((id) => MAGAYO_CODES[id] && boardAllowed(id));
  return [...new Set([...head, ...ids])];
}

// Refresh the per-game cache from magayo — bounded by the sweep throttle, the
// per-sweep poll cap, and the monthly budget. `full` (cron) lifts the per-sweep
// cap but still honors the monthly budget. Never throws.
async function magayoSweep(now, full) {
  const last = Number(await store.get(SWEEP_KEY)) || 0;
  if (!full && Date.now() - last < SWEEP_MS) return;              // too soon → serve cache
  await store.set(SWEEP_KEY, String(Date.now()));

  const mKey = budgetKey(now);
  let used = Number(await store.get(mKey)) || 0;
  if (used >= MONTHLY_CAP) return;                                // budget spent → stop

  const maxPolls = full ? Infinity : MAX_POLLS;
  let polls = 0;

  for (const board of orderedBoards()) {
    const map = MAGAYO_CODES[board];
    for (const session of Object.keys(map)) {
      const codes = map[session]; if (!codes) continue;
      for (const code of [codes.p3, codes.p4]) {
        if (!code) continue;
        if (used >= MONTHLY_CAP || polls >= maxPolls) return;
        if (!(await gameDue(code, session, now))) continue;

        polls++;
        let live = null;
        try { live = await fetchMagayoGameLive(code); } catch { live = null; }
        used = (await store.incr(mKey)) || (used + 1);           // every call counts
        if (live && live.limited) {                              // unexpected 303 → freeze month
          await store.set(mKey, String(MONTHLY_CAP));
          return;
        }
        await writeGame(code, live && live.digits
          ? { date: live.date, digits: live.digits, lastAttempt: Date.now() }
          : { lastAttempt: Date.now() });                        // record attempt; keep last good
      }
    }
  }
}

// Current month's magayo budget usage — a plain store read (no API call), for the
// health probe so the owner can see how much quota is left.
async function magayoBudget() {
  const now = new Date();
  const used = Number(await store.get(budgetKey(now))) || 0;
  return { used, cap: MONTHLY_CAP, remaining: Math.max(0, MONTHLY_CAP - used) };
}

// opts: { allowSweep?: boolean (default true), fullSweep?: boolean (cron) }.
async function buildResults(opts = {}) {
  const today = new Date();
  const y = new Date(today); y.setUTCDate(today.getUTCDate() - 1);
  const days = [dkOf(today), dkOf(y)];

  const draws = [];
  for (const dk of days) for (const b of CATALOG) for (const session of b.sessions) {
    const { pick3, pick4 } = demoDraw(b.id, dk, session);
    draws.push({ board: b.id, date: dk, session, pick3, pick4, source: "demo" });
  }

  const realBoards = new Set();
  const real = [];
  try { const ny = await fetchNewYork(); if (ny.length) { real.push(...ny); realBoards.add("newyork"); } } catch { /* keep demo */ }

  if (cleanEnv(process.env.MAGAYO_API_KEY) && Object.keys(MAGAYO_CODES).length) {
    // 1) Refresh the cache (bounded + budgeted). Display never depends on this
    //    succeeding — it only reads from cache below.
    if (opts.allowSweep !== false) { try { await magayoSweep(today, !!opts.fullSweep); } catch { /* fail-soft */ } }

    // 2) Assemble board results purely from cache — never fabricated; a session
    //    goes "real" only when EVERY mapped game has a cached draw.
    const codesNeeded = new Set();
    for (const b of CATALOG) {
      const map = MAGAYO_CODES[b.id]; if (!map || !boardAllowed(b.id)) continue;
      for (const s of b.sessions) { const c = map[s] || map.default; if (c) { if (c.p3) codesNeeded.add(c.p3); if (c.p4) codesNeeded.add(c.p4); } }
    }
    const cache = {};
    await Promise.all([...codesNeeded].map(async (code) => { cache[code] = await getCachedGame(code); }));

    for (const b of CATALOG) {
      const map = MAGAYO_CODES[b.id]; if (!map || !boardAllowed(b.id)) continue;
      for (const session of b.sessions) {
        const codes = map[session] || map.default; if (!codes) continue;
        const p3 = codes.p3 ? cache[codes.p3] : null;
        const p4 = codes.p4 ? cache[codes.p4] : null;
        if (codes.p3 && !p3) continue;
        if (codes.p4 && !p4) continue;
        real.push({
          board: b.id, date: (p3 || p4).date, session,
          pick3: (p3 ? p3.digits : "").padStart(3, "0").slice(-3),
          pick4: (p4 ? p4.digits : "").padStart(4, "0").slice(-4),
          source: "real",
        });
        realBoards.add(b.id);
      }
    }
  }

  const realKeys = new Set(real.map((d) => `${d.board}|${d.date}|${d.session}`));
  const merged = draws.filter((d) => !realKeys.has(`${d.board}|${d.date}|${d.session}`)).concat(real);

  return { ts: Date.now(), draws: merged, realBoards: [...realBoards] };
}

module.exports = { buildResults, magayoBudget, CATALOG };
