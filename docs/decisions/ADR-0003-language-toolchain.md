# ADR-0003: Language and toolchain: strict TypeScript 5.9.3

Status: accepted · 2026-10-10 · Records PLAN.md §13.1, §6.3, §6.10, §4.7

## Decision
- Strict TypeScript 5.9.3: ES modules, extensionless imports, erasable syntax only (no enums or namespaces).
- `tsc --noEmit` checks it with `moduleResolution: bundler` against the pinned types (`three`, `@types/three`,
  Rapier's own types, `@types/node`). `skipLibCheck` stays on for speed; the pinned declaration files also check clean
  without it (§4.7).
- Vite runs it in the browser; Vitest and tsx run it in Node. No build step for Node code.

## Why
Doctrines Common ground and Mastery: the language and tools agents know best, at the newest release compatible with
a qualifying one. Real types turn an old or misspelt API into an error before anything runs (I-31). Under `nodenext`,
Rapier 0.19.3's types silently became `any`; with `bundler` and Rapier 0.21 they stay real (§4.7).

## Enforced by
`tsconfig.json`; `npm run typecheck` (inside `npm run check` from WP 0.4); `tests/unit/ts-smoke.test.ts`, whose
`@ts-expect-error` on `world.createRigidBody(123)` fails `tsc` if Rapier's types degrade to `any`.
