# ADR-0005: Time: a fixed 60 Hz step

Status: accepted · 2026-10-10 · Records PLAN.md §13.1, §6.4, WP 1.3, I-02

## Decision
- The sim steps at a fixed 60 Hz, at most 6 steps per frame, with an accumulator; the view interpolates between
  steps.
- The clock is injectable, so tests and replays drive time themselves.
- A timescale stack, a hit-stop budget and per-entity clocks shape time without breaking the fixed step.
- Gameplay time is counted in sim ticks.

## Why
Doctrine Reproducible: variable substeps made the prototype's play irreproducible and its rigs depend on the refresh
rate (I-02). A fixed step with recorded intents makes identical inputs give identical state.

## Enforced by
The time module's unit tests (WP 1.3); replay golden hashes (WP 1.5); ESLint's sim-side bans on
`requestAnimationFrame`, timers and `performance.now` (Appendix B).
