// POST /api/broadcast — ONE endpoint for all result broadcasts (consolidated to
// stay under the Hobby plan's 12-function limit). Channel chosen by ?ch=…
//
//   ?ch=call      → voice call (Bland.ai)
//        result mode (owner/server, secret):     { phone, resumen }
//        welcome mode (client, origin-locked):    { tipo:"welcome", phone, nombre? }
//   ?ch=email     → email (Resend), secret:       { to, asunto, html }
//   ?ch=telegram  → Telegram, secret:             { texto, chat_id? }
const { readBody, checkSecret, placeCall, sendEmail, sendTelegram } = require("../lib/notify");

function originAllowed(req) {
  const o = req.headers && (req.headers.origin || req.headers.Origin);
  if (!o) return true;
  let h; try { h = new URL(o).hostname; } catch { return false; }
  if (h === "localhost" || h === "127.0.0.1") return true;
  if (h.endsWith(".vercel.app")) return true;
  if (h === "hermeselbolitero.com" || h === "www.hermeselbolitero.com") return true;
  try { if (process.env.APP_URL && h === new URL(process.env.APP_URL).hostname) return true; } catch { /* ignore */ }
  return false;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "method_not_allowed" }); return; }
  const ch = (req.query && req.query.ch) || "";
  const b = readBody(req);

  // ───────────── Voice call ─────────────
  if (ch === "call") {
    // Welcome mode: client-facing, origin-locked, no secret.
    if (b.tipo === "welcome") {
      if (!originAllowed(req)) { res.status(403).json({ error: "forbidden_origin" }); return; }
      const phone = String(b.phone || "").trim();
      if (!/^\+\d{8,15}$/.test(phone)) { res.status(400).json({ error: "invalid_phone" }); return; }
      const nombre = String(b.nombre || "").trim().slice(0, 60);
      const saludo = nombre ? `a ${nombre}` : "al cliente";
      const task =
        `Eres Hermes, de HERMES EL BOLITERO, con voz cálida y sabor cubano. ` +
        `Da la bienvenida ${saludo} a la plataforma en una llamada corta y alegre. ` +
        `Explícale que, a partir de ahora, cuando sus números salgan en el sorteo y gane, ` +
        `Hermes lo llamará personalmente para felicitarlo y decirle exactamente cuánto ganó. ` +
        `Cuéntale que también puede ver los resultados oficiales en vivo en la app. ` +
        `No hables de apuestas, no prometas ganancias y recuerda que cada tiro es azar. ` +
        `Despídete con cariño. Máximo 30 segundos.`;
      const r = await placeCall({ phone, task });
      res.status(r.ok ? 200 : (r.detail === "voice_not_configured" ? 503 : 502)).json(r);
      return;
    }
    // Result/prize mode: owner/server, secret-gated.
    const auth = checkSecret(req);
    if (!auth.ok) { res.status(auth.code).json(auth.body); return; }
    const { phone, resumen } = b;
    if (!phone || !resumen) { res.status(400).json({ error: "missing_phone_or_resumen" }); return; }
    const task = `Saluda en español cubano, cálido y breve. Di exactamente este resultado de la bolita y despídete: ${resumen}. No des consejos de apuestas ni prometas ganancias.`;
    const r = await placeCall({ phone, task });
    res.status(r.ok ? 200 : (r.detail === "voice_not_configured" ? 503 : 502)).json(r);
    return;
  }

  // ───────────── Email ─────────────
  if (ch === "email") {
    const auth = checkSecret(req);
    if (!auth.ok) { res.status(auth.code).json(auth.body); return; }
    const { to, asunto, html } = b;
    if (!to || !html) { res.status(400).json({ error: "missing_to_or_html" }); return; }
    const r = await sendEmail({ to, subject: asunto || "HERMES EL BOLITERO", html });
    res.status(r.ok ? 200 : (r.detail === "email_not_configured" ? 503 : 502)).json(r);
    return;
  }

  // ───────────── Telegram ─────────────
  if (ch === "telegram") {
    const auth = checkSecret(req);
    if (!auth.ok) { res.status(auth.code).json(auth.body); return; }
    const { texto, chat_id } = b;
    if (!texto) { res.status(400).json({ error: "missing_texto" }); return; }
    const r = await sendTelegram(texto, chat_id);
    res.status(r.ok ? 200 : 502).json(r);
    return;
  }

  res.status(400).json({ error: "unknown_channel", hint: "use ?ch=call|email|telegram" });
};
