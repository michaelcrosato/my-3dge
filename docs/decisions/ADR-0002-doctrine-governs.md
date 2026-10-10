# ADR-0002: The doctrine governs

Status: accepted · 2026-10-10 · Records PLAN.md §13.1, §3, §8.10, §11.1

## Decision
- `DOCTRINE.md` governs everything here: the plan, the ADRs and AGENTS.md follow it. When the plan and the doctrine
  disagree, follow the doctrine and record the conflict (§11.4).
- Each principle has the rules and checks of §3, and is cited by name (Agent-readable, Agent-operable, Verifiable,
  Assets, Reproducible, WebGPU only, Common ground, Quality under the hood, Mastery, Discovery first), never by number.
- Agents change the doctrine only when the owner asks. A PreToolUse hook asks the owner to confirm each edit
  (WP 0.10).
- AGENTS.md and CLAUDE.md send every reader to `DOCTRINE.md` first.

## Why
A rule without a check is only a suggestion (§3); a doctrine agents could edit at will would not govern.

## Enforced by
§3's checks; the PreToolUse hook on `DOCTRINE.md` (WP 0.10); the `verifier`, which checks every deviation against an
escalation record or an owner's call (ADR-0017, ADR-0021).
