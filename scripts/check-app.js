// Validates that the browser-loaded app actually transpiles.
// The app has no build step: index.html fetches app/p1..p4.txt, joins them,
// and runs Babel(preset-react) in the browser. A syntax error in any part
// breaks the WHOLE app at runtime, so we replicate that transform here and
// fail loudly. Run with: npm run check
const fs = require("fs");
const path = require("path");
const babel = require("@babel/core");

const appDir = path.join(__dirname, "..", "app");
const parts = ["p1.txt", "p2.txt", "p3.txt", "p4.txt"];

const code = parts
  .map((f) => fs.readFileSync(path.join(appDir, f), "utf8"))
  .join("\n");

try {
  babel.transform(code, { presets: ["@babel/preset-react"], filename: "app.jsx" });
  console.log("✓ app transpiles: " + parts.join(" + ") + " (" + code.length + " chars)");
} catch (e) {
  console.error("✗ app FAILED to transpile (this would break the live app):\n");
  console.error(e.message);
  process.exit(1);
}
