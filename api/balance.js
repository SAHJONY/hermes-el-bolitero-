// GET /api/balance — app-wide VIRTUAL-COIN total for the admin display.
// Reads the shared datastore using the SAME backend detection as /api/db
// (Supabase preferred, then Upstash/Vercel KV). Always degrades gracefully:
// any failure returns {configured:false} instead of a 500, so the UI never breaks.

const cleanEnv = (v) => String(v || "").replace(/[^\x21-\x7E]/g, "").replace(/["']/g, "");
const ns = (k) => "hb:" + String(k || "");

function supaCfg() {
  const url = cleanEnv(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}
function redisCfg() {
  const url = cleanEnv(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL);
  const tok = cleanEnv(process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN);
  return url && tok ? { url: url.replace(/\/$/, ""), tok } : null;
}

async function redis(cmd) {
  const c = redisCfg();
  const r = await fetch(c.url, {
    method: "POST",
    headers: { Authorization: "Bearer " + c.tok, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const d = await r.json().catch(() => ({}));
  return d.result;
}
async function supaRows(pathQuery) {
  const c = supaCfg();
  const r = await fetch(c.url + "/rest/v1/" + pathQuery, { headers: { apikey: c.key, Authorization: "Bearer " + c.key } });
  return r.ok ? (await r.json().catch(() => [])) : [];
}

const sumBal = (arr) => { let t = 0; for (const v of (arr || [])) { try { t += JSON.parse(v).bal || 0; } catch { /* skip */ } } return t; };

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    // Wallets live under hb:wallet:* in the server-authoritative economy.
    if (supaCfg()) {
      const rows = await supaRows("kv?select=v&k=like." + encodeURIComponent(ns("wallet:")) + "*");
      const vals = (rows || []).map(r => r.v);
      return res.status(200).json({ configured: true, accounts: vals.length, totalCoins: sumBal(vals), ts: Date.now() });
    }
    if (redisCfg()) {
      const keys = (await redis(["KEYS", ns("wallet:") + "*"])) || [];
      const vals = keys.length ? ((await redis(["MGET", ...keys])) || []) : [];
      return res.status(200).json({ configured: true, accounts: keys.length, totalCoins: sumBal(vals), ts: Date.now() });
    }
    return res.status(200).json({ configured: false, accounts: 0, totalCoins: 0 });
  } catch (e) {
    // Never 500 — the balance widget is non-critical.
    return res.status(200).json({ configured: false, accounts: 0, totalCoins: 0, note: String((e && e.message) || e) });
  }
};
