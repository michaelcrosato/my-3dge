# ADR-0018: The roadmap: box first

Status: accepted · 2026-10-10 · Records PLAN.md §13.1, §9.1

## Decision
- The Stress Box comes first, in six stages (Phases 2–7, gates G2–G7), after the foundation (G0) and the kernel
  (G1).
- Then the animation library (Phase 8) and audio (Phase 9), which may start earlier but never delay a box stage.
- Everything else is on demand: each WP starts only when its trigger is measured, and its ledger note records the
  measurement (§9.1).
- Production hardening (Phase H) waits until a game goes to production.

## Why
Doctrines North Star (solve problems when they surface) and Discovery first (most of the work is finding something
worth shipping).

## Enforced by
The roadmap (§9) and the ledger (§14), whose notes record each trigger; the `verifier` flags production-hardening work
outside Phase H, except ADR-0021's.
