// POST /api/db — native shared datastore for the app (forum, accounts, payments,
// CRM, game economy). GLOBAL across all users/devices once a store is connected.
// Until then it reports {configured:false} and the client falls back to
// per-device localStorage (no breakage).
//
// Two backends, auto-detected (Supabase preferred, then Redis):
//   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY     (Supabase Postgres — needs a
//        table:  create table if not exists kv (k text primary key, v text);)
//   KV_REST_API_URL + KV_REST_API_TOKEN          (Vercel KV / Upstash Redis)
//   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
const { readBody } = require("../lib/notify");

function originAllowed(req) {
  const o = req.headers && (req.headers.origin || req.headers.Origin);
  if (!o) return true;
  let h; try { h = new URL(o).hostname; } catch { return false; }
  if (h === "localhost" || h === "127.0.0.1" || h.endsWith(".vercel.app")) return true;
  if (h === "hermeselbolitero.com" || h === "www.hermeselbolitero.com") return true; // custom domain
  try { if (process.env.APP_URL && h === new URL(process.env.APP_URL).hostname) return true; } catch { /* ignore */ }
  return false;
}

const ns = (k) => "hb:" + String(k || "");

// ---------- Supabase (PostgREST) backend ----------
function supaCfg() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}
async function supa(method, path, { body, prefer } = {}) {
  const c = supaCfg();
  const headers = { apikey: c.key, Authorization: "Bearer " + c.key, "Content-Type": "application/json" };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(c.url + "/rest/v1/" + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await r.json(); } catch { /* 204 no content */ }
  return { ok: r.ok, status: r.status, data, error: r.ok ? null : (data && (data.message || data.error) || ("http_" + r.status)) };
}
const eq = (k) => "k=eq." + encodeURIComponent(ns(k));

// ---------- Redis (Upstash / Vercel KV) backend ----------
function redisCfg() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const tok = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
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
  return { ok: r.ok, result: d.result, error: d.error };
}

function backend() {
  if (supaCfg()) return "supabase";
  if (redisCfg()) return "redis";
  return null;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "method_not_allowed" }); return; }
  if (!originAllowed(req)) { res.status(403).json({ error: "forbidden_origin" }); return; }
  const b = readBody(req);
  const op = b.op;
  const be = backend();
  if (!be) return res.status(200).json({ configured: false });

  try {
    if (op === "get") {
      if (be === "supabase") {
        const r = await supa("GET", "kv?select=v&" + eq(b.key));
        if (!r.ok) return res.status(200).json({ configured: true, value: null, error: r.error });
        const row = Array.isArray(r.data) && r.data[0];
        return res.status(200).json({ configured: true, value: row ? row.v : null });
      }
      const r = await redis(["GET", ns(b.key)]);
      return res.status(200).json({ configured: true, value: r.result ?? null });
    }

    if (op === "set") {
      if (be === "supabase") {
        const r = await supa("POST", "kv", { body: [{ k: ns(b.key), v: String(b.value) }], prefer: "resolution=merge-duplicates,return=minimal" });
        return res.status(200).json({ configured: true, ok: r.ok, error: r.error });
      }
      const r = await redis(["SET", ns(b.key), String(b.value)]);
      return res.status(200).json({ configured: true, ok: !r.error });
    }

    if (op === "del") {
      if (be === "supabase") {
        const r = await supa("DELETE", "kv?" + eq(b.key), { prefer: "return=minimal" });
        return res.status(200).json({ configured: true, ok: r.ok, error: r.error });
      }
      const r = await redis(["DEL", ns(b.key)]);
      return res.status(200).json({ configured: true, ok: !r.error });
    }

    if (op === "list") {
      if (be === "supabase") {
        const r = await supa("GET", "kv?select=k&k=like." + encodeURIComponent(ns(b.prefix || "")) + "*");
        if (!r.ok) return res.status(200).json({ configured: true, keys: [], error: r.error });
        return res.status(200).json({ configured: true, keys: (r.data || []).map(row => String(row.k).replace(/^hb:/, "")) });
      }
      const r = await redis(["KEYS", ns(b.prefix || "") + "*"]);
      return res.status(200).json({ configured: true, keys: (r.result || []).map(k => String(k).replace(/^hb:/, "")) });
    }

    if (op === "ping") {
      return res.status(200).json({ configured: true, backend: be });
    }

    res.status(400).json({ error: "bad_op" });
  } catch (e) {
    res.status(500).json({ error: "db_failed", detail: String((e && e.message) || e) });
  }
};
