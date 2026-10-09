# G — Emberdeep harvest: engine-grade patterns, exclusions, lessons

**Scope.** Read in full: `src/emberdeep/DESIGN.md`, `TUNING.md`, `docs/CHARACTERS.md`, `docs/DAN.md`, `docs/CODEX.md`, `docs/CONTROLS-AUDIT.md`, `00-core.js`, `01-tune.js`, `18-characters.js`, `61-controls.js`, `63-character-menu.js`, `70-audio.js`, `95-perf.js`, `99-start.js`. Read for mechanism: `05`, `10`, `15` (head), `20` (parts), `21`, `22`, `25`, `30`, `33`, `35`, `36` (parts), `45`, `50`, `55` (head), `60`, `62`, `90`, `92`, `93`, `94`, `96`; tools `ed-character-test.mjs`, `ed-controls-test.mjs`, `ed-tune-test.mjs`, `ed-sheet.mjs`, `ed-balance.mjs`, `ed-smoke.mjs`, `ed-play.mjs`, `new-character.mjs`, `character-check.mjs`, `ed-build.mjs`. Paths are relative to `/home/user/michaelcrosato/my-3d2dge/`; `ed/` = `src/emberdeep/`.

**Correction to the brief.** The IK-legged crawler, burrowing serpent and floating Watcher rigs live in `ed/33-beasts.js` (`BST_Crawler` :85, `BST_Serpent` :602, `BST_Eye` :858), not `30-monsters-core.js` (which holds the monster runtime, shared AI and five Humanoid/Blob/wisp archetypes). The boss bodies (incl. the Six-Armed Reaver) and the 13-verb boss pattern library are in `ed/36-bosses.js`.

**Headline findings.**
1. The most valuable export is a *closed loop for agents*: registry → auto-enumerating gallery / inspector / bot → contract tests that fail with one plain sentence → numeric lints + one contact-sheet image → a one-command check. Rebuild the loop, not the game.
2. Everything worth observing is URL-addressable (`#gallery/skills/<id>`, `#depth-7`, `?character=`, `?view=`) and scriptable (`window.__ed`, `ed-play.mjs` step DSL, deterministic hand-stepping with a fake clock).
3. The custom creature rigs decompose into ~14 reusable procedural building blocks (eased state weights, two-bone IK with pole/reverse knee, critically damped springs, planted-foot multi-leg gait, path-history chains, verlet strands, look-at/blink, hover/bank/fold, orbiters, detached parts, delayed pose replay, joint-attached extras, tip trails, animation-measured reach). None needs 2D; all map onto three.js bones.
4. Composition works because generic behaviours speak a shared **intent vocabulary** (`pose`, `stance`, `expr`, `attack{spec,phase,u}`, `air`, `dash`, `run`, `down`, `hurt`) that every body interprets, ignoring unknown keys; non-humanoid bodies translate it. That protocol is what lets "any boss pattern run on any body".
5. Do **not** replicate: one shared global scope built by file concatenation, monkey-patching as the hook mechanism, schemas that exist only in comments, and simulation code reading the wall clock.

---

## 1. Engine-grade patterns

### 1.1 Registry `def(kind, id, spec)` and the data-driven content language
*Where*: `ed/00-core.js:76-87`; spec docs atop each owner file (`ed/30-monsters-core.js:3-13`, `ed/35-bosses-core.js:3-9`, `ed/45-mechanics-core.js:3-16`, `ed/25-skills-core.js:3-14`, `ed/18-characters.js:6-32`); contractual ids `ed/DESIGN.md:55-69`.
```js
function def(kind, id, spec) {
  if (!REG[kind]) throw new Error('EMBERDEEP: unknown registry "' + kind + '"');
  if (REG[kind][id]) E.warn('ed:dup:' + kind + id, '... registered twice (the last one wins)');
  spec.id = id; REG[kind][id] = spec; return spec;
}
```
*How*: every part is a plain spec with data + hooks (`place/start/update/draw`, `apply/onHit/onDie`, `start(b) -> runtime`). Consumers look up by id and fall back gracefully (`recipe()`'s `has()` guards, `ed/50-levels-core.js:33-41`; `REG.themes[rec.theme] || REG.themes.crypt`, :354). DESIGN.md: "Mechanics, themes, archetypes, affixes, patterns and powers must therefore work in ANY combination... Missing ids fall back gracefully."
*Why*: an agent adds a feature as one new file; tooling enumerates registries (gallery reels, inspectors, search, bot, character test), so new content is visible and tested with zero wiring.
*3D re-implementation*: `core/registry` with `defineKind(kind, schema)` + `def()`. Make the schema data, not comments: fields, defaults, docs, numeric ranges (auto-tunable), `visual: true` (excluded from inspectors, cf. `DEV_SKIP` `ed/62-developer.js:192`), required hooks, contract ids enforced by a test. Generate docs, inspector help and validation from the one schema.

### 1.2 "Ask the entry, never the id" — optional hooks with defaults
*Where*: `ed/18-characters.js:1-4` ("the game asks the entry wherever heroes differ (never the id), so a new hero needs no edits to shared code"), `charRig` :66-69, hook list :6-32; usage `dropIn` `ed/90-scenes.js:105-108`, `prime` `ed/92-gallery.js:134`, `ed/62-developer.js:871`.
```js
function charRig(h, look = h.look, over = null) {
  const C = characterOf(h); over = over || { colors: Object.assign({}, look.colors) };
  return C.rig ? C.rig(h, look, over) : new E.Humanoid(Object.assign({}, look, over));
}
```
*How*: every behaviour that may differ is an optional hook (`rig`, `prime`, `init`, `stats`, `kit`, `dropIn`, `titlePose(t)`, `preview(h, part, t)`, `menuNotes`) plus capability flags (`ownLayers: true` skips shared animation layers that assume a Humanoid; `clips: false` opts out of mocap). The `over` argument lets the same body be re-instantiated with a palette override (the spectral Echo, `ed/27-skills-spells.js:696`; the paper doll).
*Why*: kills `if (id === 'codex')` branches; adding an actor never edits shared files. Test/demos hooks (`prime`, `titlePose`, `preview`) make content demonstrable by tools.
*3D*: `actors` registry with the same hook-with-default discipline; rigs accept a material/colour override (ghost/echo/portrait passes); `showcase(t) -> intents` for title/menu/gallery loops.

### 1.3 BUS event system with lifetimes
*Where*: `ed/00-core.js:89-100`; catalog `ed/DESIGN.md:157-162`.
```js
on(ev, fn, scope = 'global') { (this.L[ev] || (this.L[ev] = [])).push({ fn, scope }); return fn; },
emit(ev, d) { ... for (...) { try { l[i].fn(d); } catch (e) { game._fail('BUS ' + ev, e); } } return d; },
clear(scope) { for (const k in this.L) this.L[k] = this.L[k].filter(x => x.scope !== scope); }
```
*How*: listeners carry a lifetime (`'level'` cleared on level end — `BUS.clear('level')` in `levelScene.enter` `ed/90-scenes.js:332`; `'global'` persists). Each listener is isolated by try/catch and failures go to `game.errors`. Payload objects are returned so emitters can read mutations. Events: combat (`hit`, `kill`, `hurt`, `heroDie`), actions (`skill`, `dodge`, `perfectDodge`, `strike`, `foeStrike`), progress (`levelStart`, `levelEnd`, `bossWake`, `bossDown`, `spawn`, `thingHit`), frame (`step`, `draw`).
*Why*: mechanics, powers, HUD, tips, audio stings, autopilot, perf governor and mocap moments all attach without editing the emitter. Scoped clearing prevents leaks across levels.
*3D*: `core/events` with typed catalog, lifetimes bound to scene/level/run objects, per-listener isolation, plus an agent-facing ring buffer `events.trace(n)` exposed on the debug handle.

### 1.4 Frozen core + plug-in modules (and what not to copy)
*Where*: `ed/DESIGN.md:14-45`; build `tools/ed-build.mjs:1-28` (`--mine` builds core + one agent's files).
*How*: core files are declared non-editable; extensions go through registries, hooks and BUS; if impossible, "describe the smallest core change in your final report". Parallel agents built and tested "core + mine" pages independently.
*Problems to avoid*: all files share one IIFE scope joined by filename order (`ed/DESIGN.md:16-20`: names "must not collide", prefix helpers `mechGale_`, `BST_`, `BOS_`, `DAN_`); hooks by monkey-patching (`ed/96-hero-clips.js:106-139` wraps `updateHero`, `townLife`, `reviveHero`, `deathPanelDue`, `galItems`, `galleryScene.update`).
*3D*: ES modules with explicit imports; keep the governance (frozen core, extend via registries/events, "smallest core change" reports) and the "build core + my module" test page; replace monkey-patching with declared hook points/middleware (e.g. `actor.layers` pipeline).

### 1.5 Seeded, named RNG streams
*Where*: `ed/00-core.js:102-117`; streams `RNG('emberdeep:' + depth + ':' + visit)` (`ed/50-levels-core.js:32`), `RNG('emberdeep:boss:' + i)` (`ed/35-bosses-core.js:157`), `RNG('emberdeep:combos:' + k)` (`ed/50-levels-core.js:96`).
*How*: string-hashed (FNV) seeds; helpers `range/int/pick/chance/weighted/shuffle`; an unseeded `rnd` only for combat rolls. Each subsystem has its own stream, so adding a draw in one place never reshuffles another.
*3D*: `core/rng` identical in spirit + global seed override via URL/test harness.

### 1.6 Body contract + `checkRig` + character sheet + character test
*Where*: contract `ed/18-characters.js:34-48`; `CHAR_STATES` :82-88; `checkRig` :96-143; sheet `tools/ed-sheet.mjs`; test `tools/ed-character-test.mjs`; loop `tools/character-check.mjs`; recipe `docs/CHARACTERS.md`.
Contract: `update(dt, s)`, `draw(...)`, `drawSmear`, `drawPortrait`, `kick(v)`, `hand(side)`, `head()`, `tip()`, `_w(p)` (local→world offset), joints `J` (≥ `hipC shC head handL handR bladeDir`), `o.size`, colours `C`, `x y z facing t phase`, optional `bones` (rigid pairs).
```js
const CHAR_STATES = [ ['idle', {}, .6], ['run', { vx: 84, run: 1 }, .6], ['dodge', { dash: true, vx: 220 }, .15],
  ['jump', { air: true, z: 10 }, .3], ['wind-up', { attack: E.move('slash', .8, 'wind') }, .2], ... ['knocked down', { down: 1 }, 1],
  ['death', { pose: 'die', expr: 'wince' }, 2.2], ['cheer', ...], ['wave', ...] ];
```
*checkRig* drives a fresh body through 14 states × 2 facings (held long enough for eased weights to settle), then: methods exist; joints finite; `facing`/position follow the state; `hand/head/tip` are *world* points within `70 × size` ("a world point, not a local one?"); `kick()` leaves joints finite; every view draws non-empty pixels for idle and strike; `drawSmear` runs through a stand-in renderer; portrait non-empty. Returns `{ ok, problems: [plain sentences], pixels: {view: n} }`.
*Sheet lints* (`tools/ed-sheet.mjs:107-131`): pop = spike (`d[i] > 9 && d[i] > 2.5 × max(neighbours)`), idle foot slide `> 2 × size`, joint below floor `< -1.5 × size`, bone stretch `> 12%` over `rig.bones`, vanishes in a view (`< 50%` of max silhouette pixels), `< 6` colours, `< 50%` contrast on any theme floor. Each lint maps to a fix (`docs/CHARACTERS.md:97-105`). Seeded `Math.random` so numbers repeat.
*Character test* (10 checks, fails on any page error **or any engine warning**, `tools/ed-character-test.mjs:22`): entry complete with numeric ranges; picked in menu, own save slot survives reload; moves and dodges; starting skills cast and one hurts a dummy; every shared skill works with its body and the Echo keeps it; paper doll; drop-in/drink/knockdown/death/revive; every view; title and gallery; phone portrait with touch.
*Why*: agents cannot reliably judge animation from frames; this converts visual quality into named failures and numbers ("Made for the loop 'edit the body, look at one image, read twenty lines'", sheet header).
*3D*: `testing/rig-check` + `testing/rig-sheet`: drive a rig through an intent-state table × N yaw facings × camera presets (iso, three-quarter, top-down, side, close) offscreen at low resolution; check finite bone transforms, root follows, sockets in world space, silhouette area per camera, contrast vs. ground materials, rigid-pair length drift, velocity-spike pops, idle foot slide, below-ground joints, material count; emit JSON + PNG contact sheet.

### 1.7 Procedural rig building blocks (from Dan, Codex, Crawler, Serpent, Watcher, Reaver, dummy)

| # | Technique | Where | Mechanism | 3D building block |
|---|---|---|---|---|
| 1 | **State weights eased toward targets** (no snapping) | Dan `ed/22-char-dan.js:27,41-57`; Crawler `ed/33-beasts.js:84,101` | `ease(k, to, up, down)` → `W[k] = approach(W[k], to, dt*rate)` with separate rise/fall rates; joints are *built* from weights | `StateWeights` driving pose-layer blend weights from intents |
| 2 | **Two-bone IK with pole; reverse knee** | Dan legs :91-100, arms :121 | `E.ik3(hip, hockT, 6.8, 6.4, [1, sd*.25, .3])`; foot bone a fixed length at a pose-dependent angle; elbow solved so arm length holds | `solveTwoBone(chain, target, pole)`; digitigrade = IK to hock + fixed metatarsal |
| 3 | **Critically damped spring** for swings + `kick` squash | Dan :62-64; Crawler `sq/sqV` :106; Eye :867; dummy `ed/92-gallery.js:16-18` | `K=900; v += ((to-x)*K - v*2*sqrt(K))*dt` — "gathers speed and settles, never jumps a frame" | `Spring1/3/Quat`; `kick(impulse)` in the contract |
| 4 | **Blend directions as angles, not vectors** | Dan :101-125; `docs/CHARACTERS.md:74` | blade dir blended as pitch/yaw; a vector lerp "passes through zero ... and flips" | slerp / swing-twist rule in rig helpers |
| 5 | **Phase-offset sway chain** (tail) + floor clamp | Dan :128-135 | `lat = sin(t*1.9 - i*.7 + ph*.5)*.38*i*sway`; joints clamped to z ≥ 0 when fallen | `SwayChain` bones |
| 6 | **Planted-foot multi-leg gait** | Crawler :117-149, `BST_footAt` :238-244 | feet stored in world space; step when offset > speed-scaled threshold and the other group is not stepping (alternating tetrapods), forced at 2.3×; step duration from speed; lead by velocity; arc lift; re-plant on landing; feet grip wall faces; body pitch/roll from speed/turn; ride height dips with lifting legs | `LegGait` solver with Rapier raycasts for foot targets (floor and walls), N legs, groups |
| 7 | **Lagging body part on damped spring** | Crawler abdomen :107-108 | `abdV += (-turn*.05 - abdY*70 - abdV*9)*dt` | secondary-motion spring on any bone |
| 8 | **Path-history chain** (serpent) | `ed/33-beasts.js:602-700` | head path recorded at even arc steps; segments sampled at fixed gaps along it ("rises out of the ground and dives back exactly where the head went"); writhe wave, neck sway with falloff, flinch spring, crumble from tail; holes where chain crosses ground | `PathChain` (snakes, worms, trains, tentacles) |
| 9 | **Verlet strands** | Eye tendrils :876-886 | anchored nodes, damping `pow(.93, dt*60)`, wave force, 3 constraint iterations | `VerletStrand` (tendrils, ribbons, hair cards) |
| 10 | **Look-at + blink + charge** | Eye :866-875 | smooth look approach; blink timer (never while charging); pupil narrows with charge | `LookAt` (limits) + `Blink` scheduler |
| 11 | **Floater: hover/bank/fold** | Codex `ed/21-codex.js:56-93,161-176` | hover = sin bob + run + recoil; bank from lateral velocity; fold compresses rig on dash; fall rotates | `Floater` root controller |
| 12 | **Detached parts + orbiters + ribbons** | Codex hands :97-126, leaves :358-382, bookmarks :219-239 | hands placed per cast pose (no elbows); leaves on parametric orbits with per-item phase; ribbons with travelling bend | free transforms; `Orbiters`; ribbon strips |
| 13 | **Delayed pose replay** | Reaver `ed/36-bosses.js:646-660` | ring buffer of hand offsets; four extra arms read the pose 0.07–0.15 s ago → "every swing is a cascade" | `PoseHistory` buffer (extra limbs, echoes, afterimages) |
| 14 | **Joint-attached extras** | `BOS_wrapRig` `ed/36-bosses.js:64-68`; `heldItem` `ed/55-town-core.js:14-25` | extras drawn from the rig's real joints so they follow every pose | sockets (bone-attached Object3D); required in contract |
| 15 | **Tip trails** | Dan `drawSmear` :247-257; Codex :406-433 | ring buffer of world tip points, cleared on a > 40-unit jump | ribbon trail mesh from socket history |
| 16 | **Animation-measured gameplay numbers** | `measureAttacks` `ed/30-monsters-core.js:31-41` | each attack is run on a spare rig, strike point sampled u=0..1 → `reach`, `stand`; cached, invalidated by tuning (`ed/01-tune.js:130`, `ed/62-developer.js:178`) | `measureMove(rig, move)` with cache invalidation |

*Why*: these are the parts an agent re-uses to build *any* creature in tens of lines; every one animates "from continuous values (timers, velocities, easing), never from frame lists" (`ed/DESIGN.md:216`).

### 1.8 Intent vocabulary and body adapters (enables composition)
*Where*: `update(dt, s)` state `ed/18-characters.js:36-38` ("plus whatever its own skills pass (unknown keys are ignored)"); patterns return `rig` intents (`ed/35-bosses-core.js:82-87`); translation for a spider `ed/33-beasts.js:1053-1060`:
```js
const rs = m.rigState || {};   // what the pattern asks of a Humanoid, spoken to a spider
p.crouch = rs.pose === 'crouch' ? 1 : 0; p.rear = rs.pose === 'cast' || rs.pose === 'cheer' ? 1 : 0;
if (rs.attack) { p.fang = A0.phase === 'wind' ? 1 : .3; p.lunge = A0.phase === 'active' ? 1 : 0; }
```
Body adapters: `BST_crawlerBody(opts)` returns `m => ({ rig, update(dt, m), draw, kick })` that feeds entity state into the rig (`ed/33-beasts.js:277-291`); `animFoe` passes intents to any body kind (`ed/30-monsters-core.js:302-311`).
*3D*: `anim/intents`: one documented vocabulary (pose, stance, expr, attack phase/u, air, dash, run, down, hurt, look target, custom namespaced keys); every rig must handle the core set (checked by rig-check); adapters map vocabulary → rig-specific weights.

### 1.9 Attack timeline as the single source of timing
*Where*: phases `'wind' | 'active' | 'recover'` with `u` (body contract :37); used by monster wind-up floors (`foeSpec` `ed/30-monsters-core.js:25-28`, "never under .36 s"), telegraph arcs, hit windows (`swingAction` `ed/25-skills-core.js:69-101`, hits from `hitAt`), the bot's dodge decisions (`ed/93-autopilot.js:62-66`), and near-miss perfect dodges (`ed/20-hero.js:171-185`).
*Why*: one timeline keeps animation, damage, warnings, AI and bots in agreement; agents tune one number.
*3D*: `anim/attack-timeline` first-class object shared by rigs, hit volumes, telegraphs, AI and bots.

### 1.10 Time and feel governors
- **Stacking slow motion** (`ed/00-core.js:146-161`): `slowMo(k, dur, id)`; "the slowest live one wins"; durations on the wall clock so a slowdown never stretches itself; `SLOW.base` is the run speed for bot runs; rule "never write `game.timeScale` directly" (`ed/DESIGN.md:143`).
- **Hit-stop leaky budget** (`ed/10-combat.js:45-76`): `want = s * clamp(1 - H.debt / H.soft, .18, 1)`; "a crowd stutters once instead of once per foe... a lunge through six foes: 0.30 s of stop before, 0.12 s after"; per-step budgets for impact stars (max 8, shrinking after 2) and glints.
- **Per-entity clocks** (`foeClock` `ed/30-monsters-core.js:300`): time wells and a speed slider scale a unit's clock; effects it owns follow it (`f.t += dt * foeClock(f.owner || f.src)`, `ed/10-combat.js:320`).
- **Feel knobs at the engine boundary** (`ed/01-tune.js:134-135` wraps `game.freeze`/`game.shake`).
- **Telegraph shapes as data + near-miss** (`ed/10-combat.js:315-353`): circle/arc/line/ring; each shape has a `gap(x,y)` function used for perfect-dodge credit.
- **AI attack tokens** (`ed/30-monsters-core.js:145-150`): `maxAttackers` + randomized gap between wind-ups "so every hit has a readable author".
- **Combat-text aggregation** (`ed/10-combat.js:79-103`): rapid small hits on one target roll into one growing number; crits stand alone; columns avoid overprint.
- **One place decides** (`foeTint` :352, `statusTint` `ed/05-elements.js:84-96` — "a gentle, slow pulse, never an on/off gate").
*3D*: `core/time` (fixed step, timescale stack, per-entity clocks, deterministic mode) + `feel/` (hit-stop budget, shake, effect budgets, combat text) + `fx/telegraph` + `ai/tokens`.

### 1.11 Composition systems
- **Boss = body + element + pattern library** (`ed/35-bosses-core.js`): pattern spec `{ name, range, role: 'close'|'zone'|'aid', unique, start(b, phase) -> { update(dt) -> keep, rig } }` (:6-9); the boss AI picks a pattern whose `range` fits the distance and "never the same verb twice running when it has another" (:53-61); phases at HP thresholds with `gap` (:44-49); composed bosses pick verbs by role — "a fight needs both a threat to dodge and one to outrun" (:169-173); seeded boss sequence with no-repeat windows (:153-164); returning set pieces recoloured (:175-178).
- **Level = layout × theme × mechanics × pool** (`recipe` `ed/50-levels-core.js:31-55`, `buildLevel` :353-412): mechanics plug in via `place/start/update/draw` + BUS `'level'` listeners; props sunk by later mechanics are culled (:395-400).
- **Stalest-first combination scheduler** (`comboAt` :86-106): within a size every combination comes once; each pick takes the set whose most-recently-seen member is oldest. Generic "novelty scheduler".
- **Parts carry their own words** (`ed/DESIGN.md:114-116`; `levelName` :113-126; `lvlSynergy` :150): names and "Together:" lines are composed from `adj/noun/brief/lure/act/move/zone`.
- **Surface tags with shared effects** (`standardFloor` :260-301, `floorEffects` :302-310) and **per-step movement modifiers** reset every step (`m.traction = undefined; m.speedK = undefined; m.drift = null;` `ed/30-monsters-core.js:291`; `timeK` is persistent — documented as such).
- **Things**: `addThing(L, { kind, x, y, r, solid, hittable, onHit, update, draw })` (`ed/45-mechanics-core.js:14-20`); every hero attack also strikes hittable things (`hitCircle/hitCone` `ed/10-combat.js:153-167`).
- **Monster = archetype × element × affixes × depth scale × palette** (`spawnMonster` `ed/30-monsters-core.js:54-83`; affix hooks `apply/update/onHit/onHurt/onDie/draw`).
*3D*: `compose/` helpers (role-based picks, no-repeat, novelty scheduler, word grammar, recolour with luminance guard per `levelHue` :329-352), `world/surfaces`, `world/things`, area queries (sphere/cone) with dedupe sets.

### 1.12 Tuning registry + inspectors + override layer
*Where*: `ed/01-tune.js:8-26,114-153`; panel `ed/62-developer.js:137-678`; doc `ed/TUNING.md`; test `tools/ed-tune-test.mjs`.
```js
knob(sec, group, tier, id, label, def, min, max, step, unit, about, where)
knob('world', 'Physics', 1, 'gravity', 'Gravity', 1, .1, 5, .05, 'x', 'How hard things fall: ...', '10-combat.js, 20-hero.js, ...');
```
*How*: rule numbers are read as `TUNE.<id>` where the rule lives; default = shipped game; `tuneSet` clamps + snaps and calls `tuneApply` (recompute stats, retime clock, invalidate measured attacks); persisted per browser (`ed:tune`). Simple/Advanced tiers (Advanced shows all; Simple shows tier 1 + anything changed, :371-373). Search spans knobs *and* registry parts by name. **Inspectors** walk every numeric field of a registered spec (depth ≤ 2, skipping visual keys `DEV_SKIP` :192), explain them via `DEV_FIELD` with wildcard paths (`attacks.*.wind`, :193-252), show implied defaults (`DEV_IMPLIED` :262). Edits are **overrides keyed `kind.id.path`** (`archetypes.husk.attacks.0.wind`), stored separately, laid over the registry at load, originals remembered for reset (:145-188). **Copy/Paste** exports `{ emberdeepTuning: 1, tune, overrides }` — "hand them to Claude to bake in as the defaults" (:651-678). A **TUNED** marker shows whenever anything differs (:875-880). TUNING.md documents *when* each change applies (at once / next spawn / next level).
*Test enforces*: ≥ 60 knobs, every default in range and at default, every knob has `about` and `where`; knobs and overrides change the game, persist across reload, reset; clamping; panel tabs/tiers/search/guide jump/inspector.
*3D*: `tune/` module unchanged in concept; knobs and inspectors generated from registry schemas; JSON export/import as the human→agent channel.

### 1.13 Developer sandbox
*Where*: `ed/62-developer.js:1-134,679-920`; saves blocked `ed/90-scenes.js:12`.
*How*: `devEnable()` clones the hero by JSON round-trip of `SAVE_KEYS`, snapshots difficulty, goes to town; toggles: invulnerable, unlimited resources (calls the character's `prime`), no cooldowns, freeze AI, pause + **single-frame step** (`devStep` runs the real scene update with panels detached, :69-87), speed (via `slowMoReset`), full lighting, collision circles, perf overlay (FPS, update ms, draw ms, entity count); travel to any depth/town/proving; spawn N of any archetype (cap 300) or any boss; clear; reveal map; grant points/gold; create item. `devDisable()` restores hero, difficulty and level.
*3D*: `dev/sandbox` with save isolation, step/pause/speed, physics + navmesh debug draw, and an extensible action list (the game registers "grant gold" etc.).

### 1.14 Autopilot / bot harness
*Where*: `ed/93-autopilot.js`; `tools/ed-balance.mjs`, `tools/ed-smoke.mjs`; attract mode `ed/90-scenes.js:203-213`.
*How*: a **virtual input** with the real input's interface (`pressed/down/buffered/consume/press/clear`, `worldMove`, `aimAt`; :11-15); the hero controller reads `h.bot.input` instead of the keyboard. `botThink` (:92-197): danger from telegraph shapes, bolts on course, wind-ups (decided once per threat: perfect-dodge/early/tank) and lava; target by *path* distance on the flow field; ignore targets not hurt for 9 s; **progress watchdog** (goal not 12 units closer in 6 s → ignore/stuck, :138-141); **stuck measured along the desired direction** (:166-176); skill use from content hints (`tags`, `kind`, `bot: { heal, ready(h) }`, :183-195). `botRun({to, speed})` logs per level `{depth, time, level, hp, gold, kills, deaths, cleared}` (:204-219). Balance runs are deterministic: rAF disabled, `performance.now`/`Date.now` replaced by a virtual clock, seeded `Math.random`, manual 120 Hz stepping (`tools/ed-balance.mjs:24-29`). The gallery drives the hero through the same virtual input (`h.bot = { manual: true }`, `ed/92-gallery.js:103`); the title uses the bot as attract mode (`ED.demo`: nothing saved).
*3D*: `bot/` (virtual device, navigation-based baseline policy, watchdogs, run logger, deterministic headless harness, smoke test over every scene/level seed, attract hook). Game-specific tactics stay in the game.

### 1.15 Gallery of every animation
*Where*: `ed/92-gallery.js`; deep links `ed/99-start.js:5-8`.
*How*: reels built from registries (SKILLS on spring-wobble training dummies; BESTIARY: each archetype walks in, attacks, flinches, dies; BOSSES: forced through every phase; POSES incl. every mocap moment). Each skill is played four takes cycling runes `[-1, 0, 1, -1]` (:136). Z toggles slow motion (0.3×), V cycles views, Enter replays; camera framing per reel; stage reset between takes; a *copy* of the save is used and never saved. `galOpen(reel, item)` — "A wrong name warns with the list of right ones" (:57-65). Tools film one entry: `filmstrip.mjs "...#gallery/skills/<id>" --seed 1 --steps "wait:200 rec:16:36"`.
*3D*: `gallery/` scene auto-populated from registries (actors, abilities, rigs × intents, clips, sfx, songs, materials), deep-linkable, slow-mo, camera presets, replay, dummies; doubles as the rig-check visual harness.

### 1.16 Performance governor
*Where*: `ed/95-perf.js:10-19`.
```js
if (!PERF.low) { PERF.bad = fps < 45 ? PERF.bad + 1 : 0;
  if (PERF.bad >= 6) { PERF.low = true; ...; P.max = Math.min(cap, 700); game.r.glowMask = false; if (now - PERF.since < 25) PERF.need = Math.min(160, PERF.need * 2); } }
else { PERF.good = fps >= 57 ? PERF.good + 1 : 0; if (PERF.good >= PERF.need) { PERF.low = false; ... } }
```
Samples every 0.5 s on the wall clock; degrades after 3 s under 45 fps; recovers after `need` good samples; hysteresis doubles `need` if it flips back within 25 s; exposed as `ED.perf` for tools; degrades only visuals (outlines, particles, glow mask).
*3D*: `perf/governor` with quality tiers; the natural switch for **WebGPU-only extras** (principle 5) and LOD; must be bypassed/frozen in deterministic runs (lesson from DAN.md).

### 1.17 Controls and input
*Where*: `ed/61-controls.js`; `ed/00-core.js:30-41`; audit `docs/CONTROLS-AUDIT.md`; test `tools/ed-controls-test.mjs`.
*How*: actions map to arrays of codes across devices (`'Pad12'`, `'Mouse0'`, `'KeyW'`); fixed **menu actions separate from gameplay bindings** (remapping movement once broke menu navigation); stored bindings validated (regex whitelist `bindingCode` :29-33, ≤ 12 codes, dedupe, `RESERVED_KEYS` :34) and options clamped (:56-58); conflicts rejected with the conflicting action named (:227-237); a rebind replaces only that device kind (:239-241); labels follow the last-used device (`actionLabel` :95-119); live controller monitor; deadzone (radial, rescaled), invert-Y, aim assist; touch layer (`auto` via `any-pointer: coarse`, handedness, size, opacity, :555-622); every finger tracked, release on `pointercancel`; **focus loss clears input and pauses** (:513-522); HUD safe-area frame from CSS `env(safe-area-inset-*)` (:623-671); full screen on first coarse-pointer tap. DOM `<dialog>` forms give browser focus/scroll plus gamepad navigation (:170-199, :273-328).
*Tests*: real keyboard/mouse/touch events, a simulated Gamepad API pad **in slot 2**, disconnect cleanup, focus loss, phone 390×844@3× portrait/landscape layout, handedness.
*3D*: `input/` as an engine module essentially as-is (game-agnostic), with the action list supplied by the game.

### 1.18 Audio extensions
*Where*: `ed/70-audio.js`.
*How*: sfx are layered synth definitions (`A.define('roar', [{ wave: 'saw', freq: 110, to: 70, dur: .8, vol: .2, vib: [14, .12] }, { wave: 'noise', ..., filter: 'lowpass' }])`, :5-14); stings fire from BUS events (`levelStart`, `bossWake`, :20-21); songs are tracker strings in a registry with engine fallback (`playSong`, :44), with a stated invariant: "every track loops on its own length, so each track's length must divide the song's" (:23-24).
*3D*: `audio/` keeps data-defined sfx/songs (principle 1); add a validator for the length invariant and a gallery reel to audition every sound.

### 1.19 Hero-clip integration (mocap moments over a procedural rig)
*Where*: `ed/96-hero-clips.js`.
*How*: a moment table maps game situations to clips with flags (`HCL_MOVES` :34-50): `speed`, `fade` in/out, `mask: 'upper'` (legs keep walking), `walk` (movement doesn't cancel), `hold` (last pose stays), `landed` (clip time by which a fall is down; the death panel waits for it, :139), `at` (start offset), `next` (chain). `HCL_play` crossfades from the current pose (0.18 s from a saved pose buffer, :61-66, :82); weight eases in/out and is handed to the rig as `rig.mocap/mocapW/mocapMask` (:70-84). Cancel rules: a dodge or action takes the body back at once; moving or a flinch unless `walk` (:100-105). Celebrations are "wishes" that wait ≤ 3 s for the hero to stand still, bigger rank wins (:92-98). Context picks variants (`HCL_deathFor`: DoT → sink, crushing blow → blown, :53-58). Only rigs that opt in (`clips !== false`) play them (:59).
*3D*: `anim/clip-layer` — mocap/keyframe clips as weighted, masked layers over procedural pose with priorities, cancel policies and landmark times other systems can wait on.

### 1.20 Deep links, debug handle, play-script DSL
*Where*: `ed/99-start.js:5-10`; `ed/18-characters.js:55`; `tools/ed-play.mjs:1-16`.
*How*: `#town`, `#depth-N`, `#proving`, `#gallery/<reel>/<item>`; `?view=`, `?character=`, `?test=`; `window.__ed` exposes registries, state, spawners, tuning, sandbox, bot, gallery and check functions (`checkRig`, `CHAR_STATES`). `ed-play.mjs` steps: `wait:600 | press:KeyE | hold:KeyD:500 | aimfoe | click | shot:name | eval:<js> | log:<js>`; exits 1 if the page threw.
*3D*: one `window.__engine` handle with a stable documented surface; URL routes for every scene/showcase/seed/camera; a Node driver with the same step DSL.

### 1.21 UI framework parts
*Where*: `ed/60-ui-core.js:1-62,322-370`; tips `ed/94-tips.js`.
*How*: panel stack `UI.def(id, spec)`/`open`/`close`; modal panels pause the world (`updateUI` returns true); immediate-mode hot rects registered while drawing and resolved next update (:32-34); action rects swallow clicks while tooltip-only rects let attacks through (:47-52). **Notice router**: quick lane (≤ 1.6 s), pickup log, top column that holds during title cards, merges repeats ("BAG FULL ×3"). **One-time tips** per save, deferred while cards/modals/boss falls are on screen (`tip(id, text)`). The death panel waits for the fall landmark.
*3D*: `ui/` (panel stack with modal-pause, DOM dialogs for accessibility, notice router, tips, safe-area frame); visual HUD is the game's.

### 1.22 Saves and isolation
*Where*: `ed/90-scenes.js:11-13`; `characterSaveKey` `ed/18-characters.js:60`.
*How*: whitelisted `SAVE_KEYS`; one slot per character (legacy slot preserved for the original hero); `saveGame()` returns early in demo, sandbox and gallery modes.
*3D*: `save/` with profiles/slots, key whitelist, version + migration hook, and mode isolation as a hard rule.

### 1.23 Error and warning hygiene
*Where*: engine `_fail` (`engine/my-3d2dge.js:1683-1691`: dedupe by `where:message`, `game.errors`), `E.warn(key, msg)` (:64-67, one warning per key, prefixed so tools can detect it); BUS isolation; tests fail on any engine warning.
*3D*: identical policy; expose `errors` and `warnings` on the debug handle; every harness asserts both empty.

---

## 2. Explicit exclusion list (must NOT be ported or re-made from Emberdeep)

| Category | Concrete items (files / ids) |
|---|---|
| Skills & runes | all `def('skills')`: `blade ember` (`ed/25`), melee `cleave whirlwind lunge leap uppercut kick flurry bladethrow` (`ed/26`), spells `frostnova chainlightning meteor voidrift bladestorm echo warcry blink` (`ed/27`), Codex `cx_*` (`ed/29`), Dan `dan_*` (`ed/22`); runes, `ICON` pictograms, skill-id contract, Echo spectral palette |
| Progression | `ed/28-progression.js` (passive tree, 199-star core, deep star rings, mastery, rune tiers), skill/passive points, XP curve `SCALE.xpNeed`, `PRG_canSpend` |
| Stats vocabulary | `STATS` table (`ed/15-stats.js`: ember, incFire, leech, ...) and its formulas (the `statSource` *pattern* is fine) |
| Damage rules | armor/resistance/crit formulas, status effects and numbers in `dealDamage`, poise counts, overkill throw, mercy invulnerability |
| Elements & statuses | `phys fire frost storm void venom`; `burn chill freeze shock curse poison bleed stun fear slow haste vuln` (`ed/05`) |
| Monsters | archetypes `husk skeleton knight slime wisp` (`ed/30`), all of `ed/31-monsters.js`, `crawler webspinner broodling burrower eye` (`ed/33`); AIs `melee pouncer orb` + beast AIs; elite affixes (`hasted stoneskin vampiric` + others); elite name tables; pack variants (Giant/Swarming); `MOVE_FIX` |
| Bosses | `cinderking broodmother wyrm`; boss bodies `boneking colossus fleshtitan reaver`; patterns `slam charge nova summon cleave meteorrain firewave sweepbeam spinattack leapchain shockring spiral groundspikes teleportstrike mirror enrage wyrmdive ...`; `BOSS_NAMES`, boss scars, arenas, chests, intros |
| Loot | `ed/40-42`: rarity, slots, bases, affixes/tiers, uniques, legendary powers and composed powers, crafting, salvage, essences, stash, vendors, item icons, paper doll, gear visuals |
| Mechanics | `powder wards chasm gale magma ice brood pylons timewell webs dark bloodrush launch flood quake` (`ed/45-47`, parts of `33`/`36`); `LVL_SYNERGY`, `LVL_WORDS` |
| Levels | `PLAN` (15 depths), themes (`crypt` + `ed/51-themes.js`), layouts (`halls islands arena caves`, `ed/52`), level names/cards, depth pacing (`comboSize` schedule), `SCALE` curves, proving grounds |
| Town | Emberhold (`ed/55-56`), NPCs (waykeeper, Bram, Harrow, Seren...), services, dialogue lines, the waystone |
| Characters | Wanderer, Codex, Dan as playable characters: briefs, looks, palettes, rigs' art, resources (manuscript pages, brood), saves, title poses, drop-ins, menu notes |
| Balance numbers | every `knob` default, `DIFF` sliders, archetype/boss/item numbers, depth scaling |
| Game UI screens | HUD (orbs, ember, skill bar, XP), inventory/skills/tree/vendor/smith/mystic/stash/waystone/death/pause/settings panels, title screen kata, character menu content, level/boss cards, minimap look, tips and notice texts |
| Audio content | sfx `zap freeze portal clang thud crack bloop roar chime slash2`, stings, songs `town deep deep2 title`, beast sounds |
| Mocap moment mapping | the specific clip ↔ game-moment table (`Death01`, `Land_Three_Point`, ...); the clip *library* is handled by the mocap research track |
| 2D-only rendering rules | `px.*`, `E.tones` pixel shading, outlines, `r.queue/r.actor` depth-sorted part drawing, `E.charView` sprite-angle cheat, view projections — obsolete in true 3D |

---

## 3. Grey areas — content that could serve as fixtures

| Item | Why grey | Recommendation |
|---|---|---|
| Sample humanoid (Wanderer) | needed to exercise intents, clips, gallery, rig-check | write a new neutral **test mannequin** (grey materials, no cape/sword identity); do not port the Wanderer's look or name |
| Custom creature rigs (Dan, Codex, Crawler, Serpent, Watcher, Reaver) | the techniques are engine-grade, the creatures are content | write **minimal fixture rigs** (~80–150 lines each) that prove each building block: `fixture-digitigrade` (reverse knee + tail + spring limbs), `fixture-hexapod` (planted-foot gait, wall grip), `fixture-chain` (path-follow body), `fixture-floater` (hover/bank, detached hands, orbiters, strands, look-at/blink), `fixture-multiarm` (delayed pose replay); geometric primitives only |
| Training dummy | pure test fixture | re-create generically (`engine/fixtures/dummy`): infinite HP, spring wobble on hit |
| Boss pattern verbs (slam, charge, nova) | generic-sounding but game design | engine ships the pattern **runtime** (roles, range fit, no-repeat, phases) with one or two neutral test patterns (`test_lunge`, `test_ring`) in fixtures only |
| "Powder Kegs" reference mechanic | reference sample for the mechanic API | write a neutral docs example (e.g. "explosive prop") under `examples/`, not in engine |
| Combination scheduler, word grammar, recolour guard | algorithm vs. content | port the algorithms with unit tests; leave pace tables, words and palettes to the game |
| Standard surface tags (ice/water/lava/web) | common, but rules are gameplay | engine provides the surface-tag registry + modifier channels (traction, speedK, drift, DoT hook) with no defaults; tests register a `test_ice` tag |
| Elements/statuses, damage pipeline | generic structure, game formulas | engine offers a hook-staged "hit event" pipeline and a status container (`unit.st[id] = {t, p, n}` with tick) with zero shipped types |
| Bot tactics | harness vs. strategy | engine bot = navigation + watchdogs + telegraph avoidance + content hints; combat tactics are game code |
| Sandbox actions (gold, points, items) | game economy | engine sandbox exposes `registerDevAction()`; game adds its own |
| Sfx and songs | generic names, but authored content | write a fresh engine "stdlib" (ui select/confirm/cancel, hit, whoosh, one demo song) for tests and the gallery |
| Elements' colour families, tone ramps | art direction | re-express as a 3D material-ramp utility; no Emberdeep palettes |

---

## 4. Lessons learned (from the docs and code comments)

**Architecture and process (DESIGN.md, CLAUDE.md, CHARACTERS.md)**
1. Freeze the core and extend through registries, hooks and events; when blocked, an agent reports "the smallest core change" instead of editing it (`ed/DESIGN.md:45`).
2. Build "core + my module" pages so parallel agents test in isolation (`ed/DESIGN.md:229`).
3. A shared global scope forces name prefixes and load-order rules (`ed/DESIGN.md:16-20`) — use modules.
4. Every rule number is a documented knob whose default is the shipped value (`ed/DESIGN.md:47-49`); the test makes undocumented or out-of-range knobs impossible.
5. Content must work in any combination, view and zoom; missing ids fall back gracefully (`ed/DESIGN.md:112, 222-223`).
6. Never write the global time scale directly; use the stack (`ed/DESIGN.md:143`). Per-step movement modifiers are set every step; persistent ones (`timeK`) must be reset by their owner (`ed/DESIGN.md:153-154`).
7. Runtime map changes require explicit cache invalidation (`L.map.floors = {}`, `ed/DESIGN.md:122,137`) — make cache invalidation an API, not folklore.
8. Testing is mandatory per module: zero console errors and `game.errors`; read your screenshots; filmstrip every animation with `--seed` and `--compare` (`ed/DESIGN.md:227-237`).
9. Scaffold from a template that already passes the checks; `new-character.mjs --test` runs the templates in CI "so the templates never rot" (`tools/new-character.mjs:10-11`).
10. One command per loop with a short summary; open screenshots only on failure (`docs/CHARACTERS.md:15-16`).
11. Write the brief before code: who, silhouette in three words, motion language, combat verbs, palette, readability in every view (`docs/CHARACTERS.md:19-28`).

**Animation (CHARACTERS.md, DAN.md, CODEX.md)**
12. Ease every weight; build joints from weights; a directly-set joint "snaps, and the sheet flags it as a pop" (`docs/CHARACTERS.md:69`).
13. Keep bones rigid with IK and *declare* rigid pairs (`rig.bones`); measuring a Humanoid's limbs on every body misread a reverse knee as a stretching shin (`docs/DAN.md:69`).
14. Blend directions as angles; swing on springs (`docs/CHARACTERS.md:74-75`).
15. A pop is a spike *relative to neighbouring steps*, not an absolute threshold — a fast blade tip is motion (`docs/DAN.md:70`).
16. Separate cosmetics from gameplay: Codex's hover "is cosmetic. Codex still collides with walls ... needs a dodge or a movement skill to cross gaps" (`docs/CODEX.md:15`); hitboxes may be slimmer than silhouettes (`docs/DAN.md:21`). This is principle 5 applied to animation.
17. Readability is measured: Dan's near-black concept "vanished on dark floors; the sheet measured it at 36-40% contrast ... now 67% or more" (`docs/DAN.md:20`).
18. Show the real rig in docs/showcases: "No generated image or external asset is substituted for the playable model" (`docs/CODEX.md:47`).
19. Content needs test hooks: `prime(h)` so a resource-gated skill doesn't fizzle in gallery/sandbox/tests; `bot: { ready }` so the autopilot knows prerequisites (`docs/DAN.md:71-72`).

**Determinism and bots (DAN.md, autopilot comments)**
20. "The balance run was not repeatable (slow motion, the death panel and the performance governor read the real clock); its clock now moves only with its steps" (`docs/DAN.md:74`) — simulation and governors must read an injectable clock.
21. Stuck detection must measure progress along the desired direction; collision push-out jitter defeated a "not moving" test (`docs/DAN.md:73`, `ed/93-autopilot.js:167-169`).
22. Bots are rough guides: a hero needing human timing looks weaker (`docs/CHARACTERS.md:107`).

**Tuning (TUNING.md)**
23. Document *when* a change takes effect (now / next spawn / next level) and show a marker while the rules differ from shipped.
24. Provide a "Where do I change…?" map from intent to knob to source file; for behaviour, point to the file and "ask Claude".
25. Settings export as JSON is the bridge from a human playtester to an agent who "bakes in" defaults.

**Controls (CONTROLS-AUDIT.md)**
26. Scan every gamepad slot; release inputs on disconnect, blur, visibility loss and modal changes; track each touch pointer and handle `pointercancel`.
27. Keep fixed menu actions separate from rebindable gameplay actions.
28. HUD hover must not suppress other devices' actions; pause must work over conversations; scene exits must stop old updates; restore saved camera view unless a URL overrides it.
29. Phones: fill portrait screens, respect safe areas, keep HUD clear of touch buttons, offer fullscreen.
30. Be explicit about verification limits (no physical controllers/devices) — honesty in reports.

**Feel and composition (code comments)**
31. Budget feedback: hit-stop, impact stars and glints are throttled per step so crowds stay readable (`ed/10-combat.js:45-53`).
32. Status tints must pulse gently, never strobe (`ed/05-elements.js:84-86`); bosses flash only their outline on light hits (`ed/30-monsters-core.js:100-104`).
33. Compose by role, not at random: two random verbs "were often two leaps... a composed boss of depth 20 fought for 45 s without landing a blow" (`ed/35-bosses-core.js:170-171`).
34. Novelty schedulers beat sorted enumeration: sorting pairs by age "left flood and the quake out of play to depth 107" (`ed/50-levels-core.js:70-72`).
35. Recolouring must not brighten materials; a luminance guard keeps hue shifts legible (`ed/50-levels-core.js:329-335`).

---

## 5. Recommendations — engine features to build generically (prioritized)

**P0 — foundation that shapes every agent workflow (build first)**
1. `core/registry` — `defineKind` with schema (fields, defaults, docs, numeric ranges, visual flags, required hooks, contract ids); `def/get/list`; duplicate warnings; graceful-fallback helpers. *Accept*: schema drives validation, docs, inspector and tests.
2. `core/events` — scoped lifetimes, per-listener isolation into `errors`, typed catalog, trace ring buffer.
3. `core/time` — fixed step, injectable/virtual clock (deterministic mode), timescale stack with ids, per-entity clocks, timers. *Accept*: a seeded run produces identical logs twice.
4. `core/rng` — named seeded streams; URL/test seed override.
5. `debug/handle` + `debug/routes` — `window.__engine`, deep links for scenes, showcases, seeds, cameras, `?test=`; errors/warnings arrays; Node step-DSL driver (port of `ed-play.mjs`).
6. `tune/` — knob registry, override layer `kind.id.path`, persistence, JSON export/import, TUNED marker, DOM panel with tiers/search/inspectors; test that every knob is in range and documented.

**P1 — inspection and testing loop (principles 3–4)**
7. `testing/rig-check` + `testing/rig-sheet` — intent-state table × facings × camera presets; contract checks with plain-sentence problems; lints (pop spikes, foot slide, under-ground, rigid-pair drift, silhouette per camera, ground contrast, material count); JSON + PNG.
8. `gallery/` — registry-driven reels (actors, rigs × intents, abilities, clips, audio), deep-linked entries, slow-mo, camera presets, replay, dummy fixture, virtual-input driven demos, wrong-name warnings listing valid names.
9. `bot/` — virtual input device; baseline navigation policy with progress watchdog and directional stuck detection; content hint protocol (`tags`, `kind`, `bot: { ready, heal }`); run logger; headless deterministic harness; smoke test over all scenes/seeds.
10. `dev/sandbox` — save-isolated sandbox; god/resources (`prime`)/cooldowns/freeze AI/pause/step/speed/full-bright/collider + navmesh debug/perf overlay; spawn any registered actor (with cap); travel; `registerDevAction`.
11. `scaffold/` — generators for actor, rig (by building block), ability, mechanic; templates pass all checks and are re-tested in CI; one-command `check:<thing>` with a ≤ 20-line summary.

**P1 — animation toolkit (carries the 3D/mocap work forward)**
12. `anim/intents` — the shared intent vocabulary + adapters; rig-check verifies the core set.
13. `anim/proc` — state weights, springs (scalar/vec/quat, `kick`), two-bone IK with pole + digitigrade variant, `LegGait` (planted feet, groups, raycast targets incl. walls), `PathChain`, `VerletStrand`, `SwayChain`, `LookAt`/`Blink`, `Floater` (hover/bank/fold), `Orbiters`, `PoseHistory` (delayed replay), sockets, trail ribbons, floor clamp; angle/quaternion blending rule.
14. `anim/clip-layer` — weighted masked clip layers with crossfade-from-current-pose, `walk/hold/next/landed` flags, cancel policies, priority wishes, event triggers.
15. `anim/attack-timeline` + `measureMove` — wind/active/recover with `u`, shared by rigs, hit volumes, telegraphs, AI, bots; animation-derived reach cached and invalidated by tuning.

**P2 — gameplay kits (generic, content-free)**
16. `compose/` — role-based selection, no-repeat, stalest-first combination scheduler, word grammar for names, luminance-guarded recolour of materials.
17. `world/surfaces` + `world/things` — surface-tag registry with per-step modifier channels; hittable interactive props; sphere/cone area queries with dedupe sets; spatial grid.
18. `ai/` — attack-token manager, awareness with LOS and group wake, flow-field/navmesh steering, per-entity clocks.
19. `fx/telegraph` + `feel/` — telegraph shapes as data with near-miss gaps; hit-stop leaky budget; shake; per-step effect budgets; combat-text aggregator; slow-mo stacking.
20. `input/` — action maps across keyboard/mouse/gamepad/touch, rebinding UI with conflicts/reserved keys/validation/persistence, fixed menu actions, device-aware labels, any-slot pads, radial deadzone, focus-loss clear + pause hook, touch layer, safe-area frame.
21. `perf/governor` — tiered adaptive quality with hysteresis; owns WebGPU-only extras and LOD; frozen in deterministic runs.
22. `audio/` — data-defined layered sfx and tracker songs with invariant validation; event-bound stings; registry with built-in fallbacks.
23. `ui/` + `save/` — panel stack with modal pause, accessible DOM dialogs with gamepad nav, notice router, one-time tips, UI waits on animation landmarks; save slots with whitelist, versioning, and demo/sandbox/gallery isolation.
24. `actors/` — playable/NPC registry with hook-with-default discipline (`rig`, `prime`, `init`, `stats`, `arrival`, `showcase(t)`, `preview`, `ownLayers`, `clips`), per-actor save slot, material override for echo/portrait passes.

**Ordering rationale.** P0 items are referenced by everything else and cannot be retrofitted cheaply (schemas, deterministic clock, debug handle). P1 gives agents eyes before content exists; the animation toolkit should land together with rig-check so every building block ships with a fixture and a passing check. P2 kits are generic but only valuable once a game starts; build them as the first game needs them, each with fixtures rather than Emberdeep content.
