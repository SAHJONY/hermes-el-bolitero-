// POST /api/db — native shared datastore + GAME ENGINE for the app (forum,
// accounts, payments, CRM, and the virtual-economy game). GLOBAL across all
// users/devices once a store is connected. Until then reports {configured:false}
// and the client falls back to per-device localStorage (no breakage).
//
// Two backends, auto-detected (Supabase preferred, then Redis):
//   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY     (Supabase Postgres — needs a
//        table:  create table if not exists kv (k text primary key, v text);)
//   KV_REST_API_URL + KV_REST_API_TOKEN          (Vercel KV / Upstash Redis)
//   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
//
// Generic ops: get/set/del/list/ping.
// Game ops (server-authoritative economy, see lib/game.js): game.state,
//   game.play, game.top.
const { readBody } = require("../lib/notify");
const game = require("../lib/game");
const { buildResults } = require("../lib/results");

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
  const r = await fetch(c.url + "/rest/v1/" + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch { /* 204 */ }
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

// Plain-value KV adapter (namespaced) shared by public ops and the game engine.
function makeStore(be) {
  return {
    async get(key) {
      if (be === "supabase") {
        const r = await supa("GET", "kv?select=v&" + eq(key));
        const row = Array.isArray(r.data) && r.data[0];
        return row ? row.v : null;
      }
      const r = await redis(["GET", ns(key)]);
      return r.result ?? null;
    },
    async set(key, val) {
      if (be === "supabase") {
        const r = await supa("POST", "kv", { body: [{ k: ns(key), v: String(val) }], prefer: "resolution=merge-duplicates,return=minimal" });
        return r.ok;
      }
      const r = await redis(["SET", ns(key), String(val)]);
      return !r.error;
    },
    async del(key) {
      if (be === "supabase") { const r = await supa("DELETE", "kv?" + eq(key), { prefer: "return=minimal" }); return r.ok; }
      const r = await redis(["DEL", ns(key)]);
      return !r.error;
    },
    async list(prefix) {
      if (be === "supabase") {
        const r = await supa("GET", "kv?select=k&k=like." + encodeURIComponent(ns(prefix || "")) + "*");
        return (r.ok && r.data ? r.data : []).map(row => String(row.k).replace(/^hb:/, ""));
      }
      const r = await redis(["KEYS", ns(prefix || "") + "*"]);
      return (r.result || []).map(k => String(k).replace(/^hb:/, ""));
    },
  };
}

// Official draws for game settlement (best-effort; empty on failure → plays stay pending).
async function getDraws() {
  try { const r = await buildResults(); return (r && r.draws) || []; } catch { return []; }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "method_not_allowed" }); return; }
  if (!originAllowed(req)) { res.status(403).json({ error: "forbidden_origin" }); return; }
  const b = readBody(req);
  const op = b.op;
  const be = backend();
  if (!be) return res.status(200).json({ configured: false });
  const store = makeStore(be);

  try {
    // ----- Generic KV ops -----
    if (op === "get")  return res.status(200).json({ configured: true, value: await store.get(b.key) });
    if (op === "set")  return res.status(200).json({ configured: true, ok: await store.set(b.key, String(b.value)) });
    if (op === "del")  return res.status(200).json({ configured: true, ok: await store.del(b.key) });
    if (op === "list") return res.status(200).json({ configured: true, keys: await store.list(b.prefix || "") });
    if (op === "ping") return res.status(200).json({ configured: true, backend: be });

    // ----- Game engine ops (server-authoritative virtual economy) -----
    if (op === "game.state") {
      const pid = String(b.pid || "").slice(0, 80);
      if (!pid) return res.status(400).json({ error: "missing_pid" });
      const player = await game.state(store, { pid, alias: b.alias }, await getDraws());
      return res.status(200).json({ configured: true, rules: game.RULES, player });
    }
    if (op === "game.play") {
      const pid = String(b.pid || "").slice(0, 80);
      if (!pid) return res.status(400).json({ error: "missing_pid" });
      const r = await game.play(store, { pid, alias: b.alias, board: b.board, session: b.session, number: b.number, stake: b.stake });
      return res.status(r.ok ? 200 : 400).json({ configured: true, ...r });
    }
    if (op === "game.top") {
      const top = await game.leaderboard(store, Math.min(50, Number(b.limit) || 20));
      return res.status(200).json({ configured: true, top });
    }

    res.status(400).json({ error: "bad_op" });
  } catch (e) {
    res.status(500).json({ error: "db_failed", detail: String((e && e.message) || e) });
  }
};
