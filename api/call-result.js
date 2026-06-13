// POST /api/call-result — llamada de voz con el resultado (Bland.ai).
// Body: { phone: string, resumen: string }
const { readBody, checkSecret, placeCall } = require("../lib/notify");

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "method_not_allowed" }); return; }
  const auth = checkSecret(req);
  if (!auth.ok) { res.status(auth.code).json(auth.body); return; }

  const { phone, resumen } = readBody(req);
  if (!phone || !resumen) { res.status(400).json({ error: "missing_phone_or_resumen" }); return; }

  const task = `Saluda en español cubano, cálido y breve. Di exactamente este resultado de la bolita y despídete: ${resumen}. No des consejos de apuestas ni prometas ganancias.`;
  const r = await placeCall({ phone, task });
  const code = r.ok ? 200 : (r.detail === "voice_not_configured" ? 503 : 502);
  res.status(code).json(r);
};
