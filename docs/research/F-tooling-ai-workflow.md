# F. Tooling, testing, docs-as-interface and the AI-agent workflow (my-3d2dge → my-3dge)

Source: `/home/user/michaelcrosato/my-3d2dge` at `e37e4ee` (v0.14.0). The clone is shallow: one commit, a squash merge of PR #50. The CHANGELOG has 16 releases between 2026-09-27 and 2026-10-09.

**Method.** I read the source; nothing in the repo was modified. All measurements ran from the scratchpad on 4 cores with Node 22.22 and Chromium build 1194 (`CHROMIUM_PATH=/opt/pw-browsers/chromium`). Playwright 1.56.0 was installed only in the scratchpad. When I ran a tool, I ran a copy whose outputs went to the scratchpad. In the tables, "m" means measured and "est." means estimated from the code.

---

## 0. The ten findings that matter most

1. **The determinism and inspection machinery is the most valuable thing to carry over.** It has four parts: a virtual clock with a seeded RNG injected before page scripts (`tools/filmstrip.mjs:39-53`); hand-stepping of the sim (`g._step`, used in `tools/ed-balance.mjs:24-29`); a cross-backend state-hash proof (`src/lab3d/30-physics.js:121-135` and `tools/lab3d-test.mjs:114-120,153`); and a headless WebGPU "stand-in canvas" that reads frames back (`tools/lab3d-test.mjs:74-102`). I measured all four working in this container. Seeded filmstrips were byte-identical across runs. The 3D lab gave proof hash `1917b7b9` on both WebGL 2 and WebGPU via SwiftShader, and stress-world gave `68e1f7d1` on both.
2. **Every test runs in Chromium, even though the code doesn't need a browser.** The whole 374 KB engine loads in plain Node in **9 ms**. 600 Humanoid steps take **21 ms**. I ported the character-sheet motion lints to Node and ran them over all 24 engine moves in **0.28 s**. Rapier 0.19.3 (the SIMD compat build) initialises in Node in **106 ms**. A 40-body, 600-step world takes **~78 ms** and gives a stable hash. `three.core` and `three.webgpu` both import in Node. There are no Node unit tests, and the full suite takes about **25 minutes** (`CLAUDE.md:22`), run sequentially (`tools/test-run.mjs:87`).
3. **Real-time waiting is the slow and flaky part, and it gets worse in 3D.** In headless SwiftShader, stress-world takes **11.1 s to become ready on WebGL / 5.8 s on WebGPU** and renders at **~5 fps / <1 fps**. Tests that wait for N real frames (`stress-world-test.mjs` `frames()`) or for N milliseconds are inherently slow. Two suites rely on this most: `ed-controls-test` (24 `waitForTimeout`s) and `ed-codex-test` (21). The new engine must make `step(n)` and `render()` explicit and keep the render loop off in tests.
4. **Seeded `--compare` breaks in a non-obvious way.** `Math.random` is one global stream. Comparing the brawler kit with the full edition (same engine, same slice) gave **16 of 16 frames different** (1,864 to 3,284 px each). The backdrop was identical; every character had diverged, because other code consumed random numbers at startup. The new engine needs **named RNG streams**, and visual-only randomness must never feed the sim.
5. **Test selection is a hand-written prefix map, and it has holes.** `lab3d` inlines `src/mocap/*` and `src/emberdeep/22-char-dan.js` (`src/lab3d.template.html`), but its suite paths don't list them. As a result, `--files src/mocap/sets/cmu.js` skips `lab3d` (verified with `test-run.mjs --list --files`). The main agent-facing tools (`check.mjs`, `filmstrip.mjs`, `ed-sheet.mjs`) are covered by **no** suite. The "syntax" check that always runs parses only Emberdeep (`tools/ed-syntax.mjs`).
6. **Two copies of the engine.** The agent edition (`engine/my-3d2dge-agent.js`, 217 KB) is a hand port: **82%** of its substantive code lines are byte-identical to the full engine, and about 320 lines differ. The only parity checks are that API names are a subset and that its examples run (`tools/agent-test.mjs:160-183`).
7. **Build outputs are committed.** 136 of 301 tracked files are build outputs. Of 95 MB of tracked bytes, 81 MB is `examples/` (including the 68 MB CMU library) plus `dist/`. **19 committed files each hold a full engine copy.** A grep for an engine symbol returns 32 files, 20 of which are copies.
8. **No types, lint or formatter, and inconsistent style.** The engine has 212 prose `/** */` comments, 0 `@param`/`@typedef`, no `tsconfig`/`jsconfig`/eslint/prettier, and 61 lines over 300 characters (max 666). Four tools use a different style (tabs, double quotes, `node:assert`), apparently from a different agent. LAB-3D.md names the top risk: agents writing outdated three.js APIs (`docs/LAB-3D.md:67-70`). Today that risk is caught only by a regex ban list.
9. **The docs are duplicated, and they drift.** About 310 KB of prose: README, API.md, AI_GUIDE.md, the agent header, CHANGELOG and `docs/`. Each core fact is restated in about four places. Concrete drift: README says `npm test` is "rebuild, syntax, controls + developer browser regressions" (`README.md:255`), but it runs 14 suites. The "matches v0.14.0" stamp in the docs is rewritten by the version bump, not verified.
10. **No CI.** There is no `.github/`. The rule is "merge when `test:changed` passes, then run the full suite in the background and fix forward or revert" (`CLAUDE.md:21-22`), so main can be red. There is no lockfile (`--no-package-lock`), so Playwright floats (`^1.56.0`).

---

## 1. Inventory

### 1.1 Core infrastructure (all Node; no browser unless noted)

| Tool | Purpose / I/O | Asserts / key mechanism | Time |
|---|---|---|---|
| `tools/build.mjs` (8.7 KB) | Templates → `examples/*.html`, `dist/*.html`, `dist/kits/*`, `dist/my-3d2dge{,.min,-agent}.js` | Directives: `@inline-raw`, `@inline-parts` (folder joined in name order), `@inline-module` (one shared module scope), `@inline-head` (a file up to its second banner), `@inline` (`:80-101`). `{{VERSION}}`/`{{BUILD}}` substitution (`:73-75`). terser minify (`:61-70`). Byte-for-byte repeatable (`CLAUDE.md:8`) | est. 2-4 s |
| `tools/test-run.mjs` (7.3 KB) | `--all` / `--changed [--base]` / `--list [--files a,b]` | `SUITES` = [name, cmd, path prefixes] (`:14-29`). `EVERYTHING` = engine/, build, lockfile (`:31`). `IGNORE` = examples/, dist/, check-output/, CHANGELOG (`:33`). The changed set is merge-base diff + untracked (`:40-53`), minus version-only diffs (`:55-64`). Always builds first (`:91`). Sequential `spawnSync` (`:87`). Timing table (`:93-96`) | full ≈ 25 min (`CLAUDE.md:22`) |
| `tools/version.mjs` (4.5 KB) | print / `--check` / `X.Y.Z` | 8 regex `PLACES` (`:17-26`) + 2 built copies (`:28-31`) + a `## X.Y.Z` CHANGELOG section (`:35,43`). A bump writes every place and a changelog stub (`:46-58`) | m 0.1 s |
| `tools/stamp.mjs` (2.2 KB) | Vercel buildCommand | Replaces the `dev-build` placeholder in deployable html/js with `<sha7> <date>` (`:15-17,27-33`). The repo keeps the placeholder, so rebuilds stay byte-identical | <1 s |
| `tools/vendor-3d.mjs` (4.5 KB) | Fetch (`npm pack`) / `--check` | Pinned `LIBS` (three 0.182.0, Rapier simd-compat 0.19.3, `:15-22`). sha256 per file in `VERSION.json` (`:25-39`) | m 0.1 s (check) |
| `.claude/hooks/session-start.sh` | SessionStart | Remote-only (`:7-9`). `npm install --no-package-lock` (`:12`). Writes `CHROMIUM_PATH` to `$CLAUDE_ENV_FILE` (`:14-16`) | est. 3-10 s |
| `tools/labs-test.mjs` (6.5 KB; Playwright) | Labs page | Static server that emulates `vercel.json` rewrites (`:18-30`). Opens all ~61 links: status 200, no page errors (`:41-60`). File links exist (`:62-69`). "All labs" way back (`:71-83`). Phone portrait fill and buttons on screen (`:85-94`) | est. 1-2 min |

### 1.2 Visual-inspection tools (Playwright)

| Tool | Purpose / I/O | Asserts / key mechanism | Time |
|---|---|---|---|
| `tools/check.mjs` (8.9 KB) | `game.html[#scene] [--seconds] [--out]` → PNGs + `report.json` | Captures page errors, console errors and `my-3D2dge:` warnings separately, plus external requests (`:24-30`). Scripted play: Enter ×2, both key layouts (`:58-71`). Cycles views (`:72-77`). Numeric look metrics (`:41-50`). Exit 1 on error, error box, or blank (`:84-89,109`) | m 11.7 s / page |
| `tools/filmstrip.mjs` (11.4 KB) | `--steps "wait: press: down: up: rec:N:every eval:"`, `--crop --cols --scale --seed --compare` → contact-sheet PNG | `repeatable()` init script (`:39-53`). Recorder grabs the game's low-res buffer per tick (`:57-71`). A/B/diff rows (`:111-141`). Per-frame changed-pixel counts printed (`:144-148`) | m 3.4-3.7 s seeded; 6.4 s compare |
| `tools/ed-sheet.mjs` (13.8 KB) | `--character id` → PNG + JSON | Every state × view, a turnaround, game scale on every theme floor. Numeric lints (§2.8). Seeded RNG in-page (`:30`). Exit 1 only if nothing draws | m 1.8 s |
| `tools/anim-sheet.mjs` | Clip contact sheets (rows of frames) for cataloguing mocap | Plays the set file itself | est. 10-60 s |
| `tools/ed-codex-showcase.mjs` | Renders the rig for docs (`docs/assets/*.png/gif`, 1.2 MB committed) | Not a test | n/a |

### 1.3 3D suites (Playwright, SwiftShader WebGPU)

| Tool | Asserts | Time |
|---|---|---|
| `tools/lab3d-test.mjs` (12.7 KB) | Vendor checksums (`:24-25`). **BANNED API regexes** over the lab's own sources, comments stripped (`:28-43`). Import map points only at existing `/vendor/` files (`:44-50`). Opens `/lab-3d` on WebGL 2 and WebGPU. Proof hash repeatable and **equal across backends** (`:114-120,153`). The hero moves under keys (`:136-147`). 10 camera/look pictures per backend, with "blank" meaning PNG < 25,000 bytes (`:133`) | **m 65 s** (passed; 22 pictures) |
| `tools/stress-world-test.mjs` (19 KB) | Same rules and dual-backend proof. Fight: ≥3 kills of 36, launches happen, **no GPU pipeline compiled mid-fight or when the crowd grows** (`renderer._pipelines.caches.size`, `:126,136,153`). Physics: jump > 18 units, stairs to gallery, AI follows, crate knocked > 4. 12 cameras + 5 filters draw. Benchmark report shape | est. 3-6 min (ready 6-11 s/backend, m) |
| `tools/stress-test.mjs` (2D) | `?cam=` deep link, fixed camera, side view, Mode-7 depth (sprite shrinks and grows) | est. 15-25 s |

### 1.4 Agent edition, mocap, Emberdeep (brief; other agents cover their content)

- **`tools/agent-test.mjs`** (22 KB). (1) Extracts the ```` ```js <name> ```` blocks from the agent header and plays each on **both** engines (`:27-30,139-148`). (2) Runs a 70-line coverage scene that drives every option on both (`:33-100,151-158`). (3) Checks the agent API is a subset of the full engine's (`:160-183`). (4) Checks that paths named in the four "More" sections exist and that the documented clip recipe runs (`:185-227`). (5) Reports the manual's size in tokens (`:231-235`). Est. 45-90 s.
- **Mocap:** `anim-import.mjs`, `anim-set.mjs`, `asf-amc.mjs`, `cmu.mjs` (a `survey` takes ~10 min, `docs/MOCAP.md:166`), `mocap-lib.mjs`, `to-glb.py` (Blender/bpy), `mocap-test.mjs`, `ed-clips-test.mjs`. `mocap-lib.mjs:7-9` loads browser scripts into Node with `vm.runInNewContext`. That is precedent for Node-side tests, but it's used only by tools.
- **Emberdeep-only (14 of the 35 tools; not carried over):** `ed-controls-test` (694 lines; gamepad stub via `navigator.getGamepads` → `window.testPads` at `:18-23`; CDP touch at `:615`), `ed-codex-test`, `ed-character-test` (hand-steps `g._step(1/60)` with a `_frame()` every 6 steps at `:49`), `ed-tune-test` (every knob in range and documented with `about`/`where`, `:30-41`), `ed-clips-test`, `ed-smoke` (every scene and depths 1-20 with the autopilot), `ed-play` (step DSL incl. `aimfoe`, `shot:`, `log:`), `ed-balance` (autopilot, virtual clock, seeded), `ed-syntax`, `ed-build`, `slice-test`, `character-check`, `new-character`. ed-smoke, ed-play and ed-balance are not in `npm test`.
- **Sprawl metrics:** 35 tool files, 343 KB, and 26 npm scripts (`package.json:12-39`). Copy-paste: `chromium.launch` appears in 19 files. The Vercel-rewrite server is copied 4×. `standInCanvas` and `BANNED` are copied 2× each. mulberry32 is copied 3×. 14 tools have their own argument parser. Template inlining is reimplemented 4× (`build`, `ed-build`, `new-character`, `slice-test`), and the copies are partial.

---

## 2. The AI-native practices that work (mechanisms)

**2.1 Virtual time and seeded randomness (filmstrip).** `--seed N` installs `repeatable()` through `page.addInitScript` before any page script runs (`filmstrip.mjs:80`). It does the following (`:39-53`):
- `Math.random` becomes mulberry32 (`rnd += 0x6D2B79F5 …`).
- `performance.now` is redefined with `Object.defineProperty` to return a variable `now` that starts at 1000. `Date.now = 1.7e12 + now`.
- `requestAnimationFrame` pushes callbacks into a `due` Map, and `cancelAnimationFrame` deletes from it.
- `navigator.getGamepads → []`, so a real controller can't steer the run.
- `navigator.gpu → undefined`, because GPU lighting starts up on real time.
- `AudioContext = undefined`, because audio draws random numbers on real time.
- `__film.tick(n)` advances `now` by 1000/60 per tick, runs the due callbacks, then `onFrame` (the recorder).

`wait:600` becomes 36 synchronous ticks in one `evaluate` (`:85`). After the steps, ticks continue until the recording is full, capped at 3,600 (`:102`). Measured: two runs gave byte-identical PNGs.

Other places use the same idea:
- `ed-balance` turns rAF into a no-op, virtualises the clock, and runs `__step(n)` → `g._step(1/120)` with no drawing (`ed-balance.mjs:24-29`). That plays 30 game-seconds per `evaluate`.
- The engine exposes the hooks this needs: `_step(dt)` (`engine/my-3d2dge.js:1692`) and `_frame()` (`:1717`). Update runs in fixed ~1/120 s substeps.

Limits:
- Seeded mode turns off WebGPU and audio, so the GPU path never gets a deterministic visual test.
- One global RNG stream (see finding 4).
- `setTimeout` is not virtualised.

**2.2 `--compare` pixel diffs.** The same steps are recorded on page B. The sheet lays each frame out as A, then B, then A greyed with every differing RGBA pixel in magenta, labelled "N px differ" (`filmstrip.mjs:111-141`). The console lists the differing frames (`:144-148`). `--compare` implies `--seed 1`. The comparison is exact: there is no tolerance and no attribution of what moved.

**2.3 Look notes** (`check.mjs:41-50,94-104`) are computed on the game's low-res buffer in gameplay frames only:
- **colors:** colours quantised to 5 bits per channel, counted if they cover ≥0.1% of pixels. A note fires when there are fewer than 40.
- **flat:** the share of the most common colour. A note fires above 0.4.
- **checker:** the share of 2×2 windows that form a 1-px checkerboard. A note fires above 0.06.
- **spread:** luma (3R+6G+B)/10, P95 minus P5. A note fires below 70.
- **filled:** 1 minus the flat share. Under 0.06 is "almost empty". All played frames under 0.01 is an **error** (blank).

Each note names its fix, for example "fill it with an E.Backdrop…". These heuristics are 2D/pixel-art-specific. The pattern of numbers with a suggested fix carries over.

**2.4 State hashes and the renderer-independence proof.** `hashNumbers` is FNV-1a over the float32 bits of a list of numbers (`src/lab3d/00-setup.js:47-52`). `SIM.hash` covers the step count, hero position and facing, and every crate's translation and rotation (`30-physics.js:121-125`). `SIM.run(n)` resets and plays `SCRIPT(i)`, scripted inputs that walk, swing and dash (`:24-28,132-135`). The page computes the proof at startup (`60-panel.js:25-27`) and shows it. The test requires the hash to repeat and to be equal on WebGL 2 and WebGPU (`lab3d-test.mjs:119,153`). This turns principle 5 ("WebGPU never affects gameplay") into a test. The physics header states the rule outright: "Nothing here reads the renderer" (`30-physics.js:1-11`). Measured: lab-3d runs `run(600)` in ~40 ms; stress-world takes ~0.9-1.0 s.

**2.5 Headless WebGPU** (`lab3d-test.mjs:70-102`). Launch flags: `--enable-unsafe-webgpu --enable-features=Vulkan --use-vulkan=swiftshader --use-webgpu-adapter=swiftshader --disable-vulkan-surface`. Headless Chromium loses the device when it presents, so the harness patches `getContext('webgpu')` to return a fake context. Its `getCurrentTexture()` returns an offscreen `RENDER_ATTACHMENT|COPY_SRC` texture. rAF waits on `queue.onSubmittedWorkDone()`. `__readFrame(scale)` copies the texture to a mappable buffer, handles BGRA and the 256-byte row alignment, and returns a PNG. The page itself is unchanged. I checked the readback visually and it is correct.

**2.6 Static rules as tests.** The `BANNED` list (`lab3d-test.mjs:28-35`), applied per line with comments stripped, rejects: `WebGLRenderer`, `(Raw)ShaderMaterial`, `onBeforeCompile`, `EffectComposer`/addons, compute or storage buffers (WebGPU-only), and `readRenderTargetPixels|getImageData|readPixels` (nothing read back into gameplay). It also requires the import map to point only at existing vendored files.

**2.7 Performance as deterministic counters.** stress-world asserts that the GPU pipeline cache size doesn't change during a fight or when the crowd grows past the atlas pages the warm-up made (`stress-world-test.mjs:126,136,153`). This catches hitches without measuring milliseconds, which are meaningless in SwiftShader.

**2.8 Character sheet with numeric lints** (`ed-sheet.mjs:100-131`). Joints are measured relative to the body (`rig._w`), normalised by `size`, at 60 Hz, for each state from idle into the state and back to idle:
- **pop:** a joint step d[i] > 9 units **and** > 2.5 × max(d[i−1], d[i+1], 0.5). The spike rule, so a fast steady sweep of a long blade is not a pop.
- **foot slide:** summed horizontal foot travel while idle > 2 × size.
- **under floor:** `rig.z + joint.z < −1.5 × size`.
- **bone stretch:** max length > 1.12 × min across all states, using `rig.bones` or the Humanoid's 8 limb bones.
- **vanishing:** the smallest view's pixel count is under 50% of the largest view's.
- **palette:** fewer than 6 colours.
- **contrast:** under 50% of body pixels have |Δluma| ≥ 24 against each theme floor.

It writes PNG and JSON side by side, deterministic thanks to the in-page seeded RNG (`:30`). The lints are advisory: exit 0 (`:8-9`). The shipped `codex` has 3 standing pop lints (measured). docs/CHARACTERS.md:112 says "nothing left to look at that you did not choose", but no file records those choices.

**2.9 Contact sheets.** Two tools make them: filmstrip (frames over time) and `anim-sheet` (one clip per row). The idea is that a single screenshot hides broken animation and a strip shows it (`filmstrip.mjs:1-3`).

**2.10 Executable contracts returning plain sentences.** `checkRig(make)` (`src/emberdeep/18-characters.js:96`) runs a body through every state at two facings and checks four things: the required methods exist; joints are finite; facing and position follow the input state; hand, head and tip are world points within reach. It returns `{ ok, problems: ["strike: hand('R') is 94 units from its feet …"] }`, and it can be called from the console or a test.

**2.11 Changed-file test selection** (`test-run.mjs`). In order:
1. It fetches `origin/main` (with a 20 s timeout and offline fallback), takes the merge-base, and diffs committed, staged, unstaged and untracked files (`:40-53`).
2. It drops build outputs and the changelog (`:33`).
3. It drops files whose only change is a version number: each line's semver is normalised to `V`, then the sorted − and + lines are compared (`:55-64`).
4. A suite runs if a prefix in its path list matches a changed file (`:65-76`). `version` and `syntax` run always. A change to `engine/`, the build or the lockfile runs everything (`:31`).
5. `--list` prints each chosen suite with the reason; `--files` simulates a change (verified).

It works, but the map is hand-maintained (gaps in finding 5).

**2.12 Version consistency and build stamping.** One number (`package.json`), written into 8 source places and 2 built copies, plus a CHANGELOG section is required (`version.mjs:17-45`). At runtime the engine carries `E.version` and `E.build` (`engine/my-3d2dge.js:61`) and `E.versionLabel()` gives `v0.14.0 · a1b2c3d 2026-10-07` (`:63`). That label appears on the game's title screen, its Developer panel, the Labs page (`labs.template.html:85`), the mocap lab and the character sheet. `CLAUDE.md:17` requires reporting version plus commit, so every screenshot and report can be traced to a build.

**2.13 Labs page with dated temporary experiments.** `src/labs.json` (`$about` at `:2`) has sections for game, keep, demos and temporary. Temporary entries carry `added` (a date) and `question` (`:64-101`): delete the page and its entry once the question is settled. The template builds links that work both on the site (`/lab-3d`) and from disk (`examples/lab-3d.html`) (`labs.template.html:60-62`). It shows "preview" on Vercel branch hostnames (`:78-79`) and the build label (`:85`). `labs-test` opens every link.

**2.14 Warn-once engine advice.** `warn(key, msg)` adds `key` to a Set and logs `console.warn('my-3D2dge: ' + msg)` once (`engine/my-3d2dge.js:65-66`). There are 33 call sites, and each message names the fix (for example `unknown input preset "x" (use DEFAULT, PLATFORMER or SHMUP)`). Tools sort warnings by that prefix: `check.mjs:28` reports them; `ed-character-test.mjs:24` captures them, with an explicit exemption for "GPU lighting unavailable", and `:251` fails on them.

**2.15 On-screen error box and `game.errors`.** `E.showError` creates `#my3d2dge-error` (`role=alert`, click to hide) (`:1477-1488`). Global `error` and `unhandledrejection` listeners feed it (`:1489-1492`). The loop schedules rAF first, so one error never stops the game (`:1641`). Update and draw failures are caught separately (`:1646-1648`). `_fail` deduplicates by `where:message` and records `{ where, scene, message, stack }` (`:1683-1691`). Tests check `game.errors` and the box (`check.mjs:52,89`; `agent-test.mjs:118`). The 3D labs follow the same idea: `fail(e)` writes the reason on the page and in `window.__lab3d.error` (`src/lab3d/00-setup.js:36-41`). Tests wait for `ready || error`, so a crash at startup shows up as one line instead of a 90 s timeout.

**2.16 `window.__*` test APIs.**
- `__game` (starter, arena, stress, perspective lab), `__ed` (Emberdeep; ~70 exports including `checkRig`, `tuneSet`, `spawnMonster`, `bot`), `__mocap`, `__freeCam`, `__shapesCompare`.
- **`__lab3d`** `{ ready, backend, proof, run(n), state(), hash(), set(k,v), camera(code), frames }` (`60-panel.js:218-223`), documented in the file header (`:9`).
- **`__sw`** `{ step(n, {move, attack: every-N, jump, skill}), run, hash, setMonsters, placeHero, setView, setCam, STATS, benchStart, report… }` (`src/stress-world/60-panel.js:279-286`).
- Injected by tests: `__film`, `__step`, `__readFrame`.

They work well but differ from page to page.

**2.17 Scaffolding that passes its own tests.** `new:character` writes one file from a template that already passes `character:check` (`new-character.mjs:197-209`). `--test` (part of `npm test`) builds both templates into a scratch page and runs the character test on each, so the templates can't rot (`:178-195`). `character-check` is one command (syntax, build, test, sheet) that prints a short summary and says when to open the images (`character-check.mjs:16-28`).

**2.18 Docs as tests.** "The header is the manual": the agent header's ```` ```js ```` blocks are complete games that the test executes on both engines. The test also checks that pointer paths exist and measures the manual's token size (§1.4).

**2.19 Pinned, checksummed vendoring.** Versions are chosen on purpose because models know them well (`vendor-3d.mjs:3-4`; `LAB-3D.md:29`). They load through local import maps, with no network.

**2.20 CLAUDE.md** is short (29 lines). It covers: sources vs built files; never edit `vendor/`; versioning steps; the check sequence (`test:changed` before pushing); "look at what you changed" (screenshots, seeded filmstrip, `--compare`); fast checks while working.

---

## 3. Gaps and pain points (quantified)

1. **Wall time.** About 25 min for `npm test`, sequential (`test-run.mjs:87`), and every run rebuilds first (`:91`). The measured cost per invocation is mostly in the page, not the browser: Chromium launches in **157 ms**; 2D pages take 0.28-0.86 s to start; the 3D pages take 0.7-11 s to become ready; then come scripted real-time waits. The 4 cores are not used in parallel.
2. **No browserless tier**, although the code supports one (finding 2). Pure-logic checks currently run through Chromium. Examples: the mocap codec round trip `R.parse(lib.text(c))` and mirror∘mirror = identity (`mocap-test.mjs:48-54`), the fit thresholds, and checkRig's math.
3. **Two engine copies.** The agent edition is a hand-maintained 82%-identical fork (finding 6). Every fix may need porting by hand, and behavioural parity isn't tested beyond "examples run, coverage scene doesn't throw".
4. **Committed build outputs.** 136/301 files and 81 MB (finding 7). Vercel serves the repo root as-is: `installCommand: ""`, `buildCommand: node tools/stamp.mjs`, `outputDirectory: "."` (`vercel.json:4-6`). Each engine edit rewrites about 19 large files, which inflates PR diffs and history. The shallow pack is already 20.7 MiB for one commit. Search noise is 32 hits vs 12 (finding 7). There is no `.ignore`/`.rgignore`.
5. **The monolith.** `engine/my-3d2dge.js` is 374 KB, 4,652 lines and 24 banner sections. It can't be read in one `Read` (2,000-line default), so agents navigate by grepping section banners (the agent header tells them to: "grep `// ---- 10.`"). Dense style: 257 lines over 200 characters and 61 over 300. An edit inside a 600-character line rewrites the whole line, and its diff is opaque.
6. **No static analysis** (finding 8). The always-on "syntax" suite parses only Emberdeep through `vm.Script` (`ed-syntax.mjs:12`). It doesn't cover the engine, the 3D modules (which are ES modules with top-level await, so `Script` can't parse them) or the tools.
7. **Screenshots that need a model to look at them.** Some checks have no numeric form: "every camera draws" uses PNG byte size < 25,000 or 15,000 as the blank test (`lab3d-test.mjs:133`). Large images: the compare sheet I made was 5,156×2,980 and was shown to me downscaled to 2,000×1,156, which hides small diffs. Diffs aren't attributed (which object moved?).
8. **Sources of flakiness and slowness:**
   - real-time `waitForTimeout` (24, 21 and 15 in the three biggest Emberdeep suites);
   - "wait for N rendered frames" in 3D at 0-19 fps headless;
   - one global RNG stream (finding 4);
   - PNG-size heuristics;
   - fps-dependent paths (the stress-world benchmark "stops after its first step under 20 fps" headless);
   - floating dependency versions with no lockfile against a Chromium image (the hook exists precisely because of that mismatch, `session-start.sh:2-4`);
   - `git fetch` inside test selection;
   - the advisory-only lints.
9. **Tool sprawl** (§1.4 metrics). Each tool has its own argument parsing, launch code, server and output layout (`check-output/<x>`). Help exists only as header comments.
10. **Selection gaps** (finding 5). Not covered by any suite: check, filmstrip, ed-sheet, ed-play, ed-smoke, ed-balance, anim-sheet, stamp. A broken inspection tool would go unnoticed.
11. **Docs duplication and drift** (finding 9):
    - README is 34 KB, API.md 38 KB (~12.2k tokens), AI_GUIDE.md 33 KB, the agent header 26.6 KB, CHANGELOG 26 KB, and `docs/*.md` 147 KB.
    - `CLAUDE.md:3` tells agents to "Start with README.md", which is ~10k tokens mostly about the 2D engine and Emberdeep.
    - CHANGELOG bullets average 360 characters (max 962).
    - Only the agent header's examples and pointer paths are actually tested.
12. **Version churn blocks parallel agents.** Every merge edits the same 10 version locations and the top of the changelog (`CLAUDE.md:14-17`), so any two branches conflict. `versionOnly()` exists only to keep those edits from triggering suites.
13. **No CI gate.** "Merge as soon as `test:changed` passes … then run the full `npm test` in the background … fixed forward at once, or the merge reverted" (`CLAUDE.md:22`).

---

## 4. Session, CI and deploy setup today

- **Claude Code.** `.claude/settings.json` holds only the SessionStart hook: no permissions, no other hooks, no skills or subagents. The hook (`session-start.sh`) runs only when `CLAUDE_CODE_REMOTE=true`, runs `npm install --no-audit --no-fund --no-package-lock`, and exports `CHROMIUM_PATH=/opt/pw-browsers/chromium` through `$CLAUDE_ENV_FILE` if it isn't already set. Every browser tool calls `chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })`. In this container `CHROMIUM_PATH` was already set and `/opt/pw-browsers` holds chromium-1194 and the headless shell. Local sessions get nothing automatically.
- **Playwright** is used as a library (no `@playwright/test` runner), with `devDependencies` `playwright ^1.56.0` and `terser ^5.51.2`. There is no lockfile, although `test-run`'s `EVERYTHING` lists `package-lock.json`.
- **CI:** no `.github/` directory, so no GitHub Actions. PRs are squash-merged (#50 is in HEAD's title).
- **Vercel:** prebuilt static site from the repo root. `.vercelignore` drops `src/` and `tools/*` except `stamp.mjs`. `vendor/` and `docs/` are deployed. Rewrites map `/emberdeep`, `/lab-3d`, `/kits/:kit` and similar to `examples/` and `dist/` (`vercel.json:10-16`), with one permanent redirect (`/stress-3d`). Every branch gets a preview, which the Labs page detects by `-git-` in the hostname. The test servers emulate these rewrites, so routing is tested.

---

## 5. Recommendations for my-3dge (opinionated)

### 5.1 One CLI, one output contract
Put one entry point at `x.mjs` in the repo root (`node x <cmd>`; also `npm run x -- <cmd>`). It holds a command registry; each command is a module in `tools/cmd/*.mjs` whose header is its manual. `x help` and `x help <cmd>` are generated from the registry, so help can't go stale.

| Command | What it does |
|---|---|
| `x check [--files …]` | **Must stay under 10 s.** Parse everything, typecheck, lint rules (§5.10), docs drift, version, unit tests for touched modules. |
| `x test [--changed\|--all\|--suite s\|--grep g] [--backend webgl2\|webgpu\|both] [--workers 4] [--repeat 3]` | Runs suites. `--repeat` runs each one several times to catch nondeterminism. |
| `x unit` | Unit tests only. |
| `x sim <scene> [--steps --seed --script] [--json]` | Runs the simulation in Node: hash, trace, state dump. |
| `x replay <file\|dir> [--update] [--browser webgl2\|webgpu]` | Replays input logs against expected hashes. |
| `x shot` | Takes a screenshot. |
| `x film [--compare main]` | Records frames, optionally against main. |
| `x sheet <rig>` | Character/rig sheet. |
| `x golden` | Manages reference images. |
| `x perf` | Counters and timing against budgets. |
| `x dump` | Text dump of state and scene graph. |
| `x serve [--inspect]` | Static server with the deploy's routes. |
| `x eval "<js>"` | Evaluates against the `--inspect` session. |
| `x new <kind> <id>` | Scaffolds from a template. |
| `x lab add\|rm\|list` | Manages temporary experiments. |
| `x build`, `x stamp`, `x version`, `x release`, `x vendor [--check]`, `x docs [--check\|--write]` | Build, deploy stamp, release and maintenance. |

Rules for every command:
- Print at most about 20 lines: a verdict first, then failures as plain sentences with what was expected, what happened, where to look and the likely fix. The current tools already do this well.
- Always write `out/<cmd>/<target>/report.json` with this schema: `{ tool, version, build, args, ms, ok, failures:[{id,message,file?,line?,entity?}], warnings, metrics, artifacts:[{path,kind,describes}] }`. Also update `out/latest.json`.
- Exit codes: 0 pass, 1 fail, 2 usage.
- Move all shared code into `tools/lib/`: `args.mjs`, `browser.mjs` (launch flags, page setup, injected harness), `serve.mjs` (reads the deploy config once), `rng.mjs`, `hash.mjs`, `report.mjs`. That one move removes every duplicate listed in §1.4.

`x serve --inspect` keeps one headless page open, and `x eval`/`x shot`/`x dump` talk to it over a local port. Round trips drop from the 1-11 s page start to about 20-50 ms, which suits a tight edit-and-look loop.

### 5.2 Test tiers with time budgets (enforced by the runner)

| Tier | Runtime | Budget | Contents |
|---|---|---|---|
| T0 `x check` | Node | **< 10 s** | syntax, `tsc --noEmit`, lint rules, docs drift, unit tests of touched modules |
| T1 `x test` (Node) | Node `node --test` | **< 60 s** | math, rig/IK, animation sampling, mocap codec (round trip, mirror), procedural texture/mesh/audio generators, level parsing, AI, input mapping, Rapier sim + **replays → hashes**, motion lints |
| T2 browser | Playwright + SwiftShader, **both backends**, parallel workers | **< 6 min** | boot, dual-backend proof hashes, object-ID parity, thumbnails/goldens, perf counters, every lab/scene smoke, input (keyboard/gamepad/touch) |
| T3 nightly | CI | any | soak, long autopilot, benchmark trend, flake hunt (`--repeat 3`) |

The measurements above show T1 is realistic: it uses the same engine code, Rapier and three.core, all loaded in Node in milliseconds.

### 5.3 A determinism contract in the engine (so tools stay simple)
- The engine API: `await engine.ready`, then `engine.step(n = 1, input?)` (fixed dt, CPU only), then `engine.render()`. In `?test` mode `engine.loop(false)` is the default. Tests never wait for wall-clock frames; they step, then render once per capture.
- Only engine time exists in the sim. Lint the sim and gameplay directories (`sim/`, `anim/`, `game/`) to reject `Math.random`, `Date.now`, `performance.now`, `setTimeout`/`setInterval`, any import from `render/`, and any GPU readback. Use the import graph for these checks, not regexes alone. This generalises the lab3d `BANNED` idea.
- RNG: `engine.rng('ai' | 'loot' | 'fx' …)` gives named streams, each seeded by `hash(masterSeed, name)`. Render-side randomness (particles, noise) gets its own streams and never feeds the sim. Keep filmstrip's init script as a backstop for third-party code.
- `engine.hash()`: FNV-1a over canonical state in stable entity-id order. Hash the **float64** bits; float32 can mask early divergence. Also provide per-entity sub-hashes and `engine.trace(every)`, so a mismatch reports the **first divergent step and entity/field** instead of just two different hex strings.
- Caveat to verify: SIMD Rapier is deterministic for a given wasm binary and platform, and JS `Math.sin/exp` can differ across JS engines. Treat hashes as Chromium-only goldens. If cross-machine or cross-browser replay matters, test `@dimforge/rapier3d-deterministic-compat` for test runs.

### 5.4 Replays (input logs → state hash)
- Format `tests/replays/<name>.json`: `{ format:"my3dge-replay/1", scene, seed, dt, inputs:<per-step action bitmask + axes, run-length encoded>, expect:{ steps, hash, checkpoints:[{step, hash}] } }`.
- `x replay` runs them in Node (T1). It also runs them once per backend in the browser (T2), which proves the renderer has no influence, as the lab does today.
- `__engine.record()` turns a live playtest, by a human or the autopilot, into a regression test.
- When gameplay changes on purpose, `x replay --update` rewrites the expectations. The resulting diff shows exactly which replays changed, which is the review signal.

### 5.5 Rendering tests agents can trust without looking
- **Harness:** `tools/lib/browser.mjs` bundles the SwiftShader flags, the stand-in WebGPU canvas and `__readFrame` (verbatim from `lab3d-test.mjs:70-102`), and the virtual clock. It gives one `readFrame()` for both backends. Capture small frames (480×270 is enough) to keep SwiftShader cheap.
- **Object-ID pass** (the key 3D addition): override the materials with flat, unlit per-object colours, render with no antialiasing, read back, and count pixels per id. That yields `visible:[{id, name, px, bbox}]` for every capture. Agents get "the boss covers 0 px" or "the camera is inside a wall (one object covers 71%)" as text. Because ID images have no shading, **WebGL 2 and WebGPU must match exactly**, which gives an exact visual-parity test. Shaded output is then compared with a tolerance, so WebGPU-only enhancements remain allowed.
- **Goldens without binary files:**
  - (a) A "text thumbnail" per test case: the frame downsampled to 48×27 and stored as hex in JSON next to the test. It's tiny, readable as a coarse map, mergeable, and compared per cell with a tolerance.
  - (b) For pixel detail, `x film --compare main` builds `origin/main` in a temporary `git worktree` and renders it as the reference, so no PNG goldens need committing.
  - Diffs use a YIQ threshold (pixelmatch-style). The report includes the diff's bounding boxes and the ID-pass attribution, e.g. "93% of differing pixels are on `hero`".
- **Look metrics per frame (JSON):** coverage vs void, luma P5/P95 spread, dark and blown-out fractions, colour count, the share of the largest object, and whether the protagonist is visible. Port the "number plus suggested fix" style from `check.mjs`, with 3D-appropriate thresholds.
- **Images on demand:** contact sheets at most 1,600 px wide, with `--crop` (already in filmstrip), labels drawn on the frames, and boxes around differing regions. Delegate image review to a `visual-reviewer` subagent (§5.15) so image tokens stay out of the main context.

### 5.6 `window.__engine`: one inspector API on every page
| Area | API |
|---|---|
| Identity and health | `version`, `build`, `backend` (`webgpu`/`webgl2`), `ready`, `errors[]` (structured `{system, entity, step, message, stack}`), `advice[]` (warn-once records with stable codes) |
| Time | `pause()`, `step(n, input)`, `render()`, `run(script, n)`, `seed(n)` |
| State | `hash()`, `trace()`, `state()`, `entities(query)`, `get(id)`, `set(path, value)` (tunables with range, default, `about` and `where`: the `ed-tune-test` pattern) |
| Scene | `scene.dump({depth, filter})` returns a text tree (name, type, visible, position, bounds, material, triangles); `camera.get()/set(code)` (keep the `?cam=` codes and deep links) |
| Rendering | `stats()` → `{simMs, renderMs, drawCalls, triangles, pipelines, programs, textures, geometries}` from `renderer.info` and the pipeline cache |
| Capture | `capture({ids:true})` |
| Input | `input.press(action)`, `input.axis()`, `input.replay(log)`; gamepad and touch injection, porting the `ed-controls-test` stubs |
| Help | `help()`: lists the API with one-line descriptions (self-documenting) |

Keep the on-screen error box and `ready || error` signalling (§2.15). Advice gets codes (e.g. `A012 light-without-shadow-budget`), so tests can allowlist by code with a reason and fail on anything new. That's the ed-character-test behaviour, made explicit. Known-benign third-party warnings go on the same allowlist; for example, Rapier's init prints "Using deprecated parameters for the initialization function", observed in Node.

`x dump <scene> --step 300` prints the same information as text: camera; per-entity position, velocity, animation and health; and render counters. An agent can then check "did the crate move" without opening an image.

### 5.7 Numeric lints as T1 tests (browserless where possible), with baselines
- **Animation:**
  - Port `ed-sheet` exactly: the pop spike rule, idle foot slide, joints under the floor, 12% bone stretch.
  - Add for 3D: foot slide during planted phases of locomotion; loop-seam continuity; knee and elbow hyperextension and backward bends; root drift in in-place clips; NaN; mirror symmetry.
- **Geometry** (three.core in Node): NaN, degenerate triangles, inverted normals, open edges on closed parts, triangle budget per prop, bounds vs declared size.
- **Procedural textures:** palette, contrast, **tileability** (edge-seam error), banding.
- **Audio:** if synthesis is pure functions producing Float32Array, test in Node; otherwise use OfflineAudioContext in T2. Check peak ≤ 0 dBFS (no clipping), RMS range, DC offset, clicks (sample-jump spikes) and silence.
- **Baselines:** lints *fail* unless they're listed in `lints.baseline.json` with a reason. That captures the "did you choose this?" intent the repo states but doesn't enforce.

### 5.8 Performance budgets as tests
- Use deterministic counters per scene in `budgets.json`: draw calls, triangles, textures, geometries; **pipelines/programs compiled after warm-up = 0** (from stress-world); and memory counters returning to baseline after a scene unload (a leak check).
- Measure sim time per step in Node (p50/p95 over replays) against generous budgets, and append it to `out/perf-history.jsonl` for trends.
- Never pass or fail on headless fps (measured at 0-19 fps on SwiftShader). Real-GPU fps belongs only in the benchmark page's copyable report, kept from today.

### 5.9 Docs: the module header is the manual, checked for drift
- Modules are small ES modules, aiming for 600 lines or fewer and about 8k tokens each; `x check` warns past the soft cap.
- Each module's header (target about 1.5k tokens or less) has four parts: purpose; public API (signatures); invariants and rules; and runnable examples in ```` ```js test ```` fences.
- `x docs --check` verifies:
  - header API names equal the module's real exports (introspected by importing it in Node);
  - examples run (in Node, or in the browser for render modules);
  - referenced paths and `symbol` names resolve;
  - commands named in AGENTS.md exist in `x help`;
  - token budgets hold;
  - the generated `docs/INDEX.md` is current.
- `docs/INDEX.md` is generated, never hand-edited: one line per module (path, purpose, exports, size in tokens). Agents find code from this map, not from grep across copies.
- Hand-written prose is limited to: AGENTS.md (rules), ARCHITECTURE.md (one page), the per-module headers, and a short human README. Don't recreate the README / API / AI_GUIDE / agent-header quartet; carry over their content, especially the rules, common mistakes and checklists, into headers and skills.
- No version numbers in docs (see §5.13).

### 5.10 Types and static rules
- **TypeScript, erasable syntax only** (no enums, namespaces or parameter properties; `erasableSyntaxOnly`), checked by `tsc --noEmit --strict` against `@types/three` pinned to r182 and Rapier's bundled `.d.ts` (dev-only copies pinned alongside `vendor/`).
- Run without a build step:
  - Node 22.22 executes `.ts` directly (verified).
  - The dev server and build strip types with `module.stripTypeScriptTypes`, which replaces types with whitespace (verified), so browser stack traces keep the source line and column with no source maps.
  - This catches the documented top risk, outdated three.js API use (`LAB-3D.md:67-70`), at compile time instead of only through a regex list.
- Caveat: TSL node typings can be awkward. Allow a narrow `// @ts-expect-error <reason>` escape, counted and budgeted. Fallback if the team prefers plain JS: JSDoc plus `checkJs` (same checks, more verbose).
- Keep a lint layer of regex and import-graph rules:
  - the BANNED list, verbatim;
  - the determinism bans from §5.3;
  - no `fetch` or binary asset imports (principle 1);
  - nothing reads pixels back in gameplay code;
  - WebGPU-only APIs (`compute`, storage buffers) only inside `render/` behind a WebGL 2 fallback, and never in `sim/`.
- One formatter configuration (Biome or Prettier) with a line cap of about 140-160 characters, so styles stop diverging between agents.

### 5.11 Test selection by the import graph
- With ES modules, `x test --changed` computes each test's transitive import closure (static parse of `import` and `export … from`; the TypeScript compiler API is already available) and selects tests whose closure includes a changed file.
- A browser test's page entry is a module, so it is analysable too. That removes the hand map and its holes.
- Keep `test-run`'s strengths: `--list`/`--files`, the reason printed per suite, the timing table, and ignoring generated and changelog files.
- Add `tools/**` → that tool's self-test (every command has a fast smoke test, so the inspection tools can't silently rot), and run in parallel workers.

### 5.12 Scaffolding
`x new component|system|scene|rig|material|prop|lab|test <id>` generates files from templates that pass `x check` and their own generated test immediately, which is the `new-character` pattern. Each template's header lists the next steps. `x new --selftest` in T1/T2 instantiates every template in a temporary directory and runs its tests.

### 5.13 Repo hygiene, versioning and release
- **Don't commit build outputs.** Use `out/` for test artifacts and `site/` for the build, both gitignored. Vercel runs `node x build && node x stamp` with no dependencies. Generate large data elsewhere, or fetch it at build time, rather than committing 68 MB.
- **Commit a lockfile** and use `npm ci` in the hook and in CI. Pin Playwright exactly, and record the browser and SwiftShader versions in every report.json, since goldens depend on them.
- **Version in exactly one place** (`package.json`); the build injects it into `engine.version`. Keep `dev-build` → `<sha7> <date>` stamping (port `stamp.mjs`).
- **Changelog fragments**, `changes/<branch>.md` with `area:` front matter, so parallel agent branches never touch the same lines. `x release` (or a merge workflow on main) bumps the version and assembles CHANGELOG.md. Keep the area taxonomy, and cap bullets at about 200 characters.
- Keep `vendor/` with checksums (port `vendor-3d.mjs` verbatim). A PreToolUse hook blocks edits there.

### 5.14 Labs
Keep `labs.json`, the template and the link test almost verbatim. Add `expires` (or `decideBy`) and `issue` to temporary entries. `x check` warns when an entry passes its date and fails 14 days later. `x lab add <id> --question "…"` scaffolds a page and its entry; `x lab rm` deletes the page, the entry and its tests together.

### 5.15 AGENTS.md / CLAUDE.md and Claude Code configuration
**AGENTS.md** is canonical and tool-agnostic, about 120 lines or fewer. **CLAUDE.md** is `@AGENTS.md` plus Claude-specific notes. AGENTS.md covers:
- the five principles;
- the loop: edit → `x check` → `x test --changed` → read `report.json`, opening images only if needed → changelog fragment → report version, commit and artifact paths;
- each invariant **together with the check that enforces it** (a rule without a check is a suggestion);
- a pointer to `docs/INDEX.md`;
- a definition of done.

`.claude/settings.json`:
- **SessionStart:** `npm ci`, export `CHROMIUM_PATH`, warm the TypeScript incremental cache.
- **PostToolUse** on `Edit|Write|MultiEdit`: a fast per-file check (parse, lint, the rules from §5.10). On failure, exit 2 so the errors return to the agent immediately.
- **PreToolUse:** deny writes to `vendor/`, `out/` and `site/`; deny `git push --force` to main.
- **Stop:** run `x check` (T0, under 10 s). If it's red, exit 2 with a short reason, honouring `stop_hook_active` to avoid loops.
- **permissions.allow:** `Bash(node x *)`, `Bash(npm ci)`, and read-only git commands.

Skills (`.claude/skills/`), loaded on demand so CLAUDE.md stays small:
- `visual-qa`: how to capture, what each JSON metric means, thresholds;
- `three-r182-webgpu`: the idioms, the banned list and its replacements, WebGL 2 fallback rules, TSL patterns;
- `rapier-0.19`;
- `animation-qa`;
- `replay-debugging`: bisect a trace, read the per-entity hash diff;
- `perf-budgets`;
- `add-<kind>`, mirroring `x new`;
- `release`.

Subagents (`.claude/agents/`):
- `visual-reviewer`: given artifact paths and the intended change, views the images and returns a JSON verdict, keeping image tokens out of the main context;
- `suite-runner`: runs T2/T3 in the background and returns only failures, with paths;
- `api-checker`: verifies three.js and Rapier usage against the pinned types and sources.

### 5.16 CI and deploy
- **GitHub Actions `ci.yml`** on every PR, as a required check:
  - run in the `mcr.microsoft.com/playwright:v<locked>` image;
  - `npm ci`, then `x check`, then `x test --changed --base origin/main` (use `--all` while the suite is under about 8 min);
  - upload `out/**` (report.json, sheets, diffs) as artifacts;
  - write a summary to `$GITHUB_STEP_SUMMARY`.
  This replaces "merge, then run the full suite in the background".
- **`nightly.yml`:** T3, perf trends, and `--repeat 3` flake detection that opens issues.
- **Vercel:** builds from source, with a preview per PR. The Labs page keeps its build and "preview" labels.

### 5.17 Port vs rewrite

| Existing | Verdict |
|---|---|
| `test-run.mjs` | **Port the logic**: `--list`/`--files`, reasons, the timing table, version-only filtering. Replace `SUITES` with the import graph; add workers and JSON output. |
| `version.mjs` | **Port, simplified**: one place plus changelog fragments, and the `--check` idea. |
| `stamp.mjs`, `vendor-3d.mjs`, `session-start.sh` | **Verbatim**. Add lockfile and `npm ci` to the hook, and dev type packages to vendoring. |
| filmstrip's `repeatable()`, lab3d's `standInCanvas`/`__readFrame`/flags, `BANNED`, `hashNumbers`, the Vercel-rewrite server | **Verbatim into `tools/lib/`**. Hash float64 bits as well. |
| `filmstrip.mjs` (CLI, step DSL, A/B/diff sheet) | **Port**. The frame source becomes `engine.render()` plus `readFrame()` on both backends. Use named RNG, add a tolerance and ID attribution, and JSON output. |
| `labs.json`, `labs.template.html`, `labs-test.mjs` | **Near verbatim**, plus expiry. |
| `check.mjs` | **Rewrite for 3D**. Keep the concept: scripted play, every camera, look notes with suggested fixes, error box, external-request check, exit codes, report.json. |
| `ed-sheet.mjs` | **Split**. The motion lints move to Node (proven: 0.28 s for 24 moves). The sheet becomes 3D cameras × states. |
| `character-check`, `new-character` (with `--test`), `ed-play` DSL, `ed-balance` autopilot plus virtual clock, `ed-smoke` | **Port the patterns** to `x sheet`, `x new`, `x run --steps`, the autopilot and smoke tests. |
| `agent-test.mjs` | Drop the second engine copy and its parity checks. **Keep** doctest extraction, pointer-path checks and token counting inside `x docs --check`. |
| `ed-syntax`, `slice-test`, `ed-build`, `build.mjs` inlining directives | **Replace** with `tsc`/parse over everything, plus ES modules and import maps. Bundle to one file only if a single-file distribution is wanted, and then generate and test it, never hand-port it. |

### 5.18 Suggested order of work (tooling milestones)
1. `x` skeleton with `args`/`report`/`browser`/`serve` libs, `x check` (parse, `tsc`, rules) and `x unit`, plus AGENTS.md and the hooks.
2. In the engine: `ready`/`step`/`render`/`hash`/`trace`, named RNG and `window.__engine`, then `x sim` and `x replay`, ported from the lab3d proof.
3. Browser harness on both backends: `x shot` with the ID pass and look metrics, `x film --compare main`, text thumbnails, dual-backend proof and ID parity.
4. Motion, geometry, texture and audio lints with baselines; `x sheet`.
5. `x docs --check` with the generated INDEX; import-graph selection; `x new` with self-tests.
6. GitHub Actions CI and nightly; Vercel building from source; labs with expiry.

**Target:** `x check` under 10 s, a typical `x test --changed` under 2 min, and full T2 under 6 min on 4 cores, against 25 min today. Every visual verdict should be available as JSON before anyone has to open an image.
