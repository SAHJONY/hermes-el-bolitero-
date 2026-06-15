// POST /api/notify-win — aviso multicanal a un miembro ganador.
// Body: { miembro: {nombre, tel, email, voz, mail, tg_chat_id}, ticket: {id, session, date}, resultado: string, monto?: string }
// Sin dinero: solo felicitación e información (monto = cantidad ganada, informativo). Cada tiro es azar independiente.
const { readBody, checkSecret, sendTelegram, sendEmail, placeCall } = require("../lib/notify");

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "method_not_allowed" }); return; }
  const auth = checkSecret(req);
  if (!auth.ok) { res.status(auth.code).json(auth.body); return; }

  const { miembro = {}, ticket = {}, resultado = "", monto = "" } = readBody(req);
  const premio = String(monto || "").trim();
  const lineaPremio = premio ? ` Ganaste ${premio}.` : "";
  const texto = `🎉👑 ¡FELICIDADES ${miembro.nombre || ""}! Tu número SALIÓ en HERMES EL BOLITERO: ` +
    `ticket ${ticket.id || "—"} · ${ticket.session || ""} ${ticket.date || ""} · ${resultado}.${lineaPremio} ` +
    `Si lo jugaste en la tienda autorizada de la lotería legal, ve a cobrar allá. Aquí celebramos contigo. 🎱`;

  const jobs = [];
  if (miembro.mail && miembro.email) {
    jobs.push(sendEmail({ to: miembro.email, subject: "🎉 ¡Tu número salió! · HERMES EL BOLITERO", html: `<p>${texto}</p>` }));
  }
  if (miembro.voz && miembro.tel) {
    jobs.push(placeCall({ phone: miembro.tel, task: `Felicita con alegría cubana y di exactamente: ${texto}. No hables de apuestas ni pagos.` }));
  }
  // Telegram: al chat del miembro si lo dio, o al canal oficial por defecto.
  jobs.push(sendTelegram(texto, miembro.tg_chat_id));

  const results = await Promise.all(jobs);
  const sent = results.filter(r => r.ok).map(r => r.channel);
  res.status(200).json({ ok: true, sent, results });
};
