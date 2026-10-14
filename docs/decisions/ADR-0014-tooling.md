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

## Amendment 8 (2026-10-10, WP-0.1 platform, U-8 not triggered): the platform's Chromium outside the cloud container

- **What changed.** Sessions now also run on the owner's workstation (Ubuntu on WSL2, x64), which has no
  `/opt/pw-browsers/chromium`. The platform's browser stays the same release, Chromium 141.0.7390.37 (tools/deps.json),
  so every recorded golden, thumbnail and perf baseline keeps its meaning: U-8 (a new platform Chromium) does not fire.
- **How.** scripts/setup.sh fetches Chrome for Testing 141.0.7390.37 from Google's official bucket into
  `~/.cache/my3dge/` when neither `$CHROMIUM_PATH` nor the container's path exists, and tools/lib/browser.ts's
  `chromiumPath` resolves `$CHROMIUM_PATH`, else the container's path, else that cache. No shell state is needed, so
  ultracode lanes in their own worktrees resolve the same browser.
- **Measured.** WebGPU runs on SwiftShader there with shardfall's flags (`tests/e2e/harness.spec.ts`: adapter, exact
  pixels), and `x ci --local` on 652ea6b passed all seven steps in 31.4 s (T0 1.7 s, T1 11.9 s, T2 9.5 s).

## Amendment 9 (2026-10-10, WP-3.3): `__engine.input` gains `hold` and `state`

- **What changed.** `__engine.input` adds `hold(action, down)` and `state()` to the four members PLAN.md §8.3 lists
  (`press`, `axis`, `play`, `record`). Without `hold`, a button can be held only inside a script; `state()` lets an
  agent read what the virtual device holds. §8.3's Input row and WP 3.3's entry say so.
- **Headless.** `step(n)` does not read the virtual device: `input.play('N')` steps with it. The lane proposes that
  `step(n)` with no intents take the virtual device's intents (engine/app/headless.ts and the core `step` member), so
  `press('jump'); step(1)` works headless; left open for the core owner (ledger, WP 3.3).

## Amendment 10 (2026-10-10, WP-2.7): the box app's modules, its edits to other WPs' files, and APP_NO_VIEW
Calls made where PLAN.md §9 WP 2.7 and amendment 6 did not fit what the work needed:
- **The app and gfx code split into more modules** (doctrine: Agent-readable, 400 lines and one concept per file). WP 2.7's Owns named engine/app/{engine,loop,routes}.ts. The result is engine.ts 341 lines, headless.ts 300, tools/cmd/inspect.ts 378, tools/cmd/shot.ts 354 and engine/gfx/stage.ts 312, so folding any of these modules back in would pass 400. WP 2.7's Owns gains:
  - engine/app/view.ts: the run's view (stage and camera), built without a GPU and shared by the page and `createHeadless({ view: true })`;
  - engine/app/viewMembers.ts: the rendering members (`ready`, `render`, `shot`, `camera.get`, `camera.set`, `scene.dump`, `replay`). These are registered from their own module, not from engine/app/engine.ts as the WP's Build says, so that engine/app/headless.ts loads them in Node without engine.ts's renderer, DOM and device imports, and a page and Node list the same members;
  - engine/app/playback.ts: replays played a step at a time (the `replay` member, `?replay`, `x replay --browser page`);
  - engine/gfx/stage.ts: the presentation graph without a GPU (level meshes split into runs, one stand-in per placed entity, lights and ground);
  - engine/gfx/sceneDump.ts: `scene.dump`'s text format;
  - tools/lib/page.ts: the page helpers that `x inspect`, `x shot` and `x replay --browser page` share (waiting for ready or an error, finding the page for a scene module, playing replays in the scene's own page).
- **Edits to other WPs' files**, each the smallest change the Done-when needed:
  - tools/cmd/help.ts and tools/x.test.ts (WP 0.2): with WP 2.7's four new commands (set, eval, dump, inspect), `x help` lists 19 or more commands, which with its summary passes the 20-line output cap (MAX_LINES). Past the cap it now prints the names on a few lines and writes every command with its first sentence to out/help/all/commands.txt, which it reports as an artifact. Under the cap the output is unchanged. tools/x.test.ts accepts both forms.
  - tools/cmd/sim.ts and tools/cmd/sim.test.ts (WP 1.5, extended by WP 1.6): the Done-when runs `x sim` on labs/box/scenes/room.ts written without its `.ts` extension, the way imports name a module. `resolveSceneModule` now takes `<path>.ts` when `<path>` is given.
  - tests/baselines/thumbs/README.md (WP 2.6): one line for the `box-room-iso` case. The baseline file itself is WP 2.7's under §9.3.
  - tests/unit/hooks/settings.test.ts (WP 0.10): its skills list names stress-box, which WP 0.10's entry says WP 2.7 adds.
- **`APP_NO_VIEW` instead of `needs: 'view'`.** Amendment 6 said WP 2.7 would add `view` to the values of `needs`. That field and its check belong to WP 1.6 (engine/dev/members.ts, engine/dev/inspector.ts), and the check decides from a host flag (`host.renderer`). A view is `host.view`, which only the app's host (`AppHost`, engine/app/viewMembers.ts) has. So `camera.get`, `camera.set` and `scene.dump` throw `APP_NO_VIEW` themselves through one helper (`viewOf`), naming the member and the fix (`createHeadless({ scene, view: true })`), and the dev layer is left unchanged. For an agent the behaviour is the same: `help()` lists the members everywhere, and a call without a view is a coded error that names the fix. The cost is that `help()` does not add "(needs a view)" the way it adds "(needs a renderer)". A `needs: 'view'` value replaces the helper once a second module's members need a view.
- **A restore or a dev action snaps the view** (review round 3). createAppHost hands members `recordedRun(session)` with `restore` and `act` followed by `view.restarted()`, so the stand-ins snap to the world, with no interpolation from the places they had, as after a restart. engine/dev/members.ts is unchanged. engine/app/view.test.ts proves it.

## Amendment 11 (2026-10-11, WP-3.11): x film
Calls made where PLAN.md §9 WP 3.11 did not fit what the work needed:
- **WP 3.11 edits tests/unit/box-readme.test.ts (WP 2.7).** Its fixture used `node x film labs/box` as the example of a command that does not exist. Now that x film exists, the fixture misspells it as flim, a command that still does not exist. This is the smallest change that keeps the test's intent.
- **The step DSL works on sim steps through `__engine`** (step, shot, rec, press, hold, release, axis, cam, set) rather than filmstrip's wall-clock wait, keys and eval. The virtual clock holds the page still, so frames repeat exactly.
- **An empty `--compare` means `HEAD`.** parseArgs needs a value for `--compare`, so `--compare ''` films the base at `HEAD`.

## Amendment 12 (2026-10-11, WP-5.5): the stats meter's wiring and budget files
Core proposal accepted at integration. Calls made where PLAN.md §9 WP 5.5 and §8.3 did not fit what the work needed:
- **Registering `stats()` from engine/dev/stats.ts is not enough on its own.** The host had no step, phase or frame timings and no renderer counts, and nothing in a page loads dev/. WP 5.5 therefore also changes engine/sim/world.ts and engine/sim/scene.ts: createWorld and startScene take a `probe` that runs each system once, so the physics and anim phases can be timed. The probe never touches the sim, and the hash is unchanged. It also changes engine/app/headless.ts and engine/app/engine.ts: the run's meter times stepOnce and frameNow and reads gfx.stats() through Drawing.counts. The member checks in engine/app/viewMembers.test.ts and tests/e2e/box.spec.ts gain `stats()`, and the box-readme fixture's missing member becomes `fps()`.
- **Means, not medians.** Chromium's clock reads in 0.1 ms steps, so medians collapse onto that grid. `stats()` also adds `steps`, `frames` and `pipelinesAfterWarmUp`; it has no `gpuMs` yet (the timestamp-query WP adds it). `renderMs` is CPU time only.
- **Budget files** are named tests/baselines/perf/<scene id, ':' as '-'>.json, one per scene, with sections `node`, `page` and `ladder`. A value passes up to budget × (1 + tolerance). WP 5.7's budget file is therefore tests/baselines/perf/box-crowd-1000.json.
- **The ladder names its agent setting** (`--agents` or the budget's `ladder.setting`) instead of guessing it from the scene.

## Amendment 13 (2026-10-11, gate G3's review): cut output, x sim's directory, template next steps, x film's modules, __engine.anim
- When the dispatcher cuts a command's output, it writes every line to out/<cmd>/<target>/output.txt, names that file
  in the "… N more in" line and lists it in the report's artifacts. The report schema is unchanged. `x describe <kind>`
  prints the ids before the fields, and a list of ids too long for its line names describe.json.
- `x sim` writes run.replay.json, state.json and map.txt beside its report, in out/sim/<slug>/ (the scene id as a
  directory name: box:room → box-room), no longer in out/sim/<scene id>/.
- A template manifest may hold `next`, which `x new` prints after writing an entry, filled like the targets. The
  scene's names the replay steps, the README entry and parity.spec.ts's STAGES.
- x film's frame comparison and thumbnail baselines move to tools/lib/filmCompare.ts, and its contact sheet and font to
  tools/lib/filmSheet.ts (film.ts 588 → 351 lines, WP 3.11's recorded follow-up).
- `__engine.anim(id?)` (engine/app/animMember.ts) is WP 3.7's deferred member. It returns the actor's
  Animator.inspect() from an animator pool of its own, posed where the actor stands, and never touches the sim's
  animators.
(The lane proposed this as amendment 12; WP 5.5 had already taken that number, so it is 13.)

## Amendment 14 (2026-10-11, gate G6's review): T2's budget is 9 minutes

- **Measured:** gate G6's `x ci --local` failed CI_BUDGET: T2 took 14 min 16 s at load 13–15, against 6 min (it
  fails at 9). Its cause, a page's warm-up (566 pipelines in the hall), is fixed (ADR-0008 amendment 9): a box page
  is ready in 2–4 s again and draws a frame at its pre-WP-7.4 cost. The same 146 tests then took 10 min 16 s (`x ci
  --local` green at 73678bf), 10 min 46 s, 11 min 7 s and 12 min 1 s on 4 workers at load 13–80 from other lanes, and
  at load 85–100 one run lost Box 4's parity replay test to its 240 s timeout (it takes 186–188 s at load 13–60); the
  gate's tree without the fix took 16 min 57 s at load 23–75 in the same hour (summed test time: 3,030 and 3,470 s
  without the fix, 2,300–2,420 s with it).
- **What remains is content:** each box stage adds its CPU-only contract to parity.spec.ts (I-07, five tests a
  stage: its replays drawn a frame after every step, swept through every camera and resolution mode, with the GPU
  features off, live play, the ID pass), on SwiftShader, where a frame costs 14 ms in the room and 24 ms in the hall
  (the GPU process; the page's own frame work is 0.6–2.2 ms). parity.spec.ts alone is 1,500–1,600 s of the sum with
  the fix (2,000–2,250 s without), over 6 minutes on 4 workers. T2 grew from 114 tests at G4 (5 min 38 s) and 122
  at G5 (6 min 28 s, over budget) to 146.
- **Call:** T2's budget is 9 minutes (`TIERS.T2`, fails at 13 min 30 s): over it warns, as at G5; 6 minutes would fail
  every gate from here at this load. Rejected: drawing fewer frames or smaller ones in parity.spec.ts (the contract is
  a frame after every step), cheaper shadows (a look change to speed up tests), more Playwright workers (a shared
  setting; up to 6 lanes share the box's 20 cores). Box 6 (WP 7.8) adds its looks to parity.spec.ts: its gate
  measures again.
- **Plan edit:** T2's 6 minutes becomes 9 in PLAN.md §1 item 8, I-27 (§7), §8.2's tier table, §8.9 and Appendix E's
  loop, in AGENTS.md's loop and in the x-loop skill.

## Amendment 15 (2026-10-12, after gate G9): one Playwright worker per 4 cores

- **Measured** in a cloud container, the development platform of PLAN.md Appendix D (Linux x64, 4 cores, 16 GB):
  `x ci --local` at 42fbd4b ran T2 on `Math.min(4, cores)` = 4 workers, at load 13, in 39 min 12 s, and 9 of 165
  tests timed out: 8 in parity.spec.ts (the box's replays drawn as they step, past their 240 s) and the offline audio
  spatial test (past 60 s). Re-run on the same tree, 6 passed on 2 workers and 3 did not (Box 4's chase replay and
  camera sweep, the new-scene replay, which paired with each other); those 3 passed on 1 worker, Box 4's chase in
  165.5 s and its sweep in 144.3 s of their 240 s. SwiftShader draws on the CPU, so each Chromium needs several cores:
  four workers on four cores leave each about one, which the owner's 20-core box (amendment 14: 186–188 s at load
  13–60) never showed.
- **Call:** `workers` is one per 4 cores, from 1 to 4 (`CORES_PER_WORKER` in playwright.config.ts): 1 in the cloud
  container, 4 from 16 cores, so the owner's box keeps its 4. No test, timeout or assertion changes; a lane's
  `--workers` still overrides it (ADR-0022 amendment 1). T2 takes longer on 4 cores; its budget only warns (ADR-0022).
  Rejected: longer timeouts (they would hide a real slowdown), 2 workers on 4 cores (measured: 3 timeouts).
- **Plan edit:** PLAN.md WP 0.2's `playwright.config.ts` item.
- **Proved:** `x ci --local` green at caff36a in the cloud container, every step: T2 165/165 on 1 worker in
  57 min 40 s (over its 9 min, a warning only), 0 timeouts.

## Amendment 16 (2026-10-14, after G9's cleanup): the 17 files over 400 lines split at their second concept

- **Found:** 17 files over the 400-line warning (DOCTRINE.md 1; eslint.config.js's `max-lines`), none past the
  600-line cap: `npm run lint` listed them since the WPs that grew them.
- **Call:** each is split at its second concept, behaviour unchanged; each new file has its own file comment, and the
  WP that owns the old file owns the new one:
  - engine/anim: actions.ts → actions-data.ts (the kind `action`, its fields and `defineAction`/`loadActions`) and
    actions-check.ts (`actionCheck`, which plays `Actions` and so cannot sit with the data without a cycle), WP 8.7;
    secondary.ts → chain.ts (`Chain`, `Cape`, `CAPE`), WP 6.2; timeline.ts → attack.ts (`Attack`, `Combo`, their
    codes), WP 6.1; check.ts → stateMatrix.ts (the state matrix, `hashRun`, `rateDrift`, `SHEET_CAMERAS`), WP 6.6.
  - engine/app/engine.ts → drawing.ts (the page's frame, settle, warm-up and the rendering members' `Drawing`, over a
    `PageParts` object the engine fills as it starts), WP 2.7; engine/physics/world.ts → binding.ts (`physicsOf`,
    `bindPhysics`, `scenePhysics`, `attachPhysics`, `PHYSICS_NONE`), WP 3.1; engine/sim/world.ts → entityTable.ts
    (the live entities in id order), WP 1.4; engine/sim/scene.ts → session.ts (`createSession` and its four codes),
    WP 1.5; engine/gfx/post/chain.ts → settings.ts (`POST_CODES`, `POST_SETTINGS`, `definePostSettings`), WP 7.4.
  - tools: qa/anim.ts → qa/anim/metrics.ts (the motion metrics and `ANIM_QA`), WP 6.6; cmd/perf.ts →
    lib/perfBudget.ts (the budget files and the trend), cmd/sim.ts → lib/scenes.ts (scene lookup), WP 1.5;
    lib/tiers.ts → lib/tierBudgets.ts (the budget checks), WP 0.5; cmd/port.ts → lib/portVectors.ts (the builders),
    WP 0.11; cmd/ci.ts → lib/ciSummary.ts (`CI_OUT`, the summary and the result), WP 0.9.
  - tests/e2e: parity.spec.ts → parity-stages.ts (`STAGES`: a box replay joins a stage there), WP 2.7; post.spec.ts →
    post-box.spec.ts (the box drawing through the chain, its drawers' parts), WP 7.4.
- **Unchanged:** the public API (engine/index.ts, engine/sim-api.ts and engine/anim/api.ts export the same names, now
  from the new files), every code and its text, every test and replay golden in Node and Chromium.
- **Plan edit:** the Owns of WPs 0.5, 0.9, 0.11, 1.4, 1.5, 2.7, 3.1, 6.1, 6.2, 6.6, 7.4 and 8.7; WP 7.4's Verify adds
  post-box.spec.ts. labs/box/README.md, the stress-box skill, the scene template and docs/TESTING.md name
  parity-stages.ts for `STAGES`.
