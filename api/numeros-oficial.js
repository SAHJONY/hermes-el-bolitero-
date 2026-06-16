// /api/numeros-oficial — Resultados OFICIALES y verificables vía magayo Lottery Data API.
// Variable en Vercel: MAGAYO_API_KEY
// Devuelve: { draws:[...], realBoards, source, ts, cached }
//
// CACHÉ DE 30 MIN a prueba de fallos: si el almacén no responde, igual sirve los números
// frescos de magayo. NUNCA deja la pantalla vacía por culpa del caché.

const CACHE_KEY = "cache:numeros-oficial";
const CACHE_MIN = 30;

const MAP = [
  { board:"labolita", session:"Mañana",   p3:"us_tn_cash3_mor", p4:"us_tn_cash4_mor" },
  { board:"labolita", session:"Mediodía", p3:"us_fl_cash3_mid", p4:"us_fl_play4_mid" },
  { board:"labolita", session:"Tarde",    p3:"us_ga_cash3_eve", p4:"us_ga_cash4_eve" },
  { board:"labolita", session:"Noche",    p3:"us_fl_cash3_eve", p4:"us_fl_play4_eve" },
  { board:"florida",  session:"Mediodía", p3:"us_fl_cash3_mid", p4:"us_fl_play4_mid" },
  { board:"florida",  session:"Noche",    p3:"us_fl_cash3_eve", p4:"us_fl_play4_eve" },
  { board:"chicago",  session:"Mediodía", p3:"us_il_pick3_mid", p4:"us_il_pick4_mid" },
  { board:"chicago",  session:"Noche",    p3:"us_il_pick3_eve", p4:"us_il_pick4_eve" },
  { board:"georgia",  session:"Mediodía", p3:"us_ga_cash3_mid", p4:"us_ga_cash4_mid" },
  { board:"georgia",  session:"Tarde",    p3:"us_ga_cash3_eve", p4:"us_ga_cash4_eve" },
  { board:"georgia",  session:"Noche",    p3:"us_ga_cash3_night", p4:"us_ga_cash4_night" },
  { board:"newyork",  session:"Mediodía", p3:"us_ny_numbers_mid", p4:"us_ny_win4_mid" },
  { board:"newyork",  session:"Noche",    p3:"us_ny_numbers_eve", p4:"us_ny_win4_eve" },
  { board:"pr", session:"Mediodía", p3:"pr_pega3_day",   p4:"pr_pega4_day" },
  { board:"pr", session:"Noche",    p3:"pr_pega3_night", p4:"pr_pega4_night" },
  { board:"rd", session:"Noche",    p3:"do_pega3", p4:"do_pega3" },
];

async function fetchGame(key, game){
  try{
    const r = await fetch(`https://www.magayo.com/api/results.php?api_key=${key}&game=${game}`);
    const d = await r.json();
    if(d.error && d.error !== 0) return null;
    const parts = String(d.results||"").split(",").map(x=>x.trim()).filter(Boolean);
    return { draw: d.draw, value: parts[0]||"", positions: parts };
  }catch(e){ return null; }
}

function selfBase(req){
  const proto = (req.headers["x-forwarded-proto"]||"https").split(",")[0];
  const host  = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}
// Caché OPCIONAL — cualquier fallo se ignora en silencio y seguimos con magayo.
async function cacheGet(req){
  try{
    const r = await fetch(selfBase(req)+"/api/db",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({op:"get",key:CACHE_KEY,shared:true})});
    if(!r.ok) return null;
    const d = await r.json().catch(()=>null);
    if(!d) return null;
    let v = (d.value!==undefined)?d.value : (d.result!==undefined?d.result : (d.data!==undefined?d.data:null));
    if(v===null||v===undefined) return null;
    if(typeof v === "string"){ try{ v = JSON.parse(v); }catch(e){ return null; } }
    return (v && Array.isArray(v.draws)) ? v : null;
  }catch(e){ return null; }
}
async function cacheSet(req,payload){
  try{
    await fetch(selfBase(req)+"/api/db",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({op:"set",key:CACHE_KEY,shared:true,value:JSON.stringify(payload)})});
  }catch(e){}
}

async function buildFresh(key){
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
      board: m.board, date: a.draw || b.draw, session: m.session,
      pick3: a.value.padStart(3,"0").slice(-3),
      pick4: b.value.padStart(4,"0").slice(-4),
      quiniela,
    });
  }
  const realBoards = Array.from(new Set(draws.map(d => d.board)));
  return { draws, realBoards, source: "magayo-official", ts: Date.now() };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const key = process.env.MAGAYO_API_KEY;
  if (!key) { res.status(500).json({ error: "no-magayo-key" }); return; }

  let force = false;
  try{ const b = (typeof req.body==="object" && req.body) ? req.body : JSON.parse(req.body||"{}"); force = !!b.force; }catch(e){}

  // 1) Caché fresco (best-effort, jamás bloquea)
  if(!force){
    const cached = await cacheGet(req);
    if(cached && cached.ts && (Date.now()-cached.ts) < CACHE_MIN*60*1000 && cached.draws.length){
      res.status(200).json({ ...cached, cached:true, ageMin: Math.round((Date.now()-cached.ts)/60000) });
      return;
    }
  }

  // 2) Llamar a magayo. PASE LO QUE PASE con el caché, devolvemos estos números.
  let fresh;
  try{ fresh = await buildFresh(key); }
  catch(e){ fresh = { draws:[], realBoards:[], source:"magayo-official", ts:Date.now() }; }

  // Guardar en caché solo si hubo datos (best-effort, no espera ni rompe).
  if(fresh.draws.length){ cacheSet(req, fresh); }
  else {
    // magayo vacío → intentar servir el último guardado aunque esté viejo.
    const stale = await cacheGet(req);
    if(stale && stale.draws.length){
      res.status(200).json({ ...stale, cached:true, stale:true, ageMin: Math.round((Date.now()-(stale.ts||0))/60000) });
      return;
    }
  }
  res.status(200).json({ ...fresh, cached:false });
};
