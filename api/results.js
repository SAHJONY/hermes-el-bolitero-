// GET /api/results — real (NY) + fallback lottery draws for the live app.
// Shape matches what the frontend's fetchLiveDraws() expects.
const { buildResults } = require("../lib/results");

module.exports = async (req, res) => {
  try {
    const data = await buildResults();
    // Cache at the edge so we don't hammer the upstream open-data API.
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=900");
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: "results_failed", detail: String((e && e.message) || e) });
  }
};
