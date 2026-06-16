// lib/payouts.js — MOTOR DE PREMIOS server-side de HERMES EL BOLITERO.
// Port fiel de la lógica del cliente (comprobar) para que los premios se
// calculen y acrediten en el SERVIDOR (anti-trampa). Monedas virtuales.
// Pure: settleTicket(ticket, draw, payouts) -> ticket liquidado.

const num = (v) => { const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.]/g, "")); return isNaN(n) ? 0 : n; };
const sortS = (s) => String(s).split("").sort().join("");

// Encuentra el sorteo oficial de un ticket (board|date|session).
function pickDraw(draws, board, date, session) {
  return (draws || []).find(d => d.board === board && d.date === date && d.session === session) || null;
}

// Liquida UN ticket pendiente contra su sorteo. P = multiplicadores del dueño.
// Devuelve el ticket con {status, premio, resultado, ganancia, coinPaid}.
function settleTicket(t, d, P) {
  if (!t || t.status !== "pendiente" || !d) return t;
  const stake = num(t.monto);
  const p3 = String(d.pick3 || "").padStart(3, "0");
  const p4 = String(d.pick4 || "").padStart(4, "0");
  const mk = (won, premio, resultado, pay) => ({
    ...t, status: won ? "ganador" : "no salió", premio: won ? premio : null,
    resultado, ganancia: won ? pay : 0, coinPaid: won ? true : t.coinPaid,
  });

  if (t.tipo === "play4") { const won = t.play4 === p4; return mk(won, "4️⃣ PLAY 4", p4, stake * P.play4); }
  if (t.tipo === "cash3") { const won = t.cash3 === p3; return mk(won, "3️⃣ CASH 3", p3, stake * P.cash3); }
  if (t.tipo === "box3")  { const won = sortS(p3) === sortS(String(t.box3).padStart(3, "0")); return mk(won, "🔀 CASH 3 BOX", p3, stake * P.box3); }
  if (t.tipo === "box4")  { const won = sortS(p4) === sortS(String(t.box4).padStart(4, "0")); return mk(won, "🔀 PLAY 4 BOX", p4, stake * P.box4); }
  if (t.tipo === "pareja") {
    const target = t.pairPos === "back" ? p3.slice(1, 3) : p3.slice(0, 2);
    const won = t.pair === target;
    return mk(won, "👫 PAREJA " + (t.pairPos === "back" ? "trasera" : "delantera"), p3, stake * P.pair);
  }
  if (t.tipo === "centena") { const won = t.cent === p3; return mk(won, "💯 CENTENA", p3, stake * P.centena); }
  if (t.tipo === "sb3") {
    const exact = t.sb3 === p3; const boxed = !exact && sortS(p3) === sortS(String(t.sb3).padStart(3, "0"));
    const won = exact || boxed; const pay = exact ? stake * P.cash3 : boxed ? stake * P.box3 : 0;
    return mk(won, exact ? "🎯 DIRECTO (Str/Box)" : "🔀 BOX (Str/Box)", p3, pay);
  }
  if (t.tipo === "sb4") {
    const exact = t.sb4 === p4; const boxed = !exact && sortS(p4) === sortS(String(t.sb4).padStart(4, "0"));
    const won = exact || boxed; const pay = exact ? stake * P.play4 : boxed ? stake * P.box4 : 0;
    return mk(won, exact ? "🎯 DIRECTO (Str/Box)" : "🔀 BOX (Str/Box)", p4, pay);
  }
  if (t.tipo === "quiniela") {
    const pos = (d.quiniela && d.quiniela.length) ? d.quiniela.map(x => String(x).padStart(2, "0").slice(-2)) : [p3.slice(1)];
    const idx = pos.indexOf(t.qnum);
    const mult = idx === 0 ? P.q1 : idx === 1 ? P.q2 : idx === 2 ? P.q3 : 0;
    const won = idx >= 0; const etq = idx === 0 ? "🥇 1er premio" : idx === 1 ? "🥈 2do premio" : idx === 2 ? "🥉 3er premio" : "";
    return mk(won, "🎲 " + etq, pos.join(" · "), stake * mult);
  }
  // ---- bolita (fijo + corridos, con parlé y candado) ----
  const f2 = p3.slice(1);
  const ca = p4.slice(0, 2), cb = p4.slice(2, 4);
  const hits = []; const fijoHit = t.fijo === f2; if (fijoHit) hits.push("FIJO " + f2);
  let corr = 0; (t.corridos || []).forEach(c => { if (c === ca || c === cb) { hits.push("corrido " + c); corr++; } });
  const won = hits.length > 0;
  const candadoHit = fijoHit && corr >= 2;
  const parleHit = !candadoHit && ((fijoHit && corr >= 1) || corr >= 2);
  let mult = (fijoHit ? P.fijo : 0) + corr * P.corrido;
  if (parleHit) mult += P.parle;
  if (candadoHit) mult += P.candado;
  const pay = won ? stake * mult : 0;
  if (candadoHit) hits.push("🔒 CANDADO"); else if (parleHit) hits.push("🎯 PARLÉ");
  return mk(won, hits.join(" + "), f2 + " · " + ca + " " + cb, pay);
}

// Liquida TODOS los tickets pendientes de un jugador. Devuelve {tickets, credited, wins}.
// credited = monedas a sumar al saldo por aciertos NUEVOS (que aún no se habían pagado).
function settleAll(tickets, draws, P) {
  let credited = 0, wins = 0;
  const out = (tickets || []).map(t => {
    if (t.status !== "pendiente") return t;
    const d = pickDraw(draws, t.board, t.date, t.session);
    if (!d || (!d.pick3 && !d.pick4)) return t;
    const before = t.coinPaid;
    const s = settleTicket(t, d, P);
    if (s.status === "ganador" && !before && s.ganancia > 0) { credited += s.ganancia; wins++; }
    return s;
  });
  return { tickets: out, credited, wins };
}

// Multiplicadores por defecto (coinciden con coins:config del dueño).
const PAYOUT_DEFAULTS = { fijo: 75, corrido: 25, parle: 1000, candado: 2000, play4: 5000, cash3: 500, box3: 160, box4: 1200, pair: 70, centena: 600, q1: 60, q2: 20, q3: 10 };

module.exports = { settleTicket, settleAll, pickDraw, PAYOUT_DEFAULTS, num };
