# my-3dge: the engine plan

**What this is.** This is the plan for building **my-3dge**, a fully 3D web game engine written and maintained only by AI coding agents. The engine is built around one target, the **Stress Box**: the prototype's *Stress test: 3D world* (`src/stress-world/` in [my-3d2dge](https://github.com/michaelcrosato/my-3d2dge)), rebuilt from the ground up in stages. It starts as a small room and grows until it does what the stress test does. The plan says:

- what the Stress Box needs at each stage, and which engine systems each stage adds (§9);
- what to carry over from my-3d2dge, and how (copy, port, rewrite or drop), including the animation library (§5, §10);
- every improvement to make along the way (§7);
- the order of work, broken into packages an agent can execute and verify on its own (§9, §11).

**The doctrine governs.** [`DOCTRINE.md`](DOCTRINE.md) is the owner's doctrine for this engine. Where this plan and the doctrine disagree, the doctrine wins. §3 turns each of its principles into checks.

**The game is out of scope.** It will be built later, in its own place, on top of the finished engine. The Stress Box is a test scene and benchmark, not a game.

| | |
|---|---|
| Source studied | `michaelcrosato/my-3d2dge` v0.14.0, commit `e37e4ee` (2026-10-08) |
| Plan date | 2026-10-09. Re-based the same day on the Stress Box and the doctrine, then on the doctrine's new principle 7 (Common ground) and its amended Mastery rule |
| Governing doctrine | [`DOCTRINE.md`](DOCTRINE.md) |
| Supporting research | [`docs/research/`](docs/research/): eight studies of the source with `path:line` evidence. This plan is canonical where they differ |
| Audience | AI coding agents running at **extra-high effort** (one agent, sequential) or as an **ultracode** multi-agent workflow (parallel lanes) |
| Status | Plan only. Nothing in this repository is built yet. The status ledger is §14 |
| How to use it | Read `DOCTRINE.md`, then §1–§3 and §9.0 once. For each work package (WP), read only its entry in §9, the sections it cites and the file comments of the modules involved (§11.1). Tick the ledger in §14 when the package's checks pass |

---

## Contents

1. [Summary](#1-summary)
2. [Goals, non-goals and the scope rule](#2-goals-non-goals-and-the-scope-rule)
3. [The doctrine, made enforceable](#3-the-doctrine-made-enforceable)
4. [What we found in my-3d2dge](#4-what-we-found-in-my-3d2dge)
5. [Carry-over inventory: keep, port, rewrite, drop](#5-carry-over-inventory-keep-port-rewrite-drop)
6. [Target architecture](#6-target-architecture)
7. [Improvements over the prototype](#7-improvements-over-the-prototype)
8. [Tooling and testing: how agents see and prove their work](#8-tooling-and-testing-how-agents-see-and-prove-their-work)
9. [Roadmap: the Stress Box, stage by stage](#9-roadmap-the-stress-box-stage-by-stage)
10. [Animation library migration, in detail](#10-animation-library-migration-in-detail)
11. [Running this plan: extra effort or ultracode](#11-running-this-plan-extra-effort-or-ultracode)
12. [Risk register](#12-risk-register)
13. [Decisions and open questions](#13-decisions-and-open-questions)
14. [Status ledger](#14-status-ledger)
15. [Appendices](#appendices): source-to-target map, banned APIs, conventions and conversions, measured numbers, AGENTS.md draft, glossary

---

## 1. Summary

### The anchor: the Stress Box

The prototype's **Stress test: 3D world** is the most complete real-3D code my-3d2dge has: 9 files, 2,574 lines (§4.1). It is a torch-lit stone hall written as ASCII text, with pillars, low walls, two galleries with stairs and a raised rune dais. A hero walks, dashes and jumps on a Rapier character controller. Zero to 5,000 monsters are Rapier bodies that chase the hero up the stairs, pile up, and fly when hit hard. Crates and barrels get knocked about. It has cameras from the classic views to chase, first person and fly, cel, pixel, bloom and FXAA filters, a benchmark, and a scripted proof run whose state hash is the same on WebGPU and WebGL 2.

It is not an engine: one shared scope across 9 files, a simulation that cannot run without the renderer, a loop that is not fixed-step, and tuning numbers scattered through the code.

**The plan rebuilds it from the ground up as the Stress Box**, in six stages. Each stage ends with a box that runs, is measured, and is proved by commands, with no display:

| Stage | The box can… | Engine systems it brings |
|---|---|---|
| Box 1 | render a small room and step it, headless and in the browser | renderer, level compiler, materials, textures, geometry, cameras, shots and the ID pass, the app shell, the inspector |
| Box 2 | let a hero walk, dash and jump | Rapier, the character controller, input, the rotation skeleton, IK, the humanoid port, the animator, puppets, chase and first-person cameras, film |
| Box 3 | become the hall: stairs, galleries, a dais, crates and barrels | bodies, level compiler v2, navigation, level meshes and cutaway, props |
| Box 4 | fill with a crowd of 100 to 5,000 | crowd bodies, steering, blob and floater rigs, crowd rendering, performance counters, a bot |
| Box 5 | fight | moves and timelines, reactions and secondary motion, combat helpers, effects, the overlay, animation QA |
| Box 6 | look like the stress test, and be driven by any agent | lights and shadows, toon and outlines, the texture library, post filters, the governor, MCP, the gallery |

**Similar, not identical.** The box must do the stress test's job, not copy its behaviour or feel: nobody knows yet how the game should behave. The prototype's numbers (Appendix C) are starting values that change freely. Only the ported animation math is checked against the prototype, so that it survives translation (§9.0).

After Box 6 (gate G7, the foundation), the plan expands the engine: the animation library, audio, more world and animation features, WebGPU-only features and more agent tooling. Production hardening waits until a game goes to production (doctrine: Discovery first).

### What else my-3d2dge has that is worth keeping

- **An animation system that is the real asset:**
  - procedural humanoid and blob rigs (gait, IK, idle, poses, stances, capes, hair);
  - 24 tuned combat moves with anticipation, strike and follow-through (`E.MOVES`, `Attack`, `Combo`);
  - **a library of 325 curated motion clips** (Quaternius, Mesh2Motion, CMU), stored as readable key poses that an agent can read and edit;
  - a ledger of all 2,548 CMU motion-capture takes, and an import toolchain that regenerates the CMU set byte for byte from public data.
- **lab3d** (`src/lab3d/`, 1,030 lines): metres with +Y up, a true fixed-step loop, and puppet bodies written as data.
- **Proven agent practices:** seeded virtual time; state hashes; banned-API lints; numeric animation lints; scaffolds that pass their own tests; warn-once advice that names the fix.

### What hurts

- **The 3D labs are not an engine** (above). Drawing writes simulation state (`_cheat`, `_pitch`, `_camSide`).
- **Two coordinate systems.** Units of 16 to the metre with z up are swapped into three.js space at the drawing's edge.
- **The animation lives inside a 374 KB 2D engine file.** The rig stores joint positions, not rotations, so it cannot skin, mask or blend cleanly. Half of the rig code is 2D pixel drawing.
- **The tests are slow and blind.** Everything runs in a browser (about 25 minutes in all); screenshots are judged by PNG byte size; the proof hash has no golden value.
- **Repo hygiene works against agents:** build outputs in git (136 of 301 files), a hand-copied agent edition of the engine, no types, no lockfile, no CI.

### What we will build

A modular, typed engine in five layers (§6.1):
- **`core`**: math (three.js's math classes), time, randomness, registries.
- **Sim-side**: `sim`, `physics`, `anim`, `world`, input intents and audio DSP. No DOM and no renderer; it runs in Node.
- **Presentation**: `gfx` (three.js r180), the audio runtime, `ui` and the input devices.
- **`dev`**: the inspector and the tools inside the page.
- **`app`**: wiring and routes.

Around it:
- **The Stress Box** (`labs/box/`): the integration target, the benchmark and the sample scene.
- **Data:** materials, props, levels and, later, the animation clips, all as readable text.
- **Tooling:** the standard web toolchain (Vite, Vitest, Playwright Test, ESLint, Prettier, TypeScript) behind npm scripts, plus one CLI (`node x <cmd>`) for what only this engine does. Every command prints 20 lines or fewer and writes a JSON report, so an agent verifies its own work without a display.

### The shape of the roadmap

| Phases | Content | How they run |
|---|---|---|
| 0–1 | Foundation and kernel | Sequential |
| 2–7 | Box 1 to Box 6. Gate G7 is the **Stress Box**: the foundation is set | Parallel lanes inside each stage |
| 8–12 | Expansions: animation library, audio, world and animation extras, WebGPU features, agent tooling | Parallel after G7. The library and audio lanes may start early, without delaying a box stage |
| H | Production hardening: other browsers, mobile, deploys, releases | Only when a game goes to production |

Each phase ends at a gate: a fixed set of commands that must pass.

### The ten biggest improvements

The full list of 49 is in §7.
1. **One integration target.** The Stress Box grows in stages, and each stage is proved by commands that need no display.
2. **One coordinate system:** SI units, +Y up, characters facing +Z.
3. **A true fixed-step simulation that runs headless in Node**, with replay files and bisection to the first step that diverges.
4. **Reproducible on the development platform, measured** (doctrine: Reproducible). The sim uses the standard `Math` and three.js's math, as agents write them; Node and Chromium each reproduce exactly and keep their own golden hashes, since they differ by 1 ulp on some `Math.sin` results. Rapier gives identical state in both, and captures canonicalize it, because a Rapier restore does not continue exactly once bodies touch (§4.7).
5. **A rotation skeleton** (root plus 23 joints) under the ported procedural animation. It enables skinning, masks, additive layers, ragdolls, foot planting and look-at.
6. **Moves as timelines** carrying events, hit volumes and root motion.
7. **Common ground and mastery** (doctrines: Common ground, Mastery). The most widely used tools and APIs, at the newest release compatible with one at least 12 months old, adopted at once: three.js r180, Rapier 0.19.3, TypeScript 5.9.3, Vite 7.3, Vitest 3.2, Playwright 1.64, Node 24 LTS. The prototype's own stress test passes on r180, except one post-processing path that the new design avoids (§4.7).
8. **Standard tools with test tiers**: under 10 s, under 60 s and under 6 min, against about 25 minutes today. Vitest picks tests through Vite's module graph; one CLI, `node x`, covers what only this engine does.
9. **Visual checks that need no committed images and no display:** per-object pixel counts from an ID pass, look metrics, text thumbnails, and comparison against a base commit.
10. **Agent-native operation:** AGENTS.md rules paired with checks; Claude Code hooks, skills and subagents; `window.__engine`, the same headless; an MCP bridge; scaffolds that pass every check; and an escalation log, so no decision is lost and no run stalls.

---

## 2. Goals, non-goals and the scope rule

**The owner's intent.** "This game engine is intended to allow for agents to as easily as possible, produce reliable quality, consistency, token efficient output, while allowing us to develop tools that we can reuse to aid in development."

**Goals**
- **G1. Build the engine around the Stress Box.** Each stage adds engine systems, not game content, and ends with a box that runs, is measured and is proved.
- **G2. Get the foundation right first:** the layers, reproducibility, the data model, the tooling and the tests. Gate G7 marks it.
- **G3. Bring over what would be costly to rebuild, when the box or an expansion needs it:**
  - the 3D world's working techniques;
  - the animation system, with its moves, poses, procedural rigs and secondary motion;
  - the procedural textures;
  - the motion-clip library with its catalogs, ledger, provenance and toolchain (Phase 8);
  - the sound data and synth design (Phase 9);
  - the agent practices.
- **G4. Improve everything that carries over** (§7). Nothing moves across just because it exists.
- **G5. Make every capability agent-readable, agent-operable and verifiable without a display** (§3).
- **G6. Leave the engine ready for a separate game.** Games extend it through registries, events and scenes, never by editing the core.

**Non-goals**
- **No game.** Emberdeep (`src/emberdeep/`) does not come over in any form, and it is not to be remade (§5.7). The Stress Box is a test scene: its monsters, waves and numbers are sample content in `labs/box/`.
- **No copy of the stress test's behaviour or feel.** "Similar" means the same job: a hall, a hero, a crowd, physics, combat, cameras and looks, measured.
- **No 2D engine.** Pixel-art world rendering, the depth-sorted 2D renderer, the 2D views, TileMap and PlatformMap drawing, the genre starter kits, the 2D agent edition and Card mode do not come over.
- **No GUI-only feature** (doctrine: Agent-operable). Pages and panels exist so that anyone watching can see the work; each is a view over a machine interface.
- **No binary assets without the owner's approval** (doctrine: Assets). Fonts are pre-approved.
- **No hardening before production** (doctrines: Reproducible, Discovery first): no Firefox, Safari or mobile runs, no cross-platform determinism, no production deploy pipeline (WP 12.5's optional preview site is only for the owner to watch), no release machinery. Phase H lists them for later.

**The scope rule for the game.** Emberdeep grew technology any game needs: registries with schemas, an event bus, a body contract and rig checks, procedural creature rigs, a tuning registry, a developer sandbox, an autopilot, a gallery and a performance governor. The plan rebuilds these **generically, with new minimal fixtures**, when the box or an expansion needs them. It never copies game content. §5.6 lists them; §5.7 is the exclusion list.

---

## 3. The doctrine, made enforceable

A rule without a check is only a suggestion. Each principle of `DOCTRINE.md` comes with the rules this plan derives from it and the mechanism that enforces them. The mechanisms ship in Phase 0 unless noted.

**Principles are cited by name, never by number,** so a renumbered doctrine costs nothing. The short names are: **Agent-readable**, **Agent-operable**, **Verifiable** (without a display), **Assets** (agent-accessible), **Reproducible** (on the development platform), **GPU-free gameplay** (gameplay never depends on the GPU), **Common ground**, **Mastery** (over novelty) and **Discovery first**. The P-labels below follow the doctrine's current order.

| Principle | Rules | Enforced by |
|---|---|---|
| **P1. Agent-readable.** Code, data and structure are optimized for agent comprehension. | <ul><li>One concept per file, named for what it does. No one-letter names outside tiny scopes.</li><li>Soft cap of 400 lines per file, hard cap 600. Prettier formats every file (print width 120).</li><li>Every module opens with a **JSDoc file comment** (`@file`: purpose, invariants, an example, see also) of 40 lines or fewer, and every export carries its own doc comment (§6.8).</li><li>Strict TypeScript in the style agents know best: ES modules, extensionless imports, no enums or namespaces (`erasableSyntaxOnly`).</li><li>Docs are generated from the comments (INDEX, API, ERRORS) and never written twice.</li><li>Per-module token budgets. No minified or generated code in the repository; dependencies stay in `node_modules`.</li><li>Content is data: levels, materials, props, bodies and clips are readable text.</li></ul> | `npm run check`: `tsc`, ESLint (`jsdoc/require-file-overview`, `max-lines`), Prettier. `node x docs --check`. `node x sizes --budget` |
| **P2. Agent-operable.** Every capability has a machine interface; nothing requires a GUI. | <ul><li>Every capability is reachable through an npm script, a `node x` command or an `__engine` member; the running page is also reachable over MCP.</li><li>Every `x` command prints at most about 20 lines, writes a `report.json` with a fixed schema, and exits 0, 1 or 2. The standard tools are configured for short terminal output plus a JSON report under `out/`.</li><li>Every setting comes from one schema: `x set`, URL parameters and `__engine.set` (a panel, if any, is generated from it).</li><li>Registries are discoverable through `x describe` and `__engine.describe()`.</li><li>Errors and advice carry stable codes that name the fix.</li></ul> | <ul><li>Every `x` command has a smoke test.</li><li>`x docs --check` compares `help()` with the real API.</li><li>A test enforces that every setting is reachable through `x set` and `__engine.set`.</li><li>The `verifier` rejects any feature reachable only through a page.</li></ul> |
| **P3. Verifiable without a display.** | <ul><li>The sim runs headless in Node: Vitest, `x sim`, `x replay`.</li><li>Every visual feature has numeric checks: the ID pass, look metrics and text thumbnails. Images are optional and made on demand.</li><li>Browser tests run in headless Chromium through Playwright Test, in two projects: `webgpu` (SwiftShader) and `webgl2` (ANGLE).</li><li>Each feature lands with the cheapest test that proves it: a Vitest unit test, then a replay hash, then Playwright numbers, then an image.</li><li>Unit tests are selected through Vite's module graph (`vitest --changed`, `vitest related`).</li></ul> | The test tiers with time budgets (§8.2); replay suites; `node x ci --local` |
| **P4. Agent-accessible assets.** Procedural first, then text and data, then binary with approval. | <ul><li>Generators are pure functions of `(params, seed)`.</li><li>Text and data (clips, catalogs, levels, sound definitions) record their source and license.</li><li>**Binary files only with the owner's approval**, each listed in `data/APPROVED-BINARIES.json` with its escalation record. Fonts (WOFF2, TTF, OTF) are pre-approved under `data/fonts/`, each with its license.</li><li>Importer inputs (GLB, AMC, BVH) live only in the git-ignored `.cache/`.</li><li>Golden references are numbers and text thumbnails, never committed images, so Playwright's screenshot snapshots are not used.</li><li>Dependencies in `node_modules`, Rapier's inlined WASM included, are code, not source assets (ADR-0019).</li></ul> | `node x check`, the asset scan: extensions, magic bytes, and base64 runs or `data:` URIs over 1 KB, outside the approved list. The importers refuse to write outside `.cache/` and `data/` |
| **P5. Reproducible on the development platform.** | <ul><li>A fixed 60 Hz step; everything from outside arrives as recorded intents.</li><li>Seeded, named RNG streams; an ordered world.</li><li>Sim-side code uses the standard `Math` and three.js's math classes, through `core/math`. Each runtime reproduces exactly. Node and Chromium can differ by 1 ulp on `Math.sin` and `Math.cos` (§4.7), so **golden hashes are kept per runtime**, and play recorded in the browser is verified in headless Chromium.</li><li>Capture and restore cover the whole sim, Rapier and the RNG streams included. **A capture canonicalizes the live world**, because Rapier's restore is deterministic but does not continue exactly like the uninterrupted run once bodies touch (§6.5).</li><li>Replays with bisection.</li><li>Cross-browser, cross-OS and cross-hardware parity are **not** required.</li></ul> | ESLint's sim-side bans (Appendix B); replay suites in Node and in Chromium on both backends; capture and restore tests (§6.5) |
| **P6. Gameplay never depends on the GPU.** WebGPU first, WebGL 2 the fallback; renderers play the same. | <ul><li>Sim-side code never imports `gfx/`, three.js's renderer or scene classes, the DOM or Web Audio; it gets three.js's math classes only through `core/math`. The renderer reads snapshots and never writes them; nothing is read back from the GPU into the sim.</li><li>Everything the player needs in order to play is drawn on both backends, with classic three.js materials by default (§6.7).</li><li>WebGPU-only features (compute included) change looks or speed only. Each declares its fallback, is chosen by capability checks and the governor, and is never chosen silently.</li><li>Looks may differ by backend; play may not.</li></ul> | <ul><li>ESLint's layer rules (`no-restricted-imports`, one block per layer); compute and storage APIs allowed only under `engine/gfx/enhanced/` (Appendix B).</li><li>`tests/e2e/parity.spec.ts`: the same replay, rendered on WebGPU and on WebGL 2, gives Chromium's golden hashes; live play recorded on each backend replays headless to the same hashes.</li><li>Feature tests: toggling a WebGPU feature never changes the hash.</li></ul> |
| **P7. Common ground.** The most widely used languages, libraries, systems and patterns; established approaches over cutting-edge performance. | <ul><li>Use the most widely used tool, library or pattern that does the job: npm, TypeScript, Vite, Vitest, Playwright Test, ESLint, Prettier and tsx (§6.10). three.js's own classes come before custom code or TSL: classic materials, math, skinning, `AnimationClip`, the addons. Rapier is used through its documented API.</li><li>Bespoke code only where nothing established fits: the `x` commands, the escalation log, the ID pass, replays and hashing, content QA, and the animation system being ported. Each such module's file comment names the established option it considered and why it does not fit, and ADR-0019 lists them.</li><li>Plain objects and systems in a fixed order (no ECS framework, Q13). Standard formats: JSON, TSV, Markdown, glTF's conventions.</li><li>Performance work never makes the common path harder. WebGPU-only features, a SIMD physics build and GPU-driven crowds come on demand, measured, behind the same API (Phase 11, WP 5.1).</li></ul> | The `verifier` asks of every new module "is there an established tool or three.js API for this?"; ADR-0019's list of bespoke tools; `node x deps --check` (every dependency is listed with its reason) |
| **P8. Mastery over novelty.** | <ul><li>Each dependency is pinned to the newest release that is backward compatible with its newest **qualifying** release (one at least 12 months old), and that release is **adopted immediately** (§6.10). A line that is not backward compatible waits until it qualifies, then arrives as an upgrade work package.</li><li>Write the idioms of the qualifying releases: features newer than a qualifying release wait until they qualify, unless an ADR says otherwise. three.js names from newer releases are banned with their r180 replacements (Appendix B).</li><li>The platform follows the same rule: Node's newest qualifying LTS line (24) is installed for each session until the environment provides it (§6.10).</li><li>Pinned knowledge: the pinned packages' own sources and types in `node_modules`, `docs/THREE-DELTA.md`, and the TSL guide as it stood for r180.</li></ul> | `node x deps --check` (offline: the pins match `tools/deps.json`, and each is the newest compatible release it records); `node x deps --update` at the start of every WP adopts compatible releases; `node x deps --qualify` at every gate lists upgrades that qualify |
| **P9. Discovery first, hardening later.** | <ul><li>Development and tests target the development platform: the Linux cloud container, Node 24 and the container's preinstalled headless Chromium 141, driven by Playwright Test.</li><li>Prefer the smallest change that proves an idea in the box. Tuning and polish wait.</li><li>Phase H (other browsers, mobile, production deploys, releases, cross-platform determinism) is not scheduled until a game goes to production.</li></ul> | The roadmap (§9); the `verifier` flags production-hardening work outside Phase H |
| **Escalation.** | <ul><li>Escalate when an action needs the owner's approval (a binary asset other than a font; a new runtime dependency, or any dependency outside the rule of §6.10; a repository setting, secret, deploy or other outward action; rewriting published history) or when a principle cannot be satisfied.</li><li>Wait up to 15 minutes. With no answer: commit the current work, make the call, continue. For the rest of that run, report further conflicts in chat without stopping.</li><li>**Never perform the action while waiting.** Take the doctrine's preferred alternative meanwhile (procedural or text instead of binary; a stub behind the feature registry).</li><li>Record every escalation and every call made in its absence.</li></ul> | `node x esc` and `docs/escalations/` (§8.14); the Stop hook warns about an open escalation past its deadline with no recorded call; the ledger links each escalation |

**Terms used throughout:**
- **Sim-side** means reproducible and renderer-free: `core`, `sim`, `physics`, `anim`, `world` (logic), input intents and replay, the audio DSP, the bot (`engine/dev/bot.ts`), the box's scenes and cast (`labs/box/scenes/`, `labs/box/cast/`) and the fixture scenes (`fixtures/scenes/`).
- **Presentation** means everything that draws or plays: `gfx`, the audio runtime, `ui`, and the input devices.
- **View state** is presentation-only state, such as cape chains, particle positions and camera shake. It may be reproducible for tests, but it is never part of the gameplay hash.
- **The development platform** is the Linux x64 cloud container, with Node 24.21.0 (the newest 24.x LTS; `scripts/setup.sh` installs it while the container ships Node 22.22.0) and the preinstalled Chromium 141.0.7390.37, driven by Playwright Test 1.64.0. Golden hashes are recorded for its two runtimes, `linux-x64 node24` and `linux-x64 chromium141`.

---

## 4. What we found in my-3d2dge

Eight parallel deep-dives read the source in full. Where possible they ran it: builds, the lab tests, Node probes, and a re-run of the CMU import. For the re-base on the Stress Box and the doctrine, the prototype's own stress-world test was also run against three.js r180, r181.2 and r182, and the platform was measured (§4.7). The numbers are collected in Appendix D.

### 4.1 The Stress test: 3D world (the anchor)

**`src/stress-world/`**: 9 files, 2,574 lines, about 55k tokens, built into one page (`examples/stress-world.html`). Its lab entry asks: *"What does the stress test become built from the ground up as a 3D game (three.js r182, Rapier physics, a hall written as text), sharing only the engine's animation system, and how does it hold up?"* (`src/labs.json:95-98`).
- **What it does:**
  - A hall written as a 64×44 ASCII map, with walls, pillars, low walls, braziers, galleries, stairs and a raised dais. Heights, colliders, a walkable grid and meshes all derive from the text.
  - A kinematic Rapier character controller: walk, dash, jump, autostep, slopes, and pushing.
  - Monsters (walkers, slimes, wisps) as dynamic bodies driven by AI-chosen velocities. The solver resolves the crowd, so there is no separation code. Big hits launch bodies, and corpses slide.
  - A Dijkstra flow field over an 8-neighbour walkable grid that knows climb limits, so monsters follow the hero up the stairs.
  - Instanced puppet batches and a card atlas.
  - A shader warm-up, so no pipeline is built mid-fight.
  - A fixed set of 42 lights, 2 of them casting shadows.
  - Cel, pixel, bloom and FXAA filters in TSL, with an MRT object mask.
  - Cameras: the classic views as ortho or perspective, side scrolling with depth, chase with wall avoidance, first person, fly and fixed. Wall and pillar cutaway.
  - A benchmark that splits CPU time into physics, logic and drawing. Headless: 1 ms per step at 100 monsters, 5.6 ms at 1,000 (2.6 ms of it physics), 33 ms at 5,000 (21 ms physics).
  - `window.__sw` and a Playwright test (`tools/stress-world-test.mjs`) that runs the proof on both backends, checks that no pipeline is built mid-fight, climbs the stairs, knocks a crate, and draws every camera and filter.
- **What it gets wrong:**
  - **Not fixed-step.** The live loop splits each frame into `ceil(dt/STEP)` equal substeps, so Rapier's step size changes with the display rate, and live play cannot be reproduced.
  - **The sim cannot run without the renderer.** `00-setup.js` initializes the renderer first, and `10-hall.js` builds meshes and textures at load.
  - **The renderer leaks into gameplay:**
    - the camera heading feeds monster AI;
    - the visibility set drives animation level of detail;
    - card drawing writes rig state;
    - particle calls own hit-stop.
  - **The hash is weak.** It covers no velocities, rotations, RNG state, corpses or shots, and there is no golden value.
  - **No shared structure.**
    - Glyph meanings are hard-coded in about a dozen places across two files.
    - There is one shared scope with 322 top-level declarations, and 21 TSL names are dumped into it.
    - Tuning numbers are scattered through the code.
- **Bugs:**
  - A probable instancing bug in the `'center'` outline mode: the push direction comes from `positionLocal`, which already holds the instance-transformed position. r180 does the same (verified in its `InstanceNode`).
  - The height "boost" of the classic views was dropped.

**What the Stress Box takes from it.** The techniques: the level-as-text compiler, the crowd-on-bodies pattern, the controller config, instanced batches with their workarounds, the warm-up discipline, the light budget idea, the filters, the cameras and camera links, and the test harness (SwiftShader flags, the stand-in canvas, readback). It rewrites the structure: real modules, a sim that runs in Node, a true fixed step, data instead of code for levels and bodies, and one inspector API.

**`src/lab3d/`**: 7 files, 1,030 lines. It does several things better than stress-world:
- metres with y up;
- a true fixed 60 Hz loop with a 6-step cap;
- the 6-line height-boost projection `P·V·S·V⁻¹`;
- puppet bodies as a data list (`['limb', a, b, ra, rb, color]` and similar);
- cards drawn from each character's own angle.

Its costs: 1,225 draw calls in Puppet mode (measured: WebGL 2, iso view, shadows on), with no instancing.

**Pick per concern** (§5.1 has the full table):
- From **lab3d**: units, loop, body grammar, boost.
- From **stress-world**: everything else: instancing, warm-up, lights, filters, richer cameras and camera links (`?cam=`, `?cam3=`), collision groups, the controller config, richer level text.

**Lessons the labs wrote down** (`docs/LAB-3D.md`):
- Rules never read the drawing.
- Warm up every pipeline before play.
- The r182 instancing bug (present in r180 too).
- **"Card" vs "Puppet": a trade-off, not a verdict** (`docs/LAB-3D.md:57-66`; both labs still default to Card). Card keeps the exact 2D look, but it is flat, sits at one depth and ignores the scene's light. Puppet has real depth, real light and works from any camera, but its look is an approximation. **This plan picks Puppet** (§5.1).

### 4.2 The animation core

The core lives in `engine/my-3d2dge.js`: its §11 Humanoid (77 KB) and its §12 Blob. The stress test uses it for every character.

- **What the rig is.** `rig.J` holds 15 joint *positions*:
  - `hipL hipR kneeL kneeR footL footR hipC shC shL shR head elbowL elbowR handL handR`.
  - There is no parent table and no bone rotation.
  - Limbs are solved by the two-bone IK `ik3`.
- **How layers combine.** Named weights ease toward their targets. Then about 15 lerp overrides apply, in a fixed order that is the only record of priority. Then IK.
- **What ports nearly verbatim:**
  - **The move model, the real asset:** 24 moves (8 blade, 6 fist, 6 kick, cast/throw/bash/claw). The wind phase starts from the real current pose; the strike is an ease-out arc with lunge, step, twist and hop; recovery overshoots, holds, and blends back by position.
  - `Attack` (leftover time carried across phases), `Combo` and `E.move` (a deterministic preview).
  - The gait and idle formulas.
  - The verlet cape and hair.
  - The squash spring.
- **Weaknesses:**
  - Hits are flat ground cones, not tied to the animation.
  - Reactions are thin: one flinch and a rigid knockdown.
  - Reproducibility breaks in two ways: `Math.random` sets the breathing phase, and the substep length varies with the display's refresh rate.
  - The state object is loose: misspelled poses fail silently.
- **Size.** The 3D-math part is about 43 KB (12.4k tokens). Card-mode drawing is about 60 KB (17k tokens), and **does not come over**.

### 4.3 The animation library

The library lives in `src/mocap/`, with its tools in `tools/anim-*`, `asf-amc`, `cmu` and `to-glb.py`. The stress test does not use it (lab3d does); it comes over in Phase 8.

- **Contents:**

  | Set | Clips | Average / worst fit | License |
  |---|---|---|---|
  | Quaternius | 88 | 13.9 / 222 mm | CC0 |
  | Mesh2Motion | 177 | 16.1 / 286 mm | CC0 |
  | CMU (moments cut from takes) | 60 | 17.8 / 167 mm | CMU terms |

  - **Size:** 1.93 MB of text, 393 KB gzipped.
  - **Catalogs:** three hand-written files of tags and descriptions (39 KB).
  - **Ledger:** 2,548 CMU takes (262 KB), with category, fit, flags and usage for each.
- **The format: "readable key poses".** A key holds about 42 integers in named fields: hips height, body/chest/head turn-lean-tilt, and limbs as direction plus bend plus twist. At about 2,100 tokens per clip, agents read and edit it well. It is text data, the doctrine's second preference (P4).
- **Converting to rotations.** Baking it into local rotations is exact: a mean error of 0.26–0.46 mm, **if the bake works from the format's parameters**. Converting key for key gives outliers up to 0.73 m.
- **Source fidelity is not in the repo.** Wrists, forearm twist, foot roll, per-bone spine and root yaw were never stored. But re-import is proven: the CMU import regenerates `cmu.js` **byte for byte** from public data in about a minute (verified during this study: `docs/research/D-mocap-library.md` §4).
- **The 68 MB `examples/cmu-lib/` can be regenerated** and is never committed.
- **License gap.** The CMU license record omits the no-resale clause. It quotes only the NSF funding line, not CMU's full acknowledgment sentence. Fix it.

### 4.4 The rest of the 2D engine

About a quarter of it is worth porting, roughly 27–35k tokens:
- `E.rng` (Mulberry32) and `hash2`, kept bit-exact;
- the colour helpers;
- the warn-once and error hygiene;
- `parseLevel` and `E.pattern`;
- the engine's sound data (33 effects, 6 drums, 5 songs) and its chip synth;
- the pixel font (use the agent edition's compact encoding);
- input's action model, edge detection in sim time and input buffering;
- `E.tex`'s 7 generators;
- the backdrop strips;
- the dialog and menu concepts.

Notes on these:
- The synth is **not reproducible**: it uses `Math.random` and a wall-clock scheduler.
- **Neither 3D lab has any audio.**
- The textures **do not tile** and are baked without mipmaps, so the distant floor shimmers.
- Each lab rewrote its own texture baker.

### 4.5 Tooling and workflow

- **35 tools, 26 npm scripts.** Browser-launch code is copied into 19 files and the server 4 times, and about 20 tools parse their own arguments.
- **Everything runs in Chromium**, although Node does most of the work fast:
  - the engine loads in 9–14 ms;
  - 600 rig steps take 21–30 ms;
  - all motion lints run in 0.28 s;
  - Rapier initialises in 84–106 ms.

  These were measured on two runs in the cloud container; they depend on the machine.
- **Mechanisms that work:**
  - the virtual clock plus seeded randomness (`tools/filmstrip.mjs:39-53`);
  - the headless WebGPU stand-in canvas with readback (`tools/lab3d-test.mjs:70-102`);
  - the banned-API list;
  - "no pipeline compiled mid-fight" as a test;
  - numeric character-sheet lints;
  - scaffolds that test themselves (`new-character.mjs --test`, a suite of `npm test`; the source has no CI).
- **Holes:**
  - The hand-written test map skips suites that should run.
  - One global random stream breaks `--compare`.
  - Seeded mode switches WebGPU off.
  - There are no Node unit tests at all.

### 4.6 Engine-grade technology inside Emberdeep

These come over as patterns only; §5.6 lists them.
- A registry, `def(kind, id, spec)`, where shared code "asks the entry, never the id".
- An event bus with listener lifetimes.
- A body contract plus `checkRig`: 14 states × 2 facings × 5 views, naming every broken part.
- An **intent vocabulary** (this plan calls it *body states*): bodies get state words and ignore keys they don't know, so any behaviour runs on any body.
- 16 procedural rig building blocks:
  - two-bone IK with reverse knees;
  - critically damped springs;
  - a multi-leg planted-foot gait;
  - a path-history serpent;
  - verlet strands;
  - floaters;
  - delayed pose replay;
  - and others.
- One attack timeline shared by animation, hits, telegraphs, AI and bots.
- A timescale stack and a leaky hit-stop budget.
- A tuning registry; a developer sandbox; an autopilot with stuck detection; a gallery of everything registered; a performance governor with hysteresis.
- 35 written lessons, folded into this plan.

### 4.7 Facts measured for the doctrine (2026-10-09)

Each fact below was measured in this cloud container, the platform development targets (doctrine: Discovery first). The probes were throwaway scripts in the session's scratch space.

**Versions (doctrine: Mastery).** A release *qualifies* when it is at least 12 months old: released on or before 2025-10-09. The pin is the newest release that is **backward compatible** with the newest qualifying one, adopted immediately: by semver, the newest release in the same major for packages at 1.0 or later, and the newest patch in the same minor for 0.x packages. Dates are from the npm registry and nodejs.org.

| Dependency | Newest qualifying release | Pin, adopted now | Why it is compatible | Next line, and the date it qualifies |
|---|---|---|---|---|
| three | r180.0 (2025-09-03) | `0.180.0` | It qualifies. r181 and later each list breaking changes (below) | r181.0 (2025-10-31) on 2026-10-31; r182.0 on 2026-12-10; r183.0 on 2027-02-18 |
| `@types/three` | 0.180.0 (2025-09-03) | `0.180.0` | Matches three | Follows three |
| `@dimforge/rapier3d-compat` | 0.19.1 (2025-10-03) | `0.19.3` (2025-11-05) | A patch of the 0.19 line | 0.20.0 (2026-08-08) on 2027-08-08. It changes behaviour (below) |
| TypeScript | 5.9.3 (2025-09-30) | `5.9.3` | The newest 5.x | 6.0 (2026-03-23) on 2027-03-23 |
| Vite | 7.1.9 (2025-10-03) | `7.3.7` (2026-10-06) | The newest 7.x | 8.0.0 (2026-03-12) on 2027-03-12 |
| Vitest | 3.2.4 (2025-06-17) | `3.2.7` (2026-07-06) | The newest 3.x | 4.0.0 (2025-10-22) on 2026-10-22 |
| `@playwright/test` | 1.56.0 (2025-10-06) | `1.64.0` (2026-10-07) | The newest 1.x. It drives the container's Chromium 141 (below) | None yet |
| ESLint, `@eslint/js` | 9.37.0 (2025-10-03) | `9.39.5` (2026-07-10) | The newest 9.x | 10.0.0 (2026-02-06) on 2027-02-06 |
| `typescript-eslint` | 8.46.0 (2025-10-06) | `8.71.1` (2026-10-05) | The newest 8.x; its peer range admits TypeScript 5.9 | None yet |
| `eslint-plugin-jsdoc` | 61.1.0 (2025-10-09) | `61.7.1` (2026-01-08) | The newest 61.x | 62.0.0 (2026-01-09) on 2027-01-09 |
| `globals` | 16.4.0 (2025-09-09) | `16.5.0` (2025-11-01) | The newest 16.x | 17.0.0 (2026-01-01) on 2027-01-01 |
| Prettier | 3.6.2 (2025-06-27) | `3.9.9` (2026-09-23) | The newest 3.x | None yet |
| tsx | 4.20.6 (2025-09-26) | `4.23.15` (2026-09-20) | The newest 4.x | None yet |
| Node | 24.10.0 (2025-10-08) | `24.21.0` (2026-09-07), LTS | The newest 24.x. The container ships 22.22.0, so `scripts/setup.sh` installs it (§6.10) | Node 26 LTS on 2027-05-05. Node 25 qualifies on 2026-10-15 but is already end-of-life (odd lines never get LTS), so it is skipped |
| `@types/node` | 24.7.1 (2025-10-09) | `24.19.2` (2026-10-09) | Matches Node 24 | Follows Node |
| `@modelcontextprotocol/sdk` (from WP 7.6) | 1.20.0 (2025-10-09) | the newest 1.x when WP 7.6 lands (1.32.1 today) | Same major | None yet |
| Chromium | — | 141.0.7390.37, the container's (`chromium-1194`) | The platform's browser (doctrine: Discovery first) | Changes when the environment does |

**three.js after r180 is not backward compatible** (its migration guide, `three.js.wiki`). Every release lists breaking changes, several in APIs this engine uses:
- **r181:** removes `waitForGPU()`; renames TSL's `PI2` to `TWO_PI` and `PassNode.setResolution()` to `setResolutionScale()`; deprecates `renderAsync()`, `computeAsync()` and the other async render methods; brightens rough PBR materials; moves GTAO's output to the `r` channel.
- **r182:** renames `colorBufferType` to `outputBufferType`; deprecates `PCFSoftShadowMap` on `WebGLRenderer`.
- **r183:** renames `PostProcessing` to `RenderPipeline`; deprecates `Clock`; changes shadows and `RoomEnvironment`.
- **r184–r186:** rotates environment maps, changes premultiplied alpha, stops `positionLocal` from following skinning, makes `updateWorldMatrix()` honour `matrixWorldNeedsUpdate`, renames `Source` to `TextureSource`, removes `PCFSoftShadowMap` from WebGPU.

So r180 stays until r181 qualifies. Each upgrade then also checks the following release against the one that just qualified: r182 touches only names this engine does not use, so U-1 is expected to land r181 and r182 together if the suites agree (§9, "Upgrades").

**Rapier after 0.19.3 changes behaviour.** JS 0.20.0 moves from Rapier 0.30 to 0.35 at once. It removes `IntegrationParameters.minIslandSize`, and Rapier 0.35 changes the character controller's snap-to-ground and the contact solver. JS 0.21.0 (Rapier 0.36) reports the character controller's collision points and normals in world space instead of local space. Neither works the same way, so 0.19.3 stays until 0.20 qualifies.

**The prototype's own test on the qualifying three.js.** The prototype's `tools/stress-world-test.mjs` was run in a scratch copy, with only the import map changed, three times:

| three.js | Result |
|---|---|
| r182 (as shipped) | Passes. Proof hash `68e1f7d1` on both backends; 3 min 11 s |
| r180 | Everything passes (proof hash `68e1f7d1` on both backends, the fight with no pipeline built mid-fight, the stairs, the crate, every camera) **except the WebGPU post filters**: the four filtered frames are solid black `(0,0,0,255)`. On WebGL 2 every filter draws |
| r180, with the MRT mask removed from the post graph | The WebGPU filters draw again (pictures of 34–270 KB, against 18 KB for the black ones). So r180's `PostProcessing` works on WebGPU; its MRT path is what fails |
| r181.2 | Worse: WebGPU pipeline validation errors ("Color target has no corresponding fragment stage output…") for materials without the mask output |

The gameplay hash is the same under r180, r181.2 and r182, as it should be: the sim never touched the renderer. One physics check ("the hero's jump rose 0.0 units") failed on WebGPU in two of the four runs and passed in the others; it follows from the prototype's variable-step live loop, not from three.js. **Consequences:** pin r180; build post masks from a separate pass instead of MRT (WP 7.4); treat each three.js upgrade as a work package that runs every suite.

**r180's API, as agents will meet it:**
- `PostProcessing` is the post-processing class. `RenderPipeline` (its name from r183), `DynamicLighting`, `ClusteredLighting` and `TextureSource` are **not** exported.
- The `TiledLighting` addon (WebGPU compute) and `CSMShadowNode` exist as addons. `SSGINode` and `GodraysNode` do not exist yet.
- r180 warns on about 20 deprecated TSL names, such as `atan2`, `equals`, `append`, `label()` and `viewportResolution`. The full list, with replacements, is in Appendix B. The newer names `packNormalToRGB`, `unpackRGBToNormal` and `negateOnBackSide` do not exist yet.
- `InstanceNode` uses a uniform buffer up to 1,000 instances and an attribute beyond. r180 re-uploads an attribute whose usage is `DynamicDrawUsage` (`Attributes.js:89`); the prototype lost dynamic-usage updates above 1,000 instances on r182 (`LAB-3D.md:196`). The instancing service avoids both by keeping `StaticDrawUsage` with update ranges.
- The npm package carries r180's source with its JSDoc comments (`node_modules/three/src/`), which agents can read and grep. Its HTML API pages cover the WebGL renderer only: none covers WebGPU, TSL or `PostProcessing`. The TSL wiki page as it stood for r180 is the last revision before r181 (`00d6fe7`, 2025-10-01); today's page uses `RenderPipeline` 8 times.
- TypeScript 5.9.3 type-checks `three/webgpu`, `three/tsl` and Rapier with `moduleResolution: bundler`. With `nodenext` plus `skipLibCheck`, every Rapier type silently becomes `any`, because Rapier's `.d.ts` files import `./exports` without an extension. `skipLibCheck` is still needed: Rapier's `raw.d.ts` re-exports a module the package does not ship.

**The standard toolchain on the platform (doctrine: Common ground).** A scratch project with the pins above:
- `tsc --noEmit` is clean. Vitest runs a test that steps Rapier and uses three.js's math classes (imported from `three/webgpu`) in Node in 0.9 s. A path filter that matches nothing exits 1. `vitest related <file>` and `vitest run --changed` select tests through Vite's module graph; a change to page-only code selects none, because the browser suites cover it.
- **`node x <cmd>`.** A three-line `x.js` that registers tsx and imports `tools/x.ts` runs TypeScript CLI code importing engine modules with extensionless paths: `node x sim` takes 0.7 s, Rapier's initialization included, on Node 22 and Node 24.
- **Playwright Test** against the Vite dev server renders a cube with the classic `MeshLambertMaterial` on both projects: WebGPU through the prototype's stand-in canvas, and WebGL 2. The page's sim hash equals Node's. Two tests take 3.4 s.
- **Playwright 1.64.0 drives the container's Chromium 141** through `launchOptions.executablePath` (`/opt/pw-browsers/chromium`), the route the environment documents for a newer Playwright, and passes the same tests with the same frames.
- **Errors keep their lines.** A thrown error's stack in a Vite-served `.ts` module names the right line. The e2e fixture still maps page-error stacks through Vite's inline source maps, for the general case.
- **ESLint's stock rules carry the bans:** `no-restricted-imports` (with `allowImportNames`, so `core/math` can re-export three.js's math classes and nothing else), `no-restricted-properties` (`Math.random`, `performance.now`), `no-restricted-globals` (`Date`) and `jsdoc/require-file-overview`, each message naming the fix.
- `vite build` builds the page in about 3 s.
- **Node 24.21.0 runs all of it,** with Playwright 1.56.1 and 1.64.0 alike. Its npm (11.19) skips dependency install scripts unless `package.json`'s `allowScripts` approves them. esbuild's postinstall is the only one, and Vite works without it.

**Reproducibility on the platform (doctrine: Reproducible):**
- **Rapier `compat` 0.19.3** gives the same snapshot hash (`8ab42415`, 100 capsules over 300 steps) in Node 22.22.0, Node 24.21.0 and Chromium 141, on both backends. The SIMD build behaves the same (`f022af2`, 200 capsules over 600 steps, Node 22 and Chromium 141).
- **A restore does not continue exactly like the uninterrupted run once bodies touch.** 40 crates restored at step 1 are 5.4 cm away from the uninterrupted run by step 300 (`compat`). An independent probe measured up to 1.5 m with the SIMD and deterministic builds. But a restore is deterministic: two restores of one snapshot continue identically, and a run that restores itself at step 120 matches any later restore of that step (`a0d54d93` in Node 22, Node 24 and Chromium 141). Snapshot bytes do not re-serialize identically after a restore.
- **Snapshots are heavy at crowd scale.** At 5,000 capsules, `takeSnapshot` takes 7.8 ms and `restoreSnapshot` 22.6 ms, for 5.72 MB; one step takes 0.6 ms.
- **V8's `Math` differs between Node and Chromium.** Hashing 200,000 seeded results for each of 17 functions:
  - Node 22 against Chromium 141: `sin`, `cos` and `pow` differ. Over 100,000 inputs, 3.46% of `Math.sin` results, 3.35% of `Math.cos` and 9.99% of `Math.pow` differ, each by 1 ulp.
  - Node 24.21.0 against Chromium 141: only `sin` and `cos` differ. `pow` now agrees, so Node 24 and Node 22 differ on `pow`.
  - `tan`, `atan`, `atan2`, `asin`, `acos`, `exp`, `expm1`, `log`, `log2`, `sinh`, `tanh`, `hypot`, `cbrt` and `sqrt` match everywhere.

  A sim that calls `Math.sin` drifts apart between Node and Chromium over time, while each runtime reproduces itself exactly. The engine keeps standard `Math` (doctrine: Common ground) and records golden hashes per runtime (§6.5).

---

## 5. Carry-over inventory: keep, port, rewrite, drop

**Verdicts:**
- **COPY**: byte for byte, or nearly.
- **PORT**: same logic, moved into a typed module in SI units, with the improvements listed.
- **REWRITE**: a new implementation that keeps the proven ideas.
- **CONCEPT**: re-implement only the idea.
- **DROP**: does not come over.

Source paths are relative to `my-3d2dge@e37e4ee`. `ed/` means `src/emberdeep/`. The engine file is `engine/my-3d2dge.js`, cited as `engine:line`. The WP column points to §9; **H** means Phase H (production hardening).

### 5.1 The 3D world runtime (`src/stress-world/`, `src/lab3d/`, `src/free-camera.*`)

| Item | Source | Verdict | Target | WP |
|---|---|---|---|---|
| Renderer bootstrap: `WebGPURenderer`, `forceWebGL`, backend label | `stress-world/00-setup.js:67-71`, `lab3d/00-setup.js` | PORT. Await `init()` once; log the backend and compat mode; never fall back silently | `engine/gfx/renderer.ts` | 2.1 |
| Fixed-step loop | Good: `lab3d/60-panel.js:143-152` (60 Hz, 6-step cap). Bad: `stress-world/50-frame.js:83` (variable substeps) | PORT lab3d's design as an accumulator with interpolation | `engine/core/time.ts`, `engine/app/loop.ts` | 1.3, 2.7 |
| State hash | `stress-world/00-setup.js:59` (FNV-1a over float32) | REWRITE: canonical component fields as float64 bits, plus RNG states, plus a hash of Rapier's snapshot, plus a per-step trace | `engine/core/hash.ts`, `engine/sim/state.ts` | 1.1, 1.4 |
| `SIM.run(600)` scripted proof | `stress-world/20-sim.js:587`, `lab3d/30-physics.js` | REWRITE as replay files run in Node and in both browser backends | `engine/sim/replay.ts`, `tests/replays/` | 1.5 |
| Rapier world, units, collision groups | `stress-world/20-sim.js:32` (groups: world, prop, hero, mob, wisp, dead) | PORT. SI units; Rapier's standard `compat` build at the prototype's version (measured reproducible, §4.7; SIMD only if WP 5.1 measures the need); one parameters table | `engine/physics/world.ts` | 3.1 |
| Character controller | `stress-world/20-sim.js`. Capsule half-height 9 and radius 4.5 units; offset 0.3, snap 4, autostep (4, 2), max slope 50°, slide, impulses at character mass 2500; speed 80, jump 150, dash 260 | PORT, converted to SI: 0.5625 m, 0.281 m, 0.019 m, 0.25 m, (0.25, 0.125) m, 5 m/s, 9.375 m/s, 16.25 m/s (Appendix C). Add the grounded-flicker workaround | `engine/physics/character.ts` | 3.2 |
| Crowd as dynamic bodies | `stress-world/20-sim.js`: velocity intents, locked rotations, zero-friction combine, sleeping, knockback as momentum, launches, a corpse group | PORT the pattern | `engine/physics/crowd.ts` | 5.1 |
| Walker, slime and wisp AI; attack tokens; waves | `stress-world/20-sim.js` | **Box sample content**, rebuilt neutrally. Flow-field steering and token-limited attackers become generic helpers | `labs/box/cast/`, `engine/world/{steer,ai}.ts` | 5.2, 5.7 |
| Level as text | Hall 64×44: `# P w t = ^ o .` (`stress-world/10-hall.js`). Room 13×11: `# T P . c C m d` (`lab3d/20-world.js:12-35`) | REWRITE as a **legend-driven compiler** with `validate()`. The hall becomes the box's big level; a small room starts it | `engine/world/level/*`, `labs/box/levels/` | 2.2, 4.2 |
| Heights, walkable grid, flow field | `stress-world/10-hall.js`: `floorH`/`topH`, `PASS` with an 8-neighbour `CLIMB` limit, Dijkstra `FLOW` without per-step allocation | PORT | `engine/world/level/heights.ts`, `engine/world/nav.ts` | 2.2, 4.3 |
| Colliders from text | Greedy rectangle merge, convex wedges for stairs, the dais frustum (`10-hall.js`) | PORT: descriptors in `world`, bodies in `sim` | `engine/world/level/colliders.ts`, `engine/sim/levelBodies.ts` | 2.2, 3.1, 4.2 |
| Procedural texture bake | `bake()`, duplicated in both labs | REWRITE: `DataTexture`, mipmaps, albedo, normal, roughness and emissive channels, tiling generators | `engine/gfx/textures/` | 2.3, 7.3 |
| Toon bands, node materials | `stress-world/00-setup.js` (`TOON_BANDS`, `objMat`) | PORT | `engine/gfx/materials/` | 2.3, 7.2 |
| Outline (inverted hull in TSL) | `stress-world/00-setup.js:102-116` | PORT and FIX: take the push direction from `positionGeometry`, because r180 assigns the instance-transformed position to `positionLocal`. Add an ID/depth edge outline as a post pass (from the fly renderer's idea) | `engine/gfx/materials/outline.ts`, `engine/gfx/post/edges.ts` | 7.2, 7.4 |
| Puppet body grammar | `lab3d/40-characters.js:8-48`: `['limb',a,b,ra,rb,c]`, `['curve',a,b,bow,ra,rb,c]`, `['ball',a,r,c]`, `['eye',a,r,c]`, `['sword']`, `['cape']`; points are a joint name, `[f,r,u]`, `['lerp',p,q,t]` or `['off',p,df,dr,du]` | PORT and EXTEND: bones, sockets, mirrored parts, material slots, metres | `engine/gfx/puppets/` | 3.8 |
| Instanced puppet batches | `stress-world/30-crowd.js:20-67` (`Batch.tube/ball/box/cone`) | PORT behind an instancing service | `engine/gfx/instancing.ts` | 3.8 |
| Cards (the engine draws sprites into an atlas) | `stress-world/30-crowd.js`, `lab3d/40-characters.js` | **DROP**. Puppets won; the pixel look becomes a post filter | — | — |
| Lights | 42 fixed point lights plus a hemisphere light; 2 shadow casters. Built in `stress-world/10-hall.js:435-466`, driven each frame by `50-frame.js:58-63` and `35-effects.js:107-109` | REWRITE: a fixed light pool with a budget manager (the count never changes, so no shader rebuilds), a shadow-caster budget, flicker on the visual RNG. r180's `TiledLighting` addon becomes an optional WebGPU feature (WP 11.5) | `engine/gfx/lights.ts` | 7.1 |
| Fog that starts past the focus | `stress-world/50-frame.js` | PORT, adding height fog | `engine/gfx/atmosphere.ts` | 7.1 |
| Warm-up (draw everything once before play) | `stress-world/50-frame.js` | REWRITE as a registry using `compileAsync` with progress, and a **public** pipeline counter instead of `renderer._pipelines` | `engine/gfx/warmup.ts` | 2.1 |
| Cameras | `stress-world/40-cameras.js`: classic views (perspective or ortho), side scrolling with depth, chase with wall avoidance, first person, fly, fixed. `lab3d/50-cameras.js`: orbit. Camera links: `stress-world/40-cameras.js:274-337` (`?cam=`, `?cam3=`) and lab3d's `CAMS.code()`/`load()` | PORT | `engine/gfx/cameras/` | 2.5, 3.9 |
| Height boost projection `P·V·S·V⁻¹` | `lab3d/50-cameras.js:31-40` | COPY (6 lines) | `engine/gfx/cameras/boost.ts` | 2.5 |
| Wall and pillar cutaway | `stress-world/10-hall.js`, `40-cameras.js` | PORT | `engine/gfx/cutaway.ts` | 4.4 |
| Post filters with an MRT mask | `stress-world/45-filters.js`: cel, pixel/Bayer, bloom, FXAA | PORT the filters to `PostProcessing` (r180), with the allowlisted TSL display addons where they exist. The object mask comes from a separate mask pass, not MRT (§4.7) | `engine/gfx/post/` | 7.4 |
| Resolution modes | `stress-world/50-frame.js` `fit()`: engine pixels at 200–330 lines, balanced, full | PORT | `engine/gfx/resolution.ts` | 2.1 |
| Effects | `stress-world/35-effects.js`: telegraph decal pool, ribbons from `rig.trail`, particle quads. Blob shadows: `stress-world/30-crowd.js:334-364` (`shadowAt`) | PORT | `engine/gfx/fx/`, `engine/gfx/puppets/blobShadow.ts` | 6.4, 3.8 |
| Damage numbers on a pixel-font overlay | `stress-world/35-effects.js:133-149` | PORT | `engine/ui/overlay.ts` | 6.5 |
| Panel, HUD, page template | `stress-world/60-panel.js`, templates | REWRITE: no hand-built panel. Every setting comes from the schema (`x set`, URL, `__engine.set`); a panel, if wanted, is generated from it | `engine/core/settings.ts`, `tools/cmd/set.ts` | 1.2, 2.7 |
| Benchmark (physics, logic and drawing split; copyable report) | `stress-world/60-panel.js` | PORT as `x perf --ladder` over the box's crowd scenes | `tools/cmd/perf.ts`, `labs/box/` | 5.5, 5.7 |
| `window.__sw`, `window.__lab3d` | `60-panel.js` in both labs | REWRITE as one `window.__engine` | `engine/dev/inspector.ts` | 1.6, 2.7 |
| The stress-world test | `tools/stress-world-test.mjs` | REWRITE as the box's Playwright suites on the shared fixture, with golden hashes and numeric picture checks | `tests/e2e/box-*.spec.ts` | 2.7, 3.10 |
| Fly renderer (a CPU rasterizer) | `src/free-camera.fly.js` (247 lines) | DROP the code. Keep two ideas: ID/depth edge outlines (WP 7.4), and a Node "agent eye" visibility raster (WP 12.3) | — | — |
| Free-camera room, perspective lab, shapes comparison | `src/free-camera.game.js`, `src/lab.game.js`, `src/shapes-*` | **DROP**. The shapes data comes from converted CC0 models | — | — |

### 5.2 The animation core (`engine/my-3d2dge.js` §1, §10–§12)

| Item | Source | Verdict | Target | WP |
|---|---|---|---|---|
| Math helpers: `clamp lerp approach ease angDiff lerpAng approachAng smoothDamp` | `engine:72-96` | PORT | `engine/core/math.ts` | 1.1 |
| `ik3`, the two-bone IK | `engine:129-140` (12 lines) | COPY, plus `twoBoneRot` with an explicit pole | `engine/anim/ik.ts` | 3.5 |
| Joint set (15 positions) and its implicit hierarchy | `engine:1753`, `_pose()` `engine:1917-1994` | REWRITE as data: **root plus 23 joints**, with local rotations (§6.3, Appendix C) | `engine/anim/skeleton.ts` | 3.4 |
| `_w` (rig-local to world, via facing, spin, `_cheat`, size, squash) | `engine:1794` | REWRITE as a root transform plus a squash scale channel | `engine/anim/skeleton.ts` | 3.4 |
| Gait, idle, lean and arm-swing formulas | `engine:1919-1954` | PORT, in metres, with constants in tables | `engine/anim/locomotion.ts` | 3.6 |
| Pose and stance effector targets | `engine:1924-1937, 1955-1968` | PORT into tables | `engine/anim/poses.ts` | 3.6 |
| Attack arm path: anticipation from the real pose (`_from`), overshoot, hold, blend back by position | `engine:1842-1867, 1950-1951, 1969-1986` | PORT | `engine/anim/moves.ts` | 6.1 |
| `E.MOVES` (24), `Attack`, `Combo`, `E.move`, `E.knockback` | `engine:2467-2577` | PORT. Fields become self-describing and in metres; `hitAt` belongs to the move; add events, root-motion curves and sweeps | `engine/anim/moves.ts`, `engine/anim/moves-data.ts` | 6.1 |
| `inArc` and `Attack.hits` | `engine:194`, `engine:2467-2504` | REWRITE: events, weapon sweeps, and a measured `hitShape` cached per move. `inArc` stays as the cheap test | `engine/anim/moves.ts`, `engine/sim/hits.ts` | 6.1, 6.3 |
| Knockdown (rigid rotation of every joint) | `engine:1989-1993` | REWRITE: root rotation and get-up timelines chosen by face up or face down; a ragdoll hand-off later (WP 10.2) | `engine/anim/reactions.ts` | 6.2 |
| Squash spring `kick(v)` | `engine:1788` (`kick`), `engine:1832` (the spring) | PORT as a root-scale channel that preserves volume | `engine/anim/secondary.ts` | 6.2 |
| Hair verlet; cape (two verlet edges) | `engine:1900-1916`; `engine:2033-2068` | PORT as one generic `Chain` (a cape is 2 chains plus a width constraint), with bone-capsule colliders | `engine/anim/secondary.ts` | 6.2 |
| Weapon-trail sampling | `engine:1885-1897` | PORT as socket history | `engine/anim/character.ts` | 3.7 |
| `die` timeline | `engine:1824-1827` | PORT | `engine/anim/reactions.ts` | 6.2 |
| Blob rig update | `engine:2595-2602` | PORT | `engine/anim/blob.ts` | 5.3 |
| Builds: `chibi heroic bulky skeleton`, `size` | `engine` §11 | PORT the skeletal fields in metres. The drawing fields go to the body grammar | `engine/anim/builds.ts`, `engine/gfx/puppets/` | 3.4, 3.8 |
| Visual options: outfits, hair, hats, armor, capes, faces | 2D drawing in `engine` §11 | CONCEPT: re-expressed as puppet body parts | `engine/gfx/puppets/bodies/` | 3.8 |
| `Math.random()` breathing phase (`engine:1782`); variable substeps (`engine:1644`) | | REWRITE: a seeded stream per entity, and a fixed dt | `engine/anim/*`, `engine/core/time.ts` | 3.6, 1.3 |
| `_drawHD`, `_drawClassic`, `_hat`, portraits, the Blob draw, `style:'classic'` | `engine` §11–§12 (about 42 KB) | **DROP** | — | — |
| View hacks: `charView`, `charPitch`, `zBoost`, `_cheat`, `_camSide`, automatic side-plane chops, the ground smear, Blob screen-space wings | `engine:2017, 2087-2093` and others | **DROP**. A 3D camera makes them unnecessary, and they write simulation state from drawing | — | — |

### 5.3 The animation library and its tools (`src/mocap/`, `examples/cmu-lib/`, `tools/anim-*`)

| Item | Size | Verdict | Target | WP |
|---|---|---|---|---|
| `src/mocap/readable.js` (format 1 codec: text, parse, mirror, fit, encode, decode) | 29 KB | PORT: the decode becomes a typed module using the standard `Math`, matching the source within 0.001 mm. The source decoder itself is the test oracle: `tools/anim/legacy-readable.ts` (about 10 lines) runs it from `$MY3D2DGE_SRC` in a `vm`. Adds format-2 fields, a validator and a normalized lens | `engine/anim/clip/readable.ts` | 8.2 |
| `src/mocap/mocap.js` (`load` `clip` `sample` `moveAt` `blend` `text` `replace` `restore` `origin`; `drive`; `Mannequin`) | 20 KB | REWRITE: keep the API and `drive`'s ideas (sole to floor, lift, heading trust ramp, blade along the knuckles and never below the floor, the upper mask). Playback becomes a clip layer on the rotation skeleton. The Mannequin is rebuilt in 3D from `body.segs` with the body grammar | `engine/anim/clip/{library,layer}.ts`, `engine/gfx/puppets/bodies/mannequin.ts` | 8.4 |
| Sets `quaternius.js` (88), `mesh2motion.js` (177), `cmu.js` (60) | 387 / 819 / 722 KB | KEEP THE DATA, repackaged one clip per file (deep-equal proof). The 84 Mesh2Motion re-exports are tagged `alt` | `data/anim/sets/<set>/` | 8.3 |
| `sets/hero.js` (15 clips, Emberdeep's subset) | 75 KB | **DROP** | — | — |
| Catalogs `quaternius.json`, `mesh2motion.json` | 30 KB | COPY | `data/anim/catalogs/` | 8.1 |
| Catalog `cmu.json` | 9.5 KB | COPY, and FIX the license: no resale "even in converted form", plus the NSF acknowledgment, verbatim | `data/anim/catalogs/`, `data/anim/SOURCES.md` | 8.1 |
| Ledger `cmu-takes.tsv` (2,548 takes) | 262 KB | PORT: split into 17 category files plus `subjects.tsv` (join-back proof). Fix the category fallback; verify the 113 takes whose frame rate was assumed (`fps?`) | `data/anim/cmu/` | 8.1, 8.5 |
| `examples/cmu-lib/` (every take, 114 files) | 68 MB | **DROP** from git. Regenerated on demand into `.cache/` | `.cache/anim/cmu-lib/` | 8.5 |
| `tools/anim-import.mjs` (GLB → set; rig maps; fit; provenance) | 24 KB | PORT: split into GLB reader, rig map and importer. Guard CUBICSPLINE and signed or quantized accessors. Add format-2 fields (the default); `--legacy` writes format 1 exactly as today | `tools/anim/` (`x anim import`) | 8.5 |
| `tools/asf-amc.mjs` (ASF/AMC reader, FK, loop-cycle search, floor estimate) | 16 KB | PORT: output rotations too. Interpolating source frames instead of taking the nearest is the default for new imports; `--legacy` keeps nearest-frame sampling, to reproduce today's set | `tools/anim/asf-amc.ts` | 8.5 |
| `tools/cmu.mjs` (find, get, all, survey, library, ledger) | 24 KB | PORT: write to `.cache/`, emit the split ledger, add `--json` | `tools/anim/cmu.ts` (`x anim cmu`) | 8.5 |
| `tools/anim-set.mjs`, `tools/mocap-lib.mjs` | 5 KB | PORT, reading and writing one file per clip | `x anim cut` | 8.5 |
| `tools/anim-sheet.mjs` (contact sheets through Playwright) | 6 KB | REWRITE as a Node renderer that writes SVG; a PNG, when wanted, comes from the browser (as `x sheet` does) | `x anim sheet` | 8.6 |
| `tools/to-glb.py` (Blender: FBX, BVH or blend → GLB) | 3 KB | COPY: optional, with `bpy` pinned | `tools/anim/to-glb.py` | 8.5 |
| `tools/mocap-test.mjs` | 16 KB | REWRITE as Node unit tests (format, provenance, ledger, picks, QA) plus a browser smoke test on both backends | `engine/anim/clip/*.test.ts`, `tests/e2e/library.spec.ts` | 8.6 |
| Mocap Lab (`src/mocap.game.js`, `src/mocap.template.html`) | 43 KB | REWRITE as clip mode in the box, with `x anim` as its machine interface; a Library Lab page is an optional view. Keep the UX: catalog search; the clip as text with Apply, Reset, Mirror and Copy for model; deep links; frame stepping | `labs/box/`, `labs/library/` | 8.9 |
| `docs/MOCAP.md` | 44 KB | PORT: keep the library recipe, provenance, source and license table, the CMU workflow and "Looking ahead"; rewrite the format and retargeting sections | `docs/ANIMATION-LIBRARY.md` | 8.1 |
| `docs/ANIMATION-RESEARCH.md` (40 ranked animations, 24 timing references) | 51 KB | PORT: drop the 2D "Engine" column; add the coverage map against the library | `docs/ANIMATION-RESEARCH.md` | 8.1 |
| `tools/ed-clips-test.mjs`, `ed/96-hero-clips.js` | | **DROP**. Its moments table (`HCL_MOVES`) is design input for the clip-action layer | — | 8.7 |

### 5.4 The 2D engine's other systems

| Item | Source | Verdict | Target | WP |
|---|---|---|---|---|
| `E.rng` (Mulberry32), `E.hash2`, `E.noise2` | `engine` §1 | PORT bit-exact, then add seeded 3D, tiling, octave and cell noise | `engine/core/rng.ts`, `engine/core/noise.ts` | 1.1 |
| Colour: `hex shade mix tones ramp` | `engine` §1 | PORT, adding linear and sRGB conversion | `engine/core/color.ts` | 1.1 |
| Warn-once, red error box, `game.errors` | `engine:65-66`, `engine:1477-1492, 1683-1691` | PORT, adding stable codes, structured records and JSON | `engine/core/log.ts`, `engine/dev/overlay.ts` | 1.2, 2.7 |
| Sound data: 33 effects, 6 drums, 5 songs | `engine` §20 | COPY the data into typed modules, with validators (track length must divide the bar) | `engine/audio/data/` | 9.2 |
| Chip synth (Web Audio: 7 waves, envelopes, sweeps, arpeggios, vibrato, delay, buses, ducking) | `engine:3647-3856` | REWRITE as **pure DSP into `Float32Array`s** (seeded, hashable, runs in Node), plus a Web Audio runtime | `engine/audio/dsp/`, `engine/audio/runtime/` | 9.1, 9.3 |
| Pixel font (5×7 proportional and 3×5) | `engine` §6; compact encoding in the agent edition | PORT, using the compact encoding. It is code, so it needs no font approval | `engine/ui/font.ts` | 6.5 |
| `E.ui.box/bar/hearts`, `Dialog`, `Menu` | `engine` §21 | PORT onto the overlay, with input and sound injected, plus `ui.state()` for tests | `engine/ui/` | 10.6 |
| Input: named actions, presets, edge detection in sim time, `repeat`, `buffered`/`consume`, radial deadzone, clear on blur | `engine:476-694` | PORT the action model. REWRITE the devices: pointer lock, axes, rebinding as data, camera-relative intents, a recorder, a virtual device | `engine/input/` | 3.3 |
| `E.tex` (7 generators: flagstone, grass, dirt, water, planks, checker, plain) | `engine:3057-3101` | PORT as seeded, **tiling** generators with height, roughness and emissive channels | `engine/gfx/textures/generators/` | 2.3, 7.3 |
| Backdrop strips (10 presets, 512 px tiling layers) | `engine` §21b | PORT the generators for a sky cylinder, and add a TSL sky dome | `engine/gfx/sky.ts` | 7.1 |
| `parseLevel` | `engine` §13 | PORT | `engine/world/level/parse.ts` | 2.2 |
| Flow field (4-neighbour BFS) | `engine:3018-3054` | DROP in favour of stress-world's Dijkstra | — | 4.3 |
| `SpatialHash` | `engine:3626-3646` | PORT on typed arrays | `engine/world/spatial.ts` | 4.3 |
| `Bullets` and `E.pattern` | `engine:3553-3625` | PORT to 3D, with swept hit tests (fast bullets pass through targets today) | `engine/world/projectiles.ts` | 6.3, 10.4 |
| Platformer feel: coyote time, jump buffer, variable jump height, wall jump, dash | `engine` §16 | PORT onto the character controller | `engine/physics/character.ts` | 3.2 |
| Scenes, timers (`after`, `every`, `{cancel}`), `E.store` | `engine` §10 (`after`/`every`, `engine:1594-1597`); `E.store` `engine:198-202` (§1) | PORT. Timers run in sim time. The store gains a configurable prefix (today a fixed `my3d2dge:`), a memory backend and versioning | `engine/core/time.ts`, `engine/app/` | 1.3, 2.7, 10.7 |
| WebGPU lighting module's habits (detect, validate, fall back, report status, snapshot for tests, URL switch) | `engine:4329-4650` | CONCEPT for the WebGPU feature registry | `engine/gfx/features.ts` | 2.1 |
| Renderer effect list (outline, flash, afterimages, x-ray, decals, `textAt`), cutaway, wall-foot shadows, the 38-prop catalog with light metadata, view and resolution presets | `engine` §9, §13, §21c | CONCEPT, rebuilt in 3D | `engine/gfx/*`, `engine/world/props/` | 4.5, 6.4 |
| Pixel primitives, canvas lighting, depth-sort renderer, TileMap and PlatformMap drawing and collision, `Body`, `E.style`, `charView`, `Screen`, the 2D views | `engine` §2–§4, §7, §9, §13, §16, §17 | **DROP** | — | — |
| The agent edition (`engine/my-3d2dge-agent.js`) | 217 KB, about three-quarters a verbatim copy of the engine (75–82%, depending on how lines are matched) | **DROP** the copy. Keep its ideas: the comment is the manual, doc examples are executed, token counts are reported | `x docs --check` | 0.6 |

### 5.5 Tooling and workflow (`tools/`, `.claude/`, `CLAUDE.md`, `package.json`, `vercel.json`)

Where a widely used tool does the job, it replaces the prototype's own (doctrine: Common ground). What remains bespoke is what only this engine needs.

| Item | Verdict | Target | WP |
|---|---|---|---|
| `tools/stamp.mjs` (writes the commit into the build at deploy) | Later: release tooling waits for production | — | H |
| `tools/vendor-3d.mjs` (pinned `npm pack`, sha256, `--check`) | **DROP** the vendoring: npm with a lockfile, plus Vite, replace the vendored copies and the import map. Keep its idea of checked pins | `x deps`, `tools/deps.json` | 0.3 |
| `.claude/hooks/session-start.sh` (`npm install`, `CHROMIUM_PATH`) | PORT: run `scripts/setup.sh` (Node 24, then `npm ci`), `x src`, and list open escalations | `.claude/hooks/`, `scripts/setup.sh` | 0.1, 0.10 |
| Virtual clock plus seeded `Math.random`, injected before page scripts run (`tools/filmstrip.mjs:39-53`) | COPY, as a Playwright fixture | `tests/e2e/fixtures.ts`, `tools/lib/browser.ts` | 0.2 |
| Headless WebGPU: flags, a stand-in `getContext('webgpu')`, `__readFrame` readback (`tools/lab3d-test.mjs:70-102`) | COPY, as a Playwright fixture. Verified with r180, Chromium 141 and Playwright 1.64 (§4.7) | `tests/e2e/fixtures.ts`, `tools/lib/browser.ts` | 0.2 |
| Banned-API list (`tools/lab3d-test.mjs:28-43`) | PORT into ESLint's stock rules: extend it with r180's deprecations and the newer names r180 lacks, each naming its replacement; scope by path | `eslint.config.js` | 0.4 |
| Static server that emulates the deploy's routes (copied 4 times) | **DROP**: Vite's dev server replaces it | `vite.config.ts` | 0.2 |
| `tools/test-run.mjs` (path-prefix suite map; list, files, reasons, timing; filters out version-only changes) | **DROP** the runner: Vitest (`--changed`, `related`) and Playwright Test (`--only-changed`, `--list`, `--repeat-each`) select and run the tests; their reporters give the timing | npm scripts `test` and `e2e` | 0.5 |
| `tools/version.mjs` (8 regex places) | Later. Until production the version lives in `package.json` only, and nothing else repeats it | — | H |
| `tools/filmstrip.mjs` (step DSL; A/B/diff contact sheets) | PORT: a 3D frame source, named RNG streams, a tolerance, ID attribution, JSON | `x film` | 3.11 |
| `tools/check.mjs` (scripted play, look notes with fixes, `report.json`) | REWRITE for 3D | `x shot` | 2.6 |
| `tools/ed-sheet.mjs` (character sheet with numeric lints) | SPLIT: the motion checks move to Node (measured at 0.28 s for 24 moves); the sheet becomes 3D cameras × states | `x qa anim`, `x sheet` | 6.6 |
| `tools/labs-test.mjs`, `src/labs.json`, `src/labs.template.html` | PORT for the optional lab pages, adding an `answer` field and an expiry date for temporary labs | `labs/`, `x lab` | 10.8 |
| `tools/agent-test.mjs` | DROP the parity half. Keep doctest extraction (now `@example` blocks), path checks and token counting | `x docs --check`, `x sizes` | 0.6 |
| Patterns in `new-character.mjs --test`, `ed-play.mjs` (step DSL), `ed-balance.mjs` (autopilot plus virtual clock), `ed-smoke.mjs`, `character-check.mjs` | CONCEPT | `x new`, `x film --steps`, `dev/bot`, smoke tests | 5.6, 12.1 |
| `tools/lab3d-test.mjs`, `tools/stress-world-test.mjs` | REWRITE as the box's Playwright suites over the shared fixtures | `tests/e2e/` | 2.7, 3.10 |
| `ed-syntax`, `slice-test`, `ed-build`, the `build.mjs` directives (`@inline-module`, `@inline-head`) | **DROP**: ES modules, `tsc` and Vite replace them | — | — |
| The 14 Emberdeep tools, `tools/stress-test.mjs` (2D), `tools/ed-codex-showcase.mjs`, `docs/assets/` | **DROP** | — | — |
| `vercel.json` (serves committed files; rewrites) | REWRITE when the owner enables hosting: `vite build` from source; no committed output | `vercel.json` or GitHub Pages | 12.5 |
| `CLAUDE.md` rules (version bump, rebuild, `test:changed`, merge, then the full suite in the background) | REWRITE as AGENTS.md, each rule paired with its check, with `x ci --local` as the gate | `AGENTS.md`, `CLAUDE.md` | 0.1 |

### 5.6 Engine-grade patterns harvested from Emberdeep (rebuilt generically, never copied)

| Pattern | Where it lives in the game | Engine feature | WP |
|---|---|---|---|
| Registry `def(kind, id, spec)` | `ed/00-core.js:76-87` | `core/registry`: `defineKind` with a schema (fields, defaults, docs, ranges, required hooks), fallbacks, duplicate warnings | 1.2 |
| "Ask the entry, never the id"; optional hooks with defaults | `ed/18-characters.js:1-4` | Registry hook discipline; shared code never compares ids | 1.2 |
| Event bus with lifetimes; each listener isolated so its failures land in `errors` | `ed/00-core.js:89-100` | `core/events` with scopes, isolation and a trace ring | 1.2 |
| Named seeded RNG streams | `ed/00-core.js:102-117` | `core/rng` | 1.1 |
| Body contract plus `checkRig` (14 states × 2 facings × 5 views) | `ed/18-characters.js:34-48, 82-143` | `anim/check`: body states × facings × camera presets | 3.4, 6.6 |
| Character-sheet lints: pops relative to the neighbouring steps, idle foot slide, joints under the floor, bone stretch over 12%, vanishing views, contrast | `tools/ed-sheet.mjs:107-131` | `x qa anim`, `x sheet` | 6.6 |
| Intent vocabulary (here: body states); body adapters ("what the pattern asks of a Humanoid, spoken to a spider") | `ed/18-characters.js:36-38`, `ed/33-beasts.js:1053-1060` | `anim/states` | 3.7 |
| 16 procedural rig building blocks (eased state weights, reverse-knee IK, critically damped springs, angle blending, sway chains, multi-leg planted gait, lagging parts, path-history chains, verlet strands, look-at and blink, floaters, orbiters and detached parts, delayed pose replay, joint-attached extras, tip trails, animation-measured reach) | `ed/22-char-dan.js`, `ed/21-codex.js`, `ed/33-beasts.js` (`BST_Crawler` :85, `BST_Serpent` :602, `BST_Eye` :858), `ed/36-bosses.js:646-660`, `ed/30-monsters-core.js:31-41` | `anim/proc`, with one new fixture rig per block | 10.1 |
| One attack timeline (wind, active, recover, with progress `u`) shared by the rig, hit windows, telegraphs, AI, the bot and perfect dodges | `ed/25-skills-core.js:69-101`, `ed/93-autopilot.js:62-66` | `anim/moves` `Timeline` | 6.1 |
| Stacked slow motion with ids (the slowest wins), a leaky hit-stop budget, per-entity clocks | `ed/00-core.js:146-161` (slow motion), `ed/10-combat.js:45-76` (hit-stop budget), `ed/30-monsters-core.js:300` and `ed/10-combat.js:320` (per-entity clocks) | `core/time` | 1.3 |
| Telegraph shapes as data with near-miss tests; an attack-token manager | `ed/10-combat.js`, `ed/30-monsters-core.js` | `world/telegraphs`, `world/ai` | 6.4, 5.2 |
| Tuning registry: knobs with tier, range, unit, explanation and source file; overrides; JSON export; a TUNED marker | `ed/01-tune.js`, `ed/62-developer.js`, `TUNING.md` | `core/settings`, `x set` | 1.2, 2.7 |
| Developer sandbox (throwaway save, god mode, freeze AI, step, speed, spawn, travel) | `ed/62-developer.js` | `dev/actions` (`registerDevAction`), reachable from `x` and `__engine` | 5.6 |
| Autopilot (a virtual device, a progress watchdog, stuck detection measured along the wanted direction, reproducible runs) | `ed/93-autopilot.js` | `dev/bot` (navigation and watchdogs, no combat tactics) | 5.6 |
| Gallery of everything registered, with deep links and wrong-name warnings that list the valid names | `ed/92-gallery.js` | `dev/gallery` and `x gallery` | 7.7 |
| Performance governor with hysteresis | `ed/95-perf.js` | `dev/governor`, which owns the WebGPU features, presentation LOD and resolution (never sim LOD) | 7.5 |
| Controls rebinding (conflicts, reserved keys, persistence, any gamepad slot, separate menu actions, a touch layer, safe areas) | `ed/61-controls.js`, `docs/CONTROLS-AUDIT.md` | `input/bindings` (touch waits for Phase H) | 3.3 |
| Data-defined layered sound effects, tracker-string songs, stings fired by events | `ed/70-audio.js` | `audio` (the mechanism, not Emberdeep's sounds) | 9.2, 9.3 |
| Captured clips layered on a procedural rig (masks, crossfades, walk/hold/next flags, cancel rules, landmark times) | `ed/96-hero-clips.js` | `anim` clip-action layer and events | 8.4, 8.7 |
| Deep links, a debug handle, a step-script DSL | `ed/99-start.js`, `tools/ed-play.mjs` | `app/routes`, `dev/inspector`, `x film --steps` | 2.7, 3.11 |
| Composition (role-based selection, a novelty scheduler, name grammar, recolouring with a luminance guard) | `ed/35-bosses-core.js:170-171`, `ed/50-levels-core.js:70-72, 329-335` | `engine/compose`, built when the first game needs it (backlog) | — |
| Saves isolated in demo, sandbox and gallery modes; deduplicated errors and warnings | `ed/` various | `app/store`, `core/log` | 10.7, 1.2 |

### 5.7 Excluded: never ported and never remade

**From Emberdeep (`src/emberdeep/`, every file):**
- **Skills and progression:** skills and runes; progression, the passive tree and mastery.
- **Rules and numbers:** the `STATS` vocabulary; damage formulas; elements and statuses; balance numbers, knob defaults and `SCALE` curves.
- **Enemies:** monsters, their AI and affixes; bosses, boss bodies and the boss pattern library.
- **World:** loot, crafting and the stash; the 15 mechanics; `PLAN`, themes, layouts, level names and pacing; the town of Emberhold and its NPCs.
- **Characters:** the Wanderer, Codex and Dan, as characters.
- **Presentation:** game UI screens and texts; Emberdeep's songs and sound effects; the clip-to-moment table; the docs `CHARACTERS.md`, `DAN.md` and `CODEX.md` (their lessons live on in §4.6 and §13); `docs/assets/`.

**The 2D engine and its products:**
- `engine/my-3d2dge.js`, except what §5.2 and §5.4 take;
- `engine/my-3d2dge-agent.js`;
- `src/starter/` (the genre kits). Two pieces are taken only as design input: the Animation Lab's UX (WP 10.8) and the blob leap parameters (WP 5.3);
- `src/arena.*`;
- `src/stress.game.js` (the 2D stress test);
- `src/lab.*` (the perspective lab);
- `src/free-camera.*`;
- `src/shapes-*`;
- `examples/` and `dist/` (build outputs);
- the scarfrunner prototype.

**The Stress Box's own content stays sample content.** Its levels, cast, behaviours, waves and numbers live in `labs/box/`. They are rebuilt neutrally (walkers, slimes and wisps as plain shapes), never Emberdeep's monsters, and the engine takes from them only generic mechanisms.

**Grey areas become new fixtures, never ports:**
- **A neutral test mannequin**, not the Wanderer (WP 8.4).
- **A neutral hero body** for the box (WP 3.8).
- **Six small fixture rigs** (80–150 lines of geometric primitives each): a digitigrade biped, a hexapod, a serpent (path chain), a floater, a multi-arm and a tentacle. `fixtures/rigs/README.md` maps each of the 16 building blocks to at least one of them (WP 10.1).
- **Combat fixtures:** a training dummy, neutral `test_*` patterns, surface tags and damage types (WPs 6.1, 6.3).
- **A small fixture sound set and one demo song** for tests and the gallery, alongside the engine's own ported presets (WP 9.2).

---

## 6. Target architecture

### 6.1 Layers and import rules

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ app/    createEngine, loop wiring, routes and deep links, store                    (may import all) │
│ dev/    inspector (__engine), overlay, actions, gallery, bot, governor, stats      (all but app)    │
├──────────────────────────────── PRESENTATION (reads sim snapshots; never writes them) ─────────────┤
│ gfx/ (three.js)   gfx/enhanced/ (WebGPU-only, via gfx/features)   audio/runtime (Web Audio)          │
│ ui/ (overlay canvas/DOM)   input/devices (DOM events → intents)                                      │
├──────────────── SIM-SIDE (reproducible; runs in Node; no DOM, renderer or Web Audio) ───────────────┤
│ sim/ (world, systems, scenes, state, hash, replay, hits, level bodies)                                │
│ physics/ (the only Rapier import)   anim/ (skeleton, layers, IK, moves, clips, proc)                  │
│ world/ (level compiler, nav, spatial, props data, steering, ai, projectiles)   input/intents   audio/dsp │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ core/   math (three.js's math classes), rng, noise, hash, color, time, events, registry, log,       │
│         settings, schema                                                                           │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Allowed import edges**, checked by ESLint (`eslint.config.js`: one `no-restricted-imports` block per layer, each message naming the rule):

| Module | May import |
|---|---|
| `core` | nothing from the engine. `core/math.ts` alone imports `three/webgpu`, and only its math classes (`allowImportNames`) |
| `anim`, `world`, `input/intents`, `audio/dsp` | `core` |
| `physics` | `core` and Rapier |
| `sim` | `core`, `anim`, `physics`, `world`, `input/intents` |
| `gfx` | `core`, `anim` (pose evaluation), `world` (mesh and level descriptors), sim **types, snapshots and the read-only `QueryView`**, and three.js (`three/webgpu`, `three/tsl`, `three/addons/*`) |
| `gfx/enhanced/*` | `gfx`, `core`. Imported **only** by `gfx/features.ts` |
| `audio/runtime` | `audio/dsp`, `core`, sim snapshot types and the `QueryView` (occlusion rays) |
| `ui` | `core`, `input/intents`, `gfx` (camera projection, overlay sizing) |
| `input/devices` | `core`, `input/intents`. `app` passes the camera in |
| `dev` | everything except `app`. `dev/bot.ts` is sim-side, so it imports only the sim-side layers |
| `app` | everything |
| `labs/box/scenes/`, `labs/box/cast/`, `fixtures/scenes/` | the engine's sim-side layers only, so `x sim` runs them in Node |
| `labs/box/` (the rest) | the engine's public API (`engine/index.ts`) |

**Reaching physics from presentation.** Presentation code reaches physics only through the read-only **`QueryView`** that `sim.snapshot()` returns (`raycast`, `probe`, `overlap`). It never imports `physics/`. The chase camera's wall avoidance and audio occlusion both use it.

**Data descriptors.** `world` holds data descriptors (a prop names its geometry, material and body by id; a level yields mesh descriptors). `gfx` turns those descriptors into meshes.

**Single owners:**
- Only `physics/` imports Rapier.
- Only `gfx/` imports three.js's renderer, scene, material and TSL classes. Every other layer gets three.js's math classes (`Vector3`, `Quaternion`, `Matrix4`, `Euler`, `Box3`, `Sphere`, `Ray`, `Plane`, `MathUtils`) through `core/math`, so all layers share one set of math types and `three/webgpu` is the one entry point.
- Only `audio/runtime/` touches Web Audio.
- Only presentation code (`gfx`, `audio/runtime`, `ui`, `input/devices`), `dev` and `app` touch browser APIs (DOM, canvas, URL, Web Audio). URL parameters are parsed once, in `app/routes`, and passed down.
- Tests and tools may import anything.

### 6.2 Repository layout

```
my-3dge/
  DOCTRINE.md               the owner's doctrine; it governs this plan. Agents edit it only when the owner asks (§8.10)
  AGENTS.md                 the rules; each one paired with the check that enforces it (Appendix E)
  CLAUDE.md                 "@AGENTS.md" plus Claude Code specifics
  PLAN.md                   this plan (the ledger in §14 is updated as work lands)
  README.md  LICENSE (MIT)  package.json  package-lock.json  .nvmrc (24.21.0)
  tsconfig.json  vite.config.ts (dev server, build, and Vitest's settings)  playwright.config.ts  eslint.config.js
  .prettierrc.json  x.js (`node x <cmd>`: registers tsx, then runs tools/x.ts)
  engine/                   TypeScript (strict), ES modules, extensionless imports, unit tests beside the code (*.test.ts)
    index.ts                the public API barrel; its file comment is the engine's front page
    core/  sim/  physics/  anim/  anim/clip/  anim/proc/  world/  world/level/  world/props/  input/
    audio/dsp/  audio/data/  audio/runtime/  gfx/  gfx/materials/  gfx/textures/  gfx/geometry/  gfx/level/
    gfx/puppets/  gfx/cameras/  gfx/post/  gfx/fx/  gfx/enhanced/  ui/  dev/  app/
  labs/
    box/                    THE STRESS BOX: index.html, main.ts (page wiring), scenes/ (sim-side scene modules),
                            levels/*.txt, cast/ (sample monsters and behaviours), bodies/, README.md
    hello/                  the harness smoke page (WP 0.8)
    (optional views from WP 10.8: anim, materials, props, fx, cameras, physics; library from WP 8.9)
  data/
    fonts/                  approved fonts only (doctrine: Assets), each with its license; empty until one is needed
    APPROVED-BINARIES.json  binaries the owner approved, each with its escalation record
    anim/                   sets/<set>/<Clip>.json, sets/<set>/_set.json, sets/<set>/catalog.tsv,
                            catalogs/*.json, cmu/<category>.tsv, cmu/subjects.tsv, SOURCES.md, LICENSES/ (Phase 8)
  fixtures/                 test-only content: kernel scenes, bodies, a training dummy, fixture rigs, sounds
  scripts/
    setup.sh                installs the pinned Node when the container lacks it, then `npm ci` (WP 0.1)
  tools/
    x.ts                    the `x` dispatcher: `node:util` parseArgs, help, report.json, exit codes
    cmd/<name>.ts           one module per `x` command; its file comment is its help
    qa/<family>.ts          content QA families (anim, geo, tex, audio, level) plugged into `x qa`
    eslint/                 the local ESLint plugin, for the few rules no stock rule expresses
    templates/<kind>/       scaffold templates for `x new` (each re-tested by `x ci --local`)
    ci/ci.yml               the GitHub Actions workflow, installed into .github/workflows/ only once the owner allows it
    deps.json               every dependency: its qualifying release, its pin, their dates, and why it is used
    lib/                    report, browser (launch options, page setup), source, tokens, hash, vite (a dev server for x)
    anim/                   GLB reader, rig maps, importer, ASF/AMC, CMU, to-glb.py (Phase 8)
    mcp/                    MCP server bridging __engine (WP 7.6)
  tests/
    e2e/                    Playwright Test suites (*.spec.ts), projects webgpu and webgl2; fixtures.ts
    replays/                *.replay.json: inputs and expected hashes, keyed by runtime
    pages/                  test pages: replay.html (sim only), scene.html (fixture scene plus gfx)
    unit/                   Vitest tests that don't sit beside a module (data checks, hooks, the type smoke test)
    baselines/              text thumbnails (per backend), QA baselines with reasons, advice and perf budgets
  docs/
    INDEX.md  API.md  ERRORS.md          generated by `x docs --write`, checked for drift
    research/                            the eight studies of my-3d2dge behind this plan (point-in-time; not drift-checked)
    decisions/ADR-0001-*.md …            one per decision in §13
    escalations/ESC-0001-*.md …          one per escalation, with the call made (§8.14)
    THREE-DELTA.md                       the pinned three.js for agents who know newer releases or the prototype's r182
    reference/three-tsl-wiki.md          the TSL wiki page as it stood for the pinned three.js (its revision in its header)
    TESTING.md  ANIMATION-LIBRARY.md  ANIMATION-RESEARCH.md
  evals/                    agent-usability tasks with automated acceptance (WP 12.2)
  .claude/                  settings.json, hooks/, skills/, agents/
  (git-ignored)  out/  dist/  .cache/  node_modules/  test-results/
```

### 6.3 Conventions

The formulas are in Appendix C.

- **Units.** SI throughout: metres, seconds, kilograms, radians. Colours are hex strings in data, linear floats in shaders, and sRGB on output.
- **Axes.** Right-handed. **+Y is up**; the ground is the XZ plane.
  - Characters face **+Z** at yaw 0, matching glTF and three.js `Object3D.lookAt`.
  - Yaw ψ is a rotation about +Y, and forward(ψ) = (sin ψ, 0, cos ψ).
  - Body-local authoring uses `B(f, r, u)`: forward, right, up, with right = forward × up.
- **Port conversion from my-3d2dge.** Its frame is x east, y south, z up, 16 units to the metre, which is **left-handed**:
  - positions: `(x, y, z)/16 → (x, z, y)`;
  - facing: φ becomes yaw ψ = π/2 − φ;
  - gravity: −480 u/s² becomes −30 m/s².
  - Mocap's (f, r, u) frame needs exactly one reflection: f→+Z, r→−X, u→+Y. Prove it with an asymmetric clip.
- **Time.**
  - The simulation runs at a fixed **60 Hz** (`SIM_DT = 1/60`), at most 6 steps per frame, and drops the backlog after a stall.
  - Rendering interpolates between the last two sim states.
  - Gameplay timing is measured in sim ticks or sim seconds.
- **Randomness.**
  - Named streams: `rng('ai')`, `rng('spawn')`, `rng.entity(id, 'anim')`, all derived from the scene seed.
  - Visual streams (`fxRng`) are separate, so adding a particle never changes the AI.
- **Ids.**
  - Registry content uses strings namespaced by kind (`move:slash`, `prop:crate`).
  - Entities use monotonic integers, iterated in id order.
- **Files.**
  - `camelCase.ts`, one concept per file, opening with the file comment from §6.8.
  - Unit tests sit beside the code (`time.test.ts`); browser suites live in `tests/e2e/` (`*.spec.ts`).
  - Imports are extensionless relative paths or package names, resolved the way Vite and tsx resolve them (`moduleResolution: bundler`). Type-only imports use `import type`.
  - Prettier decides the formatting.

### 6.4 The frame model

```
frame(now):                                                  // app/loop.ts
  intents = input.devices.sample(camera)                    // presentation → intents (move is camera-relative and the
                                                            //   camera heading is included, so it is recorded)
  n, alpha = clock.advance(now)                             // fixed 1/60 steps, ≤ 6, timescale stack applied
  repeat n:  sim.step(intents)                              // systems in a fixed, documented order:
               intents → ai → anim.step (timelines, events, root motion, state weights) → physics.step
               → readback → rules (hits, damage, spawns, despawns) → events flushed
  view.update(sim.snapshot(), alpha)                        // VIEW STATE: pose evaluation (LOD by distance allowed),
                                                            //   secondary chains, particles, camera, shake, listener
  gfx.render(); audio.update(); ui.render()
```

- **Inputs across several steps.** When one frame runs several steps, edges (`pressed`) apply to the first step only, and held state repeats. Replays record the intents of every step, so playback never depends on frame timing.
- **Two animation paths.**
  - `anim.step` runs in the sim for every character, every tick. It is cheap and part of the gameplay hash.
  - `anim.pose` runs in the presentation for characters that are drawn. It may be LOD'd and is not part of the gameplay hash.
  - A character marked `preciseHits` has its pose evaluated in the sim, so weapon sweeps can hit. That evaluation never depends on visibility.
  - This removes the prototype's leak where the visibility set drove animation (§4.1).
- **Feel effects are split by layer.**
  - Hit-stop and slow motion change sim time, so they are sim decisions: rules trigger them, never particles.
  - Screen shake is camera-only.
  - Particles never call into the sim.

### 6.5 The reproducibility contract (doctrine: Reproducible)

1. **Sim-side code never uses** `Math.random`, `Date.now`, `performance.now`, `setTimeout`/`setInterval`/`requestAnimationFrame`, the DOM, three.js's renderer or scene classes, or Web Audio. ESLint enforces it (Appendix B).
   - **It does use the standard `Math`** and three.js's math classes (through `core/math`), as agents write them everywhere else (doctrine: Common ground). Each runtime gives the same results run after run.
   - **Node and Chromium are two runtimes.** On the platform they differ by 1 ulp on some `Math.sin` and `Math.cos` results (§4.7), so a long run of a chaotic scene drifts apart between them. Nothing compares a Node hash with a Chromium hash: each runtime has its own golden hashes (item 7).
2. **Fixed step, explicit inputs.**
   - Everything the sim reads from outside arrives in the per-step intents, and is recorded. That includes the camera heading and any presentation fact gameplay chooses to use.
3. **Ordered world.**
   - Entities iterate in id order.
   - Spawns and despawns queue up and apply at step boundaries.
   - Rapier bodies are inserted in a deterministic order.
4. **Physics.**
   - `@dimforge/rapier3d-compat` 0.19.3, the standard build. It gives the same state run to run, and the same state in Node and in Chromium on the platform (§4.7).
   - The SIMD build (`@dimforge/rapier3d-simd-compat`, the same version and API) is a drop-in swap for speed. WP 5.1 measures both on the crowd ladder and adopts SIMD only if it pays (doctrine: Common ground).
   - Integration parameters are pinned in one table.
   - The build and version are recorded in replays, because snapshots are version-locked.
5. **The hash.**
   - It is FNV-1a over the float64 bits of the canonical state, plus the state of every **sim** RNG stream (those made by `rng()` or `rng.entity()`), plus every Rapier body's translation, rotation, linear velocity and angular velocity, in handle order.
   - Snapshot bytes are never hashed: they do not re-serialize identically after a restore, and at 5,000 bodies they are 5.7 MB.
   - Visual streams (`fxRng`) belong to presentation and are never hashed.
   - The canonical state is the components each kind registers, with their fields in order.
   - It is computed at checkpoints during play (every 60 steps by default), and every step in tests.
   - `trace()` gives per-entity hashes, so a mismatch names the first step, entity and field that diverged.
6. **Capture, restore, replay.**
   - `capture()` covers the whole sim: entities, components, timers, RNG states and the Rapier world. Any live session can be recorded and replayed, and any captured state restored.
   - The engine's own state round-trips exactly. **Rapier's does not once bodies touch:** a restored world drifts away from the uninterrupted run (by 5 cm to 1.5 m over 300 steps, §4.7). A restore is deterministic, though: two restores of one capture continue identically, in every runtime.
   - So **a capture canonicalizes:** `capture()` snapshots the Rapier world and immediately restores the live sim from that snapshot. The live run then continues exactly as any later restore of the capture will. A capture costs about 30 ms at 5,000 bodies, so it happens when a recording starts, on a save, and in tests, never on a timer.
7. **Golden hashes are keyed by runtime** (`linux-x64 node24`, `linux-x64 chromium141`). On another runtime or platform, tests run each replay twice and compare the runs, and report "golden: other runtime". Exact parity across browsers, operating systems and hardware is not required (doctrine: Reproducible).
8. **The proof matrix**, on the development platform:

   | Run | Compared with |
   |---|---|
   | A replay in Node, three times | Node's golden hashes |
   | The same replay in Chromium, sim only (`tests/pages/replay.html`), three times | Chromium's golden hashes |
   | The same replay in the scene's own page, rendering on WebGL 2 and on WebGPU | Chromium's golden hashes: rendering never changes play (doctrine: GPU-free gameplay) |
   | Live play on each backend, recorded and replayed in a sim-only Chromium page | the live hashes; this catches renderer writes |
   | capture → restore → continue, twice | the run that made the capture, which canonicalized itself |

   Other browsers and cross-platform runs wait for Phase H.

### 6.6 Data-first registries and schemas

- **Defining and validating content.**
  - `defineKind(kind, schema)` declares fields, defaults, ranges, units, docs, required hooks and fallbacks.
  - `def(kind, id, spec)` validates, writing plain-sentence errors with codes.
  - `get(kind, id)` warns once on a missing id and returns the kind's fallback.
  - `list(kind)` enumerates.
- **Ask the entry, never the id.** Shared code reads an entry's optional hooks, each with a default. A local ESLint rule flags string comparisons against registered ids in shared code.
- **Every kind automatically gets** an `x describe <kind>` listing (in a page, `__engine.describe(kind)`) and its row in
  `docs/INDEX.md`.
- **The kinds listed in §8.13 also get** a scaffold template and a `gallery` hook, which WP 7.7 turns into a contact sheet.
- **Kinds with a QA family (§8.6) get** its checks. Other kinds get these extras only when a WP shows they pay off.
- **Initial kinds:** `material`, `texture`, `geometry`, `body` (a puppet body), `skeleton`, `build`, `move`, `pose`, `stance`, `rig` (custom procedural), `prop`, `glyph` (level legend), `level`, `light`, `sky`, `look` (post preset), `emitter`, `telegraph`, `actionmap`, `setting`, `scene`, `feature` (a WebGPU feature), `actor` (an entity template: a body, a controller and a character animator), `devAction`. The expansions add `action`, `clipset`, `sfx` and `song`.

### 6.7 Rendering: WebGPU first, WebGL 2 fallback, and the play-alike contract (doctrine: GPU-free gameplay)

- **WebGPU is the primary renderer.** Visual work is developed against it first. **WebGL 2 is the fallback**, for players without WebGPU and for agents without a GPU; `?backend=webgl` forces it.
- **Baseline features run on both backends.** Everything the player needs in order to play is drawn by them, with no compute. The one exception is a "map" kernel listed in `BASELINE_COMPUTE` (`engine/gfx/features.ts`), which the WebGL backend emulates, each with a test on both backends.
- **Classic three.js first** (doctrine: Common ground). Baseline materials are the classic ones agents know: `MeshStandardMaterial`, `MeshLambertMaterial`, `MeshToonMaterial`, `MeshBasicMaterial`, `LineBasicMaterial`, `PointsMaterial`, `SpriteMaterial`. `WebGPURenderer` converts them to node materials on both backends (measured, §4.7). TSL node materials come in only where a classic material cannot do the job: the ID pass's flat override, the outline push, procedural effects. Textures are `DataTexture`s from CPU generators, which Node tests can hash; post-processing uses r180's `PostProcessing` with the built-in TSL display nodes; built-in addons come before custom passes.
- **WebGPU features** add looks or speed only. Each registers `def('feature', id, { requires, fallback, costMs, visualOnly: true })`, where the fallback may be "off". It is gated by a capability check (`float32-filterable`, `timestamp-query`, limits…), owned by the performance governor and reported by `__engine.info()`. Every downgrade logs an advice code: **nothing falls back silently.** Compute, storage buffers, indirect draws and atomics live only under `engine/gfx/enhanced/`. Each feature is built when a measurement or a look the box needs calls for it (Phase 11).
- **The play-alike contract:**
  1. The same replay gives Chromium's golden hashes on WebGPU and on WebGL 2, with the scene rendering at least every 10th step.
  2. Live play on each backend, recorded and replayed headless in a sim-only Chromium page, reproduces the live hashes.
  3. On each backend, the gameplay entities in view appear in the ID pass: the fallback is playable.
  4. Looks and performance may differ. Visual baselines (text thumbnails, look metrics) are kept per backend; nothing compares images or ID passes across backends.
  5. Turning a WebGPU feature on or off never changes the hash.
- **Post-processing masks come from a separate pass, not MRT.** The prototype's MRT graph renders black on r180's WebGPU backend (§4.7). A mask pass (the ID pass's flat override technique) works on both backends and never recompiles materials when a filter toggles.
- **Version quirks are contained** in one module each (Appendix B): the instancing service (`InstanceNode`'s 1,000-instance uniform path; `StaticDrawUsage` with update ranges), the pipeline counter (the one reader of renderer internals), and the outline's `positionGeometry`.

### 6.8 File and export comments (JSDoc: the comment is the manual)

Every module opens with a JSDoc file comment, and every export carries its own doc comment. These are the standard forms that editors, TypeScript and every agent already read (doctrine: Common ground).

```ts
/**
 * @file What this module is for, in one or two sentences.
 *
 * Invariants: units, ranges, reproducibility, ownership; what must always hold.
 *
 * @example
 * const clock = createClock({ hz: 60 });   // x docs --check runs this
 * @see engine/core/time.test.ts
 */

/** Advances the clock by `dt` seconds and returns the number of fixed steps to run. */
export function advance(clock: Clock, dt: number): number { … }
```

- File comments run **40 lines or fewer**. ESLint requires them (`jsdoc/require-file-overview`).
- `docs/INDEX.md` (module → purpose → exports → tests) and `docs/API.md` (each export with the first sentence of its doc comment) are generated by `x docs` through the TypeScript compiler API. The export list comes from the code itself, so it cannot drift.
- `docs/ERRORS.md` is generated from the codes each module registers (`defineCodes`).
- **Prose is never duplicated.** README, AGENTS.md and the docs point to these files and never restate them.

### 6.9 Public API sketch (illustrative; WPs refine it)

```ts
// labs/box/scenes/hall.ts: sim-side, so it also runs in Node
import { defineScene } from '../../../engine/sim/scene';

export default defineScene('box:hall', {
  level: 'level:hall',                                       // labs/box/levels/hall.txt, compiled by the legend
  settings: { crowd: 1000, props: 40, mix: 'balanced' },     // schema-checked; x set / URL / __engine.set change them
  setup(w) {
    w.spawn('actor:hero', { at: 'spawn:hero' });
    w.spawnCrowd('actor:walker', { count: w.settings.crowd, near: 'spawn:crowd' });
  },
  step(w, intents) { /* the box's sample behaviour at 60 Hz: read intents and components, write components */ },
});

// The page (labs/box/main.ts):
import { createEngine } from '../../engine';
const engine = await createEngine({ canvas, backend: 'auto', look: 'toon', seed: 1 });
await engine.start('box:hall');

// Node, no browser:
import { createHeadless } from '../../engine';
const h = await createHeadless({ scene: 'box:hall', seed: 1, settings: { crowd: 100 } });
h.step(600, script); h.hash(); h.trace(); h.state();
```

### 6.10 Dependencies, versions and the toolchain (doctrines: Common ground, Mastery)

**The rule** (doctrine: Mastery):
1. Find each dependency's **qualifying** release: the newest one at least 12 months old.
2. Pin the newest release that is **backward compatible** with it, and **adopt it immediately**. By semver, that is the newest release in the same major for packages at 1.0 or later, and the newest patch in the same minor for 0.x packages.
3. A release that semver calls breaking (a new major; a new minor of a 0.x package, such as each three.js `r` release) is adopted immediately too, but only if it **works the same way**: its upstream migration notes touch no API or behaviour the engine uses, and every suite passes unchanged on it.
4. Anything else waits until it qualifies by age, then arrives as an upgrade work package (§9, "Upgrades").
5. **Write to the qualifying release's API.** A feature that is newer than the qualifying release waits until it qualifies, unless an ADR says otherwise. Adopting a compatible release keeps its fixes, not its novelties, so agents' existing knowledge still applies.
6. **The platform follows the same rule** through the environment: Node's newest qualifying LTS line (odd Node lines never get LTS and are skipped), and the container's Chromium (doctrine: Discovery first).

§4.7 has today's pins, their dates and the next lines. `tools/deps.json` records them, with each dependency's reason for being here.

**The toolchain** (doctrine: Common ground). These are the most widely used tools for each job, and every agent knows them:

| Job | Tool | Front door |
|---|---|---|
| Language and types | TypeScript 5.9.3, strict; `module: esnext`, `moduleResolution: bundler`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `skipLibCheck` (for Rapier's `raw.d.ts`) | `npm run typecheck` |
| Dev server and build | Vite 7.3.7: multi-page (`labs/*/index.html`, `tests/pages/*.html`), TypeScript served with source maps | `npm run dev`, `npm run build` |
| Unit tests (T1) | Vitest 3.2.7, Node environment, `*.test.ts` beside the code; the JSON reporter writes `out/test/report.json` | `npm test` |
| Browser tests (T2) | Playwright Test 1.64.0, projects `webgpu` and `webgl2`, the platform's Chromium through `launchOptions.executablePath`, Vite as the `webServer`; the JSON reporter writes `out/e2e/report.json` | `npm run e2e` |
| Lint | ESLint 9.39.5 with `typescript-eslint` 8.71.1 (its recommended rules, without type information, so T0 stays fast), `eslint-plugin-jsdoc` 61.7.1, `globals` 16.5.0 | `npm run lint` |
| Format | Prettier 3.9.9, print width 120 | `npm run format` |
| Engine commands | tsx 4.23.15, under `x.js` | `node x <cmd>` |
| T0 | All of the first five, plus `node x check` (the repository checks no standard tool covers) | `npm run check` |

**Runtime dependencies** (exact pins, a lockfile, `npm ci`):
- `three@0.180.0`. Vite serves it from `node_modules`, and Node imports the same files. Engine code imports `three/webgpu`, `three/tsl` and `three/addons/*`. Vite aliases a bare `three` to `three/webgpu`, as three.js's own WebGPU examples do in their import map, so the addons that import `three` share one module with the engine.
- `@dimforge/rapier3d-compat@0.19.3`, which inlines its WASM.
- Nothing else without an escalation (§8.14).

**Development dependencies** (exact pins, the same lockfile): those in the table, plus `@types/three@0.180.0` and `@types/node@24.19.2`. WP 7.6 adds `@modelcontextprotocol/sdk`. Each arrives with its reason in `tools/deps.json`.

**Dependency install scripts.** npm 11 (Node 24) skips them unless `package.json`'s `allowScripts` approves them. esbuild's postinstall is the only one, and Vite works without it, so `allowScripts` denies it explicitly.

**The platform:**
- **Node 24.21.0**, named in `.nvmrc`. The container ships Node 22.22.0, so `scripts/setup.sh` downloads the official 24.21.0 build from nodejs.org, checks its SHA-256, installs it under `~/.cache/my3dge/` and puts it first on `PATH` for the session (the SessionStart hook runs it; §8.10). The owner can make it permanent through the environment's setup script (§11.5). Everything also runs on Node 22 (measured), but Node goldens are recorded on 24.
- **Chromium 141.0.7390.37**, the container's (`/opt/pw-browsers/chromium`, from `CHROMIUM_PATH` when set). Playwright 1.64 drives it through `executablePath`; nothing ever runs `playwright install`.

**Adopting and upgrading.**
- `node x deps --update` runs at the start of every WP. It asks the registry for newer compatible releases and adopts them in a commit of their own (`deps: adopt compatible releases`), which must pass T0–T2 and re-baselines anything that changed, with the reason recorded.
- `node x deps --qualify` runs at every gate. It lists the lines that have newly qualified, which become upgrade WPs (§9, "Upgrades"). An upgrade WP also checks the next release against the one that just qualified (rule 3).
- `node x deps --check` (offline, in T0) fails when a pin differs from `tools/deps.json`, or when a dependency has no recorded reason.

**Pinned knowledge for agents:**
- The pinned packages' own sources and types in `node_modules`: three.js's `src/` carries its JSDoc, and `@types/three` turns a name the pinned release lacks into a type error.
- `docs/THREE-DELTA.md` explains the pinned three.js to agents who know newer releases (`RenderPipeline`, `DynamicLighting`…) or the prototype's r182.
- `docs/reference/three-tsl-wiki.md`: the TSL wiki page at the last revision before the next three.js release (`00d6fe7` for r180), since r180's API pages do not cover WebGPU or TSL.
- ESLint's bans name each replacement (Appendix B). **Any three.js deprecation warning fails a test.**

---

## 7. Improvements over the prototype

Each improvement is owned by a work package. A WP is not done until the improvements it lists are in.

| Id | Improvement | What it fixes or replaces | WP |
|---|---|---|---|
| I-01 | One coordinate system: SI units, +Y up, +Z forward, used end to end | `toThree` swaps, quaternion sign flips, a left-handed engine frame | 0.1, 3.4 |
| I-02 | True fixed-step loop with an accumulator and interpolation. Injectable clock, timescale stack, per-entity clocks, leaky hit-stop budget | Variable substeps that make play irreproducible; rigs that depend on the refresh rate | 1.3 |
| I-03 | The sim runs headless in Node: replay and proof suites take milliseconds | The sim could not run without `renderer.init()` and meshes | 1.4–1.6 |
| I-04 | Replay files: record from live play, assert hashes per tick, bisect to the first step, entity and field that diverged | No input recording; only one scripted run | 1.5 |
| I-05 | A strong hash: float64 canonical state, RNG states, Rapier snapshot, per-entity trace | A float32 hash of a few fields; no velocities, RNG or corpses | 1.1, 1.4 |
| I-06 | Reproducibility on the development platform, measured per runtime: standard `Math` and three.js's math in the sim, golden hashes kept for Node and for Chromium, browser-recorded play verified in headless Chromium, Rapier's `compat` build measured identical in both, and captures that canonicalize Rapier so restores continue exactly | Proven only inside one Chromium page, with no golden value | 1.5, 3.1 |
| I-07 | A real play-alike proof: replays rendered on each backend give Chromium's golden hashes, and live play recorded on each backend replays headless to the same hashes, at every box stage | Parity that held by construction (no rendering between proof steps) | 2.7, 3.10, 4.6, 5.7, 6.7, 7.8 |
| I-08 | Rotation skeleton (root + 23 joints): skinning, bone masks, slerp blending, additive layers, ragdolls, native head and hand orientation | Joint positions only; `mocapTilt` side channels | 3.4 |
| I-09 | An explicit, inspectable layer stack. Unknown pose or move names warn with suggestions. Drawing never writes sim state. View hacks are gone | Priority hidden in lerp order; silent typos; `_cheat`, `_pitch`, `_camSide` | 3.6, 3.7 |
| I-10 | Moves as timelines with events (`hitOpen`, `footstep`, `land`…), hit volumes (sweeps plus a measured `hitShape`) and root-motion curves | Flat ground cones; `hitAt` depended on how the attack was built | 6.1 |
| I-11 | New animation capabilities: directional reactions, get-ups, ragdoll hand-off, foot planting, look-at and aim, hand IK, and an **ACTIONS** layer (multi-beat sequences with held contact frames) | Thin reactions; the "missing layer" named in ANIMATION-RESEARCH | 3.5, 6.2, 8.7, 10.2 |
| I-12 | 16 procedural creature building blocks, exercised by six fixture rigs (each block used by at least one) that pass their checks | Techniques trapped inside game characters | 10.1 |
| I-13 | Library format 2: a superset with events, contacts, props, hands, foot roll and root yaw. Clips baked to rotation tracks. A validator and a normalized lens. One file per clip. A split ledger. `x anim find`. Corrected licenses. CMU on demand (68 MB → 0 committed) | Point blending that shortened bones; pops `fit` cannot see; the license gap; 68 MB of churn | 8.1–8.6 |
| I-14 | Re-import from the original sources for the missing degrees of freedom: hands, forearm twist, foot roll, spine, root yaw | Fidelity never stored | 8.8 |
| I-15 | three.js r180, chosen for mastery, with its quirks contained in one place each: the 1,000-instance uniform path and its buffer usage, MRT on WebGPU, `positionLocal` after instancing | Workarounds scattered through the page; a pin chosen for novelty | 0.3, 2.1, 3.8 |
| I-16 | WebGPU features with capability checks and declared fallbacks, owned by the governor and never chosen silently | A blanket ban on compute, or silent fallbacks | 2.1, 11.1 |
| I-17 | A fixed light pool with a budget manager (the count never changes, so shaders never rebuild) plus a shadow-caster budget; tiled lighting as an optional WebGPU feature | 42 fixed lights in every lit shader | 7.1, 11.5 |
| I-18 | A warm-up registry using `compileAsync` with progress, plus a public pipeline counter. "Zero pipelines compiled after warm-up" becomes a test | Reading the private `renderer._pipelines`; stalls after filter toggles | 2.1 |
| I-19 | An instancing service that contains r180's quirks: the uniform-buffer path, usage and colours set before the first render, update ranges | The instancing bug the prototype documented | 3.8 |
| I-20 | Procedural material library: seeded tiling generators with albedo, height, roughness and emissive; normals from height; mipmaps; pixel and smooth looks; TSL noise nodes; contact sheets | Seams, shimmer, two duplicated bakers | 2.3, 7.3 |
| I-21 | Puppet bodies as data (bones, sockets, mirrored parts, material slots), compiled to instanced parts or one rigid-skinned mesh per character, with optional smooth skinning | 1,225 draw calls; bodies written as code | 3.8, 5.4 |
| I-22 | A legend-driven level compiler with `validate()`: heights, stairs, slopes, galleries, a nav grid with climb limits, a Dijkstra flow field | Glyph meanings hard-coded in about a dozen places across two files | 2.2, 4.2, 4.3 |
| I-23 | Audio: pure-JS DSP (seeded and hashable), spatial audio, procedural reverb impulse responses, adaptive music layers, voice limits, variants, plus spectrograms and metrics for agents | No audio in 3D; a non-reproducible synth; untestable output | 9.1–9.5 |
| I-24 | Input intents: camera-relative movement, pointer lock, axes, rebinding as engine data, a virtual device, recording | Screen-space `move()`; 673 lines of game-side rebinding; tests pressing keys on a wall clock | 3.3 |
| I-25 | One `window.__engine` API, the same in Node: step, state, hash, trace, entities, a text scene dump, stats, capture with IDs, input injection, `describe`, `help()` | `__sw` and `__lab3d`, which were inconsistent | 1.6, 2.7 |
| I-26 | One CLI, `node x`, for what only this engine does: it prints 20 lines or fewer, writes `report.json` and returns exit codes 0/1/2, with shared `tools/lib` and a persistent inspect session. Everything else goes through npm scripts and the standard tools | 35 tools, 26 scripts, 19 copies of the browser-launch code | 0.2, 2.7 |
| I-27 | Test tiers with budgets (T0 under 10 s, T1 under 60 s, T2 under 6 min) on Vitest and Playwright Test, with tests selected through Vite's module graph and run in parallel | 25 minutes, sequential; a hand-written map with holes | 0.5 |
| I-28 | Visual verification with no committed images and no display: ID pass, look metrics, text thumbnails per backend, comparison against a base commit built in a worktree | PNG byte size as "not blank" | 2.6, 3.11 |
| I-29 | Numeric content QA with baselines: animation, geometry, texture tiling, audio, levels | Lints that never failed (the shipped `codex` still has 3 joint pops) | 2.2, 2.4, 6.6, 7.3, 8.6, 9.4 |
| I-30 | Docs from code: JSDoc file and export comments become a generated INDEX, API and ERRORS; `@example` blocks are executed; token budgets; no duplicated prose | About 310 KB of docs with each core fact in about 4 places; drift | 0.6 |
| I-31 | Strict TypeScript checked by `tsc` against the pinned three.js and Rapier types (real types, with `moduleResolution: bundler`); ESLint's layer and banned-API rules; Prettier | No types; old-API mistakes found only at run time | 0.1, 0.4 |
| I-32 | Repo hygiene: no committed build output, a lockfile, the version in `package.json` only | 136 of 301 files were build output; 10 places to edit on every bump | 0.1 |
| I-33 | `x ci --local` as the merge gate from day one; GitHub Actions as required checks once the owner enables them | No CI; "merge, then run the full suite in the background" | 0.9 |
| I-34 | Claude Code integration: SessionStart, a fast check after each edit, write protection, a Stop gate, skills, subagents (`verifier`, `visual-reviewer`, `suite-runner`, `api-checker`) | A SessionStart hook only | 0.10, 12.1 |
| I-35 | An MCP server, on the standard SDK, that bridges `__engine` for any agent | None | 7.6 |
| I-36 | Registries with schemas that automatically feed the gallery, the inspector, content QA, scaffolds and docs. Scaffolds pass every check and are re-tested | Schemas existed only as comments; templates could rot | 1.2, 12.1 |
| I-37 | One settings schema that generates URL parameters, `x set`, `__engine.set`, the benchmark settings line and JSON export (and a panel, if one is wanted) | `S`/`FX` mutations that sometimes never took effect; 14k tokens of hand-wired panel | 1.2, 2.7 |
| I-38 | A bot harness: a virtual device, navigation, a watchdog, stuck detection measured along the wanted direction, reproducible smoke runs | A bot inside the game only | 5.6 |
| I-39 | Performance budgets as counters (pipelines after warm-up, draw calls, memory bytes, sim ms per step in Node) and a crowd ladder (100, 1,000, 5,000) | Headless fps, which is noise | 5.5, 5.7 |
| I-40 | Agent-usability evals (fresh-agent tasks) and mutation testing of the key suites | The suites themselves were never tested | 12.2 |
| I-41 | Advice and error codes with docs. Tests fail on new advice; allowed advice is listed with a reason | Free-text warnings | 1.2, 0.5 |
| I-42 | Version-pinned knowledge: the pinned packages' own sources and types, the TSL guide as it stood for r180, a delta for agents who know newer releases or r182, rename rules with replacements, deprecations failing tests | Models' priors drifting from the pinned version | 0.3, 0.4 |
| I-43 | **The Stress Box**: one integration target, grown in six stages, each proved by commands that need no display | A lab page whose proof run was its only test of play | 2.7, 3.10, 4.6, 5.7, 6.7, 7.8 |
| I-44 | Escalations with records (`x esc`): the owner is asked, a call is made after 15 minutes, and every call can be found and reviewed | Decisions lost in chat; runs stalled on a question | 0.7 |
| I-45 | Dependency qualification (`x deps`): pins checked against publish dates, compatible releases adopted at once in their own commits, and upgrades scheduled as lines qualify | Versions chosen for novelty | 0.3 |
| I-46 | Post masks from a separate pass instead of MRT: works on r180's WebGPU backend and never recompiles materials when a filter toggles | Black frames on r180's WebGPU (§4.7); a re-warm after every filter toggle | 7.4 |
| I-47 | Binary assets only with a recorded approval; fonts pre-approved | A blanket ban that left fonts and other approved needs no path | 0.4 |
| I-48 | The standard web toolchain behind npm scripts: Vite, Vitest, Playwright Test, ESLint, Prettier and tsx. Bespoke tools only where nothing established fits, each listed with its reason (ADR-0019) | A home-grown server, test runner, import-graph scanner, rule engine and vendoring | 0.2, 0.4, 0.5 |
| I-49 | three.js used the way agents know it: classic materials (converted by `WebGPURenderer`), its math classes in the sim, standard skinning and `AnimationClip`s, built-in addons and post nodes. TSL and custom code only where these fall short | Tuple math of our own, node materials everywhere, a private clip runtime | 1.1, 2.3, 3.4, 3.8, 8.4 |

---

## 8. Tooling and testing: how agents see and prove their work

### 8.1 npm scripts for the standard tools, `node x` for the engine's own

**The front door is npm** (doctrine: Common ground). The standard tools run through the scripts every agent expects:

| Script | Runs | Tier |
|---|---|---|
| `npm run check` | `tsc --noEmit`, `eslint --cache .`, `prettier --check --cache .`, then `node x check` | T0 |
| `npm test [-- <path filters>]` | `vitest run`: unit tests, Node replays, content QA. A filter is a substring of a test file's path; one that matches nothing exits 1 | T1 |
| `npm run e2e [-- <spec files>] [--project=webgpu\|webgl2]` | `playwright test`: the browser suites, both projects unless one is named | T2 |
| `npm run dev`, `npm run build` | `vite`, `vite build` | — |
| `npm run typecheck`, `npm run lint`, `npm run format` | the parts of T0 on their own; `format` writes | — |

Vitest prints its `dot` reporter and writes `out/test/report.json`; Playwright prints its `line` reporter and writes `out/e2e/report.json`. Agents read failures from those files rather than scrolling output.

**`node x <cmd>` covers what only this engine does.**
- `x.js` registers tsx and runs `tools/x.ts`, which dispatches to `tools/cmd/<cmd>.ts` and parses arguments with `node:util`'s `parseArgs`. Each command's file comment is its help, so `x help [cmd]` is generated and cannot go stale.
- Shared code lives in `tools/lib/`. Commands that need a page start Vite through its JavaScript API (`tools/lib/vite.ts`) and drive Chromium through Playwright's library, with the same launch options as `playwright.config.ts` (`tools/lib/browser.ts`).

**Output contract for every `x` command.**
- Print **at most about 20 lines**: the verdict first, then each failure as a plain sentence giving what was expected, what happened, where, and the likely fix.
- Always write `out/<cmd>/<target>/report.json`:
  ```json
  { "tool": "x shot", "version": "0.3.0", "args": {}, "ms": 812, "ok": false, "runtime": "linux-x64 chromium141",
    "failures": [{ "id": "A031", "message": "hero covers 0 px from cam iso", "file": "labs/box/scenes/room.ts", "line": 40, "entity": 12 }],
    "warnings": [], "metrics": { "drawCalls": 214 }, "artifacts": [{ "path": "out/shot/box-room/iso.png", "kind": "image", "describes": "iso view, WebGPU" }] }
  ```
- Also update `out/latest.json`.
- Exit codes: **0** pass, **1** fail, **2** usage error.

**Quick iteration.** Every command that runs a scene takes `--scene <name>` and `--set key=value` (validated against the settings schema), so an agent changes a tunable, runs, and reads numbers, without editing code: `x sim`, `x shot`, `x film` and `x perf`.

| Command | Purpose |
|---|---|
| `x help [cmd]` | Generated help |
| `x check` | The repository checks no standard tool covers, run inside `npm run check`: the asset scan, docs drift (`x docs --check`), escalation records, dependency pins (`x deps --check`), token budgets |
| `x sim <scene> [--steps n] [--seed s] [--set k=v…] [--script f] [--dump]` | Run a scene headless in Node: hash, trace, state, event summary |
| `x replay <file\|dir…> [--update] [--browser chromium\|webgl2\|webgpu\|both] [--bisect]` | Replay in Node against Node's goldens; `--browser` also replays in Chromium against Chromium's: `chromium` in the sim-only page, `webgl2`, `webgpu` or `both` in the scene's own page, rendering (WP 2.7). `--bisect` finds the first divergence |
| `x inspect [--page p] [--backend b]` | Keep one headless page open over the Vite dev server, for `x eval`, `x dump`, `x set` and MCP |
| `x eval "<js>"` / `x dump [--step n]` | Talk to the inspect session: evaluate, or dump the scene and state as text |
| `x set <key> <value> [--scene s]` | Validate a setting against the schema; print it as a URL parameter and apply it to the inspect session |
| `x shot <page> [--scene s] [--cam code] [--backend b] [--set k=v…] [--ids] [--metrics]` | Render; read back a render target; write PNG plus look metrics plus ID-pass stats |
| `x film <page> --steps "…" [--scene s] [--seed s] [--compare <ref>]` | Filmstrip contact sheet, with a diff against `<ref>` (default `HEAD`) built in a temporary worktree |
| `x sheet <rig\|move\|clip>` | 3D sheet: states × cameras, plus numeric checks |
| `x gallery <kind> [id]` | Contact sheets and JSON from the registries' `gallery` hooks |
| `x qa <family…> [--only <prefix…>]` | Content QA against per-family (and per-area) baselines. The families are `anim`, `geo`, `tex`, `audio` and `level` |
| `x perf <page\|scene> [--scene s] [--backend b] [--budget] [--ladder] [--feature f] [--set k=v…]` | Counters and timings against budgets; `--ladder` runs the crowd at 100, 1,000 and 5,000 |
| `x describe <kind> [id]` | Registry listing: schema, ids, docs |
| `x new <kind> <id>` | Scaffold content that already passes every check |
| `x docs [--check\|--write]` | Generate and check INDEX, API and ERRORS; run `@example` blocks; token budgets |
| `x sizes [--budget]` | Tokens per module and directory against budgets |
| `x deps [--check\|--update\|--qualify]` | Doctrine: Mastery. Check the pins offline; adopt compatible releases now; list lines that newly qualify (§6.10) |
| `x esc open\|list\|answer\|decide\|close …` | Escalations (§8.14) |
| `x src` | Prints and checks `$MY3D2DGE_SRC`, the read-only source checkout (WP 0.1) |
| `x ci --local [--install-workflow]` | Runs the CI steps locally: the merge gate. `--install-workflow` copies `tools/ci/ci.yml` into `.github/workflows/` once the owner allows it (§8.9) |
| `x port refs [--check]` | Build reference vectors from my-3d2dge@e37e4ee for differential tests (WP 0.11) |
| `x mcp` | Start the MCP server (WP 7.6) |
| `x anim find\|show\|cut\|import\|cmu\|bake\|sheet …` | Animation library tools (§10, Phase 8) |
| `x audio <id> [--wav] [--spectrogram]` | Render a sound; metrics; optional files in `out/` (Phase 9) |
| `x evals [--dry-run]`, `x eye`, `x edition [--check]` | Agent-usability evals, the Node visibility raster, the optional reading edition (Phase 12) |

### 8.2 Test tiers with time budgets

| Tier | Contents | Budget | When |
|---|---|---|---|
| T0 `npm run check` | Types, ESLint, Prettier, and the repository checks: assets, docs drift, escalations, pins, sizes | under 10 s | After every edit (the hook runs the per-file part) and at Stop |
| T1 `npm test` | Pure modules, animation, generators, the Rapier sim, Node replays, content QA | under 60 s | Before every commit (`npm test -- --changed` while iterating) |
| T2 `npm run e2e` | Browser suites on both backends in parallel: rendering, play-alike, ID pass, pipeline counters | under 6 min for the full set | Before every push; part of `x ci --local` |
| Long runs | Long replays, the crowd ladder, `--repeat-each 3` flake hunting | — | At each gate |

**Rules:**
- **Selection.** T1 selects through Vite's module graph: `vitest run --changed <base>` while iterating, `vitest related <files>` to see what covers a file. T2 runs in full whenever engine, lab or page code changed, because page code reaches the browser through the dev server rather than through the specs' imports. When only specs or their helpers changed, `--only-changed <base>` is enough.
- **The base** is the merge-base with `origin/main` once `main` holds a gate, and otherwise the commit recorded in `out/ci/last-green` by the last green `x ci --local`.
- **Budgets.** `x ci --local` reads the JSON reports, warns when a tier is over its budget, and fails at 1.5×.
- A test that waits on wall-clock time is a bug. Tests step the engine (`step(n)`) on a virtual clock.
- A flaky test is quarantined only through a WP that fixes it. Skipping a test to get green is forbidden.
- Tests run on the development platform only (doctrine: Discovery first): Node 24 and headless Chromium 141, WebGPU on SwiftShader and WebGL 2 on ANGLE.

### 8.3 `window.__engine`: one inspector API, also headless (`createHeadless`) minus the rendering members

| Area | API |
|---|---|
| Identity and health | `info()` → `{ version, backend, compat, features, fallbacks, runtime }`, `ready`, `errors[]` (structured records), `advice[]` (warn-once records with codes) |
| Time | `pause()`, `resume()`, `step(n, intents?)`, `render()`, `timeScale(k)`, `seed(n)` |
| State | `state(query?)`, `hash()`, `trace()`, `entities(query)`, `get(id)`, `set(path, value)` (settings schema only; validated), `capture()` and `restore(c)` (the whole sim, §6.5), `describe(kind?, id?)` (the registries, as `x describe`) |
| Scene | `scene.dump({ depth, filter })` → a text tree (name, type, visible, position, bounds, material, triangles); `camera.get()`, `camera.set(code)` |
| Rendering | `stats()` → `{ simMs, physicsMs, animMs, renderMs, gpuMs?, drawCalls, triangles, pipelines, programs, textures, geometries, memory }` |
| Shots | `shot({ ids, metrics, thumbnail, size })`, through a render target and `readRenderTargetPixelsAsync` |
| Input | `input.press(action)`, `input.axis(name, value)`, `input.play(script)`, `input.record()` |
| Dev actions | `actions.list()`, `actions.run(id, args)`: god mode, freeze AI, spawn, travel (WP 5.6) |
| Help | `help()`: every member, one line each (checked against the API by `x docs --check`) |

**Members are registered, never edited in.** `engine/dev/inspector.ts` assembles `__engine` from the members registered with `def('inspectorMember', name, impl)` through `core/registry`. Each WP registers its own members from its own files (`input` in WP 3.3, `stats` in WP 5.5, `actions` in WP 5.6), so no two WPs edit the inspector, and no layer imports `dev/`.

**Headless.** In Node, `createHeadless` returns the same object. Its rendering members (`render`, `shot`, `camera`, `scene`) throw a coded "no renderer" error.

Every page signals `ready` or `error` within a timeout. That turns a startup crash into one line instead of a hang.

### 8.4 Replays

```json
{ "format": "my3dge-replay/1", "engine": "0.4.0", "three": "0.180.0", "rapier": "compat 0.19.3",
  "scene": "box:room", "settings": { "crowd": 0 }, "seed": 1, "hz": 60, "steps": 600,
  "inputs": [[0, { "move": [0, 1], "cam": 0.785 }], [30, { "move": [1, 0], "b": ["attack"] }], [42, { "b": [] }]],
  "hashes": { "linux-x64 node24":      { "60": "9f2c…", "120": "…", "600": "…" },
              "linux-x64 chromium141": { "60": "41d7…", "120": "…", "600": "…" } } }
```

- **Inputs** are change-points only, so the file stays small and diff-friendly.
- **Golden hashes are keyed by runtime** (§6.5). A replay is checked against the hashes of the runtime it runs in.
- **Bisect.** `x replay --bisect` reruns with per-step traces until the first divergence, then prints the step, the entity and the component fields that differ.
- **Recording live play.** The engine keeps every step's intents from the start of the scene (change-points only, so a long session stays small), and `__engine.input.record()` saves them as a replay from step 0. The file is text, and no capture is needed. Every bug report about behaviour becomes a replay test.

### 8.5 Visual verification without committed images or a display

1. **ID pass.**
   - Flat, unlit, per-object colours; no antialiasing; read back.
   - The result is `visible: [{ id, name, px, bbox }]`, so an agent reads "the hero covers 0 px" or "one object covers 71%: the camera is inside a wall" as text.
   - Each backend is checked on its own: gameplay entities in view must appear (§6.7). ID passes are never compared across backends.
2. **Look metrics** for every frame, as JSON:
   - coverage against empty space;
   - luma spread (P5 to P95);
   - dark and blown-out fractions;
   - colour count;
   - the largest object's share;
   - whether the protagonist is visible;
   - edge density.
   Failures are written as "number plus suggested fix", the style of the prototype's `check.mjs`.
3. **Text thumbnails.** A 48×27 hex-colour grid per case and per backend, stored as JSON in `tests/baselines/`. It can be compared per cell with a tolerance, and read as a coarse map. Playwright's screenshot assertions are not used for baselines, because they commit PNG files (doctrine: Assets).
4. **Compare with a base.** `x film --compare <ref>` (default `HEAD`) builds the ref in a temporary `git worktree` and renders the same steps. The diff report gives bounding boxes and attribution from the ID pass ("93% of the changed pixels are on `hero`"). When the base lacks the scene, it reports "no baseline" as a deferred proof instead of failing.
5. **Images on demand only.** Contact sheets are capped at 1,600 px wide, with labels and diff boxes. Reviewing them is delegated to the `visual-reviewer` subagent, which returns a JSON verdict and keeps image tokens out of the main context. Images are also how humans watching from afar see the work (§11.5).

### 8.6 Content QA and baselines (fast, mostly in Node)

ESLint checks code. `x qa` checks content: motion, meshes, textures, sounds and levels. Each family also runs in T1 as a Vitest test, sharing the code in `tools/qa/`.

**Animation**, over every move, clip, action and fixture rig in every body state:
- pops: spikes relative to the neighbouring steps;
- foot sliding during contacts;
- joints under the ground;
- bone stretch on declared rigid pairs;
- joint limits;
- loop closure;
- twist jumps above 120° while a limb is folded past 140° (the v1 pop pattern);
- angles beyond ±540°;
- NaN;
- the same hash twice;
- 1/60 against 1/120 within tolerance.

**Geometry:** degenerate triangles, normal consistency, bounds, a vertex budget.

**Textures:** tileability (seam delta), value range, mip sanity.

**Audio:** peak, clipping, DC offset, clicks (discontinuities), silence, duration, spectral centroid.

**Levels:** `validate()` (unknown glyphs, unreachable spawns, unclimbable stairs), nav connectivity.

**Baselines.** Each family (and area) has a baseline file, `tests/baselines/qa-<family>[-<area>].json`, listing accepted exceptions as `{ id, metric, value, reason }`. A new violation fails the test, and so does an accepted one that got worse.

### 8.7 Performance budgets, as counters (never headless fps)

- **Pipelines** compiled after warm-up must be **0**.
- **Draw calls, triangles, programs and memory bytes** (`renderer.info`) are capped per box scene.
- **Sim time.** `sim.step` in milliseconds at 100, 1,000 and 5,000 crowd agents (`x perf --ladder`), measured in Node with the median of 5 runs, checked against budgets with a tolerance. The prototype's figures (1, 5.6 and 33 ms per step) are context; the budgets are the box's own measurements on the development platform, recorded in WP 5.7.
- Budgets live in one file per scene or area under `tests/baselines/perf/`, owned by the WP that records them.
- **Trends.** Each gate records `out/perf/trend.json` and flags any regression over 15%.

### 8.8 The headless browser recipe

- **In this cloud container:**
  - Chromium 141 at `/opt/pw-browsers/chromium` (`chromium-1194`), launched by Playwright 1.64 through `launchOptions.executablePath`. `CHROMIUM_PATH` overrides the path. Nothing runs `playwright install`.
  - WebGPU via SwiftShader: `--enable-unsafe-webgpu --enable-features=Vulkan --use-vulkan=swiftshader --use-webgpu-adapter=swiftshader --disable-vulkan-surface`, set in each Playwright project.
  - A stand-in `getContext('webgpu')` that renders to a texture and is read back, because headless Chromium loses the device when it presents a frame. Ported verbatim (`tools/lab3d-test.mjs:70-102`) into the shared fixture `tests/e2e/fixtures.ts`; verified with r180 (§4.7).
  - WebGL 2 through ANGLE.
- **In GitHub Actions** (when the owner enables it): the official Playwright 1.56.1 container image, whose Chromium is the same build 141 (`/ms-playwright/chromium-1194`), with Node 24 from `actions/setup-node` and `.nvmrc`. Mesa lavapipe (`mesa-vulkan-drivers`) plus `xvfb-run` only if SwiftShader is unavailable there.
- **Every suite asserts, through the fixture:**
  - which backend actually ran, using the adapter info;
  - that the frame is not blank;
  - that the virtual clock is installed.
  A WebGPU-to-WebGL fallback can never pass silently as WebGPU.
- **Page errors name the source.** The fixture maps every page error's stack through Vite's inline source maps (`node:module`'s `SourceMap`), so it names `.ts` files and lines.
- **Shots** go through a render target and `readRenderTargetPixelsAsync`, never `toDataURL` on a WebGPU canvas.
- **Baselines** are kept separately per backend.

### 8.9 Continuous integration

- **`x ci --local` is the merge gate** from day one: `npm ci`, `x src`, `npm run check` (which includes `x deps --check` and `x docs --check`), `npm test`, `x port refs --check`, and `npm run e2e` (in full while the T2 set stays within its 6-minute budget, otherwise selected as in §8.2). It writes a summary to `out/ci/summary.md` and records the commit in `out/ci/last-green`.
- **GitHub Actions.** The workflow lives at `tools/ci/ci.yml` and runs the same steps in the Playwright container of §8.8, uploading `out/**` as artifacts and writing `$GITHUB_STEP_SUMMARY`. A unit test checks that its steps match `x ci --local`. It is not committed under `.github/workflows/`: without the token's `workflow` scope, GitHub rejects every push that contains such a file. Once the owner enables Actions and grants the scope (an escalation, §11.5), `x ci --install-workflow` copies it into place.
- **Long runs** (§8.2) run at each gate.

### 8.10 Claude Code integration

- **`AGENTS.md`** is canonical and tool-agnostic, about 150 lines or fewer (draft in Appendix E). **`CLAUDE.md`** is `@AGENTS.md` plus Claude-specific notes.
- **`.claude/settings.json`:**

  | Hook or setting | Does |
  |---|---|
  | SessionStart | Runs `scripts/setup.sh`: installs Node 24.21.0 if the container lacks it and appends its `PATH` to `$CLAUDE_ENV_FILE`, so later Bash calls use it; then `npm ci`. Resolves the source (`x src`) and appends `MY3D2DGE_SRC=<absolute path>` to `$CLAUDE_ENV_FILE`. Lists open escalations, and compatible releases waiting to be adopted (`x deps --update --dry-run`) |
  | PostToolUse on `Edit\|Write` | `prettier --write`, then `eslint --cache`, on the edited file. Exits 2 with the errors so the agent sees them at once |
  | PreToolUse | Asks the owner before any edit to `DOCTRINE.md` (`permissionDecision: "ask"`), so the doctrine changes only on the owner's word. Denies hand edits to `out/` and `node_modules/`, and force-pushes to `main` |
  | Stop | Runs `npm run check`. Exit 2 with a short reason if red, honouring `stop_hook_active` to avoid loops. Warns about an open escalation past its deadline with no recorded call |
  | `permissions.allow` | `Bash(node x *)`, `Bash(npm run *)`, `Bash(npm test*)`, `Bash(npm ci)`, `Bash(npx vitest *)`, `Bash(npx playwright test*)`, read-only git |

- **Skills** (`.claude/skills/`, loaded on demand; names never carry a version, so an upgrade renames nothing):

  | Skill | What it carries |
  |---|---|
  | `x-loop` | The edit → check → test → report loop |
  | `three-webgpu` | The pinned three.js's idioms, classic materials first, banned APIs and their replacements, TSL patterns, WebGL 2 rules, the delta from newer releases and from r182 |
  | `rapier` | Rapier usage under the reproducibility contract, captures included |
  | `determinism-debugging` | Replay bisect; reading a trace diff; Node against Chromium |
  | `escalation` | When to escalate, the 15-minute rule, `x esc` (§8.14) |
  | `stress-box` | How the box is organized, how to add a scene or a variant, the iteration loop |
  | `animation-authoring` | Effector-space authoring, moves, clips, actions, content QA |
  | `visual-qa` | The metrics, the ID pass, thumbnails |
  | `perf-budgets` | Budgets and how to meet them |
  | `add-<kind>` | Mirrors `x new` |

- **Subagents** (`.claude/agents/`):

  | Subagent | Job |
  |---|---|
  | `verifier` | Runs a WP's Verify commands, re-reads the diff adversarially against `DOCTRINE.md` and the WP's Done-when list (including "is there an established tool or three.js API for this?"), and returns pass or fail with reasons |
  | `visual-reviewer` | Reads images and returns a JSON verdict |
  | `suite-runner` | Runs T2 and the long runs in the background and returns failures only |
  | `api-checker` | Checks three.js and Rapier usage against the pinned types and sources in `node_modules` |

### 8.11 The MCP bridge (WP 7.6)

- **What it is.** `x mcp` starts a server, built on the official `@modelcontextprotocol/sdk`, over a persistent `x inspect` session.
- **Tools:**
  - `engine_open(page, params)`
  - `engine_step(n, intents)`
  - `engine_state(query)`
  - `engine_dump()`
  - `engine_shot({ ids, metrics, thumbnail })`, which returns image plus JSON
  - `engine_input(script)`
  - `engine_replay(file)`
  - `engine_set(path, value)`
  - `engine_actions(id, args)`
  - `engine_help()`
  - `docs_lookup(symbol)`
- **Why.** Unity, Unreal, PlayCanvas, Bevy and the Chrome DevTools team have all shipped this pattern: inspect, step, inject input, capture and read logs over the running app. It lets any agent drive the running engine without writing Playwright code.

### 8.12 Docs as an interface, checked for drift

`x docs --check` covers file and export comments, AGENTS.md and `docs/*.md`. It skips `DOCTRINE.md`, `docs/research/`, `docs/reference/` and `docs/escalations/`. Source citations are written `my-3d2dge:<path>[:line]` and are checked against `$MY3D2DGE_SRC`.

It fails when:
- an `@example` does not run;
- a path or name the docs mention does not exist;
- a token budget is exceeded;
- INDEX, API or ERRORS are stale;
- `help()` differs from the inspector's API.

The engine's own version lives in `package.json` only, and prose never repeats it.

### 8.13 Scaffolding

`x new <kind> <id>` exists for these kinds, and only these: `material`, `prop`, `body`, `move`, `level`, `scene` (a box scene or variant), `module`, `feature`, `devAction`. The expansions add `rig --block legGait` (WP 10.1), `action` (WP 8.7), `sfx` and `song` (WP 9.2) and `game` (WP 10.7). Each writes:
- a working entry;
- a test;
- a `gallery` hook (WP 7.7 renders it);
- a file comment.

It then runs the relevant checks and prints the summary. `x ci --local` runs every template (`x new … --test`), so templates cannot rot.

### 8.14 Escalations (doctrine: Escalation)

**When to escalate.** An action needs the owner's approval, or a principle cannot be satisfied:
- adding a binary file other than a font (doctrine: Assets);
- a new runtime dependency, or any dependency outside the rule of §6.10 (doctrines: Common ground, Mastery);
- a repository setting, secret, token, deploy, publication or other outward action; rewriting published history;
- any case where following a principle would break another, or cannot be done (for example, a WebGPU-only effect that would change play).

Everything else is decided by the agent and recorded as an ADR amendment (§11.4), without waiting.

**How.**
1. `x esc open "<question>" --principle Assets --option "…" --option "…" --recommend 1` writes `docs/escalations/ESC-NNNN-<slug>.md` with status `open`, the time raised, a deadline 15 minutes later, the options and the recommendation, and prints a short message.
2. Post that message where the owner is watching: the session's chat, or the PR. Then wait. In a Claude Code cloud session, schedule a check-in for the deadline (`send_later`) and end the turn; an answer that arrives first resumes the session.
3. **Never perform the action while waiting.** Meanwhile, take the doctrine's preferred alternative: procedural or text instead of binary, or a stub behind the feature registry.
4. **An answer arrives:** `x esc answer ESC-NNNN "<answer>"`, then act on it.
5. **No answer by the deadline:** commit the current work, decide, `x esc decide ESC-NNNN --call "<what was done and why>" --commit <sha>`, and continue. The record's status becomes `decided-in-absence`.
6. **For the rest of that run** (the session or workflow run), further conflicts are reported in chat without stopping, and each is still recorded with `x esc open … --no-wait` and `x esc decide`.
7. `x esc list --open` and the SessionStart hook surface every record that still needs review. The owner closes one with `x esc close ESC-NNNN` (or by asking an agent to), keeping or reversing the call.

**In ultracode workflows**, lanes never wait and never perform the action: a lane writes the record, takes the preferred alternative, and reports it to the integrator, which escalates once for the run, applies the 15-minute rule, and records the call before the action lands.

---

## 9. Roadmap: the Stress Box, stage by stage

### 9.0 The Stress Box

**What it is.** A test scene, benchmark and sample in `labs/box/` that grows through six stages until it does the stress test's job (§4.1). It is the engine's integration target: every capability built in Phases 2–7 is shown in the box, or in a fixture test when the box has no use for it.

**How it is organized (`labs/box/`):**
- `levels/*.txt`: the box's levels, in the legend-driven text format (WP 2.2). `room` (16 × 12 m) starts it. `hall` (the prototype's 64 × 44 layout, with pillars, low walls, two galleries with stairs, the dais and braziers) arrives in Box 3.
- `scenes/*.ts`: sim-side scene modules: the level, spawns, settings and the box's behaviour. `x sim` runs them in Node.
- `cast/*.ts`: the sample cast. The hero, and walkers, slimes and wisps as neutral shapes, each with its body, steering and attack data.
- `looks/`: the box's looks (Box 6); `sounds/` (Phase 9).
- `main.ts`, `index.html`: the page, a view over the same scenes.
- `README.md`: what each scene shows, and which suites cover it.

**The stages.** Each stage is a phase, and its gate is the "box can" column.

| Stage (phase, gate) | Scenes | The box can… | Proved by |
|---|---|---|---|
| Box 1 (2, G2) | `room` | render on WebGPU and WebGL 2, step headless, be inspected and set | `x sim` golden hashes; `x shot` ID pass and metrics on each backend; 0 pipelines after warm-up |
| Box 2 (3, G3) | `room-hero` | let a hero walk, dash and jump onto a low wall; follow it with every camera; be filmed and compared | replays match each runtime's goldens, rendering on both backends; live play replays headless; the humanoid's differential tests; `x film` |
| Box 3 (4, G4) | `hall`, `hall-props` | let the hero climb stairs to a gallery, and push and knock 10–300 crates and barrels | level validation; nav coverage; replays, rendered on both backends |
| Box 4 (5, G5) | `crowd-100`, `crowd-1000`, `crowd-5000` | fill with walkers, slimes and wisps that chase the hero up the stairs, while a bot drives the hero | the perf ladder within budgets; 0 pipelines as the crowd grows; reproducible bot runs |
| Box 5 (6, G6) | `fight`, `fight-1000` | fight: moves, hits, knockback, launches, deaths, corpses, telegraphs, particles, trails, damage numbers | scripted fight replays (≥ 3 deaths, a launch); the hash unchanged with effects off; animation QA |
| Box 6 (7, G7) | every scene, every look | look torch-lit, toon-shaded and filtered; be driven over MCP; show a gallery | every look on both backends with 0 pipelines after warm-up; the governor; the MCP test; the benchmark report |

**Rules for the box:**
- **Similar, not identical.** The prototype's numbers (Appendix C) are starting values. Behaviour, feel and tuning change freely, and a change records its reason in the scene or cast data. The only checks against the prototype are the animation port's differential tests (WPs 3.6 and 6.1). They make sure the motion survives translation; after that it is ours to change, with the reference vectors as a baseline.
- **Engine, not game.** The box's cast, behaviours and numbers stay in `labs/box/`. A mechanism moves into `engine/` only through a WP that names it, and only in a generic form.
- **Every stage ends runnable and measured.** A gate is green only when its scenes run headless and on both backends, and their numbers are recorded.
- **Grow by need.** A stage adds a scene or a variant (`stairs`, `crowd-arena`…) whenever a system needs exercising. A variant is a new file or a settings preset, never a change of meaning in a passing one.
- **The quick loop.** Change a setting (`--set`) or a scene → `x sim` (hash, events) → `x shot` (numbers, and a picture on demand) → `x film --compare HEAD` (from Box 2) → `x perf` → commit.

### 9.1 Phases at a glance

| Phase | Goal | Lanes | Ends at gate | Runs |
|---|---|---|---|---|
| 0 Foundation | The repo can check, test, document, pin and escalate before any engine code exists | T | **G0** | Sequential |
| 1 Kernel | Reproducible kernel: math, time, registry, world, scenes, hash, replay, headless runs | C | **G1** | Sequential |
| 2 Box 1: render and step | Renderer, level compiler, materials and textures, geometry and level meshes, cameras, shots and the ID pass, the box app | R, W, T, B | **G2** | Parallel lanes |
| 3 Box 2: a hero | Rapier, the controller, input, skeleton, IK, the humanoid, the animator, puppets, more cameras, film | P, I, A, R, T, B | **G3** | Parallel lanes |
| 4 Box 3: the hall | Bodies, level compiler v2, navigation, level meshes v2 and cutaway, props | P, W, R, B | **G4** | Parallel lanes |
| 5 Box 4: a crowd | Crowd bodies, steering, blob and floater rigs, crowd rendering, perf counters, the bot | P, W, A, R, T, I, B | **G5** | Parallel lanes |
| 6 Box 5: combat | Moves, reactions, combat helpers, effects, the overlay, animation checks | A, W, R, I, B | **G6** | Parallel lanes |
| 7 Box 6: the look, operated | Lights, materials v2, textures v2, post, the governor, MCP, the gallery | R, W, T, I, B | **G7: the Stress Box** | Parallel lanes |
| 8 Animation library | Provenance, codec, sets, baker and clip layer, tools, tests, actions, clip mode in the box | L | **G8** | May start after G0 (8.1) and G1 (8.2); never delays a box stage |
| 9 Audio | DSP, data, runtime, tools, sound in the box | X | **G9** | May start after G1; never delays a box stage |
| 10 Expansions | Building blocks and fixture rigs, ragdolls, props library, gameplay kits, terrain, UI widgets, the game template, lab pages | A, P, W, I, B | **G10** | After G7 |
| 11 WebGPU features | Completing the feature framework and GPU timing; then GPU particles, GPU-driven crowds and lighting upgrades, each when a measurement or a look calls for it | R2 | **G11** | After G7; WPs 11.3–11.5 on demand |
| 12 Agent tooling+ | Scaffolds completed, evals and mutation testing, agent eye, reading edition, preview hosting | T | **G12** | After G7 |
| H Production hardening | Other browsers, mobile, deploys, releases, cross-platform determinism | — | — | Only when a game goes to production |

Lanes: **T** tooling, **C** core, **R** render, **W** world, **P** physics, **A** animation, **I** input, UI and dev, **B** the box (the integrator), **L** library, **X** audio, **R2** WebGPU features.

### 9.2 Dependency graph

Each WP below repeats its direct dependencies in a **Needs** line. Edges in brackets are sources from other stages.

```
Phase 0:  0.1 → 0.2 → {0.4, 0.11} ; 0.4 → {0.3, 0.5, 0.6, 0.7} ; {0.3, 0.5, 0.6} → 0.8 → 0.9 ; {0.7, 0.9} → 0.10 ; {0.10, 0.11} ⇒ G0
Phase 1:  G0 → 1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6 ⇒ G1
Box 1:    G1 → 2.1 → {2.3, 2.5, 2.6} ; G1 → 2.2 ; {2.2, 2.3} → 2.4 ; {2.4, 2.5, 2.6} → 2.7 ⇒ G2
Box 2:    [2.2] → 3.1 → 3.2 ; [1.5, 2.5] → 3.3 ; G1 → 3.4 → 3.5 → 3.6 ; {3.2, 3.6} → 3.7 ; [2.4] + 3.4 → 3.8 ;
          [2.5] + {3.1, 3.4} → 3.9 ; [2.7] + 3.3 → 3.11 ; [2.7] + {3.3, 3.7, 3.8, 3.9, 3.11} → 3.10 ⇒ G3
Box 3:    [3.2] → 4.1 ; [3.1] → 4.2 → 4.3 ; [2.4] + 4.2 → 4.4 ; [3.8] + 4.1 → 4.5 ; [3.10] + {4.3, 4.4, 4.5} → 4.6 ⇒ G4
Box 4:    [4.1] → 5.1 ; [4.3] + 5.1 → 5.2 ; [3.7] → 5.3 ; [3.8] + 5.3 → 5.4 ; [2.7] + 5.1 → 5.5 ; [3.3, 4.3] → 5.6 ;
          [4.6] + {5.2, 5.4, 5.5, 5.6} → 5.7 ⇒ G5
Box 5:    [3.7] → 6.1 → 6.2 ; [5.1] + 6.1 → 6.3 ; [3.8] + 6.1 → 6.4 ; [2.7] → 6.5 ; [5.3] + 6.2 → 6.6 ;
          [5.7] + {6.3, 6.4, 6.5, 6.6} → 6.7 ⇒ G6
Box 6:    [2.3, 4.2] → 7.1 ; [3.8] → 7.2 ; [2.3, 4.2] → 7.3 ; [2.6] + 7.2 → 7.4 ; [5.4] + 7.1 → 7.5 ;
          [2.7, 3.3, 5.6] → 7.6 ; [3.11] → 7.7 ; [6.7] + {7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7} → 7.8 ⇒ G7 (the Stress Box)
Library:  G0 → 8.1 ; [0.11, 1.1] → 8.2 → 8.3 ; [3.7, 3.8] + 8.3 → 8.4 ; {8.1, 8.3, 8.4} → 8.5 ; [6.6] + {8.1, 8.4} → 8.6 ;
          [6.6] + 8.4 → 8.7 ; [7.8] + 8.6 → 8.9 ⇒ G8 ; G8 → 8.8
Audio:    G1 → 9.1 → 9.2 → 9.4 ; [3.1, 4.2] + 9.2 → 9.3 ; [7.8] + {9.3, 9.4} → 9.5 ⇒ G9
Expand:   G7 → {10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8} ⇒ G10
WebGPU:   G7 → 11.1 → {11.2, 11.4, 11.5} ; {11.1, 11.2} → 11.3 ⇒ G11   (11.3, 11.4 and 11.5 start only on their triggers)
Tooling+: G7 → {12.1, 12.2, 12.3, 12.4, 12.5} ⇒ G12
Upgrades (each when it qualifies, between stages): U-1 Vitest 4 ; U-2 three r181 (+ r182 if it works the same) ; U-3 the lint majors ;
          U-4 three r183 ; U-5 Vite 8, TypeScript 6 ; U-6 Node 26 ; U-7 Rapier 0.20 ; U-8 three r184 and later ; U-9 the platform's Chromium
```

### 9.3 Definition of done for every work package

A WP is done only when all of these hold:
1. Its **Verify** commands exit 0, and `npm run check` and `npm test` are green.
2. The T2 suites covering what it touched are green on **both** backends.
3. Every new module has its file comment and every export its doc comment, and `x docs --check` passes. INDEX, API and ERRORS were regenerated with `x docs --write`. In ultracode lanes (detected automatically, WP 0.4), drift is a warning and the integrator regenerates.
4. A new kind from §8.13's list has its scaffold template and its `gallery` hook. WP 7.7 renders every hook registered before it. A kind with a QA family has its checks (§8.6).
5. **The box rule.** A capability built in Phases 2–7 is exercised by the box (its stage's integration WP) or by a fixture test, and the WP's Done-when list says which.
6. The `verifier` subagent has reviewed the diff against `DOCTRINE.md` and the WP's **Done when**, and every finding was fixed or answered. The subagent arrives in WP 0.10, so it reviews WPs 0.1–0.9 and 0.11 at G0.
7. Compatible releases found by `x deps --update` at the WP's start were adopted in their own commit first (§6.10).
8. No new advice codes appear during tests, unless they are allowlisted with a reason.
9. Every escalation raised during the WP is recorded in `docs/escalations/`, and every call made in the owner's absence is named in the ledger note.
10. The ledger (§14) row is updated: status, commit and notes. In extra-effort mode the agent writes it in the same commit. In ultracode, lanes report and the integrator writes it. Deviations from this plan are recorded as ADR amendments, never silently.

**Phase 0 bootstrap.** Items 1–3, 7 and 8 apply once their tools exist: `npm test` (WP 0.2), `npm run check` (0.4), `x deps` (0.3), the advice trap (0.5), `x docs` (0.6) and T2 (0.8). Item 9 applies from WP 0.7.

**Rules about paths and proofs:**
- **What Owns covers.** A WP's **Owns** also covers, without listing them:
  - the browser specs its Verify names (`tests/e2e/<suite>.spec.ts`), and the `tests/pages/<suite>.html` pages they load;
  - unit tests beside its modules or under `tests/unit/`;
  - the scaffold templates, `gallery` hooks and QA-baseline entries for the kinds and QA checks it introduces;
  - the baseline files it records: advice, perf and thumbnails (`tests/baselines/advice/<area>.json`, `tests/baselines/perf/<scene>.json`, `tests/baselines/thumbs/<case>.json`);
  - the **new** fixtures its Done-when names. Fixtures another WP owns are read-only.
- **Extending earlier work.** A later WP may extend a file an earlier WP created, and says so ("extends …"). Two WPs that may run at the same time (no path between them in §9.2) never own the same path.
- **Every claim is proved.** Each **Done when** bullet maps to a **Verify** step. Otherwise it is marked *(deferred proof: <where it is proven>)*, and the ledger records that.

**Format of each WP below:**
- **Owns**: the paths it may create or change. Anything else goes through the integrator, or is generated.
- **Needs**: the WPs that must be done and green first (§9.2).
- **Carry**: exact source paths at `my-3d2dge@e37e4ee`. Omitted when nothing is carried.
- **Build**: the deliverables.
- **Improves**: §7 ids. Omitted when none apply.
- **Done when**: measurable outcomes.
- **Verify**: commands that must exit 0.
- **Size**: S (under 300 new lines), M (under 1,000), L (under 2,500). A WP that would exceed L is split.

### Phase 0: Foundation (lane T)

#### WP-0.1 Repo constitution, the platform and the source checkout
- **Owns:** `AGENTS.md`, `CLAUDE.md`, `README.md`, `LICENSE`, `.gitignore`, `.editorconfig`, `.nvmrc`, `package.json`, `package-lock.json`, `tsconfig.json`, `scripts/setup.sh`, `docs/decisions/`, `tests/unit/ts-smoke.test.ts` (the type smoke test)
- **Needs:** —
- **Size:** S
- **Carry:** the source's `CLAUDE.md`, as input only. MIT `LICENSE`.
- **Build:**
  - AGENTS.md (Appendix E), and CLAUDE.md (`@AGENTS.md` plus Claude notes). Both send the reader to `DOCTRINE.md` first. `DOCTRINE.md` already exists; agents change it only when the owner asks (§8.10).
  - ADR-0001…0019 recording §13, each one page or less.
  - **The platform.** `.nvmrc` names Node 24.21.0. `scripts/setup.sh` is idempotent:
    - when the active `node` is not `.nvmrc`'s version, it downloads the official Linux x64 build from nodejs.org, checks it against `SHASUMS256.txt`, unpacks it under `~/.cache/my3dge/`, puts it first on `PATH`, and appends that `PATH` to `$CLAUDE_ENV_FILE` when the variable is set;
    - then it runs `npm ci`;
    - offline, it says so and leaves the container's Node 22 in place. Everything runs on Node 22 too (§4.7), but Node goldens are recorded on 24.
  - **Exact pins** in `package.json`, with the lockfile (§6.10, §4.7):
    - `dependencies`: `three@0.180.0` and `@dimforge/rapier3d-compat@0.19.3`;
    - `devDependencies`: `typescript@5.9.3`, `@types/three@0.180.0` and `@types/node@24.19.2`. WPs 0.2 and 0.4 add the toolchain.
  - `package.json` also sets `"type": "module"`, `engines.node` to `>=24.10 <25` (a warning, not `engine-strict`), `allowScripts` denying esbuild's postinstall, and the scripts of §8.1.
  - `tsconfig.json`:
    - `target: es2022`, `module: esnext`, `moduleResolution: bundler`;
    - `strict`, `noEmit`, `skipLibCheck`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `isolatedModules`;
    - `lib: es2022, dom, dom.iterable`, and `types: ["node"]`. three.js's types arrive through its imports;
    - `include`: `engine`, `labs`, `tests`, `fixtures`, `tools`, and the config files.
  - `.gitignore`: `out/ dist/ .cache/ node_modules/ test-results/`.
  - README: what this is, the doctrine, the Stress Box, how to start, links.
  - **The source checkout.** `MY3D2DGE_SRC` (an absolute path) names a read-only checkout of my-3d2dge at `e37e4ee`. Resolve it in this order:
    1. the environment variable;
    2. an existing local clone (in the Claude Code cloud image: `/home/user/michaelcrosato/my-3d2dge`), via `git clone --shared <path> .cache/src-3d2dge`;
    3. `git clone https://github.com/michaelcrosato/my-3d2dge .cache/src-3d2dge`.

    For cases 2 and 3, then run `git -C .cache/src-3d2dge checkout --detach e37e4ee`. Every `x` command that reads the source resolves it the same way (`$MY3D2DGE_SRC`, else `.cache/src-3d2dge`, else the clone above), so no shell state is needed. Every **Carry** read and `x port refs` go through `$MY3D2DGE_SRC`. AGENTS.md says how to set it.
  - **The type smoke test** `tests/unit/ts-smoke.test.ts` (Vitest) imports `three/webgpu`, `three/tsl` and `@dimforge/rapier3d-compat`, and constructs and steps a `World`. A `// @ts-expect-error` above `world.createRigidBody(123)` makes `tsc` fail if Rapier's types ever degrade to `any` again (§4.7). `skipLibCheck` stays: Rapier 0.19.3's `raw.d.ts` re-exports a module the package does not ship.
- **Improves:** I-01 (recorded as an ADR), I-31, I-32.
- **Done when:**
  - `scripts/setup.sh` installs Node 24.21.0 when it is missing and does nothing when it is active; `npm ci` succeeds; `tsc` runs clean; the smoke test passes. Later shells use Node 24 *(deferred proof: WP 0.10's SessionStart test)*.
  - `$MY3D2DGE_SRC` resolves to `e37e4ee`.
  - AGENTS.md is 150 lines or fewer.
- **Verify:** `bash scripts/setup.sh && npx tsc --noEmit && npx vitest run tests/unit/ts-smoke.test.ts && test "$(git -C "${MY3D2DGE_SRC:-$PWD/.cache/src-3d2dge}" rev-parse --short=7 HEAD)" = e37e4ee`

#### WP-0.2 The toolchain, the e2e fixture and the `x` CLI
- **Owns:** `x.js`, `tools/x.ts`, `tools/cmd/{help,src}.ts`, `tools/lib/{report,browser,vite,source,tokens,hash}.ts`, `vite.config.ts`, `playwright.config.ts`, `.prettierrc.json`, `tests/e2e/fixtures.ts`, `tests/e2e/harness.spec.ts`, `tests/pages/harness.html`; extends `package.json` and `package-lock.json` (from WP 0.1) with the toolchain
- **Needs:** WP 0.1
- **Size:** M
- **Carry:**
  - The virtual clock plus seeded `Math.random` from `tools/filmstrip.mjs:39-53` (COPY).
  - The headless WebGPU flags, the stand-in `getContext('webgpu')` and `__readFrame` from `tools/lab3d-test.mjs:70-102` (COPY).
- **Build:**
  - **The standard tools** of §6.10, pinned in `package.json`: Vite, Vitest, Playwright Test, Prettier and tsx.
  - **`vite.config.ts`:**
    - every `labs/*/index.html` and `tests/pages/*.html` as a page;
    - `resolve.alias` from a bare `three` to `three/webgpu` (§6.10);
    - Vitest's settings: the Node environment, `include: ['**/*.test.ts']`, `tests/e2e/` excluded, the `dot` and `json` reporters (`out/test/report.json`).
  - **`playwright.config.ts`:**
    - `testDir: tests/e2e`; projects `webgpu` and `webgl2`, with the flags of §8.8 and `executablePath` from `CHROMIUM_PATH` (default `/opt/pw-browsers/chromium`);
    - a `webServer` that starts Vite on `PORT` (default 5173; each ultracode lane sets its own);
    - the `line` and `json` reporters (`out/e2e/report.json`);
    - `workers` from the machine's cores, at most 4, so parallel lanes don't starve Chromium.
  - **The shared fixture, `tests/e2e/fixtures.ts`:**
    - before page scripts run: the virtual clock, named seeded streams, and on the `webgpu` project the stand-in canvas;
    - a `ready || error` wait, `readFrame` and `assertBackend`;
    - console capture, for the advice trap of WP 0.5;
    - page errors mapped to `.ts` files and lines through Vite's source maps.
  - **`x.js` and `tools/x.ts`:** tsx's `register()`, then the dispatcher: `parseArgs`, help generated from file comments, the `report.json` writer and the exit codes (§8.1). Every report records the runtime.
  - **`tools/lib/vite.ts` and `tools/lib/browser.ts`:** a Vite dev server through its JavaScript API, and Chromium through Playwright's library with the options of `playwright.config.ts`, for the `x` commands that open pages.
  - **`x src`:** prints and checks `$MY3D2DGE_SRC`, cloning it as in WP 0.1 when it is missing.
    Tests that read the source call `requireSource()` (`tools/lib/source.ts`). When the source cannot be resolved
    (offline), they skip and the summary reports `deferred: no source`. `x ci --local` runs `x src` first and fails if
    it cannot resolve the source, so nothing is deferred there.
  - **Helpers:** a token counter and the FNV hash.
  - **The harness check:** `tests/pages/harness.html` throws from a `.ts` module, and `tests/e2e/harness.spec.ts` checks on both projects that the fixture names the right file and line, that the clock is virtual, and which backend ran.
- **Improves:** I-26, I-48.
- **Done when:**
  - `node x help` exits 0 from the repo root and lists every command.
  - `npm test` runs the tools' unit tests (the report schema, the dispatcher's exit codes), and a filter that matches nothing exits 1.
  - The harness spec passes on both projects.
- **Verify:** `node x help && npm test -- tools/ && npm run e2e -- tests/e2e/harness.spec.ts`

#### WP-0.4 ESLint rules and `npm run check` (T0)
- **Owns:** `eslint.config.js`, `tools/eslint/`, `tools/cmd/{check,sizes,qa}.ts`, `tests/baselines/README.md`, `data/APPROVED-BINARIES.json`; extends `package.json` and `package-lock.json` (from WP 0.1) with ESLint
- **Needs:** WP 0.2
- **Size:** M
- **Carry:** the banned list from `tools/lab3d-test.mjs:28-43` (PORT; Appendix B).
- **Build:**
  - **ESLint** (§6.10) with `typescript-eslint`'s recommended rules (no type information, so T0 stays fast), `eslint-plugin-jsdoc` and `globals`. One block per rule family, each message naming the fix:
    - **the layer rules** (§6.1): `no-restricted-imports` per directory, including the box's sim-side scenes and the fixture scenes. `allowImportNames` limits `core/math.ts` to three.js's math classes;
    - **banned APIs**, scoped by path (Appendix B): r180's deprecations, names from newer releases that r180 lacks, and compute APIs outside `engine/gfx/enhanced/` except the `BASELINE_COMPUTE` files;
    - **reproducibility bans** for sim-side code (§6.5), through `no-restricted-properties`, `no-restricted-globals` and `no-restricted-syntax`. `*.test.ts` files are exempt;
    - `jsdoc/require-file-overview`, and `max-lines` (a warning at 400, an error at 600), for code under `engine/`, `tools/`, `labs/` and `tests/`;
    - **the local plugin** (`tools/eslint/`) for what no stock rule expresses, starting with "ask the entry, never the id" (WP 1.2 turns it on).
  - **`npm run check`:** `tsc --noEmit`, `eslint --cache .`, `prettier --check --cache .`, then `node x check`.
  - **`x check`**, the repository checks no standard tool covers, built from plugins:
    - **the asset scan** (doctrine: Assets): file extensions, magic bytes, and any base64 run or `data:` URI over 1 KB. A binary file passes only if `data/APPROVED-BINARIES.json` lists it with its escalation record, or if it is a font (WOFF2, TTF, OTF) under `data/fonts/` with a license file beside it. Anything else fails with "needs the owner's approval: `x esc open --principle Assets`";
    - token budgets, also run alone as `x sizes`;
    - plugins added later: dependency pins (WP 0.3), docs drift (WP 0.6) and escalation records (WP 0.7).
  - **Lane mode is detected, not configured.** `x check` treats a linked git worktree as an ultracode lane, and reports docs drift there as a warning (§11.3). A linked worktree is one where `git rev-parse --git-dir` differs from `--git-common-dir`. `X_LANE=0|1` overrides the detection.
  - **The `x qa` dispatcher:**
    - usage: `x qa <family…> [--only <prefix…>]`. `--only` filters ids by prefix (`clip:`, `action:`, `prop:`);
    - baseline files `tests/baselines/qa-<family>[-<area>].json`, each owned by the WP that creates it, with entries `{ id, metric, value, reason }`;
    - families are plugged in later: level (WP 2.2), tex (2.3), geo (2.4), anim (6.6), audio (9.4). Each family also runs in T1 as a Vitest test.
- **Improves:** I-31, I-42, I-47, I-48.
- **Done when:** every rule has a failing fixture and a passing fixture, and `npm run check` on the repo takes under 10 s. Tests write failing fixtures to a temporary directory and lint them through ESLint's Node API; nothing failing is committed.
- **Verify:** `npm run check && npm test -- tools/eslint tools/cmd/check`

#### WP-0.5 Test tiers, selection and the advice trap
- **Owns:** `tools/lib/tiers.ts`, `tests/setup/adviceTrap.ts`, `tests/baselines/advice/README.md`; extends `tests/e2e/fixtures.ts` and `vite.config.ts` (from WP 0.2) with the advice trap
- **Needs:** WP 0.4
- **Size:** S
- **Carry:** the ideas of `tools/test-run.mjs`: a reason for each selection, the timing table, and the version-only filter (a commit that changes only `package.json`'s version selects nothing).
- **Build:**
  - **The tiers** as npm scripts (§8.1, §8.2): T0 `npm run check`, T1 `npm test`, T2 `npm run e2e`, and the long runs.
  - **Selection** (§8.2): T1 through `vitest run --changed <base>` and `vitest related`. T2 runs in full when engine, lab or page code changed, and otherwise as `playwright test --only-changed <base>`. `tools/lib/tiers.ts` computes the base (the merge-base with `origin/main` once `main` holds a gate, else `out/ci/last-green`) and the T2 decision, for `x ci --local`.
  - **Budget enforcement:** `tools/lib/tiers.ts` reads the JSON reports, warns when a tier is over its budget, and fails at 1.5×.
  - **The advice trap.** A Vitest setup file and the Playwright fixture both fail on any engine advice code, `console.warn` or three.js deprecation that is not listed in a file under `tests/baselines/advice/`. Each area has its own file of `{ code, reason }` entries, owned by the WP that adds them; the trap reads the whole directory.
- **Improves:** I-27, I-41, I-48.
- **Done when:**
  - In a temporary git repository the test builds, a change to a fixture `engine/core/a.ts` selects every Vitest test that imports it, directly or not, and a change to page code makes T2 run in full.
  - An unlisted warning fails a fixture test in each harness; a listed one passes.
  - A report over its budget warns, and one at 1.5× fails.
- **Verify:** `npm test -- tools/lib/tiers tests/setup`

#### WP-0.3 Dependency qualification and pinned knowledge
- **Owns:** `tools/cmd/deps.ts`, `tools/deps.json`, `docs/THREE-DELTA.md`, `docs/reference/three-tsl-wiki.md`, `tests/baselines/advice/deps.json`
- **Needs:** WP 0.4
- **Size:** M
- **Carry:** the idea of `tools/vendor-3d.mjs`'s checked pins. §4.7 and Appendix B.
- **Build:**
  - **`tools/deps.json`** records, for every direct dependency:
    - its qualifying release and pin, with their dates;
    - the rule that admits the pin: it qualifies, it is compatible, it works the same way (with its ADR), or it is the platform's;
    - the next line, and the date it qualifies;
    - why it is a dependency at all (doctrine: Common ground).
  - **`x deps --check`** (offline; WP 0.4's `x check` runs it as a plugin): `package.json` and the lockfile match `tools/deps.json`; every dependency has a reason; the lockfile's `@types/*` and `@webgpu/*` packages follow the same rule; and the active `node` is `.nvmrc`'s (a warning otherwise).
  - **`x deps --update`** (network): asks the registry (`npm view <pkg> time --json`) for releases newer than each pin within its compatible range, installs them with `--save-exact`, updates `tools/deps.json`, and runs T0 and T1. `--dry-run` only lists them.
  - **`x deps --qualify`** (network): lists the lines that have newly qualified, with their dates, as upgrade WPs to schedule.
  - **`docs/THREE-DELTA.md`:**
    - r180 for agents who know newer releases (`RenderPipeline` → `PostProcessing`; no `DynamicLighting`, `ClusteredLighting` or `TextureSource`; `packNormalToRGB` → `directionToColor`…);
    - r180 for anyone reading the prototype's r182 code (the MRT path, §4.7);
    - what U-2 will change, so code written now avoids it (`renderAsync`, `waitForGPU`).
  - **`docs/reference/three-tsl-wiki.md`:** the TSL wiki page at revision `00d6fe7` (2025-10-01), the last edit before r181, taken from the wiki's git repository, with the source and revision in its header. Each three.js upgrade moves it to the last revision before the next release.
  - **Rapier's init warning.** Rapier 0.19.3's `init()` prints one `console.warn` (deprecated initialization parameters). Allowlist it in `tests/baselines/advice/deps.json`, with that reason.
- **Improves:** I-15, I-42, I-45.
- **Done when:**
  - `x deps --check` passes on the pins. It fails on fixture pins, written to a temporary directory, that are too new, that are older than the newest compatible release recorded, or that lack a reason.
  - `x deps --update --dry-run` lists nothing to adopt right after the pins are set *(deferred proof when offline: the next `x ci --local` with network)*.
  - A Node test imports Rapier (and steps a world) and `three/webgpu` from `node_modules`.
- **Verify:** `node x deps --check && npm test -- tools/cmd/deps`

#### WP-0.6 Docs system
- **Owns:** `tools/cmd/{docs,new}.ts`, `tools/templates/module/`, `tests/unit/examples.test.ts`, `docs/{INDEX,API,ERRORS,TESTING}.md`
- **Needs:** WP 0.4
- **Size:** M
- **Carry:** the doctest extraction, path checks and token counting of `tools/agent-test.mjs:27-30, 185-235`.
- **Build:**
  - A reader for file and export comments, through the TypeScript compiler API.
  - **INDEX** (module → purpose → exports → tests), **API** (each export with the first sentence of its doc comment) and **ERRORS** (collected from every module's `defineCodes`).
  - **`@example` blocks** run in Node by `tests/unit/examples.test.ts` (T1); browser examples are flagged for T2.
  - **Token budgets and drift checks** (§8.12), registered as an `x check` plugin. `x docs --check` alone also runs the examples.
  - **Path checks:**
    - They cover file and export comments, AGENTS.md and `docs/*.md`.
    - `DOCTRINE.md`, `docs/research/`, `docs/reference/` and `docs/escalations/` are not checked.
    - Citations of the source repo are written `my-3d2dge:<path>[:line]`, and are checked against `$MY3D2DGE_SRC`.
  - **`x new`:** it discovers the kinds from `tools/templates/<kind>/` (each with a small manifest), and has `--test` and `--test-all`. This WP adds the `module` template (a file comment plus a test stub). Every later WP that adds a scaffolded kind (§8.13) adds its template there, without touching `new.ts`; WP 12.1 checks the coverage.
  - `docs/TESTING.md`: the tiers, the selection rule, the fixture, and how to add a suite.
- **Improves:** I-30.
- **Done when:** fixtures with a broken example, a stale INDEX, or a missing path each fail. They are written to a temporary directory by the test, never committed.
- **Verify:** `node x docs --check && npm test -- tools/cmd/docs`

#### WP-0.7 Escalations and decisions
- **Owns:** `tools/cmd/esc.ts`, `tools/lib/escalations.ts`, `docs/escalations/README.md`
- **Needs:** WP 0.4
- **Size:** S
- **Build:**
  - **The record**, `docs/escalations/ESC-NNNN-<slug>.md`: front matter with `id`, `title`, `status` (`open`, `answered`, `decided-in-absence`, `closed`), `principle`, `raised`, `deadline`, `run`, `options`, `recommendation`, `answer`, `call`, `commit` and `followUp`, then a short body.
  - **`x esc open | list | answer | decide | close`**, as §8.14 describes, with `--no-wait` for the rest of a run after a first timeout. `open` prints the message to post.
  - **An `x check` plugin:** records are well-formed, and an `open` record past its deadline with no call fails with "decide or answer ESC-NNNN".
  - **`docs/escalations/README.md`** is generated: the records by status, the calls awaiting the owner's review first.
- **Improves:** I-44.
- **Done when:** a test in a temporary directory opens an escalation, passes its deadline on a virtual clock, records a call and closes it; `x check` flags an overdue open record; the index regenerates.
- **Verify:** `npm test -- tools/cmd/esc && npm run check`

#### WP-0.11 Port reference vectors from my-3d2dge
- **Owns:** `tools/cmd/port.ts`, `tests/baselines/port/**`
- **Needs:** WP 0.2
- **Size:** M
- **Build:** `x port refs`:
  1. Reads the source at `$MY3D2DGE_SRC` (WP 0.1).
  2. Loads `engine/my-3d2dge.js` in a Node `vm`.
     - It needs only tiny shims; the source's `tools/mocap-lib.mjs:7-9` shows the pattern.
     - `Math.random` is replaced by a seeded generator, and `dt` is fixed.
     - It records each reference rig's **initial breathing phase** (`engine:1782`), so the port can inject the same value (WP 3.6).
  3. Writes reference vectors as text JSON:
     - outputs of `rng`, `hash2`, `noise2` and the colour helpers;
     - Humanoid joint trajectories over a state matrix: idle, walk, run, dash, air, climb, every pose and stance, 8 facings, 3 builds; 120 steps at 1/120 s;
     - `E.move(name, u, phase)` hand and blade-tip positions for all 24 moves, with u in steps of 0.05;
     - Blob updates.

     WP 8.2 extends it with the clip decodes of the library.
- **Done when:**
  - The vectors exist, with a README naming the source commit and the conversion (Appendix C).
  - Re-running produces byte-identical files.
  - `--check` compares the committed vectors with their recorded checksums offline.
- **Verify:** `node x port refs && git diff --exit-code tests/baselines/port && node x port refs --check`

#### WP-0.8 Hello page on both backends
- **Owns:** `labs/hello/`, `engine/gfx/renderer.ts` (minimal), `tools/cmd/shot.ts` (basic: render, read back, PNG, metrics), `tests/e2e/hello.spec.ts`
- **Needs:** WP 0.3, WP 0.5, WP 0.6
- **Size:** S
- **Build:**
  - A lit procedural cube with a classic `MeshStandardMaterial`, drawn directly and through one `PostProcessing` pass (a TSL colour grade, no MRT). It proves r180's post path on both backends, headless.
  - The renderer starts with `await renderer.init()` and draws with `render()`, never `renderAsync()`, which r181 deprecates.
  - A minimal `__engine.info()`, and `ready`/`error` signalling.
  - `x shot labs/hello --backend both`, writing a PNG and metrics.
- **Done when:**
  - T2 passes on WebGL 2 and on WebGPU (SwiftShader) in the cloud container.
  - The backend is asserted, and the frame is not blank, with and without the post pass.
  - Vite resolves `three/webgpu` and `three/tsl` in the browser, and its alias sends a bare `three` to the same module.
- **Verify:** `npm run e2e -- tests/e2e/hello.spec.ts && node x shot labs/hello --backend both`

#### WP-0.9 Continuous integration
- **Owns:** `tools/cmd/ci.ts`, `tools/ci/ci.yml`
- **Needs:** WP 0.8
- **Size:** S
- **Build:**
  - **`x ci --local`**: the steps of §8.9 on the local machine, with a summary in `out/ci/summary.md` and the commit in `out/ci/last-green`. It is the merge gate.
  - **`tools/ci/ci.yml`**, with the same steps: §8.8's container, `actions/setup-node` from `.nvmrc`, `npm ci`, `node x ci --local`, artifacts and a step summary. A unit test checks its steps against `x ci --local`'s. The actions it uses follow §6.10's rule too.
  - **`x ci --install-workflow`** copies it to `.github/workflows/ci.yml`. It refuses until an escalation record shows that the owner enabled Actions and granted the `workflow` scope (§11.5), because a workflow file pushed without that scope makes GitHub reject the whole push.
- **Improves:** I-33.
- **Done when:** `x ci --local` passes; the workflow test passes; and a unit test finds the escalation record about Actions with status `answered`, `decided-in-absence` or `closed`.
- **Verify:** `node x ci --local && npm test -- tools/cmd/ci`

#### WP-0.10 Claude Code integration
- **Owns:** `.claude/`, `tests/unit/hooks/`
- **Needs:** WP 0.7, WP 0.9
- **Size:** S
- **Carry:** `.claude/hooks/session-start.sh` (PORT: run `scripts/setup.sh`; add `x src` and the open escalations).
- **Build:**
  - Hooks and permissions, as in §8.10.
  - The skills `x-loop`, `three-webgpu` (from THREE-DELTA plus Appendix B), `rapier` and `escalation`, plus stubs that later WPs fill: `determinism-debugging` (WP 1.5) and `stress-box` (WP 2.7).
  - **All four subagents:** `verifier`, `visual-reviewer`, `suite-runner`, `api-checker`.
  - Unit tests for the hook scripts, run against fixtures.
- **Improves:** I-34.
- **Done when:**
  - Run against a fixture environment, the SessionStart script installs nothing when Node 24 is active, writes the `PATH` and `MY3D2DGE_SRC` lines to `$CLAUDE_ENV_FILE`, and lists open escalations.
  - Writing a banned API makes the PostToolUse hook fail, naming the replacement.
  - An edit to `DOCTRINE.md` makes the PreToolUse hook ask the owner.
  - The Stop hook runs `npm run check`.
  - A fresh cloud session starts clean, and the four subagents load *(deferred proof: checked at G0 and noted in the ledger)*.
- **Verify:** `npm test -- tests/unit/hooks`

**Gate G0:**
- These are green in `x ci --local`: `npm run check` (with `x deps --check` and `x docs --check`), `npm test`, `npm run e2e` (the harness and hello suites on both projects) and `x port refs --check`.
- No escalation is open past its deadline.
- The `verifier` subagent has reviewed WPs 0.1–0.9 and 0.11 retroactively.

### Phase 1: The kernel (lane C)

#### WP-1.1 Math, randomness, noise, hashing, colour
- **Owns:** `engine/core/{math,rng,noise,hash,color}.ts` and their tests
- **Needs:** G0
- **Size:** M
- **Carry:**
  - `engine:72-96` (`clamp lerp approach ease angDiff lerpAng approachAng smoothDamp`).
  - `E.rng` (Mulberry32), `E.hash2`, `E.noise2`.
  - The colour helpers.
  - `hashNumbers` (`stress-world/00-setup.js:59`).
- **Build:**
  - **`math`:** re-exports three.js's math classes (`Vector3`, `Quaternion`, `Matrix4`, `Euler`, `Box3`, `Sphere`, `Ray`, `Plane`, `MathUtils`) from `three/webgpu`, so every layer shares one set of math types (doctrine: Common ground). It adds only what three.js lacks: the source's angle helpers (`angDiff`, `lerpAng`, `approach`, `approachAng`, `smoothDamp`), swing-twist decomposition, and easing. `MathUtils` already covers `clamp`, `lerp`, `damp` and `smoothstep`.
  - **`rng`:** named streams, `derive(seed, …keys)`, getting and setting state.
  - **`noise`:**
    - `hash2`, bit-exact with the source;
    - value, gradient and cell noise in 2D and 3D, with fbm octaves;
    - periodic (tiling) variants;
    - all seeded. Where a module needs Perlin or simplex noise beyond the source's, three.js's `ImprovedNoise` and `SimplexNoise` addons come first.
  - **`hash`:** 64-bit FNV-1a (two 32-bit lanes) over float64 bits, plus a canonical serializer.
  - **`color`:** hex, sRGB ↔ linear (over three.js's `Color` where it fits), and `tones/ramp/shade/mix`, bit-exact with the source.
- **Improves:** I-05, I-49.
- **Done when:**
  - The outputs match the reference vectors bit for bit (`rng`, `hash2`, `noise2`, colour).
  - The angle helpers match the source's within 1e-12.
  - ESLint's reproducibility bans pass across `engine/core`, and `core/math` re-exports nothing but math classes.
- **Verify:** `npm test -- engine/core && npm run lint`

#### WP-1.2 Registry, events, log, settings, schema
- **Owns:** `engine/core/{schema,registry,events,log,settings}.ts`, `tools/cmd/describe.ts`
- **Needs:** WP 1.1
- **Size:** M
- **Carry (mechanisms):**
  - `ed/00-core.js:76-117`: registry, bus, streams.
  - `ed/01-tune.js`: knobs.
  - `engine:65-66`: warn-once.
- **Build:**
  - **A schema mini-language:** type, default, range, unit, doc, enum, required, hooks with defaults, `when` (`now | spawn | scene`), and a `gallery` hook (camera, duration, states) that WP 7.7 later renders.
  - **Registry:** `defineKind`, `def`, `get`, `list`, `describe`. A missing id warns once, suggests the closest names, and returns the fallback. The local ESLint rule "ask the entry, never the id" (WP 0.4) is turned on here.
  - **Events:** scoped listeners (`scope.dispose()`), each listener isolated so its failure is recorded in `errors`, and a trace ring.
  - **Log:** warn-once and structured errors. Each module registers its own codes beside its code: `defineCodes('anim', { CODE: { template, fix, doc } })`. `x docs` collects them, and there is no central table.
  - **Settings:** one schema drives URL parameters, a validated `set` and `get`, JSON export and import, and a "differs from default" marker. `x set` arrives in WP 2.7.
- **Improves:** I-36, I-37, I-41.
- **Done when:** unit tests cover every behaviour, and `docs/ERRORS.md` is generated from the codes the modules register.
- **Verify:** `npm test -- engine/core && node x docs --check`

#### WP-1.3 Time
- **Owns:** `engine/core/time.ts`
- **Needs:** WP 1.2
- **Size:** M
- **Carry:**
  - The fixed loop of `lab3d/60-panel.js:143-152`.
  - `Attack.update`'s leftover-time carry (`engine:2467-2504`).
  - The hit-stop budget of `ed/10-combat.js:45-76`, and the slow-motion stack of `ed/00-core.js:146-161`. Mechanism only. The source's slow motion reads the wall clock; the new one must not.
  - The timers of `engine` §10.
- **Build:**
  - `createClock({ hz: 60, maxSteps: 6, now })`, an accumulator and `alpha`.
  - A timescale stack: `push(id, k)`/`pop(id)`, where the slowest wins.
  - A leaky hit-stop budget, so a crowd stutters once.
  - Per-entity clocks.
  - Timers `after` and `every` in sim time, returning `{ cancel }`.
  - A virtual clock for tests.
- **Improves:** I-02.
- **Done when:**
  - With seeded random frame times at 30, 60, 75, 120 and 144 Hz, the state after 10 s is identical to fixed stepping.
  - The stack, budget and timers are unit-tested.
- **Verify:** `npm test -- engine/core/time`

#### WP-1.4 Sim world and canonical state
- **Owns:** `engine/sim/{world,systems,state,capture}.ts`
- **Needs:** WP 1.3
- **Size:** M
- **Build:**
  - Entities with monotonic ids.
  - Component kinds registered with field lists.
  - Spawn and despawn queues that apply at step boundaries.
  - An explicit list of systems in order, and an event flush.
  - `state()`, `hash()` (engine plus RNG plus a physics hook) and `trace()`.
  - `capture()` and `restore()` for the engine part; physics plugs in at WP 3.1 (§6.5).
- **Improves:** I-03, I-05.
- **Done when:**
  - Changing any registered field changes the hash.
  - Drawing from an `fxRng` stream never changes `hash()`.
  - capture → restore → step equals an uninterrupted step (no physics yet, so the round trip is exact).
  - The hash is stable across runs.
- **Verify:** `npm test -- engine/sim`

#### WP-1.5 Intents, scenes, replays, `x sim`, `x replay`
- **Owns:** `engine/input/intents.ts`, `engine/sim/{scene,replay}.ts`, `tools/cmd/{sim,replay,perf}.ts`, `fixtures/scenes/kernel/`, `tests/replays/README.md`, `tests/replays/kernel-*.replay.json`, `tests/pages/replay.html`, `.claude/skills/determinism-debugging/`
- **Needs:** WP 1.4
- **Size:** M
- **Build:**
  - The intents vocabulary: move `[x, z]` in world space, camera heading, aim point, look, buttons pressed and held, and custom namespaced keys.
  - `intents.fromCamera(yaw, axes)`: pure math that turns stick or keys into a world-space move, so W walks away from the camera. WPs 3.3 and 3.10 use it.
  - **Scenes, sim-side:** `defineScene(id, { level?, settings, setup, step })` and the scene registry, in `engine/sim/scene.ts`. The `kernel` fixture, the box's scenes and `createHeadless` all use it, so no scene imports `app/`.
  - The replay format (§8.4), with a recorder and a player, and golden hashes keyed by runtime (§6.5). The recorder keeps every step's intents from step 0.
  - `x sim`, with `--set` and `--scene`.
  - `x replay` with `--update` and `--bisect`.
  - `x replay --browser chromium` runs the replay inside `tests/pages/replay.html`: the sim in a page, no renderer, Chromium's goldens. WP 2.7 adds the rendering backends.
  - `x perf` for Node: sim milliseconds per step against budgets. WP 5.5 adds browser counters and the crowd ladder.
  - The `kernel` fixture scene: a few scripted movers with no physics.
- **Improves:** I-03, I-04, I-06.
- **Done when:**
  - A fixture replay gives the same hashes three times in Node, and three times in Chromium; each runtime's goldens are recorded.
  - `--bisect` finds an injected divergence at the right step, entity and field.
  - On a runtime key that differs from the recorded ones, the replay runs twice, compares the runs and reports "golden: other runtime".
- **Verify:** `npm test -- engine/sim && node x replay tests/replays --browser chromium`

#### WP-1.6 Headless app and the inspector core
- **Owns:** `engine/app/headless.ts`, `engine/dev/inspector.ts`, `engine/index.ts`
- **Needs:** WP 1.5
- **Size:** S
- **Build:**
  - `createHeadless({ scene, seed, settings })`, over the scene registry of WP 1.5.
  - **The inspector as a registry kind:** `def('inspectorMember', name, impl)`. `engine/dev/inspector.ts` assembles `__engine` from the registered members, so later WPs add members from their own files and no layer imports `dev/` (§8.3).
  - The core members: `info`, `pause`, `step`, `state`, `hash`, `trace`, `entities`, `get`, `set`, `capture`, `restore`, `describe`, `help`, `errors`, `advice`. In Node, the rendering members throw a coded "no renderer" error.
  - The same shape in the browser; WP 2.7 wires it into pages.
- **Improves:** I-03, I-25.
- **Done when:**
  - `x sim fixtures/scenes/kernel` runs through `createHeadless`.
  - A member registered from a test file appears in `__engine` and in `help()`.
  - `help()` matches the API.
- **Verify:** `node x sim fixtures/scenes/kernel --steps 600 && npm test -- engine/dev/inspector && node x docs --check`

**Gate G1:**
- `npm test` (core and sim) is green.
- The kernel fixture's replay is identical three times in Node and three times in a Chromium page, against each runtime's goldens.
- `x docs --check` is green.

### Phase 2: Box 1, the box renders and steps (lanes R, W, T, B)

#### WP-2.1 Renderer, capabilities, features, resolution, warm-up
- **Owns:** `engine/gfx/{caps,features,resolution,warmup,pipelines}.ts`; extends `engine/gfx/renderer.ts` (from WP 0.8); `tests/pages/scene.html` (renders a fixture scene description and exposes the renderer and the scene; render tests import the modules they test into it)
- **Needs:** G1
- **Size:** M
- **Carry:**
  - The renderer bootstrap of `stress-world/00-setup.js:66-76`.
  - `fit()`, the resolution modes (`stress-world/50-frame.js:18-28`).
  - `warmUp()` (`stress-world/50-frame.js:29-47`), as the idea for a registry.
- **Build:**
  - `await renderer.init()`, then `render()` (never `renderAsync()`, which r181 deprecates); a report of backend, compat mode, features and limits; `?backend=webgl` forces WebGL 2; `renderer.onError` routed to the log.
  - **The WebGPU feature registry** of §6.7: `def('feature', …)`, capability checks, and advice on every fallback.
  - Resolution modes: pixels (200–330 lines, whole-pixel scaling), balanced, full; DPR handling and resize.
  - Interpolation alpha; stats from `renderer.info`.
  - **The warm-up registry:** pools and batches register themselves; `compileAsync` with progress; a re-warm on every shader-key change (fog, shadows, filters, light count).
  - **The public pipeline counter**, the single place that reads renderer internals, pinned to r180 by a test.
- **Improves:** I-15, I-16, I-18.
- **Done when:**
  - T2 asserts the backend and the compat flag on both backends, and forced WebGL works.
  - A scripted session that switches resolution modes and shows a registered pool builds 0 pipelines after warm-up.
  - The counter's pin test fails if r180's internals change.
- **Verify:** `npm run e2e -- tests/e2e/renderer.spec.ts`

#### WP-2.2 The level compiler (v1)
- **Owns:** `engine/world/level/**`, `tools/qa/level.ts`, `fixtures/levels/`
- **Needs:** G1
- **Size:** M
- **Carry:**
  - `parseLevel` (`engine` §13).
  - The glyph meanings of `stress-world/10-hall.js:22-91` (`#`, `w`, `P`, `.`) and `lab3d/20-world.js:12-35`.
  - `rects()`, the greedy rectangle merge (`stress-world/10-hall.js:81-91`); `floorH` and `topH` (`:104-115`).
- **Build:**
  - **A legend registry** (kind `glyph`). Each glyph maps to: height, top, solid, collider recipe, mesh recipe, nav flags, spawn, light spot and surface tag.
  - **`compile`** produces height queries (`floorH`, `topH`), a solid grid, collider descriptors (greedy merged boxes), mesh descriptors, spawns and light spots. It is sim-side: no meshes, no Rapier.
  - **`validate()`**, which reports unknown glyphs, unreachable spawns and ragged rows.
  - **The v1 glyphs:** floor `.`, wall `#`, low wall `w`, pillar `P` (2 × 2), and spawn markers. WP 4.2 adds galleries, stairs, the dais and braziers.
  - The `level` QA family.
- **Improves:** I-22, I-29.
- **Done when:**
  - The compiler fixtures compile, and compiling is reproducible (hashed).
  - `validate()` catches every seeded error.
  - The merged colliders cover exactly the solid tiles, and the heights match hand-computed values.
- **Verify:** `npm test -- engine/world/level && node x qa level`

#### WP-2.3 Materials and procedural textures (v1)
- **Owns:** `engine/gfx/materials/**`, `engine/gfx/textures/**`, `tools/qa/tex.ts`
- **Needs:** WP 2.1
- **Size:** M
- **Carry:**
  - `E.tex`'s generators (`engine:3057-3101`).
  - The labs' texture functions: wall faces and blocks (`stress-world/10-hall.js:225-248`), crate and barrel (`stress-world/30-crowd.js:293-305`), `lab3d/10-materials.js:20-66`.
  - `bake()` (`stress-world/00-setup.js:80-89`), as a REWRITE.
- **Build:**
  - **A material registry** (kind `material`) over classic three.js materials, which `WebGPURenderer` converts on both backends (§6.7): lit (`MeshLambertMaterial`) and unlit or emissive (`MeshBasicMaterial`), with colour, texture and flags. The styles (toon, flat, pbr-lite) arrive in WP 7.2.
  - **A generator registry:** seeded, periodic generators giving albedo, height, roughness and emissive per texel.
  - **A CPU bake** to `DataTexture`s with mipmaps, normals from height, and pixel (nearest magnification) or smooth looks.
  - **The v1 set:** flagstone, brick courses, dressed stone, planks, barrel staves, checker. WP 7.3 adds the rest.
  - The tileability check (the `tex` QA family).
- **Improves:** I-20, I-49.
- **Done when:**
  - Every generator tiles: the mean difference across the wrap edge is at most 2% of the value range above that of neighbouring interior pairs.
  - Bakes are reproducible in Node (hashed).
  - Every material renders on both backends in `tests/pages/scene.html`.
- **Verify:** `npm test -- engine/gfx/textures engine/gfx/materials && node x qa tex && npm run e2e -- tests/e2e/materials.spec.ts`

#### WP-2.4 Geometry kit and level meshes (v1)
- **Owns:** `engine/gfx/geometry/**`, `engine/gfx/level/**`, `tools/qa/geo.ts`
- **Needs:** WP 2.2, WP 2.3
- **Size:** M
- **Carry:**
  - `boxGeo` with 16 texels per metre (`stress-world/10-hall.js:253-257`) and `sidesThenTops` (`:259-263`).
  - The wall cells, their outward directions and the instanced walls (`:264`, `:302-324`).
- **Build:**
  - **Pure builders to `BufferGeometry`:** box (UV per metre), rounded box, tapered limb, ramp or wedge, frustum, pillar parts, ring; `sidesThenTops`.
  - **Level meshes** from WP 2.2's descriptors: the floor, instanced walls (sides and tops in two groups), low walls and pillars, each registered with the warm-up.
  - The `geo` QA family.
- **Improves:** I-29.
- **Done when:**
  - Vertex counts, bounds, normals and the QA checks all pass in Node.
  - The room fixture's level meshes render on both backends in 20 draw calls or fewer.
- **Verify:** `npm test -- engine/gfx/geometry engine/gfx/level && node x qa geo && npm run e2e -- tests/e2e/level-meshes.spec.ts`

#### WP-2.5 Cameras (v1)
- **Owns:** `engine/gfx/cameras/{pose,presets,boost,orbit,fly,fixed,codes,place}.ts`
- **Needs:** WP 2.1
- **Size:** M
- **Carry:**
  - `stress-world/40-cameras.js`: the view poses, `placeCamera`, the `?cam=` links and `camDesc` (`:27-148`, `:266-338`).
  - `boost()`, `lab3d/50-cameras.js:31-40` (COPY).
  - The lab3d orbit.
- **Build:**
  - Pure pose functions: (state, input, dt) → pose.
  - Presets: iso, three-quarter, top-down, brawler, side and custom; ortho or perspective, with boost.
  - Orbit, fly and fixed cameras.
  - Camera codes (`?cam=`, `?cam3=`) and a description in words.
  - Cameras expose `yaw()`. `input/devices` (WP 3.3) passes it to `intents.fromCamera`, so W walks away from the camera, and `gfx` never imports `input/`.
- **Done when:**
  - The pose functions are unit-tested in Node (positions, look directions, ortho frame sizes).
  - Camera codes round-trip.
  - The classic views reproduce the boost: a 1 m cube's projected height matches the view's boost within 1%.
- **Verify:** `npm test -- engine/gfx/cameras`

#### WP-2.6 Shots, the ID pass and `x shot`
- **Owns:** `engine/gfx/{shot,idpass,lookMetrics,thumbnail}.ts`; extends `tools/cmd/shot.ts` (from WP 0.8); `tests/baselines/thumbs/README.md`
- **Needs:** WP 2.1
- **Size:** M
- **Carry:** the look metrics and notes of `tools/check.mjs:40-50, 96-104`.
- **Build:**
  - **`shot()`** renders into a render target and reads it back with `readRenderTargetPixelsAsync`.
  - **The ID pass:** flat per-object colours through an override material (no MRT), no antialiasing. It returns `visible: [{ id, name, px, bbox }]`.
  - Look metrics, and text thumbnails (48 × 27) per backend.
  - **`x shot`**: `--scene`, `--cam`, `--set`, `--ids`, `--metrics`; the PNG only on demand.
- **Improves:** I-28.
- **Done when:**
  - In `tests/pages/scene.html`, the ID pass reports every object of a fixture scene, on each backend.
  - Thumbnails are stable over 3 runs per backend.
  - `x shot` writes its `report.json` with the metrics and the ID-pass list.
- **Verify:** `npm run e2e -- tests/e2e/shot.spec.ts && npm test -- engine/gfx/shot`

#### WP-2.7 Box 1: the box app
- **Owns:** `engine/app/{engine,loop,routes}.ts`; `engine/dev/overlay.ts` (the error overlay); `labs/box/{index.html,main.ts,README.md}`, `labs/box/levels/room.txt`, `labs/box/scenes/room.ts`; `tools/cmd/{set,eval,dump,inspect}.ts`; extends `tools/cmd/replay.ts` (from WP 1.5) with the rendering backends; `tests/e2e/parity.spec.ts`; `.claude/skills/stress-box/`; `tests/replays/box-1-*.replay.json`
- **Needs:** WP 2.4, WP 2.5, WP 2.6
- **Size:** L
- **Carry:** the scene and timer patterns of `engine` §10. The stress-world page structure, as a reference only.
- **Build:**
  - **`createEngine`** with the loop of §6.4 (fixed step plus interpolation), and routes that map `?scene` to the scenes registered with `engine/sim/scene.ts` (WP 1.5): `?scene ?cam ?backend ?seed ?set ?replay`.
  - **The rendering members of `__engine`** (§8.3), registered from `engine/app/engine.ts`: `render`, `shot`, `camera`, `scene.dump`, `stats`.
  - **The error overlay**, and `ready || error`.
  - **`x set`** (schema-validated; prints the URL parameter and applies it to the inspect session), **`x eval`** and **`x dump`**, over **`x inspect`**.
  - **The play-alike proof** (doctrine: GPU-free gameplay): `x replay --browser webgl2|webgpu|both` runs a replay in the scene's own page, rendering at least every 10th step, against Chromium's goldens. `tests/e2e/parity.spec.ts` starts here with the box-1 replays; each later stage adds its scenes.
  - **The box, stage 1:** the page; `levels/room.txt` (16 × 12 m: walls, one low wall, a pillar, spawn markers); `scenes/room.ts`, with three scripted movers (boxes on fixed paths, no physics yet) so that stepping changes state; `README.md`; the first box suite.
  - The `stress-box` skill: the box's layout, how to add a scene or variant, the quick loop (§9.0).
- **Improves:** I-07, I-25, I-26, I-37, I-43.
- **Done when:**
  - `x sim labs/box/scenes/room --steps 600` gives the same hash three times in Node, and the box-1 replay gives Chromium's goldens while rendering on both backends.
  - `x shot labs/box --scene room --cam iso --backend both`: the ID pass lists the floor, every wall run, the low wall, the pillar and the movers on each backend; the look metrics are within thresholds; thumbnails are recorded per backend.
  - Cycling every camera preset builds 0 pipelines after warm-up.
  - Every inspector member is tested in the browser and headless, and `help()` matches the API.
  - Every setting is reachable through `x set` and `__engine.set` (the P2 test of §3).
- **Verify:** `node x replay tests/replays/box-1-*.replay.json --browser both && npm run e2e -- tests/e2e/box.spec.ts tests/e2e/parity.spec.ts && node x docs --check`

**Gate G2, Box 1:** the box room steps headless with golden hashes in Node and in Chromium, renders on both backends with every object in the ID pass and Chromium's hashes unchanged, builds 0 pipelines after warm-up, and every inspector member and setting is reachable from `x` and `__engine`.

### Phase 3: Box 2, a hero (lanes P, I, A, R, T, B)

#### WP-3.1 Rapier adapter and queries
- **Owns:** `engine/physics/{world,groups,params,capture,queries}.ts`, `engine/sim/{queryView,levelBodies}.ts`, `fixtures/scenes/physics-40/`, `tests/replays/physics-40.replay.json`
- **Needs:** WP 2.2
- **Size:** M
- **Carry:**
  - The world setup and collision groups of `stress-world/20-sim.js:29-33, 118-131` (PORT, in SI units).
  - `hallColliders` (`stress-world/10-hall.js:188-201`), as the model for level bodies.
- **Build:**
  - Initialize `@dimforge/rapier3d-compat`'s embedded WASM in Node and in the browser.
  - Gravity `(0, −30, 0)` as the default, overridable per scene.
  - One table each for integration parameters and collision groups (world, prop, actor, crowd, flyer, corpse).
  - Insertion in a deterministic order; stepping inside the sim, then readback.
  - Every body's translation, rotation and velocities, in handle order, folded into the sim hash (§6.5); snapshot bytes are never hashed.
  - **Capture and restore** (§6.5): `capture()` takes Rapier's snapshot and immediately restores the live world from it, so the run continues exactly as any later restore of that capture.
  - **Level bodies:** WP 2.2's collider descriptors become one fixed body of merged boxes.
  - **Queries:** raycasts, shape casts, overlaps, and `probe(x, z) → { y, normal }` for animation. The read-only `QueryView` that `sim.snapshot()` exposes to presentation code (§6.1), with a test that it offers no mutation.
- **Improves:** I-06.
- **Done when:**
  - A 40-body replay matches its goldens in Node and in Chromium.
  - Restoring its capture twice gives identical hashes in Node and in Chromium, equal to the run that made the capture.
  - `fixtures/levels/room.txt`'s level bodies match its solid grid.
  - The `QueryView` is read-only.
- **Verify:** `npm test -- engine/physics engine/sim/levelBodies && node x replay tests/replays/physics-40.replay.json --browser chromium`

#### WP-3.2 Character controller
- **Owns:** `engine/physics/character.ts`, `engine/sim/actors.ts` (spawns an actor with its controller; WP 3.7 extends it with the animator), `fixtures/scenes/steps/` (steps and slopes built by a scene script, because the level's stairs arrive in WP 4.2)
- **Needs:** WP 3.1
- **Size:** M
- **Carry:**
  - The stress-world controller config (converted; Appendix C).
  - The Platformer feel settings (`engine` §16).
  - The 0.19.3 grounded-flicker workaround: a small downward component each step.
- **Build:**
  - `createCharacter({ capsule, offset, snap, autostep, maxSlope, slide, pushImpulse, feel: { coyote, buffer, variableJump, wallJump, dash, airControl } })`.
  - Intents → velocity → `computeColliderMovement`.
  - Jump, dash, a ground probe, and pushing dynamic bodies.
- **Done when** (Node tests):
  - It climbs 0.25 m steps and refuses 0.30 m ones.
  - Slopes up to 50° are climbable.
  - The jump apex equals v²/2g for the configured jump speed and gravity, ± 2 cm (1.46 m with Appendix C's starting values).
  - A dash covers its configured speed × duration, ± 2 cm, and respects the configured cooldown.
  - It pushes a 20 kg crate.
  - Coyote time and buffer are exact in ticks.
  - The grounded flag never flickers on flat lateral motion.
- **Verify:** `npm test -- engine/physics/character`

#### WP-3.3 Input devices, bindings, intents
- **Owns:** `engine/input/**` except `intents.ts`, which only gets extended
- **Needs:** WP 1.5, WP 2.5
- **Size:** M
- **Carry:**
  - The action model of `engine:476-694`.
  - The rebinding mechanism of `ed/61-controls.js`.
  - The lessons in `docs/CONTROLS-AUDIT.md`.
- **Build:**
  - **Devices:** keyboard; mouse, with pointer lock and wheel; gamepads in any slot, with a radial deadzone and analog triggers. Touch waits for Phase H.
  - **Action maps and presets.**
  - **Bindings:** rebind, conflicts, reserved keys, persistence, labels per device.
  - **Edges, buffering and `consume`** in sim time.
  - **Clear on blur, visibility change and disconnect.**
  - **Camera-relative intents**, through `intents.fromCamera` and the camera's `yaw()`.
  - **A virtual device, and a recorder.** `__engine.input` (§8.3) drives the virtual device; this WP registers that member from its own file, `engine/input/devices/inspector.ts`.
- **Improves:** I-24.
- **Done when:** browser tests pass with injected keyboard and gamepad-stub events, and the intents are unit-tested in Node.
- **Verify:** `npm test -- engine/input && npm run e2e -- tests/e2e/input.spec.ts --project=webgl2`

#### WP-3.4 Skeleton, builds, pose, FK, sheets
- **Owns:** `engine/anim/{skeleton,builds,pose,fk,sheet,check}.ts`
- **Needs:** G1
- **Size:** M
- **Carry:**
  - The builds (`chibi heroic bulky skeleton`, `size`) from `engine` §11, in metres.
  - Joint naming aligned with `rig.J` and the 36 mocap points (Appendix C).
- **Build:**
  - **Skeleton:** root plus 23 joints:
    - pelvis, spine0 (a lower-back pivot at the pelvis, required by CMU), spine1, spine2, chest, neck, head;
    - per side: clavicle, upperArm, forearm, hand, thigh, shin, foot, toe.
  - **Sockets:** weaponR, weaponL, headTop, eyeL, eyeR, contactL, contactR, back.
  - **`Pose`:** `{ rootPos, rootRot, rootScale, local: Float32Array(23·4) }`. Rotations are three.js `Quaternion`s (through `core/math`) when read or written, and flat floats in storage for speed. WP 3.8 writes poses into a three.js `Skeleton` for drawing.
  - **FK** to matrices and positions.
  - **Blending:** slerp/nlerp, bone masks (upper, arms, legs, lists), additive layers.
  - **A pose hash.**
  - **`anim.sheet()`:** SVG skeleton contact sheets in Node. `x sheet` (WP 6.6) turns them into PNG through the browser, on demand.
  - **The core of `anim.check(def)`:** finite values, bone lengths and declared rigid pairs, feet at or above the floor, sockets reachable. WP 6.6 adds the state matrix, the QA family and sheets.
- **Improves:** I-01, I-08, I-49.
- **Done when:**
  - The rest pose's FK matches the build proportions.
  - Blending, masks and additive layers are unit-tested.
  - Sheets are reproducible (hashed).
- **Verify:** `npm test -- engine/anim/skeleton engine/anim/builds engine/anim/pose engine/anim/fk engine/anim/sheet engine/anim/check`

#### WP-3.5 IK
- **Owns:** `engine/anim/ik.ts`
- **Needs:** WP 3.4
- **Size:** S
- **Carry:** `ik3`, `engine:129-140` (COPY).
- **Build:**
  - `twoBone`, verbatim.
  - `twoBoneRot`: local quaternions with an explicit pole.
  - `aim`: a chain spread over chest, neck and head, with limits.
  - `footPlant(probe)`: drop the pelvis, align the foot to the normal, lock it during stance.
  - `handTo`: grips and ladders.
- **Improves:** I-11.
- **Done when:**
  - Reach, limits and poles are tested.
  - On a 10° slope and a 0.2 m step, soles stay within 5 mm of the surface.
- **Verify:** `npm test -- engine/anim/ik`

#### WP-3.6 Humanoid procedural port
- **Owns:** `engine/anim/{authoring,locomotion,poses,humanoid}.ts`
- **Needs:** WP 3.5
- **Size:** L
- **Carry:**
  - Gait, idle, lean and arm swing (`engine:1919-1954`).
  - Poses and stances (`engine:1924-1937, 1955-1968`).
  - The state update (`engine:1803` onward).
- **Build:**
  - The `B(f, r, u)` authoring helper.
  - Every constant in a table, with a one-line comment each.
  - In the differential harness, the port starts from the reference rig's recorded breathing phase (WP 0.11), so breathing cannot push the error past the tolerance.
  - An effector stage, then a solve stage:
    - the spine from lean and twist;
    - limbs through `twoBoneRot`, using the old hints as poles;
    - feet and hands.
  - A fixed dt, and seeded per-entity streams.
- **Improves:** I-09.
- **Done when:** the differential tests against `tests/baselines/port/humanoid-*.json`, converted to SI, pass:
  - joint positions are within 1 cm on average and 3 cm at worst;
  - every exception is listed with its reason. The removed view hacks are the expected exceptions.
- **Verify:** `npm test -- engine/anim/humanoid` (the motion QA runs over it from WP 6.6 on)

#### WP-3.7 The Character animator and the body-state vocabulary
- **Owns:** `engine/anim/{character,states,weights}.ts`; extends `engine/sim/actors.ts` (WP 3.2) with the animator
- **Needs:** WP 3.2, WP 3.6
- **Size:** M
- **Carry:**
  - The weight rates (dash 24/8, hurt 14, attack 30/7, air 10/18, poses 9, stances 10).
  - The "intent vocabulary" of `ed/18-characters.js:36-38`. Here it is called **body states**, to keep it distinct from input intents.
- **Build:**
  - **The layer stack:** weights → base → override → solve → clips → additive → post IK → physics blend → secondary. Locomotion fills it now; moves (WP 6.1), reactions and secondary motion (WP 6.2) and clips (WP 8.4) plug into their slots later.
  - **`inspect()`** returns plain JSON.
  - **Body-state validation** that suggests the closest names.
  - **Events, sockets and trail sampling.**
  - **The two update paths** of §6.4, with the `preciseHits` flag.
  - **LOD hooks**, view-only.
- **Improves:** I-09.
- **Done when:**
  - `inspect()` snapshot tests pass.
  - Unknown body states warn with a suggestion.
  - **The sim hash is identical whether or not poses are evaluated** (the test).
- **Verify:** `npm test -- engine/anim/character engine/anim/states engine/anim/weights`

#### WP-3.8 Instancing service and puppets
- **Owns:** `engine/gfx/instancing.ts`, `engine/gfx/puppets/{grammar,compile,draw,blobShadow}.ts`, `engine/gfx/puppets/bodies/humanoid.ts`, `fixtures/bodies/`
- **Needs:** WP 2.4, WP 3.4
- **Size:** L
- **Carry:**
  - `Batch` (`stress-world/30-crowd.js:20-67`), with its rule of more than 1,000 slots.
  - The lab3d grammar (`lab3d/40-characters.js:8-48`).
  - The `humanParts` sizing (`stress-world/30-crowd.js:98-138`) and the builds' drawing fields.
  - `shadowAt`, the blob shadows (`stress-world/30-crowd.js:334-364`).
- **Build:**
  - **The instancing service**, which contains r180's quirks (§4.7):
    - capacity paging, with every page over 1,000 slots so all pages share one shader;
    - `StaticDrawUsage` with update ranges, and instance colours set before the first render (§4.7);
    - update ranges; awareness of the uniform-buffer limit; shared materials; per-instance palette attributes; a `BatchedMesh` option.
  - **Body grammar v2:**
    - parts on bones: limb, curve, ball, box, cone, eye, blade, cape strip, hair strands;
    - points: a bone name, `[f, r, u]`, `lerp`, `off`;
    - material slots, and L/R mirroring.
  - **Compiled** to instanced parts per part type (for crowds) or to one rigid-skinned three.js `SkinnedMesh` per character, whose `Skeleton` takes the pose from WP 3.4. Smooth skinning is optional, later.
  - **The neutral humanoid body**, and blob shadows.
- **Improves:** I-15, I-19, I-21, I-49.
- **Done when:**
  - A 2,000-instance batch updates on both backends: the ID-pass counts follow the moved instances.
  - No shader is built per page (checked with the pipeline counter).
  - The humanoid body draws in 10 draw calls or fewer, and its socket positions match FK within 1 mm.
- **Verify:** `npm run e2e -- tests/e2e/instancing.spec.ts tests/e2e/puppets.spec.ts && npm test -- engine/gfx/puppets`

#### WP-3.9 Cameras (v2): chase, first person, the rail
- **Owns:** `engine/gfx/cameras/{chase,first,rail}.ts`, `fixtures/scenes/chase-walls/`
- **Needs:** WP 2.5, WP 3.1, WP 3.4
- **Size:** S
- **Carry:** `chasePose`, `firstPose` and `railPose` (`stress-world/40-cameras.js:60-117`).
- **Build:**
  - Chase, which avoids walls with raycasts through the read-only `QueryView`.
  - First person at the head socket, with near-body culling.
  - The side-scrolling depth rail.
  - Camera codes for all three (`?cam3=`).
- **Done when:** in a walled fixture (`fixtures/scenes/chase-walls/`), the chase camera never ends inside a wall (checked with `QueryView` probes), and the codes round-trip. *(Deferred proof: the camera suite of WP 3.10 checks each camera with the ID pass.)*
- **Verify:** `npm test -- engine/gfx/cameras`

#### WP-3.11 Film and visual comparison
- **Owns:** `tools/cmd/film.ts`
- **Needs:** WP 2.7, WP 3.3
- **Size:** M
- **Carry:** `tools/filmstrip.mjs` (PORT): the step DSL, contact sheets, diffs.
- **Build:**
  - `x film --steps "…"`: a step DSL over `__engine.input` and `step`.
  - Contact sheets with labels; per-backend thumbnail baselines.
  - `--compare <ref>` (default `HEAD`) through a temporary `git worktree`, with attribution from the ID pass. A base that lacks the scene gives "no baseline", a deferred proof rather than a failure.
- **Improves:** I-28.
- **Done when:** `x film` on the box room writes a sheet and JSON; `--compare HEAD` reports no difference on an unchanged tree and attributes an injected change to the right object; a scene missing from the base reports "no baseline".
- **Verify:** `npm test -- tools/cmd/film && node x film labs/box --scene room --steps "step 60" --compare HEAD`

#### WP-3.10 Box 2: a hero in the box
- **Owns:** `labs/box/scenes/room-hero.ts`, `labs/box/cast/hero.ts`; extends `labs/box/{README.md,main.ts}` and `tests/e2e/parity.spec.ts` (from WP 2.7); `tests/replays/box-2-*.replay.json`, `tests/e2e/box-hero.spec.ts`
- **Needs:** WP 2.7, WP 3.3, WP 3.7, WP 3.8, WP 3.9, WP 3.11
- **Size:** M
- **Carry:** the hero's speeds and timings (`stress-world/20-sim.js:108-114, 242-301`) as starting values (Appendix C).
- **Build:**
  - **The hero actor:** the controller, the animator and the neutral humanoid body, walking, dashing and jumping onto the low wall.
  - **Scripted replays:** walk a square, dash, jump onto the low wall.
  - **The play-alike suite** (`parity.spec.ts`): the box-2 replays rendered on both backends, and live play on each backend recorded and replayed in a sim-only Chromium page (§6.7).
  - **The camera suite:** every camera (the presets, chase, fly, fixed) passes an ID-pass check: the hero is visible, and coverage is sane. First person passes the inverse check: the hero's body is culled (only the hands and the weapon socket may cover pixels), and no wall covers more than 70% of the frame.
  - W walks away from the camera in every camera mode.
- **Improves:** I-07, I-43.
- **Done when:**
  - The replays match each runtime's goldens: Node, and Chromium rendering on both backends.
  - Live recordings replay to the same hashes.
  - The camera checks pass, and 0 pipelines are built after warm-up.
  - The humanoid's differential tests are green.
- **Verify:** `node x replay tests/replays/box-2-*.replay.json --browser both && npm run e2e -- tests/e2e/parity.spec.ts tests/e2e/box-hero.spec.ts`

**Gate G3, Box 2:** the hero walks, dashes and jumps in replays that match each runtime's goldens, rendering on both backends; live play on each backend replays headless; every camera passes its ID-pass check; the animation port is within tolerance; `x film` compares the box with `HEAD`.

### Phase 4: Box 3, the hall (lanes P, W, R, B)

#### WP-4.1 Bodies and props physics
- **Owns:** `engine/physics/bodies.ts`, `fixtures/scenes/physics-props/`, `tests/replays/physics-props.replay.json`
- **Needs:** WP 3.2
- **Size:** S
- **Carry:** the props' physics (`stress-world/20-sim.js:141-171`): density, friction, restitution, damping, and `knockProp`'s impulse and torque.
- **Build:**
  - Dynamic body helpers (box, cylinder, capsule, ball); impulses and torque impulses; stacking; sleeping.
  - The lost-body rescue: a body below the floor or outside the level is put back on a walkable tile.
  - Sensors and triggers that emit events.
- **Done when:**
  - Stacked crates topple the same way every run, and the replay matches its goldens in Node and in Chromium.
  - The rescue returns a body that fell through to a walkable tile.
- **Verify:** `npm test -- engine/physics/bodies && node x replay tests/replays/physics-props.replay.json --browser chromium`

#### WP-4.2 The level compiler (v2): the hall
- **Owns:** extends `engine/world/level/**` (from WP 2.2) with the v2 glyphs; extends `engine/sim/levelBodies.ts` (from WP 3.1) with convex hulls; `labs/box/levels/hall.txt`
- **Needs:** WP 3.1
- **Size:** M
- **Carry:** the hall's glyphs `= ^ o t` and their geometry (`stress-world/10-hall.js:22-67, 94-124, 188-201`): galleries at 1 m, stairs as ramps with hull wedges, the octagonal dais (`octR`) with a hull frustum, braziers as cylinders, torch spots.
- **Build:**
  - **The v2 glyphs:** gallery `=`, stairs `^` (direction from the neighbours), dais `o`, brazier `t`.
  - `floorH` with ramps and the dais profile; `topH`; a surface tag per glyph; hull colliders; light spots.
  - **The hall**, ported to the legend as `labs/box/levels/hall.txt`.
- **Improves:** I-22.
- **Done when:**
  - The hall compiles and validates, reproducibly.
  - `floorH` on the stairs and the dais matches hand-computed values.
  - The hull colliders match the ramp heights within 1 cm (probed).
- **Verify:** `npm test -- engine/world/level engine/sim/levelBodies && node x qa level`

#### WP-4.3 Navigation and spatial queries
- **Owns:** `engine/world/{nav,spatial}.ts`, `fixtures/scenes/nav-1000/`
- **Needs:** WP 4.2
- **Size:** M
- **Carry:**
  - `PASS`, `CLIMB` and the Dijkstra `FLOW` (`stress-world/10-hall.js:129-178`).
  - `SpatialHash` (`engine:3626-3646`).
- **Build:**
  - The walkable grid with climb limits and one-way ledges.
  - Multi-target, cached flow fields on a typed-array heap.
  - A* on the grid, and line-of-sight checks.
  - A spatial hash on typed arrays, with no allocation per step.
- **Improves:** I-22.
- **Done when:**
  - In the hall, the flow field reaches every walkable tile from the spawn, and one-way ledges are respected.
  - 1,000 agents' queries stay within the budget recorded here.
- **Verify:** `npm test -- engine/world/nav engine/world/spatial && node x perf fixtures/scenes/nav-1000 --budget`

#### WP-4.4 Level meshes (v2) and cutaway
- **Owns:** extends `engine/gfx/level/**` (from WP 2.4) with stairs, galleries, the dais and pillars with plinths and capitals; `engine/gfx/cutaway.ts`
- **Needs:** WP 2.4, WP 4.2
- **Size:** M
- **Carry:**
  - The stairs, gallery, dais and pillar meshes (`stress-world/10-hall.js:336-405`).
  - The wall and pillar cutaway (`stress-world/10-hall.js:302-370`, `40-cameras.js:166-181`) and `segBox`.
- **Build:**
  - Meshes for the v2 glyphs; each flight of stairs is one mesh (the prototype used 20).
  - **Cutaway:** walls facing an outside camera swap to their cut twin; pillars between the camera and the focus become stumps.
  - Everything registered with the warm-up.
- **Done when:**
  - Cutaway is unit-tested: which walls and pillars cut for a given camera pose.
  - The hall renders on both backends within its draw-call budget, and turning the camera builds 0 pipelines after warm-up.
- **Verify:** `npm test -- engine/gfx/level engine/gfx/cutaway && npm run e2e -- tests/e2e/hall.spec.ts`

#### WP-4.5 Props as data
- **Owns:** `engine/world/props/**`, `engine/gfx/props.ts`
- **Needs:** WP 3.8, WP 4.1
- **Size:** M
- **Carry:**
  - The crate and barrel (`stress-world/30-crowd.js:293-329`).
  - The braziers and their flames (`stress-world/10-hall.js:409-433`), and `FLICKER`.
  - The idea of the 2D 38-prop catalog, with its light metadata.
- **Build:**
  - **A prop registry** (kind `prop`): geometry, material and body by id; an optional light spot; interaction hooks.
  - The first props: crate, barrel, brazier (flames animated on `fxRng`), pillar.
  - Prop meshes through the instancing service. Props spawn from level glyphs or from scene data.
- **Done when:**
  - Every prop passes the geometry and texture QA checks.
  - Each renders on both backends (ID-pass coverage above 0).
  - A knocked crate's mesh follows its body.
- **Verify:** `node x qa geo tex --only prop: && npm run e2e -- tests/e2e/props.spec.ts`

#### WP-4.6 Box 3: the hall
- **Owns:** `labs/box/scenes/{hall,hall-props}.ts`; extends `labs/box/{README.md,main.ts}` and `tests/e2e/parity.spec.ts` (with this stage's scenes); `tests/replays/box-3-*.replay.json`, `tests/e2e/box-hall.spec.ts`
- **Needs:** WP 3.10, WP 4.3, WP 4.4, WP 4.5
- **Size:** M
- **Carry:** the prop placement (seeded spots, every fifth crate stacked; `stress-world/20-sim.js:141-171`) as a starting point.
- **Build:**
  - The hall scene with the hero, and the props scene (10–300 crates and barrels).
  - Replays: climb to the west gallery; push and knock crates; walk the dais.
- **Improves:** I-07, I-43.
- **Done when:**
  - The replays match each runtime's goldens: Node, and Chromium rendering on both backends.
  - The hero ends on the gallery, more than 0.9 m above the floor.
  - A knocked crate moves more than 0.25 m.
  - The hall's ID pass and metrics are recorded on each backend, and 0 pipelines are built after warm-up.
- **Verify:** `node x replay tests/replays/box-3-*.replay.json --browser both && npm run e2e -- tests/e2e/box-hall.spec.ts tests/e2e/parity.spec.ts`

**Gate G4, Box 3:** the hall compiles and validates; the hero climbs to a gallery and knocks crates in replays that match each runtime's goldens, rendering on both backends; navigation covers every walkable tile.

### Phase 5: Box 4, a crowd (lanes P, W, A, R, T, I, B)

#### WP-5.1 Crowd bodies
- **Owns:** `engine/physics/crowd.ts`, `fixtures/scenes/crowd-1000/`, `tests/replays/crowd-1000.replay.json`
- **Needs:** WP 4.1
- **Size:** M
- **Carry:** the crowd pattern of `stress-world/20-sim.js:174-222, 498-516` (mechanism only): velocity intents with acceleration limits, locked rotations, a min friction combine, sleeping, knockback as momentum, launches, a corpse group, the grounded heuristic and the lost-body rescue.
- **Build:**
  - Crowd agents (capsule or ball) with spawn and despawn queues.
  - `setVelocity` with approach limits; launches; the corpse group and its timers; grounded detection; a wake and sleep policy.
  - **The SIMD question** (doctrine: Common ground): measure `@dimforge/rapier3d-compat` against `@dimforge/rapier3d-simd-compat` (the same version and API) on the crowd at 1,000 and 5,000. Adopt SIMD, through an ADR amendment and re-recorded goldens, only if it cuts the sim step by at least 20% at 5,000.
- **Done when:**
  - 1,000 agents pushing toward a point stay within a budget recorded here (the median of 5 runs on the development platform).
  - `tests/replays/crowd-1000.replay.json` matches its goldens in Node and in Chromium.
  - The SIMD measurement and the decision are recorded.
  - Corpses settle and are removed on schedule.
- **Verify:** `npm test -- engine/physics/crowd && node x perf fixtures/scenes/crowd-1000 --budget && node x replay tests/replays/crowd-1000.replay.json --browser chromium`

#### WP-5.2 Steering kit
- **Owns:** `engine/world/{steer,ai}.ts`
- **Needs:** WP 4.3, WP 5.1
- **Size:** M
- **Carry:** flow-field following, approach rings and attack tokens (`stress-world/20-sim.js:236-241, 346-451`; the token manager of `ed/30-monsters-core.js`, mechanism only).
- **Build:**
  - Flow-field following; approach rings around a target.
  - An attack-token manager (a cap on simultaneous attackers).
  - Simple awareness: distance, and line of sight on the grid.
  - Hover and hop helpers for flyers and jumpers.
- **Done when:**
  - Tokens never exceed the cap.
  - In a fixture, agents following the field reach the target tile.
  - Every helper is unit-tested.
- **Verify:** `npm test -- engine/world/steer engine/world/ai`

#### WP-5.3 Blob and floater rigs
- **Owns:** `engine/anim/{blob,floater}.ts`
- **Needs:** WP 3.7
- **Size:** S
- **Carry:**
  - `engine:2595-2602`.
  - The leap parameters (`back reach h air land hit`) from `src/starter/60-animlab.js` `SKINS`.
  - The wisp's hover (`stress-world/20-sim.js:427-428`).
- **Build:**
  - A spring squash and stretch, and look smoothing, on a minimal skeleton.
  - Blob moves as data: bite, leap, pounce, spit.
  - A floater: hover, bank, and orbiting motes.
- **Done when:** unit tests pass, the squash preserves volume, and every pose is finite.
- **Verify:** `npm test -- engine/anim/blob engine/anim/floater`

#### WP-5.4 Crowd rendering and pose LOD
- **Owns:** `engine/gfx/puppets/{crowd,lod}.ts`, `engine/gfx/puppets/bodies/{blob,floater}.ts`
- **Needs:** WP 3.8, WP 5.3
- **Size:** M
- **Carry:** `slimeParts` and `wispParts` (`stress-world/30-crowd.js:140-170`); `drawCrowd`'s culling (`:342-373`).
- **Build:**
  - Crowd drawing over the instancing service; the blob and floater bodies.
  - Pose LOD by distance, presentation only; culling; capes off beyond a distance.
- **Improves:** I-21.
- **Done when:**
  - 5,000 agents draw on both backends, and no pipeline is built as the crowd grows.
  - The sim hash is identical with LOD on and off.
  - Draw calls stay within budget.
- **Verify:** `npm run e2e -- tests/e2e/crowd-render.spec.ts`

#### WP-5.5 Performance counters and the crowd ladder
- **Owns:** `engine/dev/stats.ts`; extends `tools/cmd/perf.ts` (from WP 1.5) with browser counters and `--ladder`
- **Needs:** WP 2.7, WP 5.1
- **Size:** S
- **Carry:** the benchmark's split into physics, logic and drawing (`stress-world/60-panel.js:205-263`).
- **Build:**
  - `stats()`: sim, physics, animation and render milliseconds; draw calls, triangles, pipelines, memory. This WP registers the member from `engine/dev/stats.ts` (§8.3).
  - `x perf` in the browser: counters, never fps.
  - `--ladder`: 100, 1,000 and 5,000 agents, headless in Node.
  - Budget files, and the trend file (§8.7).
- **Improves:** I-39.
- **Done when:** `x perf` reports counters for the room on both backends, the ladder runs in Node, and budgets compare with a tolerance.
- **Verify:** `npm test -- engine/dev/stats && node x perf labs/box --scene room --budget`

#### WP-5.6 The bot and dev actions
- **Owns:** `engine/dev/{bot,actions}.ts`
- **Needs:** WP 3.3, WP 4.3
- **Size:** M
- **Carry:** the autopilot (`ed/93-autopilot.js`) and the developer sandbox (`ed/62-developer.js`), mechanisms only.
- **Build:**
  - **The bot:** a virtual device, navigation over the flow field, a watchdog, and stuck detection measured along the wanted direction. Its runs are reproducible.
  - **Dev actions** (kind `devAction`): god mode, freeze AI, spawn N, travel, time scale. Each is reachable from `__engine.actions` (registered from `engine/dev/actions.ts`, §8.3), `x eval` and, later, MCP.
  - The bot is sim-side (§3): it reads the sim and writes intents, under the reproducibility bans.
- **Improves:** I-38.
- **Done when:**
  - In a maze fixture, the bot reaches a target tile, and reports "stuck" correctly when blocked.
  - Every dev action is unit-tested and reachable from `__engine` and `x`.
- **Verify:** `npm test -- engine/dev/bot engine/dev/actions`

#### WP-5.7 Box 4: a crowd
- **Owns:** `labs/box/scenes/crowd-*.ts`, `labs/box/cast/{walker,slime,wisp}.ts`; extends `labs/box/{README.md,main.ts}` and `tests/e2e/parity.spec.ts` (with this stage's scenes); `tests/replays/box-4-*.replay.json`, `tests/e2e/box-crowd.spec.ts`, `tests/baselines/perf/box-crowd.json`
- **Needs:** WP 4.6, WP 5.2, WP 5.4, WP 5.5, WP 5.6
- **Size:** M
- **Carry:** the cast's sizes and speeds (`stress-world/20-sim.js:57-102, 174-222`) as starting values.
- **Build:**
  - **The sample cast:** a walker (capsule), a slime (a hopping ball) and a wisp (a floater), each with its steering.
  - Crowd scenes at 100, 1,000 and 5,000, with mixes; the bot drives the hero through the crowd.
  - The perf ladder's budgets, recorded.
- **Improves:** I-07, I-39, I-43.
- **Done when:**
  - In a replay, the crowd follows the hero up the stairs: at least one agent reaches the gallery.
  - The ladder's sim-step medians are recorded as budgets.
  - 0 pipelines are built as the crowd grows to 5,000.
  - The bot's runs are reproducible, and the replays match each runtime's goldens: Node, and Chromium rendering on both backends (crowd LOD included).
- **Verify:** `node x replay tests/replays/box-4-*.replay.json --browser both && node x perf labs/box --scene crowd-1000 --ladder --budget && npm run e2e -- tests/e2e/box-crowd.spec.ts tests/e2e/parity.spec.ts`

**Gate G5, Box 4:** the crowd follows the hero up the stairs in replays that match each runtime's goldens, rendering on both backends; the perf ladder is within its budgets; nothing compiles as the crowd grows; the bot is reproducible.

### Phase 6: Box 5, combat (lanes A, W, R, I, B)

#### WP-6.1 Moves, timelines, hits
- **Owns:** `engine/anim/{timeline,moves,moves-data}.ts`, `fixtures/rigs/dummy/` (a neutral training dummy that takes hits)
- **Needs:** WP 3.7
- **Size:** L
- **Carry:**
  - `Attack`, `Combo`, `E.move` and `E.knockback` (`engine:2467-2577`).
  - The 24 entries of `E.MOVES` (`engine:2543-2572`).
  - The arm path (`engine:1842-1867, 1950-1951, 1969-1986`).
  - `measureAttacks` (`ed/30-monsters-core.js:31-41`, mechanism only).
- **Build:**
  - **`Timeline`:** phases with durations, effector or clip content, and events, carrying leftover time across phases. `Attack` and `Combo` are built on it.
  - **Moves as data.** Each move has self-describing fields in metres: `arc`, `height`, `reach`, `time { wind, active, recover }`, `hitAt`, `body { lean, lunge, hop, crouch, twist }`, `plane`, `trail`.
  - **A table converting each old field** (Appendix C).
  - **Events:** `wind`, `active`, `hitOpen`, `hitClose`, `recover`, `end`.
  - **Root-motion curves**, in `'visual'` or `'apply'` mode.
  - **Weapon sweeps** published during hit windows.
  - **`measureMove`** → `hitShape { range, halfAngle, yMin, yMax }`, cached and invalidated when settings change. `inArc` is kept.
  - **`anim.moveAt(name, u, phase)`**, and the animator's move slot filled (WP 3.7).
- **Improves:** I-10.
- **Done when:**
  - All 24 moves pass the differential tests: hand and tip paths over `u`, within 1 cm on average and 3 cm at worst.
  - Combo chaining windows are exact in ticks.
- **Verify:** `npm test -- engine/anim/moves engine/anim/timeline` (the motion QA runs over the moves from WP 6.6 on)

#### WP-6.2 Reactions and secondary motion
- **Owns:** `engine/anim/{reactions,secondary}.ts`
- **Needs:** WP 6.1
- **Size:** M
- **Carry:**
  - The squash spring (`engine:1832`).
  - Hair (`engine:1900-1916`).
  - The cape (`engine:2033-2068`).
  - `die` (`engine:1824-1827`).
- **Build:**
  - **Reactions:** a directional flinch (an additive spring); down, die and get-up timelines (face up or face down). The ragdoll hand-off comes in WP 10.2.
  - **`Chain`:** anchor, n, seg, gravity, drag, wind, iterations, bone-capsule colliders, a floor probe, and stiffness toward a rest shape.
    - A cape is 2 chains plus a width constraint; hair and tails are 1 chain.
    - It resets on teleport.
  - **Squash** becomes a volume-preserving root scale.
- **Improves:** I-11.
- **Done when:**
  - Chains are stable at 60 and 120 Hz and collide with body capsules and the floor.
  - The correct get-up is chosen.
- **Verify:** `npm test -- engine/anim/secondary engine/anim/reactions`

#### WP-6.3 Combat helpers
- **Owns:** `engine/sim/{hits,damage}.ts`, `engine/world/projectiles.ts`
- **Needs:** WP 5.1, WP 6.1
- **Size:** M
- **Carry:**
  - `inArc3` and its spatial-hash use (`stress-world/20-sim.js:225-233`).
  - `damageEnemy` (`:324-342`): knockback, launches, the kill launch and the switch to the corpse group.
  - `Bullets` (`engine:3553-3625`), moved to 3D with swept tests.
- **Build:**
  - Hit queries: cones with height windows, and sweeps against hurt capsules.
  - Knockback as momentum on crowd bodies; launches; damage events; death into the corpse group.
  - Hit-stop through the time module's budget (WP 1.3).
  - Projectiles with swept tests (bolts).
  - Generic only: no damage formulas, stats or balance.
- **Done when:**
  - A fast projectile never tunnels.
  - A scripted hit launches a body more than 1 m up.
  - Hit-stop triggers once per crowd hit (the budget).
- **Verify:** `npm test -- engine/sim/hits engine/sim/damage engine/world/projectiles`

#### WP-6.4 Effects
- **Owns:** `engine/gfx/fx/**`, `engine/world/telegraphs.ts` (shape data and near-miss geometry: sim-side)
- **Needs:** WP 3.8, WP 6.1
- **Size:** M
- **Carry:**
  - `stress-world/35-effects.js`: the floor decal pool, ribbons, particle quads.
  - The engine's particle emitters (`engine` §8: dust, spark, bit, ember, ring, text; explosion, fire, smoke).
- **Build:**
  - CPU particles as view state: `fxRng`, pooling, instanced quads.
  - Socket trails (ribbons).
  - Telegraph shapes as data (arc, ring, line, cone) in `world/telegraphs.ts`, where sim code tests near misses; `gfx/fx` draws them at floor height.
  - Decals; screen shake (camera only); bolt visuals.
- **Done when:**
  - **The sim hash is identical with effects on and off.**
  - Budgets hold, and every pool is warmed: 0 pipelines after warm-up.
- **Verify:** `npm test -- engine/gfx/fx engine/world/telegraphs && npm run e2e -- tests/e2e/fx.spec.ts`

#### WP-6.5 Overlay, font and damage numbers
- **Owns:** `engine/ui/{overlay,font,text}.ts`
- **Needs:** WP 2.7
- **Size:** S
- **Carry:**
  - The pixel font, in the agent edition's compact encoding.
  - The damage numbers (`stress-world/35-effects.js:133-149`), with stacking (`20-sim.js:320-323`).
- **Build:**
  - An overlay canvas at pixel scale, with projected, world-anchored text.
  - Damage numbers with stacking; HUD lines; a crosshair.
  - `ui.state()` for tests.
- **Done when:** `ui.state()` snapshot tests pass, the overlay renders on both backends, and text positions match the projection within 1 px.
- **Verify:** `npm test -- engine/ui && npm run e2e -- tests/e2e/overlay.spec.ts`

#### WP-6.6 Animation checks, QA and sheets
- **Owns:** extends `engine/anim/check.ts` (WP 3.4) with the state matrix; `tools/cmd/sheet.ts` (PNG of `anim.sheet()` through the browser), `tools/qa/anim.ts`, `tests/baselines/qa-anim.json`
- **Needs:** WP 5.3, WP 6.2
- **Size:** M
- **Carry:**
  - `checkRig` (`ed/18-characters.js:82-143`, mechanism).
  - The motion checks of `tools/ed-sheet.mjs:100-131`.
- **Build:**
  - A state matrix: body states × facings, plus camera presets for sheets.
  - Checks: finite values; bone lengths and declared rigid pairs; feet at or above the ground; sockets reachable; the same hash twice; 1/60 against 1/120 within tolerance.
  - The `anim` QA family of §8.6, run in Node.
  - `x sheet`.
  - Baselines, each with a reason.
- **Improves:** I-29.
- **Done when:** every move and pose, the humanoid, the blob and the floater pass the `anim` QA family in under 10 s in Node, against a baseline file with reasons.
- **Verify:** `node x qa anim`

#### WP-6.7 Box 5: combat
- **Owns:** `labs/box/scenes/fight*.ts`; extends `labs/box/cast/*` (attacks), `labs/box/{README.md,main.ts}` and `tests/e2e/parity.spec.ts` (with this stage's scenes); `tests/replays/box-5-*.replay.json`, `tests/e2e/box-fight.spec.ts`
- **Needs:** WP 5.7, WP 6.3, WP 6.4, WP 6.5, WP 6.6
- **Size:** M
- **Carry:** as starting values only: the hero's moves and the cast's attacks (`stress-world/20-sim.js:57-114, 242-282, 346-451`), and the proof script's press timetable (`:587-603`) as the first fight script.
- **Build:**
  - The hero's combo (slash, backslash, spin, thrust) and a bolt.
  - The cast's attacks, with telegraphs and attack tokens.
  - Deaths, corpses and launches; damage numbers; trails; particles.
  - Fight scenes: 36 mixed, and 1,000.
- **Improves:** I-07, I-43.
- **Done when:**
  - A scripted fight replay has at least 3 deaths and at least one body launched more than 1 m up, and matches each runtime's goldens: Node, and Chromium rendering on both backends (effects included).
  - The hash is identical with effects on and off.
  - 0 pipelines are built after warm-up during the fight.
  - The animation QA is green or baselined.
- **Verify:** `node x replay tests/replays/box-5-*.replay.json --browser both && npm run e2e -- tests/e2e/box-fight.spec.ts tests/e2e/parity.spec.ts`

**Gate G6, Box 5:** a scripted fight kills and launches in replays that match each runtime's goldens, rendering on both backends; effects never change the hash; the animation QA is clean or baselined with reasons.

### Phase 7: Box 6, the look, operated (lanes R, W, T, I, B)

#### WP-7.1 Lights, shadows, atmosphere, sky
- **Owns:** `engine/gfx/{lights,shadows,atmosphere,sky}.ts`
- **Needs:** WP 2.3, WP 4.2
- **Size:** M
- **Carry:**
  - The fixed light set and the shadow-caster reassignment (`stress-world/10-hall.js:435-466`); `FLICKER`.
  - The fog that starts past the focus (`stress-world/50-frame.js:56`).
  - The backdrop generators (`engine` §21b).
- **Build:**
  - **A fixed light pool:** 8–16 point lights near the focus, assigned by priority and distance from the level's light spots. The count never changes, so shaders never rebuild.
  - **A shadow budget:** 2 point casters, reassigned to the most important lights.
  - Flicker on `fxRng`; fog (range plus height); a sky dome (three.js's `SkyMesh` addon first) and a backdrop cylinder.
  - Presets: the torch-lit hall, day, dusk, night, cave.
- **Improves:** I-17.
- **Done when:** moving the focus across the hall reassigns lights with 0 pipelines built, and every preset renders on both backends.
- **Verify:** `npm run e2e -- tests/e2e/lights.spec.ts`

#### WP-7.2 Materials (v2): toon, outlines, styles
- **Owns:** `engine/gfx/materials/{toon,outline,styles}.ts` (in WP 2.3's material registry)
- **Needs:** WP 3.8
- **Size:** M
- **Carry:** `TOON_BANDS` and `outlineMat` (`stress-world/00-setup.js:91-116`); lab3d's `toonMat` (`lab3d/10-materials.js:80-96`).
- **Build:**
  - Toon materials with bands: the classic `MeshToonMaterial` with a generated gradient map.
  - Outline shells correct under instancing: a TSL push whose direction comes from `positionGeometry` (§4.7), the one place a classic material cannot do the job.
  - Material styles, each warmed: toon (`MeshToonMaterial`), flat (`MeshLambertMaterial` with flat shading) and pbr-lite (`MeshStandardMaterial`).
- **Done when:**
  - Toggling every style builds 0 pipelines after warm-up, on both backends.
  - On instanced box parts, the outline shell's ID-pass bounding box contains the part's, centred within 1 px.
- **Verify:** `npm run e2e -- tests/e2e/materials-v2.spec.ts`

#### WP-7.3 The texture library (v2)
- **Owns:** `engine/gfx/textures/generators/{runes,moss,metal,plaster,dirt,grass,water}.ts`, `engine/gfx/textures/{tslNoise,contactShadow}.ts`
- **Needs:** WP 2.3, WP 4.2
- **Size:** M
- **Carry:** the hall floor bake (`stress-world/10-hall.js:206-287`): flagstones with the rune circle as an emissive map, moss near the walls, and contact shadows at the wall feet.
- **Build:**
  - The remaining generators; the rune emissive map; contact shadows baked along wall feet; TSL noise for large-scale variation.
  - Contact sheets.
- **Improves:** I-20, I-29.
- **Done when:** every new generator tiles, bakes are reproducible, and the hall's floor bake lines up with its wall cells.
- **Verify:** `npm test -- engine/gfx/textures && node x qa tex`

#### WP-7.4 Post-processing
- **Owns:** `engine/gfx/post/**`
- **Needs:** WP 2.6, WP 7.2
- **Size:** M
- **Carry:** `stress-world/45-filters.js`: cel, pixel and Bayer dither, bloom, FXAA, and the `keep(m)` scope.
- **Build:**
  - A `PostProcessing` chain (r180), built from three.js's TSL display nodes first: `BloomNode` and `FXAANode` from the addons.
  - Filters: cel, pixel (palette and dither), bloom, FXAA, and an ID/depth edge outline.
  - **The scope mask** (objects or environment) comes from a separate mask pass, never MRT (§4.7, §6.7).
  - Looks as data (kind `look`: a material style from WP 7.2 plus a filter chain), with warm-up integration.
- **Improves:** I-46.
- **Done when:**
  - Every filter and scope works on both backends.
  - Toggling a filter builds no pipeline after warm-up and recompiles no material.
  - The ID pass is unchanged by filters.
- **Verify:** `npm run e2e -- tests/e2e/post.spec.ts`

#### WP-7.5 The performance governor
- **Owns:** `engine/dev/governor.ts`
- **Needs:** WP 5.4, WP 7.1
- **Size:** S
- **Carry:** the mechanism of `ed/95-perf.js`.
- **Build:**
  - Tiered adaptive quality with hysteresis.
  - It owns the WebGPU features, presentation LOD (pose LOD, draw distance, light and shadow budgets, effect density) and resolution.
  - It **never** changes sim state or sim settings; sim LOD is a scene setting recorded in replays.
  - It is frozen in reproducible runs, and every change it makes is logged as advice.
- **Done when:** a simulated sequence of frame times produces the expected demotions and promotions with no flicker, and no governor action changes the hash.
- **Verify:** `npm test -- engine/dev/governor`

#### WP-7.6 MCP server
- **Owns:** `tools/mcp/**`, `tools/cmd/mcp.ts`
- **Needs:** WP 2.7, WP 3.3, WP 5.6
- **Size:** M
- **Build:** the tools in §8.11, on the official `@modelcontextprotocol/sdk` (the newest 1.x, §4.7, adopted with its reason in `tools/deps.json`), over `x inspect`.
- **Improves:** I-35.
- **Done when:** an MCP client test opens the box room, steps it, injects input, takes a shot with the ID pass, runs a dev action and replays a file.
- **Verify:** `npm test -- tools/mcp`

#### WP-7.7 The gallery
- **Owns:** `engine/dev/gallery.ts`, `tools/cmd/gallery.ts`
- **Needs:** WP 3.11
- **Size:** M
- **Carry:** the gallery of `ed/92-gallery.js` (mechanism).
- **Build:**
  - Contact sheets and JSON from the registries' `gallery` hooks: bodies × body states, moves, props, materials, emitters, looks.
  - Deep links (`#gallery/…`), served by the app's routes on any page; wrong names warn with the list of valid ones.
- **Done when:** every registered entry with a `gallery` hook renders a sheet on both backends, and `x gallery body` lists every body.
- **Verify:** `npm run e2e -- tests/e2e/gallery.spec.ts && node x gallery body`

#### WP-7.8 Box 6: the Stress Box
- **Owns:** `labs/box/looks/`; extends `labs/box/{README.md,main.ts}`, `labs/box/scenes/*` and `tests/e2e/parity.spec.ts` (with every look); `tests/replays/box-6-*.replay.json`, `tests/e2e/box-look.spec.ts`, `tests/baselines/perf/box.json`
- **Needs:** WP 6.7, WP 7.1, WP 7.2, WP 7.3, WP 7.4, WP 7.5, WP 7.6, WP 7.7
- **Size:** M
- **Build:**
  - The box's looks: the torch-lit hall with flicker and fog, toon shading with outlines, flagstones with runes, and the cel, pixel, bloom and FXAA presets.
  - The governor wired to the box.
  - The full benchmark report: `x perf --ladder` over `fight-1000` and `crowd-5000`.
  - The box README as the engine's demo index: every scene, what it proves, and the command that shows it.
- **Improves:** I-07, I-43.
- **Done when:**
  - Every look renders on both backends, with 0 pipelines after warm-up across every toggle, and with Chromium's goldens unchanged.
  - The governor demotes and promotes under a scripted load without changing the hash.
  - The MCP test drives the box; the gallery covers every kind with a hook.
  - The benchmark report is recorded, and `x ci --local` is green.
- **Verify:** `npm run e2e -- tests/e2e/box-look.spec.ts tests/e2e/parity.spec.ts && node x perf labs/box --scene fight-1000 --ladder --budget && node x ci --local`

**Gate G7, the Stress Box (the foundation is set):**
- Gates G0–G6 still hold.
- The box does the stress test's job: the hall, the hero, a crowd up to 5,000, props, combat, effects, cameras and looks, on both backends, with the play-alike suite green.
- Every capability built so far is reachable from `x` or `__engine`, and the running page over MCP, and is proved without a display.
- The benchmark is within budget, and `x deps --qualify` has been run, its upgrades scheduled.
- The `verifier` has reviewed the stage against `DOCTRINE.md`.

### Phase 8: The animation library (lane L)

§10 has the detailed specification. The stress test never used the library; it comes over because it would be costly to rebuild, and it joins the box as clip mode (WP 8.9). WPs 8.1–8.3 need only the foundation and the kernel, so lane L may run alongside the box stages when an agent is free, without ever delaying a box gate.

#### WP-8.1 Provenance, catalogs, ledger, docs
- **Owns:** `data/anim/{SOURCES.md,LICENSES/,catalogs/,cmu/}`, `docs/ANIMATION-LIBRARY.md`, `docs/ANIMATION-RESEARCH.md`, `tests/unit/data/anim/{catalogs,ledger,sources}/`
- **Needs:** G0
- **Size:** S
- **Carry:**
  - The catalogs (COPY).
  - `cmu.json` (COPY, and FIX the license).
  - `cmu-takes.tsv` (split).
  - `docs/MOCAP.md` and `docs/ANIMATION-RESEARCH.md` (PORT).
- **Build:**
  - `data/anim/SOURCES.md`, one section per library (license, URL, file names), and the license texts in `LICENSES/`.
  - The catalogs, copied into `data/anim/catalogs/`.
  - The CMU ledger split into `data/anim/cmu/<category>.tsv` and `subjects.tsv` (§10.3), with the category fallback
    fixed. The 113 takes flagged `fps?` (an assumed 120 fps) keep the flag until WP 8.5 verifies them.
  - `docs/ANIMATION-LIBRARY.md` (from `docs/MOCAP.md`) and `docs/ANIMATION-RESEARCH.md`, with the coverage map.
- **Improves:** I-13.
- **Done when:**
  - The split ledger joins back to the original rows.
  - SOURCES lists every library: license text, URL, file names, and the CMU acknowledgment and no-resale terms verbatim.
  - The research doc carries the coverage map.
- **Verify:** `npm test -- tests/unit/data/anim`

#### WP-8.2 The readable codec and format 2
- **Owns:** `engine/anim/clip/{readable,validate,lens,mirror}.ts`, `tools/anim/legacy-readable.ts`; extends `tools/cmd/port.ts` (from WP 0.11) with `--clips`, and `tests/baselines/port/clips/`
- **Needs:** WP 0.11, WP 1.1
- **Size:** M
- **Carry:** `src/mocap/readable.js` (PORT, with the standard `Math` the source uses; the source decoder is the oracle).
- **Build:**
  - Format 1 decoding, within 0.001 mm of the reference vectors.
  - **`x port refs --clips`:** `MR.pose` decodes of all 325 curated clips at 30 fps. That set is large: commit a sampled subset with checksums, and keep the full set regenerable.
  - The oracle is the source decoder itself. `tools/anim/legacy-readable.ts` (about 10 lines) runs `$MY3D2DGE_SRC/src/mocap/readable.js` in a `vm` context, as `tools/mocap-lib.mjs:7-9` does. Nothing is copied. The bit-for-bit check runs wherever the source resolves.
  - Format 2's optional fields (§10.2).
  - The validator, the normalized lens and mirroring.
  - Parse errors that name the key, its time and the field.
- **Improves:** I-13.
- **Done when:**
  - Every curated clip decodes within 0.001 mm, and the oracle reproduces the reference vectors bit for bit.
  - Round trip, and mirroring twice, stay within 0.5 mm.
- **Verify:** `npm test -- engine/anim/clip && node x port refs --check`

#### WP-8.3 Re-containerize the sets
- **Owns:** `data/anim/sets/**`, `tools/anim/repack.ts`, `tests/unit/data/anim/sets/`
- **Needs:** WP 8.2
- **Size:** S
- **Build:**
  - One JSON file per clip: slugged file names, with the real name kept in `clip`.
  - `_set.json`, and a generated `catalog.tsv`.
  - `alt` tags on the 84 Mesh2Motion re-exports.
  - HERO dropped.
- **Improves:** I-13.
- **Done when:** the rejoined sets deep-equal the source objects, and `text()` output is unchanged.
- **Verify:** `npm test -- tests/unit/data/anim/sets`

#### WP-8.4 Baker, clip layer, retargeting, the mannequin
- **Owns:** `engine/anim/clip/{bake,library,layer,retarget}.ts`, `engine/gfx/puppets/bodies/mannequin.ts`
- **Needs:** WP 3.7, WP 3.8, WP 8.3
- **Size:** L
- **Carry:** the API of `src/mocap/mocap.js` and the ideas in its `drive` (§5.3).
- **Build:**
  - **A baker** that works from format-1 **parameters** (direction, bend, twist, hints), handles singular poses, and produces 30 fps rotation tracks on the canonical skeleton.
  - **Standard clips too** (doctrine: Common ground): each baked clip is also a three.js `AnimationClip` (`QuaternionKeyframeTrack`s on the canonical bone names), so standard three.js code can play it with an `AnimationMixer` (the Library Lab, presentation-only props). The sim's clip layer samples the same tracks on the CPU.
  - **The library API.**
  - **The clip layer**, in the animator's clip slot (WP 3.7): weight, mask, fade from the current pose, speed, loop, additive, `walk/hold/next/landed` flags, cancel rules, events, root motion.
  - **Retargeting to builds:** a rotation copy, root scaled by the hip-height ratio, and contact IK.
  - **The mannequin body**, built with the body grammar (WP 3.8) from `body.segs` in `_set.json` (WP 8.3). The clip layer retargets onto it, and differences go in the baseline.
- **Improves:** I-13, I-49.
- **Done when:**
  - Forward-kinematics parity against the format-1 decode has a mean of **1 mm or less** for every set.
  - The worst cases are listed in the baseline.
  - The clip layer is unit-tested, and a baked `AnimationClip` played by an `AnimationMixer` matches the clip layer's pose within 0.1 mm.
- **Verify:** `npm test -- engine/anim/clip` (the library QA runs in WP 8.6)

#### WP-8.5 Tools port
- **Owns:** `tools/anim/*`, `tools/cmd/anim.ts`. It extends `repack.ts` from WP 8.3 and the `fps?` rows of WP 8.1's `data/anim/cmu/`; `legacy-readable.ts` stays WP 8.2's
- **Needs:** WP 8.1, WP 8.3, WP 8.4
- **Size:** L
- **Carry:** `anim-import`, `asf-amc`, `cmu`, `anim-set`, `mocap-lib`, `to-glb.py`.
- **Build:**
  - `x anim find|show|cut|import|cmu|bake|sheet`.
  - The `.cache/anim/` layout.
  - Guards in the GLB reader, each tested on small GLBs that the tests build in memory (CUBICSPLINE, signed and quantized accessors). No binary fixtures are committed.
  - Frame interpolation, and format-2 output, by default.
  - **`--legacy`:** nearest-frame sampling and format 1, exactly as today.
  - The split ledger; `--json`.
  - The 113 `fps?` takes verified: each flag is cleared, or the rate corrected, with the evidence in the row.
- **Improves:** I-13.
- **Done when:**
  - **`x anim import --cmu --legacy` reproduces the CMU set** byte for byte *(deferred proof: it needs the network; it runs at the library gate)*.
  - `x anim find punch` prints 20 lines or fewer.
- **Verify:** `npm test -- tools/anim`, plus at the gate `node x anim import --cmu --legacy --check`

#### WP-8.6 Library tests and QA
- **Owns:** library tests, `tests/e2e/library.spec.ts`, `tests/baselines/qa-anim-library.json`
- **Needs:** WP 6.6, WP 8.1, WP 8.4
- **Size:** M
- **Build:**
  - Node tests: format, provenance, ledger completeness, picks.
  - Fit thresholds: a clip's mean at most 40 mm and its worst at most 300 mm; a set's mean at most 20 mm.
  - The `anim` QA family over all 325 clips, with a baseline.
  - A browser smoke test on both backends.
- **Improves:** I-13, I-29.
- **Done when:** everything is green, and the Node part runs in under 30 s.
- **Verify:** `npm test -- engine/anim/clip tests/unit/data/anim && npm run e2e -- tests/e2e/library.spec.ts`

#### WP-8.7 The ACTIONS layer
- **Owns:** `engine/anim/actions.ts`, `data/anim/actions/*`
- **Needs:** WP 6.6, WP 8.4
- **Size:** M
- **Carry:**
  - The ranked list and build order of `docs/ANIMATION-RESEARCH.md`.
  - The `HCL_MOVES` design (`ed/96-hero-clips.js`), as input only.
- **Build:**
  - Multi-beat sequences that combine timelines, clips and effector overrides, with held contact frames, events and cancel windows.
  - A first set: jump phases, hurt and dizzy, the flip layer, death styles (the body only), charge-up, item-get, ledge hang and climb, wall slide, a paired grab, get-ups, idle life.
- **Improves:** I-11.
- **Done when:** each action has a check, QA and a `gallery` hook.
- **Verify:** `npm test -- engine/anim/actions && node x qa anim --only action:`

#### WP-8.8 Re-import from the sources (format 2, after G8)
- **Owns:** updates to `data/anim/sets/**`; `tests/unit/data/anim/upgrade.test.ts`
- **Needs:** G8
- **Size:** L
- **Build:**
  - Fetch the sources into `.cache/`: Mesh2Motion via git, CMU over HTTP. The owner supplies the Quaternius Universal Animation Library 1 and 2 once: an escalation (§11.5). Until then, Quaternius clips stay `via: "v1"` and are listed as blocked.
  - Re-import with hands, foot roll, root yaw, spine, contacts and events.
  - Swap clips in one at a time, checking parity, marked `via: "source"`.
- **Improves:** I-14.
- **Done when:** at least 80% of the clips whose sources are available are upgraded with parity (§10.5 step 8); a unit test counts the `via: "source"` clips against those whose sources are available, and fails below 80%. The rest are listed with reasons.
- **Verify:** `node x qa anim --only clip: && npm test -- engine/anim/clip tests/unit/data/anim/upgrade`

#### WP-8.9 Clip mode in the box, and the Library Lab
- **Owns:** `labs/box/scenes/clips.ts`, `labs/library/**`
- **Needs:** WP 7.8, WP 8.6
- **Size:** M
- **Carry:** the Mocap Lab's UX (`src/mocap.game.js`): catalog search; the clip as text with Apply, Reset, Mirror and Copy for model; deep links; frame stepping.
- **Build:**
  - **Clip mode in the box:** the mannequin and the hero play any clip, with the clip layer over the procedural rig. Its machine interface is `x anim show`, `__engine.describe('clip')` and the inspector.
  - **The Library Lab** (`labs/library/`), an optional page over the same interfaces, with a retarget preview across the builds. Its wiring in `labs/box/main.ts` goes through the integrator (§11.3).
- **Done when:**
  - The mannequin plays every clip in the box, headless and on both backends.
  - An edit test in the lab (raise the right arm, then Apply) moves the fist, and Reset restores the clip.
- **Verify:** `npm run e2e -- tests/e2e/box-clips.spec.ts tests/e2e/library-lab.spec.ts`

**Gate G8:**
- The library is intact, with provenance and parity proofs.
- The clip layer plays every clip on every build in Node with clean QA, or QA baselined with reasons.
- Clip mode runs in the box, headless and on both backends.
- `x anim import --cmu --legacy --check` passes.

### Phase 9: Audio (lane X)

The stress test had no sound. The engine's sound data and synth design come over here, as code (doctrine: Assets): sounds are definitions rendered by DSP, never sample files. WPs 9.1, 9.2 and 9.4 need only the kernel, so lane X may run alongside the box stages when an agent is free.

#### WP-9.1 DSP core
- **Owns:** `engine/audio/dsp/**`
- **Needs:** G1
- **Size:** M
- **Carry:** the synth design (`engine:3647-3856`).
- **Build:**
  - Oscillators: square, pulse 25% and 12.5%, triangle, sine, saw, noise.
  - ADSR envelopes, sweeps, arpeggios, vibrato, biquad filters, delay, simple FM, and a Karplus–Strong pluck.
  - `render(def, seed, rate) → Float32Array`, reproducible and hashable in each runtime, with goldens per runtime (§6.5).

  jsfxr (Unlicense) and ZzFX (MIT) are references only. If code is ever borrowed, its license is recorded.
- **Improves:** I-23.
- **Done when:** the same definition and seed give the same hash in Node and in Chromium.
- **Verify:** `npm test -- engine/audio/dsp && npm run e2e -- tests/e2e/audio-dsp.spec.ts --project=webgl2`

#### WP-9.2 Sound data
- **Owns:** `engine/audio/data/**`, `fixtures/sounds/` (a small neutral sound set and one demo song for tests and the gallery)
- **Needs:** WP 9.1
- **Size:** S
- **Carry:** the engine's 33 effects, 6 drums and 5 songs (COPY the data).
- **Build:**
  - The data as typed modules (kinds `sfx` and `song`, with their scaffold templates).
  - Validators (track length must divide the bar; value ranges).
  - Variants, and layered effects.
- **Improves:** I-23.
- **Done when:** every sound renders, and its validators pass. The clipping, DC and duration checks (the `audio` QA family) run over them from WP 9.4 on.
- **Verify:** `npm test -- engine/audio`

#### WP-9.3 Runtime, spatial audio, music
- **Owns:** `engine/audio/runtime/**`
- **Needs:** WP 9.2, WP 3.1, WP 4.2
- **Size:** M
- **Build:**
  - **Context:** resumed on a user gesture.
  - **Mixing:** buses for effects, music, UI and ambience; ducking; voice limits.
  - **Playback:** buffer playback, or streaming through an `AudioWorklet`.
  - **Spatial:** `PannerNode` positioning, with the listener following the camera.
  - **Occlusion:** muffling from a raycast through the `QueryView`, presentation only.
  - **Reverb:** procedural impulse responses for each room preset.
  - **Music:** layers by intensity; section changes at bar lines; stingers on the beat; stings bound to events.
  - **Footsteps** chosen by the level's surface tags (WP 4.2).
- **Improves:** I-23.
- **Done when:** a browser smoke test on both backends shows no errors and the right context states, and an `OfflineAudioContext` smoke test passes within tolerances.
- **Verify:** `npm run e2e -- tests/e2e/audio.spec.ts`

#### WP-9.4 Audio tools
- **Owns:** `tools/cmd/audio.ts`, `tools/qa/audio.ts`, `tests/baselines/qa-audio.json`
- **Needs:** WP 9.2
- **Size:** S
- **Build:** `x audio` (metrics, plus WAV or spectrogram PNG in `out/` on request), and the `audio` QA family with its baseline.
- **Improves:** I-23, I-29.
- **Done when:** the audio QA over every sound runs in under 5 s in Node.
- **Verify:** `node x qa audio && node x audio sfx:jump --spectrogram`

#### WP-9.5 Sound in the box
- **Owns:** `labs/box/sounds/`
- **Needs:** WP 7.8, WP 9.3, WP 9.4
- **Size:** S
- **Build:** footsteps by surface, hits, launches, deaths, torch ambience and one demo song, spatialized and ducked. The sound events come from the box's sim events, so a fight replay's sound timeline is reproducible. Its wiring in `labs/box/main.ts` goes through the integrator (§11.3).
- **Improves:** I-23.
- **Done when:** a fight replay's sound-event timeline hashes the same in Node and in the browser, and the runtime smoke test passes on both backends with the box.
- **Verify:** `npm run e2e -- tests/e2e/box-audio.spec.ts && node x qa audio`

**Gate G9:** sound buffers hash the same run after run in Node and in the browser, each against its runtime's goldens; the audio QA is clean; the box plays its sounds on both backends.

### Phase 10: Expansions (lanes A, P, W, I, B)

After the foundation, these widen the engine beyond what the box needed. Each still lands with a fixture test, and the box gains a scene for it where that helps.

#### WP-10.1 Procedural building blocks and their fixture rigs
- **Owns:** `engine/anim/proc/*.ts`, `fixtures/rigs/{biped,hexapod,serpent,floater,multiarm,tentacle}/`, `fixtures/rigs/README.md`, `tools/templates/rig/`
- **Needs:** G7
- **Size:** L (split into 10.1a, b and c if needed)
- **Carry:** the techniques of §5.6, as mechanisms only. The game's characters are not ported.
- **Build:**
  - The blocks:
    - `StateWeights`;
    - `Spring1/3/Quat` with `kick`;
    - digitigrade `twoBone`;
    - angle blending;
    - `SwayChain`;
    - `LegGait`: N legs in groups, planted feet, raycast targets including walls, thresholds that scale with speed;
    - a lagging spring part;
    - `PathChain`;
    - `VerletStrand`;
    - `LookAt` with `Blink`;
    - `Floater`: hover, bank, fold;
    - `Orbiters`, and detached parts;
    - `PoseHistory`: delayed replay;
    - extras attached to sockets;
    - tip trails.
  - **Six fixture rigs:** a digitigrade biped, a hexapod, a serpent, a floater, a multi-arm and a tentacle.
    - Each is 80–150 lines of primitives and passes `anim.check` and the `anim` QA family (WP 6.6).
    - `fixtures/rigs/README.md` maps each of the 16 blocks to at least one rig.
- **Improves:** I-12.
- **Done when:** every block has unit tests and a fixture that passes its check.
- **Verify:** `npm test -- engine/anim/proc && node x qa anim`

#### WP-10.2 Ragdolls
- **Owns:** `engine/physics/ragdoll.ts`, `engine/anim/ragdoll.ts`, `tests/replays/ragdoll-*.replay.json`
- **Needs:** G7
- **Size:** M
- **Build:**
  - A ragdoll builder from bone capsules (physics).
  - The animation side: descriptors, a blend weight, and the choice of get-up.
  - A hand-off on death or a big launch, as a scene setting in the box.
- **Improves:** I-11.
- **Done when:** a ragdoll hand-off round-trips in Node with Rapier, the correct get-up is chosen, and the ragdoll replays match their goldens in Node and in Chromium.
- **Verify:** `npm test -- engine/physics/ragdoll engine/anim/ragdoll && node x replay tests/replays/ragdoll-*.replay.json --browser chromium`

#### WP-10.3 The props library
- **Owns:** extends `engine/world/props/**` (from WP 4.5) with the first library set
- **Needs:** G7
- **Size:** M
- **Build:** torch sconce, banner, chest, door, table, bench, statue and lantern, each with geometry, material, body, optional light and interaction hooks.
- **Done when:** every prop passes the geometry and texture QA checks, and renders in `tests/e2e/props.spec.ts` with ID-pass coverage above 0 on both backends.
- **Verify:** `node x qa geo tex --only prop: && npm run e2e -- tests/e2e/props.spec.ts`

#### WP-10.4 Generic gameplay kits
- **Owns:** `engine/world/{things,patterns,awareness}.ts`
- **Needs:** G7
- **Size:** M
- **Carry:** `E.pattern` (`engine:3553-3625`), moved to 3D.
- **Build:**
  - **Things** that can be hit, with hooks.
  - **Projectile patterns:** aim, spread and ring, over WP 6.3's projectiles.
  - **Awareness and line of sight** beyond WP 5.2's basics: hearing, memory of the last seen position.
- **Done when:** unit tests pass, and pattern projectiles never tunnel.
- **Verify:** `npm test -- engine/world/things engine/world/patterns engine/world/awareness`

#### WP-10.5 Terrain
- **Owns:** `engine/world/terrain.ts`, `engine/physics/heightfield.ts`, `engine/gfx/terrain.ts`, `tests/replays/terrain-*.replay.json`
- **Needs:** G7
- **Size:** M
- **Build:**
  - A seeded fbm heightfield **descriptor** in `world/`, made into a Rapier heightfield collider by `physics/heightfield.ts`.
  - A chunked mesh with LOD.
  - A splat material driven by slope and height.
  - A nav grid built from the terrain.
- **Done when:**
  - The character walks the terrain with planted feet.
  - The terrain replays match their goldens in Node and in Chromium, rendering on both backends.
- **Verify:** `npm test -- engine/world/terrain engine/physics/heightfield engine/gfx/terrain && node x replay tests/replays/terrain-*.replay.json --browser both && npm run e2e -- tests/e2e/terrain.spec.ts`

#### WP-10.6 UI widgets
- **Owns:** `engine/ui/{widgets,dialog,menu}.ts`
- **Needs:** G7
- **Size:** M
- **Carry:** `ui.box/bar/hearts`, `Dialog`, `Menu` (`engine` §21).
- **Build:** widgets on the overlay (WP 6.5); Dialog and Menu with input and sound injected; safe areas; `ui.state()` covering them.
- **Done when:** `ui.state()` snapshot tests pass, and the widgets render on both backends.
- **Verify:** `npm test -- engine/ui && npm run e2e -- tests/e2e/ui.spec.ts`

#### WP-10.7 The game template and the store
- **Owns:** `engine/app/store.ts`, `tools/templates/game/`
- **Needs:** G7
- **Size:** M
- **Carry:** `E.store` (`engine:198-202`), extended with a configurable prefix (replacing the fixed `my3d2dge:`), a memory backend, versioning, and isolation in demo, sandbox and gallery modes.
- **Build:**
  - The store.
  - **`x new game <name> [--out dir]`**, the starting point for the future game. It scaffolds a separate package, by default outside this repository, containing:
    - the engine as a git submodule `engine/`, pinned to a commit of this repository (tags wait for Phase H), or as a `file:` dependency. Vite and tsx compile its TypeScript wherever it lives, so the engine needs no build step;
    - the same toolchain and pins (§6.10), and an `x` shim that runs the engine's `x.js` on the game's `scenes/` and `data/`;
    - a `vite.config.ts` and an `index.html`;
    - one scene and its replay test;
    - the game's own AGENTS.md, and a copy of `DOCTRINE.md`.

    `x ci --local` scaffolds it, in the submodule form, into a temporary directory, and runs its test.
- **Done when:** the store is unit-tested, and a scaffolded game passes its own test.
- **Verify:** `npm test -- engine/app/store && node x new game demo --test`

#### WP-10.8 Lab pages (optional views)
- **Owns:** `labs/{anim,materials,props,fx,cameras,physics}/**`, `labs/index/**`, `labs/labs.json`, `tools/cmd/lab.ts`
- **Needs:** G7
- **Size:** M
- **Carry:** the animlab UX (`src/starter/60-animlab.js`: lineup, skins, phase timeline, frozen key poses, dummy); `src/labs.json` and `tools/labs-test.mjs` (PORT, adding `answer` and `expires`).
- **Build:**
  - Pages driven by the registries, each a view over `x gallery`, `x describe` and `__engine` (doctrine: Agent-operable). The Animation Lab adds the lineup, timeline scrubbing and a bone overlay.
  - A labs index, with a question, an answer and an expiry date for temporary labs (`x lab add|rm|list`).
- **Done when:** every lab passes its suite on both backends, and each lab's file comment names the `x` command that does the same job without the page.
- **Verify:** `npm run e2e -- tests/e2e/labs.spec.ts`

**Gate G10:** every expansion is green on both backends with its fixtures; the fixture rigs pass their QA; `x new game` produces a package that runs.

### Phase 11: WebGPU features (lane R2: looks and speed only, never gameplay)

**On demand** (doctrine: Common ground). WPs 11.1 and 11.2 complete the framework and the measuring tool after G7. WPs 11.3–11.5 each start only when its **trigger** is measured: a budget the baseline path misses, or a look the box needs that only WebGPU can give. The ledger note records the measurement. Each uses three.js's built-in WebGPU features (TSL `compute()`, the addons) before custom WGSL.

#### WP-11.1 Completing the feature framework
- **Owns:** extends `engine/gfx/features.ts` (from WP 2.1); `tests/e2e/features.spec.ts`; extends `tools/cmd/perf.ts` with `--feature`
- **Needs:** G7
- **Size:** S
- **Build:**
  - Per-feature tests: with the feature on and off, the hash is unchanged and the gameplay entities in view appear in the ID pass (the fallback is playable).
  - Governor integration; `__engine.info().features`.
- **Improves:** I-16.
- **Done when:** the feature matrix passes on WebGPU.
- **Verify:** `npm run e2e -- tests/e2e/features.spec.ts --project=webgpu`

#### WP-11.2 GPU timing
- **Owns:** `engine/gfx/enhanced/timing.ts`
- **Needs:** WP 11.1
- **Size:** S
- **Build:** `trackTimestamp`, and `resolveTimestampsAsync` feeding `stats().gpuMs`, where `timestamp-query` exists. Where it does not (SwiftShader may lack it), `gpuMs` is absent and an advice code says why.
- **Done when:** GPU time appears in `stats().gpuMs` and in `x perf` on adapters that support it, and is reported as unavailable elsewhere.
- **Verify:** `npm run e2e -- tests/e2e/timing.spec.ts --project=webgpu`

#### WP-11.3 GPU particles
- **Owns:** `engine/gfx/enhanced/particles.ts`
- **Needs:** WP 11.1, WP 11.2
- **Size:** M
- **Trigger:** the CPU particles of WP 6.4 exceed their budget in the box's densest fight, or a look needs more particles than the CPU path carries.
- **Build:** compute particles (`instancedArray` plus `Fn().compute`), decorative only, falling back to the CPU particles of WP 6.4.
- **Done when:**
  - The hash is unchanged, and particles stay out of the ID pass.
  - The GPU time measured through WP 11.2 is under the budget, where it can be measured.
- **Verify:** `npm run e2e -- tests/e2e/enhanced-particles.spec.ts --project=webgpu`

#### WP-11.4 GPU-driven crowds
- **Owns:** `engine/gfx/enhanced/crowds.ts`
- **Needs:** WP 11.1
- **Size:** L
- **Trigger:** the crowd ladder's render cost at 5,000 misses its budget on the baseline path (WP 5.7's numbers).
- **Build,** in stages:
  1. Compute frustum culling plus indirect draws over the instancing service's batches.
  2. Only if the 2× target is still missed: compute skinning and occlusion culling.

  The instancing service remains the fallback.
- **Done when:** draw-call and CPU-render costs improve by at least 2× at 5,000 crowd members in the box, with the hash unchanged.
- **Verify:** `node x perf labs/box --scene crowd-5000 --feature gpu-crowds --budget`

#### WP-11.5 Lighting and shading upgrades
- **Owns:** `engine/gfx/enhanced/{lighting,ao,ssr,aa,csm}.ts`, using three.js's `TiledLighting`, `GTAONode`, `SSRNode`, `TRAANode` and `CSMShadowNode` addons
- **Needs:** WP 11.1
- **Size:** L
- **Trigger:** a look the box needs that the baseline path cannot give: more lights than the pool, ambient occlusion, reflections, or cascaded shadows outdoors.
- **Build:**
  - Tiled lighting (r180's `TiledLighting` addon), lifting the light pool's limit on WebGPU.
  - GTAO, SSR, and TRAA with deterministic jitter in tests.
  - Cascaded shadows through `CSMShadowNode`, for outdoor scenes.
  - SSGI and god rays wait for a qualifying release that has them, or become a custom TSL pass through an ADR.
- **Improves:** I-17.
- **Done when:** each feature passes its tests (hash unchanged, fallback playable) and has a measured cost, and the governor demotes them under load.
- **Verify:** `npm run e2e -- tests/e2e/enhanced.spec.ts --project=webgpu`

**Gate G11:**
- Every WebGPU feature built so far changes looks or speed only: the sim hash is unchanged, and the fallback is playable.
- Each falls back cleanly, is owned by the governor and is reported in `info()`.
- Each on-demand WP not yet triggered is recorded as "not needed yet", with the measurement that says so.

### Phase 12: Agent tooling+ (lane T)

#### WP-12.1 Scaffolds and skills, completed
- **Owns:** extends `.claude/skills/**` and `.claude/agents/**` (from WP 0.10); `tools/templates/README.md`; the templates of §8.13 kinds from Phases 2–7 that are still missing
- **Needs:** G7
- **Size:** M
- **Build:**
  - `x new` for every kind in §8.13, each with `--test` in `x ci --local`; any missing template is added, and `tools/templates/README.md` lists them all.
  - Every skill and subagent listed in §8.10.
- **Improves:** I-34, I-36.
- **Done when:** every template passes every check.
- **Verify:** `node x new --test-all`

#### WP-12.2 Agent-usability evals and mutation testing
- **Owns:** `evals/**`, `tools/cmd/evals.ts`, `stryker.config.json`
- **Needs:** G7
- **Size:** M
- **Build:**
  - At least 12 small tasks with automated acceptance, for example:
    - add a prop;
    - add a box variant with a different crowd mix;
    - add a fog preset;
    - add a move;
    - fix a seeded desync.
    A fresh agent attempts each using only the docs. Model access for these runs is the owner's: an escalation (§11.5).
  - Mutation testing with StrykerJS and its Vitest runner (the established tool; §6.10's rule picks the version): mutants injected into `sim` and `anim` must be caught by the suites.
- **Improves:** I-40.
- **Done when:** at least 90% of mutants are caught, and a baseline pass rate for the tasks is recorded *(deferred proof: it needs the owner's model access, §11.5)*.
- **Verify:** `node x evals --dry-run && npx stryker run`

#### WP-12.3 Agent eye
- **Owns:** `tools/cmd/eye.ts`, `engine/dev/eye.ts`
- **Needs:** G7
- **Size:** S
- **Build:** a coarse visibility raster in Node, built from physics shapes and camera poses. It answers "is X visible from camera C" and draws ASCII thumbnails, with no GPU.
- **Done when:** its answers agree with the ID pass on the box's cameras for at least 95% of cases.
- **Verify:** `npm test -- engine/dev/eye && npm run e2e -- tests/e2e/eye.spec.ts --project=webgl2`

#### WP-12.4 Reading edition (optional)
- **Owns:** `tools/cmd/edition.ts`
- **Needs:** G7
- **Size:** S
- **Build:** a single generated file containing the file comments, the API and the examples, for handing to a chat model, with a token budget. **It is generated and tested, never written by hand.**
- **Done when:** the file regenerates in `x ci --local`, its examples run, and it is within budget.
- **Verify:** `node x edition --check`

#### WP-12.5 Preview hosting (optional; the owner enables it)
- **Owns:** `vercel.json`, `tools/ci/pages.yml`
- **Needs:** G7
- **Size:** S
- **Carry:** `vercel.json`'s idea of routes; `tools/stamp.mjs`'s idea of the commit stamp.
- **Build:**
  - **`npm run build`** (Vite) writes `dist/`: every page, bundled from source. The commit appears in `info()`.
  - Hosting (GitHub Pages or Vercel) is the owner's to enable: an escalation (§11.5). It lets people watching from afar open the box. The Pages workflow waits in `tools/ci/pages.yml`, like `ci.yml` (§8.9).
- **Done when:** the built site's box page passes the box suite from a plain static server (`vite preview`). Once hosting is enabled, a preview URL loads the box.
- **Verify:** `npm run build && npm run e2e -- tests/e2e/site.spec.ts`

**Gate G12:** the scaffolds are complete; the eval baseline and the mutation score are recorded; the ledger is up to date.

### Phase H: Production hardening (not scheduled)

Doctrine: Discovery first. Cross-platform compatibility and hardening happen when a game goes to production. When that happens, these become work packages:
- Firefox and Safari runs; mobile WebGL 2 and touch input; real devices.
- Cross-runtime and cross-platform reproducibility, if a game needs it (lockstep multiplayer, shared replays): deterministic math for the sim (the standard `Math` differs between engines, §4.7), Rapier's deterministic build, golden hashes per platform.
- Apple WebGL 2 instancing limits (16 KB uniform blocks), and other driver workarounds.
- A deploy pipeline built from source, releases, versioning and changelogs, the commit stamp.
- Bundle size, minification and loading; accessibility; security headers.
- Performance budgets on target hardware, instead of the development container.

### Upgrade work packages (scheduled when a line qualifies, never mixed with feature work)

Compatible releases need no work package: `x deps --update` adopts them at the start of each WP, in a commit of their own (§6.10). The lines below are not backward compatible, so each waits until it qualifies. `x deps --qualify` runs at every gate and lists what has qualified. Each upgrade:
- updates `package.json`, the lockfile, `tools/deps.json`, `@types/*`, `docs/THREE-DELTA.md`, the TSL reference and Appendix B as needed;
- checks the next release against the one that just qualified, and takes it too when it works the same way (§6.10, rule 3);
- runs every suite and replay; re-records goldens, thumbnails and budgets deliberately, recording each change.

It is done when everything is green.

| Id | Upgrade | Qualifies on | Notes |
|---|---|---|---|
| U-1 | Vitest 4 | 2026-10-22 | Configuration and reporter changes; the T1 suites must pass unchanged |
| U-2 | three r181, and r182 with it if r182 works the same way | 2026-10-31 (r182 alone: 2026-12-10) | r181 renames `PI2` and `PassNode.setResolution()`, deprecates `renderAsync()` and brightens rough PBR materials (§4.7). r181.2 broke the prototype's MRT path; the mask-pass design avoids MRT, but check the post suites closely. The TSL reference moves to the last wiki revision before r182 (or r183) |
| U-3 | The lint majors: `globals` 17, `eslint-plugin-jsdoc` 62, ESLint 10 | 2027-01-01, 2027-01-09, 2027-02-06 | Each as it qualifies; configuration only |
| U-4 | three r183 | 2027-02-18 | `PostProcessing` becomes `RenderPipeline`; `Clock` is deprecated; shadows change. Re-record thumbnails |
| U-5 | Vite 8 and TypeScript 6 | 2027-03-12, 2027-03-23 | Vite 8 moves to the Rolldown bundler; check TypeScript 6's release notes for removed options |
| U-6 | Node 26 LTS | 2027-05-05 | Through `.nvmrc` and `scripts/setup.sh` (and the environment, §11.5); re-record Node's goldens |
| U-7 | Rapier 0.20 | 2027-08-08 | Re-tune the character controller (its snap-to-ground changed), sleep, CCD, velocity caps and contacts; re-record the replays (snapshots are version-locked) |
| U-8 | three r184 and later | Each 12 months after its release | One WP per release, or several together when they work the same way |
| U-9 | The platform's Chromium | When the environment's browser changes | Doctrine: Discovery first. Re-record Chromium's goldens and the thumbnails |

---

## 10. Animation library migration, in detail

### 10.1 What comes over, and under what terms

| Set | Clips | Keys | Seconds | Text (gzip) | Fit, average / worst | Sources | License |
|---|---|---|---|---|---|---|---|
| QUATERNIUS | 88 (32 loops, 13 with root motion, 11 sword) | 1,295 | 135 | 387 KB (74 KB) | 13.9 / 222 mm | Universal Animation Library 1 and 2 | CC0 1.0 |
| MESH2MOTION | 177 (72 / 21 / 12) | 2,798 | 322 | 819 KB (158 KB) | 16.1 / 286 mm | 86 Quaternius re-exports (the 84 with an `orig` are tagged `alt`), 75 hand-animated, 16 mocopi captures | CC0 1.0 |
| CMU | 60 (16 / 44 / 1) | 2,376 | 236 | 722 KB (161 KB) | 17.8 / 167 mm | 25 subject libraries of the CMU database | CMU terms |

- **Also kept:**
  - three hand-written catalogs (39 KB of tags, descriptions, sources, skips and picks);
  - the ledger of **all 2,548 CMU takes** (113 subjects, 10.75 h; per-take category, fit, flags and usage; 30 rows marked `pick`).
- **Dropped:** HERO (Emberdeep's subset) and the 68 MB `examples/cmu-lib/`, which can be regenerated.
- **CMU terms, recorded verbatim in `data/anim/SOURCES.md`:**
  - The data may be copied, modified and redistributed, and used in commercial products.
  - It **may not be resold directly, even in converted form**.
  - Credit it as: *"The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217."*
- **Doctrine 4.** The clips are text data that agents read and edit, the doctrine's second preference. The binary sources (GLB, AMC) stay in the git-ignored `.cache/`.

### 10.2 The stored format: readable key poses (format 1, extended as format 2)

**Format 1.** Each key holds about 42 whole numbers in named fields:

| Field | Meaning |
|---|---|
| `t` | seconds |
| `hips` | `[f, r, u]`, as % of standing hip height |
| `body`, `chest`, `head` | `[turn, lean, tilt]`, in degrees, each relative to the part below |
| `shL`, `shR` | `[reach, shrug]` |
| `armL`, `armR` | `[fwd, out, up, bend, twist]` |
| `legL`, `legR` | `[fwd, out, up, bend, twist]` |
| `footL`, `footR` | `[down, out, toes]` |
| `blade` | `[f, r, u]`, optional |
| `root` | `[f, r]`, optional |

- **Decoding** rebuilds 36 body points on each library's measured rest body. Each library has its own spine shares.
- **Interpolation** is linear on every stored number. Loops wrap; one-shots hold their last pose.
- **Quantization:** angles to 1°; directions to 1%; hips and root to 1% of standing hip height.

**Format 2** is a strict superset; every format-1 file stays valid.
- **Optional fields per key:**
  - `handL/handR [flex, side, roll]`;
  - foot `roll` as the 4th number;
  - root `yaw` as the 3rd number;
  - a `spine [turn, lean, tilt]` override, written only when the library's spine share misses;
  - `gripL/gripR` (0–100).
- **Optional fields per clip:**
  - `events` (`land`, `hit`, `step`…);
  - `contacts` (foot and hand intervals, detected at import);
  - `props` (`"sword:R"`, `"box:LR"`);
  - the source `fps`;
  - `via` (`v1` or `source`);
  - `fit`.

**The validator warns when:**
- a limb direction collapses between opposite keys;
- twist jumps more than 120° while the bend is over 140°: the v1 pop pattern (example: HERO `Victory` at 1.2–1.3 s);
- a knee bends out of range;
- an angle goes past ±540°;
- the hips go below the floor.

**The normalized lens** folds angles to ±180° for reading, without changing the stored data.

### 10.3 Layout

```
data/anim/
  SOURCES.md  LICENSES/               provenance and license texts (CC0; CMU terms and acknowledgment)
  catalogs/{quaternius,mesh2motion,cmu}.json   hand-written catalogs (input to the importers)
  sets/<set>/_set.json                sources (rest bodies, licenses), body (mannequin segments), credit
  sets/<set>/<Clip_Slug>.json         one clip per file (1–10 KB, ~2,100 tokens), real name inside
  sets/<set>/catalog.tsv              generated: name | sec | loop | tags | desc | src | orig | take | fit (~30 tokens a row)
  cmu/<category>.tsv, cmu/subjects.tsv   the ledger, split into 17 categories (the subject descriptions move to subjects.tsv)
  actions/*.json                      multi-beat ACTIONS (WP 8.7)
.cache/anim/                          never committed: CMU archive or takes, converted library (~60–70 MB), source GLBs
```

**Agents search the library. They never read it whole.**
- `x anim find <words> [--cat c] [--max 20]` searches the catalogs, then the ledger.
- `x anim show <set>/<clip> --lens` prints one clip.
- A core list of about 40 clips is the first thing an agent sees.

### 10.4 The runtime path

```
clip.json ─parse/validate─▶ keys (format 1/2)
          ─bake (from PARAMETERS: direction, bend, twist, hints; singular poses handled)─▶
          rotation tracks: Float32 quaternions per bone at 30 fps + hips + root (~106 KB per 10 s clip, lazy, cached),
          also exposed as a three.js AnimationClip (QuaternionKeyframeTracks) for standard playback
          ─clip layer (weight, bone mask, fade from current pose, speed, loop, additive, events, root motion)─▶
          Character layer stack ─▶ pose ─▶ FK ─▶ puppets/skinning (presentation) or hits (sim)
```

- **Retargeting.**
  - Humanoid builds get a rotation copy, with the root scaled by the hip-height ratio, plus contact IK for feet and hands.
  - Non-human bodies map chains by name, using direction, bend and twist; the format's limb model suits this.
- **Feet.**
  - `contacts` drive the foot-planting post-pass on uneven ground.
  - From `drive`: the sole, not the ankle, goes to the floor, and the figure is lifted by its lowest point.
- **Sampling stays on the CPU** (doctrine: GPU-free gameplay). Root motion, events and hit volumes are therefore identical on every backend. An `AnimationMixer` playing the exported `AnimationClip` is for presentation only (the Library Lab, props); the sim never reads it.

### 10.5 Migration steps, each with its proof

| Step | WP | Proof |
|---|---|---|
| 1. Provenance and license files | 8.1 | SOURCES.md lists every library with its URL, file names, license text and acknowledgment |
| 2. Catalogs and ledger copied verbatim, then split | 8.1 | The split rows join back to the original exactly |
| 3. Port `readable.js` with no change in behaviour | 8.2 | Every clip sampled at 30 fps decodes within 0.001 mm of the reference vectors. The legacy oracle reproduces them bit for bit |
| 4. Repackage the sets as one file per clip | 8.3 | Rejoined, they deep-equal the source objects, and `text()` output is unchanged |
| 5. Baker and clip layer | 8.4 | FK parity against the v1 decode at 30 fps and at 60 Hz midpoints: mean ≤ 1 mm per set; worst cases listed |
| 6. Node contact sheets, tests, clip mode and the Library Lab | 8.6, 8.9 | Lints pass or are baselined with reasons, on both backends |
| 7. Port the tools | 8.5 | `x anim import --cmu --legacy` reproduces the CMU set byte for byte. This study verified that the source's importer does so today |
| 8. Format-2 re-import from the sources | 8.8 | Per clip, decoded-point parity with v1 within that clip's fit; swapped in one at a time as `via: "source"` |
| 9. Re-survey CMU; import the `pick` rows as games need them | 8.8 | The ledger's `fit` reflects format 2; the notes are kept |

### 10.6 What the library does not cover, and how the engine fills it

**Already covered for humanoids** (measured against `ANIMATION-RESEARCH.md`'s ranked list), most of tiers 1–3:
- jump phases, get-ups, rolls and flips;
- lift, carry and throw; interactions; idle life;
- swimming, crawling, sliding and gliding;
- bow and shield; blocks; tool work; ceremonies and dances.

**Missing, and how each gap gets filled:**

| Gap | Filled by |
|---|---|
| Item-get, wall slide, whip, grabs with a victim | **ACTIONS** (WP 8.7), plus procedural moves |
| Quadrupeds and creatures | Procedural building blocks and fixture rigs (WP 10.1) |
| Vehicles | Later, when a game needs them |
| Death effects | FX, not clips |

**Future sources:**
- Quaternius Library 1 Pro and Library 2 Source (CC0) can be imported.
- 100STYLE is CC BY 4.0, which requires attribution. It is held back unless the owner approves (Q11 in §13).

---

## 11. Running this plan: extra effort or ultracode

### 11.1 Rules for both modes

- **The doctrine first.** Read `DOCTRINE.md` at the start of every session. When the plan and the doctrine disagree, follow the doctrine and record the conflict (§11.4).
- **Order and gates.**
  - Never start a WP before everything it **Needs** is done and green.
  - Never call a gate passed until all its checks are green.
  - Never weaken a gate to pass it.
- **The box comes first.** Until G7, a WP that does not serve the current box stage waits, unless an agent is idle and its Needs are green (lanes L and X, §9.1).
- **Commits.** One commit per WP (more is fine), with the message `<area>: <what> (WP-x.y)`. Compatible releases adopted at the WP's start go first, in a `deps:` commit of their own (§6.10).
- **Pull requests.** One PR per stage (gate), and `x ci --local` must be green before merging (GitHub Actions too, once enabled). Merge with a merge commit, never a squash, so the ledger's commits stay on `main`; start the next stage from the updated `main`. Work on the branch your session designates.
- **The ledger.** In extra-effort mode, update §14 in the same commit as the work: status, commit and a one-line note. In ultracode, lanes report and the integrator writes the ledger.
- **Deviations** become ADR amendments in `docs/decisions/`. **Blockers** go in the WP's ledger note, together with the smallest core change that would unblock it. Then move on to the next independent WP.
- **Escalations** follow §8.14: ask, wait up to 15 minutes, then commit, decide and record. Never stall.
- **The source repo.** `$MY3D2DGE_SRC` (WP 0.1; `x src` checks it) points at a read-only checkout of my-3d2dge at `e37e4ee`. Read only the cited line ranges; never edit it.
- **Context hygiene: the one reading instruction.** Read `DOCTRINE.md`, AGENTS.md, the WP entry and only the sections it cites, and the **file comments** of the modules involved. Open a whole source file only when porting it. The front matter, AGENTS.md and the prompts below all say the same.

### 11.2 Extra effort: one agent, sequential

**Recommended order**, which follows the dependency graph and keeps the box running at every stage:

| Stage | Work packages |
|---|---|
| Up to G0 | 0.1 → 0.2 → 0.4 → 0.5 → 0.3 → 0.6 → 0.7 → 0.11 → 0.8 → 0.9 → 0.10 |
| Up to G1 | 1.1 → 1.6 |
| Box 1 (G2) | 2.1 → 2.7 |
| Box 2 (G3) | 3.1 → 3.9, then 3.11, then 3.10 |
| Box 3 (G4) | 4.1 → 4.6 |
| Box 4 (G5) | 5.1 → 5.7 |
| Box 5 (G6) | 6.1 → 6.7 |
| Box 6 (G7) | 7.1 → 7.8 |
| Library (G8) | 8.1 → 8.2 → 8.3 → 8.4 → 8.5 → 8.6 → 8.7 → 8.9 |
| Audio (G9) | 9.1 → 9.5 |
| Expansions (G10) | 10.1 → 10.8 |
| WebGPU features (G11) | 11.1 → 11.5 |
| Agent tooling+ (G12) | 12.1 → 12.5 |
| Last | 8.8 |

A range such as `2.1 → 2.7` means every WP of the stage in numeric order. Upgrades (U-1…U-9) slot in between stages when they qualify.

**Loop for each WP:**
1. `node x deps --update`: adopt any compatible releases, in a commit of their own.
2. Plan the files.
3. Write the tests first where the Done-when list is numeric.
4. Implement.
5. `npm run check` → `npm test` → `npm run e2e` (selected as in §8.2).
6. The `verifier` subagent reviews.
7. Fix, commit, update the ledger.

**Use subagents to keep the main context small:**
- `verifier` for every WP;
- `visual-reviewer` for anything visual;
- `suite-runner` for T2 and the long runs in the background;
- an Explore agent for wide searches of the source.

**Checkpoints.** At each gate: run `x deps --qualify`, push, open the PR, wait for a green `x ci --local` (and Actions, once enabled), merge, then write a gate note in the ledger (what is proven, measured numbers, open risks, escalations and the calls made). Post the box's film of the stage for the owner (§11.5).

### 11.3 Ultracode: a multi-agent workflow

**Shape.**
- **Phases 0 and 1 run in sequence**, as a single lane with an implementer and a verifier.
- **Each box stage (Phases 2–7) runs its lanes in parallel**, keeping fewer than 10 agents at once: up to 6 implementers (the stage's lanes from §9.1), a shared verifier queue (1–2 agents) and the integrator (lane B), which runs the stage's integration WP and its gate.
- **A lane may start a later stage's WP early**, when its Needs are green and an agent is free. It never delays the current stage's gate.
- **Lanes L and X** (Phases 8 and 9) may run in the background from G1 when there is room under the agent cap.
- **After G7**, Phases 8–12 run as parallel lanes (L, X, the expansion lanes, R2 and T).

**Isolation.**
- Each lane runs in its own git worktree (`isolation: "worktree"`). Before its first Verify, the lane:
  - runs `npm ci` in the worktree, or symlinks the main checkout's `node_modules`;
  - sets its own `PORT`, so its Vite server and Playwright runs never collide with another lane's;
  - needs no other shell state. Every `x` command resolves the source itself (`$MY3D2DGE_SRC`, else `.cache/src-3d2dge`, else the WP 0.1 order), and `x check` detects the worktree (WP 0.4).
- A WP may change only its **Owns** paths, as widened by the rules in §9.3.
- Generated files (`docs/INDEX.md`, `docs/API.md`, `docs/ERRORS.md`, `docs/escalations/README.md`) are never resolved by hand. On a merge conflict, take either side and re-run the generator.
- Shared files are owned by the integrator or regenerated:
  - `engine/index.ts`, `eslint.config.js`, `package.json`, `tools/deps.json`, `tsconfig.json`, `vite.config.ts`, `playwright.config.ts`, the generated docs, the ledger.
  - `package-lock.json` is regenerated: on a conflict, take either side and run `npm install`.
  - After G7, `labs/box/main.ts` and `labs/box/README.md`: the expansions request their wiring there.
- Lanes request changes to shared files through their final report.

**Escalations in a workflow.** Lanes never wait. A lane writes the record (`x esc open --no-wait`) and reports it; the integrator escalates once for the run, waits up to 15 minutes, then decides and records the call (§8.14).

**The integrator:**
1. merges lanes in dependency order;
2. regenerates the docs (`x docs --write`);
3. applies the requested shared-file edits;
4. runs the stage's integration WP and the full gate suite;
5. handles escalations for the run;
6. updates the ledger;
7. opens or updates the PR.

On a conflict, the WP merged later re-runs its Verify after rebasing onto the integrator's branch.

**Implementer prompt** (one per WP):
```
You are implementing WP-<id> "<title>" of my-3dge. Read: DOCTRINE.md; AGENTS.md; the WP-<id> entry in PLAN.md §9
and only the sections it cites; the file comments of the modules named in Owns/Needs. Source to carry over is at
$MY3D2DGE_SRC (my-3d2dge@e37e4ee): read only the cited lines. Change only the Owns paths. Follow the doctrine. Write
tests first for numeric Done-when items. Iterate until every Verify command exits 0. If an action needs the owner's
approval or a principle cannot be satisfied, do not wait and do not perform it: record it with
`node x esc open --no-wait`, take the doctrine's preferred alternative (procedural or text instead of binary; a stub
behind the feature registry), and report it.
Final report (≤ 30 lines): files changed; Verify results with report.json paths; Done-when checklist with evidence;
requested shared-file edits (exact text); deviations as ADR amendment text; escalations; open issues.
```

**Verifier prompt** (one per WP, adversarial):
```
Verify WP-<id> of my-3dge on branch <b>. Run its Verify commands plus `npm run check` and `npm test`.
Then try to break it against DOCTRINE.md: reproducibility leaks (Math.random, clocks, renderer reads in sim-side code),
anything reachable only through a page, binary files without approval, versions outside the Mastery rule, bespoke code
where an established tool or three.js API would do (Common ground), silent fallbacks, files outside Owns, missing or
weak tests (would a plausible bug pass?), docs drift, unbaselined QA changes, game content (§5.7), box sample content
leaking into engine/, production-hardening work outside Phase H.
Return JSON: { "pass": bool, "failures": [{ "what", "where", "fix" }], "notes" }.
```

**Gates in ultracode** are run by the integrator with `npm test` and the full `npm run e2e`, plus the gate's specific checks. A failed gate sends the failure back to the lane that owns it.

### 11.4 When something is not as the plan says

The source changes, an upstream API differs, or a number doesn't hold. In that case:
1. Measure.
2. Choose the option that best keeps the doctrine.
3. If the choice needs the owner's approval, or a principle cannot be satisfied, escalate (§8.14). Otherwise decide.
4. Record it as an ADR amendment with the evidence.
5. Update the affected WP entries in this plan, in the same commit.

The plan is a living document. Its ledger, ADRs and escalation records are the truth about what was done.

### 11.5 What the owner does: direction, approvals and a few switches

Humans give direction remotely; agents fly the plane. The owner's part is small, and each piece arrives as an escalation (§8.14) with a fallback, so work never stalls.

**Seeing the work.** At each gate, the agent posts the stage's film (`x film`) and the box's numbers in the PR or the chat. Preview hosting (WP 12.5) lets the owner open the box in a browser once it is enabled.

**Switches that belong to the owner:**

| Step | Needed by | Fallback until it's done |
|---|---|---|
| Node 24 for every new session: add `bash scripts/setup.sh` to the environment's setup script (the cloud environment menu in the session's title bar, then Edit, then Setup script) | Optional, from WP 0.1 | The SessionStart hook installs Node 24 in each session |
| GitHub Actions on for the repository, and an agent token allowed to push `.github/workflows/*` (the `workflow` scope) | WP 0.9 | `x ci --local` is the gate; the workflow waits in `tools/ci/ci.yml` (§8.9) |
| Branch protection that makes `ci.yml` a required check | I-33 | Agents run `x ci --local` before every merge |
| Preview hosting: GitHub Pages or a Vercel project | WP 12.5 | Films and pictures in the PR or chat; `npm run build` plus `npx vite preview` locally |
| Quaternius Universal Animation Library 1 and 2 (`.glb`): a download link or a private repository | WP 8.8 | Quaternius clips stay `via: "v1"` and are listed as blocked |
| Model access for agent-usability evals (headless Claude Code or an API key) | WP 12.2 | `x evals --dry-run` checks the tasks and their acceptance tests only |
| Any binary asset other than a font (doctrine: Assets) | As needed | A procedural or text version, or the feature waits |

---

## 12. Risk register

| # | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| R1 | The animation's tuned "feel" is lost in the port (axes, units, positions → rotations) | M | H | Reference vectors (WP 0.11); differential tests (WPs 3.6, 6.1); `x film --compare` (from Box 2); motion QA | A |
| R2 | Node and Chromium runs of one scene drift apart (they differ by 1 ulp on some `Math.sin` and `Math.cos` results, §4.7), and agents compare them by mistake | H | M | Goldens per runtime; nothing compares a Node hash with a Chromium hash; browser-recorded play is verified in headless Chromium; the `determinism-debugging` skill; `--bisect` | C, P |
| R3 | Headless WebGPU is flaky or loses its device | H | M | The stand-in canvas with readback (verified with r180 and Chromium 141); backend asserts; per-backend baselines; retries for infrastructure failures only | T |
| R4 | Agents write APIs from newer three.js releases than r180 (`RenderPipeline`, `DynamicLighting`…) or deprecated ones | H | M | `@types/three` 0.180.0 makes a missing name a type error; three.js's own sources in `node_modules`; `THREE-DELTA.md` and the TSL reference as it stood for r180; ESLint bans with their replacements; deprecations fail tests; the `api-checker` subagent | T, R |
| R5 | r180's quirks: the instancing uniform path and its buffer usage; MRT renders black on WebGPU; `positionLocal` after instancing | H | M | The instancing service; masks from a separate pass; outlines from `positionGeometry`; tests for each (§4.7) | R |
| R6 | An upgrade breaks a technique (r181.2 broke the prototype's MRT path with validation errors) | M | M | Each upgrade is its own WP that runs every suite; fragile techniques avoided; the upgrade calendar of §9 | R |
| R7 | Rapier diverges somewhere the probes did not reach, or a restore surprises us again (restores do not continue exactly once bodies touch, §4.7) | M | M | Captures canonicalize (§6.5); replays in Node and Chromium at every stage; `--bisect`; the deterministic build (same API) as a fallback through an ADR | P |
| R8 | Crowd physics cost at 5,000 bodies (21 ms in the prototype) | H | M | Sleeping; sim LOD (kinematic grid movement beyond a radius), a scene setting recorded in replays and never driven by frame time; budgets. WebGPU-driven crowds for rendering only | P, R |
| R9 | Size creep and docs drift | M | M | `x sizes` budgets; `x docs --check`; caps on file and comment length | T |
| R10 | Parallel agents collide | H | M | Owns lists; worktrees; shared files regenerated or owned by the integrator | Integrator |
| R11 | Licenses or provenance get lost | L | H | `SOURCES.md`; per-clip `src`/`orig`/`take` tests; the CMU terms verbatim | L |
| R12 | Large data in git | L | M | `.cache/` on demand; no build output committed; the asset scan | L, T |
| R13 | Tools that need the network (CMU over HTTP; GitHub 403s for `curl` in the sandbox, while `git clone` works) | M | H for the source checkout, L otherwise | `$MY3D2DGE_SRC` resolution order (WP 0.1); committed reference vectors checked by checksum; network tests at gates or on demand; caching | T, L |
| R14 | Agents report success falsely or skip tests | M | H | The `verifier` subagent; `x ci --local` as the gate; the "never skip a test" rule; mutation testing | T |
| R15 | Visual regressions go unnoticed | M | M | The ID pass, thumbnails per backend, `x film --compare <ref>` from Box 2, and the `visual-reviewer` subagent on demand | R |
| R16 | Audio unlock rules in browsers | M | L | Resume on a gesture; an in-game mute; iOS waits for Phase H | X |
| R17 | Churn from adopting compatible releases at once: a patch changes formatting, warnings or sim results in the middle of a stage | M | M | `deps:` commits of their own at a WP's start, passing T0–T2; exact pins and the lockfile; goldens re-recorded with reasons; a one-commit rollback | T |
| R18 | Game content creeps into the engine, or the box becomes a game | M | M | The exclusion list (§5.7); box content stays in `labs/box/`; stages are defined by engine capabilities, not game design; the verifier checks both | All |
| R19 | Escalations stall work or get lost | M | M | The 15-minute rule; `x esc` records; `x check` fails on an overdue open escalation; SessionStart lists open ones; gate notes list the calls made | T, Integrator |
| R20 | Hardening work leaks in early and slows discovery | M | L | Phase H is not scheduled; the verifier flags hardening outside it | All |
| R21 | Playwright 1.64 drives the container's older Chromium 141 through `executablePath`, a pairing Playwright does not promise | M | M | Measured working on both backends (§4.7); the harness spec (WP 0.2) catches a regression at once; on a failure, pin the newest 1.x that works and record the call, or the owner updates the environment's browser | T |

---

## 13. Decisions and open questions

### 13.1 Decisions (recorded as ADRs in WP 0.1)

| ADR | Decision |
|---|---|
| 0001 | **Scope:** the engine only. The game is built later and elsewhere. The Stress Box is the integration target, benchmark and sample, not a game. Emberdeep's patterns are rebuilt generically with new fixtures; its content is excluded (§5.7) |
| 0002 | **The doctrine governs** (`DOCTRINE.md`). Each principle has the checks of §3. Agents change the doctrine only when the owner asks, and a hook asks the owner to confirm each edit |
| 0003 | **Language and toolchain:** strict TypeScript 5.9.3 (ES modules, extensionless imports, erasable syntax), checked by `tsc` with `moduleResolution: bundler` against the pinned types; run by Vite in the browser, and by Vitest and tsx in Node (doctrines: Common ground, Mastery) |
| 0004 | **Coordinates and units:** SI; right-handed; +Y up; characters face +Z; the conversion from my-3d2dge is in Appendix C |
| 0005 | **Time:** a fixed 60 Hz, at most 6 steps per frame, with interpolation; an injectable clock; a timescale stack; a hit-stop budget; per-entity clocks |
| 0006 | **Reproducibility contract** (§6.5, doctrine: Reproducible): the development platform only; the standard `Math` and three.js's math in the sim, with golden hashes per runtime (Node and Chromium); an ordered world; Rapier's `compat` build; the hash over the bodies' state; captures that canonicalize; the proof matrix |
| 0007 | **Versions** (doctrine: Mastery): the newest release compatible with each qualifying one, adopted at once. Today: three.js r180.0, Rapier `compat` 0.19.3, TypeScript 5.9.3, Vite 7.3, Vitest 3.2, Playwright 1.64 driving the container's Chromium 141, and Node 24.21 LTS; `x deps`; upgrades as lines qualify (§6.10) |
| 0008 | **Rendering** (doctrine: GPU-free gameplay): WebGPU first, WebGL 2 the fallback; classic three.js materials first, TSL where they fall short; the play-alike contract (§6.7); compute and storage only under `gfx/enhanced/`, plus the `BASELINE_COMPUTE` allowlist; WebGPU features on demand; post masks from a separate pass, never MRT |
| 0009 | **Animation architecture:** effector-space authoring, then IK, then a rotation skeleton (root + 23 joints); an explicit layer stack; two update paths; no Card mode; no camera input to animation |
| 0010 | **Animation library:** readable key poses (format 1, extended as format 2) are the stored format, baked to rotation tracks that are also three.js `AnimationClip`s; the CMU library comes on demand |
| 0011 | **Characters as data:** body grammar v2; one rigid-skinned mesh per character by default; instanced crowds; smooth skinning optional |
| 0012 | **Registries and schemas:** "ask the entry, never the id"; every kind gets an `x describe` listing (also `__engine.describe()`) and docs; the §8.13 kinds also get a scaffold and a `gallery` hook; kinds with a QA family get its checks |
| 0013 | **Audio:** pure DSP into seeded, hashed `Float32Array`s; Web Audio for playback and spatial sound; `OfflineAudioContext` only for smoke tests |
| 0014 | **Tooling:** the standard toolchain behind npm scripts (Vite, Vitest, Playwright Test, ESLint, Prettier, tsx); one CLI, `node x`, with `report.json`, for what only this engine does; test tiers with budgets; tests selected through Vite's module graph; images optional; every capability machine-operable (doctrine: Agent-operable) |
| 0015 | **Docs:** JSDoc file and export comments are the manual; INDEX, API and ERRORS are generated; prose is never duplicated; pinned knowledge is the packages' own sources and types, `THREE-DELTA.md` and the TSL reference |
| 0016 | **Repo hygiene:** no committed build output; a lockfile; the version in `package.json` only; `x ci --local` as the gate until Actions are enabled; stage PRs merged with merge commits, never squashed |
| 0017 | **Escalation protocol** (§8.14): what needs the owner, the 15-minute rule, the records |
| 0018 | **The roadmap:** box first, in six stages; expansions after the foundation; production hardening only when a game goes to production (doctrine: Discovery first) |
| 0019 | **Common ground** (doctrine: Common ground): established tools, libraries and three.js APIs before bespoke code. The bespoke parts, each because nothing established does the job: the `x` commands (engine operations), the escalation log, the ID pass and look metrics, replays and hashing, content QA, the animation system being ported, and the local ESLint rule. Dependencies in `node_modules`, Rapier's inlined WASM included, are code, not source assets (doctrine: Assets) |

### 13.2 Open questions, each with a default (proceed with the default; revisit only through an ADR amendment)

| # | Question | Default |
|---|---|---|
| Q1 | How big is the first box? | `room`, 16 × 12 m, with walls, a low wall, a pillar and spawns. It grows by new scenes and variants, never by changing the meaning of a passing one |
| Q2 | How much of the prototype's behaviour must the box match? | None beyond the ported animation math. The prototype's numbers are starting values; changes record their reason in the scene data |
| Q3 | Hosting | None until WP 12.5 and the owner's approval: GitHub Pages or Vercel, built from source |
| Q4 | Where does the future game live? | A separate repository (or `games/<name>` package) scaffolded by `x new game`, importing the engine as a git submodule pinned to a commit (tags wait for Phase H) |
| Q5 | Rapier: the standard, SIMD or deterministic build? | The standard `compat` build (doctrine: Common ground), measured reproducible on the platform. SIMD only if WP 5.1 measures a 20% gain at 5,000 bodies. `deterministic-compat` (the same API) through an ADR only if a divergence bisects to Rapier, or in Phase H if a game needs cross-platform replays |
| Q6 | Characters: skinned or rigid parts? | One rigid-skinned merged mesh by default; smooth skinning per body, optionally |
| Q7 | Card mode? | Dropped. If a game ever needs sprite characters, they become a separate optional module |
| Q8 | The pixel look? | A post filter (the `pixel` look) over real geometry |
| Q9 | Mobile? | Phase H. Until then nothing is tested on mobile, and nothing claims to be |
| Q10 | Distributing the CMU library | `x anim cmu` fills `.cache/` on demand; a checksummed release asset can come later |
| Q11 | Import 100STYLE (CC BY 4.0)? | No, unless the owner approves the attribution requirement (an escalation) |
| Q12 | Run the sim in a Web Worker? | Not until a perf WP proves the need. The sim has no DOM, so it stays possible |
| Q13 | An ECS framework? | None: plain objects and systems in a fixed order. Revisit only with measurements |
| Q14 | Upgrade three.js at every release that qualifies? | Yes (doctrine: Mastery), as its own WP between stages, taking the next release along when it works the same way; skip a release only when its WP finds a regression, and record why |
| Q15 | How often are compatible releases adopted? | At the start of every WP and at every gate (`x deps --update`), in a `deps:` commit of its own that passes T0–T2: at once, as the doctrine says, but never mixed with feature work |

---

## 14. Status ledger

Status is `todo`, `doing`, `done` or `blocked`. Update the row in the same commit as the work. Escalation ids go in the notes.

| WP | Title | Lane | Status | Commit | Notes |
|---|---|---|---|---|---|
| 0.1 | Repo constitution, platform, source checkout | T | todo | | |
| 0.2 | Toolchain, e2e fixture, `x` CLI | T | todo | | |
| 0.3 | Dependency qualification, pinned knowledge | T | todo | | |
| 0.4 | ESLint rules, `npm run check` (T0) | T | todo | | |
| 0.5 | Test tiers, selection, advice trap | T | todo | | |
| 0.6 | Docs system | T | todo | | |
| 0.7 | Escalations and decisions | T | todo | | |
| 0.8 | Hello page on both backends | T | todo | | |
| 0.9 | CI (`x ci --local`, Actions when enabled) | T | todo | | |
| 0.10 | Claude Code integration | T | todo | | |
| 0.11 | Port reference vectors | T | todo | | |
| **G0** | **Gate: foundation** | | todo | | |
| 1.1 | Math, rng, noise, hash, color | C | todo | | |
| 1.2 | Registry, events, log, settings, schema | C | todo | | |
| 1.3 | Time | C | todo | | |
| 1.4 | Sim world and canonical state | C | todo | | |
| 1.5 | Intents, scenes, replays, `x sim`, `x replay` | C | todo | | |
| 1.6 | Headless app and inspector core | C | todo | | |
| **G1** | **Gate: kernel** | | todo | | |
| 2.1 | Renderer, capabilities, features, resolution, warm-up | R | todo | | |
| 2.2 | Level compiler (v1) | W | todo | | |
| 2.3 | Materials and procedural textures (v1) | R | todo | | |
| 2.4 | Geometry kit and level meshes (v1) | W | todo | | |
| 2.5 | Cameras (v1) | R | todo | | |
| 2.6 | Shots, ID pass, `x shot` | T | todo | | |
| 2.7 | Box 1: the box app | B | todo | | |
| **G2** | **Gate: Box 1** | | todo | | |
| 3.1 | Rapier adapter and queries | P | todo | | |
| 3.2 | Character controller | P | todo | | |
| 3.3 | Input devices, bindings, intents | I | todo | | |
| 3.4 | Skeleton, builds, pose, FK, sheets | A | todo | | |
| 3.5 | IK | A | todo | | |
| 3.6 | Humanoid procedural port | A | todo | | |
| 3.7 | Character animator and body states | A | todo | | |
| 3.8 | Instancing service and puppets | R | todo | | |
| 3.9 | Cameras (v2): chase, first person, rail | R | todo | | |
| 3.10 | Box 2: a hero in the box | B | todo | | |
| 3.11 | Film and visual comparison | T | todo | | |
| **G3** | **Gate: Box 2** | | todo | | |
| 4.1 | Bodies and props physics | P | todo | | |
| 4.2 | Level compiler (v2): the hall | W | todo | | |
| 4.3 | Navigation and spatial queries | W | todo | | |
| 4.4 | Level meshes (v2) and cutaway | R | todo | | |
| 4.5 | Props as data | R | todo | | |
| 4.6 | Box 3: the hall | B | todo | | |
| **G4** | **Gate: Box 3** | | todo | | |
| 5.1 | Crowd bodies | P | todo | | |
| 5.2 | Steering kit | W | todo | | |
| 5.3 | Blob and floater rigs | A | todo | | |
| 5.4 | Crowd rendering and pose LOD | R | todo | | |
| 5.5 | Performance counters and crowd ladder | T | todo | | |
| 5.6 | Bot and dev actions | I | todo | | |
| 5.7 | Box 4: a crowd | B | todo | | |
| **G5** | **Gate: Box 4** | | todo | | |
| 6.1 | Moves, timelines, hits | A | todo | | |
| 6.2 | Reactions and secondary motion | A | todo | | |
| 6.3 | Combat helpers | W | todo | | |
| 6.4 | Effects | R | todo | | |
| 6.5 | Overlay, font, damage numbers | I | todo | | |
| 6.6 | Animation checks, QA, sheets | A | todo | | |
| 6.7 | Box 5: combat | B | todo | | |
| **G6** | **Gate: Box 5** | | todo | | |
| 7.1 | Lights, shadows, atmosphere, sky | R | todo | | |
| 7.2 | Materials (v2): toon, outlines, styles | R | todo | | |
| 7.3 | Texture library (v2) | W | todo | | |
| 7.4 | Post-processing | R | todo | | |
| 7.5 | Performance governor | I | todo | | |
| 7.6 | MCP server | T | todo | | |
| 7.7 | Gallery | I | todo | | |
| 7.8 | Box 6: the Stress Box | B | todo | | |
| **G7** | **Gate: the Stress Box (foundation)** | | todo | | |
| 8.1 | Provenance, catalogs, ledger, docs | L | todo | | |
| 8.2 | Readable codec and format 2 | L | todo | | |
| 8.3 | Re-containerize the sets | L | todo | | |
| 8.4 | Baker, clip layer, retargeting, mannequin | L | todo | | |
| 8.5 | Tools port | L | todo | | |
| 8.6 | Library tests and QA | L | todo | | |
| 8.7 | ACTIONS layer | L | todo | | |
| 8.8 | Re-import from sources (after G8) | L | todo | | |
| 8.9 | Clip mode in the box, Library Lab | L | todo | | |
| **G8** | **Gate: animation library** | | todo | | |
| 9.1 | DSP core | X | todo | | |
| 9.2 | Sound data | X | todo | | |
| 9.3 | Runtime, spatial audio, music | X | todo | | |
| 9.4 | Audio tools | X | todo | | |
| 9.5 | Sound in the box | X | todo | | |
| **G9** | **Gate: audio** | | todo | | |
| 10.1 | Building blocks and fixture rigs | A | todo | | |
| 10.2 | Ragdolls | P | todo | | |
| 10.3 | Props library | W | todo | | |
| 10.4 | Generic gameplay kits | W | todo | | |
| 10.5 | Terrain | W | todo | | |
| 10.6 | UI widgets | I | todo | | |
| 10.7 | Game template and store | B | todo | | |
| 10.8 | Lab pages (optional views) | B | todo | | |
| **G10** | **Gate: expansions** | | todo | | |
| 11.1 | Completing the feature framework | R2 | todo | | |
| 11.2 | GPU timing | R2 | todo | | |
| 11.3 | GPU particles | R2 | todo | | |
| 11.4 | GPU-driven crowds | R2 | todo | | |
| 11.5 | Lighting and shading upgrades | R2 | todo | | |
| **G11** | **Gate: WebGPU features** | | todo | | |
| 12.1 | Scaffolds and skills completed | T | todo | | |
| 12.2 | Agent-usability evals and mutation testing | T | todo | | |
| 12.3 | Agent eye | T | todo | | |
| 12.4 | Reading edition (optional) | T | todo | | |
| 12.5 | Preview hosting (optional) | T | todo | | |
| **G12** | **Gate: agent tooling** | | todo | | |
| U-1 | Vitest 4 (from 2026-10-22) | T | todo | | |
| U-2 | three r181, with r182 if it works the same (from 2026-10-31) | R | todo | | |
| U-3 | The lint majors (from 2027-01-01 to 2027-02-06) | T | todo | | |
| U-4 | three r183 (from 2027-02-18) | R | todo | | |
| U-5 | Vite 8 and TypeScript 6 (from 2027-03-12 and 2027-03-23) | T | todo | | |
| U-6 | Node 26 LTS (from 2027-05-05) | T | todo | | |
| U-7 | Rapier 0.20 (from 2027-08-08) | P | todo | | |
| U-8 | three r184 and later (each 12 months after release) | R | todo | | |
| U-9 | The platform's Chromium (when the environment changes) | T | todo | | |

---

## Appendices

### Appendix A: Source-to-target map, by path

In this table, `engine` §N means section N of `engine/my-3d2dge.js`, not a section of this plan.

| Source (`my-3d2dge@e37e4ee`) | Fate | Target |
|---|---|---|
| `engine/my-3d2dge.js` §1 math | PORT (bit-exact `rng`, `hash2`, `noise2`, colour) | `engine/core/{math,rng,noise,color}.ts` |
| `engine` §2 pixel primitives, §7 canvas lighting, §17 Body | DROP | — |
| `engine` §3 views, §4 screen | CONCEPT | `engine/gfx/cameras/` presets, `engine/gfx/resolution.ts` |
| `engine` §5 input | PORT the action model; REWRITE the devices | `engine/input/` |
| `engine` §6 pixel font | PORT (compact encoding) | `engine/ui/font.ts` |
| `engine` §8 particles | PORT the emitters | `engine/gfx/fx/particles.ts` |
| `engine` §9 renderer | CONCEPT (its effect list) | `engine/gfx/*` |
| `engine` §10 game loop | REWRITE the loop; PORT timers and scenes | `engine/core/time.ts`, `engine/app/` |
| `engine` §11 Humanoid, `Attack`, `Combo`, `MOVES` | PORT the math, moves and secondary motion; DROP the drawing | `engine/anim/*` |
| `engine` §12 Blob | PORT the update; DROP the drawing | `engine/anim/blob.ts` |
| `engine` §13 TileMap | PORT `parseLevel`; CONCEPT cutaway and wall-foot shadow | `engine/world/level/`, `engine/gfx/cutaway.ts` |
| `engine` §14 flow field | DROP (stress-world's Dijkstra replaces it) | `engine/world/nav.ts` |
| `engine` §15 texture helpers | PORT | `engine/gfx/textures/` |
| `engine` §16 PlatformMap and Platformer | DROP the map; PORT the feel settings | `engine/physics/character.ts` |
| `engine` §18 Bullets, `E.pattern` | PORT to 3D with swept tests | `engine/world/{projectiles,patterns}.ts` |
| `engine` §19 SpatialHash | PORT | `engine/world/spatial.ts` |
| `engine` §20 audio | REWRITE the synth; COPY the data | `engine/audio/{dsp,data,runtime}/` |
| `engine` §21 UI, §21b backdrops, §21c props | PORT UI and backdrop generators; CONCEPT the props | `engine/ui/`, `engine/gfx/sky.ts`, `engine/world/props/` |
| `engine` §22 WebGPU lighting | CONCEPT (the habits of the feature registry) | `engine/gfx/features.ts` |
| `engine/my-3d2dge-agent.js` | DROP (its ideas live on in `x docs`) | — |
| `src/stress-world/*`, `src/stress-world.template.html` | Per §5.1: the Stress Box's engine systems, and its sample content | `engine/{gfx,physics,world,anim,sim}/`, `labs/box/` |
| `src/lab3d/*`, `src/lab3d.template.html` | Per §5.1 | `engine/*`, `labs/box/` |
| `src/free-camera.*`, `src/lab.*`, `src/shapes-*` | DROP | — |
| `src/mocap/*` | Per §5.3 | `engine/anim/clip/`, `data/anim/` |
| `src/mocap.game.js`, `src/mocap.template.html` | REWRITE | `labs/box/` (clip mode), `labs/library/` |
| `src/emberdeep/**` | **EXCLUDED** (patterns only, §5.6) | — |
| `src/starter/**` | DROP (the animlab UX informs `labs/anim/`) | — |
| `src/arena.*`, `src/stress.game.js`, `src/stress.template.html`, `examples/scarfrunner-side.html` | DROP | — |
| `src/labs.json`, `src/labs.template.html` | PORT | `labs/` (WP 10.8) |
| `tools/*` | Per §5.5 and §5.3 | `tools/cmd/`, `tools/lib/`, `tools/anim/` |
| `docs/LAB-3D.md` | Its lessons go into §4 and the ADRs | `docs/decisions/` |
| `docs/MOCAP.md`, `docs/ANIMATION-RESEARCH.md` | PORT | `docs/ANIMATION-LIBRARY.md`, `docs/ANIMATION-RESEARCH.md` |
| `docs/CHARACTERS.md`, `DAN.md`, `CODEX.md`, `CONTROLS-AUDIT.md` | Lessons only | AGENTS.md, ADRs, input docs |
| `docs/assets/*` | DROP | — |
| `vendor/three-0.182.0` | REPLACE with `three@0.180.0` from npm: the newest release compatible with the qualifying one (doctrine: Mastery). Nothing is vendored | `package.json` |
| `vendor/rapier3d-simd-compat-0.19.3` | REPLACE with `@dimforge/rapier3d-compat@0.19.3` from npm: the standard build at the same version (doctrine: Common ground). SIMD only if WP 5.1 measures the need | `package.json` |
| `examples/**`, `dist/**` | DROP (build output) | — |
| `README.md`, `API.md`, `AI_GUIDE.md`, `CHANGELOG.md`, `CLAUDE.md` | REWRITE (generated docs, AGENTS.md) | — |
| `.claude/**` | PORT | `.claude/` |
| `package.json`, `vercel.json`, `.gitignore`, `.vercelignore` | REWRITE | — |
| `LICENSE` (MIT) | COPY | `LICENSE` |

### Appendix B: Banned and renamed APIs (enforced by ESLint, each message naming its replacement)

**Legacy or fragile three.js, banned everywhere in the engine:**

| Banned | Use instead |
|---|---|
| `WebGLRenderer` | `WebGPURenderer` (`forceWebGL` for the WebGL 2 path) |
| `ShaderMaterial`, `RawShaderMaterial` | Classic materials; node materials and TSL where a classic material cannot do the job |
| `onBeforeCompile` | Node inputs (`colorNode`, `positionNode`…) |
| `EffectComposer`, `three/examples/jsm/postprocessing/*` | `PostProcessing` plus the TSL display nodes from the addons |
| `mrt(`, `setMRT(`, `mrtNode` | A separate pass, using the ID pass's override technique. The prototype's MRT graph renders black on r180's WebGPU backend (§4.7). Lifting this ban takes an ADR and a test on both backends |
| `DynamicDrawUsage` on instanced matrices or colours | The instancing service, which keeps `StaticDrawUsage` with update ranges. The prototype lost dynamic-usage updates above 1,000 instances on r182 (§4.7) |
| `positionLocal`, where the pre-instancing position is meant (outline push directions) | `positionGeometry`. r180 assigns the instance-transformed position to `positionLocal` |
| `Clock` | `core/time`, or `Timer` inside `gfx` only |
| `renderAsync`, `computeAsync`, `clearAsync`, `initTextureAsync`, `hasFeatureAsync`, `waitForGPU` | `await renderer.init()` once, then `render()`, `compute()`, `clear()`, `initTexture()`, `hasFeature()`. r181 deprecates the async forms and removes `waitForGPU()`, so avoiding them now keeps U-2 mechanical. `compileAsync` (the warm-up) and `readRenderTargetPixelsAsync` stay |
| `readRenderTargetPixels` (sync), `getImageData`, `readPixels` | `readRenderTargetPixelsAsync`, and only in `engine/gfx/shot.ts` |
| Reading `renderer._pipelines` or other private fields | The public pipeline counter (`engine/gfx/pipelines.ts`), the one place that reads renderer internals |

**Names from newer three.js releases that r180 lacks.** A named import of a missing export is a type error (`@types/three` 0.180.0) and, in the browser, a link error that stops the whole module graph.

| Newer name | In r180 |
|---|---|
| `RenderPipeline` (the post-processing class from r183) | `PostProcessing` |
| `DynamicLighting`, `ClusteredLighting` | The light pool (WP 7.1); the `TiledLighting` addon as a WebGPU feature (WP 11.5) |
| `TextureSource` | `Source` |
| `packNormalToRGB`, `unpackRGBToNormal` | `directionToColor`, `colorToDirection` |
| `negateOnBackSide` | `directionToFaceDirection` |
| `TWO_PI`, `PassNode.setResolutionScale()` | `PI2`, `PassNode.setResolution()`. U-2 (r181) renames them |
| `SSGINode`, `GodraysNode` | Not available: wait for a qualifying release, or write a custom TSL pass through an ADR |

**Deprecated in r180.** Each prints a warning on use, and any warning fails a test (WP 0.5).

| Deprecated | Use instead |
|---|---|
| `atan2(y, x)` | `atan(y, x)` |
| `equals` | `equal` |
| `modInt` | `mod(int(…))` |
| `rangeFog(c, n, f)` | `fog(c, rangeFogFactor(n, f))` |
| `densityFog(c, d)` | `fog(c, densityFogFactor(d))` |
| `burn`, `dodge`, `overlay`, `screen` | `blendBurn`, `blendDodge`, `blendOverlay`, `blendScreen` |
| `append`, `.append()` | `Stack`, `.toStack()` |
| `label()` | `setName()` |
| `.varying()`, `.vertexStage()` | `.toVarying()`, `.toVertexStage()` |
| `texture(…).uv(u)` | `.sample(u)` |
| `viewportResolution` | `screenSize` |
| `transformedNormalView`, `transformedNormalWorld`, `transformedClearcoatNormalView` | `normalView`, `normalWorld`, `clearcoatNormalView` |
| `storageObject` | `storage().setPBO(true)` |
| `material.shadowNode` | `castShadowNode` |

**Path-scoped: allowed only under `engine/gfx/enhanced/`.**
- **APIs:** `.compute(`, `computeAsync`, `compileComputeAsync`, `storage(`, `StorageBufferAttribute`, `StorageInstancedBufferAttribute`, `IndirectStorageBufferAttribute`, `textureStore`, `storageTexture`, `atomic*`, `workgroupArray`, `setIndirect`, and `instancedArray` or `attributeArray` when compute writes them.
- **One exception.** A file may use them outside `enhanced/` only if it is listed in `BASELINE_COMPUTE` (exported by `engine/gfx/features.ts`; `eslint.config.js` reads the list), with a test on both backends. These are "map" kernels, which the WebGL backend emulates with transform feedback.

**Sim-side bans** (`engine/{core,sim,physics,anim,world}`, `engine/input/intents.ts`, `engine/audio/dsp`, `engine/dev/bot.ts`, `labs/box/scenes/`, `labs/box/cast/`, `fixtures/scenes/`; `*.test.ts` files are exempt):
- **Banned:**
  - `Math.random`, `Date`, `performance.now`;
  - `setTimeout`, `setInterval`, `requestAnimationFrame`;
  - `document`, `window`, `navigator`;
  - any import of `three`, `three/webgpu`, `three/tsl` or `three/addons/*`, except in `core/math.ts`, which re-exports the math classes;
  - `AudioContext`.
- **Allowed, and expected:** the standard `Math`, `Math.sin` and `Math.cos` included, and three.js's math classes through `core/math`. Goldens are kept per runtime, because Node and Chromium differ on `sin` and `cos` (§6.5).

**Everywhere:**
- no binary files, except the owner-approved ones in `data/APPROVED-BINARIES.json` and fonts under `data/fonts/` (doctrine: Assets);
- no `eval` or `new Function` in the engine;
- no TypeScript enums or namespaces (`erasableSyntaxOnly`).

### Appendix C: Conventions and conversion formulas

**Axes and units.**
- **my-3d2dge's frame:** x east, y south, z up, 16 units per metre. This frame is **left-handed**.
- **my-3dge's frame:** x, y up, z, with x × y = z (right-handed).
- **Positions, velocities and accelerations:** `new = (x, z, y) / 16`. Swapping y and z converts the handedness.
- **Facing.** The old rig's `facing` φ has forward = (cos φ, sin φ) on the ground plane (`engine:1810`). The new yaw is ψ = π/2 − φ, with forward(ψ) = (sin ψ, 0, cos ψ) and right = forward × up.
- **Mocap's (f, r, u) frame** maps to f→+Z, r→−X, u→+Y. That is one reflection; prove it with an asymmetric clip.

**Character controller and level constants** (`stress-world/20-sim.js`, `10-hall.js`). These are the box's starting values; they may change (§9.0).

| Quantity | Source (units) | SI |
|---|---|---|
| Capsule half-height, radius | 9, 4.5 | 0.5625 m, 0.28125 m |
| Controller offset, snap to ground | 0.3, 4 | 0.01875 m, 0.25 m |
| Autostep max height, min width | 4, 2 | 0.25 m, 0.125 m |
| Max slope | 50° | 50° |
| Walk, jump, dash speed | 80, 150, 260 u/s | 5, 9.375, 16.25 m/s |
| Dash duration, distance, cooldown | 0.2 s, 52 u, 0.45 s (`stress-world/20-sim.js:257`) | 0.2 s, 3.25 m, 0.45 s |
| Gravity | −480 u/s² | −30 m/s² (cartoon, about 3 g) |
| Jump apex | ≈ 23.4 u | ≈ 1.46 m |
| Launch speed (big hit; kill, big kill) | ≥ 70; ≥ 95, ≥ 170 u/s | 4.375; 5.94, 10.625 m/s |
| Nav climb limit per sample (`CLIMB`) | 3.5 | 0.219 m |
| Wall, pillar, low wall, gallery, dais height | 48, 56, 12, 16, 8 | 3.0, 3.5, 0.75, 1.0, 0.5 m |
| Character mass for push impulses | 2,500 | Re-tune in WP 3.2. Mass doesn't depend on the length unit, but the impulse response does |

**The canonical skeleton**, and how it maps to the old rig and the mocap points:

| Joint | Parent | Old `rig.J` | Mocap points |
|---|---|---|---|
| root | — | rig `x, y, z` (ground) | root (ground under the pelvis) |
| pelvis | root | `hipC` | `pelvis` (+`pelvisF`) |
| spine0 | pelvis | — | (lower back; CMU spine share) |
| spine1 | spine0 | — | `spine1` |
| spine2 | spine1 | — | `spine2` |
| chest | spine2 | `shC` (top) | `chest` (+`chestF`) |
| neck | chest | — | `neck` |
| head | neck | `head` | `head`, `headTop` (+`faceF`) |
| clavicle L/R | chest | — | `clav` |
| upperArm L/R | clavicle | `shL`/`shR` | `sh` |
| forearm L/R | upperArm | `elbowL`/`elbowR` | `elbow` |
| hand L/R | forearm | `handL`/`handR` | `wrist` (+`index`, `knuck`, `pinky`, `fist`) |
| thigh L/R | pelvis | `hipL`/`hipR` | `hip` |
| shin L/R | thigh | `kneeL`/`kneeR` | `knee` |
| foot L/R | shin | `footL`/`footR` | `ankle` |
| toe L/R | foot | — | `ball` → `toe` |

- **Sockets:** `weaponR` and `weaponL` (from the hand, plus the grip; the blade direction comes from `J.bladeDir` or the knuckle line), `headTop`, `eyeL`, `eyeR`, `contactL` and `contactR` (the soles), `back` (the cape anchor).

**Move fields, old to new.** Confirm every unit against `engine:1842-1986` in WP 6.1.

| Old field (`E.MOVES`) | New field |
|---|---|
| `a0`, `a1` (radians; + toward the right hand) | `arc: [a0, a1]` (unchanged) |
| `z0`, `z1` with `rel` (units from the shoulder centre) | `height: [z0/16, z1/16]` (metres from the shoulder centre) |
| `z0`, `z1` on kicks (shares of hip height) | `kickHeight: [z0, z1]` (unchanged) |
| `reach`, scaled by arm length / 9.2 with `rel` | `reach: reach/16` (metres at the reference arm), `reachScale: 'arm'` |
| `r0`, `r1` | `reach: [r0/16, r1/16]` |
| `hand` | `hand: 'R' \| 'L' \| 'both'` |
| `plane: 'side'` | `plane: 'vertical'` (default `'ground'`; automatic side-view chops are dropped) |
| `kick` | `limb: 'footR'` |
| `spin` | `spin: 1` (turns) |
| `lunge`, `hop` (units) | `body.lunge`, `body.hop` in metres (÷16) |
| `crouch`, `lean`, `twist` | `body.crouch`, `body.lean`, `body.twist`, units confirmed in WP 6.1 |
| `hold` (share of recover) | `time.hold` |
| `wind`, `active`, `recover` (seconds) | `time: { wind, active, recover }` |
| `hitAt` | `hitAt`, a property of the move: 0.35 by default **for every move**. This fixes the old difference between building from a name and from a spec |
| `blade: 0` | `trail: false` |

### Appendix D: Measured numbers (baselines and budgets start here)

**Source**
- my-3d2dge v0.14.0, commit `e37e4ee`; 16 releases from 2026-09-27 to 2026-10-09.
- 301 tracked files, 136 of them build output (about 84 of 95 MB).

**Size**

| Item | Size |
|---|---|
| `engine/my-3d2dge.js` | 4,652 lines, 374 KB, about 107k tokens |
| Agent edition | 2,866 lines, 217 KB, about three-quarters a verbatim copy (75–82%) |
| `src/stress-world/` | 9 files, 2,574 lines, about 55k tokens |
| `src/lab3d/` | 7 files, 1,030 lines, about 74 KB |
| Humanoid (`engine` §11) | 77 KB (about 22k tokens) |
| Portable animation math | about 43 KB (12.4k tokens) |
| Card-mode drawing stack | about 60 KB (17k tokens) |
| Proposed `engine/anim/` | 55–66 KB (16–19k tokens) |
| Engine code worth porting besides animation | about 27–35k tokens |

**Library**
- 325 curated clips, 1.93 MB of text (393 KB gzipped); about 2,100 tokens per clip and about 30 tokens per catalog row.
- The ledger: 2,548 takes, 262 KB.
- `cmu-lib`: 68 MB on disk (70.4 MB of text, 14.5 MB gzipped); 4,770 entries and 241,740 keys.
- Baking to rotations: mean error 0.26–0.46 mm. Key-for-key conversion: worst case 0.73 m.
- CMU re-import: byte-identical; 69 MB downloaded in about 1 minute.

**Performance (headless)**

| Measurement | Value |
|---|---|
| stress-world, per step | 1 ms at 100 monsters; 5.6 ms at 1,000 (2.6 physics); 33 ms at 5,000 (21 physics) |
| lab3d draw calls | 1,225 in Puppet mode, 487 in Card mode; about 120 meshes for the hero alone (measured: WebGL 2, iso view, shadows on) |
| SwiftShader frame rate | 5–7 fps (lab3d at 1100×700) |
| stress-world ready | 11.1 s on WebGL, 5.8 s on WebGPU |
| Proof hashes | `1917b7b9` (lab3d) and `68e1f7d1` (stress-world), the same on both backends. Not recorded in the source. Under r180 and r181.2 the stress-world hash is the same `68e1f7d1` (§4.7) |
| The prototype's stress-world test | 3 min 11 s on r182, 2 min 53 s on r180, in this container (2026-10-09) |

**Node** (two runs in the cloud container; the numbers depend on the machine)

| Measurement | Value |
|---|---|
| Engine load | 9–14 ms |
| 600 Humanoid steps | 21–30 ms |
| Lints over 24 moves | 0.28 s |
| Rapier init | 84–106 ms |
| 40 bodies × 600 steps | 78 ms |
| 200 capsules × 600 steps, twice (Rapier SIMD 0.19.3) | about 0.9 s |
| 5,000 capsules (Rapier `compat` 0.19.3, Node 24): one step; `takeSnapshot`; `restoreSnapshot` | 0.6 ms; 7.8 ms; 22.6 ms (5.72 MB) |
| lab3d proof | 27 ms in Node; 130 ms cold or 35 ms warm in the browser |

**Tests and tools**
- The full suite took about 25 minutes; the lab3d test 65–81 s.
- 35 tool files (343 KB) and 26 npm scripts.
- Browser launch copied 19 times, the server 4 times; about 20 tools parse their own arguments.
- About 310 KB of docs prose.

**Libraries**

| Library | Size |
|---|---|
| three r180, unminified (what Vite serves in development) | core 1.40 MB (277 KB gzipped), webgpu 1.88 MB (362 KB), tsl 32 KB (7 KB) |
| three r180, minified (for reference) | core 381 KB, webgpu 580 KB |
| three r182, minified (the prototype's) | core 381 KB, webgpu 616 KB, tsl 23 KB |
| Rapier `compat` 0.19.3, `rapier.mjs` with the inlined WASM | 2.24 MB (0.84 MB gzipped) |
| Rapier SIMD 0.19.3 (the prototype's), the same | 2.31 MB (0.86 MB gzipped) |
| Rapier 0.21 (for reference) | 4.37–4.62 MB (1.66 MB gzipped) |

**Toolchain** (the probe of §4.7, on the platform)

| Measurement | Value |
|---|---|
| `node x sim` (tsx, Rapier's initialization included) | 0.7 s |
| Vitest, one test stepping Rapier with three.js's math | 0.9 s |
| Playwright Test, one spec on both projects, against Vite | 3.4 s |
| `vite build` of the probe page | about 3 s |

**The platform (October 2026)**
- The development platform: Linux x64 (4 cores); Node 24.21.0, installed by `scripts/setup.sh` over the container's Node 22.22.0; Chromium 141.0.7390.37 (`/opt/pw-browsers/chromium-1194`, which the container's global Playwright 1.56.1 installed), driven by the project's Playwright 1.64.0; SwiftShader for WebGPU.
- Measured on it (§4.7): Rapier's `compat` and SIMD builds give the same snapshot hash in Node and Chromium. Against Node 22, Chromium's `Math.sin` differs in 3.46% of results, `Math.cos` in 3.35% and `Math.pow` in 9.99%, each by 1 ulp; against Node 24, only `sin` and `cos` differ.
- WebGPU reaches 83.3% of devices and WebGL 2 97.8% (web3dsurvey). By group: Linux 17.8%, Firefox 60.4%, Android 73.6%. This matters for Phase H, not before.
- Versions: §4.7 has every pin, its qualifying release and its next line. The newest releases today, for reference: three r186.1 (2026-09-24), Rapier JS 0.21.0 (2026-09-25), TypeScript 7.0.2 (2026-07-08), Vite 8.3.4 (2026-10-08), Vitest 5.0.3 (2026-09-30), ESLint 10.12.0 (2026-10-02), Playwright 1.64.0 (2026-10-07), Node 26.11.1 (2026-10-07).

### Appendix E: Draft `AGENTS.md`

```markdown
# AGENTS.md: rules for every change to my-3dge

my-3dge is a fully 3D web game engine written and maintained only by AI agents. DOCTRINE.md governs everything here:
read it first. The plan and its ledger are PLAN.md; generated docs start at docs/INDEX.md. The game is not here.

## The doctrine, as checks
1. Agent-readable: one concept per file, ≤ 400 lines (hard 600), a JSDoc file comment, strict TypeScript the way
   agents usually write it, docs generated from comments.   → npm run check (tsc, ESLint, Prettier), x docs --check
2. Agent-operable: every capability through npm scripts, node x or __engine; nothing only in a page.
                                                            → command smoke tests, the help() check, verifier
3. Verifiable without a display: the sim runs headless; visual checks are numbers (ID pass, metrics, thumbnails).
                                                            → npm test, x replay, npm run e2e
4. Assets: procedural first, then text and data; binary only with the owner's approval (fonts are pre-approved).
                                                            → x check (asset scan), x esc
5. Reproducible here: fixed 60 Hz, recorded intents, named seeded RNG, standard Math; golden hashes per runtime
   (Node, Chromium); a capture canonicalizes Rapier.        → ESLint sim bans, replays in Node and Chromium
6. The GPU never decides play: sim-side code never imports gfx, the renderer, the DOM or Web Audio (three.js's math
   only through core/math); WebGPU-only work lives in engine/gfx/enhanced, with a fallback, and never changes the hash.
                                                            → ESLint layer rules, tests/e2e/parity.spec.ts
7. Common ground: the established tool or three.js API first (npm, Vite, Vitest, Playwright, ESLint, Prettier;
   classic materials, AnimationClip, the addons); bespoke code only where nothing fits, with the reason in its
   file comment.                                            → verifier, ADR-0019
8. Mastery: each pin is the newest release compatible with the newest one ≥ 12 months old, adopted at once; write
   the qualifying release's idioms (docs/THREE-DELTA.md).   → x deps --check, x deps --update, banned names
9. Discovery first: target this container (Node 24 through scripts/setup.sh, its Chromium); no production
   hardening outside Phase H.

## Escalate, don't stall
Owner approval needed (a binary asset, a new dependency, a repo setting, a deploy, any outward action) or a principle
can't be met: node x esc open … → post it → wait up to 15 minutes, doing the preferred alternative, never the action
itself → answered: act on it. No answer: commit, decide, node x esc decide …, continue. For the rest of the run,
report further conflicts without stopping. Record every call.

## The loop
1. node x deps --update: adopt compatible releases first, in a commit of their own.
2. Read DOCTRINE.md, this file, your WP in PLAN.md §9 and only the sections it cites, and the file comments of the
   modules you touch (not whole files). The source being ported is read-only at $MY3D2DGE_SRC (node x src).
3. Edit. The after-edit hook formats and lints the file: fix what it reports.
4. npm run check (< 10 s) → npm test (< 60 s) → npm run e2e (< 6 min; PLAN.md §8.2 says what to select).
5. Read out/**/report.json. Open images only when a metric points at one (use the visual-reviewer subagent).
6. Show it in the box or a fixture test. Update the ledger row in PLAN.md §14 (in ultracode lanes, report it).
7. Commit "<area>: <what> (WP-x.y)". Report the commit, the report paths and any escalations.

## Rules
- SI units, +Y up, characters face +Z. Gameplay time is in 60 Hz sim ticks. Randomness comes from named streams.
- DOCTRINE.md changes only when the owner asks. Never edit out/ or node_modules/ by hand.
- Versions: only the pins in package.json, as tools/deps.json records them. Upgrades are their own work packages.
- Never skip, disable or loosen a test to get green. Baselines change only with a written reason.
- Never fall back silently: every downgrade emits an advice code.
- Ask the entry, never the id: shared code reads registry hooks and never compares ids.
- No game content in the engine; the box's own content stays in labs/box/ (PLAN.md §5.7).
- Docs are generated from comments: never restate a fact in prose (x docs --check).
- Blocked by the core? Write the smallest core change as a proposal in your WP notes. Don't widen your WP.
- Say plainly what you did not verify.

## Done means
Verify commands green; npm run check and npm test green; T2 green on both backends for what you touched; shown in the
box or a fixture; file comments and docs current; scaffold, gallery hook and QA for new §8.13 kinds; verifier review
clean; no new advice codes; escalations recorded; ledger updated.

## Where things are
engine/ (code + unit tests) · labs/box/ (the Stress Box) · data/ (readable data) · fixtures/ · tools/ (x commands,
content QA, the ESLint plugin, deps.json) · tests/ (e2e, replays, baselines) · docs/ (generated INDEX/API/ERRORS,
ADRs, escalations, reference) · scripts/setup.sh (the platform)
```

### Appendix F: Glossary

| Term | Meaning |
|---|---|
| **Stress Box** | The engine's integration target, benchmark and sample in `labs/box/`: the prototype's *Stress test: 3D world*, rebuilt in six stages (§9.0) |
| **Box stage** | One of the six phases that grow the box, each ending at a gate (Box 1 = G2 … Box 6 = G7) |
| **Development platform** | The cloud container development targets: Linux x64, Node 24.21.0 (installed by `scripts/setup.sh`), headless Chromium 141 with SwiftShader, driven by Playwright 1.64 (doctrine: Discovery first) |
| **Qualifying release** | A release at least 12 months old (doctrine: Mastery, §6.10) |
| **Compatible release** | A newer release that is backward compatible with a qualifying one (the same major; the same minor for 0.x packages), or that works the same way. It is adopted at once (§6.10) |
| **Common ground** | The doctrine's principle of building on the most widely used tools, libraries and patterns (§3, ADR-0019) |
| **Escalation** | A question for the owner, recorded in `docs/escalations/`, with a call made after 15 minutes if no answer comes (§8.14) |
| **Baseline features** | The features that run on both backends. They show everything the player needs to play |
| **WebGPU features** | WebGPU-only extras for looks or speed, each with a fallback, owned by the governor (§6.7) |
| **Play-alike contract** | The same replay gives Chromium's golden hashes on WebGPU and on WebGL 2, while rendering; looks may differ (§6.7) |
| **Runtime** | Node or Chromium on the platform. Each reproduces exactly, and each has its own golden hashes (§6.5) |
| **Capture** | The whole sim's state, taken so that the live run continues exactly as any later restore of it: it canonicalizes Rapier (§6.5) |
| **Shot** | A rendered frame read back from a render target, with look metrics and the ID pass (`x shot`, `__engine.shot()`) |
| **Golden hash** | The recorded hash of a replay at a checkpoint, keyed by runtime |
| **Sim-side** | Reproducible, renderer-free code that runs in Node: `core`, `sim`, `physics`, `anim`, `world`, intents, `audio/dsp`, the bot, the box's scenes and cast, the fixture scenes |
| **Presentation** | Code that draws or plays: `gfx`, the audio runtime, `ui`, the input devices |
| **View state** | Presentation-only state (cape chains, particles, camera shake). Never in the gameplay hash |
| **Intents** | The per-step input to the sim (move, camera heading, aim, buttons). They are recorded in replays |
| **Body states** | The words behaviours send to a body each step (`pose`, `stance`, `attack`, `air`, `dash`, `hurt`…). Bodies ignore words they don't know. Not to be confused with input intents |
| **Replay** | A seed plus per-step intents, with golden hashes at checkpoints |
| **Trace** | Per-step, per-entity hashes used to bisect a divergence |
| **ID pass** | A flat render with one colour per object, read back as per-object pixel counts and bounding boxes |
| **Text thumbnail** | A 48×27 grid of hex colours stored as JSON: a golden reference without an image file |
| **Effector space** | Authoring targets as positions in the body frame (forward, right, up), solved into rotations by IK |
| **Timeline** | Phases with durations, content and events. Moves, actions and reactions are all timelines |
| **`hitShape`** | A move's reach (range, half-angle, height band), measured once from the animation |
| **Sweep** | The weapon segment between two steps, tested against hurt capsules for precise hits |
| **Building block** | A reusable procedural rig technique (`LegGait`, `PathChain`…) that ships with a fixture |
| **Fixture** | Minimal neutral content made for tests and galleries, never game content |
| **Format 1/2** | The readable key-pose clip formats. Format 2 is a strict superset |
| **Bake** | Converting a readable clip into rotation tracks for the runtime, also exposed as a three.js `AnimationClip` |
| **Lens** | A read-only normalized view of a clip's angles |
| **WP** | A work package: an independently verifiable unit of work |
| **Lane** | A sequence of WPs owned by one stream of work |
| **Gate** | The set of checks that ends a phase |
| **Advice code** | A stable id for a warning, with a fix and a docs link |
| **Content QA** | Numeric checks on content (motion, meshes, textures, sounds, levels), run by `x qa` and in T1 (§8.6). ESLint checks code |
| **Ledger** | §14, the record of what is done |
