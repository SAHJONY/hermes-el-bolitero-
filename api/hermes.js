// HERMES EL BOLITERO — backend brain proxy (Vercel serverless function).
// Keeps the model API key server-side so it is never exposed in the browser.
//
// Configure a provider via Vercel env vars (Project → Settings → Environment):
//   NVIDIA_API_KEY        (NVIDIA NIM, OpenAI-compatible)
//   NVIDIA_MODEL          (default: nvidia/llama-3.1-nemotron-70b-instruct)
//   NVIDIA_BASE_URL       (default: https://integrate.api.nvidia.com/v1)
//   — or, for an OpenRouter / OpenAI-compatible engine —
//   ENGINE_API_KEY, ENGINE_MODEL, ENGINE_BASE_URL
//   — or, for Anthropic —
//   ANTHROPIC_API_KEY, ANTHROPIC_MODEL (default: claude-sonnet-4-6)
//
// If more than one provider is configured, they are tried in order
// (engine → nvidia → anthropic) and the first healthy one answers.

const HERMES_SYSTEM = `Eres "Hermes", el agente-cerebro de HERMES EL BOLITERO, app cubana
informativa de resultados de la bolita y charada. Tono cubano cálido y breve.
Reglas: nunca aceptas ni gestionas apuestas, nunca prometes ganancias,
y recuerdas que cada tiro es azar independiente.`;

// Normalize an OpenAI-compatible base URL into a full /chat/completions endpoint,
// tolerating common misconfigurations (trailing slash, an already-appended path,
// or a missing /v1 segment on known hosts).
function chatCompletionsUrl(base) {
  let u = String(base || "").trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/.test(u)) return u;            // already full endpoint
  if (/(api\.openai\.com|api\.nvidia\.com|openrouter\.ai\/api)$/.test(u)) u += "/v1";
  return u + "/chat/completions";
}

async function readUpstream(r) {
  const raw = await r.text();
  let data = null;
  try { data = JSON.parse(raw); } catch { /* non-JSON; expose snippet */ }
  return { data, raw };
}

// NVIDIA NIM free models, ordered best→fastest. All verified callable on the
// project's NVIDIA account (2026-06-13). The proxy rotates through them so that
// if any model is unprovisioned, rate-limited, erroring, or slow, the next one
// answers — no env change or redeploy needed.
const NVIDIA_FALLBACK_MODELS = [
  "meta/llama-3.3-70b-instruct",
  "nvidia/llama-3.3-nemotron-super-49b-v1.5",
  "qwen/qwen3-next-80b-a3b-instruct",
  "meta/llama-4-maverick-17b-128e-instruct",
  "openai/gpt-oss-120b",
  "nvidia/nemotron-3-super-120b-a12b",
  "z-ai/glm-5.1",
  "meta/llama-3.1-70b-instruct",
  "mistralai/mixtral-8x7b-instruct-v0.1",
  "openai/gpt-oss-20b",
  "nvidia/nvidia-nemotron-nano-9b-v2",
  "meta/llama-3.1-8b-instruct",
  "meta/llama-3.2-3b-instruct",
];

const ATTEMPT_TIMEOUT_MS = 12000; // abort a single model attempt after this
const ROTATE_DEADLINE_MS = 24000; // stop starting NEW attempts after this (fn cap ~30s)

async function callOpenAICompatible({ key, base, models, system, messages, maxTokens }) {
  const url = chatCompletionsUrl(base);
  // Try each candidate model in order. Rotate to the next on ANY failure
  // (404 unprovisioned, 429 rate limit, 5xx, timeout, network error). Stop only
  // on auth/permission errors (401/403) — switching models can't fix a bad key.
  const list = (Array.isArray(models) ? models : [models]).filter(Boolean);
  const startedAt = Date.now();
  let lastDetail = "no model candidates";
  for (const model of list) {
    if (Date.now() - startedAt > ROTATE_DEADLINE_MS) {
      lastDetail = `deadline reached; last error → ${lastDetail}`;
      break;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ATTEMPT_TIMEOUT_MS);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          temperature: 0.6,
          messages: system ? [{ role: "system", content: system }].concat(messages) : messages,
        }),
        signal: ctrl.signal,
      });
      const { data, raw } = await readUpstream(r);
      if (r.ok && data) {
        return { ok: true, payload: { content: [{ type: "text", text: data.choices?.[0]?.message?.content || "" }] }, model };
      }
      lastDetail = `${r.status} (${model}) ${data?.error?.message || raw.slice(0, 160) || r.statusText}`.trim();
      if (r.status === 401 || r.status === 403) return { ok: false, detail: lastDetail };
      // otherwise rotate to the next candidate model
    } catch (e) {
      lastDetail = `error (${model}) ${e && e.name === "AbortError" ? "timeout" : String((e && e.message) || e)}`;
      // rotate to the next candidate model
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, detail: lastDetail };
}

async function callAnthropic({ key, model, system, messages, maxTokens }) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
  });
  const { data, raw } = await readUpstream(r);
  if (!r.ok || !data) {
    return { ok: false, detail: `${r.status} ${data?.error?.message || raw.slice(0, 200) || r.statusText}`.trim() };
  }
  return { ok: true, payload: { content: data.content || [] } };
}

// Allow a request only if it carries no Origin (server-to-server / curl, which
// an Origin check can't police anyway) or an Origin we trust. This blocks other
// websites from driving visitors' browsers to spend our model quota.
function originAllowed(req) {
  const origin = req.headers && (req.headers.origin || req.headers.Origin);
  if (!origin) return true;
  let host;
  try { host = new URL(origin).hostname; } catch { return false; }
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (host.endsWith(".vercel.app")) return true;          // prod + preview deploys
  try {
    if (process.env.APP_URL && host === new URL(process.env.APP_URL).hostname) return true;
  } catch { /* ignore malformed APP_URL */ }
  return false;
}

module.exports = async (req, res) => {
  // Health/status (no secrets) — handy for debugging the deployment.
  if (req.method === "GET") {
    const e = process.env;
    res.status(200).json({
      ok: true,
      service: "hermes",
      providers: [
        e.ENGINE_API_KEY && "engine",
        e.NVIDIA_API_KEY && "nvidia",
        e.ANTHROPIC_API_KEY && "anthropic",
      ].filter(Boolean),
      nvidiaModelRotation: NVIDIA_FALLBACK_MODELS,
    });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed", detail: "POST or GET only" });
    return;
  }

  if (!originAllowed(req)) {
    res.status(403).json({ error: "forbidden_origin" });
    return;
  }

  let body = req.body || {};
  if (typeof body === "string") {
    try { body = JSON.parse(body || "{}"); } catch { body = {}; }
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const system = body.system || HERMES_SYSTEM;
  const maxTokens = Math.min(Number(body.max_tokens) || 600, 1024);

  // Build the provider chain from whatever is configured, in priority order.
  // For NVIDIA-hosted endpoints, append known-good fallback models so a stale
  // or unprovisioned model name (which NVIDIA answers with 404) self-heals.
  const env = process.env;
  const isNvidiaHost = (u) => /api\.nvidia\.com/.test(String(u || ""));
  const withNvidiaFallbacks = (base, configured) => {
    const list = [configured];
    if (isNvidiaHost(base)) list.push(...NVIDIA_FALLBACK_MODELS);
    return [...new Set(list.filter(Boolean))];
  };
  const providers = [];
  if (env.ENGINE_API_KEY) {
    const base = env.ENGINE_BASE_URL || "https://openrouter.ai/api/v1";
    providers.push({
      name: "engine",
      run: () => callOpenAICompatible({
        key: env.ENGINE_API_KEY,
        base,
        models: withNvidiaFallbacks(base, env.ENGINE_MODEL || "nousresearch/hermes-4-70b"),
        system, messages, maxTokens,
      }),
    });
  }
  if (env.NVIDIA_API_KEY) {
    const base = env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";
    providers.push({
      name: "nvidia",
      run: () => callOpenAICompatible({
        key: env.NVIDIA_API_KEY,
        base,
        models: withNvidiaFallbacks(base, env.NVIDIA_MODEL || "nvidia/llama-3.1-nemotron-70b-instruct"),
        system, messages, maxTokens,
      }),
    });
  }
  if (env.ANTHROPIC_API_KEY) {
    providers.push({
      name: "anthropic",
      run: () => callAnthropic({
        key: env.ANTHROPIC_API_KEY,
        model: env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
        system, messages, maxTokens,
      }),
    });
  }

  if (providers.length === 0) {
    res.status(503).json({
      error: "no_engine_configured",
      detail: "Set NVIDIA_API_KEY (or ENGINE_API_KEY / ANTHROPIC_API_KEY) in the Vercel project env vars.",
    });
    return;
  }

  const failures = [];
  for (const p of providers) {
    try {
      const out = await p.run();
      if (out.ok) {
        res.status(200).json(out.payload);
        return;
      }
      failures.push(`${p.name}: ${out.detail}`);
    } catch (e) {
      failures.push(`${p.name}: ${String((e && e.message) || e)}`);
    }
  }

  // Every configured provider failed — surface each one's reason.
  res.status(502).json({ error: "all_providers_failed", detail: failures.join(" | ") });
};
