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
| `labs/box/index.html`, `labs/box/main.ts` | The page: imports every scene under `scenes/` and the levels as `?raw` text, then `createEngine` | page (engine/index.ts only) |
| `labs/box/scenes/*.ts` | Sim-side scene modules: level, settings, spawns, systems; `x sim` runs them in Node | sim-side (engine/sim-api.ts only) |
| `labs/box/levels/*.txt` | Levels in the legend's text format (engine/world/level) | data |
| `tests/replays/box-*.replay.json` | Recorded runs with goldens, played in Node, the sim-only page and the box page | tests |
| `tests/e2e/box.spec.ts`, `tests/e2e/parity.spec.ts` | The box suite and the CPU-only gameplay contract | T2 |

The engine does the rest: routes (`?scene ?seed ?cam ?replay`, settings by path), the renderer and warm-up, the frame
loop, `window.__engine`, the error overlay (engine/app/engine.ts). The view is built from data: the level's meshes
(each wall run its own mesh, so the ID pass names it, with the cutaway the view runs while it follows a player),
actors with an animator as puppets (engine/gfx/puppets/actors.ts), and a stand-in box for every other entity whose
component declares `x` and `z` in metres, until props draw themselves (engine/gfx/stage.ts). The camera follows the
first player actor. `createHeadless({ scene, view: true })` builds the same view in Node, for `scene.dump()` and
`camera`.

Rules: the box's cast, numbers and behaviour stay in labs/box/ (never the engine); a component name is global, so
prefix a scene's own (`pathMover`, `spinnersCrate`); a scene's settings are `box.<scene>.<name>`.

## Add a scene or a variant

1. `node x new scene labs/box/scenes/<name>`: a scene and its replay test that pass their checks; the page opens it at
   `labs/box/?scene=<name>` (main.ts imports every scene module).
2. Make it show what the stage needs. A variant is a new file or a settings preset, never a change of meaning in a
   passing scene.
3. Record a replay: `node x sim labs/box/scenes/<name> --steps 600`, copy `out/sim/box-<name>/run.replay.json` to
   `tests/replays/box-<stage>-<name>.replay.json`, then `node x replay <file> --browser sim --update` (goldens hold in
   Node and Chromium) and `node x replay <file> --browser page` (and while the page renders).
4. List it in labs/box/README.md (scene, what it shows, covered by, its settings) and extend the box suite. When it
   belongs to a stage, add it to `STAGES` in tests/e2e/parity.spec.ts: T2's rendering-page check plays only those.

## The quick loop

- `node x set box.room.speed 3` (validates, prints the URL, applies to a running `x inspect`)
- `node x sim labs/box/scenes/room.ts --steps 600 --set box.room.speed=3` (hash, events, a replay of the run)
- `node x shot labs/box --scene room --cam iso` (ID pass, look metrics; `--png`, `--marks`, `--thumb <case>`)
- `node x replay tests/replays/box-1-room.replay.json --browser page` (goldens while the page renders)
- `node x inspect --scene room`, then `node x eval "<js>"`, `node x dump --step 60`, `node x shot …` (reuses it),
  `node x inspect --stop`

Read the report.json files under out/, not scrollback. Images only when a metric points at one (the
`visual-reviewer` subagent reads them).
