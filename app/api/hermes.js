export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const { messages = [], system = "" } = req.body || {};
    const base = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";
    const model = process.env.NVIDIA_MODEL || "nvidia/llama-3.1-nemotron-70b-instruct";
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model, max_tokens: 600, temperature: 0.6,
        messages: system ? [{ role: "system", content: system }, ...messages] : messages,
      }),
    });
    const d = await r.json();
    const text = d.choices?.[0]?.message?.content ?? "";
    res.status(r.status).json({ content: [{ type: "text", text }], engine: "nvidia" });
  } catch (e) {
    res.status(500).json({ error: "hermes_nim_failed" });
  }
}

