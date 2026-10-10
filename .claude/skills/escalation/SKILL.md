---
name: escalation
description: When and how to escalate to the owner in my-3dge — the cases that need the owner's approval (binary assets, new dependencies, repository settings, spending, a principle that cannot be met, going against the doctrine), the 15-minute rule, and the node x esc commands that record every escalation and every call made without an answer. Use before any such action, and when the SessionStart hook or the Stop hook names an open escalation.
---

# Escalation

DOCTRINE.md ("Escalation") is the rule; PLAN.md §8.14 and ADR-0017 detail it. The records are
`docs/escalations/ESC-NNNN-<slug>.md`, written only by `node x esc`; `docs/escalations/README.md` is generated.

## When

Escalate when an action needs the owner's approval, or a principle cannot be satisfied:

- a binary file other than a font (Assets); a new dependency, or one outside the version rule of PLAN.md §6.10;
- a repository setting, secret, token, deploy, publication or other outward action; rewriting published history;
- spending money (a paid service, API or plan);
- following one principle would break another, or cannot be done;
- going against the doctrine or the plan looks best: escalate with the reasoning, and keep to the doctrine meanwhile.

Pre-approved, no escalation (ADR-0021): pushes, opening and squash-merging the stage PRs, deleting their branches,
and the Vercel deploys they trigger. Everything else is your call, recorded as an ADR amendment (PLAN.md §11.4).

## How

1. `node x esc open "<question>" --principle <Name> --option "<a>" --option "<b>" --recommend 1 [--why "<reason>"]`.
   `--principle` takes the doctrine's short names (Assets, Mastery, Common ground…), comma-separated.
2. Post the printed message where the owner is watching: the session's chat, or the PR. In a Claude Code cloud
   session, schedule a check-in for the deadline (`send_later`) and end the turn; an answer resumes the session.
3. Never perform the action while waiting. Take the doctrine's preferred alternative instead: procedural or text
   instead of binary, the free path, a stub behind the feature registry.
4. The owner answers: `node x esc answer ESC-NNNN "<answer>"`, then act on it.
5. No answer by the deadline (15 minutes): commit the current work, decide, then
   `node x esc decide ESC-NNNN --call "<what was done and why>" --commit <sha>`, and continue.
6. For the rest of the run, or until the owner answers, report further conflicts without stopping: each still gets
   `node x esc open … --no-wait`, and a `decide` before its deadline.
7. `node x esc list --open` shows what still needs review; the owner closes a record (`node x esc close ESC-NNNN`).

## In an ultracode lane

Lanes never wait and never perform the action: `node x esc open … --no-wait`, take the preferred alternative, and
report the id to the integrator, who escalates once for the run and records the call. In a lane, an overdue record
is only a warning in `npm run check` (`X_LANE=1` forces lane mode in the main checkout).

## What enforces it

`npm run check` fails on an open record past its deadline with no call ("decide or answer ESC-NNNN"); the
SessionStart hook lists the open records; the Stop hook warns about overdue ones; the ledger note names each id and
each call made in the owner's absence.
