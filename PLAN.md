# my-3dge: the engine plan

**What this is.** This is the plan for building **my-3dge**, a fully 3D web game engine written and maintained only by AI coding agents. It is built from the real-3D work and the animation library of [my-3d2dge](https://github.com/michaelcrosato/my-3d2dge). The plan says:

- what to carry over, and how (copy, port, rewrite or drop);
- what to build new, and every improvement to make along the way;
- the order of work, broken into packages an agent can execute and verify on its own.

**The game is out of scope.** It will be built later, in its own place, on top of the finished engine.

| | |
|---|---|
| Source studied | `michaelcrosato/my-3d2dge` v0.14.0, commit `e37e4ee` (2026-10-08) |
| Plan date | 2026-10-09 |
| Supporting research | [`docs/research/`](docs/research/): eight studies of the source with `path:line` evidence. This plan is canonical where they differ |
| Audience | AI coding agents running at **extra-high effort** (one agent, sequential) or as an **ultracode** multi-agent workflow (parallel lanes) |
| Status | Plan only. Nothing in this repository is built yet. The status ledger is §14 |
| How to use it | Read §1–§4 once. Before starting a work package (WP), read its entry in §9 and the sections it cites. Tick the ledger in §14 when the package's checks pass |

---

## Contents

1. [Summary](#1-summary)
2. [Goals, non-goals and the scope rule](#2-goals-non-goals-and-the-scope-rule)
3. [The five laws, made enforceable](#3-the-five-laws-made-enforceable)
4. [What we found in my-3d2dge](#4-what-we-found-in-my-3d2dge)
5. [Carry-over inventory: keep, port, rewrite, drop](#5-carry-over-inventory-keep-port-rewrite-drop)
6. [Target architecture](#6-target-architecture)
7. [Improvements over the prototype](#7-improvements-over-the-prototype)
8. [Tooling and testing: how agents see and prove their work](#8-tooling-and-testing-how-agents-see-and-prove-their-work)
9. [Roadmap: phases, gates, lanes and work packages](#9-roadmap-phases-gates-lanes-and-work-packages)
10. [Animation library migration, in detail](#10-animation-library-migration-in-detail)
11. [Running this plan: extra effort or ultracode](#11-running-this-plan-extra-effort-or-ultracode)
12. [Risk register](#12-risk-register)
13. [Decisions and open questions](#13-decisions-and-open-questions)
14. [Status ledger](#14-status-ledger)
15. [Appendices](#appendices): source-to-target map, banned APIs, conventions and conversions, prototype numbers, AGENTS.md draft, glossary

---

## 1. Summary

### What my-3d2dge has that is worth keeping

- **A real 3D world that works.** Two labs run on three.js `WebGPURenderer` (WebGPU, with WebGL 2 fallback) and Rapier physics:
  - `src/lab3d/`: 1,030 lines;
  - `src/stress-world/`: 2,574 lines.
- **Characters that work in that world.** Characters fight, jump, climb stairs and push crates. Crowds of thousands run as rigid bodies.
- **Art made by code, and a sim/render split that mostly holds.** Every texture and mesh is made by code. A scripted 600-step fight hashes to the same state on WebGPU and WebGL 2. That proof is weaker than it looks (see *What hurts*), but the design is right.
- **An animation system that is the real asset:**
  - procedural humanoid and blob rigs (gait, IK, idle, poses, stances, capes, hair);
  - 24 tuned combat moves with anticipation, strike and follow-through (`E.MOVES`, `Attack`, `Combo`);
  - **a library of 325 curated motion clips** (Quaternius, Mesh2Motion, CMU), stored as readable key poses that an agent can read and edit;
  - a ledger of all 2,548 CMU motion-capture takes, and an import toolchain that regenerates the CMU set byte for byte from public data.
- **Proven agent practices:**
  - seeded virtual time for repeatable filmstrips;
  - state hashes, and banned-API lints that stop outdated three.js code;
  - numeric animation lints (pops, foot sliding, under-floor joints, bone stretch);
  - scaffolds that pass their own tests;
  - warn-once advice that names the fix.

### What hurts

- **The 3D labs are not an engine.**
  - Their files are joined into one shared scope.
  - The simulation cannot run without the renderer.
  - The live loop is not truly fixed-step, and drawing writes simulation state (`_cheat`, `_pitch`, `_camSide`).
- **Two coordinate systems.** Units of 16 to the metre with z up are swapped into three.js space at the drawing's edge.
- **The animation lives inside a 374 KB 2D engine file.**
  - The rig stores joint positions, not rotations, so it cannot skin, mask or blend cleanly.
  - Half of the rig code is 2D pixel drawing.
- **The tests are slow and blind to whole classes of bug.**
  - Everything runs in a browser: the full suite takes about 25 minutes.
  - The backend-parity proof holds by construction, so it cannot catch a renderer writing into gameplay.
  - Screenshots are judged by PNG byte size.
- **Repo hygiene works against agents.**
  - 136 of 301 tracked files are build outputs; the CMU library alone is 68 MB.
  - The agent edition is a hand-ported second copy of the engine.
  - There are no types, no lockfile and no CI.
  - Every version bump edits 10 places, so parallel agents always conflict.

### What we will build

A modular, typed, deterministic engine, in five layers (§6.1):
- **`core`**: math, time, randomness, registries.
- **Sim-side**: `sim`, `physics`, `anim`, `world`, input intents and audio DSP. No DOM and no renderer; it runs in Node.
- **Presentation**: `gfx` (three.js r186.1), the audio runtime, `ui` and the input devices.
- **`dev`**: the inspector and tools inside the page.
- **`app`**: wiring, scenes and routes.

Around it:
- **Data:** a library of clips, materials, props and levels kept as readable text.
- **Tooling:** one CLI (`node x <cmd>`) whose every command writes a JSON report, so an agent can verify its own work without opening an image.

### The shape of the roadmap

| Phases | Content | How they run |
|---|---|---|
| 0–1 | Foundation and kernel | Sequential |
| 2–8 | Physics, animation core, animation library, rendering, world, audio, and input/UI/dev | Parallel lanes |
| 9 | Labs that prove everything together, and a benchmark | Integration |
| 10 | The WebGPU-only enhanced tier | After 9 |
| 11 | Advanced agent tooling: MCP server, evals, generators | Continuous, finished last |

Each phase ends at a gate: a fixed set of commands that must pass.

### The ten biggest improvements

The full list of 42 is in §7.
1. One coordinate system: SI units, +Y up, characters facing +Z.
2. A true fixed-step simulation that runs headless in Node, with replay files and bisection to the first step that diverges.
3. Cross-browser determinism: our own math functions for the sim, plus Rapier's `deterministic-compat` build.
4. A real parity proof:
   - record input during rendered play, then replay it with no renderer;
   - compare an object-ID render pass between WebGPU and WebGL 2.
5. A rotation skeleton (root plus 23 joints) under the existing procedural animation. It enables skinning, masks, additive layers, ragdolls, foot planting and look-at.
6. Moves as timelines carrying events, hit volumes and root motion. The clip library is kept readable, then baked to rotation tracks.
7. three.js r186.1, which fixes WebGL 2 instancing on Apple hardware, among other things. Rendering is tiered, with a capability registry:
   - **Baseline**: everything gameplay needs, on WebGL 2 or WebGPU;
   - **Enhanced**: WebGPU-only extras for speed and looks.

   The engine never falls back silently.
8. One CLI with three test tiers: under 10 s, under 60 s and under 6 min, against 25 minutes today. Tests are picked from the import graph.
9. Visual checks that need no committed images:
   - per-object pixel counts from an ID pass;
   - look metrics;
   - text thumbnails;
   - comparison against `main`, built in a temporary worktree.
10. Agent-native operation:
    - AGENTS.md rules, each paired with the check that enforces it;
    - Claude Code hooks, skills and subagents;
    - `window.__engine`, with an MCP bridge to it;
    - scaffolds that pass every check.

---

## 2. Goals, non-goals and the scope rule

**Goals**
- **G1.** A fully 3D engine for the web. Gameplay, physics and animation run on the CPU at a fixed rate, are deterministic, and run headless in Node.
- **G2.** Bring over everything that would be costly to rebuild:
  - the 3D world's working systems;
  - the animation system, with its moves, poses, procedural rigs and secondary motion;
  - the motion-clip library with its catalogs, ledger, provenance and toolchain;
  - the procedural textures, sound data and font;
  - the agent practices.
- **G3.** Improve everything that carries over (§7). Nothing moves across just because it exists.
- **G4.** Make the engine easy for AI agents to read, change, inspect and prove (the laws in §3).
- **G5.** Leave the engine ready for a separate game. Games extend it through registries, events and scenes, never by editing the core.

**Non-goals**
- **No game.** Emberdeep (`src/emberdeep/`) does not come over in any form, and it is not to be remade: no skills, monsters, bosses, loot, levels, town, characters or balance numbers. The game comes later, in its own repository or package, built on the finished engine.
- **No 2D engine.** Pixel-art world rendering, the depth-sorted 2D renderer, the 2D views, TileMap and PlatformMap drawing, the genre starter kits, the 2D agent edition and Card mode do not come over.
- **No visual editor for humans.** No human ever edits the engine. Labs and panels exist so agents, and anyone watching, can see the work.
- **No imported art.** No model, texture or sound files (§3, law 1).

**The scope rule for the game.** Emberdeep grew a lot of technology that any game needs: registries with schemas, an event bus, a body contract and rig checks, procedural creature rigs, a tuning registry, a developer sandbox, an autopilot, a gallery and a performance governor. The plan rebuilds these **generically, with new minimal fixtures**. It never copies game content. §5.6 lists them; §5.7 is the exclusion list.

---

## 3. The five laws, made enforceable

A rule without a check is only a suggestion. Each law below comes with the mechanism that enforces it, and that mechanism ships in Phase 0.

| Law | Rules | Enforced by |
|---|---|---|
| **L1. Everything is code.** Graphics, animation and sound are written as code or made procedurally. | <ul><li>**No binary asset files tracked anywhere**: png, jpg, jpeg, gif, webp, avif, bmp, tga, ktx2, basis, hdr, exr, glb, gltf, bin, fbx, obj, dae, blend, wav, mp3, ogg, flac, m4a, opus, ttf, otf, woff, woff2, mp4, webm.</li><li>**Readable data counts as code.** Animation clips, catalogs, levels and sound definitions are allowed, as diff-friendly text, each item recording where it came from and its license.</li><li>Every generator is a pure function of `(params, seed)`.</li><li>Source files used by importers (GLB, AMC, BVH) live only in the git-ignored `.cache/`.</li><li>Golden references are numbers and text thumbnails, never committed images.</li><li>Pictures for docs are generated on demand.</li></ul> | `x check`: scans every tracked file by extension and magic bytes. The importers refuse to write outside `.cache/` and `data/`. |
| **L2. Small and legible.** Agents can hold any part of the engine in their head. | <ul><li>One concept per file.</li><li>Soft cap of 400 lines per file, hard cap 600. Lines up to 140 characters.</li><li>Every module opens with a **manual header**: PURPOSE, API, INVARIANTS, EXAMPLE, SEE ALSO, in 40 lines or fewer.</li><li>TypeScript using only erasable syntax, run with no build step.</li><li>The only runtime dependencies are three.js and Rapier, vendored and pinned.</li><li>Per-module token budgets.</li><li>No minified or generated code outside `vendor/`.</li><li>Docs are generated from the headers, never written twice.</li></ul> | `x check`: header present, file caps, `tsc --noEmit`, `x docs --check`. `x sizes --budget` checks the token budgets. |
| **L3. AI-native tooling.** Agents drive and question the engine directly. | <ul><li>**One CLI**, `node x <cmd>`. Each command prints at most about 20 lines and writes a `report.json` with a fixed schema; exit codes are 0, 1 or 2.</li><li>`window.__engine` is on every page. The same API works headless in Node, except the rendering members (`render`, `capture`, `camera`, `scene`), which report a coded "no renderer" error there.</li><li>A scaffold for every kind of content, and every scaffold passes every check.</li><li>Registries are discoverable through `x describe`.</li><li>Errors and advice carry stable codes and link to docs.</li><li>Claude Code is wired in: hooks, skills and subagents. An MCP bridge connects agents to the running engine.</li></ul> | <ul><li>CI runs each scaffold and checks the result passes every check.</li><li>Every `x` command has a smoke test.</li><li>The docs check verifies the `help()` text.</li></ul> |
| **L4. Inspect and test.** Agents prove their own work. | <ul><li>The sim runs headless in Node and is deterministic: the same inputs give the same state hash.</li><li>Every feature lands with a test at the cheapest level that proves it, in this order: Node unit test, then replay hash, then browser numbers, then image.</li><li>Every visual verdict is available as JSON.</li><li>Animation, geometry, texture, audio and level lints run over everything registered.</li><li>Tests are selected from the import graph.</li></ul> | `x test` tiers with time budgets (§8.2); replay suites; CI required checks. |
| **L5. The GPU never decides gameplay.** WebGPU-only techniques may improve speed and looks, nothing else. Everything works on WebGL 2. | <ul><li>Simulation-side modules can never import `gfx/`, `three`, the DOM or WebAudio.</li><li>The renderer reads a snapshot of the sim and never writes to it.</li><li>**Baseline tier**: the features that run on every backend (WebGL 2, WebGPU compatibility mode, WebGPU core). It shows everything gameplay needs.</li><li>**Enhanced tier**: optional extras that need WebGPU core. They add speed or visual quality only. Each feature declares its fallback, is gated by a capability check, is switched by the performance governor, and is never chosen silently.</li><li>Nothing is read back from the GPU into the sim.</li><li>Compute shaders, storage buffers, indirect draws and atomics are allowed **only** under `engine/gfx/enhanced/`. The one exception is the "map" kernels listed in `BASELINE_COMPUTE` (`tools/lib/rules.mjs`, Appendix B), which the WebGL backend emulates; each comes with a parity test.</li></ul> | <ul><li>`x check`: import-layer rules; banned-API rules scoped by path.</li><li>`x test --suite parity`: record on each backend, replay headless, same hash; per-object pixel counts from the ID pass agree across backends within tolerance.</li><li>Enhanced features run in the tier test matrix.</li></ul> |

**Terms used throughout:**
- **Sim-side** means deterministic and renderer-free: `core`, `sim`, `physics`, `anim`, `world` (logic), input intents and replay, and the audio DSP.
- **Presentation** means everything that draws or plays: `gfx`, the audio runtime, `ui`, and the input devices.
- **View state** is presentation-only state, such as cape chains, particle positions and camera shake. It may be deterministic for tests, but it is never part of the gameplay hash.

---

## 4. What we found in my-3d2dge

Eight parallel deep-dives read the source in full. Where possible they ran it: builds, the lab tests, Node probes, and a re-run of the CMU import. Their findings are summarized here; the numbers are collected in Appendix D.

### 4.1 The 3D world

**`src/stress-world/`**: 9 files, 2,574 lines, about 55k tokens.
- **What it does:**
  - A hall written as a 64×44 ASCII map, with walls, pillars, low walls, braziers, galleries, stairs and a raised dais. Heights, colliders, a walkable grid and meshes all derive from the text.
  - A kinematic Rapier character controller: walk, dash, jump, autostep, slopes, and pushing.
  - Monsters as dynamic bodies driven by AI-chosen velocities. The solver resolves the crowd, so there is no separation code. Knockback is momentum, launches throw bodies, and corpses slide.
  - A Dijkstra flow field over an 8-neighbour walkable grid that knows climb limits.
  - Instanced puppet batches and a card atlas.
  - A shader warm-up, so no pipeline is built mid-fight.
  - A fixed set of 42 lights, 2 of them casting shadows.
  - Cel, pixel, bloom and FXAA filters in TSL, with an MRT object mask.
  - Cameras: the classic views as ortho or perspective, side scrolling with depth, chase with wall avoidance, first person, fly and fixed. Wall and pillar cutaway.
  - A benchmark that splits CPU time into physics, logic and drawing. Headless: 1 ms per step at 100 monsters, 5.6 ms at 1,000 (2.6 ms of it physics), 33 ms at 5,000 (21 ms physics).
- **What it gets wrong:**
  - **Not fixed-step.** The live loop splits each frame into `ceil(dt/STEP)` equal substeps, so Rapier's step size changes with the display rate.
  - **The renderer leaks into gameplay:**
    - the camera heading feeds monster AI;
    - the visibility set drives animation level of detail;
    - card drawing writes rig state;
    - particle calls own hit-stop.
  - **The hash is weak.** It covers no velocities, rotations, RNG state, corpses or shots, and there is no golden value.
  - **No shared structure.**
    - Glyph meanings are hard-coded in about a dozen places across two files.
    - There is one shared scope with 322 top-level declarations.
    - Tuning numbers are scattered through the code.
- **Bugs:**
  - A probable instancing bug in the `'center'` outline mode.
  - The height "boost" of the classic views was dropped.

**`src/lab3d/`**: 7 files, 1,030 lines. It does several things better than stress-world:
- metres with y up;
- a true fixed 60 Hz loop with a 6-step cap;
- the 6-line height-boost projection `P·V·S·V⁻¹`;
- puppet bodies as a data list (`['limb', a, b, ra, rb, color]` and similar);
- cards drawn from each character's own angle.

Its costs: 1,225 draw calls in Puppet mode (measured: WebGL 2, iso view, shadows on), with no instancing.

**Pick per concern** (§5.1 has the full table):
- From **lab3d**: units, loop, body grammar, boost.
- From **stress-world**: instancing, warm-up, lights, filters, richer cameras and camera links (`?cam=`, `?cam3=`), collision groups, the controller config, richer level text.

**Lessons the labs wrote down** (`docs/LAB-3D.md`):
- Rules never read the drawing.
- Warm up every pipeline before play.
- The r182 instancing bug.
- **"Card" vs "Puppet": a trade-off, not a verdict** (`docs/LAB-3D.md:57-66`; both labs still default to Card). Card keeps the exact 2D look, but it is flat, sits at one depth and ignores the scene's light. Puppet has real depth, real light and works from any camera, but its look is an approximation. **This plan picks Puppet** (§5.1).

### 4.2 The animation core

The core lives in `engine/my-3d2dge.js`: its §11 Humanoid (77 KB) and its §12 Blob.

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
  - Determinism breaks in two ways: `Math.random` sets the breathing phase, and the substep length varies with the display's refresh rate.
  - The state object is loose: misspelled poses fail silently.
- **Size.** The 3D-math part is about 43 KB (12.4k tokens). Card-mode drawing is about 60 KB (17k tokens), and **does not come over**.

### 4.3 The animation library

The library lives in `src/mocap/`, with its tools in `tools/anim-*`, `asf-amc`, `cmu` and `to-glb.py`.

- **Contents:**

  | Set | Clips | Average / worst fit | License |
  |---|---|---|---|
  | Quaternius | 88 | 13.9 / 222 mm | CC0 |
  | Mesh2Motion | 177 | 16.1 / 286 mm | CC0 |
  | CMU (moments cut from takes) | 60 | 17.8 / 167 mm | CMU terms |

  - **Size:** 1.93 MB of text, 393 KB gzipped.
  - **Catalogs:** three hand-written files of tags and descriptions (39 KB).
  - **Ledger:** 2,548 CMU takes (262 KB), with category, fit, flags and usage for each.
- **The format: "readable key poses".** A key holds about 42 integers in named fields: hips height, body/chest/head turn-lean-tilt, and limbs as direction plus bend plus twist. At about 2,100 tokens per clip, agents read and edit it well.
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
- The synth is **not deterministic**: it uses `Math.random` and a wall-clock scheduler.
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

---

## 5. Carry-over inventory: keep, port, rewrite, drop

**Verdicts:**
- **COPY**: byte for byte, or nearly.
- **PORT**: same logic, moved into a typed module in SI units, with the improvements listed.
- **REWRITE**: a new implementation that keeps the proven ideas.
- **CONCEPT**: re-implement only the idea.
- **DROP**: does not come over.

Source paths are relative to `my-3d2dge@e37e4ee`. `ed/` means `src/emberdeep/`. The engine file is `engine/my-3d2dge.js`, cited as `engine:line`. The WP column points to §9.

### 5.1 The 3D world runtime (`src/stress-world/`, `src/lab3d/`, `src/free-camera.*`)

| Item | Source | Verdict | Target | WP |
|---|---|---|---|---|
| Renderer bootstrap: `WebGPURenderer`, `forceWebGL`, backend label | `stress-world/00-setup.js:67-71`, `lab3d/00-setup.js` | PORT. Await `init()` once; log the backend and compat mode; never fall back silently | `engine/gfx/renderer.ts` | 5.1 |
| Fixed-step loop | Good: `lab3d/60-panel.js:143-152` (60 Hz, 6-step cap). Bad: `stress-world/50-frame.js:83` (variable substeps) | PORT lab3d's design as an accumulator with interpolation | `engine/core/time.ts`, `engine/app/loop.ts` | 1.3, 9.1 |
| State hash | `stress-world/00-setup.js:59` (FNV-1a over float32) | REWRITE: canonical component fields as float64 bits, plus RNG states, plus a hash of Rapier's snapshot, plus a per-step trace | `engine/core/hash.ts`, `engine/sim/state.ts` | 1.1, 1.4 |
| `SIM.run(600)` scripted proof | `stress-world/20-sim.js:587`, `lab3d/30-physics.js` | REWRITE as replay files run in Node and in both browser backends | `engine/sim/replay.ts`, `tests/replays/` | 1.5 |
| Rapier world, units, collision groups | `stress-world/20-sim.js:32` (groups: world, prop, hero, mob, wisp, dead) | PORT. SI units, deterministic build, one parameters table | `engine/physics/world.ts` | 2.1 |
| Character controller | `stress-world/20-sim.js`. Capsule half-height 9 and radius 4.5 units; offset 0.3, snap 4, autostep (4, 2), max slope 50°, slide, impulses at character mass 2500; speed 80, jump 150, dash 260 | PORT, converted to SI: 0.5625 m, 0.281 m, 0.019 m, 0.25 m, (0.25, 0.125) m, 5 m/s, 9.375 m/s, 16.25 m/s (Appendix C). Add the grounded-flicker workaround | `engine/physics/character.ts` | 2.2 |
| Crowd as dynamic bodies | `stress-world/20-sim.js`: velocity intents, locked rotations, zero-friction combine, sleeping, knockback as momentum, launches, a corpse group | PORT the pattern | `engine/physics/bodies.ts` | 2.3 |
| Walker, slime and wisp AI; attack tokens; waves | `stress-world/20-sim.js` | Keep as **benchmark sample content only**. Token-limited attackers become a generic `world/ai` helper | `labs/stress-world/`, `engine/world/ai.ts` | 9.3, 6.4 |
| Level as text | Hall 64×44: `# P w t = ^ o .` (`stress-world/10-hall.js`). Room 13×11: `# T P . c C m d` (`lab3d/20-world.js:12-35`) | REWRITE as a **legend-driven compiler** with `validate()`. The hall and room become fixtures | `engine/world/level/*`, `fixtures/levels/` | 6.1 |
| Heights, walkable grid, flow field | `stress-world/10-hall.js`: `floorH`/`topH`, `PASS` with an 8-neighbour `CLIMB` limit, Dijkstra `FLOW` without per-step allocation | PORT | `engine/world/nav.ts` | 6.2 |
| Colliders from text | Greedy rectangle merge, convex wedges for stairs, the dais frustum (`10-hall.js`) | PORT | `engine/world/level/colliders.ts` | 6.1 |
| Procedural texture bake | `bake()`, duplicated in both labs | REWRITE: `DataTexture`, mipmaps, albedo, normal, roughness and emissive channels, tiling generators | `engine/gfx/textures/` | 5.3 |
| Toon bands, node materials | `stress-world/00-setup.js` (`TOON_BANDS`, `objMat`) | PORT | `engine/gfx/materials/` | 5.2 |
| Outline (inverted hull in TSL) | `stress-world/00-setup.js:102-116` | PORT and FIX: use `positionGeometry` (r185+) and fix `'center'` mode on instances. Add an ID/depth edge outline as a post pass (from the fly renderer's idea) | `engine/gfx/materials/outline.ts`, `engine/gfx/post/edges.ts` | 5.2, 5.9 |
| Puppet body grammar | `lab3d/40-characters.js:8-48`: `['limb',a,b,ra,rb,c]`, `['curve',a,b,bow,ra,rb,c]`, `['ball',a,r,c]`, `['eye',a,r,c]`, `['sword']`, `['cape']`; points are a joint name, `[f,r,u]`, `['lerp',p,q,t]` or `['off',p,df,dr,du]` | PORT and EXTEND: bones, sockets, mirrored parts, material slots, metres | `engine/gfx/puppets/` | 5.6 |
| Instanced puppet batches | `stress-world/30-crowd.js:20-67` (`Batch.tube/ball/box/cone`) | PORT behind an instancing service | `engine/gfx/instancing.ts` | 5.5 |
| Cards (the engine draws sprites into an atlas) | `stress-world/30-crowd.js`, `lab3d/40-characters.js` | **DROP**. Puppets won; the pixel look becomes a post filter | — | — |
| Lights | 42 fixed point lights plus a hemisphere light; 2 shadow casters. Built in `stress-world/10-hall.js:435-466`, driven each frame by `50-frame.js:58-63` and `35-effects.js:107-109` | REWRITE: a light pool on r184's `DynamicLighting` (no recompile when the count changes), a shadow-caster budget, flicker on the visual RNG | `engine/gfx/lights.ts` | 5.7 |
| Fog that starts past the focus | `stress-world/50-frame.js` | PORT, adding height fog | `engine/gfx/atmosphere.ts` | 5.7 |
| Warm-up (draw everything once before play) | `stress-world/50-frame.js` | REWRITE as a registry using `compileAsync` with progress, and a **public** pipeline counter instead of `renderer._pipelines` | `engine/gfx/warmup.ts` | 5.2 |
| Cameras | `stress-world/40-cameras.js`: classic views (perspective or ortho), side scrolling with depth, chase with wall avoidance, first person, fly, fixed. `lab3d/50-cameras.js`: orbit. Camera links: `stress-world/40-cameras.js:274-337` (`?cam=`, `?cam3=`) and lab3d's `CAMS.code()`/`load()` | PORT | `engine/gfx/cameras/` | 5.8 |
| Height boost projection `P·V·S·V⁻¹` | `lab3d/50-cameras.js:31-40` | COPY (6 lines) | `engine/gfx/cameras/boost.ts` | 5.8 |
| Wall and pillar cutaway | `stress-world/10-hall.js`, `40-cameras.js` | PORT | `engine/gfx/cutaway.ts` | 5.8 |
| Post filters with an MRT mask | `stress-world/45-filters.js`: cel, pixel/Bayer, bloom, FXAA | PORT to `RenderPipeline` (r183+), using allowlisted TSL display addons where they exist | `engine/gfx/post/` | 5.9 |
| Resolution modes | `stress-world/50-frame.js` `fit()`: engine pixels at 200–330 lines, balanced, full | PORT | `engine/gfx/renderer.ts` | 5.1 |
| Effects | `stress-world/35-effects.js`: telegraph decal pool, ribbons from `rig.trail`, particle quads. Blob shadows: `stress-world/30-crowd.js:334-364` (`shadowAt`) | PORT | `engine/gfx/fx/` | 5.10 |
| Damage numbers on a pixel-font overlay | `stress-world/35-effects.js:133-149` | PORT | `engine/ui/overlay.ts` | 8.2 |
| Panel, HUD, page template | `stress-world/60-panel.js`, templates | REWRITE: the dev panel is generated from the settings schema | `engine/dev/panel.ts` | 8.4 |
| Benchmark (physics, logic and drawing split; copyable report) | `stress-world/60-panel.js` | PORT as `x perf` plus the Stress World lab | `tools/cmd/perf.mjs`, `labs/stress-world/` | 9.3 |
| `window.__sw`, `window.__lab3d` | `60-panel.js` in both labs | REWRITE as one `window.__engine` | `engine/dev/inspector.ts` | 1.6, 8.3 |
| Fly renderer (a CPU rasterizer) | `src/free-camera.fly.js` (247 lines) | DROP the code. Keep two ideas: ID/depth edge outlines (WP 5.9), and a Node "agent eye" visibility raster (WP 11.4) | — | — |
| Free-camera room, perspective lab, shapes comparison | `src/free-camera.game.js`, `src/lab.game.js`, `src/shapes-*` | **DROP**. The shapes data comes from converted CC0 models, which breaks L1 | — | — |

### 5.2 The animation core (`engine/my-3d2dge.js` §1, §10–§12)

| Item | Source | Verdict | Target | WP |
|---|---|---|---|---|
| Math helpers: `clamp lerp approach ease angDiff lerpAng approachAng smoothDamp` | `engine:72-96` | PORT | `engine/core/math.ts` | 1.1 |
| `ik3`, the two-bone IK | `engine:129-140` (12 lines) | COPY, plus `twoBoneRot` with an explicit pole | `engine/anim/ik.ts` | 3.2 |
| Joint set (15 positions) and its implicit hierarchy | `engine:1753`, `_pose()` `engine:1917-1994` | REWRITE as data: **root plus 23 joints**, with local rotations (§6.3, Appendix C) | `engine/anim/skeleton.ts` | 3.1 |
| `_w` (rig-local to world, via facing, spin, `_cheat`, size, squash) | `engine:1794` | REWRITE as a root transform plus a squash scale channel | `engine/anim/skeleton.ts` | 3.1 |
| Gait, idle, lean and arm-swing formulas | `engine:1919-1954` | PORT, in metres, with constants in tables | `engine/anim/locomotion.ts` | 3.3 |
| Pose and stance effector targets | `engine:1924-1937, 1955-1968` | PORT into tables | `engine/anim/poses.ts` | 3.3 |
| Attack arm path: anticipation from the real pose (`_from`), overshoot, hold, blend back by position | `engine:1842-1867, 1950-1951, 1969-1986` | PORT | `engine/anim/moves.ts` | 3.4 |
| `E.MOVES` (24), `Attack`, `Combo`, `E.move`, `E.knockback` | `engine:2467-2577` | PORT. Fields become self-describing and in metres; `hitAt` belongs to the move; add events, root-motion curves and sweeps | `engine/anim/moves.ts`, `engine/anim/moves-data.ts` | 3.4 |
| `inArc` and `Attack.hits` | `engine:194`, `engine:2467-2504` | REWRITE: events, weapon sweeps, and a measured `hitShape` cached per move. `inArc` stays as the cheap test | `engine/anim/moves.ts`, `engine/sim/hits.ts` | 3.4 |
| Knockdown (rigid rotation of every joint) | `engine:1989-1993` | REWRITE: root rotation, a ragdoll hand-off, and get-up timelines chosen by face up or face down | `engine/anim/reactions.ts` | 3.5 |
| Squash spring `kick(v)` | `engine:1788` (`kick`), `engine:1832` (the spring) | PORT as a root-scale channel that preserves volume | `engine/anim/secondary.ts` | 3.5 |
| Hair verlet; cape (two verlet edges) | `engine:1900-1916`; `engine:2033-2068` | PORT as one generic `Chain` (a cape is 2 chains plus a width constraint), with bone-capsule colliders | `engine/anim/secondary.ts` | 3.5 |
| Weapon-trail sampling | `engine:1885-1897` | PORT as socket history | `engine/anim/character.ts` | 3.6 |
| `die` timeline | `engine:1824-1827` | PORT | `engine/anim/reactions.ts` | 3.5 |
| Blob rig update | `engine:2595-2602` | PORT | `engine/anim/blob.ts` | 3.7 |
| Builds: `chibi heroic bulky skeleton`, `size` | `engine` §11 | PORT the skeletal fields in metres. The drawing fields go to the body generator | `engine/anim/builds.ts`, `engine/gfx/puppets/` | 3.1, 5.6 |
| Visual options: outfits, hair, hats, armor, capes, faces | 2D drawing in `engine` §11 | CONCEPT: re-expressed as puppet body parts | `engine/gfx/puppets/bodies/` | 5.6 |
| `Math.random()` breathing phase (`engine:1782`); variable substeps (`engine:1644`) | | REWRITE: a seeded stream per entity, and a fixed dt | `engine/anim/*`, `engine/core/time.ts` | 3.3, 1.3 |
| `_drawHD`, `_drawClassic`, `_hat`, portraits, the Blob draw, `style:'classic'` | `engine` §11–§12 (about 42 KB) | **DROP** | — | — |
| View hacks: `charView`, `charPitch`, `zBoost`, `_cheat`, `_camSide`, automatic side-plane chops, the ground smear, Blob screen-space wings | `engine:2017, 2087-2093` and others | **DROP**. A 3D camera makes them unnecessary, and they write simulation state from drawing | — | — |

### 5.3 The animation library and its tools (`src/mocap/`, `examples/cmu-lib/`, `tools/anim-*`)

| Item | Size | Verdict | Target | WP |
|---|---|---|---|---|
| `src/mocap/readable.js` (format 1 codec: text, parse, mirror, fit, encode, decode) | 29 KB | PORT: the decode becomes a typed module that takes its trig from `core/dmath`, matching the source within 0.001 mm. The source decoder is kept unchanged as a test oracle, `tools/anim/legacy-readable.mjs` (tools may use `Math.*`). Becomes a typed module, adds format-2 fields, `bake()`, a validator and a normalized lens | `engine/anim/clip/readable.ts` | 4.2 |
| `src/mocap/mocap.js` (`load` `clip` `sample` `moveAt` `blend` `text` `replace` `restore` `origin`; `drive`; `Mannequin`) | 20 KB | REWRITE: keep the API and `drive`'s ideas (sole to floor, lift, heading trust ramp, blade along the knuckles and never below the floor, the upper mask). Playback becomes a clip layer on the rotation skeleton. The Mannequin is rebuilt in 3D from `body.segs` | `engine/anim/clip/library.ts`, `engine/anim/character.ts`, `engine/gfx/puppets/mannequin.ts` | 4.4 |
| Sets `quaternius.js` (88), `mesh2motion.js` (177), `cmu.js` (60) | 387 / 819 / 722 KB | KEEP THE DATA, repackaged one clip per file (deep-equal proof). The 84 Mesh2Motion re-exports are tagged `alt` | `data/anim/sets/<set>/` | 4.3 |
| `sets/hero.js` (15 clips, Emberdeep's subset) | 75 KB | **DROP** | — | — |
| Catalogs `quaternius.json`, `mesh2motion.json` | 30 KB | COPY | `data/anim/catalogs/` | 4.1 |
| Catalog `cmu.json` | 9.5 KB | COPY, and FIX the license: no resale "even in converted form", plus the NSF acknowledgment, verbatim | `data/anim/catalogs/`, `data/anim/SOURCES.md` | 4.1 |
| Ledger `cmu-takes.tsv` (2,548 takes) | 262 KB | PORT: split into 17 category files plus `subjects.tsv` (join-back proof). Fix the category fallback; verify the 113 takes whose frame rate was assumed (`fps?`) | `data/anim/cmu/` | 4.1, 4.5 |
| `examples/cmu-lib/` (every take, 114 files) | 68 MB | **DROP** from git. Regenerated on demand into `.cache/` | `.cache/anim/cmu-lib/` | 4.5 |
| `tools/anim-import.mjs` (GLB → set; rig maps; fit; provenance) | 24 KB | PORT: split into GLB reader, rig map and importer. Guard CUBICSPLINE and signed or quantized accessors. Add format-2 fields (the default); `--legacy` writes format 1 exactly as today | `tools/anim/` (`x anim import`) | 4.5 |
| `tools/asf-amc.mjs` (ASF/AMC reader, FK, loop-cycle search, floor estimate) | 16 KB | PORT: output rotations too. Interpolating source frames instead of taking the nearest is the default for new imports; `--legacy` keeps nearest-frame sampling, to reproduce today's set | `tools/anim/asf-amc.mjs` | 4.5 |
| `tools/cmu.mjs` (find, get, all, survey, library, ledger) | 24 KB | PORT: write to `.cache/`, emit the split ledger, add `--json` | `tools/anim/cmu.mjs` (`x anim cmu`) | 4.5 |
| `tools/anim-set.mjs`, `tools/mocap-lib.mjs` | 5 KB | PORT, reading and writing one file per clip | `x anim cut` | 4.5 |
| `tools/anim-sheet.mjs` (contact sheets through Playwright) | 6 KB | REWRITE as a Node renderer: SVG, and PNG via a 40-line zlib encoder, no browser | `x anim sheet` | 4.6 |
| `tools/to-glb.py` (Blender: FBX, BVH or blend → GLB) | 3 KB | COPY: optional, with `bpy` pinned | `tools/anim/to-glb.py` | 4.5 |
| `tools/mocap-test.mjs` | 16 KB | REWRITE as Node unit tests (format, provenance, ledger, picks, lints) plus a browser smoke test on both backends | `engine/anim/clip/*.test.ts`, `tests/browser/library.spec.ts` | 4.6 |
| Mocap Lab (`src/mocap.game.js`, `src/mocap.template.html`) | 43 KB | REWRITE as the 3D Library Lab. Keep the UX: catalog search; the clip as text with Apply, Reset, Mirror and Copy for model; deep links; frame stepping | `labs/library/` | 9.5 |
| `docs/MOCAP.md` | 44 KB | PORT: keep the library recipe, provenance, source and license table, the CMU workflow and "Looking ahead"; rewrite the format and retargeting sections | `docs/ANIMATION-LIBRARY.md` | 4.1 |
| `docs/ANIMATION-RESEARCH.md` (40 ranked animations, 24 timing references) | 51 KB | PORT: drop the 2D "Engine" column; add the coverage map against the library | `docs/ANIMATION-RESEARCH.md` | 4.1 |
| `tools/ed-clips-test.mjs`, `ed/96-hero-clips.js` | | **DROP**. Its moments table (`HCL_MOVES`) is design input for the clip-action layer | — | 4.8 |

### 5.4 The 2D engine's other systems

| Item | Source | Verdict | Target | WP |
|---|---|---|---|---|
| `E.rng` (Mulberry32), `E.hash2`, `E.noise2` | `engine` §1 | PORT bit-exact, then add seeded 3D, tiling, octave and cell noise | `engine/core/rng.ts`, `engine/core/noise.ts` | 1.1 |
| Colour: `hex shade mix tones ramp` | `engine` §1 | PORT, adding linear and sRGB conversion | `engine/core/color.ts` | 1.1 |
| Warn-once, red error box, `game.errors` | `engine:65-66`, `engine:1477-1492, 1683-1691` | PORT, adding stable codes, structured records and JSON | `engine/core/log.ts`, `engine/dev/overlay.ts` | 1.2, 8.3 |
| Sound data: 33 effects, 6 drums, 5 songs | `engine` §20 | COPY the data into typed modules, with validators (track length must divide the bar) | `engine/audio/data/` | 7.2 |
| Chip synth (Web Audio: 7 waves, envelopes, sweeps, arpeggios, vibrato, delay, buses, ducking) | `engine:3647-3856` | REWRITE as **pure DSP into `Float32Array`s** (seeded, hashable, runs in Node), plus a Web Audio runtime | `engine/audio/dsp/`, `engine/audio/runtime/` | 7.1, 7.3 |
| Pixel font (5×7 proportional and 3×5) | `engine` §6; compact encoding in the agent edition | PORT, using the compact encoding | `engine/ui/font.ts` | 8.2 |
| `E.ui.box/bar/hearts`, `Dialog`, `Menu` | `engine` §21 | PORT onto the overlay, with input and sound injected, plus `ui.state()` for tests | `engine/ui/` | 8.2 |
| Input: named actions, presets, edge detection in sim time, `repeat`, `buffered`/`consume`, radial deadzone, clear on blur | `engine:476-694` | PORT the action model. REWRITE the devices: pointer lock, axes, rebinding as data, camera-relative intents, a recorder, a virtual device | `engine/input/` | 8.1 |
| `E.tex` (7 generators: flagstone, grass, dirt, water, planks, checker, plain) | `engine:3057-3101` | PORT as seeded, **tiling** generators with height, roughness and emissive channels | `engine/gfx/textures/generators/` | 5.3 |
| Backdrop strips (10 presets, 512 px tiling layers) | `engine` §21b | PORT the generators for a sky cylinder, and add a TSL sky dome | `engine/gfx/sky.ts` | 5.7 |
| `parseLevel` | `engine` §13 | PORT | `engine/world/level/parse.ts` | 6.1 |
| Flow field (4-neighbour BFS) | `engine:3018-3054` | DROP in favour of stress-world's Dijkstra | — | 6.2 |
| `SpatialHash` | `engine:3626-3646` | PORT on typed arrays | `engine/world/spatial.ts` | 6.2 |
| `Bullets` and `E.pattern` | `engine:3553-3625` | PORT to 3D, with swept hit tests (fast bullets pass through targets today) | `engine/world/projectiles.ts` | 6.4 |
| Platformer feel: coyote time, jump buffer, variable jump height, wall jump, dash | `engine` §16 | PORT onto the character controller | `engine/physics/character.ts` | 2.2 |
| Scenes, timers (`after`, `every`, `{cancel}`), `E.store` | `engine` §10 (`after`/`every`, `engine:1594-1597`); `E.store` `engine:198-202` (§1) | PORT. Timers run in sim time. The store gains a configurable prefix (today a fixed `my3d2dge:`), a memory backend and versioning | `engine/core/time.ts`, `engine/app/` | 1.3, 9.1 |
| WebGPU lighting module's habits (detect, validate, fall back, report status, snapshot for tests, URL switch) | `engine:4329-4650` | CONCEPT for the tier system | `engine/gfx/renderer.ts`, `engine/gfx/tiers.ts` | 5.1 |
| Renderer effect list (outline, flash, afterimages, x-ray, decals, `textAt`), cutaway, wall-foot shadows, the 38-prop catalog with light metadata, view and resolution presets | `engine` §9, §13, §21c | CONCEPT, rebuilt in 3D | `engine/gfx/*`, `engine/world/props/` | 5.x, 6.3 |
| Pixel primitives, canvas lighting, depth-sort renderer, TileMap and PlatformMap drawing and collision, `Body`, `E.style`, `charView`, `Screen`, the 2D views | `engine` §2–§4, §7, §9, §13, §16, §17 | **DROP** | — | — |
| The agent edition (`engine/my-3d2dge-agent.js`) | 217 KB, about three-quarters a verbatim copy of the engine (75–82%, depending on how lines are matched) | **DROP** the copy. Keep its ideas: the header is the manual, doc examples are executed, token counts are reported | `x docs --check` | 0.6 |

### 5.5 Tooling and workflow (`tools/`, `.claude/`, `CLAUDE.md`, `package.json`, `vercel.json`)

| Item | Verdict | Target | WP |
|---|---|---|---|
| `tools/stamp.mjs` (writes the commit into the build at deploy) | COPY | `x stamp` | 0.7 |
| `tools/vendor-3d.mjs` (pinned `npm pack`, sha256, `--check`) | PORT: copy from `node_modules`, add npm integrity pins, a generated import map and an addon allowlist | `x vendor` | 0.3 |
| `.claude/hooks/session-start.sh` (`npm install`, `CHROMIUM_PATH`) | PORT: switch to `npm ci`; add `x src` and `x vendor --check` | `.claude/hooks/` | 0.10 |
| Virtual clock plus seeded `Math.random`, injected before page scripts run (`tools/filmstrip.mjs:39-53`) | COPY | `tools/lib/browser.mjs` | 0.2 |
| Headless WebGPU: flags, a stand-in `getContext('webgpu')`, `__readFrame` readback (`tools/lab3d-test.mjs:70-102`) | COPY | `tools/lib/browser.mjs` | 0.2 |
| Banned-API list (`tools/lab3d-test.mjs:28-43`) | PORT: extend with the r183–r186 renames and their replacements; scope by path | `tools/lib/rules.mjs` | 0.4 |
| Static server that emulates the deploy's routes (copied 4 times) | PORT once | `tools/lib/serve.mjs` | 0.2 |
| `tools/test-run.mjs` (path-prefix suite map; list, files, reasons, timing; filters out version-only changes) | PORT the logic onto the **import graph**, with workers and JSON output | `x test` | 0.5 |
| `tools/version.mjs` (8 regex places) | PORT, simplified: the version lives in `package.json` only, with changelog fragments | `x version`, `x release` | 0.7 |
| `tools/filmstrip.mjs` (step DSL; A/B/diff contact sheets) | PORT: 3D frame source, named RNG streams, a tolerance, ID attribution, JSON | `x film` | 5.11 |
| `tools/check.mjs` (scripted play, look notes with fixes, `report.json`) | REWRITE for 3D | `x shot` | 5.11 |
| `tools/ed-sheet.mjs` (character sheet with numeric lints) | SPLIT: the motion lints move to Node (measured at 0.28 s for 24 moves); the sheet becomes 3D cameras × states | `x lint anim`, `x sheet` | 3.9 |
| `tools/labs-test.mjs`, `src/labs.json`, `src/labs.template.html` | PORT, adding an `answer` field and an expiry date for temporary labs | `labs/`, `x lab` | 9.7 |
| `tools/agent-test.mjs` | DROP the parity half. Keep doctest extraction, path checks and token counting | `x docs --check` | 0.6 |
| Patterns in `new-character.mjs --test`, `ed-play.mjs` (step DSL), `ed-balance.mjs` (autopilot plus virtual clock), `ed-smoke.mjs`, `character-check.mjs` | CONCEPT | `x new`, `x run --steps`, `dev/bot`, smoke tests | 8.6, 11.2 |
| `tools/lab3d-test.mjs`, `tools/stress-world-test.mjs` | REWRITE as browser suites on the shared harness | `tests/browser/` | 5.x, 9.x |
| `ed-syntax`, `slice-test`, `ed-build`, the `build.mjs` directives (`@inline-module`, `@inline-head`) | **DROP**: ES modules and `tsc` replace them | — | — |
| The 14 Emberdeep tools, `tools/stress-test.mjs` (2D), `tools/ed-codex-showcase.mjs`, `docs/assets/` | **DROP** | — | — |
| `vercel.json` (serves committed files; rewrites) | REWRITE: build from source; no committed output | `vercel.json` | 9.7 |
| `CLAUDE.md` rules (version bump, rebuild, `test:changed`, merge, then the full suite in the background) | REWRITE as AGENTS.md, each rule paired with its check, with CI as the gate | `AGENTS.md`, `CLAUDE.md` | 0.1 |

### 5.6 Engine-grade patterns harvested from Emberdeep (rebuilt generically, never copied)

| Pattern | Where it lives in the game | Engine feature | WP |
|---|---|---|---|
| Registry `def(kind, id, spec)` | `ed/00-core.js:76-87` | `core/registry`: `defineKind` with a schema (fields, defaults, docs, ranges, required hooks), fallbacks, duplicate warnings | 1.2 |
| "Ask the entry, never the id"; optional hooks with defaults | `ed/18-characters.js:1-4` | Registry hook discipline; shared code never compares ids | 1.2 |
| Event bus with lifetimes; each listener isolated so its failures land in `errors` | `ed/00-core.js:89-100` | `core/events` with scopes, isolation and a trace ring | 1.2 |
| Named seeded RNG streams | `ed/00-core.js:102-117` | `core/rng` | 1.1 |
| Body contract plus `checkRig` (14 states × 2 facings × 5 views) | `ed/18-characters.js:34-48, 82-143` | `anim/check`: body states × facings × camera presets | 3.1, 3.9 |
| Character-sheet lints: pops relative to the neighbouring steps, idle foot slide, joints under the floor, bone stretch over 12%, vanishing views, contrast | `tools/ed-sheet.mjs:107-131` | `x lint anim`, `x sheet` | 3.9 |
| Intent vocabulary (here: body states); body adapters ("what the pattern asks of a Humanoid, spoken to a spider") | `ed/18-characters.js:36-38`, `ed/33-beasts.js:1053-1060` | `anim/states` | 3.6 |
| 16 procedural rig building blocks (eased state weights, reverse-knee IK, critically damped springs, angle blending, sway chains, multi-leg planted gait, lagging parts, path-history chains, verlet strands, look-at and blink, floaters, orbiters and detached parts, delayed pose replay, joint-attached extras, tip trails, animation-measured reach) | `ed/22-char-dan.js`, `ed/21-codex.js`, `ed/33-beasts.js` (`BST_Crawler` :85, `BST_Serpent` :602, `BST_Eye` :858), `ed/36-bosses.js:646-660`, `ed/30-monsters-core.js:31-41` | `anim/proc`, with one new fixture rig per block | 3.8 |
| One attack timeline (wind, active, recover, with progress `u`) shared by the rig, hit windows, telegraphs, AI, the bot and perfect dodges | `ed/25-skills-core.js:69-101`, `ed/93-autopilot.js:62-66` | `anim/moves` `Timeline` | 3.4 |
| Stacked slow motion with ids (the slowest wins), a leaky hit-stop budget, per-entity clocks | `ed/00-core.js:146-161` (slow motion), `ed/10-combat.js:45-76` (hit-stop budget), `ed/30-monsters-core.js:300` and `ed/10-combat.js:320` (per-entity clocks) | `core/time` | 1.3 |
| Telegraph shapes as data with near-miss tests; an attack-token manager | `ed/10-combat.js`, `ed/30-monsters-core.js` | `gfx/fx/telegraph`, `world/ai` | 5.10, 6.4 |
| Tuning registry: knobs with tier, range, unit, explanation and source file; overrides; JSON export; a TUNED marker | `ed/01-tune.js`, `ed/62-developer.js`, `TUNING.md` | `core/settings`, `dev/tuning` | 1.2, 8.4 |
| Developer sandbox (throwaway save, god mode, freeze AI, step, speed, spawn, travel) | `ed/62-developer.js` | `dev/sandbox`, with `registerDevAction` | 8.4 |
| Autopilot (a virtual device, a progress watchdog, stuck detection measured along the wanted direction, deterministic runs) | `ed/93-autopilot.js` | `dev/bot` (navigation and watchdogs, no combat tactics) | 8.6 |
| Gallery of everything registered, with deep links and wrong-name warnings that list the valid names | `ed/92-gallery.js` | `dev/gallery` | 8.5 |
| Performance governor with hysteresis | `ed/95-perf.js` | `dev/governor`, which owns the Enhanced-tier features and LOD | 8.7 |
| Controls rebinding (conflicts, reserved keys, persistence, any gamepad slot, separate menu actions, a touch layer, safe areas) | `ed/61-controls.js`, `docs/CONTROLS-AUDIT.md` | `input/bindings` | 8.1 |
| Data-defined layered sound effects, tracker-string songs, stings fired by events | `ed/70-audio.js` | `audio` (the mechanism, not Emberdeep's sounds) | 7.2, 7.3 |
| Captured clips layered on a procedural rig (masks, crossfades, walk/hold/next flags, cancel rules, landmark times) | `ed/96-hero-clips.js` | `anim` clip-action layer and events | 4.4, 4.8 |
| Deep links, a debug handle, a step-script DSL | `ed/99-start.js`, `tools/ed-play.mjs` | `app/routes`, `dev/inspector`, `x run --steps` | 8.3, 9.1 |
| Composition (role-based selection, a novelty scheduler, name grammar, recolouring with a luminance guard) | `ed/35-bosses-core.js:170-171`, `ed/50-levels-core.js:70-72, 329-335` | `engine/compose`, built when the first game needs it (backlog) | — |
| Saves isolated in demo, sandbox and gallery modes; deduplicated errors and warnings | `ed/` various | `app/store`, `core/log` | 9.1, 1.2 |

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
- `src/starter/` (the genre kits). Two pieces are taken only as design input: the Animation Lab's UX (WP 9.4) and the blob leap parameters (WP 3.7);
- `src/arena.*`;
- `src/stress.game.js` (the 2D stress test);
- `src/lab.*` (the perspective lab);
- `src/free-camera.*`;
- `src/shapes-*`;
- `examples/` and `dist/` (build outputs);
- the scarfrunner prototype.

**Grey areas become new fixtures, never ports:**
- **A neutral test mannequin**, not the Wanderer.
- **Six small fixture rigs** (80–150 lines of geometric primitives each): a digitigrade biped, a hexapod, a serpent (path chain), a floater, a multi-arm and a tentacle. `fixtures/rigs/README.md` maps each of the 16 building blocks to at least one of them.
- **Combat fixtures:** a training dummy, neutral `test_*` patterns, surface tags and damage types.
- **A small fixture sound set and one demo song** for tests and the gallery, alongside the engine's own ported presets.

---

## 6. Target architecture

### 6.1 Layers and import rules

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ app/    createEngine, loop wiring, scenes, routes and deep links, store            (may import all) │
│ dev/    inspector (__engine), overlay, panel, tuning, sandbox, gallery, bot, governor (all but app)  │
├──────────────────────────────── PRESENTATION (reads sim snapshots; never writes them) ─────────────┤
│ gfx/ (three.js)   gfx/enhanced/ (WebGPU-only, via gfx/tiers)   audio/runtime (Web Audio)            │
│ ui/ (overlay canvas/DOM)   input/devices (DOM events → intents)                                      │
├──────────────────────────────── SIM-SIDE (deterministic; runs in Node; no DOM, three or Web Audio) ──┤
│ sim/ (world, systems, state, hash, replay, hits)                                                      │
│ physics/ (the only Rapier import)   anim/ (skeleton, layers, IK, moves, clips, proc)                  │
│ world/ (level compiler, nav, spatial, props data, projectiles, ai)   input/intents   audio/dsp       │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ core/   math, dmath, rng, noise, hash, color, time, events, registry, log, settings, schema         │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Allowed import edges**, checked by `x check` against `tools/lib/layers.json`:

| Module | May import |
|---|---|
| `core` | nothing from the engine |
| `anim`, `world`, `input/intents`, `audio/dsp` | `core` |
| `physics` | `core` and Rapier |
| `sim` | `core`, `anim`, `physics`, `world`, `input/intents` |
| `gfx` | `core`, `anim` (pose evaluation), `world` (mesh and level descriptors), sim **types, snapshots and the read-only `QueryView`**, and `three` |
| `gfx/enhanced/*` | `gfx`, `core`. Imported **only** by `gfx/tiers.ts` |
| `audio/runtime` | `audio/dsp`, `core`, sim snapshot types and the `QueryView` (occlusion rays) |
| `ui` | `core`, `input/intents`, `gfx` (camera projection, overlay sizing) |
| `input/devices` | `core`, `input/intents`. `app` passes the camera in |
| `dev` | everything except `app` |
| `app` | everything |

**Reaching physics from presentation.** Presentation code reaches physics only through the read-only **`QueryView`** that `sim.snapshot()` returns (`raycast`, `probe`, `overlap`). It never imports `physics/`. The chase camera's wall avoidance and audio occlusion both use it.

**Data descriptors.** `world` holds data descriptors (a prop names its geometry, material and body by id). `gfx` turns those descriptors into meshes.

**Single owners:**
- Only `physics/` imports Rapier.
- Only `gfx/` imports `three`.
- Only `audio/runtime/` touches Web Audio.
- Only presentation code (`gfx`, `audio/runtime`, `ui`, `input/devices`), `dev` and `app` touch browser APIs (DOM, canvas, URL, Web Audio). URL parameters are parsed once, in `app/routes`, and passed down.
- Tests and tools may import anything.

### 6.2 Repository layout

```
my-3dge/
  AGENTS.md                 the rules; each one paired with the check that enforces it (Appendix E)
  CLAUDE.md                 "@AGENTS.md" plus Claude Code specifics
  PLAN.md                   this plan (the ledger in §14 is updated as work lands)
  README.md  LICENSE (MIT)  package.json  package-lock.json  tsconfig.json  x.js (the CLI entry; ESM via "type": "module")
  engine/                   TypeScript, erasable syntax only, ES modules, unit tests beside the code (*.test.ts)
    index.ts                the public API barrel; its header is the engine's front page
    core/  sim/  physics/  anim/  anim/clip/  anim/proc/  world/  world/level/  input/  audio/dsp/
    audio/data/  audio/runtime/  gfx/  gfx/materials/  gfx/textures/  gfx/geometry/  gfx/puppets/
    gfx/cameras/  gfx/post/  gfx/fx/  gfx/enhanced/  ui/  dev/  app/
  data/
    anim/                   sets/<set>/<Clip>.json, sets/<set>/_set.json, sets/<set>/catalog.tsv,
                            catalogs/*.json, cmu/<category>.tsv, cmu/subjects.tsv, SOURCES.md, LICENSES/
  fixtures/                 test-only content: mannequin, one rig per building block, dummy, levels, sounds, scenes
  labs/                     pages: index (labs.json), hello, sandbox, stress-world, anim, library, materials,
                            props, fx, audio, cameras, physics
  tools/
    cmd/<name>.mjs          one module per `x` command; its header is its help
    lint/<family>.mjs       lint families (anim, geo, tex, audio, level) plugged into `x lint`
    templates/<kind>/       scaffold templates for `x new` (each re-tested in CI)
    lib/                    args, report, browser (flags, stand-in canvas, readFrame, virtual clock), serve,
                            importgraph, layers.json, rules (banned APIs), png, tokens, hash
    anim/                   GLB reader, rig maps, importer, ASF/AMC, CMU, to-glb.py
    mcp/                    MCP server bridging __engine (WP 11.1)
  tests/
    browser/                Playwright suites (*.spec.ts), run on both backends
    replays/                *.replay.json: inputs and an expected hash timeline
    baselines/              text thumbnails, lint baselines with reasons, perf budgets
  docs/
    INDEX.md  API.md  ERRORS.md          generated by `x docs --write`, checked for drift
    decisions/ADR-0001-*.md …            one per decision in §13
    ANIMATION-LIBRARY.md  ANIMATION-RESEARCH.md  THREE-DELTA.md (r182 → r186 for agents)  TESTING.md
    vendor/                three-0.186.1-llms-full.txt, TSL-Guide.md (version-pinned upstream docs)
  changes/                  one changelog fragment per change (no shared file to conflict on)
  vendor/
    three-0.186.1/          ESM build (unminified), allowlisted addons, LICENSE, VERSION.json (sha256 + npm integrity)
    rapier3d-deterministic-compat-0.19.3/
  .claude/                  settings.json, hooks/, skills/, agents/
  .github/workflows/        ci.yml, nightly.yml
  (git-ignored)  out/  site/  .cache/  node_modules/
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
  - Named streams: `rng('ai')`, `rng('loot')`, `rng.entity(id, 'anim')`, all derived from the scene seed.
  - Visual streams (`fxRng`) are separate, so adding a particle never changes the AI.
- **Ids.**
  - Registry content uses strings namespaced by kind (`move:slash`, `prop:crate`).
  - Entities use monotonic integers, iterated in id order.
- **Files.**
  - `camelCase.ts`, one concept per file, with the manual header from §6.8.
  - Tests sit beside the code (`time.test.ts`).
  - Imports are explicit with the `.ts` extension; type-only imports use `import type`.

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

### 6.5 The determinism contract

1. **Sim-side code never uses** `Math.random`, `Date.now`, `performance.now`, `setTimeout`/`setInterval`/`requestAnimationFrame`, the DOM, `three` or Web Audio.
   - Nor these, whose results differ between JS engines: `Math.sin cos tan asin acos atan atan2 exp log pow hypot cbrt sinh cosh tanh log1p expm1 log2 log10`. Use `core/dmath` instead.
   - `sqrt`, `abs`, `min`, `max`, `floor`, `ceil`, `round`, `trunc`, `sign`, `fround` and `imul` are exact, so they are allowed.
2. **Fixed step, explicit inputs.**
   - Everything the sim reads from outside arrives in the per-step intents, and is recorded. That includes the camera heading and any presentation fact gameplay chooses to use.
3. **Ordered world.**
   - Entities iterate in id order.
   - Spawns and despawns queue up and apply at step boundaries.
   - Rapier bodies are inserted in a deterministic order.
4. **Physics.**
   - `@dimforge/rapier3d-deterministic-compat`: the only flavor whose README promises cross-platform determinism.
   - Integration parameters are pinned in one table.
   - The version is recorded in replays, because snapshots are version-locked.
5. **The hash.**
   - It is FNV-1a over the float64 bits of the canonical state, plus the state of every **sim** RNG stream (those made by `rng()` or `rng.entity()`), plus a hash of the bytes of `world.takeSnapshot()`.
   - Visual streams (`fxRng`) belong to presentation and are never hashed.
   - The canonical state is the components each kind registers, with their fields in order.
   - It is computed at checkpoints during play, and every step in tests.
   - `trace()` gives per-entity hashes, so a mismatch names the first step, entity and field that diverged.
6. **The proof matrix.**

   | Run | Compared with |
   |---|---|
   | The same replay in Node | the expected hashes |
   | The same replay in Chromium on WebGL 2 and WebGPU | Node |
   | Live play on each backend, recorded and replayed in Node | the live hashes; this catches renderer writes |
   | Nightly: Firefox and WebKit | Node |

### 6.6 Data-first registries and schemas

- **Defining and validating content.**
  - `defineKind(kind, schema)` declares fields, defaults, ranges, units, docs, required hooks and fallbacks.
  - `def(kind, id, spec)` validates, writing plain-sentence errors with codes.
  - `get(kind, id)` warns once on a missing id and returns the kind's fallback.
  - `list(kind)` enumerates.
- **Ask the entry, never the id.** Shared code reads an entry's optional hooks, each with a default. A lint flags string comparisons against registered ids in shared code.
- **Every kind automatically gets** an `x describe <kind>` listing and its row in `docs/INDEX.md`.
- **The kinds listed in §8.13 also get** a scaffold template, a gallery reel and an inspector view.
- **Kinds with a lint family (§8.6) get** lint runs. Other kinds get these extras only when a WP shows they pay off.
- **Initial kinds:** `material`, `texture`, `geometry`, `body` (a puppet body), `skeleton`, `build`, `move`, `pose`, `stance`, `action`, `clipset`, `rig` (custom procedural), `prop`, `glyph` (level legend), `level`, `light`, `sky`, `look` (post preset), `emitter`, `telegraph`, `sfx`, `song`, `actionmap`, `setting`, `scene`, `lab`, `feature` (Enhanced-tier capability), `actor` (an entity template: a body, a controller and a character animator).

### 6.7 Rendering tiers and the parity contract

- **Baseline tier.** The feature set that runs on every backend: WebGL 2, WebGPU in compatibility mode (`renderer.backend.compatibilityMode`), and WebGPU core. A WebGL 2 or compat-mode device runs only this tier.
  - Everything gameplay needs is visible here.
  - Node materials and TSL only.
  - "Map" compute kernels that the WebGL backend emulates with transform feedback are allowed only where they are explicitly listed as Baseline-safe.
- **Enhanced tier.** WebGPU core, with per-feature checks (`float32-filterable`, `timestamp-query`, `subgroups`, limits).
  - Every feature registers `def('feature', id, { requires, fallback, costMs, visualOnly: true })`.
  - Candidates: compute particles, GPU culling with indirect draws, compute skinning, clustered lighting, GTAO/SSAO, SSR, SSGI/VXGI, TRAA/TAAU, volumetrics, god rays.
- **Who chooses.** The performance governor picks the active set, with hysteresis. It is frozen during deterministic tests.
  - `__engine.info()` reports `backend`, `tier`, `compat`, `features[]` and `fallbacks[]`.
  - Every downgrade logs an advice code. **Nothing falls back silently.**
- **The parity contract:**
  1. The same replay gives the same sim hash on every backend.
  2. The object-ID pass gives per-object pixel counts within 0.5% (or 4 px) and bounding boxes within 1 px across backends.
  3. Shaded images are compared only against baselines for the same backend and tier.
  4. Turning any Enhanced feature off never changes the ID pass.
  5. View-only effects stay out of the ID pass: particles, decals, trails and the sky.

### 6.8 The module header standard (the header is the manual)

```ts
/**
 * PURPOSE     What this module is for, in one or two sentences.
 * API         name(args) → result   one line per export (x docs --check compares this list with the real exports)
 * INVARIANTS  Units, ranges, determinism, ownership: what must always hold.
 * EXAMPLE     A short snippet that x docs --check executes.
 * SEE ALSO    Related modules, docs and tests.
 */
```

- Headers run **40 lines or fewer**.
- `docs/INDEX.md` (module → purpose → exports → tests) and `docs/API.md` are generated from the headers and the exports.
- `docs/ERRORS.md` is generated from the advice and error code table.
- **Prose is never duplicated.** README, AGENTS.md and the docs point to these files and never restate them.

### 6.9 Public API sketch (illustrative; WPs refine it)

```ts
import { createEngine, createHeadless } from './engine/index.ts';

const engine = await createEngine({ canvas, backend: 'auto', look: 'toon', seed: 1 });
engine.def('prop', 'crate', { geometry: 'box', size: [0.9, 0.9, 0.9], material: 'planks', body: { type: 'dynamic', mass: 20 } });
engine.def('level', 'hall', { text: HALL, legend: { '#': 'glyph:wall', P: 'glyph:pillar', c: 'prop:crate', H: 'spawn:hero' } });
engine.def('scene', 'demo', {
  level: 'hall',
  setup(w) { w.spawn('actor', { at: 'H', body: 'body:mannequin', skeleton: 'humanoid', controller: 'character' }); },
  step(w, intents) { /* gameplay at 60 Hz: read intents and components, write components, emit events */ },
});
await engine.start('demo');

// Node, no browser:
const h = await createHeadless({ scene: 'demo', seed: 1 });
h.step(600, script); h.hash(); h.trace(); h.state();
```

### 6.10 Dependencies and versions

**Runtime dependencies (vendored, exact pins, checksums plus npm integrity in `VERSION.json`, import map generated):**
- `three@0.186.1` (2026-09-24), the **unminified ESM build**: r186 dropped the minified builds. Plus an explicit allowlist of addon files, such as the TSL display nodes.
- `@dimforge/rapier3d-deterministic-compat@0.19.3`: the same API and size as the prototype's `simd-compat@0.19.3`.

**How the runtime dependencies resolve:**
- **Node** resolves them from `node_modules`: they are exact-pinned `dependencies` in `package.json`.
- **The browser** loads the byte-identical copy in `vendor/`, which `x vendor` generates and `x vendor --check` verifies.

**Development dependencies (pinned, with a lockfile, installed by `npm ci`):**
- `typescript`: try 7.0.x, falling back to 6.0.x;
- `@types/three@0.186.0`;
- `playwright` (1.64.x, with the container's Chromium through `CHROMIUM_PATH`).
- `@types/node@22.x`, for `node:test`.
- Nothing else by default. A PNG encoder is about 40 lines over `node:zlib`, and the test runner is `node:test`.

**Upgrade policy:**
- three.js:
  - one release at a time, and only to a `.1` patch (r185.0 shipped an instancing regression);
  - a nightly canary job against the next release;
  - an upgrade is its own WP, which must pass the goldens, the replays and the tier matrix;
  - skip r187 until r187.1.
- Rapier 0.21.x: a deliberate WP (U-2). Its defaults for sleep, CCD, velocity caps and contacts change gameplay, its snapshot format changes, and its bundle is twice the size.

**Pinned knowledge for agents:**
- `docs/vendor/` holds the official `llms-full.txt` for 0.186 and the TSL Guide.
- `docs/THREE-DELTA.md` explains r182 → r186 for agents whose training favours older APIs.
- Banned-API rules name each replacement (Appendix B).
- **Any three.js deprecation warning fails a test.**

---

## 7. Improvements over the prototype

Each improvement is owned by a work package. A WP is not done until the improvements it lists are in.

| Id | Improvement | What it fixes or replaces | WP |
|---|---|---|---|
| I-01 | One coordinate system: SI units, +Y up, +Z forward, used end to end | `toThree` swaps, quaternion sign flips, a left-handed engine frame | 0.1, 3.1 |
| I-02 | True fixed-step loop with an accumulator and interpolation. Injectable clock, timescale stack, per-entity clocks, leaky hit-stop budget | Variable substeps that make play irreproducible; rigs that depend on the refresh rate | 1.3 |
| I-03 | The sim runs headless in Node: replay and proof suites take milliseconds | The sim could not run without `renderer.init()` and meshes | 1.4–1.6 |
| I-04 | Replay files: record from live play, assert hashes per tick, bisect to the first step, entity and field that diverged | No input recording; only one scripted run | 1.5 |
| I-05 | A strong hash: float64 canonical state, RNG states, Rapier snapshot, per-entity trace | A float32 hash of a few fields; no velocities, RNG or corpses | 1.1, 1.4 |
| I-06 | Cross-browser determinism: `core/dmath` for the sim, Rapier `deterministic-compat`, a nightly Firefox/WebKit/Node matrix | Proven only inside one Chromium; SIMD Rapier is "locally deterministic" only | 1.1, 2.1, 0.9 |
| I-07 | A real parity proof: live play recorded on each backend and replayed headless; the ID pass compared across backends | Parity that held by construction (no rendering between proof steps) | 5.11, 9.2 |
| I-08 | Rotation skeleton (root + 23 joints): skinning, bone masks, slerp blending, additive layers, ragdolls, native head and hand orientation | Joint positions only; `mocapTilt` side channels | 3.1 |
| I-09 | An explicit, inspectable layer stack. Unknown pose or move names warn with suggestions. Drawing never writes sim state. View hacks are gone | Priority hidden in lerp order; silent typos; `_cheat`, `_pitch`, `_camSide` | 3.6 |
| I-10 | Moves as timelines with events (`hitOpen`, `footstep`, `land`…), hit volumes (sweeps plus a measured `hitShape`) and root-motion curves | Flat ground cones; `hitAt` depended on how the attack was built | 3.4 |
| I-11 | New animation capabilities: directional reactions, ragdoll hand-off and get-ups, foot planting on terrain, look-at and aim, hand IK, and an **ACTIONS** layer (multi-beat sequences with held contact frames) | Thin reactions; the "missing layer" named in ANIMATION-RESEARCH | 3.2, 3.5, 4.8 |
| I-12 | 16 procedural creature building blocks, exercised by six fixture rigs (each block used by at least one) that pass their checks | Techniques trapped inside game characters | 3.8 |
| I-13 | Library format 2: a superset with events, contacts, props, hands, foot roll and root yaw. Clips baked to rotation tracks. A validator and a normalized lens. One file per clip. A split ledger. `x anim find`. Corrected licenses. CMU on demand (68 MB → 0 committed) | Point blending that shortened bones; pops `fit` cannot see; the license gap; 68 MB of churn | 4.1–4.6 |
| I-14 | Re-import from the original sources for the missing degrees of freedom: hands, forearm twist, foot roll, spine, root yaw | Fidelity never stored | 4.7 |
| I-15 | three.js r186.1: WebGL 2 instancing on Apple fixed, BatchedMesh fallbacks, non-blocking `compileAsync`, readback buffers, `DynamicLighting`, `ClusteredLighting`, SSAO, VXGI, `SunLight` | r182 bugs that break the WebGL 2 promise | 0.3, 5.x |
| I-16 | Rendering tiers with a capability registry. WebGPU-only features gated by backend, compat mode and feature checks, owned by the governor, and never chosen silently | A blanket ban on compute, or silent fallbacks | 5.1, 10.1 |
| I-17 | A light pool on `DynamicLighting` plus a shadow-caster budget | 42 fixed lights in every lit shader | 5.7 |
| I-18 | A warm-up registry using `compileAsync` with progress, plus a public pipeline counter. "Zero pipelines compiled after warm-up" becomes a test | Reading the private `renderer._pipelines`; stalls after filter toggles | 5.2 |
| I-19 | An instancing service that contains three.js's quirks: uniform-buffer limits, usage set before the first render, colours set before the first render, update ranges | The r182 instancing bug; the r186.1 `setColorAt` bug | 5.5 |
| I-20 | Procedural material library: seeded tiling generators with albedo, height, roughness and emissive; normals from height; mipmaps; pixel and smooth looks; TSL noise nodes; contact sheets | Seams, shimmer, two duplicated bakers | 5.3 |
| I-21 | Puppet bodies as data (bones, sockets, mirrored parts, material slots), compiled to instanced parts or one rigid-skinned mesh per character, with optional smooth skinning | 1,225 draw calls; bodies written as code | 5.6 |
| I-22 | A legend-driven level compiler with `validate()`: heights, stairs, slopes, galleries, a nav grid with climb limits, a Dijkstra flow field | Glyph meanings hard-coded in about a dozen places across two files | 6.1, 6.2 |
| I-23 | Audio: pure-JS DSP (seeded and hashable), spatial audio, procedural reverb impulse responses, adaptive music layers, voice limits, variants, plus spectrograms and metrics for agents | No audio in 3D; non-deterministic synth; untestable output | 7.1–7.4 |
| I-24 | Input intents: camera-relative movement, pointer lock, axes, rebinding as engine data, a virtual device, recording | Screen-space `move()`; 673 lines of game-side rebinding; tests pressing keys on a wall clock | 8.1 |
| I-25 | One `window.__engine` API, the same in Node: step, state, hash, trace, entities, a text scene dump, stats, capture with IDs, input injection, `help()` | `__sw` and `__lab3d`, which were inconsistent | 1.6, 8.3 |
| I-26 | One CLI `x` that prints 20 lines or fewer, writes `report.json` and returns exit codes 0/1/2, with shared `tools/lib` and a persistent inspect session | 35 tools, 26 scripts, 19 copies of the browser-launch code | 0.2, 8.3 |
| I-27 | Test tiers with budgets (T0 under 10 s, T1 under 60 s, T2 under 6 min), selected from the import graph, run in parallel | 25 minutes, sequential; a hand-written map with holes | 0.5 |
| I-28 | Visual verification with no committed images: ID pass, look metrics, text thumbnails, comparison against `main` built in a worktree | PNG byte size as "not blank" | 5.11 |
| I-29 | Numeric lints with baselines: animation, geometry, texture tiling, audio, levels | Lints that never failed (the shipped `codex` still has 3 joint pops) | 3.9, 4.6, 5.3, 5.4, 7.4, 6.1 |
| I-30 | Docs from code: module headers become a generated INDEX, API and ERRORS; examples are executed; token budgets; no duplicated prose | About 310 KB of docs with each core fact in about 4 places; drift | 0.6 |
| I-31 | TypeScript (erasable syntax) checked with `tsc --strict` against pinned three.js and Rapier types; layered lint rules | No types; old-API mistakes found only at run time | 0.4 |
| I-32 | Repo hygiene: no committed build output, a lockfile, changelog fragments, the version in `package.json` only | 136 of 301 files were build output; 10 places to edit on every bump | 0.1, 0.7 |
| I-33 | GitHub Actions as a required check, a nightly matrix, deploys built from source | No CI; "merge, then run the full suite in the background" | 0.9, 9.7 |
| I-34 | Claude Code integration: SessionStart, a fast check after each edit, write protection, a Stop gate, skills, subagents (`verifier`, `visual-reviewer`, `suite-runner`, `api-checker`) | A SessionStart hook only | 0.10, 11.2 |
| I-35 | An MCP server that bridges `__engine` for any agent | None | 11.1 |
| I-36 | Registries with schemas that automatically feed galleries, inspectors, lints, scaffolds and docs. Scaffolds pass every check and are re-tested in CI | Schemas existed only as comments; templates could rot | 1.2, 11.2 |
| I-37 | One settings schema that generates URL parameters, `__engine.set`, the dev panel, the benchmark settings line and JSON export | `S`/`FX` mutations that sometimes never took effect | 1.2, 8.4 |
| I-38 | A bot harness: a virtual device, navigation, a watchdog, stuck detection measured along the wanted direction, deterministic smoke runs | A bot inside the game only | 8.6 |
| I-39 | Performance budgets as counters (pipelines after warm-up, draw calls, memory bytes, sim ms per step in Node) plus nightly trends | Headless fps, which is noise | 9.3, 0.9 |
| I-40 | Agent-usability evals (fresh-agent tasks) and mutation testing of the key suites | The suites themselves were never tested | 11.3 |
| I-41 | Advice and error codes with docs. Tests fail on new advice; allowed advice is listed with a reason | Free-text warnings | 1.2, 0.5 |
| I-42 | Version-pinned knowledge in the repo: `llms-full.txt` for 0.186, the TSL Guide, an r182 → r186 delta, rename rules with replacements, deprecations failing tests | Models' older three.js priors | 0.3, 0.4 |

---

## 8. Tooling and testing: how agents see and prove their work

### 8.1 One CLI: `node x <cmd>`

**Command registry.**
- `x.js` dispatches to `tools/cmd/<cmd>.mjs`. Each command's header is its help, so `x help [cmd]` is generated and cannot go stale.
- Shared code lives in `tools/lib/`.

**Output contract for every command.**
- Print **at most about 20 lines**: the verdict first, then each failure as a plain sentence giving what was expected, what happened, where, and the likely fix.
- Always write `out/<cmd>/<target>/report.json`:
  ```json
  { "tool": "x shot", "version": "0.3.0", "build": "dev", "args": {}, "ms": 812, "ok": false,
    "failures": [{ "id": "A031", "message": "hero covers 0 px from cam iso", "file": "labs/sandbox/main.ts", "line": 40, "entity": 12 }],
    "warnings": [], "metrics": { "drawCalls": 214 }, "artifacts": [{ "path": "out/shot/sandbox/iso.png", "kind": "image", "describes": "iso view, WebGPU" }] }
  ```
- Also update `out/latest.json`.
- Exit codes: **0** pass, **1** fail, **2** usage error.

| Command | Purpose |
|---|---|
| `x help [cmd]` | Generated help |
| `x check [--files …]` | **T0, under 10 s.** Parse, `tsc`, layer and banned-API rules, asset scan, header and caps checks, docs drift, changelog fragment present |
| `x unit [pattern…]` | T1 Node unit tests (`node --test`, TypeScript stripped natively). A pattern is a substring of a test file's path, searched in `engine/`, `tools/` and `tests/unit/`. Zero matched files exit 1 |
| `x test [--changed [--base ref]\|--all\|--suite s\|--grep g] [--backend webgl2\|webgpu\|both] [--workers n] [--repeat n] [--list]` | Test tiers, with the reason each test was selected and a timing table |
| `x why <file>` | Which tests cover a file, through the import graph |
| `x sim <scene> [--steps n] [--seed s] [--script f] [--dump]` | Run a scene headless in Node: hash, trace, state |
| `x replay <file\|dir> [--update] [--browser webgl2\|webgpu\|both] [--bisect]` | Replay against expected hashes; bisect to the first divergence |
| `x serve [--inspect] [--port p]` | Dev server: strips TypeScript on the fly (keeping line numbers), import map, routes. `--inspect` keeps one headless page open |
| `x eval "<js>"` / `x dump <page> [--step n]` | Talk to the `--inspect` session: evaluate, or dump the scene and state as text |
| `x shot <page> [--cam code] [--backend b] [--ids] [--metrics]` | Render; read back a render target; write PNG plus look metrics plus ID-pass stats |
| `x film <page> --steps "…" [--seed s] [--compare main\|file]` | Filmstrip contact sheet, with a diff against `main` built in a temporary worktree |
| `x sheet <rig\|move\|clip>` | 3D sheet: states × cameras, plus numeric lints |
| `x lint <family…> [--only <id…>]` | Numeric lints against per-family baselines. The families are `anim`, `geo`, `tex`, `audio` and `level` |
| `x anim find\|show\|cut\|import\|cmu\|bake\|sheet …` | Animation library tools (§10) |
| `x audio <id> [--wav] [--spectrogram]` | Render a sound; metrics; optional files in `out/` |
| `x perf <scene> [--budget]` | Counters and timings against budgets |
| `x describe <kind> [id]` | Registry listing: schema, ids, docs |
| `x new <kind> <id>` | Scaffold content that already passes every check |
| `x lab add\|rm\|list` | Temporary labs with a question, an answer and an expiry date |
| `x docs [--check\|--write]` | Generate and check INDEX, API and ERRORS; run doc examples; token budgets |
| `x sizes [--budget]` | Tokens per module and directory against budgets |
| `x vendor [--check\|--addon path\|--update lib@ver]` | Copies the pinned libraries from `node_modules` into `vendor/`, adds allowlisted addons, checks integrity, writes the import map |
| `x src` | Prints and checks `$MY3D2DGE_SRC`, the read-only source checkout (WP 0.1) |
| `x ci --local` | Runs the CI steps locally (the fallback while owner setup is pending, §11.5) |
| `x version`, `x release`, `x stamp`, `x build` | Version print, release (gathers `changes/`), deploy stamp, site build to `site/` |
| `x port refs [--check]` | Build reference vectors from my-3d2dge@e37e4ee for differential tests (WP 0.11) |
| `x mcp` | Start the MCP server (WP 11.1) |
| `x evals [--dry-run]`, `x eye`, `x edition [--check]` | Agent-usability evals, the Node visibility raster, the optional reading edition (WP 11.3–11.5) |

### 8.2 Test tiers with time budgets (the runner enforces them)

| Tier | Contents | Budget | When |
|---|---|---|---|
| T0 `x check` | Parse, types, rules, docs drift, sizes | under 10 s | After every edit (hook) and at Stop |
| T1 `x unit` | Pure modules, animation, generators, the Rapier sim, Node replays, lints | under 60 s | Before every commit |
| T2 `x test --changed` | Browser suites on both backends in parallel: rendering, parity, ID pass, pipeline counters | under 6 min for the full set; typically under 2 min | Before every push; required in CI |
| T3 nightly | Long replays, benchmarks and trends, `--repeat 3` flake hunting, Firefox and WebKit determinism, the next-three.js canary | — | Scheduled CI |

**Rules:**
- A test that waits on wall-clock time is a bug. Tests step the engine (`step(n)`) on a virtual clock.
- A flaky test is quarantined only through a WP that fixes it. Skipping a test to get green is forbidden.

### 8.3 `window.__engine`: one inspector API, identical headless (`createHeadless`)

| Area | API |
|---|---|
| Identity and health | `info()` → `{ version, build, backend, tier, compat, features, fallbacks }`, `ready`, `errors[]` (structured records), `advice[]` (warn-once records with codes) |
| Time | `pause()`, `resume()`, `step(n, intents?)`, `render()`, `timeScale(k)`, `seed(n)` |
| State | `state(query?)`, `hash()`, `trace()`, `entities(query)`, `get(id)`, `set(path, value)` (settings schema only; validated), `snapshot()`, `restore(s)` |
| Scene | `scene.dump({ depth, filter })` → a text tree (name, type, visible, position, bounds, material, triangles); `camera.get()`, `camera.set(code)` |
| Rendering | `stats()` → `{ simMs, physicsMs, animMs, renderMs, gpuMs?, drawCalls, triangles, pipelines, programs, textures, geometries, memory }` |
| Capture | `capture({ ids, metrics, thumbnail, size })`, via render target and `readRenderTargetPixelsAsync` |
| Input | `input.press(action)`, `input.axis(name, value)`, `input.play(script)`, `input.record()` |
| Help | `help()`: every member, one line each (checked against the API by `x docs --check`) |

**Headless.** In Node, `createHeadless` returns the same object. Its rendering members (`render`, `capture`, `camera`, `scene`) throw a coded "no renderer" error.

Every page signals `ready` or `error` within a timeout. That turns a startup crash into one line instead of a hang.

### 8.4 Replays

```json
{ "format": "my3dge-replay/1", "engine": "0.4.0", "three": "0.186.1", "rapier": "deterministic-compat 0.19.3",
  "scene": "fixtures/scenes/kernel", "seed": 1, "hz": 60, "steps": 600,
  "inputs": [[0, { "move": [0, 1], "cam": 0.785 }], [30, { "move": [1, 0], "b": ["attack"] }], [42, { "b": [] }]],
  "hashes": { "60": "9f2c…", "120": "…", "600": "…" } }
```

- **Inputs** are change-points only, so the file stays small and diff-friendly.
- **Bisect.** `x replay --bisect` reruns with per-step traces until the first divergence, then prints the step, the entity and the component fields that differ.
- **Recording live play.** `__engine.input.record()` in any lab saves a replay. Every bug report about behaviour becomes a replay test.

### 8.5 Visual verification without committed images

1. **ID pass.**
   - Flat, unlit, per-object colours; no antialiasing; read back.
   - The result is `visible: [{ id, name, px, bbox }]`, so an agent reads "the boss covers 0 px" or "one object covers 71%: the camera is inside a wall" as text.
   - The ID pass is compared across backends for parity (§6.7).
2. **Look metrics** for every frame, as JSON:
   - coverage against empty space;
   - luma spread (P5 to P95);
   - dark and blown-out fractions;
   - colour count;
   - the largest object's share;
   - whether the protagonist is visible;
   - edge density.
   Failures are written as "number plus suggested fix", the style of the prototype's `check.mjs`.
3. **Text thumbnails.** A 48×27 hex-colour grid per case, stored as JSON in `tests/baselines/`. It can be compared per cell with a tolerance, and read as a coarse map.
4. **Compare with `main`.** `x film --compare main` builds `origin/main` in a temporary `git worktree` and renders the same steps. The diff report gives bounding boxes and attribution from the ID pass ("93% of the changed pixels are on `hero`").
5. **Images on demand only.** Contact sheets are capped at 1,600 px wide, with labels and diff boxes. Reviewing them is delegated to the `visual-reviewer` subagent, which returns a JSON verdict and keeps image tokens out of the main context.

### 8.6 Lints and baselines (fast, mostly in Node)

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

**Baselines.** Each family has a baseline file, `tests/baselines/lints-<family>.json`, listing accepted exceptions as `{ id, metric, value, reason }`. A new violation fails the test, and so does an accepted one that got worse.

### 8.7 Performance budgets, as counters (never headless fps)

- **Pipelines** compiled after warm-up must be **0**.
- **Draw calls, triangles, programs and memory bytes** (`renderer.info`) are capped per lab scene.
- **Sim time.** `sim.step` in milliseconds at 100, 1,000 and 5,000 bodies, measured in Node with the median of 5 runs, checked against budgets with a tolerance. The prototype's figures: 1, 5.6 and 33 ms. Physics should stay within 1.2× of the prototype under the deterministic build.
- **Trends.** The nightly job records a trend file (`out/perf/trend.json`) and flags any regression over 15%.

### 8.8 The headless browser recipe

- **In this cloud container:**
  - Chromium at `CHROMIUM_PATH=/opt/pw-browsers/chromium`.
  - WebGPU via SwiftShader: `--enable-unsafe-webgpu --enable-features=Vulkan --use-vulkan=swiftshader --use-webgpu-adapter=swiftshader --disable-vulkan-surface`.
  - A stand-in `getContext('webgpu')` that renders to a texture and is read back, because headless Chromium loses the device when it presents a frame. Ported verbatim (`tools/lab3d-test.mjs:70-102`).
  - WebGL 2 through ANGLE.
- **In CI:** the three.js project's own recipe. Mesa lavapipe (`mesa-vulkan-drivers`, `VK_DRIVER_FILES=…/lvp_icd.x86_64.json`) plus `xvfb-run` for screenshot suites, with `--ignore-gpu-blocklist --disable-gpu-watchdog`.
- **Every suite asserts:**
  - which backend actually ran, using the adapter info;
  - that the frame is not blank;
  - that the virtual clock is installed.
  A WebGPU-to-WebGL fallback can never pass silently as WebGPU.
- **Capture** goes through a render target and `readRenderTargetPixelsAsync`, never `toDataURL` on a WebGPU canvas.
- **Baselines** are kept separately per backend.

### 8.9 Continuous integration

- **`ci.yml`**, required on every PR:
  - runs in the Playwright container pinned by the lockfile;
  - `npm ci`, then `x vendor --check`, then `x check`, then `x unit`, then `x test --changed --base origin/main` (`--all` while the full T2 set stays within its 6-minute budget);
  - uploads `out/**` as artifacts;
  - writes a summary to `$GITHUB_STEP_SUMMARY`.
- **`nightly.yml`:** T3 (§8.2), plus perf trends and the next-three.js canary.
- **Until the owner has switched on Actions** (§11.5), `x ci --local` runs the same steps, and merges wait on it.

### 8.10 Claude Code integration

- **`AGENTS.md`** is canonical and tool-agnostic, about 150 lines or fewer (draft in Appendix E). **`CLAUDE.md`** is `@AGENTS.md` plus Claude-specific notes.
- **`.claude/settings.json`:**

  | Hook or setting | Does |
  |---|---|
  | SessionStart | `npm ci`, export `CHROMIUM_PATH`, resolve `MY3D2DGE_SRC` (`x src`), `x vendor --check`, warm the TypeScript cache |
  | PostToolUse on `Edit\|Write` | Fast per-file check (parse, layer and banned-API rules). Exits 2 with the errors so the agent sees them at once |
  | PreToolUse | Deny hand edits to `vendor/`, `out/` and `site/` (`node x vendor` and `node x build` may write them); deny force-pushes to `main` |
  | Stop | Run `x check`. Exit 2 with a short reason if red, honouring `stop_hook_active` to avoid loops |
  | `permissions.allow` | `Bash(node x *)`, `Bash(npm ci)`, read-only git |

- **Skills** (`.claude/skills/`, loaded on demand):

  | Skill | What it carries |
  |---|---|
  | `x-loop` | The edit → check → test → report loop |
  | `three-r186-webgpu` | Idioms, banned APIs and their replacements, TSL patterns, WebGL 2 rules, the delta from r182 |
  | `rapier-deterministic` | Rapier usage under the determinism contract |
  | `determinism-debugging` | Replay bisect; reading a trace diff |
  | `animation-authoring` | Effector-space authoring, moves, clips, actions, lints |
  | `visual-qa` | The metrics, the ID pass, thumbnails |
  | `perf-budgets` | Budgets and how to meet them |
  | `add-<kind>` | Mirrors `x new` |
  | `release` | Cutting a release |

- **Subagents** (`.claude/agents/`):

  | Subagent | Job |
  |---|---|
  | `verifier` | Runs a WP's Verify commands, re-reads the diff adversarially against the five laws, and returns pass or fail with reasons |
  | `visual-reviewer` | Reads images and returns a JSON verdict |
  | `suite-runner` | Runs T2/T3 in the background and returns failures only |
  | `api-checker` | Checks three.js and Rapier usage against the pinned types and vendored sources |

### 8.11 The MCP bridge (WP 11.1)

- **What it is.** `x mcp` starts a server over a persistent `x serve --inspect` session.
- **Tools:**
  - `engine_open(page, params)`
  - `engine_step(n, intents)`
  - `engine_state(query)`
  - `engine_dump()`
  - `engine_capture({ ids, metrics, thumbnail })`, which returns image plus JSON
  - `engine_input(script)`
  - `engine_replay(file)`
  - `engine_set(path, value)`
  - `engine_help()`
  - `docs_lookup(symbol)`
- **Why.** Unity, Unreal, PlayCanvas, Bevy and the Chrome DevTools team have all shipped this pattern: inspect, step, inject input, capture and read logs over the running app. It lets any agent drive the running engine without writing Playwright code.

### 8.12 Docs as an interface, checked for drift

`x docs --check` covers module headers, AGENTS.md and `docs/*.md`. It skips `docs/research/` and `docs/vendor/`. Source citations are written `my-3d2dge:<path>[:line]` and are checked against `$MY3D2DGE_SRC`.

It fails when:
- a header's API list differs from the module's real exports;
- an EXAMPLE does not run;
- a path or name the docs mention does not exist;
- a token budget is exceeded;
- INDEX, API or ERRORS are stale;
- `help()` differs from the inspector's API.

Upstream docs are pinned in `docs/vendor/`. Version numbers never appear in prose: the version lives in `package.json` only.

### 8.13 Scaffolding

`x new <kind> <id>` exists for these kinds, and only these: `material`, `prop`, `body`, `rig --block legGait`, `move`, `action`, `level`, `sfx`, `song`, `lab`, `scene`, `module`, `feature`, plus `game` (WP 9.1). Each writes:
- a working entry;
- a test;
- a gallery entry;
- a docs header.

It then runs the relevant checks and prints the summary. CI runs every template (`x new … --test`), so templates cannot rot.

---

## 9. Roadmap: phases, gates, lanes and work packages

### 9.1 Phases at a glance

| Phase | Goal | Lane(s) | Ends at gate | Runs |
|---|---|---|---|---|
| 0 Foundation | The repo can check, test, document and version itself before any engine code exists | T | **G0** | Sequential |
| 1 Core and sim kernel | Deterministic kernel: math, time, registry, world, hash, replay, headless runs | C | **G1** | Sequential |
| 2 Physics | Rapier adapter, character controller, bodies, queries | P | **G2** | Parallel after G1 |
| 3 Animation core | Rotation skeleton, the humanoid port, moves, IK, reactions, secondary motion, building blocks, checks | A | **G3** | Parallel after G1 |
| 4 Animation library | Provenance, codec, sets, baker, clip layer, tools, actions | L | **G4** | Parallel; joins A after WP 3.1 |
| 5 Render core | Renderer, tiers, materials, textures, geometry, instancing, puppets, lights, cameras, post, effects, capture | R | **G5** | Parallel after G1 (WP 5.1 may start after G0) |
| 6 World | Level compiler, nav, props, gameplay kits, terrain | W | **G6** | After WP 2.1 and WP 5.4 |
| 7 Audio | DSP, data, runtime, tools | X | **G7** | Parallel after G1 |
| 8 Input, UI, dev | Devices and intents, overlay, inspector, panel, gallery, bot, governor | I | **G8** | Parallel after G1 |
| 9 Integration | createEngine, the labs that prove everything together, the benchmark, deploy | all → integrator | **G9** (baseline engine) | After G2–G8 |
| 10 Enhanced tier | WebGPU-only speed and visual features with fallbacks | R2 | **G10** | After G9 |
| 11 Agent tooling+ | MCP, scaffolds everywhere, evals, agent eye, reading edition | T | **G11** | Continuous; finished last |

### 9.2 Dependency graph

Each WP below repeats its direct dependencies in a **Needs** line. Edges in brackets cross lanes.

```
Phase 0:  0.1 → 0.2 → {0.4, 0.3, 0.6, 0.7, 0.11} ; 0.4 → 0.5 ; {0.3, 0.5, 0.6, 0.7} → 0.8 → 0.9 → 0.10 ⇒ G0
Phase 1:  G0 → 1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6 ⇒ G1
After G1, in lanes:
  P: 2.1 → 2.2 → 2.3 → 2.4 ⇒ G2
  A: 3.1 → 3.2 → 3.3 → 3.4 → 3.5 [2.3] → 3.6 → {3.7, 3.8} → 3.9 ⇒ G3
  L: 4.1 (any time after G0) ; {0.11, 1.1} → 4.2 → 4.3 ; {3.1, 3.6, 4.2} → 4.4 ; {4.1, 4.3, 4.4} → 4.5 ;
     {3.9, 4.4} → 4.6 ; {3.4, 4.4} → 4.8 ⇒ G4 ; G4 → 4.7
  R: 5.1 (may start after G0) → 5.2 → {5.3, 5.4, 5.5, 5.7, 5.9} ; {5.4, 5.5} + [3.1, 3.7, 3.8] → 5.6 ;
     5.2 + [2.3] → 5.8 ; 5.5 + [3.6] → 5.10 ; 5.6 + [1.5, 2.1] → 5.11 ⇒ G5 (all of 5.1–5.11)
  W: [2.2] + [5.4] → 6.1 → 6.2 [2.3] → 6.3 [5.3] → 6.4 → 6.5 [3.2] ⇒ G6
  X: 7.1 → 7.2 → 7.4 ; 7.2 + [2.3, 6.4] → 7.3 ⇒ G7
  I: 8.1 → 8.2 [5.1] → 8.3 [5.2, 5.8] → 8.4 → {8.6 [6.2], 8.7} ; 8.4 + [G3, G4, G5, G6, G7] → 8.5 ⇒ G8
Phase 9:  {G2 … G8} → 9.1 → {9.2 … 9.6} → 9.7 ⇒ G9
Phase 10: G9 → 10.1 → {10.3, 10.4, 10.5} ; 10.5 → 10.2 ⇒ G10
Phase 11: {8.3, 5.11} → 11.1 ; G9 → {11.2, 11.3, 11.4, 11.5} ⇒ G11
Upgrades (when due, after G9): U-1 three.js next .1 release ; U-2 Rapier 0.21.x deterministic
```

### 9.3 Definition of done for every work package

A WP is done only when all of these hold:
1. Its **Verify** commands exit 0, and `x check` and `x unit` are green.
2. The T2 suites covering what it touched are green on **both** backends.
3. Every new module has its manual header, and `x docs --check` passes. INDEX, API and ERRORS were regenerated with `x docs --write`. In ultracode lanes (`X_LANE=1`), drift is a warning and the integrator regenerates.
4. A new kind from §8.13's list has its scaffold template, gallery entry and inspector view. A kind with a lint family has its lints (§6.6).
5. There is a changelog fragment in `changes/`.
6. The `verifier` subagent has reviewed the diff against the five laws and the WP's **Done when**, and every finding was fixed or answered. The subagent arrives in WP 0.10, so it reviews WPs 0.1–0.9 at G0.
7. No new advice codes appear during tests, unless they are allowlisted with a reason.
8. The ledger (§14) row is updated: status, commit and notes. In extra-effort mode the agent writes it in the same commit. In ultracode, lanes report and the integrator writes it. Deviations from this plan are recorded as ADR amendments, never silently.

**Rules about paths and proofs:**
- **What Owns covers.** A WP's **Owns** also covers, without listing them:
  - the browser specs its Verify names (`tests/browser/<suite>.spec.ts`);
  - unit tests beside its modules or under `tests/unit/`;
  - the scaffold templates, gallery entries and baseline entries for the kinds and lints it introduces;
  - the fixtures its Done-when names;
  - one changelog fragment.
- **Extending earlier work.** A later WP may extend a file an earlier WP created, and says so ("extends …"). Two WPs that may run at the same time (no path between them in §9.2) never own the same path.
- **Every claim is proved.** Each **Done when** bullet maps to a **Verify** step. Otherwise it is marked *(nightly)* or *(deferred proof: <where it is proven>)*, and the ledger records that.

**Format of each WP below:**
- **Owns**: the paths it may create or change. Anything else goes through the integrator, or is generated.
- **Needs**: the WPs that must be done and green first (§9.2).
- **Carry**: exact source paths at `my-3d2dge@e37e4ee`.
- **Build**: the deliverables.
- **Improves**: §7 ids.
- **Done when**: measurable outcomes.
- **Verify**: commands that must exit 0.
- **Size**: S (under 300 new lines), M (under 1,000), L (under 2,500). A WP that would exceed L is split.

### Phase 0: Foundation (lane T)

#### WP-0.1 Repo constitution and the source checkout
- **Owns:** `AGENTS.md`, `CLAUDE.md`, `README.md`, `LICENSE`, `.gitignore`, `.editorconfig`, `package.json`, `package-lock.json`, `tsconfig.json`, `docs/decisions/`, `changes/`
- **Needs:** —
- **Size:** S
- **Carry:** the source's `CLAUDE.md`, as input only. MIT `LICENSE`.
- **Build:**
  - AGENTS.md (Appendix E), and CLAUDE.md (`@AGENTS.md` plus Claude notes).
  - ADR-0001…0016 recording §13, each one page or less.
  - **Exact pins** in `package.json`, with the lockfile:
    - `dependencies`: `three@0.186.1` and `@dimforge/rapier3d-deterministic-compat@0.19.3`. Node resolves them from `node_modules`; WP 0.3 copies them, byte for byte, into `vendor/` for the browser.
    - `devDependencies`: `typescript` (as the spike decides), `@types/three@0.186.0`, `@types/node@22.x` (for `node:test`), `playwright@1.64.x`.
  - `package.json` also sets `"type": "module"`, `engines.node >= 22.18`, and scripts that alias `x`.
  - `tsconfig.json`:
    - `strict`, `noEmit`, `allowImportingTsExtensions`, `erasableSyntaxOnly`, `verbatimModuleSyntax`;
    - the DOM libs, and `types: ["node"]`. three's types arrive through its imports;
    - `include`: `engine`, `labs`, `tests`, `fixtures`, `tools`.
  - `.gitignore`: `out/ site/ .cache/ node_modules/`.
  - README: what this is, the laws, how to start, links.
  - **The source checkout.** `MY3D2DGE_SRC` (an absolute path) names a read-only checkout of my-3d2dge at `e37e4ee`. Resolve it in this order:
    1. the environment variable;
    2. an existing local clone (in the Claude Code cloud image: `/home/user/michaelcrosato/my-3d2dge`), via `git clone --shared <path> .cache/src-3d2dge`;
    3. `git clone https://github.com/michaelcrosato/my-3d2dge .cache/src-3d2dge`.

    Then run `git -C .cache/src-3d2dge checkout --detach e37e4ee`. Every **Carry** read and `x port refs` go through `$MY3D2DGE_SRC`. AGENTS.md says how to set it.
  - **TypeScript spike** (no more than 30 minutes):
    - Try `typescript@7.0.x` with these flags on a stub module importing `three/webgpu` types, and on a stub test importing `node:test`. If anything blocks, fall back to `6.0.x`, and record the outcome in ADR-0003.
    - TypeScript 7 has **no classic JS API** (only `tsc`), so no tool may `import 'typescript'`. Tools read imports and exports by stripping types (WP 0.2).
- **Improves:** I-01 (recorded as an ADR), I-32.
- **Done when:**
  - `npm ci` succeeds, and `tsc` runs clean on the stubs.
  - `$MY3D2DGE_SRC` resolves to `e37e4ee`.
  - AGENTS.md is 150 lines or fewer.
- **Verify:** `npm ci && npx tsc -p . --noEmit && test "$(git -C "$MY3D2DGE_SRC" rev-parse --short=7 HEAD)" = e37e4ee`

#### WP-0.2 The `x` CLI, the unit runner and `tools/lib`
- **Owns:** `x.js`, `tools/cmd/{help,serve,unit,src}.mjs`, `tools/lib/{args,report,serve,browser,importgraph,hash,png,tokens}.mjs`
- **Needs:** WP 0.1
- **Size:** M
- **Carry:**
  - The virtual clock plus seeded `Math.random` from `tools/filmstrip.mjs:39-53` (COPY).
  - The headless WebGPU flags, the stand-in `getContext('webgpu')` and `__readFrame` from `tools/lab3d-test.mjs:70-102` (COPY).
  - The route-emulating server from `tools/labs-test.mjs:18-30` (PORT).
- **Build:**
  - **`x.js`, the entry point.** With `"type": "module"` it is ESM, and `node x` resolves to it. Node never tries `x.mjs` for a main entry.
  - **The command registry**, with help generated from the headers.
  - **The `report.json` writer**, and the exit codes (§8.1).
  - **`x unit [pattern…]`.**
    - It runs `node --test` over `engine/**/*.test.ts`, `tools/**/*.test.mjs` and `tests/unit/**`.
    - A pattern is a substring of a test file's path; **zero matched files exit 1**.
  - **The import graph.**
    - Import and export specifiers come from type-stripped `.ts` and `.mjs` files: `module.stripTypeScriptTypes`, then a scanner for top-level `import` and `export` statements.
    - `x check` (WP 0.4) rejects any statement the scanner cannot read.
  - **`browser.mjs`:**
    - launch with `CHROMIUM_PATH` and the flags for each backend;
    - page setup: the virtual clock, named seeded streams, the stand-in canvas, a `ready || error` wait;
    - `readFrame`, and `assertBackend`;
    - capture of console output and warnings;
    - **a semaphore that limits concurrent Chromium instances** for the whole machine, so parallel lanes don't time out.
  - **`x serve`:** static files, the import map and routes. TypeScript is stripped on the fly with `module.stripTypeScriptTypes` in whitespace mode, so stack-trace positions match the source.
  - **`x src`:** prints and checks `$MY3D2DGE_SRC`, cloning it as in WP 0.1 when it is missing.
  - **Helpers:** a PNG encoder over `node:zlib`, and a token counter.
- **Improves:** I-26.
- **Done when:**
  - `node x help` exits 0 from the repo root and lists every command.
  - A browser test proves a thrown error's stack points at the right `.ts` line.
  - Unit tests cover the report schema and `x unit`'s exit on zero matches.
- **Verify:** `node x help && node x unit tools/`

#### WP-0.4 `x check` (T0) and the rules
- **Owns:** `tools/cmd/{check,sizes,lint}.mjs`, `tools/lib/rules.mjs`, `tools/lib/layers.json`, `tests/baselines/README.md`
- **Needs:** WP 0.2
- **Size:** M
- **Carry:** the banned list from `tools/lab3d-test.mjs:28-43` (PORT; Appendix B).
- **Build:**
  - **`x check`**, built from plugins:
    - parsing and incremental `tsc`;
    - the layer rules (§6.1), over the import graph from WP 0.2;
    - **banned APIs**, scoped by path, each naming its replacement (Appendix B). This includes the `BASELINE_COMPUTE` allowlist that `rules.mjs` exports;
    - determinism bans for sim-side code (§6.5); `*.test.ts` files are exempt;
    - **the asset scan** (L1): file extensions, magic bytes, and any base64 run or `data:` URI over 1 KB outside `vendor/`;
    - header presence, file caps and the 140-character line limit (L2);
    - import and export statements the scanner cannot read;
    - token budgets, in `x sizes`.
  - **Plugins added later:** docs drift (WP 0.6) and changelog fragments (WP 0.7).
  - **`X_LANE=1`**, set by the ultracode harness, turns docs drift into a warning (§11.3).
  - **The `x lint` dispatcher:**
    - usage: `x lint <family…> [--only <id…>]`;
    - one baseline file per family, `tests/baselines/lints-<family>.json`, with entries `{ id, metric, value, reason }`;
    - families are plugged in later: anim (WP 3.9), tex (5.3), geo (5.4), level (6.1), audio (7.4).
- **Improves:** I-31, I-42.
- **Done when:** every rule has a failing fixture and a passing fixture, and `x check` on the repo takes under 10 s.
- **Verify:** `node x check && node x unit rules`

#### WP-0.5 Test selection, tiers and the advice trap
- **Owns:** `tools/cmd/{test,why}.mjs`, `tools/fixtures/importgraph/**`, `tests/baselines/advice.json`
- **Needs:** WP 0.4
- **Size:** M
- **Carry:** the logic of `tools/test-run.mjs`: `--list`, `--files`, reasons, the timing table, the version-only filter.
- **Build:**
  - **`x test`:**
    - tiers;
    - `--changed [--base <ref>]`, through the import graph (a merge-base diff plus untracked files);
    - `--list` with a reason for each test;
    - `--workers`, `--repeat`, `--backend`, `--suite`, `--grep`.
  - **Budget enforcement:** warn over the budget, fail at 1.5×.
  - **`x why <file>`.**
  - **The advice trap.** Both harnesses (the Node unit runner and the browser) fail on any engine advice code, `console.warn` or three.js deprecation that is not listed in `tests/baselines/advice.json` (`{ code, reason }`).
- **Improves:** I-27, I-41.
- **Done when:**
  - In `tools/fixtures/importgraph/`, a change to `engine/core/a.ts` selects every dependent `*.test.ts` and `*.spec.ts`, and a change to `labs/x/main.ts` selects `x.spec.ts`.
  - An unlisted warning fails a fixture test; a listed one passes.
- **Verify:** `node x test --list --files tools/fixtures/importgraph/engine/core/a.ts && node x unit tools/`

#### WP-0.3 Vendoring and pinned knowledge
- **Owns:** `vendor/`, `tools/cmd/vendor.mjs`, `tools/lib/importmap.mjs`, `docs/vendor/`, `docs/THREE-DELTA.md`
- **Needs:** WP 0.2
- **Size:** M
- **Carry:** `tools/vendor-3d.mjs` (PORT). The r182 → r186 tables in §4 and Appendix B.
- **Build:**
  - **`x vendor`** copies the browser's copy of each library from `node_modules` (pinned in WP 0.1) into `vendor/`:
    - three's unminified ESM builds: `three.core.js`, `three.webgpu.js`, `three.tsl.js`;
    - Rapier's `rapier.mjs` only. The `-compat` build inlines its WASM, so the stray `.wasm` file stays out.
  - **`x vendor --addon <path>`** copies an addon file and its relative imports from `three/examples/jsm/` into `vendor/three-0.186.1/addons/`, records it in `ADDONS.json`, and rehashes. `DynamicLighting`, `ClusteredLighting` and `BloomNode` are addons in r186.1.
    - Hooks deny hand edits to `vendor/`, but allow `node x vendor`.
  - **License texts:** three's LICENSE, and Rapier's Apache-2.0 text taken from the upstream repository at the matching tag (the npm package ships none).
  - **`VERSION.json`:** the sha256 of every vendored file, the npm `integrity`, and publish dates **read from the registry**.
  - **`x vendor --check`:** vendored files equal the `node_modules` files byte for byte, and match `VERSION.json`.
  - **A generated import map:** `three`, `three/webgpu`, `three/tsl`, `three/addons/`, and Rapier.
  - **`docs/vendor/`:**
    - `three-0.186.1-llms-full.txt`, from `https://raw.githubusercontent.com/mrdoob/three.js/r186/docs/llms-full.txt`;
    - the TSL Guide, at the same tag.
  - **`docs/THREE-DELTA.md`.**
- **Improves:** I-15, I-42.
- **Done when:**
  - `x vendor --check` passes offline.
  - Node tests import Rapier (and step a world) and `three/webgpu` from `node_modules`.
  - `x vendor --addon tsl/display/BloomNode.js` adds the file and its imports, and the check still passes.
- **Verify:** `node x vendor --check && node x unit vendor`

#### WP-0.6 Docs system
- **Owns:** `tools/cmd/{docs,new}.mjs`, `tools/templates/module/`, `docs/{INDEX,API,ERRORS,TESTING}.md`
- **Needs:** WP 0.2
- **Size:** M
- **Carry:** the doctest extraction, path checks and token counting of `tools/agent-test.mjs:27-30, 185-235`.
- **Build:**
  - A header parser.
  - **INDEX** (module → purpose → exports → tests), **API** (the real exports, with one line each from the headers) and **ERRORS** (from the `core/log` code table).
  - **EXAMPLE blocks** executed in Node; browser examples are flagged for T2.
  - **Token budgets and drift checks** (§8.12), registered as an `x check` plugin.
  - **Path checks:**
    - They cover module headers, AGENTS.md and `docs/*.md`.
    - `docs/research/` and `docs/vendor/` are not checked.
    - Citations of the source repo are written `my-3d2dge:<path>[:line]`, and are checked against `$MY3D2DGE_SRC`.
  - **A skeleton of `x new`:** the `module` template (header plus test stub). Every later WP that adds a scaffolded kind (§8.13) adds its template under `tools/templates/<kind>/`; WP 11.2 completes the coverage.
- **Improves:** I-30.
- **Done when:** fixtures with a header/export mismatch, a broken example, or a missing path each fail.
- **Verify:** `node x docs --check && node x unit docs`

#### WP-0.7 Versioning, changelog fragments, stamping, the site build
- **Owns:** `tools/cmd/{version,release,stamp,build}.mjs`, `changes/README.md`
- **Needs:** WP 0.2
- **Size:** S
- **Carry:** `tools/stamp.mjs` (COPY). `tools/version.mjs` (PORT, simplified).
- **Build:**
  - The version lives in `package.json` only.
  - One fragment per change: `changes/<date>-<slug>.md`, tagged by part: Core, Sim, Physics, Animation, Library, Rendering, World, FX, Audio, Input, UI, Dev, Tools, Docs. A fragment check is registered as an `x check` plugin.
  - `x release X.Y.Z` writes `CHANGELOG.md` and bumps the version.
  - `x stamp` writes the commit into the site build.
  - **`x build` writes `site/`**, which settles Q2:
    - it strips types, renames `.ts` to `.js` and rewrites the import specifiers;
    - it copies `vendor/` and the import map.
- **Improves:** I-32.
- **Done when:**
  - A test in a temporary git repo merges two branches that each add a fragment, with no conflict.
  - `x build` produces a site whose hello page loads from a plain static server (checked in WP 0.8).
- **Verify:** `node x unit version`

#### WP-0.11 Port reference vectors from my-3d2dge
- **Owns:** `tools/cmd/port.mjs`, `tests/baselines/port/**`
- **Needs:** WP 0.2
- **Size:** M
- **Build:** `x port refs`:
  1. Reads the source at `$MY3D2DGE_SRC` (WP 0.1).
  2. Loads `engine/my-3d2dge.js` and `src/mocap/readable.js` in a Node `vm`.
     - It needs only tiny shims; the source's `tools/mocap-lib.mjs:7-9` shows the pattern.
     - `Math.random` is replaced by a seeded generator, and `dt` is fixed.
     - It records each reference rig's **initial breathing phase** (`engine:1782`), so the port can inject the same value (WP 3.3).
  3. Writes reference vectors as text JSON:
     - outputs of `rng`, `hash2`, `noise2` and the colour helpers;
     - Humanoid joint trajectories over a state matrix: idle, walk, run, dash, air, climb, every pose and stance, 8 facings, 3 builds; 120 steps at 1/120 s;
     - `E.move(name, u, phase)` hand and blade-tip positions for all 24 moves, with u in steps of 0.05;
     - Blob updates;
     - `MR.pose` decodes of all 325 curated clips at 30 fps. That set is large: commit a sampled subset with checksums, and keep the full set regenerable.
- **Done when:**
  - The vectors exist, with a README naming the source commit and the conversion (Appendix C).
  - Re-running produces byte-identical files.
  - `--check` compares the committed vectors with their recorded checksums offline, for CI; full regeneration runs nightly.
- **Verify:** `node x port refs --check`

#### WP-0.8 Hello page on both backends
- **Owns:** `labs/hello/`, `engine/gfx/renderer.ts` (minimal), `tools/cmd/shot.mjs` (basic: render, read back, PNG, metrics), `tests/browser/hello.spec.ts`
- **Needs:** WP 0.3, WP 0.5, WP 0.6, WP 0.7
- **Size:** S
- **Build:**
  - A lit procedural cube using node materials.
  - A minimal `__engine.info()`, and `ready`/`error` signalling.
  - `x shot labs/hello --backend both`, writing a PNG and metrics.
- **Done when:**
  - T2 passes on WebGL 2 and on WebGPU (SwiftShader) in the cloud container.
  - The backend is asserted, and the frame is not blank.
  - The import map resolves `three`, `three/webgpu` and `three/tsl` in the browser.
  - The `x build` site's hello page passes the same test.
- **Verify:** `node x test --suite hello --backend both`

#### WP-0.9 Continuous integration
- **Owns:** `.github/workflows/{ci,nightly}.yml`, `tools/cmd/ci.mjs`
- **Needs:** WP 0.8
- **Size:** S
- **Build:**
  - `ci.yml` and `nightly.yml`, as described in §8.9.
  - The lavapipe/xvfb recipe (§8.8).
  - Artifacts and a step summary.
  - The nightly job runs:
    - the Firefox/WebKit/Node replay-determinism matrix, switched on once WP 1.5 lands;
    - the next-three.js canary;
    - the full regeneration of `x port refs`.
  - **`x ci --local`** runs the same steps on the local machine. It stands in for CI while the owner setup of §11.5 is pending.
- **Improves:** I-33, I-06 (the matrix).
- **Done when:** the first PR shows green required checks with `out/**` uploaded. If the owner setup is pending, `x ci --local` passes and the ledger records "blocked on owner".
- **Verify:** `node x ci --local`, plus the PR checks once they are enabled

#### WP-0.10 Claude Code integration
- **Owns:** `.claude/`, `tests/unit/hooks/`
- **Needs:** WP 0.9
- **Size:** S
- **Carry:** `.claude/hooks/session-start.sh` (PORT: switch to `npm ci`; add `x src` and `x vendor --check`).
- **Build:**
  - Hooks and permissions, as in §8.10.
  - The skills `x-loop`, `three-r186-webgpu` (from THREE-DELTA plus Appendix B), and a `determinism-debugging` stub that WP 1.5 fills in.
  - **All four subagents:** `verifier`, `visual-reviewer`, `suite-runner`, `api-checker`.
  - Unit tests for the hook scripts, run against fixtures.
- **Improves:** I-34.
- **Done when:**
  - A fresh cloud session starts clean.
  - Writing a banned API makes the PostToolUse hook fail, naming the replacement.
  - The Stop hook runs `x check`.
  - The four subagents load.
- **Verify:** `node x unit hooks`

**Gate G0:**
- These are green in CI, or in `x ci --local` while the owner setup is pending (§11.5): `x check`, `x unit`, `x test --suite hello --backend both`, `x vendor --check`, `x docs --check` and `x port refs --check`.
- The `verifier` subagent has reviewed WPs 0.1–0.9 retroactively.

### Phase 1: Core and the simulation kernel (lane C)

#### WP-1.1 Math, deterministic math, randomness, noise, hashing, colour
- **Owns:** `engine/core/{math,dmath,rng,noise,hash,color}.ts` and their tests
- **Needs:** G0
- **Size:** M
- **Carry:**
  - `engine:72-96` (`clamp lerp approach ease angDiff lerpAng approachAng smoothDamp`).
  - `E.rng` (Mulberry32), `E.hash2`, `E.noise2`.
  - The colour helpers.
  - `hashNumbers` (`stress-world/00-setup.js:59`).
- **Build:**
  - **Math:** vec3 and quaternion helpers on plain tuples (`mul slerp nlerp fromAxisAngle swingTwist`), and easing.
  - **`dmath`:** every function the determinism ban names (§6.5): `sin cos tan asin acos atan atan2 exp log pow hypot cbrt sinh cosh tanh log1p expm1 log2 log10`. Each is built only from `+ − × ÷ sqrt`, with a documented maximum error, so results are bit-identical on every JS engine.
  - **`rng`:** named streams, `derive(seed, …keys)`, getting and setting state.
  - **`noise`:**
    - `hash2`, bit-exact with the source;
    - value, gradient and cell noise in 2D and 3D, with fbm octaves;
    - periodic (tiling) variants;
    - all seeded.
  - **`hash`:** 64-bit FNV-1a (two 32-bit lanes) over float64 bits, plus a canonical serializer.
  - **`color`:** hex, sRGB ↔ linear, and `tones/ramp/shade/mix`, bit-exact with the source.
- **Improves:** I-05, I-06.
- **Done when:**
  - The outputs match the reference vectors bit for bit.
  - The `dmath` accuracy table is in its header.
  - The determinism bans pass across `engine/core`.
- **Verify:** `node x unit core`

#### WP-1.2 Registry, events, log, settings, schema
- **Owns:** `engine/core/{schema,registry,events,log,settings}.ts`, `tools/cmd/describe.mjs`
- **Needs:** WP 1.1
- **Size:** M
- **Carry (mechanisms):**
  - `ed/00-core.js:76-117`: registry, bus, streams.
  - `ed/01-tune.js`: knobs.
  - `engine:65-66`: warn-once.
- **Build:**
  - **A schema mini-language:** type, default, range, unit, doc, enum, required, hooks with defaults, `when` (`now | spawn | scene`).
  - **Registry:** `defineKind`, `def`, `get`, `list`, `describe`. A missing id warns once, suggests the closest names, and returns the fallback.
  - **Events:** scoped listeners (`scope.dispose()`), each listener isolated so its failure is recorded in `errors`, and a trace ring.
  - **Log:** a code table `{ code, template, fix, doc }`, warn-once, structured errors.
  - **Settings:** one schema drives URL parameters, a validated `set` and `get`, JSON export and import, and a "differs from default" marker.
- **Improves:** I-36, I-37, I-41.
- **Done when:** unit tests cover every behaviour, and `docs/ERRORS.md` is generated from the code table.
- **Verify:** `node x unit core && node x docs --check`

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
- **Verify:** `node x unit core/time`

#### WP-1.4 Sim world and canonical state
- **Owns:** `engine/sim/{world,systems,state,snapshot}.ts`
- **Needs:** WP 1.3
- **Size:** M
- **Build:**
  - Entities with monotonic ids.
  - Component kinds registered with field lists.
  - Spawn and despawn queues that apply at step boundaries.
  - An explicit list of systems in order, and an event flush.
  - `state()`, `hash()` (engine plus RNG plus a physics hook) and `trace()`.
  - `snapshot()` and `restore()` for the engine part; physics plugs in at WP 2.1.
- **Improves:** I-05.
- **Done when:**
  - Changing any registered field changes the hash.
  - Drawing from an `fxRng` stream never changes `hash()`.
  - snapshot → restore → step equals an uninterrupted step.
  - The hash is stable across runs.
- **Verify:** `node x unit sim`

#### WP-1.5 Intents, replays, `x sim`, `x replay`
- **Owns:** `engine/input/intents.ts`, `engine/sim/replay.ts`, `tools/cmd/{sim,replay,perf}.mjs`, `fixtures/scenes/kernel/`, `tests/replays/`, `.claude/skills/determinism-debugging/`
- **Needs:** WP 1.4
- **Size:** M
- **Build:**
  - The intents vocabulary: move `[x, z]` in world space, camera heading, aim point, look, buttons pressed and held, and custom namespaced keys.
  - `intents.fromCamera(yaw, axes)`: pure math that turns stick or keys into a world-space move, so W walks away from the camera. WPs 5.8 and 8.1 use it.
  - `x replay --browser webgl2|webgpu|both` runs the replay inside `tests/pages/replay.html` (owned), with the sim in the page and no renderer needed.
  - The replay format (§8.4), with a recorder and a player.
  - `x sim`.
  - `x replay` with `--update` and `--bisect`.
  - `x perf` for Node: sim milliseconds per step against budgets. WP 9.3 adds browser and GPU timings.
  - The `kernel` fixture scene: a few scripted movers with no physics.
- **Improves:** I-04.
- **Done when:**
  - A fixture replay gives the same hashes three times in Node.
  - `--bisect` finds an injected divergence at the right step, entity and field.
- **Verify:** `node x unit sim && node x replay tests/replays`

#### WP-1.6 Headless app and the inspector core
- **Owns:** `engine/app/headless.ts`, `engine/dev/inspector.ts` (core members), `engine/index.ts`
- **Needs:** WP 1.5
- **Size:** S
- **Build:**
  - `createHeadless({ scene, seed })`.
  - The `__engine` core: `info`, `pause`, `step`, `state`, `hash`, `trace`, `entities`, `get`, `set`, `help`, `errors`, `advice`. In Node, the rendering members throw a coded "no renderer" error.
  - The same shape in the browser; it is wired up in WP 9.1.
- **Improves:** I-03, I-25.
- **Done when:**
  - `x sim fixtures/scenes/kernel` runs through `createHeadless`.
  - `help()` matches the API.
- **Verify:** `node x sim fixtures/scenes/kernel --steps 600 && node x docs --check`

**Gate G1:**
- `x unit` (core and sim) is green.
- The kernel fixture's replay is identical three times in Node, and once inside a Chromium page.
- `x docs --check` is green.

### Phase 2: Physics (lane P)

#### WP-2.1 Rapier adapter
- **Owns:** `engine/physics/{world,groups,params,snapshot}.ts`, `fixtures/scenes/physics-40/`, `tests/replays/physics-40.replay.json`
- **Needs:** G1
- **Size:** M
- **Carry:** the world setup and collision groups of `stress-world/20-sim.js:32` (PORT, in SI units).
- **Build:**
  - Initialize the embedded WASM in Node and in the browser.
  - Gravity `(0, −30, 0)` as the default, overridable per scene.
  - One table each for integration parameters and collision groups.
  - Insertion in a deterministic order.
  - Stepping inside the sim, then readback.
  - A hash of the snapshot bytes folded into the sim hash, and restore.
  - A benchmark of the deterministic build against the SIMD build, both on the same machine, with the prototype's crowd scenario. Both numbers go in the ADR. The deterministic build's numbers become the physics budgets in `tests/baselines/perf.json`.
  - Rapier's init deprecation notice allowlisted as known benign advice.
- **Improves:** I-06.
- **Done when:** a 40-body replay matches in Node and in Chromium on both backends, and snapshot/restore round-trips equal.
- **Verify:** `node x unit physics && node x replay tests/replays/physics-40.replay.json --browser both`

#### WP-2.2 Character controller
- **Owns:** `engine/physics/character.ts`, `engine/sim/actors.ts` (spawns an actor with its controller; WP 3.6 extends it with the animator), `fixtures/scenes/steps/` (stairs and slopes built by a scene script, because the level format only arrives in WP 6.1)
- **Needs:** WP 2.1
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
  - The default jump apex is 1.46 m ± 2 cm.
  - A dash covers 3.25 m ± 2 cm in 0.2 s, with a 0.45 s cooldown (Appendix C).
  - It pushes a 20 kg crate.
  - Coyote time and buffer are exact in ticks.
  - The grounded flag never flickers on flat lateral motion.
- **Verify:** `node x unit physics/character`

#### WP-2.3 Bodies, crowds, queries, ragdoll builder
- **Owns:** `engine/physics/{bodies,crowd,queries,ragdoll}.ts`, `engine/sim/queryView.ts`, `fixtures/scenes/crowd-1000/`
- **Needs:** WP 2.2
- **Size:** M
- **Carry:** the crowd pattern of `stress-world/20-sim.js`: velocity intents with acceleration limits, locked rotations, a min friction combine, sleeping, knockback as momentum, launches, and a corpse group.
- **Build:**
  - Body helpers and crowd agents.
  - Impulses and launches.
  - Sensors and triggers that emit events.
  - Raycasts, shape casts, overlaps, and `probe(x, z) → { y, normal }` for animation.
  - The read-only `QueryView` that `sim.snapshot()` exposes to presentation code (§6.1), with a test that it offers no mutation.
  - A ragdoll builder from bone capsules (WP 3.5 uses it).
- **Done when:**
  - The 1,000-body crowd stays within its physics budget from WP 2.1: the deterministic build's measured baseline, plus 15%.
  - Probes are exact on stairs and slopes.
  - Replays match.
- **Verify:** `node x unit physics && node x perf fixtures/scenes/crowd-1000 --budget`

#### WP-2.4 Physics fixtures and replays
- **Owns:** `fixtures/scenes/physics-*`, `tests/replays/physics-*.replay.json`
- **Needs:** WP 2.3
- **Size:** S
- **Build:**
  - Scenes: stairs, slopes and gallery; a crowd push; a crate topple.
  - Their replays with hashes, and perf counters.
- **Done when:** the replays pass in Node and on both backends, and the budgets are recorded.
- **Verify:** `node x replay tests/replays --browser both`

**Gate G2:** all physics replays are equal across Node, WebGL 2 and WebGPU, and the perf budgets hold.

### Phase 3: Animation core (lane A)

#### WP-3.1 Skeleton, builds, pose, FK, sheets
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
  - **`Pose`:** `{ rootPos, rootRot, rootScale, local: Float32Array(23·4) }`.
  - **FK** to matrices and positions.
  - **Blending:** slerp/nlerp, bone masks (upper, arms, legs, lists), additive layers.
  - **A pose hash.**
  - **`anim.sheet()`:** SVG skeleton contact sheets in Node. `x sheet` (WP 3.9) encodes PNG.
  - **The core of `anim.check(def)`:** finite values, bone lengths and declared rigid pairs, feet at or above the floor, sockets reachable. WP 3.8's fixtures must pass it; WP 3.9 adds the state matrix, lints and sheets.
- **Improves:** I-01, I-08.
- **Done when:**
  - The rest pose's FK matches the build proportions.
  - Blending, masks and additive layers are unit-tested.
  - Sheets are deterministic (hashed).
- **Verify:** `node x unit anim/skeleton`

#### WP-3.2 IK
- **Owns:** `engine/anim/ik.ts`
- **Needs:** WP 3.1
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
- **Verify:** `node x unit anim/ik`

#### WP-3.3 Humanoid procedural port
- **Owns:** `engine/anim/{authoring,locomotion,poses,humanoid}.ts`
- **Needs:** WP 3.2
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
- **Verify:** `node x unit anim/humanoid` (the motion lints run over it from WP 3.9 on)

#### WP-3.4 Moves, timelines, hits
- **Owns:** `engine/anim/{timeline,moves,moves-data}.ts`, `engine/sim/hits.ts`, `fixtures/rigs/dummy/` (a neutral training dummy that takes hits)
- **Needs:** WP 3.3
- **Size:** L
- **Carry:**
  - `Attack`, `Combo`, `E.move` and `E.knockback` (`engine:2467-2577`).
  - The 24 entries of `E.MOVES` (`engine:2543-2572`).
  - The arm path (`engine:1842-1867, 1950-1951, 1969-1986`).
  - `measureAttacks` (`ed/30-monsters-core.js:31-41`, mechanism only).
- **Build:**
  - **`Timeline`:** phases with durations, effector or clip content, and events, carrying leftover time across phases. `Attack` and `Combo` are built on it.
  - **Moves as data.** Each move has self-describing fields in metres: `arc`, `height`, `reach`, `time { wind, active, recover }`, `hitAt`, `body { lean, lunge, hop, crouch, twist }`, `plane`, `trail`.
  - **A table converting each old field.**
  - **Events:** `wind`, `active`, `hitOpen`, `hitClose`, `recover`, `end`.
  - **Root-motion curves**, in `'visual'` or `'apply'` mode.
  - **Weapon sweeps** published during hit windows.
  - **`measureMove`** → `hitShape { range, halfAngle, yMin, yMax }`, cached and invalidated when settings change. `inArc` is kept.
  - **`anim.moveAt(name, u, phase)`.**
- **Improves:** I-10.
- **Done when:**
  - All 24 moves pass the differential tests: hand and tip paths over `u`, within 1 cm on average and 3 cm at worst.
  - Combo chaining windows are exact in ticks.
- **Verify:** `node x unit anim/moves` (the motion lints run over the moves from WP 3.9 on)

#### WP-3.5 Reactions, secondary motion, ragdoll blend
- **Owns:** `engine/anim/{reactions,secondary,ragdoll}.ts`
- **Needs:** WP 3.4, WP 2.3
- **Size:** M
- **Carry:**
  - The squash spring (`engine:1832`).
  - Hair (`engine:1900-1916`).
  - The cape (`engine:2033-2068`).
  - `die` (`engine:1824-1827`).
- **Build:**
  - **Reactions:** a directional flinch (an additive spring); down, die and get-up timelines (face up or face down).
  - **`Chain`:** anchor, n, seg, gravity, drag, wind, iterations, bone-capsule colliders, a floor probe, and stiffness toward a rest shape.
    - A cape is 2 chains plus a width constraint; hair and tails are 1 chain.
    - It resets on teleport.
  - **Squash** becomes a volume-preserving root scale.
  - **Ragdoll:** descriptors, a blend weight, and the choice of get-up.
- **Improves:** I-11.
- **Done when:**
  - Chains are stable at 60 and 120 Hz and collide with body capsules and the floor.
  - A ragdoll hand-off round-trips in Node with Rapier.
  - The correct get-up is chosen.
- **Verify:** `node x unit anim/secondary anim/reactions`

#### WP-3.6 The Character animator and the body-state vocabulary
- **Owns:** `engine/anim/{character,states,weights}.ts`; extends `engine/sim/actors.ts` (WP 2.2) with the animator
- **Needs:** WP 3.5
- **Size:** M
- **Carry:**
  - The weight rates (dash 24/8, hurt 14, attack 30/7, air 10/18, poses 9, stances 10).
  - The "intent vocabulary" of `ed/18-characters.js:36-38`. Here it is called **body states**, to keep it distinct from input intents.
- **Build:**
  - **The layer stack:** weights → base → override → solve → clips → additive → post IK → physics blend → secondary.
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
- **Verify:** `node x unit anim/character`

#### WP-3.7 Blob rig
- **Owns:** `engine/anim/blob.ts`
- **Needs:** WP 3.6
- **Size:** S
- **Carry:**
  - `engine:2595-2602`.
  - The leap parameters (`back reach h air land hit`) from `src/starter/60-animlab.js` `SKINS`.
- **Build:**
  - A spring squash and stretch, and look smoothing, on a minimal skeleton.
  - Blob moves as data: bite, leap, pounce, spit.
- **Done when:** unit tests and lints pass.
- **Verify:** `node x unit anim/blob`

#### WP-3.8 Procedural building blocks and their fixture rigs
- **Owns:** `engine/anim/proc/*.ts`, `fixtures/rigs/*`
- **Needs:** WP 3.6
- **Size:** L (split into 3.8a, b and c if needed)
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
    - Each is 80–150 lines of primitives and passes the core of `anim.check` (WP 3.1).
    - `fixtures/rigs/README.md` maps each of the 16 blocks to at least one rig.
- **Improves:** I-12.
- **Done when:** every block has unit tests and a fixture that passes its check.
- **Verify:** `node x unit anim/proc`

#### WP-3.9 `anim.check`, lints, sheets
- **Owns:** extends `engine/anim/check.ts` (WP 3.1) with the state matrix; `tools/cmd/sheet.mjs` (PNG encoding of `anim.sheet()`), `tools/lint/anim.mjs`, `tests/baselines/lints-anim.json`
- **Needs:** WP 3.7, WP 3.8
- **Size:** M
- **Carry:**
  - `checkRig` (`ed/18-characters.js:82-143`, mechanism).
  - The lints of `tools/ed-sheet.mjs:100-131`.
- **Build:**
  - A state matrix: body states × facings, plus camera presets for sheets.
  - Checks: finite values; bone lengths and declared rigid pairs; feet at or above the ground; sockets reachable; the same hash twice; 1/60 against 1/120 within tolerance.
  - The lints of §8.6, run in Node.
  - `x sheet`.
  - Baselines, each with a reason.
- **Improves:** I-29.
- **Done when:** all moves, poses and WP 3.8's fixtures lint in under 10 s in Node, against a baseline file with reasons.
- **Verify:** `node x lint anim`

**Gate G3:** every animation unit test and lint is green; the differential tests against the prototype are within tolerance; `anim.sheet` renders every fixture.

### Phase 4: Animation library (lane L)

§10 has the detailed specification.

#### WP-4.1 Provenance, catalogs, ledger, docs
- **Owns:** `data/anim/{SOURCES.md,LICENSES/,catalogs/,cmu/}`, `docs/ANIMATION-LIBRARY.md`, `docs/ANIMATION-RESEARCH.md`, `tests/unit/data/anim/`
- **Needs:** G0
- **Size:** S
- **Carry:**
  - The catalogs (COPY).
  - `cmu.json` (COPY, and FIX the license).
  - `cmu-takes.tsv` (split).
  - `docs/MOCAP.md` and `docs/ANIMATION-RESEARCH.md` (PORT).
- **Improves:** I-13
- **Done when:**
  - The split ledger joins back to the original rows.
  - SOURCES lists every library: license text, URL, file names, and the CMU acknowledgment and no-resale terms verbatim.
  - The research doc carries the coverage map.
- **Verify:** `node x unit data/anim`

#### WP-4.2 The readable codec and format 2
- **Owns:** `engine/anim/clip/{readable,validate,lens,mirror}.ts`
- **Needs:** WP 0.11, WP 1.1
- **Size:** M
- **Carry:** `src/mocap/readable.js` (PORT; the core decode stays verbatim).
- **Build:**
  - Format 1 decoding through `core/dmath`, within 0.001 mm of the reference vectors.
  - The source decoder, kept unchanged as an oracle in `tools/anim/legacy-readable.mjs`. Tools may use `Math.*`.
  - Format 2's optional fields (§10.2).
  - The validator, the normalized lens and mirroring.
  - Parse errors that name the key, its time and the field.
- **Done when:**
  - Every curated clip decodes within 0.001 mm, and the oracle reproduces the reference vectors bit for bit.
  - Round trip, and mirroring twice, stay within 0.5 mm.
- **Verify:** `node x unit anim/clip`

#### WP-4.3 Re-containerize the sets
- **Owns:** `data/anim/sets/**`, `tools/anim/repack.mjs`, `tests/unit/data/anim/sets/`
- **Needs:** WP 4.2
- **Size:** S
- **Build:**
  - One JSON file per clip: slugged file names, with the real name kept in `clip`.
  - `_set.json`, and a generated `catalog.tsv`.
  - `alt` tags on the 84 Mesh2Motion re-exports.
  - HERO dropped.
- **Improves:** I-13
- **Done when:** the rejoined sets deep-equal the source objects, and `text()` output is unchanged.
- **Verify:** `node x unit data/anim/sets`

#### WP-4.4 Baker, clip layer, retargeting, mannequin
- **Owns:** `engine/anim/clip/{bake,library,layer,retarget}.ts`
- **Needs:** WP 3.1, WP 3.6, WP 4.2
- **Size:** L
- **Carry:** the API of `src/mocap/mocap.js` and the ideas in its `drive` (§5.3).
- **Build:**
  - **A baker** that works from format-1 **parameters** (direction, bend, twist, hints), handles singular poses, and produces 30 fps rotation tracks on the canonical skeleton.
  - **The library API.**
  - **The clip layer:** weight, mask, fade from the current pose, speed, loop, additive, `walk/hold/next/landed` flags, cancel rules, events, root motion.
  - **Retargeting to builds:** a rotation copy, root scaled by the hip-height ratio, and contact IK.
  - **The mannequin's dimensions**, taken from `body.segs` and handed to WP 5.6, which owns the mannequin body.
- **Done when:**
  - Forward-kinematics parity against the format-1 decode has a mean of **1 mm or less** for every set.
  - The worst cases are listed in the baseline.
  - The clip layer is unit-tested.
- **Verify:** `node x unit anim/clip` (the library lints run in WP 4.6)

#### WP-4.5 Tools port
- **Owns:** `tools/anim/*`, `tools/cmd/anim.mjs`
- **Needs:** WP 4.1, WP 4.3, WP 4.4
- **Size:** L
- **Carry:** `anim-import`, `asf-amc`, `cmu`, `anim-set`, `mocap-lib`, `to-glb.py`.
- **Build:**
  - `x anim find|show|cut|import|cmu|bake|sheet`.
  - The `.cache/anim/` layout.
  - Guards in the GLB reader, each tested on small GLBs that the tests build in memory (CUBICSPLINE, signed and quantized accessors). No binary fixtures are committed.
  - Frame interpolation, and format-2 output, by default.
  - **`--legacy`:** nearest-frame sampling and format 1, exactly as today.
  - The split ledger; `--json`.
- **Improves:** I-13
- **Done when:**
  - **`x anim import --cmu --legacy` reproduces the CMU set** byte for byte *(nightly: it needs the network)*.
  - `x anim find punch` prints 20 lines or fewer.
- **Verify:** `node x unit tools/anim`, plus nightly `node x anim import --cmu --check`

#### WP-4.6 Library tests and lints
- **Owns:** library tests, `tests/browser/library.spec.ts`, `tests/baselines/lints-anim-library.json`
- **Needs:** WP 3.9, WP 4.4
- **Size:** M
- **Build:**
  - Node tests: format, provenance, ledger completeness, picks.
  - Fit thresholds: a clip's mean at most 40 mm and its worst at most 300 mm; a set's mean at most 20 mm.
  - Lints over all 325 clips, with a baseline.
  - A browser smoke test on both backends.
- **Improves:** I-13, I-29
- **Done when:** everything is green, and the Node part runs in under 30 s.
- **Verify:** `node x unit anim/clip data/anim && node x test --suite library --backend both`

#### WP-4.7 Re-import from the sources (format 2, after G4)
- **Owns:** updates to `data/anim/sets/**`
- **Needs:** G4
- **Size:** L
- **Build:**
  - Fetch the sources into `.cache/`: Mesh2Motion via git, CMU over HTTP. The owner supplies the Quaternius Universal Animation Library 1 and 2 once (§11.5). Until then, Quaternius clips stay `via: "v1"` and are listed as blocked.
  - Re-import with hands, foot roll, root yaw, spine, contacts and events.
  - Swap clips in one at a time, checking parity, marked `via: "source"`.
- **Improves:** I-14
- **Done when:** at least 80% of the clips whose sources are available are upgraded with parity (§10.5 step 8). The rest are listed with reasons.
- **Verify:** `node x lint anim --only library && node x unit anim/clip`

#### WP-4.8 The ACTIONS layer
- **Owns:** `engine/anim/actions.ts`, `data/anim/actions/*`
- **Needs:** WP 3.4, WP 4.4
- **Size:** M
- **Carry:**
  - The ranked list and build order of `docs/ANIMATION-RESEARCH.md`.
  - The `HCL_MOVES` design (`ed/96-hero-clips.js`), as input only.
- **Build:**
  - Multi-beat sequences that combine timelines, clips and effector overrides, with held contact frames, events and cancel windows.
  - A first set: jump phases, hurt and dizzy, the flip layer, death styles (the body only), charge-up, item-get, ledge hang and climb, wall slide, a paired grab, get-ups, idle life.
- **Improves:** I-11.
- **Done when:** each action has a check, lints and a gallery entry.
- **Verify:** `node x unit anim/actions && node x lint anim --only actions`

**Gate G4:**
- The library is intact, with provenance and parity proofs.
- The clip layer plays every clip on every build in Node with clean lints, or lints baselined with reasons.
- The browser smoke test passes on both backends.

### Phase 5: Render core (lane R)

#### WP-5.1 Renderer, capabilities, tiers, resolution
- **Owns:** `engine/gfx/{renderer,caps,tiers,resolution}.ts`
- **Needs:** G0
- **Size:** M
- **Build:**
  - `await renderer.init()`.
  - A report of backend, compat mode, features and limits.
  - `?backend=webgl` to force WebGL 2.
  - `renderer.onError` routed to the log.
  - The tier rules and feature registry of §6.7.
  - Resolution modes: pixel (200–330 lines, whole-pixel scaling), balanced, full; DPR handling and resize.
  - Interpolation alpha.
  - Stats from `renderer.info`.
  - Advice on every fallback.
- **Improves:** I-16.
- **Done when:** T2 asserts the backend, the tier and the compat flag on both backends, and forced WebGL works.
- **Verify:** `node x test --suite renderer --backend both`

#### WP-5.2 Materials, looks, outlines, warm-up
- **Owns:** `engine/gfx/materials/**`, `engine/gfx/warmup.ts`, `engine/gfx/capture.ts`, `tests/pages/scene.html`
- **Needs:** WP 5.1, G1
- **Size:** M
- **Carry:**
  - `TOON_BANDS`, the `objMat` MRT tagging, and `outlineMat` (`stress-world/00-setup.js:91-116`).
  - lab3d's `toonMat` (`lab3d/10-materials.js:80-96`).
- **Build:**
  - A material registry: toon, lit, unlit/emissive.
  - An outline shell that uses `positionGeometry` and is correct under instancing.
  - **Capture and the ID pass:** `capture()` renders into a render target and reads it back with `readRenderTargetPixelsAsync`. It returns `visible: [{ id, name, px, bbox }]`.
  - **`tests/pages/scene.html`:** a page that steps a fixture scene, with gfx wired by hand (before `createEngine` exists), and exposes the `__engine` core plus `capture`. Later render WPs test with it.
  - MRT channels: object mask and ID.
  - Looks: `toon`, `pixel`, `pbr-lite`.
  - A warm-up registry: `compileAsync` with `onProgress`, run for each look and re-run on toggles.
  - **One public pipeline counter**, the single place that reads renderer internals, pinned to the three.js version by a test.
- **Improves:** I-18.
- **Done when:**
  - A scripted session that toggles every look builds 0 pipelines after warm-up, on both backends.
  - On instanced box parts, the outline shell's ID-pass bounding box contains the part's, centred within 1 px.
  - The ID pass reports every object of a fixture scene on both backends.
- **Verify:** `node x test --suite warmup --backend both`

#### WP-5.3 Procedural textures and the material library
- **Owns:** `engine/gfx/textures/**`, `tools/lint/tex.mjs`
- **Needs:** WP 5.2
- **Size:** M
- **Carry:**
  - `E.tex`'s seven generators (`engine:3057-3101`).
  - The labs' own texture functions (`lab3d/10-materials.js:20-66`; wall faces in `stress-world/10-hall.js:225-248`).
  - The hall floor bake, with a contact shadow at wall feet and the rune circle as an emissive map (`stress-world/10-hall.js:206-287`).
- **Build:**
  - A generator registry: seeded and periodic, giving albedo, height, roughness and emissive per texel.
  - A CPU bake to `DataTexture`s with mipmaps, normals from height, and pixel (nearest magnification) or smooth looks.
  - Sets: flagstone, brick, planks, stone, dirt, grass, water, checker, metal, plaster, runes.
  - TSL noise for large-scale variation.
  - Contact sheets, and the tileability lint.
- **Improves:** I-20.
- **Done when:**
  - Every generator tiles: the mean difference across the wrap edge is at most 2% of the value range above that of neighbouring interior pairs.
  - Bakes are deterministic in Node (hashed).
  - The per-backend baselines are stable.
- **Verify:** `node x unit gfx/textures && node x lint tex`

#### WP-5.4 Geometry kit
- **Owns:** `engine/gfx/geometry/**`, `tools/lint/geo.mjs`
- **Needs:** WP 5.2
- **Size:** M
- **Build:** pure builders to `BufferGeometry`:
  - box, rounded box, tapered limb or capsule, lathe, extrude, sweep;
  - stairs, ramp or wedge, frustum, arch, pillar with plinth and capital, ring;
  - a terrain patch.

  Texel density defaults to 16 px per metre. Geometry lints.
- **Done when:** vertex counts, bounds, normals and the lints all pass in Node.
- **Verify:** `node x unit gfx/geometry && node x lint geo`

#### WP-5.5 Instancing service and batches
- **Owns:** `engine/gfx/instancing.ts`
- **Needs:** WP 5.2
- **Size:** M
- **Carry:** `Batch` (`stress-world/30-crowd.js:20-67`).
- **Build:**
  - Capacity paging.
  - Usage and instance colours set **before the first render**.
  - Update ranges.
  - Awareness of the uniform-buffer limit.
  - Shared materials.
  - A `BatchedMesh` option with Uint32 indices.
  - Per-instance palette attributes.
- **Improves:** I-19.
- **Done when:**
  - A 2,000-instance batch updates on both backends: the ID-pass counts follow the moved instances.
  - No shader is built per page (checked with the pipeline counter).
- **Verify:** `node x test --suite instancing --backend both`

#### WP-5.6 Puppets: bodies as data
- **Owns:** `engine/gfx/puppets/**`, `fixtures/bodies/*`, `fixtures/scenes/sandbox/` (a flat floor, 10 crates and one mannequin actor; WP 6.1 adds the room level)
- **Needs:** WP 5.4, WP 5.5, WP 3.1, WP 3.7, WP 3.8
- **Size:** L
- **Carry:**
  - The lab3d grammar (`lab3d/40-characters.js:8-48`).
  - The `humanParts` sizing (`stress-world/30-crowd.js`).
  - The builds' drawing fields.
- **Build:**
  - Body grammar v2:
    - parts on bones: limb, curve, ball, box, cone, eye, blade, cape strip, hair strands;
    - points: a bone name, `[f, r, u]`, `lerp`, `off`;
    - material slots, and L/R mirroring.
  - Compiled to one of:
    - instanced parts per part type, for crowds;
    - **one rigid-skinned mesh per character**;
    - smooth skinning, optionally.
  - Bodies: the mannequin, a neutral humanoid, a blob, and the fixture rigs.
- **Improves:** I-21.
- **Done when:**
  - `fixtures/scenes/sandbox` draws in under 50 draw calls (the prototype's lab used 1,225).
  - Socket positions match FK within 1 mm.
- **Verify:** `node x test --suite puppets --backend both && node x unit gfx/puppets`

#### WP-5.7 Lights, shadows, atmosphere, sky
- **Owns:** `engine/gfx/{lights,shadows,atmosphere,sky}.ts`, plus the `DynamicLighting` addon via `x vendor --addon`
- **Needs:** WP 5.2
- **Size:** M
- **Carry:** the fog that starts past the focus; the backdrop generators (`engine` §21b).
- **Build:**
  - A light pool on `DynamicLighting`: a budget of 8–16 point lights near the focus, flickering on `fxRng`.
  - A shadow budget: the sun plus 2 point lights, chosen by priority.
  - Fog: range plus height fog.
  - A TSL sky dome (gradient, sun or moon, stars) and a backdrop sky cylinder.
  - Presets: day, dusk, night, cave and others.
- **Improves:** I-17.
- **Done when:** changing the light count builds 0 pipelines, and every preset renders on both backends.
- **Verify:** `node x test --suite lights --backend both`

#### WP-5.8 Cameras, cutaway, shake
- **Owns:** `engine/gfx/cameras/**`, `engine/gfx/cutaway.ts`
- **Needs:** WP 5.2, WP 2.3
- **Size:** M
- **Carry:**
  - `stress-world/40-cameras.js`.
  - `boost()`, `lab3d/50-cameras.js:31-40` (COPY).
  - The lab3d orbit, and both labs' camera links (`?cam=`, `?cam3=`).
- **Build:**
  - Presets: iso, three-quarter, top-down, brawler, side, and custom; ortho or perspective, with boost.
  - Orbit, fly, and chase. Chase avoids walls with raycasts through the read-only `QueryView` (§6.1).
  - First person at the head socket, with near-body culling.
  - The side-scrolling depth rail, and fixed cameras.
  - Camera codes.
  - Camera-relative movement through `intents.fromCamera` (WP 1.5), so W walks away from the camera.
  - Cutaway, and shake.
- **Done when:**
  - Each camera has an ID-pass test: the focus is visible and coverage is sane.
  - The classic views reproduce the boost: a 1 m cube's projected height matches the view's boost within 1%.
  - Camera codes round-trip.
- **Verify:** `node x test --suite cameras --backend both`

#### WP-5.9 Post-processing
- **Owns:** `engine/gfx/post/**`, plus the `BloomNode` and FXAA addons via `x vendor --addon`
- **Needs:** WP 5.2
- **Size:** M
- **Carry:** `stress-world/45-filters.js`.
- **Build:**
  - A `RenderPipeline` chain.
  - Filters: cel, pixel (palette and dither), bloom (the allowlisted `BloomNode`), FXAA, and an ID/depth edge outline.
  - A scope from the MRT mask: scene, objects or environment.
  - Warm-up integration.
- **Done when:**
  - Every filter works on both backends.
  - Toggling a filter builds no pipeline after warm-up.
  - The ID pass is unchanged by filters.
- **Verify:** `node x test --suite post --backend both`

#### WP-5.10 Effects
- **Owns:** `engine/gfx/fx/**`, `engine/world/telegraphs.ts` (shape data and near-miss geometry: sim-side)
- **Needs:** WP 5.5, WP 3.6
- **Size:** M
- **Carry:**
  - `stress-world/35-effects.js`.
  - The engine's particle emitters (`engine` §8: dust, spark, bit, ember, ring, text; explosion, fire, smoke).
- **Build:**
  - CPU particles as view state: `fxRng`, pooling, instanced quads.
  - Socket trails.
  - Telegraph shapes as data (arc, ring, line, cone) in `world/telegraphs.ts`, where sim code tests near misses; `gfx/fx` draws them at floor height.
  - Decals, and blob shadows.
- **Done when:**
  - **The sim hash is identical with effects on and off.**
  - Budgets hold.
- **Verify:** `node x unit gfx/fx && node x test --suite fx --backend both`

#### WP-5.11 Capture, the ID pass, visual tools, parity
- **Owns:** `tools/cmd/film.mjs`, extends `tools/cmd/shot.mjs` (ID-pass stats, thumbnails), `tests/baselines/thumbs/*`, `tests/browser/parity.spec.ts`
- **Needs:** WP 5.6, WP 1.5, WP 2.1
- **Size:** M
- **Carry:**
  - The look metrics and notes of `tools/check.mjs:40-50, 96-104`.
  - `tools/filmstrip.mjs` (PORT).
- **Build:**
  - Look metrics and text thumbnails on top of WP 5.2's `capture()`.
  - The ID pass, look metrics and text thumbnails.
  - `x shot`, and `x film --compare main` (via `git worktree`).
  - **The parity suite:** live play on each backend is recorded, replayed headless, and its hashes compared; the ID pass is compared across backends.
- **Improves:** I-07, I-28.
- **Done when:**
  - The parity suite is green on `fixtures/scenes/physics-40` and `fixtures/scenes/sandbox`, run in `tests/pages/scene.html`.
  - `--compare main` works locally and in CI.
- **Verify:** `node x test --suite parity --backend both`

**Gate G5:**
- Every render suite is green on both backends.
- 0 pipelines are built after warm-up.
- The parity suite is green.
- Budgets hold.

### Phase 6: World (lane W)

#### WP-6.1 The level compiler
- **Owns:** `engine/world/level/**`, `engine/sim/levelBodies.ts` (a compiled level becomes Rapier colliders and spawns), `fixtures/levels/{hall,room}.txt`, `tools/lint/level.mjs`, `tests/replays/world-*.replay.json`; extends `fixtures/scenes/sandbox` with the room
- **Needs:** WP 2.2, WP 5.4
- **Size:** L
- **Carry:**
  - `parseLevel` (`engine` §13).
  - The hall's and room's glyphs (`stress-world/10-hall.js`; `lab3d/20-world.js:12-35`).
  - Greedy-rectangle colliders, stair wedges, the dais frustum.
- **Build:**
  - **A legend registry.** Each glyph maps to: height, top, collider, mesh builder, nav flags, spawn, light and prop.
  - **An optional heights layer.**
  - **`compile`** produces height queries (`floorH`, `topH`), the walkable grid, colliders, mesh descriptors, spawns, lights and props.
  - **`validate()`**, which reports unknown glyphs, unreachable spawns and stairs that are too steep.
  - **The hall and room**, ported as fixtures.
- **Improves:** I-22.
- **Done when:**
  - The hall compiles.
  - `validate()` catches every seeded error.
  - A replay where the hero climbs to the gallery passes.
- **Verify:** `node x unit world/level && node x replay tests/replays/world-*`

#### WP-6.2 Navigation and spatial queries
- **Owns:** `engine/world/{nav,spatial}.ts`, `fixtures/scenes/nav-1000/`
- **Needs:** WP 6.1, WP 2.3
- **Size:** M
- **Carry:**
  - `PASS`, `CLIMB` and the Dijkstra `FLOW` (`stress-world/10-hall.js`).
  - `SpatialHash` (`engine:3626-3646`).
- **Build:**
  - Multi-target, cached flow fields.
  - A* on the grid.
  - A spatial hash on typed arrays.
  - Line-of-sight checks on the grid.
- **Done when:**
  - In a replay, the crowd follows the hero up the stairs.
  - 1,000 agents stay within budget.
- **Verify:** `node x unit world/nav && node x perf fixtures/scenes/nav-1000 --budget`

#### WP-6.3 The props library
- **Owns:** `engine/world/props/**`
- **Needs:** WP 6.1, WP 5.3
- **Size:** M
- **Carry:**
  - The idea of the 2D 38-prop catalog, with its light metadata.
  - The stress-world crate, barrel and brazier, and pillars with plinths and capitals.
- **Build:** a registry where each prop has:
  - geometry, material and body;
  - an optional light and interaction hooks.

  The first set: crate, barrel, brazier, torch sconce, pillar, banner, chest, door, table, bench, statue, lantern.
- **Done when:**
  - Every prop passes the geometry and texture lints.
  - Every prop renders in `tests/browser/props.spec.ts`: ID-pass coverage above 0 on both backends.
- **Verify:** `node x lint geo tex --only props && node x test --suite props --backend both`

#### WP-6.4 Generic gameplay kits
- **Owns:** `engine/world/{surfaces,things,projectiles,ai}.ts`
- **Needs:** WP 6.1, WP 2.3
- **Size:** M
- **Carry:**
  - `Bullets` and `E.pattern` (`engine:3553-3625`), moved to 3D.
  - Attack tokens (mechanism only). Telegraph near-miss tests use `world/telegraphs.ts` from WP 5.10.
- **Build:**
  - **Surface tags:** friction, footstep sound, damage.
  - **Things** that can be hit.
  - **Projectiles** with swept tests and the aim, spread and ring patterns.
  - **An attack-token manager.**
  - **An awareness and line-of-sight helper.**
- **Done when:**
  - Unit tests pass.
  - A fast projectile never tunnels.
- **Verify:** `node x unit world`

#### WP-6.5 Terrain (new)
- **Owns:** `engine/world/terrain.ts`, `engine/physics/heightfield.ts`, `engine/gfx/terrain.ts`
- **Needs:** WP 6.2, WP 3.2, WP 5.3
- **Size:** M
- **Build:**
  - A seeded fbm heightfield **descriptor** in `world/`, made into a Rapier heightfield collider by `physics/heightfield.ts`.
  - A chunked mesh with LOD.
  - A splat material driven by slope and height.
  - A nav grid built from the terrain.
- **Done when:**
  - The character walks the terrain with planted feet.
  - Replays match.
- **Verify:** `node x unit world/terrain && node x test --suite terrain --backend both`

**Gate G6:**
- Fixture levels compile and validate.
- Navigation replays match.
- Props and terrain render on both backends within budget.

### Phase 7: Audio (lane X)

#### WP-7.1 DSP core
- **Owns:** `engine/audio/dsp/**`
- **Needs:** G1
- **Size:** M
- **Carry:** the synth design (`engine:3647-3856`).
- **Build:**
  - Oscillators: square, pulse 25% and 12.5%, triangle, sine, saw, noise.
  - ADSR envelopes, sweeps, arpeggios, vibrato, biquad filters, delay, simple FM, and a Karplus–Strong pluck.
  - `render(def, seed, rate) → Float32Array`, deterministic and hashable.

  jsfxr (Unlicense) and ZzFX (MIT) are references only. If code is ever borrowed, its license is recorded.
- **Improves:** I-23.
- **Done when:** the same definition and seed give the same hash in Node and in Chromium.
- **Verify:** `node x unit audio/dsp && node x test --suite audio-dsp --backend webgl2`

#### WP-7.2 Sound data
- **Owns:** `engine/audio/data/**`, `fixtures/sounds/` (a small neutral sound set and one demo song for tests and the gallery)
- **Needs:** WP 7.1
- **Size:** S
- **Carry:** the engine's 33 effects, 6 drums and 5 songs (COPY the data).
- **Build:**
  - The data as typed modules.
  - Validators (track length must divide the bar; value ranges).
  - Variants, and layered effects.
- **Done when:** every sound renders, and its validators pass. The clipping, DC and duration lints run over them from WP 7.4 on.
- **Verify:** `node x unit audio`

#### WP-7.3 Runtime, spatial audio, music
- **Owns:** `engine/audio/runtime/**`
- **Needs:** WP 7.2, WP 2.3, WP 6.4
- **Size:** M
- **Build:**
  - **Context:** resumed on a user gesture; the iOS silent switch documented.
  - **Mixing:** buses for effects, music, UI and ambience; ducking; voice limits.
  - **Playback:** buffer playback, or streaming through an `AudioWorklet`.
  - **Spatial:** `PannerNode` positioning, with the listener following the camera.
  - **Occlusion:** muffling from a raycast through the `QueryView`, presentation only.
  - **Reverb:** procedural impulse responses for each room preset.
  - **Music:** layers by intensity; section changes at bar lines; stingers on the beat; stings bound to events.
  - **Footsteps** chosen by surface.
- **Done when:** a browser smoke test on both backends shows no errors and the right context states, and an `OfflineAudioContext` smoke test passes within tolerances.
- **Verify:** `node x test --suite audio --backend both`

#### WP-7.4 Audio tools
- **Owns:** `tools/cmd/audio.mjs`, `tools/lint/audio.mjs`, `tests/baselines/lints-audio.json`
- **Needs:** WP 7.2
- **Size:** S
- **Build:** `x audio` (metrics, plus WAV or spectrogram PNG in `out/` on request), and the audio lint baselines.
- **Done when:** lints over every sound run in under 5 s in Node.
- **Verify:** `node x lint audio && node x audio sfx:jump --spectrogram`

**Gate G7:** sound buffers hash the same in Node and the browser; lints are clean; the runtime smoke test passes on both backends.

### Phase 8: Input, UI, dev tools (lane I)

#### WP-8.1 Input devices, bindings, intents
- **Owns:** `engine/input/**` except `intents.ts`, which only gets extended
- **Needs:** G1
- **Size:** M
- **Carry:**
  - The action model of `engine:476-694`.
  - The rebinding mechanism of `ed/61-controls.js`.
  - The lessons in `docs/CONTROLS-AUDIT.md`.
- **Build:**
  - **Devices:**
    - keyboard;
    - mouse, with pointer lock and wheel;
    - gamepads in any slot, with a radial deadzone and analog triggers;
    - touch: a stick, buttons and safe areas.
  - **Action maps and presets.**
  - **Bindings:** rebind, conflicts, reserved keys, persistence, labels per device.
  - **Edges, buffering and `consume`** in sim time.
  - **Clear on blur, visibility change and disconnect.**
  - **Camera-relative intents.**
  - **A virtual device, and a recorder.**
- **Improves:** I-24.
- **Done when:** browser tests pass with injected keyboard, gamepad-stub and CDP touch events, and the intents are unit-tested in Node.
- **Verify:** `node x unit input && node x test --suite input --backend webgl2`

#### WP-8.2 UI overlay, font, widgets
- **Owns:** `engine/ui/**`
- **Needs:** WP 8.1, WP 5.1
- **Size:** M
- **Carry:**
  - The pixel font, compact encoding.
  - `ui.box/bar/hearts`, `Dialog`, `Menu`.
  - The damage-number overlay.
- **Build:**
  - An overlay canvas at pixel scale, with text and widgets.
  - Dialog and Menu with input and sound injected.
  - `ui.state()`.
  - Safe areas.
- **Done when:** `ui.state()` snapshot tests pass, and the overlay renders on both backends.
- **Verify:** `node x unit ui && node x test --suite ui --backend both`

#### WP-8.3 Full inspector, overlay, routes
- **Owns:** `engine/dev/{inspector,overlay}.ts`, `engine/app/routes.ts`, `tools/cmd/{eval,dump}.mjs`; extends `tools/cmd/serve.mjs` with `--inspect` (one persistent headless page)
- **Needs:** WP 8.2, WP 5.2, WP 5.8
- **Size:** M
- **Build:**
  - The whole `__engine` API of §8.3.
  - The error overlay and `ready || error`.
  - Deep links: `?scene ?cam ?look ?backend ?seed ?replay #gallery/…`.
- **Improves:** I-25.
- **Done when:**
  - Every inspector member is tested in the browser and in headless mode.
  - `help()` matches the API.
- **Verify:** `node x test --suite inspector --backend both && node x docs --check`

#### WP-8.4 Settings panel, tuning, sandbox
- **Owns:** `engine/dev/{panel,tuning,sandbox}.ts`
- **Needs:** WP 8.3
- **Size:** M
- **Build:**
  - **A DOM panel generated from the settings schema:** search, tiers, reset, a TUNED marker, JSON export.
  - **A sandbox:**
    - god mode, frozen AI, stepping, speed;
    - spawn any registered actor (capped at 300);
    - travel;
    - `registerDevAction`.
- **Improves:** I-37.
- **Done when:**
  - Every setting appears in the panel, as a URL parameter and in `__engine.set`.
  - A test enforces that every knob has a range and docs.
- **Verify:** `node x unit dev && node x test --suite dev --backend webgl2`

#### WP-8.5 Gallery
- **Owns:** `engine/dev/gallery.ts`
- **Needs:** WP 8.4, G3, G4, G5, G6, G7
- **Size:** M
- **Build:**
  - Reels driven by the registries: bodies × body states, moves, actions, clips, props, materials, emitters, sounds.
  - Deep links, slow motion, camera presets, the training-dummy fixture.
  - Wrong names warn with the list of valid ones.
- **Done when:** every registered entry has a reel that renders on both backends.
- **Verify:** `node x test --suite gallery --backend both`

#### WP-8.6 Bot harness
- **Owns:** `engine/dev/bot.ts`
- **Needs:** WP 8.4, WP 6.2
- **Size:** M
- **Build:**
  - A virtual device and navigation.
  - A watchdog, with stuck detection measured along the wanted direction.
  - Telegraph avoidance.
  - Deterministic runs, and the smoke suite.
- **Improves:** I-38.
- **Done when:** in a replay, the bot walks `fixtures/levels/hall.txt` from the spawn to the gallery; smoke runs are deterministic.
- **Verify:** `node x unit dev/bot && node x test --suite smoke`

#### WP-8.7 Performance governor
- **Owns:** `engine/dev/governor.ts`
- **Needs:** WP 8.4
- **Size:** S
- **Carry:** the mechanism of `ed/95-perf.js`.
- **Build:**
  - Tiered adaptive quality with hysteresis.
  - It owns the Enhanced features, presentation LOD (pose LOD, draw distance, light and shadow budgets, effect density) and resolution.
  - It **never** changes sim state or sim settings. Sim LOD is a scene setting recorded in replays (Q5).
  - It is frozen in deterministic runs.
  - Every change it makes is logged as advice.
- **Done when:** a simulated sequence of frame times produces the expected demotions and promotions, with no flicker.
- **Verify:** `node x unit dev/governor`

**Gate G8:** input, UI and dev suites are green on both backends; the inspector is complete; the gallery covers every registry.

### Phase 9: Integration (the integrator plus each lane)

#### WP-9.1 `createEngine`, the loop, scenes, the store, the game template
- **Owns:** `engine/app/**`
- **Needs:** G2, G3, G4, G5, G6, G7, G8
- **Size:** M
- **Carry:** the scene and timer patterns; `E.store` (`engine:198-202`), extended with a configurable prefix (replacing the fixed `my3d2dge:`), a memory backend, versioning, and isolation in demo, sandbox and gallery modes.
- **Build:**
  - `createEngine`, with the loop of §6.4 and the scene lifecycle.
  - `x new scene`.
  - **`x new game <name> [--out dir]`**, the starting point for the future game. It scaffolds a separate package, by default outside this repository, containing:
    - a `package.json` that pins the engine by git tag (`github:michaelcrosato/my-3dge#v0.x.y`), or by a relative path for local development;
    - an `index.html` with the import map;
    - one scene and its replay test;
    - the game's own AGENTS.md.

    CI scaffolds it into a temporary directory and runs its test.
- **Done when:** `fixtures/scenes/sandbox` gives the same hash under `createEngine` and headless, and a scaffolded game passes its own test.
- **Verify:** `node x unit app && node x test --suite app --backend both`

#### WP-9.2 Sandbox lab (successor to lab3d)
- **Owns:** `labs/sandbox/**`
- **Needs:** WP 9.1
- **Size:** M
- **Build:**
  - The room and hall fixtures.
  - A mannequin hero with combo, dash and jump.
  - Crates, every camera and look, and the fixture creatures.
  - The parity suite (record live, replay headless).
- **Done when:** parity and ID-pass parity are green, and budgets hold.
- **Verify:** `node x test --suite sandbox --backend both`

#### WP-9.3 Stress World (the benchmark)
- **Owns:** `labs/stress-world/**`, extensions to `tools/cmd/perf.mjs` (browser and GPU timings)
- **Needs:** WP 9.1
- **Size:** L
- **Carry:** the stress-world AI, waves and benchmark, **as a benchmark sample only**.
- **Build:**
  - The hall fixture.
  - Walkers, blobs and floaters built from fixture bodies.
  - Crowds up to 5,000; launches; 0–300 props.
  - The benchmark report, broken down by physics, logic, animation, rendering and GPU.
  - Budgets and trends.
- **Improves:** I-39.
- **Done when:** the budgets of §8.7 hold, and the trend file is updated *(nightly)*.
- **Verify:** `node x perf labs/stress-world --budget`

#### WP-9.4 Animation Lab
- **Owns:** `labs/anim/**`
- **Needs:** WP 9.1
- **Size:** M
- **Carry:** the animlab UX (`src/starter/60-animlab.js`): lineup, skins, phase timeline, frozen key poses, dummy.
- **Build:**
  - Every move, pose, action, reaction and clip on every body.
  - The lineup, timeline scrubbing and a bone overlay.
  - Live lints, and deep links.
- **Done when:** every registered animation opens from a deep link and renders on both backends.
- **Verify:** `node x test --suite anim-lab --backend both`

#### WP-9.5 Library Lab (successor to the Mocap Lab)
- **Owns:** `labs/library/**`
- **Needs:** WP 9.1
- **Size:** M
- **Build:**
  - Catalog search.
  - The clip as text, with Apply, Reset, Mirror and Copy for model.
  - Deep links and frame stepping.
  - A retarget preview across the builds.
- **Done when:** an edit test (raise the right arm, then Apply) moves the fist; Reset restores the clip; both backends pass.
- **Verify:** `node x test --suite library-lab --backend both`

#### WP-9.6 Materials, Props, FX, Audio, Cameras and Physics labs
- **Owns:** `labs/{materials,props,fx,audio,cameras,physics}/**`
- **Needs:** WP 9.1
- **Size:** M
- **Build:** galleries driven by the registries; each lab doubles as a test fixture.
- **Done when:** every lab passes its suite.
- **Verify:** `node x test --suite labs --backend both`

#### WP-9.7 Labs index, deploy, stamps
- **Owns:** `labs/index/**`, `labs/labs.json`, `vercel.json`, the site part of `tools/cmd/build.mjs`
- **Needs:** WP 9.2, WP 9.3, WP 9.4, WP 9.5, WP 9.6
- **Size:** S
- **Carry:** `src/labs.json`, the template and `tools/labs-test.mjs` (PORT, adding `answer` and `expires`).
- **Build:**
  - The site is built from source with WP 0.7's `x build`, which renames `.ts` to `.js` (Q2, decided).
  - Vercel previews, labelled.
  - The commit stamp.
- **Improves:** I-33.
- **Done when:** a deploy preview loads every lab, and the labs test opens every link.
- **Verify:** `node x build && node x test --suite site`

**Gate G9, the baseline engine:**
- Every gate G0–G8 holds.
- Every lab is green on both backends.
- The parity suite is green.
- The benchmark is within budget.
- `x new game` produces a package that runs.
- The release is cut with `x release 0.x.0`.

### Phase 10: The Enhanced tier (lane R2, WebGPU-only, never gameplay)

#### WP-10.1 Hardening the tier framework
- **Owns:** `engine/gfx/tiers.ts`, `tests/browser/tiers.spec.ts`
- **Needs:** G9
- **Size:** S
- **Build:**
  - Per-feature parity tests: with each feature off, the ID pass equals the Baseline; with it on, the ID pass still equals the Baseline and the hash is unchanged.
  - Governor integration.
  - `__engine.info().features`.
- **Done when:** the tier matrix passes locally on WebGPU, and runs in nightly CI *(nightly)*.
- **Verify:** `node x test --suite tiers --backend webgpu`

#### WP-10.2 GPU particles
- **Owns:** `engine/gfx/enhanced/particles.ts`
- **Needs:** WP 10.1, WP 10.5
- **Size:** M
- **Build:** compute particles (`instancedArray` plus `Fn().compute`), decorative only, falling back to CPU particles.
- **Done when:**
  - Particles are view-only, so they stay out of the ID pass. With GPU particles on or off, the ID pass of the rest of the scene is unchanged.
  - The hash is unchanged.
  - The GPU time measured through WP 10.5 is under the budget.
- **Verify:** `node x test --suite enhanced-particles --backend webgpu`

#### WP-10.3 GPU-driven crowds
- **Owns:** `engine/gfx/enhanced/crowds.ts`
- **Needs:** WP 10.1
- **Size:** L
- **Build,** in stages:
  1. Compute frustum culling plus indirect draws over the instancing service's batches.
  2. Only if the 2× target is still missed: compute skinning and occlusion culling.

  The instancing service remains the fallback.
- **Done when:** draw-call and CPU-render budgets improve by at least 2× at 5,000 crowd members, with the fallback identical in the ID pass.
- **Verify:** `node x perf labs/stress-world --tier enhanced --budget`

#### WP-10.4 Lighting and shading upgrades
- **Owns:** `engine/gfx/enhanced/{lighting,ao,ssr,gi,aa,volumetrics}.ts`
- **Needs:** WP 10.1
- **Size:** L
- **Build:**
  - `ClusteredLighting`, and `SunLight` (two-cascade CSM).
  - GTAO or SSAO, and SSR.
  - SSGI or VXGI, flagged experimental.
  - TRAA, TAAU or FSR1, with deterministic jitter in tests.
  - Volumetrics, and god rays.
- **Done when:** each feature passes its parity test and has a measured cost, and the governor demotes them under load.
- **Verify:** `node x test --suite enhanced --backend webgpu`

#### WP-10.5 GPU timing
- **Owns:** `engine/gfx/enhanced/timing.ts`
- **Needs:** WP 10.1
- **Size:** S
- **Build:** `trackTimestamp`, and `resolveTimestampsAsync` feeding `stats().gpuMs`, used where `timestamp-query` exists.
- **Done when:** GPU time appears in `stats().gpuMs` and in `x perf` on supporting adapters.
- **Verify:** `node x test --suite timing --backend webgpu`

**Gate G10:**
- Every Enhanced feature is visual-only: the sim hash is unchanged and the ID pass matches the Baseline.
- Each falls back cleanly.
- Each is owned by the governor and reported in `info()`.

### Phase 11: Advanced agent tooling (lane T)

#### WP-11.1 MCP server
- **Owns:** `tools/mcp/**`, `tools/cmd/mcp.mjs`
- **Needs:** WP 8.3, WP 5.11
- **Size:** M
- **Build:** the tools in §8.11, over `x serve --inspect`.
- **Improves:** I-35.
- **Done when:** an MCP client test opens `tests/pages/scene.html?scene=sandbox`, steps it, captures the ID pass and replays a file.
- **Verify:** `node x unit tools/mcp`

#### WP-11.2 Skills, subagents and scaffolds, completed
- **Owns:** `.claude/skills/**`, `.claude/agents/**`, `tools/cmd/new.mjs` templates
- **Needs:** G9
- **Size:** M
- **Build:**
  - `x new` for every registry kind, each with `--test` in CI.
  - Every skill and subagent listed in §8.10.
- **Improves:** I-36.
- **Done when:** every template passes every check in CI.
- **Verify:** `node x new --test-all`

#### WP-11.3 Agent-usability evals and mutation testing
- **Owns:** `evals/**`, `tools/cmd/evals.mjs`
- **Needs:** G9
- **Size:** M
- **Build:**
  - At least 12 small tasks with automated acceptance, for example:
    - add a prop;
    - make a fixture wave on a key;
    - add a fog preset;
    - add a move;
    - fix a seeded desync.
    A fresh agent attempts each using only the docs.
  - Mutation testing: mutants injected into `sim` and `anim` must be caught by the suites.
- **Improves:** I-40.
- **Done when:** a baseline pass rate is recorded, and at least 90% of mutants are caught.
- **Verify:** `node x evals --dry-run && node x test --suite mutants`

#### WP-11.4 Agent eye
- **Owns:** `tools/cmd/eye.mjs`, `engine/dev/eye.ts`
- **Needs:** G9
- **Size:** S
- **Build:** a coarse visibility raster in Node, built from physics shapes and camera poses. It answers "is X visible from camera C" and draws ASCII thumbnails, with no GPU.
- **Done when:** its answers agree with the ID pass on the sandbox cameras for at least 95% of cases.
- **Verify:** `node x unit dev/eye && node x test --suite eye --backend webgl2`

#### WP-11.5 Reading edition (optional)
- **Owns:** `tools/cmd/edition.mjs`
- **Needs:** G9
- **Size:** S
- **Build:** a single generated file containing the headers, the API and the examples, for handing to a chat model, with a token budget. **It is generated and tested, never written by hand.**
- **Done when:** the file is regenerated in CI, its examples run, and it is within budget.
- **Verify:** `node x edition --check`

**Gate G11:**
- The MCP bridge, the complete scaffolds, the eval baseline and the mutation score are all in place.
- The ledger is up to date.

### Upgrade work packages (scheduled when due, never mixed with feature work)

- **U-1, three.js to the next `.1` release:**
  - update `vendor/` and `@types/three`, `THREE-DELTA.md`, and the rename rules;
  - run the canary results;
  - re-baseline the shaded goldens deliberately, recording each change.

  Done when the replays, the ID-pass parity and the tier matrix are green.
- **U-2, Rapier 0.21.x (deterministic):**
  - re-tune the constants for sleep, CCD, velocity caps and contacts;
  - re-baseline the replays (snapshots are version-locked);
  - accept the +0.8 MB gzipped bundle;
  - update the ADR.

  Done when every physics replay and budget is green.

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
  actions/*.json                      multi-beat ACTIONS (WP 4.8)
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
          rotation tracks: Float32 quaternions per bone at 30 fps + hips + root (~106 KB per 10 s clip, lazy, cached)
          ─clip layer (weight, bone mask, fade from current pose, speed, loop, additive, events, root motion)─▶
          Character layer stack ─▶ pose ─▶ FK ─▶ puppets/skinning (presentation) or hits (sim)
```

- **Retargeting.**
  - Humanoid builds get a rotation copy, with the root scaled by the hip-height ratio, plus contact IK for feet and hands.
  - Non-human bodies map chains by name, using direction, bend and twist; the format's limb model suits this.
- **Feet.**
  - `contacts` drive the foot-planting post-pass on uneven ground.
  - From `drive`: the sole, not the ankle, goes to the floor, and the figure is lifted by its lowest point.
- **Sampling stays on the CPU** (law 5). Root motion, events and hit volumes are therefore identical on every backend.

### 10.5 Migration steps, each with its proof

| Step | WP | Proof |
|---|---|---|
| 1. Provenance and license files | 4.1 | SOURCES.md lists every library with its URL, file names, license text and acknowledgment |
| 2. Catalogs and ledger copied verbatim, then split | 4.1 | The split rows join back to the original exactly |
| 3. Port `readable.js` with no change in behaviour | 4.2 | Every clip sampled at 30 fps decodes within 0.001 mm of the reference vectors. The legacy oracle reproduces them bit for bit |
| 4. Repackage the sets as one file per clip | 4.3 | Rejoined, they deep-equal the source objects, and `text()` output is unchanged |
| 5. Baker and clip layer | 4.4 | FK parity against the v1 decode at 30 fps and at 60 Hz midpoints: mean ≤ 1 mm per set; worst cases listed |
| 6. Node contact sheets, tests and the Library Lab | 4.6, 9.5 | Lints pass or are baselined with reasons, on both backends |
| 7. Port the tools | 4.5 | `x anim import --cmu --legacy` reproduces the CMU set byte for byte. This study verified that the source's importer does so today |
| 8. Format-2 re-import from the sources | 4.7 | Per clip, decoded-point parity with v1 within that clip's fit; swapped in one at a time as `via: "source"` |
| 9. Re-survey CMU; import the `pick` rows as games need them | 4.7 | The ledger's `fit` reflects format 2; the notes are kept |

### 10.6 What the library does not cover, and how the engine fills it

**Already covered for humanoids** (measured against `ANIMATION-RESEARCH.md`'s ranked list), most of tiers 1–3:
- jump phases, get-ups, rolls and flips;
- lift, carry and throw; interactions; idle life;
- swimming, crawling, sliding and gliding;
- bow and shield; blocks; tool work; ceremonies and dances.

**Missing, and how each gap gets filled:**

| Gap | Filled by |
|---|---|
| Item-get, wall slide, whip, grabs with a victim | **ACTIONS** (WP 4.8), plus procedural moves |
| Quadrupeds and creatures | Procedural building blocks and fixture rigs (WP 3.8) |
| Vehicles | Later, when a game needs them |
| Death effects | FX, not clips |

**Future sources:**
- Quaternius Library 1 Pro and Library 2 Source (CC0) can be imported.
- 100STYLE is CC BY 4.0, which requires attribution. It is held back by default (Q11 in §13).

---

## 11. Running this plan: extra effort or ultracode

### 11.1 Rules for both modes

- **Order and gates.**
  - Never start a WP before everything it **Needs** is done and green.
  - Never call a gate passed until all its checks are green.
  - Never weaken a gate to pass it.
- **Commits.** One commit per WP (more is fine; squash when merging), with the message `<area>: <what> (WP-x.y)`.
- **Pull requests.** One PR per phase or per gate, and CI must be green before merging. Work on the branch your session designates.
- **The ledger.** In extra-effort mode, update §14 in the same commit as the work: status, commit and a one-line note. In ultracode, lanes report and the integrator writes the ledger.
- **Deviations** become ADR amendments in `docs/decisions/`. **Blockers** go in the WP's ledger note, together with the smallest core change that would unblock it. Then move on to the next independent WP.
- **The source repo.** `$MY3D2DGE_SRC` (WP 0.1; `x src` checks it) points at a read-only checkout of my-3d2dge at `e37e4ee`. Read only the cited line ranges; never edit it.
- **Context hygiene.** Read AGENTS.md, the WP entry, the sections it cites, and the **headers** of the modules involved. Open a whole source file only when porting it.

### 11.2 Extra effort: one agent, sequential

**Recommended order**, which follows the dependency graph and lets the work verify itself early:

| Stage | Work packages |
|---|---|
| Up to G0 | 0.1 → 0.2 → 0.4 → 0.5 → 0.3 → 0.6 → 0.7 → 0.11 → 0.8 → 0.9 → 0.10 |
| Up to G1 | 1.1 → 1.6 |
| Interleaved lanes | 2.1 → 3.1 → 3.2 → 5.1 → 5.2 → 2.2 → 3.3 → 2.3 → 3.4 → 4.1 → 4.2 → 4.3 → 5.3 → 5.4 → 5.5 → 3.5 → 3.6 → 3.7 → 3.8 → 5.6 → 2.4 → 3.9 → 4.4 → 4.5 → 4.6 → 4.8 |
| Up to G5 | 5.7 → 5.8 → 5.9 → 5.10 → 5.11 |
| Up to G6 | 6.1 → 6.5 |
| Up to G7 | 7.1 → 7.2 → 7.4 → 7.3 |
| Up to G8 | 8.1 → 8.2 → 8.3 → 8.4 → 8.6 → 8.7 → 8.5 |
| Up to G9 | 9.1 → 9.7 |
| Last | 10.1 → 10.5 → 10.2 → 10.3 → 10.4, then 11.1 → 11.2 → 11.3 → 11.4 → 11.5, then 4.7 |

**Loop for each WP:**
1. Plan the files.
2. Write the tests first where the Done-when list is numeric.
3. Implement.
4. `x check` → `x unit` → `x test --changed`.
5. The `verifier` subagent reviews.
6. Fix, commit, update the ledger.

**Use subagents to keep the main context small:**
- `verifier` for every WP;
- `visual-reviewer` for anything visual;
- `suite-runner` for T2 and T3 in the background;
- an Explore agent for wide searches of the source.

**Checkpoints.** At each gate: push, open the PR, wait for green CI, merge, then write a gate note in the ledger (what is proven, measured numbers, open risks).

### 11.3 Ultracode: a multi-agent workflow

**Shape.**
- **Phases 0 and 1 run in sequence**, as a single lane with an implementer and a verifier.
- **After G1, two waves of parallel lanes**, keeping fewer than 10 agents at once:
  - **Wave A:** lanes P, A, R and X: 4 implementers, a shared verifier queue (1–2 agents) and 1 integrator.
  - **Wave B**, which starts as Wave A's prerequisites land: lanes L (as soon as 3.1, 3.6 and 0.11 exist), I and W.
- **Phase 9 runs on the integrator plus one agent per lab.**
- **Phase 10** (R2) and **Phase 11** (T) can overlap once G9 is near.

**Isolation.**
- Each lane runs in its own git worktree (`isolation: "worktree"`). Before its first Verify, the lane:
  - runs `npm ci` in the worktree, or symlinks the main checkout's `node_modules`;
  - exports `MY3D2DGE_SRC` as an absolute path;
  - sets `X_LANE=1`.
- A WP may change only its **Owns** paths, as widened by the rules in §9.3.
- Generated files (`docs/INDEX.md`, `docs/API.md`, `docs/ERRORS.md`) are never resolved by hand. On a merge conflict, take either side and re-run `x docs --write`.
- Shared files are owned by the integrator or regenerated:
  - `engine/index.ts`, `tools/lib/layers.json`, `package.json`, `tsconfig.json`, `docs/INDEX.md`, `docs/API.md`, `docs/ERRORS.md`, the ledger.
- Lanes request changes to shared files through their final report.

**The integrator:**
1. merges lanes in dependency order;
2. regenerates the docs (`x docs --write`);
3. applies the requested shared-file edits;
4. runs the full gate suite;
5. updates the ledger;
6. opens or updates the PR.

On a conflict, the WP merged later re-runs its Verify after rebasing onto the integrator's branch.

**Implementer prompt** (one per WP):
```
You are implementing WP-<id> "<title>" of my-3dge. Read: AGENTS.md; PLAN.md §3, §6, §8 and the WP-<id> entry in §9;
the headers of the modules named in Owns/Needs. Source to carry over is at $MY3D2DGE_SRC (my-3d2dge@e37e4ee):
read only the cited lines. Change only the Owns paths plus one changes/ fragment. Follow the five laws.
Write tests first for numeric Done-when items. Iterate until every Verify command exits 0.
Final report (≤ 30 lines): files changed; Verify results with report.json paths; Done-when checklist with evidence;
requested shared-file edits (exact text); deviations as ADR amendment text; open issues.
```

**Verifier prompt** (one per WP, adversarial):
```
Verify WP-<id> of my-3dge on branch <b>. Run its Verify commands plus `node x check` and `node x unit`.
Then try to break it: determinism leaks (Math.random, clocks, renderer reads in sim-side code), silent fallbacks,
files outside Owns, missing or weak tests (would a plausible bug pass?), docs drift, unbaselined lint changes,
game content creeping in (§5.7). Return JSON: { "pass": bool, "failures": [{ "what", "where", "fix" }], "notes" }.
```

**Gates in ultracode** are run by the integrator with `x test --all --backend both`, plus the gate's specific checks. A failed gate sends the failure back to the lane that owns it.

### 11.4 When something is not as the plan says

The source changes, an upstream API differs, or a number doesn't hold. In that case:
1. Measure.
2. Choose the option that best keeps the five laws.
3. Record it as an ADR amendment with the evidence.
4. Update the affected WP entries in this plan, in the same commit.

The plan is a living document. Its ledger and ADRs are the truth about what was done.

### 11.5 One-time owner setup (the only steps that need a person)

The engine is built only by agents, but a few switches belong to the repository's owner. Each has a fallback, so work never stalls. A WP that waits on one is marked **blocked on owner** in the ledger, and work moves on.

| Step | Needed by | Fallback until it's done |
|---|---|---|
| GitHub Actions on for the repository, and an agent token allowed to push `.github/workflows/*` (the `workflow` scope) | WP 0.9, G0 | `x ci --local` runs the same steps; the workflow files wait in a branch |
| Branch protection that makes `ci.yml` a required check | I-33 | Agents run `x ci --local` before every merge |
| A Vercel project (or GitHub Pages) linked to the repository | WP 9.7 | `x build` plus `x serve site/` locally |
| Quaternius Universal Animation Library 1 and 2 (`.glb`): a download link or a private repository | WP 4.7 | Quaternius clips stay `via: "v1"` and are listed as blocked |
| Model access for agent-usability evals (headless Claude Code or an API key) | WP 11.3 | `x evals --dry-run` checks the tasks and their acceptance tests only |

---

## 12. Risk register

| # | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| R1 | The animation's tuned "feel" is lost in the port (axes, units, positions → rotations) | M | H | Reference vectors (WP 0.11); differential tests (WP 3.3, 3.4); `x film --compare`; motion lints | A |
| R2 | Determinism breaks across browsers or machines | M | H | `dmath`; Rapier `deterministic-compat`; an ordered world; the nightly Firefox/WebKit/Node matrix; `--bisect` | C, P |
| R3 | Headless WebGPU is flaky or loses its device | H | M | The stand-in canvas with readback; lavapipe in CI; backend asserts; per-backend baselines; retries for infrastructure failures only | T |
| R4 | Agents write outdated three.js APIs, or upstream churns | H | M | Vendored `llms-full.txt` for 0.186 and the TSL Guide; `THREE-DELTA.md`; rename rules with replacements; deprecations fail tests; the `api-checker` subagent | T, R |
| R5 | Known r186 bugs: `setColorAt` after the first render (#34748); `PassNode` preparing contexts it never renders (#34681) | M | M | The instancing service sets colours before the first render; warm-up tests; the canary job | R |
| R6 | Instancing on Apple WebGL 2 (16 KB uniform blocks) | M | H | The r183+ threshold fix (on r186.1); a test that simulates a low uniform-buffer limit | R |
| R7 | The deterministic Rapier build is slower | M | M | Benchmark in WP 2.1; crowd optimizations; budget tolerances; an ADR | P |
| R8 | Crowd physics cost at 5,000 bodies (21 ms in the prototype) | H | M | Sleeping; sim LOD (kinematic grid movement beyond a radius), a scene setting recorded in replays and never driven by frame time; budgets. Enhanced tier for rendering only | P, R |
| R9 | Size creep and docs drift | M | M | `x sizes` budgets; `x docs --check`; caps on file and header length | T |
| R10 | Parallel agents collide | H | M | Owns lists; worktrees; changelog fragments; shared files regenerated or owned by the integrator | Integrator |
| R11 | Licenses or provenance get lost | L | H | `SOURCES.md`; per-clip `src`/`orig`/`take` tests; the CMU terms verbatim | L |
| R12 | Large data in git | L | M | `.cache/` on demand; no build output committed; the asset scan | L, T |
| R13 | Tools that need the network (CMU over HTTP; GitHub 403s for `curl` in the sandbox, while `git clone` works) | M | H for the source checkout, L otherwise | `$MY3D2DGE_SRC` resolution order (WP 0.1); committed reference vectors checked by checksum in CI; network tests nightly or on demand; caching | T, L |
| R14 | Agents report success falsely or skip tests | M | H | The `verifier` subagent; CI required checks; the "never skip a test" rule; mutation testing | T |
| R15 | Visual regressions go unnoticed | M | M | The ID pass, thumbnails, `--compare main`, and the `visual-reviewer` subagent on demand | R |
| R16 | Audio unlock and iOS restrictions | M | L | Resume on a gesture; an in-game mute; documentation | X |
| R17 | TypeScript stripping pitfalls (non-erasable syntax; MIME types on hosts) | M | M | `erasableSyntaxOnly`; renaming during the site build; `x serve` tests | T |
| R18 | Game content creeps into the engine | M | M | The exclusion list (§5.7); the verifier checks against it; fixtures stay minimal and neutral | All |

---

## 13. Decisions and open questions

### 13.1 Decisions (recorded as ADRs in WP 0.1)

| ADR | Decision |
|---|---|
| 0001 | **Scope:** the engine only. The game is built later and elsewhere. Emberdeep's patterns are rebuilt generically with new fixtures; its content is excluded (§5.7) |
| 0002 | **The five laws**, each with the check that enforces it (§3) |
| 0003 | **Language:** TypeScript with erasable syntax only, run with no build step: Node strips the types, and the dev server strips them with whitespace so line numbers hold. `tsc --strict` checks it, against pinned types. TypeScript 7.0.x, falling back to 6.0.x; JSDoc with `checkJs` is the last resort |
| 0004 | **Coordinates and units:** SI; right-handed; +Y up; characters face +Z; the conversion from my-3d2dge is in Appendix C |
| 0005 | **Time:** a fixed 60 Hz, at most 6 steps per frame, with interpolation; an injectable clock; a timescale stack; a hit-stop budget; per-entity clocks |
| 0006 | **Determinism contract** (§6.5): `dmath`, an ordered world, the deterministic Rapier build, hash and trace, the proof matrix |
| 0007 | **Versions:** three.js r186.1 and Rapier `deterministic-compat` 0.19.3, pinned and vendored, with the upgrade policy of §6.10 |
| 0008 | **Rendering tiers and the parity contract** (§6.7). Compute and storage only under `gfx/enhanced/`, plus the `BASELINE_COMPUTE` allowlist of map kernels |
| 0009 | **Animation architecture:** effector-space authoring, then IK, then a rotation skeleton (root + 23 joints); an explicit layer stack; two update paths; no Card mode; no camera input to animation |
| 0010 | **Animation library:** readable key poses (format 1, extended as format 2) are the stored format, baked to rotation tracks; the CMU library comes on demand |
| 0011 | **Characters as data:** body grammar v2; one rigid-skinned mesh per character by default; instanced crowds; smooth skinning optional |
| 0012 | **Registries and schemas:** "ask the entry, never the id"; every kind gets a gallery, lints, a scaffold and docs |
| 0013 | **Audio:** pure DSP into seeded, hashed `Float32Array`s; Web Audio for playback and spatial sound; `OfflineAudioContext` only for smoke tests |
| 0014 | **Tooling:** one CLI with `report.json`; test tiers with budgets; tests selected from the import graph; images optional |
| 0015 | **Docs:** the header is the manual; INDEX, API and ERRORS are generated; prose is never duplicated; upstream docs are vendored |
| 0016 | **Repo hygiene:** no committed build output; a lockfile; changelog fragments; the version in `package.json` only; CI required |

### 13.2 Open questions, each with a default (proceed with the default; revisit only through an ADR amendment)

| # | Question | Default |
|---|---|---|
| Q1 | TypeScript 7 or 6? | 7.0.x, if the WP 0.1 spike passes |
| Q2 | Site build: rename `.ts` to `.js`, or serve `.ts` as JavaScript? | **Decided in WP 0.7:** rename and rewrite the imports, which works on any host |
| Q3 | Hosting | Vercel, built from source, with previews; GitHub Pages is an acceptable alternative |
| Q4 | Where does the future game live? | A separate repository (or `games/<name>` package) scaffolded by `x new game`, importing the engine at a pinned tag |
| Q5 | What if the deterministic Rapier build is too slow? | Keep it. Optimize the crowd rather than switching builds: sleeping, and sim LOD (kinematic agents beyond a radius around sim entities). Sim LOD is a scene setting, fixed at load and recorded in replays. The governor never switches it, and neither does frame time |
| Q6 | Characters: skinned or rigid parts? | One rigid-skinned merged mesh by default; smooth skinning per body, optionally |
| Q7 | Card mode? | Dropped. If a game ever needs sprite characters, they become a separate optional module |
| Q8 | The pixel look? | A post filter (the `pixel` look) over real geometry |
| Q9 | Mobile? | The Baseline tier must run on mobile WebGL 2. Tests use emulated viewports; physical devices are stated as unverified |
| Q10 | Distributing the CMU library | `x anim cmu` fills `.cache/` on demand; a checksummed release asset can come later |
| Q11 | Import 100STYLE (CC BY 4.0)? | No, unless the owner approves the attribution requirement |
| Q12 | Run the sim in a Web Worker? | Not until a perf WP proves the need. The sim has no DOM, so it stays possible |
| Q13 | An ECS framework? | None: plain objects and systems in a fixed order. Revisit only with measurements |

---

## 14. Status ledger

Status is `todo`, `doing`, `done` or `blocked`. Update the row in the same commit as the work.

| WP | Title | Lane | Status | Commit | Notes |
|---|---|---|---|---|---|
| 0.1 | Repo constitution | T | todo | | |
| 0.2 | `x` CLI and tools/lib | T | todo | | |
| 0.3 | Vendoring and pinned knowledge | T | todo | | |
| 0.4 | `x check` and rules | T | todo | | |
| 0.5 | Test runners and selection | T | todo | | |
| 0.6 | Docs system | T | todo | | |
| 0.7 | Versioning, fragments, stamp, build | T | todo | | |
| 0.8 | Hello page on both backends | T | todo | | |
| 0.9 | CI | T | todo | | |
| 0.10 | Claude Code integration | T | todo | | |
| 0.11 | Port reference vectors | T | todo | | |
| **G0** | **Gate: foundation** | | todo | | |
| 1.1 | Math, dmath, rng, noise, hash, color | C | todo | | |
| 1.2 | Registry, events, log, settings, schema | C | todo | | |
| 1.3 | Time | C | todo | | |
| 1.4 | Sim world and canonical state | C | todo | | |
| 1.5 | Intents, replays, `x sim`, `x replay` | C | todo | | |
| 1.6 | Headless app and inspector core | C | todo | | |
| **G1** | **Gate: kernel** | | todo | | |
| 2.1 | Rapier adapter | P | todo | | |
| 2.2 | Character controller | P | todo | | |
| 2.3 | Bodies, crowds, queries, ragdoll builder | P | todo | | |
| 2.4 | Physics fixtures and replays | P | todo | | |
| **G2** | **Gate: physics** | | todo | | |
| 3.1 | Skeleton, builds, pose, FK, sheets | A | todo | | |
| 3.2 | IK | A | todo | | |
| 3.3 | Humanoid procedural port | A | todo | | |
| 3.4 | Moves, timelines, hits | A | todo | | |
| 3.5 | Reactions, secondary motion, ragdoll blend | A | todo | | |
| 3.6 | Character animator and body states | A | todo | | |
| 3.7 | Blob rig | A | todo | | |
| 3.8 | Building blocks and fixture rigs | A | todo | | |
| 3.9 | `anim.check`, lints, sheets | A | todo | | |
| **G3** | **Gate: animation core** | | todo | | |
| 4.1 | Provenance, catalogs, ledger, docs | L | todo | | |
| 4.2 | Readable codec and format 2 | L | todo | | |
| 4.3 | Re-containerize the sets | L | todo | | |
| 4.4 | Baker, clip layer, retarget, mannequin | L | todo | | |
| 4.5 | Tools port | L | todo | | |
| 4.6 | Library tests and lints | L | todo | | |
| 4.7 | Re-import from sources (after G4) | L | todo | | |
| 4.8 | ACTIONS layer | L | todo | | |
| **G4** | **Gate: animation library** | | todo | | |
| 5.1 | Renderer, capabilities, tiers, resolution | R | todo | | |
| 5.2 | Materials, looks, outlines, warm-up | R | todo | | |
| 5.3 | Procedural textures and materials | R | todo | | |
| 5.4 | Geometry kit | R | todo | | |
| 5.5 | Instancing service | R | todo | | |
| 5.6 | Puppets: bodies as data | R | todo | | |
| 5.7 | Lights, shadows, atmosphere, sky | R | todo | | |
| 5.8 | Cameras, cutaway, shake | R | todo | | |
| 5.9 | Post-processing | R | todo | | |
| 5.10 | Effects | R | todo | | |
| 5.11 | Capture, ID pass, visual tools, parity | R | todo | | |
| **G5** | **Gate: render core** | | todo | | |
| 6.1 | Level compiler | W | todo | | |
| 6.2 | Navigation and spatial queries | W | todo | | |
| 6.3 | Props library | W | todo | | |
| 6.4 | Generic gameplay kits | W | todo | | |
| 6.5 | Terrain | W | todo | | |
| **G6** | **Gate: world** | | todo | | |
| 7.1 | DSP core | X | todo | | |
| 7.2 | Sound data | X | todo | | |
| 7.3 | Runtime, spatial audio, music | X | todo | | |
| 7.4 | Audio tools | X | todo | | |
| **G7** | **Gate: audio** | | todo | | |
| 8.1 | Input devices, bindings, intents | I | todo | | |
| 8.2 | UI overlay, font, widgets | I | todo | | |
| 8.3 | Full inspector, overlay, routes | I | todo | | |
| 8.4 | Settings panel, tuning, sandbox | I | todo | | |
| 8.5 | Gallery | I | todo | | |
| 8.6 | Bot harness | I | todo | | |
| 8.7 | Performance governor | I | todo | | |
| **G8** | **Gate: input, UI, dev** | | todo | | |
| 9.1 | createEngine, loop, scenes, store, game template | Int | todo | | |
| 9.2 | Sandbox lab | Int | todo | | |
| 9.3 | Stress World benchmark | Int | todo | | |
| 9.4 | Animation Lab | Int | todo | | |
| 9.5 | Library Lab | Int | todo | | |
| 9.6 | Materials, Props, FX, Audio, Cameras, Physics labs | Int | todo | | |
| 9.7 | Labs index, deploy, stamps | Int | todo | | |
| **G9** | **Gate: baseline engine** | | todo | | |
| 10.1 | Tier framework hardening | R2 | todo | | |
| 10.2 | GPU particles | R2 | todo | | |
| 10.3 | GPU-driven crowds | R2 | todo | | |
| 10.4 | Lighting and shading upgrades | R2 | todo | | |
| 10.5 | GPU timing | R2 | todo | | |
| **G10** | **Gate: enhanced tier** | | todo | | |
| 11.1 | MCP server | T | todo | | |
| 11.2 | Skills, subagents, scaffolds complete | T | todo | | |
| 11.3 | Agent-usability evals and mutation testing | T | todo | | |
| 11.4 | Agent eye | T | todo | | |
| 11.5 | Reading edition (optional) | T | todo | | |
| **G11** | **Gate: agent tooling** | | todo | | |
| U-1 | three.js next `.1` upgrade (when due) | R | todo | | |
| U-2 | Rapier 0.21.x deterministic (when due) | P | todo | | |

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
| `engine` §18 Bullets, `E.pattern` | PORT to 3D with swept tests | `engine/world/projectiles.ts` |
| `engine` §19 SpatialHash | PORT | `engine/world/spatial.ts` |
| `engine` §20 audio | REWRITE the synth; COPY the data | `engine/audio/{dsp,data,runtime}/` |
| `engine` §21 UI, §21b backdrops, §21c props | PORT UI and backdrop generators; CONCEPT the props | `engine/ui/`, `engine/gfx/sky.ts`, `engine/world/props/` |
| `engine` §22 WebGPU lighting | CONCEPT (the habits of the tier system) | `engine/gfx/tiers.ts` |
| `engine/my-3d2dge-agent.js` | DROP (its ideas live on in `x docs`) | — |
| `src/stress-world/*`, `src/stress-world.template.html` | Per §5.1 | `engine/{gfx,physics,world}/`, `labs/stress-world/` |
| `src/lab3d/*`, `src/lab3d.template.html` | Per §5.1 | `engine/*`, `labs/sandbox/` |
| `src/free-camera.*`, `src/lab.*`, `src/shapes-*` | DROP | — |
| `src/mocap/*` | Per §5.3 | `engine/anim/clip/`, `data/anim/` |
| `src/mocap.game.js`, `src/mocap.template.html` | REWRITE | `labs/library/` |
| `src/emberdeep/**` | **EXCLUDED** (patterns only, §5.6) | — |
| `src/starter/**` | DROP (the animlab UX informs `labs/anim/`) | — |
| `src/arena.*`, `src/stress.game.js`, `src/stress.template.html`, `examples/scarfrunner-side.html` | DROP | — |
| `src/labs.json`, `src/labs.template.html` | PORT | `labs/` |
| `tools/*` | Per §5.5 and §5.3 | `tools/cmd/`, `tools/lib/`, `tools/anim/` |
| `docs/LAB-3D.md` | Its lessons go into §4 and the ADRs | `docs/decisions/` |
| `docs/MOCAP.md`, `docs/ANIMATION-RESEARCH.md` | PORT | `docs/ANIMATION-LIBRARY.md`, `docs/ANIMATION-RESEARCH.md` |
| `docs/CHARACTERS.md`, `DAN.md`, `CODEX.md`, `CONTROLS-AUDIT.md` | Lessons only | AGENTS.md, ADRs, input docs |
| `docs/assets/*` | DROP | — |
| `vendor/three-0.182.0`, `vendor/rapier3d-simd-compat-0.19.3` | REPLACE | `vendor/three-0.186.1`, `vendor/rapier3d-deterministic-compat-0.19.3` |
| `examples/**`, `dist/**` | DROP (build output) | — |
| `README.md`, `API.md`, `AI_GUIDE.md`, `CHANGELOG.md`, `CLAUDE.md` | REWRITE (generated docs, AGENTS.md, fragments) | — |
| `.claude/**` | PORT | `.claude/` |
| `package.json`, `vercel.json`, `.gitignore`, `.vercelignore` | REWRITE | — |
| `LICENSE` (MIT) | COPY | `LICENSE` |

### Appendix B: Banned and renamed APIs (enforced by `x check`, each message naming its replacement)

**Legacy three.js, banned everywhere in the engine:**

| Banned | Use instead |
|---|---|
| `WebGLRenderer` | `WebGPURenderer` (`forceWebGL` for the WebGL 2 path) |
| `ShaderMaterial`, `RawShaderMaterial` | Node materials and TSL |
| `onBeforeCompile` | Node inputs (`colorNode`, `positionNode`…) |
| `EffectComposer`, `three/examples/jsm/postprocessing/*` | `RenderPipeline` plus TSL display nodes from the allowlisted addons |
| `PostProcessing` | `RenderPipeline` (the alias exists only with a warning) |
| `Clock` | `core/time`, or `Timer` inside `gfx` only |
| `readRenderTargetPixels` (sync), `getImageData`, `readPixels` | `readRenderTargetPixelsAsync`, and only in `engine/gfx/capture.ts` |
| `PCFSoftShadowMap` (WebGPU) | `PCFShadowMap` (soft since r186) |
| `Source` | `TextureSource` |
| `AnimationClip.parseAnimation` | Removed in r185 |
| `InstanceNode`, `SkinningNode`, `MorphNode`, `BatchNode` (as classes) | The TSL functions |
| `positionLocal` inside a skinned or morphed `positionNode` | `positionGeometry` |

**TSL names removed between r182 and r186.** A named import of a removed export is a link error that stops the whole module graph.

| Removed | Use instead |
|---|---|
| `atan2` | `atan(y, x)` |
| `equals` | `equal` |
| `modInt` | `mod(int(…))` |
| `rangeFog(c, n, f)` | `fog(c, rangeFogFactor(n, f))` |
| `densityFog` | `fog(c, densityFogFactor(d))` |
| `storageObject()` | `storage().setPBO(true)` |
| `viewportResolution` | `screenSize` |
| `burn`, `dodge`, `overlay`, `screen` | `blendBurn`, `blendDodge`, `blendOverlay`, `blendScreen` |
| `append` | `Stack` |
| `directionToColor` | `packNormalToRGB` |
| `colorToDirection` | `unpackRGBToNormal` |
| `directionToFaceDirection` | `negateOnBackSide` |
| `TiledLighting` | `DynamicLighting` (Baseline) or `ClusteredLighting` (Enhanced) |
| `PCFSoftShadowFilter`, `scriptable*` | Removed; no replacement |

**Path-scoped: allowed only under `engine/gfx/enhanced/`.**
- **APIs:** `.compute(`, `computeAsync`, `compileComputeAsync`, `storage(`, `StorageBufferAttribute`, `StorageInstancedBufferAttribute`, `IndirectStorageBufferAttribute`, `textureStore`, `storageTexture`, `atomic*`, `workgroupArray`, `setIndirect`, and `instancedArray` or `attributeArray` when compute writes them.
- **One exception.** A file may use them outside `enhanced/` only if it is listed in `BASELINE_COMPUTE` (exported by `tools/lib/rules.mjs`), with a test proving WebGL 2 parity. These are "map" kernels, which the WebGL backend emulates with transform feedback.

**Sim-side bans** (`engine/{core,sim,physics,anim,world}`, `engine/input/intents.ts`, `engine/audio/dsp`; `*.test.ts` files are exempt):
- **Banned:**
  - `Math.random`, `Date.now`, `performance.now`;
  - `setTimeout`, `setInterval`, `requestAnimationFrame`;
  - `document`, `window`, `navigator`;
  - any import of `three`;
  - `AudioContext`.
- **Use `core/dmath` instead:** `Math.sin cos tan asin acos atan atan2 exp log pow hypot cbrt sinh cosh tanh log1p expm1 log2 log10`.

**Everywhere:**
- no binary asset imports or `fetch` of binary assets (law 1);
- no `eval` or `new Function` in the engine.

### Appendix C: Conventions and conversion formulas

**Axes and units.**
- **my-3d2dge's frame:** x east, y south, z up, 16 units per metre. This frame is **left-handed**.
- **my-3dge's frame:** x, y up, z, with x × y = z (right-handed).
- **Positions, velocities and accelerations:** `new = (x, z, y) / 16`. Swapping y and z converts the handedness.
- **Facing.** The old rig's `facing` φ has forward = (cos φ, sin φ) on the ground plane (`engine:1810`). The new yaw is ψ = π/2 − φ, with forward(ψ) = (sin ψ, 0, cos ψ) and right = forward × up.
- **Mocap's (f, r, u) frame** maps to f→+Z, r→−X, u→+Y. That is one reflection; prove it with an asymmetric clip.

**Character controller and level constants** (`stress-world/20-sim.js`, `10-hall.js`):

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
| Character mass for push impulses | 2,500 | Re-tune in WP 2.2. Mass doesn't depend on the length unit, but the impulse response does |

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

**Move fields, old to new.** Confirm every unit against `engine:1842-1986` in WP 3.4.

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
| `crouch`, `lean`, `twist` | `body.crouch`, `body.lean`, `body.twist`, units confirmed in WP 3.4 |
| `hold` (share of recover) | `time.hold` |
| `wind`, `active`, `recover` (seconds) | `time: { wind, active, recover }` |
| `hitAt` | `hitAt`, a property of the move: 0.35 by default **for every move**. This fixes the old difference between building from a name and from a spec |
| `blade: 0` | `trail: false` |

### Appendix D: Numbers from the prototype (baselines and budgets start here)

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
| Proof hashes | `1917b7b9` (lab3d) and `68e1f7d1` (stress-world), the same on both backends (measured during this study; not recorded in the source) |

**Node** (two runs in the cloud container; the numbers depend on the machine)

| Measurement | Value |
|---|---|
| Engine load | 9–14 ms |
| 600 Humanoid steps | 21–30 ms |
| Lints over 24 moves | 0.28 s |
| Rapier init | 84–106 ms |
| 40 bodies × 600 steps | 78 ms |
| lab3d proof | 27 ms in Node; 130 ms cold or 35 ms warm in the browser |

**Tests and tools**
- The full suite took about 25 minutes; the lab3d test 65–81 s.
- 35 tool files (343 KB) and 26 npm scripts.
- Browser launch copied 19 times, the server 4 times; about 20 tools parse their own arguments.
- About 310 KB of docs prose.

**Libraries**

| Library | Size |
|---|---|
| three r182 builds | core 381 KB, webgpu 616 KB, tsl 23 KB (all minified) |
| Rapier 0.19.3 | 2.31 MB (0.86 MB gzipped) |
| three r186 webgpu build | 2.28 MB unminified (447 KB gzipped) |
| Rapier 0.21 | 4.37–4.62 MB (1.66 MB gzipped) |

**The platform (October 2026)**
- WebGPU reaches 83.3% of devices and WebGL 2 97.8% (web3dsurvey). By group: Linux 17.8%, Firefox 60.4%, Android 73.6%.
- `float32-filterable` is present on 53.8% of iOS devices.
- Current versions:

  | Package | Version (date) |
  |---|---|
  | three | r186.1 (2026-09-24) |
  | Rapier JS | 0.21.0 (2026-09-25) |
  | TypeScript | 7.0.2 (2026-07-08) |
  | Playwright | 1.64.0 (2026-10-07) |
  | `@types/three` | 0.186.0 |
  | Node in the cloud image | 22.22.0 |

### Appendix E: Draft `AGENTS.md`

```markdown
# AGENTS.md: rules for every change to my-3dge

my-3dge is a fully 3D web game engine written and maintained only by AI agents. Start at docs/INDEX.md (generated);
the plan and its ledger are PLAN.md. The game is not here and never will be.

## The five laws (each has a check)
1. Everything is code: no binary asset files; readable data records its source and license.   → x check (asset scan)
2. Small and legible: one concept per file, ≤ 400 lines (hard 600), a manual header, TypeScript erasable syntax.
                                                                                           → x check (caps, headers, tsc)
3. AI-native tooling: drive and question the engine through `node x` and __engine; every kind has a scaffold.
                                                                                           → scaffold self-tests in CI
4. Inspect and test: the sim is deterministic and runs headless; add the cheapest test that proves your change.
                                                                                           → x unit, x replay, x test
5. The GPU never decides gameplay: sim-side code never imports gfx, three, the DOM or Web Audio; WebGPU-only features
   live in engine/gfx/enhanced with a fallback and never change the ID pass or the hash.  → x check (layers), x test parity

## The loop
1. Read your WP in PLAN.md §9 (with its Needs), the sections it cites, and the headers of the modules you touch (not whole
   files). The source being ported is read-only at $MY3D2DGE_SRC (node x src).
2. Edit. The after-edit hook runs a fast check: fix what it reports.
3. node x check (< 10 s) → node x unit (< 60 s) → node x test --changed (< 6 min).
4. Read out/**/report.json. Open images only when a metric points at one (use the visual-reviewer subagent).
5. Add a fragment in changes/. Update the ledger row in PLAN.md §14 (in ultracode lanes, report it to the integrator).
6. Commit "<area>: <what> (WP-x.y)". Report the version, the commit and the report paths.

## Rules
- SI units, +Y up, characters face +Z. Gameplay time is in 60 Hz sim ticks. Randomness comes from named streams.
- Sim-side code (core, sim, physics, anim, world, input/intents, audio/dsp): no Math.random, Date.now, performance.now,
  timers, DOM, three or Web Audio, and no engine-dependent Math functions (use core/dmath).
- Never edit vendor/, out/ or site/ by hand. Upgrades are their own work packages (x vendor).
- Never skip, disable or loosen a test to get green. Baselines change only with a written reason.
- Never fall back silently: every downgrade emits an advice code.
- Ask the entry, never the id: shared code reads registry hooks and never compares ids.
- No game content: fixtures are minimal and neutral (PLAN.md §5.7).
- Docs are generated from headers: never restate a fact in prose (x docs --check).
- Blocked by the core? Write the smallest core change as a proposal in your WP notes. Don't widen your WP.
- Say plainly what you did not verify (devices, browsers, network).

## Done means
Verify commands green; x check and x unit green; T2 green on both backends for what you touched; headers and docs current;
gallery, lints and scaffold for new kinds; changelog fragment; verifier review clean; no new advice codes; ledger updated.

## Where things are
engine/ (code + unit tests) · data/ (readable data) · fixtures/ · labs/ · tools/ (x commands) · tests/ (browser,
replays, baselines) · docs/ (generated INDEX/API/ERRORS, ADRs, guides) · vendor/ (pinned libraries) · changes/
```

### Appendix F: Glossary

| Term | Meaning |
|---|---|
| **Baseline tier** | The features that run on every backend (WebGL 2, WebGPU compat, WebGPU core). It must show everything gameplay needs |
| **Enhanced tier** | WebGPU core. Speed and visual extras only, each with a fallback, owned by the governor |
| **Sim-side** | Deterministic, renderer-free code that runs in Node: `core`, `sim`, `physics`, `anim`, `world`, intents, `audio/dsp` |
| **Presentation** | Code that draws or plays: `gfx`, the audio runtime, `ui`, the input devices |
| **View state** | Presentation-only state (cape chains, particles, camera shake). Never in the gameplay hash |
| **Intents** | The per-step input to the sim (move, camera heading, aim, buttons). They are recorded in replays |
| **Body states** | The words behaviours send to a body each step (`pose`, `stance`, `attack`, `air`, `dash`, `hurt`…). Bodies ignore words they don't know. Not to be confused with input intents |
| **Replay** | A seed plus per-step intents, with expected hashes at checkpoints |
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
| **Bake** | Converting a readable clip into rotation tracks for the runtime |
| **Lens** | A read-only normalized view of a clip's angles |
| **WP** | A work package: an independently verifiable unit of work |
| **Lane** | A sequence of WPs owned by one stream of work |
| **Gate** | The set of checks that ends a phase |
| **Advice code** | A stable id for a warning, with a fix and a docs link |
| **Ledger** | §14, the record of what is done |
