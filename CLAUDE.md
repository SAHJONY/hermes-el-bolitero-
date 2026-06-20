# HERMES EL BOLITERO — working agreement (read this first)

A bilingual (ES/EN) Cuban lottery/charada PWA + social-casino. Static client app
served by Vercel, with serverless functions for the AI brain, results, the
server-authoritative virtual economy, and notifications.

---

## Standing directive: session efficiency (always on)
The owner runs on a metered plan — **each session/request is precious**. Make
every one count; never waste one.

- **Batch.** Do all related tasks in a single session. Don't split work that
  could be one run into many requests.
- **Run autonomously.** Carry a task through to done — code → `npm run check` →
  commit → deploy → verify → report — without stopping to ask, unless a step is
  destructive, ambiguous, or genuinely the owner's call.
- **Fold verification into the work.** Never spend a turn just to "check status";
  confirm as part of the session and report at the end.
- **Prefer the highest-leverage work** toward getting customers in and paying
  (distribution, the paid-tier flow, real result feeds, anything blocking
  signup) over cosmetic polish, until the app is profitable.
- Don't over-engineer a small ask into a large project.

## Standing directive: performance-first (always on)
Every cost on a client-side PWA is paid **per user**. Flag latency, wasted
CPU/bandwidth, redundant renders, serial I/O, leaks, and cache-busting that
defeats caching. Apply low-risk in-scope fixes; propose (with code) and get a
go-ahead for boot-path/architectural ones. Never trade correctness, a11y, or
clarity for micro-optimizations.

## Standing directive: clean-architecture instincts (always on)
Keep business rules out of React components (pure domain functions); depend on
abstractions, isolate I/O in adapters; respect UI → application → domain. **Do
not big-bang rewrite this live, browser-unverifiable app** — migrate via
strangler-fig, smallest verified slices first, never altering `api/*` contracts.
(Fuller notes live on the `claude/modest-curie-pfj1ca` branch's
`docs/ARCHITECTURE.md` / `docs/PERF.md`.)

---

## ⚠️ CRITICAL: branch landmine — do not regress production
- **`main` IS production.** Pushing to `main` auto-deploys to Vercel
  (`www.hermeselbolitero.com`). `main` holds the newest work: server-authoritative
  anti-cheat economy, push, broadcast, Suerte tab, coin store, the full daily
  arcade.
- **NEVER merge `claude/modest-curie-pfj1ca` into `main`.** It is an *older*
  divergent branch (~69 ahead / ~13 behind) that **deletes live production code**
  (`api/broadcast.js`, `api/push.js`, `lib/payouts.js`, PWA icons,
  `manifest.webmanifest`, `sw.js`). Its good parts (rebrand, local-midnight
  reset, CI, the arcade) were already cherry-ported onto `main`. To deploy, work
  from a clean branch off `main`.

## Architecture (how the app is built)
- **Client:** `index.html` boots a loader that fetches `app/p1.txt`…`p4.txt`,
  concatenates them, and transpiles the JSX with **babel-standalone in the
  browser**, then `eval`s it. There is no build step for the app itself.
- **Serverless:** `api/*.js` (Vercel Node functions; **Hobby plan = max 12**,
  currently ~10 — budget before adding). Shared helpers in `lib/`.
- **Shared datastore:** auto-detected in `api/db.js` — Supabase first, else
  Upstash/Vercel KV (Redis). Until one is connected, shared writes silently fall
  back to per-device `localStorage` (`{configured:false}`).
- **Secrets:** never in the repo. All via `process.env`, set only in Vercel →
  Settings → Environment Variables. See `SECRETS.md` for the catalog (names only).

## Verify like this (the sandbox can't reach the internet directly)
- **Gate before every commit:** `npm run check` (transpiles p1–p4). Syntax only —
  it does **not** run the app; boot/render/behavior changes still need a real
  browser pass.
- **CI** (`.github/workflows/ci.yml`) runs the same gate + a hardcoded-secret
  scan on every push/PR.
- This container's egress is firewalled (`host_not_allowed`), so plain `curl` to
  the live site fails. To check production, use the **Vercel MCP**
  `web_fetch_vercel_url` (GET) against the deployment URL.
- **Readiness URLs:** `GET /api/health` (overall `ready` + per-integration
  booleans, no secret values) and `GET /api/hermes` (AI providers configured).
