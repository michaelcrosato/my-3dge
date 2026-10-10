# ADR-0004: Coordinates and units: SI, right-handed, +Y up, +Z forward

Status: accepted · 2026-10-10 · Records PLAN.md §13.1, Appendix C, I-01

## Decision
- SI units throughout: metres, seconds, kilograms, radians.
- A right-handed frame with +Y up (x × y = z). Characters face +Z.
- One frame end to end: the sim, physics, animation, rendering and data all use it. No per-layer conversion.
- Converting from my-3d2dge (x east, y south, z up, 16 units per metre, left-handed) follows Appendix C:
  `new = (x, z, y) / 16`, yaw ψ = π/2 − φ, and the mocap (f, r, u) frame maps to (+Z, −X, +Y).

## Why
The prototype's `toThree` swaps, quaternion sign flips and left-handed engine frame were a constant source of bugs
(I-01). three.js and Rapier are both right-handed and +Y up, so agents' knowledge applies unchanged.

## Enforced by
Ported reference vectors and differential tests (WP 0.11, WP 3.4) prove the conversion; AGENTS.md's rule "SI units,
+Y up, characters face +Z".
