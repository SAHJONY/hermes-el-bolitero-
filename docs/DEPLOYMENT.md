# Production Reliability & Deployment — HERMES EL BOLITERO

Reviewer lens: Senior DevOps / SRE. **Reality check first:** this is a static PWA
+ Vercel serverless functions (`api/*`, `maxDuration 30s`) + Upstash Redis (REST)
on a custom domain. There is **no VM, container, VPC, or cluster to operate** — so
Kubernetes/Helm/VPC/load-balancer designs do not apply and adding them would be
pure cost and risk against the project's "simplicity over complexity" mandate.
Below, each classic SRE deliverable is mapped to its **managed-platform
equivalent**, plus a "when you outgrow Vercel" note for the 5-year horizon.

---

## 1. Infrastructure Architecture (as-is, hardened)
```
                 ┌──────────────────────────────────────────┐
   Users ─TLS──▶ │ Vercel Edge Network (global CDN + Anycast)│  ← LB + WAF + TLS
                 │  • static shell (index.html, /app/*.js)   │    are platform-managed
                 │  • edge cache for cacheable GET responses │
                 └───────────────┬──────────────────────────┘
                                 │
                 ┌───────────────▼───────────────┐
                 │ Vercel Serverless Functions    │  (auto-scaled, stateless)
                 │  /api/db  /api/balance         │
                 │  /api/numeros-oficial /api/hermes
                 │  /api/notify-win /api/ticket … │
                 └──┬──────────────┬───────────┬──┘
                    │              │           │
        ┌───────────▼──┐   ┌───────▼─────┐  ┌──▼───────────────┐
        │ Upstash Redis│   │ Draw feeds  │  │ AI providers     │
        │ (REST, hb:*) │   │ data.ny.gov │  │ NVIDIA/OpenRouter│
        │  state store │   │ magayo      │  │ Anthropic (chain)│
        └──────────────┘   └─────────────┘  └──────────────────┘
                    Notifications: Telegram / email / voice (secret-gated)
                    Scheduler: Vercel Cron → /api/cron-reminder
```
**Hardening actions (real gaps found):**
- **TLS/LB/WAF/DDoS:** managed by Vercel Edge — keep, enable Vercel WAF + Attack
  Challenge Mode for the public write endpoints.
- **Single point of failure = Upstash Redis** (every account/forum/coin read).
  Mitigate: Upstash Global (multi-region replication), client-side timeout +
  graceful localStorage fallback (already present in `index.html`), and circuit-
  breaking in a shared `lib/kv.js`.
- **AI dependency:** already has a provider failover chain (engine→nvidia→
  anthropic) — good. Add a short timeout + a static fallback reply.
- **Draws SPOF:** `numeros-oficial.js` already degrades to free NY feed when magayo
  is down — good; cache last-good in Redis with TTL so a total upstream outage
  still serves stale results.

## 2. Deployment Workflow (zero-downtime — already native, make it deliberate)
Vercel gives you most of this for free; the gap is **process discipline**, not tech.
- **Atomic immutable deploys + instant rollback** = built-in blue/green. Every
  deploy is a new immutable build; promotion is an atomic alias swap; rollback is
  one click/CLI call. **Action:** document the rollback runbook (§6).
- **Preview Deployments per PR** = canary/staging for free. **Action:** require a
  green CI run (this repo's new `.github/workflows/ci.yml`) + a manual smoke check
  on the preview URL before promoting to production. Protect the production branch.
- **Progressive rollout:** for risky releases use Vercel **Skew Protection** +
  staged promotion (deploy → verify preview → promote). True % canary needs
  Vercel's traffic-splitting / a feature flag — recommend flags for big changes
  (e.g. the precompiled-boot migration in `docs/PERF.md`).

## 3. CI/CD Pipeline (NOW LANDED — `.github/workflows/ci.yml`)
Before today there was **no CI**; the transpile gate ran only by hand. The new
workflow runs on every push/PR:
1. `npm ci` (lockfile-pinned, reproducible)
2. `npm run check` — Babel-transpiles p1..p4; fails the build on any syntax error.
3. Lightweight hardcoded-secret guard (`git grep` for provider key patterns).
**Vercel** handles build+deploy on merge (Git integration), so GH Actions stays the
*validation* gate and Vercel the *delivery* engine — clean separation.
**Next increments:** add `vitest` once the domain layer is extracted
(`docs/ARCHITECTURE.md`), add `gitleaks` for real secret scanning, and a Lighthouse-
CI budget on the preview URL to catch perf regressions (`docs/PERF.md`).

## 4. Containerization & Orchestration
**Not applicable today** — functions are deployed as managed lambdas, not
containers; there is no orchestrator to configure (no liveness/readiness probes,
no resource limits to set beyond `vercel.json`'s `maxDuration`). Forcing Docker/k8s
here adds an ops burden with no reliability gain.
- **Do now (the real knobs):** keep `maxDuration` tight per function; add
  per-function `memory` sizing in `vercel.json`; set `regions` near your users;
  ensure functions are stateless (they are).
- **"When you outgrow Vercel" (5-yr horizon):** if cost or control forces a move,
  the target is a containerized modular monolith (one image, multi-stage Docker,
  non-root user, distroless base) behind a managed LB, with HPA on CPU/RPS and
  readiness/liveness probes — but only once metrics justify the operational tax.
  Design the app (per `docs/ARCHITECTURE.md`) so this is a deployment swap, not a
  rewrite.

## 5. Observability & Monitoring
Current state: **near-zero** — `console`/ad-hoc, no metrics, no alerts, no tracing.
Establish the three pillars with managed tooling (no infra to run):
- **Logging:** add a structured JSON logger (`lib/log.js`: level, route, reqId,
  latency, outcome) and ship via **Vercel Log Drains → Better Stack / Datadog /
  Axiom**. Never log PII (phone/email) or secrets.
- **Metrics & RUM:** enable **Vercel Analytics + Speed Insights** (Core Web Vitals:
  LCP/INP/CLS) and Vercel function metrics (invocations, duration, error rate).
  Track Upstash dashboard (cmd latency, throughput, evictions).
- **Tracing:** propagate a `x-request-id` from edge → function → Redis call; include
  it in every log line for request correlation.
- **Synthetic checks:** uptime monitor (Better Uptime/Checkly) hitting
  `/api/numeros-oficial` and a static asset every 1–5 min from multiple regions.
- **SLIs / SLOs (proposed):**
  | SLI | SLO |
  |-----|-----|
  | Shell availability (200 on `/`) | 99.95% / 30d |
  | API success rate (non-5xx) | ≥ 99.9% |
  | `/api/numeros-oficial` p95 latency | < 800 ms |
  | `/api/hermes` p95 latency | < 6 s (LLM-bound) |
  | LCP (RUM, p75 mobile) | < 2.5 s |
- **Alerts (page vs ticket):** page on API 5xx rate > 2% (5 min), Redis
  unreachable, or synthetic down 2 consecutive checks; ticket on SLO burn-rate
  warnings and Web Vitals regressions.

## 6. Production Deployment Checklist / Runbook
**Pre-flight (every release):**
- [ ] CI green (`npm run check` + secret guard) on the PR.
- [ ] Preview URL smoke test: app boots, each tab renders, a coin write + ticket
      check round-trips, language toggle works.
- [ ] No secrets in diff; new env vars added in Vercel (all environments).
- [ ] DB-affecting change reviewed for `KEYS` usage (must be SCAN/indexed — see
      `docs/PERF.md`/`BACKEND` notes) and for TTLs on ephemeral keys.
- [ ] Rollback plan noted (previous deployment id).

**Cutover:**
- [ ] Promote preview → production (atomic alias).
- [ ] Watch error rate + p95 + Web Vitals for 15 min.

**Rollback (one step):** `vercel rollback <previous-deployment-url>` (or re-promote
the prior deployment in the dashboard) — instant, because deploys are immutable.

**Config to add now:**
```jsonc
// vercel.json — wire the existing cron-reminder (currently NOT scheduled),
// size hot functions, and pin regions. Keep existing headers.
{
  "crons": [{ "path": "/api/cron-reminder", "schedule": "0 14 * * *" }],
  "functions": {
    "api/**/*.js": { "maxDuration": 30 },
    "api/hermes.js": { "maxDuration": 30, "memory": 512 },
    "api/numeros-oficial.js": { "maxDuration": 15, "memory": 256 }
  }
}
```
> Note: `cron-reminder.js` exists and self-authorizes via `CRON_SECRET`, but no
> `crons` entry schedules it — so the daily broadcast never fires. Add the block
> above (and set `CRON_SECRET`) to activate it.

---

### Top reliability risks (cross-cutting, prioritized)
1. **No CI/tests** → FIXED (CI added); add unit tests next.
2. **In-browser Babel boot** (`docs/PERF.md`) → slow, fragile cold start per user.
3. **`KEYS` scans** in `balance.js`/`db.list` → Redis latency cliff under load.
4. **Public write endpoint `/api/db` has no rate limiting** → abuse/cost/integrity.
5. **Unscheduled cron** → advertised daily reminder silently never runs.
6. **No observability** → outages found by users, not alerts.
