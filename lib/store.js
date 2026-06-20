// Minimal shared key/value accessor (Redis / Upstash / Vercel KV, or Supabase),
// used by the results layer to cache upstream lottery feeds and rate-limit our
// own outbound API calls. Read-light, write-light, and ALWAYS fail-soft: every
// method swallows errors and returns null/false so a flaky store can never break
// results. (api/db.js owns the full economy store; this is a tiny isolated twin
// so the results lib stays decoupled from the request handler — no circular import.)
const cleanEnv = (v) => String(v || "").replace(/[^\x21-\x7E]/g, "").replace(/["']/g, "");
const ns = (k) => "hb:" + String(k || ""); // same namespace as api/db.js (distinct keys)

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
function backend() { return supaCfg() ? "supabase" : redisCfg() ? "redis" : null; }

async function get(key) {
  try {
    if (supaCfg()) {
      const c = supaCfg();
      const r = await fetch(c.url + "/rest/v1/kv?select=v&k=eq." + encodeURIComponent(ns(key)), {
        headers: { apikey: c.key, Authorization: "Bearer " + c.key },
      });
      const d = await r.json().catch(() => null);
      return Array.isArray(d) && d[0] ? d[0].v : null;
    }
    if (redisCfg()) {
      const c = redisCfg();
      const r = await fetch(c.url, {
        method: "POST",
        headers: { Authorization: "Bearer " + c.tok, "Content-Type": "application/json" },
        body: JSON.stringify(["GET", ns(key)]),
      });
      const d = await r.json().catch(() => ({}));
      return d.result ?? null;
    }
  } catch { /* fail-soft */ }
  return null;
}

async function set(key, val) {
  try {
    if (supaCfg()) {
      const c = supaCfg();
      const r = await fetch(c.url + "/rest/v1/kv", {
        method: "POST",
        headers: { apikey: c.key, Authorization: "Bearer " + c.key, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ k: ns(key), v: String(val) }]),
      });
      return r.ok;
    }
    if (redisCfg()) {
      const c = redisCfg();
      const r = await fetch(c.url, {
        method: "POST",
        headers: { Authorization: "Bearer " + c.tok, "Content-Type": "application/json" },
        body: JSON.stringify(["SET", ns(key), String(val)]),
      });
      const d = await r.json().catch(() => ({}));
      return !d.error;
    }
  } catch { /* fail-soft */ }
  return false;
}

// Atomic-ish increment, returning the new integer value (or null fail-soft).
// Redis INCR is genuinely atomic — used to count magayo API calls against the
// monthly quota so concurrent requests can't blow past the budget cap.
async function incr(key) {
  try {
    if (redisCfg()) {
      const c = redisCfg();
      const r = await fetch(c.url, {
        method: "POST",
        headers: { Authorization: "Bearer " + c.tok, "Content-Type": "application/json" },
        body: JSON.stringify(["INCR", ns(key)]),
      });
      const d = await r.json().catch(() => ({}));
      const n = Number(d.result);
      return Number.isFinite(n) ? n : null;
    }
    if (supaCfg()) {
      // No atomic primitive over REST — read-modify-write (good enough; the cap
      // carries a safety buffer below the real quota to absorb any race).
      const next = (Number(await get(key)) || 0) + 1;
      await set(key, String(next));
      return next;
    }
  } catch { /* fail-soft */ }
  return null;
}

module.exports = { get, set, incr, configured: () => !!backend() };
