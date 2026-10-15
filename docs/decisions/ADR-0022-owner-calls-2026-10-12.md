# ADR-0022: The owner's calls of 2026-10-12: the testing budget

Status: accepted · 2026-10-12 · Amends PLAN.md §8.2 and WP 0.5's Done-when; AGENTS.md's "How to work"; the `verifier`

## Decision
my-3dge is a prototype with one user. Tokens and machine time go to finding what clearly helps, not to measuring
precisely how much.
1. **Cheap, objective checks verify:** deterministic suites, replay hashes, hard counts (pipelines, draw calls, bytes,
   errors). They may confirm even a small gain; nobody hunts for gains under 5%.
2. **Wall-clock time on this shared machine is noise, not proof.** A tier over its budget in `x ci --local`
   (`CI_BUDGET`) and a time over its budget in `x perf --budget` (the `…Ms` keys) warn and never fail; a count over
   its budget still fails. A time difference under 10% is neither a win nor a loss.
3. **Read results by confidence.** Clearly better: keep it. Clearly worse: drop it. Close or unclear after a cheap test:
   no proven benefit, so stop testing it, record it and move on (another approach, or the next WP). Never buy more
   precision, and never polish a losing bet with variations of it.
4. **Rank by return.** What to test first: (impact × confidence) / token cost. A test whose answer transfers (a
   principle) beats a one-off tweak. Before a test bigger than a few runs, state its estimated token cost and the
   decision it changes; after it, what it cost.
5. **Looks:** objective proxies first; agent judges only for large, obvious differences, few judges, many items per
   call. Fine visual judgment is the owner's, through a page that flips between the options.
6. **Reviews:** a full suite runs once per commit and reviewers read its report rather than run it again. A review
   fails on a red command, a Done-when bullet without evidence or a doctrine breach; anything else is an open issue,
   not another fix round.
7. **The owner reads every unclear call:** each is an open issue starting "Owner:" in the WP's ledger row, named in the
   session's report, so the owner can weigh in.

## Why
The owner's direction, given on 2026-10-12, after a measured audit of the runs on the owner's machine (about 540M
input-equivalent tokens): 37% went to review, fix and gate agents; agents launched about 290 full e2e runs and 60
`x ci --local` runs, many over unchanged trees; gate G6 failed on T2's wall-clock time at load averages of 13–76,
with three suites sharing the CPU.

## Enforced by
tools/lib/tierBudgets.ts (`checkGate`, since ADR-0023), tools/cmd/ci.ts, tools/cmd/perf.ts; AGENTS.md's "How to work"; the `verifier`.

## Amendment 1 (2026-10-12): the audit behind it, and how stage runs apply it
- **Measured** on the owner's machine from 2026-10-10 15:39 to 2026-10-12 (about 44 h; the planning and Phases 0–1
  ran in cloud sessions and are not counted): about 17,700 model calls (Opus 5.5), 16.0M output tokens, 98M new
  input and 3.55B cache reads, about 558M input-equivalent (cache reads 0.1×, cache writes 1.25×, output 5×).
  Building took 58%; gates 18%; WP reviews 12%; fixes after review 8%; merging 2%; orchestration 1.4%. By activity:
  reading code 43%, waiting on logs 13%, unit tests 10%, check, lint and docs 10%, git 8%, editing 5%, e2e and `x`
  tools 7%.
- **Spent without new information:** the same full suite on the same tree (about 290 full e2e and 60
  `x ci --local` launches); wall-clock budgets on a loaded machine (gate G6 failed on T2's time); open-ended review
  (WPs 7.4 and 8.4 took 13 review and fix agents each, about 30M tokens, 3.5× the mean WP's 8.5M); full suites in
  parallel (SwiftShader is CPU-bound, so three at once pushed the load average to 40–76 and doubled T2's time); fresh
  fix agents re-reading what the implementer knew.
- **How a stage run (PLAN.md §11.3) applies the budget:** one full suite at a time on the machine, once per commit,
  and reviewers read its report; at most two review rounds, then a triage agent sorts blocking from open issues;
  fixes go back to the implementer where the runner allows it; lanes run targeted specs with `npm test --
  --maxWorkers=4`, `npm run e2e -- --workers=2` and a unique PORT each (six lanes fit in 16 GB).
- **Runner traps** (Claude Code's Workflow tool): a resumed run replays only the longest unchanged prefix of its
  agent calls, so after any edited prompt every later agent runs live again; start a fresh run that skips the
  integrated WPs instead. A gate closer removes only its own gate worktrees (one removed every lane's). When project
  agents are not loaded, an agent takes the verifier's role by reading `.claude/agents/verifier.md`.

## Amendment 2 (2026-10-14, the owner's decision 3 of CLEANUP.md): T2's budget goes by machine size
- **Found:** T2's budget was a flat 9 minutes (`TIERS.T2.budgetMs`, 540,000 ms), measured on the owner's 20-core box
  with 4 workers. Since ADR-0014 amendment 15 the workers follow the cores (one per 4), so on the 4-core cloud
  container T2 runs on 1 worker and took 57 min 40 s at caff36a: every gate there warned `CI_BUDGET`, and `selectT2`,
  which runs T2 in full while its last full run fit the budget, never did.
- **Call (the owner's):** T2's budget goes by machine size, and no test is weakened. tools/lib/tiers.ts exports one
  worker count (`t2Workers(cores)`, which playwright.config.ts uses) and T2's budget from it (`t2Budget(cores)`,
  `T2_BUDGETS`): 9 minutes on 4 workers (from 16 cores), 60 minutes on 1 (4 cores: the 57 min 40 s measured). 2 and
  3 workers are unmeasured: they are held to 1 worker's budget and the message says so. Every tier's budget is a
  function of the cores (`TIERS[t].budgetMs(cores)`); `x ci --local` takes the core count from its deps (`CiDeps.cores`,
  `availableParallelism()`), so the tests never depend on the host.
- **Call (mine, PLAN.md §8.9):** within its budget `selectT2` runs T2 in full, so on 4 cores `x ci --local` runs the
  whole hour. That is what §8.9 intends: the gate runs every spec whenever the full set fits the machine's budget, and
  narrows only when T2 has outgrown it; the hour is measured there, as the 9 minutes are on 16 cores. An agent
  iterating still runs the specs its change selects (docs/TESTING.md).
- **Plan edit:** PLAN.md §1 item 8, I-27, §8.2's tier table, §8.9 and Appendix E's loop; AGENTS.md's loop; the x-loop
  skill; ADR-0014 amendments 14 and 15 point here.
- **Proved:** tools/lib/tiers.test.ts (`t2Workers` from 1 to 64 cores; `t2Budget` at 4, 8, 16 and 20 cores; T2's
  57 min 40 s within budget on 4 cores and over it on 16; `selectT2` running in full on 4 cores and narrowing on 16)
  and tools/cmd/ci.test.ts (the summary's budget column and budget line at 4 and 16 cores).

## Amendment 3 (2026-10-15, the owner's calls of ADR-0023): the full suite runs after the merge
- **Replaced:** decision 6's "a full suite runs once per commit" now reads once per merge, on GitHub after it, nobody
  waiting on it; reviewers read that run's report. Amendment 2's T2 budget by machine size and its selection in the
  gate are gone: the quick gate runs no T2, the full run all of it, and only the quick gate has a budget (five
  minutes, a warning). `t2Workers` stays: playwright.config.ts reads it.
- **Plan edit:** PLAN.md §1 item 8, I-27, §8.2's tier table, §8.9, §11.1 and Appendix E's loop.
