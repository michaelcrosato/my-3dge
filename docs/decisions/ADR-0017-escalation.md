# ADR-0017: The escalation protocol

Status: accepted · 2026-10-10 · Records PLAN.md §13.1, §8.14, DOCTRINE.md "Escalation"

## Decision
- **What needs the owner:** a binary asset other than a font; a new runtime dependency, or any dependency outside the
  rule of §6.10; a repository setting, secret, deploy or other outward action not pre-approved by ADR-0021; rewriting
  published history; spending money; a principle that cannot be met; going against the doctrine or the plan.
- **The 15-minute rule:** open the record, post it, wait up to 15 minutes while taking the doctrine's preferred
  alternative (never the action itself). With no answer: commit, decide, record the call, continue. For the rest of
  the run, or until the owner answers, further conflicts are reported and recorded without stopping.
- **The records:** `docs/escalations/ESC-NNNN-<slug>.md`, written by `node x esc` (WP 0.7), surfaced by the
  SessionStart hook, and linked from the ledger.
- Everything else is the agent's call, recorded as an ADR amendment (§11.4).

## Why
DOCTRINE.md: progress never stalls indefinitely; the worst case is a review, a change or a rollback.

## Enforced by
`x esc` and its `x check` plugin (an overdue open record fails); the Stop hook's warning (WP 0.10).
