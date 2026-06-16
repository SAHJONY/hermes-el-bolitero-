// /api/numeros-oficial — Resultados OFICIALES y verificables vía magayo Lottery Data API.
// Variable en Vercel: MAGAYO_API_KEY (tu clave de magayo.com/lottery-feeds/lottery-data-api)
// Devuelve: { draws:[{board,date,session,pick3,pick4,quiniela}], realBoards, source, ts, cached }
//
// CACHÉ DE 30 MINUTOS: para no agotar tu plan de magayo. Los resultados se guardan en
// tu mismo almacén (/api/db). Si llega otra visita dentro de 30 min, se sirve lo guardado
// SIN llamar a magayo. Así magayo se consulta máximo ~48 veces al día, no por cada usuario.

const CACHE_KEY = "cache:numeros-oficial";
const CACHE_MIN = 30; // minutos de frescura

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
  // Puerto Rico (Lotería Electrónica) — Pega 3 + Pega 4, mediodía y noche
  { board:"pr", session:"Mediodía", p3:"pr_pega3_day",   p4:"pr_pega4_day" },
  { board:"pr", session:"Noche",    p3:"pr_pega3_night", p4:"pr_pega4_night" },
  // República Dominicana — Pega 3 Más (oficial 3 dígitos), sesión de Noche.
  { board:"rd", session:"Noche",    p3:"do_pega3", p4:"do_pega3" },
];

async function fetchGame(key, game){
  try{
    const r = await fetch(`https://www.magayo.com/api/results.php?api_key=${key}&game=${game}`);
    const d = await r.json();
    if(d.error && d.error !== 0) return null;
    // results: top prize first, comma-separated. Pick3="123", Pick4="1234".
    // Para quinielas con varios premios vienen "p1,p2,p3" (1ro,2do,3ro).
    const parts = String(d.results||"").split(",").map(x=>x.trim()).filter(Boolean);
    return { draw: d.draw, value: parts[0]||"", positions: parts };
  }catch(e){ return null; }
}

// ---- Caché vía tu propio /api/db (mismo almacén que ya usas) ----
function selfBase(req){
  const proto = (req.headers["x-forwarded-proto"]||"https").split(",")[0];
  const host  = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}
async function cacheGet(req){
  try{
    const r = await fetch(selfBase(req)+"/api/db",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({op:"get",key:CACHE_KEY,shared:true})});
    const d = await r.json().catch(()=>({}));
    const v = d && (d.value!==undefined ? d.value : d.result);
    if(!v) return null;
    return typeof v === "string" ? JSON.parse(v) : v;
  }catch(e){ return null; }
}
async function cacheSet(req,payload){
  try{
    await fetch(selfBase(req)+"/api/db",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({op:"set",key:CACHE_KEY,shared:true,value:JSON.stringify(payload)})});
  }catch(e){}
}

async function buildFresh(key){
  // de-duplicate the game codes we need, fetch each once
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
      quiniela, // [1ro,2do,3ro] de 2 cifras cuando el feed los entrega
    });
  }
  const realBoards = Array.from(new Set(draws.map(d => d.board)));
  return { draws, realBoards, source: "magayo-official", ts: Date.now() };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const key = process.env.MAGAYO_API_KEY;
  if (!key) { res.status(500).json({ error: "no-magayo-key" }); return; }

  // Permite forzar refresco desde el panel del dueño: { force:true }
  let force = false;
  try{ force = !!(req.body && (typeof req.body==="object"? req.body.force : JSON.parse(req.body||"{}").force)); }catch(e){}

  try {
    // 1) Intentar servir desde caché si está fresco (< 30 min) y no se forzó refresco
    if(!force){
      const cached = await cacheGet(req);
      if(cached && cached.ts && (Date.now()-cached.ts) < CACHE_MIN*60*1000 && Array.isArray(cached.draws) && cached.draws.length){
        res.status(200).json({ ...cached, cached:true, ageMin: Math.round((Date.now()-cached.ts)/60000) });
        return;
      }
    }
    // 2) Caché viejo o vacío → llamar a magayo una sola vez y guardar
    const fresh = await buildFresh(key);
    if(fresh.draws.length){ await cacheSet(req, fresh); }
    else {
      // Si magayo no devolvió nada (límite/red), servir el último caché aunque esté viejo.
      const stale = await cacheGet(req);
      if(stale && Array.isArray(stale.draws) && stale.draws.length){
        res.status(200).json({ ...stale, cached:true, stale:true, ageMin: Math.round((Date.now()-(stale.ts||0))/60000) });
        return;
      }
    }
    res.status(200).json({ ...fresh, cached:false });
  } catch (e) {
    // Último recurso: intentar caché viejo
    try{ const stale = await cacheGet(req); if(stale && stale.draws){ res.status(200).json({ ...stale, cached:true, stale:true }); return; } }catch(e2){}
    res.status(500).json({ error: "numeros_oficial_failed", detail: String(e) });
  }
};
