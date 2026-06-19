# HERMES EL BOLITERO — working agreement

## Standing directive: performance-first engineering (always on)
Apply a **Senior Performance Engineer** lens to every change in this repo, by
default, without being asked. Treat the app as if it serves massive concurrent
traffic — on a static client-side PWA that means **every cost is paid per user**,
so client efficiency *is* the scalability story.

On each task:
- Proactively flag performance/scale liabilities you notice (latency, wasted
  CPU/bandwidth, redundant renders/state, sequential I/O, memory/listener leaks,
  cache-busting that defeats caching).
- Where a fix is **low-risk and in scope**, apply it. Where it's large or
  boot-path/architectural, propose it concretely (with code) and get a go-ahead
  before committing — don't silently rewrite hot paths you can't verify.
- Prefer: precompiled assets over in-browser compilation, content-hash caching
  over `?v=Date.now()`, `Promise.all` over serial `await` loops, debounced/
  coalesced event handlers, lazy-loading for off-screen/secondary views,
  request coalescing + in-memory caches over repeated storage/network reads.
- **Never trade correctness, accessibility, or clarity for micro-optimizations**,
  and don't over-engineer a simple request into a perf project.

## Standing directive: clean-architecture instincts (always on)
Also apply a **Senior Software Architect** lens (see `docs/ARCHITECTURE.md`):
- Keep business rules out of React components — pure domain logic belongs in
  domain/use-case functions (e.g. ticket payout/win-checking should not live
  inside `TabTicket`).
- Depend on abstractions (ports), not concrete I/O (`window.storage`, `fetch`);
  isolate I/O in adapters.
- Respect the dependency rule: UI → application → domain; infrastructure
  implements ports. Never make domain import UI/infra.
- **Do not big-bang rewrite this live app.** The layered structure is gated on
  "Step 0" (a real build pipeline replacing in-browser Babel). Migrate via
  strangler-fig, smallest pure slices first, each browser-verified — never alter
  external behavior or `api/*` contracts while refactoring.

## Known top optimization targets (see docs/PERF.md for full analysis)
1. `index.html` boots via **babel-standalone**: ships a ~2.7 MB compiler and
   transpiles ~270 KB of JSX on the main thread, every load. Biggest win =
   precompile at build time (devDeps + `scripts/check-app.js` already transpile)
   and drop babel-standalone.
2. App chunks (`p1..p4.txt`) are fetched with `?v=Date.now()` → **uncacheable**;
   move to content-hashed bundle(s).
3. Shared `sGet` hits `/api/db` per call with no coalescing/cache.

## Verification
- `npm run check` (transpiles p1–p4) is the required gate before every commit.
- It validates **syntax only** — it does NOT run the app. For boot-path, render,
  or behavior changes, a real browser pass is still needed before shipping.
