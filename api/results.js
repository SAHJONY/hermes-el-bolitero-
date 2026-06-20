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
    // Vercel attaches `Authorization: Bearer <CRON_SECRET>` to scheduled calls.
    const secret = cleanEnv(process.env.CRON_SECRET) || cleanEnv(process.env.RESULTS_API_SECRET);
    const auth = String(req.headers.authorization || "");
    const isCron = !!secret && auth === "Bearer " + secret;

    const data = await buildResults({ fullSweep: isCron });

    // A cron run is a write-path refresh — don't let it be served from cache, and
    // don't pollute the edge cache with it.
    if (isCron) res.setHeader("Cache-Control", "no-store");
    else res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=900");

    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: "results_failed", detail: String((e && e.message) || e) });
  }
};
