// POST /api/telegram-result — canta el número en Telegram.
// Body: { texto: string, chat_id?: string|number }
const { readBody, checkSecret, sendTelegram } = require("../lib/notify");

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "method_not_allowed" }); return; }
  const auth = checkSecret(req);
  if (!auth.ok) { res.status(auth.code).json(auth.body); return; }

  const { texto, chat_id } = readBody(req);
  if (!texto) { res.status(400).json({ error: "missing_texto" }); return; }

  const r = await sendTelegram(texto, chat_id);
  res.status(r.ok ? 200 : 502).json(r);
};
