// /api/lottery-results-feed – Free live lottery numbers via Lottery Results Feed (https://lotteryresultsfeed.com)
// Environment variable: LOTTERY_RESULTS_FEED_KEY (free tier – 1 request/min per game)
// This endpoint returns JSON with the latest draws for the configured games.
// It uses the same optional cache mechanism the project already has (via /api/db) to stay within rate limits.

const CACHE_KEY = "cache:lottery-results-feed";
const CACHE_MIN = 30; // minutes to keep cache (same as magayo implementation)

// List of games you want to expose. Adjust as needed.
const GAMES = [
  "powerball",
  "megamillions",
  "euromillions",
  "lotto-max",
  // add any other game slugs supported by the API (see docs)
];

async function fetchGame(key, game) {
  try {
    const url = `https://api.lotteryresultsfeed.com/v1/${game}/latest`;
    const resp = await fetch(url, {
      headers: { "x-api-key": key },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    // Normalize fields – the API returns `draw_date` or `date`
    const drawDate = data.draw_date || data.date || null;
    const numbers = data.numbers || [];
    const jackpot = data.jackpot || null;
    return { game, drawDate, numbers, jackpot };
  } catch (e) {
    return null;
  }
}

function selfBase(req) {
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

async function cacheGet(req) {
  try {
    const r = await fetch(selfBase(req) + "/api/db", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "get", key: CACHE_KEY, shared: true }),
    });
    if (!r.ok) return null;
    const d = await r.json().catch(() => null);
    if (!d) return null;
    let v = d.value ?? d.result ?? d.data ?? null;
    if (typeof v === "string") {
      try { v = JSON.parse(v); } catch { return null; }
    }
    return v && Array.isArray(v.draws) ? v : null;
  } catch { return null; }
}

async function cacheSet(req, payload) {
  try {
    await fetch(selfBase(req) + "/api/db", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "set", key: CACHE_KEY, shared: true, value: JSON.stringify(payload) }),
    });
  } catch {}
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  const apiKey = process.env.LOTTERY_RESULTS_FEED_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "missing LOTTERY_RESULTS_FEED_KEY env var" });
    return;
  }
  // Optional force refresh flag in request body (same shape as magayo endpoint)
  let force = false;
  try {
    const body = typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    force = !!body.force;
  } catch {}

  // 1) Try cached data if not forced and fresh enough
  if (!force) {
    const cached = await cacheGet(req);
    if (
      cached &&
      cached.ts &&
      Date.now() - cached.ts < CACHE_MIN * 60 * 1000 &&
      cached.draws &&
      cached.draws.length
    ) {
      res.status(200).json({ ...cached, cached: true, ageMin: Math.round((Date.now() - cached.ts) / 60000) });
      return;
    }
  }

  // 2) Fetch fresh data from Lottery Results Feed
  const freshDraws = [];
  for (const game of GAMES) {
    const result = await fetchGame(apiKey, game);
    if (result) freshDraws.push(result);
  }

  const payload = { draws: freshDraws, source: "lottery-results-feed", ts: Date.now() };

  // Store in cache (best‑effort, no await needed for speed)
  if (freshDraws.length) cacheSet(req, payload);

  // If we got nothing, fall back to stale cache if any
  if (!freshDraws.length) {
    const stale = await cacheGet(req);
    if (stale && stale.draws && stale.draws.length) {
      res.status(200).json({ ...stale, cached: true, stale: true, ageMin: Math.round((Date.now() - stale.ts) / 60000) });
      return;
    }
  }

  res.status(200).json({ ...payload, cached: false });
};
