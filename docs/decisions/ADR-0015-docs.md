# ADR-0015: Docs: the comment is the manual

Status: accepted · 2026-10-10 · Records PLAN.md §13.1, §6.8, §8.12

## Decision
- JSDoc file comments and export comments are the manual (§6.8).
- `docs/INDEX.md`, `docs/API.md` and `docs/ERRORS.md` are generated from them (`x docs --write`).
- Prose is never duplicated: a fact lives in one place.
- Pinned knowledge is the packages' own sources and types in `node_modules`, `docs/THREE-DELTA.md`, and the TSL
  reference as it stood for the pinned three.js.

## Why
Doctrine Agent-readable: docs generated from the code cannot drift, and agents read the pinned release's own sources
rather than their memory of another.

## Enforced by
`x docs --check` in T0 (WP 0.6); `eslint-plugin-jsdoc`'s file-overview rule (WP 0.4).
