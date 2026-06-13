// HERMES EL BOLITERO — backend brain proxy (Vercel serverless function).
// Keeps the model API key server-side so it is never exposed in the browser.
//
// Configure ONE provider via Vercel env vars (Project → Settings → Environment):
//   NVIDIA_API_KEY        (default provider — NVIDIA NIM, OpenAI-compatible)
//   NVIDIA_MODEL          (default: nvidia/llama-3.1-nemotron-70b-instruct)
//   NVIDIA_BASE_URL       (default: https://integrate.api.nvidia.com/v1)
//   — or, for an OpenRouter / OpenAI-compatible engine —
//   ENGINE_API_KEY, ENGINE_MODEL, ENGINE_BASE_URL
//   — or, for Anthropic —
//   ANTHROPIC_API_KEY, ANTHROPIC_MODEL (default: claude-sonnet-4-6)

const HERMES_SYSTEM = `Eres "Hermes", el agente-cerebro de HERMES EL BOLITERO, app cubana
informativa de resultados de la bolita y charada. Tono cubano cálido y breve.
Reglas: nunca aceptas ni gestionas apuestas, nunca prometes ganancias,
y recuerdas que cada tiro es azar independiente.`;

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

  // Read an upstream response as text first, then parse — providers sometimes
  // return streamed/event bodies or HTML error pages that break res.json().
  const readUpstream = async (r) => {
    const raw = await r.text();
    let data = null;
    try { data = JSON.parse(raw); } catch { /* leave null; expose snippet below */ }
    return { data, raw };
  };

  try {
    const antKey = process.env.ANTHROPIC_API_KEY;
    const engineKey = process.env.ENGINE_API_KEY;
    const nvidiaKey = process.env.NVIDIA_API_KEY;

    // --- OpenAI-compatible engine first (NVIDIA NIM / OpenRouter / OpenAI) ---
    // This is the intended default "Hermes" brain. Anthropic is used only as a
    // fallback when no OpenAI-compatible engine key is configured.
    const key = engineKey || nvidiaKey;
    if (key) {
      const base = engineKey
        ? (process.env.ENGINE_BASE_URL || "https://openrouter.ai/api/v1")
        : (process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1");
      const model = engineKey
        ? (process.env.ENGINE_MODEL || "nousresearch/hermes-4-70b")
        : (process.env.NVIDIA_MODEL || "nvidia/llama-3.1-nemotron-70b-instruct");

      const r = await fetch(base.replace(/\/$/, "") + "/chat/completions", {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          temperature: 0.6,
          messages: system ? [{ role: "system", content: system }].concat(messages) : messages,
        }),
      });
      const { data: d, raw } = await readUpstream(r);
      if (!r.ok || !d) {
        res.status(502).json({
          error: "engine_failed",
          status: r.status,
          detail: d?.error?.message || raw.slice(0, 300) || r.statusText,
        });
        return;
      }
      const text = d.choices?.[0]?.message?.content || "";
      res.status(200).json({ content: [{ type: "text", text }] });
      return;
    }

    // --- Anthropic (Claude) fallback ---
    if (antKey) {
      const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": antKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
      });
      const { data: d, raw } = await readUpstream(r);
      if (!r.ok || !d) {
        res.status(502).json({
          error: "anthropic_failed",
          status: r.status,
          detail: d?.error?.message || raw.slice(0, 300) || r.statusText,
        });
        return;
      }
      res.status(200).json({ content: d.content || [] });
      return;
    }

    res.status(503).json({
      error: "no_engine_configured",
      detail: "Set NVIDIA_API_KEY (or ENGINE_API_KEY / ANTHROPIC_API_KEY) in the Vercel project env vars.",
    });
  } catch (e) {
    res.status(500).json({ error: "hermes_proxy_failed", detail: String((e && e.message) || e) });
  }
};
