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
// Game ops (server-authoritative, anti-cheat economy): wallet.top (ranking by
//   real capital), ticket.create + ticket.settle (see lib/payouts.js).
const { readBody } = require("../lib/notify");
const { buildResults } = require("../lib/results");
const { settleAll, PAYOUT_DEFAULTS, num } = require("../lib/payouts");

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

// Strip stray non-printable/whitespace/quote chars that sneak into env values via
// copy-paste (spaces, newlines, zero-width chars, surrounding quotes) — they break
// fetch() with "Failed to parse URL".
const cleanEnv = (v) => String(v || "").replace(/[^\x21-\x7E]/g, "").replace(/["']/g, "");

// ---------- Supabase (PostgREST) backend ----------
function supaCfg() {
  const url = cleanEnv(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);
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

    // ----- App-wide virtual-coin total (folded in from /api/balance) -----
    // Sums wallet:* balances for the admin economy dashboard. Never throws.
    if (op === "balance") {
      const keys = await store.list("wallet:");
      let total = 0;
      for (const k of keys) {
        const raw = await store.get(k);
        if (!raw) continue;
        try { total += JSON.parse(raw).bal || 0; } catch { /* skip */ }
      }
      return res.status(200).json({ configured: true, accounts: keys.length, totalCoins: Math.round(total), ts: Date.now() });
    }

    // Ranking ANTI-TRAMPA: derivado de los saldos reales del servidor (wallet:<alias>).
    if (op === "wallet.top") {
      const keys = await store.list("wallet:");
      const players = [];
      for (const k of keys) {
        const raw = await store.get(k);
        if (!raw) continue;
        try { const w = JSON.parse(raw); players.push({ alias: k.replace(/^wallet:/, ""), bal: Math.round(w.bal || 0), xp: Math.round(w.xp || 0) }); } catch { /* skip */ }
      }
      players.sort((a, b2) => b2.bal - a.bal);
      return res.status(200).json({ configured: true, top: players.slice(0, Math.min(50, Number(b.limit) || 10)) });
    }

    // ----- Ticket economy (server-authoritative: stake + payout anti-cheat) -----
    if (op === "ticket.create" || op === "ticket.settle") {
      const pid = String(b.pid || "").slice(0, 80);
      if (!pid) return res.status(400).json({ error: "missing_pid" });
      const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
      const cfg = parse(await store.get("coins:config")) || {};
      const start = Number.isFinite(cfg.start) ? cfg.start : 1000;
      const P = {
        fijo: cfg.payFijo ?? PAYOUT_DEFAULTS.fijo, corrido: cfg.payCorrido ?? PAYOUT_DEFAULTS.corrido,
        parle: cfg.payParle ?? PAYOUT_DEFAULTS.parle, candado: cfg.payCandado ?? PAYOUT_DEFAULTS.candado,
        play4: cfg.payPlay4 ?? PAYOUT_DEFAULTS.play4, cash3: cfg.payCash3 ?? PAYOUT_DEFAULTS.cash3,
        box3: cfg.payBox3 ?? PAYOUT_DEFAULTS.box3, box4: cfg.payBox4 ?? PAYOUT_DEFAULTS.box4,
        pair: cfg.payPair ?? PAYOUT_DEFAULTS.pair, centena: cfg.payCentena ?? PAYOUT_DEFAULTS.centena,
        q1: cfg.payQ1 ?? PAYOUT_DEFAULTS.q1, q2: cfg.payQ2 ?? PAYOUT_DEFAULTS.q2, q3: cfg.payQ3 ?? PAYOUT_DEFAULTS.q3,
      };
      const wkey = "wallet:" + pid, tkey = "tickets:" + pid;
      const getWallet = async () => parse(await store.get(wkey)) || { bal: start, streak: 0, bestStreak: 0, xp: 0 };
      const saveWallet = async (w) => { await store.set(wkey, JSON.stringify(w)); await store.set("bal:" + pid, JSON.stringify({ bal: w.bal, ts: Date.now() })); };

      if (op === "ticket.create") {
        const ticket = b.ticket || {};
        const stake = num(ticket.monto);
        const w = await getWallet();
        if (stake > 0 && w.bal < stake) return res.status(200).json({ configured: true, ok: false, error: "insufficient_coins", wallet: w });
        if (stake > 0) w.bal -= stake;
        const t = { ...ticket, status: "pendiente", premio: null, ganancia: 0, coinPaid: false, ts: Date.now() };
        const list = parse(await store.get(tkey)) || [];
        const next = [t, ...list].slice(0, 30);
        await store.set(tkey, JSON.stringify(next));
        await saveWallet(w);
        return res.status(200).json({ configured: true, ok: true, ticket: t, wallet: w, tickets: next });
      }
      // ticket.settle
      const list = parse(await store.get(tkey)) || [];
      const draws = await getDraws();
      const r = settleAll(list, draws, P);
      await store.set(tkey, JSON.stringify(r.tickets));
      const w = await getWallet();
      if (r.credited > 0) { w.bal += r.credited; w.xp = (w.xp || 0) + r.credited; await saveWallet(w); }
      return res.status(200).json({ configured: true, ok: true, tickets: r.tickets, credited: r.credited, wins: r.wins, wallet: w });
    }

    res.status(400).json({ error: "bad_op" });
  } catch (e) {
    res.status(500).json({ error: "db_failed", detail: String((e && e.message) || e) });
  }
};
