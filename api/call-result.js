// POST /api/call-result — llamada de voz de Hermes (Bland.ai).
// Dos modos en un solo endpoint (límite de funciones del plan):
//  • Resultado/premio (uso del dueño/servidor) — gated por RESULTS_API_SECRET.
//      Body: { phone, resumen }
//  • Bienvenida (la dispara el navegador al unirse un cliente) — sin secret,
//      pero origin-locked y solo llama al número que el cliente acaba de poner.
//      Body: { tipo:"welcome", phone, nombre? }
const { readBody, checkSecret, placeCall } = require("../lib/notify");

function originAllowed(req) {
  const o = req.headers && (req.headers.origin || req.headers.Origin);
  if (!o) return true;
  let h; try { h = new URL(o).hostname; } catch { return false; }
  if (h === "localhost" || h === "127.0.0.1") return true;
  if (h.endsWith(".vercel.app")) return true;
  try { if (process.env.APP_URL && h === new URL(process.env.APP_URL).hostname) return true; } catch { /* ignore */ }
  return false;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "method_not_allowed" }); return; }

  const b = readBody(req);

  // --- Modo bienvenida: cliente-facing, origin-locked, sin secret ---
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
    const code = r.ok ? 200 : (r.detail === "voice_not_configured" ? 503 : 502);
    res.status(code).json(r);
    return;
  }

  // --- Modo resultado/premio: uso del dueño/servidor, gated por secret ---
  const auth = checkSecret(req);
  if (!auth.ok) { res.status(auth.code).json(auth.body); return; }

  const { phone, resumen } = b;
  if (!phone || !resumen) { res.status(400).json({ error: "missing_phone_or_resumen" }); return; }

  const task = `Saluda en español cubano, cálido y breve. Di exactamente este resultado de la bolita y despídete: ${resumen}. No des consejos de apuestas ni prometas ganancias.`;
  const r = await placeCall({ phone, task });
  const code = r.ok ? 200 : (r.detail === "voice_not_configured" ? 503 : 502);
  res.status(code).json(r);
};
