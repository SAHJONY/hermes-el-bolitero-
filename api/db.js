// POST /api/db — native shared datastore for the app (forum, accounts, payments,
// CRM). Backed by Upstash Redis REST when configured, so data is GLOBAL across
// all users/devices. Until a store is connected it reports {configured:false}
// and the client falls back to per-device localStorage (no breakage).
//
// Connect a free store in Vercel env (either name pair works):
//   KV_REST_API_URL + KV_REST_API_TOKEN        (Vercel KV / Upstash)
//   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
const { readBody } = require("../lib/notify");

function originAllowed(req) {
  const o = req.headers && (req.headers.origin || req.headers.Origin);
  if (!o) return true;
  let h; try { h = new URL(o).hostname; } catch { return false; }
  if (h === "localhost" || h === "127.0.0.1" || h.endsWith(".vercel.app")) return true;
  try { if (process.env.APP_URL && h === new URL(process.env.APP_URL).hostname) return true; } catch { /* ignore */ }
  return false;
}

async function redis(cmd) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const tok = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) return { configured: false };
  const r = await fetch(url.replace(/\/$/, ""), {
    method: "POST",
    headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const d = await r.json().catch(() => ({}));
  return { configured: true, ok: r.ok, result: d.result, error: d.error };
}

const ns = (k) => "hb:" + String(k || "");

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "method_not_allowed" }); return; }
  if (!originAllowed(req)) { res.status(403).json({ error: "forbidden_origin" }); return; }
  const b = readBody(req);
  const op = b.op;
  try {
    if (op === "get") {
      const r = await redis(["GET", ns(b.key)]);
      if (!r.configured) return res.status(200).json({ configured: false });
      return res.status(200).json({ configured: true, value: r.result ?? null });
    }
    if (op === "set") {
      const r = await redis(["SET", ns(b.key), String(b.value)]);
      if (!r.configured) return res.status(200).json({ configured: false });
      return res.status(200).json({ configured: true, ok: !r.error });
    }
    if (op === "del") {
      const r = await redis(["DEL", ns(b.key)]);
      if (!r.configured) return res.status(200).json({ configured: false });
      return res.status(200).json({ configured: true, ok: !r.error });
    }
    if (op === "list") {
      const r = await redis(["KEYS", ns(b.prefix || "") + "*"]);
      if (!r.configured) return res.status(200).json({ configured: false });
      return res.status(200).json({ configured: true, keys: (r.result || []).map(k => String(k).replace(/^hb:/, "")) });
    }
    res.status(400).json({ error: "bad_op" });
  } catch (e) {
    res.status(500).json({ error: "db_failed", detail: String((e && e.message) || e) });
  }
};
