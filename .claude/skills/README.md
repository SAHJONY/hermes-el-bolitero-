# Project skills — vendored dev "superpowers"

These skills give every Claude Code session on this repo a shared development
methodology and review discipline. They are auto-discovered from
`.claude/skills/`.

## What's here & where it came from

| Skill | Source | What it does |
|-------|--------|--------------|
| `brainstorming` | superpowers | Tease out a real spec before coding |
| `writing-plans` | superpowers | Turn a spec into a clear implementation plan |
| `executing-plans` | superpowers | Work a plan task-by-task without drifting |
| `test-driven-development` | superpowers | Red/green TDD discipline |
| `systematic-debugging` | superpowers | Find root causes instead of guessing |
| `requesting-code-review` | superpowers | Dispatch a focused reviewer before merge |
| `receiving-code-review` | superpowers | Act on review feedback well |
| `verification-before-completion` | superpowers | Prove work is done before claiming it |
| `gstack-review` | gstack | Pre-landing design + a11y + code checklists |

## Attribution & license

Both upstreams are MIT-licensed and vendored here unmodified (except the
`gstack-review/SKILL.md` wrapper, which is original to this repo).

- **Superpowers** — © 2025 Jesse Vincent — https://github.com/obra/superpowers (MIT)
- **gstack** — © 2026 Garry Tan — https://github.com/garrytan/gstack (MIT)

The full gstack runtime (Bun/Supabase/iOS/deploy tooling) was intentionally **not**
vendored — only its review/design checklists, which are the parts relevant to a
static React PWA with no build step.

## Using this repo's gate

After any code change to `app/p1.txt`–`p4.txt` (the in-browser React app that is
concatenated and Babel-transpiled at runtime), always run:

```bash
npm run check
```

A syntax error in any part breaks the entire live app — `npm run check` replicates
the browser transform and fails loudly. This is the `verification-before-completion`
step for this project.
