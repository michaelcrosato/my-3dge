---
id: ESC-0004
title: "WP 12.2's agent-usability evals need model access for their live runs: a fresh agent attempts each of the 14 tasks under evals/ in a copy of the repository, with only its docs, and node x evals --run --agent \"<command>\" --record writes the baseline pass rate, the WP's deferred proof (PLAN.md §11.5, ADR-0025 §6). Will you grant model access for it, and in which form?"
status: decided-in-absence
principle: Escalation
raised: 2026-10-25T02:43:42Z
deadline: 2026-10-25T02:58:42Z
run: cse_0195aNNV9M5vZfaBJKsynNUv
options:
  - "Headless Claude Code in this environment: at a gate an agent runs node x evals --run --agent \"claude -p --permission-mode acceptEdits\" --record (14 attempts, each stopped after its task's 30 to 45 minutes)"
  - "An API key in the environment's secrets for a harness you choose, passed as --agent"
  - "No live runs for now: the dry run (node x evals --dry-run) stands and the baseline stays deferred"
recommendation: 1
answer: null
call: "No answer by the deadline (posted in the session's chat at 03:07 UTC, deadline 03:22): no live runs, which would spend the owner's model use. The dry run (node x evals --dry-run) stands: every task well-formed and its acceptance real with no model call; the baseline pass rate stays deferred until the owner grants model access (option 3). The owner's answer, when it comes, reopens the live runs."
commit: 9e8a14c
followUp: null
---

# ESC-0004: WP 12.2's agent-usability evals need model access for their live runs: a fresh agent attempts each of the 14 tasks under evals/ in a copy of the repository, with only its docs, and node x evals --run --agent "<command>" --record writes the baseline pass rate, the WP's deferred proof (PLAN.md §11.5, ADR-0025 §6). Will you grant model access for it, and in which form?

The dry run proves every task well-formed and its acceptance real with no model call; only a live run measures how well a fresh agent works from the docs, and the model use it spends is the owner's to grant.

## Options

1. Headless Claude Code in this environment: at a gate an agent runs node x evals --run --agent "claude -p --permission-mode acceptEdits" --record (14 attempts, each stopped after its task's 30 to 45 minutes) (recommended)
2. An API key in the environment's secrets for a harness you choose, passed as --agent
3. No live runs for now: the dry run (node x evals --dry-run) stands and the baseline stays deferred

## Log

- 2026-10-25T02:43:42Z: opened without waiting (--no-wait: an earlier escalation in this run timed out, or an ultracode lane) (run cse_0195aNNV9M5vZfaBJKsynNUv).
- 2026-10-25T06:12:28Z: decided in the owner's absence at 9e8a14c: No answer by the deadline (posted in the session's chat at 03:07 UTC, deadline 03:22): no live runs, which would spend the owner's model use. The dry run (node x evals --dry-run) stands: every task well-formed and its acceptance real with no model call; the baseline pass rate stays deferred until the owner grants model access (option 3). The owner's answer, when it comes, reopens the live runs.
