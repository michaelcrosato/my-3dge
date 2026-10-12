---
name: stress-box
description: The Stress Box (labs/box), the engine's integration target - its layout, how to add a scene or a variant, and the quick loop (x set, x sim, x shot, x replay --browser page, x inspect). Use when you work on the box, add or tune a box scene, or need to show an engine capability in the box.
---

# The Stress Box

PLAN.md §9.0 is the rule: the box grows through six stages (Box 1 to Box 6), each a phase whose gate is what the box
can do, proved by commands that need no display. labs/box/README.md says what each scene shows, what covers it and
the settings that tune it; a test (tests/unit/box-readme.test.ts) fails when it names something that does not exist.

## Layout

| Path | What it is | Layer |
|---|---|---|
| `labs/box/index.html`, `labs/box/main.ts` | The page: imports every scene under `scenes/`, every look under `looks/` and the levels as `?raw` text, then `createEngine` | page (engine/index.ts only) |
| `labs/box/scenes/*.ts` | Sim-side scene modules: level, settings, spawns, systems; `x sim` runs them in Node | sim-side (engine/sim-api.ts only) |
| `labs/box/cast/*.ts` | The cast: the hero (`HERO`, `HERO_FIGHT`), the walkers, slimes and wisps, their numbers and steering | sim-side |
| `labs/<lab>/props/*.ts`, `<lab>` = `box` (none yet) | The box's own props, made by `node x new prop labs/<lab>/props/<name>`; the page reaches one only through a scene that imports it | sim-side data |
| `labs/box/looks/*.ts` | The box's looks (`look:torch-lit`…, `node x new look`) and the hall floor's bake | page (view data) |
| `labs/box/sounds/*.ts` | The box's sounds from its sim events, its effects and music (WP 9.5) | page |
| `labs/box/touch.ts` | The touch controls on a phone (ADR-0021: not tested) | page |
| `labs/box/levels/*.txt` | Levels in the legend's text format (engine/world/level) | data |
| `tests/replays/box-*.replay.json` | Recorded runs with goldens, played in Node, the sim-only page and the box page | tests |
| `tests/e2e/box.spec.ts`, `tests/e2e/parity.spec.ts` | The box suite and the CPU-only gameplay contract | T2 |

The engine does the rest: routes (`?scene ?seed ?cam ?replay`, settings by path), the renderer and warm-up, the frame
loop, `window.__engine`, the error overlay (engine/app/engine.ts). The view is built from data: the level's meshes
(each wall run its own mesh, so the ID pass names it, with the cutaway the view runs while it follows a player),
actors with an animator as puppets (engine/gfx/puppets/actors.ts, with their `reactions` and `secondary` motion),
props stood with `spawnProp` (engine/gfx/stageProps.ts), crowd bodies (engine/gfx/stageCrowd.ts), the fight's effects
(engine/gfx/stageFx.ts), and a stand-in box for every other entity whose component declares `x` and `z` in metres
(engine/gfx/stage.ts). The camera follows the
first player actor. `createHeadless({ scene, view: true })` builds the same view in Node, for `scene.dump()` and
`camera`.

Rules: the box's cast, numbers and behaviour stay in labs/box/ (never the engine); a component name is global, so
prefix a scene's own (`pathMover`, `spinnersCrate`); a scene's settings are `box.<scene>.<name>`.

## Add a scene or a variant

1. `node x new scene labs/box/scenes/<name>`: a scene and its replay test that pass their checks; the page opens it at
   `labs/box/?scene=<name>` (main.ts imports every scene module).
2. Make it show what the stage needs. A variant is a new file or a settings preset, never a change of meaning in a
   passing scene.
3. Record a replay: `node x sim labs/box/scenes/<name>.ts --steps 600` (no intents), copy
   `out/sim/box-<name>/run.replay.json` to `tests/replays/box-<stage>-<name>.replay.json` and edit its `inputs` to
   drive it (`[0, { "move": [0, 1] }]` walks south, +Z: tests/replays/README.md, "Coordinates and inputs"); `node x
   replay <file> --state` writes where it ends (out/replay/<name>/state.json). Then `node x replay <file> --browser sim
   --update` (goldens hold in Node and Chromium) and `node x replay <file> --browser page` (while the page renders).
   `<stage>`: labs/box/README.md, "Adding a scene or a variant", step 2.
4. List it in labs/box/README.md's demo index and settings (tests/unit/box-readme.test.ts fails a scene or a `box.*`
   setting left out) and extend the box suite. When it belongs to a stage, add it to `STAGES` in
   tests/e2e/parity.spec.ts: T2's rendering-page check plays only those.

## Add a prop

labs/box/README.md, "Adding a prop", has the steps; labs/box/scenes/hall-props.ts is the worked example.

1. `node x new prop labs/<lab>/props/<name>` (`<lab>` = `box`); `node x qa geo tex --only prop:<name>` checks it
   (and counts what it checked).
2. Import it from the scene that shows it: nothing else loads the box's props in the page.
3. The scene has `physics: true` and, in `setup`, `addLevelBodies(physicsOf(w), <compiled level>)`: the template's
   `level: 'level:room'` is drawn but has no bodies (room-hero.ts exports `ROOM_HERO_LEVEL`, hall.ts `HALL_LEVEL`).
4. `spawnProp(w, { prop: 'prop:<name>', at: [x, y, z], yaw })`: its base at `at` (m), `yaw` about +Y (rad). Or give
   the prop `place: { spawn: '<spot>' }`, a glyph `defineGlyph('glyph:<spot>', { char, description, mesh: 'floor',
   spawn: '<spot>' })` in the level, and spawn `levelProps(<compiled level>)`.

## The quick loop

- `node x set box.room.speed 3` (validates, prints the URL, applies to a running `x inspect`)
- `node x sim labs/box/scenes/room.ts --steps 600 --set box.room.speed=3` (hash, events, a replay of the run)
- `node x shot labs/box --scene room --cam iso` (ID pass, look metrics; `--png`, `--marks`, `--thumb <case>`)
- `node x replay tests/replays/box-1-room.replay.json --browser page` (goldens while the page renders; `--state` or
  `--until n` writes the state the run reaches to out/replay/<name>/state.json)
- `node x inspect --scene room`, then `node x eval "<js>"`, `node x dump --step 60`, `node x shot …` (reuses it),
  `node x inspect --stop`

Read the report.json files under out/, not scrollback. Images only when a metric points at one (the
`visual-reviewer` subagent reads them).
