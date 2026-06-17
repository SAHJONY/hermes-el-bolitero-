// POST /api/push-subscribe — save a Web Push subscription
// DELETE /api/push-subscribe — remove subscription by endpoint

const crypto = require("crypto");
const cleanEnv = (v) => String(v || "").replace(/[^\x21-\x7E]/g, "").replace(/["']/g, "");
const ns = (k) => "hb:" + String(k || "");

function redisCfg() {
  const url = cleanEnv(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL);
  const tok = cleanEnv(process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN);
  return url && tok ? { url: url.replace(/\/$/, ""), tok } : null;
}
function supaCfg() {
  const url = cleanEnv(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}

async function redisCmd(cmd) {
  const c = redisCfg();
  const r = await fetch(c.url, {
    method: "POST",
    headers: { Authorization: "Bearer " + c.tok, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  return (await r.json().catch(() => ({}))).result;
}

async function supaUpsert(k, v) {
  const c = supaCfg();
  await fetch(`${c.url}/rest/v1/kv`, {
    method: "POST",
    headers: { apikey: c.key, Authorization: "Bearer " + c.key, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ k, v }),
  });
}
async function supaDel(k) {
  const c = supaCfg();
  await fetch(`${c.url}/rest/v1/kv?k=eq.${encodeURIComponent(k)}`, {
    method: "DELETE",
    headers: { apikey: c.key, Authorization: "Bearer " + c.key },
  });
}

function subId(endpoint) {
  return crypto.createHash("sha256").update(endpoint).digest("hex").slice(0, 24);
}

const ALLOWED = ["https://www.hermeselbolitero.com", "https://hermeselbolitero.com", "https://hermes-el-bolitero.vercel.app"];

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const origin = req.headers.origin || req.headers.referer || "";
  if (process.env.NODE_ENV !== "development" && !ALLOWED.some(a => origin.startsWith(a))) {
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }

  try {
    const body = req.body || {};

    if (req.method === "POST") {
      const sub = body.subscription || body;
      if (!sub || !sub.endpoint) return res.status(400).json({ ok: false, error: "Missing subscription" });
      const id = subId(sub.endpoint);
      const key = ns("push:sub:" + id);
      const val = JSON.stringify(sub);
      if (supaCfg()) await supaUpsert(key, val);
      else if (redisCfg()) await redisCmd(["SET", key, val]);
      else return res.status(200).json({ ok: false, configured: false });
      return res.status(200).json({ ok: true, id });
    }

    if (req.method === "DELETE") {
      const { endpoint } = body;
      if (!endpoint) return res.status(400).json({ ok: false, error: "Missing endpoint" });
      const id = subId(endpoint);
      const key = ns("push:sub:" + id);
      if (supaCfg()) await supaDel(key);
      else if (redisCfg()) await redisCmd(["DEL", key]);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
};
