# Research A: `src/stress-world/`, the real-3D world runtime

Source repo: `/home/user/michaelcrosato/my-3d2dge` (v0.14.0). Paths are relative to that repo, and line refs are given as `file:line`.
Files read in full: `src/stress-world/{00-setup,10-hall,20-sim,30-crowd,35-effects,40-cameras,45-filters,50-frame,60-panel}.js`,
`src/stress-world.template.html`, `tools/stress-world-test.mjs`, the relevant parts of `tools/build.mjs`, `docs/LAB-3D.md`, `CLAUDE.md`.
I also read these parts of `engine/my-3d2dge.js`: View/VIEWS, Input, Particles, Humanoid (posing and draw entry), Attack/Combo/MOVES, Blob, tex. I read
the r182 `InstanceNode` code in `vendor/three-0.182.0/three.webgpu.min.js` to confirm the instancing bug. I looked briefly at
`src/lab3d/` for comparison: the puppet data format and the camera height boost.

---

## 0. Summary for decisions

- **What it is.** This is the most complete real-3D code in the repo. It has 9 files, 2,574 lines and about 55K tokens of dense JS, plus a
  7K-token HTML template. They are built into one page, `examples/stress-world.html` (591 KB, of which 374 KB is the 2D engine, inlined
  whole). It runs three.js r182 `WebGPURenderer` (WebGPU, or WebGL 2 by itself) and Rapier 0.19.3 SIMD, both vendored and loaded through an
  import map. The page itself is a lab: a torch-lit hall written as ASCII, a hero driven by a character controller, and 0 to 5,000
  monsters as Rapier bodies. Characters are drawn as Cards (2D sprites from the engine) or Puppets (instanced 3D parts on the rig
  joints). It also has 5 camera families, TSL post filters, a benchmark and `window.__sw`.
- **Worth carrying over (engine-grade):**
  1. The discipline of keeping the sim apart from the renderer, with a scripted proof run and an FNV hash that is identical on WebGPU
     and WebGL 2.
  2. The text-level compiler. ASCII becomes floor and top heights, a nav grid that knows about height (one-way ledges, gentle slopes),
     a Dijkstra flow field, Rapier colliders (greedy merged boxes and convex hulls), meshes and baked procedural textures.
  3. The Rapier crowd pattern: the AI sets each body's velocity and the solver separates the crowd. The character controller config
     comes with it.
  4. The instanced primitive `Batch` (tube, ball, box, cone), with TSL inverted-hull outlines and 3-band toon shading.
  5. The pipeline-stall discipline: warm-up, a fixed light count, fixed atlas pages, and the workaround for the r182 InstancedMesh bug.
  6. Post filters in TSL (cel, pixel/dither, bloom, FXAA) with an MRT object mask.
  7. The camera rig suite and its serialization as links.
  8. The headless WebGPU test harness: SwiftShader, a stand-in canvas context, frame readback, a pipeline counter and a lint for
     banned APIs.
- **Structural problems that block reuse as-is:**
  - One shared lexical scope for 322 top-level declaration statements across 9 files, with no imports and with forward and circular references.
  - The sim cannot run without a browser and a GPU. `00-setup` does `await renderer.init()` first, and `10-hall` builds meshes and
    textures at load.
  - The live loop is **not** fixed-step: it substeps to at most 1/60.
  - Several renderer-to-sim leaks: camera direction as an AI input, the LOD set from culling, and `rig.draw()` mutating rig state.
  - Cards drag in the entire 2D drawing engine.
  - Puppet bodies are code, not data. The lab3d data format was dropped.
  - Lines of 200 to 318 characters, one-letter globals, and hand-written axis swizzles in every draw function.
- **Recommendation: port the techniques and rewrite the structure.**
  - Use real ES modules.
  - Make `sim/` importable in Node, with a golden-hash test that needs no browser.
  - Use a true fixed-step accumulator with interpolation and recorded input frames.
  - Drive the level from a legend instead of hard-coded glyph cases.
  - Make puppet bodies data, rendered through `Batch`.
  - Add a pipeline warm-up registry and a generic `__engine` devtools API.
  - Drop Cards, the hand-built panel and the 2D engine dependency, keeping only the animation system. Keep the stress hall as a
    sample, benchmark and test scene.

---

## 1. Architecture

### 1.1 How the page is assembled (`@inline-module`)

`tools/build.mjs:87-91` replaces `<!-- @inline-module src/stress-world -->` with **one** `<script type="module">`. That script holds every
`.js` file in the folder, **sorted by name and concatenated**. Because of this:

- The parts share one lexical scope. The imports must sit in the first part (`00-setup.js:33-35`).
- Order is the dependency mechanism, via the name prefixes 00 to 60. A name used before the part that declares it has run is a TDZ
  error.
- Top-level `await` in `00-setup.js:68` (`renderer.init()`) and `20-sim.js:26` (`RAPIER.init({})`) blocks all later parts.

The template (`src/stress-world.template.html:104-113`) holds an import map with local paths only:

```json
"three": "/vendor/three-0.182.0/three.webgpu.min.js", "three/webgpu": "...three.webgpu.min.js",
"three/tsl": "/vendor/three-0.182.0/three.tsl.min.js",
"@dimforge/rapier3d-simd-compat": "/vendor/rapier3d-simd-compat-0.19.3/rapier.js"
```

It inlines the whole 2D engine as a classic script before the module (`:332`, `<!-- @inline engine/my-3d2dge.js -->`), which the module
reads as `window.My3D2dge` (`00-setup.js:37`). The page must be served (ES modules and an import map), not double-clicked. The Vercel
rewrite in `vercel.json:12` maps `/stress-world` to `/examples/stress-world.html`. The vendored payload is three at about 1.0 MB minified
and Rapier at 2.3 MB (its wasm is embedded as base64).

### 1.2 Modules

| File | ~tokens | Responsibility | Key symbols (`file:line`) |
|---|---|---|---|
| `00-setup.js` | 2.4K | imports, units, renderer, shared helpers and materials | `U=16`, `STEP=1/60`, `OUTLINE` (:39-41); `fail()` (:44-51); `toThree()` (:53); `lin()` (:56); `hashNumbers()` (:58-63); renderer (:66-76); `bake()` (:80-89); `TOON_BANDS` (:91-95); `objMat()`/`OBJ_MATS`/`OBJ_MRT` (:98-99); `OUTLINE_PX`, `outlineMat()` (:102-116) |
| `10-hall.js` | 9.4K | the level as text and everything derived from it, plus lights | `LEVEL` (:22-67); heights (:68-69); `tile`/`solidTile` (:70-71); `WT` (:73-77); `rects()` (:81-91); `DAIS` (:94-99); `floorH`/`topH` (:104-115); `TORCHES` (:117-124); `PASS` (:129-142); `FLOW` (:145-178); `hallColliders()` (:188-201); textures (:204-248); `boxGeo`/`sidesThenTops`/`inst` (:253-264); `FLOOR_MAT` (:269-288); walls and `placeWalls` (:302-324); pillars, `placePillars`, `segBox` (:336-370); galleries and stairs (:373-390); dais (:393-405); braziers (:409-433); `LIGHT`, `lightHall` (:436-466) |
| `20-sim.js` | 11.8K | the game on Rapier: settings, hero, monsters, combat, AI, waves, props, shots, particles sim, step, hash, proof | `S` (:27-28); `GROUPS` (:31-33); `SIM` (:34); particles (:42-54); cast data (:57-102); `HIT`, `SPEED`, `JUMP` (:108-114); `SIM.reset` (:118-138); props (:141-171); monsters (:174-222); spatial hash (:225-233); attack tokens (:236-241); `heroIntent` (:242-282); `moveHero` (:290-301); `damageEnemy` (:324-342); AI (:346-451); `shotsStep` (:463-477); `storm` (:479-495); `readBack` (:498-516); `animate` (:528-553); `SIM.step` (:557-577); `SIM.hash` (:579-584); `SIM.run` (:587-603) |
| `30-crowd.js` | 8.5K | characters as Puppets (instanced parts) or Cards (atlas), capes, props, blob shadows | `Batch` (:20-67); `BATCH` (:68-77); `frame`/`wp` (:80-89); `humanParts` (:98-138); `slimeParts` (:140-161); `wispParts` (:164-170); `CAPE` (:173-203); `ATLAS` (:205-290); `drawProps` (:316-329); `shadowAt` (:335-338); `drawCrowd` (:342-373) |
| `35-effects.js` | 3.1K | telegraphs, rings, trails, bolts, particle quads, 2D overlay | `floorPool` (:15-43), `ARCS`/`RINGS` (:44); `RIBBONS` (:46-71); `PART` (:74-78); `drawEffects` (:88-130); `drawOverlay` (:133-148) |
| `40-cameras.js` | 7.7K | camera modes, the three camera, culling, wall and pillar cutting, camera-relative controls, keys and mouse, links | `CAM` (:32-41); `viewPose`/`railPose`/`chasePose`/`firstPose`/`flyStep`/`cameraPose` (:60-117); `placeCamera` (:123-148); `visible`/`project`/`cardView` (:150-163); `placeCut` (:166-181); `INPUT` (:185-188); `mouseOnFloor` (:191-198); `controls()` (:204-218); `setCam`/`toggleFix`/... (:222-264); `camLink` (:274-288); `?cam=`/`?cam3=` parsing (:325-338) |
| `45-filters.js` | 3.2K | TSL post-processing and the MRT mask | TSL destructuring (:20); `FX`/`UF` (:21-29); `post`, `scenePass`, MRT (:30-35); `celLook` (:42-56); `pixelLook` (:57-68); `bloomOf` (:70-80); `fxaa` (:82-93); `buildFX` (:96-103); `tagMaterials` (:106-109); `renderFrame` (:113-127) |
| `50-frame.js` | 1.9K | resolution, warm-up, one frame, the loop | `R3`, `SCR` (:13-15); `fit()` (:18-28); `warmUp()` (:32-47); `STATS` (:48); `drawFrame()` (:51-76); `tick()` (:80-90) |
| `60-panel.js` | 6.9K | DOM panel, HUD, presets, benchmark, start, `window.__sw` | `hud()` (:51-74); `syncUI()` (:90-118); `PRESETS` (:159-165); benchmark (:205-263); start (:273-277); `stepN` (:279-283); `__sw` (:284-286) |
| template | 7.1K | DOM, CSS, import map, panel markup | three canvases: `#view` (three), `#over` (2D overlay), `#screen` (input surface) (:117-118) |
| `tools/stress-world-test.mjs` | 5.4K | static rules and headless browser checks | see §8 |

### 1.3 Data flow per display frame

`tick(now)` (`50-frame.js:80-90`):

1. It calls `requestAnimationFrame(tick)` **first**, so a thrown error never stops the loop. Errors go to `fail()`, which writes
   `__sw.error` and shows the message on the page.
2. `dt = clamp(Δt, 0, 0.05)`, `steps = max(1, ceil(dt/STEP - 1e-6))`, `h = dt/steps`. Note that this is **variable** substepping, not a
   fixed step (§2.2).
3. Each step runs `INPUT.tick(h)`, then `SIM.step(h, controls())`:
   - `INPUT.tick` belongs to the engine's `E.Input`. It polls the gamepad, turns presses into edge sets, and advances the input clock in
     sim time.
   - `controls()` (`40-cameras.js:204-218`) turns the input into camera-relative ground motion. It produces the aim from the mouse ray
     onto the hero's floor plane, from the pad's right stick, or from the yaw under pointer lock. It also produces `cam`: the ground
     direction toward the camera and the cosine of its pitch.
   - `SIM.step(dt, ctl)` (`20-sim.js:557-577`) runs:
     - `SIM.real += dt`. During hitstop it returns early.
     - Otherwise `SIM.time` and `SIM.n` advance.
     - `rebuildGrid()` rebuilds the spatial hash.
     - `heroIntent` handles timers, the cheer and wave respawn, death and respawn, dash, jump, combo or thrust, bolts and facing, and
       calls `moveHero`, which runs the character controller and `setNextKinematicTranslation`.
     - `enemiesIntent` moves the dead to the corpses, detects a cleared wave, updates `FLOW`, counts attack tokens and runs the AI for
       each monster type, which calls `setLinvel`.
     - Then `corpsesStep`, `shotsStep` and `storm`.
     - `world.timestep = dt; world.step()`.
     - `readBack` copies body positions and velocities into the entities and sets a grounded heuristic.
     - `animate` poses every rig from entity state.
     - `P.update` moves the particles, which land on `topH`.
     - Timing is split into physics and logic.
4. `drawFrame(dt)` (`50-frame.js:51-76`):
   - `fit()`.
   - `cameraPose(dt)`. Fly-camera movement integrates here, in frame time.
   - `placeCamera()` sets up the ortho or perspective camera, shake, card axes `CV`, card pixel scale, outline pixel size and frustum.
   - Fog near and far are set relative to the hero.
   - `placeCut()` re-lays the instanced walls and pillars, but only when its key changes.
   - `lightHall()` sets torch intensities and flicker and moves the two shadow casters. Then `animateBraziers()` runs, and the hero and
     wisp lights are set.
   - `cardView()` runs. On the first frame, or after a filter change, `warmUp()` runs.
   - `drawCrowd()` culls, then either draws cards into the atlas or puts puppet parts into the batches, plus capes and blob shadows. It
     then sets `VISIBLE = SEEN`, which goes back to the sim (§2.3).
   - `drawProps()` and `drawEffects()`.
   - `renderFrame(cam)` either calls `renderer.render` directly or runs the `PostProcessing` graph.
   - `drawOverlay()` draws the 2D canvas text, and `STATS` is updated.
5. `hud()` (`60-panel.js:51-74`) updates the EMA timings, the graph and the DOM metrics (every 250 ms), and feeds the benchmark.

### 1.4 Shared-scope coupling (what an agent cannot see from a file header)

I computed a symbol cross-reference. `50-frame` uses names from all 8 other parts. `40-cameras` and `60-panel` depend on each other:
`setCam` calls `syncUI`, and the panel calls `setCam`. Writes cross files:

- `45-filters.js:115,117` assigns `warmed`, which is declared in `50-frame.js:29`.
- `45-filters.js:107` assigns `OBJ_MRT`, declared in `00-setup.js:98`.
- `50-frame.js:68` assigns `VISIBLE`, declared in `20-sim.js:520`.
- The first-person camera uses the puppet helpers `frame`/`wp` from `30-crowd` (`40-cameras.js:98`).

`45-filters.js:20` destructures 21 TSL functions **into the shared scope**:
`const { pass, mrt, output, rtt, float, vec2, vec3, vec4, uv, uniform, floor, mod, abs, max, min, mix, select, smoothstep, luminance, saturation, sRGBTransferOETF } = TSL;`.
After that, `floor`, `max`, `min`, `mix`, `abs` and `select` in any later part are GPU node builders. If any part declares one of these
names at top level, the whole page dies with a SyntaxError.

Shadowing is common, and the names it hides are global:

- `H` is `E.hex` (`10-hall.js:222`). It is also the heap (`10-hall.js:153`) and the screen height in parameters.
- `P` is the particle system (`20-sim.js:42`). It is also the pillar-part loop variable (`10-hall.js:344`), the atlas page size
  (`30-crowd.js:216`) and `WOOD` (`30-crowd.js:294`).
- `near()` is the spatial query (`20-sim.js:227`), and `let near` is the shadow list (`10-hall.js:452`).
- `T` (tile, 16 units) and `U` (units per metre, 16) are the same number under two names.

---

## 2. The sim/render boundary and determinism

### 2.1 How gameplay is kept apart from the renderer

- **The contract** (`20-sim.js:1-25`) is "`SIM.step(dt, ctl)` never reads the renderer". `ctl` is
  `{ move:[x,y] ground dir (len 0..1), aim: angle|null, pressed(action, window), use(action), cam:[fx, fy, k] }` (`20-sim.js:17-20`).
  All gameplay state is plain JS objects (`hero`, `enemies`, `corpses`, `shots`, `PROPS`) plus the Rapier world. Rendering reads them
  and never writes them, with the exceptions listed in §2.3.
- **Hits are computed without physics queries or GPU work.** They are 2D cones (`E.inArc`) with a height window
  (`inArc3`, `20-sim.js:233`: `|Δz| < 24`), found through a spatial hash (`GC = 12` units, `:225-231`). Shots are ballistic in JS and
  are stopped by `topH()`.
- **Seeded randomness.** `SIM.rnd = E.rng(seed)` is set in `SIM.reset` (`:122`). `E.rng` is a mulberry32-style generator
  (`engine/my-3d2dge.js:85`). It is used for spawns, monster types, timers, attack choice, wander targets, prop torque and the rescue of
  lost bodies. The static layouts use their own seeds: torch order with `E.rng(9)` (`10-hall.js:120`) and prop spots with `E.rng(21)`
  (`20-sim.js:142`). Note that `SIM.rnd` starts as `Math.random` (`:34`) until the first reset.
- **The state hash.** `hashNumbers(list)` (`00-setup.js:58-63`) is FNV-1a over the **float32 bit patterns** of each number. `SIM.hash()`
  (`20-sim.js:579-584`) hashes `[SIM.n, SIM.wave, hero.x, hero.y, hero.z, hero.hp, …each enemy x,y,z,hp, …each prop x,y,z]`.
- **The proof**, `SIM.run(n = 600)` (`:587-603`):
  - It saves `S`, forces `{ mix:'balanced', skin:'mixed', behavior:'swarm', props:16, god:true, launch:true, iters:4, capes:false, lod:false }`,
    then calls `reset(7)` and `setMonsters(40, true)`.
  - The hero walks a square around the dais and changes target every 120 steps. Presses follow a timetable: attack when `i%24===12`,
    dash at `i%150===75`, jump at `i%200===130`, skill at `i%90===40`. Each step is exactly `STEP`.
  - It returns `SIM.hash()` and restores `S`.
  - `__sw.run` (`60-panel.js:285`) then calls `reset(1)` and respawns. Despite the comment at `20-sim.js:586`, `SIM.run` alone does not
    restart the live game.
- **What uses `Math.random`, and why it only affects looks:**
  - `storm()` (`20-sim.js:487-492`), the panel's particle storm.
  - All of the engine's particle emitters: `dust`, `sparks`, `bits`, `glints`, `impact`, `text` (`engine:1006-1019`).
  - `Humanoid`'s idle phase `this.t = Math.random()*10` and its blink timer (`engine:1782, :1831`).

  These only affect looks for three reasons. Particles are never read by the sim. Rig poses reach the sim in only one place,
  `strikePt(rig)`, which places the `P.impact` spark (`20-sim.js:375`). And the move measurement at load forces `rig.t = 0`
  (`20-sim.js:91`), so `k.stand` and `k.reach` are the same on every run.

### 2.2 The fixed step is only fixed in the proof

`LAB-3D.md:30` says that gameplay "runs on the CPU at a fixed 60 Hz". In fact the live loop runs `ceil(dt/STEP)` **equal substeps of
`dt/steps`** (`50-frame.js:83`):

- At 144 Hz each step is 1/144 s and Rapier's `timestep` changes to match.
- At 50 fps the game takes two steps of 1/100 s.
- Below 20 fps, `dt` is clamped to 0.05 and the game slows down.

So live play depends on the frame rate and cannot be reproduced. Only `SIM.run` and `__sw.step` use exactly `STEP`. There is also no
input recording, so a bug seen in live play cannot be replayed.

### 2.3 Leaks and risks across the boundary

1. **The camera is a gameplay input.** `ctl.cam` makes walkers wait further back (`ring + 20*front`) and attack less often
   (`cool <= -2*front`) on the camera's side (`20-sim.js:379-383`). The hero also faces the camera while cheering (`:278`). This is
   deterministic only if the camera is recorded with the inputs. The proof fixes it at `[0,1,.5]`.
2. **Renderer culling feeds the sim.** `VISIBLE = SEEN` (`50-frame.js:68`) makes `animate()` skip off-screen rigs when `S.lod` is on
   (`20-sim.js:538`). It only affects looks today, and the proof turns `lod` off, but the dependency points the wrong way.
3. **Drawing mutates rigs.** `Humanoid.draw()`, used for Cards, writes `_pitch`, `_cheat`, `_camSide` and `_lastView`
   (`engine:2087-2093`). `_pitch` then chooses `sidePlane` in the next `update()` (`engine:1838`), which changes the swing geometry,
   `J`, `tip()` and the trail. `_cheat` rotates `_w()`, and so changes `hand()`, `tip()` and `head()`. Today only the impact spark reads
   these, and the puppet path resets `_cheat = 0` (`30-crowd.js:358`). But an agent who uses `rig.tip()` for hit detection, which is a
   natural thing to do, would make gameplay depend on the view.
4. **Cosmetic systems hold gameplay callbacks.** The particle system is built with the sim's `freeze` and `shake`
   (`20-sim.js:42`). `P.explosion()` (`engine:1031`) would add **hitstop** from a cosmetic call. It is not called today.
5. **The hero rig survives `reset`** (`if (!hero.rig)`, `20-sim.js:136`), as do `numCol` and `emitAcc`. They affect looks only today, but
   this is hidden state across runs.
6. **The hash is weak.** It leaves out velocities, rotations (`p.q`), corpses, shots, attack phases, timers and the RNG state. Through
   float32 rounding it also misses differences below about 1e-7 relative. Divergence in velocity or rotation can stay hidden for a
   while.
7. **Determinism is scoped to one browser engine.** The proof compares WebGPU and WebGL 2 in the same Chromium, so it proves the result
   does not depend on the renderer. It does not prove the result is the same across machines or browsers:
   - JS `Math.sin/cos/atan2/exp/hypot` may differ between engines.
   - The Rapier package is the SIMD build, not `rapier3d-deterministic`.
   - There is **no stored golden hash**, so a deterministic change to gameplay passes silently.
8. **Hidden dependencies on Humanoid internals.** `k.stand` and `k.reach` are measured with `rig.t = 0` (`20-sim.js:91`), and
   `humanParts` copies `_drawHD` sizing and `_w` math (`30-crowd.js:82-88`). If the rig changes, both drift silently.
9. **The claim of "no renderer" is untested.** The claim is "the same state and the same hash on WebGPU, WebGL 2 **or no renderer**". The
   sim cannot actually be loaded without the browser: `00-setup` initialises the renderer before anything else, and `10-hall`, which the
   sim needs for `floorH`, `topH`, `FLOW` and `hallColliders`, creates meshes, canvases and textures at load.

---

## 3. Physics (Rapier 0.19.3 SIMD)

**Units.** The engine's units are used throughout, with z up. 16 units = 1 m = 1 tile (`U`, `T`). Rapier's `world.lengthUnit = U`
(`20-sim.js:121`), which scales its internal tolerances. Gravity is `{x:0, y:0, z:-480}` (`:29`, `:120`). That is 30 m/s², about 3 g,
"the 2D slimes' own cartoon gravity". three.js gets metres with y up, but only at the drawing edge: `toThree(x,y,z) = (x/U, z/U, y/U)`
(`00-setup.js:53`). Note that this swap is a **reflection**, so rotations must be negated (§5.10).

**Collision groups** (`20-sim.js:31-33`), with `ig(member, filter) = member<<16 | filter`. A pair collides when each one's filter
includes the other's membership:

```js
world: ig(1, 0xffff), prop: ig(2, 1|2|4|8|32), hero: ig(4, 1|2|8), mob: ig(8, 1|2|4|8), wisp: ig(16, 1|16), dead: ig(32, 1|2)
HERO_QUERY = ig(4, 1|2)   // the controller steers round world + props only; monsters are shoved by the kinematic body
```

**The hero** is a kinematic position-based capsule, `capsule(HERO_HALF=9, HERO_R=4.5)` (27 units, about 1.7 m tall). It is stood up
with `Z_UP = {x:√½, y:0, z:0, w:√½}`, because Rapier's capsules and cylinders lie along y (`10-hall.js:181`). Its controller
(`20-sim.js:129-131`):

```js
const cc = world.createCharacterController(.3);                 // skin offset, units
cc.setUp({x:0,y:0,z:1}); cc.enableSnapToGround(4); cc.enableAutostep(4, 2, false);
cc.setMaxSlopeClimbAngle(50*Math.PI/180); cc.setSlideEnabled(true);
cc.setApplyImpulsesToDynamicBodies(true); cc.setCharacterMass(2500);
```

`moveHero` (`:290-301`) works like this:

- It integrates `vz -= 480*dt` (capped at -600).
- It calls `computeColliderMovement(col, {vx*dt, vy*dt, vz*dt}, EXCLUDE_SENSORS, HERO_QUERY)` and reads `computedGrounded()`.
- It zeroes `vz` on the ground or on a head bump, using the test `m.z < vz*dt*.5`.
- Then it calls `setNextKinematicTranslation(p + m)`, and `world.step()` carries the move out.
- Readback snaps the feet to `floorH` within 1.5 units (`:501`).
- There is a small mismatch: bodies are placed at `+HERO_FOOT + .4` but read back with `- HERO_FOOT - .3` (`:127` vs `:500`).

Movement numbers: `SPEED=80` u/s (5 m/s). Acceleration is 900 u/s² on the ground and 420 in the air. Speed drops to 25% while
attacking. A dash lasts 0.2 s at 260 u/s, easing out. `JUMP=150` u/s gives an apex of about 23 units, which clears low walls (12) and
gallery edges (16). Stairs and the dais are ramps, so autostep (4 units) is not used on them.

**Monsters are dynamic bodies** (`makeBody`, `:174-181`):

- `lockRotations()`, `setCanSleep(true)`.
- Shapes: walkers `capsule(8, r)` with r = 5 (knights 6); slimes `ball(6)`; wisps `ball(5)` with `setGravityScale(0)`.
- Friction 0 with `CoefficientCombineRule.Min`, restitution 0, density 1. Since density is 1, a walker's mass is about 1,780 units.
- **The AI sets velocity**: each step it calls `setVel()`, which is `body.setLinvel(…, true)` and so wakes the body, with an
  approach-limited acceleration of 500 u/s², or 160 while stunned. The solver separates the crowd. There is no separation code, and with
  zero friction bodies slide past each other.
- Monsters steer only when `grounded`. That is a velocity heuristic with no contact query: `|vz|<6 && (z-floorH<2 || |vz-pvz|<1)`
  (`:507`).
- Wisps hover with a spring, `vz = (floorH + 20 + 3 sin(2t) - z)*6` (`:427-428`).
- Slimes hop ballistically. The hop has `vz` 150 and a pounce has 85, with the horizontal speed set to `len/airTime`. Landing is
  detected heuristically (`:396`).
- A body that falls below z -60 or leaves the hall is put back on a random floor tile (`:508-510`).

**Knockback and launches** (`damageEnemy`, `:324-342`):

- Knockback adds `kb` to `e.vx/vy`: 130 for slashes, 230 for the spin, 220 for the thrust, 70 for bolts. Then it calls `setLinvel`.
  This is **velocity-level knockback that the AI's approach decays**, not true momentum. It is stunned for 0.22 s.
- A big hit with `S.launch` sets `vz ≥ 70`.
- A killing blow sets `vz ≥ 170`, or 95 if it was not big, and multiplies the horizontal velocity by 1.3. The collider then switches to
  the `dead` group with friction 0.9 and `Average`. Corpses slide to a stop (300 u/s²) and are removed after 1.6 s, or 0.35 s for wisps.
  At most 300 corpses are kept.
- An airborne monster drops its swing (`:387`).
- Hitstop comes from `freeze(t)`: `SIM.step` returns early and the world does not step. Screen shake decays in real time.

**Props** (`:141-171`):

- There are 0 to 300 dynamic crates, `cuboid(6,6,6)`, and barrels, `cylinder(7,6)` with `Z_UP`.
- Their spots are seeded once, and every fifth crate is stacked on the one before.
- They use density 0.5, friction 0.7, restitution 0.05, linear damping 0.3 and angular damping 0.8.
- `knockProp` applies an impulse of `mass*dv` plus a torque impulse around a perpendicular axis, with a random z part from `SIM.rnd`.
- Swings knock props that are in an arc and within a height window. Bolts knock them with a 9-unit AABB test. The hero's controller
  pushes them through applied impulses (character mass 2500 against a crate's 864).

**Hall colliders** (`hallColliders`, `10-hall.js:188-201`):

- One fixed body.
- A floor slab from z -16 to 0.
- **Greedy merged boxes** (`rects()`) for `#`, `P` and `w` at their heights, and boxes from 0 to 16 for galleries.
- A **convex-hull wedge** for each staircase and a convex-hull **octagonal frustum** for the dais.
- Cylinders for the braziers.
- Friction 0.6 throughout.

**Solver.** `numSolverIterations = S.iters` (default 4, range 1 to 8 on the panel), re-applied each step (`20-sim.js:570`).

**Performance** (headless Chromium, from `LAB-3D.md:253-255`):

| Monsters | Game cost per step | Physics share |
|---|---|---|
| 100 | about 1 ms | |
| 1,000 | 5.6 ms | 2.6 ms |
| 5,000, crowding the hero | 33 ms | 21 ms |

The panel's metrics and the benchmark split the CPU into physics, logic and drawing.

**Pitfalls to carry forward:**

- Rapier's capsules and cylinders lie along y. A z-up world needs `Z_UP` rotations everywhere. A y-up sim would avoid this.
- `lengthUnit` must match the scale of the world.
- The hero cannot be body-blocked by monsters: they are excluded from the controller's query.
- `setLinvel` every step overrides what the solver resolved, so knockback has to live in the AI's velocity state.
- Waking every step (`setLinvel(…, true)`) means that only frozen crowds ever sleep.
- Grounded detection for dynamic bodies is a heuristic.
- `world.free()` must be called on reset; it is done at `:119`.
- Rapier gives no contact events here: every gameplay hit is computed analytically.

---

## 4. World authoring: the ASCII hall

**The format** (`10-hall.js:2-6`, `22-67`) is a 64 × 44 grid, one character per 1 m tile. Row 0 is the north wall. Tiles outside the
grid read as `#` (`tile()`, `:70`).

| Glyph | Meaning | Height (units) | Solid? | Collider | Mesh |
|---|---|---|---|---|---|
| `#` | wall | `WALL_H=48` (3 m); cut-away twin `CUT_H=7` | yes | merged box | instanced box per tile, sides and tops in two draw groups |
| `P` | pillar (2×2 tiles) | `PILLAR_H=56` (3.5 m) | yes | merged box | 4 instanced parts: plinth 0-6, shaft 6-48, capitals 48-52 and 52-56 |
| `w` | low wall (jumpable; the hero may stand on it) | `LOW_H=12` | yes | merged box | instanced box per tile |
| `t` | brazier and torch spot | stands on `floorH` | yes | cylinder r 5, half-height 6 | 5 instanced parts and animated flames |
| `=` | gallery | `GALLERY_H=16` | no (walkable at 16) | box 0-16 | top: floor polygon with the floor texture; brick side box |
| `^` | stairs rising north to a gallery | ramp from 0 at the south edge to 16 at the north edge | no | convex-hull wedge | 2 steps per tile row, one mesh each |
| `o` | rune dais (centre and size come from the bounding box of its tiles) | `DAIS_H=8`, octagonal; the slope runs from `R0` to `R1 = R0-24` | no | convex-hull frustum | octagonal top with the floor texture; sloped rim |
| `.` | floor | 0 | no | floor slab | one floor quad |

`solidTile = '#Pwt'.includes(tile)` (`:71`). Counts in the current map: 212 `#`, 92 `P` (23 pillars), 39 `w`, 30 `t`, 160 `=`, 30 `^`,
88 `o`. `CLIMB=3.5` is the highest rise a body walks up per 2-unit sample.

**Surface queries**:

- `floorH(x,y)` (`:104-110`) is the height of the walkable surface. It returns 16 on `=`. On `^` it ramps linearly across the stair
  rectangle. Inside the dais it is `8*clamp((R0-r)/(R0-R1),0,1)`, using the octagonal distance `octR` (`:102`). Everywhere else it is 0.
  It ignores walls.
- `topH(x,y)` (`:112-115`) returns the top of whatever is there: wall, pillar, low wall, or the floor. Shots, particles and the chase
  camera use it.

**The walkable grid** `PASS` (`:129-142`) holds 8 neighbour bits per tile. A step is allowed when:

- neither tile is solid;
- it does not cut a corner past a solid tile;
- walking the line between the two centres in 8 samples never **rises** more than `CLIMB` per sample.

So stairs (16 over 80 units) and the dais edge (8 over 24) are passable both ways. A gallery's edge is a wall from below but a drop from
above, which makes the edges one-way.

**`FLOW`** (`:145-178`) is a Dijkstra flow field toward the hero over `PASS`. It uses a binary heap on arrays with costs of 1 and 1.414,
and walks the edges backwards. It is recomputed only when the hero changes tile. If the hero stands on a solid tile, such as a low wall,
the walkable neighbours become the seeds. `dir(x,y,out)` gives the unit vector toward the centre of the best neighbour tile, or null for
"walk straight". The engine already has `E.FlowField` and `E.SpatialHash` (`engine:3020, :3630`), but this module reimplements both,
because it needs heights and one-way edges.

**From text to meshes, colliders and textures:**

- `rects(ch)` (`:81-91`) does a greedy row-then-column merge of a glyph into rectangles. It feeds the colliders, galleries, stairs and
  pillars.
- `DAIS` (`:94-99`) takes its centre and radius from the bounding box of the `o` tiles. Its top sits 1.5 tiles in from the base.
- **Textures are generated pixel by pixel** through `bake(fn, w, h)` (`00-setup.js:80-89`). `fn(x,y)` returns `[r,g,b]`. The function
  is written into a 2D canvas, wrapped in a `CanvasTexture`, and set to `NearestFilter`, no mipmaps, sRGB and repeat. The texture
  functions are:
  - `floorTex` (`:208-221`): `E.tex.flagstone` with a palette, the rune circle (radii 43 to 54, with a 4th "glow" channel), and moss
    near the walls from `noise2`;
  - `faceTex(t,h)` (`:225-236`): brick courses;
  - `topTex` (`:237`);
  - `blockTex` (`:239-248`): dressed stone;
  - `crateTex` and `barrelTex` (`30-crowd.js:293-305`).
- **The floor** (`:269-288`) is baked once over the whole hall at 1 texel per unit, a 1024×704 texture. It includes a baked contact
  shadow along the foot of every wall (radius 5, quantized to 5 levels) and a separate **emissive map** for the rune's glow
  (`emissiveIntensity 1.6`). Gallery tops and the dais top reuse it through world-space UVs (`floorPoly`, `:290-296`).
- **UV per metre**: `boxGeo(w,d,h)` (`:253-257`) rescales the UVs of a `BoxGeometry` so that every face keeps 16 texels per metre.
  `sidesThenTops` (`:259-263`) re-indexes a box into two draw groups instead of six.
- **Walls** (`:302-324`) know their outward direction from their floor neighbours, which `WALL_CELLS` records. They are drawn by two
  instanced meshes, `full` and `cut`. `placeWalls(key, cut)` re-lays them only when the key changes.

To change the level, edit `LEVEL`. Everything else is derived from it. The glyph semantics, however, are hard-coded in
`floorH`/`topH`/`solidTile`/`WT`/`hallColliders`/the mesh blocks, not in a legend. Adding a glyph means editing about 6 places.

---

## 5. Rendering

### 5.1 Renderer init and the WebGL 2 fallback (`00-setup.js:66-76`)

```js
const renderer = new THREE.WebGPURenderer({ canvas: canvas3d, antialias: false, forceWebGL: QS.get('backend') === 'webgl' });
await renderer.init();
const BACKEND = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2';
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NoToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.info.autoReset = false;   // reset per frame: with a filter on, one frame is several renders
```

The WebGPU renderer falls back to WebGL 2 by itself when WebGPU is missing. `?backend=webgl` forces the fallback. The scene has a dark
background and linear `Fog`. No WebGPU-only feature is used: no compute, no storage buffers, no GPU readback. A lint enforces this (§8).

### 5.2 Materials

All materials are node materials:

- `MeshLambertNodeMaterial` for the hall, props and braziers, which is cheap.
- `MeshToonNodeMaterial` with `gradientMap: TOON_BANDS` for puppets and capes. `TOON_BANDS` is a 3×1 `DataTexture`
  `[90,170,255]` with nearest filtering (`00-setup.js:91-95`), which gives three bands: shadow, base and lit.
- `MeshBasicNodeMaterial` for flames, coals, glows, halos, blob shadows, particles, floor decals, ribbons, outlines and cards.

TSL is used directly in three places: the outline `vertexNode`, the card `colorNode`, and the post graph.

**MRT tagging.** `objMat(m)` (`00-setup.js:98-99`) registers the material of a character or object. While a filter is on, it gets
`m.mrtNode = mrt({ mask: float(1) })` (`45-filters.js:34, :106-109`).

### 5.3 Outlines: an inverted hull in TSL (`00-setup.js:102-116`)

```js
const m = objMat(new THREE.MeshBasicNodeMaterial({ color: OUTLINE, side: THREE.BackSide, fog: false }));
m.vertexNode = Fn(() => {
  const mvp = cameraProjectionMatrix.mul(modelViewMatrix), pos = mvp.mul(vec4(positionLocal, 1));
  const out = mode === 'center' ? positionLocal : normalLocal;
  const pos2 = mvp.mul(vec4(positionLocal.add(out.normalize().mul(.01)), 1));
  const dir = pos2.xy.div(pos2.w).sub(pos.xy.div(pos.w)).normalize();
  return vec4(pos.xy.add(dir.mul(OUTLINE_PX).mul(pos.w)), pos.z, pos.w);   // constant pixel width
})();
```

- `OUTLINE_PX` is a uniform set each frame to `2/W*thick` (`40-cameras.js:144`), which is one game pixel.
- The outline shell is a second `InstancedMesh` that **shares the parts' `instanceMatrix`** (`30-crowd.js:31-32`).
- **A probable bug.** In r182, `InstanceNode.setup` assigns the instance-transformed position to `positionLocal`. I confirmed this in
  the vendored code: `const u=a.mul(Bd).xyz; Bd.assign(u)`. So in `'center'` mode, which `BATCH.box` uses for blades, guards and wings,
  the push direction runs from the batch mesh's origin, which is the **world origin**, not from the box's centre. The hull is therefore
  shifted to one side rather than grown. The mode came from lab3d, where boxes were separate meshes and the approach was correct. Check
  this with a close-up screenshot. The fix is to use `positionGeometry` (before instancing) for the direction, or to give the boxes
  smoothed normals.

### 5.4 Instancing and the r182 bug

I verified this in `vendor/three-0.182.0/three.webgpu.min.js` (`InstanceNode`):

- When `instanceMatrix.count <= 1000` (the capacity, not `mesh.count`), the matrices go into a **uniform buffer** built from that mesh's
  array. Every such mesh gets its own shader, so a mesh created at run time compiles a new pipeline.
- When the count is over 1000, they go into an `InstancedInterleavedBuffer`. Its `update()` copies `updateRanges` but syncs `version`
  **only if `usage !== DynamicDrawUsage`**. A dynamic mesh with more than 1000 instances therefore never uploads, and the monsters
  vanish.
- The workaround (`30-crowd.js:26`, `:211-212`, `LAB-3D.md:196-199`):
  - never set `DynamicDrawUsage`;
  - give every mesh created at run time more than 1000 slots (`Batch` caps of 2048 to 8192; atlas pages use `room = max(per, 1001)`,
    `:221`) so that they all share one shader;
  - call `clearUpdateRanges()` and `addUpdateRange(0, n*16)` each frame (`30-crowd.js:61-66`).
- `inst()` (`10-hall.js:264`) is used for static hall meshes created at load, with exact counts of 1000 or fewer. They take the UBO
  path, which is fine because the warm-up builds them.

### 5.5 Cards versus Puppets

**Cards** (`ATLAS`, `30-crowd.js:205-290`): the 2D engine draws each rig into an atlas cell.

- The atlas is a row of fixed pages, at most 64. Each page is 512² by default and grows up to 2048 when a cell is larger than ¼ of the
  page.
- Each page has a draw canvas, an outline canvas, a `CanvasTexture`, an `InstancedMesh` and a per-instance `cardRect` vec4 attribute.
- The cell size is `ceil(64*view.scale/8)*8`. Changing it disposes all pages and starts again.
- Each frame:
  - each character is drawn with `rig.draw(g, ox, oy, view)` or `blob.draw(...)`, clipped to its cell, with its root at
    `(cell/2, .72*cell)`;
  - the hit flash is a `source-atop` fill;
  - the outline is the sprite drawn at 4 or 8 offsets, then filled with `source-in` in `OUTLINE`;
  - only the pages that were used upload.
- The card's matrix comes from the camera axes `CV.right/up/back` (a full billboard). It is sized as `cell/ppm` metres and pushed 0.45 m
  toward the camera "so the floor can't cut its feet" (`:250-259`).
- The material is `MeshBasicNodeMaterial({alphaTest:.5})` with
  `colorNode = texture(tex).sample(uv().mul(cardRect.zw).add(cardRect.xy))` (`:222-223`). Every page compiles to the same shader.
- The engine view is `new E.View('card','Card', CV.yaw, CV.pitch, CV.scale, 1)`, cached by yaw, pitch and scale up to 500 entries
  (`40-cameras.js:158-163`).
- `CV.scale` is about the screen's pixels per unit at the hero's depth, quantized to ⅛ and clamped to [0.5, 4], with 20% hysteresis
  (`:138-143`).
- When the atlas is full, a character falls back to a puppet. Wisps are always 3D glows.
- Limits: a card is flat and sits at one depth, ignores the scene's lights and casts no shadow. It also needs the whole 2D drawing
  stack: `_drawHD`, `px.*`, `charView` and `E.style`.

**Puppets**: 3D parts on joints, in shared instanced batches (`BATCH`, `30-crowd.js:68-77`).

```js
tube: Batch(CylinderGeometry(.85, 1, 1, 7, 1, true), toon, {outline:'normal', shadow:true, cap:8192})
ball: Batch(SphereGeometry(1, 9, 6), toon, {outline:'normal', shadow:true, cap:8192})
box:  Batch(BoxGeometry(1,1,1), toon, {outline:'center', shadow:true})      // cap 2048
cone: Batch(ConeGeometry(1, 1, 6), toon, {outline:'normal', shadow:true})
glow: Batch(SphereGeometry(1,8,6), objMat(MeshBasicNodeMaterial))            // unlit, emissive look
halo: Batch(SphereGeometry(1,10,7), MeshBasic additive, depthWrite:false, {order:2})
blob: Batch(CircleGeometry(1,14).rotateX(-π/2), MeshBasic opacity .45, depthWrite:false, {order:1})   // blob shadows
```

The `Batch` call format (`:37-60`) is exact. All coordinates are **three.js metres, y up**, and colors are linear RGB `[r,g,b]`.

- `put(ax,ay,az, bx,by,bz, cx,cy,cz, tx,ty,tz, col)` writes the matrix columns directly: the X, Y and Z axes, each already scaled, then
  the translation. It grows the capacity ×2 when full.
- `tube(a, b, r, col)` puts the unit cylinder's Y axis along `a→b` (length `|b-a|`), with radius `r` on X and Z. The top radius is 0.85
  of the bottom one, so tubes taper toward `b`.
- `ball(p, rx, ry, rz, col)` is an ellipsoid **aligned to the world axes**, with no rotation.
- `box(a, b, across, w, t, col)` puts Y along `a→b`, X `w` wide along `across` (orthogonalized), and Z `t` thick.
- `cone` is used as `BATCH.cone.tube(base, tip, r, col)`.
- `begin()` and `end(outlines)` frame each frame. The shell count is `n` when outlines are on.

**There is no part-list data in stress-world.** A body is code: `humanParts(rig, flash)` (`30-crowd.js:98-138`) calls the batch
methods. Each humanoid gets about 15 tubes, 10 to 12 balls, 2 eyes (glow or dark balls) and, with a sword, 2 boxes. That is about 30
instances, which the outline shells draw again. Sizes come from the build (`lw = classic ? .45 : max(.55, limbW/2)`, `torsoW`, `headR`)
and colors from `rig.C`, both in engine units scaled by `u = 1/16`. Joints are read from `rig.J` through `frame()` and `wp()`
(`:82-88`). That pair repeats `rig._w`'s rotation, squash and size arithmetic without allocating. It ignores the 2D `_cheat` and adds
`_sink`, which sinks spawning and dying bodies into the floor.

`slimeParts` (`:140-161`) draws:

- the body as `ball(R·a, R·h, R·a)` with `a = 1 - sq·.55` and `h = 1 + sq`, following the Blob's squash;
- the eyes, or a slit when squinting;
- horns or ears as cones;
- flapping wings as boxes.

`wispParts` (`:164-170`) draws a glow core, an additive halo and 3 orbiting motes.

**The data format that was dropped** (`src/lab3d/40-characters.js:8-15`) is better for agents and should be revived. Each part is one
line:

```
['limb', a, b, ra, rb, color]        tapered capsule a→b (radii in engine units)
['ball', a, r, color]                ['eye', a, r, color]   (small unlit sphere)
['curve', a, b, bow, ra, rb, color]  limb bowed away from the body by bow × its length
['sword']                            grip, guard, blade along J.bladeDir
['cape']                             the rig's own cloth chains
point := 'jointName' | ['lerp', a, b, t] | ['off', a, forward, right, up]   (offset in the body frame)
```

For example: `['limb', 'hipL', 'kneeL', 1.45*lw, 1.2*lw, C.pants]`, or `['ball', ['off','head', R*.1, 0, -R*.05], R*.9, C.skin]`.

**Capes** (`CAPE`, `30-crowd.js:173-203`) are one dynamic `Mesh`. Each rig gets 8 segments × 2 vertices, taken from the engine's verlet
chains `rig.capeL/capeR`. The mesh has vertex colors and a double-sided toon material, and `computeVertexNormals()` runs every frame.

### 5.6 Lights, the shadow budget and fog

The light set is **fixed** (`10-hall.js:436-447`). Lights are never added or removed, only their intensities change, because changing
the light count rebuilds every lit shader. The set is:

- 1 `HemisphereLight`;
- 30 torch `PointLight`s (decay 0.5, reach 170 units);
- **2 shadow-casting point lights** (512² cube maps, bias -0.002) that **take over** the 2 lit torches nearest the hero, whose own
  lights then go dark;
- 1 rune light, 1 hero light, 4 wisp lights (enabled with "monster lights", nearest wisps) and 4 bolt lights (the first 4 shots).

That is 42 point lights in every forward-lit fragment loop, even when most of them have intensity 0. It is a real GPU cost, and there is
no clustering. Intensities are `LIGHT = { torch: 30, rune: 8, hero: 14, wisp: 10, shot: 10, ambient: 4 }`, "set by eye". `FLICKER` is
the 2D hall's sum of sines. The fog is `THREE.Fog`, linear, with near = distance(camera, hero) + 12 m and far = distance + 70 m
(`50-frame.js:56`), so it always starts just past the hero. Outlines and ribbons set `fog: false`.

### 5.7 Cut-away walls and pillars (`40-cameras.js:166-181`)

These apply to outside cameras (the views) only.

- **Walls**: walls whose outward normal points toward the camera (`c.ox*fx + c.oy*fy > .3`) are swapped to the 7-unit `cut` mesh. Above
  85° pitch nothing is cut. The layout is keyed by yaw.
- **Pillars**:
  - The test is a slab test, `segBox` (`10-hall.js:353-362`), on segments from the camera to five aim points: the hero's head and feet,
    and 4 floor points 40 units out (`AIM_FIGHT`). For an ortho camera, the camera end is taken 3,000 units back.
  - At 60° pitch or more, only the head and feet are used (`AIM_HERO`).
  - A pillar that is hit is cut to a 14-unit stump by scaling each part (`placePillars`, `:340-350`).
- 3D cameras cut nothing. The chase camera slides in front of walls instead.

### 5.8 Post-processing (`45-filters.js`)

The graph is `THREE.PostProcessing`, built entirely from TSL with no addons, with `outputColorTransform = false` (the filters output
display colors).

- **The scene pass and mask**: `pass(scene, camP)` with `setMRT(mrt({ output, mask: float(0) }))`. Object materials override the mask
  to 1. Additive glows, trails and particles add 0, so they leave the mask unchanged.
- The filters work in display colors (`sceneAt = sRGBTransferOETF(...)`), so bands and levels fall where the eye expects them.
- **`keep(m)`** chooses where a filter applies: the whole scene, objects only (`m`) or the environment only (`1-m`) (`:41`).
- **Cel** (`:42-56`):
  - luminance banding `q = max(floor(l·bands+.5), .5)/bands`, then `c·q/l`, which keeps the hue;
  - `saturation(·, punch)`;
  - ink only on the **darker** side of an edge: the largest of 4 neighbour luminance differences at `inkW` texels, passed through
    `smoothstep(.16,.36)`;
  - ink also on silhouettes, from the mask's falloff;
  - mixed toward `INK = #0c0818`.
- **Pixel** (`:57-68`): block quantization `px`, posterization to `levels` per channel, and a 4×4 ordered Bayer dither built from two
  2×2 levels. Objects use the mask per block, the environment per pixel.
- **Bloom** (`:70-80`): a bright pass `smoothstep(.72,1,lum)` into an `rtt` at ¼ size, then a separable 9-tap Gaussian (weights
  `.227,.194,.121,.054,.016`, step 1.6 texels, H then V), each step its own `rtt`, added ×0.6.
- **FXAA** (`:82-93`) is the classic version, run on an `rtt` of the composed picture.
- The graph is rebuilt only when `look`, `bloom` or `fxaa` changes. The sliders are uniforms (`:96-103`, `:117`).
- **When a filter turns on or off**, `tagMaterials()` sets or clears `mrtNode` on every `objMat` and sets `needsUpdate`. That recompiles,
  so `warmed = false` and the next frame warms up again (`:115`). The reason, from the code: "a material with its own MRT outputs can't
  draw straight to the screen".
- `?fx=cel|pixel&fxto=objects|env&bloom=1&fxaa=1` (`:18-23`).

### 5.9 Resolution modes (`50-frame.js:18-28`)

- **pixels** (the default): the picture is `S = ceil(devicePx_h/330)` screen pixels per game pixel, which gives 200 to 330 lines. three
  renders at W×H and the canvas is upscaled with CSS `image-rendering: pixelated`.
- **balanced**: half the device resolution.
- **full**: the device resolution, with dpr ≤ 3.
- `renderer.setPixelRatio(1); setSize(rw, rh, false)`.
- The 2D overlay always runs at W×H game pixels.
- `?res=`, `?pixels=0`. P cycles the modes.

### 5.10 Pipeline warm-up (`50-frame.js:29-47`)

The rule, learned from the retired `/stress-3d` (whose 1% low was 34 fps at 50 monsters, `LAB-3D.md:193-195`), is: **never build a GPU
pipeline mid-fight**.

`warmUp(cam, view)` runs on the first frame and again after any filter or MRT change. It:

1. creates pool meshes (8 arcs, 12 rings, 6 ribbons, 2 atlas pages);
2. sets every instanced batch, outline shell, particle batch, atlas page and prop mesh to `count = 1` with a **zero-scale matrix**;
3. makes the pool meshes visible;
4. forces both shadow lights on (`castShadow = true`, intensity ≥ 0.001);
5. renders one full frame through `renderFrame`, which includes the post graph;
6. restores everything.

Other parts of the same strategy:

- one shared material per pool, with color and alpha in the vertices (`35-effects.js:13-16`);
- fixed atlas pages that all compile to the same shader;
- a fixed light count;
- no texture resizing (pages are kept).

Gaps:

- Fog toggles, shadow toggles (`castShadow` is part of the lights' cache key) and `S.lights = 0` at warm-up (braziers with count 0)
  are not re-warmed.
- `Batch.grow()` creates new meshes mid-fight. Puppets reach the 8192-slot tube cap at about 546 humanoids on screen.
- `renderer.compileAsync()` is not used.

Converting rotations from Rapier (z up) to three (y up) for props (`30-crowd.js:316-325`):

```js
_pq.set(-p.q[0], -p.q[2], -p.q[1], p.q[3]);          // axis swap is a reflection: negate the vector part
if (p.kind === 'barrel') _pq.multiply(_rotZY);        // Rapier cylinder along its y, three's along its own y
```

---

## 6. Cameras (`40-cameras.js`)

**Poses.** Every mode produces a pose `{ x, y, z (engine units), yaw (heading it looks along), pitch (rad, negative = down), fov, ortho, Hf }`.
`placeCamera(pose, W, H)` turns it into `camP` (perspective, metres, far 500) or `camO` (orthographic, far 2000):

- it adds screen shake (sums of sines);
- it `lookAt`s along the heading, with a `up` fix for straight-down views;
- it sets up the card axes `CV`, the card pixel scale and `OUTLINE_PX`;
- it builds the frustum used for culling. `visible()` tests a sphere of radius 2.2 m at z + 14.

| Mode (key) | How it works |
|---|---|
| **View** (1): `iso`, `threequarter`, `topdown`, `brawler`, `side`, `custom` (V cycles) | Uses only `E.VIEWS[v].yawDeg/pitchDeg/scale` (`:47-52`). The engine's yaw 0 puts the camera to the south: `headingOf = atan2(-cos yaw, -sin yaw)`. The focus is 16 units ahead along the hero's aim, at z+8, with the 2D camera's lag `k = 1-exp(-dt/.18)`. The frame height is `frameUnits = 330/scale × dist`. **Perspective**: distance `Hf/2/tan(fov/2)`, and zoom narrows the fov. **Orthographic**: 900 units back, frame height `Hf/zoom`. Flat side view is always ortho. Turn moves in 45° steps (`[ ]`) and does not apply to side. Fix (F) pins the focus. |
| **Side with depth** (M) | `railPose` (`:76-84`) is the 2D page's Mode 7 rail as a perspective camera. It follows x, keeps y between `hero.y+110` and `+260`, sits at z = 70 + hero z, uses pitch -14° and fov 50 (zoom narrows it). |
| **Chase** (2) | Smoothed target at the hero's z+24, behind at `C.dist` (88 by default; the wheel ×/÷1.15 within [24, 260]), pitch -0.36. It ray-marches toward the camera in 3-unit steps against `topH` and pulls in before a wall. Pointer lock turns yaw and pitch (`k=.0024`). |
| **First** (3) | Eye at the rig's **head joint** (via `frame`/`wp`), smoothed in z, 2.5 units forward. The hero is not drawn, nor are bodies within 12 units. Near plane 0.3 m, fov 75 (the wheel sets 45 to 110). |
| **Fly** (4) | WASD moves along the look direction, including pitch. Q/E or Space go down and up, Shift is faster (170 vs 64 u/s), the arrows or pointer lock look. It is clamped to the hall ±6 tiles. The hero waits (move and aim are zeroed). |
| **Fixed** (F from 2 to 4) | A pose snapshot. F again frees it into fly. |

**Height boost.** The engine's views stretch height through `zBoost`: three-quarter 1.35, top-down 1.3 (`engine:379-386`).
**Stress-world does not reproduce this.** Its cameras use true heights, the cards' views are built with boost 1, and the boost field in
`?cam=` is parsed and ignored. lab3d did reproduce it exactly with a projection-only shear, `P' = P · V·S(1,k,1)·V⁻¹`
(`src/lab3d/50-cameras.js:31-40`), and cards compensated with `vert = 1 + (k-1)·up.y²`. Lights, shadows and physics keep true heights
under that approach.

**Input relative to the camera** (`controls()`, `:204-218`). `INPUT.move()` gives screen directions, with y down. Then:

```js
CTL.move[0] = -fy*mv[0] + fx*-mv[1];  CTL.move[1] = fx*mv[0] + fy*-mv[1];   // W = away from the camera
CTL.cam = [-fx, -fy, Math.cos(pitch)];                                       // toward camera + "hides the hero" factor
```

The aim depends on the mode:

- in chase or first person with the mouse captured, it is the camera's yaw;
- with a pad, it is the right stick rotated the same way as the move;
- with the mouse, a ray from the cursor is cast onto the plane at the hero's z+4 (`mouseOnFloor`), and the aim points from the hero to
  that point if it is more than 3 units away.

**Bindings** (`:185-188`), on the engine's `E.Input`:

- up/down/left/right: WASD, the arrows and the pad's d-pad;
- attack: J, Mouse0 and pads;
- dash: Shift or K;
- jump: Space;
- skill: E, L or Mouse2.

Camera keys are captured in the capture phase with `stopImmediatePropagation` before the game sees them. Fly mode takes WASD, Q, E,
Space and Shift.

**Links** (`:22-24`, `:274-288`, `:325-338`):

- `?view=iso|threequarter|topdown|brawler|side|custom`, `&proj=ortho`, `&depth=1`;
- `?cam=yaw,pitch,zoom,height,boost,x,y`: the 2D pages' format, a custom view, fixed when x and y are given;
- `?cam3=chase|first|fly`, or `?cam3=fly|fixed,x,y,z,yaw,pitch,fov` (engine units and degrees).

`camLink()` writes these out, and `camDesc()` describes the camera in words for reports.

---

## 7. Effects and UI (`35-effects.js`)

- **Telegraphs**: an `ARCS` floor pool (12 segments). Each is an annular sector at the floor's height + 0.3, ±0.8 rad around the
  attacker's facing:
  - for a walker it grows during the wind-up from `0.6r` to the move's **measured** reach `k.reach[e.next]`;
  - for a slime it grows toward the hero.

  They are `#ff4a3a` with alpha `.25 + .45u`, additive, so the alpha simply scales the vertex color. `floorPool` (`:15-43`) uses one
  `Mesh` per shape and one material for the whole pool. `set(i, x, y, z, r0, r1, a0, a1, color, alpha)`, `hideFrom(i)` and `prepare(n)`
  form the API.
- **Rings**: a `RINGS` pool (24 segments) draws particles of kind `ring`. Each ring is ±0.7 units wide, at
  `lerp(r0, r1, outQuad(u))`, fading as `1-u`.
- **Trails**: the `RIBBONS` pool (`:46-71`). Each ribbon has up to 12 base and tip pairs taken from `rig.trail`, an engine structure
  `{ b:[x,y,z], t:[x,y,z], age }` that the rig fills while swinging. Brightness fades as `((k+1)/n)^1.5`. The hero's trail is `#d8f2ff`
  and is hidden in first person. Monster claws are `#ff7a5a`, up to 24 in all. All ribbons are additive and double-sided with fog off.
- **Bolts**: a halo (5 units) and a hot core (2 units) are added to `BATCH.halo` and `BATCH.glow` **after `drawCrowd` has ended them**,
  and the batches are ended again. This coupling depends on call order. The first 4 shots move the 4 bolt lights.
- **Particles**: the engine's `E.Particles` is reused for its **list and emitters only** (`dust`, `sparks`, `bits`, `ring`, `text`,
  `glints`, `impact`):
  - `update` is replaced (`20-sim.js:43-54`) so that particles land on `topH` and bounce back off walls more than 6 units high;
  - the engine's 2D `draw` is unused;
  - here they become camera-facing hexagon quads (`quad()`, `:81-84`) in `PART.add` (additive: spark, ember, glint, impact),
    `PART.solid` (dust, smoke, fire) and `PART.bit` (squares);
  - `P.max = S.pcap`, from 900 to 10,000.
- **2D pixel overlay** (`drawOverlay`, `:133-148`):
  - the `#over` canvas runs at W×H game pixels with `image-rendering: pixelated`;
  - damage numbers (`text` particles) are projected through the three camera (`project()`, `40-cameras.js:153-156`) and drawn with the
    engine's pixel font `E.font.text` (outline `#0b0814`), blinking in their last quarter;
  - the wave and camera note is drawn at the top in the `tiny` font;
  - a crosshair shows in first person or in chase with the mouse captured;
  - numbers that land within 0.12 s and 28 units of each other stack (`damageNumber`, `20-sim.js:320-323`).
- **Braziers** (`10-hall.js:409-433`): 5 instanced meshes. The flames are 3 cone tongues, each with its own height (a sum of sines),
  sway and orbit, with inner and outer layers. The first N braziers are lit.
- **Blob shadows** (`shadowAt`, `30-crowd.js:335-338`): a dark disc on `floorH + 0.2` under every body, shrinking as `max(.35, 1-up/80)`
  as the body rises, so the height of a thrown body reads clearly. Puppets cast real shadows as well.
- **Spawning and dying**: bodies rise out of or sink into the floor (`_sink`, `fade()`, `30-crowd.js:332`, `353`).

---

## 8. Hooks for agents and tests

**`window.__sw`** (`60-panel.js:284-286`) exposes:

- state: `ready`, `backend`, `error` (from `fail()`), and the live objects `S`, `SIM`, `CAM`, `R3`, `FX`, `STATS`, `hero`, `enemies`,
  `corpses`, `PROPS`, `shots`, `renderer`, `scene`;
- `set(k, v)`, which handles only `look`, `res` and `pixels`;
- camera control: `setCam(mode)`, `setView(v)`, `setDepth(on)`, `setProj(p)`, `toggleFix()`;
- content: `setMonsters(n, instant)`, `setProps(n)`, `placeHero(x, y)`;
- `step(n, o)`: n steps of exactly STEP with scripted controls. `o.move` is `[x,y]`, `o.aim` is an angle, and `o.attack`, `o.dash`,
  `o.jump` and `o.skill` mean "press every that many steps";
- `run(n)` (the proof hash, then the live game restarts) and `hash()`;
- the benchmark: `benchStart()` and the getters `bench` and `report`;
- `rendererDesc()`, `camDesc()`, `camLink()`.

The API is inconsistent. Other settings have to be changed by mutating `__sw.S` or `__sw.FX` directly. Some of those changes do not
take effect: `S.capes` needs `applyCapes()`, which is not exposed, and `S.monsters` needs `setMonsters`. The test changes filters by
clicking DOM buttons.

**URL parameters**:

- `?backend=webgl`
- `?view=`, `&proj=ortho`, `&depth=1`, `?cam=`, `?cam3=`
- `?fx=`, `&fxto=`, `&bloom=1`, `&fxaa=1`
- `?look=card|puppet`
- `?res=pixels|balanced|full`, `?pixels=0`
- `?monsters=N`

**`tools/stress-world-test.mjs`** (Playwright, about 5.4K tokens, part of `npm test` and run by `test:changed` for this folder,
`tools/test-run.mjs:28`) does the following.

1. **Static rules** (`:29-44`). It applies regexes per line, with comments stripped, over `src/stress-world/*.js` and the template. They
   ban:
   - `WebGLRenderer`;
   - `(Raw)ShaderMaterial`;
   - `onBeforeCompile`;
   - `EffectComposer`, `three/examples` and `three/addons`;
   - `compute(`, `StorageBufferAttribute`, `storage(` and `computeAsync`;
   - `readRenderTargetPixels`, `getImageData(` and `readPixels(`.

   The import map must point only at existing `/vendor/` files (`:45-51`).
2. **Serving.** A small HTTP server applies the rewrites from `vercel.json` (`:54-66`). Chromium is launched with
   `--enable-unsafe-webgpu --enable-features=Vulkan --use-vulkan=swiftshader --use-webgpu-adapter=swiftshader --disable-vulkan-surface`
   (`:71`).
3. **The WebGPU stand-in canvas** (`standInCanvas`, `:74-101`, installed with `addInitScript`). Headless WebGPU loses its device when
   it presents a frame, so the test works around it:
   - `HTMLCanvasElement.prototype.getContext('webgpu')` returns a fake context whose `getCurrentTexture()` is an offscreen texture with
     `RENDER_ATTACHMENT|COPY_SRC`;
   - `requestAnimationFrame` waits on `queue.onSubmittedWorkDone()`;
   - `__readFrame(scale)` copies the texture to a mappable buffer, swizzles BGRA, scales it with nearest filtering and returns a PNG data
     URL.

   WebGL uses `page.screenshot`.
4. **Runs on both backends.** For each backend the test:
   - waits for `__sw.ready` or `__sw.error` (up to 120 s);
   - checks that the backend label is right;
   - checks the **proof**: `[__sw.run(600), __sw.run(600)]` must be equal. At the end the test also requires
     `hashes.webgl === hashes.webgpu` (`:238`).
5. **A fight with no pipelines built**:
   - It reads `p0 = renderer._pipelines.caches.size`. That is a **private** three.js internal and will break on upgrades.
   - It spawns 36 monsters of mixed kinds and runs 600 steps with an attack every 15 steps and a skill every 60. It requires at least 3
     deaths and at least one corpse above z 8, meaning a launch happened.
   - It draws the fight as cards and as puppets: at least 10 characters drawn, and each PNG at least 25 KB, a check for a blank frame.
   - `p1 === p0`.
   - It then grows the crowd to 300 cards and requires `p2 === p0`, which checks that new atlas pages share a shader.
   - It checks that the panel numbers have filled in.
6. **Physics** (`:164-187`):
   - the jump rises more than 18 units;
   - the hero walks up the west stairs, from tile (12.5, 12) to (12.5, 2.5), and ends on the gallery at z > 14;
   - with 16 humanoids, after 1,800 steps at least one live monster is above z 12;
   - a crate that is swung at moves more than 4 units.
7. **Cameras.** 12 camera setups each draw a picture of at least 15 KB with the right mode and something drawn. Holding the real `W` key
   for 0.6 s of sim time moves the hero more than 4 units **away from the fixed camera**.
8. **Filters.** 5 filter combinations are set by clicking the DOM, and each draws a picture of at least 25 KB. It also checks
   `rendererDesc`, and on WebGL only it checks the format of the benchmark report.
9. **Errors and output.** Any `pageerror` or `console.error` fails the run. The output is `check-output/stress-world/*.png` and
   `results.json`.

Weaknesses of the test:

- The image checks are only PNG byte-size thresholds. There are no golden images or perceptual diffs, and cosmetic `Math.random` would
  make pixel-exact goldens impossible anyway.
- There is no golden hash.
- There are no performance budgets.
- It depends on private three internals.
- It needs a whole browser for every check, even pure-sim ones.

---

## 9. Coupling to the 2D engine (`E.*`)

| `E.*` use | Where | What for | Does a 3D engine need it? |
|---|---|---|---|
| `clamp, lerp, approach, TAU`, `E.approachAng`, `E.ease` | everywhere | math | **Yes.** Port into a small `math` module. |
| `E.rng`, `E.hash2`, `E.noise2` | `10-hall:120`, `20-sim:122,142`, textures | seeded RNG, hash noise, value noise | **Yes**, tiny; keep as is. |
| `E.hex`, `E.tones`, `E.shade` | `10-hall:204-248`, `20-sim:67` | palette tools: hue-shifted 5-tone ramps | **Yes**: color and palette module, also useful for toon materials. |
| `E.tex.flagstone` | `10-hall:216-217` | the floor texture function | **Yes**, as part of a procedural texture library (port `E.tex.*`). |
| `E.inArc` | `20-sim:233,272,375` | 2D hit cone | **Yes**: combat helper; add a 3D or height-aware version. |
| `E.Humanoid` | `20-sim:91,136,186` | rig: `J` joints (local forward/right/up), `o` build, `C` colors, `update(dt, state)`, `tip()`/`hand()`/`head()`, `trail`, `capeL/R`, `kick()`, `draw()` for cards | **Yes for posing** (the core of the animation system); **no for its 2D drawing** (`_drawHD`/`_drawClassic`, `charView`, `_cheat`, `_pitch`). Split posing from drawing, seed its randomness, and make `sidePlane` an explicit option instead of depending on the last view drawn. |
| `E.Blob` | `20-sim:190` | slime squash rig (`sq`, `look`, `flap`, `flapP`) | **Yes, the posing part only**; drop its 2D draw. |
| `E.Attack`, `E.Combo`, `E.MOVES` | `20-sim:89,134-135,383` | move timing (wind, active, recover), once-per-swing hits, combo windows, the move library with body motion | **Yes**: the gameplay-facing animation system. It is pure logic with no DOM. |
| `E.Particles` | `20-sim:42` | particle list and emitters (`update` replaced, `draw` unused) | **Rewrite** as a 3D cosmetic particle module, keeping the emitter presets as data. Do not pass it gameplay callbacks (`freeze`, `shake`). |
| `E.Input` | `40-cameras:185` | keyboard, mouse, pad and touch, action buffering, edge detection | **Port the concept.** Take it apart from the 2D `Screen`, and add input-frame recording and replay. |
| `E.VIEWS` (yaw, pitch, scale) | `40-cameras:33,49,52` | camera presets | **As data only**: a 5-row table in the camera module. |
| `E.View` | `40-cameras:161` | the orthographic projection the cards are drawn from | **No** (cards only). |
| `E.style.trans`, `E.style.charPitch` | `60-panel:103,136-137,255` | 2D card look switches | **No.** |
| `E.font.text` | `35-effects:139,142` | pixel bitmap font defined in code | **Yes.** It fits "no image files" well: debug overlay, damage numbers, in-world UI. |
| (inlined but unused) `E.FlowField`, `E.SpatialHash`, `E.parseLevel`, `E.knockback` | none | none | Superseded by stress-world's height-aware versions. |

Mocap (`Mocap.drive`) is **not** used in stress-world; lab3d uses it. Whatever the stress-world sim adopts for animation should go
through the same rig interface so that mocap clips can drive puppets unchanged. About 30% of the 374 KB engine is reachable from this
page. The rest (Game, Renderer, TileMap, PlatformMap, audio, menus, GPULighting) is dead weight here.

---

## 10. Classification and recommendations

Labels: **ENGINE** = generalize into my-3dge; **GAME** = stress-test game logic, which should be left behind or kept as a
sample or test scene; **LAB** = debug or benchmark scaffolding that is worth keeping as tooling.

| Subsystem (location) | Label | Recommendation | Why |
|---|---|---|---|
| Renderer init and fallback (`00-setup:66-76`) | ENGINE | KEEP-AS-IS (wrap) | Correct and minimal; add a backend query to the devtools. |
| Units and `toThree` (`00-setup:39,53`) | ENGINE | REWRITE | Pick one coordinate system (preferably metres, y up in sim and render). If z-up engine units stay, put every conversion in one adapter. Today's swizzles are scattered and include a reflection. |
| `hashNumbers`, proof-run pattern (`00-setup:58-63`, `20-sim:579-603`) | ENGINE | PORT-WITH-CHANGES | Hash a declared state schema (positions, velocities, rotations, RNG state, timers); store golden hashes; run it in Node. |
| `bake()`, procedural textures (`00-setup:80-89`, `10-hall:204-248`, `30-crowd:293-305`) | ENGINE | PORT-WITH-CHANGES | Use `DataTexture` (no DOM canvas, so it is testable in Node or a worker); gather the functions into a `tex` library; `floorTex`'s rune and moss are a GAME sample. |
| Toon bands and toon material (`00-setup:91-95`) | ENGINE | KEEP | Small and effective. |
| Inverted-hull outline (`00-setup:102-116`) | ENGINE | PORT-WITH-CHANGES | Fix `'center'` mode for instancing (`positionGeometry`). |
| MRT object mask (`objMat`, `45-filters:30-35,106-109`) | ENGINE | PORT-WITH-CHANGES | Make it a material tag registry. Re-tagging needs a re-warm; consider always rendering through the post pass so materials never switch. |
| ASCII level format and derivation (`10-hall`) | ENGINE (format and compiler) / GAME (this map and its glyph meanings) | REWRITE as a legend-driven compiler | Today about 6 hard-coded places per glyph; a legend `{glyph → solid, floor height or profile, collider, mesh, material, nav, spawn}` gives agents one place to edit. |
| `rects()` greedy merge, `segBox`, `octR`, `floorPoly`, `boxGeo`, `sidesThenTops` | ENGINE | KEEP | Reusable geometry utilities. |
| `floorH`/`topH`, `PASS`, `FLOW` (`10-hall:104-178`) | ENGINE | PORT-WITH-CHANGES | Make a `nav` module: height samplers come from the level; keep the one-way ledge rule; use typed-array heaps; support several targets. |
| `hallColliders` (`10-hall:188-201`) | ENGINE | PORT-WITH-CHANGES | Generated by the level compiler. |
| Wall and pillar cutting (`10-hall:302-370`, `40-cameras:166-181`) | ENGINE | PORT-WITH-CHANGES | A camera occlusion feature: "cut walls facing an outside camera; stump occluders between the camera and the focus". |
| Braziers and flames, `FLICKER` (`10-hall:409-436`) | GAME (sample prop) | KEEP as a sample | A good example of an animated instanced prop. |
| Fixed light set and shadow-caster reassignment (`10-hall:435-466`) | ENGINE | PORT-WITH-CHANGES | Make a light budget manager: a fixed pool of N (well below 42), assigned by priority and distance; shadow casters move to the most important lights. |
| `SIM` step, reset, run, `S` settings (`20-sim:27-38,118-138,557-603`) | ENGINE (framework) / GAME (contents) | REWRITE | A generic world with a system order; split settings into gameplay and render; never mix in DOM or three. |
| Rapier world, groups, character controller (`20-sim:29-33,120-131,290-301`) | ENGINE | PORT-WITH-CHANGES | Make a physics adapter with a config object; keep the tuned controller values as defaults. |
| Crowd on dynamic bodies, velocity control (`20-sim:174-181,365`) | ENGINE (pattern) | PORT | Cheap, robust, needs no separation code. |
| Knockback, launches, hitstop, shake (`20-sim:324-342,36-37`) | ENGINE (helpers) / GAME (tuning) | PORT the helpers | Keep `freeze` and `shake` gameplay-side and out of the particles. |
| Walker, slime and wisp AI, attack tokens, rings, waves (`20-sim:236-451`) | GAME | KEEP as a sample scene | Valuable as a stress scene and test content, not as engine code. |
| Spatial hash (`20-sim:225-231`) | ENGINE | PORT | Reuse buffers instead of making new arrays every step. |
| `readBack`, `animate` glue (`20-sim:498-553`) | ENGINE (pattern) | PORT | Sync from bodies to entities to rigs; remove the `VISIBLE` dependency (do LOD in the render layer). |
| Particle storm (`20-sim:479-495`) | LAB | Keep as a benchmark load | |
| `Batch` (`30-crowd:20-67`) | ENGINE | KEEP (minor changes) | The heart of the instanced renderer; keep the caps over 1000 and the update-range discipline. |
| `humanParts`/`slimeParts`/`wispParts` (`30-crowd:98-170`) | ENGINE (puppet renderer) | REWRITE as data | Adopt lab3d's part-list grammar, compiled to `Batch` puts. One source of truth for body shape. |
| Capes (`30-crowd:173-203`) | ENGINE | PORT | Cloth ribbon mesh from the rig's verlet chains. |
| Cards and `ATLAS` (`30-crowd:205-290`) | LAB | DROP from the engine | Requires the 2D drawing stack; flat and unlit. Keep the write-up of the technique (fixed pages, a shared shader, at least 1001 slots) as lore. |
| Props mesh, z-up to y-up quaternion (`30-crowd:306-329`) | GAME / ENGINE (conversion util) | PORT the util | |
| Blob shadows (`30-crowd:335-338`) | ENGINE | KEEP | Cheap contact cue; works with any renderer. |
| Floor decal pool, ribbons, particle quads (`35-effects:15-130`) | ENGINE | PORT-WITH-CHANGES | Generic effect pools; separate the telegraph rules (GAME) from the pools. |
| 2D overlay with pixel font (`35-effects:133-148`) | ENGINE | PORT | World-anchored text, debug labels. |
| Camera modes and `placeCamera` (`40-cameras:27-148`) | ENGINE | PORT-WITH-CHANGES | Each mode becomes a pure function from (state, input, dt) to a pose; add the boost option from lab3d if the classic views matter. |
| Camera-relative controls and mouse ray aim (`40-cameras:191-218`) | ENGINE | PORT | Record the result as an input frame (move, aim, buttons, cam). |
| Key, wheel and pointer-lock handlers (`40-cameras:291-322`) | LAB | REWRITE as bindings | Into the input layer and a binding table. |
| Camera links `?cam`/`?cam3`, `camDesc` (`40-cameras:266-338`) | ENGINE (devtools) | PORT | Agents reproduce a view from a string. |
| Post filters (`45-filters:42-127`) | ENGINE | KEEP (TSL) and restructure | A `post` module with a `set({look, apply, bloom, fxaa, …})` API. |
| `fit()` resolution modes (`50-frame:18-28`) | ENGINE | KEEP | |
| `warmUp()` (`50-frame:32-47`) | ENGINE | PORT-WITH-CHANGES | A registry: every pool and batch registers itself; re-warm on every change to a shader key (fog, shadows, filters); try `compileAsync`. |
| `tick()` loop (`50-frame:80-90`) | ENGINE | REWRITE | A true fixed-step accumulator with interpolation and input recording. |
| HUD, panel, presets, fullscreen (`60-panel`, template) | LAB | DROP; generate a dev panel from a settings schema | 14K tokens of hand-wired DOM. |
| Benchmark and report (`60-panel:205-263`) | LAB | KEEP as a tool | Its physics, logic and drawing split is useful. |
| `window.__sw` (`60-panel:279-286`) | ENGINE (devtools) | REWRITE as a generic `__engine` | One consistent `get`/`set`/`step`/`run`/`shot` surface. |
| `tools/stress-world-test.mjs` | LAB to engine tooling | PORT-WITH-CHANGES | Keep the stand-in canvas, SwiftShader flags, banned-API lint, cross-backend hash and pipeline counter. Add golden hashes, golden images and Node-only sim tests. |

---

## 11. Quality problems

1. **A shared-scope "module"** (§1.4). There are 322 top-level declaration statements, no imports or exports, and dependency order comes from file
   names. There are forward writes (`warmed`, `VISIBLE`, `OBJ_MRT`) and circular calls (cameras and panel). TSL names are dumped into
   the global scope. One-letter globals (`E`, `U`, `T`, `S`, `P`, `H`, `CV`, `R3`, `SCR`, `og`, `wp`, `lin`, `ig`) are shadowed by
   locals. An agent editing one file cannot see what it may break without grepping all nine.
2. **The sim is welded to the browser and GPU** (§2.3.9). There is no fast unit test of the sim, and it cannot be fuzzed or replayed in
   Node.
3. **The fixed step is not fixed** (§2.2), there is no replay, and the camera is an unrecorded input.
4. **Mixed responsibilities in `S`.** One object holds gameplay settings (`monsters`, `behavior`, `iters`, `launch`, `god`) and render
   settings (`outlines`, `shadows`, `fog`, `torchLights`, `lod`, `capes`), all mutated freely by the panel, tests and `SIM.run`. A
   parallel set of state objects (`CAM`, `R3`, `FX`, `SCR`, `STATS`) each has its own setters, or none.
5. **Hard-coded constants everywhere.** Examples: heights (`10-hall:68-69`), `LIGHT` "set by eye" (`:437`), speeds and jump
   (`20-sim:114`), damage tables (`:108-113`), AI magic numbers (rings `+10+20*front`, `TURN_GAP .25`, `MAX_ATTACKERS 3`), camera
   numbers (330 lines, 900 units ortho distance, 0.0024 mouse sensitivity, ×1.15 zoom, `DEPTH`), card scale clamps, outline offsets.
   None are grouped into a tunable config.
6. **Density.** There are 57 lines over 200 characters in the JS, the longest 318 (`10-hall`). Long multi-statement lines make
   exact-match edits and diffs fragile for agents.
7. **Duplicated knowledge.** `humanParts` copies `_drawHD`'s sizing; `frame()`/`wp()` copy `rig._w`; `FLOW`, the spatial hash and
   `parseLevel` re-implement engine equivalents; the 2D views' angles live in the engine while their use lives here.
8. **Hidden order coupling.** `drawEffects` adds to `BATCH.halo`/`glow` after `drawCrowd` has ended them. The first-person camera
   depends on the puppet helpers. `placeCut` depends on `CAM.pose` from the previous call.
9. **Rendering correctness and performance risks:**
   - the `'center'` outline mode on instanced boxes (§5.3);
   - 42 lights in every lit shader (§5.6);
   - stairs as 20 separate meshes (2 draw groups each, plus 12 shadow-pass faces);
   - `computeVertexNormals` on capes every frame;
   - allocation in hot paths: `WISP.halo.map` for each wisp each frame, `lightHall` sorting new arrays, `enemies.filter().sort()` for
     wisp lights, the spatial hash's `Map` of new arrays every step;
   - `Batch.grow` mid-fight;
   - toggles that change shader keys without a re-warm.
10. **Documentation drift.** Examples: "fixed 60 Hz" (`LAB-3D.md:30`), "or no renderer" (`20-sim:4`, `00-setup:31`), "`set(key, value)`"
    (`60-panel:6`) when only 3 keys work, "The live game starts again after it" (`20-sim:586`). Agents trust headers, so wrong headers
    are worse than none.
11. **Tests depend on private internals** (`renderer._pipelines.caches`) and judge pictures by byte size.
12. **Weak state hash** (§2.3.6) and no golden value.
13. **A page-size tax.** The whole 374 KB (about 107K tokens) 2D engine is inlined for the roughly 30% of it the page uses.

**Token sizes** (bytes ÷ 3.5):

| File | Tokens |
|---|---|
| `00-setup` | 2.4K |
| `10-hall` | 9.4K |
| `20-sim` | 11.8K |
| `30-crowd` | 8.5K |
| `35-effects` | 3.1K |
| `40-cameras` | 7.7K |
| `45-filters` | 3.2K |
| `50-frame` | 1.9K |
| `60-panel` | 6.9K |
| **JS total** | **about 55K** |
| template | 7.1K |
| test | 5.4K |

The good parts for agents:

- **Each file opens with a contract header.** It lists the file's API, its rules and its units. Keep this style.
- **Comments explain *why* at each trap**, for example the r182 bug, the warm-up and the reflection in the quaternion swizzle.

---

## 12. Recommendations for my-3dge

### 12.1 Module split (real ES modules, one import map, `sim/` free of DOM and three)

```
src/core/      math.js (clamp/lerp/approach/angles/ease), rng.js (seeded streams: sim, cosmetic), hash.js (FNV over a schema),
               color.js (hex/tones/shade), units.js (the ONE coordinate convention + converters)
src/sim/       world.js (entities, system order, fixed step, snapshot/restore, hash), physics.js (Rapier adapter: world, groups,
               bodies, character controller, readBack), level.js (legend-driven compiler: tiles -> heights, colliders, nav, spawns,
               mesh *descriptions*), nav.js (PASS grid + flow fields), combat.js (hit cones/height windows, knockback, hitstop,
               shake), anim/ (Humanoid posing, Blob, MOVES, Attack, Combo, mocap; no 2D drawing), particles.js (cosmetic sim on
               the cosmetic RNG stream)
src/render/    renderer.js (WebGPURenderer + fallback, resolution modes), materials.js (toon bands, outline hull, node mats, MRT
               tags), tex.js (procedural textures -> DataTexture), batch.js (instanced primitives), puppet.js (body part-lists ->
               batch puts), level-mesh.js (meshes from level descriptions, cut-away), lights.js (fixed-pool budget manager),
               effects.js (decal pool, ribbons, particle quads, blob shadows), overlay.js (pixel font, projected text), post.js
               (cel/pixel/bloom/fxaa + mask), warmup.js (registry + compileAsync + counters), cameras.js (pure pose functions +
               placeCamera + links)
src/input/     bindings.js, input.js (devices -> InputFrame {move, aim, buttons, cam}), record.js (record/replay)
src/app/       loop.js (fixed-step accumulator, interpolation alpha), game.js (wires sim + render + input)
src/devtools/  api.js (window.__engine), params.js (URL schema), panel.js (generated from a settings schema), bench.js
samples/stress-hall/   the stress-world level, cast, AI, waves, props, braziers (GAME, as a sample + benchmark + test scene)
tools/         build (bundle or import-map), test-sim.mjs (Node: golden hashes, replays), test-browser.mjs (stand-in canvas,
               both backends, pipelines, golden images), lint-rules.mjs (banned APIs; sim/ bans Math.random, performance.now,
               Date.now, document, window, three)
```

Keep each file under about 6K tokens and lines under about 140 characters. Every file should keep a contract header, and the headers
should be checked against the API by a test.

### 12.2 Public API sketch

```js
const world = await createWorld({ level: { text: LEVEL, legend }, seed: 1 });   // Node or browser
world.addSystems(heroSystem, crowdSystem, combatSystem);
world.step(inputFrame);              // exactly 1/60 s; inputFrame = { move:[x,y], aim, buttons:{attack,dash,jump,skill}, cam:[fx,fy,k] }
world.hash(); world.snapshot(); world.restore(snap);
runScript(world, script, 600)        // -> hash (the proof), Node-runnable

const view = await createView(canvas, { backend: 'auto'|'webgl', res: 'pixels'|'balanced'|'full' });
view.attach(world, { bodies: { hero: HUMAN_BODY, slime: SLIME_BODY }, lights: { pool: 16, shadows: 2 } });
view.camera.set('view', { preset: 'iso', proj: 'ortho' }); view.camera.code(); view.camera.fromCode('cam3=fixed,…');
view.post.set({ look: 'cel', apply: 'objects', bloom: true, fxaa: false });
await view.warmUp();                 // compiles every registered pipeline; view.stats.pipelinesBuilt exposed publicly
startLoop({ world, view, input });   // fixed step + interpolation; input frames recorded

window.__engine = { world, view, get(path), set(path, v), step(n, script), run(script), hash(), shot(), stats(), replay(rec) };
```

### 12.3 Specific improvements

1. **A true fixed step.** Use an accumulator with `STEP = 1/60` and interpolate for rendering. Record input frames, including the camera
   heading, so any live session can be replayed exactly. Add golden hashes (stored in the repo) for several scripts.
2. **Keep cosmetic randomness on its own seeded stream** (particles, idle rig phase, blinks). Golden screenshots then become possible:
   seed it, freeze time and use a fixed camera.
3. **Move rig posing into `sim/anim`.** Make it independent of the view (`sidePlane` becomes an option), with no `Math.random`. The
   renderer may only *read* rigs, which is enforced by freezing or proxying in debug builds.
4. **Data-driven bodies.** Use the lab3d grammar, compiled once per body type into a flat list of batch ops. Add `'box'` and `'cone'`
   ops, and fix the outline for instanced boxes.
5. **A legend-driven level.** Glyph semantics live in one table, and the compiler emits colliders, height samplers, a nav grid and
   mesh descriptions. Add a `level.validate()` that reports unreachable areas, one-way ledges and missing torches, so agents can check
   their maps.
6. **Pipeline hygiene as an engine service.** Every mesh pool registers with `warmup`. Shader-key changes (fog, shadows, MRT, light
   count) raise a re-warm. A public counter of pipelines built (wrap the backend's pipeline creation once) replaces
   `renderer._pipelines`. Never create runtime instanced meshes with 1000 or fewer slots, and never use `DynamicDrawUsage` on r182.
7. **A light budget.** Use a fixed pool of about 8 to 16 point lights plus 2 shadow casters, assigned each frame by priority and
   distance. Optional WebGPU-only tiled lighting is allowed (it only affects looks), with WebGL 2 keeping the pool.
8. **Devtools from one settings schema.** It should generate the URL params, `__engine.set`, the dev panel and the benchmark report's
   settings line. That removes about 14K tokens of hand-written panel and HTML.
9. **Tests in three tiers:**
   - Node: sim, nav, level, hash and replay, in seconds;
   - a headless browser on both backends: no pipelines mid-fight, cross-backend hash, golden images with a tolerance;
   - performance budgets from the benchmark (physics, logic and drawing ms at N monsters).

   Keep the banned-API lint and extend it to forbid DOM, three and `Math.random` inside `sim/`.
10. **One coordinate system.** I recommend metres with y up end to end, so Rapier shapes need no `Z_UP` and three needs no swizzle.
    Convert the animation system's rig output (engine units, z up, local forward/right/up) once, at the rig adapter. Agree this with
    whoever ports the animation and mocap library, because their data is z-up at 16 units per metre.
11. **The order to port in:**
    1. core
    2. sim with physics, level and nav, plus Node tests
    3. render basics (renderer, materials, batch, puppet, level meshes, lights, warm-up)
    4. cameras and input
    5. effects, overlay and post
    6. devtools and the test harness
    7. the stress hall as `samples/`
