---
name: x-loop
description: The my-3dge work loop, edit → check → test → report. Which command to run after a change (npm run check, npm test, npm run e2e, node x …), how to read the report.json files instead of scrollback, and how to finish a work package (docs, ledger, commit). Use whenever you change code in this repository, or are unsure what to run next.
---

# The x loop

AGENTS.md ("The loop", "Done means") is the rule; this is how to run it. PLAN.md is about 440 KB: never read it
whole. `grep -n '^#### WP-<id> ' PLAN.md`, then read only the sections the entry cites.

## Before the first edit

Read the file comments (`@file`) of the modules you touch, not whole files. `node x help <cmd>` prints a command's
manual; docs/INDEX.md lists every module, docs/API.md every export.

## After each edit

The PostToolUse hook runs Prettier, then ESLint, on the edited file. Exit 2 means: fix what it printed now. A banned
three.js API names its replacement (the `three-webgpu` skill).

## The tiers (PLAN.md §8.2; tools/lib/tiers.ts says what a change selects)

| Tier | Command | Budget | Notes |
|---|---|---|---|
| T0 | `npm run check` | | tsc, ESLint, Prettier, `node x check` (assets, deps, docs, escalations, port vectors) |
| T1 | `npm test` | | one area: `npm test -- <path>`; what a change reaches: `npx vitest related --run <files>` |
| T2 | `npm run e2e` | none: nobody waits on it | while working, only the specs for what only it checks, or a failure you are fixing (`npm run e2e -- <spec>`); a background task; a lane sets its own `PORT` first |
| Gate | `node x ci --local` | 5 min | the quick gate before every merge: `npm ci`, `x src`, T0, T1, `x port refs --check` |
| Full run | `node x ci --local --full` | none | the gate's steps, `x new --test-all` and T2 in full (`--long` adds the long runs): GitHub runs it after each merge; `node x ci --status` says how main's last one went (ADR-0023) |

The Stop hook runs `npm run check` when you end a turn and sends you back once if it is red.

## Reading results

- Every `node x` command prints at most 20 lines, the verdict first, and writes `out/<cmd>/<target>/report.json`
  (the last one is also `out/latest.json`). Vitest writes `out/test/report.json`. Read those, not scrollback.
- A failure names its fix (`ID: message`). Exit codes: 0 pass, 1 fail, 2 usage error naming the closest choice.
- Open an image only when a metric points at one, and through the `visual-reviewer` subagent, which returns JSON.

## Finishing

After a new `@file` comment or export doc: `node x docs --write`, then `node x docs --check`. The rest is AGENTS.md's
"Done means"; owner approval: the `escalation` skill.
