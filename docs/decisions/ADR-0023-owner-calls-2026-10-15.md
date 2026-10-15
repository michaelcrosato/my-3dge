# ADR-0023: The owner's calls of 2026-10-15: long tests never hold up work

Status: accepted · 2026-10-15 · Records PLAN.md §8.2, §8.9, §11.1, §11.5; amends ADR-0022 (decision 6, amendment 2)
and ADR-0016 (amendment 1's merge gate)

## Decision
1. **Long tests never hold up work.** Before every merge an agent runs the quick gate, `node x ci --local`: npm ci,
   x src, T0, T1 and x port refs --check. The full run, `node x ci --local --full` (the same, x new --test-all and T2
   in full, about an hour on 4 cores), runs where nobody waits on it: on GitHub after each merge to main
   (.github/workflows/ci.yml, one run per merge and none cancelled, so a failure names its merge) and by hand. While
   working, an agent runs browser specs only for what only they check that it touched, or a failure it is finding
   and fixing.
2. **Assume it passes; fix it when it fails.** `node x ci --status` reads main's last full run from GitHub. The
   SessionStart hook prints it, and a red main is fixed before other work. At the end of a goal or a stage the agent
   waits for main's full run and reports it: nobody is held up then.
3. **One budget:** the quick gate's steps together, five minutes (`GATE_BUDGET_MS`), a warning as ever (ADR-0022). T2
   and the long runs have none. This answers C1's Owner: issue (T0 and T1 over their fixed 10 s and 60 s on 4
   cores): those budgets are gone, with T2's by machine size (ADR-0022 amendment 2) and its selection in the gate.
4. **No branch protection** (PLAN.md §11.5): the workflow's `ci` check stays optional, and runs on pull requests no
   more.
5. **The `game/*` branches** were deleted on GitHub by the owner, on purpose (noted in docs/HANDOFF.md).
6. **Vercel is paused** by the owner from 2026-10-15 until they test. Until they say it is back on, agents skip the
   look at a PR's Vercel status and ignore Vercel's statuses and errors (AGENTS.md, PLAN.md §8.9 and §11.5).

## Why
The owner's direction of 2026-10-15: a ten-minute fix took about two and a half hours to merge, since the local gate
ran T2 in full (61 min 44 s on 4 cores at 8006e81) and the workflow then ran it again (74 minutes on PR #14's merge).
Tests that long belong where they slow nobody; when they run matters little, as long as nobody waits on them.
GitHub's runners cost nothing here (the repository is public) and are no faster (T2 took 65 min 44 s there): the time
saved comes from running the hour once, off the critical path. A merge now waits on the quick gate, a few minutes.
`x new --test-all` moved to the full run too (my call): with it the quick gate took 6 min 53 s at c2d1333, over the
owner's five minutes, and it took 2 min 33 s of them; without it, 4 min 19 s (3 min 3 s at 8006e81).

Accepted trade-off: a fault only T2 catches reaches main, and the Vercel preview, until the full run after its merge
names it. The leaks between suites that C1's full runs found are still found, an hour after the merge instead of
before it.

## Enforced by
tools/cmd/ci.ts (`CI_STEPS`' `full`, `FULL_ONLY`, `--status`), tools/lib/tierBudgets.ts (`GATE_BUDGET_MS`),
tools/lib/ciStatus.ts, .github/workflows/ci.yml and tools/cmd/ci-workflow.test.ts, .claude/hooks/session-start.sh,
AGENTS.md (the loop, merging, gates).
