# ADR-0010: Animation library: readable key poses

Status: accepted · 2026-10-10 · Records PLAN.md §13.1, §10

## Decision
- The stored format is readable key poses: format 1, extended as format 2 (§10.2).
- At load they are baked to rotation tracks that are also three.js `AnimationClip`s, so game code meets a familiar
  type.
- The CMU library comes on demand (`x anim cmu` fills `.cache/`; §13.2 Q10).

## Why
Doctrine Assets: text and data agents read and edit directly, never binary clips. Baking to `AnimationClip` keeps the
public API common ground.

## Enforced by
The library's tests and QA (WP 8.6); the asset scan in `x check`.
