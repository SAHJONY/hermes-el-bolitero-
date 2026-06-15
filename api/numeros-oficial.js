// /api/numeros-oficial — Resultados OFICIALES y verificables.
// Combina DOS fuentes oficiales y las normaliza al formato bolitero
// { draws:[{board,date,session,pick3,pick4,quiniela?}], realBoards, source }:
//
//   1) New York  → GRATIS, sin clave (data.ny.gov: Daily Numbers + Win 4).
//   2) magayo    → requiere MAGAYO_API_KEY (cubre FL, GA, IL, TX, NY, PR, RD…).
//
// Importante: ya NO falla con 500 cuando falta la clave de magayo — devuelve al
// menos los números reales y gratis de New York, y el resto cae a demo/IA en el
// cliente. Pon MAGAYO_API_KEY en Vercel para activar todos los demás tableros.

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
  // New York (también lo cubre el feed gratis; magayo queda como respaldo)
  { board:"newyork",  session:"Mediodía", p3:"us_ny_numbers_mid", p4:"us_ny_win4_mid" },
  { board:"newyork",  session:"Noche",    p3:"us_ny_numbers_eve", p4:"us_ny_win4_eve" },
  // Puerto Rico (Lotería Electrónica) — Pega 3 + Pega 4, mediodía y noche
  { board:"pr", session:"Mediodía", p3:"pr_pega3_day",   p4:"pr_pega4_day" },
  { board:"pr", session:"Noche",    p3:"pr_pega3_night", p4:"pr_pega4_night" },
  // República Dominicana — Pega 3 Más (oficial 3 dígitos), sesión de Noche.
  { board:"rd", session:"Noche",    p3:"do_pega3", p4:"do_pega3" },
];

const dkey = (d) => `${d.board}|${d.date}|${d.session}`;

// 1) New York Daily Numbers + Win 4 — datos oficiales abiertos, GRATIS, sin clave.
async function fetchNewYorkFree() {
  try {
    const url = "https://data.ny.gov/resource/hsys-3def.json?$limit=6&$order=draw_date%20DESC";
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) return [];
    const rows = await r.json();
    const p3 = (v) => String(v).padStart(3, "0").slice(-3);
    const p4 = (v) => String(v).padStart(4, "0").slice(-4);
    const out = [];
    for (const row of rows || []) {
      const date = String(row.draw_date || "").slice(0, 10);
      if (!date) continue;
      if (row.midday_daily) out.push({ board:"newyork", date, session:"Mediodía", pick3:p3(row.midday_daily), pick4:p4(row.midday_win_4||""), quiniela:[p3(row.midday_daily).slice(-2)] });
      if (row.evening_daily) out.push({ board:"newyork", date, session:"Noche", pick3:p3(row.evening_daily), pick4:p4(row.evening_win_4||""), quiniela:[p3(row.evening_daily).slice(-2)] });
    }
    return out;
  } catch { return []; }
}

// 2) magayo — un juego a la vez. results: premios separados por coma (1ro,2do,3ro).
async function fetchGame(key, game){
  try{
    const r = await fetch(`https://www.magayo.com/api/results.php?api_key=${encodeURIComponent(key)}&game=${encodeURIComponent(game)}`);
    const d = await r.json();
    if(d.error && d.error !== 0) return null;
    const parts = String(d.results||"").split(",").map(x=>x.trim()).filter(Boolean);
    return { draw: d.draw, value: parts[0]||"", positions: parts };
  }catch(e){ return null; }
}

async function fetchMagayo(key){
  const codes = new Set();
  MAP.forEach(m => { codes.add(m.p3); codes.add(m.p4); });
  const cache = {};
  await Promise.all([...codes].map(async g => { cache[g] = await fetchGame(key, g); }));
  const draws = [];
  for (const m of MAP) {
    const a = cache[m.p3], b = cache[m.p4];
    if (!a || !b || !a.value || !b.value) continue;
    const quiniela = (a.positions && a.positions.length>=1)
      ? a.positions.slice(0,3).map(p=>String(p).padStart(2,"0").slice(-2))
      : [a.value.padStart(3,"0").slice(-2)];
    draws.push({
      board: m.board,
      date: a.draw || b.draw,
      session: m.session,
      pick3: a.value.padStart(3,"0").slice(-3),
      pick4: b.value.padStart(4,"0").slice(-4),
      quiniela,
    });
  }
  return draws;
}

module.exports = async (req, res) => {
  if (req.method !== "POST" && req.method !== "GET") { res.status(405).json({ error: "POST or GET only" }); return; }
  try {
    const key = process.env.MAGAYO_API_KEY;

    // Diagnóstico para VERIFICAR/limpiar los códigos de magayo sin exponer la
    // clave: GET /api/numeros-oficial → lista cada código y si trae datos.
    // (La app usa POST para los números; GET es solo diagnóstico.)
    if (req.method === "GET") {
      const ny0 = await fetchNewYorkFree();
      const codes = [...new Set(MAP.flatMap(m => [m.p3, m.p4]))];
      const magayoCodes = key
        ? await Promise.all(codes.map(async c => {
            const g = await fetchGame(key, c);
            return { code: c, ok: !!(g && g.value), value: g ? g.value : null, draw: g ? g.draw : null };
          }))
        : [];
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({
        magayoConfigured: !!key,
        ny: { ok: ny0.length > 0, draws: ny0.length },
        okCount: magayoCodes.filter(c => c.ok).length,
        failCount: magayoCodes.filter(c => !c.ok).length,
        badCodes: magayoCodes.filter(c => !c.ok).map(c => c.code),
        magayoCodes,
        ts: Date.now(),
      });
      return;
    }

    // New York es gratis y siempre se intenta; magayo solo si hay clave.
    const [ny, magayo] = await Promise.all([
      fetchNewYorkFree(),
      key ? fetchMagayo(key).catch(() => []) : Promise.resolve([]),
    ]);

    // Merge: NY (gratis, autoritativo para newyork) tiene prioridad; magayo
    // rellena el resto. Dedupe por board|date|session.
    const byKey = new Map();
    for (const d of magayo) byKey.set(dkey(d), d);
    for (const d of ny) byKey.set(dkey(d), d); // NY pisa a magayo en newyork
    const draws = [...byKey.values()];

    const realBoards = Array.from(new Set(draws.map(d => d.board)));
    const sources = [ny.length && "ny-open-data", magayo.length && "magayo"].filter(Boolean);
    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=600");
    res.status(200).json({
      draws,
      realBoards,
      source: sources.join("+") || "none",
      magayoConfigured: !!key,
      ts: Date.now(),
    });
  } catch (e) {
    res.status(500).json({ error: "numeros_oficial_failed", detail: String((e && e.message) || e) });
  }
};
