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

## Amendment 3 (2026-10-10, WP-0.11)
- **Prettier skips the port reference vectors, `tests/baselines/port/`.** They are machine-written baselines that
  `x port refs` lays out itself, one sample per line with exact numbers, and `checksums.json` pins every byte.
  Prettier would wrap each sample over several lines, respell numbers (`1e+21` as `1e21`) and so break the checksums,
  and re-read about 3.5 MB on every changed run of `npm run check`. `.prettierignore` lists the directory; `x port refs
  --check` and the `port` plugin of `x check` check it instead.

## Amendment 4 (2026-10-10, WP-0.10)
Calls made where §8.10 is silent, for the Claude Code hooks in `.claude/hooks/`:
- **The hooks are small scripts that read Claude Code's JSON on stdin**, so tests run them against fixtures
  (`tests/unit/hooks/`). SessionStart is bash, the port of my-3d2dge's hook; the other three are TypeScript run by
  Node's built-in type stripping (the container's Node 22.22 and Node 24.21 both run it), with no dependency, so the
  PreToolUse guard works before `npm ci`. The Stop hook reads the escalation records through tsx (`isOverdue`). The
  carried hook's `CLAUDE_CODE_REMOTE` guard and `CHROMIUM_PATH` line are dropped: setup.sh is idempotent, and the
  tools default to the container's Chromium (tools/lib/browser.ts).
- **SessionStart writes Node 24's `PATH` line itself** whenever Node 24 is active or cached, not only when setup.sh
  switches Node: the container's login shells put `/opt/node22` first, and Claude Code sources `$CLAUDE_ENV_FILE`
  after them. setup.sh's output goes to `out/hooks/session-start.log`, and `node_modules/.cache/` waits aside across
  its `npm ci`, as in `x ci --local` (measured: without that, the first `npm run check` of a session runs cold, and
  `x docs --check` alone fails on the cache paths the docs name). The hook prints at most 20 lines and always
  exits 0. After `/clear` or a compaction it skips setup.sh and `x deps --update --dry-run` and repeats `x src` and
  `x esc list --open`.
- **PreToolUse** also asks before a Bash command that writes `DOCTRINE.md` (a redirection into it, or a command
  other than a reader naming it, split as a shell splits it), and denies deleting `main` as well as force-pushing it.
- **Stop** blocks a red `npm run check` once; when Claude Code reports `stop_hook_active` it lets the turn end with
  a warning to the owner (`systemMessage`) instead of blocking again. Overdue escalations go into that warning, or
  into the reason when the check is red.
- **PostToolUse** returns ESLint warnings as context without failing, and fails (exit 2) when Prettier cannot parse
  the file. The allow list spells out the read-only git commands and the GitHub server's pull-request tools.

## Amendment 5 (2026-10-10, gate G0): T0's tools run in parallel

Measured at G0: `npm run check` took 10.0 s of its 10 s budget inside `x ci --local`, with its four tools run one
after another (`tsc` about 4.3 s, ESLint 1.4 s, Prettier 1.0 s, `x check` 1.9 s; incremental `tsc` saves time only
when nothing changed). `npm run check` is now `node tools/checkAll.ts`, which starts the four at once on the
container's 4 cores, prints each tool's output whole in a fixed order, and fails if any fails: 5.8 s. The tools,
their flags and their caches are unchanged.

## Amendment 6 (2026-10-10, WP-1.6): the inspector and the headless engine
Calls made where PLAN.md §8.3 and WP 1.6 are silent:
- **The kind lives in its own module.** `inspectorMember` (fields `help`, `args`, `impl`, `needs`, `value`), its
  checks, `defineMember`, signatures and `help()` lines are in engine/dev/members.ts; engine/dev/inspector.ts assembles
  `__engine` and registers the core members. One file would pass the 400-line cap, so WP 1.6's Owns gains
  engine/dev/members.ts (the WP entry says so).
- **Arguments are a schema in call order**: `args` is a schema.ts schema whose key order is the position. A call
  checks every argument before anything runs (`DEV_BAD_ARGS`, naming each problem and the signature) and passes them
  as given, uncopied: a capture restores its timers only as the object `capture()` returned (ADR-0006).
- **Calls, properties and namespaces.** `value: true` makes a property read without a call: `errors` and `advice`
  are arrays, as the page signal (`__engine.errors`, tests/e2e/fixtures.ts) reads them. A dotted name (`scene.dump`)
  is a call on a namespace object; a name is a member or a namespace, never both. `needs: 'renderer'` members exist
  headless and throw `DEV_NO_RENDERER`; WP 2.7 adds `view` to that field's values when it builds the view graph.
- **Members come from the shared registry**; the run's own registry (a test's) is what `describe()` lists. Layers
  below `dev/` register with `def('inspectorMember', …)` once engine/dev/members.ts has loaded (see the WP 3.3 note in
  the ledger).
- **The core members' semantics.** `step(n, intents)` takes one intents object for every step (its pressed buttons
  on the first only) or a list of one per step, and returns the tick; `seed(n)` starts the scene again with seed n,
  a new session and clock, keeping every setting that differs from a fresh start; `set` types a text value as `x set`
  does when the setting is not a string, and goes through the session, so non-view changes are recorded;
  `entities(query)` lists ids and component names, `get(id)` a copy of one entity (null when gone); `help(name)`
  gives one member with its arguments.
- **The headless engine** (`createHeadless`, engine/app/headless.ts) is async (Rapier's start will be, WP 3.1). It has
  a frame clock over the run's settings and no frames: `step(n)` hands the clock n single steps and runs what
  `advance` returns at once, inside the session. On a registry without the time settings it declares them (the clock
  reads them). The inspector holds only its members, so tools reach the run through `headlessHost(h)`: `x sim` reads
  the event trace and the recording there.
- **The help() check** (`x docs --check`, tools/lib/docsHelp.ts, §8.12) loads every module that registers a member,
  starts an empty scene headless and compares the names `help()` lists with the object's own (calls, properties,
  namespaces walked; getters never read). It runs in `x docs --check` and in T1 (engine/dev/inspector.test.ts), not
  in `x check`'s docs plugin: loading the modules added about 0.4 s to T0 and pushed `x check`'s own smoke test past
  its 5 s limit under the full suite's load.

## Amendment 7 (2026-10-10, WP-0.5, tooling lane): T0 and T1 within budget as the code grows
Measured unloaded on the 4-core platform (Node 24) at c203f16, with 30.9k lines of our TypeScript in 157 files:
`npm run check` took 7.0–7.4 s on every run, its slowest tool `tsc --noEmit` (6.0 s alone: parse 1.1 s, bind 0.6 s,
check 3.8 s, spread evenly over our files); `npm test` 43–45 s on Vitest's default 3 workers (134 CPU-seconds);
`npm run e2e` 17 s; `x ci --local` 80 s. On a copy of the repository at three times its size, `tsc --noEmit` alone
took 14.5 s, so T0 would have failed (15 s) by the end of the box stages. Calls:
- **T0's type check is `tsc -b tsconfig.check.json`** (`npm run typecheck`, and `tsc` in tools/checkAll.ts): three
  composite projects that emit declarations only, into node_modules/.cache/tsc/, over the options of
  tsconfig.base.json. tsconfig.engine.json holds engine/; tsconfig.apps.json the code that runs on the engine (labs/,
  fixtures/, tools/, tests/'s pages, specs, setup and helpers, .claude/hooks/, the root `*.config.ts`);
  tsconfig.tests.json every `*.test.ts`. `tsc -b` skips a project whose files and upstream declarations did not
  change, and its builder re-checks only the files a change reaches. tsconfig.json stays the whole repository as one
  program (`npx tsc --noEmit`, editors, Vite, Vitest, tsx, `x new`); tools/checkAll.test.ts checks that the projects
  hold its files, each in one project, with its options. A type error anywhere fails T0 (checked in a scratch copy:
  an error in each of 14 files across the three projects failed `npm run typecheck`).
  Measured, `tsc` alone / the whole `npm run check`: nothing changed 0.15 s / 3.4 s; an edit inside an engine function
  1.6 s / 3.9 s; a test edited 2.2 s / 4.0 s; a new export in tools/ 3.1 s / 4.7 s; a new export of
  engine/core/log.ts, which nearly every file reaches, 6.2 s / 7.9 s; cold 7.5 s. At three times the size: 0.16 s,
  1.7 s, 2.8 s for a leaf edit, 9.5–11.3 s for the hub edit, 12.6 s cold.
  Rejected, measured: `tsc --incremental --noEmit` (2.4 s unchanged, 6–7 s after most edits: without declarations a
  comment can change a file's signature); one composite project (3.6 s per edit at three times the size); five
  projects (sim side, presentation, content, tools, tests: each program resolves three.js's types again, 0.5–1 s
  more on hub edits and cold); `tsc -b` processes in parallel (1.5–1.8 s of startup each, on a chain of projects:
  longer than serial); `isolatedDeclarations` (an annotation on every export, no gain in tsc 5.9); a native type
  checker (does not qualify under Mastery yet).
- **package-lock.json is one of every project's files.** `tsc -b` decides "up to date" from a project's own files
  and never looks into node_modules: an edited Rapier `.d.ts` that breaks tests/unit/ts-smoke.test.ts passed it
  (exit 0). With the lockfile listed, a dependency change rebuilds every project, which then sees the changed
  declarations (exit 2); with nothing to re-check the rebuild costs 3 s, once.
- **Declarations need nameable export types**: tools/eslint's three plugin objects are annotated `ESLint.Plugin`.
- **A change to a declaration that every file reaches still re-checks nearly everything** (tsc invalidates every
  file that imports a changed declaration, directly or not), so T0's worst case grows with the code: about 8 s now,
  about 12–13 s at three times the size (over budget, under 1.5×). The next levers, when it surfaces: `x check`,
  already the slowest T0 tool after most edits (3.4 s: its docs plugin re-parses every module, 1.7 s, and loading
  the plugins takes 0.9 s), caching per file under node_modules/.cache/; and a faster type checker once one
  qualifies.
- **T1 runs one Vitest worker per core** (vite.config.ts `maxWorkers`): the tool tests wait on the node, tsx, git and
  ESLint children they spawn, and Vitest's default (cores − 1) left a core idle. 41 s → 36 s; five workers, 36 s.
- **Browser work is T2** (§8.2). tests/setup/harnesses.test.ts drove Chromium through a child Playwright Test (5.4
  s, 6 CPU-seconds); that half is now tests/e2e/adviceTrap.spec.ts, with the same assertions (shared with the
  Vitest half, which stays in T1, through tests/setup/trapOutcomes.ts). tiers.ts's `T2_FULL` names
  tests/setup/fixtures/, which the spec runs outside its imports, and `T1_FULL`/`T2_FULL` name tsconfig.base.json.
  WP 0.5's Verify runs the spec. T1 45 s → 35 s; T2 17 s → 19 s.
- Rejected for T1, measured: worker threads (no faster: 42 s on 4) and the VM pools (12 files fail); `isolate:
  false` (a quarter less CPU, 29 s, but test files then share module state, the shared registry among it, and a
  timing test failed). It is the lever to take when T1 nears 45 s, with a check that no test file leaves shared state
  behind.
