// Generates the app icons (PWA + push notification) from a branded SVG.
// Run: node scripts/make-icons.js   (sharp is in devDependencies)
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

// Branded mark: dark rounded tile, a white lottery ball with gold "HB",
// matching the boot screen (radial white ball + gold #FFB838).
const svg = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="ball" cx="38%" cy="32%" r="75%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="70%" stop-color="#e7edf0"/>
      <stop offset="100%" stop-color="#b9c6cd"/>
    </radialGradient>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#13222B"/>
      <stop offset="100%" stop-color="#0B141A"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <circle cx="256" cy="256" r="150" fill="url(#ball)"/>
  <circle cx="256" cy="256" r="150" fill="none" stroke="#FFB838" stroke-width="14"/>
  <text x="256" y="258" text-anchor="middle" dominant-baseline="central"
        font-family="Georgia, 'Times New Roman', serif" font-weight="700"
        font-size="150" fill="#0B141A">HB</text>
  <text x="256" y="430" text-anchor="middle" dominant-baseline="central"
        font-family="system-ui, sans-serif" font-weight="800" letter-spacing="3"
        font-size="44" fill="#FFB838">BOLITERO</text>
</svg>`;

async function main() {
  const targets = [
    { name: "icon-192.png", size: 192 },
    { name: "icon-512.png", size: 512 },
    { name: "apple-touch-icon.png", size: 180 },
    { name: "favicon.png", size: 64 },
  ];
  for (const t of targets) {
    const out = path.join(ROOT, t.name);
    await sharp(Buffer.from(svg(t.size))).png().toFile(out);
    console.log("wrote", t.name, "(" + t.size + "px)");
  }
  // Maskable icon (full-bleed background, safe-zone padded) for Android adaptive icons.
  const maskable = `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#0B141A"/>
  <circle cx="256" cy="256" r="120" fill="#fff"/>
  <circle cx="256" cy="256" r="120" fill="none" stroke="#FFB838" stroke-width="12"/>
  <text x="256" y="258" text-anchor="middle" dominant-baseline="central"
        font-family="Georgia, serif" font-weight="700" font-size="120" fill="#0B141A">HB</text>
</svg>`;
  await sharp(Buffer.from(maskable)).png().toFile(path.join(ROOT, "icon-maskable-512.png"));
  console.log("wrote icon-maskable-512.png (512px)");
}

main().catch((e) => { console.error(e); process.exit(1); });
