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
| Sources studied | `michaelcrosato/my-3d2dge` v0.14.0, commit `e37e4ee` (2026-10-08). `michaelcrosato/shardfall` at `fa2dab6` (2026-10-09), a sibling engine under the same doctrine (§4.8, §5.8) |
| Plan date | 2026-10-09. Re-based the same day on the Stress Box and the doctrine, then on the doctrine's principle 7 (Common ground) and amended Mastery rule. Re-based on 2026-10-10 on the doctrine's third version: How to read this, the North Star's "best expected output", WebGPU only, and Quality under the hood |
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
| Box 4 | fill with a crowd of 100 to 5,000 | crowd bodies, steering, blob and floater rigs, crowd rendering, performance counters |
| Box 5 | fight | moves and timelines, combat helpers, effects, the overlay, animation QA |
| Box 6 | look like the stress test | lights and shadows, toon and outlines, the texture library, post filters, reactions and secondary motion (ADR-0018 amendment 1) |

**Similar, not identical.** The box must do the stress test's job, not copy its behaviour or feel: nobody knows yet how the game should behave. The prototype's numbers (Appendix C) are starting values that change freely. Only the ported animation math is checked against the prototype, so that it survives translation (§9.0).

After Box 6 (gate G7, the foundation), the plan brings over the animation library and audio. Everything else (more world and animation features, advanced GPU features, more agent tooling) is **on demand**: built when a measured need triggers it, not in anticipation (doctrine: North Star). Production hardening waits until a game goes to production (doctrine: Discovery first). Two pieces come early, at the owner's request and untested: touch controls and a Vercel deployment of every push (ADR-0021).

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

### What shardfall adds

The owner's sibling engine, [shardfall](https://github.com/michaelcrosato/shardfall), is written in Rust under the same doctrine (§4.8). Its code cannot be copied, so its designs, tuned numbers, shaders and data come over instead (§5.8):
- the character controller's fixes and its feel meter, measured here on Rapier 0.21 (WP 3.2);
- touch controls, checked there only under phone emulation (WP 3.12), and a Vercel deployment (WP 0.12);
- one fixed MRT with every filter behind a uniform, its filters, and 73 tuned presets (WP 7.4);
- 893 more motion clips: 100STYLE's 878 loops of about 100 styles of walking, running, sidestepping and standing, and Quaternius' version 2 (WP 8.10);
- lessons from its journal: hash everything a capture holds, record setting changes in replays, reject unknown arguments, keep the startup read to one page.

### What we will build

A modular, typed engine in five layers (§6.1):
- **`core`**: math (three.js's math classes), the sim's deterministic math, time, randomness, registries.
- **Sim-side**: `sim`, `physics`, `anim`, `world`, input intents and audio DSP. No DOM and no renderer; it runs in Node.
- **Presentation**: `gfx` (three.js r182 on WebGPU), the audio runtime, `ui` (HTML/CSS) and the input devices.
- **`dev`**: the inspector and the tools inside the page.
- **`app`**: wiring and routes.

Game code sees only the **public API**, `engine/index.ts` and `engine/sim-api.ts`, in terms every agent knows. Behind it, the internals use whatever gives the best result (doctrines: Common ground, Quality under the hood).

Around it:
- **The Stress Box** (`labs/box/`): the integration target, the benchmark and the sample scene.
- **Data:** materials, props, levels and, later, the animation clips, all as readable text.
- **Tooling:** the standard web toolchain (Vite, Vitest, Playwright Test, ESLint, Prettier, TypeScript) behind npm scripts, plus one CLI (`node x <cmd>`) for what only this engine does. Every command prints 20 lines or fewer and writes a JSON report, so an agent verifies its own work without a display.

### The shape of the roadmap

| Phases | Content | How they run |
|---|---|---|
| 0–1 | Foundation and kernel | Sequential |
| 2–7 | Box 1 to Box 6. Gate G7 is the **Stress Box**: the foundation is set | Parallel lanes inside each stage |
| 8–9 | The animation library and audio | Parallel lanes; they may start early, without delaying a box stage |
| On demand | World and animation extras, advanced GPU features, more agent tooling, and a few box-stage tools (Phases 10–12; WPs 5.6, 7.5–7.7, 8.8) | Each WP starts only when its trigger is measured; the playground fires all 21 (Phase 13, ADR-0025) |
| 13 | **The Playground**: a house on a block where the player moves as in Apex Legends, in five cameras and two looks, with the on-demand WPs it needs | Four stages, G10 to G13: the character first, then the house, then the life in it, then the tech demo |
| H | Production hardening: other browsers, testing on phones, a native build, releases | Only when a game goes to production |

Each scheduled phase ends at a gate: a fixed set of commands that must pass.

### The ten biggest improvements

The full list of 54 is in §7.
1. **One integration target.** The Stress Box grows in stages, and each stage is proved by commands that need no display.
2. **One coordinate system:** SI units, +Y up, characters facing +Z.
3. **A true fixed-step simulation that runs headless in Node**, with replay files and bisection to the first step that diverges.
4. **Reproducible on the development platform, measured** (doctrine: Reproducible). Game code writes the standard `Math`; under the hood the sim swaps in fdlibm ports while it steps, so Node and Chromium agree bit for bit and one golden hash serves both. Rapier 0.21's restores continue exactly (§4.7).
5. **A rotation skeleton** (root plus 23 joints) under the ported procedural animation. It enables skinning, masks, additive layers, ragdolls, foot planting and look-at.
6. **Moves as timelines** carrying events, hit volumes and root motion.
7. **Common ground outside, quality inside** (doctrines: Common ground, Quality under the hood, Mastery). Game agents meet the most widely used tools and a familiar API: TypeScript 5.9.3, Vite 7.3, Vitest 3.2, Playwright 1.64, ESLint, Node 24 LTS. The internals use what measures best: three.js r182, on which the prototype's own stress test passes, and Rapier 0.21's SIMD build (§4.7).
8. **Standard tools with test tiers**: a quick gate of about five minutes before every merge, and the full run (about an hour on 4 cores) on GitHub after it, nobody waiting on it (ADR-0023), against about 25 minutes today. Vitest picks tests through Vite's module graph; one CLI, `node x`, covers what only this engine does.
9. **WebGPU only, gameplay on the CPU** (doctrine: WebGPU only). One renderer, with compute and storage available for looks and speed; HTML/CSS game UI checked through the DOM; visual checks without committed images (ID pass, look metrics, text thumbnails); and a contract, proved at every stage, that rendering never changes play.
10. **Agent-native operation:** AGENTS.md rules paired with checks; Claude Code hooks and a verifier; `window.__engine`, the same headless; errors and advice that name the fix in API terms; and an escalation log, so no decision is lost and no run stalls. More tooling (MCP, a gallery, scaffolds for every kind) arrives on demand.

---

## 2. Goals, non-goals and the scope rule

**The owner's intent.** "This game engine is intended to allow for agents to as easily as possible, produce reliable quality, consistency, token efficient output, while allowing us to develop tools that we can reuse to aid in development."

**Goals**
- **G1. Build the engine around the Stress Box.** Each stage adds engine systems, not game content, and ends with a box that runs, is measured and is proved.
- **G2. Get the foundation right first:** the layers, reproducibility, the data model, the tooling and the tests. Gate G7 marks it.
- **G3. Bring over what would be costly to rebuild, when the box, the animation library or audio (Phases 8–9) needs it, or an on-demand WP does:**
  - the 3D world's working techniques;
  - the animation system, with its moves, poses, procedural rigs and secondary motion;
  - the procedural textures;
  - the motion-clip library with its catalogs, ledger, provenance and toolchain (Phase 8);
  - the sound data and synth design (Phase 9);
  - the agent practices.
- **G4. Improve everything that carries over** (§7). Nothing moves across just because it exists.
- **G5. Make every capability agent-readable, agent-operable and verifiable without a display** (§3).
- **G6. Leave the engine ready for a separate game.** Games use its public API and extend it through registries, events and scenes. They never edit the internals, and never need to read them.

**Non-goals**
- **No game.** Emberdeep (`src/emberdeep/`) does not come over in any form, and it is not to be remade (§5.7). The Stress Box is a test scene: its monsters, waves and numbers are sample content in `labs/box/`. The Playground (Phase 13) is a test site in the same way: its house, cast and numbers are sample content in `labs/playground/`.
- **No copy of the stress test's behaviour or feel.** "Similar" means the same job: a hall, a hero, a crowd, physics, combat, cameras and looks, measured.
- **No 2D engine.** Pixel-art world rendering, the depth-sorted 2D renderer, the 2D views, TileMap and PlatformMap drawing, the genre starter kits, the 2D agent edition and Card mode do not come over.
- **No GUI-only feature** (doctrine: Agent-operable). Pages and panels exist so that anyone watching can see the work; each is a view over a machine interface.
- **No WebGL 2 renderer** (doctrine: WebGPU only). This supersedes the original goal of WebGL 2 compatibility. Whether players without WebGPU are served is a production question for Phase H.
- **Nothing in anticipation** (doctrine: North Star). Expansions, extra tooling and advanced GPU features wait for a measured trigger (§9.1); the Playground (Phase 13, ADR-0025) is the consumer that fires them.
- **No binary assets without the owner's approval** (doctrine: Assets). Fonts are pre-approved.
- **No hardening before production** (doctrines: Reproducible, Discovery first): no Firefox, Safari or phone test runs, no cross-platform determinism, no release machinery. Phase H lists them for later. The owner made two exceptions (ADR-0021): touch controls (WP 3.12) and a Vercel deployment of every push (WP 0.12) come early, and neither is tested. A failed Vercel build is fixed when it shows; any other problem with them, when the owner reports it.

**The scope rule for the game.** Emberdeep grew technology any game needs: registries with schemas, an event bus, a body contract and rig checks, procedural creature rigs, a tuning registry, a developer sandbox, an autopilot, a gallery and a performance governor. The plan rebuilds these **generically, with new minimal fixtures**, when the box, Phases 8–9 or an on-demand WP needs them. It never copies game content. §5.6 lists them; §5.7 is the exclusion list.

---

## 3. The doctrine, made enforceable

A rule without a check is only a suggestion. Each principle of `DOCTRINE.md` comes with the rules this plan derives from it and the mechanism that enforces them. The mechanisms ship in Phase 0 unless noted.

**Principles are cited by name, never by number,** so a renumbered doctrine costs nothing. The short names are: **Agent-readable**, **Agent-operable**, **Verifiable** (without a display), **Assets** (agent-accessible), **Reproducible** (on the development platform), **WebGPU only**, **Common ground**, **Quality under the hood**, **Mastery** (over novelty) and **Discovery first**. The P-labels below follow the doctrine's current order.

| Principle | Rules | Enforced by |
|---|---|---|
| **How to read this.** Judgment of a trusted manager; deviations are escalated with their reasoning. | <ul><li>Agents decide what the doctrine and this plan leave open, and record the call as an ADR amendment (§11.4).</li><li>When going against the doctrine looks best, the agent escalates with its reasoning (§8.14) instead of quietly deviating.</li></ul> | The `verifier` checks that every deviation has an escalation record or an owner's call in an ADR (ADR-0021); `docs/escalations/` |
| **North Star.** The best expected overall output, not flawless software; problems solved when they surface. | <ul><li>The roadmap's core path is what the Stress Box and the doctrine need. Everything else is **on demand**: a WP that starts only when its trigger is measured, and records the measurement (§9.1).</li><li>The plan's answers to problems the prototype already hit or the probes measured (pipeline stalls, the instancing quirks, re-warms after filter toggles, crowd physics cost, `Math` differences between runtimes) are not anticipation; they ship with the stage that meets them.</li><li>Ceremony scales with risk: the `verifier` reviews L-size WPs and every gate; S and M WPs rely on their Verify commands.</li></ul> | The roadmap (§9); the ledger's notes record each trigger |
| **P1. Agent-readable.** Code, data and structure are optimized for agent comprehension over conventions that serve only humans. | <ul><li>One concept per file, named for what it does. No one-letter names outside tiny scopes.</li><li>Soft cap of 400 lines per file, hard cap 600. Prettier formats every code, data and generated file (print width 120; hand-written prose is exempt, ADR-0014).</li><li>Every module opens with a **JSDoc file comment** (`@file`: purpose, invariants, an example, see also) of 40 lines or fewer, and every export carries its own doc comment (§6.8).</li><li>Strict TypeScript in the style agents know best: ES modules, extensionless imports, no enums or namespaces (`erasableSyntaxOnly`).</li><li>Docs are generated from the comments (INDEX, API, ERRORS) and never written twice.</li><li>No minified or generated code in the repository; dependencies stay in `node_modules`.</li><li>Content is data: levels, materials, props, bodies and clips are readable text.</li></ul> | `npm run check`: `tsc`, ESLint (`jsdoc/require-file-overview`, `max-lines`), Prettier. `node x docs --check` |
| **P2. Agent-operable.** Every capability has a machine interface; nothing requires a GUI unless there is no other option. | <ul><li>Every capability is reachable through an npm script, a `node x` command or an `__engine` member.</li><li>Every `x` command prints at most about 20 lines, writes a `report.json` with a fixed schema, and exits 0, 1 or 2. The standard tools are configured for short terminal output plus a JSON report under `out/`.</li><li>Every setting comes from one schema: `x set`, URL parameters and `__engine.set` (a panel, if any, is generated from it).</li><li>Registries are discoverable through `x describe` and `__engine.describe()`.</li><li>Errors and advice carry stable codes that name the fix.</li></ul> | <ul><li>Every `x` command has a smoke test.</li><li>`x docs --check` compares `help()` with the real API.</li><li>A test enforces that every setting is reachable through `x set` and `__engine.set`.</li><li>The `verifier` rejects any feature reachable only through a page.</li></ul> |
| **P3. Verifiable without a display.** | <ul><li>The sim runs headless in Node: Vitest, `x sim`, `x replay`.</li><li>Every visual feature has numeric checks: the ID pass, look metrics and text thumbnails. HTML/CSS UI is checked through DOM queries. Images are optional and made on demand.</li><li>Browser tests run in headless Chromium through Playwright Test, on WebGPU (SwiftShader).</li><li>Each feature lands with the cheapest test that proves it: a Vitest unit test, then a replay hash, then Playwright numbers, then an image.</li><li>**The owner's exceptions** (ADR-0021): the touch controls (WP 3.12) and the Vercel deployment (WP 0.12) are not tested.</li><li>Unit tests are selected through Vite's module graph (`vitest --changed`, `vitest related`).</li></ul> | The test tiers with time budgets (§8.2); replay suites; `node x ci --local` |
| **P4. Agent-accessible assets.** Procedural first, then text and data, then binary with approval. | <ul><li>Generators are pure functions of `(params, seed)`.</li><li>Text and data (clips, catalogs, levels, sound definitions) record their source and license.</li><li>**Binary files only with the owner's approval**, each listed in `data/APPROVED-BINARIES.json` with its escalation record. Fonts (WOFF2, TTF, OTF) are pre-approved under `data/fonts/`, each with its license.</li><li>Importer inputs (GLB, AMC, BVH) live only in the git-ignored `.cache/`.</li><li>Golden references are numbers and text thumbnails, never committed images, so Playwright's screenshot snapshots are not used.</li><li>Dependencies in `node_modules`, Rapier's inlined WASM included, are code, not source assets (ADR-0019).</li></ul> | `node x check`, the asset scan: extensions, magic bytes, and base64 runs or `data:` URIs over 1 KB, outside the approved list. The importers refuse to write outside `.cache/` and `data/` |
| **P5. Reproducible on the development platform.** | <ul><li>A fixed 60 Hz step; everything from outside arrives as recorded intents.</li><li>Seeded, named RNG streams; an ordered world.</li><li>**Deterministic math under the hood:** while the sim steps, the engine swaps in fdlibm ports of the transcendental `Math` functions, so Node and Chromium agree bit for bit. Game code still writes `Math.sin` (§6.5).</li><li>**One golden hash per replay**, valid in Node and in the browser.</li><li>Capture and restore cover the whole sim, Rapier and the RNG streams included, and a restore continues exactly like the uninterrupted run (Rapier 0.21, §4.7).</li><li>Replays with bisection.</li></ul> | ESLint's sim-side bans (Appendix B); replay suites in Node and in Chromium; capture and restore tests (§6.5) |
| **P6. WebGPU only.** WebGPU is the only renderer; gameplay runs only on the CPU; game UI in HTML/CSS is allowed. | <ul><li>The engine requires WebGPU and refuses to start without it, with a coded error. three.js's automatic WebGL 2 fallback is switched off.</li><li>Rendering may use everything WebGPU offers, compute and storage included, for looks and speed. Optional adapter features (`timestamp-query`, `float32-filterable`…) are checked, and every downgrade logs an advice code.</li><li>Sim-side code never imports `gfx/`, three.js's renderer or scene classes, the DOM or Web Audio. Nothing is read back from the GPU into the sim.</li><li>Game UI is HTML/CSS over the canvas (§6.7).</li><li>The browser is the target now; a native WebGPU implementation (Dawn or wgpu on Vulkan) waits for Phase H.</li></ul> | <ul><li>ESLint's layer rules (`no-restricted-imports`, one block per layer).</li><li>`tests/e2e/parity.spec.ts`: a replay gives its golden hashes while the page renders; live play recorded in the page replays in Node to the same hashes.</li><li>Toggling any visual feature never changes the hash.</li><li>The startup test: no WebGPU, no engine.</li></ul> |
| **P7. Common ground.** Everything agents work with when building games is widely used; established approaches over cutting-edge performance. | <ul><li>**What game agents touch** is common ground: the toolchain (npm, TypeScript, Vite, Vitest, Playwright Test, ESLint, Prettier, tsx; §6.10), the engine's public API, its data formats (JSON, TSV, Markdown), HTML/CSS UI, and the `x` commands.</li><li>The public API speaks in familiar terms: plain objects and functions, three.js's math classes, registries of data, events, systems in a fixed order (no ECS framework, Q13), and material and clip definitions with the parameters agents know from three.js.</li><li>Bespoke game-facing tools only where nothing established fits; ADR-0019 lists them with the reason.</li></ul> | The `verifier` asks of every public API "would a game agent recognize this?"; ADR-0019; `node x deps --check` (every dependency is listed with its reason) |
| **P8. Quality under the hood.** Internals use the highest-quality approach their builder can execute well; the complexity stays behind the API. | <ul><li>**Internals** are code whose API does not appear in game code: the renderer's passes and materials, the instancing service, the physics adapter, the animation solver, deterministic math, capture, the tools' insides. They use what works best: TSL and compute where they look or run better, Rapier's SIMD build, newer releases where they measurably help (doctrine: Mastery).</li><li>**The public API is a boundary.** Game code (the box's scenes and cast, fixtures, future games) imports only the barrels `engine/index.ts` (pages) and `engine/sim-api.ts` (sim-side code).</li><li>**Game agents never need to read the internals,** even when something goes wrong: every error and advice code names the fix in API terms, `docs/API.md` is complete, and the inspector and `x` commands explain state without opening engine code. Internals stay agent-readable (doctrine: Agent-readable) for the agents who maintain the engine.</li><li>Reuse what others built well (three.js, Rapier, stdlib's math), and invest in what is ours.</li></ul> | ESLint's public-API rule for game code; `x docs --check` (every public export documented, every error code with a fix); the `verifier` |
| **P9. Mastery over novelty.** | <ul><li>Each dependency is pinned to the newest release that is backward compatible with its newest **qualifying** release (one at least 12 months old), and that release is **adopted immediately** (§6.10). A line that is not backward compatible waits until it qualifies, then arrives as an upgrade work package.</li><li>**Internals may go newer** when a newer release measurably raises quality and the builder can use it well: today three.js r182 and Rapier 0.21 (§4.7). `tools/deps.json` records the measurement.</li><li>Game-facing code writes the qualifying releases' idioms; features newer than that wait until they qualify, unless an ADR says otherwise.</li><li>The platform follows the same rule: Node's newest qualifying LTS line (24) is installed for each session until the environment provides it (§6.10).</li><li>Pinned knowledge: the pinned packages' own sources and types in `node_modules`, `docs/THREE-DELTA.md`, and the TSL guide as it stood for the pinned three.js.</li></ul> | `node x deps --check` (offline: the pins match `tools/deps.json`, each with its rule and reason); `node x deps --update` at the start of every WP adopts compatible releases; `node x deps --qualify` at every gate lists upgrades that qualify |
| **P10. Discovery first, hardening later.** One target platform: the development environment's. | <ul><li>Development and tests target the development platform: the Linux cloud container, Node 24, and the container's headless Chromium 141 with WebGPU on SwiftShader, driven by Playwright Test.</li><li>Prefer the smallest change that proves an idea in the box. Tuning and polish wait.</li><li>Phase H (other browsers, testing on phones, a native build, releases, cross-platform determinism) is not scheduled until a game goes to production.</li><li>**The owner's exceptions** (ADR-0021): touch controls (WP 3.12) and a Vercel deployment of every push (WP 0.12) exist now, and are not tested. A failed Vercel build is fixed when it shows; anything else about them, only when the owner reports it.</li></ul> | The roadmap (§9); the `verifier` flags production-hardening work outside Phase H, except ADR-0021's |
| **Escalation.** | <ul><li>Escalate when an action needs the owner's approval (a binary asset other than a font; a new runtime dependency, or any dependency outside the rule of §6.10; a repository setting, secret, deploy or other outward action, apart from the pushes, stage PRs, merges, branch deletions and Vercel deployments that ADR-0021 pre-approves; rewriting published history), when a principle cannot be satisfied, or when going against the doctrine looks best.</li><li>Wait up to 15 minutes. With no answer: commit the current work, make the call, continue. For the rest of that run, or until the owner answers, report further conflicts without stopping.</li><li>**Never perform the action while waiting.** Take the doctrine's preferred alternative meanwhile (procedural or text instead of binary; a stub behind the API).</li><li>Record every escalation, every later conflict, and every call made without an answer.</li></ul> | `node x esc` and `docs/escalations/` (§8.14); the Stop hook warns about an open escalation past its deadline with no recorded call; the ledger links each escalation |

**Terms used throughout:**
- **Sim-side** means reproducible and renderer-free: `core`, `sim`, `physics`, `anim`, `world` (logic), input intents and replay, the audio DSP, the bot (`engine/dev/bot.ts`), the box's scenes and cast (`labs/box/scenes/`, `labs/box/cast/`) and the fixture scenes (`fixtures/scenes/`).
- **Presentation** means everything that draws or plays: `gfx`, the audio runtime, `ui`, and the input devices.
- **View state** is presentation-only state, such as cape chains, particle positions and camera shake. It may be reproducible for tests, but it is never part of the gameplay hash.
- **Game code** is code written the way a game would be: the box's scenes, cast and pages, the fixture scenes, and the future game. It sees only the public API (doctrine: Quality under the hood).
- **The development platform** is the Linux x64 cloud container, with Node 24.22.1 (the newest 24.x LTS; `scripts/setup.sh` installs it while the container ships Node 22.22.0) and the preinstalled Chromium 141.0.7390.37 with WebGPU on SwiftShader, driven by Playwright Test 1.64.1. Golden hashes are recorded for it, and hold in both its runtimes.

---

## 4. What we found in my-3d2dge

Eight parallel deep-dives read the source in full. Where possible they ran it: builds, the lab tests, Node probes, and a re-run of the CMU import. For the re-base on the Stress Box and the doctrine, the prototype's own stress-world test was also run against three.js r180, r181.2, r182, r184.0 and r186.1, and the platform was measured (§4.7). The numbers are collected in Appendix D.

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
  - A probable instancing bug in the `'center'` outline mode: the push direction comes from `positionLocal`, which already holds the instance-transformed position. r180 does the same as r182 (verified in its `InstanceNode`).
  - The height "boost" of the classic views was dropped.

**What the Stress Box takes from it.** The techniques: the level-as-text compiler, the crowd-on-bodies pattern, the controller config, instanced batches with their workarounds, the warm-up discipline, the light budget idea, the filters, the cameras and camera links, and the test harness's checks (shardfall's flags replace its SwiftShader flags, stand-in canvas and readback, §8.8). It rewrites the structure: real modules, a sim that runs in Node, a true fixed step, data instead of code for levels and bodies, and one inspector API.

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
- the pixel font's compact encoding, as a reference for a pixel look (UI text is HTML/CSS now, §5.4);
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

**Versions (doctrine: Mastery).** A release *qualifies* when it is at least 12 months old: released on or before 2025-10-09. The pin is the newest release that is **backward compatible** with the newest qualifying one, adopted immediately: by semver, the newest release in the same major for packages at 1.0 or later, and the newest patch in the same minor for 0.x packages. **Engine internals** may use a newer release when it measurably raises quality and the builder can use it well (doctrine: Quality under the hood); the rows marked *internals* do. Dates are from the npm registry and nodejs.org.

| Dependency | Newest qualifying release | Pin, adopted now | Why | Next line, and the date it qualifies |
|---|---|---|---|---|
| three | r180.0 (2025-09-03) | `0.182.0` (2025-12-10), *internals* | The prototype's own release: its full stress test passes on r182, while r180 draws the WebGPU post filters black (below). Game code meets three.js only through the barrels' re-exports (its math classes, `AnimationClip` and `AnimationMixer`) and material parameters as data. Against r180, r182 changes none of those APIs: it reimplements `Quaternion.slerp` (now clamping t to [0, 1]), makes four `Matrix4` methods safe on degenerate matrices, and changes only the animation classes' logging (a diff of the sources). So agents' knowledge still applies | r183.0 (2026-02-18) on 2027-02-18, or earlier through the internals rule once measured. r186 fails on the platform's Chromium (below) |
| `@types/three` | 0.180.0 (2025-09-03) | `0.182.0` | Matches three | Follows three |
| Rapier (`@dimforge/rapier3d-simd-compat`) | 0.19.1 (2025-10-03) | `0.21.0` (2026-09-25), *internals* | Restores continue exactly, where 0.19.3 drifts; 9–16% faster than 0.19.3 SIMD; the character controller's snap-to-ground fixed (below). Only the engine's physics adapter sees its API | None yet |
| stdlib's math (`@stdlib/math-base-special-sin`, `-cos`, `-pow`…) | 0.3.0 (2024-07-28) | `0.3.1` (2026-02-08), *internals* | A patch of the 0.3 line. Pure-JS fdlibm ports, the same in every runtime (below); about 250,000 downloads a week | None yet |
| TypeScript | 5.9.3 (2025-09-30) | `5.9.3` | The newest 5.x | 6.0 (2026-03-23) on 2027-03-23 |
| Vite | 7.1.9 (2025-10-03) | `7.3.7` (2026-10-06) | The newest 7.x | 8.0.0 (2026-03-12) on 2027-03-12 |
| Vitest | 3.2.4 (2025-06-17) | `3.2.7` (2026-07-06) | The newest 3.x | 4.0.0 (2025-10-22) on 2026-10-22 |
| `@playwright/test` | 1.56.0 (2025-10-06) | `1.64.1` (2026-10-14) | The newest 1.x. It drives the container's Chromium 141 (below) | None yet |
| ESLint, `@eslint/js` | 9.37.0 (2025-10-03) | `9.39.5` (2026-07-10) | The newest 9.x | 10.0.0 (2026-02-06) on 2027-02-06 |
| `typescript-eslint` | 8.46.0 (2025-10-06) | `8.71.1` (2026-10-05) | The newest 8.x; its peer range admits TypeScript 5.9 | None yet |
| `eslint-plugin-jsdoc` | 61.1.0 (2025-10-09) | `61.7.1` (2026-01-08) | The newest 61.x | 62.0.0 (2026-01-09) on 2027-01-09 |
| `globals` | 16.4.0 (2025-09-09) | `16.5.0` (2025-11-01) | The newest 16.x | 17.0.0 (2026-01-01) on 2027-01-01 |
| Prettier | 3.6.2 (2025-06-27) | `3.9.9` (2026-09-23) | The newest 3.x | None yet |
| tsx | 4.20.6 (2025-09-26) | `4.23.15` (2026-09-20) | The newest 4.x | None yet |
| Node | 24.10.0 (2025-10-08) | `24.22.1` (2026-10-20), LTS | The newest 24.x. The container ships 22.22.0, so `scripts/setup.sh` installs it (§6.10) | Node 26 LTS on 2027-05-05. Node 25 qualifies on 2026-10-15 but is already end-of-life (odd lines never get LTS), so it is skipped |
| `@types/node` | 24.7.1 (2025-10-09) | `24.19.2` (2026-10-09) | Matches Node 24 | Follows Node |
| Chromium | — | 141.0.7390.37, the container's (`chromium-1194`) | The platform's browser (doctrine: Discovery first) | Changes when the environment does |

**three.js releases on the platform.** The prototype's `tools/stress-world-test.mjs` (both of its backends, every camera and filter, a fight, the stairs, a crate) was run in a scratch copy with only the import map changed:

| three.js | Result |
|---|---|
| r180 | Everything passes **except the WebGPU post filters**, whose frames are solid black `(0,0,0,255)`. With the MRT mask removed from the post graph they draw again, so r180's MRT path is what fails |
| r181.2 | Worse: WebGPU pipeline validation errors ("Color target has no corresponding fragment stage output…") for materials without the mask output |
| r182 (as shipped) | **Passes everything.** Proof hash `68e1f7d1`; 3 min 11 s |
| r184.0 | Passes everything except one check of the prototype's card mode, a sprite crowd this plan drops: a second card atlas page builds 1 extra pipeline. The WebGPU filters draw |
| r186.1 | **Fails on WebGPU at startup:** "Failed to execute 'createView' on 'GPUTexture': … 'swizzle' … is not of type 'GPUTextureComponentSwizzle'". r186 uses a WebGPU texture-view feature that Chromium 141 does not have |

The gameplay hash is `68e1f7d1` on every release that runs, as it should be: the sim never touched the renderer. One physics check ("the hero's jump rose 0.0 units") failed on WebGPU in two runs of r180 and passed in others; it follows from the prototype's variable-step live loop, not from three.js.

**So the engine runs on r182** (doctrine: Quality under the hood). It is the newest release that measurably raises quality on this platform: the prototype's code, written for r182, works there unchanged, and r181–r182 bring better PBR, PMREM and WebGPU fixes. Agents know it well, and since r181 its API documentation is generated from JSDoc and covers WebGPU and TSL. r184 adds little the box needs yet, and r186 does not run here. Each later release is still checked against its migration notes (`three.js.wiki`, Migration Guide):
- **r183:** renames `PostProcessing` to `RenderPipeline` (the old name still works, with a warning); deprecates `Clock`; improves WebGPU shadows; changes `RoomEnvironment`.
- **r184–r186:** rotate environment maps, change premultiplied alpha, stop `positionLocal` from following skinning, make `updateWorldMatrix()` honour `matrixWorldNeedsUpdate`, rename `Source` to `TextureSource`, replace `TiledLighting` with `ClusteredLighting`, and remove `PCFSoftShadowMap` from WebGPU.

**Rapier, measured.** A crowd of capsules steered toward a centre (contacts everywhere), on Node 24; step time is the mean of steps 60–180, and the drift is the largest distance between a run and its own restore 120 steps after the snapshot:

| Build | 1,000 bodies | 5,000 bodies | Restore drift |
|---|---|---|---|
| 0.19.3 `compat` | 7.5 ms | 28.0 ms | 6.7–13 cm |
| 0.19.3 SIMD (the prototype's) | 5.1 ms | 24.1 ms | 5.2–7.9 cm |
| 0.21.0 `compat` | 6.8 ms | 29.2 ms | **0** |
| 0.21.0 SIMD | **4.3 ms** | **22.1 ms** | **0** |

- **0.21 restores exactly**, in Node and in Chromium: 40 stacked crates restored at step 1 continue identically too (0.19.3 SIMD drifted 4.1 cm there), and two runtimes give the same hash (`8942d209`). So a capture needs no workaround (§6.5).
- Its API is 0.19's, plus optional `target` parameters and joint motors. It removes `IntegrationParameters.minIslandSize`, fixes the controller's snap-to-ground, and speeds up the 3D solver. Its controller reports world-space contact points and normals, as 0.19.3's does (§4.8). The package doubles in size: 4.62 MB (1.66 MB gzipped).

**Deterministic math, measured.** stdlib's pure-JS fdlibm ports (`sin`, `cos`, `pow`) hash identically on 200,000 seeded inputs in Node 22, Node 24 and Chromium 141, at about twice the cost of V8's native `Math.sin` (28 ns against 14 ns per call). Two test sims, each run on all three runtimes:
- a JavaScript sim keeping float64 state (1,000 phases fed back through `sin` and `cos` for 600 steps) ends with **different hashes in Node and Chromium** under native `Math` (`8f73787d` against `e6e972cf`), and the **same hash everywhere** (`604db7be`) when the fdlibm ports are swapped into `Math` only while the sim steps;
- 150 Rapier bodies steered with `sin`, `cos` and three.js's `Quaternion` end the same in every runtime even under native `Math`, because Rapier stores its state as float32, which absorbs last-bit differences.

So the engine swaps the ports in while the sim steps (§6.5): gameplay state is bit-identical in Node and Chromium, and game code keeps writing `Math.sin`.

**r182's API, as agents will meet it:**
- `PostProcessing` is the post-processing class; `RenderPipeline` (r183), `DynamicLighting`, `ClusteredLighting` and `TextureSource` are **not** exported. `Timer`, `TWO_PI` and `PassNode.setResolutionScale()` exist.
- Addons include `BloomNode`, `FXAANode`, `SMAANode`, `OutlineNode`, `GTAONode`, `SSRNode`, `SSGINode`, `TRAANode`, `DenoiseNode`, `CSMShadowNode` and `TiledLighting` (WebGPU compute). `GodraysNode` does not exist yet.
- r182 warns on about 40 deprecated names, from `renderAsync()` and the other async render methods to TSL's `atan2`, `append` and `viewportResolution`. Appendix B lists them with their replacements.
- `InstanceNode` uses a uniform buffer up to 1,000 instances and an attribute beyond. The prototype lost dynamic-usage updates above 1,000 instances on r182 (`LAB-3D.md:196`), so the instancing service keeps `StaticDrawUsage` with update ranges.
- The npm package carries r182's source with its JSDoc comments (`node_modules/three/src/`), which agents can read and grep. The TSL wiki page as it stood for r182 is its last revision before r183: `6153b39` (2025-12-22). The next revision, after r183, already uses `RenderPipeline`.
- TypeScript 5.9.3 type-checks `three/webgpu`, `three/tsl` and Rapier with `moduleResolution: bundler`. Under `nodenext` plus `skipLibCheck`, Rapier 0.19.3's types silently became `any` (its `.d.ts` files import `./exports` without an extension); 0.21's stay real under both. On the pins, every package's declaration files check clean even without `skipLibCheck`, which only saves time: 2.0 s against 5.9 s for the probe.

**The standard toolchain on the platform (doctrine: Common ground).** A scratch project, first on r180 and Rapier 0.19.3, then again on the pins above (three 0.182.0 with `@types/three` 0.182.0, Rapier SIMD 0.21.0, Node 24.21.0):
- `tsc --noEmit` is clean. Vitest runs a test that steps Rapier and uses three.js's math classes (imported from `three/webgpu`) in Node in 0.9 s. A path filter that matches nothing exits 1. `vitest related <file>` and `vitest run --changed` select tests through Vite's module graph; a change to page-only code selects none, because the browser suites cover it.
- **`node x <cmd>`.** A three-line `x.js` that registers tsx and imports `tools/x.ts` runs TypeScript CLI code importing engine modules with extensionless paths: `node x sim` takes 0.7 s, Rapier's initialization included, on Node 22 and Node 24.
- **Playwright Test** against the Vite dev server renders a lit cube on WebGPU through the prototype's stand-in canvas, and the page's sim hash equals Node's.
- **On the pins, WebGPU only.** `tsc` is clean, and a `// @ts-expect-error` on `world.createRigidBody(123)` proves Rapier 0.21's types are real. The page asks for a WebGPU adapter before it creates the renderer, then draws a `MeshStandardMaterial` cube with `render()`, directly and through one `PostProcessing` pass, without a single warning. Rapier 0.21's `init()` prints none either (0.19.3's printed one). Launched without the WebGPU flags, Chromium 141 still has `navigator.gpu`, but `requestAdapter()` returns `null`, and the page refuses to start with `GFX_NO_WEBGPU`.
- **SwiftShader's adapter offers** `timestamp-query`, `float32-filterable`, `float32-blendable`, `subgroups`, `indirect-first-instance`, `clip-distances`, `texture-component-swizzle` and the BC, ETC2 and ASTC texture formats, among others. Timings it reports are those of a CPU emulating a GPU.
- **Playwright 1.64.1 drives the container's Chromium 141** through `launchOptions.executablePath` (`/opt/pw-browsers/chromium`), the route the environment documents for a newer Playwright, and passes the same tests with the same frames.
- **A first page load can reload once.** When Vite meets a dependency it has not pre-bundled, it re-optimizes and reloads the page, which failed a probe test once. Listing the runtime dependencies in `optimizeDeps.include` prevents it.
- **Errors keep their lines.** A thrown error's stack in a Vite-served `.ts` module names the right line. The e2e fixture still maps page-error stacks through Vite's inline source maps, for the general case.
- **ESLint's stock rules carry the bans:** `no-restricted-imports` (with `allowImportNames`, so `core/math` can re-export three.js's math classes and nothing else), `no-restricted-properties` (`Math.random`), `no-restricted-globals` (`Date`, `performance`), `no-restricted-globals` (`Date`) and `jsdoc/require-file-overview`, each message naming the fix.
- `vite build` builds the page in about 3 s.
- **Node 24.21.0 runs all of it.** Its npm (11.19) still runs a dependency's install script that `package.json`'s `allowScripts` does not mention, with a warning, and skips one that it denies. esbuild's postinstall is the only install script that runs on the platform, and Vite works without it.

**V8's `Math` differs between Node and Chromium** (the reason for the swap above). Hashing 200,000 seeded results for each of 17 functions:
- Node 22 against Chromium 141: `sin`, `cos` and `pow` differ. Over 100,000 inputs, 3.46% of `Math.sin` results, 3.35% of `Math.cos` and 9.99% of `Math.pow` differ, each by 1 ulp.
- Node 24.21.0 against Chromium 141: only `sin` and `cos` differ. `pow` now agrees, so Node 24 and Node 22 differ on `pow`.
- `tan`, `atan`, `atan2`, `asin`, `acos`, `exp`, `expm1`, `log`, `log2`, `sinh`, `tanh`, `hypot`, `cbrt` and `sqrt` match everywhere.

**Snapshots at crowd scale.** At 5,000 capsules, Rapier 0.19.3's `takeSnapshot` takes 7.8 ms and `restoreSnapshot` 22.6 ms, for 5.72 MB. Captures are rare (a save, a test), so this is affordable.

### 4.8 What shardfall offers (2026-10-10)

**What it is.** [`michaelcrosato/shardfall`](https://github.com/michaelcrosato/shardfall) (commit `fa2dab6`, 2026-10-09) is the owner's sibling project: an engine written in Rust on wgpu, a hack-and-slash game built on it, and a pavilion of demo rooms. It follows the identical doctrine, adopted partway through, so some older code doesn't fit. It has about 61,000 lines of Rust in six crates, rooms and game data in TOML, and a motion library in my-3d2dge's readable format. It deploys to Vercel as WebAssembly on the browser's WebGPU, and it has touch controls, checked only under phone emulation at device-pixel ratio 1, never on a real phone. Five reviewers read it for this plan, and §5.8 lists what comes over and how. Its code is Rust, so what comes over is designs, tuned numbers, WGSL shaders (usable from TSL through `wgslFn`) and data.

**Measured here because of it** (Node 24, Chromium 141, three.js r182, Rapier 0.21; throwaway probes):
- **Headless WebGPU can present to a real canvas.**
  - With shardfall's flags (`--enable-unsafe-webgpu --enable-features=Vulkan --use-vulkan=swiftshader --use-angle=swiftshader`), a page rendered 30 frames to its own canvas without an error, and a screenshot of the canvas shows the lit cube. The adapter was still SwiftShader, with the same 19 features.
  - With the flags this plan used before, and without the prototype's stand-in canvas, the device is lost at the first frame. The stand-in is no longer needed (§8.8).
- **r182's readback keeps the row padding.** `copyTextureToBuffer` aligns each row to 256 bytes and returns the padded buffer (`WebGPUTextureUtils.js:601-602`), so a 48-pixel-wide read comes back in 64-pixel rows. Shardfall strips the padding on capture, and `shot()` must too (WP 2.6).
- **r182's own addons expect MRT.**
  - `PixelationPassNode` creates its own MRT (colour plus `normalView`). `SSRNode` needs a normals texture and has no depth fallback; `GTAONode` can rebuild normals from depth.
  - Shardfall sets up one MRT at startup and gates every filter with a uniform, so toggling a filter never recompiles anything. That replaces this plan's separate mask pass (§6.7).
- **r182's scene graph builds in Node.** With no GPU, Node builds, traverses and bounds:
  - meshes with classic and node materials;
  - a 2,000-instance batch;
  - a skinned mesh.

  So `scene.dump()` and view logic can be tested in T1 (§8.3).
- **Rapier, as agents write it.**
  - Typical Rapier code written from memory fails type-checking in the same four places on 0.19.3 and on 0.21.0: `toi` where ray hits name it `timeOfImpact` (twice), `castShape`'s `targetDistance` argument, and `toi` where shape-cast hits name it `time_of_impact`. Controller collisions do call it `toi`. It runs once the compiler's hints are applied.
  - The controller reports identical, world-space contact points and normals in both versions.
  - 0.21 adds no API trap of its own; losing all sideways motion, below, is new in 0.21.
- **The controller drops sideways motion on level ground.** Shardfall found it on a one-block floor, not at seams (`docs/HISTORY.md:279-286`; `crates/pav_core/src/character.rs:1000-1003`).
  - Walking across a floor made of several boxes, 0.21's controller loses all horizontal motion on 1–8 of 600 ticks for normal downward pushes. 0.19.3 never loses all of it; its worst tick keeps 81%.
  - Shardfall hit the same bug in Rust Rapier, and moves across first, then down. With that split, walking with the usual small downward push (0.01 m per tick) keeps at least 95% of its motion on every tick, against 5 lost ticks without it. WP 3.2 builds the split in.
- **Autostep climbs about 5 cm above its setting.** With a 0.281 m capsule:
  - a 0.25 m autostep climbs a 0.30 m step and refuses 0.35 m;
  - a 0.30 m autostep climbs 0.35 m.

  The capsule's rounded bottom rides over the rest (WP 3.2).
- **A Vite build needs no WebAssembly setup.** Rapier 0.21 passes its WASM to `init()` inline, as base64, and never fetches its `.wasm` file. So `vite build` of a page with three.js r182, a TSL post pass and Rapier emits one HTML page and one 5.4 MB script (1.86 MB gzipped), and no `.wasm` file: a static host such as Vercel needs no MIME header. Served by `vite preview`, the probe's WebGPU spec passed with the dev server's sim hash (WP 0.12).

**Where shardfall chose differently, and this plan keeps its own:**
- **Reproducibility.** Shardfall promises matching replays only on the machine that recorded them (Rapier's enhanced determinism off, native maths). This plan's sim runs the same Rapier WASM in Node and Chromium with the fdlibm swap, so one golden holds in both (§6.5).
- **Hit-stop.** Shardfall shrinks the physics step to 6%. This plan slows the clock and keeps the step fixed, so the integration parameters stay pinned (WP 1.3).
- **UI.** Shardfall's egui HUD and windows stayed invisible to its tools. This plan's HTML/CSS UI is read through the DOM (§6.7).
- **Crowds.** Shardfall runs the full character controller on every monster and uses no collision groups; its stress room holds about 600 dynamic bodies at about 600 ticks a second (`docs/HISTORY.md:837-838`). This plan's crowd is dynamic bodies with collision groups, for 5,000 (WP 5.1).
- **Visual checks.** Shardfall judged captures by eye. This plan's are numbers: the ID pass, look metrics and thumbnails (§8.5).

**Lessons from its journal** (`docs/HISTORY.md`) that this plan takes:
- **Hash what you capture.** A hash of positions alone let a replay "match" while the gold and the RNG had diverged (§6.5).
- **Record settings changed mid-run.** Shardfall's replays keep settings only as they stand at save time, or none, so a mid-run change does not replay (§8.4).
- **Fresh-agent dry runs found friction the authors had missed.** A 25-minute run listed 13 friction points, and a smaller model's bot could not finish its own level (G3, G7).
- **Unknown arguments must fail.** Shardfall's main tools ignore them silently (§8.1).
- **Keep the startup read small.** A one-page `PROGRESS.md` and a journal that is searched rather than read cut each session's reading from 150 KB to 40 KB (WP 0.6).
- **Content as data lets helper agents extend the engine.** Helpers built 27 rooms from briefs, each checked by a headless run (§11.3).
- **What the owner sees gets fixed.** Shardfall's owner ruled that a problem the user can see is fixed at once (`AGENTS.md:15-17`). Its touch controls came earlier, when its browser build did not respond on a phone (`docs/HISTORY.md:48-51`). Here the owner asked for them directly, without tests: a problem with them is fixed when the owner reports it (ADR-0021).

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
| Renderer bootstrap: `WebGPURenderer`, `forceWebGL`, backend label | `stress-world/00-setup.js:67-71`, `lab3d/00-setup.js` | PORT. Await `init()` once; require WebGPU, with no WebGL 2 fallback (doctrine: WebGPU only); report the adapter's features and limits | `engine/gfx/renderer.ts` | 2.1 |
| Fixed-step loop | Good: `lab3d/60-panel.js:143-152` (60 Hz, 6-step cap). Bad: `stress-world/50-frame.js:83` (variable substeps) | PORT lab3d's design as an accumulator with interpolation | `engine/core/time.ts`, `engine/app/loop.ts` | 1.3, 2.7 |
| State hash | `stress-world/00-setup.js:59` (FNV-1a over float32) | REWRITE: canonical component fields as float64 bits, plus RNG states, plus every Rapier body's pose and velocities (never the snapshot bytes), plus a per-step trace | `engine/core/hash.ts`, `engine/sim/state.ts` | 1.1, 1.4 |
| `SIM.run(600)` scripted proof | `stress-world/20-sim.js:587`, `lab3d/30-physics.js` | REWRITE as replay files run in Node and in the browser, against one golden | `engine/sim/replay.ts`, `tests/replays/` | 1.5 |
| Rapier world, units, collision groups | `stress-world/20-sim.js:32` (groups: world, prop, hero, mob, wisp, dead) | PORT. SI units; `@dimforge/rapier3d-simd-compat` 0.21.0 (§4.7): the same state in Node and Chromium, exact restores; one parameters table | `engine/physics/world.ts` | 3.1 |
| Character controller | `stress-world/20-sim.js`. Capsule half-height 9 and radius 4.5 units; offset 0.3, snap 4, autostep (4, 2), max slope 50°, slide, impulses at character mass 2500; speed 80, jump 150, dash 260 | PORT, converted to SI: 0.5625 m, 0.281 m, 0.019 m, 0.25 m, (0.25, 0.125) m, 5 m/s, 9.375 m/s, 16.25 m/s (Appendix C). The grounded-flicker workaround only if WP 3.2's test still needs it on Rapier 0.21 | `engine/physics/character.ts` | 3.2 |
| Crowd as dynamic bodies | `stress-world/20-sim.js`: velocity intents, locked rotations, zero-friction combine, sleeping, knockback as momentum, launches, a corpse group | PORT the pattern | `engine/physics/crowd.ts` | 5.1 |
| Walker, slime and wisp AI; attack tokens; waves | `stress-world/20-sim.js` | **Box sample content**, rebuilt neutrally. Flow-field steering and token-limited attackers become generic helpers | `labs/box/cast/`, `engine/world/{steer,ai}.ts` | 5.2, 5.7 |
| Level as text | Hall 64×44: `# P w t = ^ o .` (`stress-world/10-hall.js`). Room 13×11: `# T P . c C m d` (`lab3d/20-world.js:12-35`) | REWRITE as a **legend-driven compiler** with `validate()`. The hall becomes the box's big level; a small room starts it | `engine/world/level/*`, `labs/box/levels/` | 2.2, 4.2 |
| Heights, walkable grid, flow field | `stress-world/10-hall.js`: `floorH`/`topH`, `PASS` with an 8-neighbour `CLIMB` limit, Dijkstra `FLOW` without per-step allocation | PORT | `engine/world/level/heights.ts`, `engine/world/nav.ts` | 2.2, 4.3 |
| Colliders from text | Greedy rectangle merge, convex wedges for stairs, the dais frustum (`10-hall.js`) | PORT: descriptors in `world`, bodies in `sim` | `engine/world/level/colliders.ts`, `engine/sim/levelBodies.ts` | 2.2, 3.1, 4.2 |
| Procedural texture bake | `bake()`, duplicated in both labs | REWRITE: `DataTexture`, mipmaps, albedo, normal, roughness and emissive channels, tiling generators | `engine/gfx/textures/` | 2.3, 7.3 |
| Toon bands, node materials | `stress-world/00-setup.js` (`TOON_BANDS`, `objMat`) | PORT | `engine/gfx/materials/` | 2.3, 7.2 |
| Outline (inverted hull in TSL) | `stress-world/00-setup.js:102-116` | PORT and FIX: take the push direction from `positionGeometry`, because r182 (like r180) assigns the instance-transformed position to `positionLocal`. Add an ID/depth edge outline as a post pass (from the fly renderer's idea) | `engine/gfx/materials/outline.ts`, `engine/gfx/post/edges.ts` | 7.2, 7.4 |
| Puppet body grammar | `lab3d/40-characters.js:8-48`: `['limb',a,b,ra,rb,c]`, `['curve',a,b,bow,ra,rb,c]`, `['ball',a,r,c]`, `['eye',a,r,c]`, `['sword']`, `['cape']`; points are a joint name, `[f,r,u]`, `['lerp',p,q,t]` or `['off',p,df,dr,du]` | PORT and EXTEND: bones, sockets, mirrored parts, material slots, metres | `engine/gfx/puppets/` | 3.8 |
| Instanced puppet batches | `stress-world/30-crowd.js:20-67` (`Batch.tube/ball/box/cone`) | PORT behind an instancing service | `engine/gfx/instancing.ts` | 3.8 |
| Cards (the engine draws sprites into an atlas) | `stress-world/30-crowd.js`, `lab3d/40-characters.js` | **DROP**. Puppets won; the pixel look becomes a post filter | — | — |
| Lights | 42 fixed point lights plus a hemisphere light; 2 shadow casters. Built in `stress-world/10-hall.js:435-466`, driven each frame by `50-frame.js:58-63` and `35-effects.js:107-109` | REWRITE: a fixed light pool with a budget manager (the count never changes, so no shader rebuilds), a shadow-caster budget, flicker on the visual RNG. r182's `TiledLighting` addon arrives on demand, when the pool is not enough (WP 11.5) | `engine/gfx/lights.ts` | 7.1 |
| Fog that starts past the focus | `stress-world/50-frame.js` | PORT, adding height fog | `engine/gfx/atmosphere.ts` | 7.1 |
| Warm-up (draw everything once before play) | `stress-world/50-frame.js` | REWRITE as a registry using `compileAsync` with progress, and a **public** pipeline counter instead of `renderer._pipelines` | `engine/gfx/warmup.ts` | 2.1 |
| Cameras | `stress-world/40-cameras.js`: classic views (perspective or ortho), side scrolling with depth, chase with wall avoidance, first person, fly, fixed. `lab3d/50-cameras.js`: orbit. Camera links: `stress-world/40-cameras.js:274-337` (`?cam=`, `?cam3=`) and lab3d's `CAMS.code()`/`load()` | PORT | `engine/gfx/cameras/` | 2.5, 3.9 |
| Height boost projection `P·V·S·V⁻¹` | `lab3d/50-cameras.js:31-40` | COPY (6 lines) | `engine/gfx/cameras/boost.ts` | 2.5 |
| Wall and pillar cutaway | `stress-world/10-hall.js`, `40-cameras.js` | PORT | `engine/gfx/cutaway.ts` | 4.4 |
| Post filters with an MRT mask | `stress-world/45-filters.js`: cel, pixel/Bayer, bloom, FXAA | PORT the filters to `PostProcessing` (r182), with three.js's TSL display addons where they exist. The object mask comes from the one fixed MRT set up at startup, with every filter gated by a uniform in one composite (§6.7, §4.8) | `engine/gfx/post/` | 7.4 |
| Resolution modes | `stress-world/50-frame.js` `fit()`: engine pixels at 200–330 lines, balanced, full | PORT | `engine/gfx/resolution.ts` | 2.1 |
| Effects | `stress-world/35-effects.js`: telegraph decal pool, ribbons from `rig.trail`, particle quads. Blob shadows: `stress-world/30-crowd.js:334-364` (`shadowAt`) | PORT | `engine/gfx/fx/`, `engine/gfx/puppets/blobShadow.ts` | 6.4, 3.8 |
| Damage numbers on a pixel-font overlay | `stress-world/35-effects.js:133-149` | REWRITE as HTML/CSS: DOM numbers that follow projected positions (doctrine: WebGPU only allows HTML/CSS UI) | `engine/ui/overlay.ts` | 6.5 |
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
| `tools/mocap-test.mjs` | 16 KB | REWRITE as Node unit tests (format, provenance, ledger, picks, QA) plus a browser smoke test | `engine/anim/clip/*.test.ts`, `tests/e2e/library.spec.ts` | 8.6 |
| Mocap Lab (`src/mocap.game.js`, `src/mocap.template.html`) | 43 KB | REWRITE as clip mode in the box, with `x anim` as its machine interface; a Library Lab page is an optional view, on demand (WP 10.8). Keep the UX: catalog search; the clip as text with Apply, Reset, Mirror and Copy for model; deep links; frame stepping | `labs/box/`, `labs/library/` | 8.9, 10.8 |
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
| Pixel font (5×7 proportional and 3×5) | `engine` §6; compact encoding in the agent edition | CONCEPT. UI text is HTML/CSS in the system font; a pixel look, when a game wants one, comes from an approved font (doctrine: Assets) or this encoding drawn to a canvas | — | 6.5 |
| `E.ui.box/bar/hearts`, `Dialog`, `Menu` | `engine` §21 | REWRITE as HTML/CSS components, with input and sound injected, read by tests through the DOM | `engine/ui/` | 10.6 |
| Input: named actions, presets, edge detection in sim time, `repeat`, `buffered`/`consume`, radial deadzone, clear on blur | `engine:476-694` | PORT the action model. REWRITE the devices: pointer lock, axes, rebinding as data, camera-relative intents, a recorder, a virtual device | `engine/input/` | 3.3 |
| `E.tex` (7 generators: flagstone, grass, dirt, water, planks, checker, plain) | `engine:3057-3101` | PORT as seeded, **tiling** generators with height, roughness and emissive channels | `engine/gfx/textures/generators/` | 2.3, 7.3 |
| Backdrop strips (10 presets, 512 px tiling layers) | `engine` §21b | PORT the generators for a sky cylinder, and add a TSL sky dome | `engine/gfx/sky.ts` | 7.1 |
| `parseLevel` | `engine` §13 | PORT | `engine/world/level/parse.ts` | 2.2 |
| Flow field (4-neighbour BFS) | `engine:3018-3054` | DROP in favour of stress-world's Dijkstra | — | 4.3 |
| `SpatialHash` | `engine:3626-3646` | PORT on typed arrays | `engine/world/spatial.ts` | 4.3 |
| `Bullets` and `E.pattern` | `engine:3553-3625` | PORT to 3D, with swept hit tests (fast bullets pass through targets today) | `engine/world/projectiles.ts` | 6.3, 10.4 |
| Platformer feel: coyote time, jump buffer, variable jump height, wall jump, dash | `engine` §16 | PORT onto the character controller | `engine/physics/character.ts` | 3.2 |
| Scenes, timers (`after`, `every`, `{cancel}`), `E.store` | `engine` §10 (`after`/`every`, `engine:1594-1597`); `E.store` `engine:198-202` (§1) | PORT. Timers run in sim time. The store gains a configurable prefix (today a fixed `my3d2dge:`), a memory backend and versioning | `engine/core/time.ts`, `engine/app/` | 1.3, 2.7, 10.9 |
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
| Virtual clock plus seeded `Math.random`, injected before page scripts run (`tools/filmstrip.mjs:39-53`) | COPY, as a Playwright fixture, without lines 48-49, which hide `navigator.gpu` and Web Audio | `tests/e2e/fixtures.ts`, `tools/lib/browser.ts` | 0.2 |
| Headless WebGPU: flags, a stand-in `getContext('webgpu')`, `__readFrame` readback (`tools/lab3d-test.mjs:70-102`) | **DROP**: shardfall's flags make the page present to its real canvas (§4.8), so neither the stand-in nor its readback, which reads the stand-in's texture, is needed. The fixture's `readFrame` takes a Playwright screenshot of the canvas element. Both stay in the source checkout as the fallback (§8.8) | `tests/e2e/fixtures.ts`, `tools/lib/browser.ts` | 0.2 |
| Banned-API list (`tools/lab3d-test.mjs:28-43`) | PORT into ESLint's stock rules: extend it with r182's deprecations and the newer names r182 lacks, each naming its replacement; scope by path | `eslint.config.js` | 0.4 |
| Static server that emulates the deploy's routes (copied 4 times) | **DROP**: Vite's dev server replaces it | `vite.config.ts` | 0.2 |
| `tools/test-run.mjs` (path-prefix suite map; list, files, reasons, timing; filters out version-only changes) | **DROP** the runner: Vitest (`--changed`, `related`) and Playwright Test (`--only-changed`, `--list`, `--repeat-each`) select and run the tests; their reporters give the timing | npm scripts `test` and `e2e` | 0.5 |
| `tools/version.mjs` (8 regex places) | Later. Until production the version lives in `package.json` only, and nothing else repeats it | — | H |
| `tools/filmstrip.mjs` (step DSL; A/B/diff contact sheets) | PORT: a 3D frame source, named RNG streams, a tolerance, ID attribution, JSON | `x film` | 3.11 |
| `tools/check.mjs` (scripted play, look notes with fixes, `report.json`) | REWRITE for 3D | `x shot` | 2.6 |
| `tools/ed-sheet.mjs` (character sheet with numeric lints) | SPLIT: the motion checks move to Node (measured at 0.28 s for 24 moves); the sheet becomes 3D cameras × states | `x qa anim`, `x sheet` | 6.6 |
| `tools/labs-test.mjs`, `src/labs.json`, `src/labs.template.html` | PORT for the optional lab pages, adding an `answer` field and an expiry date for temporary labs | `labs/`, `x lab` | 10.8 |
| `tools/agent-test.mjs` | DROP the parity half and the token counting. Keep doctest extraction (now `@example` blocks) and path checks | `x docs --check` | 0.6 |
| Patterns in `new-character.mjs --test`, `ed-play.mjs` (step DSL), `ed-balance.mjs` (autopilot plus virtual clock), `ed-smoke.mjs`, `character-check.mjs` | CONCEPT | `x new`, `x film --steps`, `dev/bot`, smoke tests | 5.6, 12.1 |
| `tools/lab3d-test.mjs`, `tools/stress-world-test.mjs` | REWRITE as the box's Playwright suites over the shared fixtures | `tests/e2e/` | 2.7, 3.10 |
| `ed-syntax`, `slice-test`, `ed-build`, the `build.mjs` directives (`@inline-module`, `@inline-head`) | **DROP**: ES modules, `tsc` and Vite replace them | — | — |
| The 14 Emberdeep tools, `tools/stress-test.mjs` (2D), `tools/ed-codex-showcase.mjs`, `docs/assets/` | **DROP** | — | — |
| `vercel.json` (serves committed files; rewrites) | REWRITE: Vercel runs `vite build` from source on every push; nothing built is committed; a landing page opens the box (ADR-0021) | `vercel.json`, `index.html` | 0.12 |
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
| Developer sandbox (throwaway save, god mode, freeze AI, step, speed, spawn, travel) | `ed/62-developer.js` | `sim/devActions` (`defineDevAction`) and `dev/actions`, reachable from `x eval` and `__engine` (ADR-0025 amendment 13) | 5.6 |
| Autopilot (a virtual device, a progress watchdog, stuck detection measured along the wanted direction, reproducible runs) | `ed/93-autopilot.js` | `dev/bot` (navigation and watchdogs, no combat tactics) | 5.6 |
| Gallery of everything registered, with deep links and wrong-name warnings that list the valid names | `ed/92-gallery.js` | `dev/gallery` and `x gallery` | 7.7 |
| Performance governor with hysteresis | `ed/95-perf.js` | `dev/governor`, which owns the WebGPU features, presentation LOD and resolution (never sim LOD) | 7.5 |
| Controls rebinding (conflicts, reserved keys, persistence, any gamepad slot, separate menu actions, a touch layer, safe areas) | `ed/61-controls.js`, `docs/CONTROLS-AUDIT.md` | `input/bindings`; the touch layer follows shardfall's design (§5.8), which needs no safe-area margins | 3.3, 3.12 |
| Data-defined layered sound effects, tracker-string songs, stings fired by events | `ed/70-audio.js` | `audio` (the mechanism, not Emberdeep's sounds) | 9.2, 9.3 |
| Captured clips layered on a procedural rig (masks, crossfades, walk/hold/next flags, cancel rules, landmark times) | `ed/96-hero-clips.js` | `anim` clip-action layer and events | 8.4, 8.7 |
| Deep links, a debug handle, a step-script DSL | `ed/99-start.js`, `tools/ed-play.mjs` | `app/routes`, `dev/inspector`, `x film --steps` | 2.7, 3.11 |
| Composition (role-based selection, a novelty scheduler, name grammar, recolouring with a luminance guard) | `ed/35-bosses-core.js:170-171`, `ed/50-levels-core.js:70-72, 329-335` | `engine/compose`, built when the first game needs it (backlog) | — |
| Saves isolated in demo, sandbox and gallery modes; deduplicated errors and warnings | `ed/` various | `app/store`, `core/log` | 10.9, 1.2 |

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
- **A small fixture sound set and one demo song** for tests, alongside the engine's own ported presets (WP 9.2).

### 5.8 Harvested from shardfall (designs, tuned numbers, shaders and data; never its game)

Shardfall is Rust (§4.8), so its code is ported, not copied. Paths are relative to its repository at `fa2dab6`. Its game content (`crates/pav_core/src/arpg/`, `game/*.toml`) stays out, like Emberdeep's (§5.7). The **Fate** column uses §5's terms; **DATA** means its files are taken as they are, with their provenance.

| What | Where it lives in shardfall | my-3dge | Fate | WP |
|---|---|---|---|---|
| One tool table (name, help, typed arguments, a function returning JSON or an image) that feeds the CLI, a REPL, an MCP server with generated schemas, and a live bridge | `crates/pav_tools/src/tools.rs:15-43, 660-676`; `mcp.rs:29-122` | Inspector members declare their arguments in the schema language, so `help()`, argument checks and a later MCP server come from one table | CONCEPT | 1.6, 7.6 |
| `see`: a screenshot with numbered marks and a legend of what each mark is | `crates/pav_tools/src/agent_tools.rs:26-224` | `x shot --marks`, marking only what the ID pass sees (shardfall's marks show through walls) | PORT | 2.6 |
| Maps: `ascii`, a text map from raycasts; `levelmap nav=true`, a picture with blocked cells and the route | `pavilion-lite/src/tools.rs:743-866`; `crates/pav_tools/src/game_tools.rs:1296-1325` | `x sim --map`; the agent eye's ASCII thumbnails | PORT | 4.3, 12.3 |
| Turntable framing: box every pose, then back the camera off until all eight corners fit (it was fixed after a 5.26 m boss lost its head) | `crates/pav_tools/src/game_tools.rs:921-952` | The sheet cameras of `x sheet`: orthographic, every frame and view fitted at one scale, so no back-off is needed (ADR-0009 amendment 6) | PORT | 6.6 |
| A bot campaign: one report row per level, seed sweeps, a stop condition, a sampled trace | `crates/pav_tools/src/agent_tools.rs:226-307`; `pavilion-lite/src/tools.rs:1076-1185` | The bot's report and sweeps | PORT | 5.6 |
| Readback without the 256-byte row padding | `crates/pav_render/src/capture.rs:31-71` | `shot()` | PORT | 2.6 |
| A test that gold, potions and the RNG each change the hash (this plan extends it to every captured field) | `crates/pav_core/tests/arpg.rs:144-169` | The capture-coverage test | PORT | 1.4 |
| The feel meter: response ticks, acceleration, stop and turn times, apex, air time, jump reach | `crates/pav_core/src/feel.rs` | `engine/physics/feel.ts`, for tuning by numbers and for level reach checks | PORT | 3.2 |
| The character controller's wiring and fixes: the across-then-down move, snap only when grounded, autostep over dynamic bodies, a 1 mm nudge so moving floors carry, pushing as a 70 kg mass that shares momentum, weight on dynamic floors, post-move velocity fixes, a one-way-platform predicate, skipping idle characters | `pavilion-lite/src/character.rs:179-399`; `crates/pav_core/src/character.rs:959-1089`; `crates/pav_core/tests/movement.rs` (13 tests) | `engine/physics/character.ts` | PORT | 3.2 |
| Movement maths and tuned defaults: coyote 0.10 s, jump buffer 0.12 s, jump cut 0.45, apex 1.35 m, fall speed capped at 26 m/s, acceleration 45, deceleration 32 and skid 90 m/s² | `crates/pav_core/src/character.rs:124-162, 770-925` | The hero's starting feel. Shardfall uses the same axes and units, so its numbers need no conversion | PORT; DATA | 3.2, 3.10 |
| Character gravity separate from world gravity (32 m/s² against 9.81 m/s², "for game feel") | `crates/pav_core/src/sim.rs:64`; `character.rs:139` | The scene settings `gravity` and `characterGravity` | CONCEPT | 3.1, 3.2 |
| Movers: the pose is a function of the tick, applied through kinematic velocities | `crates/pav_core/src/behaviors.rs:14-75` | Box movers that carry riders and restore exactly | PORT | 4.1 |
| A* with line-of-sight smoothing; flow fields with reach; ties broken by index; no corner cutting; a look-ahead direction; fields cached per goal cell | `crates/pav_core/src/nav.rs:184-292` | `engine/world/nav.ts` | PORT | 4.3, 5.2 |
| Joints as data (ball, hinge with limits, motor and spring, slider, rope, spring), with chain and bridge builders | `crates/pav_core/src/joints.rs`; `world.rs:523-596` | Ragdoll joints | PORT | 10.2 |
| Load ramps as data: spawners add at most 25 bodies per tick, with caps | `rooms/stress.toml` | The crowd scenes spawn in batches | CONCEPT | 5.7 |
| Rooms as data, with a validator, hot reload that keeps the last good version, and per-room guides that a test holds to the code | `crates/pav_core/src/room.rs:420-547`; `rooms/_template.toml`; `crates/pav_view/tests/learn.rs` | The box README's claims, checked by a test | CONCEPT | 2.7 |
| Settings declared once: the panel, presets (path → value JSON that reports unknown keys) and scoped overrides that are restored on exit | `crates/pav_core/src/params.rs:63-259`; `world.rs:1052-1116` | The settings schema's presets and scoped overrides | CONCEPT | 1.2 |
| Terrain: fbm plus ridges, terraces, flattened footprints, stateless placement, trimesh chunks with internal-edge fixes | `crates/pav_core/src/terrain.rs:93-230` | Terrain | CONCEPT | 10.5 |
| Projectile emitters: aimed, forward, ring, spiral and random; bursts, delay, range, gravity | `crates/pav_core/src/behaviors.rs:77-92, 189-241` | Projectile patterns | PORT | 10.4 |
| Clip `speed`: the playback rate is ground speed divided by capture speed; a walk–run switch with hysteresis | `crates/pav_core/src/clips.rs:137-140, 441-476` | Format 2 carries `speed`, so clips round-trip with shardfall | PORT | 8.2, 8.4 |
| Strike time: the hand, blade tip or foot furthest ahead, so attacks are timed to their hits | `crates/pav_core/src/clips.rs:478-550` | `hit` events derived from clips | PORT | 8.4 |
| A two-slot crossfade with flags; an upper-body blend that re-solves IK | `crates/pav_core/src/puppet.rs:582-615, 653-698`; `clips.rs:656-735` | The clip layer's blending | CONCEPT | 8.4 |
| BVH rig maps for five rig families; the rest pose from the frame where the body stands straightest; units from leg length | `crates/pav_tools/src/mocap/bvh.rs:235-605` | The re-import's rig handling, parsed with three.js's `BVHLoader` | PORT | 8.8 |
| Loop finders (straight, going, still) with a turn penalty | `crates/pav_tools/src/mocap/takes.rs:53-243` | Cutting loops from long takes | PORT | 8.8 |
| One file read out of a remote zip by HTTP ranges | `crates/pav_tools/src/mocap/fetch.rs:49-161` | `x anim cmu` without downloading whole archives | PORT | 8.5 |
| 100STYLE (CC BY 4.0) and Quaternius v2 (CC0) clips, in format 1 plus `speed` | `anim/style100.json`, `anim/100style/`, `anim/quaternius.json`, `anim/catalogs/` | New library sets: 100STYLE, approved by the owner (ADR-0021), and Quaternius v2, which is CC0, needs no approval and replaces v1's set (WP 8.10) | DATA | 8.10 |
| A planted gait for N legs (neighbours never lift together), body tilt from the feet, and verlet chains | `crates/pav_core/src/rig.rs:24-60, 295-450` | `LegGait` and `VerletStrand` | PORT | 10.1 |
| A directional flinch spring | `crates/pav_core/src/puppet.rs:568-573, 700-710` | Reactions | PORT | 6.2 |
| Generators that keep old seeds stable when genes are added (each addition draws from its own RNG stream) | `crates/pav_core/src/arpg/genome.rs:334-346` | Procedural creature blocks | CONCEPT | 10.1 |
| One fixed MRT (colour, and normals carrying per-object flags) and one composite pass with every filter gated by a uniform | `crates/pav_render/src/shaders/post.wgsl:731-860`; `scene.wgsl:267-277`; `crates/pav_render/src/renderer.rs:400-403, 1309-1358` | Post-processing (§6.7) | PORT | 7.4 |
| Filter functions: Bayer, five palettes, levels, grade, scanlines, CRT, vignette, grain, chroma; pixel art with a rim; the edge outline from depth, crease and ID; Kuwahara oil, CMYK halftone, ASCII, pencil | `crates/pav_render/src/shaders/post.wgsl:72-101, 337-409, 443-673, 741-848` | Filters, through TSL's `wgslFn` or ported to TSL | PORT | 7.4 |
| Tuned looks: 73 presets and 21 whole looks | `crates/pav_view/src/looks.toml`; `look.rs:100-353` | The `look` kind's starting data, keys renamed | DATA | 7.4 |
| Smoothed toon bands and a gated rim; the style as a per-instance id | `crates/pav_render/src/shaders/scene.wgsl:200-257`; `renderer.rs:1052-1056` | Toon materials | CONCEPT | 7.2 |
| Light shafts through haze, and lamp halos: a 32-step march with a sun-shadow compare and a Henyey–Greenstein phase | `crates/pav_render/src/shaders/post.wgsl:153-255` | God rays and halos | PORT | 11.5 |
| A cheap GI and AO tier: a 12-tap spiral | `crates/pav_render/src/shaders/post.wgsl:110-151` | A tier below `SSGINode` | PORT | 11.5 |
| GPU particles: CPU births into a 65,536-slot ring, compute integration, one premultiplied blend | `crates/pav_render/src/shaders/particle_*.wgsl`; `crates/pav_render/src/fx.rs:425-658` | GPU particles | PORT | 11.3 |
| Emitter presets (13), event bursts, flicker | `crates/pav_view/src/fx.rs:13-229, 264-276, 290-480` | The effects' starting data | DATA | 6.4, 7.1 |
| Quality tiers, and dynamic resolution with hysteresis | `crates/pav_app/src/quality.rs:29-115` | The governor's tiers; the touch-screen defaults | CONCEPT | 3.12, 7.5 |
| Touch controls: finger routing, a floating stick, a fan of round buttons, taps and holds timed in seconds with a one-frame guard, a tap that closes the top panel, swipe to dismiss, and the page set up for phones (no zoom, full screen, landscape) | `crates/pav_app/src/touch.rs`; `crates/pav_app/src/app.rs:275-331, 799-808`; `web/index.html:5-58` | `engine/input/devices/touch.ts` and HTML/CSS buttons, the same design (ADR-0021) | PORT | 3.12 |
| Bindings by physical key; a system layer that is never rebound; taps shorter than a frame kept; prompts that follow the last-used device; scripted gamepad input | `crates/pav_app/src/input.rs:131-161, 299-380, 590-610` | Input devices | CONCEPT | 3.3 |
| Gamepad menus through a virtual cursor; menu actions sent as input, so they replay | `crates/pav_app/src/app.rs:438-530` | UI widgets | CONCEPT | 10.6 |
| A 90-line game template whose bot must win on many seeds; a test that every game runs, draws, rewinds and replays | `pavilion-lite/src/games/template.rs`; `games/mod.rs:60-169` | The game template's Done-when | CONCEPT | 10.7 |
| Sound from sim events, with an offline render of a scripted run's whole mix (peak, event counts) | `crates/pav_audio/src/lib.rs:209-553`; `crates/pav_tools/src/tools.rs:1270-1309` | A clipping check on the whole mix | CONCEPT | 9.4, 9.5 |
| A static deployment on Vercel, imported by the owner and built on every push | `vercel.json`; `scripts/build-vercel.sh` | `vercel.json` and the landing page (ADR-0021) | CONCEPT | 0.12 |
| A one-page `PROGRESS.md`, read at every start, plus a journal that is searched rather than read | `docs/PROGRESS.md`; `docs/HISTORY.md` | `docs/PROGRESS.md` beside the ledger | CONCEPT | 0.6 |

**Left out:**
- The synth (`crates/pav_audio/src/lib.rs:10-194`): a subset of my-3d2dge's, with sounds written as code.
- The egui UI and `pav_app`'s 668-line `frame()`.
- The SDF impostor characters.
- `bloom.wgsl`: r182 has `BloomNode`.
- Its clip codec and importers, which are Rust ports of the my-3d2dge JavaScript this plan ports itself.
- Its foot IK, which only drops the pelvis.
- Hit-stop by shrinking the physics step.
- The live bridge: no finding came through it.
- Streaming, soft bodies, vehicles, water and wind: no WP needs them yet.
- `projectile.rs`, whose fast shots can pass through characters.

---

## 6. Target architecture

### 6.1 Layers and import rules

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ app/    createEngine, loop wiring, routes and deep links, store                    (may import all) │
│ dev/    inspector (__engine), overlay, actions, gallery, bot, governor, stats      (all but app)    │
├──────────────────────────────── PRESENTATION (reads sim snapshots; never writes them) ─────────────┤
│ gfx/ (three.js on WebGPU)   gfx/enhanced/ (optional GPU features, via gfx/features)   audio/runtime  │
│ ui/ (HTML/CSS over the canvas)   input/devices (DOM events → intents)                                │
├──────────────── SIM-SIDE (reproducible; runs in Node; no DOM, renderer or Web Audio) ───────────────┤
│ sim/ (world, systems, scenes, state, hash, replay, hits, level bodies)                                │
│ physics/ (the only Rapier import)   anim/ (skeleton, layers, IK, moves, clips, proc)                  │
│ world/ (level compiler, nav, spatial, props data, steering, ai, projectiles)   input/intents   audio/dsp │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ core/   math (three.js's math classes), simMath, rng, noise, hash, color, time, events, registry,   │
│         log, settings, schema                                                                      │
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
| Game code, sim-side: `labs/box/scenes/`, `labs/box/cast/`, `fixtures/scenes/` | the public sim API only, `engine/sim-api.ts`, so `x sim` runs them in Node |
| Game code, pages: `labs/box/` (the rest) | the public API only, `engine/index.ts` |

**Reaching physics from presentation.** Presentation code reaches physics only through the read-only **`QueryView`** that `sim.snapshot()` returns (`raycast`, `probe`, `overlap`). It never imports `physics/`. The chase camera's wall avoidance and audio occlusion both use it.

**Data descriptors.** `world` holds data descriptors (a prop names its geometry, material and body by id; a level yields mesh descriptors). `gfx` turns those descriptors into meshes.

**Single owners:**
- Only `physics/` imports Rapier.
- Only `gfx/` imports three.js's renderer, scene, material and TSL classes. Every other layer gets three.js's math classes (`Vector3`, `Quaternion`, `Matrix4`, `Euler`, `Box3`, `Sphere`, `Ray`, `Plane`, `MathUtils`, and `Color` since WP 1.1, ADR-0020 amendment 1) through `core/math`, so all layers share one set of math types and `three/webgpu` is the one entry point.
- Only `audio/runtime/` touches Web Audio.
- Only presentation code (`gfx`, `audio/runtime`, `ui`, `input/devices`), `dev` and `app` touch browser APIs (DOM, canvas, URL, Web Audio). URL parameters are parsed once, in `app/routes`, and passed down.
- Tests and tools may import anything.
- **Game code reaches three.js only through the barrels' re-exports:** its math classes (through `core/math`), `AnimationClip` and `AnimationMixer`. When game code needs another three.js class, the barrel gains a re-export with its doc comment, so every three.js surface a game sees is listed in one place, and the internals rule of §6.10 can check it.

### 6.2 Repository layout

```
my-3dge/
  DOCTRINE.md               the owner's doctrine; it governs this plan. Agents edit it only when the owner asks (§8.10)
  AGENTS.md                 the rules; each one paired with the check that enforces it (Appendix E)
  CLAUDE.md                 "@AGENTS.md" plus Claude Code specifics
  PLAN.md                   this plan (the ledger in §14 is updated as work lands)
  README.md  LICENSE (MIT)  package.json  package-lock.json  .nvmrc (24.22.1)
  index.html                the landing page: it opens the box (WP 0.12)
  vercel.json  .vercelignore   the Vercel build: npm ci, npm run build, dist/ (WP 0.12)
  tsconfig.json  vite.config.ts (dev server, build, and Vitest's settings)  playwright.config.ts  eslint.config.js
  tsconfig.base.json  tsconfig.check.json  tsconfig.{engine,apps,tests}.json   T0's incremental type check (ADR-0014 am. 7)
  .prettierrc.json  x.js (`node x <cmd>`: registers tsx, then runs tools/x.ts)
  engine/                   TypeScript (strict), ES modules, extensionless imports, unit tests beside the code (*.test.ts)
    index.ts                the public API for pages; its file comment is the engine's front page
    sim-api.ts              the public API for sim-side game code (scenes, cast, behaviours); index.ts re-exports it
                            (its Animation area is anim/api.ts, re-exported whole: ADR-0020 amendment 8)
    core/  sim/  physics/  anim/  anim/clip/  anim/proc/  world/  world/level/  world/props/  input/
    audio/dsp/  audio/data/  audio/runtime/  gfx/  gfx/materials/  gfx/textures/  gfx/geometry/  gfx/level/
    gfx/puppets/  gfx/cameras/  gfx/post/  gfx/fx/  gfx/enhanced/  ui/  dev/  app/
  labs/
    box/                    THE STRESS BOX: index.html, main.ts (page wiring), scenes/ (sim-side scene modules),
                            levels/*.txt, cast/ (sample monsters and behaviours), bodies/, README.md
    hello/                  the harness smoke page (WP 0.8)
    game/                   the starter game every game made from the engine begins as (WP 10.7, ADR-0024)
    playground/             THE PLAYGROUND (Phase 13, ADR-0025): index.html, main.ts, scenes/, levels/, cast/,
                            bodies/, looks/, sounds/, courses/, weapons/, README.md
    (on demand, WP 10.8: optional views for anim, materials, props, fx, cameras, physics and the animation library)
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
    game/                   new-game.mjs (makes a game, and moves one to a newer engine), files.mjs (what a game
                            gets, engine-lock.json), template/ (a game's root files) (WP 10.7, ADR-0024)
    deps.json               every dependency: its qualifying release, its pin, their dates, and why it is used
    lib/                    report, browser (launch options, page setup), source, hash, vite (a dev server for x)
    anim/                   GLB reader, rig maps, importer, ASF/AMC, CMU, to-glb.py (Phase 8)
    mcp/                    MCP server bridging __engine (WP 7.6, on demand)
  tests/
    e2e/                    Playwright Test suites (*.spec.ts), one project (webgpu); fixtures.ts
    replays/                *.replay.json: inputs and expected hashes, keyed by platform
    pages/                  test pages: replay.html (sim only), scene.html (fixture scene plus gfx)
    unit/                   Vitest tests that don't sit beside a module (data checks, hooks, the type smoke test)
    baselines/              text thumbnails, QA baselines with reasons, advice and perf budgets
  docs/
    PROGRESS.md                          one screen: where things stand, what is next, open issues; read first, rewritten at each gate
    INDEX.md  API.md  ERRORS.md          generated by `x docs --write`, checked for drift
    GAME-GUIDE.md                        the game agent's guide and the single-file handoff; its last section
                                         generated by `x docs --write` (WPs 10.7 and 12.4, ADR-0024)
    HANDOFF.md                           handing the engine to game agents, and starting in a new environment
    research/                            the eight studies of my-3d2dge behind this plan (point-in-time; not drift-checked)
    decisions/ADR-0001-*.md …            one per decision in §13
    escalations/ESC-0001-*.md …          one per escalation, with the call made (§8.14)
    THREE-DELTA.md                       the pinned three.js (r182) for agents who know newer or older releases
    reference/three-tsl-wiki.md          the TSL wiki page as it stood for the pinned three.js (its revision in its header)
    TESTING.md  ANIMATION-LIBRARY.md  ANIMATION-RESEARCH.md
  evals/                    agent-usability tasks with automated acceptance (WP 12.2, on demand)
  .claude/                  settings.json, hooks/, skills/, agents/
  (git-ignored)  out/  dist/  .cache/  node_modules/  test-results/  .vercel/  .env*
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
  - Every HTML page's head has `<link rel="icon" href="data:,">`, so Chromium logs no 404 for `/favicon.ico` (measured).
  - Pages get their content through imports (`?raw`, `import.meta.glob`), never a `fetch()` of a repository path: the dev server serves the whole repository, but a build ships only what is imported (WP 0.12).

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
   - **It uses the standard `Math`** and three.js's math classes (through `core/math`), as agents write them everywhere else (doctrine: Common ground).
   - **It calls `Math.pow`, `Math.sin` and `Math.cos` by name where it uses them:** no swap (item 2) reaches an operator or an alias, so `**` and `**=` are banned (write `Math.pow`), and so are names destructured from `Math` (`const { sin } = Math`) and a swapped function held in a variable (`const pw = Math.pow`), which keep the native function (ADR-0006 amendment 1).
2. **Deterministic math under the hood** (doctrine: Quality under the hood).
   - V8's `Math.sin` and `Math.cos` differ by 1 ulp between Node and Chromium on the platform, and `pow` between Node releases (§4.7). Float64 state fed back through them drifts apart within a few hundred steps.
   - So `core/simMath.ts` swaps fdlibm ports (stdlib's, pure JavaScript) into `Math` while the sim runs, and restores the native functions afterwards. Every sim entry point runs inside it: `setup`, `step`, spawns, captures, restores. three.js's math classes, called by the sim, get the same results too.
   - The swap covers the functions that differ between the platform's runtimes: `sin`, `cos` and `pow` today. A **drift test** compares every `Math` function between Node and Chromium, and the moment a runtime update makes another one differ, its stdlib port joins the swap (doctrine: North Star, solve problems when they surface).
   - Measured cost: about 14 ns more per `sin` call, inside the sim only; rendering keeps native speed.
   - Game code sees none of it. Unit tests that call sim functions directly run under native `Math` in Node, and compare only with Node.
3. **Fixed step, explicit inputs.**
   - Everything the sim reads from outside arrives in the per-step intents, and is recorded. That includes the camera heading and any presentation fact gameplay chooses to use.
   - Setting changes (except `view` settings, WP 1.2) and dev actions made during play are recorded at the step they happen, like intents (§8.4).
4. **Ordered world.**
   - Entities iterate in id order.
   - Spawns and despawns queue up and apply at step boundaries.
   - Rapier bodies are inserted in a deterministic order.
5. **Physics.**
   - `@dimforge/rapier3d-simd-compat` 0.21.0 (§4.7): the same state run to run and in both runtimes, and restores that continue exactly.
   - Integration parameters are pinned in one table.
   - The build and version are recorded in replays, because snapshots are version-locked.
6. **The hash.**
   - It is FNV-1a over the float64 bits of everything `capture()` holds except Rapier's snapshot bytes: the canonical state, the timers, the scene's settings (except those marked `view`, WP 1.2), the state of every **sim** RNG stream (those made by `rng()` or `rng.entity()`), and every Rapier body's translation, rotation, linear velocity and angular velocity, in handle order. Snapshot bytes are never hashed: at 5,000 bodies they are 5.7 MB.
   - A test changes each captured field in turn and expects a new hash. In shardfall, a hash of positions alone let a replay "match" while the game state had diverged (§4.8).
   - Visual streams (`fxRng`) belong to presentation and are never hashed.
   - The canonical state is the components each kind registers, with their fields in order.
   - It is computed at checkpoints during play (every 60 steps by default), and every step in tests.
   - `trace()` gives per-entity hashes, so a mismatch names the first step, entity and field that diverged.
7. **Capture, restore, replay.**
   - `capture()` covers the whole sim: entities, components, timers, settings (except those marked `view`), RNG states and the Rapier world. `restore()` continues exactly like the uninterrupted run, in either runtime.
   - Any live session can be recorded and replayed, and any captured state restored.
8. **Golden hashes are keyed by platform** (`linux-x64`), one per replay checkpoint, and hold in Node and in Chromium alike. On another platform, tests run each replay twice and compare the runs, and report "golden: other platform".
9. **The proof matrix**, on the development platform:

   | Run | Compared with |
   |---|---|
   | A replay in Node, three times | the golden hashes |
   | The same replay in Chromium, sim only (`tests/pages/replay.html`) | the golden hashes |
   | The same replay in the scene's own page, rendering as it steps (every step; every 10th in the 5,000-agent scenes, to stay within T2's budget) | the golden hashes: rendering never changes play (doctrine: WebGPU only) |
   | Live play in the page, recorded and replayed in Node | the live hashes; this catches renderer writes |
   | capture → restore → continue, in Node and in Chromium | the uninterrupted run |

   Other browsers and other platforms wait for Phase H.

### 6.6 Data-first registries and schemas

- **Defining and validating content.**
  - `defineKind(kind, schema)` declares fields, defaults, ranges, units, docs, required hooks and fallbacks.
  - `def(kind, id, spec)` validates, writing plain-sentence errors with codes.
  - `get(kind, id)` warns once on a missing id and returns the kind's fallback.
  - `list(kind)` enumerates.
- **Ask the entry, never the id.** Shared code reads an entry's optional hooks, each with a default. A local ESLint rule flags string comparisons against registered ids in shared code.
- **Every kind automatically gets** an `x describe <kind>` listing (in a page, `__engine.describe(kind)`) and its row in
  `docs/INDEX.md`.
- **Scaffold templates** arrive with use (§8.13); the six kinds the gallery films write their `gallery` field (WP 7.7).
- **Kinds with a QA family (§8.6) get** its checks. Other kinds get these extras only when a WP shows they pay off.
- **Initial kinds:** `material`, `texture`, `geometry`, `body` (a puppet body), `skeleton`, `build`, `move`, `pose`, `stance`, `rig` (custom procedural), `prop`, `glyph` (level legend), `level`, `light`, `sky`, `look` (post preset), `emitter`, `telegraph`, `actionmap`, `setting`, `scene`, `feature` (an optional GPU feature), `actor` (an entity template: a body, a controller and a character animator), `inspectorMember` (WP 1.6), `touchlayout` (WP 3.12). Phases 8 and 9 add `action`, `clipset`, `sfx` and `song`; on-demand WPs add their own (`devAction`, WP 5.6).

### 6.7 Rendering: WebGPU only, gameplay on the CPU (doctrine: WebGPU only)

- **WebGPU is the only renderer.** The engine checks for WebGPU before it creates the renderer and refuses to start without it, with a coded error (`GFX_NO_WEBGPU`) that names the fix. three.js's automatic fallback to its WebGL 2 backend is switched off, and every page asserts after `init()` that the backend is WebGPU. There is no `?backend=` switch and no WebGL code path to keep working.
- **Everything WebGPU offers is available to rendering,** compute and storage buffers included, for looks and speed (doctrine: Quality under the hood). Optional adapter features (`timestamp-query`, `float32-filterable`, larger limits) are checked at startup and reported by `__engine.info()`. A missing one downgrades a look, never play, and logs an advice code: **nothing degrades silently.**
- **Gameplay runs only on the CPU.** The sim never imports `gfx/`, and nothing is read back from the GPU into it. GPU work (compute particles, GPU culling, post) changes how the game looks and performs, never how it behaves.
- **The CPU-only gameplay contract** (`tests/e2e/parity.spec.ts`, grown at every box stage):
  1. A replay gives its golden hashes while its scene renders as it steps (§6.5): rendering never changes play.
  2. Live play recorded in the page replays in Node to the same hashes.
  3. Turning any visual feature or look on or off never changes the hash.
  4. The gameplay entities in view appear in the ID pass.
- **Inside the renderer, quality comes first** (doctrine: Quality under the hood). Materials, passes and effects use whatever the builder can do best: TSL node materials, compute, three.js's addons. What game code sees stays common ground (doctrine: Common ground): a material is data with the parameters agents know from three.js's classic materials (`color`, `map`, `roughness`, `emissive`…), and the engine decides how to draw it. Textures are `DataTexture`s from CPU generators, which Node tests can hash.
- **Game UI is HTML/CSS** over the canvas: the HUD, menus, dialogs and damage numbers. World-anchored labels follow projected positions (three.js's `CSS2DRenderer` pattern). Tests read the UI through DOM queries (text, visibility, bounding boxes), not pixels.
- **Post-processing uses one fixed MRT**: colour, plus view normals carrying an outline group and per-object flags (the characters, the objects or the environment), set up once at startup. Every filter is a uniform, so toggling one never recompiles a material, and r182's `SSRNode`, which needs a normals texture, can use it (`PixelationPassNode` renders the scene again with its own MRT, so the pixel filter stays in the composite). r180 drew MRT post filters black and r181 failed validation, but r182 runs the prototype's MRT path (§4.7), and shardfall uses this design (§4.8).
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
import { defineScene } from '../../../engine/sim-api';

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
const engine = await createEngine({ canvas, look: 'toon', seed: 1 });   // throws GFX_NO_WEBGPU without WebGPU
await engine.start('box:hall');

// Node, no browser:
import { createHeadless } from '../../engine';
const h = await createHeadless({ scene: 'box:hall', seed: 1, settings: { crowd: 100 } });
h.step(600, script); h.hash(); h.trace(); h.state();
```

### 6.10 Dependencies, versions and the toolchain (doctrines: Common ground, Quality under the hood, Mastery)

**The rule** (doctrine: Mastery):
1. Find each dependency's **qualifying** release: the newest one at least 12 months old.
2. Pin the newest release that is **backward compatible** with it, and **adopt it immediately**. By semver, that is the newest release in the same major for packages at 1.0 or later, and the newest patch in the same minor for 0.x packages.
3. A release that semver calls breaking (a new major; a new minor of a 0.x package, such as each three.js `r` release) is adopted immediately too, but only if it **works the same way**: its upstream migration notes touch no API or behaviour the engine uses, and every suite passes unchanged on it.
4. Anything else waits until it qualifies by age, then arrives as an upgrade work package (§9, "Upgrades").
5. **Write to the qualifying release's API.** A feature that is newer than the qualifying release waits until it qualifies, unless an ADR says otherwise. Adopting a compatible release keeps its fixes, not its novelties, so agents' existing knowledge still applies.
6. **The platform follows the same rule** through the environment: Node's newest qualifying LTS line (odd Node lines never get LTS and are skipped), and the container's Chromium (doctrine: Discovery first).
7. **Engine internals may go newer** (doctrine: Quality under the hood): a dependency whose API stays behind the engine's public API may use a newer release when it measurably raises quality, runs on the platform, and the builder can use it well. `tools/deps.json` records the measurement. Today that is three.js r182, Rapier 0.21 and stdlib's math (§4.7).

§4.7 has today's pins, their dates and the next lines. `tools/deps.json` records them, with each dependency's reason for being here.

**The toolchain** (doctrine: Common ground). These are the most widely used tools for each job, and every agent knows them:

| Job | Tool | Front door |
|---|---|---|
| Language and types | TypeScript 5.9.3, strict; `module: esnext`, `moduleResolution: bundler`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `skipLibCheck` (for speed; §4.7) | `npm run typecheck` |
| Dev server and build | Vite 7.3.7: multi-page (the build takes `index.html` and `labs/*/index.html`; `tests/pages/*.html` are served in development only), TypeScript served with source maps | `npm run dev`, `npm run build` |
| Unit tests (T1) | Vitest 3.2.7, Node environment, `*.test.ts` beside the code; the JSON reporter writes `out/test/report.json` | `npm test` |
| Browser tests (T2) | Playwright Test 1.64.1, one project (`webgpu`), the platform's Chromium through `launchOptions.executablePath`, Vite as the `webServer`; the JSON reporter writes `out/e2e/report.json` | `npm run e2e` |
| Lint | ESLint 9.39.5 with `typescript-eslint` 8.71.1 (its recommended rules, without type information, so T0 stays fast), `eslint-plugin-jsdoc` 61.7.1, `globals` 16.5.0 | `npm run lint` |
| Format | Prettier 3.9.9, print width 120 | `npm run format` |
| Engine commands | tsx 4.23.15, under `x.js` | `node x <cmd>` |
| T0 | All of the first five, plus `node x check` (the repository checks no standard tool covers) | `npm run check` |

**Runtime dependencies** (exact pins, a lockfile, `npm ci`):
- `three@0.182.0` (rule 7). Vite serves it from `node_modules`, and Node imports the same files. Engine code imports `three/webgpu`, `three/tsl` and `three/addons/*`. Vite aliases a bare `three` to `three/webgpu`, as three.js's own WebGPU examples do in their import map, so the addons that import `three` share one module with the engine.
- `@dimforge/rapier3d-simd-compat@0.21.0` (rule 7), which inlines its WASM. Only the engine's physics adapter sees its API.
- stdlib's fdlibm ports, one package per function (`@stdlib/math-base-special-sin@0.3.1`, `-cos`, `-pow`), for the sim's deterministic math (§6.5; rule 7).
- Nothing else without an escalation (§8.14).

**Development dependencies** (exact pins, the same lockfile): those in the table, plus `@types/three@0.182.0` and `@types/node@24.19.2`. On-demand work adds its own (for example `@modelcontextprotocol/sdk` for WP 7.6). Each arrives with its reason in `tools/deps.json`.

**Dependency install scripts.** npm 11 (Node 24) runs an install script that `package.json`'s `allowScripts` does not mention, with a warning, and skips one it denies (measured; npm 10 ignores the field). esbuild's postinstall is the only one that runs on the platform, and Vite works without it, so `allowScripts` denies it.

**The platform:**
- **Node 24.22.1**, named in `.nvmrc`. The container ships Node 22.22.0, so `scripts/setup.sh` downloads the official 24.22.1 build from nodejs.org, checks its SHA-256, installs it under `~/.cache/my3dge/` and puts it first on `PATH` for the session (the SessionStart hook runs it; §8.10). The owner can make it permanent through the environment's setup script (§11.5). Everything also runs on Node 22 (measured), but Node goldens are recorded on 24.
- **Chromium 141.0.7390.37**, the container's (`/opt/pw-browsers/chromium`, from `CHROMIUM_PATH` when set), with WebGPU on SwiftShader. Playwright 1.64 drives it through `executablePath`; nothing ever runs `playwright install`. It also bounds the internals rule: a three.js release that needs WebGPU features Chromium 141 lacks (r186 does) cannot be adopted here.

**Adopting and upgrading.**
- `node x deps --update` runs at the start of every WP. It asks the registry for newer compatible releases and adopts them in a commit of their own (`deps: adopt compatible releases`), which must pass T0–T2 and re-baselines anything that changed, with the reason recorded.
- `node x deps --qualify` runs at every gate. It lists the lines that have newly qualified, which become upgrade WPs (§9, "Upgrades"). An upgrade WP also checks the next release against the one that just qualified (rule 3).
- `node x deps --check` (offline, in T0) fails when a pin differs from `tools/deps.json`, or when a dependency has no recorded reason.

**Pinned knowledge for agents:**
- The pinned packages' own sources and types in `node_modules`: three.js's `src/` carries its JSDoc, and `@types/three` turns a name the pinned release lacks into a type error.
- `docs/THREE-DELTA.md` explains the pinned three.js to agents who know newer releases (`RenderPipeline`, `ClusteredLighting`, `TextureSource`…) or older ones (`renderAsync()` is deprecated since r181).
- `docs/reference/three-tsl-wiki.md`: the TSL wiki page at the last revision before the next three.js release (`6153b39` for r182).
- ESLint's bans name each replacement (Appendix B). **Any three.js deprecation warning fails a test.**

---

## 7. Improvements over the prototype

Each improvement is owned by a work package. A WP is not done until the improvements it lists are in. Improvements owned only by on-demand WPs (§9.1) arrive when those WPs' triggers fire.

| Id | Improvement | What it fixes or replaces | WP |
|---|---|---|---|
| I-01 | One coordinate system: SI units, +Y up, +Z forward, used end to end | `toThree` swaps, quaternion sign flips, a left-handed engine frame | 0.1, 3.4 |
| I-02 | True fixed-step loop with an accumulator and interpolation. Injectable clock, timescale stack, per-entity clocks, leaky hit-stop budget | Variable substeps that make play irreproducible; rigs that depend on the refresh rate | 1.3 |
| I-03 | The sim runs headless in Node: replay and proof suites take milliseconds | The sim could not run without `renderer.init()` and meshes | 1.4–1.6 |
| I-04 | Replay files: record from live play, assert hashes per tick, bisect to the first step, entity and field that diverged | No input recording; only one scripted run | 1.5 |
| I-05 | A strong hash: float64 canonical state, RNG states, every Rapier body's pose and velocities, per-entity trace | A float32 hash of a few fields; no velocities, RNG or corpses | 1.1, 1.4 |
| I-06 | Reproducibility on the development platform, measured: game code writes the standard `Math`, the sim swaps in fdlibm ports while it steps, so Node and Chromium agree bit for bit and one golden serves both; Rapier 0.21's restores continue exactly | Proven only inside one Chromium page, with no golden value | 1.1, 1.4, 1.5, 3.1 |
| I-07 | A real proof that gameplay runs only on the CPU: replays give their golden hashes while the scene renders, and live play recorded in the page replays in Node to the same hashes, at every box stage | Parity that held by construction (no rendering between proof steps) | 2.7, 3.10, 4.6, 5.7, 6.7, 7.8 |
| I-08 | Rotation skeleton (root + 23 joints): skinning, bone masks, slerp blending, additive layers, ragdolls, native head and hand orientation | Joint positions only; `mocapTilt` side channels | 3.4 |
| I-09 | An explicit, inspectable layer stack. Unknown pose or move names warn with suggestions. Drawing never writes sim state. View hacks are gone | Priority hidden in lerp order; silent typos; `_cheat`, `_pitch`, `_camSide` | 3.6, 3.7 |
| I-10 | Moves as timelines with events (`hitOpen`, `footstep`, `land`…), hit volumes (sweeps plus a measured `hitShape`) and root-motion curves | Flat ground cones; `hitAt` depended on how the attack was built | 6.1 |
| I-11 | New animation capabilities: directional reactions, get-ups, ragdoll hand-off, foot planting, look-at and aim, hand IK, and an **ACTIONS** layer (multi-beat sequences with held contact frames) | Thin reactions; the "missing layer" named in ANIMATION-RESEARCH | 3.5, 6.2, 8.7, 10.2 |
| I-12 | 16 procedural creature building blocks, exercised by six fixture rigs (each block used by at least one) that pass their checks | Techniques trapped inside game characters | 10.1 |
| I-13 | Library format 2: a superset with events, contacts, props, hands, foot roll and root yaw. Clips baked to rotation tracks. A validator and a normalized lens. One file per clip. A split ledger. `x anim find`. Corrected licenses. CMU on demand (68 MB → 0 committed) | Point blending that shortened bones; pops `fit` cannot see; the license gap; 68 MB of churn | 8.1–8.6 |
| I-14 | Re-import from the original sources for the missing degrees of freedom: hands, forearm twist, foot roll, spine, root yaw | Fidelity never stored | 8.8 |
| I-15 | three.js r182, measured on the platform, with its quirks contained in one place each: the 1,000-instance uniform path and its buffer usage, and `positionLocal` after instancing | Workarounds scattered through the page; a pin chosen without measuring | 0.3, 2.1, 3.8 |
| I-16 | WebGPU required and checked at startup, with optional adapter features detected and every downgrade reported; no silent fallback to WebGL 2 | A blanket ban on compute, or silent fallbacks | 2.1, 11.1 |
| I-17 | A fixed light pool with a budget manager (the count never changes, so shaders never rebuild) plus a shadow-caster budget; tiled lighting on demand when the pool is not enough | 42 fixed lights in every lit shader | 7.1, 11.5 |
| I-18 | A warm-up registry using `compileAsync` with progress, plus a public pipeline counter. "Zero pipelines compiled after warm-up" becomes a test | Reading the private `renderer._pipelines`; stalls after filter toggles | 2.1 |
| I-19 | An instancing service that contains the pinned three.js's quirks: the uniform-buffer path, usage and colours set before the first render, update ranges | The instancing bug the prototype documented | 3.8 |
| I-20 | Procedural material library: seeded tiling generators with albedo, height, roughness and emissive; normals from height; mipmaps; pixel and smooth looks; TSL noise nodes; contact sheets | Seams, shimmer, two duplicated bakers | 2.3, 7.3 |
| I-21 | Puppet bodies as data (bones, sockets, mirrored parts, material slots), compiled to instanced parts or one rigid-skinned mesh per character, with optional smooth skinning | 1,225 draw calls; bodies written as code | 3.8, 5.4 |
| I-22 | A legend-driven level compiler with `validate()`: heights, stairs, slopes, galleries, a nav grid with climb limits, a Dijkstra flow field | Glyph meanings hard-coded in about a dozen places across two files | 2.2, 4.2, 4.3 |
| I-23 | Audio: pure-JS DSP (seeded and hashable), spatial audio, procedural reverb impulse responses, adaptive music layers, voice limits, variants, plus spectrograms and metrics for agents | No audio in 3D; a non-reproducible synth; untestable output | 9.1–9.5 |
| I-24 | Input intents: camera-relative movement, pointer lock, axes, rebinding as engine data, a virtual device, recording | Screen-space `move()`; 673 lines of game-side rebinding; tests pressing keys on a wall clock | 3.3 |
| I-25 | One `window.__engine` API, the same in Node: step, state, hash, trace, entities, a text scene dump, stats, shots with IDs, input injection, `describe`, `help()` | `__sw` and `__lab3d`, which were inconsistent | 1.6, 2.7 |
| I-26 | One CLI, `node x`, for what only this engine does: it prints 20 lines or fewer, writes `report.json` and returns exit codes 0/1/2, with shared `tools/lib` and a persistent inspect session. Everything else goes through npm scripts and the standard tools | 35 tools, 26 scripts, 19 copies of the browser-launch code | 0.2, 2.7 |
| I-27 | Test tiers (T0 and T1 in a quick gate of five minutes before every merge; T2 in the full run on GitHub after it, nobody waiting on it: ADR-0023) on Vitest and Playwright Test, with tests selected through Vite's module graph and run in parallel | 25 minutes, sequential; a hand-written map with holes | 0.5 |
| I-28 | Visual verification with no committed images and no display: ID pass, look metrics, text thumbnails, comparison against a base commit built in a worktree | PNG byte size as "not blank" | 2.6, 3.11 |
| I-29 | Numeric content QA with baselines: animation, geometry, texture tiling, audio, levels | Lints that never failed (the shipped `codex` still has 3 joint pops) | 2.2, 2.4, 6.6, 7.3, 8.6, 9.4 |
| I-30 | Docs from code: JSDoc file and export comments become a generated INDEX, API and ERRORS; `@example` blocks are executed; every public export and error code is documented; no duplicated prose | About 310 KB of docs with each core fact in about 4 places; drift | 0.6 |
| I-31 | Strict TypeScript checked by `tsc` against the pinned three.js and Rapier types (real types, with `moduleResolution: bundler`); ESLint's layer and banned-API rules; Prettier | No types; old-API mistakes found only at run time | 0.1, 0.4 |
| I-32 | Repo hygiene: no committed build output, a lockfile, the version in `package.json` only | 136 of 301 files were build output; 10 places to edit on every bump | 0.1 |
| I-33 | `x ci --local` as the merge gate from day one; since ADR-0023 the quick gate before each merge and the full run on GitHub after it, nobody waiting on it, a red main fixed first (`x ci --status`) | No CI; "merge, then run the full suite in the background" | 0.9 |
| I-34 | Claude Code integration: SessionStart, a fast check after each edit, write protection, a Stop gate, skills, and two subagents (`verifier`, `visual-reviewer`) | A SessionStart hook only | 0.10, 12.1 |
| I-35 | An MCP server, on the standard SDK, that bridges `__engine` for agents that cannot run `node x` | None | 7.6 |
| I-36 | Registries with schemas that feed `describe`, the inspector, content QA and docs, and later the gallery and scaffolds. Scaffolds pass every check and are re-tested | Schemas existed only as comments; templates could rot | 1.2, 12.1 |
| I-37 | One settings schema that generates URL parameters, `x set`, `__engine.set`, the benchmark settings line and JSON export (and a panel, if one is wanted) | `S`/`FX` mutations that sometimes never took effect; 14k tokens of hand-wired panel | 1.2, 2.7 |
| I-38 | A bot harness: a virtual device, navigation, a watchdog, stuck detection measured along the wanted direction, reproducible smoke runs | A bot inside the game only | 5.6 |
| I-39 | Performance budgets as counters (pipelines after warm-up, draw calls, texture and geometry counts, sim ms per step in Node) and a crowd ladder (100, 1,000, 5,000) | Headless fps, which is noise | 5.5, 5.7 |
| I-40 | Agent-usability evals (fresh-agent tasks) and mutation testing of the key suites | The suites themselves were never tested | 12.2 |
| I-41 | Advice and error codes with docs. Tests fail on new advice; allowed advice is listed with a reason | Free-text warnings | 1.2, 0.5 |
| I-42 | Version-pinned knowledge: the pinned packages' own sources and types, the TSL guide as it stood for r182 (wiki `6153b39`), a delta for agents who know newer releases, rename rules with replacements, deprecations failing tests | Models' priors drifting from the pinned version | 0.3, 0.4 |
| I-43 | **The Stress Box**: one integration target, grown in six stages, each proved by commands that need no display | A lab page whose proof run was its only test of play | 2.7, 3.10, 4.6, 5.7, 6.7, 7.8 |
| I-44 | Escalations with records (`x esc`): the owner is asked, a call is made after 15 minutes, and every escalation, later conflict and call can be found and reviewed | Decisions lost in chat; runs stalled on a question | 0.7 |
| I-45 | Dependency qualification (`x deps`): pins checked against publish dates, compatible releases adopted at once in their own commits, newer internals recorded with their measurement, and upgrades scheduled as lines qualify | Versions chosen for novelty | 0.3 |
| I-46 | One fixed MRT set up at startup, and one composite pass with every filter gated by a uniform: a filter toggle never recompiles a material, and r182's normal-based addons work | Black frames on r180's WebGPU (§4.7); a re-warm after every filter toggle | 7.4 |
| I-47 | Binary assets only with a recorded approval; fonts pre-approved | A blanket ban that left fonts and other approved needs no path | 0.4 |
| I-48 | The standard web toolchain behind npm scripts: Vite, Vitest, Playwright Test, ESLint, Prettier and tsx. Bespoke tools only where nothing established fits, each listed with its reason (ADR-0019) | A home-grown server, test runner, import-graph scanner, rule engine and vendoring | 0.2, 0.4, 0.5 |
| I-49 | Common ground outside, quality inside: game code meets familiar types and data (three.js's math, material and clip parameters agents know, `AnimationClip`s), while the internals use TSL, compute and custom systems wherever they measure better | Tuple math of our own; a private clip runtime; one quality bar for everything | 1.1, 2.3, 3.4, 3.8, 8.4 |
| I-50 | Game UI in HTML/CSS: the HUD, damage numbers and menus are DOM elements that tests read as text and boxes | A canvas overlay with a pixel font, checked by pixel | 6.5, 10.6 |
| I-51 | A public API boundary: game code imports only `engine/index.ts` and `engine/sim-api.ts`, every public export is documented, and every error names its fix in API terms | One shared scope; game code reaching into engine internals | 0.4, 1.6 |
| I-52 | Touch controls modelled on shardfall's (checked there only under phone emulation): a floating stick, a fan of HTML/CSS buttons, taps, holds and swipes, and lighter defaults on phones. Touch intents are recorded like any other. Built without tests, at the owner's order (ADR-0021) | The 2D engine's touch layer: a stick on one half of the screen (`engine:644-647`) and `Act:` buttons; nothing in 3D | 3.12 |
| I-53 | Every push deployed by Vercel, built from source, with a landing page that opens the box; no test or CI step of its own, at the owner's order (ADR-0021) | `vercel.json` serving committed build output | 0.12 |
| I-54 | A larger library from shardfall: 100STYLE's 878 stylized loops (CC BY 4.0, credited) and Quaternius' version 2, with each loop's capture `speed`, so it plays at the character's ground speed and switches between walk and run without flicker | 325 clips with few walking styles, and no record of how fast a loop travels | 8.4, 8.10 |

---

## 8. Tooling and testing: how agents see and prove their work

### 8.1 npm scripts for the standard tools, `node x` for the engine's own

**The front door is npm** (doctrine: Common ground). The standard tools run through the scripts every agent expects:

| Script | Runs | Tier |
|---|---|---|
| `npm run check` | `tsc -b tsconfig.check.json` (`npm run typecheck`), `eslint --cache .`, `prettier --check --cache .`, then `node x check` | T0 |
| `npm test [-- <path filters>]` | `vitest run`: unit tests, Node replays, content QA. A filter is a substring of a test file's path; one that matches nothing exits 1 | T1 |
| `npm run e2e [-- <spec files>]` | `playwright test`: the browser suites, on WebGPU | T2 |
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
- **Unknown flags and keys are errors.** An `x` command rejects an unknown flag with exit 2 and names the closest valid one (`parseArgs` in strict mode). Data files, URL parameters and `set` paths reject unknown keys the same way. Shardfall's main tools ignore them silently (`crates/pav_tools/src/tools.rs:664-667`); its first fresh-agent dry run listed them among 13 friction points (§4.8).

**Quick iteration.** Every command that runs a scene takes `--scene <name>` and `--set key=value` (validated against the settings schema), so an agent changes a tunable, runs, and reads numbers, without editing code: `x sim`, `x shot`, `x film` and `x perf`.

| Command | Purpose |
|---|---|
| `x help [cmd]` | Generated help |
| `x check` | The repository checks no standard tool covers, run inside `npm run check`: the asset scan, docs drift (`x docs --check`), escalation records, dependency pins (`x deps --check`) |
| `x sim <scene> [--steps n] [--seed s] [--set k=v…] [--script f] [--dump] [--feel] [--map]` | Run a scene headless in Node: hash, trace, state, event summary; the feel meter's report (WP 3.2); a text map of the nav grid (WP 4.3) |
| `x replay <file\|dir…> [--update] [--browser sim\|page] [--bisect]` | Replay in Node against the golden hashes; `--browser` also replays in Chromium against the same goldens: `sim` in the sim-only page, `page` in the scene's own page while it renders (WP 2.7). `--bisect` finds the first divergence |
| `x inspect [--page p]` | Keep one headless page open over the Vite dev server, for `x eval`, `x dump` and `x set` (and the MCP server, once WP 7.6 is built). `x shot` and `x film` reuse it when it runs. It reloads when Vite reports a change, and says so in its next reply |
| `x eval "<js>"` / `x dump [--step n]` | Talk to the inspect session: evaluate, or dump the scene and state as text |
| `x set <key> <value> [--scene s]` | Validate a setting against the schema; print it as a URL parameter and apply it to the inspect session |
| `x shot <page> [--scene s] [--cam code] [--set k=v…] [--ids] [--metrics] [--marks] [--png] [--thumb case [--update]]` | Render; read back a render target; write look metrics plus ID-pass stats (a PNG only with `--png` or `--marks`); `--marks` numbers what the ID pass sees, with a legend; `--thumb` compares a text thumbnail with its baseline and `--update` records it |
| `x film <page> --steps "…" [--scene s] [--seed s] [--compare <ref>]` | Filmstrip contact sheet, with a diff against `<ref>` (default `HEAD`) built in a temporary worktree |
| `x sheet <rig\|move\|clip>` | 3D sheet: states × cameras, plus numeric checks |
| `x gallery <kind> [id]` | Contact sheets and JSON from the registries' `gallery` fields (WP 7.7) |
| `x qa <family…> [--only <prefix…>]` | Content QA against per-family (and per-area) baselines. The families are `anim`, `geo`, `tex`, `audio` and `level` |
| `x perf <page\|scene> [--scene s] [--budget] [--ladder] [--feature f] [--set k=v…]` | Counters and timings against budgets; `--ladder` runs the crowd at 100, 1,000 and 5,000; `--feature` arrives with WP 11.1 (on demand) |
| `x describe <kind> [id]` | Registry listing: schema, ids, docs |
| `x new <kind> <id>` | Scaffold content that already passes every check, for the kinds that have a template (§8.13) |
| `x docs [--check\|--write]` | Generate and check INDEX, API and ERRORS; run `@example` blocks |
| `x deps [--check\|--update\|--qualify]` | Doctrine: Mastery. Check the pins offline; adopt compatible releases now; list lines that newly qualify (§6.10) |
| `x esc open\|list\|answer\|decide\|close …` | Escalations (§8.14) |
| `x src` | Prints and checks `$MY3D2DGE_SRC` and `$SHARDFALL_SRC`, the read-only source checkouts (WP 0.1) |
| `x ci --local` | Runs the CI steps locally: the merge gate (§8.9) |
| `x port refs [--check]` | Build reference vectors from my-3d2dge@e37e4ee for differential tests (WP 0.11) |
| `x mcp` | Start the MCP server (WP 7.6, on demand) |
| `x anim find\|show\|cut\|import\|cmu\|bake\|sheet …` | Animation library tools (§10, Phase 8) |
| `x audio <id> [--wav] [--spectrogram]` | Render a sound; metrics; optional files in `out/` (Phase 9) |
| `x evals [--dry-run]`, `x eye`, `x edition [--check]` | Agent-usability evals, the Node visibility raster, the optional reading edition (Phase 12, on demand) |

A command arrives with the WP that needs it; on-demand commands do not exist, even as stubs, until their WP is built. `x help` lists only what exists.

### 8.2 Test tiers with time budgets

| Tier | Contents | Budget | When |
|---|---|---|---|
| T0 `npm run check` | Types, ESLint, Prettier, and the repository checks: assets, docs drift, escalations, pins | the quick gate's | After every edit (the hook runs the per-file part) and at Stop |
| T1 `npm test` | Pure modules, animation, generators, the Rapier sim, Node replays, content QA | the quick gate's | Before every commit (`npm test -- --changed` while iterating) |
| T2 `npm run e2e` | Browser suites on WebGPU, in parallel: rendering, the CPU-only gameplay contract, the ID pass, the UI's DOM checks, pipeline counters | none: nobody waits on it (one worker per 4 cores, `t2Workers`; about an hour on 4) | In the full run, on GitHub after each merge; while working, only the specs for what only T2 checks that a change touched, or a failure being fixed (ADR-0023) |
| Long runs | Long replays, the kernel's perf budget, the crowd ladder, `--repeat-each 3` flake hunting | — | At each gate |

**Rules:**
- **Selection.** T1 selects through Vite's module graph: `vitest run --changed <base>` while iterating, `vitest related <files>` to see what covers a file. T2 runs in full whenever engine, lab or page code changed, because page code reaches the browser through the dev server rather than through the specs' imports. When only specs or their helpers changed, `--only-changed <base>` is enough.
- **The base** is the merge-base with `origin/main` once `main` holds a gate, and otherwise the commit recorded in `out/ci/last-green` by the last green `x ci --local`.
- **Budgets.** One: the quick gate's steps together (`x ci --local`: npm ci, x src, T0, T1, x port refs --check) within five minutes (tools/lib/tierBudgets.ts `GATE_BUDGET_MS`, ADR-0023); over it warns, and wall-clock time never fails a gate (ADR-0022).
- **T0 costs what a change reaches** (ADR-0014, amendment 7). Its type check is `tsc -b` over three composite projects (`tsconfig.check.json`: the engine, the code that runs on it, the unit tests) that keep their declarations in `node_modules/.cache/tsc/`, so an unchanged project is skipped and a change re-checks only the files it can reach. Together the projects hold exactly `tsconfig.json`'s files, which `tsc --noEmit` still checks as one program.
- **Browser work is T2.** A test that drives Chromium, even through a child Playwright, is a spec in `tests/e2e/`, never a Vitest test; T1 runs one Vitest worker per core.
- A test that waits on wall-clock time is a bug. Tests step the engine (`step(n)`) on a virtual clock.
- A flaky test is quarantined only through a WP that fixes it. Skipping a test to get green is forbidden.
- Tests run on the development platform only (doctrine: Discovery first): Node 24 and headless Chromium 141, with WebGPU on SwiftShader.

### 8.3 `window.__engine`: one inspector API, also headless (`createHeadless`) minus the rendering members

| Area | API |
|---|---|
| Identity and health | `info()` → `{ version, runtime, adapter, features, downgrades, deps }`, `ready`, `errors[]` (structured records), `advice[]` (warn-once records with codes) |
| Time | `pause()`, `resume()`, `step(n, intents?)`, `render()`, `timeScale(k)`, `seed(n)` |
| State | `state(query?)`, `hash()`, `trace()`, `entities(query)`, `get(id)`, `set(path, value)` (settings schema only; validated), `capture()` and `restore(c)` (the whole sim, §6.5), `describe(kind?, id?)` (the registries, as `x describe`) |
| Scene | `scene.dump({ depth, filter })` → a text tree (name, type, visible, position, bounds, material, triangles); `camera.get()`, `camera.set(code)` |
| Rendering | `stats()` → `{ simMs, physicsMs, animMs, renderMs, steps, frames, drawCalls, triangles, computeCalls, textures, geometries, pipelines, pipelinesAfterWarmUp, gpuMs? }` (means of the last 60 steps or frames; `gpuMs` arrives with the timestamp-query WP) |
| Shots | `shot({ ids, metrics, thumbnail, size })`, through a render target and `readRenderTargetPixelsAsync` |
| Input | `input.press(action)`, `input.hold(action, down)`, `input.axis(name, value)`, `input.play(script)`, `input.record()`, `input.state()` |
| Feel | `feel(id?)` → an actor's feel meter report (WP 3.2) |
| Animation | `anim(id?)` → an animated actor's animator as `Animator.inspect()` JSON: weights, the layer stack slot by slot, effectors, sockets, events, trail (WP 3.7's member, delivered at gate G3's review) |
| Dev actions | `actions.list()`, `actions.run(id, args)`: god mode, freeze AI, spawn, travel, time scale (WP 5.6, on demand) |
| Bot | `bot(plan)`: the player played to goals, a tour and back, until a condition, with a sampled trace; with `seeds`, a sweep of fresh runs (WP 5.6) |
| Help | `help()`: every member, one line each (checked against the API by `x docs --check`) |

**Members are registered, never edited in.** `engine/dev/inspector.ts` assembles `__engine` from the members registered with `def('inspectorMember', name, { args, help, impl })` through `core/registry`. Each WP registers its own members from its own files (`input` in WP 3.3, `stats` in WP 5.5, `actions` in WP 5.6), so no two WPs edit the inspector, and no layer imports `dev/`.

**Headless.** In Node, `createHeadless` returns the same object. With `view: true` it also builds the presentation scene graph, which needs no GPU (§4.8), so `scene.dump()` and `camera` work in Node and view logic is tested in T1. Only `render` and `shot` throw a coded "no renderer" error.

Every page signals `ready` or `error` within a timeout. That turns a startup crash into one line instead of a hang.

### 8.4 Replays

```json
{ "format": "my3dge-replay/1", "engine": "0.4.0", "three": "0.182.0", "rapier": "simd-compat 0.21.0",
  "scene": "box:room", "settings": { "crowd": 0 }, "seed": 1, "hz": 60, "steps": 600,
  "inputs": [[0, { "move": [0, 1], "cam": 0.785 }], [30, { "move": [1, 0], "b": ["attack"] }], [42, { "b": [] }]],
  "hashes": { "linux-x64": { "60": "9f2c…", "120": "…", "600": "…" } } }
```

- **Inputs** are change-points only, so the file stays small and diff-friendly.
- **Golden hashes are keyed by platform** (§6.5): one set per replay, valid in Node and in Chromium alike.
- **Bisect.** `x replay --bisect` reruns with per-step traces until the first divergence, then prints the step, the entity and the component fields that differ.
- **Recording live play.** The engine keeps every step's intents from the start of the scene (change-points only, so a long session stays small), and `__engine.input.record()` saves them as a replay from step 0. The file is text, and no capture is needed. Every bug report about behaviour becomes a replay test.
- **Setting changes and dev actions are recorded too**, as change-points at their step (`[240, { "set": { "crowd.speed": 4 } }]`), so a session in which an agent tuned a value mid-run still replays exactly. Shardfall's tool replays store the settings only as they stand when saved (`crates/pav_tools/src/tools.rs:1030`), and its game's replays store none, so a value changed mid-run does not replay (§4.8). Settings marked `view` (WP 1.2) are not recorded: they never change play.

### 8.5 Visual verification without committed images or a display

1. **ID pass.**
   - Flat, unlit, per-object colours; no antialiasing; read back.
   - The result is `visible: [{ id, name, px, bbox }]`, so an agent reads "the hero covers 0 px" or "one object covers 71%: the camera is inside a wall" as text.
   - Gameplay entities in view must appear in it (§6.7).
2. **Look metrics** for every frame, as JSON:
   - coverage against empty space;
   - luma spread (P5 to P95);
   - dark and blown-out fractions;
   - colour count;
   - the largest object's share;
   - whether the protagonist is visible;
   - edge density.
   Failures are written as "number plus suggested fix", the style of the prototype's `check.mjs`.
3. **Text thumbnails.** A 48×27 hex-colour grid per case, stored as JSON in `tests/baselines/`. It can be compared per cell with a tolerance, and read as a coarse map. Playwright's screenshot assertions are not used for baselines, because they commit PNG files (doctrine: Assets).
4. **Compare with a base.** `x film --compare <ref>` (default `HEAD`) builds the ref in a temporary `git worktree` and renders the same steps. The diff report gives bounding boxes and attribution from the ID pass ("93% of the changed pixels are on `hero`"). When the base lacks the scene, it reports "no baseline" as a deferred proof instead of failing.
5. **Images on demand only.** Contact sheets are capped at 1,600 px wide, with labels and diff boxes. Reviewing them is delegated to the `visual-reviewer` subagent, which returns a JSON verdict and keeps image tokens out of the main context. `x shot --marks` numbers the objects the ID pass sees and lists them in a legend, so a reviewer can say "mark 7" and the JSON says what it is (shardfall's `see`). Images are also how humans watching from afar see the work (§11.5).
6. **UI through the DOM.** HTML/CSS UI is checked with DOM queries: text, visibility, bounding boxes, and whether it covers the protagonist in the ID pass.

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
- **Draw calls, triangles, and texture and geometry counts** (`renderer.info`) are capped per box scene. WebGPU's `renderer.info` has no byte totals and no program count; pipelines are counted by the pipeline counter.
- **Sim time.** `sim.step` in milliseconds at 100, 1,000 and 5,000 crowd agents (`x perf --ladder`), measured in Node with the median of 5 runs, checked against budgets with a tolerance. The prototype's figures (1, 5.6 and 33 ms per step) are context; the budgets are the box's own measurements on the development platform, recorded in WP 5.7.
- Budgets live in one file per scene or area under `tests/baselines/perf/`, owned by the WP that records them.
- **Trends.** Each gate records `out/perf/trend.json` and flags any regression over 15%.

### 8.8 The headless browser recipe

- **In this cloud container:**
  - Chromium 141 at `/opt/pw-browsers/chromium` (`chromium-1194`), launched by Playwright 1.64 through `launchOptions.executablePath`. `CHROMIUM_PATH` overrides the path. Nothing runs `playwright install`.
  - WebGPU via SwiftShader, with shardfall's flags: `--enable-unsafe-webgpu --enable-features=Vulkan --use-vulkan=swiftshader --use-angle=swiftshader`, set in the Playwright project. With them, headless Chromium presents frames to the real canvas (§4.8).
  - The prototype's stand-in `getContext('webgpu')` (`tools/lab3d-test.mjs:70-102`) is therefore not used. It stays in the source checkout as the fallback if a Chromium update brings the device loss back.
- **In GitHub Actions** (WP 0.9, ADR-0016 amendment 1): ubuntu-24.04 set up as a fresh machine is, by `scripts/setup.sh`, whose Chrome for Testing is the same build 141 (tools/deps.json's 141.0.7390.37), with Playwright's system libraries (`npx playwright install-deps chromium`) and Node from `.nvmrc`; WebGPU runs on SwiftShader there with the same flags (§8.9: the workflow runs green). Mesa lavapipe (`mesa-vulkan-drivers`) plus `xvfb-run` only if SwiftShader is ever unavailable there.
- **Every suite asserts, through the fixture:**
  - that WebGPU actually ran (the renderer's backend and the adapter info);
  - that the frame is not blank;
  - that the virtual clock is installed.
- **There is no second backend to fall back on.** If an environment update breaks WebGPU on SwiftShader, T2 stops: `x ci --local` names the cause, and the agent escalates (R3).
- **Page errors name the source.** The fixture maps every page error's stack through Vite's inline source maps (`node:module`'s `SourceMap`), so it names `.ts` files and lines.
- **Shots** go through a render target and `readRenderTargetPixelsAsync`, never `toDataURL` on a WebGPU canvas.
- **Baselines** are keyed by platform, like the golden hashes.

### 8.9 Continuous integration

- **`x ci --local` is the merge gate** from day one: `npm ci`, `x src`, `npm run check` (which includes `x deps --check` and `x docs --check`), `npm test` and `x port refs --check`, the quick gate, a few minutes. **`x ci --local --full` is the full run**: the same steps, `x new --test-all` (§8.13) and `npm run e2e` in full (about an hour on 4 cores), which nobody waits on (ADR-0023, the owner's calls of 2026-10-15). Both write a summary to `out/ci/summary.md` and record a green commit in `out/ci/last-green`.
- **GitHub Actions runs it too** (after G9: ESC-0001 answered yes on 2026-10-14, ADR-0016 amendment 1). `.github/workflows/ci.yml` (WP 0.9) runs the full run, `node x ci --local --full`, after each merge to main and by hand (on pull requests until ADR-0023), one run per merge and none cancelled, within 120 minutes, on ubuntu-24.04 built as a fresh machine is: both sources at their pinned commits, Node from `.nvmrc` and `scripts/setup.sh`, whose Chrome for Testing is tools/deps.json's Chromium (rather than the Playwright container of §8.8: the platform's own install path), uploading `out/**` as artifacts and writing out/ci/summary.md to `$GITHUB_STEP_SUMMARY` and to the job's log (GitHub's API serves an agent the log, not the step summary); `tools/cmd/ci-workflow.test.ts` keeps its command, commits, Node and Chromium equal to the platform's. Before it existed, GitHub rejected a push holding a file under `.github/workflows/` without the token's `workflow` scope, so nothing was written in advance (doctrine: North Star). Its first run failed one T2 test, as `x ci --local` did: two leaks between suites in the one Playwright worker, both new after G9 (examples.spec.ts's Node examples, fixed in 7d256f3, and x shot's import of tools/cmd/sim.ts, fixed in 1e5d6dd); its first green run was on PR #14 (run 38679570559, 2026-10-15, 72 min), and ESC-0001 is closed.
- **The merge gate since ADR-0023** (2026-10-15; from the workflow's first green run until then, its `ci` check on the PR as well, ADR-0016 amendment 1): the quick gate green on the PR's head, which agents run before every merge (ADR-0021). The full run follows on main after the merge, nobody waiting on it; `node x ci --status` (tools/lib/ciStatus.ts), which the SessionStart hook runs, reads main's last one, and a red main is fixed before other work. At the end of a goal or a stage the agent waits for it and reports it. The `ci` check is not required: the owner declined branch protection (§11.5).
- **Long runs** (§8.2) run at each gate.
- **Vercel builds every push** (WP 0.12), except while the owner has it paused (from 2026-10-15 until they test, ADR-0023: no look, its statuses and errors ignored). It is not a test, and nothing in `x ci --local` checks it (the owner's order, ADR-0021). A failed Vercel build seen on a stage PR (§11.1), or one the owner reports, is reproduced in a clean checkout of the pushed commit with `npm ci && npm run build` on Node 24 (Vercel builds only what git holds), fixed and pushed; the local build is the proof, and the next stage PR's one look shows Vercel's result. If it does not fail there, the agent asks the owner for Vercel's build log (an escalation, §8.14), since reading it needs a Vercel login. Problems on phones or in the deployed pages are fixed when the owner reports them.

### 8.10 Claude Code integration

- **`AGENTS.md`** is canonical and tool-agnostic, about 150 lines or fewer (draft in Appendix E). **`CLAUDE.md`** is `@AGENTS.md` plus Claude-specific notes.
- **`.claude/settings.json`:**

  | Hook or setting | Does |
  |---|---|
  | SessionStart | Runs `scripts/setup.sh`: installs Node 24.22.1 if the container lacks it and appends its `PATH` to `$CLAUDE_ENV_FILE`, so later Bash calls use it; then `npm ci`. Resolves the sources (`x src`) and appends `MY3D2DGE_SRC=<absolute path>` and `SHARDFALL_SRC=<absolute path>` to `$CLAUDE_ENV_FILE`. Lists open escalations, and compatible releases waiting to be adopted (`x deps --update --dry-run`) |
  | PostToolUse on `Edit\|Write` | `prettier --write`, then `eslint --cache`, on the edited file. Exits 2 with the errors so the agent sees them at once |
  | PreToolUse | Asks the owner before any edit to `DOCTRINE.md` (`permissionDecision: "ask"`), so the doctrine changes only on the owner's word. Denies hand edits to `out/` and `node_modules/`, and force-pushes to `main` |
  | Stop | Runs `npm run check`. Exit 2 with a short reason if red, honouring `stop_hook_active` to avoid loops. Warns about an open escalation past its deadline with no recorded call |
  | `permissions.allow` | `Bash(node x *)`, `Bash(npm run *)`, `Bash(npm test*)`, `Bash(npm ci)`, `Bash(npx vitest *)`, `Bash(npx playwright test*)`, read-only git, and, since they need no approval under ADR-0021, `Bash(git add *)`, `Bash(git commit *)`, `Bash(git push *)`, `Bash(gh pr *)` and the GitHub MCP server's pull-request tools. The PreToolUse hook still denies force-pushes to `main` |

- **Skills** (`.claude/skills/`, loaded on demand; names never carry a version, so an upgrade renames nothing):

  | Skill | What it carries |
  |---|---|
  | `x-loop` | The edit → check → test → report loop |
  | `three-webgpu` | The pinned three.js's idioms: the material parameters and math classes game code meets; TSL, compute and node post for the internals; banned APIs and their replacements; the delta from newer releases |
  | `rapier` | Rapier under the reproducibility contract, captures included, and the traps measured in §4.8: `timeOfImpact` on rays, `time_of_impact` on shape casts and `toi` on controller collisions; `castShape`'s `targetDistance` argument; the controller's across-then-down move; autostep climbing about 5 cm above its setting |
  | `determinism-debugging` | Replay bisect; reading a trace diff; Node against Chromium |
  | `escalation` | When to escalate, the 15-minute rule, `x esc` (§8.14) |
  | `stress-box` | How the box is organized, how to add a scene or a variant, the iteration loop |
  | `animation-authoring` | Effector-space authoring, moves, clips, actions, content QA |
  | `visual-qa` | The metrics, the ID pass, thumbnails |
  | `perf-budgets` | Budgets and how to meet them |
  | `add-<kind>` | Mirrors `x new`, one per kind with a template (§8.13) |

- **Subagents** (`.claude/agents/`):

  | Subagent | Job |
  |---|---|
  | `verifier` | Runs a WP's Verify commands, re-reads the diff adversarially against `DOCTRINE.md` and the WP's Done-when list, and returns pass or fail with reasons. Of every public API it asks "would a game agent recognize this?"; of every internal, "is this the best approach we can execute well, and does it stay behind the API?". It reviews L-size WPs and every gate (§9.3) |
  | `visual-reviewer` | Reads images and returns a JSON verdict |

  More subagents arrive only when a measured need appears (WP 12.1). Long suites run as Claude Code background tasks, and the pinned types answer API questions: `tsc` turns a name the pinned release lacks into an error.

### 8.11 The MCP bridge (WP 7.6, on demand)

**Built when an agent that cannot run `node x` needs to drive the engine** (a client without a shell, or another agent framework). Until then `x inspect`, `x eval`, `x dump` and `x set` serve agents.

- **What it is.** `x mcp` starts a server, built on the official `@modelcontextprotocol/sdk`, over a persistent `x inspect` session. Its tools are generated from the inspector members' argument schemas (WP 1.6), as shardfall generates its MCP schemas from its tool table (§5.8). It restarts when engine sources change, because a running server keeps serving old code.
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

`x docs --check` covers file and export comments, AGENTS.md and `docs/*.md`. It skips `DOCTRINE.md`, `docs/research/`, `docs/reference/` and `docs/escalations/`. Source citations are written `my-3d2dge:<path>[:line]` or `shardfall:<path>[:line]`, and are checked against `$MY3D2DGE_SRC` and `$SHARDFALL_SRC`.

It fails when:
- an `@example` does not run;
- a path or name the docs mention does not exist;
- a public export (anything `engine/index.ts` or `engine/sim-api.ts` exports) lacks its doc comment, or an error or advice code lacks its fix;
- INDEX, API or ERRORS are stale;
- `help()` differs from the inspector's API.

**`docs/API.md` is the game agent's manual** (doctrine: Quality under the hood). It covers the public API completely, so a game agent never needs to open engine code, even when something goes wrong. INDEX maps the internals for the agents who maintain the engine.

The engine's own version lives in `package.json` only, and prose never repeats it.

### 8.13 Scaffolding

`x new <kind> <id>` writes a working entry, a test and a file comment from the template in `tools/templates/<kind>/`, runs the relevant checks and prints the summary. `x ci --local` runs every template (`x new … --test`), so templates cannot rot.

**Templates arrive with use** (doctrine: North Star):
- `module` (WP 0.6) and `scene` (a box scene or variant, WP 2.7) come first, because agents create them constantly.
- Any other kind gets its template when an agent writes the third entry of that kind by hand; the WP that writes it adds the template. The likely ones are `material`, `prop`, `body`, `move` and `level`; Phases 8–9 bring `action` (WP 8.7), `sfx` and `song` (WP 9.2), and on-demand WPs bring `rig --block legGait` (WP 10.1). A game itself is no `x new` kind: it comes from `node tools/game/new-game.mjs`, which runs before anything is installed (WP 10.7, ADR-0024).
- WP 12.1 (on demand) completes the set and the `add-<kind>` skills. Once the gallery exists (WP 7.7), templates also write a `gallery` hook.

### 8.14 Escalations (doctrine: Escalation)

**When to escalate.** An action needs the owner's approval, or a principle cannot be satisfied:
- adding a binary file other than a font (doctrine: Assets);
- a new runtime dependency, or any dependency outside the rule of §6.10 (doctrines: Common ground, Mastery);
- a repository setting, secret, token, deploy, publication or other outward action; rewriting published history. **Pre-approved by the owner (ADR-0021):** pushing (at each milestone, and the session's branch whenever that protects work), opening and merging pull requests, deleting their branches after the merge, and the Vercel deployments that pushes trigger;
- spending money (a paid service, API or plan);
- any case where following a principle would break another, or cannot be done (for example, a GPU effect that would change play);
- any case where going against the doctrine or this plan looks best (doctrine: How to read this): escalate with the reasoning, and keep to the doctrine while waiting.

Everything else is decided by the agent and recorded as an ADR amendment (§11.4), without waiting.

**How.**
1. `x esc open "<question>" --principle Assets --option "…" --option "…" --recommend 1` writes `docs/escalations/ESC-NNNN-<slug>.md` with status `open`, the time raised, a deadline 15 minutes later, the options and the recommendation, and prints a short message.
2. Post that message where the owner is watching: the session's chat, or the PR. Then wait. In a Claude Code cloud session, schedule a check-in for the deadline (`send_later`) and end the turn; an answer that arrives first resumes the session.
3. **Never perform the action while waiting.** Meanwhile, take the doctrine's preferred alternative: procedural or text instead of binary, or a stub behind the feature registry.
4. **An answer arrives:** `x esc answer ESC-NNNN "<answer>"`, then act on it.
5. **No answer by the deadline:** commit the current work, decide, `x esc decide ESC-NNNN --call "<what was done and why>" --commit <sha>`, and continue. The record's status becomes `decided-in-absence`.
6. **For the rest of that run** (the session or workflow run), or until the owner answers, further conflicts are reported in chat without stopping, and each is still recorded with `x esc open … --no-wait` and `x esc decide`.
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
- `README.md`: what each scene shows, which suites cover it, and the settings that tune it. A test checks that every setting, file and command it names exists, as shardfall's station guides are checked (§5.8).

**The stages.** Each stage is a phase, and its gate is the "box can" column.

| Stage (phase, gate) | Scenes | The box can… | Proved by |
|---|---|---|---|
| Box 1 (2, G2) | `room` | render on WebGPU, step headless, be inspected and set | `x sim` golden hashes; `x shot` ID pass and metrics; 0 pipelines after warm-up |
| Box 2 (3, G3) | `room-hero` | let a hero walk, dash and jump onto a low wall; follow it with every camera; be filmed and compared | replays give their golden hashes in Node and in the rendering page; live play replays in Node; the humanoid's differential tests; `x film` |
| Box 3 (4, G4) | `hall`, `hall-props` | let the hero climb stairs to a gallery, and push and knock 10–300 crates and barrels | level validation; nav coverage; replays in Node and in the rendering page |
| Box 4 (5, G5) | `crowd-100`, `crowd-1000`, `crowd-5000` | fill with walkers, slimes and wisps that chase the hero up the stairs | the perf ladder within budgets; 0 pipelines as the crowd grows; scripted crowd replays |
| Box 5 (6, G6) | `fight`, `fight-1000` | fight: moves, hits, knockback, launches, deaths, corpses, telegraphs, particles, trails, damage numbers in HTML/CSS | scripted fight replays (≥ 3 deaths, a launch); the hash unchanged with effects off; animation QA; the UI through DOM queries |
| Box 6 (7, G7) | every scene, every look | look torch-lit, toon-shaded and filtered | every look with 0 pipelines after warm-up; no look changes the hash; the benchmark report |

**Rules for the box:**
- **Similar, not identical.** The prototype's numbers (Appendix C) are starting values. Behaviour, feel and tuning change freely, and a change records its reason in the scene or cast data. The only checks against the prototype are the ported math's differential tests (WPs 1.1, 3.6, 5.3, 6.1 and 8.2). They make sure the motion survives translation; after that it is ours to change, with the reference vectors as a baseline.
- **Engine, not game.** The box's cast, behaviours and numbers stay in `labs/box/`. A mechanism moves into `engine/` only through a WP that names it, and only in a generic form.
- **Every stage ends runnable and measured.** A gate is green only when its scenes run headless and in their page on WebGPU, and their numbers are recorded.
- **Grow by need.** A stage adds a scene or a variant (`stairs`, `crowd-arena`…) whenever a system needs exercising. A variant is a new file or a settings preset, never a change of meaning in a passing one.
- **The quick loop.** Change a setting (`--set`) or a scene → `x sim` (hash, events) → `x shot` (numbers, and a picture on demand) → `x film --compare HEAD` (from Box 2) → `x perf` → commit.

### 9.1 Phases at a glance

| Phase | Goal | Lanes | Ends at gate | Runs |
|---|---|---|---|---|
| 0 Foundation | The repo can check, test, document, pin, escalate and deploy before any engine code exists | T | **G0** | Sequential |
| 1 Kernel | Reproducible kernel: math (with the sim's deterministic math), time, registry, world, scenes, hash, replay, headless runs, the public API | C | **G1** | Sequential |
| 2 Box 1: render and step | The renderer (WebGPU only), level compiler, materials and textures, geometry and level meshes, cameras, shots and the ID pass, the box app | R, W, T, B | **G2** | Parallel lanes |
| 3 Box 2: a hero | Rapier, the controller, input and touch controls, skeleton, IK, the humanoid, the animator, puppets, more cameras, film | P, I, A, R, T, B | **G3** | Parallel lanes |
| 4 Box 3: the hall | Bodies, level compiler v2, navigation, level meshes v2 and cutaway, props | P, W, R, B | **G4** | Parallel lanes |
| 5 Box 4: a crowd | Crowd bodies, steering, blob and floater rigs, crowd rendering, perf counters | P, W, A, R, T, B | **G5** | Parallel lanes |
| 6 Box 5: combat | Moves, reactions, combat helpers, effects, the HTML/CSS overlay, animation checks | A, W, R, I, B | **G6** | Parallel lanes |
| 7 Box 6: the look | Lights and shadows, materials v2 (toon, outlines), textures v2, post | R, W, B | **G7: the Stress Box** | Parallel lanes |
| 8 Animation library | Provenance, codec, sets (with 100STYLE and Quaternius v2 from shardfall), baker and clip layer, tools, tests, actions, clip mode in the box | L | **G8** | May start after G0 (8.1) and WP 1.1 (8.2); never delays a box stage |
| 9 Audio | DSP, data, runtime, tools, sound in the box | X | **G9** | May start after G1; never delays a box stage |
| On demand | 21 WPs: the bot and dev actions, the governor, MCP, the gallery, the source re-import, and Phases 10–12 (expansions, advanced GPU features, more agent tooling) | as each phase | Each WP's own **Done when** | Each starts only when its trigger is measured (below); Phase 13's playground fires all 21 (ADR-0025) |
| 13 The Playground | A house on a block where the player moves as in Apex Legends, in five cameras and two looks (docs/PLAYGROUND.md), with the on-demand WPs it fires | B, P, A, R, I, W, X, T, and R2 and L for the fired WPs | **G10** feel, **G11** the house, **G12** alive, **G13: the tech demo** | Four stages in Phase 13's order; parallel lanes inside each stage |
| H Production hardening | Other browsers, testing on phones, a native WebGPU build, releases, cross-platform determinism | — | — | Only when a game goes to production |

Lanes: **T** tooling, **C** core, **R** render, **W** world, **P** physics, **A** animation, **I** input, UI and dev, **B** the box (the integrator), **L** library, **X** audio, **R2** advanced GPU features.

**On demand** (doctrine: North Star: solve problems when they actually surface). These WPs are fully specified, so an agent can build one the day it is needed, but none is scheduled. Each starts when its trigger is measured:

| WP | Start it when… |
|---|---|
| 5.6 The bot and dev actions | a test needs play longer or more varied than a scripted replay can express (soak runs, navigation smoke over many levels), or reaching a state by replay costs more than a dev action would (fired 2026-10-17 by the playground: the gym's courses and the house need soak runs, and tuning needs teleports and slow motion; ADR-0025) |
| 7.5 The performance governor | a scene must hold a frame budget on hardware that varies (Phase H), a measured scene misses its GPU budget and a quality tier would fix it, or the owner reports a scene running slowly on a phone (ADR-0021) (fired 2026-10-17 by the playground: the playground must hold its frame budget on the owner's hardware with WPs 11.3 and 11.5 on; ADR-0025) |
| 7.6 MCP server | an agent that cannot run `node x` needs to drive the engine (fired 2026-10-17 by the playground: the owner's order: an agent playtester drives the playground through MCP; ADR-0025) |
| 7.7 The gallery | reviewing a kind's entries one `x shot` at a time costs more than one contact sheet would: about 20 entries of a kind that need visual review (fired 2026-10-17 by the playground: about 40 props and the building materials need visual review; ADR-0025) |
| 8.8 Re-import from the sources | a clip needs a degree of freedom format 1 lacks (hands, forearm twist, foot roll, spine, root yaw) to fix a defect that can be seen or measured (fired 2026-10-17 by the playground: the playground's mantles, climbs, ladders and ziplines need hands on their contacts, and its locomotion foot roll; ADR-0025) |
| 10.1 Procedural building blocks | the box or the game needs a creature beyond the humanoid, blob and floater rigs (fired 2026-10-17 by the playground: the playground's dog; ADR-0025) |
| 10.2 Ragdolls | deaths or launches need physical bodies that reactions and get-ups cannot fake (fired 2026-10-17 by the playground: dummies and neighbours fall to hard hits and kicks; ADR-0025) |
| 10.3 The props library | the box or the game needs props beyond crates and barrels (fired 2026-10-17 by the playground: the house needs doors, windows and furniture; ADR-0025) |
| 10.4 Generic gameplay kits | the game needs hittable things, projectile patterns or awareness beyond WP 5.2's basics (fired 2026-10-17 by the playground: the range's targets and the neighbours' awareness; ADR-0025) |
| 10.5 Terrain | the game needs outdoor ground (fired 2026-10-17 by the playground: the yard and the hill; ADR-0025) |
| 10.6 UI widgets | the game needs menus, dialogs or HUD widgets beyond the overlay's (fired 2026-10-17 by the playground: the playground's settings, prompts and HUD; ADR-0025) |
| 10.7 The game template | the owner starts the game (fired 2026-10-15, done: ADR-0024) |
| 10.8 Lab pages | someone watching needs a view that the `x` commands and the box do not give (fired 2026-10-17 by the playground: the owner tunes animation and feel in pages; ADR-0025) |
| 10.9 The store | a game saves state across sessions: high scores, progress, its settings (fired 2026-10-17 by the playground: the playground keeps its settings and bindings across sessions; ADR-0025) |
| 11.1 Completing the feature framework | the first of WPs 11.2–11.5 is triggered: it is their common Need (fired 2026-10-17 by the playground: the first of WPs 11.2–11.5 fired; ADR-0025) |
| 11.2 GPU timing | a performance question needs GPU time (the platform's adapter has `timestamp-query`, §4.7) (fired 2026-10-17 by the playground: the owner's GPU frame time in the playground; ADR-0025) |
| 11.3 GPU particles | the CPU particles of WP 6.4 exceed their budget in the box's densest fight, or a look needs more particles than the CPU path carries (fired 2026-10-17 by the playground: rain, dust and debris beyond the CPU particles; ADR-0025) |
| 11.4 GPU-driven crowds | the crowd ladder's render cost at 5,000 misses its budget (WP 5.7's numbers) (fired 2026-10-17 by the playground: the street's crowd variant at 1,000 to 5,000 people; ADR-0025) |
| 11.5 Lighting and shading upgrades | a look the box needs is beyond the light pool and the standard passes: more lights, ambient occlusion, reflections, cascaded shadows (fired 2026-10-17 by the playground: the house's lights beyond the pool, cascaded shadows over the yard, ambient occlusion indoors; ADR-0025) |
| 12.1 Scaffolds and skills, completed | agents keep writing by hand a kind that has no template, or keep repeating work no skill covers (fired 2026-10-17 by the playground: the new kinds (movement profiles, camera modes, storey levels, interactables, weapons) and the playground's skills; ADR-0025) |
| 12.2 Agent-usability evals and mutation testing | a regression slips past the suites, or agents repeatedly misuse an API (fired 2026-10-17 by the playground: the owner's order: usability tasks over the playground, and mutation testing; ADR-0025) |
| 12.3 Agent eye | image review costs more than it gives, and the ID pass cannot answer the question in Node (fired 2026-10-17 by the playground: whether the player is in view from each camera in every room, asked in Node; ADR-0025) |
| 12.4 Reading edition | an agent without the repository needs the engine's API in one file (fired 2026-10-15, done as docs/GAME-GUIDE.md: ADR-0024) |

**How a trigger fires.** The agent that meets a trigger records the measurement in the WP's ledger note, and schedules the WP after the current one (never mid-WP). A triggered WP builds its unbuilt **Needs** first. It is then done like any other WP; on-demand work has no phase gates. A trigger that never fires means the WP was not needed, which is the expected outcome for several of them.

### 9.2 Dependency graph

Each WP below repeats its direct dependencies in a **Needs** line. Edges in brackets are sources from other stages.

```
Phase 0:  0.1 → 0.2 → {0.4, 0.11} ; 0.4 → {0.3, 0.5, 0.6, 0.7} ; {0.3, 0.5, 0.6} → 0.8 ; {0.8, 0.11} → 0.9 ; 0.8 → 0.12 ; {0.7, 0.9} → 0.10 ⇒ G0
Phase 1:  G0 → 1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6 ⇒ G1
Box 1:    G1 → 2.1 → {2.3, 2.5, 2.6} ; G1 → 2.2 ; {2.2, 2.3} → 2.4 ; {2.4, 2.5, 2.6} → 2.7 ⇒ G2
Box 2:    [2.2] → 3.1 → 3.2 ; [1.5, 2.5] → 3.3 ; G1 → 3.4 → 3.5 → 3.6 ; {3.2, 3.6} → 3.7 ; [2.4, 2.6] + 3.4 → 3.8 ;
          [2.5] + {3.1, 3.4} → 3.9 ; [2.7] + 3.3 → {3.11, 3.12} ; [2.7] + {3.3, 3.7, 3.8, 3.9, 3.11, 3.12} → 3.10 ⇒ G3
Box 3:    [3.2] → 4.1 ; [3.1] → 4.2 ; [3.2] + 4.2 → 4.3 ; [2.4] + 4.2 → 4.4 ; [3.8] + 4.1 → 4.5 ; [3.10] + {4.3, 4.4, 4.5} → 4.6 ⇒ G4
Box 4:    [4.1] → 5.1 ; [4.3] + 5.1 → 5.2 ; [3.7] → 5.3 ; [3.8] + 5.3 → 5.4 ; [2.7] + 5.1 → 5.5 ;
          [4.6] + {5.2, 5.4, 5.5} → 5.7 ⇒ G5
Box 5:    [3.7] → 6.1 → 6.2 ; [5.1] + 6.1 → 6.3 ; [3.8] + 6.1 → 6.4 ; [2.7, 3.12] → 6.5 ; [5.3] + 6.2 → 6.6 ;
          [5.7] + {6.3, 6.4, 6.5, 6.6} → 6.7 ⇒ G6
Box 6:    [2.3, 3.12, 4.2] → 7.1 ; [3.8] → 7.2 ; [2.3, 4.2] → 7.3 ; [2.6, 3.12] + 7.2 → 7.4 ;
          [6.7] + {7.1, 7.2, 7.3, 7.4} → 7.8 ⇒ G7 (the Stress Box)
Library:  G0 → 8.1 ; [0.11, 1.1] → 8.2 → 8.3 ; {8.1, 8.3} → 8.10 ; [3.7, 3.8] + {8.3, 8.10} → 8.4 ; {8.1, 8.3, 8.4} → 8.5 ;
          [6.6] + {8.1, 8.4, 8.10} → 8.6 ;
          [6.6] + 8.4 → 8.7 ; [7.8] + {8.5, 8.6} → 8.9 ⇒ G8
Audio:    G1 → 9.1 → 9.2 → 9.4 ; [3.1, 4.2] + 9.2 → 9.3 ; [7.8] + {9.3, 9.4} → 9.5 ⇒ G9
On demand: [3.3, 4.3] → 5.6 ; [5.4, 7.1] → 7.5 ; [2.7, 3.3] + 5.6 → 7.6 ; [3.11] → 7.7 ; G8 → 8.8 ;
          G7 → {10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8} ; 10.7 → 10.9 ; G7 → 11.1 → {11.2, 11.4, 11.5} ; {11.1, 11.2} → 11.3 ;
          G7 → {12.1, 12.2, 12.3, 12.4}
Playground: G9 → 13.1 → {13.2, 13.3, 13.8} ; 13.3 → 13.4 → {13.5, 13.7} ; 13.5 → 13.6 ; 13.8 → 13.9 ; {13.2, 13.5} → 13.10 ;
          {13.6, 13.7, 13.10} → 13.11 ; {13.8, 13.11} → 13.12 ⇒ G10 ;
          G9 → 13.13 → 13.14 ; {13.14, 10.5, 13.8} → 13.15 ; {10.3, 13.13, 13.9} → 13.16 ; G9 → 13.17 ;
          {13.15, 13.16, 13.17, 13.6, 13.7} → 13.18 ⇒ G11 ;
          {13.8, 13.18} → 13.27 ; {13.16, 13.11, 10.4} → 13.19 ; {10.4, 13.9, 13.12} → 13.20 ;
          {13.15, 10.4, 10.2, 10.1, 13.2} → 13.21 ;
          {13.15, 13.16, 13.6} → 13.22 ; {11.5, 13.15, 13.16} → 13.23 ; {13.8, 13.17, 13.23} → 13.24 ⇒ G12 ;
          {10.6, 10.9, 13.9, 13.20} → 13.25 → 13.26 ⇒ G13
Upgrades (each when it qualifies or measures better, between stages): U-1 Vitest 4 ; U-2 the lint majors ; U-3 three r183 ;
          U-4 Vite 8, TypeScript 6 ; U-5 Node 26 ; U-6 Rapier after 0.21 ; U-7 three r184 and later ; U-8 the platform's Chromium
```

The **On demand** edges belong to WPs that are not scheduled: each starts only on its trigger (§9.1), and a triggered WP builds its unbuilt Needs first. Phase 13 schedules all 21 in its stages, since the playground needs each (ADR-0025).

### 9.3 Definition of done for every work package

A WP is done only when all of these hold:
1. Its **Verify** commands exit 0, and `npm run check` and `npm test` are green.
2. The T2 suites covering what it touched are green.
3. Every new module has its file comment and every export its doc comment, and `x docs --check` passes. INDEX, API and ERRORS were regenerated with `x docs --write`. In ultracode lanes (detected automatically, WP 0.4), drift is a warning and the integrator regenerates.
4. A kind with a QA family has its checks (§8.6). A WP that writes the third entry of a kind by hand adds the kind's scaffold template (§8.13).
5. **The box rule.** A capability built in Phases 2–7 is exercised by the box (its stage's integration WP) or by a fixture test, and the WP's Done-when list says which.
6. **L-size WPs and every gate** get a `verifier` review of the diff against `DOCTRINE.md` and the WP's **Done when**, and every finding is fixed or answered. S and M WPs rely on their Verify commands and their gate's review (doctrine: North Star: ceremony scales with risk). The subagent arrives in WP 0.10, and G0's review covers Phase 0.
7. Compatible releases found by `x deps --update` at the WP's start were adopted in their own commit first (§6.10).
8. No new advice codes appear during tests, unless they are allowlisted with a reason.
9. Every escalation raised during the WP is recorded in `docs/escalations/`, and every call made in the owner's absence is named in the ledger note.
10. The ledger (§14) row is updated: status, commit and notes. In extra-effort mode the agent writes it in the same commit. In ultracode, lanes report and the integrator writes it. Deviations from this plan are recorded as ADR amendments, and deviations from the doctrine are escalated with their reasoning (§8.14), never silently. An on-demand WP's note also records the measurement that triggered it.

**Phase 0 bootstrap.** Items 1–3, 7 and 8 apply once their tools exist: `npm test` (WP 0.2), `npm run check` (0.4), `x deps` (0.3), the advice trap (0.5), `x docs` (0.6) and T2 (0.8). Item 9 applies from WP 0.7.

**Rules about paths and proofs:**
- **What Owns covers.** A WP's **Owns** also covers, without listing them:
  - the browser specs its Verify names (`tests/e2e/<suite>.spec.ts`), and the `tests/pages/<suite>.html` pages they load;
  - unit tests beside its modules or under `tests/unit/`;
  - the scaffold templates (§8.13) and QA-baseline entries for the kinds and QA checks it introduces;
  - the baseline files it records: advice, perf and thumbnails (`tests/baselines/advice/<area>.json`, `tests/baselines/perf/<scene>.json`, `tests/baselines/thumbs/<case>.json`);
  - the **new** fixtures its Done-when names. Fixtures another WP owns are read-only.
- **Extending earlier work.** A later WP may extend a file an earlier WP created, and says so ("extends …"). Two WPs that may run at the same time (no path between them in §9.2) never own the same path.
- **Every claim is proved.** Each **Done when** bullet maps to a **Verify** step. Otherwise it is marked *(deferred proof: <where it is proven>)*, and the ledger records that.

**Format of each WP below:**
- **Owns**: the paths it may create or change. Anything else goes through the integrator, or is generated.
- **Needs**: the WPs that must be done and green first (§9.2).
- **Trigger**: on-demand WPs only; the measurement that starts it (§9.1).
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
  - ADR-0001…0021 recording §13, each one page or less.
  - **The platform.** `.nvmrc` names Node 24.22.1. `scripts/setup.sh` is idempotent:
    - when the active `node` is not `.nvmrc`'s version, it downloads the official Linux x64 build from nodejs.org, checks it against `SHASUMS256.txt`, unpacks it under `~/.cache/my3dge/`, puts it first on `PATH`, and appends that `PATH` to `$CLAUDE_ENV_FILE` when the variable is set;
    - then it runs `npm ci`;
    - offline, it says so and leaves the container's Node 22 in place. Everything runs on Node 22 too (§4.7), but Node goldens are recorded on 24.
  - **Exact pins** in `package.json`, with the lockfile (§6.10, §4.7):
    - `dependencies`: `three@0.182.0`, `@dimforge/rapier3d-simd-compat@0.21.0`, and stdlib's `@stdlib/math-base-special-sin`, `-cos` and `-pow` at `0.3.1`;
    - `devDependencies`: `typescript@5.9.3`, `vitest@3.2.7` (for the type smoke test), `@types/three@0.182.0` and `@types/node@24.19.2`. WPs 0.2 and 0.4 add the rest of the toolchain.
  - `package.json` also sets `"type": "module"`, `engines.node` to `>=24.10 <25` (a warning, not `engine-strict`), `allowScripts` denying esbuild's postinstall, and the scripts of §8.1 whose tools it installs: `typecheck` and `test`. The others arrive with their tools: `dev`, `build` and `e2e` in WP 0.2, `lint`, `format` and `check` in WP 0.4 (ADR-0014, amendment 1).
  - `tsconfig.json`:
    - `target: es2022`, `module: esnext`, `moduleResolution: bundler`;
    - `strict`, `noEmit`, `skipLibCheck`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `isolatedModules`;
    - `lib: es2022, dom, dom.iterable`, and `types: ["node"]`. three.js's types arrive through its imports;
    - `include`: `engine`, `labs`, `tests`, `fixtures`, `tools`, and the config files;
    - since ADR-0014 amendment 7, the options live in `tsconfig.base.json`, which `tsconfig.json` extends, `include` also names `.claude/hooks`, and T0 checks the same files through `tsconfig.check.json`'s projects.
  - `.gitignore`: `out/ dist/ .cache/ node_modules/ test-results/`.
  - README: what this is, the doctrine, the Stress Box, how to start, links.
  - **The source checkout.** `MY3D2DGE_SRC` (an absolute path) names a read-only checkout of my-3d2dge at `e37e4ee`. Resolve it in this order:
    1. the environment variable;
    2. an existing local clone (in the Claude Code cloud image: `/home/user/michaelcrosato/my-3d2dge`), via `git clone --shared <path> .cache/src-3d2dge`;
    3. `git clone https://github.com/michaelcrosato/my-3d2dge .cache/src-3d2dge`.

    For cases 2 and 3, then run `git -C .cache/src-3d2dge checkout --detach e37e4ee`. Every `x` command that reads the source resolves it the same way (`$MY3D2DGE_SRC`, else `.cache/src-3d2dge`, else the clone above), so no shell state is needed. Every **Carry** read and `x port refs` go through `$MY3D2DGE_SRC`. AGENTS.md says how to set it. `scripts/setup.sh` performs this resolution for both sources and, when `$CLAUDE_ENV_FILE` is set, appends their `export` lines next to Node's `PATH`, each once (ADR-0014, amendment 1).
  - **The sibling's checkout.** `SHARDFALL_SRC` names a read-only checkout of shardfall at `fa2dab6` (§4.8), resolved the same way: the environment variable; an existing clone (in the Claude Code cloud image, `/home/user/michaelcrosato/shardfall`); else `GIT_LFS_SKIP_SMUDGE=1 git clone https://github.com/michaelcrosato/shardfall .cache/src-shardfall`, then `checkout --detach fa2dab6`. **Carry** lines that cite shardfall, and WP 8.10's data, read it.
  - **The type smoke test** `tests/unit/ts-smoke.test.ts` (Vitest) imports `three/webgpu`, `three/tsl` and `@dimforge/rapier3d-simd-compat`, and constructs and steps a `World`. A `// @ts-expect-error` above `world.createRigidBody(123)` makes `tsc` fail if Rapier's types ever degrade to `any` (§4.7). `skipLibCheck` stays, to keep T0 fast: the pinned packages' types also check clean without it, in three times the time (§4.7).
- **Improves:** I-01 (recorded as an ADR), I-31, I-32.
- **Done when:**
  - `scripts/setup.sh` installs Node 24.22.1 when it is missing and does nothing when it is active; `npm ci` succeeds; `tsc` runs clean; the smoke test passes. Later shells use Node 24 *(deferred proof: WP 0.10's SessionStart test)*.
  - `$MY3D2DGE_SRC` resolves to `e37e4ee`, and `$SHARDFALL_SRC` to `fa2dab6`.
  - AGENTS.md is 150 lines or fewer.
- **Verify:** `bash scripts/setup.sh && npx tsc --noEmit && npx vitest run tests/unit/ts-smoke.test.ts && test "$(git -C "${MY3D2DGE_SRC:-$PWD/.cache/src-3d2dge}" rev-parse --short=7 HEAD)" = e37e4ee && test "$(git -C "${SHARDFALL_SRC:-$PWD/.cache/src-shardfall}" rev-parse --short=7 HEAD)" = fa2dab6`

#### WP-0.2 The toolchain, the e2e fixture and the `x` CLI
- **Owns:** `x.js`, `tools/x.ts`, `tools/cmd/{help,src}.ts`, `tools/lib/{report,browser,vite,source,hash}.ts`, `vite.config.ts`, `playwright.config.ts`, `.prettierrc.json`, `tests/e2e/fixtures.ts`, `tests/e2e/harness.spec.ts`, `tests/pages/harness.html`; extends `package.json` and `package-lock.json` (from WP 0.1) with the toolchain
- **Needs:** WP 0.1
- **Size:** M
- **Carry:**
  - The virtual clock plus seeded `Math.random` from `tools/filmstrip.mjs:39-53` (COPY, without lines 48-49, which hide `navigator.gpu` and Web Audio).
  - The headless WebGPU flags come from shardfall (§8.8), so the page presents to its real canvas. Neither the stand-in canvas nor `__readFrame` (`tools/lab3d-test.mjs:70-102`) is copied: `__readFrame` reads the stand-in's texture (`:80-84`). The fixture's `readFrame` takes a Playwright screenshot of the canvas element, the read §4.8 measured.
- **Build:**
  - **The standard tools** of §6.10, pinned in `package.json`: Vite, Playwright Test, Prettier and tsx (Vitest arrived in WP 0.1).
  - **`vite.config.ts`:**
    - every `labs/*/index.html` and `tests/pages/*.html` served as a page, with `appType: 'mpa'`, so a missing page is a 404 rather than the root page (measured; WP 0.12 sets what the build takes);
    - `resolve.alias` from a bare `three` to `three/webgpu` (§6.10);
    - `optimizeDeps.include` listing the runtime dependencies, so a first page load never re-optimizes and reloads (§4.7);
    - Vitest's settings: the Node environment, `include: ['**/*.test.ts']`, `tests/e2e/` excluded, the `dot` and `json` reporters (`out/test/report.json`).
  - **`playwright.config.ts`:**
    - `testDir: tests/e2e`; one project, `webgpu`, with the flags of §8.8 and `executablePath` from `CHROMIUM_PATH` (default `/opt/pw-browsers/chromium`);
    - a `webServer` that starts Vite on `PORT` (default 5173; each ultracode lane sets its own);
    - the `line` and `json` reporters (`out/e2e/report.json`);
    - `workers` from the machine's cores, one per 4 cores, from 1 to 4, so a Chromium on SwiftShader keeps the cores the parity replays need and parallel lanes don't starve it (ADR-0014 amendment 15).
  - **The shared fixture, `tests/e2e/fixtures.ts`:**
    - before page scripts run: the virtual clock and named seeded streams;
    - a `ready || error` wait, `readFrame` and `assertWebGPU`;
    - console capture, for the advice trap of WP 0.5;
    - page errors mapped to `.ts` files and lines through Vite's source maps.
  - **`x.js` and `tools/x.ts`:** tsx's `register()`, then the dispatcher: `parseArgs`, help generated from file comments, the `report.json` writer and the exit codes (§8.1). Every report records the runtime.
  - **`tools/lib/vite.ts` and `tools/lib/browser.ts`:** a Vite dev server through its JavaScript API, and Chromium through Playwright's library with the options of `playwright.config.ts`, for the `x` commands that open pages.
  - **`x src`:** prints and checks `$MY3D2DGE_SRC` and `$SHARDFALL_SRC`, cloning each as in WP 0.1 when it is missing. Both sources are public (shardfall since 2026-10-14, after this plan was written), so a clone from GitHub needs no token: when a source cannot be reached, `x src` names the repository the session must reach or include, and the agent escalates once (§11.5).
    Tests that read the source call `requireSource()` (`tools/lib/source.ts`). When the source cannot be resolved
    (offline), they skip and the summary reports `deferred: no source`. `x ci --local` runs `x src` first and fails if
    it cannot resolve the source, so nothing is deferred there.
  - **Helpers:** the FNV hash.
  - **The harness check:** `tests/pages/harness.html` throws from a `.ts` module, and `tests/e2e/harness.spec.ts` checks that the fixture names the right file and line, that the clock is virtual, and that WebGPU ran.
- **Improves:** I-26, I-48.
- **Done when:**
  - `node x help` exits 0 from the repo root and lists every command.
  - `npm test` runs the tools' unit tests (the report schema, the dispatcher's exit codes), and a filter that matches nothing exits 1.
  - The harness spec passes.
- **Verify:** `node x help && npm test -- tools/ && npm run e2e -- tests/e2e/harness.spec.ts`

#### WP-0.4 ESLint rules and `npm run check` (T0)
- **Owns:** `eslint.config.js`, `tools/eslint/`, `tools/cmd/{check,qa}.ts`, `tests/baselines/README.md`, `data/APPROVED-BINARIES.json`, `.prettierignore`; extends `package.json` and `package-lock.json` (from WP 0.1) with ESLint
- **Needs:** WP 0.2
- **Size:** M
- **Carry:** the banned list from `tools/lab3d-test.mjs:28-43` (PORT; Appendix B).
- **Build:**
  - **ESLint** (§6.10) with `typescript-eslint`'s recommended rules (no type information, so T0 stays fast), `eslint-plugin-jsdoc` and `globals`. One block per rule family, each message naming the fix:
    - **the layer rules** (§6.1): `no-restricted-imports` per directory, including the box's sim-side scenes and the fixture scenes. `allowImportNames` limits `core/math.ts` to three.js's math classes;
    - **the public-API rule** (§6.1, doctrine: Quality under the hood): game code (`labs/box/`, `fixtures/scenes/`) imports only `engine/index.ts` and `engine/sim-api.ts`, never `three` or another `engine/` path, and the message names the public export to use. WP 1.6 turns it on, once the barrels exist; `labs/hello/` is a harness page and is exempt;
    - **banned APIs**, scoped by path (Appendix B): r182's deprecations, and names from newer releases that r182 lacks;
    - **reproducibility bans** for sim-side code (§6.5), through `no-restricted-properties`, `no-restricted-globals` and `no-restricted-syntax`. `*.test.ts` files are exempt;
    - `jsdoc/require-file-overview`, and `max-lines` (a warning at 400, an error at 600), for code under `engine/`, `tools/`, `labs/` and `tests/`;
    - **the local plugin** (`tools/eslint/`) for what no stock rule expresses, starting with "ask the entry, never the id" (WP 1.2 turns it on).
    - the families are TypeScript modules in `tools/eslint/`, each registering the core rules it uses under its own name (`layer/no-restricted-imports`, `sim/no-restricted-globals`), so no family replaces another's options; `eslint.config.js` assembles them, and holds the switches (ADR-0014, amendment 2).
  - **`npm run check`:** `tsc -b tsconfig.check.json` (incremental, over the projects of ADR-0014 amendment 7; it was `tsc --noEmit`), `eslint --cache .`, `prettier --check --cache .` and `node x check`, run in parallel by `tools/checkAll.ts` (ADR-0014, amendment 5). Prettier covers code, data and the generated docs; `.prettierignore` exempts hand-written prose (ADR-0014, amendment 2).
  - **`x check`**, the repository checks no standard tool covers, built from plugins:
    - **the asset scan** (doctrine: Assets): file extensions, magic bytes, and any base64 run or `data:` URI over 1 KB. A binary file passes only if `data/APPROVED-BINARIES.json` lists it with its escalation record, or if it is a font (WOFF2, TTF, OTF) under `data/fonts/` with a license file beside it. Anything else fails with "needs the owner's approval: `x esc open --principle Assets`";
    - plugins added later: dependency pins (WP 0.3), docs drift (WP 0.6) and escalation records (WP 0.7). Each plugs in by exporting `check` (a `CheckPlugin`) from its command module in `tools/cmd/`, so `check.ts` never changes.
  - **Lane mode is detected, not configured.** `x check` treats a linked git worktree as an ultracode lane, and reports docs drift there as a warning (§11.3). A linked worktree is one where `git rev-parse --git-dir` differs from `--git-common-dir`. `X_LANE=0|1` overrides the detection.
  - **The `x qa` dispatcher:**
    - usage: `x qa <family…> [--only <prefix…>]`. `--only` filters ids by prefix (`clip:`, `action:`, `prop:`);
    - baseline files `tests/baselines/qa-<family>[-<area>].json`, each owned by the WP that creates it, with entries `{ id, metric, value, reason }`;
    - families are plugged in later: level (WP 2.2), tex (2.3), geo (2.4), anim (6.6), audio (9.4). Each family also runs in T1 as a Vitest test.
- **Improves:** I-31, I-42, I-47, I-48, I-51.
- **Done when:** every rule has a failing fixture and a passing fixture, and `npm run check` on the repo takes under 10 s. Tests write failing fixtures to a temporary directory and lint them through ESLint's Node API; nothing failing is committed.
- **Verify:** `npm run check && npm test -- tools/eslint tools/cmd/check`

#### WP-0.5 Test tiers, selection and the advice trap
- **Owns:** `tools/lib/{tiers,tierBudgets}.ts` (tierBudgets.ts split from tiers.ts: ADR-0014 amendment 16), `tests/setup/adviceTrap.ts`, `tests/baselines/advice/README.md`; extends `tests/e2e/fixtures.ts` and `vite.config.ts` (from WP 0.2) with the advice trap
- **Needs:** WP 0.4
- **Size:** S
- **Carry:** the ideas of `tools/test-run.mjs`: a reason for each selection, the timing table, and the version-only filter (a commit that changes only `package.json`'s version selects nothing).
- **Build:**
  - **The tiers** as npm scripts (§8.1, §8.2): T0 `npm run check`, T1 `npm test`, T2 `npm run e2e`, and the long runs.
  - **Selection** (§8.2): T1 through `vitest run --changed <base>` and `vitest related`. T2 runs in full when engine, lab or page code changed, and otherwise as `playwright test --only-changed <base>`. `tools/lib/tiers.ts` computes the base (the merge-base with `origin/main` once `main` holds a gate, else `out/ci/last-green`) and the T2 decision, for `x ci --local`.
  - **Budget enforcement:** `tools/lib/tiers.ts` reads the JSON reports and warns when a tier is over its budget (ADR-0022: time never fails).
  - **The advice trap.** A Vitest setup file and the Playwright fixture both fail on any engine advice code, `console.warn` or three.js deprecation that is not listed in a file under `tests/baselines/advice/`. Each area has its own file of `{ code, reason }` entries, owned by the WP that adds them; the trap reads the whole directory. Its proof in the Playwright harness drives Chromium, so it runs in T2 (`tests/e2e/adviceTrap.spec.ts`), and its Vitest proof in T1 (`tests/setup/harnesses.test.ts`; ADR-0014, amendment 7).
- **Improves:** I-27, I-41, I-48.
- **Done when:**
  - In a temporary git repository the test builds, a change to a fixture `engine/core/a.ts` selects every Vitest test that imports it, directly or not, and a change to page code makes T2 run in full.
  - An unlisted warning fails a fixture test in each harness; a listed one passes.
  - A report over its budget warns (ADR-0022).
- **Verify:** `npm test -- tools/lib/tiers tests/setup && npm run e2e -- tests/e2e/adviceTrap.spec.ts`

#### WP-0.3 Dependency qualification and pinned knowledge
- **Owns:** `tools/cmd/deps.ts`, `tools/lib/deps.ts`, `tools/lib/depsCheck.ts`, `tools/lib/depsUpdate.ts` (ADR-0007, amendment 1), `tools/deps.json`, `docs/THREE-DELTA.md`, `docs/reference/three-tsl-wiki.md`
- **Needs:** WP 0.4
- **Size:** M
- **Carry:** the idea of `tools/vendor-3d.mjs`'s checked pins. §4.7 and Appendix B.
- **Build:**
  - **`tools/deps.json`** records, for every direct dependency:
    - its qualifying release and pin, with their dates;
    - the rule that admits the pin: it qualifies, it is compatible, it works the same way (with its ADR), it is an internal that measures better (with the measurement), or it is the platform's;
    - the next line, and the date it qualifies;
    - why it is a dependency at all (doctrine: Common ground).
  - **`x deps --check`** (offline; WP 0.4's `x check` runs it as a plugin): `package.json` and the lockfile match `tools/deps.json`; every dependency has a reason; the lockfile's `@types/*` and `@webgpu/*` packages follow the same rule, and what only they pull in is recorded (`typesDeps`, ADR-0007 amendment 1); and the active `node` is `.nvmrc`'s (a warning otherwise).
  - **`x deps --update`** (network): asks the registry (`npm view <pkg> time --json`) for releases newer than each pin within its compatible range, installs them with `--save-exact`, updates `tools/deps.json`, and runs T0 and T1. `--dry-run` only lists them.
  - **`x deps --qualify`** (network): lists the lines that have newly qualified, with their dates, as upgrade WPs to schedule.
  - **`docs/THREE-DELTA.md`:**
    - r182 for agents who know newer releases (`RenderPipeline` → `PostProcessing`; no `DynamicLighting`, `ClusteredLighting` or `TextureSource`; `packNormalToRGB` → `directionToColor`…);
    - r182 for agents who know older ones: the renames and deprecations of r181 and r182 (Appendix B);
    - what r183–r186 change (§4.7), so code written now avoids it (`Clock`, the async render methods, `positionLocal` under skinning).
  - **`docs/reference/three-tsl-wiki.md`:** the TSL wiki page at revision `6153b39` (2025-12-22), the last edit before r183, taken from the wiki's git repository, with the source and revision in its header. Each three.js upgrade moves it to the last revision before the next release.
- **Improves:** I-15, I-42, I-45.
- **Done when:**
  - `x deps --check` passes on the pins. It fails on fixture pins, written to a temporary directory, that are too new, that are older than the newest compatible release recorded, or that lack a reason.
  - `x deps --update --dry-run` lists nothing to adopt right after the pins are set *(deferred proof when offline: the next `x ci --local` with network)*.
  - A Node test imports Rapier (and steps a world) and `three/webgpu` from `node_modules`.
- **Verify:** `node x deps --check && npm test -- tools/cmd/deps`

#### WP-0.6 Docs system
- **Owns:** `tools/cmd/{docs,new}.ts`, `tools/lib/docs{,Codes,Examples,Generate,Paths,Start}.ts` (ADR-0015, amendments 1 and 3), `tools/templates/module/`, `tests/unit/examples.test.ts`, `tests/e2e/examples.spec.ts` (after G9: ADR-0015 amendment 4), `docs/{INDEX,API,ERRORS,TESTING,PROGRESS}.md`; extends the `@example` blocks of `tests/setup/adviceTrap.ts` (from WP 0.5) and `tools/lib/deps{Check,Update}.ts` (from WP 0.3) so they run
- **Needs:** WP 0.4
- **Size:** M
- **Carry:** the doctest extraction and path checks of `tools/agent-test.mjs:27-30, 185-235`.
- **Build:**
  - A reader for file and export comments, through the TypeScript compiler API.
  - **INDEX** (module → purpose → exports → tests), **API** (each export with the first sentence of its doc comment) and **ERRORS** (collected from every module's `defineCodes`).
  - **`@example` blocks** run in Node by `tests/unit/examples.test.ts` (T1); browser examples are flagged for T2.
  - **Drift checks** (§8.12), registered as an `x check` plugin, including the public API's: every export of `engine/index.ts` and `engine/sim-api.ts` has its doc comment, and every error or advice code its fix. `x docs --check` alone also runs the examples.
  - **Path checks:**
    - They cover file and export comments, AGENTS.md and `docs/*.md`.
    - `DOCTRINE.md`, `docs/research/`, `docs/reference/` and `docs/escalations/` are not checked.
    - Citations of the source repos are written `my-3d2dge:<path>[:line]` or `shardfall:<path>[:line]`, and are checked against `$MY3D2DGE_SRC` and `$SHARDFALL_SRC`.
  - **`x new`:** it discovers the kinds from `tools/templates/<kind>/` (each with a small manifest), and has `--test` and `--test-all`. This WP adds the `module` template (a file comment plus a test stub). Later templates arrive by §8.13's rule, each without touching `new.ts`.
  - `docs/TESTING.md`: the tiers, the selection rule, the fixture, and how to add a suite.
  - `docs/PROGRESS.md`, one screen that every session reads first (shardfall's, §5.8). `x docs --check` fails if it grows past 40 lines.
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
  - **An `x check` plugin:** records are well-formed with unique ids, and an `open` record past its deadline with no call fails with "decide or answer ESC-NNNN" (a warning in an ultracode lane, where the integrator decides for the run; ADR-0017, amendment 1).
  - **`docs/escalations/README.md`** is generated: the records by status, the calls awaiting the owner's review first. Every `x esc` that changes a record rewrites it, `x esc list --write` regenerates it, and the plugin fails it when stale.
- **Improves:** I-44.
- **Done when:** a test in a temporary directory opens an escalation, passes its deadline on a virtual clock, records a call and closes it; `x check` flags an overdue open record; the index regenerates.
- **Verify:** `npm test -- tools/cmd/esc && npm run check`

#### WP-0.11 Port reference vectors from my-3d2dge
- **Owns:** `tools/cmd/port.ts`, `tools/lib/portVectors.ts` (split from it: ADR-0014 amendment 16), `tests/baselines/port/**`
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
  4. The vectors are machine-written and checksummed, so Prettier skips their directory (ADR-0014, amendment 3).
- **Done when:**
  - The vectors exist, with a README naming the source commit and the conversion (Appendix C).
  - Re-running produces byte-identical files.
  - `--check` compares the committed vectors with their recorded checksums offline.
- **Verify:** `node x port refs && git diff --exit-code tests/baselines/port && node x port refs --check`

#### WP-0.8 Hello page on WebGPU
- **Owns:** `labs/hello/`, `engine/gfx/renderer.ts` (minimal), `tools/cmd/shot.ts` (basic: render, read back, PNG, metrics), `tests/e2e/hello.spec.ts`
- **Needs:** WP 0.3, WP 0.5, WP 0.6
- **Size:** S
- **Build:**
  - A lit procedural cube with a `MeshStandardMaterial`, drawn directly and through one `PostProcessing` pass (a TSL colour grade, no MRT). It proves r182's post path on WebGPU, headless (§4.7).
  - **WebGPU required:** the renderer asks for a WebGPU adapter first and refuses to start without one (`GFX_NO_WEBGPU`, naming the fix; §6.7). It then starts with `await renderer.init()`, asserts the WebGPU backend, and draws with `render()`, never `renderAsync()` (deprecated since r181).
  - A minimal `__engine.info()`, and `ready`/`error` signalling.
  - **Errors show on the page:** `GFX_NO_WEBGPU` and load failures also appear as page text that names the fix, since whoever opens a deployed page sees the page, not its console (shardfall's `web/index.html:34-40, 62-65`).
  - `x shot labs/hello`, writing a PNG and metrics.
- **Done when:**
  - T2 passes on WebGPU (SwiftShader) in the cloud container, with no warning in the console.
  - WebGPU is asserted, and the frame is not blank, with and without the post pass.
  - **The startup test:** launched without the WebGPU flags, the page reports `GFX_NO_WEBGPU` and does nothing else.
  - Vite resolves `three/webgpu` and `three/tsl` in the browser, and its alias sends a bare `three` to the same module.
- **Verify:** `npm run e2e -- tests/e2e/hello.spec.ts && node x shot labs/hello`

#### WP-0.12 Deploy on Vercel (built, not tested)
- **Owns:** `vercel.json`, `.vercelignore`, `index.html` (the landing page); extends `.gitignore` and `README.md` (from WP 0.1) and `vite.config.ts` (from WP 0.2)
- **Needs:** WP 0.8
- **Size:** S
- **Carry:** from shardfall (§5.8), which deploys to Vercel today: explicit commands in `vercel.json` (`vercel.json:1-13`), an outputs-only `.vercelignore` (`.vercelignore:1-3`), `.vercel` and `.env*` ignored (`.gitignore:4-5`), and the README's section on deploying (`README.md:108-131`). Its Rust build script does not apply: Vercel's build image has Node, which is all this build needs.
- **Build:**
  - **`vercel.json`:** `{"$schema":"https://openapi.vercel.sh/vercel.json","framework":"vite","installCommand":"npm ci","buildCommand":"npm run build","outputDirectory":"dist"}`. No headers, rewrites or redirects. Rapier inlines its WASM in its JavaScript, so the build emits no `.wasm` file and needs no MIME header (measured, §4.8). Vercel's defaults deploy every push: `main` to production, other branches to previews. Vercel builds of pushes made before this WP lands may fail or serve nothing useful (no `vercel.json` and no landing page yet); nobody acts on them.
  - **The landing page**, `index.html` at the root: `location.replace('labs/box/' + location.search + location.hash)`, plus a plain link, so `/?scene=crowd-1000` opens that scene. It points at `labs/hello/` until WP 2.7 points it at the box. Routing lives in files, not in `vercel.json`, so `npx vite preview` serves what Vercel serves.
  - **`vite.config.ts`:** the build's inputs are `index.html` and every `labs/*/index.html` (`globSync` from `node:fs`). `tests/pages/*.html` never ship; `harness.html` throws on purpose. `build.chunkSizeWarningLimit` is 8,000 KB, with a comment: Rapier's inlined WASM makes one large chunk.
  - `.vercelignore`: `out/`, `dist/`, `test-results/`. `.gitignore` adds `.vercel/` and `.env*`.
  - **Node on Vercel** is 24.x, taken from `package.json`'s `engines.node` (Vercel does not read `.nvmrc`). `npm run build` stays plain `vite build`: no prebuild step, no `x` command, no source checkout, no browser and no network. `vite.config.ts`, which Vitest also reads, imports nothing that needs them either.
  - **README:** the play link, once the URL exists; and "Deploying": Vercel imports the repository and `vercel.json` does the rest; locally, `npm run build && npx vite preview`.
- **Improves:** I-53.
- **Done when:** `npm run build` writes `dist/index.html` and `dist/labs/hello/index.html`, with no `.wasm` file and nothing from `tests/`. Nothing else is tested, by the owner's order (ADR-0021): no deployment, preview, URL or browser check, and the build does not join `x ci --local`.
- **Verify:** `npm ci && npm run build && test -f dist/index.html && test -f dist/labs/hello/index.html && test -z "$(find dist -name '*.wasm' -o -path 'dist/tests*')"`

#### WP-0.9 Continuous integration
- **Owns:** `tools/cmd/ci.ts`, `tools/lib/ciSummary.ts` (split from it: ADR-0014 amendment 16); `.github/workflows/ci.yml` and its test `tools/cmd/ci-workflow.test.ts` (after G9, ESC-0001 answered: ADR-0016 amendment 1)
- **Needs:** WP 0.8, WP 0.11
- **Size:** S
- **Build:**
  - **`x ci --local`**: the steps of §8.9 on the local machine, with a summary in `out/ci/summary.md` and the commit in `out/ci/last-green`. It is the merge gate (with the workflow's `ci` check from its first green run until ADR-0023; since then the quick gate, and with `--full` the full run that the workflow runs after each merge: §8.9).
  - **The GitHub workflow waits for the owner** (§8.9). This WP raises the escalation that asks whether to enable Actions (§11.5) and continues without waiting. When the owner enables Actions and grants the `workflow` scope, it writes `.github/workflows/ci.yml` with the same steps (`actions/setup-node` from `.nvmrc`, `npm ci`, `node x ci --local`, artifacts and a step summary; its actions follow §6.10's rule too), and a unit test that checks them against `x ci --local`'s. (Written after G9 on ubuntu-24.04 with `scripts/setup.sh`'s Chrome for Testing rather than §8.8's container: ADR-0016 amendment 1. Its first green run came on 2026-10-15; ESC-0001 closed.) Before that, nothing is written: a workflow file pushed without the scope makes GitHub reject the whole push.
- **Improves:** I-33.
- **Done when:** `x ci --local` passes, and the escalation about Actions is recorded. The workflow and its test arrive with the owner's answer *(deferred proof: the ledger links the escalation)*.
- **Verify:** `node x ci --local && npm test -- tools/cmd/ci`

#### WP-0.10 Claude Code integration
- **Owns:** `.claude/`, `tests/unit/hooks/`
- **Needs:** WP 0.7, WP 0.9
- **Size:** S
- **Carry:** `.claude/hooks/session-start.sh` (PORT: run `scripts/setup.sh`; add `x src` and the open escalations).
- **Build:**
  - Hooks and permissions, as in §8.10.
  - The skills `x-loop`, `three-webgpu` (from THREE-DELTA plus Appendix B) and `escalation`. Later WPs add theirs: `determinism-debugging` (WP 1.5), `stress-box` (WP 2.7) and `rapier` (WP 3.1).
  - **Two subagents:** `verifier` and `visual-reviewer` (§8.10).
  - Unit tests for the hook scripts, run against fixtures.
- **Improves:** I-34.
- **Done when:**
  - Run against a fixture environment, the SessionStart script installs nothing when Node 24 is active, writes the `PATH`, `MY3D2DGE_SRC` and `SHARDFALL_SRC` lines to `$CLAUDE_ENV_FILE`, and lists open escalations.
  - Writing a banned API makes the PostToolUse hook fail, naming the replacement.
  - An edit to `DOCTRINE.md` makes the PreToolUse hook ask the owner.
  - The Stop hook runs `npm run check`.
  - A fresh cloud session starts clean, and both subagents load *(deferred proof: checked at G0 and noted in the ledger)*.
- **Verify:** `npm test -- tests/unit/hooks`

**Gate G0:**
- These are green in `x ci --local`: `npm run check` (with `x deps --check` and `x docs --check`), `npm test`, `npm run e2e` (the harness and hello suites, and the startup test) and `x port refs --check`.
- No escalation is open past its deadline.
- The `verifier` subagent has reviewed Phase 0's diff.
- The gate's report tells the owner that Vercel can import the repository (WP 0.12).

### Phase 1: The kernel (lane C)

#### WP-1.1 Math, randomness, noise, hashing, colour
- **Owns:** `engine/core/{math,simMath,rng,noise,hash,color}.ts` and their tests
- **Needs:** G0
- **Size:** M
- **Carry:**
  - `engine:72-96` (`clamp lerp approach ease angDiff lerpAng approachAng smoothDamp`).
  - `E.rng` (Mulberry32), `E.hash2`, `E.noise2`.
  - The colour helpers.
  - `hashNumbers` (`stress-world/00-setup.js:59`).
- **Build:**
  - **`math`:** re-exports three.js's math classes (`Vector3`, `Quaternion`, `Matrix4`, `Euler`, `Box3`, `Sphere`, `Ray`, `Plane`, `MathUtils`, and `Color` for `color`, ADR-0020 amendment 1) from `three/webgpu`, so every layer shares one set of math types (doctrine: Common ground). It adds only what three.js lacks: the source's angle helpers (`angDiff`, `lerpAng`, `approach`, `approachAng`, `smoothDamp`), swing-twist decomposition, and easing. `MathUtils` already covers `clamp`, `lerp`, `damp` and `smoothstep`.
  - **`simMath`** (§6.5, doctrine: Quality under the hood): `withSimMath(fn)` swaps stdlib's fdlibm ports of `sin`, `cos` and `pow` into `Math` while `fn` runs, and restores the native functions afterwards, also after a throw; nested calls are safe. Game code never sees it. No swap reaches `**` or an alias of a `Math` function, so ESLint bans both sim-side (Appendix B, ADR-0006 amendment 1).
  - **The drift test** (`tests/e2e/drift.spec.ts`, with a Node half): every `Math` function hashed on 200,000 seeded inputs in Node and in Chromium, natively and under the swap. It fails when a swapped function differs, or when a native one starts to differ outside the swap, naming the stdlib package that would cover it.
  - **`rng`:** named streams, `derive(seed, …keys)`, getting and setting state.
  - **`noise`:**
    - `hash2`, bit-exact with the source;
    - value, gradient and cell noise in 2D and 3D, with fbm octaves;
    - periodic (tiling) variants;
    - all seeded. Presentation code that needs Perlin or simplex noise beyond these (texture generators, say) uses three.js's `ImprovedNoise` and `SimplexNoise` addons first; sim-side code cannot import addons (Appendix B).
  - **`hash`:** 64-bit FNV-1a (two 32-bit lanes) over float64 bits, plus a canonical serializer.
  - **`color`:** hex, sRGB ↔ linear (over three.js's `Color` where it fits), and `tones/ramp/shade/mix`, bit-exact with the source.
- **Improves:** I-05, I-06, I-49.
- **Done when:**
  - The outputs match the reference vectors bit for bit (`rng`, `hash2`, `noise2`, colour).
  - Under `withSimMath`, `sin`, `cos` and `pow` give the same bits in Node and in Chromium; outside it, `Math` holds the native functions again, also after a throw.
  - The drift test passes, and fails on a fixture that leaves `cos` out of the swap.
  - The angle helpers match the source's within 1e-12.
  - ESLint's reproducibility bans pass across `engine/core`, and `core/math` re-exports nothing but math classes.
- **Verify:** `npm test -- engine/core && npm run lint && npm run e2e -- tests/e2e/drift.spec.ts`

#### WP-1.2 Registry, events, log, settings, schema
- **Owns:** `engine/core/{schema,registry,events,log,settings}.ts`, `tools/cmd/describe.ts`
- **Needs:** WP 1.1
- **Size:** M
- **Carry (mechanisms):**
  - `ed/00-core.js:76-117`: registry, bus, streams.
  - `ed/01-tune.js`: knobs.
  - `engine:65-66`: warn-once.
- **Build:**
  - **A schema mini-language** in JSON Schema's words (ADR-0012 amendment 1): type, default, range (`minimum`, `maximum`), unit, doc (`description`), enum, required, hooks with defaults, `when` (`now | spawn | scene`), and `view: true` for a setting that changes only how the game looks or performs (a resolution mode, a camera, a look, WP 3.12's `quality` and `touch`). `x set`, URL parameters and `__engine.set` reach a `view` setting like any other, but the hash, captures and replays leave it out, and sim-side code cannot read it. The gallery (WP 7.7, on demand) adds a `gallery` hook when it is built.
  - **Registry:** `defineKind`, `def`, `get`, `list`, `describe`. A missing id warns once, suggests the closest names, and returns the kind's fallback; a kind declared without one throws `CORE_NO_ENTRY`, naming the closest names (ADR-0012 amendment 1). The local ESLint rule "ask the entry, never the id" (WP 0.4) is turned on here.
  - **Events:** scoped listeners (`scope.dispose()`), each listener isolated so its failure is recorded in `errors`, and a trace ring.
  - **Log:** warn-once and structured errors. Each module registers its own codes beside its code: `defineCodes('anim', { CODE: { template, fix, doc } })`. `x docs` collects them, and there is no central table.
  - **Settings:** one schema drives URL parameters, a validated `set` and `get`, JSON export and import, and a "differs from default" marker. `x set` arrives in WP 2.7.
  - **Presets and scoped overrides** (shardfall's, §5.8): a preset is path → value JSON, and loading one reports unknown paths. A scene or variant may override settings for its lifetime, and the overrides are undone when it ends.
  - **Unknown keys are errors**, in specs, presets, URL parameters and `set` paths, each naming the closest valid key (§8.1).
- **Improves:** I-36, I-37, I-41.
- **Done when:** unit tests cover every behaviour, and `docs/ERRORS.md` is generated from the codes the modules register.
- **Verify:** `npm test -- engine/core && node x docs --check`

#### WP-1.3 Time
- **Owns:** `engine/core/{time,timers}.ts` (two concepts: the frame clock, and timers with per-entity clocks; ADR-0005 amendment 1)
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
- **Owns:** `engine/sim/{world,entityTable,systems,state,capture,entities}.ts` (entityTable.ts split from world.ts: ADR-0014 amendment 16); extends `engine/core/{rng,events}.ts` (review fixes, ADR-0006 amendment 3)
- **Needs:** WP 1.3
- **Size:** M
- **Build:**
  - Entities with monotonic ids.
  - Component kinds registered with field lists.
  - Spawn and despawn queues that apply at step boundaries.
  - An explicit list of systems in order, and an event flush.
  - `state()`, `hash()` (engine plus RNG plus a physics hook) and `trace()`.
  - `capture()` and `restore()` for the engine part; physics plugs in at WP 3.1 (§6.5).
  - **Every sim entry point runs inside `withSimMath`** (§6.5): `setup`, `step`, spawns, captures and restores.
- **Improves:** I-03, I-05, I-06.
- **Done when:**
  - Changing any captured field (components, timers, settings other than `view` ones, RNG states) changes the hash, field by field (§6.5), and changing a `view` setting does not.
  - Drawing from an `fxRng` stream never changes `hash()`.
  - capture → restore → step equals an uninterrupted step (no physics yet, so the round trip is exact).
  - The hash is stable across runs.
  - Inside a system, `Math.sin` is the port; after the step, it is native again.
- **Verify:** `npm test -- engine/sim`

#### WP-1.5 Intents, scenes, replays, `x sim`, `x replay`
- **Owns:** `engine/input/intents.ts`, `engine/sim/{scene,session,replay}.ts`, `tools/cmd/{sim,replay,perf}.ts`, `tools/lib/{scenes,perfBudget}.ts` (session.ts, scenes.ts and perfBudget.ts split from scene.ts, sim.ts and perf.ts: ADR-0014 amendment 16), `fixtures/scenes/kernel/`, `tests/replays/README.md`, `tests/replays/kernel-*.replay.json`, `tests/pages/replay.html`, `.claude/skills/determinism-debugging/`
- **Needs:** WP 1.4
- **Size:** M
- **Build:**
  - The intents vocabulary: move `[x, z]` in world space, camera heading, aim point, look, buttons pressed and held, and custom namespaced keys.
  - `intents.fromCamera(yaw, axes)`: pure math that turns stick or keys into a world-space move, so W walks away from the camera. WPs 3.3 and 3.10 use it.
  - **Scenes, sim-side:** `defineScene(id, { level?, settings, setup, step })` and the scene registry, in `engine/sim/scene.ts`. The `kernel` fixture, the box's scenes and `createHeadless` all use it, so no scene imports `app/`.
  - The replay format (§8.4), with a recorder and a player, and golden hashes keyed by platform: one set per replay, valid in Node and in Chromium (§6.5). The recorder keeps every step's intents from step 0, and every setting change (except `view` settings) and dev action at its step (§8.4).
  - `x sim`, with `--set` and `--scene`.
  - `x replay` with `--update` and `--bisect`.
  - `x replay --browser sim` runs the replay inside `tests/pages/replay.html`: the sim in a page, no renderer, against the same goldens. WP 2.7 adds `--browser page`: the scene's own page, rendering.
  - `x perf` for Node: sim milliseconds per step against budgets. WP 5.5 adds browser counters and the crowd ladder.
  - The `kernel` fixture scene: a few scripted movers with no physics. They steer with `Math.sin`, `Math.cos` and `Math.pow` on float64 state, so shared goldens prove the swap end to end (without it, Node and Chromium part within 600 steps, §4.7).
- **Improves:** I-03, I-04, I-06.
- **Done when:**
  - A fixture replay gives its golden hashes three times in Node and three times in Chromium: one set of goldens, recorded once.
  - `--bisect` finds an injected divergence at the right step, entity and field.
  - On a platform other than the recorded one, the replay runs twice, compares the runs and reports "golden: other platform".
- **Verify:** `npm test -- engine/sim && node x replay tests/replays --browser sim`

#### WP-1.6 Headless app and the inspector core
- **Owns:** `engine/app/headless.ts`, `engine/dev/inspector.ts`, `engine/dev/members.ts` (the kind, ADR-0014 amendment 6), `engine/index.ts`, `engine/sim-api.ts`, `tools/lib/docsHelp.ts` (§8.12's help() check); extends `fixtures/scenes/kernel/` and `tools/cmd/sim.ts` (from WP 1.5), `tools/cmd/docs.ts` (from WP 0.6) and `tools/eslint/` (from WP 0.4: the public-API rule's G0 follow-ups, ADR-0020 amendment 2)
- **Needs:** WP 1.5
- **Size:** S
- **Build:**
  - `createHeadless({ scene, seed, settings })`, over the scene registry of WP 1.5.
  - **The inspector as a registry kind:** `def('inspectorMember', name, { args, help, impl })`, each member declaring its arguments in WP 1.2's schema language, so `help()`, argument checks and a later MCP server are generated from one table (shardfall's tool table, §5.8). `engine/dev/inspector.ts` assembles `__engine` from the registered members, so later WPs add members from their own files and no layer imports `dev/` (§8.3).
  - The core members: `info`, `pause`, `resume`, `step`, `timeScale`, `seed`, `state`, `hash`, `trace`, `entities`, `get`, `set`, `capture`, `restore`, `describe`, `help`, `errors`, `advice`. In Node, the rendering members throw a coded "no renderer" error; WP 2.7 adds `view: true`, after which only `render` and `shot` throw.
  - The same shape in the browser; WP 2.7 wires it into pages.
  - **The public API** (§6.1, doctrine: Quality under the hood): `engine/sim-api.ts` exports what sim-side game code needs (`defineScene`, `defineKind` and `def`, the intents vocabulary, `core/math`, `rng`, events); `engine/index.ts` re-exports it and adds `createHeadless` (and `createEngine`, WP 2.7). Each export carries its doc comment. Each later WP appends its public names, one export per line, so parallel lanes merge cleanly (§11.3). This WP moves WP 1.5's kernel fixture onto `engine/sim-api.ts` and turns on the public-API rule (WP 0.4).
- **Improves:** I-03, I-25, I-51.
- **Done when:**
  - `x sim fixtures/scenes/kernel` runs through `createHeadless`.
  - A member registered from a test file appears in `__engine` and in `help()`.
  - `help()` matches the API.
  - The kernel fixture scene imports only `engine/sim-api.ts`, and the public-API rule rejects a fixture that imports `engine/sim/world`.
- **Verify:** `node x sim fixtures/scenes/kernel --steps 600 && npm test -- engine/dev/inspector && npm run lint && node x docs --check`

**Gate G1:**
- `npm test` (core and sim) is green.
- The kernel fixture's replay is identical three times in Node and three times in a Chromium page, against its one set of goldens.
- The drift test is green.
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
  - **WebGPU required** (§6.7), extending WP 0.8's bootstrap: the adapter check and `GFX_NO_WEBGPU`, `await renderer.init()`, the backend assertion, then `render()`. A report of the adapter, its features and its limits; WebGPU's errors routed to the log (the device's `uncapturederror` and `renderer.onDeviceLost`: r182 has no `renderer.onError`; ADR-0008 amendment 1).
  - **The feature registry** of §6.7: `def('feature', …)` for optional adapter features and GPU techniques, capability checks, and an advice code on every downgrade.
  - Resolution modes: pixels (200–330 lines, whole-pixel scaling), balanced, full; DPR handling and resize.
  - Interpolation alpha; stats from `renderer.info`.
  - **The warm-up registry:** pools and batches register themselves; `compileAsync` with progress; a re-warm on every shader-key change (fog, shadows, filters, light count).
  - **The public pipeline counter**, the single place that reads renderer internals, pinned to r182 by a test.
- **Improves:** I-15, I-16, I-18.
- **Done when:**
  - T2 asserts the WebGPU backend, and `info()` lists the adapter's features; the startup test still passes.
  - A scripted session that switches resolution modes and shows a registered pool builds 0 pipelines after warm-up.
  - The counter's pin test fails if r182's internals change.
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
  - **A material registry** (kind `material`): a material is data with the parameters agents know from three.js's classic materials (`color`, `map`, `roughness`, `emissive`, flags; §6.7). How it is drawn is internal: v1 compiles it to `MeshLambertMaterial` (lit) or `MeshBasicMaterial` (unlit or emissive), and later WPs may compile the same data to node materials that look better, without changing the data. The styles (toon, flat, pbr) arrive in WP 7.2.
  - **A generator registry:** seeded, periodic generators giving albedo, height, roughness and emissive per texel.
  - **A CPU bake** to `DataTexture`s with mipmaps, normals from height, and pixel (nearest magnification) or smooth looks.
  - **The v1 set:** flagstone, brick courses, dressed stone, planks, barrel staves, checker. WP 7.3 adds the rest.
  - The tileability check (the `tex` QA family).
- **Improves:** I-20, I-49.
- **Done when:**
  - Every generator tiles: the mean difference across the wrap edge is at most 2% of the value range above that of neighbouring interior pairs.
  - Bakes are reproducible in Node (hashed).
  - Every material renders in `tests/pages/scene.html`, and no frame is blank.
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
  - The room fixture's level meshes render in 20 draw calls or fewer.
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
- **Owns:** `engine/gfx/{shot,idpass,idmarks,lookMetrics,thumbnail}.ts` (idmarks.ts split from idpass.ts after G9: ADR-0014 amendment 17); extends `tools/cmd/shot.ts` (from WP 0.8); `tests/baselines/thumbs/README.md`
- **Needs:** WP 2.1
- **Size:** M
- **Carry:** the look metrics and notes of `tools/check.mjs:40-50, 96-104`.
- **Build:**
  - **`shot()`** renders into a render target and reads it back with `readRenderTargetPixelsAsync`, stripping the 256-byte row padding that r182's readback keeps (§4.8; shardfall's `capture.rs`).
  - **The ID pass:** flat per-object colours through an override material, no antialiasing. It returns `visible: [{ id, name, px, bbox }]`.
  - Look metrics, and text thumbnails (48 × 27).
  - **`x shot`**: `--scene`, `--cam`, `--set`, `--ids`, `--metrics`, `--marks` (numbered marks on what the ID pass sees, with a legend; shardfall's `see`); the PNG only on demand.
- **Improves:** I-28.
- **Done when:**
  - In `tests/pages/scene.html`, the ID pass reports every object of a fixture scene.
  - Thumbnails are stable over 3 runs, and a 48-pixel-wide readback matches the rendered frame pixel for pixel, with no row skew.
  - `x shot` writes its `report.json` with the metrics and the ID-pass list.
- **Verify:** `npm run e2e -- tests/e2e/shot.spec.ts && npm test -- engine/gfx/shot`

#### WP-2.7 Box 1: the box app
- **Owns:** `engine/app/{engine,drawing,loop,routes,view,viewMembers,playback}.ts` (view, viewMembers and playback: ADR-0014, amendment 10; drawing.ts split from engine.ts: amendment 16); `engine/gfx/{stage,sceneDump}.ts` (amendment 10); `engine/dev/overlay.ts` (the error overlay); `labs/box/{index.html,main.ts,README.md}`, `labs/box/levels/room.txt`, `labs/box/scenes/room.ts`; `tools/cmd/{set,eval,dump,inspect}.ts`, `tools/lib/page.ts` (amendment 10); `tools/templates/scene/`; extends `tools/cmd/replay.ts` (from WP 1.5) with `--browser page`; `tests/e2e/parity.spec.ts` and its `STAGES`, `tests/e2e/parity-stages.ts` (amendment 16); `.claude/skills/stress-box/`; `tests/replays/box-1-*.replay.json`; `tests/unit/box-readme.test.ts`; extends `index.html` (from WP 0.12), `engine/app/headless.ts` (from WP 1.6) with `view: true`, `tools/cmd/shot.ts` (from WP 0.8) so `x shot` reuses a running `x inspect` (§8.1), `tools/cmd/help.ts` and `tools/x.test.ts` (from WP 0.2: past the 20-line cap, the names), `tools/cmd/sim.ts` (from WP 1.5: extensionless module targets), `tests/baselines/thumbs/README.md` (from WP 2.6: the `box-room-iso` case) and `tests/unit/hooks/settings.test.ts` (from WP 0.10: the stress-box skill) (ADR-0014, amendment 10)
- **Needs:** WP 2.4, WP 2.5, WP 2.6
- **Size:** L
- **Carry:** the scene and timer patterns of `engine` §10. The stress-world page structure, as a reference only.
- **Build:**
  - **`createEngine`** with the loop of §6.4 (fixed step plus interpolation), and routes that map `?scene` to the scenes registered with `engine/sim/scene.ts` (WP 1.5): `?scene ?cam ?seed ?set ?replay`.
  - **The rendering members of `__engine`** (§8.3), registered from `engine/app/viewMembers.ts`, which engine/app/headless.ts loads, so a page and Node list the same members (ADR-0014, amendment 10): `render`, `shot`, `camera`, `scene.dump` (`stats` arrives with WP 5.5).
  - **`createHeadless({ …, view: true })`** also builds the scene's presentation graph in Node, so `scene.dump()` and `camera` work headless (§8.3).
  - **The error overlay**, and `ready || error`.
  - **`x set`** (schema-validated; prints the URL parameter and applies it to the inspect session), **`x eval`** and **`x dump`**, over **`x inspect`**.
  - **The CPU-only gameplay contract** (§6.7, doctrine: WebGPU only): `x replay --browser page` runs a replay in the scene's own page, rendering as it steps, against the golden hashes. `tests/e2e/parity.spec.ts` starts here with the box-1 replays and the contract's checks; each later stage adds its scenes.
  - **The box, stage 1:** the page, which the landing page (`index.html`, WP 0.12) now opens; `levels/room.txt` (16 × 12 m: walls, one low wall, a pillar, spawn markers); `scenes/room.ts`, with three scripted movers (boxes on fixed paths, no physics yet) so that stepping changes state; `README.md`; the first box suite.
  - The `stress-box` skill: the box's layout, how to add a scene or variant, the quick loop (§9.0).
  - **The README check** (shardfall's station guides, §5.8): `tests/unit/box-readme.test.ts` fails when `labs/box/README.md` names a setting, file or `x` command that does not exist.
  - **The `scene` template** for `x new scene` (§8.13): a box scene with its replay test.
- **Improves:** I-07, I-25, I-26, I-37, I-43.
- **Done when:**
  - `x sim labs/box/scenes/room --steps 600` gives the same hash three times in Node, and the box-1 replay gives the same golden hashes in the page while it renders.
  - Switching every camera preset and resolution mode during that replay leaves its hashes unchanged.
  - `x shot labs/box --scene room --cam iso`: the ID pass lists the floor, every wall run, the low wall, the pillar and the movers; the look metrics are within thresholds; thumbnails are recorded.
  - `x new scene --test` scaffolds a box scene that passes its checks.
  - Cycling every camera preset builds 0 pipelines after warm-up.
  - Every inspector member is tested in the browser and headless, and `help()` matches the API.
  - Every setting is reachable through `x set` and `__engine.set` (the Agent-operable test of §3).
  - In Node, `createHeadless({ scene: 'box:room', view: true })` dumps the room's scene graph, and `render` and `shot` throw `no renderer`.
  - The README check passes, and fails on a fixture README that names a missing setting.
- **Verify:** `node x replay tests/replays/box-1-*.replay.json --browser page && npm run e2e -- tests/e2e/box.spec.ts tests/e2e/parity.spec.ts && node x docs --check && node x new scene --test && npm test -- engine/app tests/unit/box-readme`

**Gate G2, Box 1:** the box room steps headless with golden hashes that hold in Node and in Chromium, renders on WebGPU with every object in the ID pass and its hashes unchanged while it renders, builds 0 pipelines after warm-up, and every inspector member and setting is reachable from `x` and `__engine`.

### Phase 3: Box 2, a hero (lanes P, I, A, R, T, B)

#### WP-3.1 Rapier adapter and queries
- **Owns:** `engine/physics/{world,binding,groups,params,capture,queries}.ts` (binding.ts split from world.ts: ADR-0014 amendment 16), `engine/sim/{queryView,levelBodies}.ts`, `fixtures/scenes/physics-40/`, `tests/replays/physics-40.replay.json`, `.claude/skills/rapier/`; extends `engine/sim/{scene,world,state}.ts` (from WPs 1.4–1.5) with `physics: true` and the settings part of the hash, and re-records `tests/replays/kernel-*.replay.json`
- **Needs:** WP 2.2
- **Size:** M
- **Carry:**
  - The world setup and collision groups of `stress-world/20-sim.js:29-33, 118-131` (PORT, in SI units).
  - `hallColliders` (`stress-world/10-hall.js:188-201`), as the model for level bodies.
- **Build:**
  - Initialize `@dimforge/rapier3d-simd-compat`'s embedded WASM (0.21, §4.7) once, in Node and in the browser.
  - World gravity, for bodies, is a scene setting with a default of 9.81 m/s². Characters fall under their own `characterGravity` (WP 3.2), as in shardfall, where props at 9.81 m/s² look right and characters at 32 m/s² feel right (§5.8). The prototype used 30 m/s² for everything, a starting value the box may keep.
  - One table each for integration parameters and collision groups (world, prop, actor, crowd, flyer, corpse).
  - Insertion in a deterministic order; stepping inside the sim, then readback.
  - Every body's translation, rotation and velocities, in handle order, folded into the sim hash (§6.5); snapshot bytes are never hashed.
  - **Capture and restore** (§6.5): `capture()` takes Rapier's snapshot with the engine's state, and `restore()` rebuilds the world from it. The restored run continues exactly like the uninterrupted one (Rapier 0.21, measured in §4.7), so a capture needs no extra step.
  - **Level bodies:** WP 2.2's collider descriptors become one fixed body of merged boxes.
  - **The `rapier` skill:** Rapier under the reproducibility contract, captures included (§8.10).
  - **Queries:** raycasts, shape casts, overlaps, and `probe(x, z) → { y, normal }` for animation. The read-only `QueryView` that `sim.snapshot()` exposes to presentation code (§6.1), with a test that it offers no mutation.
- **Improves:** I-06.
- **Done when:**
  - A 40-body replay matches its goldens in Node and in Chromium.
  - A capture taken mid-replay, with bodies in contact, restores in Node and in Chromium and continues with the uninterrupted run's hashes.
  - `fixtures/levels/room.txt`'s level bodies match its solid grid.
  - The `QueryView` is read-only.
- **Verify:** `npm test -- engine/physics engine/sim/levelBodies && node x replay tests/replays/physics-40.replay.json --browser sim`

#### WP-3.2 Character controller
- **Owns:** `engine/physics/{character,move,feel}.ts` (move.ts split from character.ts at gate G3's review, ADR-0020 amendment 6), `engine/sim/actors.ts` (spawns an actor with its controller; WP 3.7 extends it with the animator), `engine/app/feelMember.ts` (the `feel` inspector member, moved there from actors.ts by gate G2's review so it registers whatever loads first), `fixtures/scenes/steps/` (steps, slopes, a one-box floor and a floor of merged boxes, built by a scene script, because the level's stairs arrive in WP 4.2), `tests/replays/steps.replay.json` (its run with goldens, after G9: ADR-0014 amendment 17); extends `tools/cmd/sim.ts` (from WP 1.5) with `--feel`; core proposal: engine/physics/world.ts gains `rapierOf(physics)` (accepted, ADR-0020 amendment 3)
- **Needs:** WP 3.1
- **Size:** M
- **Carry:**
  - The stress-world controller config (converted; Appendix C), as starting values.
  - The Platformer feel settings (`engine` §16).
  - **From shardfall** (§5.8), whose axes and units are ours, so nothing needs converting:
    - the controller wiring and its fixes (`pavilion-lite/src/character.rs:179-399`; `crates/pav_core/src/character.rs:959-1089`; 13 tests in `crates/pav_core/tests/movement.rs`): the across-then-down move, snap only when grounded, autostep over dynamic bodies, a 1 mm nudge so moving floors carry, pushing as a 70 kg mass that shares momentum, weight on dynamic floors, post-move velocity fixes, a one-way-platform predicate, and skipping idle characters;
    - its movement maths and defaults (`crates/pav_core/src/character.rs:124-162, 770-925`): coyote 0.10 s, jump buffer 0.12 s, jump cut 0.45, apex 1.35 m, fall speed capped at 26 m/s, acceleration 45, deceleration 32 and skid 90 m/s²;
    - the feel meter (`crates/pav_core/src/feel.rs`).
- **Build:**
  - `createCharacter({ capsule, offset, snap, autostep, maxSlope, slide, push, characterGravity, feel: { coyote, buffer, variableJump, wallJump, dash, airControl } })`.
  - **Intents → velocity → two moves: across, then down.** One combined `computeColliderMovement` loses all sideways motion on some ticks on level ground, and the split fixes it (measured on Rapier 0.21, §4.8).
  - **Order within a step:** movers set their velocities, then characters move, then the world steps. Characters spawn 0.025 m above the floor, just outside the 0.02 m skin, so they don't stick at seams (shardfall's lessons).
  - Jump, dash, a ground probe, and pushing dynamic bodies. Rapier 0.21 reports the controller's contacts in world space, as 0.19.3 does (§4.8).
  - **`characterGravity`** is the controller's own, separate from the world's (WP 3.1).
  - **The feel meter** (`engine/physics/feel.ts`): response ticks, acceleration, stop and turn times, jump apex, air time and reach. It is an inspector member and an `x sim --feel` report, so agents tune feel by numbers, and WP 4.3's walkable grid takes the reach as a climb limit.
  - The prototype's grounded-flicker workaround for Rapier 0.19.3 (a small downward component each step) only if the Done-when test still needs it.
  - **As built (ADR-0020 amendment 3):** Rapier's autostep, snap and impulses are off; steps, snap-to-ground and momentum-sharing pushes (an inelastic collision of a push-kg mass, level with the centre of mass) are the controller's own; a grounded move is lifted by the skin first; the flicker workaround was not needed.
- **Done when** (Node tests):
  - Walking across a one-box floor and a floor of merged boxes with the usual downward push, no tick moves less than 95% of the intended distance.
  - It climbs a step 0.05 m below the height it is configured to climb, and refuses one 0.05 m above it. With a 0.281 m capsule, an autostep of 0.25 m climbs 0.30 m and refuses 0.35 m (§4.8), so the configured height is the measured one, not the raw setting.
  - Slopes up to 50° are climbable.
  - The jump apex equals v²/2g for the configured jump speed and `characterGravity`, ± 2 cm.
  - A dash covers its configured speed × duration, ± 2 cm, and respects the configured cooldown.
  - It pushes a 20 kg crate, which moves off with shared momentum.
  - Coyote time and buffer are exact in ticks.
  - The grounded flag never flickers on flat lateral motion.
  - The feel meter reports every number for the box hero's settings.
- **Verify:** `npm test -- engine/physics/character engine/physics/feel`

#### WP-3.3 Input devices, bindings, intents
- **Owns:** `engine/input/**` except `intents.ts`, which only gets extended
- **Needs:** WP 1.5, WP 2.5
- **Size:** M
- **Carry:**
  - The action model of `engine:476-694`.
  - The rebinding mechanism of `ed/61-controls.js`.
  - The lessons in `docs/CONTROLS-AUDIT.md`.
- **Build:**
  - **Devices:** keyboard; mouse, with pointer lock and wheel; gamepads in any slot, with a radial deadzone and analog triggers. Bindings by physical key (`KeyboardEvent.code`), a system layer that is never rebound, taps shorter than a frame kept, prompts that follow the last-used device, and a scripted gamepad format for tests (shardfall's, §5.8). Touch arrives in WP 3.12.
  - **Action maps and presets.**
  - **Bindings:** rebind, conflicts, reserved keys, persistence, labels per device.
  - **Edges, buffering and `consume`** in sim time.
  - **Clear on blur, visibility change and disconnect.**
  - **Camera-relative intents**, through `intents.fromCamera` and the camera's `yaw()`.
  - **A virtual device, and a recorder.** `__engine.input` (§8.3) drives the virtual device; this WP registers that member from its own file, `engine/input/devices/inspector.ts`. It adds `hold(action, down)` and `state()` to §8.3's four members (ADR-0014 amendment 9).
- **Improves:** I-24.
- **Done when:** browser tests pass with injected keyboard and gamepad-stub events, and the intents are unit-tested in Node.
- **Verify:** `npm test -- engine/input && npm run e2e -- tests/e2e/input.spec.ts`

#### WP-3.4 Skeleton, builds, pose, FK, sheets
- **Owns:** `engine/anim/{skeleton,builds,pose,fk,sheet,check}.ts`
- **Needs:** G1
- **Size:** M
- **Carry:**
  - The builds (`chibi heroic bulky skeleton`, `size`) from `engine` §11, in metres (`hipZ` → `hipHeight`, `headR` → `headRadius`; new `ankleHeight`, `footLength`, `handLength`, `chestDepth`; ADR-0009 amendment 1).
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
  - **`anim.sheet()`** (public name `animSheet`, ADR-0009 amendment 1): SVG skeleton contact sheets in Node. `x sheet` (WP 6.6) turns them into PNG through the browser, on demand.
  - **The core of `anim.check(def)`** (public name `animCheck`): finite values, bone lengths and declared rigid pairs, feet at or above the floor, sockets reachable. WP 6.6 adds the state matrix, the QA family and sheets.
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
  - `twoBone`, verbatim, except a unit fallback when the pole lies along the limb (ADR-0009 amendment 2).
  - `twoBoneRot`: local quaternions with an explicit pole (a world direction; hinge knees and elbows).
  - `aim`: a chain spread over chest, neck and head, with limits.
  - `footPlant(probe)`: drop the pelvis, align the foot to the normal, lock it during stance.
  - `handTo`: hand IK to a grip (the weapon socket).
  - No per-solver weight: a solve is faded with `blendPoses` (ADR-0009 amendment 2).
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
    - feet and hands. The old `footL`/`footR` is the sole, not the ankle: compare it with the sole point under the ankle (contact height), not with the `foot` joint, which is `ankleHeight` above it (ADR-0009 amendment 1).
  - A fixed dt, and seeded per-entity streams.
- **Improves:** I-09.
- **Done when:** the differential tests against `tests/baselines/port/humanoid-*.json`, converted to SI, pass:
  - joint positions are within 1 cm on average and 3 cm at worst;
  - every exception is listed with its reason. The removed view hacks are the expected exceptions.
- **Verify:** `npm test -- engine/anim/humanoid` (the motion QA runs over it from WP 6.6 on)

#### WP-3.7 The Character animator and the body-state vocabulary
- **Owns:** `engine/anim/{character,states,weights}.ts`; extends `engine/sim/actors.ts` (WP 3.2) with the animator; `engine/app/animMember.ts` (the `anim` inspector member, delivered at gate G3's review)
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
- **As built (ADR-0009 amendment 4):** `Animator` and `AnimatorInput` (sim-api already had `Character` and `BodyState`); the stack's slots, layers and LODs live in weights.ts; actors hold the animator in a component of their own, `animator`; the post-IK slot stays empty until footPlant takes a `floor` (core proposal).
- **Verify:** `npm test -- engine/anim/character engine/anim/states engine/anim/weights`

#### WP-3.8 Instancing service and puppets
- **Owns:** `engine/gfx/instancing.ts`, `engine/gfx/puppets/{grammar,compile,draw,blobShadow}.ts`, `engine/gfx/puppets/bodies/humanoid.ts`, `fixtures/bodies/`
- **Needs:** WP 2.4, WP 2.6, WP 3.4
- **Size:** L
- **Carry:**
  - `Batch` (`stress-world/30-crowd.js:20-67`), with its rule of more than 1,000 slots.
  - The lab3d grammar (`lab3d/40-characters.js:8-48`).
  - The `humanParts` sizing (`stress-world/30-crowd.js:98-138`) and the builds' drawing fields.
  - `shadowAt`, the blob shadows (`stress-world/30-crowd.js:334-364`).
- **Build:**
  - **The instancing service**, which contains the pinned three.js's quirks (§4.7, Appendix B):
    - capacity paging, with every page over 1,000 slots so all pages share one shader;
    - `StaticDrawUsage` with update ranges (§4.7), and instance colours set before the first render (a first `setColorAt()` after the mesh has rendered never shows on WebGPU; research note H);
    - awareness of the uniform-buffer limit; shared materials; per-instance palette attributes.
  - **Body grammar v2:**
    - parts on bones: limb, curve, ball, box, cone, eye, blade, cape strip, hair strands;
    - points: a bone name, `[f, r, u]`, `lerp`, `off`;
    - material slots, and L/R mirroring.
  - **Compiled** to instanced parts per part type (for crowds) or to one rigid-skinned three.js `SkinnedMesh` per character, whose `Skeleton` takes the pose from WP 3.4. Smooth skinning is optional, later.
  - **The neutral humanoid body**, and blob shadows.
- **Improves:** I-15, I-19, I-21, I-49.
- **Done when:**
  - A 2,000-instance batch updates: the ID-pass counts follow the moved instances.
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
- **Owns:** `tools/cmd/film.ts`, `tools/lib/film{Compare,Sheet}.ts` (split at gate G3's review, ADR-0014 amendment 13); extends `tests/unit/box-readme.test.ts` (from WP 2.7: the fixture's missing command is a misspelling of film) (ADR-0014, amendment 11)
- **Needs:** WP 2.7, WP 3.3
- **Size:** M
- **Carry:** `tools/filmstrip.mjs` (PORT): the step DSL, contact sheets, diffs.
- **Build:**
  - `x film --steps "…"`: a step DSL over `__engine.input` and `step`.
  - Contact sheets with labels; thumbnail baselines.
  - `--compare <ref>` (default `HEAD`) through a temporary `git worktree`, with attribution from the ID pass. A base that lacks the scene gives "no baseline", a deferred proof rather than a failure.
- **Improves:** I-28.
- **Done when:** `x film` on the box room writes a sheet and JSON; `--compare HEAD` reports no difference on an unchanged tree and attributes an injected change to the right object; a scene missing from the base reports "no baseline".
- **Verify:** `npm test -- tools/cmd/film && node x film labs/box --scene room --steps "step 60" --compare HEAD`

#### WP-3.12 Touch controls (built, not tested)
- **Owns:** `engine/input/devices/touch.ts`, `engine/ui/{touch,swipe,chrome}.ts`, `engine/ui/{touch.css,manifest.webmanifest}`, `engine/gfx/quality.ts`; extends `engine/input/**` (from WP 3.3: the `touch:<action>` codes, and the stick merged with keys and pads), `engine/gfx/resolution.ts` (from WP 2.1), and `engine/app/{engine,loop}.ts` and `labs/box/index.html` (from WP 2.7: the touch layer's wiring, `createEngine`'s `touchLayout` and `onMenu` options, and the 60 fps cap)
- **Needs:** WP 2.7, WP 3.3
- **Size:** M
- **Carry:**
  - **From shardfall** (§5.8), the design of the touch controls it ships for phones and tablets, which the owner asked this engine to mimic (ADR-0021). Shardfall checked it only under phone emulation, never on a real phone (`docs/HISTORY.md:99-105`):
    - `crates/pav_app/src/touch.rs`: finger routing, the floating stick, the button fan, taps, holds and swipes;
    - `crates/pav_app/src/quality.rs:29-115`: the quality tiers and what each turns off;
    - `crates/pav_app/src/app.rs:275-331, 799-808, 1015-1019, 1650-1653, 1724-1726`: touch mode, closing panels with a tap, the 60 fps cap, the stick into intents, clearing on blur, and switching back to the mouse;
    - `web/index.html:5-58` and `web/manifest.webmanifest`: the page.
- **Build:**
  - **Layers** (§6.1): `input/devices/touch.ts` reads pointer events and writes intents; `ui/touch.ts` and `ui/swipe.ts` draw HTML/CSS and import no input device; `gfx/quality.ts` gets the touch mode from `app`, which wires the three. The modules' file comments carry no runnable `@example`, which would amount to a touch test (ADR-0021).
  - **Touch mode** starts when `matchMedia('(pointer: coarse)')` matches or at the first touch, and ends when a `pointermove` whose `pointerType` is `mouse` moves more than 2 px (a tap also fires emulated mouse events, which must not count). It sets the `touch` class on the page.
    - The setting `touch` (`auto`, `on` or `off`; a `view` setting, WP 1.2) forces it either way through `x set`, the URL and `__engine.set`, so an agent can open the touch layer headlessly and read it through DOM queries (doctrine: Agent-operable).
    - It is a machine interface, not a test: no touch spec uses it (ADR-0021).
  - **Fingers are routed by the DOM,** from the top: the menu button, open panels, the action buttons, swipeable notices, then the canvas. Layers take `pointer-events: none` and controls `auto`. On the canvas, the first finger is the stick. Pointer capture keeps each finger on what it first touched.
  - **A floating stick** wherever the thumb lands:
    - a radius of 56 CSS px; a dead zone of 0.12, and full speed at 0.82 (`v/|v| · min((|v| − 0.12)/0.7, 1)`, with v = (dx, −dy)/56, so pushing up the screen is forward; `touch.rs:266-272`);
    - a thumb that runs past the rim drags the centre along;
    - while it is held, a faint 112 px ring and a 44 px knob show where it is (`touch.rs:443-450`).
  - **Into intents:** `move = intents.fromCamera(camera.yaw(), stick)`, added to keys and pads and clamped to length 1. Buttons carry `data-action`, and every action also binds the code `touch:<action>` in WP 3.3's action maps. Touch intents are recorded like any other, so touch play replays.
  - **Taps and holds** are timed in seconds, with a one-frame guard so a slow frame never turns a tap into a hold (`touch.rs:48-58, 76-97`):
    - a tap on the game is shorter than 0.30 s, or seen for a single frame, and moves less than 14 px;
    - on a button, a release that moved less than 28 px is a tap however long it was down, except after a hold on a button that acts while held, as shardfall's skills do (`touch.rs:225-238`);
    - a hold lasts at least 0.32 s and two frames;
    - a tap on the open game closes the top panel;
    - `pointercancel` never taps, and blur clears every finger.
  - **Buttons** (`engine/ui/touch.ts`), from a `touchlayout` entry: `{ buttons: [{ action, label?, hold? }], menu: true }` (`hold`: acts while held, ADR-0021 amendment 1). The page names its layout (`createEngine({ touchLayout: 'touchlayout:box' })`); scenes stay sim-side and name none. Without a layout, only the stick shows.
    - Slots fill in order: the main button (68k px across), centred 40k px in from the right and bottom margins; then an inner ring of 48k px buttons, 92k px from its centre, at 180°, 225° and 270°; then an outer ring at 158k px, at 205° and 245°.
    - Angles are in screen space with y down, as in shardfall's `Fan` (`touch.rs:590-595`): 180° is straight left of the main button and 270° straight above it. Round buttons take touches up to 8 px outside their rim (`touch.rs:114`).
    - A 38k px menu button at the top right pauses, then calls `onMenu`, which the page passes to `createEngine`.
    - `k = clamp(min(width, height)/390, 0.8, 1.25)`, set as the CSS variable `--touch-k`. Margins are 14k px.
    - Pressed buttons shrink to 94% and darken. Buttons hide under open panels; the menu button never does.
  - **Swipe to dismiss** (`engine/ui/swipe.ts`), for elements marked `data-swipe` (notices, banners, cards): they follow the finger and fade. Past 72 px, or flicked 26 px within 0.3 s, they fly off; otherwise they spring back. A dismissed element stays gone until its `data-swipe-key` changes.
  - **Defaults for phones** (`engine/gfx/quality.ts`): the setting `quality` (`auto`, `low`, `medium` or `high`) is a `view` setting (WP 1.2), which `capture()`, the hash and sim-side code never see. `auto` means `medium` on touch screens and `high` elsewhere.
    - `medium`: at most 1 megapixel, one shadow caster, GI and god rays off.
    - `low`: at most 0.5 megapixel, no shadow casters, and bloom and halos off as well.
    - `high` on a touch screen: at most 2 device pixels per CSS pixel.

    `resolution.ts` applies the pixel caps now; WPs 7.1, 7.4 and 11.5 apply the rest as their features arrive. Touch screens also draw at most 60 frames a second: `app/loop.ts` skips an animation frame that arrives more than 2.5 ms before the next 16.667 ms slot, and resets the slot when it falls behind (`app.rs:799-808`).
  - **The page** (`engine/ui/chrome.ts`, plus `touch.css` and `manifest.webmanifest`, which `labs/box/index.html` links with `<link>` tags; no engine module imports a `.css` file, since tsx, which runs every `x` command, cannot load one):
    - a viewport that does not zoom, as shardfall's (`width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no`, without `viewport-fit=cover`, so the browser keeps the page clear of notches);
    - a manifest asking for full screen and landscape, with no icon, as in shardfall, and with `start_url` and `scope` set to `/`: Vite emits a linked manifest as `/assets/manifest-<hash>.webmanifest`, where shardfall's `./` would open `/assets/`, a 404 (measured);
    - no scrolling, overscroll, text selection or tap highlight; the canvas at `100dvh`; open panels start below the menu button, are at most `calc(100dvh - 66px)` tall, and scroll (`overflow: auto; touch-action: pan-y`);
    - in touch mode, the first `pointerup` (once, in the capture phase) asks for full screen and a landscape lock, and ignores a refusal (iPhones keep their bars);
    - in portrait, a "turn sideways" hint fades after 5 s, and `resolution.ts` widens the vertical field of view so the horizontal one is kept (`2·atan(tan(fov/2)/aspect)`, at most 150°; `crates/pav_view/src/camera.rs:168-173`);
    - on touch screens, key hints, the keyboard guide and the dev stats are hidden, HUD text scales with `--touch-k`, and touch targets are at least 44 × 34 px.
  - **Left out,** as in shardfall or by choice: camera rotation by touch, pinching in the world, drag-to-aim, haptics and the gyroscope. Shardfall's players need not press attack: by default the nearest foe is struck automatically (a setting; with it off, attack takes the corner button). That is game logic, which a game builds from recorded settings, so the engine adds nothing for it.
- **Improves:** I-52.
- **Done when:**
  - On the desktop nothing changes: `npm run check`, the input unit tests and the input and box suites stay green, with no new advice.
  - The box uses it from WP 3.10, through its touch layout *(deferred proof: WP 3.10 adds the layout; like the rest of the touch layer, only the owner's reports check it, ADR-0021)*.
  - The touch layer itself is not tested, by the owner's order (ADR-0021): no touch specs, device emulation or phones *(deferred proof: the owner's reports. A reported problem is then reproduced by whatever it needs, the `touch` setting or Playwright's touch emulation included, fixed and noted in the ledger; no standing touch suite is added)*.
- **Verify:** `npm run check && npm test -- engine/input && npm run e2e -- tests/e2e/input.spec.ts tests/e2e/box.spec.ts`
#### WP-3.10 Box 2: a hero in the box
- **Owns:** `labs/box/scenes/room-hero.ts`, `labs/box/cast/hero.ts`, `labs/box/touch.ts`; extends `labs/box/{README.md,main.ts}` and `tests/e2e/parity.spec.ts` (from WP 2.7); `tests/replays/box-2-*.replay.json`, `tests/e2e/box-hero.spec.ts`; core proposal: `engine/gfx/puppets/actors.ts`; extends `engine/gfx/{stage,cameras/place,puppets/draw}.ts`, `engine/app/{view,routes}.ts` and their unit tests, `tests/unit/box-readme.test.ts`, `.claude/skills/stress-box/SKILL.md` (accepted, ADR-0008 amendment 4)
- **Needs:** WP 2.7, WP 3.3, WP 3.7, WP 3.8, WP 3.9, WP 3.11, WP 3.12
- **Size:** M
- **Carry:** the hero's speeds and timings (`stress-world/20-sim.js:108-114, 242-301`) as starting values (Appendix C). They override WP 3.2's defaults (shardfall's) where both set a value.
- **Build:**
  - **The hero actor:** the controller, the animator and the neutral humanoid body, walking, dashing and jumping onto the low wall.
  - **Scripted replays:** walk a square, dash, jump onto the low wall.
  - **The CPU-only gameplay contract** (`parity.spec.ts`, §6.7): the box-2 replays give their goldens while the page renders; live play in the page, recorded with `__engine.input.record()`, replays in Node to the same hashes; switching cameras and resolution modes never changes them.
  - **The camera suite:** every camera (the presets, chase, fly, fixed) passes an ID-pass check: the hero is visible, and coverage is sane. First person passes the inverse check: the hero's body is culled (only the hands and the weapon socket may cover pixels), and no wall covers more than 70% of the frame.
  - W walks away from the camera in every camera mode.
  - **The box's touch layout** (`labs/box/touch.ts`, WP 3.12): jump as the main button, then dash. The box page names it, for every scene. Like the rest of the touch layer, it is not tested (ADR-0021).
- **Improves:** I-07, I-43.
- **Done when:**
  - The replays give their golden hashes in Node and in the rendering page.
  - Live recordings replay in Node to the same hashes.
  - The camera checks pass, and 0 pipelines are built after warm-up.
  - The humanoid's differential tests are green.
- **Verify:** `node x replay tests/replays/box-2-*.replay.json --browser page && npm run e2e -- tests/e2e/parity.spec.ts tests/e2e/box-hero.spec.ts`

**Gate G3, Box 2:** the hero walks, dashes and jumps in replays that give their golden hashes in Node and in the rendering page; live play in the page replays in Node; every camera passes its ID-pass check; the animation port is within tolerance; `x film` compares the box with `HEAD`; and a fresh-agent dry run (a subagent given only AGENTS.md and the generated docs adds a box variant with `x new scene` and records a replay) has its friction list fixed or answered in the gate note.

### Phase 4: Box 3, the hall (lanes P, W, R, B)

#### WP-4.1 Bodies and props physics
- **Owns:** `engine/physics/bodies.ts`, `fixtures/scenes/physics-props/`, `tests/replays/physics-props{,-lift}.replay.json` (the lift's after G9: ADR-0014 amendment 17); extends `engine/physics/character{,.test}.ts` and `engine/physics/move.ts` (from WP 3.2) with the kinematic carry (accepted, ADR-0020 amendment 5)
- **Needs:** WP 3.2
- **Size:** S
- **Carry:** the props' physics (`stress-world/20-sim.js:141-171`): density, friction, restitution, damping, and `knockProp`'s impulse and torque.
- **Build:**
  - Dynamic body helpers (box, cylinder, capsule, ball); impulses and torque impulses; stacking; sleeping.
  - The lost-body rescue: a body below the floor or outside the level is put back on a walkable tile.
  - Sensors and triggers that emit events.
  - **Movers:** kinematic bodies whose pose is a function of the tick, `pose((tick + 1) · dt)`, applied as velocities, so they carry riders and restore exactly (shardfall's `behaviors.rs`).
- **Done when:**
  - A mover carries the hero, and a capture taken mid-ride restores exactly.
  - Stacked crates topple the same way every run, and the replay matches its goldens in Node and in Chromium.
  - A capture taken while the crates fall restores and continues exactly, in Node and in Chromium.
  - The rescue returns a body that fell through to a walkable tile.
- **Verify:** `npm test -- engine/physics/bodies && node x replay tests/replays/physics-props.replay.json --browser sim`

#### WP-4.2 The level compiler (v2): the hall
- **Owns:** extends `engine/world/level/**` (from WP 2.2) with the v2 glyphs; extends `engine/sim/levelBodies.ts` (from WP 3.1) with convex hulls; `labs/box/levels/hall.txt`, `tests/baselines/qa-geo-hall.json`; core proposal: extends `engine/physics/{world,queries,world.test}.ts` with the hull shape and edits one glyph in `engine/gfx/level/meshes.test.ts` (accepted, ADR-0020 amendment 4)
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
- **Owns:** `engine/world/{nav,spatial}.ts`, `fixtures/scenes/nav-1000/`, `tests/replays/nav-1000.replay.json` (after G9: ADR-0014 amendment 17); extends `tools/cmd/sim.ts` (from WP 1.5) with `--map`
- **Needs:** WP 3.2, WP 4.2
- **Size:** M
- **Carry:**
  - `PASS`, `CLIMB` and the Dijkstra `FLOW` (`stress-world/10-hall.js:129-178`).
  - `SpatialHash` (`engine:3626-3646`).
- **Build:**
  - The walkable grid with climb limits and one-way ledges. A climb limit is data: the crowd's, or the hero's jump reach from the feel meter (WP 3.2), since `world` cannot import `physics`.
  - Multi-target, cached flow fields on a typed-array heap, with reach and a field cached per goal cell.
  - A* on the grid with line-of-sight smoothing; ties broken by index; no corner cutting; a look-ahead direction (shardfall's `nav.rs`, §5.8). Navigation is derived data: it is never saved, and rebuilding it after a restore gives the same grid.
  - A text map of the grid with blocked cells and a route, in `x sim --map` (a text form of shardfall's `levelmap nav=true` picture).
  - A spatial hash on typed arrays, with no allocation per step.
- **Improves:** I-22.
- **Done when:**
  - In the hall, the flow field reaches every walkable tile from the spawn, and one-way ledges are respected.
  - With the hero's jump reach as the climb limit, the hall's grid reaches every gallery from the spawn, and a test ledge above the reach is not walkable.
  - 1,000 agents' queries stay within the budget recorded in `tests/baselines/perf/nav-1000.json` (6 ms per step).
- **Verify:** `npm test -- engine/world/nav engine/world/spatial && node x perf fixtures/scenes/nav-1000 --budget`

#### WP-4.4 Level meshes (v2) and cutaway
- **Owns:** extends `engine/gfx/level/**` (from WP 2.4) with stairs, galleries, the dais and pillars with plinths and capitals; `engine/gfx/cutaway.ts`; core proposal: re-records `tests/baselines/thumbs/box-room-iso.json` (the room's pillar gains its plinth and capital; ADR-0008 amendment 2)
- **Needs:** WP 2.4, WP 4.2
- **Size:** M
- **Carry:**
  - The stairs, gallery, dais and pillar meshes (`stress-world/10-hall.js:336-405`).
  - The wall and pillar cutaway (`stress-world/10-hall.js:302-370`, `40-cameras.js:166-181`) and `segBox`.
- **Build:**
  - Meshes for the v2 glyphs; each flight of stairs is one solid of steps, a descriptor's flights one mesh (the prototype used a mesh per step, 20).
  - **Cutaway:** walls facing an outside camera swap to their cut twin; pillars between the camera and the focus become stumps.
  - Everything registered with the warm-up.
- **Done when:**
  - Cutaway is unit-tested: which walls and pillars cut for a given camera pose.
  - The hall renders within its draw-call budget, and turning the camera builds 0 pipelines after warm-up.
- **Verify:** `npm test -- engine/gfx/level engine/gfx/cutaway && npm run e2e -- tests/e2e/hall.spec.ts`

#### WP-4.5 Props as data
- **Owns:** `engine/world/props/**`, `engine/gfx/props.ts`; extends `tools/qa/{geo,tex}{,.test}.ts` (from WPs 2.4 and 2.3) to check props under their ids (ADR-0012 amendment 3)
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
  - Each renders, with ID-pass coverage above 0.
  - A knocked crate's mesh follows its body.
- **Verify:** `node x qa geo tex --only prop: && npm run e2e -- tests/e2e/props.spec.ts`

#### WP-4.6 Box 3: the hall
- **Owns:** `labs/box/scenes/{hall,hall-props}.ts`; extends `labs/box/{README.md,main.ts}` and `tests/e2e/parity.spec.ts` (with this stage's scenes); `tests/replays/box-3-*.replay.json`, `tests/e2e/box-hall.spec.ts`; core proposal: `engine/sim/props{,.test}.ts`, `engine/gfx/stageProps{,.test}.ts`; extends `engine/gfx/stage.ts`, `engine/sim-api.ts` (accepted, ADR-0008 amendment 5)
- **Needs:** WP 3.10, WP 4.3, WP 4.4, WP 4.5
- **Size:** M
- **Carry:** the prop placement (seeded spots, every fifth crate stacked; `stress-world/20-sim.js:141-171`) as a starting point.
- **Build:**
  - The hall scene with the hero, and the props scene (10–300 crates and barrels).
  - Replays: climb to the west gallery; push and knock crates; walk the dais.
- **Improves:** I-07, I-43.
- **Done when:**
  - The replays give their golden hashes in Node and in the rendering page.
  - The hero ends on the gallery, more than 0.9 m above the floor.
  - A knocked crate moves more than 0.25 m.
  - The hall's ID pass and metrics are recorded, and 0 pipelines are built after warm-up.
- **Verify:** `node x replay tests/replays/box-3-*.replay.json --browser page && npm run e2e -- tests/e2e/box-hall.spec.ts tests/e2e/parity.spec.ts`

**Gate G4, Box 3:** the hall compiles and validates; the hero climbs to a gallery and knocks crates in replays that give their golden hashes in Node and in the rendering page; navigation covers every walkable tile.

### Phase 5: Box 4, a crowd (lanes P, W, A, R, T, B)

#### WP-5.1 Crowd bodies
- **Owns:** `engine/physics/crowd.ts`, `fixtures/scenes/crowd-1000/`, `tests/replays/crowd-1000.replay.json`
- **Needs:** WP 4.1
- **Size:** M
- **Carry:** the crowd pattern of `stress-world/20-sim.js:174-222, 498-516` (mechanism only): velocity intents with acceleration limits, locked rotations, a min friction combine, sleeping, knockback as momentum, launches, a corpse group, the grounded heuristic and the lost-body rescue.
- **Build:**
  - Crowd agents (capsule or ball) with spawn and despawn queues.
  - `setVelocity` with approach limits; launches; the corpse group and its timers; grounded detection; a wake and sleep policy.
  - The crowd runs on Rapier 0.21's SIMD build, the engine's only build (§4.7: 22.1 ms per step for 5,000 capsules, against 29.2 ms for `compat`).
- **Done when:**
  - 1,000 agents pushing toward a point stay within a budget recorded here (the median of 5 runs on the development platform): step 12 ms, hash 36 ms, capture 16 ms (tests/baselines/perf/crowd-1000.json; measured step 3.0 ms idle, 5.8-6.4 ms at load 25-30).
  - `tests/replays/crowd-1000.replay.json` matches its goldens in Node and in Chromium.
  - Corpses settle and are removed on schedule.
- **Verify:** `npm test -- engine/physics/crowd && node x perf fixtures/scenes/crowd-1000 --budget && node x replay tests/replays/crowd-1000.replay.json --browser sim`

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
- **Done when:** unit tests pass, the squash preserves volume, and every pose is finite. The blob's update matches WP 0.11's reference vectors after conversion (Appendix C), within 1 cm on average, with every exception listed with its reason.
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
  - 5,000 agents draw, and no pipeline is built as the crowd grows.
  - The sim hash is identical with LOD on and off.
  - Draw calls stay within budget.
- **Verify:** `npm run e2e -- tests/e2e/crowd-render.spec.ts`

#### WP-5.5 Performance counters and the crowd ladder
- **Owns:** `engine/dev/stats.ts`; extends `tools/cmd/perf.ts` (from WP 1.5) with browser counters and `--ladder`; with ADR amendment (ADR-0014, amendment 12): `engine/sim/{world,scene}.ts` (the system probe), `engine/app/{headless,engine}.ts` (the meter's wiring)
- **Needs:** WP 2.7, WP 5.1
- **Size:** S
- **Carry:** the benchmark's split into physics, logic and drawing (`stress-world/60-panel.js:205-263`).
- **Build:**
  - `stats()`: sim, physics, animation and render milliseconds; draw calls, triangles, compute calls, pipelines, and texture and geometry counts. This WP registers the member from `engine/dev/stats.ts` (§8.3).
  - `x perf` in the browser: counters, never fps.
  - `--ladder`: 100, 1,000 and 5,000 agents, headless in Node.
  - Budget files, and the trend file (§8.7).
- **Improves:** I-39.
- **Done when:** `x perf` reports counters for the room, the ladder runs in Node, and budgets compare with a tolerance.
- **Verify:** `npm test -- engine/dev/stats && node x perf labs/box --scene room --budget`

#### WP-5.6 The bot and dev actions (on demand)
- **Owns:** `engine/dev/{bot,actions}.ts`
- **Needs:** WP 3.3, WP 4.3
- **Size:** M
- **Trigger:** a test needs play longer or more varied than a scripted replay can express (soak runs, navigation smoke over many levels), or reaching a state by replay costs more than a dev action would (§9.1). Fired 2026-10-17 by the playground (ADR-0025): the gym's courses and the house need soak runs, and tuning needs teleports and slow motion.
- **Carry:** the autopilot (`ed/93-autopilot.js`) and the developer sandbox (`ed/62-developer.js`), mechanisms only.
- **Build:**
  - **The bot:** a virtual device, navigation over the flow field, a watchdog, and stuck detection measured along the wanted direction. Its runs are reproducible. Its report has one row per level or scene, and it takes seed sweeps, a stop condition and a sampled trace (shardfall's `crates/pav_tools/src/agent_tools.rs:226-307` and `pavilion-lite/src/tools.rs:1076-1185`, §5.8). *Reached as `__engine.bot(plan)` too (§8.3); a sweep runs fresh sessions and leaves the run alone (ADR-0025 amendment 13).*
  - **Dev actions** (kind `devAction`): god mode, freeze AI, spawn N, travel, time scale. Each is reachable from `__engine.actions` (registered from `engine/dev/actions.ts`, §8.3), `x eval` and MCP, if it is built. *The kind and the engine's five live sim-side in `engine/sim/devActions.ts`, which the session reads, so a replay's dev action plays in every host; an entry changes the sim (`run`, recorded as `dev`), settings (`settings`: freeze is the recorded `ai.frozen`, which the step reads; time scale the view setting `time.scale`), or both; god mode is the component `invulnerable`, which `damage` respects; spawn makes props (amendment 13).*
  - The bot is sim-side (§3): it reads the sim and writes intents, under the reproducibility bans.
- **Improves:** I-38.
- **Done when:**
  - In a maze fixture, the bot reaches a target tile, and reports "stuck" correctly when blocked.
  - Every dev action is unit-tested and reachable from `__engine` and `x`.
- **Verify:** `npm test -- engine/dev/bot engine/dev/actions`

#### WP-5.7 Box 4: a crowd
- **Owns:** `labs/box/scenes/crowd-*.ts`, `labs/box/cast/{walker,slime,wisp}.ts`; extends `labs/box/{README.md,main.ts}` and `tests/e2e/parity.spec.ts` (with this stage's scenes); `tests/replays/box-4-*.replay.json`, `tests/e2e/box-crowd.spec.ts`, `tests/baselines/perf/box-crowd-1000.json` (its ladder section names `setting`, ADR-0014 amendment 12); with ADR amendment (ADR-0008, amendment 6): `engine/sim/crowdBodies{,.test}.ts`, `engine/gfx/stageCrowd{,.test}.ts`; extends `engine/gfx/stage.ts`, `engine/app/view.ts`, `engine/sim-api.ts`
- **Needs:** WP 4.6, WP 5.2, WP 5.4, WP 5.5
- **Size:** M
- **Carry:** the cast's sizes and speeds (`stress-world/20-sim.js:57-102, 174-222`) as starting values.
- **Build:**
  - **The sample cast:** a walker (capsule), a slime (a hopping ball) and a wisp (a floater), each with its steering.
  - Crowd scenes at 100, 1,000 and 5,000, with mixes; scripted replays drive the hero through the crowd and up the stairs. Spawners add at most 25 bodies per step, as shardfall's load ramps do.
  - The perf ladder's budgets, recorded.
- **Improves:** I-07, I-39, I-43.
- **Done when:**
  - In a replay, the crowd follows the hero up the stairs: at least one agent reaches the gallery.
  - The ladder's sim-step medians are recorded as budgets.
  - 0 pipelines are built as the crowd grows to 5,000.
  - The replays give their golden hashes in Node and in the rendering page, crowd LOD included.
- **Verify:** `node x replay tests/replays/box-4-*.replay.json --browser page && node x perf labs/box --scene crowd-1000 --ladder --budget && npm run e2e -- tests/e2e/box-crowd.spec.ts tests/e2e/parity.spec.ts`

**Gate G5, Box 4:** the crowd follows the hero up the stairs in replays that give their golden hashes in Node and in the rendering page; the perf ladder is within its budgets; nothing compiles as the crowd grows.

### Phase 6: Box 5, combat (lanes A, W, R, I, B)

#### WP-6.1 Moves, timelines, hits
- **Owns:** `engine/anim/{timeline,attack,moves,moves-data,strike}.ts` (attack.ts split from timeline.ts: ADR-0014 amendment 16), `fixtures/rigs/dummy/` (a neutral training dummy that takes hits); extends `engine/anim/{humanoid,poses,locomotion,states,weights,character}.ts` for the arm path (ADR-0009 amendment 5)
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
- **Owns:** `engine/anim/{reactions,secondary,chain}.ts` (chain.ts split from secondary.ts: ADR-0014 amendment 16), `engine/anim/footPlant.ts` (the post-IK foot plant, moved from ik.ts and built after G9: ADR-0009 amendment 8)
- **Needs:** WP 6.1
- **Size:** M
- **Carry:**
  - The squash spring (`engine:1832`).
  - Hair (`engine:1900-1916`).
  - The cape (`engine:2033-2068`).
  - `die` (`engine:1824-1827`).
- **Build:**
  - **Reactions:** a directional flinch (an additive spring, ported from shardfall's `puppet.rs`); down, die and get-up timelines (face up or face down). The ragdoll hand-off comes in WP 10.2.
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
- **Owns:** `engine/sim/{hits,damage}.ts`, `engine/world/projectiles.ts`; extends `engine/app/headless.ts` (the
  after-step hit-stop handover, `stepped`) and `engine/app/engine.ts` (ADR-0005 amendment 2)
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
  - CPU particles as view state: `fxRng`, pooling, instanced quads. Shardfall's 13 emitter presets, event bursts and flicker are the starting data (§5.8).
  - Socket trails (ribbons).
  - Telegraph shapes as data (arc, ring, line, cone) in `world/telegraphs.ts`, where sim code tests near misses; `gfx/fx` draws them at floor height.
  - Decals; screen shake (camera only); bolt visuals.
- **Done when:**
  - **The sim hash is identical with effects on and off.**
  - Budgets hold, and every pool is warmed: 0 pipelines after warm-up.
- **Verify:** `npm test -- engine/gfx/fx engine/world/telegraphs && npm run e2e -- tests/e2e/fx.spec.ts`

#### WP-6.5 The HTML/CSS overlay and damage numbers
- **Owns:** `engine/ui/{overlay,labels,state}.ts`
- **Needs:** WP 2.7, WP 3.12
- **Size:** S
- **Carry:** the damage numbers (`stress-world/35-effects.js:133-149`), with stacking (`20-sim.js:320-323`), as behaviour only.
- **Build:**
  - **An HTML/CSS overlay** over the canvas (§6.7, doctrine: WebGPU only): a root element sized to the canvas, and world-anchored labels positioned from projected coordinates each frame (three.js's `CSS2DRenderer` pattern).
  - Damage numbers with stacking, as pooled DOM elements animated with CSS; HUD lines; a crosshair. Text uses the system font; an approved font (doctrine: Assets) only when a look asks for one.
  - `ui.state()` for tests: the overlay's elements as text, boxes and visibility.
  - On touch screens it follows WP 3.12's rules: text scales with `--touch-k`, key hints are hidden, and nothing sits under the buttons' corner.
- **Improves:** I-50.
- **Done when:** `ui.state()` snapshot tests pass; DOM queries find each damage number with its value; a world-anchored label's centre matches its projection within 1 px; the overlay never changes the hash.
- **Verify:** `npm test -- engine/ui && npm run e2e -- tests/e2e/overlay.spec.ts`

#### WP-6.6 Animation checks, QA and sheets
- **Owns:** extends `engine/anim/check.ts` (WP 3.4) with the state matrix, `engine/anim/stateMatrix.ts` since its split (ADR-0014 amendment 16); `tools/cmd/sheet.ts` (PNG of `anim.sheet()` through the browser), `tools/qa/anim.ts`, `tools/qa/anim/metrics.ts` (split from it, ADR-0014 amendment 16), `tests/baselines/qa-anim.json`
- **Needs:** WP 5.3, WP 6.2
- **Size:** M
- **Carry:**
  - `checkRig` (`ed/18-characters.js:82-143`, mechanism).
  - The motion checks of `tools/ed-sheet.mjs:100-131`.
- **Build:**
  - A state matrix: body states × facings, plus camera presets for sheets.
  - Checks: finite values; bone lengths and declared rigid pairs; feet at or above the ground; sockets reachable; the same hash twice; 1/60 against 1/120 within tolerance.
  - The `anim` QA family of §8.6, run in Node.
  - `x sheet`. Each camera frames every pose: the sheet cameras are `anim.sheet()`'s orthographic views, fitted to every frame and view at one scale (ADR-0009 amendment 6; shardfall's back-off fixes perspective cameras, which sheets do not have).
  - Baselines, each with a reason.
- **Improves:** I-29.
- **Done when:** every move and pose, the humanoid, the blob and the floater pass the `anim` QA family in under 10 s in Node, against a baseline file with reasons.
- **Verify:** `node x qa anim`

#### WP-6.7 Box 5: combat
- **Owns:** `labs/box/scenes/fight*.ts`; extends `labs/box/cast/*` (attacks), `labs/box/touch.ts`, `labs/box/{README.md,main.ts}` and `tests/e2e/parity.spec.ts` (with this stage's scenes); `tests/replays/box-5-*.replay.json`, `tests/e2e/box-fight.spec.ts`; `engine/gfx/stageFx{,.test}.ts`, `engine/app/damageNumbers{,.test}.ts`; extends `engine/gfx/stage{,.test}.ts`, `engine/gfx/puppets/actors.ts`, `engine/gfx/fx/ribbons.ts`, `engine/app/{engine,view,view.test}.ts`, `tests/e2e/box.spec.ts` and `tests/baselines/perf/box-room.json` (ADR-0008 amendment 8)
- **Needs:** WP 5.7, WP 6.3, WP 6.4, WP 6.5, WP 6.6
- **Size:** M
- **Carry:** as starting values only: the hero's moves and the cast's attacks (`stress-world/20-sim.js:57-114, 242-282, 346-451`), and the proof script's press timetable (`:587-603`) as the first fight script.
- **Build:**
  - The hero's combo (slash, backslash, spin, thrust) and a bolt.
  - The cast's attacks, with telegraphs and attack tokens.
  - Deaths, corpses and launches; damage numbers; trails; particles.
  - Fight scenes: 36 mixed, and 1,000.
  - The touch layout makes attack the main button, with jump, dash and the bolt beside it (WP 3.12; untested, ADR-0021).
- **Improves:** I-07, I-43.
- **Done when:**
  - A scripted fight replay has at least 3 deaths and at least one body launched more than 1 m up, and gives its golden hashes in Node and in the rendering page (effects and damage numbers included).
  - DOM queries find the damage numbers the fight's hits produce, with their values.
  - The hash is identical with effects on and off.
  - 0 pipelines are built after warm-up during the fight.
  - The animation QA is green or baselined.
- **Verify:** `node x replay tests/replays/box-5-*.replay.json --browser page && npm run e2e -- tests/e2e/box-fight.spec.ts tests/e2e/parity.spec.ts`

**Gate G6, Box 5:** a scripted fight kills and launches in replays that give their golden hashes in Node and in the rendering page; effects never change the hash; the animation QA is clean or baselined with reasons.

### Phase 7: Box 6, the look (lanes R, W, B)

#### WP-7.1 Lights, shadows, atmosphere, sky
- **Owns:** `engine/gfx/{lights,shadows,atmosphere,sky}.ts`
- **Needs:** WP 2.3, WP 3.12, WP 4.2
- **Size:** M
- **Carry:**
  - The fixed light set and the shadow-caster reassignment (`stress-world/10-hall.js:435-466`); `FLICKER`.
  - The fog that starts past the focus (`stress-world/50-frame.js:56`).
  - The backdrop generators (`engine` §21b).
- **Build:**
  - **A fixed light pool:** 8–16 point lights near the focus, assigned by priority and distance from the level's light spots. The count never changes, so shaders never rebuild.
  - **A shadow budget:** 2 point casters, reassigned to the most important lights. The `quality` tier (WP 3.12) lowers it: one at `medium`, none at `low`.
  - Flicker on `fxRng`; fog (range plus height); a sky dome (three.js's `SkyMesh` addon first) and a backdrop cylinder.
  - Presets: the torch-lit hall, and a plain daylight for fixtures. Others arrive when a scene needs them.
- **Improves:** I-17.
- **Done when:** moving the focus across the hall reassigns lights with 0 pipelines built, every preset renders, and switching presets never changes the hash.
- **Verify:** `npm run e2e -- tests/e2e/lights.spec.ts`

#### WP-7.2 Materials (v2): toon, outlines, styles
- **Owns:** `engine/gfx/materials/{toon,outline,styles}.ts` (in WP 2.3's material registry)
- **Needs:** WP 3.8
- **Size:** M
- **Carry:** `TOON_BANDS` and `outlineMat` (`stress-world/00-setup.js:91-116`); lab3d's `toonMat` (`lab3d/10-materials.js:80-96`).
- **Build:**
  - **Toon shading at the best quality the builder can reach** (doctrine: Quality under the hood): `MeshToonMaterial` with a generated gradient map as the baseline, or a TSL node material where it measurably looks better (banding under the light pool, rim light, shadow terminators). The data game code writes stays the material registry's (colours, maps); the style and the toon look (bands, rim) are view state of a style set (ADR-0008 Amendment 3). Shardfall's smoothed bands and gated rim, with the style as a per-instance id, are the reference (§5.8).
  - Outline shells correct under instancing: a TSL push whose direction comes from `positionGeometry` (§4.1), taken back through the instance's turn; skinned meshes get no shell (ADR-0008 Amendment 3).
  - Material styles, each warmed and each compiled from the same material data: toon, flat and pbr (`MeshStandardMaterial`), plus lambert; each warm-up compiles every style for the drawn meshes (ADR-0008 Amendment 3).
- **Done when:**
  - Toggling every style builds 0 pipelines after warm-up, and never changes the hash.
  - The toon implementation chosen is recorded with the comparison that decided it (thumbnails and look metrics).
  - On instanced box parts, the outline shell's ID-pass bounding box contains the part's, centred within 1 px.
- **Verify:** `npm run e2e -- tests/e2e/materials-v2.spec.ts`

#### WP-7.3 The texture library (v2)
- **Owns:** `engine/gfx/textures/generators/{runes,moss,metal,plaster,dirt,grass,water}.ts`, `engine/gfx/textures/{tslNoise,contactShadow}.ts`; core proposal: `engine/gfx/textures/{v1,v2,texture,texture.test}.ts`, `tools/qa/tex{,.test}.ts` (accepted, ADR-0020 amendment 7)
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
- **Owns:** `engine/gfx/post/**`, `tools/templates/look/`, `tests/e2e/post-box.spec.ts` (the box's post tests, split from post.spec.ts: ADR-0014 amendment 16); extends `engine/app/engine.ts`, `engine/gfx/props.ts`, `engine/gfx/puppets/crowd.ts` and `tools/cmd/set.ts` (core proposal accepted, ADR-0008 amendment 7)
- **Needs:** WP 2.6, WP 3.12, WP 7.2
- **Size:** L
- **Carry:**
  - `stress-world/45-filters.js`: cel, pixel and Bayer dither, bloom, FXAA, and the `keep(m)` scope.
  - **From shardfall** (§5.8):
    - the design: one composite in which every filter is gated by a uniform, in a fixed order (`crates/pav_render/src/shaders/post.wgsl:731-860`; `crates/pav_render/src/renderer.rs:851-877, 1309-1358`);
    - its filter functions, as WGSL through TSL's `wgslFn` or ported to TSL (`post.wgsl:337-409, 741-760, 810-848`: Bayer, five palettes, levels, grade, scanlines, CRT, vignette, grain, chroma; `:761-804`: pixel art on marked objects with a one-block rim; `:72-101`: the edge outline from depth, crease and ID; `:431-697`: the painterly and print styles (oil paint with brush strokes, CMYK halftone, ASCII and pencil), which 12 of the 73 presets and 7 of the 21 looks use);
    - its tuned presets, as data with the keys renamed (`crates/pav_view/src/looks.toml`: 73 presets and 21 looks).
- **Build:**
  - **One fixed MRT, set up once at startup** (`engine/gfx/post/mrt.ts`): colour, plus view normals whose spare channel carries an outline group and the per-object flags, packed as shardfall packs them (`scene.wgsl:267-277`: the group folded into 1..1023, +1024 on characters and objects, negative for pixel art). The packed value stays within ±2,047, the integers a half-float target holds exactly (r182's `pass()` targets are `HalfFloatType`). Telling characters from objects takes a group bit (groups 1..511) or a float32 normal target. It never changes at run time, so no filter toggle recompiles a material. r182's `SSRNode`, which needs normals, can use it (§4.8); `PixelationPassNode` makes its own MRT and is not used.
  - A `PostProcessing` chain (r182) from three.js's TSL display nodes where they exist: `BloomNode`, and `FXAANode` or `SMAANode`, whichever measures better. Bloom is off at the `low` quality tier (WP 3.12).
  - **One composite pass** after them, with every filter gated by a uniform, in a fixed order: cel, pixel (palette and dither), the edge outline, the painterly and print styles, grading and the screen effects above. Each filter can be scoped to the characters, the objects or the environment.
  - **Shardfall's lessons, kept:**
    - posterize with 8 or more levels (24 for pixel art) so dull colours keep their hue;
    - snap the camera to the pixel grid so pixel art doesn't shimmer as it slides;
    - bloom runs before the composite and is not scoped.
  - Looks as data (kind `look`: a material style from WP 7.2 plus a filter chain), seeded from shardfall's presets, with warm-up integration.
- **Improves:** I-46.
- **Done when:**
  - Every filter and scope works, and toggling one never changes the hash.
  - Toggling a filter builds no pipeline after warm-up and recompiles no material.
  - The ID pass is unchanged by filters.
- **Verify:** `npm run e2e -- tests/e2e/post.spec.ts tests/e2e/post-box.spec.ts`

#### WP-7.5 The performance governor (on demand)
- **Owns:** `engine/dev/governor.ts`
- **Needs:** WP 5.4, WP 7.1
- **Size:** S
- **Trigger:** a scene must hold a frame budget on hardware that varies (Phase H), a measured scene misses its GPU budget and a quality tier would fix it, or the owner reports a scene running slowly on a phone (§9.1). Fired 2026-10-17 by the playground (ADR-0025): the playground must hold its frame budget on the owner's hardware with WPs 11.3 and 11.5 on.
- **Carry:** the mechanism of `ed/95-perf.js`.
- **Build:**
  - Adaptive quality with hysteresis, moving between WP 3.12's `quality` tiers, plus dynamic resolution on phones, both only while `quality` is `auto`, so a tier set by hand is kept (shardfall's `crates/pav_app/src/quality.rs:89-113`).
  - It owns the optional GPU features, presentation LOD (pose LOD, draw distance, light and shadow budgets, effect density) and resolution.
  - It **never** changes sim state or any setting not marked `view` (WP 1.2); sim LOD is a scene setting recorded in replays.
  - It is frozen in reproducible runs, and every change it makes is logged as advice.
- **Done when:** a simulated sequence of frame times produces the expected demotions and promotions with no flicker, and no governor action changes the hash.
- **Verify:** `npm test -- engine/dev/governor`

#### WP-7.6 MCP server (on demand)
- **Owns:** `tools/mcp/**`, `tools/cmd/mcp.ts`
- **Needs:** WP 2.7, WP 3.3, WP 5.6
- **Size:** M
- **Trigger:** an agent that cannot run `node x` needs to drive the engine (§9.1). Fired 2026-10-17 by the playground (ADR-0025): the owner's order: an agent playtester drives the playground through MCP.
- **Build:** the tools in §8.11, generated from the inspector members' argument schemas (WP 1.6), on the official `@modelcontextprotocol/sdk` (pinned by §6.10's rule when the WP starts, with its reason in `tools/deps.json`), over `x inspect`. The server restarts when engine sources change.
- **Improves:** I-35.
- **Done when:** an MCP client test opens the box room, steps it, injects input, takes a shot with the ID pass, runs a dev action and replays a file.
- **Verify:** `npm test -- tools/mcp`

#### WP-7.7 The gallery (on demand)
- **Owns:** `engine/dev/gallery.ts`, `tools/cmd/gallery.ts`
- **Needs:** WP 3.11
- **Size:** M
- **Trigger:** reviewing a kind's entries one `x shot` at a time costs more than one contact sheet would: about 20 entries of a kind that need visual review (§9.1). Fired 2026-10-17 by the playground (ADR-0025): about 40 props and the building materials need visual review.
- **Carry:** the gallery of `ed/92-gallery.js` (mechanism).
- **Build:**
  - **The `gallery` hook** in the schema language (camera, duration, states), added to the kinds that need review and to their templates.
  - Contact sheets and JSON from the registries' `gallery` hooks: bodies × body states, moves, props, materials, emitters, looks.
  - Deep links (`#gallery/…`), served by the app's routes on any page; wrong names warn with the list of valid ones.
- **Done when:** every registered entry with a `gallery` hook renders a sheet, and `x gallery body` lists every body.
- **Verify:** `npm run e2e -- tests/e2e/gallery.spec.ts && node x gallery body`
- **Built** (the calls are in the ledger row): the hook as one field of the schema language, `galleryField` with each kind's defaults (engine/core/gallery.ts), on props, materials, emitters, looks, bodies and moves and in their templates; the gallery as a scene, `dev:gallery` (engine/dev/galleryScene.ts, sim-side as the bot is), which stages one entry on an empty stage through its recorded dev action `show`, so it draws what play draws; `__engine.gallery.*` films it (engine/dev/galleryShoot.ts) and `x gallery` lays the frames out; the deep links go through the app's routes; `x gallery`'s default page, tests/pages/gallery.html, registers every lab's entries.

#### WP-7.8 Box 6: the Stress Box
- **Owns:** `labs/box/looks/`; extends `labs/box/{README.md,main.ts}`, `labs/box/scenes/*` and `tests/e2e/parity.spec.ts` (with every look); `tests/replays/box-6-*.replay.json`, `tests/e2e/box-look.spec.ts`, `tests/baselines/perf/box-fight-1000.json` and `box-crowd-5000.json`, `engine/gfx/stageSky{,.test}.ts`, `engine/app/look{,.test}.ts`; extends `engine/gfx/puppets/actors.ts` (a view-side `Secondary` and its mesh), `tests/replays/box-5-*.replay.json` (goldens re-recorded with the fight's reactions), `engine/gfx/{stage,post/looks,post/looks.test,post/chain}.ts`, `engine/app/{engine,view,view.test}.ts`, `engine/world/level/level{,.test}.ts`, `tests/baselines/thumbs/{box-hall-iso.json,README.md}` and `tools/lib/tiers.ts` `LONG_RUNS` (ADR-0008 amendment 10), `engine/sim/reactions{,.test}.ts`, `engine/gfx/puppets/chains{,.test}.ts`, `engine/sim/actors.ts` (the reactions step, ActorSpec.components), `labs/box/cast/hero.ts`, `tests/pages/boxAudioTimeline.ts` (FIGHT_TIMELINE) (ADR-0018 amendment 2)
- **Needs:** WP 6.7, WP 7.1, WP 7.2, WP 7.3, WP 7.4
- **Size:** M
- **Build:**
  - The box's looks: the torch-lit hall with flicker and fog, toon shading with outlines, flagstones with runes, and the cel, pixel, bloom and FXAA presets.
  - WP 6.2 in the box (ADR-0018 amendment 1): the hero's cape or hair (`Secondary`, view-only, on his puppet's animator, drawn and seen by the ID pass), and the fight's flinch, knockdown and get-up through `Reactions` (the fight's goldens re-recorded with that reason).
  - The full benchmark report: `x perf --ladder` over `fight-1000` and `crowd-5000`.
  - The box README as the engine's demo index: every scene, what it proves, and the command that shows it.
- **Improves:** I-07, I-43.
- **Done when:**
  - Every look renders with 0 pipelines after warm-up across every toggle, and with the golden hashes unchanged.
  - The fight shows WP 6.2: the ID pass sees the hero's cape (or hair), and a hit puts a body's reaction to work (labs/box/scenes/fight.test.ts, tests/e2e/box-fight.spec.ts).
  - The benchmark report is recorded, and `x ci --local` is green.
- **Verify:** `npm run e2e -- tests/e2e/box-look.spec.ts tests/e2e/parity.spec.ts && node x perf labs/box --scene fight-1000 --ladder --budget && node x ci --local`

**Gate G7, the Stress Box (the foundation is set):**
- Gates G0–G6 still hold.
- The box does the stress test's job: the hall, the hero, a crowd up to 5,000, props, combat, effects, cameras and looks, on WebGPU, with the CPU-only gameplay contract green.
- Every capability built so far is reachable from `x` or `__engine`, and is proved without a display, except what ADR-0021 leaves untested by the owner's order: the touch controls and phone defaults (WP 3.12) and the Vercel deployment (WP 0.12).
- Every on-demand WP's ledger row is still `on demand`, or records the measurement that triggered it.
- **A fresh-agent dry run:** a subagent given only AGENTS.md and the generated docs adds a prop and a box variant. Its friction list is fixed or answered in the gate note. Shardfall's first dry run found 13 friction points this way (§4.8).
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
  - Format 1 decoding, within 0.001 mm of the reference vectors. The reference decodes read the source's own sets (`$MY3D2DGE_SRC/src/mocap/sets/`), never `data/anim/sets/`, which WP 8.10 changes.
  - **`x port refs --clips`:** `MR.pose` decodes of all 325 curated clips at 30 fps. That set is large: commit a sampled subset with checksums, and keep the full set regenerable.
  - The oracle is the source decoder itself. `tools/anim/legacy-readable.ts` (about 10 lines) runs `$MY3D2DGE_SRC/src/mocap/readable.js` in a `vm` context, as `tools/mocap-lib.mjs:7-9` does. Nothing is copied. The bit-for-bit check runs wherever the source resolves.
  - Format 2's optional fields (§10.2), including shardfall's clip `speed` and set `title` and `legend`, so its sets parse unchanged (WP 8.10).
  - Format 2's key fields (`hand`, `roll`, `yaw`, `spine`, `grip`) are parsed, in-betweened, mirrored, lensed and printed; the decode reads format-1 fields only (WP 8.8 defines theirs; ADR-0010 amendment 1). Reference decodes use each clip's own source rest body.
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
  - One JSON file per clip, exactly its `text()`: slugged file names, with the real name kept in `clip` (ADR-0010 amendment 2).
  - `_set.json` (keeping the set's `fit` map, whose order is the clip order), and a generated `catalog.tsv`. Prettier skips `data/anim/sets/`.
  - `alt` tags on the 84 Mesh2Motion re-exports.
  - The repacker also reads plain JSON sets, as shardfall writes them (for WP 8.10), and `catalog.tsv` gains a `speed` column.
  - HERO dropped.
- **Improves:** I-13.
- **Done when:** the rejoined sets deep-equal the source objects, and `text()` output is unchanged.
- **Verify:** `npm test -- tests/unit/data/anim/sets`

#### WP-8.4 Baker, clip layer, retargeting, the mannequin
- **Owns:** `engine/anim/clip/{bake,library,layer,retarget,rest}.ts` (rest.ts split from retarget.ts after G9: ADR-0014 amendment 17), `engine/gfx/puppets/bodies/mannequin.ts`
- **Needs:** WP 3.7, WP 3.8, WP 8.3, WP 8.10
- **Size:** L
- **Carry:**
  - The API of `src/mocap/mocap.js` and the ideas in its `drive` (§5.3).
  - **From shardfall** (§5.8): playing a loop at the character's ground speed, and the walk–run switch (`crates/pav_core/src/clips.rs:441-476`), with the rate's test (`crates/pav_core/tests/motion.rs:214-231`); shardfall tests the switch only through its monsters' chase (`crates/pav_core/tests/monsters.rs:231-256`), which is game content.
- **Build:**
  - **A baker** that works from format-1 **parameters** (direction, bend, twist, hints), handles singular poses, and produces 30 fps rotation tracks on the canonical skeleton.
  - **Standard clips too** (doctrine: Common ground): each baked clip is also a three.js `AnimationClip` (`QuaternionKeyframeTrack`s on the canonical bone names), so pages can play it with three.js's `AnimationMixer`, which `engine/index.ts` re-exports (§6.1), for presentation only (the Library Lab, props). The sim's clip layer samples the same tracks on the CPU.
  - **The library API**, which also exports WP 8.2's codec (parse, text, validate, lens, mirror, decode) from `engine/index.ts` and `engine/sim-api.ts`.
  - **The clip layer**, in the animator's clip slot (WP 3.7): weight, mask, fade from the current pose, speed, loop, additive, `walk/hold/next/landed` flags, cancel rules, events, root motion.
  - **Ground speed** (shardfall's): a loop with a `speed` plays at rate = clamp(ground speed / pace, 0.4, 2.5), where pace = `speed`/100 × the build's hip height, in m/s. A walk and a run switch to the run above √(w·r) × 1.15 and back below √(w·r) × 0.87, where w and r are their paces (1.4 and 4.0 hip heights a second when a clip has none), so a speed near the line never flickers. Below 0.1 m/s the character idles.
  - **Strike time** (shardfall's `crates/pav_core/src/clips.rs:478-550`, §5.8): the moment a clip's hand reaches furthest ahead of the hips (the blade's tip for a clip that holds one, a foot for a clip tagged `kick`), sampled at 60 Hz and measured once per clip. A move that plays a clip as its attack lands its hit there when the clip has no `hit` event.
  - **Retargeting to builds:** a rotation copy, root scaled by the hip-height ratio, and contact IK.
  - **The mannequin body**, built with the body grammar (WP 3.8) from the `body` (height, 22 segments and 24 bands) in `data/anim/sets/quaternius/_set.json`, the only set with one, which WP 8.10 restores from v1. The clip layer retargets onto it, and differences go in the baseline.
- **Improves:** I-13, I-49, I-54.
- **Done when:**
  - Forward-kinematics parity against the format-1 decode has a mean of **1 mm or less** for every set, WP 8.10's included.
  - The ground-speed rate passes shardfall's case: three walkers, each played at ground speed over its own pace. A new unit test drives the walk–run switch just above and just below √(w·r) × 1.15 and × 0.87, with and without the run playing, and sees one change each way.
  - The worst cases are listed in the baseline.
  - The clip layer is unit-tested, and a baked `AnimationClip` played by an `AnimationMixer` matches the clip layer's pose within 0.1 mm.
- **Verify:** `npm test -- engine/anim/clip` (the library QA runs in WP 8.6)

#### WP-8.5 Tools port
- **Owns:** `tools/anim/*`, `tools/cmd/anim.ts`, `engine/anim/clip/encode.ts` (the importer half of `readable.js`: `measure`, `encode`, `fit`, `capSample`, `reduce`; ADR-0010 amendment 1), and `engine/anim/clip/frames.ts`, the frame math and `torso` it shares with `readable.ts` (moved there from WP 8.2's file; ADR-0010 amendment 4). It extends `repack.ts` from WP 8.3 and the `fps?` rows of WP 8.1's `data/anim/cmu/`; `legacy-readable.ts` stays WP 8.2's, and `shardfall.ts` stays WP 8.10's
- **Needs:** WP 8.1, WP 8.3, WP 8.4
- **Size:** L
- **Carry:** `anim-import`, `asf-amc`, `cmu`, `anim-set`, `mocap-lib`, `to-glb.py`.
- **Build:**
  - `x anim find|show|cut|import|cmu|bake|sheet`.
  - The `.cache/anim/` layout.
  - Guards in the GLB reader, each tested on small GLBs that the tests build in memory (CUBICSPLINE, signed and quantized accessors). No binary fixtures are committed.
  - Frame interpolation, and format-2 output, by default. Each loop gets its `speed` as shardfall's importer computes it: round(stride / H0 × 100 / dur), left out below 10 (`crates/pav_tools/src/mocap/mod.rs:308-316`). A library that ships root-motion twins (Quaternius' `_RM` files) gives each in-place loop its twin's root travel as the stride, and adds each one-shot that travels more than 50 mm as `<clip>_RM` (`mod.rs:326-366`).
  - `x anim cmu` reads one take out of the site's 1.08 GB `allasfamc.zip` by HTTP ranges, without downloading the archive (shardfall's `crates/pav_tools/src/mocap/fetch.rs:49-161`; the server accepts ranges).
  - **`--legacy`:** nearest-frame sampling and format 1, exactly as today.
  - The split ledger; `--json`.
  - The 113 `fps?` takes verified: each flag is cleared, or the rate corrected, with the evidence in the row.
- **Improves:** I-13.
- **Done when:**
  - **`x anim import --cmu --legacy` reproduces the CMU set** byte for byte *(deferred proof: it needs the network; it runs at the library gate)*.
  - `x anim find punch` prints 20 lines or fewer.
- **Verify:** `npm test -- tools/anim`, plus at the gate `node x anim import --cmu --legacy --check`

#### WP-8.6 Library tests and QA
- **Owns:** library tests, `tests/e2e/library.spec.ts`, `tests/baselines/qa-anim-library.json`; extends `tools/qa/anim{,.test}.ts` and `tools/cmd/sheet{,.test}.ts` (WP 6.6) and `tools/lib/tiers.ts` `LONG_RUNS`; adds `tools/qa/anim/clips.ts`; fixes `engine/anim/clip/{bake,library}.ts` (WP 8.4) (ADR-0010 amendment 3)
- **Needs:** WP 6.6, WP 8.1, WP 8.4, WP 8.10
- **Size:** M
- **Build:**
  - Node tests: format, provenance, ledger completeness, picks. The take check accepts 100STYLE's take names (`<Style>_(FW|BW|FR|BR|SW|SR|ID) <start>-<end>`, such as `Old_FW 23.80-25.63`) beside CMU's.
  - Fit thresholds: a clip's mean at most 40 mm and its worst at most 300 mm; a set's mean at most 20 mm.
  - The `anim` QA family over all 1,218 clips, with a baseline. The baseline starts with WP 8.10's known cases, each with its reason: the four 100STYLE clips over the fit limits (§10.1); five whose angles pass ±540° (`BouncyRight_Idle`, `WhirlArms_Run`, `WildArms_Run`, `OnPhoneRight_SideRight`, `SwingArmsRound_SideLeft`); and the two Quaternius swims, whose hips go below the floor.
  - A browser smoke test.
- **Improves:** I-13, I-29.
- **Done when:** everything is green, and the Node part runs in under 30 s. If the 1,218 clips push it past that, T1 keeps a sample with every set in it, and the full sweep joins the gate's long runs (§8.2).
- **Verify:** `npm test -- engine/anim/clip tests/unit/data/anim && npm run e2e -- tests/e2e/library.spec.ts`

#### WP-8.7 The ACTIONS layer
- **Owns:** `engine/anim/{actions,actions-data,actions-check}.ts` (the split: ADR-0014 amendment 16), `data/anim/actions/*`, `tools/templates/action/`; extends `tools/qa/anim.ts` and `tools/qa/anim.test.ts` (WP 6.6) with the action subjects (ADR-0009 amendment 7)
- **Needs:** WP 6.6, WP 8.4
- **Size:** M
- **Carry:**
  - The ranked list and build order of `docs/ANIMATION-RESEARCH.md`.
  - The `HCL_MOVES` design (`ed/96-hero-clips.js`), as input only.
- **Build:**
  - Multi-beat sequences that combine timelines, clips and effector overrides, with held contact frames, events and cancel windows.
  - A first set: jump phases, hurt and dizzy, the flip layer, death styles (the body only), charge-up, item-get, ledge hang and climb, wall slide, a paired grab, get-ups, idle life.
- **Improves:** I-11.
- **Done when:** each action has a check and passes the `anim` QA.
- **Verify:** `npm test -- engine/anim/actions && node x qa anim --only action:`

#### WP-8.8 Re-import from the sources (format 2; on demand, after G8)
- **Owns:** updates to `data/anim/sets/**`; `tests/unit/data/anim/upgrade.test.ts`
- **Needs:** G8; a skinned-mesh GLB import test first (tools/anim/glb-library.test.ts's fixture has no mesh, so no test reads a GLB's skin)
- **Size:** L
- **Trigger:** a clip needs a degree of freedom format 1 lacks (hands, forearm twist, foot roll, spine, root yaw) to fix a defect that can be seen or measured (§9.1). The WP then upgrades the clips that defect touches first. Fired 2026-10-17 by the playground (ADR-0025): the playground's mantles, climbs, ladders and ziplines need hands on their contacts, and its locomotion foot roll.
- **Build:**
  - Fetch the sources into `.cache/`: Mesh2Motion via git, CMU over HTTP, and 100STYLE's takes by HTTP range requests from its Zenodo archive (1.47 GB, never committed), as shardfall's importer reads them.
  - The owner supplies the four GLBs of the Quaternius Universal Animation Library's version 2 once (`UAL1_Standard.glb`, `UAL1_Standard_RM.glb`, `UAL2_Standard.glb`, `UAL2_Standard_RM.glb`): an escalation (§11.5). Until then, Quaternius clips stay as WP 8.10 brought them and are listed as blocked. Their parity reference is v2's format-1 decode.
  - Re-import with hands, foot roll, root yaw, spine, contacts and events, and each loop's `speed` by WP 8.5's rule. 100STYLE's BVH takes use shardfall's rig maps, rest pose (the frame where the body stands straightest) and units from leg length (`crates/pav_tools/src/mocap/bvh.rs:235-605`, parsed with three.js's `BVHLoader`), and its loop finders (`mocap/takes.rs:53-243`).
  - Swap clips in one at a time, checking parity, marked `via: "source"`.
  - The decode of format 2's key fields (`hand`, `roll`, `yaw`, `spine`, `grip`) in `engine/anim/clip/readable.ts`, defined together with WP 8.5's encode that writes them (ADR-0010 amendment 1).
- **Improves:** I-14.
- **Done when:** in every set, at least 80% of the clips whose sources are available are upgraded with parity (§10.5 step 9); a unit test counts the `via: "source"` clips against those whose sources are available, per set, and fails below 80%. The 100STYLE sets are left out of the count until a defect touches them. The rest are listed with reasons.
- **Verify:** `node x qa anim --only clip: && npm test -- engine/anim/clip tests/unit/data/anim/upgrade`

#### WP-8.9 Clip mode in the box
- **Owns:** `labs/box/scenes/clips{,.test}.ts`, `labs/box/library.ts`, `engine/anim/clip/clipsets{,.test}.ts`, `engine/sim/actorClips{,.test}.ts`, `tests/e2e/box-clips.spec.ts`; extends `labs/box/index.html` (from WP 2.7) with 100STYLE's credit, and `engine/sim/actors.ts`, `engine/gfx/puppets/actors{,.test}.ts`, `engine/app/animMember.ts`, `engine/anim/api.ts`, `engine/sim-api.ts` (append), `labs/box/{main.ts,README.md}` and `tools/lib/tiers.ts`'s `LONG_RUNS` (ADR-0010 amendment 5)
- **Needs:** WP 7.8, WP 8.5, WP 8.6
- **Size:** M
- **Carry:** the Mocap Lab's clip mode (`src/mocap.game.js`): catalog search and frame stepping, as `x anim` commands and box settings.
- **Build:**
  - **Clip mode in the box:** the mannequin and the hero play any clip, with the clip layer over the procedural rig. Its machine interface is `x anim show`, `__engine.describe('clipset')` and the inspector.
  - The Library Lab, a page for people watching, is an optional view built on demand (WP 10.8).
  - **100STYLE's credit** (WP 8.10) on the box page, which now ships the clips and which Vercel publishes: "Motion: 100STYLE, by Mason, Starke and Komura (2022), CC BY 4.0; converted to key poses, one loop per style and gait", with links to https://creativecommons.org/licenses/by/4.0/ and https://zenodo.org/records/8127870.
- **Done when:**
  - The mannequin plays every clip in the box headless. In the page, the box suite plays one clip from each set, and the gate's long runs play them all (§8.2).
  - The box page shows 100STYLE's credit (a DOM query).
  - `x anim show <clip>` and the box's clip setting select the same clip, frame for frame.
- **Verify:** `npm run e2e -- tests/e2e/box-clips.spec.ts && npm test -- tools/anim labs/box/scenes/clips`

#### WP-8.10 100STYLE and Quaternius v2, from shardfall
- **Owns:** `data/anim/sets/{style100,style100_back,style100_backrun,style100_idle,style100_run,style100_side,style100_siderun}/**`, `data/anim/catalogs/100style*.json`, `data/anim/LICENSES/CC-BY-4.0.txt`, `tools/anim/shardfall.ts`, `tests/unit/data/anim/shardfall.test.ts`; replaces `data/anim/sets/quaternius/**` (from WP 8.3) and `data/anim/catalogs/quaternius.json` (from WP 8.1); extends `data/anim/SOURCES.md` and `docs/ANIMATION-LIBRARY.md` (from WP 8.1), and `tests/unit/data/anim/sets/` (from WP 8.3)
- **Needs:** WP 8.1, WP 8.3
- **Size:** S
- **Carry:** shardfall's converted sets, as data (§5.8; the owner approved 100STYLE, ADR-0021). They are format 1 plus a clip `speed`, written by shardfall's importer from the original captures:
  - `anim/style100.json` and `anim/100style/style100_{back,backrun,idle,run,side,siderun}.json`: 878 clips of 100STYLE (CC BY 4.0), about 100 styles of walking, running and standing, each a loop;
  - `anim/quaternius.json`: 102 clips of the Quaternius Universal Animation Library, version 2 of June 2026 (CC0);
  - their catalogs in `anim/catalogs/` (`100style*.json`, `quaternius.json`).
- **Build:**
  - **`tools/anim/shardfall.ts`** reads the sets from `$SHARDFALL_SRC` (plain JSON) and writes them through WP 8.3's repacker, one file per clip, each clip marked `via: "shardfall"`.
  - **100STYLE becomes seven sets:** `style100` (forward), and `style100_back`, `_backrun`, `_idle`, `_run`, `_side` and `_siderun`. Their `_set.json` files keep shardfall's credit and sources verbatim, with `body: null`.
  - **Quaternius v2 replaces v1's set:** 102 clips, 15 of them new (`ClimbUp_1m`, `Shield_Dash`, `Sword_Dash`, `Sword_Heavy_Combo` and root-motion twins). `Punch_Enter`, which v2 dropped, stays from v1, marked `via: "v1"`. v1's `body` (the mannequin's segments and bands, 2,238 bytes) is restored into `_set.json`: WP 8.4's mannequin needs it, and shardfall's files leave it out.
  - WP 8.3's round-trip test compares `quaternius` with shardfall's file from now on, not with v1's, with the exceptions below (`body`, the `via` marks and `Punch_Enter`).
  - **The credit CC BY 4.0 requires:**
    - a 100STYLE section in `SOURCES.md`: the dataset's title, its authors (Mason, Starke and Komura), 2022, https://zenodo.org/records/8127870, DOI 10.1145/3522618, the license with its link, and the changes made (one loop per style and gait, converted by shardfall's importer at `fa2dab6`);
    - the license's text in `LICENSES/CC-BY-4.0.txt`;
    - the rule, in SOURCES.md and `docs/ANIMATION-LIBRARY.md`, that any page or game that ships a `style100*` clip shows the credit on screen: the title, the authors, the license with its link, a link to the dataset, and a note that the clips were changed. The box counts from WP 8.9, since Vercel publishes it (WP 0.12).
  - **Catalogs:** shardfall's seven `100style*.json`, and its `quaternius.json` in place of v1's.
- **Improves:** I-54.
- **Done when:**
  - Rejoined, every set deep-equals shardfall's file, apart from `body`, the `via` marks and v1's `Punch_Enter` (its clip and its `fit` entry); `quaternius` holds 103 clips, v2's 102 and `Punch_Enter`.
  - The source decoder (WP 8.2's oracle) decodes all 980 clips with no NaN, and the Quaternius parity against v1 is §10.5's step 5: with both versions decoded by the oracle on v1's rest bodies at 30 fps, 79 of the 87 shared clips are within v1's fit (mean and worst), and the other 8 are listed with their reasons. Decoded each on its own set's rest bodies, fewer than 60 pass, because v2's rests differ from v1's in UAL1's `bt` and `spineW` and in UAL2's `neckW`.
  - Every `style100*` set carries its credit, SOURCES.md has its section, and the license text is in place.
- **Verify:** `npm test -- tests/unit/data/anim`

**Gate G8:**
- The library is intact, with provenance and parity proofs.
- The clip layer plays every clip on every build in Node with clean QA, or QA baselined with reasons.
- Clip mode runs in the box, headless and in the page.
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
  - `render(def, seed, rate) → Float32Array`, reproducible and hashable. It renders under `withSimMath` (§6.5), so a buffer hashes the same in Node and in Chromium: one golden per sound.

  jsfxr (Unlicense) and ZzFX (MIT) are references only. If code is ever borrowed, its license is recorded.
- **Improves:** I-23.
- **Done when:** the same definition and seed give the same hash in Node and in Chromium.
- **Verify:** `npm test -- engine/audio/dsp && npm run e2e -- tests/e2e/audio-dsp.spec.ts`

#### WP-9.2 Sound data
- **Owns:** `engine/audio/data/**`, `fixtures/sounds/` (a small neutral sound set and one demo song, for tests)
- **Needs:** WP 9.1
- **Size:** M (ADR-0013 amendment 1)
- **Carry:** the engine's 33 effects, 6 drums and 5 songs (COPY the data).
- **Build:**
  - The data as typed modules (kinds `sfx` and `song`, with their scaffold templates); drums are `sfx` entries.
  - Validators (track length must fill whole bars or divide a bar, and divide the song length; value ranges).
  - Variants (4 rendered per effect, replacing the source's per-play detune), and layered effects.
- **Improves:** I-23.
- **Done when:** every sound renders, and its validators pass. The clipping, DC and duration checks (the `audio` QA family) run over them from WP 9.4 on.
- **Verify:** `npm test -- engine/audio`

#### WP-9.3 Runtime, spatial audio, music
- **Owns:** `engine/audio/runtime/**`
- **Needs:** WP 9.2, WP 3.1, WP 4.2
- **Size:** M
- **Build:**
  - **Context:** resumed on a user gesture: a key, a click or the end of a touch (`pointerup`; a touch's `pointerdown` is not a gesture).
  - **Mixing:** buses for effects, music, UI and ambience; ducking; voice limits.
  - **Playback:** buffer playback, or streaming through an `AudioWorklet`.
  - **Spatial:** `PannerNode` positioning, with the listener following the camera.
  - **Occlusion:** muffling from a raycast through the `QueryView`, presentation only.
  - **Reverb:** procedural impulse responses for each room preset.
  - **Music:** layers by intensity; section changes at bar lines; stingers on the beat; stings bound to events.
  - **Footsteps** chosen by the level's surface tags (WP 4.2).
- **Improves:** I-23.
- **Done when:** a browser smoke test shows no errors and the right context states, and an `OfflineAudioContext` smoke test passes within tolerances.
- **Verify:** `npm run e2e -- tests/e2e/audio.spec.ts`

#### WP-9.4 Audio tools
- **Owns:** `tools/cmd/audio.ts`, `tools/qa/audio.ts`, `tests/baselines/qa-audio.json`
- **Needs:** WP 9.2
- **Size:** S
- **Build:** `x audio` (metrics, plus WAV or spectrogram PNG in `out/` on request), and the `audio` QA family with its baseline. `x audio --replay <file>` renders a scripted run's sound events offline and checks the whole mix for clipping (shardfall's, §5.8).
- **Improves:** I-23, I-29.
- **Done when:** the audio QA over every sound runs in under 5 s in Node.
- **Verify:** `node x qa audio && node x audio sfx:jump --spectrogram`

#### WP-9.5 Sound in the box
- **Owns:** `labs/box/sounds/`, `engine/app/engine.ts` (`onFrame`), `engine/index.ts` (append), `labs/box/main.ts` (wiring), `tests/e2e/box-audio.spec.ts`, `tests/pages/box-audio.{html,ts}`, `tests/pages/boxAudioTimeline.ts` (ADR-0013 amendment 2)
- **Needs:** WP 7.8, WP 9.3, WP 9.4
- **Size:** S
- **Build:** footsteps by surface, hits, launches, deaths, torch ambience and one demo song, spatialized and ducked. The sound events come from the box's sim events, so a fight replay's sound timeline is reproducible. Its wiring in `labs/box/main.ts` goes through the integrator (§11.3).
- **Improves:** I-23.
- **Done when:** a fight replay's sound-event timeline hashes the same in Node and in the browser, and the runtime smoke test passes with the box.
- **Verify:** `npm run e2e -- tests/e2e/box-audio.spec.ts && node x qa audio`

**Gate G9:** sound buffers hash the same run after run, in Node and in the browser, against one set of goldens; the audio QA is clean; the box plays its sounds.

### Phase 10: Expansions (on demand; lanes A, P, W, I, B)

**On demand** (doctrine: North Star). These widen the engine beyond what the box needs, each when its trigger fires (§9.1). Each lands with a fixture test, and the box gains a scene for it where that helps. There is no phase gate: each WP is done when its own **Done when** holds.

#### WP-10.1 Procedural building blocks and their fixture rigs
- **Owns:** `engine/anim/proc/*.ts`, `fixtures/rigs/{biped,hexapod,serpent,floater,multiarm,tentacle}/`, `fixtures/rigs/README.md`, `tools/templates/rig/`
- **Needs:** G7
- **Size:** L (split into 10.1a, b and c if needed)
- **Trigger:** the box or the game needs a creature beyond the humanoid, blob and floater rigs (§9.1). Fired 2026-10-17 by the playground (ADR-0025): the playground's dog.
- **Carry:** the techniques of §5.6, as mechanisms only. The game's characters are not ported. From shardfall (§5.8): the planted gait for N legs and the verlet chains of `crates/pav_core/src/rig.rs`, and the rule that a generator's later additions draw from their own RNG streams, so old seeds stay stable.
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
- **Trigger:** deaths or launches need physical bodies that reactions and get-ups cannot fake (§9.1). Fired 2026-10-17 by the playground (ADR-0025): dummies and neighbours fall to hard hits and kicks.
- **Build:**
  - A ragdoll builder from bone capsules (physics), with joints as data after shardfall's `joints.rs` (§5.8).
  - The animation side: descriptors, a blend weight, and the choice of get-up.
  - A hand-off on death or a big launch, as a scene setting in the box. *From WP 13.10 (ADR-0025 amendment 10): the adult's face-down fall digs its feet under the floor deeper than the source builds' (0.3503 against 0.2975); a ragdoll fall replaces the turn that does it.*
- **Improves:** I-11.
- **Done when:** a ragdoll hand-off round-trips in Node with Rapier, the correct get-up is chosen, and the ragdoll replays match their goldens in Node and in Chromium.
- **Verify:** `npm test -- engine/physics/ragdoll engine/anim/ragdoll && node x replay tests/replays/ragdoll-*.replay.json --browser sim`

#### WP-10.3 The props library
- **Owns:** extends `engine/world/props/**` (from WP 4.5) with the first library set
- **Needs:** G7
- **Size:** M
- **Trigger:** the box or the game needs props beyond crates and barrels (§9.1). Fired 2026-10-17 by the playground (ADR-0025): the house needs doors, windows and furniture.
- **Build:** torch sconce, banner, chest, door, table, bench, statue and lantern, each with geometry, material, body, optional light and interaction hooks.
- **Done when:** every prop passes the geometry and texture QA checks, and renders in `tests/e2e/props.spec.ts` with ID-pass coverage above 0.
- **Verify:** `node x qa geo tex --only prop: && npm run e2e -- tests/e2e/props.spec.ts`

#### WP-10.4 Generic gameplay kits
- **Owns:** `engine/world/{things,patterns,awareness}.ts`
- **Needs:** G7
- **Size:** M
- **Trigger:** the game needs hittable things, projectile patterns or awareness beyond WP 5.2's basics (§9.1). Fired 2026-10-17 by the playground (ADR-0025): the range's targets and the neighbours' awareness.
- **Carry:** `E.pattern` (`engine:3553-3625`), moved to 3D.
- **Build:**
  - **Things** that can be hit, with hooks.
  - **Projectile patterns:** aim, spread, ring, spiral and random, with bursts and delays, over WP 6.3's projectiles (shardfall's emitters, §5.8).
  - **Awareness and line of sight** beyond WP 5.2's basics: hearing, memory of the last seen position.
- **Done when:** unit tests pass, and pattern projectiles never tunnel.
- **Verify:** `npm test -- engine/world/things engine/world/patterns engine/world/awareness`

#### WP-10.5 Terrain
- **Owns:** `engine/world/terrain.ts`, `engine/physics/heightfield.ts`, `engine/gfx/terrain.ts`, `tests/replays/terrain-*.replay.json`
- **Needs:** G7
- **Size:** M
- **Trigger:** the game needs outdoor ground (§9.1). Fired 2026-10-17 by the playground (ADR-0025): the yard and the hill.
- **Build:**
  - A seeded fbm heightfield **descriptor** in `world/`, made into a Rapier heightfield collider by `physics/heightfield.ts`. Shardfall's terrain (ridges, terraces, flattened footprints, stateless placement) is the reference (§5.8).
  - A chunked mesh with LOD.
  - A splat material driven by slope and height.
  - A nav grid built from the terrain.
- **Done when:**
  - The character walks the terrain with planted feet.
  - The terrain replays give their golden hashes in Node and in the rendering page.
- **Verify:** `npm test -- engine/world/terrain engine/physics/heightfield engine/gfx/terrain && node x replay tests/replays/terrain-*.replay.json --browser page && npm run e2e -- tests/e2e/terrain.spec.ts`

#### WP-10.6 UI widgets
- **Owns:** `engine/ui/{widgets,dialog,menu}.ts`
- **Needs:** G7
- **Size:** M
- **Trigger:** the game needs menus, dialogs or HUD widgets beyond the overlay's (§9.1). Fired 2026-10-17 by the playground (ADR-0025): the playground's settings, prompts and HUD.
- **Carry:** `ui.box/bar/hearts`, `Dialog`, `Menu` (`engine` §21).
- **Build:** HTML/CSS widgets on the overlay (WP 6.5): bars, hearts and boxes; Dialog and Menu as DOM elements, with input and sound injected; `ui.state()` covering them. Gamepads drive menus through a virtual cursor, and menu actions are sent as input, so they replay (shardfall's, §5.8). Mind (after G9): the system layer's actions (pause, the menu's accept, cancel and directions; engine/input/actionMaps.ts's `SYSTEM_ACTIONS`) never enter the intents, so a menu action that changes play must be recorded another way (a dev action or a custom intent), never by adding system actions to the intents.
- **Improves:** I-50.
- **Done when:** `ui.state()` snapshot tests pass, and DOM queries find every widget with its text and box.
- **Verify:** `npm test -- engine/ui && npm run e2e -- tests/e2e/ui.spec.ts`

#### WP-10.7 The game template
- **Owns:** `tools/game/**`, `labs/game/**`, `tools/cmd/engine.ts`, `tests/e2e/game.spec.ts`, `docs/GAME-GUIDE.md` (with WP 12.4); extends `tools/x.ts`, `tools/cmd/{ci,docs,new,check,help}.ts`, `tools/templates/{scene,look}/template.json`, `tools/eslint/{publicApi,simSide}.ts`, `vite.config.ts`, `scripts/setup.sh`, `.github/workflows/ci.yml` and `.gitattributes` (a game mode of the same tools)
- **Needs:** G7
- **Size:** L
- **Trigger:** the owner starts the game (§9.1). Fired 2026-10-15: the owner hands the engine to many agents at once, from different labs, one game each (ADR-0024).
- **Built** (ADR-0024 records the departures from the first design: the engine vendored in each game and pinned by engine-lock.json, not a submodule; `tools/game/new-game.mjs`, not `x new game`, since it runs before anything is installed; the store split off as WP 10.9):
  - `node tools/game/new-game.mjs <dir>`, plain JavaScript run straight after a shallow clone: a game repository with the engine's files pinned by engine-lock.json (each file's SHA-256), the starter game (labs/game/) and the game's root files (AGENTS.md, CLAUDE.md, GEMINI.md, README.md, ENGINE-FEEDBACK.md, package.json with the engine's pins, .claude/settings.json); `--update` moves a game to a newer engine, keeping the game's files and its declared patches;
  - a game mode of the same tools (tools/x.ts `isGame`): the engine's own commands are not commands there, `x check` runs the `engine` plugin, scripts/setup.sh skips the sources; `node x engine` says which engine a game is on (`--check`, `--update`, and `--test` in this repository);
  - the starter game, labs/game/, the shardfall template's idea (§5.8): a scene (a level as text, settings, components, systems, a random stream, events), a player (cast/player.ts), a bot of its own (bot.ts), a page with a HUD, and its replay with goldens.
- **Done when:** a game made from the checkout passes its own gate: `npm ci`, `npm run check`, `npm test` (its golden replay, a run continuing exactly after a capture and restore, the bot winning on 10 seeds), `x sim`, `x replay --browser sim`, `x shot`, `x qa` of every family, and `x help` without the engine's own commands.
- **Verify:** `npm test -- tools/game tools/cmd/engine labs/game && node x engine --test && npm run e2e -- tests/e2e/game.spec.ts`

#### WP-10.8 Lab pages (optional views)
- **Owns:** `labs/{anim,materials,props,fx,cameras,physics,library}/**`, `labs/index/**`, `labs/labs.json`, `tools/cmd/lab.ts`
- **Needs:** G7
- **Size:** M
- **Trigger:** someone watching needs a view that the `x` commands and the box do not give (§9.1). Fired 2026-10-17 by the playground (ADR-0025): the owner tunes animation and feel in pages.
- **Carry:** the animlab UX (`src/starter/60-animlab.js`: lineup, skins, phase timeline, frozen key poses, dummy); the Mocap Lab's UX for the Library Lab (`src/mocap.game.js`: catalog search, the clip as text with Apply, Reset, Mirror and Copy for model, deep links, frame stepping, a retarget preview across the builds); `src/labs.json` and `tools/labs-test.mjs` (PORT, adding `answer` and `expires`).
- **Build:**
  - Pages driven by the registries, each a view over `x describe`, `__engine` and, if it is built, `x gallery` (doctrine: Agent-operable). The Animation Lab adds the lineup, timeline scrubbing and a bone overlay.
  - A labs index, with a question, an answer and an expiry date for temporary labs (`x lab add|rm|list`).
- **Done when:** every lab passes its suite, and each lab's file comment names the `x` command that does the same job without the page.
- **Verify:** `npm run e2e -- tests/e2e/labs.spec.ts`

#### WP-10.9 The store
- **Owns:** `engine/app/store.ts`
- **Needs:** WP 10.7
- **Size:** S
- **Trigger:** a game saves state across sessions: high scores, progress, its settings (§9.1). Split from WP 10.7 on 2026-10-15 (ADR-0024): no game needs it to start, and until then a page keeps its saves in `localStorage`, outside the sim. Fired 2026-10-17 by the playground (ADR-0025): the playground keeps its settings and bindings across sessions.
- **Carry:** `E.store` (`engine:198-202`), extended with a configurable prefix (replacing the fixed `my3d2dge:`), a memory backend, versioning, and isolation in demo, sandbox and gallery modes.
- **Build:** the store. It writes a format version and checks it on load (shardfall writes one and never checks it).
- **Done when:** the store is unit-tested, and the starter game keeps its best round through it.
- **Verify:** `npm test -- engine/app/store`

### Phase 11: Advanced GPU features (on demand; lane R2: looks and speed only, never gameplay)

**On demand** (doctrine: North Star). Each WP starts only when its **trigger** is measured (§9.1): a budget the standard path misses, or a look the box needs that the standard path cannot give. The ledger note records the measurement. Each uses three.js's built-in GPU features (TSL `compute()`, the addons) before custom WGSL, and changes looks or speed only: the CPU-only gameplay contract (§6.7) holds with it on and off. There is no phase gate.

#### WP-11.1 Completing the feature framework
- **Owns:** extends `engine/gfx/features.ts` (from WP 2.1); `tests/e2e/features.spec.ts`; extends `tools/cmd/perf.ts` with `--feature`
- **Needs:** G7
- **Size:** S
- **Trigger:** the first of WPs 11.2–11.5 is triggered, since it is their common Need (§9.1). Fired 2026-10-17 by the playground (ADR-0025): the first of WPs 11.2–11.5 fired.
- **Build:**
  - Per-feature tests: with the feature on and off, the hash is unchanged and the gameplay entities in view appear in the ID pass (the downgraded look is playable).
  - `__engine.info().features`, and governor integration if WP 7.5 is built.
- **Improves:** I-16.
- **Done when:** the feature matrix passes on WebGPU.
- **Verify:** `npm run e2e -- tests/e2e/features.spec.ts`

#### WP-11.2 GPU timing
- **Owns:** `engine/gfx/enhanced/timing.ts`
- **Needs:** WP 11.1
- **Size:** S
- **Trigger:** a performance question needs GPU time (§9.1). Fired 2026-10-17 by the playground (ADR-0025): the owner's GPU frame time in the playground.
- **Build:** `trackTimestamp`, and `resolveTimestampsAsync` feeding `stats().gpuMs`, where `timestamp-query` exists. The platform's SwiftShader adapter has it (§4.7), though its times are a CPU's emulating a GPU. Where it is missing, `gpuMs` is absent and an advice code says why.
- **Done when:** GPU time appears in `stats().gpuMs` and in `x perf` on adapters that support it, and is reported as unavailable elsewhere.
- **Verify:** `npm run e2e -- tests/e2e/timing.spec.ts`

#### WP-11.3 GPU particles
- **Owns:** `engine/gfx/enhanced/particles.ts`
- **Needs:** WP 11.1, WP 11.2
- **Size:** M
- **Trigger:** the CPU particles of WP 6.4 exceed their budget in the box's densest fight, or a look needs more particles than the CPU path carries (§9.1). Fired 2026-10-17 by the playground (ADR-0025): rain, dust and debris beyond the CPU particles.
- **Build:** compute particles (`instancedArray` plus `Fn().compute`), decorative only, falling back to the CPU particles of WP 6.4. The design is shardfall's: CPU births into a 65,536-slot ring, integration in compute, one premultiplied blend, no normal writes (§5.8).
- **Done when:**
  - The hash is unchanged, and particles stay out of the ID pass.
  - The GPU time measured through WP 11.2 is under the budget, where it can be measured.
- **Verify:** `npm run e2e -- tests/e2e/enhanced-particles.spec.ts`

#### WP-11.4 GPU-driven crowds
- **Owns:** `engine/gfx/enhanced/crowds.ts`
- **Needs:** WP 11.1
- **Size:** L
- **Trigger:** the crowd ladder's render cost at 5,000 misses its budget on the standard path (WP 5.7's numbers) (§9.1). Fired 2026-10-17 by the playground (ADR-0025): the street's crowd variant at 1,000 to 5,000 people.
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
- **Trigger:** a look the box needs that the standard path cannot give: more lights than the pool, ambient occlusion, reflections, or cascaded shadows outdoors (§9.1). Fired 2026-10-17 by the playground (ADR-0025): the house's lights beyond the pool, cascaded shadows over the yard, ambient occlusion indoors.
- **Build:**
  - Tiled lighting (r182's `TiledLighting` addon, on compute), lifting the light pool's limit.
  - GTAO, SSR, and TRAA with deterministic jitter in tests.
  - Cascaded shadows through `CSMShadowNode`, for outdoor scenes.
  - SSGI through r182's `SSGINode` addon when a look needs it, with shardfall's 12-tap spiral as a cheaper tier; god rays and lamp halos as a custom TSL pass ported from shardfall's haze march (r182 has no `GodraysNode`; §5.8).
  - The `quality` tiers (WP 3.12): GI and god rays are off at `medium` and `low`, and halos at `low`.
- **Improves:** I-17.
- **Done when:** each feature passes its tests (hash unchanged, the downgraded look playable) and has a measured cost; if the governor exists, it demotes them under load.
- **Verify:** `npm run e2e -- tests/e2e/enhanced.spec.ts`

### Phase 12: Agent tooling+ (on demand; lane T)

**On demand** (doctrine: North Star). Each WP starts when its trigger fires (§9.1). There is no phase gate.

#### WP-12.1 Scaffolds and skills, completed
- **Owns:** extends `.claude/skills/**` and `.claude/agents/**` (from WP 0.10); `tools/templates/README.md`; the templates of §8.13's kinds that are still missing
- **Needs:** G7
- **Size:** M
- **Trigger:** agents keep writing by hand a kind that has no template, or keep repeating work no skill covers (§9.1). Fired 2026-10-17 by the playground (ADR-0025): the new kinds (movement profiles, camera modes, storey levels, interactables, weapons) and the playground's skills.
- **Build:**
  - `x new` for every kind §8.13 names that still lacks a template, each with `--test` in `x ci --local`; `tools/templates/README.md` lists them all.
  - The skills §8.10 lists that are still missing, and any subagent a measured need asks for.
- **Improves:** I-34, I-36.
- **Done when:** every template passes every check.
- **Verify:** `node x new --test-all`

#### WP-12.2 Agent-usability evals and mutation testing
- **Owns:** `evals/**`, `tools/cmd/evals.ts`, `stryker.config.json`
- **Needs:** G7
- **Size:** M
- **Trigger:** a regression slips past the suites, or agents repeatedly misuse an API (§9.1). Fired 2026-10-17 by the playground (ADR-0025): the owner's order: usability tasks over the playground, and mutation testing.
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
- **Trigger:** image review costs more than it gives, and the ID pass cannot answer the question in Node (§9.1). Fired 2026-10-17 by the playground (ADR-0025): whether the player is in view from each camera in every room, asked in Node.
- **Build:** a coarse visibility raster in Node, built from physics shapes and camera poses. It answers "is X visible from camera C" and draws ASCII thumbnails with a legend, with no GPU (after Pavilion Lite's `ascii`, §5.8).
- **Done when:** its answers agree with the ID pass on the box's cameras for at least 95% of cases.
- **Verify:** `npm test -- engine/dev/eye && npm run e2e -- tests/e2e/eye.spec.ts`

#### WP-12.4 Reading edition (optional)
- **Owns:** `tools/lib/docsGameApi.ts`, `docs/GAME-GUIDE.md` (with WP 10.7)
- **Needs:** G7
- **Size:** S
- **Trigger:** an agent without the repository needs the engine's API in one file (§9.1). Fired 2026-10-15 (ADR-0024).
- **Built** as docs/GAME-GUIDE.md, not `x edition` (ADR-0024): the game agent's guide, and the one file handed to a model without the repository. Its last section, the public API by area, is generated by `x docs --write` from the barrels' area comments: **generated and tested where it names the API, never written by hand there.**
- **Done when:** the section regenerates in `x docs --write`, `x docs --check` fails it when stale, and the guide stays within its budget (`GUIDE_BUDGET_BYTES`, 60 KB; 45 KB written).
- **Verify:** `node x docs --check && npm test -- tools/lib/docsGameApi`

### Phase 13: The Playground (lanes B, P, A, R, I, W, X, T, with the on-demand WPs it fires)

**What it is** (the owner's direction of 2026-10-17, ADR-0025). The engine's second integration target after the Stress Box: `labs/playground/`, a house with a basement, two floors, an attic and a walkable roof, a yard, a street, a gym of calibrated features, a hill, a firing range and a sparring ring, where the player moves as in Apex Legends, in five cameras (first person, third-person shooter, third-person platformer, isometric, top-down) and two looks (cel-shaded and pixel art). docs/PLAYGROUND.md is its design: the site, the move set with its Apex reference values, the cameras, the looks, what a player can do there, and how feel and looks are measured. Every capability this phase builds is shown there, as the box shows Phases 2–7's, and the on-demand WPs the playground needs fire through it (§9.1: their Trigger lines name the need).

**How it runs.** Four stages, each ending at a gate, the character first: if the core character does not feel and look good, nothing after it matters.

| Stage | WPs, in order | Gate |
|---|---|---|
| Feel: the gym | 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 13.11, 13.12, 5.6, 10.6, 10.9 | **G10** |
| The house | 13.13, 13.14, 10.5, 13.15, 10.3, 13.16, 13.17, 7.7, 13.18, 12.3 | **G11** |
| Alive | 13.27, 10.4, 13.19, 13.20, 10.2, 10.1, 13.21, 13.22, 11.1, 11.2, 11.5, 13.23, 11.3, 13.24, 8.8, 10.8 | **G12** |
| The tech demo | 13.25, 7.5, 11.4, 12.1, 12.2, 7.6, 13.26 | **G13** |

**Rules for the playground** (the box's rules, §9.0, hold too):
- **Engine, not game.** The site, the cast, the player's body and every tuned number stay in `labs/playground/`; a mechanism enters `engine/` only through a WP that names it, in a generic form (§5.7).
- **Opt-in, never a changed golden.** New movement, cameras, level formats and looks are opt-in: `movement:platformer` is today's controller, a format-1 level compiles as before, so every existing replay keeps its goldens.
- **Sim-side play, view-side feel.** Movement, traversal, doors, hits and AI are sim-side, hashed and replayable; cameras, viewmodels, camera effects and looks are view-side and reach the sim only through recorded intents (`look`, `aim`, `cam`).
- **Numbers first, then the owner's hands.** Every move, camera and look has numbers an agent checks headless (`node x feel`, docs/PLAYGROUND.md §9); the owner's playtest at each gate is the final word on feel, and its notes become tuning, never a blocker.

#### WP-13.1 The playground lab
- **Owns:** `labs/playground/`, `tests/unit/playground-readme.test.ts`, `tests/unit/readmeClaims.ts`, `tests/e2e/playground.spec.ts`, `tests/replays/playground-*.replay.json`, `engine/gfx/level/ramp.ts`, extends `engine/gfx/level/recipes.ts`, `engine/gfx/level/shapes.ts`, `engine/gfx/level/stairs.ts`, `engine/world/level/glyph.ts` (the smooth ramp), `engine/app/headless.ts` (a replay keeps the view settings), `engine/gfx/puppets/actors.ts` (spare puppets), `tests/unit/box-readme.test.ts`, `tools/game/files.mjs`
- **Needs:** G9
- **Size:** M
- **Build:**
  - `labs/playground/`, organized as the box is (§9.0): `index.html` and `main.ts` (the page imports every module under `scenes/` and `looks/`, its levels as `?raw` text, its sounds, and the menu for humans), `scenes/`, `levels/`, `cast/`, `bodies/`, `looks/`, `sounds/`, and `README.md` with the demo index, the settings table and the controls, checked by `tests/unit/playground-readme.test.ts` as `tests/unit/box-readme.test.ts` checks the box's.
  - The first scene, `playground:gym`: the gym of docs/PLAYGROUND.md §2.3 as a format-1 level (the playground's own glyphs give the calibrated heights, ramps and gaps), the player spawned on today's controller, the five cameras reachable as far as today's codes reach them (`cam3=first`, `cam3=chase`, `cam3=orbit`, `cam=iso`, `cam=topdown`).
  - Playable on the owner's machine from this WP on: `npm run dev`, then `/labs/playground/`.
- **Done when:**
  - The gym steps headless with a golden replay that holds in Node and in the rendering page.
  - The page renders on WebGPU with 0 pipelines built after the warm-up, and its README test passes.
- **Verify:** `npm test -- tests/unit/playground-readme.test.ts && node x sim labs/playground/scenes/gym && node x replay tests/replays/playground-gym.replay.json --browser page && npm run e2e -- tests/e2e/playground.spec.ts`

#### WP-13.2 The player's body
- **Owns:** `labs/playground/bodies/`, `tests/baselines/qa-anim-adult.json`, extends `engine/anim/builds.ts` (an adult build), `engine/anim/locomotion.ts` (`plantedStride`), `tools/qa/anim.ts` (the adult's own QA ids), `engine/gfx/idpass.ts`, `engine/gfx/post/mrt.ts` and `engine/gfx/sky.ts` (the sky as the ID pass's and the MRT's background), `engine/anim/authoring.ts` and `engine/anim/humanoid.ts` (free hands follow their forearms), `tools/cmd/sheet.ts` (the sheet draws the build's own skeleton), `labs/playground/looks/cel.ts` (its ink, ahead of WP 13.24), `labs/playground/cast/player.ts`, `engine/gfx/puppets/grammar.ts` (only if a part the outfit needs is missing); ADR-0025 amendment 2 records why
- **Needs:** WP 13.1
- **Size:** M
- **Build:**
  - `build:adult`: an adult's proportions (1.80 m standing, the leg reach to plant at full stride, so ADR-0009 amendment 4's short feet do not return), its capsule sized to it.
  - The player's body in the body grammar (docs/PLAYGROUND.md §3.1): jacket, trousers, boots, gloves, hair and a face, with a silhouette and a two-tone palette that read in the cel and the pixel look from every camera, and slots the neighbours vary (§7.4).
- **Done when:** the adult build passes `node x qa anim`; the body's state matrix sheet and its thumbnails in both looks are reviewed (visual-reviewer); the ID pass shows every part.
- **Verify:** `npm test -- engine/anim/builds && node x qa anim && node x sheet humanoid --build build:adult`

#### WP-13.3 Movement profiles and the Apex model
- **Owns:** `engine/physics/movement/`, `engine/sim/feelCourse.ts` (the feel course, moved out of actors.ts), extends `engine/physics/{character,feel}.ts`, `engine/sim/actors.ts`, `engine/sim-api.ts`, `tools/cmd/sim.ts` (`--feel`), `engine/app/engine.ts` (`actionMap`), `labs/playground/controls.ts` and the playground's player, gym, menu and page; ADR-0025 amendment 3 records why
- **Needs:** WP 13.1
- **Size:** L
- **Build:**
  - The registry kind `movement`: a profile is data, every number of docs/PLAYGROUND.md §3.2 (speeds, accelerations, frictions, the jump, air control, gravity, step and slope limits, and which moves it allows with their numbers). `movement:apex` holds the Apex reference values; `movement:platformer` is today's controller, exactly, so every existing scene and golden stays as it is.
  - Apex's model, Titanfall 2's as the community's reconstructions and measurements give it (docs/PLAYGROUND.md §3.2): acceleration in m/s² toward the wished velocity (fast from a standstill, slower to the run, slow into the sprint), linear deceleration of only the velocity's part away from the input, Quake's air acceleration with the wished speed capped (air strafing, the best-known model of its kind: Common ground), no air friction, jump fatigue, lurch and the bunny-hop penalty, all tunable per profile.
  - Gaits: run (the default), sprint (held or toggled, within 45° of the view), crouch-walk, and a walk (a held key or a light tilt) at the aiming speed; holstered ×1.15; backpedal and strafe multipliers (1 for Apex); the turn rate and the facing rule (toward the move, the look or the aim: §4's camera modes choose).
  - Landings soft and hard: Apex's fall stun by impact speed (none below a 7.6 m fall, full from 20.3 m, recovering over 1 s), no fall damage; the landing speed fed to the body.
  - The character's state gains its mode, gait and stance as plain data (hashed, captured, restored).
- **Done when:**
  - Under `movement:apex` the feel meter's run, sprint, walk and crouch-walk speeds, acceleration and stop times, the jump's height, jump fatigue, the air-strafe gain and the lurch match docs/PLAYGROUND.md §3.2 within its tolerances.
  - Every existing replay gives its golden hashes, the box's included.
- **Verify:** `npm test -- engine/physics engine/sim/feelCourse engine/sim/actors && node x sim labs/playground/scenes/gym --feel && node x replay tests/replays/*.replay.json`

#### WP-13.4 The feel kit
- **Owns:** `engine/dev/feel/`, `tools/cmd/feel.ts`, `labs/playground/courses/`, extends `engine/physics/feel.ts`, `engine/app/feelMember.ts`; as built (ADR-0025 amendment 4) also `engine/anim/motionMetrics.ts` (from `tools/qa/anim/metrics.ts`), `engine/physics/movement/settings.ts`, `engine/physics/characterBody.ts`, `placeActor` in `engine/sim/actors.ts`, `labs/playground/feel.ts` and the gym's `place`
- **Needs:** WP 13.3
- **Size:** M
- **Build:**
  - Courses: a course is data (a gym feature, a scripted run of intents over it, the numbers to measure and the profile values they must meet). `node x feel <lab> --course <name|all>` runs them headless and writes each number against its reference and tolerance to `out/feel/<lab>-<course>/report.json`; a miss exits 1, and a bound its WP has yet to meet is watched (reported, never failing: ADR-0025 amendment 4).
  - Animation metrics on the same runs: foot slide (a planted foot's drift per contact), pops (the anim QA's rule: a point's jump in a step against its neighbours), hands at their contacts (the distance to a ledge, a rung, a cable).
  - Camera metrics on the same runs: continuity (no jump in the camera's position or turn between frames beyond §4's bound), never inside geometry, the player in view.
  - The owner's feel panel in the page: sliders over `movement.*` and `cam.*` settings, live, with copy-as-profile and save-the-replay, so a playtest's tuning comes back as data.
  - Each movement WP after this one adds its courses (extends `labs/playground/courses/`).
- **Done when:** `node x feel labs/playground --course all` passes every course built so far; the panel changes a setting live (DOM check).
- **Verify:** `npm test -- engine/dev/feel && node x feel labs/playground --course all && npm run e2e -- tests/e2e/playground.spec.ts`

#### WP-13.5 Crouch and slide
- **Owns:** extends `engine/physics/movement/`, `labs/playground/courses/`; as built (ADR-0025 amendment 5) also `engine/physics/hull.ts` (the capsule resized, headroom), extends `engine/physics/{character,characterBody,move}.ts` (the live hull, `climbed`, the opt-in `stepFrom` and `stayOnGround`), `engine/sim/actors.ts` (`crouchToggle`, `placeActor` standing the hull), `engine/dev/feel/{course,run}.ts` (change-points in order, the stance and the slide in a sample and its `until`s), `labs/playground/levels/gym.ts` and `scenes/gym.ts` (the crawl's tunnel and bar, `place`'s speed)
- **Needs:** WP 13.4
- **Size:** M
- **Build:**
  - Stances: crouch shrinks the capsule in place (Rapier's `setHalfHeight`) on the profile's timing (Apex: 0.4 s down, 0.2 s up, crouch spam ignored), from the top on the ground and from both ends in the air; standing waits for headroom; hold or toggle.
  - The slide (docs/PLAYGROUND.md §3.2): entered from a sprint or above the profile's slide speed when crouch is pressed; its boost and the boost's cooldown; low friction; gravity along the slope (downhill gains, uphill stops); the slide-jump keeping the speed; its end into a crouch below the exit speed; cancelled by standing or jumping; under any gap the crouched capsule fits.
- **Done when:** the courses slide-flat, slide-ramps (5°, 10°, 20°, 30°), slide-jump and crawl pass against §3.2; their replays give their goldens.
- **Verify:** `npm test -- engine/physics engine/dev/feel labs/playground && node x feel labs/playground --course slide-flat,slide-ramps,slide-jump,crawl`

#### WP-13.6 Mantle, wall-climb and the superglide
- **Owns:** extends `engine/physics/movement/`, `labs/playground/courses/`; as built (ADR-0025 amendment 6) also `engine/physics/ledge.ts` (walls, ledges and the mantle's path by casts), `engine/physics/room.ts` (the model's questions to the physics), `engine/physics/movement/{mantle,climb}.ts`, extends `engine/physics/{character,feel}.ts` (the mantle's straight move, `Steering.path`), `engine/physics/movement/settings.ts` (the model's switches as settings), `engine/dev/feel/{course,run}.ts` (`duration`, `topRise`, `standHeight`; the mode and the mantle's phase in a sample), `tests/replays/playground-climb.replay.json`
- **Needs:** WP 13.5
- **Size:** L
- **Build:**
  - Ledge finding by shape casts: a wall within reach ahead, its top within the profile's mantle heights, and room for the capsule standing or crouched on it.
  - The mantle as a timed path (the grab, then the pull), into a crouch where only that fits; sprinting in, sprinting out; fences mantled over at a sprint; the mantle hang (letting go of forward during the grab).
  - The wall-climb: airborne into a steep wall, facing it within the profile's angle and holding forward, up it within the profile's two height limits, topping out into a mantle, or letting go; climbing again starts lower; the wall-bounce by zone.
  - The superglide (a jump, then a crouch one tick later, in the pull's last window) and the mantle boost, its one-button form, as in Apex.
  - The contacts (the ledge point, the edge's normal, where each hand goes) as plain data in the state, for the animation.
- **Done when:** the courses mantle (each wall of the gym: mantles within the reach, refuses past it), fences, climb (each wall, and the wall-bounces), hang and superglide pass against §3.2; replays golden.
- **Verify:** `npm test -- engine/physics engine/dev/feel labs/playground && node x feel labs/playground --course mantle,fences,climb,hang,superglide,mantle-boost && node x replay tests/replays/playground-climb.replay.json --browser sim`

#### WP-13.7 Ziplines, ladders and launchers
- **Owns:** `engine/world/traverse.ts`, extends `engine/physics/movement/`, `engine/world/level/legend.ts` (the ladder glyph), `labs/playground/courses/`; as built (ADR-0025 amendment 7) also `engine/physics/movement/{ride,ladder}.ts`, `engine/sim/rides.ts`, `engine/gfx/stageRides.ts`, `engine/physics/carry.ts` (from character.ts), extends `engine/physics/{character,room}.ts`, `engine/world/level/{glyph,types}.ts` (the field `ladder`), `engine/sim/actors.ts`, `engine/gfx/stage.ts`, `engine/dev/feel/{course,run}.ts`, the playground's controls, gym level and scene, `tests/replays/playground-rides.replay.json`
- **Needs:** WP 13.4
- **Size:** M
- **Build:**
  - Ziplines: a cable between two anchors as world data, sloped or vertical; caught with use or by jumping into it within the profile's angles; ridden either way, accelerating to the profile's speed, keeping momentum along it; left by a jump that keeps the speed, or dropped with crouch.
  - The redeploy balloon: a vertical zipline to the balloon, then a skydive (its speeds and the landing pose's height from the profile).
  - Ladders: a level glyph and a prop; up and down, jump off, a mantle at the top.
  - Launchers: jump pads and the trampoline, a sensor that sets the velocity.
  - The gym's tower with its ladder and zipline (docs/PLAYGROUND.md §2.3).
- **Done when:** the courses zipline, ladder, launcher and skydive pass; replays golden.
- **Verify:** `npm test -- engine/world/traverse engine/physics/movement && node x feel labs/playground --course zipline,ladder,launcher,skydive`

#### WP-13.8 Camera modes
- **Owns:** `engine/gfx/cameras/{shoulder,follow,blend,effects,collide}.ts`, extends `engine/gfx/cameras/{first,chase,orbit,presets,codes,place}.ts`, `engine/app/{view,viewMembers}.ts`, `tests/e2e/playground-cameras.spec.ts`; as built also `engine/gfx/cameras/{rig,define,api}.ts` (the rig the view and the feel kit step, a game's own camera, the public names), the fade in `engine/gfx/cutaway.ts`, the camera switches of `engine/dev/feel/{camera,course,run}.ts` and `labs/playground/courses/cameras.ts` (ADR-0025 amendment 8)
- **Needs:** WP 13.1
- **Size:** L
- **Build** (docs/PLAYGROUND.md §4):
  - The five modes as codes: first person `cam3=first`; the shooter `cam3=shoulder` (over the shoulder, the shoulder swap, aim-down-sights); the platformer `cam3=follow` (orbit and follow with recentring, look-ahead and a vertical dead zone for jumps); isometric `cam=iso` (orthographic, 90° turns from keys, whole-number zooms); top-down `cam=overhead` (straight down, orthographic, pixel-exact).
  - Switching blends (position, turn, field of view, orthographic to perspective) instead of cutting; `__engine.camera.set` and a key cycle them.
  - Collision for every follow camera: ball casts through the query view, pulling in and easing out; the occluder fade (a wall between camera and player turns transparent); the camera never inside geometry.
  - Effects, view-only, driven by the character's state, Apex's (docs/PLAYGROUND.md §4): the sprint's eye drop and roll into turns, the boosted slide's wider field of view and roll, the view punch of jumps and landings, the weapon's bob, the mantle's path, screen shake, the aim-down-sights zoom and recoil kick; the field of view as Apex measures it (horizontal at 4:3).
  - The camera factories public, so a game adds its own mode without editing the engine (Common ground: a camera is a function of input and time).
- **Done when:** each mode renders the gym with the player in view; over a soak run no frame puts the camera inside geometry and every switch is continuous (§4's bounds, measured by `x feel`'s camera metrics); no camera changes the hash; the crawl course's shooter camera stops being watched (`labs/playground/courses/crawl.ts`: inside the tunnel's roof and snapping in under the bar at WP 13.5).
- **Verify:** `npm test -- engine/gfx/cameras && npm run e2e -- tests/e2e/playground-cameras.spec.ts`

#### WP-13.9 Controls for every camera
- **Owns:** `engine/input/aim.ts`, extends `engine/input/{actionMaps,input,intents}.ts`, `engine/input/devices/mouse.ts`, `engine/app/engine.ts`, `engine/sim/actors.ts`
- **Needs:** WP 13.8
- **Size:** M
- **Build:**
  - An action map per mode, Apex's default bindings where the browser allows (docs/PLAYGROUND.md §3.3, with Q and E turning isometric, which WP 13.8 left to this WP); `createEngine` takes the map and the input settings, and the page gets the input (prompts, rebinding).
  - Mouse look under pointer lock (lock on click, unlock on pause), with sensitivity, aim-down-sights sensitivity and invert as `input.*` view settings; the right stick likewise.
  - `look` with its pitch, and `aim`: the screen centre's ray in first person and the shooter, the pointer's ray onto the player's floor in isometric and top-down (twin-stick on a pad), recorded every step so live play replays.
  - Movement relative to the look (first person, shooter), to the camera (platformer) or to the screen (isometric, top-down); actors face their move, look or aim as the mode's rule says, at the profile's turn rate.
  - The page sends the view (`look`) in the aiming modes, so the sprint keeps within 45° of it as Apex's does; WP 13.3's model reads it, and until then the page's player sprints in every direction (ADR-0025 amendment 3).
  - Sprint and crouch, hold or toggle (the crouch on C: Ctrl with W closes the browser's tab).
- **Done when:** every map passes the bindings tests; in each mode, live play recorded in the page replays in Node to the same hashes.
- **Verify:** `npm test -- engine/input && npm run e2e -- tests/e2e/playground-cameras.spec.ts`

#### WP-13.10 Locomotion animation
- **Owns:** `engine/anim/locomotion/`, extends `engine/anim/{character,footPlant,weights,humanoid}.ts`, `engine/anim/clip/{layer,library}.ts`, `engine/gfx/puppets/actors.ts`
- **Needs:** WP 13.2, WP 13.5
- **Size:** L
- **Build** (docs/PLAYGROUND.md §5):
  - Blend sets by speed and direction: idle, walk, run, sprint and crouch-walk in eight directions from the library (100STYLE's neutral and crouched sets, Quaternius's jog, sprint and crouch, Mesh2Motion's strafes), phase-synced on their foot contacts, each loop's speed measured where its set has none; the procedural humanoid fills what no clip covers. *Built instead (ADR-0025 amendment 10): the procedural planted stride for every gait; the library's loops wait for a measured need and WP 8.8's contacts (captured at 0.7–1.9 m/s against the playground's 2.3–7.6).*
  - Stride warping (a loop's stride scaled to the speed) and orientation warping (legs toward the movement, the chest toward the aim). *The planted stride is matched to the speed; the hip's turn toward the movement is deferred (amendment 10).*
  - Starts, stops and pivots matched to distance; turning in place; leaning from the turn rate and the acceleration. *Starts, stops and turns in place step on the stance locks; matching to distance waits with the blend sets (amendment 10).*
  - Stance locks with the rule ADR-0009 amendment 8 asked for: a planted foot stays put until its contact window ends.
  - Foot IK on stairs and slopes from the physics ground (the view probes it through the query view).
  - Poses for crouch, slide (pelvis to the slope), rise, apex, fall and the soft and hard landings (chosen by the landing speed); the head and eyes toward the aim. *The head and eyes go to WP 13.11, with its aim offsets (amendment 10).*
  - The foot plant's weight from what the clips cover: today the view drops the plant for every actor with a clip layer, even an idle one (`engine/gfx/puppets/actors.ts`, the plant's weight from `ClipLayer.weight`, which is always 1).
- **Done when:** over every course, foot slide stays within §5's bound and no transition pops (the courses' `feet planted` measures stop watching: `labs/playground/courses/bounds.ts`); the anim QA's foot-slide entries for the player's states pass without a baseline change, and the adult's own (tests/baselines/qa-anim-adult.json, WP 13.2) tighten to the source builds' or go; the state matrix covers every movement state; contact sheets reviewed (visual-reviewer). *Three of the adult's stay above the source builds', accepted (ADR-0025 amendment 10): the roll's foot slide, the axe kick's twist jump and the face-down fall's under-floor.*
- **Verify:** `npm test -- engine/anim && node x qa anim && node x feel labs/playground --course all`

#### WP-13.11 Traversal animation
- **Owns:** `engine/anim/traversal/`, extends `engine/anim/{actions,actions-data}.ts`, `engine/sim/actors.ts`, `engine/gfx/puppets/actors.ts`
- **Needs:** WP 13.6, WP 13.7, WP 13.10
- **Size:** L
- **Build:**
  - The actions system wired into the sim and the view (a component, a view layer), so its 28 actions play on actors.
  - Mantle (the hands planted on the sim's contact points, the body over; Quaternius's climb warped to the height), a fence's top under one hand at a sprint, the mantle hang (Mesh2Motion's ledge hang), wall-climb (hand over hand, the feet pushing), zipline (both hands on the cable, legs swinging), ladder (the climb cycle locked to the vertical speed, hands and feet on rungs), the skydive, the hard landing, the slide-jump. *Built on the procedural body instead of the clips (ADR-0025 amendment 11): they wait for WP 8.8's contacts.*
  - Holding: the weapon carried, lowered when sprinting, the support hand on the grip (two-hand IK); the aim offsets by pitch and yaw; the head and eyes toward the aim (from WP 13.10, ADR-0025 amendment 10: the look's pitch reaching the view's body). *Built ahead of WP 13.20's weapons, the gun carried as the view says (amendment 11); the head and eyes turn the neck and the head.*
- **Done when:** in every course the hands stay within §5's bound of their contacts and nothing pops; contact sheets reviewed.
- **Verify:** `npm test -- engine/anim && node x feel labs/playground --course all && node x qa anim`

#### WP-13.12 First person
- **Owns:** `engine/gfx/viewmodel/`, extends `engine/gfx/cameras/first.ts`, `engine/app/view.ts`
- **Needs:** WP 13.8, WP 13.11
- **Size:** M
- **Build:**
  - Viewmodel arms: the player's arms and hands drawn in their own pass, with their own field of view and near plane, so they never clip a wall; sway with the look, bob with the gait, the sprint's and slide's poses, the hands on the ledge in a mantle and on the wall in a climb, the kick's leg. *Drawn in the frame's own pass by a lens of their own (each vertex on its ray, at the arms' own depth and field of view), a second mesh posed on a rig stood under the camera: the camera's eye leaves the body's shoulders up to 1.4 m away (ADR-0025 amendment 12).*
  - The full body under the camera when looking down, as an option; the culled body still casts its shadow. *The body folds for the camera by a vertex attribute and casts its shadow from where skinning puts it (amendment 12).*
- **Done when:** in every course the arms render without clipping (the depth check), move with the state, and show in the ID pass; the courses' first-person camera checks the arms in view (`lost`, `labs/playground/courses/bounds.ts`).
- **Verify:** `npm test -- engine/gfx/viewmodel && npm run e2e -- tests/e2e/playground-cameras.spec.ts`

**Gate G10, Feel:** under `movement:apex` every course passes against docs/PLAYGROUND.md §3.2; the gym plays in the five cameras with blended switches; foot slide, pops and hand contacts within §5's bounds; every replay gives its goldens in Node and in the page; 0 pipelines after warm-up in every camera and look; the owner's playtest checklist (docs/PLAYGROUND.md §9.3) goes out with the stage's PR.

#### WP-13.13 Storeys: the level format and its colliders
- **Owns:** `engine/world/level/{storeys,rooms,openings,roofs}.ts`, extends `engine/world/level/{parse,compile,colliders,heights,validate,walk,legend,glyph,types}.ts`, `fixtures/levels/storeys/`
- **Needs:** G9
- **Size:** L
- **Build** (docs/PLAYGROUND.md §6):
  - Level format 2 (`my3dge-level/2`), a superset (a format-1 file is one storey at height 0): storeys with their base and height; void (no floor: stairwells, double heights, the outside); walls, doors, windows, railings, stairs between storeys, ladders, a roof over the top storey (gable, hip, flat; pitch; the storey's keys, not glyphs: ADR-0025 amendment 15), room markers, tiles down to 0.25 m; floors below ground (basements).
  - The compiler's colliders: walls per storey, slabs with their openings, stair hulls, roofs.
  - Queries in 3D: `floorBelow(level, x, y, z)`, the storey, the room and the surface at a point; validation (a door wider than the capsule, stairs within the climb, headroom) and `node x qa level`.
- **Done when:** fixture storeys compile to their expected colliders and heights; the controller climbs the stairs between storeys and stands on the roofs; every format-1 level compiles to the same data and hash as before.
- **Verify:** `npm test -- engine/world/level && node x qa level`

#### WP-13.14 Storeys drawn
- **Owns:** `engine/gfx/level/{walls,roofs,slabs,openings,flights}.ts`, extends `engine/gfx/level/{meshes,recipes}.ts`
- **Needs:** WP 13.13
- **Size:** L
- **Build:** walls with door and window openings (frames, lintels, sills), floor and ceiling slabs with their openings, stair flights, railings, roofs (gable, hip, flat, eaves, a chimney), materials per room and glyph, instanced where repeated.
- **Done when:** the fixtures render in both looks, the ID pass tells walls, slabs, roofs and openings apart, and no pipeline is built after warm-up.
- **Verify:** `npm test -- engine/gfx/level && npm run e2e -- tests/e2e/level-meshes.spec.ts`

#### WP-13.15 Sites: storeys and terrain in play
- **Owns:** `engine/world/site.ts`, extends `engine/world/nav.ts`, `engine/gfx/cutaway.ts`, `engine/sim/{scene,levelBodies}.ts`, `engine/world/ai.ts`
- **Needs:** WP 13.14, WP 10.5, WP 13.8
- **Size:** L
- **Build:**
  - Sites: a scene stands any number of levels (structures) on its terrain, each placed at an offset and a turn of 90°; the terrain is cut under them (basements, window wells); `floorBelow`, `surfaceAt`, sight and the rescue answer over all of them.
  - Navigation over storeys and terrain: a grid per storey and the terrain, linked through stairs, ladders and doorways, for the bot and the neighbours.
  - The cutaway by storey (isometric and top-down hide what is above the player's storey, and the roof when indoors) and the occluder fade for third person indoors.
  - Rooms as data for sound (reverb), light groups and the HUD.
- **Done when:** in a fixture site the bot reaches every room from its spawn and back; the cutaway hides the right storeys in every room (ID pass); no third-person frame puts the camera inside a wall over a soak.
- **Verify:** `npm test -- engine/world engine/gfx/cutaway && npm run e2e -- tests/e2e/playground-cameras.spec.ts`

#### WP-13.16 Interaction: doors, windows, switches and pickups
- **Owns:** `engine/sim/{interact,doors,breakables}.ts`, extends `engine/world/props/prop.ts`, `engine/sim/{props,damage}.ts`, `engine/physics/bodies.ts`
- **Needs:** WP 10.3, WP 13.13, WP 13.9
- **Size:** L
- **Build** (docs/PLAYGROUND.md §7.1):
  - Use: the `interact` action finds the usable thing in reach and in view (the crosshair's ray in first person and the shooter, the nearest in front otherwise), with its prompt; the prop's `use` hook gets the world and the entity; a body-to-entity index for uses and hits.
  - Doors: kinematic props on a hinge (props gain the kinematic type), opened away from the player and closed with use, as Apex's are; locked; blocked by bodies; the first melee hit bursts a door open and the second breaks it (Apex's rule, counted only when the player faced it), explosives and shots too, into a falling slab and splinters.
  - Windows: panes that break and leave the opening passable; switches (room lights, the garage door) as sim state the view reads; pickups and throws (carry a light prop, throw it along the aim).
  - `damage` for props with health; bolts and shots knock props.
  - *Built (ADR-0025 amendment 19): engine/sim/damage.ts stays the crowd's; a prop's hit points are its own component, which engine/sim/breakables.ts takes (`damageProp`, `strikeBody`).*
- **Done when:** fixture tests for each; a replay opens, kicks in and breaks a door, breaks a window, throws a prop and switches a light, golden in Node and in the page.
- **Verify:** `npm test -- engine/sim && node x replay tests/replays/playground-site.replay.json --browser page` (the cottage's replay until WP 13.18, the site's since: ADR-0025 amendment 20)

#### WP-13.17 Building materials
- **Owns:** `engine/gfx/textures/generators/{wood,tiles,carpet,wallpaper,shingles,asphalt,concrete,siding,glass}.ts`, `engine/gfx/textures/v3.ts`, extends `engine/gfx/materials/builtins.ts`
- **Needs:** G9
- **Size:** M
- **Build:** the generators a house, a yard and a street need, and their materials, with palettes tuned for the toon and pixel styles.
- **Done when:** every generator tiles without seams (`node x qa tex`), thumbnails in both looks reviewed.
- **Verify:** `npm test -- engine/gfx/textures && node x qa tex`

#### WP-13.18 The site
- **Owns:** extends `labs/playground/`, `tests/replays/playground-*.replay.json`
- **Needs:** WP 13.15, WP 13.16, WP 13.17, WP 13.6, WP 13.7
- **Size:** L
- **Build:** the site of docs/PLAYGROUND.md §2: the house's storeys and rooms, the garage and its deck, the yards, the street, the gym in its final place, the hill, the range and the ring; furnished; lit; spawn points per area; `playground:site` and a scene per area; the README's demo index. *From gate G10: the gym's courses for its gaps (the jump's reach running, sprinting, slide-jumping and superglided) and its steps and slopes, and §3.2's crouch timing, landing stun and climbing again measured on it (unit-tested only so far: engine/physics/movement/).* *From WP 13.15 (ADR-0025 amendment 18): the lot's soak judges only that no camera stands in a wall and watches the cameras' other bounds for this house: in the lot's 2.5 to 3 m rooms the shooter loses the player in 931 of the tour's 1,398 frames, the platformer in 255, and first person and the platformer jump 0.42 and 0.52 m in a frame; judge them here. Amendment 15's leftovers too: a railing collides over its whole tile though drawn as a 6 cm rail, a door's frames narrow its drawn opening 7 cm a side, and `wallUnder` stands a wall up to 0.18 m over a roof's underside near the eaves. The lot (labs/playground/scenes/lot.ts) and its copies of the storey fixtures give way to this site.* *From WP 13.16 (amendment 19): hang the house's doors (`addLevelDoors`) and stand its panes (`addLevelWindows`), a lamp and a switch per room (its light group `room:<name>`), the garage door on its switch in a storey tall enough for its 2.2 m slide up, chairs and boxes to carry; the bot opens a closed door on its way (it uses one in front, as a player does); the cottage (labs/playground/scenes/interact.ts) gives way to the house.*
  - *Built (ADR-0025 amendment 20): the block 96 × 113 m, the gym as built not fitting §2's strip; the lot and the cottage retired, the site's replay in their place; the bot's clear points and look-ahead for the house's doorways, flights and ladders; the shooter's and the platformer's bounds indoors to WP 13.27; the style set warms only the styles looks ask for; the gym's courses for its gaps, steps and slopes, the crouch, the stun and climbing again.*
- **Done when:** the bot reaches every room and area from the spawn; every scene renders in the five cameras and both looks with 0 pipelines after warm-up; the site's replays give their goldens in Node and in the page.
- **Verify:** `node x replay tests/replays/playground-site*.replay.json --browser page && npm run e2e -- tests/e2e/playground.spec.ts`

**Gate G11, The house:** the bot reaches every room of every storey and every outdoor area from the spawn and back; doors, windows, switches and pickups work in replays; the cutaway is right in every room in isometric and top-down; no third-person frame inside a wall over the soak; the five cameras and both looks render the site with 0 pipelines after warm-up; the gallery's sheets of the house's props and materials reviewed.

#### WP-13.19 Melee and the door kick
- **Owns:** extends `engine/anim/moves-data.ts`, `engine/sim/hits.ts`, `labs/playground/cast/dummies.ts`
- **Needs:** WP 13.16, WP 13.11, WP 10.4
- **Size:** M
- **Build:** the punch and the kick (docs/PLAYGROUND.md §3.2: reach, cone, damage, the lunge, the uppercut from a slide), their hits on props, doors, dummies and people; the door kick (Mesh2Motion's `Kick_Breach`, the hit at its strike): the first bursts a door open, the second breaks it off its hinges; hit-stop, shake and sound; seen from both first and third person. *From WP 13.10 (ADR-0025 amendment 10): the adult's axe kick twists its thigh past the source builds' (twist jump 2.5186 against 2.4568) and its face-down fall digs its feet deeper (under-floor 0.3503 against 0.2975), for the kicks and falls the ring plays on it.* *From WP 13.12 (amendment 12): the punch's arm in first person (the rig already draws a kick's leg).* *From WP 13.16 (amendment 19): `melee` strikes now with the use's reach and cone (engine/sim/interact.ts `strikeEntity`, the kind `strikable`); the kick's move, its 1.52 m reach in a 30° cone and its moment of contact replace them, the faced test taken as the swing begins.*
- **Done when:** replays golden; a door bursts open at the first kick and breaks at the second; the leg shows in first person.
- **Verify:** `npm test -- engine/sim/hits engine/anim && node x replay tests/replays/playground-melee.replay.json --browser page`

#### WP-13.20 Firearms
- **Owns:** `engine/sim/weapons.ts`, `engine/gfx/weapons.ts`, `labs/playground/weapons/`
- **Needs:** WP 10.4, WP 13.9, WP 13.12
- **Size:** L
- **Build** (docs/PLAYGROUND.md §7.2): the registry kind `weapon` (fire rate, damage, spread, recoil pattern, magazine, reload, aim-down-sights zoom, range); hitscan through the sim's raycasts; hip fire and aim-down-sights; recoil (the kick in the view, the spread in the sim); reload; holstering (holstered runs faster, as in Apex); impacts (decals, particles, sounds) and tracers; a pistol and a rifle built from parts; the range's pop-up and moving targets, with hits and accuracy on the HUD; aim in every camera. *From WP 13.11 (ADR-0025 amendment 11): the gun's mesh, its recoil and the weapon state (`carry`), and §5.1's muzzle within 2° of the aim as a course measure; from WP 13.12 (amendment 12): the gun's viewmodel in first person (until then the rig takes a carried gun's grips from the body); from the controls (amendment 9): the pad's reload and holster, Apex's X and Y held, on a held binding.*
- **Done when:** the range's replays give their goldens; spread and recoil follow the weapon's data; every camera aims (isometric and top-down by the pointer).
- **Verify:** `npm test -- engine/sim/weapons && node x replay tests/replays/playground-range.replay.json --browser page`

#### WP-13.21 The neighbours and the dog
- **Owns:** `labs/playground/cast/{neighbours,dog}.ts`, extends `engine/world/ai.ts`
- **Needs:** WP 13.15, WP 10.4, WP 10.2, WP 10.1, WP 13.2
- **Size:** M
- **Build** (docs/PLAYGROUND.md §7.4): neighbours on routes and schedules (the sidewalk, the porch, the garden bench) over the site's navigation; reactions (look at the player, step aside, flinch when shoved, startle at a kick or a shot, ragdoll on a hard hit, get up); varied bodies and outfits from seeded slots; the dog on WP 10.1's planted gait (following, sitting, fetching a thrown ball).
- **Done when:** replays golden; each reaction fires on its scripted event; the dog fetches the ball in a replay; a soak finds no neighbour or dog stuck.
- **Verify:** `npm test -- engine/world/ai && node x replay tests/replays/playground-street.replay.json --browser page`

#### WP-13.22 The playground's sound
- **Owns:** `engine/audio/runtime/footsteps.ts`, extends `engine/audio/runtime/{reverb,spatial,mixer}.ts`, `engine/audio/data/effects.ts`, `labs/playground/sounds/`
- **Needs:** WP 13.15, WP 13.16, WP 13.6
- **Size:** M
- **Build** (docs/PLAYGROUND.md §8.1): footsteps by surface and gait; movement foley (slide, landings, mantle, climb, zipline, ladder, crouch); doors, windows, switches, impacts and weapons; reverb from the room the listener is in; indoor and outdoor ambience; occlusion through walls; wind with speed.
- **Done when:** the site's sound timeline hashes the same in Node and in Chromium; every sim event the playground emits has a sound (a coverage test).
- **Verify:** `npm test -- engine/audio && node x audio --replay tests/replays/playground-site.replay.json`

#### WP-13.23 Light and time
- **Owns:** `engine/gfx/daylight.ts`, `engine/sim/lights.ts`, extends `engine/gfx/{lights,sky,atmosphere,stageSky}.ts`
- **Needs:** WP 11.5, WP 13.15, WP 13.16
- **Size:** M
- **Build** (docs/PLAYGROUND.md §8.2): the time of day as sim state a scene sets and runs; the sky, sun, fog and ambience following it in the view (blended presets); switchable lights as sim components the light pool reads each frame (room lights, streetlights at dusk, the porch light); shadows indoors and out.
- **Done when:** look metrics at noon, dusk and night in both looks; a switch changes the view's lights and the hash only through the switch's state.
- **Verify:** `npm test -- engine/gfx/daylight engine/sim/lights && npm run e2e -- tests/e2e/lights.spec.ts`

#### WP-13.24 The two looks, finished
- **Owns:** `labs/playground/looks/`, extends `engine/gfx/post/{looks,presets,snap,filters,composite}.ts`, `engine/gfx/materials/{toon,outline,styles}.ts`, `engine/gfx/resolution.ts`
- **Needs:** WP 13.8, WP 13.17, WP 13.23
- **Size:** L
- **Build** (docs/PLAYGROUND.md §5.2): the cel look (a ramp per material, hue-shifted shadows, a rim, ink from depth and normals at a width scaled to the resolution, the outline shell wired to the stage and to skinned bodies) and the pixel look (a low-resolution render at a whole-number scale, 1-pixel ink, palette ramps with dither fixed to the world, the orthographic cameras snapped to the pixel grid in translation with sub-pixel smoothing, whole-number zooms, and a perspective variant for first person and the shooter); each tuned for the five cameras, by day and by night.
- **Done when:** look metrics and thumbnails per look and camera; the shimmer metric (pixels changed by a sub-pixel orthographic pan) is 0 in the pixel look; visual-reviewer verdicts pass.
- **Verify:** `npm test -- engine/gfx/post engine/gfx/materials && npm run e2e -- tests/e2e/post.spec.ts tests/e2e/playground-cameras.spec.ts`

#### WP-13.27 Follow cameras indoors
- **Owns:** extends `engine/gfx/cameras/{shoulder,follow,collide}.ts`, `labs/playground/scenes/site-soak.test.ts`
- **Needs:** WP 13.8, WP 13.18
- **Size:** M
- **Build** (docs/PLAYGROUND.md §4; ADR-0025 amendment 20): the shooter and the platformer in the house's rooms. Over the house's soak the shooter loses the player in about 7% of the tour's frames, its arm pulled in at the walls, and a door swinging into its ball cuts it (3.45 m in a frame); the platformer loses the player in most, its short arm's view along it missing the chest. Keep the player in view in a room (an arm that rises or swings round as it shortens, the occluder fade for what stands between), never cut by a moving prop, and judge both cameras' bounds over the soak.
- **Done when:** the house's soak judges every camera's bounds, none watched; the gym's courses keep theirs.
- **Verify:** `npm test -- labs/playground/scenes/site-soak engine/gfx/cameras && node x feel labs/playground`

**Gate G12, Alive:** the shooter and the platformer keep the player in view indoors (WP 13.27); melee, the door kick and both firearms work in every camera, golden in Node and in the page; the neighbours, the dog and the dummies react; every event has its sound; day and night in both looks; GPU features each with its downgrade playable and the hash unchanged; hands and feet within §5's bounds with the re-imported clips.

#### WP-13.25 The front end
- **Owns:** `labs/playground/ui/`, extends `labs/playground/main.ts`, `tests/e2e/playground.spec.ts`
- **Needs:** WP 10.6, WP 10.9, WP 13.9, WP 13.20
- **Size:** M
- **Build** (docs/PLAYGROUND.md §8.3): the title screen; the spawn picker (each area and room); pause; settings (camera mode and field of view, controls with rebinding, sensitivity, the movement profile, the look, audio levels, graphics and quality); the HUD per camera mode (crosshair, prompts, ammo, the feel readout); photo mode (the free camera, the looks).
- **Done when:** every screen through DOM queries; settings and bindings survive a reload (the store); menu choices that change play are recorded and replay.
- **Verify:** `npm run e2e -- tests/e2e/playground.spec.ts`

#### WP-13.26 The tour and the hand-over
- **Owns:** extends `labs/playground/`, `docs/GAME-GUIDE.md`, `labs/game/`, `tests/replays/playground-tour.replay.json`
- **Needs:** WP 13.25, and every WP of the stages before it
- **Size:** M
- **Build:** the tour (a replay through every feature, in every camera and both looks: the attract mode, a film per look, a T2 check); the owner's playtest checklist (docs/PLAYGROUND.md §9.3); the guide, lean/ and the starter game brought up to the new public API (movement profiles, camera modes, storeys and sites, interaction, weapons).
- **Done when:** the tour's replay gives its goldens in Node and in the page; `node x docs --check` and `node x engine --test` pass; the films go out with the stage's PR.
- **Verify:** `node x replay tests/replays/playground-tour.replay.json --browser page && node x docs --check && node x engine --test`

**Gate G13, The tech demo:** every row of Phase 13 and every WP it fired is done or blocked only on the owner (named in docs/PROGRESS.md); the tour plays through; the quick gate and main's full run are green; the owner's checklist goes out.

### Phase H: Production hardening (not scheduled)

Doctrine: Discovery first. Cross-platform compatibility and hardening happen when a game goes to production. When that happens, these become work packages:
- Firefox and Safari runs, on their WebGPU; testing on phones and tablets, and on real devices (touch controls exist from WP 3.12, untested by the owner's order; ADR-0021).
- Players without WebGPU: whether to serve them, and how (§2).
- A native WebGPU build (Dawn, or wgpu on Vulkan), if a game ships outside the browser (doctrine: WebGPU only).
- Cross-platform reproducibility, if a game needs it (lockstep multiplayer, shared replays): §6.5's swap extended to whatever the drift test finds on each new platform, Rapier's deterministic build, golden hashes per platform.
- Driver and browser workarounds.
- Releases, versioning and changelogs, and the commit stamp (Vercel deploys every push from WP 0.12).
- Bundle size, minification and loading; accessibility; security headers.
- Performance budgets on target hardware, instead of the development container.

### Upgrade work packages (scheduled when a line qualifies, never mixed with feature work)

Compatible releases need no work package: `x deps --update` adopts them at the start of each WP, in a commit of their own (§6.10). The lines below are not backward compatible, so each waits until it qualifies or, for an internal, until it measurably raises quality (§6.10, rule 7). `x deps --qualify` runs at every gate and lists what has qualified. Each upgrade:
- updates `package.json`, the lockfile, `tools/deps.json`, `@types/*`, `docs/THREE-DELTA.md`, the TSL reference and Appendix B as needed;
- checks the next release against the one that just qualified, and takes it too when it works the same way (§6.10, rule 3);
- runs every suite and replay; re-records goldens, thumbnails and budgets deliberately, recording each change.

It is done when everything is green.

| Id | Upgrade | Qualifies on | Notes |
|---|---|---|---|
| U-1 | Vitest 4 | 2026-10-22 | Configuration and reporter changes; the T1 suites must pass unchanged |
| U-2 | The lint majors: `globals` 17, `eslint-plugin-jsdoc` 62, ESLint 10 | 2027-01-01, 2027-01-09, 2027-02-06 | Each as it qualifies; configuration only |
| U-3 | three r183 | 2027-02-18, or earlier through the internals rule once it measures better | `PostProcessing` becomes `RenderPipeline` (the old name still works, with a warning); `Clock` is deprecated; WebGPU shadows change. The public API is unaffected; re-record thumbnails |
| U-4 | Vite 8 and TypeScript 6 | 2027-03-12, 2027-03-23 | Vite 8 moves to the Rolldown bundler; check TypeScript 6's release notes for removed options |
| U-5 | Node 26 LTS | 2027-05-05 | Through `.nvmrc` and `scripts/setup.sh` (and the environment, §11.5). The drift test runs first; the goldens must hold |
| U-6 | Rapier after 0.21 | When a release measures better (the internals rule) | Re-run §4.7's crowd and restore probes on it; re-record the goldens deliberately, since physics results change; re-tune the character controller if needed |
| U-7 | three r184 and later | When a release runs on the platform and measures better, or 12 months after its release | One WP per release, or several together when they work the same way. r186 needs WebGPU features Chromium 141 lacks (§4.7), so it waits for U-8 |
| U-8 | The platform's Chromium | When the environment's browser changes | Doctrine: Discovery first. The drift test runs first; the goldens must hold. Re-record the thumbnails |

---

## 10. Animation library migration, in detail

### 10.1 What comes over, and under what terms

| Set | Clips | Keys | Seconds | Text (gzip) | Fit, average / worst | Sources | License |
|---|---|---|---|---|---|---|---|
| QUATERNIUS | 88 (32 loops, 13 with root motion, 11 sword) | 1,295 | 135 | 387 KB (74 KB) | 13.9 / 222 mm | Universal Animation Library 1 and 2 | CC0 1.0 |
| MESH2MOTION | 177 (72 / 21 / 12) | 2,798 | 322 | 819 KB (158 KB) | 16.1 / 286 mm | 86 Quaternius re-exports (the 84 with an `orig` are tagged `alt`), 75 hand-animated, 16 mocopi captures | CC0 1.0 |
| CMU | 60 (16 / 44 / 1) | 2,376 | 236 | 722 KB (161 KB) | 17.8 / 167 mm | 25 subject libraries of the CMU database | CMU terms |

**From shardfall** (WP 8.10; the owner approved 100STYLE, ADR-0021), in format 1 plus a clip `speed`:

| Set | Clips | Keys | Seconds | Text (gzip) | Fit, average / worst | Sources | License |
|---|---|---|---|---|---|---|---|
| QUATERNIUS v2, which replaces v1's 88 (`Punch_Enter` stays from v1) | 102 (32 loops, 10 with `speed`, 17 with root motion, 20 sword), plus `Punch_Enter` from v1: 103 in the set | 1,763 | 161 | 527 KB (85 KB) | 14.5 / 222 mm | Universal Animation Library 1 and 2, version 2 (June 2026) | CC0 1.0 |
| STYLE100, seven sets (forward, back, back run, idle, run, side, side run) | 878 (all loops; 775 with `speed`) | 11,329 | 1,132 | 3.33 MB (693 KB) | 10.6 / 546 mm | 100STYLE: about 100 styles of walking, running and standing (Mason, Starke and Komura, 2022) | CC BY 4.0 |

- **After WP 8.10** the library holds 1,218 clips: 5.40 MB of text, 1.10 MB gzipped. Four 100STYLE clips exceed a clip's fit limits, and WP 8.6 baselines them: `HandsBetweenLegs_Walk` (73 / 292 mm), `WildLegs_Walk` (71 / 546), `SwingArmsRound_Walk` (40 / 395) and `Elated_SideRunRight` (30 / 435).

- **Also kept:**
  - three hand-written catalogs (39 KB of tags, descriptions, sources, skips and picks); WP 8.10 replaces the Quaternius one with shardfall's and adds 100STYLE's seven;
  - the ledger of **all 2,548 CMU takes** (113 subjects, 10.75 h; per-take category, fit, flags and usage; 30 rows marked `pick`).
- **Dropped:** HERO (Emberdeep's subset) and the 68 MB `examples/cmu-lib/`, which can be regenerated.
- **CMU terms, recorded verbatim in `data/anim/SOURCES.md`:**
  - The data may be copied, modified and redistributed, and used in commercial products.
  - It **may not be resold directly, even in converted form**.
  - Credit it as: *"The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217."*
- **100STYLE's terms (CC BY 4.0), recorded in `data/anim/SOURCES.md` with the license text:** the clips may be shared and adapted, commercially too, with credit, a link to the license and a note of the changes. Each `style100*` set carries the credit, and any page or game that ships one of its clips shows it, the box's published page included (WP 8.9).
- **Doctrine: Assets.** The clips are text data that agents read and edit, the doctrine's second preference. The binary sources (GLB, AMC) stay in the git-ignored `.cache/`.

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
  - foot roll as `rollL` and `rollR`, and root yaw as `yaw`: named fields, not extra array entries, because shardfall's reader takes fixed-length arrays and skips unknown names, so its files and ours stay interchangeable;
  - a `spine [turn, lean, tilt]` override, written only when the library's spine share misses;
  - `gripL/gripR` (0–100).
- **Optional fields per clip:**
  - `events` (`land`, `hit`, `step`…);
  - `contacts` (foot and hand intervals, detected at import);
  - `props` (`"sword:R"`, `"box:LR"`);
  - the source `fps`;
  - `via` (`v1`, `shardfall` or `source`);
  - `fit`;
  - `speed`: how fast a loop travels as captured, in % of standing hip height per second (shardfall's; WP 8.4 plays the loop at the character's ground speed).
- **Optional fields per set** (`_set.json`), beside `sources`, `body` and `credit`: `title` and `legend` (shardfall's).

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
  SOURCES.md  LICENSES/               provenance and license texts (CC0; CMU terms and acknowledgment; CC BY 4.0)
  catalogs/*.json                     catalogs, input to the importers (mesh2motion and cmu from my-3d2dge;
                                      quaternius and 100style* from shardfall, WP 8.10)
  sets/<set>/_set.json                sources (rest bodies, licenses), body (mannequin segments), credit
  sets/<set>/<Clip_Slug>.json         one clip per file (0.7–40 KB, ~2,100 tokens), real name inside
  sets/<set>/catalog.tsv              generated: name | sec | loop | speed | tags | desc | src | orig | take | fit (~30 tokens a row)
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
- **Sampling stays on the CPU** (doctrine: WebGPU only: gameplay runs only on the CPU). Root motion, events and hit volumes are therefore the same in Node and in every page. An `AnimationMixer` playing the exported `AnimationClip` is for presentation only (the Library Lab, props); the sim never reads it.

### 10.5 Migration steps, each with its proof

| Step | WP | Proof |
|---|---|---|
| 1. Provenance and license files | 8.1 | SOURCES.md lists every library with its URL, file names, license text and acknowledgment |
| 2. Catalogs and ledger copied verbatim, then split | 8.1 | The split rows join back to the original exactly |
| 3. Port `readable.js` with no change in behaviour | 8.2 | Every clip sampled at 30 fps decodes within 0.001 mm of the reference vectors. The legacy oracle reproduces them bit for bit |
| 4. Repackage the sets as one file per clip | 8.3 | Rejoined, they deep-equal the source objects, and `text()` output is unchanged |
| 5. Adopt 100STYLE and Quaternius v2 from shardfall | 8.10 | Rejoined, each set deep-equals shardfall's file, apart from `body`, the `via` marks and v1's `Punch_Enter` in `quaternius`. The source decoder decodes all 980 clips with no NaN. Quaternius v2 against v1, both decoded on v1's rest bodies at 30 fps: 79 of 87 shared clips within v1's fit (mean and worst). Of the other 8, `Swim_Idle_Loop` and `Swim_Fwd_Loop` sit about 1.24 m and 1.07 m lower (their hips at −36% to −47% and −7% to −9% of standing hip height, below the floor) and are within fit once that drop is removed; `Death01` misses on its mean and its worst frame; and `Sword_Attack` and its `_RM` twin, `Walk_Formal_Loop`, `Zombie_Walk_Fwd_Loop` and `Walk_Loop` miss on their worst frame |
| 6. Baker and clip layer | 8.4 | FK parity against the format-1 decode at 30 fps and at 60 Hz midpoints: mean ≤ 1 mm per set; worst cases listed |
| 7. Node contact sheets, tests and clip mode | 8.6, 8.9 | Lints pass or are baselined with reasons |
| 8. Port the tools | 8.5 | `x anim import --cmu --legacy` reproduces the CMU set byte for byte. This study verified that the source's importer does so today |
| 9. Format-2 re-import from the sources | 8.8 | Per clip, decoded-point parity with the clip's current format-1 decode (v2's for Quaternius, shardfall's for 100STYLE) within that clip's fit; swapped in one at a time as `via: "source"` |
| 10. Re-survey CMU; import the `pick` rows as games need them | 8.8 | The ledger's `fit` reflects format 2; the notes are kept |

### 10.6 What the library does not cover, and how the engine fills it

**Already covered for humanoids** (measured against `ANIMATION-RESEARCH.md`'s ranked list), most of tiers 1–3:
- jump phases, get-ups, rolls and flips;
- lift, carry and throw; interactions; idle life;
- swimming, crawling, sliding and gliding;
- about 100 styles of walking, running and standing (100STYLE, WP 8.10);
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
- 100STYLE's original takes (CC BY 4.0), for clips beyond the one loop per style and gait that WP 8.10 brings (WP 8.8).

---

## 11. Running this plan: extra effort or ultracode

### 11.1 Rules for both modes

- **The doctrine first.** Read `DOCTRINE.md` at the start of every session. When the plan and the doctrine disagree, follow the doctrine and record the conflict (§11.4). Where both are silent, use judgment (doctrine: How to read this); when going against the doctrine looks best, escalate with the reasoning (§8.14).
- **Order and gates.**
  - Never start a WP before everything it **Needs** is done and green.
  - Never call a gate passed until all its checks are green.
  - Never weaken a gate to pass it.
- **The box comes first.** Until G7, a WP that does not serve the current box stage waits, unless an agent is idle and its Needs are green (lanes L and X, §9.1). On-demand WPs wait for their triggers (§9.1).
- **Commits.** One commit per WP (more is fine), with the message `<area>: <what> (WP-x.y)`. Compatible releases adopted at the WP's start go first, in a `deps:` commit of their own (§6.10).
- **Pushes and pull requests** (the owner's standing policy, ADR-0021). Push after every major milestone (each gate), open one PR per stage, merge it once the quick gate (`x ci --local`) is green, wait for main's full run after it and report it (§8.9, ADR-0023), and delete its branch. None of this needs the owner's approval. The repository allows only squash merges and deletes a PR's branch when it merges (its settings on 2026-10-10), so each stage lands on `main` as one commit, and each WP's own commits stay readable through its PR (`git fetch origin pull/<n>/head`). Start the next stage from the updated `main`. Push the session's branch more often when that protects work. Work on the branch your session designates. Vercel builds each push (WP 0.12). Before merging a stage PR, look once at its Vercel status, without waiting for it: if the build failed, reproduce it in a clean checkout of the pushed commit with `npm ci && npm run build` on Node 24 and fix it before merging; if it is still pending, or there is none yet (before the owner's Vercel imports the repository), merge; if it failed but does not fail in the clean checkout, merge and ask the owner for Vercel's build log, which agents cannot read. Nothing else is checked there, and nobody polls it (ADR-0021).
- **The ledger.** In extra-effort mode, update §14 in the same commit as the work: status, commit and a one-line note. In ultracode, lanes report and the integrator writes the ledger. At each gate, rewrite `docs/PROGRESS.md`: one screen on where things stand, what is next and the open issues, which every session reads first (shardfall's lesson, §4.8).
- **Deviations** become ADR amendments in `docs/decisions/`. **Blockers** go in the WP's ledger note, together with the smallest core change that would unblock it. Then move on to the next independent WP.
- **Escalations** follow §8.14: ask, wait up to 15 minutes, then commit, decide and record. Never stall.
- **The source repos.** `$MY3D2DGE_SRC` and `$SHARDFALL_SRC` (WP 0.1; `x src` checks them) point at read-only checkouts of my-3d2dge at `e37e4ee` and shardfall at `fa2dab6`. Read only the cited line ranges; never edit them.
- **Context hygiene: the one reading instruction.** Read `DOCTRINE.md`, AGENTS.md, the WP entry and only the sections it cites, and the **file comments** of the modules involved. Open a whole source file only when porting it. The front matter, AGENTS.md and the prompts below all say the same.

### 11.2 Extra effort: one agent, sequential

**Recommended order**, which follows the dependency graph and keeps the box running at every stage:

| Stage | Work packages |
|---|---|
| Up to G0 | 0.1 → 0.2 → 0.4 → 0.5 → 0.3 → 0.6 → 0.7 → 0.11 → 0.8 → 0.12 → 0.9 → 0.10 |
| Up to G1 | 1.1 → 1.6 |
| Box 1 (G2) | 2.1 → 2.7 |
| Box 2 (G3) | 3.1 → 3.9, then 3.11, then 3.12, then 3.10 |
| Box 3 (G4) | 4.1 → 4.6 |
| Box 4 (G5) | 5.1 → 5.5, then 5.7 |
| Box 5 (G6) | 6.1 → 6.7 |
| Box 6 (G7) | 7.1 → 7.4, then 7.8 |
| Library (G8) | 8.1 → 8.2 → 8.3 → 8.10 → 8.4 → 8.5 → 8.6 → 8.7 → 8.9 |
| Audio (G9) | 9.1 → 9.5 |
| The Playground (G10 → G13) | Phase 13's four stages, in the order its table gives, with the on-demand WPs it fires in their places |
| On demand, each when its trigger fires | 5.6, 7.5, 7.6, 7.7, 8.8, 10.1 → 10.9, 11.1 → 11.5, 12.1 → 12.4; Phase 13 fires every one not yet done (ADR-0025) |

A range such as `2.1 → 2.7` means every WP of the stage in numeric order. On-demand WPs run in the order their triggers fire; the last row only lists them. Upgrades (U-1…U-8) slot in between stages when they qualify.

**Loop for each WP:**
1. `node x deps --update`: adopt any compatible releases, in a commit of their own.
2. Plan the files.
3. Write the tests first where the Done-when list is numeric.
4. Implement.
5. `npm run check` → `npm test` → `npm run e2e` (selected as in §8.2).
6. For an L-size WP, the `verifier` subagent reviews (§9.3).
7. Fix, commit, update the ledger.

**Use subagents to keep the main context small:**
- `verifier` for L-size WPs and every gate;
- `visual-reviewer` for anything visual;
- T2 and the long runs as background tasks;
- an Explore agent for wide searches of the source.

**Checkpoints.** At each gate: run `x deps --qualify`, push, open the PR, wait for a green `x ci --local` (the quick gate, ADR-0023), look once at the PR's Vercel status unless the owner has it paused (§11.1), squash-merge it (GitHub then deletes the branch), then write a gate note in the ledger (what is proven, measured numbers, open risks, escalations and the calls made). Post the box's film of the stage for the owner (§11.5).

### 11.3 Ultracode: a multi-agent workflow

**Shape.**
- **Phases 0 and 1 run in sequence**, as a single lane with an implementer, and a verifier for L-size WPs and the gates.
- **Each box stage (Phases 2–7) runs its lanes in parallel**, keeping fewer than 10 agents at once: up to 6 implementers (the stage's lanes from §9.1), a shared verifier queue (1–2 agents) and the integrator (lane B), which runs the stage's integration WP and its gate.
- **A lane may start a later stage's WP early**, when its Needs are green and an agent is free. It never delays the current stage's gate.
- **Lanes L and X** (Phases 8 and 9) may run in the background from G1 when there is room under the agent cap.
- **After G7**, Phases 8 and 9 finish as parallel lanes (L and X), and on-demand WPs start as their triggers fire, each in its phase's lane.
- **Phase 13** runs as the box stages did: each stage's lanes in parallel under the agent cap, the integrator (lane B) running `labs/playground/` and the stage's gate, and the on-demand WPs it fires in their own phases' lanes.

**Isolation.**
- Each lane runs in its own git worktree (`isolation: "worktree"`). Before its first Verify, the lane:
  - runs `npm ci` in the worktree. It never symlinks the main checkout's `node_modules`: `npm ci`, which `x ci --local` runs first, empties a symlinked `node_modules` through the link, so the main checkout and every lane that shares it lose their packages (measured on npm 11.19);
  - sets its own `PORT`, so its Vite server and Playwright runs never collide with another lane's;
  - needs no other shell state. Every `x` command resolves the source itself (`$MY3D2DGE_SRC`, else `.cache/src-3d2dge`, else the WP 0.1 order), and `x check` detects the worktree (WP 0.4).
- A WP may change only its **Owns** paths, as widened by the rules in §9.3.
- Generated files (`docs/INDEX.md`, `docs/API.md`, `docs/ERRORS.md`, `docs/escalations/README.md`) are never resolved by hand. On a merge conflict, take either side and re-run the generator.
- Shared files are owned by the integrator or regenerated:
  - `eslint.config.js`, `package.json`, `tools/deps.json`, `tsconfig.json`, `vite.config.ts`, `playwright.config.ts`, the generated docs, the ledger.
  - `package-lock.json` is regenerated: on a conflict, take either side and run `npm install`.
  - `engine/index.ts`, `engine/sim-api.ts` and its Animation area `engine/anim/api.ts` (ADR-0020 amendment 8) are append-only: a lane appends its own export lines, and a merge keeps both sides.
  - After G7, `labs/box/main.ts` and `labs/box/README.md`: Phases 8–9 and the on-demand WPs request their wiring there; in Phase 13, `labs/playground/main.ts` and `labs/playground/README.md` likewise.
- Lanes request changes to shared files through their final report.

**Content as data goes to helpers.** Levels, props, looks and box variants are data, so the integrator can hand them to helper agents (a cheaper model is fine) with a brief that names the coordinates, the tools and the check, each helper in its own scratch directory, and each result accepted only after a headless run. Shardfall's helpers built 27 rooms this way (§4.8).

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
$MY3D2DGE_SRC (my-3d2dge@e37e4ee) and $SHARDFALL_SRC (shardfall@fa2dab6): read only the cited lines. Change only the Owns paths. Follow the doctrine: familiar
terms in the public API, the best quality you can execute behind it. Write tests first for numeric Done-when items. Iterate until every Verify command exits 0. If an action needs the owner's
approval or a principle cannot be satisfied, do not wait and do not perform it: record it with
`node x esc open --no-wait`, take the doctrine's preferred alternative (procedural or text instead of binary; a stub
behind the feature registry), and report it.
Final report (≤ 30 lines): files changed; Verify results with report.json paths; Done-when checklist with evidence;
requested shared-file edits (exact text); deviations as ADR amendment text; escalations; open issues.
```

**Verifier prompt** (one per L-size WP and per gate, adversarial):
```
Verify WP-<id> of my-3dge on branch <b>. Run its Verify commands plus `npm run check` and `npm test`.
Then try to break it against DOCTRINE.md: reproducibility leaks (Math.random, clocks, renderer reads in sim-side code),
anything reachable only through a page, binary files without approval, versions outside the Mastery rule, bespoke code
in the game-facing surface where an established tool or three.js API would do (Common ground), internals below the
best quality the builder can execute (Quality under the hood), game code reaching past engine/index.ts or
engine/sim-api.ts, public exports without docs or errors without a fix, GPU work that can change play, silent
downgrades, files outside Owns, missing or weak tests (would a plausible bug pass? ADR-0021 orders none for the
touch controls and the Vercel deployment), docs drift, unbaselined QA
changes, game content (§5.7), box sample content leaking into engine/, work built ahead of its trigger (North Star),
production-hardening work outside Phase H (ADR-0021's exceptions aside), deviations from the doctrine without an escalation
or an owner's call recorded in an ADR (ADR-0021).
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

**Seeing the work.** At each gate, the agent posts the stage's film (`x film`) and the box's numbers in the PR or the chat. Vercel deploys every push (WP 0.12), so the owner can also open the box on a desktop or a phone, and reports what looks wrong: nothing tests the deployment or the touch controls (ADR-0021).

**Switches that belong to the owner:**

| Step | Needed by | Fallback until it's done |
|---|---|---|
| Node 24 for every new session: add `bash scripts/setup.sh` to the environment's setup script (the cloud environment menu in the session's title bar, then Edit, then Setup script) | Optional, from WP 0.1 | The SessionStart hook installs Node 24 in each session |
| GitHub Actions on for the repository, and an agent token allowed to push `.github/workflows/*` (the `workflow` scope) | WP 0.9 | Done (ESC-0001, 2026-10-14): the workflow runs the full run after each merge to main and by hand (§8.9, ADR-0023) |
| Branch protection that makes `ci.yml` a required check | I-33 | Declined by the owner (2026-10-15, ADR-0023): agents run the quick gate before every merge, and `x ci --status` reads main's full run |
| Vercel imports the repository (the owner's Vercel does it automatically; `vercel.json` sets the build). Paused by the owner from 2026-10-15 until they test: agents ignore its statuses and errors (ADR-0023) | WP 0.12 | Films and pictures in the PR or chat; `npm run build` plus `npx vite preview` locally |
| Report problems seen on a phone or in the deployed pages: nothing tests them (ADR-0021) | WPs 0.12, 3.12 | Nothing is fixed there until reported, except a failed Vercel build |
| Sessions that run this plan include `michaelcrosato/my-3d2dge` and `michaelcrosato/shardfall` (both are public since 2026-10-14, so a session or a GitHub Actions runner also clones them anonymously) | WP 0.1 | `x src` fails, and with it `x ci --local`, so nothing merges; the agent escalates at once |
| The four GLBs of the Quaternius Universal Animation Library's version 2 (`UAL1_Standard.glb`, `UAL1_Standard_RM.glb`, `UAL2_Standard.glb`, `UAL2_Standard_RM.glb`): a download link or a private repository | WP 8.8 (on demand) | Quaternius clips stay as WP 8.10 brought them (format 1), listed as blocked |
| Model access for agent-usability evals (headless Claude Code or an API key) | WP 12.2 (on demand) | `x evals --dry-run` checks the tasks and their acceptance tests only |
| Any binary asset other than a font (doctrine: Assets) | As needed | A procedural or text version, or the feature waits |
| Spending money: a paid service, API or plan | As needed | The free path, or the work waits |

---

## 12. Risk register

| # | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| R1 | The animation's tuned "feel" is lost in the port (axes, units, positions → rotations) | M | H | Reference vectors (WP 0.11); differential tests (WPs 3.6, 6.1); `x film --compare` (from Box 2); motion QA | A |
| R2 | A `Math` function starts to differ between Node and Chromium after a runtime update, or sim code runs outside the swap, and the shared goldens break | M | M | `withSimMath` around every sim entry point (§6.5); the drift test names the function and the stdlib port that covers it; `--bisect`; the `determinism-debugging` skill | C, P |
| R3 | Headless WebGPU is flaky, loses its device, or breaks in an environment update, with no second backend to fall back on | M | H | Real-canvas presentation with shardfall's flags, measured (§4.8), and the stand-in canvas kept as a fallback; WebGPU asserted in every suite; retries for infrastructure failures only; the Node tiers (T0, T1 and the replays) need no GPU; the browser changes only through U-8; escalate at once | T |
| R4 | Agents write APIs from newer three.js releases than r182 (`RenderPipeline`, `ClusteredLighting`…) or deprecated ones | H | M | Game code meets only the public API, so the risk lives in the internals; `@types/three` 0.182.0 makes a missing name a type error; three.js's own sources in `node_modules`; `THREE-DELTA.md` and the TSL reference as it stood for r182; ESLint bans with their replacements; deprecations fail tests | T, R |
| R5 | r182's quirks: the instancing uniform path and its buffer usage; `positionLocal` after instancing; readback rows padded to 256 bytes | H | M | The instancing service; outlines from `positionGeometry`; `shot()` strips the padding; tests for each (§4.7, §4.8) | R |
| R6 | An upgrade breaks a technique (r181.2 broke the prototype's MRT path; r186 does not start on the platform's Chromium) | M | M | Each upgrade is its own WP that runs every suite; a newer internal is adopted only after it is measured on the platform; fragile techniques avoided; the upgrade calendar of §9 | R |
| R7 | Rapier 0.21 diverges somewhere the probes did not reach, or a restore drifts in a case they missed (0.19.3's did once bodies touched, §4.7) | L | M | Capture tests with bodies in contact (WPs 3.1, 4.1); replays in Node and Chromium at every stage; `--bisect`; the deterministic build (the same API) as a fallback, through an ADR | P |
| R8 | Crowd physics cost at 5,000 bodies (21 ms in the prototype; 22 ms per step for 5,000 steered capsules on Rapier 0.21 SIMD, §4.7) | H | M | Sleeping; sim LOD (kinematic grid movement beyond a radius), a scene setting recorded in replays and never driven by frame time; budgets. GPU-driven crowds for rendering only (WP 11.4, on demand) | P, R |
| R9 | Size creep and docs drift | M | M | `x docs --check`; caps on file length (ESLint's `max-lines`) and on file comments (40 lines) | T |
| R10 | Parallel agents collide | H | M | Owns lists; worktrees; shared files regenerated or owned by the integrator | Integrator |
| R11 | Licenses or provenance get lost | L | H | `SOURCES.md`; per-clip `src`/`orig`/`take` tests; the CMU terms verbatim; 100STYLE's credit on every `style100*` set, with the license text (WP 8.10) | L |
| R12 | Large data in git | L | M | `.cache/` on demand; no build output committed; the asset scan | L, T |
| R13 | Tools that need the network (CMU over HTTP; GitHub 403s for `curl` in the sandbox, while `git clone` works) | M | H for the source checkout, L otherwise | `$MY3D2DGE_SRC` resolution order (WP 0.1); committed reference vectors checked by checksum; network tests at gates or on demand; caching | T, L |
| R14 | Agents report success falsely or skip tests | M | H | The `verifier` on L-size WPs and every gate; `x ci --local` as the gate; the "never skip a test" rule; mutation testing on demand (WP 12.2) | T |
| R15 | Visual regressions go unnoticed | M | M | The ID pass, thumbnails, `x film --compare <ref>` from Box 2, and the `visual-reviewer` subagent on demand | R |
| R16 | Audio unlock rules in browsers | M | L | Resume on a gesture, a first touch included; an in-game mute; a problem on a phone, iOS included, is fixed when the owner reports it (ADR-0021) | X |
| R17 | Churn from adopting compatible releases at once: a patch changes formatting, warnings or sim results in the middle of a stage | M | M | `deps:` commits of their own at a WP's start, passing T0–T2; exact pins and the lockfile; goldens re-recorded with reasons; a one-commit rollback | T |
| R18 | Game content creeps into the engine, or the box becomes a game | M | M | The exclusion list (§5.7); box content stays in `labs/box/`; stages are defined by engine capabilities, not game design; the verifier checks both | All |
| R19 | Escalations stall work or get lost | M | M | The 15-minute rule; `x esc` records; `x check` fails on an overdue open escalation; SessionStart lists open ones; gate notes list the calls made | T, Integrator |
| R20 | Hardening work leaks in early and slows discovery | M | L | Phase H is not scheduled; the verifier flags hardening outside it | All |
| R21 | Playwright 1.64 drives the container's older Chromium 141 through `executablePath`, a pairing Playwright does not promise | M | M | Measured working (§4.7); the harness spec (WP 0.2) catches a regression at once; on a failure, pin the newest 1.x that works and record the call, or the owner updates the environment's browser | T |
| R22 | Newer three.js releases need WebGPU features the platform's Chromium 141 lacks (r186 fails at startup), so three.js upgrades stall until the environment's browser changes | H | L | r182 does what the box needs; U-7 waits for U-8; a newer internal is adopted only after it is measured on the platform | R |
| R23 | On demand goes wrong both ways: work built ahead of need, or a needed tool never built because nobody measured its trigger (doctrine: North Star) | M | M | Concrete triggers in §9.1; the ledger records each trigger's measurement; each gate note lists the on-demand WPs that came close to triggering | All |
| R24 | The touch controls and the Vercel deployment are untested by design (ADR-0021), so a problem on phones or in the deployed pages goes unseen until the owner reports it | M | L | The desktop suites keep the shared code green; WP 3.12 copies shardfall's design, which was checked only under phone emulation (its `docs/HISTORY.md:99-105`); errors show as page text (WP 0.8); a failed Vercel build seen in the one look before a stage PR's merge is fixed first, when it reproduces in a clean checkout; a reported problem is reproduced first (`npm ci && npm run build` for the build) | I, T |

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
| 0006 | **Reproducibility contract** (§6.5, doctrine: Reproducible): the development platform only; game code writes the standard `Math` and three.js's math, while the sim swaps in stdlib's fdlibm ports for the functions that differ between runtimes, so one golden per replay holds in Node and in Chromium; the drift test; an ordered world; Rapier 0.21's SIMD build, whose restores continue exactly; the hash over the bodies' state; the proof matrix |
| 0007 | **Versions** (doctrines: Mastery, Quality under the hood): the newest release compatible with each qualifying one, adopted at once; internals may go newer when a measurement on the platform shows better quality. Today: three.js r182.0 and Rapier SIMD 0.21.0 (internals, §4.7), stdlib's math 0.3.1, TypeScript 5.9.3, Vite 7.3, Vitest 3.2, Playwright 1.64 driving the container's Chromium 141, and Node 24.21 LTS; `x deps`; upgrades as lines qualify or measure better (§6.10) |
| 0008 | **Rendering** (doctrine: WebGPU only): WebGPU is the only renderer, required at startup, with no WebGL 2 fallback; everything WebGPU offers, compute included, serves looks and speed; materials are data with familiar parameters, drawn inside the renderer by whatever looks best (TSL, compute, the addons); game UI in HTML/CSS; the CPU-only gameplay contract (§6.7); optional GPU features on demand; one fixed MRT set up at startup, with every filter gated by a uniform (§6.7) |
| 0009 | **Animation architecture:** effector-space authoring, then IK, then a rotation skeleton (root + 23 joints); an explicit layer stack; two update paths; no Card mode; no camera input to animation |
| 0010 | **Animation library:** readable key poses (format 1, extended as format 2) are the stored format, baked to rotation tracks that are also three.js `AnimationClip`s; the CMU library comes on demand |
| 0011 | **Characters as data:** body grammar v2; one rigid-skinned mesh per character by default; instanced crowds; smooth skinning optional |
| 0012 | **Registries and schemas:** "ask the entry, never the id"; every kind gets an `x describe` listing (also `__engine.describe()`) and docs; scaffold templates arrive with use (§8.13), and `gallery` hooks with the gallery (on demand); kinds with a QA family get its checks |
| 0013 | **Audio:** pure DSP into seeded, hashed `Float32Array`s; Web Audio for playback and spatial sound; `OfflineAudioContext` only for smoke tests |
| 0014 | **Tooling:** the standard toolchain behind npm scripts (Vite, Vitest, Playwright Test, ESLint, Prettier, tsx); one CLI, `node x`, with `report.json`, for what only this engine does; test tiers with budgets; tests selected through Vite's module graph; images optional; every capability machine-operable (doctrine: Agent-operable) |
| 0015 | **Docs:** JSDoc file and export comments are the manual; INDEX, API and ERRORS are generated; prose is never duplicated; pinned knowledge is the packages' own sources and types, `THREE-DELTA.md` and the TSL reference |
| 0016 | **Repo hygiene:** no committed build output; a lockfile; the version in `package.json` only; `x ci --local` as the gate until Actions are enabled; pushes at milestones, and stage PRs squash-merged, the only method the repository allows, with their branches deleted (ADR-0021) |
| 0017 | **Escalation protocol** (§8.14): what needs the owner, the 15-minute rule, the records |
| 0018 | **The roadmap:** box first, in six stages; then the animation library and audio; everything else on demand, each WP when its trigger is measured (§9.1, doctrine: North Star); production hardening only when a game goes to production (doctrine: Discovery first) |
| 0019 | **Common ground** (doctrine: Common ground): what game agents touch (the toolchain, the public API, the data formats, the `x` commands) uses established tools, libraries and patterns. The bespoke game-facing parts, each because nothing established does the job: the `x` commands (engine operations), the escalation log, the ID pass and look metrics, replays and hashing, content QA, the animation system being ported, and the local ESLint rules. Internals follow ADR-0020. Dependencies in `node_modules`, Rapier's inlined WASM included, are code, not source assets (doctrine: Assets) |
| 0020 | **Quality under the hood, behind a public API** (doctrines: Quality under the hood, Common ground): game code imports only `engine/index.ts` and `engine/sim-api.ts`, enforced by ESLint; every public export is documented and every error names its fix in API terms, so game agents never need to read the internals; behind that boundary, the internals use the highest-quality approach their builder can execute well, newer releases included when measured (§6.10, rule 7) |
| 0021 | **The owner's calls of 2026-10-10:** (1) mobile support modelled on shardfall's (WP 3.12: its touch controls, its page set up for phones, and its lighter defaults on phones) and a Vercel deployment of every push (WP 0.12) are built now, ahead of Phase H, and **not tested**: no specs, device emulation, phones, deployment tests or CI steps for them. A stage PR's Vercel status gets one look before merging, so a failed build is fixed when it shows (§11.1). That look is not a test. Any other problem with them is fixed only when the owner reports it, and may then be reproduced by whatever it needs (touch emulation included), without adding a standing suite. The `verifier` does not flag their missing tests (an exception to the doctrines Verifiable and Discovery first, made by the owner). (2) 100STYLE (CC BY 4.0) is adopted, with its credit (WP 8.10). (3) Pushes (at milestones, and the session's branch whenever that protects work), stage PRs squash-merged, their branches deleted, and the Vercel deployments that pushes trigger need no approval (§8.14, §11.1) |
| 0022 | **The owner's calls of 2026-10-12:** the testing budget: cheap, objective checks, never wall-clock time on the shared machine |
| 0023 | **The owner's calls of 2026-10-15:** long tests never hold up work: merges wait on the quick gate, and the full run goes on main after each merge |
| 0024 | **Handing the engine to game agents:** one URL, one command, one guide; lean/ is the default handoff (amendment 1) |
| 0025 | **The owner's direction of 2026-10-17, the Playground** (Phase 13): a character-first vertical slice, a house on a block where the player moves as in Apex Legends in five cameras and two looks; it fires the on-demand WPs it needs; the gameplay of RDR2, GTA V, Apex Legends and Cyberpunk 2077 as the long aim |

### 13.2 Open questions, each with a default (proceed with the default; revisit only through an ADR amendment)

| # | Question | Default |
|---|---|---|
| Q1 | How big is the first box? | `room`, 16 × 12 m, with walls, a low wall, a pillar and spawns. It grows by new scenes and variants, never by changing the meaning of a passing one |
| Q2 | How much of the prototype's behaviour must the box match? | None beyond the ported animation math. The prototype's numbers are starting values; changes record their reason in the scene data |
| Q3 | Hosting | Vercel, from WP 0.12 (the owner's call, ADR-0021): every push builds from source; `main` is production, other branches are previews. Nothing tests it: a failed build is fixed when it shows, other problems when the owner reports them |
| Q4 | Where does the future game live? | Answered 2026-10-15 (ADR-0024): each game in a repository of its own, made by `node tools/game/new-game.mjs`, the engine vendored in it and pinned by engine-lock.json (tags wait for Phase H) |
| Q5 | Rapier: the standard, SIMD or deterministic build? | Answered by measurement (§4.7): the SIMD build, 0.21.0, with exact restores and the fastest step at 1,000 and 5,000 bodies. It is an internal, so its novelty costs game agents nothing. `deterministic-compat` (the same API) through an ADR only if a divergence bisects to Rapier, or in Phase H if a game needs cross-platform replays |
| Q6 | Characters: skinned or rigid parts? | One rigid-skinned merged mesh by default; smooth skinning per body, optionally |
| Q7 | Card mode? | Dropped. If a game ever needs sprite characters, they become a separate optional module |
| Q8 | The pixel look? | A post filter (the `pixel` look) over real geometry |
| Q9 | Mobile? | Touch controls from WP 3.12, modelled on shardfall's, with lighter defaults on phones (the owner's call, ADR-0021). Nothing is tested on phones: the owner reports problems, and only then are they fixed. Testing on real devices waits for Phase H |
| Q10 | Distributing the CMU library | `x anim cmu` fills `.cache/` on demand; a checksummed release asset can come later |
| Q11 | Import 100STYLE (CC BY 4.0)? | Yes: the owner approved it on 2026-10-10 (ADR-0021). WP 8.10 brings shardfall's 878 clips, credited in `SOURCES.md` with the license text |
| Q12 | Run the sim in a Web Worker? | Not until a perf WP proves the need. The sim has no DOM, so it stays possible |
| Q13 | An ECS framework? | None: plain objects and systems in a fixed order. Revisit only with measurements |
| Q14 | Upgrade three.js at every release that qualifies? | Yes (doctrine: Mastery), as its own WP between stages, taking the next release along when it works the same way, and earlier when a release measures better on the platform (an internal, §6.10 rule 7); skip a release only when its WP finds a regression, and record why |
| Q15 | How often are compatible releases adopted? | At the start of every WP and at every gate (`x deps --update`), in a `deps:` commit of its own that passes T0–T2: at once, as the doctrine says, but never mixed with feature work |
| Q16 | Players without WebGPU? | Not served before Phase H: the engine refuses to start, with `GFX_NO_WEBGPU`. Serving them is a production decision for the game (§2) |
| Q17 | Which `Math` functions does the sim swap? | Only those that differ on the platform: `sin`, `cos` and `pow` today. The drift test adds others as runtimes change (§6.5) |

---

## 14. Status ledger

Status is `todo`, `doing`, `done`, `blocked`, or `on demand` (not scheduled until its trigger fires, §9.1; the note records the measurement that fired it). Update the row in the same commit as the work. The Commit column names the WP's last commit on its stage branch and the stage PR (`#n`): `main` holds one squash commit per stage (§11.1), and the PR keeps the WP's commits. Escalation ids go in the notes.

| WP | Title | Lane | Status | Commit | Notes |
|---|---|---|---|---|---|
| 0.1 | Repo constitution, platform, source checkout | T | done | 1b993eb (#2) | Pins as planned (vite 7.3.7 and esbuild 0.28.2 arrive through vitest; esbuild's postinstall denied); setup.sh also resolves both sources; scripts `typecheck` and `test` only (ADR-0014 amendment 1); deferred proof: later shells on Node 24 (WP 0.10) |
| 0.2 | Toolchain, e2e fixture, `x` CLI | T | done | 4660edd (#2) | Pins as planned (vite 7.3.7, @playwright/test 1.64.0, prettier 3.9.9, tsx 4.23.15); scripts `dev`, `build`, `e2e` (`build` has no input until WP 0.8/0.12); harness proves WebGPU on SwiftShader (adapter google/swiftshader, exact pixels; no adapter without the flags), the virtual clock, and source-mapped page errors; `x src` parses setup.sh's constants; clock global renamed `__film` → `__clock`, plus named streams; size came out L (≈1,600 code + 730 test lines); G0 review: a command module that throws on import now writes its X_CRASH report (4aa836a) |
| 0.3 | Dependency qualification, pinned knowledge | T | done | 2d55e11 (#2) | Pins as planned, dates re-read 2026-10-10 (the same as §4.7); x deps split into tools/cmd/deps.ts over tools/lib/deps{,Check,Update}.ts, plus the calls on `typesDeps` (@types/three's @dimforge/rapier3d-compat 0.12.0 and 4 more: recorded, version-pinned, exempt from the age rule), `follows`, pinned docs tied to three's line and the wiki blob, `npm view … time versions dist-tags`, Node listed not installed (ADR-0007 amendment 1); `--update --dry-run` and `--qualify` run online here: nothing to adopt, nothing qualified (Vitest 4 qualifies 2026-10-22, warned by --check from then); TSL wiki 6153b39 taken with git into .cache/three.js.wiki; no escalations |
| 0.4 | ESLint rules, `npm run check` (T0) | T | done | 4660edd (#2) | Pins as planned (eslint 9.39.5, typescript-eslint 8.71.1, eslint-plugin-jsdoc 61.7.1, globals 16.5.0); `npm run check` measured 6.1 s cold, 4.0 s warm (caches in node_modules/.cache/); families are TS modules in tools/eslint/ (loaded by tsx), each aliasing the core rules it uses under its own name, and Prettier skips hand-written *.md (`.prettierignore`), both ADR-0014 amendment 2 with the bans added beyond Appendix B; public-API (WP 1.6) and ask-the-entry (WP 1.2) are off in eslint.config.js's `SWITCHES`; x check plugins are `export const check` in tools/cmd/*.ts; no-unused-vars allows `_` names and rest siblings; size came out L (≈1,600 code + 1,400 test lines); no escalations; G0 review fixes (4aa836a): namespace imports of three.js allowed (the names banned by syntax), bare Node built-ins, dynamic import() and the whole `performance` global banned sim-side, relative imports resolved before the layer rule matches, the public-API rule covers side-effect imports |
| 0.5 | Test tiers, selection, advice trap | T | done | 5ea7d44 (#2) | tools/lib/tiers.ts for `x ci --local`: `plan()` (base = merge-base with origin/main once its ledger marks a gate row done, else out/ci/last-green, else none and all runs in full; version-only package.json/lock changes select nothing), T1 as `vitest related --run <files>` (its `T1_FULL` triggers are also vite.config.ts's `forceRerunTriggers`), T2 in full on engine/labs/pages/fixtures/data/configs else `npm run e2e -- --only-changed=<base>`, `checkReports` (warn over budget; it failed at 1.5× until ADR-0022), `timingTable`, `recordGreen`; long runs listed in `LONG_RUNS`, no new npm script (§8.1 names none); advice trap: `[AREA_CODE] …` at any level, every console.warn, `THREE.…deprecated`; Vitest hooks install only in Vitest workers (env guard); `harness.advice()` reads provoked advice; both harnesses proven from npm test via tests/setup/fixtures/ (T1 ≈12 s, was ≈8 s); allow list tests/baselines/advice/trap.json (the fixtures' TRAP_LISTED); no escalations; after G9: T2's budget goes by machine size, one worker count for playwright.config.ts and the budget (`t2Workers`, `t2Budget`: 9 min from 16 cores, 60 min on 4, 2–3 workers unmeasured; `x ci --local` takes the cores from its deps, so on 4 cores it runs T2 in full by design), ADR-0022 amendment 2; the budget checks split into tools/lib/tierBudgets.ts (ADR-0014 amendment 16) |
| 0.6 | Docs system | T | done | 2c17c32 (#2) | `x docs` over tools/lib/docs{,Codes,Examples,Generate,Paths}.ts and `x new` with the `module` template; calls in ADR-0015 amendment 1: every export documented (a default export by its file comment), examples run with their module's exports in scope, browser examples flagged (2, no T2 runner yet: deferred; run after G9: flagged by what they need, not their folder, 13 of 411, 12 run by tests/e2e/examples.spec.ts in the box page or in Node processes of their own (in the Playwright worker, film.ts's example registered materials that failed materials.spec.ts in the full T2) and the one left unrun names why, ADR-0015 amendment 4), paths checked in comments, AGENTS.md, README.md and docs/ (decisions included) with not-yet-done WPs' Owns and §6.2's layout counting as planned, `defineCodes('<area>', { AREA_NAME: { template, fix, doc } })` fixed for WP 1.2; 3 examples of WPs 0.3/0.5 made runnable (doc comments only); `x check`'s docs plugin skips examples (`x check` ≈1.7 s, `npm run check` ≈6 s warm); T1 ≈20 s (was ≈12 s); deferred: §8.12's help() check (WP 1.6), `x new --test-all` in `x ci --local` (WP 0.9); size came out L (≈1,500 code + 460 test lines); no escalations |
| 0.7 | Escalations and decisions | T | done | 5247097 (#2) | `x esc` (open, answer, decide, close, list) over tools/lib/escalations.ts, clock injected (`createEscCommand({ now })`) so the test passes the deadline on a virtual clock; calls in ADR-0017 amendment 1: front matter in a YAML subset read without a dependency, `--no-wait` keeps the 15-minute deadline (it changes the message and log), `--why`, `--run` (default `$X_RUN`, the Claude Code session, `local`), `--follow-up`, comma-separated principles, an answer may follow a call; README rewritten by every changing subcommand and by `x esc list --write` (not `x docs`); the `esc` plugin also fails duplicate ids and a stale README, and an overdue record or stale README is a warning in ultracode lanes; size came out M (≈760 code + 300 test lines); no escalations |
| 0.8 | Hello page on WebGPU | T | done | 416c7f1 (#2) | labs/hello/ (boot.ts publishes `__engine` with `ready`, `errors`, a minimal `info()`, and loads hello.ts by dynamic import, so a load failure also shows as page text; `?post=0` draws without the post pass) over engine/gfx/renderer.ts (`createRenderer`, `requestWebGPU`, `GfxError`); calls: the engine requests the adapter and a device with every adapter feature and hands the device to `WebGPURenderer`, so three.js's WebGL 2 fallback never runs and `_getFallback` (banned outside pipelines.ts) is never touched; `GFX_NO_WEBGPU` registered through a local `defineCodes` stand-in that WP 1.2 replaces (docs/ERRORS.md lists it); `x shot <page>` screenshots the first canvas to out/shot/<page>/frame.png with metrics (coverage, luma P5/P95, dark/blown, colours, histogram), exit 1 if blank, on a free port of its own (`startVite()` without a port falls back to Vite's strict 5173); hello.spec.ts: WebGPU asserted, frames not blank with and without the post pass (graded frame warmer, same coverage), no console warning on SwiftShader (no advice baseline needed), the alias proven on a three.js addon's bare `three` (a bare `three` in scanned page source gets its own optimizer entry: the same chunk, another module record), the startup test in its own Chromium with `args: []` (Playwright Test merges the project's WEBGPU_FLAGS into a bare `launch()`), a load failure shown as text; size came out M (≈680 code + 340 test lines); no escalations |
| 0.9 | CI (`x ci --local`, Actions when enabled) | T | done | 97b697b (#2) | `x ci --local` (tools/cmd/ci.ts) runs `CI_STEPS`, §8.9's 7 steps in one exported constant for the workflow's test, with each step's output in out/ci/logs/, out/ci/summary.md, out/ci/last-green when green and out/ci/local/report.json; ≈50 s here (npm ci 6–7 s, check 8 s, test 23 s, e2e 6 s); calls: `npm ci` runs under the running process (measured safe from `node x ci --local`: everything is imported before it, later steps are new processes) and keeps node_modules/.cache/ across it (T0 cold after it took 10.6–11.7 s, over its 10 s budget; warm 8 s); after a failed step the rest still run, but a failed `npm ci` skips them; T2 runs in full while its last passing full run (out/ci/t2-full.json) is within budget or none is recorded, else tiers.ts's selection; T1/T2 times from their JSON reports when the step rewrote them, else wall time; `--local` required (exit 2 without), `--long` adds `LONG_RUNS`, a dirty tree warns (CI_DIRTY); deferred proof: the workflow and its test wait for ESC-0001 (Actions and the `workflow` scope), nothing written under .github/ (after G9: ESC-0001 answered yes, .github/workflows/ci.yml runs `node x ci --local` on ubuntu-24.04 and tools/cmd/ci-workflow.test.ts keeps it equal to the platform, its summary in the step summary and the job's log (the first run failed where only the step summary, which GitHub's API does not serve, named the test), ADR-0016 amendment 1; its first green run on PR #14, run 38679570559, 2026-10-15, 72 min, so ESC-0001 is closed and the merge gate is `x ci --local` and the workflow's `ci` check, which is not a required check until the owner sets branch protection, §11.5); size came out M (≈390 code + 320 test lines); ESC-0001 decided in the owner's absence at a8970b0 (record 97b697b): Actions stays off, `x ci --local` is the merge gate |
| 0.10 | Claude Code integration | T | done | 0f91dac (#2) | `.claude/settings.json`: §8.10's allow list (read-only git spelled out, the GitHub server's pull-request tools) and four hooks in `.claude/hooks/`: session-start.sh (setup.sh with its output in out/hooks/session-start.log and node_modules/.cache kept across its npm ci; Node 24's PATH first, MY3D2DGE_SRC and SHARDFALL_SRC in $CLAUDE_ENV_FILE, which closes WP 0.1's deferred proof; `x src`, `x esc list --open`, `x deps --update --dry-run`; ≤ 20 lines, always exit 0, ≈10.5 s here with npm ci), pre-tool-use.ts (DOCTRINE.md → ask, Bash writes included; hand edits under out/ and node_modules/, force-pushing or deleting main → deny), post-tool-use.ts (Prettier, then ESLint with the check's cache: errors exit 2 naming the fix, warnings as context), stop.ts (`npm run check`, blocks once, `stop_hook_active` → owner warning only; overdue escalations through `isOverdue`); skills x-loop, three-webgpu, escalation; subagents verifier (§11.3's prompt, JSON verdict) and visual-reviewer; calls in ADR-0014 amendment 4 (TS hooks on Node's built-in type stripping, no dependency); 26 tests in tests/unit/hooks/ against fixture projects and a fixture $CLAUDE_ENV_FILE (T1 ≈28 s, was ≈23 s); deferred proof: a fresh cloud session starts clean and both subagents load (checked at G0); size M (≈720 code and settings, ≈240 skill and agent lines, ≈700 test lines); no escalations |
| 0.11 | Port reference vectors | T | done | eafdf7a (#2) | `x port refs` (tools/cmd/port.ts) writes 8 text files, 3.55 MB, to tests/baselines/port/ from my-3d2dge@e37e4ee in a `vm` (only `console` shimmed; any message fails): core.json, color.json, humanoid-{chibi,heroic,bulky}.json (18 states × 8 facings, 120 steps of 1/120 s, `t0` per run), moves.json (24 moves × 3 phases × u = i/20 × the 3 builds, plus the right foot), blob.json (3 scripts), a generated README and checksums.json (sha256), checked offline by `--check` and a new `port` plugin of `x check`; calls: numbers exact (shortest round-trip, `-0` kept); sampling reduced to every 4th step at facing 0 and every 40th at the other facings, which share facing 0's seed and so differ only by the turn (≤ 4e-14 units); `Math.random` = `E.rng(fnv1a(record id))`, throwing until seeded; the move preview is the rest pose at t = 0, then one update of dt = 1 (saturates the smoothing); walk 40, run 80, dash 260 u/s, air at z = 12, climb at 32 u/s, stances while walking; Prettier skips the directory (one line in .prettierignore, ADR-0014 amendment 3); size M (≈400 code + 150 test lines); no escalations |
| 0.12 | Deploy on Vercel (not tested, ADR-0021) | T | done | 3c7aa94 (#2) | vercel.json, .vercelignore and .gitignore as planned; landing page `index.html` → `labs/hello/` + query + hash, plus a plain link (WP 2.7 retargets it); build entries `index` and `labs/<name>` (`globSync`), `chunkSizeWarningLimit` 8000; the build writes dist/index.html, dist/labs/hello/index.html and 2 scripts (three.js 784 KB), no .wasm, nothing from tests/; nothing else checked (ADR-0021); README: Deploying, Status and toolchain lines current; `x deps --update --dry-run` found prettier 3.9.10 (2026-10-10), left to the integrator; no escalations |
| **G0** | **Gate: foundation** | | done | 4660edd (#2) | x ci --local green at 4660edd (54 s: check 6.3 s of 10, test 30.7 s of 60, 499 tests, e2e 6.6 s of 6 min with harness, hello and the startup test; x port refs --check, x new --test-all); verifier reviewed Phase 0 (5 failures: namespace-import bans, bare Node built-ins sim-side, x crash reports, ledger, docs) and re-reviewed the fixes (3 more: cold-cache check, missing default export, checkAll tests), all fixed in 4aa836a, 01631e8, 4660edd; T0 now runs its tools in parallel (ADR-0014 amendment 5); no escalation open past its deadline (ESC-0001 decided in absence, awaiting the owner's review); x deps --qualify: nothing qualified; Vercel can import the repository (WP 0.12); deferred: a fresh cloud session with both subagents (the verifier ran as a general-purpose agent following .claude/agents/verifier.md, since agent types load at session start) |
| 1.1 | Math, rng, noise, hash, color | C | done | 680f2af (#3) | engine/core/{math,simMath,rng,noise,hash,color}.ts match the reference vectors bit for bit (rng's 11 seeds × 64, hash2, noise2, every colour helper, and the angle helpers, smoothDamp and ease exactly, stricter than the 1e-12 allowed); drift.spec.ts runs tests/pages/driftProbe.ts in its own Node process and in tests/pages/drift.html: all 35 `Math` functions and `**` on 200,000 seeded inputs each plus edge values, three.js's math classes and a feedback sim, natively and swapped, and the swapped sin/cos/pow result by result (natively sin and cos differ on ≈2.9% of inputs, pow agrees); the fixture without cos fails naming @stdlib/math-base-special-cos; calls: `Color` joins `THREE_MATH` (ADR-0020 amendment 1), `hex` throws CORE_BAD_COLOR where the source drew magenta, codes CORE_NOT_CANONICAL, CORE_BAD_NOISE and CORE_BAD_COLOR through local `defineCodes` stand-ins (WP 1.2 replaces them), the hash is byte-wise FNV-1a 64 (published vectors) with a sorted-key canonical form that takes `toArray()` values, `withSimMath(fn, names)` narrows the swap for the fixture, cell noise searches exactly (5×5 with pruning), fbm octaves get their own seed and offset; size came out L (≈1,110 engine + 310 drift page and probe + 1,000 test lines); no escalations; review fixes (680f2af): the swapped pow defers to the native one on NaN/±0/±Infinity arguments and computes negative bases with |y| ≥ 2^53 as pow(-x, y); `**`/`**=`, destructured Math and aliased swapped functions banned sim-side (ADR-0006 amendment 1); withSimMath throws CORE_SIM_ASYNC on a thenable; rng helpers pinned with uniformity checks; noise digests recorded for 3 kinds × 2D/3D × plain/period/fbm |
| 1.2 | Registry, events, log, settings, schema | C | done | 31848c1 (#3) | engine/core/{log,schema,registry,events,settings}.ts and `x describe`, 62 unit tests plus 8 for the command; calls in ADR-0012 amendment 1: the schema in JSON Schema's words (`description`, `minimum`/`maximum`, per-field `required`, types `function` for hooks and `any`), fallbacks optional (`CORE_NO_ENTRY` without one), duplicate ids are errors, settings are `setting` entries by dotted path with layered scoped overrides and all-or-nothing presets/URLs, sim-side reads through `settings.sim.get` (view settings refused), `x describe` imports the modules that call `def`/`define…` under engine/, labs/, fixtures/; the defineCodes stand-ins of hash, noise, color and gfx/renderer replaced; `SWITCHES.askTheEntry` on, repo passes; ERRORS.md lists 18 codes; size ≈1,730 source lines with comments (over M); not built: §6.6's INDEX row per kind (needs tools/lib/docsGenerate.ts to read `defineKind` statically); no escalations; review fixes (31848c1): warn-once keyed by code + subject (`warnOnce(code, values, subject?)`), advice capped (`maxAdvice` 200); entries stored as deep-frozen copies, `any` objects copied, so setting defaults are frozen; `x describe` finds registrations from syntax and loads them in a child process (60 s limit, DESCRIBE_HUNG); §6.6 kind rows built (tools/lib/docsKinds.ts); generated and cache dirs pass the docs path checks; ADR-0012 amendment 2, ADR-0015 amendment 2 |
| 1.3 | Time | C | done | cd40396 (#3) | engine/core/time.ts (the frame clock: `createClock`, slowdown stack, leaky hit-stop budget, pause and single steps, `createVirtualClock`) and engine/core/timers.ts (`createTimers` with `after`/`every`, per-entity clocks as plain numbers), 34 unit tests; calls in ADR-0005 amendment 1: the module split (deviation), slowdowns and hit-stop shape the step rate and count real seconds from the given timestamps (outside the hash), an integer nanosecond × hz accumulator (random frames at 30/60/75/120/144 Hz give the fixed-step state exactly, step count and alpha checked every frame), the backlog dropped after `time.maxSteps` with `CORE_CLOCK_BEHIND` after 10 such frames, settings `time.hz` (sim) and `time.maxSteps`, `time.scale`, `time.paused`, `time.hitStop.*` (view); codes CORE_NO_TIME, CORE_BAD_TIME, CORE_CLOCK_BEHIND; no escalations; G1 fixes (8995169): Timers tick()/fire() split, so a timer made in any phase fires next step; every() exact in whole millionths of a tick; no golden change; G1 re-review fixes (cd40396): every by firing count (start + n periods, rounded once; 1/7, 1/9, 1/13 s exact), Timers.untick for a step thrown before its timers stage; timer state gains start and firings (my3dge-state/3, my3dge-capture/3, ADR-0006 amendment 5); kernel goldens re-recorded |
| 1.4 | Sim world and canonical state | C | done | ad4d440 (#3) | engine/sim/{world,systems,state,capture}.ts, 35 unit tests; calls in ADR-0006 amendment 2: entities and components as plain objects (registry kind `component`), systems in phases with the WP 1.3 timers' stage before `rules`, spawn/despawn/event queues applied at the boundary (at once between steps), tick constant within a step, hash over a format tag, seed, next id, entities (components by name, fields in declared order), timers, non-view settings, sim RNG states and the physics hook's `state()`; captures are plain data with timer callbacks held beside them (same world only when timers are pending: `SIM_NO_CALLBACKS`), other `time.hz` refused; golden `00e4f01b787914db` (demo, step 300); 5,000 entities: step ≈1 ms, hash ≈10 ms, capture ≈3 ms, restore ≈15 ms (Node); 8 codes SIM_*; size ≈1,150 source lines with comments (M/L border); no escalations; review fixes (ad4d440): plain-data components with defaults required, name/declared order kept and checked (entities.ts), hz hashed and captured (golden fdae537c20bfa5c0), listeners and systems captured, foreign restores must match schedule/settings/fields, Object.is seeds, RNG fast names and entity index (step 30→3 ms, despawn 6.6→0.4 ms at 5,000), events without emit, frozen intents; ADR-0006 amendment 3; core events.ts and rng.ts extended |
| 1.5 | Intents, scenes, replays, `x sim`, `x replay` | C | done | 1115f46 (#3) | engine/input/intents.ts (move, cam, aim, look, b, p, `game:key` custom keys; `fromCamera`; the change-point encoding), engine/sim/scene.ts (kind `scene`, `startScene`, and the recorder `createSession`), engine/sim/replay.ts (format, checks, player, `judgeRuns`, `firstDifference`, `partingOf`), `x sim`, `x replay` (`--update`, `--browser sim`, `--bisect`, plus `--runs` and `--swap`), `x perf` (Node medians, tests/baselines/perf/kernel.json), fixtures/scenes/kernel/, tests/replays/kernel-{movers,crowd}.replay.json (goldens in Node ×3 and Chromium ×3; with `--swap none` Node and Chromium part at step 0 and after step 6), tests/pages/replay.{html,ts}, the determinism-debugging skill; calls in ADR-0006 amendment 4 (scene `description` and `actions`, the session in scene.ts, hashes before the inputs of their step, `--bisect` names only a checkpoint window when every run agrees but the goldens differ); shared edit: tests/unit/hooks/settings.test.ts lists the new skill; kernel fixture imports engine modules until WP 1.6; size came out L (≈1,950 code + 920 test lines); no escalations; review fixes (1115f46): setting changes made through the session's store recorded, all-or-nothing dev actions, goldens must cover steps 0 and the last with checked platform keys, `--update` needs `--browser sim` and writes only when every file and the page pass, bisect inside each failure, perf budgets keyed to scene and steps |
| 1.6 | Headless app and inspector core | C | done | 48b5ad6 (#3) | engine/app/headless.ts (`createHeadless`, async; `headlessHost` for tools), engine/dev/{inspector,members}.ts (kind `inspectorMember`: help, args as a schema in call order, impl, `needs`, `value`; 18 core members; codes DEV_BAD_ARGS, DEV_NO_RENDERER, APP_NOT_HEADLESS), engine/{index,sim-api}.ts, `x sim` through `createHeadless` (kernel hash unchanged, 9bfff513ce92f0ec), the help() check in `x docs --check` and T1 (not in `x check`: +0.4 s pushed its smoke test past 5 s), every setting set typed and as text through `__engine.set` (test); public-API rule on plus G0's follow-ups (barrel layer edges, resolving `public-api/no-unnamed-imports`, `banned/no-namespace-names`, sim-side `Buffer`); calls in ADR-0014 amendment 6 and ADR-0020 amendment 2; Owns gained engine/dev/members.ts (400-line cap); note for WP 3.3: `def('inspectorMember', …)` from engine/input/devices/ needs engine/dev/members.ts loaded first (app imports it first), else move `memberKind` into core; size came out M–L, not S (≈1,110 code lines with comments + 520 test lines); no escalations; G1 fixes (8e0e1f2, 48b5ad6): recorded Session.capture/restore (SIM_FOREIGN_CAPTURE, SIM_EDITED_CAPTURE), members get recordedRun (a read-only world), help() typed as CoreMembers, state() names an unknown component, SIM_BAD_SEED, public-API rule allows the page barrel by its folder and catches TS import types; G1 re-review fixes (cd40396): recordedRun hands frozen copies (get/query, systems.list, inputs); the session records a step only once the world counts it; checkSeed reads -0 as 0 |
| **G1** | **Gate: kernel** | | done | 653dbe6 (#3) | x ci --local green at 653dbe6 (1 min 22 s: check 10.5 s cold after the merge, 3.5 s warm; test 41.1 s of 60, 904 tests; e2e 19.6 s); kernel replays identical ×3 in Node and ×3 in Chromium against one golden set (crowd e82d3715dd7ebf60, movers 123e33f07be4148e); drift test green; x docs --check green; verifier reviews of WPs 1.1, 1.2, 1.4, 1.5 (L) and of the gate (WPs 1.3, 1.6 and the whole), each finding fixed with a failing test first, plus a re-review of the gate fixes; T0/T1 recovered by tool/budgets (9e77042: TypeScript project references with cached builds, browser-driving tests moved to T2; ADR-0014); no escalations; x deps --qualify: nothing new |
| 2.1 | Renderer, capabilities, features, resolution, warm-up | R | done | 056039a | renderer: adapter features and limits in info(), feature registry with downgrade advice (GFX_NO_TIMESTAMPS, GFX_NO_FLOAT32_FILTERING, GFX_SMALL_BUFFERS; gfx.featuresOff), gfx.resolution (pixels/balanced/full), warm-up registry compiling for the real frame target plus a warm frame, pipelines counted at the device (r182 internals only in pipelines.ts, pinned by tests); 0 pipelines after warm-up across resolution switches and the post pass; calls in ADR-0008 amendment 1 (r182 has no renderer.onError: GPU errors via uncapturederror and onDeviceLost; feature template deferred to WP 11.1); no escalations |
| 2.2 | Level compiler (v1) | W | done | e44f5fb | `glyph` kind (legend `. # w P`, spawns `@`, `1`–`9`) and `level` kind; level text = front matter + map; compiled format my3dge-level/1 (ground, colliders with min/max, meshes: pieces and merged rects, spawns, floorHeight/topHeight); golden hashes per fixture; QA family `level` (tools/cmd/qa.test.ts expectation updated); hall 64×44 compiles in ≈2.1 ms; size M–L, covered by the G2 review; no escalations |
| 2.3 | Materials and procedural textures (v1) | R | done | 65e8efe | engine/gfx/textures (the texture kind; flagstone, brick, stone, planks, staves, checker generators; CPU bake with height normals and golden hashes, linear-light mips, seam and period checks) and engine/gfx/materials (the material kind, 8 built-ins, Lambert or Basic when unlit, compile cache with warm-up probes); every generator tiles (worst seam ≈1.1% of 2%) and repeats exactly; page bakes hash as Node's; every material renders with 0 pipelines after warm-up; QA family tex; texture and material templates; seam range = the channel's full range (seams.ts); size L, covered by the G2 review; no escalations |
| 2.4 | Geometry kit and level meshes (v1) | W | done | b987973 (#5) | geometry kit with UVs in metres (box, roundedBox, limb, ramp/wedge, frustum, pillarParts/pillarGeometry, ring), sidesThenTops, mergeGeometries, inspectGeometry; geometry registry kind (7 built-ins, fallback geometry:box) and its template; level meshes (welded floor, instanced blocks in 2 groups, recipes, cells with outward directions, warm-up registration, GFX_LEVEL_RECIPE); QA family geo; room = 13 draw calls with 1 shadow map (budget 20); calls: v1 pillars are plain blocks (WP 4.4 adds plinths/capitals); note for WP 2.7: walls are one InstancedMesh (`level:room/wall`), so the ID pass sees one object unless it colours by instanceIndex; block colour tones repeat per tile (world-space UVs belong to WP 2.3/7.2); no escalations |
| 2.5 | Cameras (v1) | R | done | 1d08d4d | cameras v1: plain-data poses named as three.js names them, classic views (orthographic by default, 330 lines) with the height boost (within 1% of the 2D engine in all 5 views), orbit, fly, fixed, cam=/cam3= codes that round-trip, createCamera(code, {from}); GFX_BAD_CAMERA_CODE, GFX_UNKNOWN_CAMERA, GFX_BAD_CAMERA; box proof (switching, 0 pipelines) in WP 2.7; no escalations |
| 2.6 | Shots, ID pass, `x shot` | T | done | 08b2d95 | engine/gfx/{shot,idpass,lookMetrics,thumbnail}.ts and x shot (--scene, --cam, --set, --ids, --metrics, --marks, --png, --thumb case [--update]); the ID pass reports every drawable (visible, or unseen: hidden/outside/covered) with 0 stray pixels; thumbnails and metrics identical over 3 loads; 48×27 readback exact (padding stripped); a shot builds its own pipelines once (ShotResult.built); r182's output pass target restored after a shot; baseline thumbs/shot-objects.json; size M–L, covered by the G2 review; no escalations |
| 2.7 | Box 1: the box app | B | done | 43d4b7b (#5) | createEngine with the §6.4 loop and ?scene/?cam/?seed/?set/?replay routes, the box page and room scene with three movers, rendering members (ready, render, shot, camera, scene.dump, replay), createHeadless({ view: true }), x set/eval/dump/inspect, x replay --browser page, parity.spec.ts, box-1 replays, stress-box skill, scene template; a restore or a dev action through __engine now snaps the view to the world (view.restarted()); calls (ADR-0014 amendment 10): Owns widened by view, viewMembers, playback, gfx stage/sceneDump and tools/lib/page.ts, small edits to help.ts/x.test.ts, sim.ts, thumbs README and hooks settings test, APP_NO_VIEW in place of needs:'view'; about 4.7k inserted lines, over L's 2,500; proposals: idpass colouring instanced meshes by instanceIndex, a Node ?raw loader hook in x.js, scene.backgroundNode draws nothing on r182 with the box's camera (a Color sky plus a ground plane used instead); box-1 goldens unchanged after merging WP-3.1's my3dge-state/4 (Node x3 and Chromium page x3 match); no escalations; not verified: x ci --local, full e2e beyond box and parity; verifier: pass after 1 fix round |
| **G2** | **Gate: Box 1** | | done | e3cb94c (#5) | x ci --local green at e3cb94c on a clean tree, first run, no flakes (3 min 42 s: check 6.8 s of 10, test 28.3 s of 60 with 2,048 tests, x new --test-all 36.7 s, e2e 2 min 25 s of 6 min with 56 tests, T2 in full); proven: the room steps headless and in the page to one golden set (box-1-room 600 steps → 1f0611eb795b4970, box-1-tuned → d16b25c94e9f6a8b; Node and Chromium page, 3 runs each), and its hashes hold while it renders, while every camera preset and resolution mode is switched and with every optional GPU feature off; live play recorded in the page replays in Node to the same hashes; the ID pass lists every object from cam iso (floor, wall runs, low wall, pillar, movers) with 0 stray pixels; 0 pipelines built after warm-up across cameras, resolution modes and materials; room level meshes in 13 draw calls (budget 20), the 64 × 44 hall in the same 13; every inspector member works in the page with help() matching and every setting reachable through __engine.set and x set/eval/dump/inspect; calls: Phase 3, lane L (8.1–8.3, 8.10) and lane X (9.1, 9.2, 9.4) WPs that finished before the gate ride in the same PR, each with its own ledger row; verifier review of the gate (WPs 2.2, 2.3, 2.6 and the whole) passed after one fix round (WP-G2-fix-r1, 721bae9: the `feel` member moved to engine/app/feelMember.ts so it registers whatever loads first); x deps --qualify: nothing qualified beyond the pins; no new escalations (ESC-0001 still awaits the owner); open risks: engine/physics/character.ts at 523 lines (over 400, under 600), ID pass sees an InstancedMesh as one object (proposal: colour by instanceIndex; built after G9: each instance has its own ID colour, the shader adding instanceIndex, and its mesh's entry counts the instances it sees, `instances`, names, pixels and boxes unchanged; idmarks.ts split from idpass.ts, ADR-0014 amendment 17), chase/first/rail camera codes not yet known to codes.ts (known after G9: a typo of any of the 12 names the closest, WP 3.9), Vitest 4 qualifies 2026-10-22, steps replay goldens not committed (after G9: tests/replays/steps.replay.json, the fixture test's own run, its goldens agreeing in Node ×3 and Chromium ×3 and checked by its test, WP 3.2) |
| 3.1 | Rapier adapter and queries | P | done | 23401df (#5) | Rapier 0.21 adapter, groups, params, capture, queries, level bodies, QueryView, physics-40 fixture and replay; core change accepted as ADR-0006 amendment 6: hash reads only non-default non-view settings, my3dge-state/4, goldens re-recorded; scenes take physics: true; queries see a body from the next step; presentation reaches the QueryView through queryViewOf(w) until sim.snapshot() exists |
| 3.2 | Character controller | P | done | 05e818b (#5) | engine/physics/{character,feel}.ts (createCharacter, addCharacter, moveCharacter, stepCharacter; steer, settle, the meter), engine/sim/actors.ts (spawnActor, measureFeel), engine/app/feelMember.ts (`__engine.feel`, since gate G2's review; §8.3 row added), fixtures/scenes/steps, x sim --feel; calls: Rapier's autostep, snap and impulses off, steps, snapping and momentum-sharing pushes our own, a grounded move lifted by the skin, flicker workaround not needed (ADR-0020 amendment 3); core change accepted: rapierOf in world.ts; no escalations; no deferred proofs; character.ts split into move.ts at gate G3's review (357 + 271 lines, ADR-0020 amendment 6), WP 2.7 must build its inspector after scene setup, steps replay goldens not committed (after G9: tests/replays/steps.replay.json, the fixture test's own run, its goldens agreeing in Node ×3 and Chromium ×3 and checked by its test, WP 3.2); after G9: the option `shoves` (collision groups its controller passes and its capsule shoves aside; groups.ts `dropGroups`), set by the box's hero for the crowd (ADR-0020 amendment 9) |
| 3.3 | Input devices, bindings, intents | I | done | 2f683a4 (#5) | engine/input/{codes,actionMaps,bindings,script,input}.ts and devices/{keyboard,mouse,gamepad,padScript,virtual,inspector}.ts; intents.ts gained InputBuffer (released, buffered, consume, consumeAll, repeated; 9/18/5 steps); kind actionMap with 4 presets; system layer and RESERVED_CODES; `__engine.input` press, hold, axis, play, record, state (ADR-0014 amendment 9; §8.3 row edited); barrels appended; calls: the system layer and the move actions kept out of b/p, mouse and pad codes named (MouseLeft, PadSouth, PadLeftStickUp), stick directions bound like keys get the radial deadzone; size came out L, not M (≈1,870 code + 1,210 test lines); no escalations; open: headless step(n) should take the virtual device's intents (core proposal; done after G9: createHeadless loads the input members, and step(n) with no intents takes what the virtual device holds each step, headless.test.ts), WP 2.7 createEngine must load engine/dev/members before devices/inspector.ts, call connectVirtualDevice and sample once per frame (p on the first step only), WP 10.6 system-layer actions never enter intents (noted in WP 10.6's Build after G9); not verified: physical pads, non-standard mappings, non-Chromium pointer lock; deferred proof: in the box, WP 3.10; re-run lane (2026-10-10) only re-checked integration 5ee52bf: input unit 53/53, e2e 8/8, check, full suite 1758/1758 pass, no new commits |
| 3.4 | Skeleton, builds, pose, FK, sheets | A | done | 043b1b7 (#5) | engine/anim/{skeleton,builds,pose,fk,sheet,check}.ts (root plus 23 joints, 8 sockets, a T-pose rest; registry kind `build`; Pose with flat float32 storage; slerp/nlerp, bone masks, additive layers; FK in doubles; SVG sheets, rest-sheet golden 8f7539de0bbc1301; animCheck), the scaffold tools/templates/build, an Animation area in sim-api.ts; calls in ADR-0009 amendment 1: animSheet/animCheck as flat names, old footL = the sole (foot joint `ankleHeight` above it; WP 3.6 compares at contact height), hipZ → hipHeight, headR → headRadius, builds carry the stance and gait fields for WP 3.6, new fields ankleHeight, footLength, handLength, chestDepth with chosen defaults (review in WP 3.8), no `skeleton` kind until a second skeleton exists; codes ANIM_UNKNOWN_JOINT, ANIM_BAD_MASK, ANIM_UNKNOWN_POINT; no escalations; deferred proof: in the box, WP 3.10; duplicate dispatch re-verified on integration 5ee52bf, no new commits |
| 3.5 | IK | A | done | 5f656de (#5) | engine/anim/ik.ts (twoBone = ik3 bit-exact in metres, with a unit fallback for a pole along the limb; twoBoneRot in model space with hinge knees/elbows, a world-direction pole defaulting to the current bend, offset/rotation options; aim over chest/neck/head with limits; footPlant with downward-ray probe, pelvis drop, normal alignment, stance lock; handTo to the weapon socket), 19 sim-api exports; calls in ADR-0009 amendment 2: no per-solver weight (fade with blendPoses), a non-limb joint raises ANIM_UNKNOWN_JOINT, new code ANIM_BAD_TARGET; no escalations; open: footPlant probes only under the contact point, assumes uniform root scale (after G9: moved to engine/anim/footPlant.ts with its layer, keeping the heel and toe tip above the ground, ADR-0009 amendment 8); deferred proof: in the box, WP 3.10 |
| 3.6 | Humanoid procedural port | A | done | c589884 (#5) | engine/anim/{authoring,locomotion,poses,humanoid}.ts (B(f,r,u), turnRight, spine/arm/leg/blade solvers through twoBoneRot; GAIT table; POSES/STANCES/WEAPONS, ordered FOOT/HAND/BLADE layer tables; step = sim state, solve = effectors + solve, knockdown as root turn), 20 sim-api exports; differential mean 0.7-0.8 mm, worst 2.0 cm, EXCEPTIONS empty; calls in ADR-0009 amendment 3: moves' arm and kick paths go to WP 6.1, squash, hair and cape to WP 6.2 (input.body slot); new code ANIM_UNKNOWN_POSE; integration call: anim `Side` renamed `LimbSide` (WP 4.2 exports a level `Side`); no escalations; deferred: floor sinks of kneel/crouch/dash/guard feet (authoring.test.ts KNOWN) to WP 3.7 foot plant and the WP 6.6 QA (after G9: built, engine/anim/footPlant.ts, ADR-0009 amendment 8: 0 through an animator with it), solve-stage performance not measured; in the box, WP 3.10; verifier: pass after 0 fix rounds |
| 3.7 | Character animator and body states | A | done | 226f484 (#6) | Animator (sim step, view pose, preciseHits sim posing, footsteps, sockets, trail, layers faded by weight, 4 LODs, inspect JSON), body-state vocabulary with suggestions, stack and weight tables (bit for bit against the humanoid), actor component `animator`; calls in ADR-0009 amendment 4: names Animator/AnimatorInput, slot tables in weights.ts, separate component, post-IK slot empty (core proposal: footPlant `floor`); new codes ANIM_UNKNOWN_STATE, ANIM_BAD_STATE, ANIM_BAD_LAYER; integration: actors.ts conflict with G2's feel move resolved (no registerFeel); no escalations; deferred: post-IK foot plant and KNOWN floor sinks (after G9: built, engine/anim/footPlant.ts, ADR-0009 amendment 8), `__engine.anim(id)` member and box exercise to WP 3.10, Node/Chromium parity of preciseHits trails (recorded after G9: box-5-precise, box-5-fight's inputs with box.fight.precise on, its goldens agreeing in Node ×3 and Chromium ×3 and in the rendering page ×3) |
| 3.8 | Instancing service and puppets | R | done | ce0a00a (#6) | WP-3.8 review round 2 (ce0a00a): instancing page later layers now magenta colour × yellow tint so a missing colour (yellow) or tint (black) fails, mutation-checked; puppets page/spec draw body:everyPart rigid-skinned and instanced, every unit-shape batch seen by the ID pass, no pipeline after warm-up, mutation-checked; everyPart file comment corrected; no calls beyond these, no escalations, no new advice codes; integration: engine/index.ts barrel conflict with WP 3.12/4.4 exports resolved keeping both; not verified in the lane: full T2 (only instancing and puppets specs); verifier: pass after 2 fix rounds |
| 3.9 | Cameras (v2): chase, first person, rail | R | done | cbe12c6 (#5) | engine/gfx/cameras/{chase,first,rail}.ts: chase as a spring arm whose ball casts go through the QueryView (in at once, back out over 0.3 s; 0 bad frames over 2400 in chase-walls), first person at the eye sockets' midpoint with nearBodyCull (hides all but the hands plus any part within 0.3 m of the eye), the depth rail keeping the hero in a near/far band; cam3=chase/first/rail codes round-trip; fixture chase-walls; calls made: codes live in the camera modules, not codes.ts, so parseCameraCode/createCamera do not yet know the three (closed after G9: place.ts's readCameraCode and createCamera read the three; codes.ts's errors name all 12, so cam3=chasee finds chase, and codes.test.ts moved from 9 to 12 names), ~850 source lines, over S's 300; no escalations; deferred proofs: ID-pass camera suite (WP 3.10), no box check names the rail |
| 3.10 | Box 2: a hero in the box | B | done | e1a26ab (#6) | labs/box/cast/hero.ts (stress-test values → SI: apex 1.465 m, dash 3.25 m), scene box:room-hero (+ box.roomHero.speed/jump/dash), touchlayout:box (jump, dash, no menu), 3 box-2 replays, parity per stage; core proposal accepted (bd71daa, ADR-0008 amendment 4): animated actors draw as humanoid puppets, view follows player, chase/first/rail via createCamera, first-person culling, cutaway when following a player; calls: room text copied into room-hero.ts and held to the file by a test, no menu button; no escalations; known limits: chase at step 0 starts outside the wall (cutaway hides it), parts hidden in first person cast no shadow, one skinned mesh per animated actor until WP 5.4; not verified: touch (ADR-0021); WP 3.7's handoffs: `__engine.anim(id)` delivered at gate G3's review (engine/app/animMember.ts); open: the post-IK foot plant (core proposal: ik.ts's footPlant takes a `floor`) and its KNOWN floor sinks → WP 6.2 (its floor probe fills the post slot), proven by WP 6.6's feet-at-or-above-ground check (after G9: built, engine/anim/footPlant.ts, ADR-0009 amendment 8: `floor` taken, the layer last in the post slot, 29 underFloor entries stale); Node/Chromium parity of preciseHits trails → WP 6.1 (its weapon sweeps are the first preciseHits users), proven by Box 5's replays (WP 6.7) in Node and Chromium (recorded after G9: box-5-precise, box-5-fight's inputs with box.fight.precise on, its goldens agreeing in Node ×3 and Chromium ×3 and in the rendering page ×3) |
| 3.11 | Film and visual comparison | T | done | 4ef12f6 (#6) | x film (tools/cmd/film.ts) films a page from a step script over __engine.input/step/camera/set; writes a labelled contact sheet drawn in Node (3×5 font), film.json and --thumb baselines; --compare <ref> films the ref in a temporary git worktree and attributes each differing pixel through the ID pass; calls (ADR-0014 amendment 11): an empty --compare means HEAD, a ref whose page lacks a member the steps call gives no baseline, sim-step DSL instead of wall-clock waits; core change accepted: box-readme.test.ts fixture's missing command now misspells film (merged with WP-4.2's crypt.txt, 8 problems); no escalations; deferred: none; film.ts split at gate G3's review into tools/lib/filmCompare.ts (comparison, verdict, thumbnails) and tools/lib/filmSheet.ts (contact sheet, font); film.ts 351 lines; not verified: a base whose node_modules pins differ (the worktree links this tree's node_modules) |
| 3.12 | Touch controls (not tested, ADR-0021) | I | done | 1d2525c (#5) | Built, not tested (ADR-0021): the touch device (stick, touch:<action> codes, taps and holds, touch mode with the `touch` setting); the ui layer, swipe and chrome; touch.css and the manifest; gfx/quality.ts (`quality` setting) with resolution pixel caps and the portrait lens; the 60 fps cap; createEngine's touchLayout and onMenu; calls (ADR-0021 amendment 1): buttons can take `hold`; page conventions data-panel, data-keyboard, data-stats, data-hud; timing uses frame timestamps; box.spec now covers WP 3.2's `feel`; escalations: none; deferred: the box layout (WP 3.10) and checks on a real phone |
| **G3** | **Gate: Box 2** | | done | 8e01167 (#6) | Closed with gate G4 in one PR (#6): Box 2 never had a PR of its own, so its work rides with Box 3, and the green x ci --local at 8e01167 (G4's row) covers it (box-2-walk/jump/dash replays and parity in T2). Gate review round 2: x ci --local was red twice at 4bf77e3 under load from 6 lanes (load average 26–35). Run 1: T1 failed when tools/cmd/check.test.ts's spawned x check hit Vitest's 30 s timeout (it passes alone, 17/17 in 11.4 s); T0 took 10.5 s against 10 s and T2 6 min 17 s against 6 min. Run 2: T0 took 12.1 s and T2 9 min 21 s, at least 1.5× its 6 minutes. T2's cause was scheduling: parity.spec.ts (443 s) ran in order on one worker. It now runs in parallel (WP-G3-fix-r2), with the 4-worker T2 modelled at 4.4–4.6 min under the same load. T0's overrun is load only and is recorded, not fixed. Friction item 9 (template comments past 120 columns once filled in) is fixed: x new rewraps them, and new.test.ts holds every template to 120 columns. Follow-ups (G3f): T1 asserts no wall-clock time (e219783). perf.test.ts shows the kernel against kernel.json without --budget, and `node x perf fixtures/scenes/kernel --budget` joins LONG_RUNS. --budget's verdicts are still proven on budgets that every run meets (1000) or misses (0). The ladder test counts the agents each session starts with, instead of comparing hash timings. tools/x.ts's CHILD_TIMEOUT_MS (120 s) is the timeout of each T1 test that waits on a child command (x check/help/deps/qa/esc/src, describe's lister, Vitest, npx, x new), and of that child. The audio QA's 5 s is counted in CPU time. The kernel-replays test was narrowed at 33ff0ee. Dry-run friction: 1 variant defined, 2 INDEX Start here, 3 cut output kept in output.txt, 4 describe ids first, 5 x sim in one folder, 6 one golden sequence, 7 box-<stage>-<name> pattern written down, 8 x new prints next, 10 AGENTS step 4 pointers, 12 and 13 PROGRESS/TESTING/skills linked, 16 main.ts sentence: all 33ff0ee; 9 e6f8be8; 11 each parity test annotates the replays it played (23b5507); 14 the 13.9 s was a new worktree filling its caches (13.9 s cold, 5.8 s warm), now said in AGENTS.md and checkAll.ts (9a70598), and the max-lines warnings stay (the 400-line soft limit; the files are listed in PROGRESS); 15 the warning comes from ~/.npmrc, and AGENTS.md now says it is expected (9a70598). |
| G3f | Gate G3 follow-ups: wall-clock tests and the dry run's friction | T | done | 23b5507 (#8) | T1 asserts no wall-clock time (kernel perf budget -> LONG_RUNS; CHILD_TIMEOUT_MS 120 s for child-command tests; audio QA timed in CPU time; ladder counts agents). Dry-run items 11, 14, 15 fixed, the other 13 were already fixed. Not run: x ci --long. No escalations. Open: describe.test.ts's 3 s hung-module test and world.test.ts's 5,000-entity ratio still depend on wall-clock time (neither seen failing; closed after G9, CLEANUP 6.5: both count instead of timing, and library.test.ts too). |
| 4.1 | Bodies and props physics | P | done | 8a097e9 (#6) | engine/physics/bodies.ts (props, torque impulses and the knock, velocity-driven movers, sensors and triggers, the lost-body rescue), fixtures/scenes/physics-props, physics-props replay; kinematic floors carry riders by their own step at the feet (core change accepted, ADR-0020 amendment 5): the rise is added after the controller move unchecked, the sink through a controller move that leaves the floor out; riders stay within 0.3 mm and grounded every tick on lifts up to 5 m/s and turns up to 3 rad/s, and a rider overhanging a ledge stays on it; calls: no upward cast (a ceiling crushes either way), the sink is cast so a ledge holds the rider; goldens unchanged by the review fixes; escalations: none; deferred: the sink path is checked in Node only (no replay rides a vertical mover; closed after G9: physics-props' setting props.lift, off by default, rides a lift 2 m up and down, tests/replays/physics-props-lift.replay.json, its goldens agreeing in Node ×3 and Chromium ×3); character.ts's 593 lines split into move.ts at gate G3's review (ADR-0020 amendment 6); core review: accepted after 1 fix round |
| 4.2 | Level compiler (v2): the hall | W | done | 29a6370 (#5) | v2 glyphs = ^ o t (gallery 1 m, ramp stairs rising toward their gallery, octagonal dais, brazier cylinder plus torch spot); floorHeight/topHeight/surfaceAt; hull and cylinder descriptors; LEVEL_BAD_RAMP and LEVEL_BAD_DAIS; one-way reach checked along each step (walk.ts); labs/box/levels/hall.txt; calls: mesh bottom 0 for box/hull glyphs, geo-QA exceptions for level:hall in qa-geo-hall.json until WP 4.4, fixture goldens re-recorded (only new fields); core proposal accepted: hull shape in engine/physics (ADR-0020 amendment 4), hall hulls probed within 1 cm; no escalations; deferred: hall drawn in WP 4.4; not verified: hull determinism in Chromium beyond physics-40 (covered after G9: box-3-climb and box-3-dais, the hall's hulls, give their goldens in Chromium in T2's parity) |
| 4.3 | Navigation and spatial queries | W | done | 09984a3 (#6) | engine/world/nav.ts: NavGrid with 8 steps under a climb limit (crowd's NAV_CLIMB or the hero's reach), A* with octile estimate, line-of-sight smoothing and index ties, LRU-cached multi-goal flow fields with reach, 3-tile look-ahead; engine/world/spatial.ts: typed-array SpatialHash with query and nearest; fixtures/scenes/nav-1000 with budget (step 6 ms); x sim --map writes out/sim/<id>/map.txt; calls: corner rule covers ledges, lineOfSight keeps a 0.3 m body radius, hash query-into-Int32Array plus nearest, hall.txt copied into hall.ts with a drift test, --map climb from --feel's reach; no escalations; no deferred proofs; not verified: nav-1000 determinism in Chromium (closed after G9: tests/replays/nav-1000.replay.json, findPath and the flow field over 300 steps, its goldens agreeing in Node ×3 and Chromium ×3) |
| 4.4 | Level meshes (v2) and cutaway | R | done | f18c133 (#6) | v2 level shapes in engine/gfx/level: pillar (plinth, shaft, capital), slab (gallery), stairs (one stepped solid per flight; each tread on the slope at its middle), dais (on the hull's corners plus bare ground at its corners), brazier stands (foot, bowl, glowing coals); recipes gain `cut` (wall 0.4375 m facing, pillar 0.875 m blocking); engine/gfx/cutaway.ts: planCutaway, createCutaway, twins registered with the warm-up; hall = 15 calls, 24 with one shadow map, +8 twins = 32 budget; qa-geo-hall.json records only drawCalls 24; calls: a descriptor's flights share a mesh (stage runs give each flight its own), level draws the brazier stand (WP 4.5 adds flames and torch), cutaway rule geometric for any camera, pages switching projections warm up through both cameras (r182 builds 6 pipelines on the first switch); core proposal accepted: re-recorded box-room-iso thumbnail (ADR-0008 amendment 2); shown in fixture tests/pages/hall.html, box deferred to WP 4.6 (createCutaway on stage meshes, update(pose, hero) per frame); no escalations; not verified: box.spec.ts 'every inspector member' fails on integration before this WP (__engine.feel missing) |
| 4.5 | Props as data | R | done | d8f04ca (#6) | engine/world/props: the `prop` kind (parts, body, light spot, place, hooks hit/use), its 4 entries (crate, barrel, brazier fire, pillar), levelProps/propBody/propPose; engine/gfx/props.ts: one batch per part, flames from fxRng, FLICKER lights, texture:crate and 4 materials; template prop; calls: the brazier prop is the fire only and stands on the level's `t` stand, propBody is plain data and hooks get knock passed in (world may import only core), defineProp's input is named PropDefinition because PropSpec is taken; core proposal accepted: QA families check props (ADR-0012 amendment 3, tools/qa/geo,tex); shown in fixture tests/pages/props.html, box deferred to WP 4.6, the light pool consuming lights() deferred to WP 7.1; no escalations; not verified: full T2 on the lane itself (green on core) |
| 4.6 | Box 3: the hall | B | done | 75d5e18 (#6) | box:hall (hero on the dais, box.hall.speed/jump/dash), replays box-3-climb and box-3-dais, box-hall.spec, box-hall-iso thumbnail, the hall in parity; core proposal accepted (75d5e18, ADR-0008 amendment 5): sceneProp, spawnProp/hitProp/removeProp, the stage draws props instanced, box:hall-props (30 fires, 10-300 seeded crates and barrels, a shove on attack), box-3-knock; calls: the component is named sceneProp, the shove is box gameplay, the known LOOK_LOW_CONTRAST is asserted; no escalations or deferred proofs |
| **G4** | **Gate: Box 3** | | done | 8e01167 (#6) | x ci --local green at 8e01167 on a clean tree, first run, no flakes, at load average 32–42 (6 min 57 s: check 6.2 s of 10, test 23.8 s of 60 with 2,530 tests in 223 files, x new --test-all 44.9 s, e2e 5 min 38 s of 6 min with 114 tests, T2 in full); proven: the hall (64 × 44, v2 glyphs: galleries, stairs, dais, braziers) compiles and validates, every walkable tile reachable and reached by the flow field (nav.test.ts); the hero climbs the west stairs to the gallery (box-3-climb, 600 steps → 4a4ea338b4b83c4c), laps the dais and walks its slope (box-3-dais → 8bcd9a691f2bf040), and pushes and shoves crates and a barrel among 100 seeded props (box-3-knock → 2945f0db612e8abc), each to one golden set in Node and in the rendering page (parity.spec.ts, box-hall.spec.ts); the hall draws in 15 calls (24 with one shadow map, 32 budget with the cutaway twins), 0 pipelines after warm-up; calls: Box 2 (G3) and Box 3 merge as one PR, since G3 had none; Phase 5–7 and lane L/X WPs finished before the gate ride in the same PR with their own rows; verifier review of the gate (WPs 4.1–4.6 and the whole) passed after one fix round (WP-G4-fix-r1, e81eed7: box-hall.spec.ts reads the shoved crate from one play and runs in parallel; 4.6's Commit corrected to 75d5e18); x deps --qualify: nothing qualified beyond the pins; no new escalations (ESC-0001 still awaits the owner); open risks: T2 at 5 min 38 s of its 6 min under load (parity and box-hall now parallel), T0 over 10 s under heavy load at G3 (recorded, not fixed), the files then over 400 lines are split (sim-api.ts's Animation area to engine/anim/api.ts at WP 8.7; the rest after G9, ADR-0014 amendment 16); crowd bodies step only 7–8.5 cm against NAV_CLIMB 0.219 m (WP 5.7; settled after G9: the stairs are a ramp the crowd climbs, ADR-0020 amendment 9), the post-IK foot plant (6.2; built after G9, ADR-0009 amendment 8) and preciseHits parity (6.1; recorded after G9, box-5-precise), Vitest 4 qualifies 2026-10-22 |
| 5.1 | Crowd bodies | P | done | 0f35f38 (#6) | engine/physics/crowd.ts: CROWD_AGENT_FIELDS component, addAgent/removeAgent, setVelocity (accel limit, feet only, flyers in 3D, a sleeping agent stays asleep under 5 cm/s), knockback, launch, killAgent (corpse group), updateCrowd (readback, grounded, corpse brake, corpseTime 1.6 s, corpseCap 300, spawnLimit 25, leaving queue); 20 sim-api exports; fixture crowd-1000 with replay and perf budget (step 12, hash 36, capture 16 ms); calls: gravityScale default 3, knockback adds velocity regardless of mass, rescue reuses rescueLost, Rapier 0.21 sleeps after about 0.5 s (measured); open: the state hash's boolean/string path dominates the hash at 1,000 agents (~75 ms at 5,000, WP 5.7) (closed after G9: the same bytes, cheaper; see WP 5.7's row); box deferred to WP 5.7; no new codes, no escalations, no deferred proofs; not verified: --browser page |
| 5.2 | Steering kit | W | done | 128b159 (#6) | engine/world/steer.ts (seek/arrive, followFlow, approachRing, hover, airTime, hop) and engine/world/ai.ts (attack tokens in a component, ATTACK_TOKENS_FIELDS, take/release/keep/holds with one draw per grant; awareness: canSee, clearSight over the tiles' tops), exports appended to sim-api.ts; fixtures in the tests (the hall, Rapier); calls: sight is a 3D line over level.top, not NavGrid's walk line; lowering the cap takes back the newest grants at the next call; finding for WP 4.3/5.1/5.7: NAV_CLIMB 0.219 m but Rapier crowd bodies step only 7–8.5 cm, so the hall Rapier fixture uses climb 0.06 (WP 5.7 needs a lower crowd climb or a step-up); engine/sim-api.ts's 425 lines: its Animation area moved to engine/anim/api.ts at WP 8.7 (ADR-0020 amendment 8), 376 lines now; not verified: steering in the box (WP 5.7), Chromium runs of the helpers; no escalations; no deferred proofs |
| 5.3 | Blob and floater rigs | A | done | a6da2bc (#6) | engine/anim/{blob,floater}.ts plus tests and 24 sim-api exports; blob: source update ported exactly, width R/sqrt(1+sq) so volume is kept (det = R^3 to 1e-12), minimal skeleton (root, body, eyeL/R, mouth, wingL/R as Matrix4), BLOB_MOVES bite/leap/pounce/spit on BlobLeap plus blobMove and blobMoveTimes; floater: wisp hover, new bank, motes; differential vs WP 0.11 mean 3.7 mm, worst 3.66 cm, 9 EXCEPTIONS from the volume fix; calls: move timings from the lab's jab/slash/overhead/cast, blob reads its own words (body-state mapping left to WP 5.7), slimeParts placement now joints, source `walk` dropped and beat wraps at 2π, floater heading/bank (atan(a/15), max 0.6 rad, smoothDamp 0.2 s)/mote frame new; not verified: crowd-scale performance, Node vs Chromium bit equality (atan2/hypot not swapped; covered after G9: tests/e2e/drift.spec.ts and box-4-chase and box-4-hop's goldens in Chromium); deferred: shown in the box WP 5.7, drawn WP 5.4; no escalations |
| 5.4 | Crowd rendering and pose LOD | R | done | 1b5e7fe (#6) | engine/gfx/puppets/{crowd,lod}.ts and bodies/{blob,floater}.ts with tests, the crowd-render page, scene module and spec, 21 index exports; 5,000 agents (walkers, slimes, wisps) drawn with 0 pipelines built while growing, ball pages 1 to 11, 16/20/46 draw calls at 100/1,000/5,000 against a budget of 64 (33.8M triangles at 5,000), sim hash identical with LOD on/off/undrawn and in Node, all 11 batches seen by the ID pass; humanoids through createPuppetBatches, capes dropped by sharing pieces without strips, LOD bands at 15/30/60/200 m set animator pose level 0-3 and capes, culling by frustum and near; calls: RigBody/RigPart a data format of its own, not a registry kind; halo drawn see-through at 35 % instead of additive; pages of 8,192 instances; draw-call budget 64; rigs draw the same in every band; new codes GFX_CROWD_LOD, GFX_RIG_BODY; not verified: look quality beyond three self-reviewed screenshots, real-GPU performance; deferred: shown in the box WP 5.7, dropping limb end balls far away; no escalations |
| 5.5 | Performance counters and crowd ladder | T | done | dff959a (#6) | engine/dev/stats.ts (stats meter, __engine.stats(): means of the last 60 steps or frames plus the renderer's counts); x perf extended (browser counters, --ladder in Node: 0.51/4.9/22.7 ms per step at 100/1,000/5,000 agents, budget sections with tolerance, out/perf/trend.json); tests/baselines/perf/box-room.json; core proposal accepted (6ccfa51, ADR-0014 amendment 12): world/scene system probe, app meter wiring; calls: means not medians, explicit --agents, budget file named after the scene id; no escalations; gpuMs: WP 11.2 (on demand, §8.3), renderMs CPU only; WP 1.5 kernel budget test flaky under load (0.209 ms vs 0.2); G3f: the kernel's --budget run left T1, where its timing flaked at load 47, for LONG_RUNS (x ci --long). |
| 5.6 | Bot and dev actions | I | done | 6183a6e (#26) | Fired 2026-10-17 by the playground (ADR-0025): the gym's courses and the house need soak runs, and tuning needs teleports and slow motion. Built the registry kind `devAction` and the engine's five, sim-side (engine/sim/devActions.ts, which the session reads after the scene's own actions, so a replay's dev action plays in every host): `god` (the component `invulnerable`, which `damage` respects), `freeze` (the recorded setting `ai.frozen`: the step skips the phase `ai`, and the actors and crowd agents it drives stand), `spawn` (props fanned before the player, on the floor), `travel` (`placeActor`) and `timeScale` (the view setting `time.scale`); an entry changes the sim (`run`, recorded as `dev`), settings, or both, its args checked first, a throw leaving nothing. `__engine.actions.list()`, `.run(name, args)` and `__engine.bot(plan)` (engine/dev/actions.ts), so `x eval` reaches them in a page. The bot (engine/dev/bot.ts): the flow field to each goal, stuck measured along navigation's way (sidesteps, a jump, 5 s held), a watchdog (1 m of walking distance in 6 s), no route; runs to goals, a tour from its own stream and back, a stop condition, a sampled trace, events, and a sweep of seeds as one row for the scene; its sums under the sim's math, its moves on 16 headings. Measured: in the maze fixture it reaches the far corner round four walls in 251 steps, gives up behind a box navigation does not know (3 jumps, `no progress` at step 495) and at once when no route leads (`no route`); two runs agree and replay to their hash; every action unit-tested (engine/dev/actions.test.ts), the recorded ones replayed to the same hash; the three members checked headless and in the page (box.spec.ts). Calls in ADR-0025 amendment 13 (the actions sim-side, settings or sim, freeze and its movers, spawn as props, the bot's member). Files beyond the WP's list: engine/sim/{devActions,session,world,systems,damage}.ts, engine/app/headless.ts, engine/app/viewMembers.test.ts, tests/e2e/box.spec.ts |
| 5.7 | Box 4: a crowd | B | done | 89495b6 (#7) | walker, slime and wisp cast with flow-field and ring steering, hops and hover; box:crowd-100/1000/5000 (box.crowd.count, box.crowd.mix), 25 bodies entering per step; replays box-4-chase and box-4-hop (walkers and slimes reach the west gallery), box-crowd.spec, Box 4 in parity, ladder budgets 2.06/17.8/77.6 ms per step at 100/1,000/5,000, 0 pipelines growing to 5,000; core proposal accepted (ADR-0008 amendment 6): crowdBody and stepCrowdBody (sim), stageCrowd (gfx); calls: rigs step in the sim (ADR-0009), crowd climb 0.06 m (settled after G9: the stairs are a 1:5 ramp the crowd climbs), parity reads each replay's steps, no crowd-1000 page replay; after G9: at 1,000 the crowd blocked the hero at the stairs' foot, closed by the character option `shoves` (his controller passes the crowd, his capsule shoves it aside, as the prototype's HERO_QUERY): box-4-stairs (crowd-1000: he waits 5 s at the foot, then stands on the gallery at step 704; its goldens agree in Node ×3, the sim page ×3 and the rendering page ×3), box-4-chase, box-4-hop and box-5-fight re-recorded, FIGHT_TIMELINE 79 → 77 sounds (ADR-0020 amendment 9); after G9: hashing at 326 ms a hash at 5,000 is gone, the same bytes made cheaper (key and string bytes kept as encoded, `Fnv64.text`; `value`'s visitor made once per hasher; plain data fed and checked in one walk, entities.ts `feedData`, where notData and value walked twice): box:crowd-1000's hash 55.4 → 18.0 ms, 67% faster (one process, old and new interleaved), every replay's goldens unchanged (22 in Node ×3), and a second hash of the same state encodes no text (state.test.ts); not verified: real-GPU performance; no escalations, no deferred proofs |
| **G5** | **Gate: Box 4** | | done | 3cdfb32 (#7) | x ci --local --long green at 3cdfb32 on a clean tree, first run, at load average 19–46 from other lanes (27 min 58 s: check 6.0 s of 10, test 28.6 s of 60 with 2,554 tests in 227 files, x new --test-all 42.5 s, e2e 6 min 28 s with 122 tests, T2 in full; flake hunt 366 of 366 (122 × 3) in 18 min 56 s; crowd ladder within budget); proven: the crowd chases the hero by flow field and ring steering round the pillars and up the west stairs, walkers and slimes reaching the gallery (box-4-chase, 720 steps → 832b86cf9951bc46; box-4-hop, 780 steps → cd0346ec04508aa9), each to one golden set in Node and in the rendering page (parity.spec.ts: drawing every step, the chase through every camera and resolution mode, the hop with the GPU features off; box-crowd.spec.ts); 0 pipelines built as the crowd grows to 5,000, every crowd batch in the ID pass; crowd ladder (box:crowd-1000, 300 steps, medians of 5, Node) step 0.83/8.5/28.5 ms, hash 3.0/40.8/152 ms, capture 0.39/3.6/23.8 ms at 100/1,000/5,000 agents against budgets 4/36/160, 14/130/650, 3/20/125; calls: x ci --local runs with --long at the gate, as ci.ts says (flake hunt and crowd ladder); WPs 6.5, 7.1, 7.2 and lane L/X WPs merged with Box 3 already rode in #6, so #7 carries 5.7 and the gate fixes only; verifier review of the gate passed after one fix round (WP-G5-fix-r1, ed2e1de: Box 4 sweeps each replay once in parity, the longest tests queued first, box-crowd and box-hall read end states without drawing, the crowd ladder joins LONG_RUNS); x deps --qualify: nothing qualified beyond the pins; no new escalations (ESC-0001 decided in the owner's absence, Actions off); open risks: T2 at 6 min 28 s, over its 6 min budget (fails at 9 min) under load 36–46, parity.spec.ts's render tests 133–146 s each are the longest, so the gate keeps selecting T2 in full; the files then over 400 lines are split (sim-api.ts at WP 8.7; the rest after G9, ADR-0014 amendment 16); at 1,000 the crowd blocks the hero at the stairs' foot (he passes it after G9: `shoves`, box-4-stairs, ADR-0020 amendment 9); the state hash dominates the step (152 ms at 5,000; after G9 the same bytes 67% faster, 55.4 → 18.0 ms at crowd-1000, WP 5.7's row); the post-IK foot plant (6.2; built after G9, ADR-0009 amendment 8) and preciseHits parity (6.1; recorded after G9, box-5-precise) open; not verified: real-GPU performance; Vitest 4 qualifies 2026-10-22 |
| 6.1 | Moves, timelines, hits | A | done | fabf4c0 (#8) | engine/anim/{timeline,moves,moves-data,strike}.ts, fixtures/rigs/dummy/, the move template; core proposal accepted (5e5ee9e, ADR-0009 amendment 5): the humanoid plays moves through its body state `body` (HumanoidState.arm), eight hero replays' goldens re-recorded for that state only; round-4 review fix (fabf4c0): Combo.load treats a saved step outside the combo's attacks as idle, as Timeline.load does, instead of throwing a bare TypeError, covered by a timeline.test.ts case loading a 3-hit save into a 2-hit combo; new codes ANIM_BAD_HIT_KEY, ANIM_EMPTY_COMBO, ANIM_NOT_PRECISE; integration: sim-api exports of WP 8.4 and WP 6.1 kept side by side, docs regenerated; no escalations; not verified: T2 (npm run e2e) in the lane; verifier: pass after 2 fix rounds; after G9 (CLEANUP 5.2): the preciseHits parity Box 5 never set is box-5-precise, box-5-fight's inputs with box.fight.precise on, its goldens agreeing in Node ×3 and Chromium ×3 and in the rendering page ×3; the setting box.fight.precise (off by default, so box-5-fight's goldens hold) poses the hero in the sim from his first step, and fight.test.ts checks his trail fills mid-swing |
| 6.2 | Reactions and secondary motion | A | done | d7659d5 (#8) | engine/anim/{secondary,reactions}.ts: Chain (verlet strand, capsules, planes, floor or GroundProbe, ceiling, rest-shape stiffness, teleport reset, fixed 1/120 s inner step), Cape (2 chains, width constraint, back plane), squashScale (volume-preserving root scale), bodyCapsules and the Secondary layer for hair, cape and tail; Reactions (flinch spring as an additive layer; down/die/getUpBack/getUpFront timelines; lyingLayer draws face-down bodies; lyingOf); chains stable at 60/120 Hz, collide with capsules and floor, get-up chosen over 5×12 + 5×3 cases; new code ANIM_BAD_CHAIN; calls made: secondary motion is view-only, flinch and timelines are sim data, tail tuning chosen in the lane, face-down knees straightened and feet pointed; secondary.ts's 586 lines: Chain and Cape split into chain.ts after G9, Owns widened (ADR-0014 amendment 16), sim-only posed bodies lie face up; integration: docs regenerated; no escalations; deferred: shown in the box in WP 7.8 (WP 6.7 did not; moved at gate G6's review, ADR-0018 amendment 1), prone poses and get-up clips to WP 8.4 and WP 10.2; not verified: T2 (no e2e suite named, no page uses these modules); after G9: the post-IK foot plant built here (CLEANUP 5.1): engine/anim/footPlant.ts (moved from ik.ts, `floor` taken, the heel and toe tip kept above the ground) and its `FootPlant` layer, last in the post slot, on the view's puppets (faded under an actor's clips) and the anim QA's humanoids, not on the sim's precise-hit posing; no stance locks (they broke 75 QA entries: the call is ADR-0009 amendment 8); authoring.test.ts's known sinks are 0 through it, 29 underFloor entries stale and removed, 3 moved with reasons |
| 6.3 | Combat helpers | W | done | 662a227 (#8) | Hit queries (cones with height windows, weapon sweeps against hurt capsules), damage with knockback, launches and the corpse group, swept projectiles; `requestHitStop` public, `takeHitStop` host-only (not in sim-api, damage.test.ts guards it); core: `stepped` in engine/app/headless.ts is the one after-step handover (stepOnce, AppRun.stepped for ?replay= playback), host.replay drops its stops (ADR-0005 amendment 2); no escalations; deferred: hit-stop in a live page with real frames and a test for engine.ts's ?replay= `started.stepped()` (WP 6.7; closed by it: box-fight.spec.ts's real-time hit-stops); verifier: pass after review fixes (stale hit-stop after replay, takeHitStop export; 8d907e9, 662a227) |
| 6.4 | Effects | R | done | 1b3470d (#8) | engine/world/telegraphs.ts: `telegraph` kind (arc/ring/line/cone), exact signed gaps (brute-force checked), inTelegraph/nearMiss/coneOf; engine/gfx/fx/{emitters,presets,particles,sprites,decals,ribbons,shake,payload,effects}.ts: `emitter` kind with shardfall's 13 presets, my-3d2dge bits/impact/glints and 8 event effects, CPU pool (4096, drops counted), one premultiplied sprite batch, SDF floor decals in TSL, one ribbon mesh, camera-only shake, createEffects; templates emitter, telegraph; sim hash identical with effects on/off (fx.spec.ts, effects.test.ts), 0 pipelines after warm-up, flood 7 draw calls/12,992 triangles (tests/baselines/perf/fx.json), shown in tests/pages/fx.html; calls: effects read world.events.trace() by seq instead of listening, shardfall's ARPG bursts left out as game content, double-sided transparent fx materials use forceSinglePass; open: `text` particles to WP 6.5 (closed by it: the damage numbers); integration: docs regenerated; no escalations; deferred: shown in the box in WP 6.7 |
| 6.5 | The HTML/CSS overlay and damage numbers | I | done | be166ee (#6) | engine/ui/{overlay,labels,state}.ts: createOverlay({canvas}) roots a DOM layer over the canvas; labels placed with CSS2DRenderer's projection and cull, z-ordered by depth; pooled damage numbers (48) rise 1.1 m over 0.8 s, pop and blink by CSS keyframes on the overlay clock (--ui-age); HUD lines in 6 places, crosshair, ui.state()/uiState; never changes the hash (box-1-room goldens, Node 240 steps); call made: stacked numbers take screen slots one number high, not 0.5 m world offsets; no __engine member; touch rules built, untested (ADR-0021); deferred proof: shown in the box in WP 6.7, which wires createOverlay into createEngine (engine.ui) |
| 6.6 | Animation checks, QA, sheets | A | done | bac08f1 (#8) | engine/anim/check.ts gains stateMatrix/STATE_MATRIX, animCheckBody (every pose, same hash twice, 1/60 vs 1/120 s) and SHEET_CAMERAS; tools/qa/anim.ts adds the anim family (pop, footSlide, underFloor, stretch, reach, nan, jointLimit, loopClosure, twistJump, angleRange, unstableHash, rateDrift), 1.7 s over 24 moves, 10 poses, 2 stances, 10 states, 4 reactions × 4 builds × 2 facings plus blob and floater; tests/baselines/qa-anim.json 62 entries with reasons; x sheet draws a PNG through Chromium with the QA results; calls (ADR-0009 amendment 6): v1 pop thresholds, rate drift beyond one step of the joint's own motion, orthographic sheet cameras fitted at one scale instead of shardfall's back-off; baselined: die-pose step drift, WP 6.2 face-down toes below floor, v1 twist/elbow pops, foot slide pending footPlant (after G9: the plant is built without stance locks, so the footSlide entries wait for a stepping rule, ADR-0009 amendment 8; 29 underFloor entries removed); integration: sim-api exports of WP 6.4 and WP 6.6 kept side by side, docs regenerated; no escalations; deferred: clips WP 8.6, actions WP 8.7, fixture dummy (no skeleton); not verified: T2 (no page code touched) |
| 6.7 | Box 5: combat | B | done | 1ccc31f (#8) | Box 5's fight with bolts, telegraphs, trails, bursts and damage numbers in the page; a frame re-reads the world when gfx.effects changes, so a flying bolt changes hands in that frame; box-room perf re-recorded after WP 7.4's post chain (geometries 17, pipelines 75, 0 after warm-up); core proposal accepted as ADR-0008 amendment 8; full T2 146/146, box-5-fight goldens match in Node and the page; verifier: pass after 2 fix rounds; engine/app/engine.ts's 411 lines: its drawing split into drawing.ts after G9 (ADR-0014 amendment 16); not done: WP 6.2's reactions and secondary motion in the fight (the 6.2 row's deferred proof), moved to WP 7.8 at gate G6's review (ADR-0018 amendment 1) |
| **G6** | **Gate: Box 5** | | done | 5f1663d (#8) | x ci --local green at 5f1663d on a clean tree, first run, at load average 32–76 from other lanes (13 min 45 s: check 9.6 s of 10, test 43.1 s of 60 with 3,168 tests in 283 files, x new --test-all 1 min 38 s, e2e 11 min 10 s with 146 tests, T2 in full, over its 9 min budget (fails at 13 min 30 s), CI_BUDGET advice only); proven: box:fight, the hero with a sword round the dais through 36 walkers, slimes and wisps, kills at least 3 and launches a body more than 1 m up (fight.test.ts), at most 3 foes attacking at once by the attack tokens, every wind-up telegraphed; box-5-fight (600 steps → 2ebb2e561e8755e0) gives one golden set in Node and in the rendering page with bolts, telegraphs, trails, bursts and damage numbers drawn; the hash is the same with effects on and off (fx.spec.ts, effects.test.ts, box-fight in one page); damage numbers checked through DOM queries; the anim QA clean or baselined with reasons (qa-anim.json 62 entries, the library 1,218 clips on 5 builds, qa-anim-library.json 32); fx flood 7 draw calls/12,992 triangles, 0 pipelines after warm-up; slowest e2e tests: parity's render-every-step replays 189 s, the camera and resolution sweeps 82–115 s; calls: verifier review of the gate passed after one fix round (WP-G6-fix-r1, 7b31f7c, 73678bf, 54cc185): the warm-up compiles each way a frame draws (ADR-0008 amendment 9: the hall warms 35 pipelines in about 4 s instead of 566 in 15–19 s), instanced level meshes get 1,024 slots, box-room budgets re-recorded with a reason, x check's asset scan skips files deleted after the listing; T2's budget is 9 min (ADR-0014 amendment 14); WP 6.2's reactions and secondary motion are shown in Box 6, WP 7.8 (ADR-0018 amendment 1); x deps --qualify: nothing qualified beyond the pins; no new escalations (ESC-0001 decided in the owner's absence, Actions off); open risks: T2 at 11 min 10 s, over 9 min, parity.spec.ts most of it, Box 4's replay test near its 240 s timeout at load 85+; engine/app/engine.ts 411, engine/anim/secondary.ts 586, engine/anim/actions.ts 596 lines and the earlier files over 400: all split after G9 (ADR-0014 amendment 16); the post-IK foot plant (6.2; built after G9, ADR-0009 amendment 8) and preciseHits parity (6.1; recorded after G9, box-5-precise) open; not verified: real-GPU performance, touch; Vitest 4 qualifies 2026-10-22 |
| 7.1 | Lights, shadows, atmosphere, sky | R | done | 3d1d317 (#6) | engine/gfx/{lights,shadows,atmosphere,sky}.ts: a fixed pool of 12 point lights (8–16) ranked by distance/priority from the level's light spots, fading at the cut-off, flicker phases from fxRng; shadow budget 2/1/0 by quality tier (casters are the pool's first slots, the sun takes the first where a preset has one); range+height TSL fog node; SkyMesh dome with exposure plus a baked backdrop cylinder; kinds light (light:torch) and sky (sky:hall, sky:daylight); 0 pipelines built while lights reassign, presets never change the hash; shown in tests/pages/lights.html (box wiring is WP 7.8's); calls made on r182 traps: lights added in id order, fog/dome uniforms in renderGroup (docs/THREE-DELTA.md); no escalations; no deferred proofs |
| 7.2 | Materials (v2): toon, outlines, styles | R | done | 1f26ebc (#6) | engine/gfx/materials/{styles,toon,outline}.ts: four styles (lambert, toon, flat, pbr) switched at run time with 0 pipelines built and the hash unchanged; toon as a TSL lighting model (smoothed bands, gated rim) over the MeshToonMaterial+gradient baseline (thumbs materials-v2-toon-{bands,gradient}); outline shells on instanced parts centred within 1 px; shown in tests/pages/materials-v2.html (box wiring is WP 7.8's); calls made (ADR-0008 Amendment 3): style is a style set's view state and bands/rim its uniforms (material schema unchanged), lambert kept as a 4th style, warm-up swaps drawn meshes per style via ~styles/* entries, toon and flat drop the normal map, skinned meshes get no shell; no escalations; no deferred proofs |
| 7.3 | Texture library (v2) | W | done | dfb88c1 (#8) | engine/gfx/textures/generators/{runes,moss,metal,plaster,dirt,grass,water}.ts and {tslNoise,contactShadow}.ts; v2.ts registers the seven after v1 (13 generators per registry); `node x qa tex` writes out/qa/tex/sheet.png (colour, normal, emissive, tiled 2 × 2, row 0 at the panel's bottom, proved by a ramp and grass/staves test); core change accepted (ADR-0020 amendment 7: Owns widens to textures/{v1,v2,texture,texture.test}.ts and tools/qa/tex{,.test}.ts); merge kept WP 4.5's prop texture checks beside the sheet; escalations: none; nothing deferred; not verified: T2 (npm run e2e) after the review fix; verifier: pass after 1 fix round |
| 7.4 | Post-processing | R | done | c9f9dc9 (#8) | One fixed MRT with part flags, every filter a uniform in one composite, bloom and FXAA, looks as data from shardfall's presets; createEngine draws every frame and shot through the chain; core proposal (ADR-0008 amendment 7): props tagged objects and crowd batches characters, one outline group per drawer; look template tools/templates/look/. Calls: one outline group per drawer, template pattern allows camelCase, starter look sets no style. Full T2 137/137; no escalations, no deferred proofs. Closed after G9: outline.color is validated (filters.ts `colorProblem`: hex or a CSS colour name three.js knows, or '' to darken): a look with another is refused when defined, and `post.filters` drops it with the advice GFX_POST_BAD_COLOR (`fixColor`), the line darkening the surface (looks.test.ts, filters.test.ts). verifier: pass after 2 fix rounds |
| 7.5 | Performance governor | I | todo | | Fired 2026-10-17 by the playground (ADR-0025): the playground must hold its frame budget on the owner's hardware with WPs 11.3 and 11.5 on. |
| 7.6 | MCP server | T | todo | | Fired 2026-10-17 by the playground (ADR-0025): the owner's order: an agent playtester drives the playground through MCP. |
| 7.7 | Gallery | I | done | 8407867, 3013e4a (#27) | Fired 2026-10-17 by the playground (ADR-0025): about 40 props and the building materials need visual review. Built the `gallery` field (engine/core/gallery.ts: `galleryField(defaults)`, camera, duration, states, each kind's defaults) on the six kinds that need review, props, materials, emitters, looks, bodies and moves, and in their templates; a body's `build`, the build it is drawn on (the playground's adult, the mannequin's own). The gallery is a scene, `dev:gallery` (engine/dev/galleryScene.ts, sim-side as the bot is): one entry staged in the middle of an empty stage, as play stages it (a prop standing, or hung 1.2 m up without a body; a material on a 1 m cube; a body as a figure with a sword in a sample state, a pose, a stance, walking or running; a move swung once from rest through `Attack`, its blade's trail while it strikes; a look on a set of two props, three swatches and a figure; an emitter burst by the view), restaged between frames through its recorded dev action `show`, so the gallery draws what a game draws. `__engine.gallery.list`, `.frames` and `.shoot` (engine/dev/gallery.ts, galleryShoot.ts) film it, each frame's camera fitted round its subject's bounds (`cam3=fixed`, 35°; a burst's live particles); `node x gallery <kind> [id] [--look id]` lays the frames out labelled on x film's sheet with the ID pass's JSON, failing a frame that shows next to nothing besides the ground (`GALLERY_EMPTY_FRAME`; a burst judged at its fullest frame); deep links `#gallery/<kind>/<id>/<state>` through the app's routes on any page, a wrong kind or id warning with the valid names and the closest (`DEV_GALLERY_UNKNOWN`) and showing the first instead; tests/pages/gallery.html registers every lab's entries. Measured: `node x gallery` on that page: 3 bodies in 24 frames (8 states), 19 props in 76 (four turns), 31 materials, 24 moves in 96 (the ends of the wind-up and the strike, the follow-through's middle and end), 27 emitters in 108, 94 looks, none empty; the props and materials in both playground looks too (76 and 31); tests/e2e/gallery.spec.ts 10 passed and box.spec.ts 9 (the deep link frames the box's chair in the middle; both wrong names; the sized shot through a look's filters; every kind's every entry), at 3013e4a. The review (visual-reviewer, every sheet): passed; the building materials in both looks signed off for WP 13.17; seen and left: the bits' burst low against the floor, snow and rain sparse (sky effects run 0.5 m up an empty stage), the garage door's seams a dot grid in the pixel look, the jab's trail on its fist, fist moves without a trail (by design). Calls: a sized shot through the post chain drew its top-left quarter (three r182's screen nodes read the drawing buffer's size), fixed by drawing at the shot's size (engine/gfx/shot.ts `atSize`), with a test and a spec; a move's hash key leaves out its `gallery` field (engine/anim/strike.ts), so the fight replays keep their goldens; a composite emitter's frames span its longest-lived part's life (`burstLife`); a look's default camera is its own isometric code. Tests: core/gallery, dev/gallery, dev/galleryScene, app/routes, app/viewMembers, gfx/shot, gfx/fx/effects, tools/cmd/gallery. Files beyond Owns: engine/core/gallery.ts, engine/dev/{galleryScene,galleryShoot}.ts, engine/app/{engine,routes,headless}.ts, engine/gfx/{shot,fx/effects,fx/sprites,fx/emitters,materials/material,post/looks,puppets/grammar,puppets/bodies/mannequin}.ts, engine/world/props/prop.ts, engine/anim/{moves-data,strike}.ts, labs/playground/bodies/player.ts, tools/lib/{filmSheet,filmCompare}.ts, tools/eslint/{simSide,layers}.ts, tools/templates/*, tests/pages/gallery.{html,ts}, tests/e2e/{gallery,box}.spec.ts, docs/GAME-GUIDE.md. |
| 7.8 | Box 6: the Stress Box | B | done | 4ba3afc (#9) | Box 6: looks/torch-{lit,toon,cel,pixel,bloom,fxaa} (sky:hall + style/filters), hall floor = its rune bake (level material swap), README demo index, fight-1000/crowd-5000 ladders within budget (box-fight-1000.json, box-crowd-5000.json; fight ladder added to LONG_RUNS); core proposal accepted (ADR-0008 amendment 10): look.sky, engine/gfx/stageSky.ts, engine/app/look.ts, the style set in createEngine, level `materials`, chain warm-frame fix; box-hall-iso thumbs re-recorded (floor bake); calls: toon ink = composite edge outline, not shells; no box-6 replay (looks are view state); budget files named per scene; parity looks on hall-props; x ci --local red only on T2's budget (19.5 min at load 40-70 from 6 lanes, 147/147 green); after G9: box-look.spec.ts is one test per look (8 tests, each with its own time limit; all 8 passed on their first try in x ci --local at 1e5d6dd, 12.8 to 109.9 s each, out/e2e/report.json), x shot takes --ready-ms (how long the page has to signal ready, 30 s by default; its whole-number parser, `wholeFlag`, moved to tools/x.ts, since importing tools/cmd/sim.ts for it loaded the view into the Playwright worker through hello.spec.ts's `frameMetrics` import, and the view's materials failed materials.spec.ts in the full T2), engine.ts 422 and parity.spec.ts 440 lines split (drawing.ts, parity-stages.ts: ADR-0014 amendment 16); not verified: real-GPU cost; no escalations; built at gate G7's review (lane gatefix-G7-r1, ADR-0018 amendment 2): engine/sim/reactions.ts (components `reactions`, hashed, and `secondary`; reactTo, stepReactions; actors.anim steps an actor's reactions; ActorSpec.components), engine/gfx/puppets/actors.ts view-side Reactions and Secondary layers with engine/gfx/puppets/chains.ts (actor#1/cape in the ID pass, counted as the hero's); the fight's blows flinch, knock walkers down to get up the way they lie and fell the slain, the hero spawns with his reactions and cape; box-5-fight's goldens and FIGHT_TIMELINE (81 → 79 sounds) re-recorded with that reason; proved by fight.test.ts, actors.test.ts, chains.test.ts, reactions.test.ts, box-fight.spec.ts; the cape is a sim component only the view draws, and crowd walkers show knockdowns, not the flinch lean (their batches run no view layers): both accepted by the owner, 2026-10-14 (ADR-0018 amendment 3) |
| **G7** | **Gate: the Stress Box (foundation)** | | done | 4af3816 (#9) | x ci --local green at 4af3816 on a clean tree, first run, at load average 16-31 from other lanes (10 min 54 s: check 5.9 s of 10, test 30.1 s of 60 with 3,262 tests in 301 files, x new --test-all 50.3 s, e2e 9 min 25 s with 164 tests, 0 flaky; T2 over its 9 min, a CI_BUDGET warning only, ADR-0022; T2 ran in full as engine/anim/api.ts changed); `node x deps --qualify`: no line has qualified beyond the pins (0 upgrades; Vitest 4 qualifies 2026-10-22). Proven: the box does the stress test's job (the hall, the hero, crowds to 5,000, props, combat with reactions and the cape, effects, cameras, looks torch-lit/toon/cel/pixel/bloom/FXAA with 0 pipelines after warm-up and box-3-knock's goldens kept; clip mode and sound from lanes L and X); Gates G0-G6 hold (all of T0-T2 green); every on-demand row (7.5-7.7 and later phases) is still `on demand`. Benchmark (x perf --ladder, 300 steps, medians, within tests/baselines/perf/box-{fight-1000,crowd-5000}.json): fight step 1.74 / 13.4 / 50.8 ms at 100 / 1,000 / 5,000, hash 7.6 / 79.5 / 410 ms; crowd step 0.94 / 9.95 / 50.5 ms, hash 3.4 / 54.6 / 294 ms; the review's `x ci --local --long` green at c30b552 in 51 min 27 s (flake hunt 477/477, ladders, clip QA, box clips). Verifier: review rounds 1-2 passed (gate-G7-r1..r3). Dry-run friction (16 items): 1 the scene template cites `x sim <id>.ts` and x new's docs check runs the path check (2450217); 2 README "Adding a prop" steps 3-4 (physics, addLevelBodies, spawnProp) (2450217); 3 spawnProp/PropPlacement name their fields in API.md (2450217); 4 README step 2 and the skill's Layout row: the page reaches labs/box/props/ only through a scene's import (2450217, ff5c618); 5 x qa counts what it checked, and an --only that keeps nothing is X_USAGE with the closest ids (2450217); 6 x describe kind:name and bare names; the cut line names describe.json (2450217, 6c31cb4); 7 tests/replays/README.md "Coordinates and inputs" (move is world [x, z], +Z south; intents.ts's keys listed) (2450217); 8 x replay --state / --until n (tools/lib/replayState.ts) (2450217); 9 README step 2: <stage> is the stage the scene proves, else the highest box-<n>- and out of STAGES (2450217, ff5c618); 10 README's demo index says box-look runs on hall-props with every look and a new scene is covered by parity through its replay; each test annotates the scene and looks it covered (2450217); 11 box-readme.test.ts requires every box scene and setting in the README (2450217); 12 the prop template measures each part where it stands (buildPropPart, partMatrix public) (2450217); 13 README "Adding a prop" step 5: defineGlyph with a spawn and levelProps (2450217); 14 docs/PROGRESS.md rewritten at the review (4bf5ef9, bae833f) and at this gate; 15 stays: docs/INDEX.md is generated and read through its "Start here" section and grep (the export lists are its API index, G3 item 2); 16 tests/replays/README.md and labs/box/README.md give the tile centre (col + 0.5, row + 0.5) × tile, rows +Z (2450217). Open risks: T2 at 9 min 25 s, over its 9 min (warning only); files over the 400-line warning (PROGRESS); crowd batches draw no flinch lean (accepted by the owner, 2026-10-14: ADR-0018 amendment 3); post-IK foot plant (built after G9, ADR-0009 amendment 8) and preciseHits parity (recorded after G9, box-5-precise) open; real-GPU cost, touch (ADR-0021) and physical pads not verified. Escalations: none new; ESC-0001 stays decided (Actions off). Calls: no box-6 replay (looks are view state); the INDEX stays one generated file. Review history: review round 1 (gatefix-G7-r1, bae833f): 14 findings fixed (WP 6.2 in the box, T2: parity one replay per test and one look per material style, x replay --state/--until, x describe kind:name, x qa checked counts and X_USAGE on an empty --only, x new path check, prop and scene templates, README Adding a prop and Coordinates and inputs, box-readme coverage test, PROGRESS); node x ci --local --long green at c30b552 (lane 9e154c0 + generated docs) in 51 min 27 s at load 6–83: check 13.9 s (CI_BUDGET warning), test 46.2 s with 3,258 tests, x new --test-all 1 min, T2 9 min 32 s with 159 tests (CI_BUDGET warning only, ADR-0022), flake hunt 477/477 in 35 min 9 s, kernel budget, crowd and fight ladders, clip QA, box clips green; after merging integration b5acdc1, 57 e2e (parity, box-fight, box-clips, box-audio, box-look, box-hero) green; review round 2 (gatefix-G7-r2, ff5c618): dry-run item 9's <stage> rule kept only in labs/box/README.md step 2 (the skill points to it), and the skill's props Layout row given a full path (labs/<lab>/props/*.ts) |
| 8.1 | Provenance, catalogs, ledger, docs | L | done | ea27caf (#5) | data/anim/{SOURCES.md,LICENSES/,catalogs/,cmu/} (ledger split into 17 categories plus subjects.tsv, fallback fixed), docs/ANIMATION-LIBRARY.md (from MOCAP.md), docs/ANIMATION-RESEARCH.md (Engine column and 2D inventory dropped, coverage map added), tests in tests/unit/data/anim/{catalogs,ledger,sources}; call: kept the research doc's Build/Size columns, labelled as the 2D engine's proposals; INDEX/API regenerated on merge; no escalations, no deferred proofs; re-dispatch on integration 5ee52bf re-checked every claim (CMU terms against the live site, CC0 hash, ledger join-back 2548/2548, catalogs) and dropped a leftover 2D-engine mark "topple (✅)" from ANIMATION-RESEARCH item 6; after G9: the set's `credit` (data/anim/sets/cmu/_set.json, `CMU_CREDIT` in tools/anim/repack.ts) states CMU's terms (free to use and redistribute, never to resell as data) where it said "free for all uses", regenerated through the importer (`x anim import --cmu --legacy`: 1 file written, the 61 others as they were), the old wording mapped in sets.test.ts's legacy compare |
| 8.2 | Readable codec and format 2 | L | done | d570025 (#5) | Readable codec port (bit-identical to the source), format-2 types and parse, validator, lens, mirror; `x port refs --clips` commits 3 float32 samples per clip plus a sha256 over every frame; calls: decode on each clip's own source rest, format-2 key fields carried but not decoded (WP 8.8), unknown fields refused (ADR-0010 amendment 1); port.ts's 408 lines: its builders split into tools/lib/portVectors.ts after G9 (ADR-0014 amendment 16) |
| 8.3 | Re-containerize the sets | L | done | c9fdfa1 (#5) | tools/anim/repack.ts (split/join, clipSlug, catalog.tsv, tagAlternates, readPlainSet) and data/anim/sets/{quaternius,mesh2motion,cmu} as 325 text() files plus _set.json and catalog.tsv; calls: fit stays in _set.json and sets the clip order, alt is the last tag, the sets kept out of Prettier (ADR-0010 amendment 2); no escalations; no deferred proofs; re-dispatch on integration 5ee52bf found it already merged (d51746f), re-verified green, no new commits |
| 8.4 | Baker, clip layer, retargeting, mannequin | L | done | b465fec (#8) | Baker (30 fps rotation tracks), clip layer in the animator's clip slot (ground-speed loops, walk-run switch, strike time), retargeting onto any build, the mannequin; review r6 fix: the build's hip-joint centre goes at the source's times the hip-height ratio (my-3d2dge hipC) and contact IK plants each foot's lowest point, dropping the pelvis just enough for a straight leg (CMU Shrug on heroic: 197 mm to 0); AnimationMixer matches the clip layer within 0.1 mm; mannequin baseline rewritten with a reason (cmu 116.6 to 92.7 mm, quaternius 58.1 to 72.4, mesh2motion 49.5 to 59.9); call: straight-leg reach over keeping the clip's knee bend (knees through the floor on kneeling clips); after G9: the lift raises a pose only as far as it sinks below its source's own lowest point, scaled (retarget.ts), so swims and dives keep their depth: the mannequin baseline re-recorded (Quaternius' mean 72.4 → 62.7 mm, Swim_Idle_Loop's worst 1,813 → 1,397 mm), and retarget.test.ts's planted-feet case runs with the lift on, which lifts only where a hand or the head would sink (15 clips); rest.ts split from retarget.ts (ADR-0014 amendment 17); docs regenerated on merge; no escalations; deferred: browser/e2e look of the clip layer and mannequin; verifier: pass after 1 fix round(s) |
| 8.5 | Tools port | L | done | 562b9cd (#8) | x anim (cmu, import, find, show, bake, sheet, cut) reproduces the CMU set byte for byte (import --cmu --legacy --check, 62 files), find punch in 20 lines; review round 2: readMany skips unwanted gaps over MAX_GAP 256 KiB (13_29 cold 1.53 MB, was 24.78 MB; cold import --cmu about 23 MB), import --cmu fetches all picks in one cmuGet, find/show/bake/sheet/cut take --sets <dir>; core change accepted (lane/wp-8.5-frames, ADR-0010 amendment 4): the codec's frame math and torso moved to engine/anim/clip/frames.ts (encode.ts 449 to 350 lines; decode bit-identical, oracle green); integration: WP 8.6's takes.test.ts flag list taught WP 8.5's fps:c3d and twin:<id> evidence flags; docs regenerated on merge; open (triaged, not blocking): no test on the GLB importer's skinned-mesh/Rigify paths (must land before WP 8.8 imports UAL1), no --json test on x anim cmu/find; no escalations; after G9: the cold `x anim import --cmu --legacy --check` passed (60 clips, all 62 files as the tool writes them, 27 s with an empty .cache/anim, its 69 MB of takes fetched again); call: not in LONG_RUNS, since every gate would then hang on CMU's server and a 23 MB download while T1's legacy compare already pins the set; not verified: T2 (tools/ and engine/anim/clip only); verifier: pass after 2 fix rounds |
| 8.6 | Library tests and QA | L | done | c0b7e60 (#8) | Library tests (format, provenance, takes, ledger completeness), the browser smoke test with mixer parity, and the anim QA family over 1,218 clips on 5 builds (qa-anim-library.json, 32 entries); core change accepted (ADR-0010 amendment 3): baker fold fix (87 clips, anim-clips.json rewritten), library replace() parses first, x sheet humanoid keeps the humanoid's own QA ids (humanoidPrefixes / qaPrefixes, includes WP 8.7's action:) and never plays the library; calls: clip QA in tools/qa/anim/, T1 plays a sample and the full sweep (about 40 s) is a LONG_RUNS entry, foot slide deferred to contacts (WP 8.8), x anim sheet left to WP 8.5; integration: tools/qa/anim{,.test}.ts merged with WP 8.7's actions, file comment trimmed to 40 lines, the bake fold fix cures action:deathBlown jointLimit so its qa-anim.json entry is removed, docs regenerated, replays unchanged; after G9: contact IK bends each knee toward the source's once it stands 2 cm off its hip–ankle line (retarget.ts KNEE_POLE): Get_Up_From_Side's pop and twistJump and Slide_Exit's twistJump left the baseline; Zombie_Rise, rising with its hips under the floor, keeps its pop (0.7215 → 0.7119) and gains a twistJump at frame 106 and an underFloor of 4.9 cm by design, baselined with their reasons, bare x qa anim about 50 s; no escalations; verifier: pass after 1 fix round; not verified: full T2 rerun after the review fixes |
| 8.7 | ACTIONS layer | L | done | 4cc8dee (#8) | engine/anim/actions.ts adds the action kind, the Actions player and actionCheck (beats of body states, a motion or a move, clips, IK effectors, flips, squash, events, flags, cancel windows, until-next holds, loops, exit, lockstep pairs, 30 eased channels); data/anim/actions/ holds 28 actions (jump phases, hurt, dizzy, flips, 8 deaths, charge, itemGet, ledgeHang, wallSlide, grab and grabbed, get-ups, idle life); tools/templates/action; core change accepted (4cc8dee, ADR-0009 amendment 7): the anim QA plays every action by its check, 38 baseline entries with reasons (full QA about 5.5 s unloaded); calls: actions are data the reader loads (loadActions), deaths revive on finish, only ground flips are clamped to the floor; integration: sim-api.ts was at 595 of 600 lines, so its Animation area moved verbatim to engine/anim/api.ts, re-exported whole, and the Actions exports were added there (ADR-0020 amendment 8; x new action --test green); docs regenerated; actions.ts's 596 lines split into actions-data.ts and actions-check.ts after G9 (ADR-0014 amendment 16); after G9: x describe action lists the 28 ids through tools/anim/library.ts's defineActions (the engine cannot import data/; describe.test.ts); no escalations; not verified: T2 (no page code touched) |
| 8.8 | Re-import from sources (after G8) | L | todo | | Fired 2026-10-17 by the playground (ADR-0025): the playground's mantles, climbs, ladders and ziplines need hands on their contacts, and its locomotion foot roll. |
| 8.9 | Clip mode in the box | L | done | bf788f2 (#9) | box:clips (labs/box/scenes/clips.ts): the hero and the mannequin play any of the library's 1,218 clips through the clip layer in the room, set by box.clips.* (clip, speed, frame, mirror, mask, cast, ik); commits 1b11767 and 7257ea0 (core), d1b807f (clip mode), c2c49c5 (the `box clips` long run), d36e905 (100STYLE's credit on every box page, a DOM query), merged fd01b19, gate G8 review fixes bf788f2; core accepted as ADR-0010 amendment 5: the clipset kind (`defineClipSet`, `clipSetFromFiles`, `defineSetBuild`), actor clips (`spawnActor` clips/body, components clips and puppet, `actors.clips`, clip events, play/stop/seek/`locomoteClips`), the view and `__engine.anim` posing clips; every host registers the library (tools/anim/library.ts `defineLibrary` for x sim, x perf, x replay, x describe and tests; labs/box/library.ts for the box page, also on `?replay=`, and tests/pages/replay.ts; library.test.ts: the same entries); proofs: clips.test.ts plays all 1,218 clips headless on the mannequin (first, middle and last frame, each pose finite, bones at length), `x anim show` and `box.clips.clip` select the same clip frame for frame, frame stepping, a one-shot's hold, the hero walking under mask=upper, one hash twice; box-clips.spec.ts plays one clip of each set in the page (0 pipelines after the warm-up, both figures in the ID pass) and finds the credit by a DOM query; the BOX_CLIPS=all long run played all 1,218 clips in the page (3/3 passed, 48 s); tests/replays/box-8-clips.replay.json (a clip change, frame stepping, the hero walking under a one-shot on mask=upper; final 900f06cdd21a82a7) gives one golden set in Node (clips.test.ts), the sim page and the rendering page, and is parity.spec.ts's clip-mode stage (goldens drawn, cameras and resolutions swept, GPU features off, live play replayed in Node, ID pass); `x describe clipset` lists the 10 sets; full T2 159/159 (24.4 min on 2 workers at load ~60); verifier: gate G8's adversarial review, round 1 fixed; no escalations; no deferred proofs; tools/cmd/sim.ts 402 and tests/e2e/parity.spec.ts 471 lines, split after G9 (tools/lib/scenes.ts, parity-stages.ts: ADR-0014 amendment 16) |
| 8.10 | 100STYLE and Quaternius v2 from shardfall | L | done | a044e3d (#5) | tools/anim/shardfall.ts adopts 100STYLE (7 sets, 878 loops, body null) and Quaternius v2 (102 clips plus v1's Punch_Enter and body) with 8 catalogs, every clip marked via; calls: 100STYLE's Set cell names its catalog family, parity runs over the shorter duration (only A_TPose differs); parity on v1 rests 79/87 within fit (8 misses with checked reasons in shardfall.test.ts); no escalations (100STYLE approved, ADR-0021); deferred without the checkouts: the oracle decode and parity tests (done: they run with the checkouts in npm test, none skipped, checked after G9); INDEX/API regenerated on merge; no verifier review (lane ran it as S-size although the ledger sizes it L); open for WP 8.5: repack.ts with no arguments still rewrites quaternius from v1 (drop it from legacySetFiles) |
| **G8** | **Gate: animation library** | | done | bb3862f (#10) | x ci --local green at bb3862f on a clean tree, first run, at load average 5-22 (1 min 33 s: check 6.1 s of 10, test 31.8 s of 60 with 3,262 tests in 301 files, x new --test-all 51.9 s; T2 selected nothing, as the stage's code reached main with gate G7's PR #9 and nothing changed since 9a8f6f3; T2 in full last ran at the review: 159/159 at ebd27cc in 14 min 24 s, and 164/164 at G7's 4af3816 in 9 min 25 s, over its 9 min, a CI_BUDGET warning only, ADR-0022); `node x deps --qualify`: no line has qualified beyond the pins (0 upgrades). Proven: the library is intact with provenance (8.1: SOURCES.md, licenses, catalogs, the CMU ledger; 8.10: 100STYLE's 7 sets and Quaternius v2 deep-equal shardfall's files bar the marked fields, every style100 set credited) and parity proofs (8.2: the codec bit-identical to the source, 3 samples and a sha256 per clip in `x port refs --check`; 8.10: 79 of 87 shared Quaternius clips within v1's fit, the 8 misses listed with reasons); the clip layer plays every clip on every build in Node (8.4, 8.6: 1,218 clips in 10 sets on 5 builds, anim QA baselined with reasons in qa-anim-library.json, 32 entries; 8.7's 28 actions by their check); clip mode runs in the box headless (clips.test.ts plays all 1,218 clips on the mannequin; box-8-clips replay, final 900f06cdd21a82a7, one golden set in Node, the sim page and the rendering page) and in the page (box-clips.spec.ts, one clip a set, 0 pipelines after warm-up; the BOX_CLIPS=all long run, 1,218 clips, in G7's --long at c30b552); `x anim import --cmu --legacy --check` passes (62 files byte for byte, 3.8 s). Verifier: review round 1 (gate-G8-r1, its x ci at 6d9fb74 failed 7 parity specs: clip mode registered no library in x sim, x replay and the replay page) fixed in gatefix-G8-r1 (bf788f2: tools/anim/library.ts defineLibrary in every host, box-8-clips replay, `x describe clipset`; ADR-0010 amendment 5's deferral closed); round 2 (gate-G8-r2) passed with x ci --local green at ebd27cc (test 3,240, T2 159/159). No dry run at this gate. Open risks: T2 over its 9 min (warning only); tools/cmd/sim.ts 402 and tests/e2e/parity.spec.ts 471 lines, split after G9 (tools/lib/scenes.ts, parity-stages.ts: ADR-0014 amendment 16); WP 8.8 (re-import, format 2's key fields) on demand; not verified: real-GPU cost of clip mode, touch (ADR-0021). Escalations: none new; ESC-0001 stays decided (Actions off). Calls: the stage's code went to main with gate G7's PR #9, so this gate's PR carries its ledger and progress only; G8's row records bb3862f, the commit x ci checked. |
| 9.1 | DSP core | X | done | 4d59721 (#5) | engine/audio/dsp: PolyBLEP oscillators, noise, ADSR and the source's fall/hold envelopes, sweep, arpeggio, vibrato, 8 cookbook biquads, echo, 2-operator FM, tuned Karplus-Strong pluck; render(def, seed, rate) → Float32Array under withSimMath, hashed by soundHash, same hashes in Node and Chromium (20 reference + 200 random sounds); calls: goldens in tests/pages/audioDspCases.ts, plucks hold by default, aliasing claim corrected to the measured ~6x (15 dB), linear cookbook Q for every filter; engine/index.ts exports left to WP 9.2/9.3; no escalations, no deferred proofs; duplicate dispatch re-verified on integration 5ee52bf, no new commits |
| 9.2 | Sound data | X | done | da451ce (#5) | engine/audio/data/{sfx,song,effects,drums,songs}.ts: kinds sfx and song; 33 effects, 6 drums and 5 songs copied from my-3d2dge; validators (tokens, bar lines, track length fills/divides bars and divides the song, ranges, voices via normalizeSound), layers, stratified pitch variants, fixtures/sounds, templates sfx and song, 44 goldens (linux-x64); calls (ADR-0013 amendment 1): 4 variants per effect replace ±3% per-play detune, added fields bus/intensity/kit/beats, drums are sfx, noise tracks refused, public names in engine/index.ts, audio/data a sim-side layer, size M; no escalations; deferred proof: audio QA (clipping/DC/duration) to WP 9.4; integrator: song.ts 2 ** octave → Math.pow (sim-side lint), audio/data layer fixture |
| 9.3 | Runtime, spatial audio, music | X | done | b4ccafa (#6) | engine/audio/runtime: createAudio locked until the first gesture (key but Escape, click, pointerup), context made in it and resumed on later ones, AUDIO_OFF advice without Web Audio; mixer buses effects/music/ui/ambience, held or timed duck to 0.35, crossfaded room reverb; voice limits 32 total, 4 per sound, 35 ms gap; HRTF PannerNode with the camera as listener; occlusion by QueryView ray, 900 Hz lowpass and x0.6; procedural stereo IRs for 6 rooms (RT60 within 5%); music intensity layers as seamless loops, sections on bar lines, stingers on beats, bind(event); footsteps by surface tag; public names in engine/index.ts; 29 unit tests plus audio.spec.ts (browser + OfflineAudioContext); calls: buffer playback only (AudioWorklet streaming waits for a measured need), sound-event payloads may carry position; no escalations, no deferred proofs; not verified: real speakers/headphones, Firefox/Safari fallbacks |
| 9.4 | Audio tools | X | done | e80dce8 (#5) | the audio QA family (tools/qa/audio.ts: peak/clipping, DC, clicks, leading silence, duration and spectral centroid, valued by each sound's worst variant; baseline []; ~0.74 s over 39 sfx × variants plus 5 songs) and x audio (tools/cmd/audio.ts: metrics, --wav, --spectrogram, --replay mixing a replay's sound events offline, failing on clipping, a bad event or a run that parts from its goldens); call made: a sound event is a sim event whose payload is { sfx, vol?, variant? }, variants play in turn when none is given; ~780 source + 330 test lines, over S's 300; no escalations, no deferred proofs; open: WP 9.3/9.5 mapping events to sounds on the audio side would need a registry hook for x audio (closed after G9: the scene's `sounds`, ADR-0013 amendment 3); an optional onStep in playReplay would remove the copied stepping loop (closed after G9: x audio steps through engine/app/playback.ts's createPlayback, ADR-0013 amendment 3); not verified: browser, listening to --wav |
| 9.5 | Sound in the box | X | done | b03aa87 (#9) | labs/box/sounds: 7 box sfx (steps by surface stone/iron, thud, hit, launch, death, torch crackle) and song:boxHall with fight layers from 0.5; the sim-event→sound map (events.ts) reads the trace after each step (FNV-1a 64), fight golden 8da39df56b106f5f the same in Node and Chromium (now 288bca340783f86f, 77 sounds: re-recorded after G9 for the hero shoving the crowd and the hits' gain, ADR-0013 amendment 3); page sound (page.ts): listener at the camera, QueryView occlusion, room reverb by level, the 2 nearest torches looped with a 2 m hysteresis, intensity 1 while blows land, death ducks; core: createEngine onFrame/EngineFrame (ADR-0013 amendment 2); calls: the map stays page-side so scenes are untouched, launches = bolts (shot), jump and dash use sfx:whoosh; size M; no escalations, no deferred proofs; closed after G9: a scene's `sounds` hook (ADR-0013 amendment 3) lets `x audio --replay` hear the box: the fight's 77 sounds, its timeline step for step (audio.test.ts), and a hit's gain capped at 0.5 so the worst moment's unspatialized mix peaks at 0.80 (it clipped at 1.54); not verified: speakers, Firefox/Safari, touch, fight-1000 event rate vs the 256-record trace (measured after G9: at most 83 events in a step over 600 steps, none missed) |
| **G9** | **Gate: audio** | | done | 8573abe (#11) | x ci --local green at 8573abe on a clean tree, first run, at load average 7-19 (1 min 34 s: check 6.2 s of 10, test 31.5 s of 60 with 3,262 tests in 301 files, x new --test-all 53.2 s; T2 selected nothing, as the stage's code reached main with earlier gates' PRs (9.1, 9.2, 9.4 with #5, 9.3 with #6, 9.5 with #9) and nothing changed since f7d95bd; T2 in full ran at the review: 151/151 at 2a1e76c in 11 min 16 s, 0 flaky, over its 9 min, a CI_BUDGET warning only, ADR-0022); `node x deps --qualify`: no line has qualified beyond the pins (0 upgrades). Proven: the DSP renders every sound to one hash in Node and Chromium (9.1: 20 reference + 200 random definitions, audio-dsp.spec.ts, Math native after a render); the sound data validates and renders to goldens (9.2: 33 effects, 6 drums, 5 songs, 44 goldens); the runtime waits for a gesture, mixes by bus, places, occludes, reverbs and sequences music as measured in Chromium (9.3: audio.spec.ts, 7 tests on an OfflineAudioContext, room IRs within 5% of RT60); the audio QA family finds 0 violations with an empty baseline (9.4: x qa audio, under 1 s) and x audio measures, writes WAVs and spectrograms (sfx:jump peak 0.30, 0 clipped, 0 clicks); the box sounds from its sim events (9.5: box-audio.spec.ts, the fight's sound timeline hashes 8da39df56b106f5f in Node, Chromium and its golden (288bca340783f86f since the cleanup after G9, ADR-0013 amendment 3); the page plays it in real time with music and torches; the room reverb on a click). Verifier: review round 1 (gate-G9-r1, x ci --local green at 2a1e76c: test 3,217, T2 151/151) passed; no gate fixes, no dry run. Open risks: T2 over its 9 min (warning only; after G9 its budget goes by machine size, 60 min on this 4-core container, ADR-0022 amendment 2); `x audio --replay` finds 0 box sounds (the box's sound map is page-side; a registry hook for a game sound map would fix it; after G9: the scene's `sounds`, ADR-0013 amendment 3); the fight-1000 event rate against the 256-record trace unmeasured (after G9: at most 83 a step, none missed); not verified: speakers and headphones, Firefox/Safari, touch (ADR-0021), real-GPU cost. Escalations: none new; ESC-0001 stays decided (Actions off; answered yes by the owner on 2026-10-14, see the cleanup's row). Calls: the stage's code went to main with earlier gates' PRs, so this gate's PR carries its ledger and progress only; G9's row records 8573abe, the commit x ci checked. |
| **C1** | **After G9: the cleanup (CLEANUP.md)** | | done | PR "After G9: the cleanup" | the audit's work order of 2026-10-14, each box ticked in the commit that closed it: deps adopted (@playwright/test 1.64.1, Node 24.22.0); the owner's decisions recorded (ESC-0001 yes, ADR-0018's two calls accepted, T2's budget by machine size: ADR-0022 amendment 2); the 17 files over 400 lines split (ADR-0014 amendment 16), and retarget.ts and idpass.ts when the cleanup grew them (amendment 17); the hero passes the crowd he shoves (`shoves`, ADR-0020 amendment 9, box-4-stairs); the post-IK foot plant built without stance locks (ADR-0009 amendment 8), the clip lift relative to the source and contact IK's knee pole (WPs 8.4, 8.6), preciseHits parity (box-5-precise), x describe action's ids, the CMU credit and the cold import check; camera errors naming all 12 cameras, the ID pass's per-instance colours, the steps replay, headless step(n) on the virtual device, three clock-free tests, outline colours validated (GFX_POST_BAD_COLOR), a test per box look and x shot --ready-ms, browser examples run in T2 (ADR-0015 amendment 4), stale text; the state hash 67% faster with the same bytes, x audio --replay hearing the box (the scene's `sounds`, ADR-0013 amendment 3; the hits' gain capped so the fight's mix peaks at 0.80), nav-1000 and lift replays and every replay in Chromium at the gates; the GitHub Actions workflow running x ci --local (ADR-0016 amendment 1); the integration branch is gone on GitHub and is not recreated; calls: T2 for each commit was the specs it touched, the full T2 in x ci --local and in the workflow (the full run found two leaks between suites in the one Playwright worker that each commit's selection could not, fixed in 7d256f3 and 1e5d6dd); the verifier reviewed it in two rounds (ADR-0022); CLEANUP.md is deleted by the last commit (its ticked list stays in PR #14's history); Owner: on 4 cores T0 and T1 run over their fixed budgets (10 s and 60 s): 20.9 s and 2 min 39 s in x ci --local at 1e5d6dd, 37.6 s and 3 min 43 s on the workflow's runner (6.2 s and 31.5 s at G9, on a larger machine), and the runner's T2 took 65 min 44 s of its 60, all CI_BUDGET warnings: scale T0 and T1 by machine size as T2 is (ADR-0022 amendment 2), or keep the warnings? (answered 2026-10-15: row C2, ADR-0023); not verified: real-GPU cost, speakers, Firefox/Safari, touch (ADR-0021); escalations: ESC-0001 answered, and closed at the workflow's first green run (run 38679570559) |
| **C2** | **Long tests never hold up work (the owner's calls of 2026-10-15)** | | done | PR "Long tests never hold up work" | ADR-0023: `x ci --local` is the quick gate before every merge (npm ci, x src, T0, T1, x port refs --check: 4 min 19 s at c2d1333, where x new --test-all took 2 min 33 s more, so it moved to the full run), `x ci --local --full` the full run with x new --test-all and T2 in full, which the workflow runs after each merge to main and by hand (no longer on PRs, no run cancelled), nobody waiting on it; `x ci --status` (tools/lib/ciStatus.ts, GitHub's REST API through curl, no token) reads main's last full run, the SessionStart hook prints it, and a red main is fixed first; one budget, the quick gate's five minutes (`GATE_BUDGET_MS`), answering C1's Owner: issue; T2's budget by machine size and its selection in the gate gone (ADR-0022 amendment 3, ADR-0016 amendment 2); the owner declined branch protection (§11.5), deleted the `game/*` branches on purpose (docs/HANDOFF.md) and paused Vercel until they test (its statuses and errors ignored meanwhile); proved by tools/cmd/ci.test.ts, tools/lib/ciStatus.test.ts, tools/cmd/ci-workflow.test.ts, tests/unit/hooks/session-start.test.ts and `x ci --status` against GitHub; the first full run on main after the merge is the one `x ci --status` reports |
| **C3** | **The agent files pruned (the owner's ask of 2026-10-15)** | | done | PR "Agent instruction files: pruned to what agents need" | against current guidance (Claude Code's CLAUDE.md docs: under 200 lines, only what applies every session, prune what tools enforce or agents do anyway; ETH Zurich's AGENTS.md study, arXiv 2602.11988: repository overviews do not help and context files cost over 20% more inference): what loads every session went from 149 lines to 115 (AGENTS.md 124 → 101, CLAUDE.md 25 → 14); cut: the directory overview, setup detail the hook and scripts/setup.sh carry, sentences DOCTRINE.md already says, the Phase 0 note, CLAUDE.md's lists of the subagents, skills and pre-approved actions that Claude Code or AGENTS.md already shows, and the x-loop skill's repeats of AGENTS.md; every owner call, rule and check stays; the Vercel rules made one bullet |
| **C4** | **The lean package (the owner's call of 2026-10-16)** | | done | PR "The lean package: the engine as a library, the default handoff" | ADR-0024 amendment 1: after about a dozen trials the owner asked for a lean package, shipped as libraries ship, without tests or checks, for agents down to a chat in a browser. lean/: my3dge.js, the engine as one ES module (1.07 MB, 346 KB gzipped; three.js r182 and Rapier 0.21 stay imports, which the page's import map loads from jsDelivr at the pinned versions), my3dge.css, game.html (the starter as one page: 256 lines), README.md (one file, 42 KB, about 10,000 tokens: the model, the rules worth keeping, the page, the API by area) and LICENSE (MIT, and @stdlib's Apache-2.0). `x docs --write` writes it (tools/lib/lean.ts; a 2.6 s build, the same bytes every time) and `x docs --check` fails it stale; tools/lib/lean.test.ts maps every import the bundle makes to a file node_modules holds at the pinned version; tests/e2e/lean.spec.ts opens game.html as a file and plays it on WebGPU from its CDN URLs served locally (23 s); jsDelivr's copies of the seven files a page loads were byte for byte node_modules' (2026-10-16). README.md's first section and docs/HANDOFF.md now lead with it; the full workspace stays for coding agents that want the checks. Not done: npm publishing and type declarations; the owner said no to both for now (2026-10-16) |
| 10.1 | Building blocks and fixture rigs | A | todo | | Fired 2026-10-17 by the playground (ADR-0025): the playground's dog. |
| 10.2 | Ragdolls | P | todo | | Fired 2026-10-17 by the playground (ADR-0025): dummies and neighbours fall to hard hits and kicks. |
| 10.3 | Props library | W | done | 9c0b23e (#27) | Fired 2026-10-17 by the playground (ADR-0025): the house needs doors, windows and furniture. Built the library's eight (engine/world/props/library.ts), which the kind registers beside the catalog's four, each from the geometry kit's shapes: the sconce (an iron wall sconce holding a burning torch, its flickering light tagged `sconce`; no body, as the brazier's fire, its origin the plate's foot on a wall), the banner (a red cloth with a gold hem on a crossbar and a 2.6 m pole on a stone foot; fixed), the chest (planks bound in iron, a rounded lid, a lock plate; 40 kg, dynamic), the door (0.9 × 2.05 m, three iron straps and a ring pull; fixed: WP 13.16 hangs doors on their hinges in a level's openings), the table (a trestle table, 30 kg), the bench (15 kg), the statue (a robed stone figure, 2.2 m on its plinth; fixed) and the lantern (glowing panes, a cap and a ring, 2 kg, its light tagged `lantern`). Those with a body stand on spawn points of their names but the door; the hooks are the kind's (a hit knocks the four dynamic ones; use does nothing until WP 13.16). Their materials (engine/gfx/props.ts): `material:iron` (texture:metal) and `material:cloth`, beside the engine's planks, stone, glow and flame. Measured: `node x qa geo tex --only prop:`, 12 props, 0 violations in either (every part within its geometry's budget, no prop floating or sunk); tests/e2e/props.spec.ts, 2 passed: in the props page's yard every part of the eight is seen in the ID pass beside the catalog's four (above 50 px each), no prop batch unseen, 0 pipelines after the warm-up, the draw calls as counted, the lights of the fire, the sconce and the lantern where their spots put them, and the knocked crate's mesh following its body; the other specs that draw props, parity, post-box and box-hall, 50 passed with them; the page now says why an object is unseen (`covered`: the south wall hid a bench and the lantern's panes until they moved north). Tests: library (4), prop and gfx props (a batch for each part of all twelve, the two materials). Calls: the library's props are the plan's list, built for the house too (a door, a table, a bench, a chest, a lantern); every stage with props makes a batch for every registered prop, now 41. Files beyond the WP's list: engine/gfx/props.ts, engine/sim-api.ts (the props area's comment), tests/pages/props.ts, tests/e2e/props.spec.ts |
| 10.4 | Generic gameplay kits | W | todo | | Fired 2026-10-17 by the playground (ADR-0025): the range's targets and the neighbours' awareness. |
| 10.5 | Terrain | W | done | 9b61785 (#27) | Fired 2026-10-17 by the playground (ADR-0025): the yard and the hill. Built terrain as world data (engine/world/terrain.ts): the registry kind `terrain` (`defineTerrain`, `getTerrain`, `makeTerrain`), a grid of cells from a north-west `origin`, a float32 height at every corner from shardfall's fbm (5 octaves, lacunarity 2.03) and ridge term, smooth domes (`hills`), `terrace` steps and flattened footprints (`flats`, blending back over a margin); queries `terrainHeight` (each cell's two triangles split as Rapier splits a heightfield's: north-east to south-west), `terrainGradient`, `terrainNormal`, `terrainGrade`, `terrainSurface` (`steepSurface` past `steep`, 0.7 m a metre); stateless placement `scatterTerrain` (hashes of the seed, a salt and the cell). The collider (engine/physics/heightfield.ts): the shape `{ type: 'heightfield', cols, rows, size, heights }`, column-major for Rapier, internal edges fixed; `addTerrainBody` (engine/sim/levelBodies.ts). Navigation (engine/world/terrainNav.ts): `NavGrid` takes a `NavSurface` with an `origin` besides a level (a level's arithmetic unchanged, no golden moved; the heap split to engine/world/tileHeap.ts at nav.ts's cap); a cell open up to a grade of 1. The drawing (engine/gfx/terrain.ts): chunks of 32 cells, three's `LOD` at every 1st, 2nd and 4th corner from 0, 48 and 96 m, 2 m skirts, the full grid's normals at every level, an orthographic camera picking by what it frames (`levelDistance`); the splat (engine/gfx/terrainSplat.ts): a node material copy of the ground layer's material in every style (the style set's `userData.restyle`; the copier shared with the viewmodel, engine/gfx/materials/nodeCopy.ts) mixing the steep and high layers by the fragment's normal and height. Scenes name a `terrain`; the view draws it (the stage's plane at its height, the sun fitted to its area). The playground's hill (labs/playground/scenes/hill.ts): `terrain:block`, 96 × 96 m rolling 0.6 m, the hill a 10 m dome over the east edge's middle, slopes up to 28.9° (10° to 30° over most of its flank), turf over rock (labs/playground/ground.ts). Measured: Rapier's probes within 2e-4 m of `terrainHeight` and normals within 5e-7 (float32); a box slides over a flat field's seams within 5 mm; a heightfield world restores from a capture and continues exactly; the controller up a 20° hillside 0 to 7 cm over the slope, running down a 23° stretch hopping up to 13 cm (its across-then-down move); the course `hill` 25 of 25 (the feet planted, no pops, every camera's bounds); tests/replays/terrain-hill.replay.json (up the flank, across it, down it in a slide from 6.1 to 10.2 m/s, back up; final 532cc08a1a85b79c) one golden set, 16 hashes, in Node ×3, Chromium ×3 and the page ×3; tests/e2e/terrain.spec.ts, 3 passed: 0 pipelines after the warm-up through every camera and both looks with the chunk under the player at its finest, the far chunks switching levels building nothing, the hill replay's goldens kept while it renders through every camera and look. Tests: terrain (11), terrainNav (3), heightfield (5), gfx terrain (9), stage (a terrain as the ground), levelBodies (the body, the walk), the hill (2), the courses (the hill's). Calls in ADR-0025 amendment 17. Files beyond the WP's list: engine/world/{terrainNav,tileHeap,nav}.ts, engine/gfx/{terrainSplat,stage,stageSky}.ts, engine/gfx/materials/nodeCopy.ts, engine/gfx/viewmodel/material.ts, engine/gfx/level/runs.ts, engine/physics/world.ts, engine/sim/{levelBodies,scene,siteApi}.ts, engine/sim-api.ts, engine/index.ts, engine/app/view.ts, labs/playground/{ground,main,README}, its scene, course and tests, tests/e2e/terrain.spec.ts |
| 10.6 | UI widgets | I | done | 54d97b1 (#26) | Fired 2026-10-17 by the playground (ADR-0025): the playground's settings, prompts and HUD. Built the widgets as HTML/CSS over the overlay, each marked `data-ui` for `ui.state()` and DOM queries: bars, hearts (halves) and boxes (engine/ui/widgets.ts, placed in the HUD's places by the overlay's new `attach`), the dialog box (dialog.ts: typed at its speed, accept showing the rest, turning the page and closing, choices marked with the directions, cancel to the last, a click picking, `auto` and non-modal lines) and the menu (menu.ts: the cursor round the ends and past disabled items, held directions repeating after 0.35 s and every 0.1 s, accept picking, cancel, the pointer); input (the page input's system layer) and sound cues injected; a gamepad's cursor over any panel (shardfall's speeds, its accept clicking what it is over); a menu item's `id` sent as input on its pick (`send`), so the replay holds it. All exported from engine/index.ts. Measured: `ui.state()` snapshot and 15 unit tests (36 in engine/ui; engine/ui/{widgets,dialog,menu}.test.ts, over the stand-in DOM, which gained listeners, `click` and `closest`); tests/e2e/ui.spec.ts in tests/pages/ui.html, 4 passed: every widget found with its text and a box inside the overlay, the keyboard working the menu and its pick recorded as the scene's dev action, the dialog typed, paged and picked by a mouse click, a scripted gamepad working the menu with its D-pad and the settings panel's button through its cursor. Calls in ADR-0025 amendment 14. Files beyond the WP's list: engine/ui/overlay.ts (`attach`), engine/index.ts, tests/unit/ui/{fakeDom,uiKit}.ts, tests/pages/ui.{html,ts} |
| 10.7 | Game template | B | done | PR "Games from one URL: new-game.mjs, the starter game, the guide" | Fired by the owner's ask of 2026-10-15 (hand the engine to many agents from different labs at once, one game each; ADR-0024). `node tools/game/new-game.mjs <dir>` makes a game in 0.5 s (1,834 engine files pinned by engine-lock.json, 8 starter files, the game's root files); `node x engine --test` made one from the checkout and passed its gate in 2.5 min (npm ci 4.5 s, check 21.8 s, test 7.0 s, sim 4.1 s, replay in Node and Chromium 10.2 s, shot 6.2 s, x qa of every family 96.0 s, help 0.3 s; each a metric of out/engine/test/report.json), now a full-run step; the starter's bot wins seeds 1–10 in 324–425 steps of the 1,800 its clock allows; the replay's goldens recorded in Node ×3 and Chromium ×3, and they hold while the page renders (`x replay --browser page`, Chromium page ×3); tests/e2e/game.spec.ts reads the HUD through the DOM (the round, its end, Enter's next round) in 7.9 s; a game's build ships only itself (6.0 MB, 3 assets). Calls: the engine vendored, not a submodule (cloud agents clone without submodules; a dependency's sources would be invisible to ripgrep); the starter at labs/game/ in this repository, checked by its suites; docs/THREE-DELTA.md not shipped (it cites a reference file games lack, and game code reaches three.js only through the barrels); sim-side lint now covers every lab's scenes/ and cast/; the store split off as WP 10.9. The verifier's review failed it, and the fixes followed: `--update` never overwrites or deletes a game's own files (a file of the game's where the newer engine adds one stops the update and names it; a declared patch is kept unless `--force`), and it carries the game's own npm scripts and dependencies across; a game's binary assets are approved in its own APPROVED-BINARIES.json (the engine's list stays the engine's); `x new` kinds that make the box's entries (a scene) say what a game does instead; tests/baselines/ ships (not port/), so `x qa` runs in a game; the determinism skill is not shipped (it cites the engine's sources; docs/GAME-GUIDE.md §7 holds what a game needs); the starter counts a gem once when two actors reach it in one step. Its second review failed it on one point, fixed: `--update` also stops on a package.json entry of the game's that the newer engine sets otherwise (scripts, dependencies, allowScripts; the lock records the engine's), unless `--force`; and it brings the root files the game never edited to the new templates and names the edited ones whose templates changed (the lock records what new-game.mjs wrote); a damaged lock names its fix. Not covered: `x qa level` reads level files only, so a game's levels written inline in a scene are not QA'd; tools/game/*.d.mts are written by hand; a root file the game had before new-game.mjs (an AGENTS.md appended to, a README.md kept) is the game's, so an update never names its template's changes. The third review passed it; its notes since: an update names the package.json entries it drops or sets back to the engine's, and a lock whose files are a list names its fix |
| 10.8 | Lab pages (optional views) | B | todo | | Fired 2026-10-17 by the playground (ADR-0025): the owner tunes animation and feel in pages. |
| 10.9 | The store | B | done | f1654e8 (#26) | Fired 2026-10-17 by the playground (ADR-0025): the playground keeps its settings and bindings across sessions. Built engine/app/store.ts: `createStore({ prefix, version, mode, backend, migrate })` keeps plain data as JSON under the game's prefix in the page's `localStorage`, each value in its envelope (`my3dge-store/1`, its version) checked when read: another version migrates (written back) or falls back with the advice `APP_STORE_VERSION`; memory in Node, where the page refuses storage (`APP_STORE_BLOCKED`) and in the `demo`, `sandbox` and `gallery` modes, which keep nothing past the page; storage never throws (a refused write returns false). Exported from engine/index.ts with `memoryBackend`. The starter game keeps its fastest won round through it (labs/game/best.ts, its HUD line `Best 9.5 s`; a replay's page opens the store in `demo`, so it sets none). Measured: engine/app/store.test.ts (5 tests) and labs/game/best.test.ts; the HUD line was not run in a browser. Files beyond the WP's list: engine/index.ts, labs/game/{best,best.test,main}.ts |
| 11.1 | Completing the feature framework | R2 | todo | | Fired 2026-10-17 by the playground (ADR-0025): the first of WPs 11.2–11.5 fired. |
| 11.2 | GPU timing | R2 | todo | | Fired 2026-10-17 by the playground (ADR-0025): the owner's GPU frame time in the playground. |
| 11.3 | GPU particles | R2 | todo | | Fired 2026-10-17 by the playground (ADR-0025): rain, dust and debris beyond the CPU particles. |
| 11.4 | GPU-driven crowds | R2 | todo | | Fired 2026-10-17 by the playground (ADR-0025): the street's crowd variant at 1,000 to 5,000 people. |
| 11.5 | Lighting and shading upgrades | R2 | todo | | Fired 2026-10-17 by the playground (ADR-0025): the house's lights beyond the pool, cascaded shadows over the yard, ambient occlusion indoors. |
| 12.1 | Scaffolds and skills completed | T | todo | | Fired 2026-10-17 by the playground (ADR-0025): the new kinds (movement profiles, camera modes, storey levels, interactables, weapons) and the playground's skills. |
| 12.2 | Agent-usability evals and mutation testing | T | todo | | Fired 2026-10-17 by the playground (ADR-0025): the owner's order: usability tasks over the playground, and mutation testing. |
| 12.3 | Agent eye | T | todo | | Fired 2026-10-17 by the playground (ADR-0025): whether the player is in view from each camera in every room, asked in Node. |
| 12.4 | Reading edition (optional) | T | done | PR "Games from one URL: new-game.mjs, the starter game, the guide" | Fired with WP 10.7 (ADR-0024): docs/GAME-GUIDE.md, 45 KB (about 11,000 tokens) of a 60 KB budget, against 704 KB for docs/API.md: the guide, then the public API by area (about 870 names in 52 areas) generated by `x docs --write` and checked by `x docs --check`; built in place of `x edition` |
| 13.1 | The playground lab | B | done | 6a02eda (#22) | Built `labs/playground/` as the box is laid out: index.html and main.ts (every module under scenes/ and looks/, the gym's text registered as the starter game registers its arena's, the playground's replays, the menu for humans), cast/player.ts, levels/gym.ts, scenes/gym.ts, looks/, views.ts, menu.ts and README.md, checked by tests/unit/playground-readme.test.ts. The gym (`playground:gym`): 40 × 100 m at 0.5 m tiles, 43 features written from data (12 strip marks, 5 mantle walls 0.5–2.1 m, 3 fences 0.6–1.2 m, 6 climb walls 3–7.2 m, 4 slide ramps 5–30° with their decks, steps of 0.25 m, slope tests of 45° and 51°, a 6 m tower, a lane of 9 gaps 2–9 m), each block, slope and gap tested at its sign's number; the player on today's controller with Apex's gravity (19.05 m/s²), jump (1.42 m, measured apex within 0.05 m) and run (4.41 m/s). T cycles the five cameras as far as today's codes reach them (chase, first, orbit, iso, topdown), P the two looks (`look:playground-cel`: toon bands with a rim, inked; `look:playground-pixel`: 3 px blocks with a rim, 24 shades, dithered), a click takes the pointer for mouse look, M the menu. The replay playground-gym (540 steps: run, jump onto the 1 m wall, drop, weave between the fences and climb walls) holds in Node ×3, Chromium ×3 and the page ×3; tests/e2e/playground.spec.ts (4 tests) cycles every camera in both looks while the player runs with 0 pipelines after the warm-up, and plays the replay through every camera and both looks to its goldens. Calls: slide ramps are drawn as the smooth wedge their hull collider is (engine/gfx/level/ramp.ts, recipe `ramp`), since a flight of steps over a slide lies about the surface; the README checks are shared (tests/unit/readmeClaims.ts; box-readme.test.ts runs them); the playground stays in this repository, out of a game (tools/game/files.mjs); its levels are text written from TypeScript data, not .txt files, so a number moves the block, the sign and the test together; `bodies/` comes with WP 13.2, `sounds/` with the sound WPs. Found and fixed, both by the page replay's cold-pipeline advice: (1) every restart (a seed, a replay, a restore) re-read the world by capturing no actors first, which disposed each puppet and made it again, and r182 names a skinned mesh's bone buffer in its shader, so the new one built its shadow pipelines in the first drawn frame (one a shadow-casting light; the box's torch-lit room built two): a puppet given up now waits as a spare for the next actor of its build and body (engine/gfx/puppets/actors.ts and its test), so a restart or a respawn makes no new mesh; (2) `__engine.replay` started the replay's run with fresh settings, dropping the page's view settings, so a replay snapped the look to `look:clean` and warmed up again: a replay's run keeps the view settings that differ, which never change play (engine/app/headless.ts and its test) |
| 13.2 | The player's body | A | done | 2cab6c9 (#22) | Built `build:adult` (1.80 m on Drillis and Contini's shares: thigh 0.44, shin and ankle 0.51, arms 0.30 and 0.29 so the source builds' grips never fold an elbow flat) with the new build field `plantedStride`, which lowers the pelvis just enough for each planted sole to be in reach at full stride (engine/anim/locomotion.ts `plantedHeight`; false for the source builds, whose vectors and goldens stand); `body:player` (labs/playground/bodies/player.ts): a teal jacket with dark upper sleeves and collar, an orange yoke with shoulder caps, cuffs and pack flap as the one accent, charcoal cargo trousers with knee pads and a belt, brown boots with dark soles, gloves, short hair, a face and a pack, each garment in two tones, its slots the neighbours' to vary; the playground's player on it with Apex's hull (1.83 × 0.82 m; the gym replay re-recorded for it). The anim QA reports the adult under its own ids (`adult/…`, tests/baselines/qa-anim-adult.json, 59 entries, each with the source builds' cause; 13 worse from the planted soles and the longer feet, for WP 13.10's stance locks to tighten). Found and fixed on the way, each with a test: free hands kept their wrists' rest rotation, so gloves jutted from the hips (`relaxHand`); `x sheet --build` drew chibi's bones (`sheetFor`); the ID pass drew the sky's dome and backdrop at their real size over the gym (`userData.background`, reason `background`); the cel outline inked the dome's box edges across the sky (the MRT writes the background's normal for them); the cel look's 2 px black ink covered the accent where the isometric and top-down cameras draw the player 11 to 15 px tall (now 1 px, a 0.35 tint, sharp creases only, and the yoke grew flattened shoulder caps, 6.3 cm tall and no higher than the yoke, standing 3.6 cm out from the sleeve: 1 and 0 orange pixels on the player became at least 8 in every camera, counting only the accent's lit and middle bands). tests/e2e/playground.spec.ts holds the accent at 6 or more in every camera of both looks and checks the parts view against the ID pass. The visual reviewer passed the body, both looks from five cameras and the adult's state-matrix sheet on its fifth round (ADR-0025 amendment 2); not judged: the chest-riding caps under a raised arm (every frame is the idle pose), for WP 13.11's traversal review |
| 13.3 | Movement profiles and the Apex model | P | done | 44a1f2e (#22) | Built the registry kind `movement` (engine/physics/movement/profile.ts: `defineMovement`, `getMovement`, `listMovements`; a profile sets the controller's settings and, for the shooter model, its numbers, which a spec's `model` can tune field by field) and the shooter model, ported from er-apex's reconstruction of Apex's code (model.ts: its numbers, Apex's as the defaults; ground.ts: GetAccel, Decelerate, Accelerate, the stick curve and the sticky sprint; air.ts: Quake's air acceleration, the lurch, jump fatigue, the bunny-hop cost and the fall stun; steer.ts: the tick in Apex's order), which `stepCharacter` runs for a character with a model, its state in the component `motion`. `movement:apex`: a medium legend's hull, 0.56 m steps, slopes to 45.57°, 19.05 m/s², a 1.42 m jump with 0.2 s grace; `movement:platformer`: today's controller, the same character down to its hash. Measured on the feel course (moved to engine/sim/feelCourse.ts; `node x sim labs/playground/scenes/gym --feel` prints it): run 4.41 and sprint 6.60 m/s armed, 5.07 and 7.59 holstered, walk 2.20, crouch-walk 2.03; 0.13 s to 90% of the run, 0.83 s from the run to the sprint, 0.22 s from a sprint to a stop; a 1.422 m jump, 0.426 m when tired; a strafed sprint jump gains 0.158 m/s; a lurch changes 4.60 m/s: each within docs/PLAYGROUND.md §3.2's tolerance (feelCourse.test.ts), and R5Reloaded's acceleration trial tick for tick (ground.test.ts). The playground's player moves on `movement:apex`, empty-handed (holstered), on Apex's movement keys (`actionMap:playground`, labs/playground/controls.ts: Shift sprints, Left Alt walks, C crouches; createEngine's new `actionMap` option). 22 replays keep their goldens; the gym's, whose player now moves by the model, re-recorded (Node and Chromium ×3, the page ×3, no warnings); tests/e2e/playground.spec.ts 5 passed. Calls in ADR-0025 amendment 3: the jump at √(2gh), the lurch's 22.5° key rule, the sprint's side dip, walking blocks the sprint, the coyote time and buffer kept, holstered by default, the table's run-to-sprint time corrected to 0.83 s. Verifier review: pass, its follow-ups done: er-apex's side and back speed scales as `gaits.side` and `gaits.back` (1); the lurch's new key read in the keys' frame (`cam`, else `look`: `CharacterInput.frame`), so a view turning alone never lurches; `spawnActor({ holstered })`, `measureFeel({ holstered })`, and `__engine.feel()` measuring an actor as it is (the gym's player: 5.07 m/s); a character with a model stepped without its motion state is `PHYSICS_BAD_ARGUMENT`, never the platformer's steering; the crouch on C, not Left Ctrl (Ctrl with W closes the browser's tab); er-apex's MIT notice in engine/physics/movement/NOTICE, which lean/LICENSE carries; new tests (model.test.ts, the air cap, the side and back scales, actors' model intents and frames, x sim's motion line, explicit ±2 cm checks, the page's Shift sprint) and a second replay, playground-moves (960 steps: the sprint held and kept by a press, a tired hop, the walk, the crouch-walk, a lurch, an air strafe from 7.59 to 7.79 m/s and the bunny hop's cost back to 7.59; Node and Chromium ×3 agree); the gym's replay re-recorded once more, its character's data holding the two new scales (its path unchanged); the page's `look` for the sprint's view left to WP 13.9 (its Build says so) |
| 13.4 | The feel kit | T | done | a668c28 (#22) | Built the registry kind `course` (engine/dev/feel/course.ts: a scripted run of a scene, as a replay holds one, and the measures read off it, each against its reference and tolerance; the move's metrics speed, topSpeed, speedGain, velocityChange, apex, height, distance, time and grounded, the animation's footSlide, pop and handGap, a camera's cameraJump, cameraTurn, cameraInside and cameraLost), `runCourse` (run.ts: the course in a session of its own, its hash the replay's, the animation posed as the page poses it, anim.ts, each camera stepped as the page steps it from its first frame, camera.ts), `node x feel <lab> [--course <name,…|all>]` (tools/cmd/feel.ts, each course into out/feel/<lab>-<name>/report.json), the live tuning (`movement.<group>.<field>` settings for every number of the model, engine/physics/movement/settings.ts, stepped by actors.ts), the feel panel (engine/dev/feel/panel.ts over `__engine.tune.settings()` and `tune.profile()`, engine/app/feelMember.ts; Copy as profile, profile.ts; Save the replay) and `placeActor` (a scene's dev action: the gym's `place`). The playground's courses (labs/playground/courses/): strip (to the run 0.133 s, the run 5.068 m/s, from it to the sprint 0.867 s, the sprint 7.595, the stop 0.25 s), jumps (1.4223 m, tired 0.4265, rested 1.4223, the walk 2.534 and the crouch-walk 2.337 m/s) and air (the lurch 4.601 m/s, the strafe's gain 0.1996 m/s, the hop back to 7.595), with no pop and every camera's bounds (at most 7 cm a frame beyond the player against §4's 30 cm, no turn, never inside, the player never lost but in first person): 76 measures, all within their tolerances; the feet's slide watched until WP 13.10 (0.36 m a contact at a run, 0.53–0.73 sprinting: the touchdown and the lift-off slide, mid-stance holds within 3 cm). The anim QA's Track, pops and footSlide moved to engine/anim/motionMetrics.ts (with worstPop and worstSlide), the character's body to engine/physics/characterBody.ts. F opens the panel in the page (`?playground.feel=on` at the start; labs/playground/feel.ts); the e2e sets the run's slider and the player runs that fast, and the copied profile holds the number. 24 replays keep their goldens. Calls in ADR-0025 amendment 4: watched bounds, the holstered references, the `tune.*` members, first person's `lost` with WP 13.12's arms |
| 13.5 | Crouch and slide | P | done | 1981a68 (#22) | Ported er-apex's duck and slide (engine/physics/movement/crouch.ts, with their parts of ground.ts, steer.ts and the jump): the duck in whole milliseconds (the hull down 25 ticks after a press, up at once, standing 200 ms later; crouch spam never shrinks it; standing waits for headroom; hold, or `crouchToggle`), the slide from a sprint (boost +3.81 × 1.15 to 11.68 m/s, cooldown 2 s from each slide's start, 2.54 m/s² and × 0.7 a second, 10.16 let go or pushed against, sideways steering, the pull g · n_y in two halves, 10 m/s a metre stepped up, the end below 3.18 m/s into a crouch, sliding on above 8.89 with crouch let go), the slide-jump (1.27 m, the dead slide, the long jump) and the landing slide; the model's `crouch` and `slide` groups, live settings but `crouch.jump`. The hull is the capsule's own (engine/physics/hull.ts: `setHalfHeight`, the feet kept on the ground, the centre in the air), read back exactly when standing, so the 22 goldens outside the playground hold; `movement:apex` opts into `stepFrom: 'contact'` (a fast move steps up instead of stopping dead) and `stayOnGround` (over a crest it keeps to the ground). The gym's crawl: a tunnel 1.4 m clear and a bar 1.3 m up (fixed props on glyph walls and posts; docs/PLAYGROUND.md's 1.0 and 1.2 m never fit the 1.19 m crouched hull). Courses (references §3.2's rules stepped at 60 Hz): slide-flat (the boost 11.573 vs 11.6, let go −0.892 m/s in 4 ticks, no boost 7.508 twice, boosted again, the slide 1.700 s, the crouch-walk 2.337), slide-ramps (5° 2.183 s, 10° 2.450, 20° 2.783 vs 2.767, 30° 2.967 vs 2.950 gaining to 12.43 vs 12.47, up 30° 0.983 vs 1.0), slide-jump (1.273 m, 9.980 m/s kept, the dead slide 7.153, the long jump 8.890) and crawl (2.337 in the tunnel, still 2.337 crouch let go under the roof, running 5.068 out, 7.709 just past the bar); 7 courses, 329 measures within their tolerances; the crawl's shooter camera watched until WP 13.8 (inside the roof 208 frames). The feel kit: change-points out of step order refused, `place`'s speed, the stance and the slide in a sample and four new `until`s, bounds per labelled run. The playground's replays re-recorded (the motion state grew; the moves replay gained a slide and a slide-jump), Node ×3 and Chromium ×3 agreeing. Calls in ADR-0025 amendment 5 |
| 13.6 | Mantle, wall-climb and the superglide | P | done | 69692a8 (#22) | Built ledges by casts (engine/physics/ledge.ts: `findWall`, a steep wall within the probe's 0.61 m of the hull; `findLedge`, a walkable lip above a step and within the reach, a landing a radius and two skins in, and the mantle's path, to the wall, up past the lip, across and down, cleared for the hull standing else crouched; `ledgePath`), the model's questions to the physics (engine/physics/room.ts: `roomOf`, `fitHull`), the mantle (engine/physics/movement/mantle.ts: the auto mantle holding jump on the ground to 2.03 m and the mantle from the air to 2.49 m over the feet, derived from Apex's 273 u highest ledge; push and view within 50°; the grab 27 ticks then the pull 18, a ledge to 1.07 m only pulled; the feet moved straight along the path, `Steering.path`; the hang with the lip 1.52 m over the ground; back or crouch letting go; the mantle hop; the exit at the gait it came in at; the 0.25 s cooldown; into a crouch where only that fits), the superglide (a jump in the pull's last 9 ticks, a crouch the next: 13.67 m/s from a holstered sprint, Apex's 540 u/s within 0.3%; less the slide boost within its cooldown) and the mantle boost (`movement.mantle.boost`: the model's switches are settings now), and the wall-climb (climb.ts: the climb space and its foot, the catch touching the wall, up at 5.72 m/s, the stop at the catch + 2.54 m or the foot + 3.73 m and the end boost's 0.71 m, the top-out into the grab, letting go, the 1 s timer, the wall-bounce by zone, the reattach rule). Courses (labs/playground/courses/): mantle (the 0.5 m wall a step; 1 m pulled in 0.3 s; 1.5 and 2 m grabbed 0.45 s then pulled; 2.1 m refused from the ground, taken from the jump a tick later; each on its top, leaving at the run 5.07), fences (0.6 and 0.9 m pulled, 1.2 m grabbed, sprinting out at 7.59), climb (3 m from the jump, 4 to 6.9 m climbed and topped out, at 5.715 m/s on the 5 m and higher walls (the 4 m one tops out first), 6.9 m by the end boost, 7.2 m refused at the boost's apex 4.445 m; bounces: mini 4.775 m/s away and 0.7165 up, green 6.553 and 1.098 up, neutral 6.553 keeping the climb's 0.857), hang (a second's hang, the feet still, then up; none under the 1.5 m lip; letting go drops it), superglide (13.67 m/s, three near misses at the sprint) and mantle-boost (13.67 m/s, rising 1.42 m): 13 courses, all within their tolerances, the shooter's camera topping out the 4 to 6 m climbs watched until WP 13.8 (1.1 to 1.2 m a frame). The feel kit: `duration`, `topRise`, `standHeight`; the mode and the phase in a sample, five new `until`s. tests/replays/playground-climb.replay.json (a superglide, the 6.9 m climb, a hang, a green bounce) records Node ×3 and Chromium ×3 agreeing; the other 24 goldens hold (the playground's two re-recorded once, for the motion state's new fields). Calls in ADR-0025 amendment 6; docs/PLAYGROUND.md §3.2's mantle, hang, superglide, climb and wall-bounce rows say what was built (the zones over the climb space's foot, not the catch). Verifier review: fail on two bugs, both fixed with tests that fail without them: a mantle hop at the wall with forward held was caught again at once by the climb and re-mantled (no climb now within the mantle's cooldown, and a catch that tops out at once mantles), and the ledge's casts left the path's last leg, down onto the landing, unswept (a cap over a thin wall let the hull through); and its notes: the reattach rule's dot clamped (a chimney's far wall), no catch on a push too weak to climb on, the tick that steps off onto the top a ground move for the controller too, `handsOf` for the hands on the lip, the courses' hang still across and their near misses hopping; re-review on the fixes: pass |
| 13.7 | Ziplines, ladders and launchers | P | done | 0b47372 (#26) | Built rides as world data the sim hands the model (the physics may import only the core and Rapier): engine/world/traverse.ts (the specs `zipline`, `ladder` and `launcher`, their checks, `levelLadders`: one ladder on each run of the engine's new ladder glyph `|` along a face, against the neighbour standing highest, up to its top), engine/sim/rides.ts (the components, `addZipline` with fixed poles on the feet its spec names, `addLadder`, `addLauncher` with a solid one's box, `addLevelLadders`, `ridesOf`), engine/physics/movement/ride.ts and ladder.ts (the modes `zipline`, `ladder`, `skydive`; launchers for any character, model or not) and engine/gfx/stageRides.ts (cables, poles, the balloon, rails and rungs, pads, the trampoline). Measured (courses, 60 Hz): ziplines caught by use at once, 10.16 m/s² to 15.24 m/s (12.19 vertical), 25.4 m/s² jumping on, the 40 m line ridden in 3.29 s, a jump off keeping 15.07 m/s across or leaving a slow ride at 11.30 m/s, a full jump up, a crouch dropping at the ride's velocity, three catches a jump; the ladder at 2.2035 m/s up and down, pulled over its top with no grab, from its top with use 1 m down, a jump off 3.048 m/s away rising 0.50 m; the jump pad 6.50 m, the trampoline 2.00 m and 0.9 of a fall's speed back (5.61 m over the mat from the jump's apex off the tower); the balloon's line at 12.19 m/s, the skydive gliding at 20 m/s, steered at 12, diving at 35, the landing pose at 29.8 m (≤ 30), touching down at 6.10 m/s, no stun. The gym: the tower's ladder (its north face), its 40 m zipline (a pole on its top to the south wall), the trampoline against its west face, the jump pad in the open, the balloon 90 m up. Courses zipline, ladder, launcher and skydive pass (17 courses, every number within its tolerance); tests/replays/playground-rides.replay.json (the ladder and over the top, the zipline, the pad, the balloon and its skydive) holds one golden in Node ×3 and Chromium ×3; the playground's three other replays re-recorded (the motion state grew; the rides are entities), the other 22 goldens hold; the compiled levels' goldens re-recorded for the glyphs' new field `ladder` (with it left out each gives its old hash). The playground binds use (`interact`) on E and the pad's X. Calls in ADR-0025 amendment 7: the hands 2.03 m over the feet, use's 1.52 m reach, the air's 0.61 m, a ride 0.61 m short of each anchor or the hull's first contact, the way by the view's direction and pitch, the jump off's cap at max(11.3 m/s, the ride's speed across), half the speed kept at an end, the skydive's numbers (21 m/s² braking: 20 left a 35 m/s dive at 6.7 m/s), the ladder's, launch heights exact from the launcher's top, pole feet given (Rapier's queries miss bodies added in the same setup). Watched until WP 13.8: the shooter's camera by the tower's pole (4.9 m) and every camera catching up after a 20 m fall (0.33–0.36 m a frame). engine/physics/carry.ts split from character.ts (at 400 lines); engine/sim/movementApi.ts holds Phase 13's movement API (sim-api.ts at its cap) |
| 13.8 | Camera modes | R | done | 8ec03dd, edd3043, a9057b6 (#26) | Built the five modes as codes (docs/PLAYGROUND.md §4): first person (`cam3=first`, at the shooter model's eye, 1.524 m standing to 0.8128 m crouched, never 0.2 m behind it, the player's lens), the shooter (`cam3=shoulder`, engine/gfx/cameras/shoulder.ts: 0.5 m right, 0.3 m up and 3.8 m back from the eye along the aim, X swapping the shoulder by its code, the sights pulling the arm in to 1.5 m, a short room behind the eye drawing the shoulder in), the platformer (`cam3=follow`, follow.ts: 5.5 m and 20° down, recentring after 1.5 s at up to 1.5 rad/s, 1 m look-ahead, the ±1.5 m dead zone, a lift over a slope that cuts the arm), isometric (`cam=iso`) and top-down (`cam=overhead`: straight down, north up, whole zoom steps, on its pixel grid). The rig (engine/gfx/cameras/rig.ts), which the view and the feel kit step: switches blended over 0.35 s when asked (T, X, a view's turn, `camera.set(code, { blend: true })`; a plain set cuts, so a shot after it shows it), about the target, orthographic and perspective meeting at a matched frustum (blend.ts); Apex's view effects by the player's state (effects.ts: the sprint's 0.15 m drop and 2° roll, the boosted slide's ×1.1 lens and 15° roll, the punch of jumps, landings and grabs, the 0.4 s bob, the sights' 55°-at-70° zoom, landing shake, a weapon's kick); the view settings `cam.fov` (Apex's horizontal degrees at 4:3, 90), `cam.blend`, `cam.effects`, `cam.wholeZoom`. Collision (collide.ts): the shooter's and the platformer's cameras move on as a ball at a pace and never stand in a wall (carried with the arm, in at up to 10 m/s, out eased, slid along walls, kept in the arm's base's sight, homing when stuck; cut only when the player is put elsewhere or the level moves into them), and the cutaway's new fade hides the block pieces and the rides' meshes between them and the player. A game adds its own mode (`defineCamera`, `followCamera`); the factories are public (engine/gfx/cameras/api.ts). Every course keeps every camera's bounds (the watches of WP 13.5–13.7 lifted; the launcher's drop and the ladder's descent look down); the soak course `cameras` blends through the five modes twice round a square by the north wall (0.08 m and 1.3° at worst, never inside, never lost outside first person), and `camera-walls` holds the shooter and the platformer to the four bounds where they meet the level (the look tilted ±1.2 rad on open floor, a run and a jump along the perimeter wall, a run past the climb walls' edges); tests/e2e/playground-cameras.spec.ts: each mode renders the player, the blends and the swap, the rides replay's goldens while blending, 0 pipelines, the sprint's eye drop. No golden changed. Calls in ADR-0025 amendment 8 (the blend on request, collision at a pace, the fade hiding, the eye heights the cameras' until WP 13.9). Verifier review (8ec03dd): fail. "Never jumps" held only on the courses: fuzzed play (80 random 3 s runs a seed, the look within ±0.8 rad) jumped 1.3 to 11.3 m and put a camera outside the perimeter wall, and the look 1.2 rad up sent the arm's end under the floor. Fixed: collision reworked (a target only where a sweep from the arm's base meets no floor or ceiling, the camera kept in the base's sight with 0.2 m to spare and never brought down behind a wall's top, homing at a pace when stuck, the base's step capped at the player's move plus 10 m/s, only the look's turns carried), the course `camera-walls`; and the notes: the camera metrics allow the look only to `LOOK_CAMERAS`, read off the look intents (a cut between views now counts), the rides drawn in run views at last (WP 13.7's miss: the stage took only the kinds a scene places) and faded by their meshes 0.25 m thick or more (`FADE_THIN`, so the line ridden stays), the landing shake by the punch's share, the rig's `kick`, `GFX_BAD_GAME_CAMERA` for a game camera's `create` that returns none, X only on the shooter, the soak's lost spans explained. Four fuzz seeds now: 0.26 m (shooter), 0.28 m (platformer), 2.1°, never inside; the shooter loses the player's chest in 4 to 5% of random frames, mostly pulled in against a wall (open issue, docs/PROGRESS.md). Files beyond the WP's list, each a small integration: engine/index.ts (the cameras' api re-exported whole), engine/gfx/cameras/pose.ts, engine/gfx/{stage,stageRides,cutaway}.ts, engine/app/{headless,playback,view}.ts, engine/dev/feel/camera.ts, labs/playground's main, menu, views and README, its courses (climb, crawl, ladder, launcher, zipline, bounds, camera-walls, courses.test), tests/e2e/playground.spec.ts. About 2,900 lines added with the tests, past L's 2,500 counting them. Verifier review 2 (40ff9e5): fail, two cases its fuzz found. A camera over a wall's top and about level with the base, or in sight with no room to spare, could still sink behind the wall as the player fell (outside the gym on seeds 4, 5 and 7); and the look held 0.9 rad up or more on open floor lost the player for about a second, the sight room grazing the floor, which camera-walls missed because its open-floor spot stood by a wall. Fixed as the review proposed and validated: out of sight, a leg goes down only to where it sees the base again; in sight without room to spare, it keeps plain sight; a floor or a ceiling grazing the room is no loss of sight. Two unit tests fail without the first two, camera-walls' open-floor leg moved to open floor by the spawn (57 lost frames without the third), and a fourth leg jumps beside the east wall with the camera over its top (never lost until the landing; the second after it is the open issue's). Also: camera-walls in courses.test.ts's runs, a rig-level test of the kick. The review's own fuzz on the integrated fix (seeds 4, 5 and 7, 80 runs each): never inside, jumps at most 0.27 m, turns 2.1°, no frame behind a perimeter wall but the run where the player climbs out of the gym; the shooter loses him in 649 to 725 of 14,400 frames |
| 13.9 | Controls for every camera | I | done | 28a9830 (#26) | Built an action map per camera mode (labs/playground/controls.ts: `PLAYGROUND_MAPS`, `playgroundMap(code)`), Apex's default bindings where the browser allows (Space, Left Shift, Left Alt, C, E, V, the mouse buttons, R, 3; T and the view button switch the camera, X and the d-pad's left swap the shoulder, Q and E and the d-pad's right turn isometric, where G uses); `createEngine({ actionMap })` takes a function of the camera's code and swaps the map (`Input.use`) as the camera changes, `onView` hears the maps' view actions (never sent to the sim, every press heard), and `Engine.input` gives the page the input (prompts, rebinding: the HUD's keys follow the map in use, the menu lists the opening camera's). Mouse look under pointer lock (a click takes it where the map's `lock` says, pause gives it back), scaled by the view settings `input.sensitivity` (Apex's 0.022° a count, 5), `input.adsSensitivity`, `input.invert` and the stick's three (engine/input/look.ts), replacing `createInput`'s `lookSpeed` and `invertY`. The aim (engine/input/aim.ts): a map's `aimWith`, `centre` (the screen centre's ray through the sim's queries, the player's body skipped, nothing between the camera and his eye counted) or `pointer` (the free pointer onto his floor, a pushed right stick as twin sticks), worked out by the view from the camera drawn (`RunView.aim`) and recorded with the intents. Sprint and crouch hold or toggle by the recorded settings `input.sprint` and `input.crouch` (players only; the defaults change no golden). Tests: aim.test.ts, look.test.ts, input.test.ts (the map switched live, view actions, the aim by rule, the look scaled), bindings.test.ts (view and aimWith problems), actors.test.ts (the two settings), view.test.ts (the aim from the camera drawn), the playground's controls test (every map passes the bindings tests), views and feel tests; tests/e2e/playground-cameras.spec.ts: in each of the five modes, live play through its own map records the look and the aim its rule gives and replays in Node to the page's hash; playground.spec.ts's sprint test runs on W, along the view the shooter now sends. Files beyond the WP's list: engine/input/{look,api}.ts (engine/index.ts re-exports the input whole, at its line cap), engine/app/view.ts, engine/physics/{character,movement/ground,movement/steer}.ts (the held sprint), labs/playground's controls, main, menu, views, their tests and README, docs/GAME-GUIDE.md. Calls in ADR-0025 amendment 9 (a map per mode with its own bindings, view actions, the aim worked out in the page and recorded, Apex's look units, the hold-or-toggle settings recorded, isometric's Use on G, the pad's held reload and holster deferred) |
| 13.10 | Locomotion animation | A | done | c34df3e, b172c1f (#26) | Built the playground player's locomotion on the procedural humanoid, planted (ADR-0025 amendment 10): engine/anim/locomotion/planted.ts (`plantedDuty`, 0.62 of a cycle walking to 0.3 running and 0.24 sprinting, `footCycle`, `plantedStep`, `plantedEase`: a foot travels back exactly as far as the body goes in its stance and swings on a half cosine, lifting early with its knee kicked up, `plantedKnee`; a run bobbing low through its stances and up into its flights, `plantedBob`) under the build flag `plantedStride` (build:adult: its stride 0.5 m, a sprint's share 1.25, a crouched stride 30% shorter, keeping a walk's stance share, and a sideways one 35%, the sim telling the animator its movement model's duck as the pose `crouch`, so the four playground replays were re-recorded, their runs unchanged and only the player's animator phase differing; a walk back steps along the move's unit vector (`plantedMove`); its arms swing against its legs, a sprint leans, a strafe's crossing foot passes ahead); stance locks (locomotion/locks.ts `holdFoot`, `onFeet`, `FOOT_LOCK`: a foot locks where it lands keeping its heading, lets go over 0.05 s or at once, holds a push-off on its level, steps back standing still, rides a treadmill, drops when carried away); the foot plant on the physics ground (`queryGround` over the sim's query view for the puppets and the feel kit, within a slope band of the body's floor, left in the air; a held sole never moved onto another level, a lifting sole over lower ground following the body, a free foot out of the leg's reach rising over its place; a foot on its feet rolling on its ball and its heel in the leg's solve and the plant alike, engine/anim/footRoll.ts and authoring.ts `solveLeg`, the ankle allowed 15° up and a quarter of the knee's bend more in a stride, `ankleLimit`; a swinging foot as level as the ankle allows, its toes kept 1.5 cm over the floor, `clearToes`; a stance foot whose heel a deep dip lifts standing on its ball; the knee bending as the animation bends it, the leg straightening as far as a lock holds the foot out; a lifted foot easing the pelvis's cap in and out, `plantedHeight`); the view's movement poses (locomotion/motion.ts `MovementPose`, `plantsFeet`; locomotion/shown.ts: the crouch, the slide, the rise and the fall, the landing's dip soft or hard and unwinding off the ground, the lean and the bank, set on `Humanoid.shown`, never hashed); the plant's weight from the clips (clipsets.ts `legsHeld`); eleven movement states in the state matrix (locomotion/matrix.ts, `motion:*` in the anim QA and `x sheet`, a script's yaw). Measured: every playground course's planted feet within 5 cm a contact (worst 1.24 cm, the 0.5 m mantle wall's step-up; 0.36 m at a run before) and no pop past 9/16 m (worst 0.48 m, the superglide a tick late; the launcher's braking stop after the pad popped 0.71 m before its fixes), the courses' watch on the feet removed; every movement state's swinging toes 0.9 cm or more over the floor, a run flying 41% of its frames and a sprint 51%; the anim QA within the adult's baseline, 11 entries gone, 38 tightened and 10 as they were, none loosened or added, three still above the source builds' and accepted (the roll's foot slide, the axe kick's twist jump, the face-down fall's under-floor: amendment 10); the eleven sheets reviewed over five rounds, all passing (visual-reviewer; the last round drew the crouch-walk with 16 frames; `x sheet motion: --build build:adult --svg` hashes 7f3ffb585010f387). Tests: planted, locks, motion, shown, matrix (the swings, the flights, the strafe, the landing), footPlant (the physics ground, the locks, a treadmill, a run up onto a box), humanoid, poses, clipsets, the feel kit's anim, the puppets' actors. Files beyond the WP's list: footRoll.ts (new), authoring.ts, locomotion.ts, api.ts, poses.ts, stateMatrix.ts, builds.ts, clipsets.ts, engine/sim/actors.ts, engine/dev/feel/{anim,run,course}.ts, engine/gfx/{stage,puppets/actors}.ts, engine/app/view.ts, tools/qa/anim.ts, tools/cmd/sheet.ts, labs/playground/courses/bounds.ts and README, the playground replays' goldens and tests/replays/README.md. Calls in ADR-0025 amendment 10 (the planted stride before the blend sets, locks for planted builds only, the physics ground, the view's movement poses, the head and eyes to WP 13.11, a riser crossed by a foot leaving at its base left for a playtest, the crouch-walk's rear knee within 23 cm of the floor). Verifier (L): failed on two counts (the stance-lock test had lost its socket check; three adult QA entries above the source builds' without a recorded call), fixed in b172c1f, then passed on re-verification, its notes settled in 4df7aa9 |
| 13.11 | Traversal animation | A | done | 37dd599 (#26) | Built the actions on actors (engine/sim/actorActions.ts: the component `actions`, saved, hashed and restored with the actor, `actOn` in the sim API, stepped before the animator, its events emitted as `action`; all 28 actions play on an actor to their ends) and the player's traversal on the procedural humanoid instead of the clips, which wait for WP 8.8's contacts (ADR-0025 amendment 11): engine/anim/traversal/ (contacts.ts: where the hands and feet touch, a mantle's lip and `mantleHold`, a ladder's rungs `ladderLimb`, a climb's holds `climbCycle` and `wallPoint` a toe's reach off the face, a zipline's cable `cableGrips`; pose.ts `TraversalPose`: the view's eased ways from the shooter model's state as plain data, its own copy, the body drawn toward a lip as far as the hands need and under them in a hang; plant.ts `TraversalPlant` at the end of the `post` slot: the skydive's tilt and a low ledge's lean about the pelvis, the free limbs of each way, the limbs solved onto their contacts (the elbows by where the hand is, a foot level on a hold), the grab's right foot and the pull's left up the face and over the lip, the slide-jump's long-jump legs, the hard landing's hand flat on the floor with the spine bent to reach it; clear.ts: each leg kept out of a mantle's face and a climb's wall, its knee swung out; hold.ts `HoldPlant` and `LookPose`: the head and eyes to the look, a gun at low ready, down the sights through the right eye, across the body at a sprint (a run is not one), the support hand on the handguard within reach; matrix.ts: ten states `traversal:*` and `hold:*` in the anim QA and `x sheet`), the foot plant faded out as far as a way holds the body (`FootPlant.reset`), the puppets and the feel kit posing it (the ride, the hull, the player's look). Measured: `handContact` in every course's body bounds (labs/playground/courses/bounds.ts, 3 cm; a traversal span `holds`, failing if no hand held): the 19 courses' 1321 measures pass, the held hands on their contacts to the IK's precision, no pop past 9/16 m (worst 0.48 m, the superglide a tick late, WP 13.10's) and the feet planted within 1.24 cm (WP 13.10's; a trailing foot pulled through a wall's top had slid 4.5 cm); leg joints more than 2 cm inside the gym's solids (a scratch probe of its heights): 49 joint-steps over the wall courses, against WP 13.10's 83 and this WP's first build's 995, every one left WP 13.10's; the anim QA within its baselines (1420 checked, none new); the ten sheets reviewed over three rounds, all passing (visual-reviewer: round 1 failed seven, the knees and toes through the wall, the hang off its lip, the ladder's elbows level with the hands, the slide-jump unplayed in its state, the sights 0.28 m under the eye, the sprint carry turned out, the zipline landing's hand; round 2 four, the reach through the face, the elbows in it on a resumed pull, the knees in the lip's corner, the climb's let-go knee and fingertips, the sights off the eye; round 3 none, leaving for the playtest the stepping knees swung wide, the pull's hands off the top as the hips reach the lip, a ladder knee at the rung plane at a stop; `x sheet traversal: --build build:adult` hashes ef2fccb18b3b4e55, `hold:` 264b237c2b94e741). Tests: contacts, pose, plant (the hang, the wall), hold (the sights, the carry, a run), matrix (every contact within 3 cm at both facings, the muzzle within 2°, the slide-jump flown), actorActions, the puppets' actors (a roll, a zipline), the courses. Verifier: failed once (a call's events carried in a cached `Actions` into the next step, so a capture between them restored without them; now emitted from the call, nothing cached, a test restoring every capture around a game system's call), passed on its second run, its open issues taken (the actions declared with the actors' kinds, a call that changes nothing adds nothing, a blended limb never held, the spans that hold); left: the muzzle bound waits for WP 13.20's gun, and plant.ts, sim/actors.ts, gfx/puppets/actors.ts, qa/anim.ts and pose.ts sit at 392 to 400 lines, so the next change to one splits it. Files beyond the WP's list: engine/sim/actorActions.ts (new), engine/sim-api.ts, engine/anim/footPlant.ts, engine/dev/feel/{anim,course,run}.ts, engine/app/view.ts, labs/playground/courses/ (the bounds and the traversal courses), tools/qa/anim.ts, tools/cmd/sheet.ts, docs/GAME-GUIDE.md, docs/PLAYGROUND.md §5.1. Calls in ADR-0025 amendment 11 (the procedural body for the clips, the gun ahead of WP 13.20, the clearance and a low ledge's wall, the elbows, a run not a sprint, the landing hand and the touchdown left as WP 13.10 built them) |
| 13.12 | First person | R | done | dd7e53d (#26) | Built first person's arms by a lens of their own (ADR-0025 amendment 12): engine/gfx/viewmodel/lens.ts (`armsDepth`: their depth past their 0.1 m near plane squeezed 0.15 m per metre in front of the picture's near plane; `armsSpread`: Apex's 70 at 4:3 against the picture's lens; `drawnPoint`, `inArmsFrame`, `intoArmsFrame`; the view settings `cam.armsFov` and `cam.fullBody`), material.ts (node material copies made once per source with every property carried: the body's folding the vertices its `viewmodel` attribute marks and casting the whole skinned body's shadow, the arms' drawing each vertex by the lens and taking shadows where it really is), rig.ts (`ArmsRig`: the build stood under the camera, its eyes at the eye: fists at rest, the sprint's pump on the gait's phase, the slide's spread, the air's raise, a breath, the effects' weapon bob, a sway behind the look's turn; hands held on a ledge, a wall, a rung or a cable drawn on the contact's ray, a carried gun from the body's eyes; each hand within 0.95 of the arms' frame and of its reach; a kick's leg; `armsInputOf`; `points` for the depth check) and body.ts (`createViewmodel`: the arms a mesh of the body's arm and right-leg pieces posed on the CPU from the rig, since r182 skins after a position node; the body folded for the camera, its shadow whole; the full body as an option); engine/gfx/cameras/first.ts (`FIRST_ARMS`, `FIRST_KICK`, `firstBodyCull`); the actor puppets' `firstPerson(frame)` for `cull` (actors.ts, what it keeps of each actor split into actorLayers.ts), the view's first-person frame (view.ts: `cameraInfo().culled` and `.arms`), the style set's `userData.restyle` (styles.ts) and the toon material's `copy`. Measured: first person's `cameraLost` reads the arms and `cameraClip` (engine/dev/feel/camera.ts, course.ts, run.ts, anim.ts) counts the frames a wall covers them or the near plane cuts them, both in every course's bounds: 19 courses, 1,425 measures, all within their tolerances (both 0 everywhere); drawn at their true depth the arms would be covered in 184 of the climb's 1,531 first-person frames (the mantles' 13, the camera walls' 9, the ladder's 1), through the lens in none, at least 0.306 m short of a wall. Verify: `npm test -- engine/gfx/viewmodel` (4 files, 18 tests) and tests/e2e/playground-cameras.spec.ts (11: the ID pass sees the arms and not the body, as many of their pixels against the spawn's south wall as in the open, the fists pump in a sprint and rise in a jump; 0 pipelines after the warm-up through every mode); tests/e2e/box-hero.spec.ts now expects the hero's body hidden and his arms drawn in first person. Not verified: the cel look's bands on the arms by eye beyond one shot, and the shadow's presence in the page (the wiring is unit-tested). |
| **G10** | **Gate: feel** | | done | 1db0511 (#26) | x ci --local green at 1db0511 on a clean tree, first run, at load average 5-7 (4 min 9 s: check 20.6 s, test 3 min 41 s with 3,914 tests in 375 files; T2 runs in full on main after the merge, ADR-0023); `node x deps --qualify`: no line has qualified beyond the pins (Vitest 4, U-1, qualifies on 2026-10-22, taken between stages). Proven: every course passes against docs/PLAYGROUND.md §3.2 under `movement:apex` (`node x feel labs/playground`: 19 courses, 1,425 measures, none watched; the 85 speeds, accelerations, times and heights within §3.2's own default tolerances, the tightest the slide ramps' 20° and 30° times and the 30° climb, a tick off); the gym plays in the five cameras with blended switches (playground-cameras.spec.ts 11 passed: each mode sees the player, T and X blend over 0.35 s, a plain set cuts, the rides replay keeps its goldens while blending; the cameras course twice round the five, its worst frame 0.083 m and 1.35°; over every course each camera's worst move 0.214 m of 0.3 and turn 2.1° of 4°, never inside, never lost, first person's arms never cut); §5's bounds on every course (foot slide worst 1.24 cm of 5, pop worst 0.483 m of 9/16, a held hand worst 0.96 mm of 3 cm; `x qa anim` 1,420 checked within its baselines, the adult's 59 entries down to 48: 11 gone, 38 tightened, none loosened); every replay's goldens (26 of 26 in Node ×3 and Chromium ×3; in the page ×3 the four playground replays, climb, gym, moves with 18 goldens and rides with 26, and box-1-room; the other box replays are main's full run's, parity.spec.ts); 0 pipelines after the warm-up in every camera and look (playground.spec.ts presses T through the five in cel, pixel and cel again while the player runs: 0, no GFX_COLD_PIPELINE, no advice); the stage's specs 35 of 35. Verifier: the gate review passed, no failures; its eleven notes taken in 1db0511 (the course template `x new course`; WP 13.19's and 13.20's hand-offs; rows 10.6 and 13.10; PLAYGROUND.md's drift, the gym's uncoursed features to WP 13.18; `defineDevAction` public; x feel's tolerances in its report; docsGenerate.ts's example over two modules; the ladder's and the zipline's tolerances at §3.2's defaults; PROGRESS's playtest items; WP 10.9's trigger left for WP 13.25). Open risks: under load a full `npm test` can exit 1 on Vitest's worker RPC timeouts with every test passed (seen at load 9-12; the quick gate ran clean); the feel kit poses apart from the page (PROGRESS). Not verified: the visual reviews (recorded, their sheets' hashes unchanged), the hidden body's shadow in a page, speakers, touch and Vercel (ADR-0021). Escalations: none new. Calls: the owner's playtest checklist (docs/PLAYGROUND.md §9.3, items 1-5 and 7-10 as far as this stage plays them, item 6 waiting on WP 13.16) went out with PR #26's body; G10's row records 1db0511, the commit x ci checked. |
| 13.13 | Storeys: the level format and its colliders | W | done | 56718b0, 280eeb9 (#27) | Built level format 2 (`my3dge-level/2`, engine/world/level/parse.ts): a map per storey after a fenced block of its own (`storey`, `base`, `height`), bottom first, every map the first's size, each base above the ceiling of the storey below (the gap its slab, 0.3 m under the lowest); a format-1 file is one storey on 0 and compiles to the same data and hash (the storey-only glyph fields `void`, `full`, `opening`, `head`, `room` left out of a format-1 legend; the four compiled levels' goldens hold, hall-v1 5a0986e2208bed91, heights 35b301d1dfb2ee62, room 2f9e675348efa089, hall cee47c75670a45ab). Heights by storey (storeys.ts): glyphs on the storey's base, `full` ones (the v1 wall and pillar) up to the floor above, slabs under every tile but void ones, heads (a door's 2.1 m, a window's, the low ceiling's) as solids up to the full top, flights (`<`) from a floor to the next one's toward the side it meets; roofs as the top storey's keys (gable, hip, flat: `roof`, `pitch`, `ridge`, `eaves`), their 0.2 m slabs walked on, the walls under a pitched one clipped to its underside as hulls (roofs.ts); openings (openings.ts) and rooms from markers (rooms.ts: `room:<name>`, floor flooded inside walls and openings, the rooms either side of each opening); the v4 glyphs void `~`, door `+`, window `:`, railing `!`, flight `<`, low ceiling `_`. The compiled level's per-tile fields are its ground storey's; `bounds`, `ground`, `colliders`, `spawns` and `lights` cover every storey; `storeyView(level, k)` reads any storey as a format-1 level, so navigation, drawing and ladders read it unchanged. In 3D (heights.ts): `floorBelow`, `surfaceBelow`, `storeyAt` (by height) and `storeyBelow` (by the surface under a point: a flight's tiles are their storey's to their top), `roomAt` reading `storeyBelow`. Validation (validate.ts, walk.ts) against the shooter model's hull (`LEVEL_BODY`: 0.8128 m across, 1.19 m crouched) and a 45° flight: `LEVEL_NARROW_DOOR`, `LEVEL_LOW_HEADROOM`, `LEVEL_STEEP_FLIGHT`, `LEVEL_UNREACHABLE_ROOM` (the storeys walked as one graph, `walkStoreys`), and the structural `LEVEL_BAD_STOREY`, `LEVEL_NEEDS_STOREY`, `LEVEL_BAD_FLIGHT`, `LEVEL_BAD_OPENING`, `LEVEL_BAD_ROOM`, `LEVEL_BAD_ROOF`; `storeyView` throws `LEVEL_NO_STOREY` for a storey a level lacks. Fixtures: fixtures/levels/storeys/{house,shed,pavilion,annex}.txt (a cellar, a ground floor, an upper floor and an attic under a gable, its flights seven tiles; a shed under a flat roof; a pavilion under a hip; a wall one storey high with a door and a window under void) with their room markers (glyphs.ts), all clean in `node x qa level`. Measured: the bodies stand every floor, head, solid and roof where `floorBelow` says (the four fixtures probed from ten heights through every storey, four points a tile, rays starting inside a solid skipped: every probe within 1 mm); every walkable tile of the four fixtures read on its own storey and in its own room; the controller walks up the cellar's flight to the kitchen floor and the hall's flight to the upper landing, stands on the gable's 35° slope and the shed's flat roof (engine/sim/levelBodies.test.ts). Tests: storeys, openings, rooms, roofs, parse, walk, validate, glyph, traverse, levelBodies, the level QA. Verifier (L): failed on two counts (`floorBelow` missed a head's top under void, 3 m under the bodies; the probe test only ever hit the house's roof), both fixed in 280eeb9 with tests that fail without the fix; re-verified: those fixed, failed on one count (`storeyBelow`, new in the fix, kept the lower storey's wall top under an upper floor at the same height, so 14 tiles were in no room), fixed in the third round (the higher storey wins a tie; a head's top counts only where its solid stands); its open issues taken (`storeyBelow` for a flight's top 0.3 m, which `storeyAt` read as the next storey in no room; the house's landings, reached through one 0.5 m tile narrower than the hull, two tiles deep; the storeys' names in engine/sim/siteApi.ts so engine/sim-api.ts stays under its cap) or left (a railing's collider over its whole tile though drawn as a 6 cm rail, a door's frames 7 cm inside its opening: WP 13.18's house; `wallUnder` up to 0.18 m over the roof's underside near the eaves, inside its slab). Calls in ADR-0025 amendment 15 (roofs as keys, not glyphs; the review's). Files beyond the WP's list: engine/world/level/{shapes,meshes}.ts, engine/world/traverse.ts, engine/sim/levelBodies.test.ts, tools/qa/level.ts, engine/world/level/problems.ts, engine/sim-api.ts, engine/sim/siteApi.ts, fixtures/levels/storeys/ |
| 13.14 | Storeys drawn | R | done | 3f1368f, fefc6a4 (#27) | Built the storeys' drawing (engine/gfx/level/): each storey's descriptors from its view (`storeyView`), bottom first, named `level:<name>/<storey>/<recipe>` with `userData.storey`; the walls up to the storey above, or under a pitched roof the hulls of their merged runs clipped to its underside (walls.ts, three's `ConvexHull`); flights by a 0.18 m riser (flights.ts, stairs.ts taking the step count, `StepCount`: two steps a metre made a storey's flight 0.375 m risers); railings as posts at most 1 m apart and two rails; then each storey's `ceiling` (slabs.ts: a slab's underside, the ceiling of the storey below, and its edges at voids and the map's edge), `heads` (the wall over each door, window and low ceiling) and `frames` (two jambs and a head of planks round each opening, a window's sill, flush with the wall) (openings.ts); the floors of rooms a level entry's `rooms` gives a material (`{ kitchen: 'material:tiles' }`, presentation only); the roof's planes, tops, undersides and edges with their eaves (roofs.ts), UVs in metres in each face's plane (`axesOf`). New recipes `railing`, `flight`, `ceiling`, `heads`, `frames`, `roof`. The stage splits each storey's runs and lays its ground under the lowest slab; a format-2 level's bounds reach over its eaves; `x qa geo` budgets per storey (20 calls and 32 vertices a tile a storey: the house draws in 58 calls with one shadow map over four storeys, 59 with the kitchen's own floor; through the stage's runs it costs 148, the hall 264, and no budget holds the stage's runs yet: WP 13.18's). Measured: tests/e2e/level-meshes.spec.ts, 5 passed: the storey house's parts apart in the ID pass from outside and storey by storey with what stands above hidden, and from the cellar, in the lambert and toon styles with every style warmed, 0 pipelines after the warm-up; the shed's flat roof, walls, door head and frames and the pavilion's hip roof, pillars and crawlspace head under the eaves likewise, each in a page of its own (an ID shot builds pipelines of its own); walls under the roof merged to 168 vertices (4,896 clipped per tile before). Tests: flights, slabs, walls, openings, roofs (a chimney, a glyph whose top stands over the ridge, rises through a gable unclipped: drawn, collided and stood on), meshes (the storey house); the stage's runs per storey checked by a probe of the review's (49 parts, every cell in its run), not by a test. The storey fixtures' compiled goldens re-recorded for the railing's and flight's recipes (never in a replay). Verifier (L): failed on one count (only the house drawn in a page; the shed and the pavilion only by vertex heights and budgets), fixed in fefc6a4. Calls in ADR-0025 amendment 16. Files beyond the WP's list: engine/gfx/level/{stairs,shapes}.ts, engine/gfx/stage.ts, engine/app/view.ts, engine/world/level/{level,legend,compile,types}.ts, tools/qa/geo.ts, tests/pages/level-meshes.ts |
| 13.15 | Sites: storeys and terrain in play | W | done | cd16b9b, d458a8e (#27) | Built sites (engine/world/site.ts): the registry kind `site` (`defineSite(id, { terrain, structures })`, `getSite`, `makeSite`), each structure a level with its map's north-west corner at `at` and turned 0 to 3 quarter turns about +Y, carried exactly between frames (`toWorld`, `toLocal`, `turnVector`, never −0, `quarterTurn`); the terrain flattened round each footprint and cut, a flag per cell, under a storey below the ground floor and the `cuts` a structure names. Queries over all of it (siteQueries.ts): `siteFloorBelow`, `siteSurfaceBelow`, `siteStructureAt`, `siteSolidAt`, `siteClearSight`, `siteRescueGrid` (`rescueLost` reads a grid's `origin`). Bodies: a cut terrain as one triangle mesh of its other cells (engine/physics/trimesh.ts, internal edges fixed; not the plan's chunks: amendment 18), `addLevelBodies` at a place and turn, `addSiteBodies`, `addSiteLadders`. Navigation (siteNav.ts, siteNavGrids.ts): a grid per storey and the terrain, linked by flights, ladders and doorways; a step needs the crouched hull's headroom over the higher of its floors, read at each tile's inset corners; a tile under less than the standing hull costs 2.5 times, crouched (never across a link); ways walk each tile's clear point, off walls as far as the hull needs; `nodeAt` takes a hatch's rim. The bot on a site (engine/dev/botNav.ts, bot.ts): ways with `crouch`, `rise` and `over`; a goal reached only within 1 m of its height; a climb counts as getting on; it lets go of a ladder to go down and pushes nowhere while it falls; `__engine.bot` reads a scene's site. The cutaway by storey (engine/gfx/storeyCut.ts, `cutPlace`): in isometric and top-down every storey above the player's and the roof indoors (in a room, or under the roof's footprint) hidden by `visible`; a site drawn (engine/gfx/stageSite.ts) in groups at its structures' places and turns, each with its cutaway and its cut in its own frame, the terrain drawn with the cut left out (engine/gfx/terrain.ts). Rooms as data: each light names its room (its light group), `roomReverb` picks a preset by volume, the playground's HUD names the room. The lot (labs/playground/levels/lot.ts, scenes/lot.ts; fixtures/levels/storeys/site.ts the same for the engine's tests): the house and the shed on a 32 × 32 m terrain; the house's ladder moved to the study's wall under a 1.5 m hatch (6b2a1e0; the house's golden f3b1585415bee4a1). Measured: both levels validate clean; the bot reaches each of the six rooms from the yard and back, and tours them all in 1,398 steps; over that tour no camera stands inside a wall (the soak course: 0 frames in all five cameras; watched for WP 13.18's house, the shooter loses the player 931 frames and the platformer 255, first person and the platformer jump 0.42 and 0.52 m in a frame); the site's bodies stand where `siteFloorBelow` says within 1 mm (a point in each half-metre square from eight heights), the cellar's stairwell open to its flight; tests/e2e/playground-cameras.spec.ts, 12 passed, and tests/e2e/terrain.spec.ts, 3 passed: the lot's test in isometric and top-down, in each room of the house and in the shed, what stands above the player's storey and the roof hidden (the scene dump) and never seen (the ID pass), nothing hidden in the yard, the player in view everywhere (28 to 206 px), the HUD's room line, 0 pipelines after the warm-up; the stage's ground a frame round a terrain (engine/gfx/stageGround.ts: its plane hid the cellar under the cut), the cut read 10 cm over the feet (a resting body's feet sink a hair into its floor). Tests: site (7), siteQueries (5), siteNavGrids (5), siteNav (4), botNav (4), trimesh (4), storeyCut (4), stageSite (4), stage, levelBodies, rides, bodies, storeys, reverb (one each), the lot (8). Verifier (L): passed, with notes, all taken in d458a8e: the rides' occluder fade had run in each structure's frame against their world boxes (now once, in the world's frame, tested with an offset structure); a shared footprint edge now goes to the east or south structure, as the comment said; `turnVector` gives no −0 for any input; `__engine.bot`'s help names a site goal's height, with a test on the fixture site; a test holds the lot's copies to the storey fixtures; WP 13.18's entry carries the watched camera bounds and amendment 15's leftovers. Its runs: the 27 replays at their goldens (Node ×3), the soak's tour replayed in Chromium ×3 at 25 checkpoints, `x qa level` and `x qa geo` clean, tests/e2e/{terrain,level-meshes}.spec.ts 8 passed. The Verify filter's `engine/gfx/cutaway` selects only cutaway.test.ts: storeyCut's and stageSite's tests run in the full `npm test`. Calls in ADR-0025 amendment 18. Files beyond the WP's list: engine/world/{siteQueries,siteNav,siteNavGrids}.ts, engine/world/level/{heights,compile,types,validate}.ts, engine/physics/{trimesh,world,bodies}.ts, engine/sim/{rides,siteApi}.ts, engine/gfx/{stageSite,storeyCut,stageGround,stage,terrain}.ts, engine/app/view.ts, engine/dev/{bot,botNav,actions}.ts, engine/audio/runtime/reverb.ts, engine/index.ts, fixtures/levels/storeys/{site.ts,house.txt}, labs/playground/{levels/lot.ts,scenes/lot.ts,main.ts,README.md}, tests/e2e/playground-cameras.spec.ts, tools/eslint/layers.ts (the bot's navigation beside it, sim-side); engine/world/{nav,ai}.ts and engine/gfx/cutaway.ts unchanged |
| 13.16 | Interaction: doors, windows, switches and pickups | W | done | 63451b8, 632bff2, 83bf3ea, 89bee62, fb3896e (#27) | Built use (engine/sim/interact.ts, the system `interact` in the phase `intents`): a player's target in reach (2 m from the eye) and in view, the first body the crosshair's ray strikes or a bodiless thing it passes within 0.15 m of, else the nearest within 60° in front, of the things that can be used now (the kind `usable` by component: a door's, a switch's; a prop's own `use` with a `prompt`; carrying a dynamic prop of 25 kg or less), its prompt in the `interactor` component, which the playground's HUD shows with its key; the use takes its press from the rides; carrying (driven 0.8 m before the eye, dropped held back) and throwing (8 m/s along the view); `melee` strikes what takes a strike (the kind `strikable`; health; a dynamic body), WP 13.19's kick's hit before its move. Doors (doors.ts, phase `anim`): kinematic props on a hinge (the kind gains `kinematic`), opened away from the user and closed, locked, held by a body in the leaf's way, burst open at a faced strike and broken at the second into a falling slab with splinters, broken at once by a shot or a blast; sliding doors on a switch; `addLevelDoors`. Windows and breakables (breakables.ts): props with health (`propHealth`), `damageProp`, `breakProp` (the event its look names, pieces knocked as their bodies are made), `addLevelWindows` (0.5 × 1.2 m panes), panes broken before the physics step by any prop thrown at them faster than 4 m/s, `strikeBody` for bolts and shots (the box's `fight.shots` calls it). Switches (switches.ts): room lights by light group and the garage door, a group's switches together; the view draws a lamp that is off dimmed and unlit (`propLight`, engine/gfx/stageProps.ts, props.ts). The fittings (engine/world/props/fittings.ts: the pane, the switch, the lamp with its glowing shade, the garage door) and the library's chair; the break effects (glass, splinters, shatter). A removed body's id names nothing now (`liveBody`). The playground's cottage (labs/playground/scenes/interact.ts) and its replay. Measured: npm test -- engine/sim, 199 passed in 24 files; npm test, 4,161 passed; tests/replays/playground-interact.replay.json (560 steps: the door opened, the light off and on, the door shut, burst open and broken, a chair thrown through a pane; 11 goldens, Node ×3, Chromium ×3 and the page ×3 agreeing, final a5d46944d284f6b8), its story event by event in labs/playground/scenes/interact.test.ts; props.spec.ts and playground.spec.ts 10 of 10 green at 89bee62 and fb3896e (the HUD's `E: Open`, `E: Close`; the menu's every scene and replay); parity and post-box 50 of 50 green at 89bee62, props.spec.ts seeing every prop's every part. Calls: ADR-0025 amendment 19 (damage.ts stays the crowd's; the strike's reach before WP 13.19; the phases; the lookup a scan; the garage and the bot through doors to WP 13.18). Verifier: failed on three counts (the lamp's bulb unseen from above, the stale menu spec, pieces broken inside a step), all fixed with its open issues (amendment 19's "From the review"). Files beyond Owns: engine/sim/{switches,houseApi,actorInput}.ts, engine/physics/{rescue,capture,world,queries,carry,crowd,move}.ts, engine/world/props/{fittings,library,place}.ts, engine/gfx/{props,propLooks,stageProps}.ts, engine/gfx/fx/presets.ts, engine/sim-api.ts, labs/box/scenes/fight-foes.ts, labs/playground/{levels/cottage.ts,scenes/interact.ts,main.ts,controls.ts,README.md}, tests/pages/props.ts, tests/e2e/{props,playground}.spec.ts, tools/qa/tex.ts. Not verified: the new props' and effects' looks (the gallery's review, WP 7.7), sounds (WP 13.22). |
| 13.17 | Building materials | R | done | dee743e, a2747ab (#27) | Built nine seeded, periodic generators on the v3 helpers (engine/gfx/textures/v3.ts): wood (planks with grain and knots in 32-texel cells), tiles (a grid with grout), carpet, wallpaper (stripes and diamonds), shingles (lapped rows), asphalt (grit), concrete (pores and joints), siding (boards) and glass, each with its golden hash (engine/gfx/textures/generators/v3.test.ts), and their nine materials (engine/gfx/materials/builtins.ts; glass opaque), the pane drawn in glass; palettes in steps of at least 0.05, so the pixel look's 24 shades a channel keep them apart, and every joint and line off the wrap edge, so they tile. Measured: npm test 4,190 passed at a2747ab; `node x qa tex` 40 checked, 0 violations. Reviewed: the texture sheets (twice: the shingles lapped and brown, the wallpaper's stripes as heavy as its diamonds), then the gallery's material sheets in the playground's cel and pixel looks (WP 7.7: `x gallery material --look look:playground-cel|pixel`), each of the nine whole on its cube and reading as named in both, no seams or banding beyond the intended posterising. Files beyond Owns: engine/gfx/textures/texture.ts (v3 registered) and its test, engine/world/props/fittings.ts (the pane's glass), engine/gfx/propLooks.ts (its own pane material gone), engine/gfx/props.test.ts. |
| 13.18 | The site | B | done | e981a49, fd06a1c, 4b89b7d, b731bf9, c86f2de (#27) | Built the block (labs/playground/levels/site.ts): `site:block`, 96 × 113 m of terrain (the hill scene's ground, flattened under the range, the yards and the street) and eleven structures, the gym as built at (0, 12) with three gates (its own scene keeps its wall whole), the house (labs/playground/levels/house.ts: four storeys on 0.25 m tiles under a 35° gable, the garage with its up-and-over door, the porch and the patio, painted from rectangles by labs/playground/levels/plan.ts), the shed, the tree house, the lookout, the range's shelter and backstop, the ring, the street, the driveway and the path (yard.ts, street.ts); furnished and lit (labs/playground/furnish.ts, props/: a lamp and a switch per room by light group, the garage door's two switches, the doors and panes, chairs and boxes to carry, the yards', street's, range's and ring's things, the rides); a spawn per area (`SITE_AREAS`) and a scene per area (`playground:site`, `playground:site-<area>`); the README's demo index; the gym's signs where it stands; the lot and the cottage retired with their replay. Engine: the site's navigation (engine/world/siteNavClear.ts: clear points sampled every 5 cm against closed tiles, ledges, ladders' feet and props' own boxes; siteNav.ts: the look-ahead past reached and passed points, a drop's height in its cost; siteNavGrids.ts: a flight's side crossed only within a 10 cm curb, a block closing no tile through a closed one), the bot (engine/dev/bot.ts, botNav.ts: the duck 2.2 m ahead, a gentle push and use at a drop, the push kept through a mantle, no push falling, a ladder's rise read three nodes on, `look`; `sweepBot` to engine/dev/botSweep.ts), the style set warming only the styles looks ask for (engine/gfx/materials/styles.ts, engine/app/look.ts), a level mesh with nothing to draw kept out of the scene (engine/gfx/level/meshes.ts), pages waited for 300 s (tools/lib/page.ts), `registry.kinds()` kept sorted, `findTarget` asking where before whether; with e981a49's level recipes per structure, the up-and-over door, the ground cut under floors, the bot through doors and amendment 15's leftovers. The gym's courses from gate G10: gaps.ts, steps.ts, crouch.ts, landing.ts, climbAgain.ts. Measured: `node x replay tests/replays/playground-site.replay.json --browser page`, 640 steps, 12 goldens, final 80447274d714a28e, Node ×3 and the Chromium page ×3 agreeing (Chromium ×3 when recorded); its story event by event and the HUD's prompts (site.test.ts); the bot from the front yard's spawn to every room of the four storeys and back (site-downstairs, site-upstairs) and to every area and back (site-areas), and the tour of the 17 rooms and back in about 5,100 steps (site-soak): no camera ever inside a wall (0 frames in all five), first person, isometric and top-down keeping every bound, the shooter's and the platformer's other bounds watched for WP 13.27 (the shooter loses the player in about 7% of the frames and is cut once by a door, 3.45 m; the platformer in most); the courses' numbers (courses.test.ts, 27 tests: run 3 m, sprint 5 m and slide-jump 7 m each flying its 0.767/0.717 s and landing on the far platform, the superglide rising 1.27 m at 13.67 m/s over the 3 + 5 m; the stairs at 5.07 m/s to 1 m, the 45° slope to its 4 m deck, the 51° refused; the duck in 0.433 s, up in a tick, spam never down; the stun leaving 1, 0.49 and 0 of the speed from 6, 14 and 25 m, the run again a second on; a climb caught again at 0.21 m, 3.25 m lower); the site page's warm-up 85 pipelines in 214 s (113 in 333 s before the styles' change), 0 after it; the stage's specs green: playground.spec.ts 9 of 9 (the five cameras and both looks on the hill and from each of the site's areas, 0 pipelines after the warm-up, no advice; the porch's prompt) and playground-cameras.spec.ts 12 of 12 (the site's cutaway in isometric and top-down in all 17 rooms, the crawlspace ducked, the shed and the front yard, the player shown in each), level-meshes 5, materials-v2 3, box-look 8, hall 2 and props 2. Tests: siteNavClear (5), siteNav (+1), siteNavGrids (+1), bot (+1), styles (+1), look (+1), meshes (+1), props (1), site (12), site-areas, site-downstairs, site-upstairs, site-soak, courses (+5). Calls in ADR-0025 amendment 20 (the block's 113 m; the lot and the cottage retired; the bot's navigation; the cameras' bounds to WP 13.27, added to stage G12; the styles on demand; the gaps course's 0.1 s hop window; §2.3's stairs; one site page for the site's scenes in the five cameras and both looks). Verifier: failed once, on the site's cutaway spec (the player, placed standing in the 1.4 m crawlspace, was pushed out under the basement slab, so nothing was cut); fixed in c86f2de: the playground's `place` takes `crouch` and `roomPlace` ducks him where a standing head would be in something solid; the cut by storey also lifts his own storey's heads under a low ceiling and hides the props on a storey it cuts off (an attic's chest hung over the hall); the house's walls cut `either` (a new rule: facing, or between the camera and the player) and its partitions `blocking`, so every camera sees him in every room (WP 12.3's eye, in Node); level-meshes.spec.ts's upper heads checked from above, the frames, now round the openings, covering the strip under the eaves the outside camera saw; its notes taken (house.test.ts for the plans and the house; PLAYGROUND.md's garage door, storey height and bulkhead; the panes and the lamps' groups asserted; the climb-again window a tick wide; comments; `registry.kinds()` readonly; botNav's one import). Open: the bot presses use at every drop (in the house only ladders' tops), a standing hull placed under a low ceiling is pushed out with no advice, the crawlspace's light (WP 13.23). Not verified: the site's looks (no visual review: its props', materials' and the gallery's sheets were WP 7.7's), sounds (WP 13.22), touch and Vercel (ADR-0021). Files beyond Owns: engine/world/{siteNav,siteNavClear,siteNavGrids,site}.ts, engine/world/level/roofs.ts, engine/dev/{bot,botNav,botSweep,actions}.ts, engine/gfx/materials/styles.ts, engine/app/look.ts, engine/gfx/level/{meshes,openings,runs,recipes}.ts, engine/gfx/{stage,stageSite,stageProps,storeyCut,cutaway}.ts, engine/sim/{interact,houseApi}.ts, engine/core/registry.ts, tools/lib/page.ts, tools/qa/tex.test.ts, fixtures/levels/storeys/site.ts, tests/e2e/{playground,playground-cameras,level-meshes}.spec.ts, docs/PLAYGROUND.md §2, lean/my3dge.js (generated) |
| **G11** | **Gate: the house** | | todo | | |
| 13.19 | Melee and the door kick | P | todo | | |
| 13.20 | Firearms | W | todo | | |
| 13.21 | The neighbours and the dog | W | todo | | |
| 13.22 | The playground's sound | X | todo | | |
| 13.23 | Light and time | R | todo | | |
| 13.24 | The two looks, finished | R | todo | | |
| 13.27 | Follow cameras indoors | R | todo | | Added at WP 13.18 (ADR-0025 amendment 20): the house's soak watches the shooter's and the platformer's bounds for it. |
| **G12** | **Gate: alive** | | todo | | |
| 13.25 | The front end | I | todo | | |
| 13.26 | The tour and the hand-over | B | todo | | |
| **G13** | **Gate: the tech demo** | | todo | | |
| U-1 | Vitest 4 (from 2026-10-22) | T | todo | | |
| U-2 | The lint majors (from 2027-01-01 to 2027-02-06) | T | todo | | |
| U-3 | three r183 (from 2027-02-18, or when it measures better) | R | todo | | |
| U-4 | Vite 8 and TypeScript 6 (from 2027-03-12 and 2027-03-23) | T | todo | | |
| U-5 | Node 26 LTS (from 2027-05-05) | T | todo | | |
| U-6 | Rapier after 0.21 (when a release measures better) | P | todo | | |
| U-7 | three r184 and later (when one measures better, or 12 months after release) | R | todo | | |
| U-8 | The platform's Chromium (when the environment changes) | T | todo | | |

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
| `engine` §6 pixel font | CONCEPT: UI text is HTML/CSS; a pixel look comes from an approved font, or this encoding drawn to a canvas (§5.4) | — |
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
| `src/mocap.game.js`, `src/mocap.template.html` | REWRITE | `labs/box/` (clip mode); `labs/library/` (on demand, WP 10.8) |
| `src/emberdeep/**` | **EXCLUDED** (patterns only, §5.6) | — |
| `src/starter/**` | DROP (the animlab UX informs `labs/anim/`) | — |
| `src/arena.*`, `src/stress.game.js`, `src/stress.template.html`, `examples/scarfrunner-side.html` | DROP | — |
| `src/labs.json`, `src/labs.template.html` | PORT | `labs/` (WP 10.8) |
| `tools/*` | Per §5.5 and §5.3 | `tools/cmd/`, `tools/lib/`, `tools/anim/` |
| `docs/LAB-3D.md` | Its lessons go into §4 and the ADRs | `docs/decisions/` |
| `docs/MOCAP.md`, `docs/ANIMATION-RESEARCH.md` | PORT | `docs/ANIMATION-LIBRARY.md`, `docs/ANIMATION-RESEARCH.md` |
| `docs/CHARACTERS.md`, `DAN.md`, `CODEX.md`, `CONTROLS-AUDIT.md` | Lessons only | AGENTS.md, ADRs, input docs |
| `docs/assets/*` | DROP | — |
| `vendor/three-0.182.0` | REPLACE with `three@0.182.0` from npm: the same release, kept as an internal measured on the platform (§4.7; doctrines: Quality under the hood, Mastery). Nothing is vendored | `package.json` |
| `vendor/rapier3d-simd-compat-0.19.3` | REPLACE with `@dimforge/rapier3d-simd-compat@0.21.0` from npm: exact restores and a faster crowd, measured (§4.7). Nothing is vendored | `package.json` |
| `examples/**`, `dist/**` | DROP (build output) | — |
| `README.md`, `API.md`, `AI_GUIDE.md`, `CHANGELOG.md`, `CLAUDE.md` | REWRITE (generated docs, AGENTS.md) | — |
| `.claude/**` | PORT | `.claude/` |
| `package.json`, `vercel.json`, `.gitignore`, `.vercelignore` | REWRITE (`vercel.json` and `.vercelignore` build from source, WP 0.12) | the same files |
| `LICENSE` (MIT) | COPY | `LICENSE` |

### Appendix B: Banned and renamed APIs (enforced by ESLint, each message naming its replacement)

**Legacy or fragile three.js, banned everywhere in the engine:**

| Banned | Use instead |
|---|---|
| `WebGLRenderer`, `forceWebGL`, `WebGLBackend` | `WebGPURenderer`, on WebGPU only (§6.7) |
| `ShaderMaterial`, `RawShaderMaterial` | Node materials and TSL inside `gfx`; material data in game code |
| `onBeforeCompile` | Node inputs (`colorNode`, `positionNode`…) |
| `EffectComposer`, `three/examples/jsm/postprocessing/*` | `PostProcessing` plus the TSL display nodes from the addons |
| `mrt(`, `setMRT(` outside `engine/gfx/post/mrt.ts` | The fixed MRT of §6.7, set up once at startup. Per-object flags change through uniforms, never by changing the outputs |
| `DynamicDrawUsage` on instanced matrices or colours | The instancing service, which keeps `StaticDrawUsage` with update ranges. The prototype lost dynamic-usage updates above 1,000 instances on r182 (§4.7) |
| `positionLocal`, where the pre-instancing position is meant (outline push directions) | `positionGeometry`. r182 assigns the instance-transformed position to `positionLocal` |
| `Clock` | `core/time`, or `Timer` inside `gfx` only. r183 deprecates `Clock` |
| `renderAsync` (on the renderer, `PostProcessing` and `QuadMesh`), `clearAsync`, `clearColorAsync`, `clearDepthAsync`, `clearStencilAsync`, `initTextureAsync`, `hasFeatureAsync`, `PMREMGenerator`'s `from*Async`, `waitForGPU` | `await renderer.init()` once, then the synchronous forms. r181 deprecated the async forms and removed `waitForGPU()`. `compileAsync` (the warm-up), `computeAsync`, `readRenderTargetPixelsAsync` and `resolveTimestampsAsync` stay |
| `renderMultiDrawInstances` | `renderMultiDraw` with indirection. r184 removes it |
| `readRenderTargetPixels` (sync), `getImageData`, `readPixels` | `readRenderTargetPixelsAsync`, and only in `engine/gfx/shot.ts` |
| Reading `renderer._pipelines` or other private fields | The public pipeline counter (`engine/gfx/pipelines.ts`), the one place that reads renderer internals |

**Names from newer three.js releases that r182 lacks.** A named import of a missing export is a type error (`@types/three` 0.182.0) and, in the browser, a link error that stops the whole module graph.

| Newer name | In r182 |
|---|---|
| `RenderPipeline` (the post-processing class from r183) | `PostProcessing` |
| `DynamicLighting`, `ClusteredLighting` | The light pool (WP 7.1); the `TiledLighting` addon (WP 11.5, on demand) |
| `TextureSource` | `Source` |
| `packNormalToRGB`, `unpackRGBToNormal` | `directionToColor`, `colorToDirection` |
| `negateOnBackSide` | `directionToFaceDirection` |
| `GodraysNode` | Not in r182: a custom TSL pass, when a look needs one |

**Deprecated in r182.** Each prints a warning on use, and any warning fails a test (WP 0.5).

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
| `cache()` | `isolate()` |
| `.varying()`, `.vertexStage()` | `.toVarying()`, `.toVertexStage()` |
| `texture(…).uv(u)` | `.sample(u)` |
| `viewportResolution` | `screenSize` |
| `transformedNormalView`, `transformedNormalWorld`, `transformedClearcoatNormalView` | `normalView`, `normalWorld`, `clearcoatNormalView` |
| `storageObject` | `storage().setPBO(true)` |
| `material.shadowNode`, `material.shadowPositionNode` | `castShadowNode`, `receivedShadowPositionNode` |
| `PassNode.setResolution()`, `getResolution()` | `setResolutionScale()`, `getResolutionScale()` |
| `ReflectorNode`'s `resolution` | `resolutionScale` |
| `renderer.getColorBufferType()` | `getOutputBufferType()` |

**GPU results never reach the sim.** Compute and storage APIs are allowed anywhere in `gfx/` (doctrine: WebGPU only, §6.7). Readbacks (`readRenderTargetPixelsAsync`, `getArrayBufferAsync`) are allowed only in `engine/gfx/shot.ts` and `engine/gfx/enhanced/timing.ts`, and sim-side code cannot import `gfx/` at all.

**Game code** (`labs/`, `fixtures/scenes/`) imports from `engine/` only through `engine/index.ts` and `engine/sim-api.ts` (§6.1, ADR-0020); the message names the public export to use.

**Sim-side bans** (`engine/{core,sim,physics,anim,world}`, `engine/input/intents.ts`, `engine/audio/dsp`, `engine/dev/bot.ts`, `labs/box/scenes/`, `labs/box/cast/`, `fixtures/scenes/`; `*.test.ts` files are exempt):
- **Banned:**
  - `Math.random`, `Date`, `performance.now`;
  - `setTimeout`, `setInterval`, `requestAnimationFrame`;
  - `document`, `window`, `navigator`;
  - any import of `three`, `three/webgpu`, `three/tsl` or `three/addons/*`, except in `core/math.ts`, which re-exports the math classes;
  - `AudioContext`;
  - `**` and `**=` (write `Math.pow`), names destructured from `Math`, and a swapped `Math` function held in a variable (`const pw = Math.pow`): no swap reaches an operator or an alias (§6.5, ADR-0006 amendment 1).
- **Allowed, and expected:** the standard `Math`, `Math.sin` and `Math.cos` included (called by name), and three.js's math classes through `core/math`. The sim swaps in fdlibm ports while it steps, so one golden per replay holds in Node and in Chromium (§6.5).

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
| foot L/R | shin | `footL`/`footR` (the sole; the ankle joint is `ankleHeight` above it) | `ankle` |
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
- After WP 8.10: 1,218 clips, 5.40 MB of text (1.10 MB gzipped). 100STYLE's 878 clips are 3.33 MB (693 KB gzipped), 0.7–14.3 KB each; Quaternius v2's 102 are 527 KB (85 KB). my-3d2dge's decoder reads all 980 in about 3 s in Node.
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
| Proof hashes | `1917b7b9` (lab3d) and `68e1f7d1` (stress-world), the same on both of the prototype's backends. Not recorded in the source. Under r180, r181.2 and r184.0 the stress-world hash is the same `68e1f7d1` (§4.7) |
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
| Crowd probe, mean step for 1,000 and 5,000 steered capsules (Rapier SIMD 0.21.0, Node 24) | 4.3 ms; 22.1 ms (§4.7) |
| stdlib's fdlibm `sin` against V8's native `Math.sin` | 28 ns against 14 ns per call |
| lab3d proof | 27 ms in Node; 130 ms cold or 35 ms warm in the browser |

**Tests and tools**
- The full suite took about 25 minutes; the lab3d test 65–81 s.
- 35 tool files (343 KB) and 26 npm scripts.
- Browser launch copied 19 times, the server 4 times; about 20 tools parse their own arguments.
- About 310 KB of docs prose.

**Libraries**

| Library | Size |
|---|---|
| three r182, unminified (what Vite serves in development) | core 1.41 MB (280 KB gzipped), webgpu 1.99 MB (390 KB), tsl 33 KB (7 KB) |
| three r182, minified (the prototype's) | core 381 KB, webgpu 616 KB, tsl 23 KB |
| Rapier SIMD 0.21.0 (the pin), `rapier.mjs` with the inlined WASM | 4.62 MB (1.66 MB gzipped); the `compat` build is 4.37 MB |
| Rapier SIMD 0.19.3 (the prototype's), the same | 2.31 MB (0.86 MB gzipped) |

**Toolchain** (the probe of §4.7, on the platform)

| Measurement | Value |
|---|---|
| `node x sim` (tsx, Rapier's initialization included) | 0.7 s |
| Vitest, one test stepping Rapier with three.js's math | 0.9 s |
| Playwright Test, one spec on both of the first probe's projects, against Vite | 3.4 s |
| On the pins (r182, Rapier SIMD 0.21, Node 24): `tsc --noEmit` | 2.0 s (5.9 s without `skipLibCheck`) |
| On the pins: two WebGPU specs, with and without a post pass | 4.9 s |
| `vite build` of the probe page | about 3 s |
| `vite build` of a page with three r182, a TSL post pass and Rapier 0.21 | one HTML page and one 5.40 MB script (1.86 MB gzipped), no `.wasm` (§4.8) |

**The platform (October 2026)**
- The development platform: Linux x64 (4 cores); Node 24.22.1, installed by `scripts/setup.sh` over the container's Node 22.22.0; Chromium 141.0.7390.37 (`/opt/pw-browsers/chromium-1194`, which the container's global Playwright 1.56.1 installed), driven by the project's Playwright 1.64.1; SwiftShader for WebGPU.
- Measured on it (§4.7): Rapier 0.21 gives the same state in Node and Chromium, and restores exactly; stdlib's fdlibm ports make `sin`, `cos` and `pow` identical across Node 22, Node 24 and Chromium 141. Against Node 22, Chromium's `Math.sin` differs in 3.46% of results, `Math.cos` in 3.35% and `Math.pow` in 9.99%, each by 1 ulp; against Node 24, only `sin` and `cos` differ.
- WebGPU reaches 83.3% of devices and WebGL 2 97.8% (web3dsurvey). By group: Linux 17.8%, Firefox 60.4%, Android 73.6%. This matters for Phase H, not before.
- Versions: §4.7 has every pin, its qualifying release and its next line. The newest releases today, for reference: three r186.1 (2026-09-24), Rapier JS 0.21.0 (2026-09-25), TypeScript 7.0.2 (2026-07-08), Vite 8.3.4 (2026-10-08), Vitest 5.0.3 (2026-09-30), ESLint 10.12.0 (2026-10-02), Playwright 1.64.1 (2026-10-14), Node 26.11.1 (2026-10-07).

### Appendix E: Draft `AGENTS.md`

```markdown
# AGENTS.md: rules for every change to my-3dge

my-3dge is a fully 3D web game engine written and maintained only by AI agents. DOCTRINE.md governs everything here:
read it first. The plan and its ledger are PLAN.md; generated docs start at docs/INDEX.md. The game is not here.

## How to work
Act as a trusted, capable manager of this engine. Where the doctrine and the plan are silent, use your judgment and
record the call. When going against the doctrine looks best, escalate with your reasoning (below); never deviate
quietly. Aim for the best expected overall result, not flawless software: solve problems when they surface, not in
anticipation. On-demand work packages wait for their measured trigger (PLAN.md §9.1).

## The doctrine, as checks
1. Agent-readable: one concept per file, ≤ 400 lines (hard 600), a JSDoc file comment, strict TypeScript the way
   agents usually write it, docs generated from comments.   → npm run check (tsc, ESLint, Prettier), x docs --check
2. Agent-operable: every capability through npm scripts, node x or __engine; nothing only in a page.
                                                            → command smoke tests, the help() check, verifier
3. Verifiable without a display: the sim runs headless; visual checks are numbers (ID pass, metrics, thumbnails);
   the HTML/CSS UI is checked through DOM queries.          → npm test, x replay, npm run e2e
4. Assets: procedural first, then text and data; binary only with the owner's approval (fonts are pre-approved).
                                                            → x check (asset scan), x esc
5. Reproducible here: fixed 60 Hz, recorded intents, named seeded RNG. Game code writes the standard Math; the sim
   swaps in fdlibm ports while it steps, so one golden per replay holds in Node and Chromium. Captures restore
   exactly.                                                 → ESLint sim bans, replays, the drift test
6. WebGPU only: no WebGL fallback (GFX_NO_WEBGPU without it). Gameplay runs only on the CPU: sim-side code never
   imports gfx, the renderer, the DOM or Web Audio, and no GPU result reaches the sim. Game UI is HTML/CSS.
                                                            → ESLint layer rules, tests/e2e/parity.spec.ts
7. Common ground: what game code touches is familiar: npm, Vite, Vitest, Playwright, ESLint, Prettier, and a public
   API in plain terms (three.js's math, materials and clips as data). Bespoke game-facing tools only where nothing
   fits, with the reason in the file comment.               → verifier, ADR-0019
8. Quality under the hood: game code imports only engine/index.ts and engine/sim-api.ts. Behind them, use the best
   approach you can execute well (TSL, compute, newer releases when measured). Every public export is documented and
   every error names its fix, so game agents never read internals.
                                                            → ESLint public-API rule, x docs --check, ADR-0020
9. Mastery: each pin is the newest release compatible with the newest one ≥ 12 months old, adopted at once;
   internals may go newer when measured. Write the pinned release's idioms (docs/THREE-DELTA.md).
                                                            → x deps --check, x deps --update, banned names
10. Discovery first: target this container (Node 24 through scripts/setup.sh; its Chromium 141, WebGPU on
    SwiftShader); no production hardening outside Phase H, except ADR-0021's touch controls and Vercel deployment.

## Escalate, don't stall
Owner approval needed (a binary asset, a new dependency, spending money, a repo setting, any other outward action;
pushes, stage PRs, merges, branch deletions and the Vercel deploys they trigger are pre-approved), a principle can't be
met, or going against the doctrine looks best: node x esc open … → post it → wait up to 15 minutes, doing the
preferred alternative, never the action itself → answered: act on it. No answer: commit, decide, node x esc
decide …, continue. For the rest of the run, or until the owner answers, report further conflicts without
stopping. Record every escalation, every later conflict and every call.

## The loop
1. node x deps --update: adopt compatible releases first, in a commit of their own.
2. Read DOCTRINE.md, this file, your WP in PLAN.md §9 and only the sections it cites, and the file comments of the
   modules you touch (not whole files). The sources being ported are read-only at $MY3D2DGE_SRC and $SHARDFALL_SRC
   (node x src).
3. Edit. The after-edit hook formats and lints the file: fix what it reports.
4. npm run check → npm test; browser specs only for what only they check that you touched, or a failure you are fixing (PLAN.md §8.2).
5. Read out/**/report.json. Open images only when a metric points at one (use the visual-reviewer subagent).
6. Show it in the box or a fixture test. Update the ledger row in PLAN.md §14 (in ultracode lanes, report it).
7. Commit "<area>: <what> (WP-x.y)". Report the commit, the report paths and any escalations.

## Rules
- SI units, +Y up, characters face +Z. Gameplay time is in 60 Hz sim ticks. Randomness comes from named streams.
- DOCTRINE.md changes only when the owner asks. Never edit out/ or node_modules/ by hand.
- Versions: only the pins in package.json, as tools/deps.json records them. Upgrades are their own work packages.
- Never skip, disable or loosen a test to get green. Baselines change only with a written reason.
- Merge on the quick gate, x ci --local; GitHub then runs the full run on main, nobody waiting on it (ADR-0023).
- At each gate: push, open the stage's PR, look once at its Vercel status (fix a failed build first), squash-merge
  it once x ci --local is green (the repository allows only squash merges, and GitHub then deletes the branch), then
  wait for main's full run and report it.
  Start the next stage from the updated main (PLAN.md §11.1). None of this needs the owner's approval (ADR-0021).
- Touch controls and the Vercel deployment have no tests, by the owner's order (ADR-0021): fix a failed Vercel
  build; fix anything else about them only when the owner reports it.
- Never downgrade silently: every downgrade emits an advice code.
- Ask the entry, never the id: shared code reads registry hooks and never compares ids.
- No game content in the engine; the box's own content stays in labs/box/ (PLAN.md §5.7).
- Docs are generated from comments: never restate a fact in prose (x docs --check).
- Blocked by the core? Write the smallest core change as a proposal in your WP notes. Don't widen your WP.
- Say plainly what you did not verify.

## Done means
Verify commands green; npm run check and npm test green; T2 green for what you touched; shown in the box or a
fixture; file comments and docs current; a template for any kind written by hand a third time; QA for kinds with a
QA family; a verifier review for L-size WPs; no new advice codes; escalations recorded; ledger updated.

## Where things are
engine/ (code + unit tests; index.ts and sim-api.ts are the public API) · labs/box/ (the Stress Box) · data/
(readable data) · fixtures/ · tools/ (x commands, content QA, the ESLint plugin, deps.json) · tests/ (e2e, replays,
baselines) · docs/ (generated INDEX/API/ERRORS, ADRs, escalations, reference) · scripts/setup.sh (the platform)
```

### Appendix F: Glossary

| Term | Meaning |
|---|---|
| **Stress Box** | The engine's integration target, benchmark and sample in `labs/box/`: the prototype's *Stress test: 3D world*, rebuilt in six stages (§9.0) |
| **Box stage** | One of the six phases that grow the box, each ending at a gate (Box 1 = G2 … Box 6 = G7) |
| **Development platform** | The cloud container development targets: Linux x64, Node 24.22.1 (installed by `scripts/setup.sh`), headless Chromium 141 with SwiftShader, driven by Playwright 1.64 (doctrine: Discovery first) |
| **Qualifying release** | A release at least 12 months old (doctrine: Mastery, §6.10) |
| **Compatible release** | A newer release that is backward compatible with a qualifying one (the same major; the same minor for 0.x packages), or that works the same way. It is adopted at once (§6.10) |
| **Common ground** | The doctrine's principle of building on the most widely used tools, libraries and patterns (§3, ADR-0019) |
| **Escalation** | A question for the owner, recorded in `docs/escalations/`, with a call made after 15 minutes if no answer comes (§8.14) |
| **CPU-only gameplay contract** | Gameplay runs only on the CPU: a replay gives its golden hashes while its scene renders, live play in the page replays in Node, and no visual toggle changes the hash (§6.7) |
| **Quality tier** | The presentation setting `quality` (`auto`, `low`, `medium`, `high`): pixel caps, shadow casters and costly effects, lighter on phones (WP 3.12). Never in the hash |
| **Optional GPU features** | Extras for looks or speed (compute particles, tiled lighting, GPU timing), detected at startup; a missing one downgrades a look and logs an advice code (§6.7) |
| **Public API** | `engine/index.ts` (pages) and `engine/sim-api.ts` (sim-side game code): all that game code may import (§6.1, ADR-0020) |
| **Game code** | Code written the way a game would be: the box's scenes, cast and pages, the fixture scenes, the future game. It sees only the public API (§3) |
| **Internals** | Engine code whose API does not appear in game code. It uses the highest-quality approach its builder can execute well (doctrine: Quality under the hood) |
| **On demand** | A WP that is fully specified but not scheduled: it starts when its trigger is measured (§9.1) |
| **Trigger** | The measurement that starts an on-demand WP, recorded in its ledger note (§9.1) |
| **Drift test** | The test that compares every `Math` function between Node and Chromium, natively and under the sim's swap (§6.5, WP 1.1) |
| **Runtime** | Node or Chromium on the platform. Both reproduce exactly and share one set of golden hashes (§6.5) |
| **Capture** | The whole sim's state; a restore of it continues exactly like the uninterrupted run (§6.5) |
| **Shot** | A rendered frame read back from a render target, with look metrics and the ID pass (`x shot`, `__engine.shot()`) |
| **Golden hash** | The recorded hash of a replay at a checkpoint, keyed by platform; it holds in Node and in Chromium |
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
| **Fixture** | Minimal neutral content made for tests, never game content |
| **Format 1/2** | The readable key-pose clip formats. Format 2 is a strict superset |
| **Bake** | Converting a readable clip into rotation tracks for the runtime, also exposed as a three.js `AnimationClip` |
| **Lens** | A read-only normalized view of a clip's angles |
| **WP** | A work package: an independently verifiable unit of work |
| **Lane** | A sequence of WPs owned by one stream of work |
| **Gate** | The set of checks that ends a phase |
| **Advice code** | A stable id for a warning, with a fix and a docs link |
| **Content QA** | Numeric checks on content (motion, meshes, textures, sounds, levels), run by `x qa` and in T1 (§8.6). ESLint checks code |
| **Ledger** | §14, the record of what is done |
