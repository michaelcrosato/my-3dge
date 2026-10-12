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
