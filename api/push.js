// /api/push — Web Push: subscribe, unsubscribe, and broadcast in ONE function
// (consolidated to stay under the Hobby plan's 12-function limit).
//
//   POST   /api/push                 → save a PushSubscription          (body: {subscription})
//   DELETE /api/push                 → remove a subscription            (body: {endpoint})
//   POST   /api/push?action=send     → broadcast to all subscribers     (header x-results-secret)
//
// VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY + RESULTS_API_SECRET live in Vercel env.

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

const subId = (endpoint) => crypto.createHash("sha256").update(endpoint).digest("hex").slice(0, 24);
const subKey = (endpoint) => ns("push:sub:" + subId(endpoint));

async function saveSub(sub) {
  const val = JSON.stringify(sub);
  if (supaCfg()) await supaUpsert(subKey(sub.endpoint), val);
  else if (redisCfg()) await redisCmd(["SET", subKey(sub.endpoint), val]);
  else return false;
  return true;
}
async function removeSub(endpoint) {
  if (supaCfg()) await supaDel(subKey(endpoint));
  else if (redisCfg()) await redisCmd(["DEL", subKey(endpoint)]);
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

const ALLOWED = ["https://www.hermeselbolitero.com", "https://hermeselbolitero.com", "https://hermes-el-bolitero.vercel.app"];

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const action = (req.query && req.query.action) || "";

  // ── Broadcast ── secured by RESULTS_API_SECRET (no origin restriction so the
  // owner can also fire it from the result pipeline / a cron).
  if (action === "send") {
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
    if (!subs.length) return res.status(200).json({ ok: true, sent: 0, total: 0, note: "No push subscribers yet" });

    let sent = 0, failed = 0; const gone = [];
    await Promise.allSettled(subs.map(async (sub) => {
      try { await webPush.sendNotification(sub, payload, { TTL: 3600 }); sent++; }
      catch (e) { if (e.statusCode === 410 || e.statusCode === 404) gone.push(sub.endpoint); failed++; }
    }));
    await Promise.allSettled(gone.map(removeSub));
    return res.status(200).json({ ok: true, total: subs.length, sent, failed, removed: gone.length });
  }

  // ── Subscribe / Unsubscribe ── origin-locked.
  const origin = req.headers.origin || req.headers.referer || "";
  if (process.env.NODE_ENV !== "development" && !ALLOWED.some(a => origin.startsWith(a))) {
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }

  try {
    const body = req.body || {};
    if (req.method === "POST") {
      const sub = body.subscription || body;
      if (!sub || !sub.endpoint) return res.status(400).json({ ok: false, error: "Missing subscription" });
      const ok = await saveSub(sub);
      return res.status(200).json({ ok, configured: ok, id: subId(sub.endpoint) });
    }
    if (req.method === "DELETE") {
      if (!body.endpoint) return res.status(400).json({ ok: false, error: "Missing endpoint" });
      await removeSub(body.endpoint);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
};
