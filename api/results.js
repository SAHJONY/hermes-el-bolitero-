// GET /api/results — real (NY + magayo) + demo lottery draws for the live app.
// Shape matches what the frontend's fetchLiveDraws() expects.
//
// Polling magayo is quota-metered, so it is DECOUPLED from visitor traffic:
//   • Normal requests run at most a small, throttled "sweep" (lib/results.js).
//   • The daily Vercel cron (vercel.json) calls this with the CRON_SECRET bearer,
//     which unlocks a FULL sweep (still bounded by the monthly budget guard).
const { buildResults } = require("../lib/results");

const cleanEnv = (v) => String(v || "").replace(/[^\x21-\x7E]/g, "").replace(/["']/g, "");

module.exports = async (req, res) => {
  try {
    // Vercel marks scheduled calls with an `x-vercel-cron` header (and, when
    // CRON_SECRET is set, an `Authorization: Bearer <CRON_SECRET>`). Either one
    // unlocks the full sweep so it works whether or not CRON_SECRET is configured.
    const secret = cleanEnv(process.env.CRON_SECRET) || cleanEnv(process.env.RESULTS_API_SECRET);
    const auth = String(req.headers.authorization || "");
    const isCron = !!req.headers["x-vercel-cron"] || (!!secret && auth === "Bearer " + secret);

    const data = await buildResults({ fullSweep: isCron });

    // Same-morning payouts: right after the full sweep publishes fresh draws,
    // settle every wallet and notify winners. Best-effort and time-boxed so it
    // never makes the results cron time out — the noon reminder cron is the
    // reliable backstop, and settle.all is idempotent (no double-credit).
    if (isCron) {
      try {
        const app = (cleanEnv(process.env.APP_URL) || "https://hermeselbolitero.com").replace(/\/+$/, "");
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 12000);
        await fetch(app + "/api/db", {
          method: "POST", signal: ctrl.signal,
          headers: { "Content-Type": "application/json", ...(secret ? { Authorization: "Bearer " + secret } : {}) },
          body: JSON.stringify({ op: "settle.all" }),
        }).finally(() => clearTimeout(timer));
      } catch { /* best-effort; the 12:00 reminder cron settles again */ }
    }

    // A cron run is a write-path refresh — don't let it be served from cache, and
    // don't pollute the edge cache with it.
    if (isCron) res.setHeader("Cache-Control", "no-store");
    else res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=900");

    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: "results_failed", detail: String((e && e.message) || e) });
  }
};
