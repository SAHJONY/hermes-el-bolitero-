// GET /api/cron-results — canta los RESULTADOS OFICIALES del día en Telegram.
// Lo dispara Vercel Cron (ver vercel.json). Publica SOLO números reales
// (New York gratis + magayo si hay MAGAYO_API_KEY); si no hay reales, no
// inventa nada. Vercel añade Authorization: Bearer CRON_SECRET si está puesto.
const { sendTelegram } = require("../lib/notify");
const { buildResults } = require("../lib/results");

const NAMES = {
  labolita: "La Bolita 🔴", newyork: "New York 🗽", florida: "Florida 🌴",
  georgia: "Georgia 🍑", chicago: "Illinois 🌆", pr: "Puerto Rico 🇵🇷", rd: "Rep. Dominicana 🇩🇴",
};

function authorized(req) {
  const need = process.env.CRON_SECRET;
  if (!need) return true; // sin secreto, permitimos el cron (bajo riesgo: solo lee y publica)
  const h = req.headers || {};
  const token = String(h.authorization || h.Authorization || "").replace(/^Bearer\s+/i, "").trim();
  return token === need || !!h["x-vercel-cron"];
}

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") { res.status(405).json({ error: "method_not_allowed" }); return; }
  if (!authorized(req)) { res.status(401).json({ error: "unauthorized" }); return; }
  try {
    const { draws } = await buildResults();
    const real = (draws || []).filter(d => d.source === "real");
    if (!real.length) { res.status(200).json({ posted: false, reason: "no_real_results" }); return; }

    // Solo los del día más reciente con datos reales.
    const latest = real.reduce((a, b) => (b.date > a ? b.date : a), "0000-00-00");
    const today = real.filter(d => d.date === latest);
    const byBoard = {};
    today.forEach(d => {
      (byBoard[d.board] = byBoard[d.board] || []).push(`${d.session}: <b>${d.pick3}</b>${d.pick4 ? " / " + d.pick4 : ""}`);
    });
    const lines = Object.keys(byBoard).map(b => `${NAMES[b] || b} — ${byBoard[b].join(" · ")}`);
    const app = process.env.APP_URL || "https://hermes-el-bolitero.vercel.app";
    const texto =
      `🎱 <b>HERMES EL BOLITERO</b> · Resultados oficiales (${latest})\n\n` +
      lines.join("\n") + `\n\n` +
      `Más resultados, estadísticas y la charada 👉 ${app}\n` +
      `<i>Solo información y entretenimiento. Cada tiro es azar independiente.</i>`;

    const r = await sendTelegram(texto);
    res.status(r.ok ? 200 : 502).json({ ...r, posted: r.ok, date: latest, boards: Object.keys(byBoard), preview: texto });
  } catch (e) {
    res.status(500).json({ error: "cron_results_failed", detail: String((e && e.message) || e) });
  }
};
