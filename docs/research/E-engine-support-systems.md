# E: the engine's non-animation systems, and what to carry into my-3dge

**Source:** `engine/my-3d2dge.js` v0.14.0 (4,652 lines, 374,022 bytes) in `/home/user/michaelcrosato/my-3d2dge`. All paths below are relative to that repo, and line numbers are for that file unless another file is named.

**Also read:**
- the header of `engine/my-3d2dge-agent.js` (lines 1-347), `API.md` and `AI_GUIDE.md`;
- `src/emberdeep/70-audio.js`, `61-controls.js` and `93-autopilot.js`;
- `src/lab3d/10-materials.js`;
- `src/stress-world/00-setup.js`, `10-hall.js`, `20-sim.js`, `35-effects.js` and `40-cameras.js`;
- `tools/agent-test.mjs`, `check.mjs` and `docs/CONTROLS-AUDIT.md`.

**Token sizes** are bytes/3.5, as the brief asks. That figure undercounts this code. The repo's own cl100k counts in README.md (agent edition 83k, full engine 140k) are about 1.3 times my bytes/3.5 figures (62k and 107k), because the dense one-line style tokenizes poorly. For real budgets, multiply by about 1.3.

---

## 0. Bottom line

- **Port nearly as written** (pure logic or data, about 10k tokens):
  - the seeded RNG, hash and noise;
  - the colour ramps (`tones`, `ramp`, `shade`);
  - `E.store`;
  - warn-once and the error overlay;
  - `parseLevel` and `E.pattern`;
  - the SFX, drum and song data;
  - the pixel font (for the HUD and the debug overlay);
  - `E.ui` boxes and bars, and the Dialog and Menu state machines.
- **Port with changes:**
  - **Input** becomes actions plus axes, with a camera-relative intent layer, scripted injection, record and replay, pointer lock and rebinding.
  - **The chip synth** becomes seeded, renders offline, gains 3D panning and procedural reverb, and gets layered music.
  - **`E.tex`** becomes seeded, tileable material generators. Each one returns a height value, from which the normal and roughness maps are built.
  - **The flow field**: take stress-world's Dijkstra version with climb limits.
  - **SpatialHash** gets a 3D key and typed arrays.
  - **Bullets** move to 3D vectors with swept tests.
  - **The Platformer controller's feel parameters** move onto Rapier's character controller.
  - **The Backdrop strips** become sky cylinders.
- **Concept only:**
  - the WebGPU lighting module's discipline: feature detection, fallback, a status value and offscreen snapshots;
  - its look tricks: light bands with dither, heat shimmer and glow spill;
  - the renderer's effect vocabulary: outline, flash, afterimages, x-ray, decals, `textAt`;
  - TileMap's cut-away walls and contact AO;
  - the props catalog, rebuilt as meshes;
  - the view and resolution presets.
- **Drop:** pixel primitives as a world renderer, canvas lighting, the painter's-order renderer, the drawing and collision of TileMap and PlatformMap, Body (Rapier replaces it), `E.style` and `charView`.
- **Documentation:**
  - Copy "the header is the manual", with executable examples and warnings that list the valid options.
  - Fix four gaps: the code in API.md is not tested, five documents overlap, the banner numbering is out of order, and the dense style costs tokens.

---

## 1. Core helpers (section 1, lines 58-204, about 2.7k tokens; the rig math in `V3` and `ik3` is covered by another report)

### 1.1 RNG, hash and noise (Q4)

The names are `E.rng`, `E.hash2` and `E.noise2`. There is no `E.noise` or `E.hash` in either engine edition.

```js
function rng(s) { return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }   // :85
function hash2(x, y) { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }   // :86
function noise2(x, y) { /* smoothstep-blended hash2 lattice */ }   // :87-90
```

- **`E.rng(seed)`** is Mulberry32: it returns a closure that gives numbers in [0, 1), with period 2^32.
- **`E.hash2(x, y)`** is an integer hash. It truncates its inputs with `|0`, takes no seed, and returns [0, 1). Callers decorrelate it by adding offsets, for example `hash2(i + 7919, seed)` at :1211.
- **`E.noise2(x, y)`** is 2D *value* noise, not gradient (Perlin or simplex) noise. It has no octave helper (callers hand-roll two octaves, as in `noise2(x*.07, y*.07)*.65 + noise2(x*.23, y*.23)*.35` at :3071), no 3D version, no period and no seed.
- **`E.bayer(x, y)`** (:91-92) returns the 4×4 ordered-dither threshold.
- **`smoothDamp(cur, target, vel, smoothTime, dt)`** (:93-96) returns `[pos, vel]`. It is a critically damped spring in the style of Unity's function of that name.
- **Other math** (:72-84): `approach`, `angDiff`, `lerpAng`, `approachAng` and `ease.{outCubic, outQuad, inQuad, inOut, outBack}`.
- **`E.rand(a, b)`, `randInt`, `pick` and `chance`** (:180-184) use **`Math.random`**, so they are unseeded. The deterministic 3D simulation had to use `E.rng` instead (`src/stress-world/20-sim.js:122`: `SIM.rnd = E.rng(seed)`).

**Verdict: PORT-WITH-CHANGES → `core/random.js`.**
- Keep `rng` and `hash2` bit-exact, so that existing content reproduces. The hall's `floorTex` in `src/stress-world/10-hall.js:208` is an example.
- Add `hash3`, seeded `noise2` and `noise3` with an optional period (for tileable bakes), `fbm(…, octaves, lacunarity, gain)` and Worley (cell) noise for cracks and cobbles.
- Add named seeded streams, for example `E.random.stream('loot')`. Make the default `rand`, `pick` and so on seeded.
- Test that gameplay code never calls `Math.random`. The labs already scan for banned APIs.

### 1.2 Colour and palette (Q4)

| Call | Lines | What it does |
|---|---|---|
| `E.hex(h)` | 98-105 | Turns `'#rrggbb'`, `'#rgb'` or `[r,g,b]` into `[r, g, b]`. A bad value warns once and draws magenta: a loud failure. |
| `E.toHex([r,g,b])` | 106 | Back to hex. |
| `E.shade(hex, a)` | 108-114 | Darkens or lightens for a in -1..1. Darker drifts the hue toward 250° (cool) and lighter toward 55° (warm), by up to 24°×abs(a). Greys keep their hue. Results are memoized and the cache is cleared at 2,000 entries. |
| `E.mix(a, b, t)` | 115 | Lerp in sRGB, returning hex. |
| `E.toHsl(hex)`, `E.hsl(h, s, l)` | 142-154 | Hue in degrees, saturation and lightness in 0..1. |
| `E.tones(hex, strength = 1)` | 161-169 | Returns five hue-shifted shades, `{ deep, sh, base, lt, hi }`. Skin, sand and cream (lightness above .62 with hue below 50 or above 340) get dusky, desaturated shadows near 280°. |
| `E.ramp(hex, n = 5, strength = 1)` | 171-175 | Returns n hue-shifted shades from dark to light. |

**Quality:** this is the engine's best idea for directing art in code. Every procedural texture, wall, prop and backdrop shades through `tones()`, so one base hex gives a coherent palette. stress-world already feeds it into its 3D textures (`src/stress-world/10-hall.js:226`).

**Smells:**
- All the colour math works in gamma (sRGB) space.
- Colours are strings, parsed again on every use. `E.tex.grass` calls `hex()` per pixel (:3073-3076).
- The caches are cleared all at once when they reach their size cap.

**Verdict: PORT-AS-IS → `core/color.js`.** Add:
- `toLinear` and `toSRGB`;
- `E.color(hex)` → `THREE.Color` (node materials expect linear colour);
- a `palette`/`theme` object that turns a few base hexes into tones, shared by materials, sky, props and UI.

### 1.3 Gameplay helpers (lines 185-196)

`dist(a, b)` (3D), `angleTo(a, b)` (on the ground), `overlap(a, b)` (ground circles), `overlapBox(a, b)` (side-view boxes), `inArc(a, facing, b, range, halfAngle)` (melee cone) and `prune(list, fn)` (in-place filter).

**PORT-WITH-CHANGES → `core/math.js` and `world/query.js`.**
- Keep `prune`, `dist` and `inArc`, and add a height band to `inArc`. stress-world already wrote an `inArc3` (`20-sim.js:271`).
- Replace `overlapBox` with sphere and capsule tests.

### 1.4 Save data: `E.store` (lines 197-202, about 145 tokens)

```js
const store = { get(key, fallback = null) { try { const v = localStorage.getItem('my3d2dge:' + key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; } }, set(key, value) {/* true | false */}, remove(key) {} };
```

It never throws, even in private mode or when storage is full. Games namespace their own keys (`'ed:'`, `'best:'`) and validate what they read back (`src/emberdeep/01-tune.js:116`).

**PORT-AS-IS → `core/store.js`**, plus:
- a configurable prefix per game;
- a schema version with a migrate hook;
- an in-memory backend for tests;
- a `dump()` that agents can inspect.

### 1.5 Warn-once and the error overlay (Q8)

- **`warn(key, msg)`** (:64-67) keeps a `Set` of keys it has already shown and prints `console.warn('my-3D2dge: ' + msg)`. It has 33 call sites.
  - Each message names the fix and lists the valid options. For example, an unknown action (:558) prints `…Known actions: … Add your own with new E.Game({ input: { ...E.Input.DEFAULT, q: ['KeyQ'] } })`.
  - The prefix lets `tools/check.mjs:28` sort engine advice from other warnings.
- **`E.showError(title, e)`** (:1476-1488) shows a fixed red `<div id="my3d2dge-error" role="alert">` with the first five stack lines; a click hides it. Window handlers for `error` and `unhandledrejection` (:1489-1492) catch errors during setup too.
- **`game._fail(where, e)`** (:1683-1691) handles errors in update and draw:
  - it de-duplicates by `where:message`;
  - pushes `{ where, scene, message, stack }` onto `game.errors`;
  - logs `console.error` once;
  - shows the overlay and calls the optional `game.onError`.
- The loop requests the next animation frame first, "so an error never stops the loop" (:1641). Update and draw sit in separate try blocks.

**PORT-AS-IS → `core/diag.js`, then extend it:**
- keep warnings in `E.diag.warnings` with stable codes, not only in the console;
- add `E.diag.report()`, which returns errors, warnings, fps, stats, backend and version as JSON for tools;
- add "did you mean" suggestions based on edit distance;
- keep the global handle `E.current`, which every tool uses.

---

## 2. Scenes and timers (Q8; another report covers the loop itself)

- **Scenes are plain objects:** `{ enter(data), exit(), update(dt), draw(r), pausable, view, views, input, res, touch, propSize }` (:1620-1625).
- **Starting and switching:** `game.start({ scenes, scene })` starts the game. `game.go(name, data, { fade: .22 })` fades through black, and the old scene stays frozen while it fades out (:1654-1666, :1696).
- **Entering a scene** (`_enter`, :1667-1682) clears the timers, particles, hit-stop and camera follow, un-ducks the audio, and applies the scene's view, input preset, resolution and touch buttons. An unknown scene name warns with the list of scenes.
- **Timers:** `game.after(s, fn)` and `game.every(s, fn)` return `{ cancel() }` (:1595-1597). They run in game time, so they stop during pause and hit-stop (:1703-1707), and are cleared on every scene change.
- **Pause:** a `pausable` scene toggles on the `pause` action, plays a sound and ducks the music (:1698-1700).

**Keep:** scenes as data with per-scene settings, timers in simulation time that cannot outlive their scene, `{ cancel }` handles, and fades as an engine service.

**Add:** labels on timers, and an inspectable `game.timers`.

---

## 3. Input (section 5, lines 476-694, about 4.4k tokens) (Q3)

**Model:**
- **Actions** are names you choose, bound to arrays of codes:
  - `KeyboardEvent.code` values;
  - `'Mouse0'` to `'Mouse2'`;
  - `'Pad0'` to `'Pad15'` (the standard gamepad mapping);
  - `'PadAxisUp'`, `'PadAxisDown'`, `'PadAxisLeft'` and `'PadAxisRight'` (the left stick as digital directions, for menus);
  - `'Act:<name>'`, which is added to every action so that DOM elements with `data-act="<name>"` work (:520, :633-643).
- **Reverse index:** a map from code to actions (:521).
- **Presets are data:** `Input.DEFAULT`, `PLATFORMER` and `SHMUP` (:678-693), plus the shared `MENU_KEYS` for `start`, `pause`, `confirm` and `cancel` (:673-676).

**API:**
```
new E.Input(screen, map)        // screen needs .canvas and .clientToScreen
use(map | 'DEFAULT' | 'PLATFORMER' | 'SHMUP')
down(a)  pressed(a)  released(a)  repeat(a, delay = .3, rate = .08)  buffered(a, win = .15)  consume(a)
suppress(a)  suppressCode(code)  consumeAll()  clear()  anyPressed()  move() -> [x, y] (screen dirs, |v| <= 1)
mouseScreen()  tick(dt)  press(code)  release(code)  bindButtons(root)  touchButtons(actions, { labels, force })
fields: mouse {cx, cy, active, t}, padMove, padAim, padAxes, aimSource ('move'|'mouse'|'pad'), lastDevice,
        deadzone = .18, invertAimY, stickSide, stickRadius, touchEnabled, touchFilter
```

**Good ideas to keep:**
1. **Edges in simulation time.**
   - Browser events go into `fresh`. `tick(dt)` swaps `fresh` into `now` (:629-630), so `pressed()` is true for exactly one fixed step, even for a tap shorter than a frame.
   - `repeat()` counts on the input clock and ignores the OS's key repeat (`e.repeat` is filtered out at :501), so it is deterministic.
2. **Forgiving input.** `buffered(a, .15)` plus `consume(a)` give combat input buffering. Hit-stop eats edges, and the buffer bridges them.
3. **A HUD widget can own the mouse.** `suppressCode(code)` lets a widget take the mouse without silencing the same action on the gamepad (:579-581; the fix is described in `docs/CONTROLS-AUDIT.md`).
4. **Robustness:**
   - a guard skips keys while the player types in a form field (:494-498);
   - blur and visibility loss clear all input (:504-505);
   - when a gamepad is swapped, its held codes are released (:610-616);
   - the deadzone is radial and rescaled (:618);
   - `lastDevice` and `aimSource` drive prompts and aim modes;
   - only bound codes call `preventDefault`.
5. **Warnings that teach.** An unknown action warns with the list of known actions (:558).

**Smells:**
- Every instance adds listeners to `window` and there is no `destroy()`.
- `move()` hard-codes up, down, left and right in screen space.
- `mouseScreen()` needs the 2D `Screen`. stress-world passes a fake object, `{ canvas, clientToScreen: () => null }` (`src/stress-world/40-cameras.js:185`).
- **Missing in the engine:**
  - mouse deltas, pointer lock and the wheel (stress-world does these itself, `40-cameras.js:290-320`);
  - analog triggers (only `b.pressed` is read) and rumble;
  - rebinding. Emberdeep wrote **673 lines** for it (`src/emberdeep/61-controls.js`): saved bindings, a regex of valid codes, reserved keys, pad labels ("A / Cross"…), conflict checks.
- **No first-class injection.**
  - `press(code)` and `release(code)` can be called directly, but `tick()` overwrites the pad axes from `navigator.getGamepads()` on every step.
  - Emberdeep therefore built its own duck-typed virtual input for the autopilot and the gallery (`src/emberdeep/93-autopilot.js:11-15`: `{ worldMove, aimAt, press(a), buffered(a), consume(a), down(a), … }`).
  - The tests press real Playwright keys in wall-clock time (`tools/check.mjs:61-69`), and the pad tests stub the Gamepad API.

**How input should grow in 3D:**
- **Keep the action model and its edge semantics as they are.** They do not depend on the renderer.
- **Add axes:**
  - `move` (2D);
  - `look` (mouse deltas under pointer lock, or the right stick with a response curve and invert-Y);
  - `zoom` (the wheel);
  - analog triggers.
  
  Add a pointer-lock manager too: a request on click, a state value, and release on Esc.
- **Add an intent layer as the boundary for replays and tests.**
  - Each step, a mapper turns device state into world space:

    ```
    intent = { move: [x, y] in world space, aim: yaw | point, look, pressed: Set, down: Set }
    ```

    The mapper is camera-relative: "W walks away from the camera". stress-world's `controls()` (`40-cameras.js:204-215`) is the reference.
  - Gameplay reads only intents. Bots, AI agents and tests write intents directly.
  - `input.record()` logs one intent per step, and `input.replay(log)` must reproduce the state hash. The labs already prove that hashes match across WebGPU and WebGL 2; that becomes a standard test.
  - Record the camera-resolved intent rather than raw device input. Camera yaw affects gameplay through the camera-relative move, so raw devices alone would not replay faithfully.
- **Scripted injection in simulation time:**

  ```js
  input.script([{ at: .5, press: 'jump' }, { at: 1, hold: 'attack', for: .3 }, { at: 2, move: [1, 0], for: 1 }])
  ```

  This replaces wall-clock Playwright key presses, which are not deterministic.
- **Rebinding becomes engine data:**
  - `bindings` saved through `E.store`;
  - label tables for keys and pad glyphs;
  - conflict detection;
  - input *contexts* (gameplay, menu, debug console) with priority, instead of a global `consumeAll`.

**Verdict: PORT-WITH-CHANGES → `input/`** (the core about 4.5k tokens, plus about 2k for axes, the intent layer and recording, plus about 1.5k for bindings).

---

## 4. Audio: the chip synthesizer (section 20, lines 3647-3856, about 4.8k tokens) (Q1)

### 4.1 Voices (`_voice(p, bus, t0, mul = 1)`, lines 3742-3764)

All of it runs on Web Audio.

**Oscillators:**
- `square`, `triangle`, `sine` and `saw` use `OscillatorNode`.
- `pulse` (25% duty) and `pulse12` (12.5% duty) use a `PeriodicWave` built from 40 Fourier terms (`_pulse(duty)`, :3736-3741, cached).
- `noise` is a one-second white-noise `AudioBuffer` (filled with `Math.random`, :3721):
  - it loops, and starts at a random offset (:3752);
  - it runs through a `BiquadFilter` (`filter` defaults to `'bandpass'`, `q` to 1.1);
  - the filter's cutoff sweeps from `freq` to `to`.

**Envelope:** gain rises from 0 to `vol` in a linear ramp over `attack` (4 ms by default), then falls exponentially to .0005 by the end of `dur`, which makes it percussive. With `hold`, it sustains and releases over 30 ms instead (used for music notes) (:3745-3747).

**Modulation:**
- a pitch sweep from `freq` to `to` (exponential, :3758);
- an arpeggio: `arp` is a list of semitone offsets, one every `step` seconds; it holds on the last one unless `loop` is set (:3759);
- vibrato: `vib: [rateHz, depth]` drives an LFO through a gain of f0 × depth into the frequency (:3760);
- `delay` offsets the start.

**Voice spec:**
`{ wave, freq: Hz | 'A4', to, dur, vol = .3, attack, hold, arp, step = .06, loop, vib, filter, q, delay }`.
`E.note('C#5')` turns a note name into a frequency (:3655-3661).

**Mixing:**
- A voice goes either into `sfxBus`, or into the song's bus and then `musBus`; both feed `master`, which feeds the destination.
- `volume`, `sfxVolume` and `musicVolume` set the levels.
- Music ducks to 35% while the game is paused (`_duck`, :3731-3735).
- `mute(on)`, `setVolume(v)`, `ready` and `failed` are public.

**`sfx(what, { vol, pitch, vary = .03 })`** (:3769-3779):
- `what` is a preset name, a voice, or a list of voices (layered sounds);
- the same name cannot retrigger within 35 ms;
- a random detune of up to `vary` applies;
- the sound is dropped silently if the context is not running yet;
- the first `pointerdown`, `keydown` or `touchstart` resumes the context (:3723-3725);
- failures warn once and never throw.

### 4.2 Presets

`SFX` (:3663-3697) is a table of `name: voice | [voice, …]`. It has **33 presets**:

`jump jump2 land step coin pickup key powerup oneup heal hit hurt stomp bump swing whoosh punch kick shoot laser charge explode boom door secret warp die select confirm cancel pause text blip`

Layered presets combine voices. For example:
- `hit` is a noise burst plus a falling square wave;
- `boom` is low-passed noise from 600 to 40 Hz plus a sine sub-bass from 90 to 30 Hz.

The drum kit `DRUMS` (:3699-3706) has six sounds:

| Token | Sound |
|---|---|
| `k` | kick (sine 150→42 Hz) |
| `s` | snare (noise plus triangle) |
| `h` | closed hat (high-passed noise) |
| `o` | open hat |
| `c` | crash |
| `t` | tom |

### 4.3 The step sequencer and the five songs

**Playing music:** `music(song | name | null, { loop })` (:3791-3802). The same song requested again is ignored. `stopMusic()` fades out over 60 ms.

**Song format:**
```js
{ bpm: 138, steps: 4, loop?: false, tracks: [
  { wave: 'pulse', vol: .15, notes: 'E5 - G5 - A5 - - C6 B5 - A5 - G5 - E5 - | …', octave?, gate?: .9, vib? },
  { wave: 'drums', vol: .15, notes: 'k . h . s . h h k . h . s . h o' } ] }
```

**Tokens:**
- a note (`C4`, `F#3`, `Bb2`);
- `-` holds the previous note one more step;
- `.` is a rest;
- `|` marks a bar line and is ignored;
- drum tracks read the first letter of each token.

`steps` is the number of steps per beat (4 means sixteenth notes). Each track loops on its own length (`pos % t.tokens.length`, :3815).

**Scheduler:** a `setInterval` every 25 ms schedules notes 120 ms ahead on the audio clock (:3801, :3808-3818). This is the classic two-clock design.

**Songs** (`E.songs`, :3834-3856; original compositions, about 860 tokens):

| Song | Tempo | Tracks | Notes |
|---|---|---|---|
| `title` | 112 | 3 | |
| `adventure` | 138 | 4 | |
| `dungeon` | 96 | 3 | |
| `boss` | 164 | 4 | |
| `victory` | 150 | 2 | `loop: false`, plays once |

### 4.4 How a game extends the synth: Emberdeep (`src/emberdeep/70-audio.js`, 44 lines, about 1.6k tokens)

- **More effects:** `A.define('zap', [voice, voice])` (with `A = game.audio`, `00-core.js:44`) adds 10 effects: zap, freeze, portal, clang, thud, crack, bloop, roar, chime and slash2.
- **Stings:** two musical stings are multi-voice effects written with note names and arpeggios (`stingDepth`, `stingBoss`). The game's event bus fires them: `BUS.on('levelStart', e => { if (e.L && e.L.depth) game.after(.35, () => sfx('stingDepth')); })`.
- **Songs:** four songs live in the game's own registry (`def('songs', 'town', {...})`), and `playSong(id)` falls back to the engine's songs.
- **A footgun, recorded in a comment there:** "every track loops on its own length, so each track's length must divide the song's (an 8-step arpeggio under 16-step bars drifts a half bar and clashes)".

### 4.5 Is it deterministic? Can it be tested offline?

**Deterministic: no.**
- `Math.random` fills the noise buffer, picks the noise start offsets and detunes every `sfx`.
- Music timing comes from a wall-clock `setInterval`.

**Testable with OfflineAudioContext: not as written.**
- `_init()` hard-codes `new (window.AudioContext || window.webkitAudioContext)()` (:3715).
- `sfx` requires the context state `'running'`.
- `music` needs the interval timer.

**But the refactor is small.** `_voice(p, bus, t0, mul)` already takes an absolute start time and a target bus. Three changes make an offline renderer, about 30 lines:
1. inject the context;
2. build the buses on it;
3. loop the scheduler over steps instead of the interval.

**Coverage today:** the tests only call `sfx` and `music` and check for errors (`tools/agent-test.mjs:58`). `docs/LAB-3D.md` lists sound as out of scope, so **neither 3D lab has any audio**.

### 4.6 What a richer procedural audio system for my-3dge needs

1. **Seeded, injectable and offline-renderable.**
   - Construct it as `new Audio({ ctx, seed })`.
   - `E.audio.render(soundOrSong, { seconds, sampleRate })` renders through an OfflineAudioContext and returns an `AudioBuffer`.
   - Add analysis helpers: peak, RMS, length above -60 dB, spectral centroid, onset times.
   - Add a **spectrogram PNG writer**, so an agent can *see* a sound it cannot hear.
   - Golden tests should compare those metrics with tolerances. Exact sample hashes hold within one browser build but differ across browsers.
2. **3D space.**
   - A voice can take `at: [x, y, z]` or `follow: entity`. Route it through a `PannerNode`:
     - `'HRTF'` panning, or `'equalpower'` for crowds;
     - `distanceModel: 'inverse'`;
     - `refDistance` of 1 m, which is 16 engine units;
     - `rolloffFactor` and `maxDistance`;
     - cones for directional sources.
   - Copy the camera to the listener every frame, ramping the values so they do not zipper. three r182 core ships `AudioListener` and `PositionalAudio`, which accept custom nodes through `setNodeSource`.
   - Add a distance low-pass (air absorption), and an optional occlusion low-pass from a Rapier raycast. Both are presentation only.
   - Web Audio no longer does Doppler. If it is wanted, fake it with a pitch ramp from the source's speed toward or away from the listener.
3. **Reverb from procedural impulse responses.**
   - Use a `ConvolverNode` per room preset: room, hall, cave, outdoors.
   - Build each impulse response from seeded stereo noise:
     - an exponential decay to a target RT60;
     - a pre-delay;
     - a few early-reflection taps;
     - a damping low-pass that closes over the tail. Render it through an OfflineAudioContext once.
   - Feed reverb through send buses, crossfaded as the listener moves between zones.
4. **Music layers and sections.**
   - Keep the text sequencer, and add sections, an order, and layers (`{ sections: { a, b }, order, layers: { calm: […], fight: […] } }`).
   - `music.intensity(0..1)` crossfades layer gains (vertical layering).
   - `music.queue('b')` switches section at the next bar (horizontal re-sequencing).
   - Stingers wait for the next beat.
   - **Validate track lengths:** warn when a track's length does not divide the bar.
5. **Richer voices.**
   - ADSR envelopes and filter envelopes.
   - 2-operator FM (bells, brass).
   - Detuned unison (pads).
   - Pink and brown noise.
   - Karplus-Strong plucks and modal impacts, rendered once to buffers at load. These "procedural samples" are cheap to play many times.
6. **Variation and limits.**
   - A preset can hold variants or ranges (`freq: [200, 260]`).
   - Choose round-robin with no immediate repeats, and add seeded jitter on pitch, volume and filter.
   - Cap instances per sound with voice stealing, cap each bus, and give sounds priorities.
   - Duck the music under large explosions.
   - Add ambience beds: wind (filtered noise under a slow LFO), fire crackle (random impulses), water.
7. **Coupling to the rest of the engine.**
   - Each material declares a sound tag, so footsteps change with the surface.
   - Gameplay emits events and audio listens. Gameplay never reads audio back (rule 5).

**Verdict: PORT-WITH-CHANGES → `audio/`.**
- Keep the voice format, `define`, note names, the buses with ducking, the unlock, the retrigger guard and the two-clock scheduler (about 3k tokens).
- Keep the SFX, drum and song data **as is** (about 1.9k tokens).
- Add spatial audio, reverb, layered music and the offline test path (about 3-4k new tokens).

---

## 5. Procedural textures (section 15, lines 3054-3101, about 1k tokens, plus related code) (Q2)

### 5.1 The `E.tex` generators

Each generator is a function of the texel at (x, y), in world units, where 16 texels make 1 m. Each returns `[r, g, b]`.

| Signature | Parameters | What it draws |
|---|---|---|
| `flagstone(x, y, pal, size = 16)` (:3059) | `pal = { stones: [[r,g,b]…], mortar, hi, lo, speck }` (**RGB arrays**) | Running-bond rows of stones, 1 px of mortar, bevelled edges, 5% specks, and rare cracks where `h > .93`. |
| `grass(x, y, o)` (:3069) | `{ base, dark, light, flower, flower2 }` (**hex strings**) | Value-noise blotches at two scales, blade marks and rare flower clusters. |
| `dirt(x, y, o)` (:3079) | `{ base, dark, light }` | Soft patches and pebbles with a lit edge. |
| `water(x, y, o)` (:3086) | `{ base, dark, light }` | Ripple lines from a static sine wave, plus noise. |
| `planks(x, y, o)` (:3092) | `{ base, dark, line }` | Boards running along x, 6 px rows, with random lengths from 20 to 38. |
| `checker(x, y, o)` (:3098) | `{ a, b, size }` | A checkerboard. |
| `plain(x, y, o)` (:3100) | `{ base, amount }` | Brightness noise in steps. |

They run as the TileMap's `floorTex(x, y, floorTag, view)`, which may also return `[r, g, b, glow]`. The fourth number is emission.

**Determinism:**
- The generators are pure functions of their coordinates, so they are deterministic.
- But they **cannot be seeded**: there is no seed parameter, so the only way to get another layout is to offset the coordinates.
- And they are **not periodic**. Only `checker`, and `flagstone` and `planks` at certain sizes, line up when tiled. `noise2` has no period, so a small tile of grass shows seams when repeated.

**Smells:**
- The palette formats are inconsistent: `flagstone` takes RGB arrays and the rest take hex strings.
- The hex strings are parsed per pixel.

### 5.2 Related generators that are not in `E.tex`

These patterns exist elsewhere and could join a texture library:
- **Wall faces** in TileMap (:2954-2992): `brick`, `stone`, `rock`, `plank`, `timber`, `plaster`, `hedge`.
- **Wall tops** in TileMap (:2994-3015): `speckle`, `plain`, `tiles`, `slab`, `leaves`, `grass`.
- **PlatformMap tile styles** (13): `stone`, `brick`, `block`, `ground`, `wood`, `metal`, `plank`, `spikes`, `ladder`, `pipe`, `bonus`, `liquid`, `plain`.

They are scanline patterns drawn inside projected screen polygons, not `(x, y)` functions, so they cannot be reused as written. Because of that, every 3D page wrote its own `(x, y)` versions:
- `src/lab3d/10-materials.js:20-51`: `TEX.floor`, `brick`, `pillar`, `top` and `crate`;
- `src/stress-world/10-hall.js:225-248`: `faceTex(t, h)`, `topTex(t)` and `blockTex(side, bw, bh)`;
- `30-crowd.js:292-310`: crate and barrel textures.

A single library would remove that duplication.

### 5.3 How the 3D labs bake them

**`bake(fn, w, h[, repeat])`** (`lab3d/10-materials.js:53-65`, copied again in `stress-world/00-setup.js:80-89`):
- writes `ImageData` row by row;
- wraps it in a `THREE.CanvasTexture`;
- uses `NearestFilter` for magnification and minification, with **no mipmaps**;
- sets sRGB colour space and `RepeatWrapping`;
- keeps the density at 16 px per metre (one texel per engine unit).

**Materials:**
- The materials are `MeshLambertNodeMaterial({ map })`, with no normal or roughness maps.
- The lighting cues (bevel highlights, mortar shadow) are baked into the albedo. Under real lights, they light the surface twice.

**The hall floor** in stress-world (`10-hall.js:269-288`):
- is baked as one texture over the whole hall;
- carries the engine's contact AO;
- uses its fourth channel as the emissive map (`emissiveMap`, `emissiveIntensity: 1.6`).

`boxGeo` (:253-257) rescales UVs so that every face keeps 16 px per metre.

**A problem the labs have:** with nearest minification and no mipmaps, perspective cameras shimmer and show moiré at a distance.

### 5.4 A recommended 3D procedural material library → `gfx/textures.js` and `gfx/materials.js`

**API:**
```js
E.mat.define('flagstone', {
  params: { size: 16, stones: ['#4b4559', '#554f64'], mortar: '#221e2b' },   // hex, normalized once at define time
  period: [64, 64],                                   // generators must tile: lattice coords wrap mod period
  sample(x, y, p, rnd, out) { out.c = [r, g, b]; out.h = 0.8; out.r = 0.7; out.e = 0; out.m = 0; }   // albedo, height, rough, emit, metal
});
const m = E.mat.bake('flagstone', { seed: 3, texelsPerM: 16, look: 'pixel' });   // -> { map, normalMap, roughnessMap, emissiveMap, height } (cached by key)
const mat = E.mat.material('flagstone', { triplanar: false, model: 'standard' | 'lambert' | 'toon' });
```

**One height function drives everything:**
- The normal map comes from central differences of the baked height grid, with wrap-around, and a strength setting.
- Roughness comes from the region (mortar rough, polished stone smoother, wet stone low), or from cavity.
- The emissive map keeps today's `[r, g, b, glow]` convention.
- A "flat albedo + height" mode leaves out the baked bevels, so lighting comes from the normal map. A "stylized" mode keeps them, for the pixel-art look.

**Two looks:**
- `pixel`: nearest magnification, **NearestMipmapNearest** minification on power-of-two sizes. This keeps texels crisp up close without shimmer far away.
- `smooth`: 64 px per metre or more, linear filtering with mipmaps, and normal maps.

**Bake on the CPU by default.**
- A CPU bake is identical on WebGPU and WebGL 2, cheap at runtime and cacheable.
- An agent can inspect it as a PNG. Add a tool that renders every material to a contact sheet showing albedo, normal and roughness.
- Bake at load, or in a Worker producing a `DataTexture`. A 1024² bake costs tens of milliseconds in JavaScript.

**Use TSL nodes on top, not instead.** They compile for both WebGPU and WebGL 2, so they respect rule 5. The vendored r182 TSL exports:
- `mx_noise_float`, `mx_fractal_noise_float`, `mx_worley_noise_float` and `mx_cell_noise_float`;
- `triplanarTexture` and `triplanarTextures`;
- `normalMap` and `bumpMap`.

Use them for:
- macro variation multiplied over the baked tiles, to break up repetition;
- animated surfaces: water, lava, emissive pulses;
- `triplanarTexture` on procedural meshes that have no good UVs, such as rocks, terrain and props.

Move the wall, roof and platform patterns from §5.2, and the labs' textures, into this one library.

**Verdict: PORT-WITH-CHANGES.** Keep the generator bodies, add a seed, a period, height output and one palette format, and leave baking to the material layer.

---

## 6. Lighting (Q5)

### 6.1 Canvas lighting (section 7, lines 845-935, about 1.8k tokens)

**API:**
```
Lighting: enabled, ambient = .15, add(x, y, z, radius, intensity = 1, { color, shadow }),
          caster(x, y, r, top) and heat(x, y, z, w, s) (both used only by the GPU path)
```

**How it works:**
- It keeps a per-pixel intensity buffer the size of the low-resolution screen.
- Each light adds (1 − d²/R²) × intensity, measured on the ground through the inverse of the view, or on screen in side views.
- **'alpha' style:** cool darkness in 16 alpha steps, plus additive coloured tints that saturate as 1 − e^(−x).
- **'dither' style:** six Bayer-dithered bands.

**Verdict: DROP.** three.js lights replace it.

### 6.2 WebGPU lighting (section 22, lines 4329-4650, about 5.1k tokens; WGSL about 1.8k, class about 3.1k)

**API:**
```
game.enableGPU({ map, bands: 6, wrap: .45, ambient, spill: 1.1, glow: .22, shadows: true, offscreen: false, onStatus })
status() -> 'loading' | 'on' | 'off' | 'unavailable'      GPULighting.supported()      active(view)
snapshot() -> PNG data URL (offscreen mode)                px.glow(g, e) marks glowing pixels
```

**What it is:** a deferred lighting pass over the 2D picture.

**What the canvas renderer supplies each frame:**
- the colour (albedo) picture, drawn as usual;
- an *info* G-buffer canvas:
  - R = height × 3;
  - G = surface class × 20 (0 = background, 2 = decal, 4 = tops, 5-8 = wall faces facing ±x and ±y, 10 = actors);
  - B = glow;
- an unlit overlay canvas for the HUD.

**GPU uploads each frame:**
- the three canvases, copied in with `copyExternalImageToTexture`;
- a heightmap at one texel per world unit (`r8unorm`), built from the TileMap's walls plus that frame's cylinder casters;
- one uniform buffer holding up to 32 lights and 8 heat sources.

**Pass 1, `fsLight`** (a fullscreen triangle):
1. It rebuilds each pixel's world position from its height, through the view's inverse.
2. It picks a normal from the surface class. For actors, the normal comes from the gradient of their silhouette mask, which wraps light around the body.
3. It adds an ambient term from the sky.
4. For each light:
   - falloff (1 − d²/r²);
   - wrapped Lambert, (n·l + wrap)/(1 + wrap);
   - an optional soft shadow, marched through the heightmap in 4 to 48 steps.
5. It adds glow spill: 5 rings × 8 taps of emissive neighbours light nearby pixels and make a tight bloom.
6. It quantizes the light's luminance into `bands` with Bayer dither, which keeps the pixel-art look.

**Pass 2, `fsFinal`:** a whole-number upscale with letterboxing, heat shimmer (sideways offsets of whole pixels, driven by a sine), and the unlit overlay composited on top.

### 6.3 Fallback

`failed` is set, and the canvas lighting is used instead, when any of these happens:
- `navigator.gpu` is missing, or no adapter comes back;
- shader compilation returns an error (checked through `getCompilationInfo`);
- the device reports a validation error (an error scope);
- the device is lost;
- an `uncapturederror` event fires.

In each case the canvas is hidden and `active()` returns false. A runtime exception thrown by `render()` calls `gpu.fail(e)` and presents the canvas frame instead (:1454).

Two more limits apply. The GPU path is only active in views that have an inverse (not side views). And at most two frames may be in flight (:4599): a slow GPU drops frames instead of building up lag.

The canvas path, a completely different algorithm, is the fallback. That is allowed because lighting never affects gameplay, which is exactly the rule my-3dge sets.

### 6.4 What carries over to 3D (CONCEPT-ONLY → `gfx/` extras for WebGPU only)

- **The pattern for a WebGPU-only extra:**
  1. detect the feature;
  2. compile and validate inside error scopes;
  3. on device loss, fall back and report a status (`'loading' | 'on' | 'off' | 'unavailable'`, plus an `onStatus` callback);
  4. cap frames in flight;
  5. offer an **offscreen render plus `snapshot()`** for automated tests;
  6. keep a URL switch that forces the fallback (the lab's `?backend=webgl`);
  7. test both backends against the same state hash.
- **Looks to rebuild in TSL**, which runs on both backends, so none of them need to be WebGPU-only:
  - light quantized into bands with Bayer dither (a "pixel" or "cel" post filter);
  - heat shimmer as a screen-space UV offset near hot sources;
  - glow spill and bloom (stress-world already uses TSL bloom).
- **A fixed light count, so shaders never rebuild** (a stress-world lesson). Today's `lights.add`, `caster` and `heat` API maps to a managed pool of lights.
- **Drop:** the normals from silhouettes, the G-buffer canvas tricks and the shadows marched through the heightmap. Real normals and shadow maps replace them. A heightmap ray-march might still be useful for cheap terrain AO.

---

## 7. Levels and physics (Q7)

### 7.1 `parseLevel` and TileMap (section 13, lines 2674-3016, about 7.6k tokens)

**`parseLevel(rows, legend)`** (:2686-2701, about 500 tokens) is pure logic:
- Rows are a string or an array, top row first.
- A legend value can be:
  - a **number**: a tile id;
  - a **string**: a spawn tag;
  - an **object** `{ tile, floor, spawn, block }`.
- `.` and space mean empty.
- An unknown character, or rows of uneven length, warns once.
- It returns `{ w, h, cells, floor, block: Uint8Array, spawns: [{ tag, ch, cx, cy }] }`.

**PORT-AS-IS → `world/level.js`.**

**TileMap's queries:** `find`, `findAll`, `cell`, `set` (doors), `walkable`, `block`, `toCell`, `center`, `solidAt`, `heightAt`, `floorAt`, `groundAt(x, y, r, z, step)`, `los` (sampled), `bounds(view)`, and `version` (for cache invalidation).

**Its collision:**
- `collide(b)` pushes a circle out of the grid, respecting step height. If the circle's centre is inside a cell, it is pushed toward the nearest open neighbour, or `_escape` searches within 8 cells.
- Walls lower than a body's feet can be stood on, so bodies can jump onto blocks.

**Its look:**
- the floor is baked per view from `floorTex`;
- contact AO along wall bases (`ao`);
- water and lava shimmer;
- cut-away walls in front of the floor (`cut`, `cutH`);
- bricks anchored in the world.

**For 3D:** stress-world already proves the ASCII → 3D pipeline (`src/stress-world/10-hall.js`):
- `rects(ch)` (:80-91) merges cells greedily, rows first;
- that produces Rapier cuboids and convex hulls (`hallColliders`, :188-201) and instanced meshes;
- height functions follow (`floorH`, `topH`);
- the brazier list is shuffled with a seed.

So:
- **Port** the grid queries (`walkable`, `heightAt`, `floorAt`, spawns, grid line of sight) as a `LevelGrid`.
- **Port** stress-world's builders: rects, colliders, meshes, nav.
- **Extend** the text format: stacked layers or height digits, and props per cell. Text levels are easy for agents to diff and review.
- **Concept only:** cut-away walls (stress-world cuts walls that face the camera, and cuts pillars to stumps with a segment-box test, `40-cameras.js:172-180`), and contact AO baked into the floor texture (`10-hall.js:277-280`).
- **Drop:** the drawing, `collide` and `groundAt`. Rapier and its kinematic character controller replace them.

### 7.2 PlatformMap and Platformer (section 16, lines 3103-3510; about 7k + 1.7k tokens)

**PlatformMap:**
- Tiles lie on the x/z plane, and cells count from the bottom row.
- Tile kinds: `solid`, `oneway`, `ladder`, `slope` (`dir` or `from`/`to`), `hazard`, `deco`, `back`.
- `move(b, dt, solids)` moves an axis-aligned box in sub-steps. It handles slopes, stepping up 5 units, dropping through one-way tiles, and moving platforms that carry riders. It reports `bumped` (a tile hit from below, for ? blocks).
- Baked chunks draw the level.

**Platformer** (:3443-3509):
- A feel-tuned state machine with parameters: `run`, `accel`, `decel`, `airAccel`, `jump`, `gravity`, `fallGravity`, `maxFall`, `cut` (variable jump height), `coyote: .09`, `buffer: .13`, `airJumps`, `wallJump` and `wallSlide`, `dash` and `dashTime`, ladders, and `knock`.
- Its `update(dt, level, ctl)` takes either an `E.Input` or an intent object (`{ x, jump, jumpPressed, up, down, dash }`). That is already an intent layer.

**Verdict:**
- PlatformMap's code: **DROP**. Its kinds are a useful **concept** for 3D: one-way platforms through Rapier's collision filtering or contact hooks, ladders and hazards as sensor volumes.
- Platformer: **PORT-WITH-CHANGES → `world/controller.js`**. Keep the feel parameters and the state machine. Replace `level.move` with Rapier's `KinematicCharacterController`; stress-world already moves its hero with `computeColliderMovement` (`20-sim.js:293`). Take the wall normal from the controller's collisions.

### 7.3 Body (section 17, lines 3511-3550, about 700 tokens)

A ground-plane circle:
- exponential friction;
- collision against the TileMap, with a bounce off the wall normal;
- gravity on z and standing on blocks (`groundAt`);
- `push(ix, iy, iz)` and `jump(v)`;
- flags: `onGround`, `landed`, `hitWall`, `bounced`.

**DROP.** Rapier's dynamic and kinematic bodies replace it. Keep its **API vocabulary** for the 3D actor wrapper: `push`, `jump`, `landed`, `hitWall`, `bounced`.

### 7.4 Bullets and `E.pattern` (section 18, lines 3552-3623, about 1.3k tokens)

**Bullets:**
- A pooled list with a cap (`max = 800`) on the `'ground'` or `'side'` plane.
- `fire(spec)`: `{ x, y, z, vx, vy, vz, r, dmg, life, team, color, core, sprite, pierce, grav, data, onWall }`.
- `burst(base, vels)`.
- `update(dt, map)`: life, gravity, death on walls with sparks.
- `hit(targets, fn, team)`: circle tests, `pierce` with a per-bullet `hitSet`, and a team filter.
- `clear(team)` and `draw(r)`.

**`E.pattern`:** `dir(angle, speed)`, `aim(a, b, speed)`, `aimSide`, `spread(angle, n, arc, speed)` and `ring(n, speed, offset)`.

**Smells:** there is no swept test. A bullet that moves farther than its radius in one step can tunnel through a target.

**Verdict:**
- Bullets: **PORT-WITH-CHANGES → `world/projectiles.js`**. Use 3D vectors; test against targets with SpatialHash, or swept spheres (Rapier `castShape`); draw with instanced emissive meshes, as `stress-world/35-effects.js` does. stress-world wrote its own bolts rather than reuse `E.Bullets`.
- `E.pattern`: **PORT-AS-IS**, plus an elevation angle.

### 7.5 SpatialHash (section 19, lines 3625-3646, about 400 tokens)

```js
new E.SpatialHash(cell = 32); build(list, xk = 'x', yk = 'y'); add(o, x, y); near(x, y, r, fn); query(x, y, r) -> []
_k(cx, cy) { return (cx & 0xffff) * 65536 + (cy & 0xffff); }   // a 16-bit cell wrap: safe within ±32k cells
```

- It is 2D only.
- It allocates arrays per cell on every `build`, and `query` allocates too.
- It skips objects whose `dead` field is set.

stress-world re-implemented it in five lines (`20-sim.js:225-230`). That version truncates with `|0`, so the cells on either side of the origin merge.

Rapier now resolves crowd separation, so there is no separation code ("there is no separation code", LAB-3D.md). Gameplay still needs cheap, deterministic queries for melee arcs and many-versus-many hits.

**Verdict: PORT-WITH-CHANGES → `world/spatial.js`.**
- Choose a 2D (ground) or 3D key.
- Build with a typed-array counting sort (cell start indices), with no allocation per frame.
- Use deterministic iteration order.

### 7.6 FlowField (section 14, lines 3017-3053, about 600 tokens)

**What it does:**
- BFS over 4 neighbours, with distances in an `Int32Array`. It recomputes only when the target changes cell.
- `dir(x, y, fx, fy)` picks the best of 8 neighbours. It never cuts corners and adds 0.4 for diagonals.
- It falls back to a straight line when the target is unreachable or already reached.
- It uses `map.walkable` or `solidCell`.

**stress-world reuses the idea but re-implemented it, and improved it** (`10-hall.js:126-178`, about 1k tokens):
- A **`PASS` bitmask** marks each of a tile's 8 neighbours as passable. A step is passable only if walking from centre to centre never climbs more than `CLIMB` (3.5 units). So stairs and the dais's slope can be climbed, while a gallery edge is a wall from below and a drop from above.
- **Dijkstra with a binary heap**, diagonal cost 1.414, walking edges backwards from the target.
- **Multiple seeds** when the target stands on a solid tile.
- **`dir(x, y, out)`** writes into an `out` array and returns `null` for "walk straight", so it does not allocate.

**Verdict: PORT-WITH-CHANGES → `world/nav.js`.** Take stress-world's version, generalized:
- `NavGrid.fromLevel(level, { climb, heightFn })`;
- `FlowField(nav)` with fields cached per target;
- optional single-agent A*;
- a debug overlay that draws the arrows.

### 7.7 What Rapier replaces

| Replaced by Rapier | Kept |
|---|---|
| TileMap `collide`, `groundAt` and `_escape` | Grids for authoring and AI: level text, spawns, nav, flow fields |
| PlatformMap `move`, slopes and step-up | Spatial hashing for gameplay queries |
| Body | Projectile logic and patterns |
| Crowd separation | The controller's feel parameters |
| Wall tests for projectiles (raycasts) | |

---

## 8. The 2D presentation layer (sections 2, 3, 4 and 9, and `E.style`)

- **Pixel primitives** (:206-338, about 2.2k tokens):
  - `px.rect`, `dot`, `line` (Bresenham), `disc`, `ell`, `poly` (scanline);
  - `blend` (stepped alpha and blend modes), `polyDither`, `ddisc`, `sprite`;
  - `E.sprite(rows, colors, scale)`: pictures written as strings, turned into a canvas, a flipped copy and run lists.

  **DROP as a world renderer.** Keep a subset (rect, line, poly, disc and `E.sprite`) for the 2D overlay: HUD icons, and ASCII-art emblems baked to textures. That subset is **PORT-WITH-CHANGES → `ui/overlay.js`**.
- **Views** (:339-405, about 1.3k):
  - `new E.View(id, label, yawDeg, pitchDeg, scale, zBoost)`, with `p`, `depth`, `order`, `toGround` and `screenDirToGround`;
  - six presets: iso, threequarter, topdown, brawler, side, overhead;
  - `charView` (the SNES cheat of drawing sprites from a lower angle).

  **CONCEPT-ONLY.** The presets become 3D camera presets (the labs already built them, including a `zBoost` through the projection matrix). `screenDirToGround` becomes camera-relative movement (§3). Drop `charView`.
- **Screen** (:406-475, about 1.3k): a low-resolution buffer, upscaled by whole numbers, with letterboxing, `E.RES` console presets (nes 256×240 … ps1 320×240, wide 400×225), portrait options and `clientToScreen`.

  **CONCEPT-ONLY.** In 3D this becomes a "retro resolution" option: render to a fixed number of lines and upscale with nearest filtering. stress-world already does this (200 to 330 lines).
- **Renderer** (:1038-1471, about 9.9k): depth sorting in painter's order, compositing per actor (outline, rim light, palette flash, afterimages, x-ray silhouettes through occluders), decals, overlays, `textAt`, the cut mask for glows, and the GPU info pass.

  **DROP the code. Keep the effect vocabulary as a concept:**

  | 2D effect | 3D equivalent |
  |---|---|
  | outline | inverted hull, as both labs already do |
  | palette flash | an emissive uniform |
  | afterimages | instanced copies that fade |
  | x-ray | a second pass for occluded characters with an inverted depth test and a checker pattern in TSL |
  | decals | projected or floor quads |
  | `textAt` | projection onto the overlay |
- **`E.style`** (:264): global switches, `trans: 'alpha' | 'dither'`, `charPitch` and `propSize`.

  **DROP.** As a concept, keep one "look preset" object: pixel scale, toon bands, outline width, post filters.

---

## 9. Props, backdrops, UI and the pixel font (Q6)

### 9.1 Pixel font (section 6, lines 696-844, about 4.1k tokens: about 2k of glyph data, about 2k of code)

**Two fonts:**
- `'normal'`: 5×7, proportional, with lower case and descenders. About 100 glyphs, including ♥ ★ ← → ↑ ↓ • × ♪ ▸ ©. Each glyph is stored as rows of `#` and `.` joined by `|`.
- `'tiny'`: 3×5, upper case only, stored as 15-bit strings.

Both are parsed into run-length spans (`parseFont`, :737-747).

**API:**
```
E.font.text(g, s, x, y, color = '#ffffff', opts | outlineColor) -> { w, h }
  opts: { font: 'normal' | 'tiny', outline: '#0b0814' | false, shadow, gradient: [top, …], scale, align, wrap, lineGap }
E.font.title(g, s, x, y, { scale: 3, colors, outline, depth, depthColor, align, shine })   // an extruded logo with a gradient
E.font.width(s, o), lineHeight(o), height(lines, o, lineGap), wrap(s, maxW, o), E.font.default
```

**In 3D already:** stress-world draws damage numbers and notes with `E.font.text` on a 2D overlay canvas laid over the three.js canvas, using projected world points (`35-effects.js:133-149`).

**Compact encoding:** the agent edition stores the 5×7 font as one base-32 digit per row (`engine/my-3d2dge-agent.js:742-748`). That font section is 6.3 KB against the full engine's 14.3 KB.

**Verdict: PORT-AS-IS → `ui/font.js`**, with the compact encoding.
- It becomes the HUD and debug font.
- It can also be baked into an atlas texture for labels in the world.
- **It does not depend on system fonts, so screenshots are byte-identical on every machine.** That property is valuable for agents comparing screenshots.

### 9.2 UI, Dialog and Menu (section 21, lines 4145-4327, about 3.8k tokens)

**API:**
```
E.ui.box(g, x, y, w, h, { bg, border, shadow, gradient, alpha })   // a Final Fantasy style window
E.ui.bar(g, x, y, w, h, frac, color, { border, bg })   E.ui.hearts(g, x, y, hp, max, { perRow })   E.ui.counter(...)
new E.Dialog(game, { speed: 50, lines: 3, place, voice: 'text', bg, border })
  .say(text | [pages], { name, choices, onChoice, onDone, portrait, portraitSize, place, y, alpha, auto, modal })
  .update(dt) -> true while it is open and modal;  .draw(r);  .close();  .typing
new E.Menu(game, items | { label, disabled }, { x, y, title, onPick, onCancel, onMove, sound })
  .update() -> true when an item is picked or the menu is cancelled;  .draw(r)
```

**What Dialog does:** text types out with blips, pages turn, a name tab sits above the box, choices take repeated key input, a live rig portrait moves its mouth while text types, pages can advance by themselves, and a non-modal mode allows radio chatter while play goes on.

**What Menu does:** it skips disabled items, repeats the cursor while a key is held, and plays sounds.

**For 3D:**
- **Keep the HUD and menus in 2D**, on an overlay canvas at a fixed low resolution scaled up by whole numbers. Text anchored in the world is projected, as `r.textAt` did. This is the PORT-WITH-CHANGES:
  - Dialog and Menu are independent of the renderer except in `draw`. But they read `game.input` and call `game.audio` directly; inject both instead.
  - Add `ui.state()` for tests: the open dialog, its page text, the menu items and the cursor. Then agents can assert on the UI without OCR.
  - Portraits become a small render target of the 3D character.
- **DOM UI is the alternative.** It is accessible and selectors can query it, but it depends on fonts and the OS, so it is not pixel-stable. Keep it for settings forms only. Emberdeep already uses native dialogs for its controls.
- **UI inside the world** (signs, name plates) is the font baked into a `CanvasTexture` on a billboard.

**Target modules:** `ui/overlay.js`, `ui/dialog.js`, `ui/menu.js`.

### 9.3 Backdrops (section 21b, lines 3859-4008, about 4.1k tokens)

**API:**
```
new E.Backdrop(preset | { sky: [...], sun | moon: { x, y, r, color }, stars, starsY, time, layers: [{ kind, color, y, height, parallax, drift, seed, windows, snow, nebula, fill }] });  bg.draw(r);  E.Backdrop.presets
```

**Presets:** day, dusk, night, castle-night, city-night, desert, forest, ocean, cave, space.

**Layer kinds:**
- `mountains`: ridged sums of sines, with snow caps;
- `hills`: smooth sines;
- `forest`: trees made of discs;
- `stalactites`;
- `city`: buildings with lit windows;
- `castle`: towers, battlements and windows;
- `clouds`: also a nebula;
- `sea`;
- `fog`.

**How layers are made:**
- Each layer is a strip **512 px wide that tiles seamlessly**: the sines complete whole cycles per strip, and `wrapN` blends the noise across the period (:3906-3912).
- Strips are shaded with `tones`, lit by their slope, hazed toward the bottom, and baked once per key.
- A sun or moon has halos and craters.
- Layers scroll with parallax and drift over time.

**For 3D:** strips that tile horizontally are exactly what a **cylinder around the camera** needs.
- Bake each layer to a `CanvasTexture` and map it on open concentric cylinders, which gives real parallax. A single sky-dome shader that samples the strips by azimuth is the alternative.
- Add a TSL sky gradient with a sun or moon disc and stars on a dome. TSL works on both backends.
- Match the fog colour to the horizon band.

**Verdict: PORT-WITH-CHANGES → `gfx/sky.js`.** The presets are data, and the strip generators need only `px.*` swapped for `ImageData` writes.

### 9.4 Props (section 21c, lines 4009-4144, about 7.1k tokens)

**38 kinds:**
torch, candle, candelabra, chandelier, brazier, window (stained glass), banner, pillar, statue, crate, barrel, chest, pot, sign, fence, lamp, door, tree, pine, bush, flowers, grass, rock, crystal, bones, skull, vines, cobweb, lantern, streetlamp, awning, hydrant, trashcan, firedrum, sandbags, cactus, palm, mushroom.

**How they are built:**
- `PROP_DEFAULTS` gives each kind a colour and a pixel size.
- `E.prop(name, { size, color, colors, variant, open, broken, color2, blossom, emblem, berries, flame, flameOut })` draws the prop with `px.*` and `tones(color)`, and caches it by a long key.
- Flames get four animated frames.
- Props return metadata: `{ glowAt, emissive, light }`. In other words, a prop states what light it gives off and where.
- `r.prop()` draws it as a billboard, and can add a light with `light: true`.

**Verdict: CONCEPT-ONLY → `gfx/props.js`.**
- **Port as data:** the catalog (names, default colours, sizes in units, options such as open, broken and variant) and the metadata contract (light colour and offset, flame anchors, emissive parts).
- **Rebuild** each prop as a cached, instanced **mesh builder** from primitives, lathe and extrude, with procedural materials (§5).
- stress-world shows the pattern: its brazier (`10-hall.js:411-415`) is a box base, a cylinder bowl, emissive coals and two cone flames; it also builds crates and barrels.
- Billboard "cards" stay possible as an option.

---

## 10. The documentation pattern (Q9)

### What exists

**The full engine's header** (`engine/my-3d2dge.js:1-54`) is titled "READ THIS FIRST". It holds 10 numbered rules and says where the manuals are. The rules cover world space, views, rigs, pixel rules, frame order, time, levels, sound, text and menus, the look, and GPU lighting.

**The agent edition's header** (`engine/my-3d2dge-agent.js:1-347`, about 7.6k tokens by bytes/3.5; AI_GUIDE says about 8k) is the whole manual. It has these sections:

| Section | Content |
|---|---|
| `## Host it` | the HTML page |
| `## Mental model` | 6 bullets |
| `## Quick start` | a complete game (title, play, win or lose) in a ```` ```js quickstart ```` block |
| `## API` | one dense line per call, with defaults |
| `## Recipes` | two more complete games (```` ```js platformer ````, ```` ```js shmup ````) and one-line genre recipes |
| `## Rules` | numbers for feel, such as "walk 70-90, run 95-140, jump 250-320 with gravity 800 …" |
| `## More, outside this file` | grep commands for the mocap store and Emberdeep |

The header tells agents directly: *"AGENTS: this header is the whole manual … Read a section only to debug: each starts with "// ---- N. NAME" (grep "// ---- 10." for the Humanoid)."*

**It is executable.** `tools/agent-test.mjs:27-29` takes every ```` ```js <name> ```` block from the header and plays it on **both** engines: start, move, attack and pause, with no errors and a drawn screen. The same tool also:
- runs a coverage scene that exercises every option;
- asserts that the agent edition's API is a subset of the full engine's;
- checks that every path in the "More" sections exists;
- reports the file's size in tokens.

**Graceful degradation.** Calls that exist only in the full engine are stubs in the agent edition, and each warns once (`:2854-2863`). Code written for the bigger engine therefore still runs.

**API.md** (about 11k tokens estimated; 12.2k per the README) is embedded in the single-file editions. Its sections:
- Quick start;
- Look target;
- Coordinates in each view;
- Rules;
- **Common mistakes**, written as symptom → fix;
- the reference for each system;
- a genre playbook;
- **Before you hand the game back**, with the commands `tools/check.mjs` and `tools/filmstrip.mjs`.

**AI_GUIDE.md** (about 9.5k tokens estimated) covers:
- the north star and the mental model;
- the workflow and visual craft;
- hard rules and frame order;
- systems in more depth, including "Errors and warnings";
- genre recipes;
- lessons from Emberdeep: registries with `def()`, an event bus, an autopilot for testing;
- performance and a checklist.

**In the code itself:**
- numbered section banners;
- a one-line `/** */` doc with defaults on nearly every public method;
- warnings that teach.

### Gaps

- **Five overlapping documents** are kept in sync by hand: the engine header, the agent header, API.md, AI_GUIDE.md and the README.
- **Only the agent header's examples run as tests.** API.md's quick start is never executed; `agent-test.mjs` reads API.md only for paths.
- **The banners in the full engine are block comments** (`/* ==== N. NAME`), and their order is not monotonic: 21b and 21c come before 21 (:3860, :4010, :4146). Section 1 also hides `store` and the colour ramps.
- **The dense style costs tokens:** about 1.3 times as many tokens as the byte count suggests.

### Replicate and improve in my-3dge

1. **Every module file starts with a header that is its manual:**
   - its purpose;
   - its mental model;
   - one API line per call, with defaults;
   - a runnable ```` ```js ```` example;
   - common mistakes.

   The build concatenates these headers into `MANUAL.md`, which becomes the single source. A **token budget for each module** is enforced in the tests, which keeps the engine compact.
2. **Every code block in every document is a test.** Each runs headless on both WebGPU and WebGL 2, and checks for errors, a drawn frame and a state hash.
3. **Generate `api.json`** from the headers: name, signature, defaults and file:line. Test that every export is documented and every documented name exists (the subset test, generalized).
4. **Stable, greppable banners in file order**, for example `// ==== 3. BINDINGS ====`.
5. **Give each warning a code.** Keep today's voice (the valid options plus the fix), and generate the "Common mistakes" table from the warning catalog.
6. **Keep:**
   - the mental model first;
   - numbers for feel;
   - recipes as complete games;
   - the "before you hand back" checklist with its commands;
   - the version label in every report.

---

## 11. Proposed target modules (suggested names)

| Module | Contents |
|---|---|
| `core/` | `math.js` (clamp, lerp, angles, `smoothDamp`, ease, `prune`), `random.js` (§1.1), `color.js` (§1.2), `store.js`, `diag.js` (warnings, overlay, report) |
| `input/` | actions and axes, intent, record and replay, script, bindings, touch, pointer lock |
| `audio/` | `synth.js`, `presets.js`, `songs.js`, `music.js` (layers and sections), `space.js` (panner, listener, reverb impulse responses), `offline.js` (render, metrics, spectrogram) |
| `gfx/` | `textures.js` and `materials.js` (§5), `sky.js` (§9.3), `props.js` (§9.4), look and post presets (bands with dither, heat shimmer, retro resolution), extras for WebGPU only with the fallback pattern from §6.4 |
| `world/` | `level.js` (ASCII parse, rects, colliders, meshes), `nav.js` (NavGrid and FlowField), `spatial.js`, `projectiles.js`, `controller.js` (Platformer feel on Rapier's character controller), `query.js` (`inArc3` and the like) |
| `ui/` | `font.js`, `overlay.js` (box, bar, hearts, sprite icons, world-to-overlay projection), `dialog.js`, `menu.js`, plus a state model for tests |

---

## 12. Summary table

| System | Lines / ~tokens | Verdict | Target module | Notes |
|---|---|---|---|---|
| Warn-once `E.warn` | 64-67 / 75 | PORT-AS-IS | core/diag | Add codes and a warning list; keep the option lists in messages |
| Error overlay, `game._fail`, `game.errors` | 1475-1492, 1683-1691 / 600 | PORT-AS-IS (extend) | core/diag | Add `E.diag.report()` JSON for tools |
| Math (`clamp` … `smoothDamp`, `ease`) | 72-96 / 550 | PORT-AS-IS | core/math | The rig team owns `V3` and `ik3` |
| `rng` (Mulberry32), `hash2`, `noise2` (value noise), `bayer` | 85-92 / 250 | PORT-WITH-CHANGES | core/random | Add seed, period, 3D, fbm, Worley; no `E.noise` or `E.hash` exists |
| `rand`, `randInt`, `pick`, `chance` | 179-184 / 150 | PORT-WITH-CHANGES | core/random | They use `Math.random`; seed them |
| Colour: `hex`, `toHex`, `shade`, `mix`, `toHsl`, `hsl`, `tones`, `ramp` | 97-176 / 1,600 | PORT-AS-IS | core/color | Add linear conversion and `THREE.Color` |
| Helpers: `dist`, `angleTo`, `overlap`, `overlapBox`, `inArc` | 185-196 / 350 | PORT-WITH-CHANGES | core/math, world/query | Add 3D shapes and a height band |
| `E.store` | 197-202 / 145 | PORT-AS-IS | core/store | Add a prefix per game, a memory backend, versioning |
| Scenes, fades, timers | 1594-1597, 1620-1691 / 1,450 | PORT-WITH-CHANGES | core/game (loop report) | Scenes as data; timers in simulation time, cleared per scene |
| `E.style` | 264 and its uses | DROP (concept) | gfx/look | Becomes a look preset |
| Pixel primitives, `E.sprite` | 206-338 / 2,200 | DROP; subset PORT-WITH-CHANGES | ui/overlay | Keep for HUD icons and ASCII emblems |
| Views, `charView` | 339-405 / 1,300 | CONCEPT-ONLY | camera presets | `screenDirToGround` becomes camera-relative movement |
| Screen, `E.RES` | 406-475 / 1,250 | CONCEPT-ONLY | gfx/post | A retro resolution with whole-number upscale |
| Input | 476-694 / 4,400 | PORT-WITH-CHANGES | input/ | Keep the edge semantics; add axes, intent, injection, record and replay, pointer lock, rebinding |
| Pixel font | 696-844 / 4,100 (1,800 compact) | PORT-AS-IS | ui/font | Deterministic text for HUD and debug; atlas for the world |
| Canvas lighting | 845-935 / 1,800 | DROP | — | three.js lights |
| Renderer (sort, composite, x-ray, glow mask) | 1038-1471 / 9,900 | DROP (concept) | gfx/fx | Outline, flash, afterimages, x-ray, decals, `textAt` |
| `parseLevel` | 2686-2701 / 500 | PORT-AS-IS | world/level | Plus stress-world's `rects`, colliders and meshes |
| TileMap queries | 2703-2951 (parts) / ~1,500 | PORT-WITH-CHANGES | world/level | `walkable`, `heightAt`, `floorAt`, spawns, grid line of sight |
| TileMap drawing and collision, wall and roof patterns | 2703-3015 / ~6,000 | DROP; concept for cut-away and AO | world/level, gfx/textures | Rapier collides; patterns become `(x, y)` generators |
| FlowField | 3017-3053 / 600 | PORT-WITH-CHANGES | world/nav | Port stress-world's Dijkstra with `PASS` and climb (`10-hall.js:126-178`, 1k) |
| `E.tex` generators | 3054-3101 / 1,000 | PORT-WITH-CHANGES | gfx/textures | Add seed, period, height → normal and roughness; one palette format |
| PlatformMap | 3103-3433 / 7,000 | DROP (kinds as concept) | world/level | Sensors and one-way filtering in Rapier |
| Platformer controller | 3434-3510 / 1,700 | PORT-WITH-CHANGES | world/controller | Feel parameters on Rapier's character controller; it already accepts intents |
| Body | 3511-3550 / 700 | DROP (vocabulary as concept) | world/actor | Rapier bodies |
| Bullets | 3552-3611 / 1,050 | PORT-WITH-CHANGES | world/projectiles | 3D, swept tests, instanced drawing |
| `E.pattern` | 3612-3623 / 300 | PORT-AS-IS | world/projectiles | Add elevation |
| SpatialHash | 3625-3646 / 400 | PORT-WITH-CHANGES | world/spatial | Typed arrays, optional 3D key |
| Chip synth (`ChipAudio`, `E.note`) | 3647-3661, 3707-3832 / 2,900 | PORT-WITH-CHANGES | audio/synth | Seeded, injectable context, offline render |
| SFX presets (33) and drums (6) | 3662-3706 / 1,000 | PORT-AS-IS (data) | audio/presets | Add variants and ranges |
| Songs (5) and the sequencer format | 3833-3856 / 860 | PORT-AS-IS (data) | audio/songs, audio/music | Add layers and sections; validate track lengths |
| Spatial audio, reverb, music layers | new / ~3,500 | NEW | audio/space, audio/music | Panner, listener on the camera, impulse responses, intensity |
| Backdrops (10 presets, 9 kinds) | 3859-4008 / 4,050 | PORT-WITH-CHANGES | gfx/sky | Seamless strips onto cylinders, plus a TSL sky dome |
| Props (38 kinds) | 4009-4144 / 7,100 | CONCEPT-ONLY (catalog as data) | gfx/props | Mesh builders, instancing, light metadata |
| `E.ui` box, bar, hearts | 4149-4194 / 950 | PORT-AS-IS | ui/overlay | On the overlay canvas |
| Dialog | 4196-4281 / 1,850 | PORT-WITH-CHANGES | ui/dialog | Inject input and audio; add a state model for tests |
| Menu | 4283-4327 / 900 | PORT-WITH-CHANGES | ui/menu | Same as Dialog |
| GPU lighting (WebGPU) | 4329-4650 / 5,150 | CONCEPT-ONLY | gfx/ extras for WebGPU only | Keep the fallback, status, snapshot and frames-in-flight cap; rebuild bands, dither and shimmer in TSL |
| Documentation pattern | headers, API.md, AI_GUIDE.md | CONCEPT (replicate and improve) | docs/, module headers | Executable doc blocks, a generated manual and `api.json`, token budgets |

**Rough budget:** the code worth carrying in some form is about 27k tokens by bytes/3.5, about 35k cl100k. That is about a quarter of the full engine file. New work adds about 10k tokens for spatial and layered audio, the material layer, input intent with record and replay, and the UI state model.
