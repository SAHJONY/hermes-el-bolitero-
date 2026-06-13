// GET /api/cron-reminder — recordatorio diario de los tiros del día.
// Lo dispara Vercel Cron (ver vercel.json). Publica en Telegram el horario de
// sorteos (datos reales del horario, NO números) e invita a la app. Vercel
// añade Authorization: Bearer CRON_SECRET cuando esa env var está configurada.
const { sendTelegram } = require("../lib/notify");
const { buildResults } = require("../lib/results");

// Latest REAL results to include in the broadcast (today only — real boards).
async function realResultsLine() {
  try {
    const { draws } = await buildResults();
    const real = draws.filter(d => d.source === "real");
    if (!real.length) return "";
    const latest = real.reduce((a, b) => (b.date > a ? b.date : a), "0000-00-00");
    const today = real.filter(d => d.date === latest);
    if (!today.length) return "";
    const byBoard = {};
    today.forEach(d => { (byBoard[d.board] = byBoard[d.board] || []).push(`${d.session}: <b>${d.pick3}</b>${d.pick4 ? " / " + d.pick4 : ""}`); });
    const names = { newyork: "New York 🗽" };
    const lines = Object.keys(byBoard).map(b => `${names[b] || b} — ${byBoard[b].join(" · ")}`);
    return `\n🏆 <b>Resultados reales (${latest})</b>\n${lines.join("\n")}\n`;
  } catch { return ""; }
}

const SESSIONS = [
  { name: "Mañana", time: "10:30" },
  { name: "Mediodía", time: "1:30 PM" },
  { name: "Tarde", time: "7:00 PM" },
  { name: "Noche", time: "9:48 PM" },
];
const BOARDS = "La Bolita 🔴 · Florida · Chicago · Georgia · New York";

function authorized(req) {
  const need = process.env.CRON_SECRET;
  if (!need) return true; // low-risk reminder; if no secret set, allow the cron
  const h = req.headers || {};
  const token = String(h.authorization || h.Authorization || "").replace(/^Bearer\s+/i, "").trim();
  // Vercel marks scheduled invocations with this header too.
  return token === need || !!h["x-vercel-cron"];
}

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") { res.status(405).json({ error: "method_not_allowed" }); return; }
  if (!authorized(req)) { res.status(401).json({ error: "unauthorized" }); return; }

  const app = process.env.APP_URL || "https://hermes-el-bolitero.vercel.app";
  const horario = SESSIONS.map(s => `• <b>${s.name}</b> — ${s.time}`).join("\n");
  const resultados = await realResultsLine();
  const texto =
    `🎱 <b>HERMES EL BOLITERO</b> · ¡Buenos días, familia!\n\n` +
    `Hoy hay tiros de: ${BOARDS}\n` +
    resultados +
    `\n🕒 <b>Horario de hoy</b>\n${horario}\n\n` +
    `Entra a la app para los resultados, estadísticas y la charada 👉 ${app}\n` +
    `<i>Solo información y entretenimiento. Cada tiro es azar independiente.</i>`;

  const r = await sendTelegram(texto);
  res.status(r.ok ? 200 : 502).json({ ...r, posted: r.ok, preview: texto });
};
