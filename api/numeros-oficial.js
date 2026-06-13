// /api/numeros-oficial — Resultados OFICIALES y verificables vía magayo Lottery Data API.
// Variable en Vercel: MAGAYO_API_KEY (tu clave de magayo.com/lottery-feeds/lottery-data-api)
// Devuelve el mismo formato que tu app espera: { draws:[{board,date,session,pick3,pick4}] }

const MAP = [
  // board "labolita": 4 tiros armados desde sorteos oficiales reales
  { board:"labolita", session:"Mañana",   p3:"us_tn_cash3_mor", p4:"us_tn_cash4_mor" }, // Tennessee morning
  { board:"labolita", session:"Mediodía", p3:"us_fl_cash3_mid", p4:"us_fl_play4_mid" }, // Florida midday
  { board:"labolita", session:"Tarde",    p3:"us_ga_cash3_eve", p4:"us_ga_cash4_eve" }, // Georgia evening
  { board:"labolita", session:"Noche",    p3:"us_fl_cash3_eve", p4:"us_fl_play4_eve" }, // Florida evening
  // Florida
  { board:"florida",  session:"Mediodía", p3:"us_fl_cash3_mid", p4:"us_fl_play4_mid" },
  { board:"florida",  session:"Noche",    p3:"us_fl_cash3_eve", p4:"us_fl_play4_eve" },
  // Chicago (Illinois)
  { board:"chicago",  session:"Mediodía", p3:"us_il_pick3_mid", p4:"us_il_pick4_mid" },
  { board:"chicago",  session:"Noche",    p3:"us_il_pick3_eve", p4:"us_il_pick4_eve" },
  // Georgia
  { board:"georgia",  session:"Mediodía", p3:"us_ga_cash3_mid", p4:"us_ga_cash4_mid" },
  { board:"georgia",  session:"Tarde",    p3:"us_ga_cash3_eve", p4:"us_ga_cash4_eve" },
  { board:"georgia",  session:"Noche",    p3:"us_ga_cash3_night", p4:"us_ga_cash4_night" },
  // New York
  { board:"newyork",  session:"Mediodía", p3:"us_ny_numbers_mid", p4:"us_ny_win4_mid" },
  { board:"newyork",  session:"Noche",    p3:"us_ny_numbers_eve", p4:"us_ny_win4_eve" },
];

async function fetchGame(key, game){
  try{
    const r = await fetch(`https://www.magayo.com/api/results.php?api_key=${key}&game=${game}`);
    const d = await r.json();
    if(d.error && d.error !== 0) return null;
    // results: top prize first, comma-separated. Pick3="123", Pick4="1234" (may include extra like Fireball)
    const first = String(d.results||"").split(",")[0].trim();
    return { draw: d.draw, value: first };
  }catch(e){ return null; }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const key = process.env.MAGAYO_API_KEY;
  if (!key) { res.status(500).json({ error: "no-magayo-key" }); return; }
  try {
    // de-duplicate the game codes we need, fetch each once
    const codes = new Set();
    MAP.forEach(m => { codes.add(m.p3); codes.add(m.p4); });
    const cache = {};
    await Promise.all([...codes].map(async g => { cache[g] = await fetchGame(key, g); }));

    const draws = [];
    for (const m of MAP) {
      const a = cache[m.p3], b = cache[m.p4];
      if (!a || !b || !a.value || !b.value) continue;
      draws.push({
        board: m.board,
        date: a.draw || b.draw,
        session: m.session,
        pick3: a.value.padStart(3,"0").slice(-3),
        pick4: b.value.padStart(4,"0").slice(-4),
      });
    }
    res.status(200).json({ draws, source: "magayo-official", ts: Date.now() });
  } catch (e) {
    res.status(500).json({ error: "numeros_oficial_failed", detail: String(e) });
  }
};
