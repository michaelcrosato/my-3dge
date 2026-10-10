# ADR-0020: Quality under the hood, behind a public API

Status: accepted · 2026-10-10 · Records PLAN.md §13.1, §3 (Quality under the hood), §6.1, §6.10 rule 7

## Decision
- Game code imports only `engine/index.ts` (pages) and `engine/sim-api.ts` (sim-side code).
- Every public export is documented, and every error names its fix in API terms, so game agents never need to read
  the internals.
- Behind that boundary, internals use the highest-quality approach their builder can execute well, newer releases
  included when a measurement on the platform shows better quality (§6.10, rule 7).

## Why
Doctrines Quality under the hood and Common ground: the engine is built once and used many times; its complexity
stays behind a familiar API.

## Enforced by
ESLint's public-API rule for game code (WP 0.4); `x docs --check` (every export documented, every error code with a
fix); the `verifier`.

## Amendment 1 (2026-10-10, WP-1.1)
three.js's `Color` joins the math classes `core/math` re-exports (§6.1's list; `THREE_MATH` in
tools/eslint/layers.ts, with a layer test). WP 1.1 asks for `color`'s sRGB ↔ linear conversion "over three.js's
`Color` where it fits", and `core/math.ts` is the one file outside `gfx/` that may import three.js, so the plan needs
`Color` there to be consistent. It lives in three.js's `src/math/`, agents know it, and going through it makes
`toLinear('#808080')` equal what a material holds for the same hex (engine/core/color.test.ts checks every reference
colour against `Color.set`). Nothing else from three.js's colour management (`ColorManagement`, the colour-space
constants) is allowed.
