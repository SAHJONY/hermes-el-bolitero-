module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  try {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) { res.status(500).json({ error: "no-anthropic-key" }); return; }
    const body = req.body || {};
    const prompt = body.prompt || "";
    const maxTokens = Math.min(body.maxTokens || 2200, 3000);
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }]
      })
    });
    const d = await r.json();
    if (d.error) { res.status(502).json({ error: "anthropic_error", detail: d.error.message || "" }); return; }
    const text = (d.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
    res.status(200).json({ text: text });
  } catch (e) {
    res.status(500).json({ error: "numeros_failed", detail: String(e) });
  }
};
