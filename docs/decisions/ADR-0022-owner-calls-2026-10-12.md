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
tools/lib/tiers.ts (`checkBudget`), tools/cmd/ci.ts, tools/cmd/perf.ts; AGENTS.md's "How to work"; the `verifier`.
