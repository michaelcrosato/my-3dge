# ADR-0014: Tooling: the standard toolchain behind npm scripts, `node x` for the rest

Status: accepted · 2026-10-10 · Records PLAN.md §13.1, §8.1, §8.2, §6.10

## Decision
- The standard tools run behind the npm scripts every agent expects (§8.1): Vite, Vitest, Playwright Test, ESLint,
  Prettier, and tsx under `node x`.
- One CLI, `node x <cmd>`, for what only this engine does: at most about 20 lines of output, a `report.json` with a
  fixed schema, exit codes 0, 1 and 2.
- Test tiers with time budgets (T0 < 10 s, T1 < 60 s, T2 < 6 min; §8.2); tests selected through Vite's module graph.
- Images are optional; numbers come first.
- Every capability is machine-operable (doctrine: Agent-operable).

## Why
Doctrine Common ground for the front door, and a bespoke CLI only where no standard tool fits (ADR-0019).

## Enforced by
The npm scripts and `x` commands themselves; each `x` command's smoke test; the tier budgets.

## Amendment 1 (2026-10-10, WP-0.1)
- **Scripts arrive with their tools.** WP 0.1 installs only TypeScript and Vitest, so `package.json` gets only
  `typecheck` (`tsc --noEmit`) and `test` (`vitest run`). A script whose tool is missing would fail, so the rest of
  §8.1 arrives with the WPs that install their tools: `dev`, `build` and `e2e` with WP 0.2, `lint`, `format` and
  `check` with WP 0.4. The WP 0.1 entry in PLAN.md says so.
- **`scripts/setup.sh` resolves the source checkouts.** WP 0.1's Verify reads `.cache/src-3d2dge` and
  `.cache/src-shardfall` right after `bash scripts/setup.sh`, so the script resolves both (the variable, else
  `git clone --shared` from the local clone, else GitHub; then `checkout --detach`). When `$CLAUDE_ENV_FILE` is set
  it appends `export MY3D2DGE_SRC=…` and `export SHARDFALL_SRC=…` along with Node's `PATH`, each line once. `x src`
  (WP 0.2) resolves the same way, so the SessionStart hook (WP 0.10) may call both.
