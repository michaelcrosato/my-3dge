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

## Amendment 2 (2026-10-10, WP-0.4)
- **Prettier checks code, data and the generated docs, not hand-written prose.** §3 said "Prettier formats every
  file", but DOCTRINE.md and `docs/research/` are frozen, and on PLAN.md, AGENTS.md, README.md and the ADRs Prettier
  re-pads every table and rewrites emphasis and lists (33 of 36 Markdown files fail `prettier --check` as written).
  `.prettierignore` therefore skips `*.md` except the generated `docs/INDEX.md`, `docs/API.md`, `docs/ERRORS.md` and
  `docs/escalations/README.md` (their generators emit Prettier-clean Markdown), and `package-lock.json` (npm's).
  `.gitignore`'s paths are skipped as well. Prettier's cache is its default, `node_modules/.cache/prettier/`;
  ESLint's goes to `node_modules/.cache/eslint/`, so neither writes to the repository root.
- **The ESLint rule families live in `tools/eslint/`, as TypeScript.** `eslint.config.js` stays short: the switches,
  typescript-eslint's recommended rules, the file-comment and size rules, then one call per family. The families
  (layers, public API, sim-side bans, banned three.js APIs) and the local rule are modules beside the plugin, checked
  by `tsc`, and loaded through tsx's `tsImport`, as `x.js` loads the commands.
- **Each family registers the core rules it uses under its own name** (`layer/no-restricted-imports`,
  `sim/no-restricted-globals`, `banned/no-restricted-syntax`): flat config keeps only the last options given to a rule
  for a file, so two families sharing `no-restricted-imports` would silently drop one list. The rule id in a report
  then names the family. The 600-line hard cap is `max-lines` registered again as `hard-cap/max-lines`.
- **A few bans beyond Appendix B, the same holes in other spellings:** sim-side, `setImmediate`,
  `requestIdleCallback`, `crypto`, `process`, `location`, Web Storage, `globalThis.<banned>` and `node:` imports;
  everywhere in engine, labs and fixtures, a bare `three` import (Node would load the WebGL build, §6.10),
  `three/examples/jsm/*` (the addons path is `three/addons/*`), and the r182 deprecations its source marks that the
  appendix leaves out (`PI2`, `fromWorkingColorSpace`, `toWorkingColorSpace`, `parseAnimation`).
