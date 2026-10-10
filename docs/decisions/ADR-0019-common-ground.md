# ADR-0019: Common ground for what game agents touch

Status: accepted · 2026-10-10 · Records PLAN.md §13.1, §3 (Common ground)

## Decision
- What game agents touch uses established tools, libraries and patterns: the toolchain (npm, TypeScript, Vite,
  Vitest, Playwright Test, ESLint, Prettier, tsx), the public API, the data formats (JSON, TSV, Markdown) and the
  `x` commands.
- The bespoke game-facing parts, each because nothing established does the job: the `x` commands (engine
  operations), the escalation log, the ID pass and look metrics, replays and hashing, content QA, the animation system
  being ported, and the local ESLint rules. Each says why in its file comment.
- Internals follow ADR-0020.
- Dependencies in `node_modules`, Rapier's inlined WASM included, are code, not source assets (doctrine: Assets).

## Why
Doctrine Common ground: lean into what agents already do well.

## Enforced by
The `verifier` asks of every public API "would a game agent recognize this?"; `node x deps --check` requires a reason
for every dependency.
