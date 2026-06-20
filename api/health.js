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
