// lib/game.js — MOTOR del juego de economía virtual de HERMES EL BOLITERO.
// Monedas VIRTUALES (estilo Monopoly), sin dinero real. Toda la lógica de
// capital/jugadas/premios corre en el SERVIDOR (anti-trampa): el navegador solo
// muestra. El estado vive en el almacén central (Supabase vía db.js).
//
// Recibe un `store` con { get(key)->string|null, set(key,val), list(prefix)->[keys] }
// (lo provee db.js, namespacing 'hb:' incluido). Hermes es el cerebro; esto el motor.

// ---- Reglas de la economía (las fija el banco central; ajustables) ----
const RULES = {
  WELCOME_CAPITAL: 1000,   // capital inicial al unirse
  MIN_STAKE: 5,            // jugada mínima
  MAX_STAKE: 500,          // jugada máxima
  FIJO_PAYOUT: 70,         // el fijo (2 dígitos) paga 70x lo jugado
  WIN_BONUS_PCT: 0.10,     // bono extra: 10% del premio en cada acierto
  STREAK_MIN: 3,           // a partir de 3 aciertos seguidos
  STREAK_STEP: 50,         // +50 por nivel de racha
  MAX_PLAYS: 60,           // historial de jugadas que se guarda por jugador
};

const todayKey = () => new Date().toISOString().slice(0, 10);
const two = (n) => String(((Number(n) % 100) + 100) % 100).padStart(2, "0"); // 0-99
const pkey = (pid) => "player:" + pid;

function newPlayer(pid, alias) {
  return {
    pid, alias: alias || pid,
    capital: RULES.WELCOME_CAPITAL,
    racha: 0, maxRacha: 0,
    jugadas: 0, aciertos: 0, ganadoTotal: 0,
    welcome: true,
    createdTs: Date.now(), lastTs: Date.now(),
    plays: [],
  };
}

async function load(store, pid) {
  const raw = await store.get(pkey(pid));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
async function save(store, p) {
  p.lastTs = Date.now();
  if (p.plays.length > RULES.MAX_PLAYS) p.plays = p.plays.slice(-RULES.MAX_PLAYS);
  await store.set(pkey(p.pid), JSON.stringify(p));
  return p;
}

async function ensure(store, pid, alias) {
  let p = await load(store, pid);
  if (!p) { p = newPlayer(pid, alias); await save(store, p); }
  else if (alias && p.alias !== alias) { p.alias = alias; }
  return p;
}

// Coloca una jugada sobre un sorteo futuro/hoy. Descuenta lo jugado del capital.
async function play(store, { pid, alias, board, session, number, stake }) {
  const p = await ensure(store, pid, alias);
  const amt = Math.floor(Number(stake));
  if (!board || !session) return { ok: false, error: "missing_board_or_session", player: p };
  if (!Number.isFinite(amt) || amt < RULES.MIN_STAKE || amt > RULES.MAX_STAKE)
    return { ok: false, error: "invalid_stake", min: RULES.MIN_STAKE, max: RULES.MAX_STAKE, player: p };
  if (amt > p.capital) return { ok: false, error: "insufficient_capital", capital: p.capital, player: p };

  const num = two(number);
  const fecha = todayKey();
  const ref = "J-" + Date.now().toString(36).toUpperCase() + "-" + Math.floor((Date.now() % 9999)).toString(36).toUpperCase();
  p.capital -= amt;
  p.jugadas += 1;
  p.plays.push({ ref, board, session, fecha, number: num, stake: amt, ts: Date.now(), status: "pending", win: 0 });
  await save(store, p);
  return { ok: true, ref, player: pub(p) };
}

// Liquida jugadas pendientes cuyo sorteo YA cayó (fecha pasada), usando los
// resultados oficiales (draws de lib/results.js). Premia aciertos + bonos.
async function settle(store, pid, draws) {
  const p = await load(store, pid);
  if (!p) return null;
  const today = todayKey();
  const idx = {};
  for (const d of (draws || [])) idx[`${d.board}|${d.date}|${d.session}`] = d;

  let changed = false;
  for (const j of p.plays) {
    if (j.status !== "pending") continue;
    if (j.fecha >= today) continue; // el sorteo aún no cae: se resuelve al día siguiente
    const d = idx[`${j.board}|${j.fecha}|${j.session}`];
    if (!d || !d.pick3) continue; // sin resultado oficial todavía
    const fijo = String(d.pick3).slice(-2);
    changed = true;
    if (fijo === j.number) {
      const bruto = j.stake * RULES.FIJO_PAYOUT;
      const bono = Math.round(bruto * RULES.WIN_BONUS_PCT);
      p.racha += 1; p.maxRacha = Math.max(p.maxRacha, p.racha);
      const rachaBono = p.racha >= RULES.STREAK_MIN ? p.racha * RULES.STREAK_STEP : 0;
      const total = bruto + bono + rachaBono;
      p.capital += total; p.aciertos += 1; p.ganadoTotal += total;
      j.status = "won"; j.win = total; j.fijo = fijo; j.bono = bono + rachaBono; j.settledTs = Date.now();
    } else {
      p.racha = 0;
      j.status = "lost"; j.win = 0; j.fijo = fijo; j.settledTs = Date.now();
    }
  }
  if (changed) await save(store, p);
  return p;
}

// Vista pública del jugador (sin internals).
function pub(p) {
  if (!p) return null;
  return {
    pid: p.pid, alias: p.alias, capital: p.capital,
    racha: p.racha, maxRacha: p.maxRacha,
    jugadas: p.jugadas, aciertos: p.aciertos, ganadoTotal: p.ganadoTotal,
    welcome: !!p.welcome,
    plays: p.plays.slice(-15).reverse(),
  };
}

// Estado del jugador: crea si no existe, liquida pendientes, devuelve vista.
async function state(store, { pid, alias }, draws) {
  await ensure(store, pid, alias);
  const p = (await settle(store, pid, draws)) || (await load(store, pid));
  // marca el welcome como visto tras la primera consulta
  if (p && p.welcome) { p.welcome = false; await save(store, p); p.welcome = true; }
  return pub(p);
}

// Ranking (competencia): top por capital. listFn = store.list.
async function leaderboard(store, limit = 20) {
  const keys = await store.list("player:");
  const players = [];
  for (const k of keys) {
    const raw = await store.get(k);
    if (!raw) continue;
    try { const p = JSON.parse(raw); players.push({ alias: p.alias, capital: p.capital, aciertos: p.aciertos, maxRacha: p.maxRacha }); } catch { /* skip */ }
  }
  players.sort((a, b) => b.capital - a.capital);
  return players.slice(0, limit);
}

module.exports = { RULES, play, settle, state, ensure, load, pub, leaderboard };
