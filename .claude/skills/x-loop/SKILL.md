---
name: x-loop
description: The my-3dge work loop, edit → check → test → report. Which command to run after a change (npm run check, npm test, npm run e2e, node x …), how to read the report.json files instead of scrollback, and how to finish a work package (docs, ledger, commit). Use whenever you change code in this repository, or are unsure what to run next.
---

# The x loop

AGENTS.md ("The loop", "Done means") is the rule; this is how to run it. PLAN.md is about 440 KB: never read it
whole. `grep -n '^#### WP-<id> ' PLAN.md`, then read only the sections the entry cites.

## Before the first edit

- `node x deps --update`: adopt compatible releases first, in a commit of their own.
- Read the file comments (`@file`) of the modules you touch, not whole files. `node x help <cmd>` prints a command's
  manual; docs/INDEX.md lists every module, docs/API.md every export.

## After each edit

The PostToolUse hook runs Prettier, then ESLint, on the edited file. Exit 2 means: fix what it printed now. A banned
three.js API names its replacement (the `three-webgpu` skill).

## The tiers (PLAN.md §8.2; tools/lib/tiers.ts says what a change selects)

| Tier | Command | Budget | Notes |
|---|---|---|---|
| T0 | `npm run check` | 10 s | tsc, ESLint, Prettier, `node x check` (assets, deps, docs, escalations, port vectors) |
| T1 | `npm test` | 60 s | one area: `npm test -- <path>`; what a change reaches: `npx vitest related --run <files>` |
| T2 | `npm run e2e` | 6 min | run it as a background task; a lane sets its own `PORT` first |
| Gate | `node x ci --local` | | the merge gate: `npm ci`, `x src`, T0, T1, `x port refs --check`, `x new --test-all`, T2 (`--long` adds the long runs); a background task |

The Stop hook runs `npm run check` when you end a turn and sends you back once if it is red.

## Reading results

- Every `node x` command prints at most 20 lines, the verdict first, and writes `out/<cmd>/<target>/report.json`
  (the last one is also `out/latest.json`). Vitest writes `out/test/report.json`. Read those, not scrollback.
- A failure names its fix (`ID: message`). Exit codes: 0 pass, 1 fail, 2 usage error naming the closest choice.
- Open an image only when a metric points at one, and through the `visual-reviewer` subagent, which returns JSON.

## Finishing

1. Every new module has its `@file` comment, every export its doc comment; then `node x docs --write` and
   `node x docs --check`.
2. The WP's Verify commands exit 0, exactly as written, from the repository root; `npm run check` and `npm test`
   are green.
3. L-size WPs and every gate: the `verifier` subagent reviews the diff; fix or answer every finding.
4. A deviation from PLAN.md: an ADR amendment in docs/decisions/ and the WP entry edited, in the same commit.
   Owner approval needed: the `escalation` skill.
5. Update the WP's row in PLAN.md §14 (an ultracode lane reports it instead), then commit
   `<area>: <what> (WP-x.y)`. Report the commit, the report.json paths and any escalation ids.
