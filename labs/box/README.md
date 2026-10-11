# The Stress Box

The engine's integration target (PLAN.md §9.0): a test scene, benchmark and sample that grows through six stages,
each proved by commands that need no display. Stage 1 (Box 1, gate G2): the box renders on WebGPU, steps headless
with golden hashes that hold in Node and in Chromium, and is inspected and set from `node x` and `window.__engine`.
Stage 2 (Box 2, gate G3): a hero walks, dashes and jumps through the character controller, his body stepped by the
animator, in replays whose hashes hold while the page renders and whatever the camera. Stage 3 (Box 3, gate G4): the
hero climbs the hall's stairs to a gallery, walks its dais, and pushes and shoves its crates and barrels in replays
that hold in Node and in the page. Every claim below is checked by `tests/unit/box-readme.test.ts`: a setting, file or
command named here that does not exist fails it.

## Scenes

| Scene | What it shows | Covered by |
|---|---|---|
| `box:room` (`labs/box/scenes/room.ts`) | The room, `labs/box/levels/room.txt`: 16 × 12 m of flagstones in brick walls 3 m high, one low wall (0.75 m), a 2 × 2 m pillar, the hero's spawn and three numbered markers. Three crates move on fixed paths from the markers, no physics yet: along the low wall, round a circle, round the pillar. | `tests/e2e/box.spec.ts`, `tests/e2e/parity.spec.ts`, `tests/replays/box-1-room.replay.json`, `tests/replays/box-1-tuned.replay.json`, `labs/box/scenes/room.test.ts`, `tests/baselines/thumbs/box-room-iso.json` |
| `box:room-hero` (`labs/box/scenes/room-hero.ts`) | The same room as a physics level, and the hero (`labs/box/cast/hero.ts`: the stress test's speeds and timings, 5 m/s, a 1.46 m jump, a 3.25 m dash) at the spawn, the player: he walks (WASD, a stick), jumps (Space) onto the low wall but not the walls, and dashes (Shift); his animator steps his body with the sim, drawn as the neutral humanoid. Every camera follows him, and the walls and the pillar before him cut away; first person hides his body but his hands. | `tests/e2e/box-hero.spec.ts`, `tests/e2e/parity.spec.ts`, `tests/replays/box-2-walk.replay.json`, `tests/replays/box-2-dash.replay.json`, `tests/replays/box-2-jump.replay.json`, `labs/box/scenes/room-hero.test.ts`, `labs/box/cast/hero.test.ts` |
| `box:hall` (`labs/box/scenes/hall.ts`) | The hall, `labs/box/levels/hall.txt`, as a physics level: 64 × 44 m inside walls 3 m high, a grid of pillars, low walls, 30 brazier stands, two galleries 1 m up along the north wall with stairs rising to each, and the octagonal rune dais at the centre, 0.5 m up. The hero starts on the dais: he walks down its slopes and up them, climbs the stairs to the galleries, jumps onto the low walls; the walls and pillars before him cut away. | `tests/e2e/box-hall.spec.ts`, `tests/e2e/parity.spec.ts`, `tests/replays/box-3-climb.replay.json`, `tests/replays/box-3-dais.replay.json`, `labs/box/scenes/hall.test.ts`, `tests/baselines/thumbs/box-hall-iso.json` |
| `box:hall-props` (`labs/box/scenes/hall-props.ts`) | The hall with the hero and its props, standing in Rapier and drawn through one instanced batch per prop part: a brazier's fire on each of the 30 stands, and 100 crates and barrels (10 to 300) on the prototype's seeded spots, every fifth crate stacked on the one before where both are crates. He pushes them by walking into them, and shoves (J, the left mouse button) every prop within 1.9 m in his arc, knocking it away, both hands thrust forward. | `tests/e2e/box-hall.spec.ts`, `tests/e2e/parity.spec.ts`, `tests/replays/box-3-knock.replay.json`, `labs/box/scenes/hall-props.test.ts` |

The page draws each mover as a crate: an entity is drawn as a stand-in box when one of its components declares `x`
and `z` in metres (engine/gfx/stage.ts), until it draws itself: actors with an animator are puppets from Box 2
(engine/gfx/puppets/actors.ts), and props a scene stands with `spawnProp` (engine/sim/props.ts) are drawn as their
props from Box 3 (engine/gfx/stageProps.ts).

## Settings

| Setting | What it tunes |
|---|---|
| `box.room.speed` | How fast the movers go along their paths, m/s (1.5). Changes play: recorded in replays. |
| `box.room.movers` | How many of the three movers run (3), when the scene starts. |
| `box.roomHero.speed` | How fast the hero walks, m/s (5), when the scene starts. Changes play: recorded in replays. |
| `box.roomHero.jump` | The hero's take-off speed, m/s (9.375: a 1.46 m apex under his 30 m/s² gravity), when the scene starts. |
| `box.roomHero.dash` | The hero's dash speed, m/s (16.25, for 0.2 s; 0 turns it off), when the scene starts. |
| `box.hall.speed` | How fast the hero walks in the hall, m/s (5), when the scene starts. Changes play: recorded in replays. |
| `box.hall.jump` | The hero's take-off speed in the hall, m/s (9.375), when the scene starts: below about 7.75 m/s he no longer jumps onto the galleries, 1 m up, and climbs to them by the stairs alone. |
| `box.hall.dash` | The hero's dash speed in the hall, m/s (16.25, for 0.2 s; 0 turns it off), when the scene starts. |
| `box.hallProps.count` | How many crates and barrels stand in the hall with its props (100, 10 to 300), when the scene starts. Changes play: recorded in replays. |
| `gfx.resolution` | The resolution mode: `pixels`, `balanced` or `full`. A view setting: never in the hash. |
| `time.scale` | Sim seconds per real second (1). A view setting. |
| `touch` | The touch controls: `auto`, `on` or `off`. A view setting (below). |

Set one with `node x set box.room.speed 3`, as a URL parameter (`labs/box/?box.room.speed=3`), or with
`__engine.set('box.room.speed', 3)`; `node x describe setting` lists them all.

## The page

`labs/box/` opens the room; the landing page (`index.html`) opens the box. Its routes: `?scene=room`, `?seed=4`,
`?cam=iso` (a camera code: `cam=topdown`, `cam=iso,45,2,persp`, `cam3=orbit`, `cam3=fly`; with the hero also
`cam3=chase`, `cam3=first` and `cam3=rail`, which follow him), any setting by its path,
and `?replay=box-1-room` (a replay played in real time; `?replay=box-2-jump` opens the hero's room, `?replay=box-3-climb`
the hall, `?replay=box-3-knock` the hall with its props). In the page,
`window.__engine.help()` lists every member.

On a phone or tablet the page shows the touch controls (`labs/box/touch.ts`, for every scene): a floating stick
wherever the thumb lands, jump as the main button and dash beside it. Like the rest of the touch layer they are not
tested (ADR-0021); `labs/box/?touch=on` shows them on a desktop.

## The quick loop

1. Change a setting or the scene, then run it headless: `node x sim labs/box/scenes/room --steps 600 --set box.room.speed=3`;
   for the hero, `node x sim labs/box/scenes/room-hero --feel --set box.roomHero.speed=6` also prints how he handles.
2. See it as numbers: `node x shot labs/box --scene room --cam iso` (the ID pass and the look metrics; `--png` for
   a picture, `--thumb box-room-iso` against the baseline); for the hall,
   `node x shot labs/box --scene hall --cam iso --thumb box-hall-iso`.
3. Prove play: `node x replay tests/replays/box-1-room.replay.json --browser page` (the goldens, in Node and in the
   page while it renders); `node x replay tests/replays/box-2-jump.replay.json --browser page` for the hero,
   `node x replay tests/replays/box-3-climb.replay.json --browser page` in the hall.
4. Keep a page open while iterating: `node x inspect --scene room`, then `node x eval "__engine.hash()"`,
   `node x set box.room.speed 3`, `node x dump --step 60 --filter pathMover` and `node x shot labs/box --scene room`
   (it reuses the session); `node x inspect --stop` ends it.
5. Commit with the suites green: `npm run e2e -- tests/e2e/box.spec.ts tests/e2e/parity.spec.ts`, and for the hall
   `npm run e2e -- tests/e2e/box-hall.spec.ts`.

## Adding a scene or a variant

A variant is a new scene file or a settings preset, never a change of meaning in a passing scene (PLAN.md §9.0).
`node x new scene labs/box/scenes/<name>` writes a box scene with its replay test, which passes its checks; the page
imports every module under `labs/box/scenes/`, so it opens at `labs/box/?scene=<name>`. Then keep a replay of it, the
sequence `tests/e2e/parity.spec.ts` runs on a new scene:

1. `node x sim labs/box/scenes/<name> --steps 600` writes the run's replay beside its report.
2. Copy `out/sim/box-<name>/run.replay.json` to `tests/replays/box-<stage>-<name>.replay.json`.
3. `node x replay <file> --browser sim --update` records its goldens, which hold in Node and in Chromium.
4. `node x replay <file> --browser page` checks them while the page renders.
5. List the scene and the replay here, with what it shows, what covers it and the settings that tune it.
6. When it belongs to a stage, add it to `STAGES` in `tests/e2e/parity.spec.ts`: T2's rendering-page check plays
   only the replays named there.

The `stress-box` skill (`.claude/skills/stress-box/SKILL.md`) says the rest.
