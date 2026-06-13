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

// Known-good NVIDIA NIM models to fall back to when the configured model name
// is not provisioned for the account (NVIDIA answers 404 in that case).
const NVIDIA_FALLBACK_MODELS = ["meta/llama-3.3-70b-instruct", "meta/llama-3.1-8b-instruct"];

async function callOpenAICompatible({ key, base, models, system, messages, maxTokens }) {
  const url = chatCompletionsUrl(base);
  // Try each candidate model; a 404 means "model not found", so move on to the
  // next candidate. Any other outcome (success or a real error) is returned.
  const list = (Array.isArray(models) ? models : [models]).filter(Boolean);
  let lastDetail = "no model candidates";
  for (const model of list) {
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0.6,
        messages: system ? [{ role: "system", content: system }].concat(messages) : messages,
      }),
    });
    const { data, raw } = await readUpstream(r);
    if (r.ok && data) {
      return { ok: true, payload: { content: [{ type: "text", text: data.choices?.[0]?.message?.content || "" }] } };
    }
    lastDetail = `${r.status} (${model}) ${data?.error?.message || raw.slice(0, 160) || r.statusText}`.trim();
    if (r.status !== 404) return { ok: false, detail: lastDetail };
    // 404 → model not available for this account/host; try the next candidate.
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

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed", detail: "POST only" });
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
