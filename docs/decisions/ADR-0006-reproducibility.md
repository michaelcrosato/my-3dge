# ADR-0006: The reproducibility contract

Status: accepted · 2026-10-10 · Records PLAN.md §13.1, §6.5, §4.7

## Decision
- Reproducibility is promised on the development platform only (Linux x64, Node 24, Chromium 141).
- Game code writes the standard `Math` and three.js's math. While the sim steps, the engine swaps in stdlib's fdlibm
  ports for the functions that differ between runtimes (`sin`, `cos`, `pow` today), so one golden hash per replay
  holds in Node and in Chromium. A drift test adds functions as runtimes change.
- An ordered world: entities in id order, spawns at step boundaries, Rapier bodies inserted in a fixed order.
- Physics is Rapier 0.21's SIMD build, whose restores continue exactly.
- The hash covers the bodies' state (translation, rotation, velocities) and everything `capture()` holds except
  Rapier's snapshot bytes.
- The proof matrix of §6.5: replays in Node and Chromium, in the rendering page, live play replayed in Node, and
  capture → restore → continue.

## Why
Doctrine Reproducible. V8's `Math.sin` and `Math.cos` differ by 1 ulp between Node and Chromium, and `pow` between
Node releases; float64 state fed back through them diverges (§4.7). The swap keeps game code familiar (doctrine:
Common ground) and the determinism under the hood.

## Enforced by
ESLint's sim-side bans (Appendix B); replay suites in Node and Chromium; capture and restore tests; the drift test.

## Amendment 1 (2026-10-10, WP-1.1)
No swap reaches an operator or an alias, so sim-side code calls the swapped functions by name. `**` and `**=` are
banned there: the operator computes with the runtime's own pow, which differs between Node releases (§4.7), and
`withSimMath` cannot replace it; write `Math.pow`. Names destructured from `Math` (`const { sin, cos } = Math`) and a
swapped function held in a variable (`const pw = Math.pow`) are banned too: made at module load, outside the sim, they
keep the native function. ESLint's `sim/no-restricted-syntax` enforces both (tools/eslint/simSide.ts, which reads the
swapped names from engine/core/simMath.ts, so a function that joins the swap is covered at once); the drift probe
hashes `**` beside `Math.pow` and names this ban if the operator drifts. The swapped `pow` is stdlib's port behind a
guard: where an argument is NaN, ±0 or ±Infinity, ECMAScript fixes the result exactly and the native function gives
it in every runtime, so the guard defers to it (stdlib gives NaN for `pow(NaN, 0)` and -0 for `pow(-0, 0.5)`); a
negative base with |y| ≥ 2^53, always an even power, is computed as `pow(-x, y)`, since stdlib's odd test fails there.
engine/core/simMath.test.ts checks both on the drift probe's edge pairs. PLAN.md §6.5 item 1, Appendix B and WP 1.1
say so.
