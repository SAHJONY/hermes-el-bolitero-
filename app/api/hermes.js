module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  try {
    const body = req.body || {};
    const messages = body.messages || [];
    const system = body.system || "";
    const base = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";
    const model = process.env.NVIDIA_MODEL || "nvidia/llama-3.1-nemotron-70b-instruct";
    const r = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + process.env.NVIDIA_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model, max_tokens: 600, temperature: 0.6,
        messages: system ? [{ role: "system", content: system }].concat(messages) : messages
      })
    });
    const d = await r.json();
    const text = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || "";
    res.status(200).json({ content: [{ type: "text", text: text }] });
  } catch (e) {
    res.status(500).json({ error: "hermes_nim_failed" });
  }
};
