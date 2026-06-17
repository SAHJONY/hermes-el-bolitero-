// POST /api/push-send — broadcast Web Push to all subscribers
// Requires: X-Results-Secret header matching RESULTS_API_SECRET env var
// Body: { title, body, url, tag, secret }   (secret is fallback if header missing)

const webPush = require("web-push");
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

async function getAllSubs() {
  const prefix = ns("push:sub:");
  if (supaCfg()) {
    const c = supaCfg();
    const r = await fetch(`${c.url}/rest/v1/kv?k=like.${encodeURIComponent(prefix + "%")}&select=v`, {
      headers: { apikey: c.key, Authorization: "Bearer " + c.key },
    });
    const rows = r.ok ? await r.json().catch(() => []) : [];
    return rows.map(row => { try { return JSON.parse(row.v); } catch { return null; } }).filter(Boolean);
  }
  if (redisCfg()) {
    const keys = (await redisCmd(["KEYS", prefix + "*"])) || [];
    if (!keys.length) return [];
    const vals = (await redisCmd(["MGET", ...keys])) || [];
    return vals.map(v => { try { return JSON.parse(v); } catch { return null; } }).filter(Boolean);
  }
  return [];
}

async function cleanupSub(endpoint) {
  try {
    const id = crypto.createHash("sha256").update(endpoint).digest("hex").slice(0, 24);
    const key = ns("push:sub:" + id);
    if (supaCfg()) {
      const c = supaCfg();
      await fetch(`${c.url}/rest/v1/kv?k=eq.${encodeURIComponent(key)}`, {
        method: "DELETE", headers: { apikey: c.key, Authorization: "Bearer " + c.key },
      });
    } else if (redisCfg()) {
      await redisCmd(["DEL", key]);
    }
  } catch { /* ignore cleanup errors */ }
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false });

  const secret = cleanEnv(process.env.RESULTS_API_SECRET);
  const incoming = cleanEnv(req.headers["x-results-secret"] || (req.body && req.body.secret) || "");
  if (!secret || incoming !== secret) return res.status(401).json({ ok: false, error: "Unauthorized" });

  const vapidPublic = cleanEnv(process.env.VAPID_PUBLIC_KEY);
  const vapidPrivate = cleanEnv(process.env.VAPID_PRIVATE_KEY);
  if (!vapidPublic || !vapidPrivate) {
    return res.status(200).json({ ok: false, error: "VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not configured in Vercel env" });
  }

  webPush.setVapidDetails("mailto:hermeselbolitero@outlook.com", vapidPublic, vapidPrivate);

  const {
    title = "HERMES EL BOLITERO",
    body: msgBody = "¡Nuevo resultado disponible!",
    url = "https://www.hermeselbolitero.com",
    tag = "hb-result",
  } = req.body || {};

  const payload = JSON.stringify({ title, body: msgBody, url, tag, icon: "/icon-192.png" });
  const subs = await getAllSubs().catch(() => []);

  if (!subs.length) return res.status(200).json({ ok: true, sent: 0, note: "No push subscribers yet" });

  let sent = 0, failed = 0;
  const gone = [];

  await Promise.allSettled(subs.map(async (sub) => {
    try {
      await webPush.sendNotification(sub, payload, { TTL: 3600 });
      sent++;
    } catch (e) {
      if (e.statusCode === 410 || e.statusCode === 404) gone.push(sub.endpoint);
      failed++;
    }
  }));

  // Clean up devices that have unsubscribed (410 Gone)
  await Promise.allSettled(gone.map(cleanupSub));

  return res.status(200).json({ ok: true, total: subs.length, sent, failed, removed: gone.length });
};
