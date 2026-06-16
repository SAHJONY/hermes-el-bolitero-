// Build on-brand launch flyers for HERMES EL BOLITERO as SVG and rasterize to PNG.
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const OUT = path.join(__dirname, "..", "flyers");
fs.mkdirSync(OUT, { recursive: true });

// Cuban-flag lottery ball (the app logo), as an SVG <g> placed at x,y scaled.
function ball(x, y, scale) {
  return `<g transform="translate(${x},${y}) scale(${scale})">
    <circle cx="50" cy="50" r="48" fill="#0E1B22"/>
    <g clip-path="url(#ballClip)">
      <rect x="0" y="4" width="100" height="18.4" fill="#0A3D91"/>
      <rect x="0" y="22.4" width="100" height="18.4" fill="#F4EFE4"/>
      <rect x="0" y="40.8" width="100" height="18.4" fill="#0A3D91"/>
      <rect x="0" y="59.2" width="100" height="18.4" fill="#F4EFE4"/>
      <rect x="0" y="77.6" width="100" height="18.4" fill="#0A3D91"/>
      <path d="M2 4 L58 50 L2 96 Z" fill="#CE2026"/>
      <path d="M22 50 l4.7 9.5 10.5 1.5 -7.6 7.4 1.8 10.4 -9.4 -4.9 -9.4 4.9 1.8 -10.4 -7.6 -7.4 10.5 -1.5 Z" transform="translate(2,-13.5) scale(0.78)" fill="#F4EFE4"/>
      <circle cx="66" cy="50" r="22" fill="#F4EFE4"/>
      <text x="66" y="61" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="30" fill="#14242E">7</text>
      <circle cx="50" cy="50" r="46" fill="url(#gloss)"/>
    </g>
    <circle cx="50" cy="50" r="46" fill="none" stroke="#FFB838" stroke-opacity="0.55" stroke-width="2.5"/>
  </g>`;
}

const DEFS = `<defs>
  <radialGradient id="bgGlow" cx="50%" cy="30%" r="58%">
    <stop offset="0%" stop-color="#1c2f3a"/><stop offset="55%" stop-color="#0B141A"/><stop offset="100%" stop-color="#070d11"/>
  </radialGradient>
  <radialGradient id="goldGlow" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="#FFB838" stop-opacity="0.30"/><stop offset="100%" stop-color="#FFB838" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="gloss" cx="32%" cy="26%" r="80%">
    <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95"/><stop offset="45%" stop-color="#ffffff" stop-opacity="0.12"/><stop offset="100%" stop-color="#000000" stop-opacity="0.28"/>
  </radialGradient>
  <linearGradient id="goldBar" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="#FFE9A8"/><stop offset="55%" stop-color="#FFB838"/><stop offset="100%" stop-color="#E08C00"/>
  </linearGradient>
  <clipPath id="ballClip"><circle cx="50" cy="50" r="46"/></clipPath>
</defs>`;

const FONT = "DejaVu Sans, Arial, Helvetica, sans-serif";

// ---------- Flyer 1: Launch ----------
const launch = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
${DEFS}
<rect width="1080" height="1350" fill="url(#bgGlow)"/>
<ellipse cx="540" cy="420" rx="540" ry="540" fill="url(#goldGlow)"/>
<text x="540" y="118" text-anchor="middle" font-family="${FONT}" font-weight="bold" font-size="26" letter-spacing="8" fill="#8AA0AB">APP CUBANA DE LA BOLITA</text>
${ball(330, 165, 4.2)}
<text x="540" y="795" text-anchor="middle" font-family="${FONT}" font-weight="bold" font-size="100" letter-spacing="2" fill="#F4EFE4">HERMES</text>
<text x="540" y="862" text-anchor="middle" font-family="${FONT}" font-weight="bold" font-size="46" letter-spacing="16" fill="#FFB838">EL BOLITERO</text>
<text x="540" y="950" text-anchor="middle" font-family="${FONT}" font-size="34" fill="#CBD6DC">Resultados en vivo  ·  Charada  ·  Hermes IA</text>
<rect x="265" y="1012" width="550" height="80" rx="40" fill="url(#goldBar)"/>
<text x="540" y="1065" text-anchor="middle" font-family="${FONT}" font-weight="bold" font-size="37" fill="#3A2604">GRATIS para empezar</text>
<text x="540" y="1180" text-anchor="middle" font-family="${FONT}" font-weight="bold" font-size="42" letter-spacing="1" fill="#38D6BA">www.hermeselbolitero.com</text>
<text x="540" y="1305" text-anchor="middle" font-family="${FONT}" font-size="21" fill="#5b6e78">Solo información y entretenimiento · No es casa de apuestas</text>
</svg>`;

// ---------- Flyer 2: Planes / precios ----------
function planRow(y, name, price, gold) {
  const c = gold ? "#FFB838" : "#F4EFE4";
  return `<rect x="120" y="${y}" width="840" height="120" rx="22" fill="#13222B" stroke="${gold ? "#FFD978" : "#243640"}" stroke-width="${gold ? 3 : 1.5}"/>
  <text x="160" y="${y + 73}" font-family="${FONT}" font-weight="bold" font-size="35" fill="${c}">${name}</text>
  <text x="920" y="${y + 73}" text-anchor="end" font-family="${FONT}" font-weight="bold" font-size="42" fill="${gold ? "#FFB838" : "#38D6BA"}">${price}</text>`;
}
const planes = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
${DEFS}
<rect width="1080" height="1350" fill="url(#bgGlow)"/>
<ellipse cx="540" cy="280" rx="520" ry="420" fill="url(#goldGlow)"/>
${ball(470, 80, 1.4)}
<text x="540" y="360" text-anchor="middle" font-family="${FONT}" font-weight="bold" font-size="64" fill="#F4EFE4">PLANES</text>
<text x="540" y="420" text-anchor="middle" font-family="${FONT}" font-size="30" fill="#8AA0AB">Escoge el tuyo · empieza GRATIS</text>
${planRow(500, "GRATIS", "$0", false)}
${planRow(640, "MIEMBRO", "$7.99/mes", false)}
${planRow(780, "VIP CORONA 👑", "$19.99/mes", true)}
${planRow(920, "SUCURSAL · BANCA 🏦", "$49.99/mes", false)}
<text x="540" y="1130" text-anchor="middle" font-family="${FONT}" font-weight="bold" font-size="40" letter-spacing="1" fill="#38D6BA">www.hermeselbolitero.com</text>
<text x="540" y="1300" text-anchor="middle" font-family="${FONT}" font-size="21" fill="#5b6e78">Solo información y entretenimiento · No es casa de apuestas</text>
</svg>`;

async function render(name, svg) {
  const file = path.join(OUT, name + ".png");
  await sharp(Buffer.from(svg)).png().toFile(file);
  console.log("wrote", file);
}
(async () => {
  await render("flyer-launch", launch);
  await render("flyer-planes", planes);
})();
