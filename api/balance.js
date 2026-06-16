// GET /api/balance — realtime app-wide VIRTUAL-COIN balance (entertainment).
// Aggregates every account's coin balance from the shared datastore. Returns
// {configured:false} until a store (Upstash/Vercel KV) is connected.
async function call(cmd) {
  // Strip any stray non-printable/whitespace/quote chars that sneak in via copy-paste
  // into the env value (spaces, newlines, zero-width chars, surrounding quotes).
  const clean = (v) => String(v || "").replace(/[^\x21-\x7E]/g, "").replace(/["']/g, "");
  const url = clean(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL);
  const tok = clean(process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN);
  if (!url || !tok) return { configured: false };
  const r = await fetch(url.replace(/\/$/, ""), {
    method: "POST",
    headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const d = await r.json().catch(() => ({}));
  return { configured: true, result: d.result };
}

module.exports = async (req, res) => {
  try {
    const keysRes = await call(["KEYS", "hb:bal:*"]);
    if (!keysRes.configured) {
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({ configured: false, accounts: 0, totalCoins: 0 });
      return;
    }
    const keys = keysRes.result || [];
    let total = 0;
    if (keys.length) {
      const vals = (await call(["MGET", ...keys])).result || [];
      for (const v of vals) { try { total += JSON.parse(v).bal || 0; } catch { /* skip */ } }
    }
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ configured: true, accounts: keys.length, totalCoins: total, ts: Date.now() });
  } catch (e) {
    res.status(500).json({ error: "balance_failed", detail: String((e && e.message) || e) });
  }
};
