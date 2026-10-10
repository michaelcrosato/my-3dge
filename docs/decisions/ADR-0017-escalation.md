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

## Amendment 1 (2026-10-10, WP-0.7)
Calls made where the plan is silent, and one rule eased for ultracode lanes:
- **The record.** Only `node x esc` writes it: the WP's fields in their order, one `key: value` per line, a string
  plain when YAML reads it back unchanged and JSON-quoted otherwise, `options` a list. tools/lib/escalations.ts reads
  that subset itself (a YAML package would be a new dependency, §6.10). Times are UTC to the second, `deadline` is
  exactly 15 minutes after `raised`, there are at least two options, and a call always names its commit.
  `principle` holds one or more of §3's short names, comma-separated, plus `Escalation`, `How to read this` and
  `North Star`; `--principle` takes them in any case and names the closest on a typo.
- **Statuses.** open → answered or decided-in-absence → closed. `answer` may follow a call (the owner answered late:
  the status becomes answered and the call stays recorded); `close` takes any status but closed (a question that
  became moot closes without an answer or a call). Each step appends a dated line to the record's log.
- **Flags.** `--no-wait` keeps the 15-minute deadline. It changes the message (the recommended option is taken at
  once, without stopping) and the log, and the agent records the call with `decide` before the deadline. `--run`
  defaults to `$X_RUN`, else the Claude Code session's id, else `local`; `--why` puts the reasoning in the body;
  `--follow-up` (on answer, decide and close) fills `followUp`.
- **The README** is rewritten by every subcommand that changes a record, and by `node x esc list --write`. `x docs
  --write` leaves it alone (WP 0.6's generator is not this WP's to change). It depends only on the records, never on
  the clock.
- **The `esc` plugin of `x check`** also fails on a duplicate id (two lanes took the same number: renumber the later
  one) and on a stale README. **In an ultracode lane**, an overdue record and a stale README are warnings: lanes never
  wait, and the integrator escalates once for the run, records the call and regenerates (§11.3). A malformed record
  still fails. Outside a linked worktree, `X_LANE=1` marks a lane, as for the docs drift.
