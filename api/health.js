// GET /api/health — production readiness probe (NO secret values, only presence
// booleans + a LIVE datastore ping). Lets the owner confirm in one request that
// the app is wired to take real customers: shared DB connected, push keys set,
// broadcast secret set, AI brain configured, and which notify channels are live.
//
// Safe to expose: it never returns any key/token value — only whether each is
// present, plus whether the configured datastore actually answered a ping.
const cleanEnv = (v) => String(v || "").replace(/[^\x21-\x7E]/g, "").replace(/["']/g, "");
const has = (v) => !!cleanEnv(v);

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

// magayo real-results feed: presence of the key + how many boards are mapped in
// lib/magayo-codes.js (which boards CAN go live once the key works). New York is
// always real via its own free feed and is intentionally not counted here.
function magayoCfg() {
  let codes = {};
  try { codes = require("../lib/magayo-codes"); } catch { codes = {}; }
  const ids = Object.keys(codes);
  // Which mapped boards are actually polled (MAGAYO_BOARDS allowlist) — the rest
  // show DEMO and spend zero quota. Mirror the default in lib/results.js.
  const raw = cleanEnv(process.env.MAGAYO_BOARDS || "florida,georgia,chicago,pr")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const allowAll = raw.length === 1 && raw[0].toLowerCase() === "all";
  const active = allowAll ? ids : ids.filter((id) => raw.includes(id));
  return { key: cleanEnv(process.env.MAGAYO_API_KEY), boards: ids.length, activeBoards: active.length, active };
}

// Live magayo probe — ONLY runs on ?deep=1 because it spends one API call against
// the account quota. Distinguishes the three states the owner needs after
// reactivating the account: no key · key set but account suspended (error 300) ·
// key live (real draws flowing).
async function pingMagayo() {
  const { key } = magayoCfg();
  if (!key) return { live: false, detail: "no_key" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const url = "https://www.magayo.com/api/results.php?api_key=" + encodeURIComponent(key) + "&game=us_fl_cash3_mid";
    const r = await fetch(url, { headers: { Accept: "application/json" }, signal: ctrl.signal });
    const d = await r.json().catch(() => ({}));
    const code = (d && typeof d.error !== "undefined") ? Number(d.error) : -1;
    const live = code === 0 && !!d.results && d.results !== "-";
    const detail = code === 0 ? (live ? "ok" : "no_results_yet")
      : code === 300 ? "account_suspended"
      : code === -1 ? "bad_response" : ("error_" + code);
    return { live, detail };
  } catch (e) {
    return { live: false, detail: e && e.name === "AbortError" ? "timeout" : String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

// Live connectivity check against whichever datastore is configured. Short
// timeout so a hung backend can't stall the function. Returns true only if the
// store actually answered — that is the real "can persist shared state" signal.
async function pingStore() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    if (supaCfg()) {
      const c = supaCfg();
      const r = await fetch(c.url + "/rest/v1/kv?select=k&limit=1", {
        headers: { apikey: c.key, Authorization: "Bearer " + c.key },
        signal: ctrl.signal,
      });
      return { backend: "supabase", reachable: r.ok, detail: r.ok ? "ok" : ("http_" + r.status) };
    }
    if (redisCfg()) {
      const c = redisCfg();
      const r = await fetch(c.url, {
        method: "POST",
        headers: { Authorization: "Bearer " + c.tok, "Content-Type": "application/json" },
        body: JSON.stringify(["PING"]),
        signal: ctrl.signal,
      });
      const d = await r.json().catch(() => ({}));
      const ok = r.ok && (d.result === "PONG" || d.result === "pong" || !!d.result);
      return { backend: "redis", reachable: ok, detail: ok ? "ok" : (d.error || ("http_" + r.status)) };
    }
    return { backend: null, reachable: false, detail: "no_datastore_configured" };
  } catch (e) {
    const be = supaCfg() ? "supabase" : redisCfg() ? "redis" : null;
    return { backend: be, reachable: false, detail: e && e.name === "AbortError" ? "timeout" : String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") { res.status(405).json({ error: "GET only" }); return; }

  const db = await pingStore();

  // ?deep=1 spends one magayo API call to confirm the feed is actually live.
  const deep = /[?&]deep=1(\b|&|$)/.test(req.url || "") || !!(req.query && req.query.deep);
  const mag = magayoCfg();
  const magProbe = deep ? await pingMagayo() : null;
  // Quota usage this month — a plain datastore read (no API call), so it's safe
  // to include on every request. Lets the owner see how much of the plan is left.
  let magBudget = null;
  try { magBudget = await require("../lib/results").magayoBudget(); } catch { magBudget = null; }

  // Core = the systems a real customer launch depends on.
  const checks = {
    database: { configured: !!db.backend, reachable: db.reachable, backend: db.backend, detail: db.detail },
    push: { vapidPublic: has(process.env.VAPID_PUBLIC_KEY), vapidPrivate: has(process.env.VAPID_PRIVATE_KEY) },
    broadcastSecret: has(process.env.RESULTS_API_SECRET),
    ai: {
      engine: has(process.env.ENGINE_API_KEY),
      nvidia: has(process.env.NVIDIA_API_KEY),
      anthropic: has(process.env.ANTHROPIC_API_KEY),
    },
    notify: {
      email: has(process.env.MAIL_API_KEY) || has(process.env.SMTP_HOST),
      telegram: has(process.env.TELEGRAM_BOT_TOKEN) && has(process.env.TELEGRAM_CHAT_ID),
      voice: has(process.env.VOICE_API_KEY),
    },
    appUrl: has(process.env.APP_URL),
    // Real official result feeds. New York is always live (free keyless feed).
    // magayo unlocks ~50 more boards once MAGAYO_API_KEY belongs to an ACTIVE
    // account; without it those boards show clearly-labeled "DEMO · referencia".
    resultsFeed: {
      newyork: true,
      magayo: Object.assign(
        { configured: !!mag.key, mappedBoards: mag.boards, activeBoards: mag.activeBoards, polling: mag.active },
        magBudget ? { quota: magBudget } : {},
        magProbe ? { live: magProbe.live, detail: magProbe.detail } : { hint: "add ?deep=1 to live-probe the magayo account" },
      ),
    },
  };

  // "Can take real customers" = shared DB actually reachable + push fully wired
  // + broadcast secured + at least one AI provider configured.
  const aiOk = checks.ai.engine || checks.ai.nvidia || checks.ai.anthropic;
  const pushOk = checks.push.vapidPublic && checks.push.vapidPrivate;
  const ready = checks.database.reachable && pushOk && checks.broadcastSecret && aiOk;

  const blockers = [];
  if (!checks.database.reachable) blockers.push("shared datastore not reachable (wallet/economy/push fall back to per-device localStorage)");
  if (!pushOk) blockers.push("VAPID push keys missing (notifications disabled)");
  if (!checks.broadcastSecret) blockers.push("RESULTS_API_SECRET missing (result broadcast unprotected/disabled)");
  if (!aiOk) blockers.push("no AI provider key (Hermes chat disabled)");

  res.status(ready ? 200 : 503).json({ service: "hermes-el-bolitero", ready, blockers, checks, ts: Date.now() });
};
