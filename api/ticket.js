// POST /api/ticket — a customer submits a ticket/receipt for confirmation.
// Posts it to the business inbox (owner's Telegram) and returns a confirmation
// ref. Customer-facing: no shared secret (the browser can't hold one), but it
// is origin-locked and only ever posts to the owner's fixed chat.
// Body: { tipo:"recibo"|"ticket", alias?, contacto?, texto, ref? }
const { readBody, sendTelegram } = require("../lib/notify");

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
  if (!originAllowed(req)) { res.status(403).json({ error: "forbidden_origin" }); return; }

  const b = readBody(req);
  const texto = String(b.texto || "").trim().slice(0, 1500);
  if (!texto) { res.status(400).json({ error: "missing_texto" }); return; }

  const alias = String(b.alias || "Cliente").slice(0, 60);
  const contacto = String(b.contacto || "").slice(0, 80);
  const ref = (String(b.ref || "").slice(0, 40)) || ("HB-" + Date.now().toString(36).toUpperCase());
  const tipo = b.tipo === "ticket" ? "Ticket" : "Comprobante";

  const msg =
    `🎟️ <b>${tipo} para confirmar</b>\n` +
    `Ref: <code>${ref}</code>\n` +
    `Cliente: <b>${alias}</b>${contacto ? ` · ${contacto}` : ""}\n` +
    `—\n${texto}`;

  let delivered = false;
  try { const r = await sendTelegram(msg); delivered = !!r.ok; } catch { /* still return the ref */ }

  res.status(200).json({ ok: true, ref, delivered });
};
