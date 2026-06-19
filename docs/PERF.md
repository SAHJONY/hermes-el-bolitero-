# Performance & Scalability Review — HERMES EL BOLITERO

Reviewer lens: Senior Performance Engineer. Context: client-side React PWA
(React 18 UMD + Recharts + babel-standalone via CDN), app code shipped as four
`.txt` JSX chunks transpiled in the browser, storage via `/api/db` + localStorage,
deployed on Vercel. On a static client app **every cost is paid per user**, so
client efficiency is the horizontal-scale story.

---

## 1. Performance Issue Breakdown

### P0 — In-browser transpilation on every load (`index.html`)
`babel-standalone` (~2.7 MB min) is downloaded by every visitor, then
`Babel.transform()` compiles ~270 KB of concatenated JSX **on the main thread**
before first interaction, and the result runs through `(0,eval)()`.
Impact: large bandwidth + multi-hundred-ms main-thread compile per session,
delayed TTI, `eval` deopt, CSP friction. This dwarfs every other client cost.

### P0 — Cache-busting that defeats caching
App chunks load as `"/app/pN.txt?v="+Date.now()` → a unique URL every load, so
browser and CDN caches are never reused. Returning users re-download the entire
app each visit.

### P1 — 4 serial-ish chunk fetches + join + compile
`p1..p4.txt` are fetched (parallel) then string-joined and compiled at runtime.
Even precompiled, four files is four cache entries; one hashed bundle is better.

### P1 — Global DOM monkeypatch on the reconciliation hot path
`Node.prototype.removeChild`/`insertBefore` are wrapped globally (a Google-Translate
workaround). Every insert/remove across all of React's reconciliation pays an
extra call + `parentNode` check.

### P1 — Redundant translation stack
A full custom ES/EN i18n (`t()/tf()`) exists, yet the Google Translate widget is
still loaded (external script + DOM mutation) — the very thing that forced the
monkeypatch above. Redundant work and a bug source.

### P2 — Recharts loaded eagerly
The full Recharts UMD bundle loads upfront though charts live in one secondary
tab — unused JS parsed/initialized for users who never open it.

### P2 — Storage reads not coalesced/cached
Shared `sGet` performs a `fetch('/api/db')` per call; many components read on
mount independently with no in-memory cache or request coalescing → duplicate
round-trips and `/api/db` load that grows with users.

### P3 — Arcade progress recompute (FIXED)
`countArcade()` ran 9 `await` reads in series and re-ran on every `arcade:played`
event with no debounce. Now parallelized (`Promise.all`) and debounced (200 ms).

---

## 2. Optimization Strategies

| Issue | Strategy |
|------|----------|
| P0 Babel-in-browser | **Precompile at deploy** with `@babel/core` + `preset-react` (already devDeps; `check-app.js` already transpiles). Emit one bundle; delete babel-standalone `<script>`. |
| P0 Cache-bust | Emit a **content-hashed** bundle (`app.<hash>.js`) referenced by `index.html`; set long-lived `Cache-Control: immutable` in `vercel.json`. Hash changes only when code changes. |
| P1 chunks | Concatenate p1–p4 into the single precompiled bundle. |
| P1 monkeypatch | Remove Google Translate → removes the need for the patch. If kept, scope the patch to the translated subtree, not `Node.prototype`. |
| P1 redundant i18n | Drop the Google Translate widget; the in-app toggle already covers ES/EN. |
| P2 Recharts | **Lazy-load** Recharts (and the Charts tab) on first open via dynamic `<script>`/`import()`; show a skeleton meanwhile. |
| P2 storage | Add a thin **in-memory cache + in-flight request map** in `window.storage.get` (shared keys) to coalesce concurrent reads and serve repeats from memory; invalidate on `set`/`delete`. |

---

## 3. Improved Production-Ready Code

### 3a. Precompiled boot (replaces babel-standalone block in `index.html`)
```html
<!-- React/ReactDOM/Recharts as today, then: -->
<script crossorigin src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script crossorigin src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<!-- One precompiled, content-hashed bundle. No babel-standalone, no eval. -->
<script defer src="/app/app.<!--HASH-->.js"></script>
```

### 3b. Build step (`scripts/build-app.js`) — run on Vercel build
```js
const fs = require("fs");
const crypto = require("crypto");
const babel = require("@babel/core");
const SRC = ["p1","p2","p3","p4"].map(n => `app/${n}.txt`);
const code = SRC.map(f => fs.readFileSync(f, "utf8")).join("\n");
const { code: out } = babel.transform(code, {
  presets: [["@babel/preset-react"]],
  compact: true, comments: false, filename: "app.jsx",
});
const hash = crypto.createHash("sha256").update(out).digest("hex").slice(0, 12);
fs.writeFileSync(`app/app.${hash}.js`, out);
const html = fs.readFileSync("index.html", "utf8").replace(/app\/app\.[a-f0-9]+\.js|<!--HASH-->/, `app/app.${hash}.js`);
fs.writeFileSync("index.html", html.replace("<!--HASH-->", hash));
console.log("built app/app." + hash + ".js (" + out.length + " bytes)");
```
Wire `"build": "node scripts/build-app.js"` and point Vercel's build command at it.
Net effect per user: **−~2.7 MB download, no main-thread compile, fully cacheable.**

### 3c. Cache headers (`vercel.json`)
```json
{ "headers": [
  { "source": "/app/app.(.*).js",
    "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] }
]}
```

### 3d. Storage read coalescing (drop-in for `window.storage.get`, shared keys)
```js
var _mem = new Map(), _inflight = new Map();         // value cache + in-flight dedupe
// inside get(): for shared keys, before hitting db()
if (s) {
  if (_mem.has(k)) return { key:k, value:_mem.get(k), shared:true };
  if (_inflight.has(k)) return _inflight.get(k);
  var p = (async () => { /* existing db()+fallback logic */ })();
  _inflight.set(k, p); try { return await p; } finally { _inflight.delete(k); }
}
// in set()/delete(): _mem.set(k,v) / _mem.delete(k) to keep cache coherent
```

### 3e. Arcade progress (already applied in `app/p3.txt`)
- `countArcade()`: `Promise.all` over `getMiniState` + 8 daily reads (was serial).
- `ArcadeProgress`: 200 ms debounce coalescing bursts of `arcade:played`.

---

## 4. Scalability Recommendations

- **Static-first / edge:** the SPA shell is static — serve from CDN/edge with
  immutable hashed assets; only `/api/*` needs compute. Precompiling removes the
  single largest per-user CPU/bandwidth cost and is the highest-leverage change.
- **`/api/db` is the shared-state choke point.** Add: (a) client read coalescing
  + short TTL cache (3d), (b) batched multi-key reads (`{op:"mget",keys:[…]}`)
  so a tab's mount is one round-trip, (c) connection pooling on the serverless
  side, (d) per-key write debouncing for high-churn counters (coins/XP).
- **Hot shared counters** (coins, leaderboard, wagers) will contend under load.
  Move to atomic server-side increments and **shard leaderboard** by week/bucket;
  compute ranks asynchronously rather than read-modify-write from clients.
- **Live draws:** cache `fetchLiveDraws` at the edge with a short TTL so spikes
  collapse onto one upstream fetch (stale-while-revalidate), instead of each
  client hitting origin.
- **Defer/parallelize:** lazy-load secondary tabs (Charts/Studio); keep the
  initial bundle to the first-paint path (Hoy/Juega).
- **Observability:** track Core Web Vitals (LCP/INP/TTFB) + `/api/db` p95 in
  production to catch regressions before users do.
