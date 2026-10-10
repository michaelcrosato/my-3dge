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
