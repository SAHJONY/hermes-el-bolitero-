// POST /api/email-result — alerta de resultados por correo (Resend).
// Body: { to: string|string[], asunto: string, html: string }
const { readBody, checkSecret, sendEmail } = require("../lib/notify");

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "method_not_allowed" }); return; }
  const auth = checkSecret(req);
  if (!auth.ok) { res.status(auth.code).json(auth.body); return; }

  const { to, asunto, html } = readBody(req);
  if (!to || !html) { res.status(400).json({ error: "missing_to_or_html" }); return; }

  const r = await sendEmail({ to, subject: asunto || "HERMES EL BOLITERO", html });
  const code = r.ok ? 200 : (r.detail === "email_not_configured" ? 503 : 502);
  res.status(code).json(r);
};
