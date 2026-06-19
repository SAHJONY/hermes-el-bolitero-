# Clean Architecture Refactor — HERMES EL BOLITERO

Reviewer lens: Senior Software Architect. Goal: a layered, testable, scalable
structure **with zero change to product behavior or API contracts**. This is a
*target design + safe migration plan*, not a big-bang rewrite (see "Migration").

---

## 0. The root constraint (read first)
The app today boots by fetching `app/p1..p4.txt`, concatenating them, compiling
JSX with **babel-standalone in the browser**, and `eval`-ing the result into one
**global scope**. Consequences:
- No module boundaries — every symbol (`LOTTERIES`, `addCoins`, `TabTicket`, …)
  shares one namespace; nothing can be `import`ed, mocked, or unit-tested.
- Domain rules live *inside* React components (e.g. the bet payout/win-checking
  logic is embedded in `TabTicket.comprobar`).

**Therefore Step 0 of any Clean Architecture migration is introducing a build
step** (esbuild/Vite) so source can be many files with real `import`/`export`.
This is the same prerequisite as the P0 perf fix in `docs/PERF.md` (drop
in-browser Babel → precompiled bundle). Architecture and performance share Step 0.

---

## 1. New Folder Structure (target)
```
src/
  domain/                     # Pure. Zero I/O, zero framework. The business core.
    boards.ts                 # LOTTERIES, US_BOARDS, INTL_BOARDS, SESSION_TIMES
    charada.ts                # CHARADA map, charadaOf()
    rng.ts                    # hashStr, mulberry32, resultFor()  (deterministic)
    dates.ts                  # dateKey, fmtDate, pastDays, nextDraw
    draw.ts                   # Draw/Result types, toRes(), pickDraw() (pure select)
    payouts.ts                # PayoutTable type + bet-type rules
    ticketEvaluation.ts       # evaluateTicket(ticket, draw, payouts) -> outcome
  application/                # Use-cases. Orchestrate domain + ports. No React, no fetch.
    ports/                    # Interfaces = the dependency-inversion seams
      StoragePort.ts          #   get/set/delete/list(key, scope)
      DrawsPort.ts            #   fetchLiveDraws()
      AiPort.ts               #   ask(messages, opts)
      NotifyPort.ts           #   call/email/telegram
      ClockPort.ts            #   now() / today()  (kills hidden Date.now coupling)
    coins.ts                  # getCoins, addCoins, spendCoins, recordWager, config
    games.ts                  # getMiniState, playHotBall, playCharada, daily-play rules
    missions.ts               # getMissions, bumpMission
    leaderboard.ts            # pushScore
    draws.ts                  # live-draw TTL cache (depends on DrawsPort)
    tickets.ts                # createTicket, checkTickets (uses ticketEvaluation)
    ai.ts                     # askHermes (depends on AiPort)
  infrastructure/             # Adapters implementing the ports. The only I/O.
    storage/webStorageAdapter.ts   # wraps window.storage (/api/db + localStorage)
    draws/httpDrawsAdapter.ts      # GET /api/numeros-oficial
    ai/claudeAdapter.ts            # POST /api/hermes  (current askClaude)
    notify/httpNotifyAdapter.ts    # /api/call|email|telegram-result
    i18n/dictionaries.ts           # I18N es/en tables
  ui/                         # Interface adapters: React only. Talks to use-cases.
    theme.ts                  # T tokens, FONT_CSS
    i18n.ts                   # t, tf, useLang (thin hook over dictionaries)
    components/               # Section, Label, Countdown, Ball, …
    hero/                     # CasinoHero, FijoHero, PendingHero, CLC_SCENE
    tabs/                     # TabHoy, TabStats, TabCharada, TabJuega, TabTicket, TabPago…
    games/                    # Ruleta, Raspadito, Slots, CoinFlip, Dice, HiLo,
                              #   Blackjack, Memory, ArcadeProgress, useDaily
    app/                      # Shell, MembersGate, Admin, App
  main.tsx                    # COMPOSITION ROOT: build adapters → inject into
                              #   use-cases → render UI. The only place layers meet.
api/                          # Server boundary (already separate). Contracts UNCHANGED.
build/                        # esbuild config → app.<contenthash>.js  (Step 0)
test/                         # unit tests, now possible per layer
```

## 2. Clean Architecture Breakdown — boundaries & dependency flow
**The Dependency Rule:** source dependencies point inward only.
```
ui ─────▶ application ─────▶ domain
              ▲
infrastructure ┘   (implements application/ports; injected at main.tsx)
```
- **Domain** depends on nothing — pure functions over plain data. `evaluateTicket`,
  `resultFor`, `pickDraw`, `charadaOf` go here. Fully unit-testable, no mocks.
- **Application** depends only on Domain + its own **Port interfaces**. It expresses
  *what the product does* (“check my tickets”, “spend coins”) without knowing
  *how* storage/network work. Today's `addCoins`, `playHotBall`, `fetchLiveDraws`
  live here but call ports instead of `window.storage`/`fetch` directly.
- **Infrastructure** implements the ports (localStorage/`/api/db`, `/api/*`). It’s
  the *only* layer that knows about `window`, `fetch`, or Babel. Swappable.
- **UI** renders use-case results and dispatches use-case calls. Components hold
  *no business rules* — `TabTicket` calls `checkTickets()`, it doesn’t compute payouts.
- **Composition root** (`main.tsx`) is the single wiring point: instantiate
  adapters, inject them into use-cases, hand use-cases to UI. Inversion lives here.

**Data flow example (check tickets):** `TabTicket` → `checkTickets(useCaseDeps)` →
pulls draws via `DrawsPort`, tickets via `StoragePort`, calls pure
`evaluateTicket()` per ticket, credits via `coins.addCoins` (StoragePort), returns
a view-model → UI renders. Swap localStorage for Redis, or the draw API for
another provider, by changing one adapter — no domain/UI edits.

## 3. Refactored Production-Grade Code (representative slices)

### 3a. Domain — pure win evaluation (lifted out of `TabTicket.comprobar`)
```ts
// domain/payouts.ts
export interface PayoutTable {
  fijo: number; corrido: number; parle: number; candado: number;
  play4: number; cash3: number; box3: number; box4: number;
  pair: number; centena: number; q1: number; q2: number; q3: number;
}

// domain/ticketEvaluation.ts — ZERO I/O. Same rules as today, now testable.
import type { PayoutTable } from "./payouts";
export interface TicketOutcome {
  won: boolean; status: "ganador" | "no salió";
  premio: string | null; resultado: string; ganancia: number;
}
/** Pure: given a ticket, the official draw, and the payout table, decide outcome.
 *  Extracted verbatim from the legacy component so behavior is identical. */
export function evaluateTicket(t: Ticket, d: Draw, P: PayoutTable): TicketOutcome {
  const pad = (v: unknown, n: number) => String(v).padStart(n, "0");
  switch (t.tipo) {
    case "play4": {
      const p4 = pad(d.pick4, 4), won = t.play4 === p4;
      return outcome(won, won ? "4️⃣ PLAY 4" : null, p4, won ? +t.monto * P.play4 : 0);
    }
    case "box3": {
      const p3 = pad(d.pick3, 3);
      const won = sorted(p3) === sorted(pad(t.box3, 3));
      return outcome(won, won ? "🔀 CASH 3 BOX" : null, p3, won ? +t.monto * P.box3 : 0);
    }
    // …cash3 / box4 / pareja / centena / sb3 / sb4 / quiniela / bolita — 1:1 with legacy…
    default: return bolita(t, d, P);
  }
}
```
*Note: `evaluateTicket` is a **behavior-preserving extraction** — the win logic is
moved, not changed. With it isolated, the bet rules finally get unit tests.*

### 3b. Application — port + use-case (no `window`, no `fetch`)
```ts
// application/ports/StoragePort.ts
export interface StoragePort {
  get<T = unknown>(key: string, shared?: boolean): Promise<T | null>;
  set(key: string, value: unknown, shared?: boolean): Promise<void>;
}
// application/tickets.ts
export function makeTicketService(deps: {
  storage: StoragePort; draws: DrawsPort; payouts: () => Promise<PayoutTable>;
}) {
  return {
    async checkTickets(): Promise<{ wins: number; coinWin: number }> {
      const [tickets, live, P] = await Promise.all([
        deps.storage.get<Ticket[]>("tickets:mine") ?? [],
        deps.draws.fetchLiveDraws(),
        deps.payouts(),
      ]);
      let wins = 0, coinWin = 0;
      const next = (tickets ?? []).map(t => {
        if (t.status !== "pendiente") return t;
        const d = pickDraw(live.draws, t.board, t.date, t.session);
        if (!d) return t;
        const o = evaluateTicket(t, d, P);                 // ← pure domain call
        if (o.won && !t.coinPaid) { coinWin += o.ganancia; wins++; }
        return { ...t, ...o, coinPaid: o.won ? true : t.coinPaid };
      });
      await deps.storage.set("tickets:mine", next);
      return { wins, coinWin };
    },
  };
}
```

### 3c. Infrastructure — adapter implements the port (the only I/O)
```ts
// infrastructure/storage/webStorageAdapter.ts
import type { StoragePort } from "../../application/ports/StoragePort";
export const webStorageAdapter: StoragePort = {
  async get(key, shared) { try { const r = await window.storage.get(key, shared); return JSON.parse(r.value); } catch { return null; } },
  async set(key, value, shared) { await window.storage.set(key, JSON.stringify(value), shared); },
};
```

### 3d. UI — thin component, business-logic-free
```tsx
// ui/tabs/TabTicket.tsx  (only the check handler shown)
const { checkTickets } = useServices();         // injected from composition root
const comprobar = async () => {
  setChecking(true);
  try {
    const { wins, coinWin } = await checkTickets();   // ← no payout math in the view
    if (wins > 0) fireConfetti();
    setMsg(wins > 0 ? tf("tk.m_won", { n: wins, c: coinWin.toLocaleString() }) : t("tk.m_checked"));
  } catch { setMsg(t("tk.m_err")); }
  setChecking(false);
};
```

### 3e. Composition root — the single wiring point
```ts
// main.tsx
const storage = webStorageAdapter;
const draws   = httpDrawsAdapter;
const ai      = claudeAdapter;
const services = {
  coins:   makeCoinService({ storage }),
  tickets: makeTicketService({ storage, draws, payouts: () => getCoinsConfig(storage) }),
  hermes:  makeAiService({ ai }),
};
render(<ServicesProvider value={services}><App /></ServicesProvider>, root);
```

## 4. Explanation of Architectural Improvements
- **Separation of concerns:** payout/win rules move from a 600-line React component
  into pure `domain/ticketEvaluation.ts`. The view renders; the domain decides.
- **Dependency inversion / decoupling:** use-cases depend on `StoragePort`/`DrawsPort`
  interfaces, not `window.storage` or `/api`. Today the dependency points the wrong
  way (UI → concrete I/O); after, it points inward to abstractions. Swap storage,
  draw provider, or AI backend by changing one adapter.
- **Testability:** domain is pure (no mocks); use-cases take fake adapters. None of
  this is possible today because everything is one eval'd global scope.
- **Scalability for features:** a new game or bet type = a domain rule + a use-case +
  a UI component, with no risk to unrelated code; clear seams enable code-splitting
  (lazy-load tabs/games) and team parallelization.
- **Maintainability / onboarding:** the folder tree *is* the documentation — a new
  dev reads `domain/` to learn the rules and `ui/` to learn the screens, never
  hunting through a 270 KB blob.
- **API contracts preserved:** `api/*` and the `/api/db` storage protocol are
  untouched; only client-internal structure changes. External behavior is identical.

---

## Migration plan (strangler fig — no big-bang, behavior frozen)
1. **Step 0 — build pipeline.** Add esbuild/Vite producing a precompiled,
   content-hashed bundle; delete babel-standalone (also the P0 perf win). Output
   must render byte-for-byte the same app. *Verify in a real browser.*
2. **Add a test harness** (vitest) so every later step is guarded.
3. **Extract domain** (pure functions/data — lowest risk first): boards, charada,
   rng, dates, draw, payouts, `evaluateTicket`. Add unit tests pinning current
   behavior **before** moving the source.
4. **Define ports + wrap existing I/O** in adapters; route use-cases through them.
5. **Lift use-cases** (coins/games/tickets/draws/ai) out of components one tab at a
   time, re-verifying each tab in the browser.
6. **Thin the UI**; introduce the composition root.

> ⚠️ This is a working production app with **no test coverage and no browser
> verification available in this environment**. A blind big-bang rewrite would
> almost certainly violate the "do not alter behavior" constraint. The plan above
> lands the architecture incrementally, each slice verifiable and revertible.
