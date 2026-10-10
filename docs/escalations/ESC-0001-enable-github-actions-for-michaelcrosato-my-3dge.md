---
id: ESC-0001
title: "Enable GitHub Actions for michaelcrosato/my-3dge and grant the agent token the workflow scope, so WP 0.9 can write .github/workflows/ci.yml?"
status: decided-in-absence
principle: Escalation
raised: 2026-10-10T08:59:31Z
deadline: 2026-10-10T09:14:31Z
run: cse_019KbgvfqjBgQMExpEeFPy9t
options:
  - "Enable Actions and grant the workflow scope; the agent writes ci.yml running node x ci --local"
  - "Keep Actions off; x ci --local stays the only merge gate"
recommendation: 1
answer: null
call: "No answer in 15 minutes: Actions stays off, nothing is written under .github/workflows/, and node x ci --local remains the merge gate; the workflow and its unit test follow once the owner enables Actions and grants the workflow scope"
commit: a8970b0
followUp: null
---

# ESC-0001: Enable GitHub Actions for michaelcrosato/my-3dge and grant the agent token the workflow scope, so WP 0.9 can write .github/workflows/ci.yml?

A repository setting and a token scope are the owner's (PLAN.md §8.9, §11.5). Without the workflow scope GitHub rejects every push that holds a file under .github/workflows/, so nothing is written until then; meanwhile node x ci --local is the merge gate.

## Options

1. Enable Actions and grant the workflow scope; the agent writes ci.yml running node x ci --local (recommended)
2. Keep Actions off; x ci --local stays the only merge gate

## Log

- 2026-10-10T08:59:31Z: opened without waiting (--no-wait: an earlier escalation in this run timed out, or an ultracode lane) (run cse_019KbgvfqjBgQMExpEeFPy9t).
- 2026-10-10T09:14:46Z: decided in the owner's absence at a8970b0: No answer in 15 minutes: Actions stays off, nothing is written under .github/workflows/, and node x ci --local remains the merge gate; the workflow and its unit test follow once the owner enables Actions and grants the workflow scope.
