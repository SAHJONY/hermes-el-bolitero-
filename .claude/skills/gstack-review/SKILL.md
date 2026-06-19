---
name: gstack-review
description: Use before merging frontend changes to catch accessibility, AI-slop, typography, spacing, and interaction-state issues. Pre-landing design + code review for the Hermes PWA.
---

# gstack-review (vendored from garrytan/gstack, MIT)

A lightweight pre-landing review pass for this repo. Two checklists adapted from
gstack's reviewer roles. Apply them to the **changed files** (read full files,
not just diff hunks).

## How to run

1. Get the diff scope:
   ```bash
   git diff --name-only origin/main...HEAD
   ```
2. If any `app/*.txt`, `*.html`, or CSS changed → run **`design-checklist.md`**.
3. For logic/security → run **`checklist.md`**.
4. Validate the app still transpiles after any fix:
   ```bash
   npm run check
   ```

## This repo's calibration

- **Design tokens** live in `app/p1.txt` → `const T` (Habana-nocturna palette).
  Colors/fonts in that palette are blessed — do not flag them as off-palette.
- The app is a **dense mobile PWA**: small caption/secondary text (10–12px) is an
  intentional pattern, not a typography bug. Flag only *body* text < 16px.
- No build step: a syntax error in any `app/pN.txt` breaks the whole app, so
  `npm run check` (Babel transpile gate) is mandatory before commit.
- Keyboard focus is provided globally via `.bol-app :focus-visible` — keep it.

See `checklist.md` and `design-checklist.md` for the full criteria.
