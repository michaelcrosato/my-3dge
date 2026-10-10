# ADR-0016: Repo hygiene

Status: accepted · 2026-10-10 · Records PLAN.md §13.1, §11.1, I-32

## Decision
- No committed build output: `out/`, `dist/`, `.cache/`, `node_modules/` and `test-results/` are ignored.
- A lockfile (`package-lock.json`) and `npm ci`.
- The version lives in `package.json` only.
- `x ci --local` is the merge gate until GitHub Actions is enabled (§8.9).
- Pushes at milestones; one PR per stage, squash-merged (the only method the repository allows), its branch deleted
  (ADR-0021).

## Why
In my-3d2dge, 136 of 301 files were build output, and a version bump touched 10 places (I-32).

## Enforced by
`.gitignore`; `npm ci` in `scripts/setup.sh`; `x ci --local` (WP 0.9).
