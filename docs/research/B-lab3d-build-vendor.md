# B. The 3D world lab, the fly renderer, 3D vendoring and test tooling, and the build system

Source: `/home/user/michaelcrosato/my-3d2dge` (v0.14.0). Every `path:line` points into that repo. I measured things on a
throwaway copy in the scratchpad, never in the source repo. The setup was Node 22, Playwright 1.56 and headless
Chromium 1194, with SwiftShader standing in for the GPU. I deleted the copy afterwards.

---

## 0. Decision summary

- **lab3d proves the stack works, and it is small.** It is 1,030 lines (74 KB) across 7 parts. The engine's rigs,
  `E.MOVES`/`E.Attack`/`E.Combo`, the mocap player and a custom non-human rig (Dan) all run unchanged on three r182
  `WebGPURenderer` plus Rapier 0.19.3. The 600-step state hash is identical on WebGL 2 and WebGPU: I measured
  `1917b7b9` on both.
- **stress-world** (2,574 lines) fixed lab3d's scaling problems: instancing, a card atlas, a warm-up pass, a fixed
  light set, whole-number pixel scaling and TSL post filters. It also took three steps back where lab3d was better:
  1. Live play no longer runs on a true fixed step.
  2. Sim and physics run in 2D engine units with z up, so a `lengthUnit` knob and an axis swap are needed.
  3. Puppet bodies are imperative code instead of data, and the engine's exact height "boost" is gone.
- **Take the best of each.** Keep lab3d's metres / y-up convention, its fixed-step accumulator, its declarative
  puppet part list (with `_offsets`), its exact boost projection, its per-character card angles and its compact
  camera codes. Run these on stress-world's instanced batches, card atlas, warm-up, fixed lights, integer pixel
  scale, filters and richer cameras.
- **Free-camera fly renderer:** drop the code and keep two ideas (§3).
- **Vendoring:** keep the tool and the import map, and add integrity pins, vendored types and a generated import
  map (§4).
- **Tests:** keep the headless-WebGPU trick. The parity proof is weaker than it looks, and missing WebGPU still
  passes (§5).
- **Build:** native ES modules in development, with no build step; a small repeatable bundler for releases (§6).

---

## 1. lab3d architecture

### 1.1 Shape

- `src/lab3d.template.html` inlines classic scripts first, then the module:
  - the 2D engine `window.My3D2dge` (`engine/my-3d2dge.js`, 374 KB)
  - the mocap reader and player
  - the HERO set (75 KB) and the CMU set (722 KB)
  - Dan's class (`lab3d.template.html:140-153`)
- After those comes `<!-- @inline-module src/lab3d -->`. `tools/build.mjs:88-91` turns it into **one**
  `<script type="module">` made of the 7 parts joined in name order.
- **The parts share one scope.** Cross-file names like `scene`, `ROOM`, `SIM`, `CAMS`, `MAT`, `toThree` and `U` are
  implicit globals, with no imports or exports between parts.
- Top-level `await` is used for `RAPIER.init()` (`30-physics.js:16`) and `renderer.init()` (`60-panel.js:15`).
- The output, `examples/lab-3d.html`, is 1.33 MB. Most of that is the CMU set, which the page uses for only 4 clips.
  The vendored libraries add another 3.33 MB.

### 1.2 Per-file responsibilities

| File | Role | Key symbols |
|---|---|---|
| `00-setup.js` (53 lines) | Imports, constants, helpers | `U=16`, `STEP=1/60`, `LINES=240`, `OUTLINE='#0c0818'` (`:29-32`); `fail()` writes the error to the page and to `__lab3d.error` (`:36-42`); `toThree`/`toEngine` (`:45-46`); `hashNumbers` (FNV-1a over float32 bits, `:48-53`) |
| `10-materials.js` (108) | Procedural textures and materials | `PAL` (`:13-19`); `TEX.floor/brick/pillar/top/crate` (`:20-51`); `bake(fn,w,h)` turns a function into a `CanvasTexture` with nearest filtering, repeat wrapping and sRGB (`:53-65`); `MAT` (`:67-76`); `TOON_BANDS` (`:80-84`); `toonMat(hex, glow)` cache (`:86-90`); `OUTLINE_PX` uniform (`:94`); `outlineMat(mode)` TSL inverted hull (`:96-108`) |
| `20-world.js` (112) | The level as text, meshes, lights | `MAP` (`:12-24`); heights (`:25`); parse into `ROOM` (`:27-35`); `solid()` (`:36`); `box()` UV rescale (`:42-46`); walls with cut-away twins (`:50-65`); one floor texture (`:68-71`); `syncCrates` (`:76-78`); sun, fill and torches (`:81-96`); `flicker` (`:98-103`); `setCutaway` (`:106-112`) |
| `30-physics.js` (135) | Gameplay on Rapier | `HERO` tuning (`:17`); `LAP` (`:19-23`); `SCRIPT` (`:25-29`); `DAN_MOVES` (`:31-35`); `SIM.reset/step/lapInput/hash/state/run` (`:38-135`) |
| `40-characters.js` (273) | The cast, Card and Puppet | `shell()` (`:22`); `humanBody` (`:27-48`); `danBody` (`:51-67`); `localPoint`/`worldPoint` (`:72-80`); `class Puppet` (`:87-139`); `placeTube/placeBox` (`:142-154`); `makeCape` (`:156-168`); `makeRibbon` (`:171-187`); `class Card` (`:191-235`); `CAST` (`:247-251`); `poseCast` (`:254-273`) |
| `50-cameras.js` (125) | Cameras | `CAMS` (`:18-27`); `toCamera` (`:30`); `boost()` (`:34-40`); `CAMS.set/update/ground/cardView/code/load` (`:41-125`) |
| `60-panel.js` (224) | Renderer, loop, input, panel, API | renderer (`:14-19`); `OPT` (`:21-22`); proof (`:26-28`); `heroInput` (`:36-47`); keys and pointer (`:48-98`); `fit` (`:102-109`); `render` (`:115-141`); `frame` (`:143-152`); `window.__lab3d` (`:218-224`) |

Every part opens with a header in the agent-edition style: its API, its rules and how to extend it. Someone can
understand the whole lab from about 150 header lines, which is a good convention to keep.

### 1.3 Coordinates and units

- **three.js and Rapier:** metres, y up, gravity −9.81 m/s² (`30-physics.js:40`).
- **Rigs:** keep the 2D engine's units, z up, with 16 units = 1 m = 1 tile. Conversion happens only at the rig
  boundary:
  - `toThree(x,y,z) = (x/U, z/U, y/U)` (`00-setup.js:45`)
  - `poseCast` feeds the rig `{x: h.x*U, y: h.z*U, z: h.y*U, …}` (`40-characters.js:256`)
- The y↔z swap flips handedness, because the engine frame is left-handed. That is why "an engine angle a turns
  about three's y axis by −a" (`00-setup.js:19`). This is a classic source of sign bugs.

### 1.4 The ASCII room format

`MAP` is 13×11 (`20-world.js:12-24`), one character per 1 m tile, and row 0 is north.

| Char | Meaning |
|---|---|
| `#` | wall, 2.5 m |
| `T` | wall with a torch on its room side |
| `P` | pillar, 46/16 m |
| `.` | floor |
| `c` | crate, yaw from `E.hash2` |
| `C` | two crates stacked; the top one offset and turned 0.35 |
| `m` | spot for the mocap figure |
| `d` | spot for Dan |

How the map is used:
- Parsing produces `ROOM = { W, H, cells:[{x,z,kind,torch}], crates:[{x,y,z,yaw}], spots:{m,d}, torches, centre }`.
- Each wall's outward direction comes from its free neighbours. A corner points outward on both axes
  (`:62-63`).
- **Colliders come from the same `ROOM`** (`30-physics.js:44-45`), so meshes and physics can't drift apart.
- There are no heights apart from fixed per-kind heights, and no slopes or stairs. stress-world's `10-hall.js`
  extends the same idea with heights, galleries, stairs, a dais, a walkable grid and a flow field.

### 1.5 Procedural materials

- **Textures are functions** `(x,y) → [r,g,b]` at 16 px/m, in the same style as `E.tex`.
  - The floor is the engine's own `E.tex.flagstone(x, y, PAL.floor)` (`10-materials.js:22`; the engine has it at
    `my-3d2dge.js:3059`). It is baked **once for the whole room** (208×176 px, clamped wrapping), so every flagstone
    sits where the 2D engine would put it (`20-world.js:68`).
  - Brick, pillar, top and crate are local functions built on `E.hash2` and `E.noise2`. These are integer-hash value
    noise, so they are pure and deterministic.
- **`box(w,h,d)` keeps a constant pixel density.** It rescales `BoxGeometry` UVs per face so every face keeps
  16 px/m with `RepeatWrapping` (`20-world.js:42-46`). `sideTop()` gives a box textured sides and a worn top
  (`:47`). The cost: each box has 6 material groups, which means 6 draw calls.
- **Materials are node materials only.**
  - `MeshLambertNodeMaterial` for the room.
  - `MeshBasicNodeMaterial` for flames, the blob shadow and cards.
  - `MeshToonNodeMaterial` for puppets. Its `gradientMap` is a 3×1 nearest-filtered `DataTexture`
    (90/170/255 grey), which gives three bands that mimic the 2D tone ramps. The material is cached per colour;
    "glow" parts get unlit Basic instead.
- **Outlines are inverted hulls written in TSL** (`10-materials.js:96-108`): back faces only, in the outline colour,
  and the vertex is pushed in clip space by a constant screen width:

  ```js
  const dir = pos2.xy.div(pos2.w).sub(pos.xy.div(pos.w)).normalize();
  return vec4(pos.xy.add(dir.mul(OUTLINE_PX).mul(pos.w)), pos.z, pos.w);
  ```

  - `mode:'center'` pushes boxes away from their centre; the default pushes along the normal.
  - `OUTLINE_PX = 2/(LINES*aspect), 2/LINES` makes the outline one game pixel at any resolution
    (`60-panel.js:120`).
  - Shells are child meshes that share the geometry (`40-characters.js:22`).

### 1.6 Rapier setup and the character controller

`SIM.reset()` (`30-physics.js:38-68`) builds everything in this order:
1. A new `World({x:0,y:-9.81,z:0})` with `timestep = STEP`. The previous world is freed first.
2. Fixed cuboids for the floor and for every wall and pillar.
3. Crates as dynamic cuboids: density 48 (about 20 kg), friction .7, restitution .05, angular damping .6,
   linear damping .2.
4. The hero, a `kinematicPositionBased` capsule (half height .55, radius .3) driven by
   `createCharacterController(.02)` with `enableSnapToGround(.3)`, `setMaxSlopeClimbAngle(50°)`,
   `setSlideEnabled(true)`, `setApplyImpulsesToDynamicBodies(true)` and `setCharacterMass(60)` (`:55-59`).
   Walking into a crate shoves it through the controller.
5. NPCs are fixed cylinder "posts" (`:63-65`).

`SIM.step(inp)` (`:70-113`) runs these phases:
1. Combo and dash timers.
2. Target velocity: a swing roots the hero to 25% speed plus a 1.4 m/s lunge while active; a dash is 11 m/s for
   0.16 s.
3. `E.approach` with acceleration 40, then manual gravity.
4. `computeColliderMovement`, then `setNextKinematicTranslation`.
5. Swing hits through `combo.hits()` in an arc (±1.3 rad, or all round for the spin). Each hit applies a
   mass-scaled `applyImpulse` and `applyTorqueImpulse` and makes Dan flinch.
6. `world.step()`.
7. Read back position, `moved` velocity (feeds the rig's stride) and facing via `E.approachAng`.
8. Dan's timetable.

One coupling to note: `SIM.reset` uses `THREE.Quaternion` (`:48`), so the sim imports the render library. The level
data also lives in `20-world.js`, which builds meshes and DOM canvases. Together these mean the sim cannot run in
plain Node as structured, even though the vendored Rapier itself runs fine there (verified: `init` takes 100 ms and
600 steps take 27 ms in Node 22).

### 1.7 Fixed 60 Hz step and state hash

- **The loop** (`60-panel.js:143-152`) is an accumulator. It runs `while (acc >= STEP && n < 6)`, calling
  `SIM.step(heroInput()); poseCast(STEP)` each time; after 6 steps the backlog is dropped. There is no interpolation
  between steps.
- **Rigs are posed in the fixed step**, so animation advances on sim time.
- **Input is plain data:** `{move:[x,z], attack, dash, speed?}`. It is mapped from keys through the camera's ground
  axes (`CAMS.ground()`), and presses are latched until the next step consumes them (`:36-47`).
- **The hash** is `hashNumbers([n, hero x,y,z,facing, every crate pos(3)+quat(4)])` (`30-physics.js:121-125`).
  Velocities, combo state, Dan and the figure are not included.
- **The proof** is `SIM.run(600)`: reset, then 600 steps of `SCRIPT(i, hero)`, which walks 6 waypoints for 100
  steps each, attacks every 24 steps from step 40 and dashes every 150. It runs before the loop starts
  (`60-panel.js:26-28`).
  - Measured: 129–136 ms cold and 34–40 ms warm.
  - The hash is `1917b7b9` on both backends.

### 1.8 Card vs Puppet

**Card** (`40-characters.js:191-235`) shows the 2D engine's own drawing on a quad that faces the camera.
- **The view.** `CAMS.cardView(p)` (`50-cameras.js:95-108`) supplies yaw, pitch, boost, `ppm` (pixels per metre of
  the 240-line frame) and the card's axes.
  - In perspective, yaw and pitch come **from each character's own direction to the camera**, so cards turn to face
    you, and `ppm` is computed at that character's depth.
  - `vert = 1+(k−1)·up.y²` cancels the projection's height boost on the card. The engine already drew the sprite
    boosted, so the 3D boost must not stretch it again.
- **The canvas.** The scale is `s = round(ppm/U·16)/16` (clamped .5–6). The canvas side `N` is the power of two
  above `extent·s` (64–512). The engine draws `rig.draw(g, N/2, .72N, view)`, then the swing trail is projected with
  `rig._lastView`.
- **The outline** is a 1-px dilation in the outline colour using the `source-in` trick (`:224-228`).
- **Placement.** The quad takes the camera's quaternion, is scaled to `N/ppm × N/ppm/vert`, sits with the rig's feet
  on its feet, and is nudged .45 m toward the camera so the floor can't cut it.
- **Lighting.** Cards get a blob shadow; scene lights don't reach them.
- **Weakness.** When `N` changes, a new `CanvasTexture` is made and `mat.needsUpdate = true` is set (`:205-210`).
  In perspective cameras that happens as characters move nearer or farther. The stress-world docs name exactly this
  as a stall source ("a remade texture stalls the frame").

**Puppet** (`:87-139`) hangs 3D parts, written as data, on the rig's joints.

Exact part-list format (`:8-15`):

```
['limb',  a, b, ra, rb, color]        tapered capsule a→b: open CylinderGeometry(rb, ra) + sphere caps at both ends (3 meshes)
['curve', a, b, bow, ra, rb, color]   3-segment limb bowed by bow·L·4u(1−u), away from 'shC' (Dan's scythes)
['ball',  a, r, color]                sphere
['eye',   a, r, color]                unlit sphere: no outline, no shadow
['sword']                             grip tube + guard box + blade box along J.bladeDir from J.handR, length rig.o.bladeLen,
                                      flat across the swing; colours rig.C.metal / rig.C.hilt
['cape']                              the rig's own verlet cloth (rig.capeL / rig.capeR) as a two-sided strip
                                      (C.cape outside, C.capeIn inside); built on the first frame with cloth, normals recomputed every frame
point := 'jointName'                  rig.J[name], in the rig's local frame [forward, right, up], engine units
       | [f, r, z]                    a literal local point
       | ['lerp', p, q, t]            between two points (nests)
       | ['off', p, df, dr, dz]       p moved in the body frame; for Humanoids through rig._offsets, so the face, hair
                                      and belt tilt with a mocap clip's head/body frames and with a knockdown
radii: engine units (÷16 at build time); color: a hex value, usually rig.C.<key> or DanRig.COL.<key>
```

- **The docs' example doesn't match the code.** `['limb','hipL','kneeL',1.45,1.2,'pants']` in `docs/LAB-3D.md:65`
  is schematic. The real line is `['limb','hip'+s,'knee'+s,1.45*lw,1.2*lw,C.pants]` (`:32`), and it passes a colour
  value, not a palette key. A literal `'pants'` would reach `THREE.Color` as an unknown colour name.
- **The bodies:**
  - `humanBody(rig)` sizes everything from `o.limbW`, `o.torsoW` and `o.headR`.
  - `danBody()` covers reverse knees, talons, tail segments, carapace spines, horns and egg sacs.
- **Posing.** `Puppet.update` sets `rig._cheat = 0` while it poses, because the 2D three-quarter turn cheat must be
  off in 3D, and restores it afterwards. Each point goes through `worldPoint = toThree(rig.x + rig._w(local))`.
  `placeTube` and `placeBox` orient the unit meshes. The swing trail becomes an additive, vertex-coloured ribbon
  (`makeRibbon`).
- **Cost:** 123 meshes for the hero, 117 for the figure and 257 for Dan, outline shells included (measured). Nothing
  is instanced.

**Both mode** draws the same camera twice, cards in the left half and puppets in the right, using viewport and
scissor (`60-panel.js:133-140`).

### 1.9 How the cast is driven (`poseCast`, `40-characters.js:254-273`)

**Hero.** `heroRig.update(dt, {x,y,z,vx,vy,facing,dash,attack: combo.state})`, fed from sim state in engine units.
The trail pairs come from `heroRig.trail`.

**Mocap figure.**
1. `LIBS = {HERO: Mocap.load(MOCAP.HERO), CMU: Mocap.load(MOCAP.CMU)}` loads the two sets.
2. A programme `FIG_CLIPS = [[set, clip, seconds|0], …]` lists 6 clips.
3. Whenever the set changes, `Mocap.drive(figRig, lib)` runs. It patches the rig's `update`/`_pose` so that after
   the rig's own pose, bones take the clip's directions at the rig's own lengths and two-bone IK places hands and
   feet. It also sets `mocapTilt`, which is what `_offsets` uses (`src/mocap/mocap.js:174`).
4. Each step:

   ```js
   FIG.pose = lib.sample(clip, t, FIG.pose); figRig.mocap = FIG.pose;
   figRig.mocapW = clamp(min(t/.25, (dur−t)/.25), 0, 1)   // 0.25 s fade in and out over the rig's idle
   ```

**Dan.** `new DanRig(null)` is Emberdeep's class, inlined by `@inline-head`, which takes the file up to its second
`/* ====` banner. The template's IIFE exposes `DAN_COL` as `DanRig.COL`.
- The sim gives Dan a timetable: every 150 steps (when `n%150 === 90`) a new `E.Attack` from `DAN_MOVES`
  (right cut, left cut, a two-handed whirl), a 0.9 s roar after the whirl, and a 0.3 s `hurt` when the hero's arc
  hits him.
- The rig input is `{x,y,z:0,facing,attack,dan:'roar'|null,hurt}`.
- While a swing is active, his trail pushes `[lerp(hand,tip,.4), tip]` pairs, at most 8.
- **The rig contract** (`40-characters.js:18`) is duck-typed: `J, x, y, z, _w, update, draw`, plus optional
  `_offsets`, `trail`, `capeL/R`, `C`, `o`.

### 1.10 Cameras (`50-cameras.js`)

- **The five engine views** (iso, three-quarter, top-down, brawler, side) are orthographic.
  - Framing matches the 2D engine: the height in metres is `LINES/(V.scale·U·zoom)`. The camera stands 40 m from
    the focus at the view's yaw and pitch. Q and E turn it 45°, and it follows the hero while you play.
  - **The height boost is exact and lives in the projection only** (`:34-40`):

    ```js
    _M.copy(cam.matrixWorldInverse).multiply(_S.makeScale(1, k, 1)).multiply(cam.matrixWorld);
    cam.projectionMatrix.multiply(_M);   // P' = P·V·S·V⁻¹, so P'·V·x = P·V·(S·x)
    ```

  - The effect is that world y is stretched by `zBoost` for the picture alone. Lighting, shadows and physics keep
    true heights, because three's lighting uses `modelViewMatrix`, not the projection.
  - Frustum culling stays correct: planes taken from P'V test S·x.
  - It needs `updateProjectionMatrix()` every frame, and `boost()` does that call.
- **Orbit:** perspective at 35° FOV; drag to turn and tilt, wheel for distance.
- **Fly:** 70° FOV, WASD plus Q/E, Shift for speed. It starts at the room's edge on the current view's side.
- **Chase:** 55° FOV. It swings behind the hero while he walks, and its position is only *clamped to the room box*
  (`:77`). It walks into pillars; the chase screenshot shows a pillar filling a third of the frame.
  stress-world ray-marches out of walls instead (`40-cameras.js:85`).
- **Cut-away walls:** walls whose outward normal faces the camera's ground direction (dot product > .3) swap to a
  .375 m twin. At pitch below 15° they disappear entirely.
- **`?cam=` codes** (`CAMS.code/load`, `:109-125`):

  | Mode | Code |
  |---|---|
  | engine views | `iso,turn,zoom,fx,fz` |
  | orbit | `orbit,yaw,pitch,dist,fx,fz` |
  | fly | `fly,x,y,z,yaw,pitch` |
  | chase | `chase,yaw,pitch,dist` |

  Values are rounded to 2 decimals. Loading checks the mode name and that values are finite, and clamps them.
  "Fix camera" writes the code into the address (commas left unescaped) and copies it to the clipboard.

### 1.11 Look options

| Option | Default | How it works |
|---|---|---|
| Pixels | on | Renders 240 lines (`setSize(round(240·w/h), 240)`) and upscales with CSS `image-rendering: pixelated`. The scale is **not** a whole number (×2.92 at 700 px), so pixels come out uneven. stress-world uses an integer scale (`50-frame.js:21`). |
| Outlines | on | Toggles visibility of every shell in `OUTLINES`. |
| Shadows | on | `sun.castShadow`, PCF, 2048² map. |
| Fog | off | Swaps between three `Fog` objects depending on camera type (`60-panel.js:111`). |

Other fixed choices: tone mapping is off, output is sRGB, and lights are a hemisphere fill, a sun and 4 flickering
torch point lights.

### 1.12 `window.__lab3d` and the address

- **API** (`60-panel.js:218-224`): `{ ready, backend, proof:{steps,hash,ms}, OPT, CAMS, SIM, CAST, scene, renderer,
  run(n), state(), hash(), set(key, value), camera(code), frames }`, plus `error` from `fail()`.
- **Gaps:**
  - `run(n)` resets the *live* world.
  - There is no pause, no manual step and no input injection.
  - `set()` writes any key without checking it, so `set('pixel', …)` fails silently.
  - `set('cam', 'foo')` falls into the chase branch.
- **Address options:** `?view=` (chase also turns play on), `?cam=`, `?look=card|puppet|both`, `?play=1`,
  `?pixels=0`, `?backend=webgl`.

### 1.13 Measured behaviour (headless Chromium, SwiftShader)

| Measurement | Result |
|---|---|
| Startup to ready | 0.7 s (WebGPU), 1.2 s (WebGL 2) |
| Frame rate at 1100×700, full resolution | 5–7 fps |
| Draw calls, WebGL 2, iso view, shadows on | 487 card, 1,225 puppet, 1,003 both |
| Scene contents | 624 meshes, 6 lights |

The draw-call count comes from the 6-group boxes per wall cell, the shells and the shadow pass. Nothing is merged
or instanced.

Console warnings on every load:
- Rapier compat's own `init` warns "using deprecated parameters". The compat build's `init()` always passes bytes,
  even with no arguments, so this happens in Node too.
- `THREE.TSL: Vertex attribute "normal" not found`, raised by the trail ribbon `BufferGeometry` (position + colour
  only) when puppets are shown.
- WebGL only: "GPU stall due to ReadPixels". This is consistent with three accelerated 2D card canvases being
  uploaded every frame.

The tests ignore warnings.

---

## 2. lab3d vs stress-world: duplication, divergence, and which to pick

**Copied verbatim between the two:**
- `bake`, `TOON_BANDS` and the inverted-hull `outlineMat` (stress-world `00-setup.js:80-116`).
- `hashNumbers` (`:59-63`) and `toThree`.
- The crate texture function (`30-crowd.js:293` = `TEX.crate`).
- In the tests, the `BANNED` list, `standInCanvas` and the vercel-rewrite server (diffed: identical).
  `tools/labs-test.mjs` has a third copy of the server.

| Concern | lab3d | stress-world | Pick, and why |
|---|---|---|---|
| Units and axes | Metres, y up for sim, physics and render. Engine units only inside rigs. | Engine units, z up for sim and physics (`world.lengthUnit = 16`, gravity −480 z, `cc.setUp(z)`, `20-sim.js:121,130`). Metres only at draw time. | **lab3d.** One right-handed metre/y-up convention, the default for three, Rapier and glTF, and well known to models. No `lengthUnit` knob to forget and fewer axis-swap sites. stress-world's reason (matching 2D reaches exactly) doesn't apply to a 3D-only engine; convert rig data once during the port. |
| Loop | True fixed 60 Hz accumulator; live play equals proof semantics. | Equal sub-steps of at most 1/60 per frame (`50-frame.js:83`): live play depends on frame rate; only the proof uses exactly `STEP`. | **lab3d.** Needed for replays and reproducible agent sessions. Add render interpolation. |
| Physics features | Walk, dash, crate pushing, NPC posts. | Jump, autostep, stairs and slopes, collision-group bitmasks, dynamic monsters (crowd resolution with no separation code), launches, solver iterations. | **stress-world features on lab3d's conventions.** |
| Level text | 8 glyphs, flat. | Heights, galleries, stairs, dais, walkable grid, flow field. | **stress-world's content, lab3d's simplicity.** Make the legend a registry (`tile(char, spec)`). |
| Static geometry | One mesh per cell, 6 material groups each. | Similar meshes, richer props. | **Neither.** Merge static level geometry per material. |
| Lights | Small fixed set; shadow and fog toggles. | Fixed set (30 torches, 2 shadow casters reassigned to the nearest), so "shaders never rebuild". | **stress-world.** |
| Puppet format | **Declarative part list**, per-part meshes, uses `_offsets` (mocap head and body tilt). | Imperative `humanParts()` writing into instanced `Batch.tube/ball/box/cone` (`30-crowd.js:20,98`). Thousands of characters; no `_offsets`; more rig styles; hit flash. | **lab3d's format, compiled per frame into stress-world's batches.** The data is easy for agents to extend; batching makes it scale. |
| Cards | Per-character canvas and texture; correct per-character angles in perspective; boost-aware `vert`; remade texture when the size changes. | Fixed atlas pages, instanced quads, one shader, warm-up (`30-crowd.js:214`); every card drawn from the camera's turn and tilt (`40-cameras.js:135`). | **stress-world's atlas plus lab3d's per-character angle and `vert`.** Cards are only worth having if the 2D sprite drawing comes across with the animation system; otherwise drop Card mode. |
| Outlines | Shells as child meshes. | Shells share the batch's `instanceMatrix` (`30-crowd.js:32`); thickness follows card detail. | **stress-world.** Also consider a screen-space ID/depth edge pass (§3). |
| Cameras | Exact boost, compact `?cam=` codes, chase clips through pillars. | Perspective or ortho engine views (**boost dropped**), depth rail, chase with wall avoidance, first person, fly, fixed, shake. | **stress-world's set plus lab3d's `boost()` and code format.** |
| Pixel pass and filters | 240 lines, non-integer CSS scale. | Integer scale; TSL cel, pixel (Bayer), bloom and FXAA with an MRT mask. | **stress-world.** |
| Fog | Swaps 3 `Fog` objects, which changes material node graphs. | One fog whose near and far follow the hero's distance. | **stress-world.** |
| Shader warm-up | None. | `warmUp()` (`50-frame.js:32`), and the test asserts no pipelines are built mid-fight. | **stress-world.** |
| Agent API | Small: `run/state/hash/set/camera`. | Larger, includes `step(n, o)` (inputs every n steps). | **Union, with strict validation.** |

---

## 3. The free-camera room and its fly renderer

**`free-camera.game.js` (335 lines)** is a 2D-engine page: a free orthographic `E.View` (turn, tilt, zoom, height,
boost), presets, Fix, `?cam=yaw,pitch,zoom,height,boost,fx,fy` and copyable `game.setView(...)` code. Real 3D
cameras make it obsolete.

**`free-camera.fly.js` (247 lines)** is a CPU software rasterizer behind `FlyCam(canvas, room) → {resize, render,
collide}`. Its pipeline:
1. **Polygons and culling.** Static polygons come from the TileMap cells: floor, wall sides and tops (`:30-43`).
   Each polygon is back-face culled with a plane test against the camera (`:107`).
2. **Camera space and clipping.** Points go into a camera basis `r/u/f`. **Near-plane clipping** is
   Sutherland–Hodgman against z = .5 (`:110-118`). There is no side or far clipping; bounding-box clamping is used
   instead.
3. **Projection and raster.** Points are projected with `F = (H/2)/tan(fov/2)` and the polygon is fan-triangulated.
   Rasterizing uses a bounding box plus incremental barycentric edge functions (`:126-154`).
4. **Depth.** A depth buffer on 1/z (Float32; larger is nearer).
5. **Perspective-correct shading** (`:146-149`). World x, y, z are interpolated as `q/z` and divided by the
   interpolated `1/z`. Shading is procedural per pixel (wall bricks re-derived from world coordinates), or a lookup
   into the floor baked at 1 texel per unit. There is no mipmapping, so the far floor shimmers.
6. **Extras:**
   - distance fog
   - blob contact shadows on the floor
   - Doom-style sprites at a single depth for the hero and flat props, alpha-tested (`:158-169`)
   - **outlines from an ID buffer plus depth discontinuities** (`:172-181`)
   - circle-vs-box camera collision (`:227-242`)

**Quality.** It is correct where it matters: perspective-correct interpolation, near clipping and a z-buffer. It is
also compact and readable. Measured cost is 11.6–13.6 ms median per frame at 283×180 and 424×270, with
~1,600–1,700 polygons, most of them from the 183-box converted crate. Its limits: no top-left fill rule, no
filtering, no lighting beyond baked face tones, and it is tied to TileMap types, `E.tones` and `E.shade`.

**Is it worth keeping?**
- **Not as a reference renderer.** It draws a different scene representation with different shading, so it can't
  validate three.js output.
- **Not for GPU-free image diffs.** SwiftShader already runs the real WebGPU and WebGL 2 paths headless.
- **It is no longer needed as the fallback** `LAB-3D.md:172-174` anticipated, since three met the rules.
- **Verdict: DROP the code and keep two ideas.**
  1. **ID-buffer edge outlines.** As a TSL post pass over an MRT id/depth target, this gives uniform 1-px ink for
     every mesh: instanced, skinned or batched, with no per-mesh shells. Inverted hulls roughly double draw calls.
  2. **A ~150-line CPU ID/depth raster of the simplified scene** (colliders or boxes) that runs in Node. It can
     answer "is the hero visible from camera X?", "what fraction of the frame does each entity cover?" and produce
     ASCII thumbnails. That would give agents a fast eye that needs neither a browser nor images.

**`shapes-raster.js` and `shapes-compare.*`:** these draw boxes converted from CC0 KayKit and Kenney models (for
example, a 1,196-triangle crate becomes 183 boxes, 4.3 KB). They break principle 1, and the "Shapes library" plan
was dropped. **DROP.**

---

## 4. Vendoring (`tools/vendor-3d.mjs`)

**How it works.**
- `LIBS` (`:15-22`) pins each package and version and maps package files to vendored names:
  - three: `build/three.{core,webgpu,tsl}.min.js` plus `LICENSE`
  - Rapier: `rapier.mjs` is saved as `rapier.js`, so every static server sends it as JavaScript. Its `LICENSE` is
    curled from GitHub at tag v0.19.3, because the npm package doesn't ship one.
- Fetching (`:40-55`):
  1. `npm pack pkg@ver` into a temp directory.
  2. `tar xzf`.
  3. Copy the files.
  4. Write `VERSION.json` with package, version, release date, licence, source, note, and `files: {name: {bytes,
     sha256}}`.
- `--check` (`:25-39`) works offline. It checks that `VERSION.json`'s version matches `LIBS`, that every listed file
  exists, and that each sha256 matches. `tools/lab3d-test.mjs:25` runs it.

**Weaknesses.**
- **Checksums are recorded, not expected.** Re-vendoring trusts whatever npm served at the time. Neither `LIBS` nor
  the tool pins the npm `dist.integrity` (sha512 of the tarball), so `--check` only catches local edits, not
  supply-chain substitution.
- **The release dates are typed in by hand.**

**Sizes:**

| File | Bytes | Gzipped |
|---|---|---|
| `three.core.min.js` | 380,922 | 100 KB |
| `three.webgpu.min.js` | 616,351 | 171 KB |
| `three.tsl.min.js` | 23,117 | 6.5 KB |
| `rapier.js` (wasm embedded as base64) | 2,308,827 | 863 KB |

Total: about 3.33 MB raw, 1.14 MB gzipped.

**Import map** (`lab3d.template.html:83-92`):
- `three` and `three/webgpu` both map to `/vendor/three-0.182.0/three.webgpu.min.js`. Using one instance avoids
  dual-package hazards.
- `three/tsl` maps to `three.tsl.min.js`. That file re-exports `THREE.TSL` and imports the bare specifier
  `three/webgpu`, so it needs the import map.
- `three.webgpu.min.js` imports `./three.core.min.js` by relative path.
- Paths are absolute (`/vendor/`), so the page must be served from the repo root, not double-clicked.
- The test checks that every map entry starts with `/vendor/` and exists on disk (`lab3d-test.mjs:44-50`).

**Why r182 and 0.19.3** (`LAB-3D.md:27-29`): "Not the newest on purpose … releases with plenty of examples in
[models'] training, so an agent writes working code first time." r180 and later have a mature `WebGPURenderer` and
TSL. For context, as of today npm has three 0.186.1 and Rapier 0.21.0.

**What of three is used.**
- lab3d uses roughly 40 `THREE.*` names: `WebGPURenderer`; Lambert, Basic and Toon node materials; standard
  geometries; `CanvasTexture`/`DataTexture`; hemisphere, directional and point lights; ortho and perspective
  cameras; `Fog`; math classes. From TSL it uses only `Fn, vec4, uniform, positionLocal, normalLocal,
  modelViewMatrix, cameraProjectionMatrix`, for the outline.
- stress-world adds `InstancedMesh`, `InstancedBufferAttribute`, `PostProcessing`, `Frustum`, `Raycaster` and about
  20 TSL nodes (`pass, mrt, output, rtt, select, smoothstep, luminance, saturation, sRGBTransferOETF, …`).
- **Neither uses addons.**

**Recommendations.**
1. Keep the tool, exact pins and `--check`.
2. Add `integrity` to `LIBS` and verify it after `npm pack`.
3. **Vendor the type definitions too**, so agents get static API checking (`tsc --checkJs`) instead of guessing:
   `@types/three@0.182.0` exists, and Rapier ships `rapier.d.ts` (both verified on npm).
4. Generate the import map from `LIBS`, so there's a single source of truth.
5. Decide between SIMD and deterministic Rapier. `@dimforge/rapier3d-deterministic-compat@0.19.3` exists and has the
   same API. The SIMD build isn't promised to give identical results across machines.
6. Consider also vendoring the non-minified three builds behind a `?debug=1` import-map switch, for readable stack
   traces.

---

## 5. Test tooling for 3D (`tools/lab3d-test.mjs`, 156 lines; about 81 s measured)

**What it does, step by step.**
1. **Vendor check.** Runs `vendor-3d.mjs --check`.
2. **Banned APIs.** It scans `src/lab3d/*.js` and the template line by line, after stripping comments with
   `/\/\/.*$|\/\*.*?\*\/|^\s*\*.*$/g` (`:40`):

   ```
   /\bWebGLRenderer\b/                                                     use WebGPURenderer
   /\b(Raw)?ShaderMaterial\b/                                              write node materials or TSL
   /\bonBeforeCompile\b/                                                   not run by WebGPURenderer
   /\bEffectComposer\b|three\/examples|three\/addons/                      addons not vendored; post is TSL
   /\bcompute\s*\(|\bStorageBufferAttribute\b|\bstorage\s*\(|\bcomputeAsync\b/   WebGPU-only compute/storage
   /readRenderTargetPixels|getImageData\s*\(|readPixels\s*\(/              no GPU read-back into gameplay
   ```

   This is text matching, so it is easy to bypass (`THREE['WebGL'+'Renderer']`). It misses WebGPU-only TSL such as
   `instancedArray`, `attributeArray`, `textureStore` and atomics. It also flags harmless CPU `getImageData`.
3. **Import map.** Every entry must be local (`/vendor/`) and must exist.
4. **Server.** A static server emulates `vercel.json`'s rewrites (`:53-65`).
5. **Browser.** Chromium launches with `--enable-unsafe-webgpu --enable-features=Vulkan --use-vulkan=swiftshader
   --use-webgpu-adapter=swiftshader --disable-vulkan-surface` (`:71`).
6. **Stand-in canvas for WebGPU** (`standInCanvas`, `:74-102`, installed with `addInitScript`). Headless Chromium
   loses the WebGPU device as soon as it presents to a canvas, so:
   - `getContext('webgpu')` is patched to return a fake context: `configure` / `unconfigure` / `getConfiguration`,
     and `getCurrentTexture` returning a plain texture with `RENDER_ATTACHMENT | COPY_SRC`.
   - `requestAnimationFrame` is wrapped to wait for `queue.onSubmittedWorkDone()`, to mimic a real canvas's back
     pressure.
   - `__readFrame(scale)` copies the texture to a mappable buffer (bytes per row aligned to 256), swizzles BGRA,
     and returns a PNG data URL.
   - The whole WebGPU pipeline runs; only presenting is skipped.
7. **Per backend** (`?backend=webgl`, then WebGPU):
   - wait up to 90 s for `ready || error`
   - check the claimed backend
   - **check `proof === run(600)`** (repeatable)
   - take 11 pictures (cameras × looks), each after 20 more frames; it **fails if a PNG is under 25,000 bytes**
   - play: hold W for 700 ms, press J six times, hold D, press Space; it **fails if the hero moved under 0.5 m**
   - fail on page errors and `console.error`
8. **Backend parity.** Finally, the WebGL 2 hash must equal the WebGPU hash. Results go to
   `check-output/lab3d/results.json`.

**Fragile or weaker than it looks:**
- **The parity proof can't see coupling through the render loop.** `SIM.run` is synchronous and runs with no
  rendering in between, both at boot and via `__lab3d.run`. Both backends also run the same V8. So the parity holds
  by construction. A renderer that wrote into gameplay state from inside the render loop (for example in
  `Card.draw` or `syncCrates`) would not be caught.
  - The real test would record the sim inputs during live, rendered play and replay them headless with no renderer.
  - There is also **no golden hash**. Changes to gameplay or Rapier go unnoticed unless they break parity.
- **Missing WebGPU still passes.** If WebGPU is unavailable, the WebGPU run becomes a *note* (`:118`) and the test
  passes with WebGL 2 only. The Chromium flags change between versions, so this is a real risk.
- **The pictures can't be compared.** The WebGL "pictures" are page screenshots *with the HTML panel covering about
  30% of the canvas*. In Both mode that hides the puppets entirely; I checked. The WebGPU pictures are raw canvas
  readbacks at 1131×720. There are no goldens and no image diffs, so an agent has to look at them by eye.
- **Wall-clock timing.** Key holds are timed in real time, but the sim only advances while frames render. Under
  SwiftShader that is 5–7 fps, and the clamp of 6 steps per frame slows sim time further. This is flaky on slow
  machines, and it is also why the test takes 81 s.
- **Duplication and private APIs.** The harness is duplicated in `stress-world-test.mjs`, which also reads the
  private `renderer._pipelines.caches` to count pipelines.
- **Coverage map holes.** `test-run.mjs:27` maps the lab3d suite to `src/lab3d`, `vendor/` and a few tools. It
  misses `src/mocap/` and `src/emberdeep/22-char-dan.js`, both of which are inlined into the page. Run directly,
  the suite tests the *built* page and doesn't rebuild it; `test-run.mjs:91` does build first.

---

## 6. The build system (`tools/build.mjs`, 111 lines)

**How it works.**
- **Inputs.**
  - A list of builds, `{template, out, vars, compact?, parts?}` (`:30-59`): 11 pages under `examples/`, the starter
    single-file builds `dist/my-3d2dge.html` and `-compact.html`, and genre kits `dist/kits/my-3d2dge-<genre>.html`
    (minified engine plus one slice).
  - Global variables: `{{VERSION}}` from `package.json`, and `{{BUILD}} = 'dev-build'`. That placeholder is replaced
    only at deploy time by `tools/stamp.mjs` (Vercel's `buildCommand`), so the repo's copies still rebuild byte for
    byte.
- **Directives**, applied as sequential regex passes over the whole HTML, in this order (`:80-101`):

  | Directive | What it inlines |
  |---|---|
  | `{{KEY}}` | variable substitution |
  | `<!-- @inline-raw FILE -->` | the file's raw text (for example `labs.json` into a `const`, or `API.md`) |
  | `<!-- @inline-parts DIR -->` | `DIR/*.js` sorted by name, as one classic `<script>`; the kits filter parts |
  | `<!-- @inline-module DIR -->` | the same, as one `<script type="module">` with a shared scope |
  | `<!-- @inline-head FILE -->` | the file up to its second line matching `^/\* =+$`; throws if there are fewer than two |
  | `<!-- @inline FILE -->` | `<script>` with the file, using the terser-minified engine when `compact` |

  `read()` escapes `</script` as `<\/script`.
- **Outputs.** It also copies `dist/my-3d2dge.js` and `dist/my-3d2dge-agent.js`, and writes `dist/my-3d2dge.min.js`
  when terser is installed. `examples/scarfrunner-side.html` is not built; it is a static file.

**Determinism.** There are no timestamps, `readdir` output is sorted, and all outputs are committed. **Verified:**
rebuilding all 11 example pages plus `dist/my-3d2dge.html`, `.js` and `-agent.js` produces byte-identical files.
Three caveats:
- **Terser-dependent outputs** (compact, kits, min) depend on terser `^5.51.2`, a caret range, and **there is no
  lockfile**, so a new install can change them.
- **Without terser the build silently skips those outputs** after one warning, which leaves stale committed files.
- **Later passes re-scan inserted text.** Because passes run in sequence, inlined text containing a directive would
  be expanded by a later pass. `@inline-head` slices another game's file by comment banners: adding a banner to
  Dan's file would silently cut it somewhere else.

**For a 3D-first, agent-maintained repo:**
- **Development: native ES modules with explicit `import`/`export`, an import map, no build step.** Edit, reload,
  test. This removes the whole class of "test ran against a stale build" mistakes.
  - Explicit exports also allow `// @ts-check` plus JSDoc and `tsc --noEmit --checkJs`, using the vendored three and
    Rapier `.d.ts` files. Agents get type errors, missing-export errors and API-misuse errors right away, which is
    stronger than the regex banlist.
  - Inline modules give no benefit here: modules plus an import map already need HTTP, so the double-click argument
    for single-file pages is gone.
- **Release: keep a tiny repeatable bundler.**
  - Concatenate the engine's modules in dependency order, with headers, into `dist/engine.js`.
  - Produce an **agent edition**: one readable file with the API card plus the engine source, for handing to an LLM.
    The vendored libraries are excluded; models never read minified code.
  - Optionally produce playable demo pages.
  - Pin dev dependencies exactly and commit a lockfile.
  - Add `build --check` (rebuild in memory, fail on any difference), or stop committing build output.
- **Drop:** kits, slices, compact builds, `@inline-head`, `@inline-parts`, Vercel rewrite emulation in tests, and
  committed `examples/`.
- **Keep:** the version label shown in pages (`{{VERSION}}` plus a deploy stamp) and the changed-file suite
  selection (`test-run.mjs`). Derive the selection from the real module import graph instead of hand-written path
  prefixes.

---

## 7. Classification

| Item | Grade | Verdict | Why |
|---|---|---|---|
| `lab3d/00-setup.js` | Engine-grade parts | Port with changes | `hashNumbers` → engine state hash (consider float64 bits); the `fail()` pattern → engine error surface. `toThree`/`toEngine` disappear with a single convention. |
| `lab3d/10-materials.js` | Engine-grade | Port with changes | The texture-function convention and `bake` → bake to a `Uint8Array`/`DataTexture`, which needs no DOM and can be hashed and tested in Node. Keep the toon bands and material cache. Keep the outline TSL, but write it once and make it instance-aware. |
| `lab3d/20-world.js` | Engine-grade concept | Port with changes | Level-as-text with colliders from the same map. Needs a registry legend and heights. Merge static geometry. Split pure level data from mesh building. Keep cut-away, generalised. |
| `lab3d/30-physics.js` | Engine-grade pattern | Port with changes | Keep `step(input)` / `run(n)` / hash, the KCC setup and impulse-on-hit. Remove the THREE dependency. Hash the full state. Add collision groups, jump and autostep from stress-world. `LAP`, `SCRIPT` and `DAN_MOVES` are lab-only. |
| `lab3d/40-characters.js` | Engine-grade core | Port with changes | The puppet part list plus `_offsets`, compiled to instanced batches. Colours as palette keys. Cape strip and ribbon pooled, and give the ribbon normals or a material that doesn't need them. `humanBody` becomes the default humanoid body. `danBody` is Emberdeep: drop it, or keep it as a test fixture. The card works only with a ported 2D sprite drawer. |
| `lab3d/50-cameras.js` | Engine-grade parts | Port with changes | `boost()` as is. Camera codes become general camera serialisation. Merge with stress-world's chase, first-person, rail and shake. |
| `lab3d/60-panel.js` | Lab-only (loop is engine-grade) | Rewrite | Keep the fixed-step accumulator and add interpolation. `__lab3d` becomes a validated engine-wide agent API. The panel is lab UI. |
| `lab3d.template.html` | Lab-only | Rewrite | Keep the import-map pattern and the error/loading panel. |
| `free-camera.fly.js` | Lab-only | Drop (keep ideas) | See §3. |
| `free-camera.game.js`, `.template.html` | Lab-only | Drop | A 2D orthographic camera explorer, superseded. |
| `shapes-raster.js`, `shapes-compare.*` | — | Drop | Imported model data breaks principle 1; the plan was dropped. |
| `lab.game.js` / Perspective Lab | — | Drop | A 2D starter. Keep the "smallest complete game to copy" idea. |
| `labs.json` + labs page + `labs-test` | Process pattern | Port with changes | The temporary-lab registry with date and question is great for agents. **Add an `answer`/`status` field**; today answers live only in CHANGELOG and `LAB-3D.md` prose. |
| `tools/lab3d-test.mjs` | Engine-grade tooling | Port with changes | One shared harness. Fail on missing WebGPU. Golden hashes. Replay-with-render test. Same-size canvas captures on both backends with image diffs. Sim-time stepping. Allowlisted warnings. |
| `tools/vendor-3d.mjs` + `vendor/` | Engine-grade | Keep as is, plus additions | Integrity pins, types, generated import map, deterministic build option. |
| `tools/build.mjs` | Tooling | Rewrite | Native-ESM development plus a small repeatable release bundler (§6). |
| `stamp.mjs`, `version.mjs`, `test-run.mjs` | Tooling | Port with changes | Simplify; derive suite coverage from imports. |

**What each temporary lab answered** (`src/labs.json` records only the question):
- **Shapes vs props:** No. Converted models cost too many boxes, and the Shapes plan was dropped.
- **Free camera room:** Any orthographic view works live in the 2D engine, but first person needs a renderer of its
  own. That led to the 3D lab.
- **3D world lab:** Yes. Built in v0.9.0, with parity on both backends. It led to `/stress-3d` (retired in v0.14
  because it was "flat" 3D that paid three's weight) and to `/stress-world`.
- **Stress-world:** It holds up: 1 ms per step at 100 monsters, 5.6 ms at 1,000 and 33 ms at 5,000
  (`LAB-3D.md:253-255`). The "hand it to a fresh agent" judging test in `LAB-3D.md:164` has no recorded result.

---

## 8. Quality problems and improvement ideas for an agent-maintained engine

1. **Implicit scope across concatenated parts.** Neither tools nor agents can see the dependencies. Use ES modules
   with explicit imports, `@ts-check` and vendored types; lint `no-undef`.
2. **Rig drawing changes the pose.**
   - The problem: `Humanoid.draw` sets `_pitch` (which picks side-plane swings, `my-3d2dge.js:1838`), `_camSide`
     (which hand waves, `:1965`), `_cheat` and `_lastView`. That is why `Puppet.update` must save and restore
     `_cheat`, and why the puppet's pose in Both mode depends on the card's camera.
   - The fix: make the pose a pure function of sim state plus explicit camera hints, and add a test that checks
     `draw()` leaves the pose unchanged.
3. **Sim tied to render and DOM** (`THREE.Quaternion`, level data next to mesh building).
   - Split them so `node tools/sim.mjs --proof` runs the sim, hash and scenarios in plain Node in about 100 ms.
     Rapier already runs there.
   - This becomes the agents' fast inner loop.
4. **Determinism has limits.**
   - Same-browser parity is not cross-machine determinism. ECMAScript leaves `Math.sin/cos/atan2/exp/hypot`
     results up to the implementation, and SIMD Rapier is not promised to give identical results everywhere.
   - If replays must travel between machines or browsers, use the deterministic Rapier build and keep transcendental
     maths out of the sim, or use the engine's own approximations.
   - Record **mapped sim inputs**, not keys, and hash the **full state**: velocities, combo and AI state, all bodies.
5. **The agent API should be strict and deterministic:**
   - `pause()`, `step(n, inputs)`, `snapshot()` / `restore()`
   - `setCamera(json)` that throws on bad input
   - per-entity screen boxes
   - a text dump of the scene graph
   - captured console warnings
6. **Performance basics belong in the engine, not the labs:** merged static geometry, instanced puppets and cards,
   a pipeline warm-up, a fixed light set, and no fog or shadow toggles that rebuild shaders. Count pipelines through
   a public hook; private three APIs drift between versions.
7. **Outlines:** choose between inverted hulls and a TSL screen-space ID/depth edge pass (§3), write it once, and
   test its width at both resolutions.
8. **Data formats should be data.** Puppet colours should be palette keys. Part lists need schema validation, so
   mistakes give clear errors instead of black parts. Legends should be registries. Docs examples should be code
   that tests check; the `'pants'` example has already drifted.
9. **Size.** Load mocap clips on demand. The lab ships 722 KB of CMU data to play 4 clips.
10. **Hygiene:** fix the ribbon's missing normal, allowlist Rapier compat's deprecation warning, fail tests on new
    warnings, and make `vendor --check` and `build --check` part of `test`.
11. **Visual checks agents can read.** Replace "not blank by byte size" with:
    - canvas captures at a fixed small size (e.g. 320×240) on both backends, plus a WebGL 2 vs WebGPU diff
      threshold
    - goldens updated with `--update`
    - a JSON summary per shot: entity coverage from an ID pass, and whether characters are on screen
