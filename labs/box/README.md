# The Stress Box

The engine's integration target (PLAN.md §9.0): a test scene, benchmark and sample that grows through six stages,
each proved by commands that need no display. This is stage 1 (Box 1, gate G2): the box renders on WebGPU, steps
headless with golden hashes that hold in Node and in Chromium, and is inspected and set from `node x` and
`window.__engine`. Every claim below is checked by `tests/unit/box-readme.test.ts`: a setting, file or command named
here that does not exist fails it.

## Scenes

| Scene | What it shows | Covered by |
|---|---|---|
| `box:room` (`labs/box/scenes/room.ts`) | The room, `labs/box/levels/room.txt`: 16 × 12 m of flagstones in brick walls 3 m high, one low wall (0.75 m), a 2 × 2 m pillar, the hero's spawn and three numbered markers. Three crates move on fixed paths from the markers, no physics yet: along the low wall, round a circle, round the pillar. | `tests/e2e/box.spec.ts`, `tests/e2e/parity.spec.ts`, `tests/replays/box-1-room.replay.json`, `tests/replays/box-1-tuned.replay.json`, `labs/box/scenes/room.test.ts`, `tests/baselines/thumbs/box-room-iso.json` |

The page draws each mover as a crate: an entity is drawn as a stand-in box when one of its components declares `x`
and `z` in metres (engine/gfx/stage.ts), until actors and props draw themselves (Box 2 and Box 3).

## Settings

| Setting | What it tunes |
|---|---|
| `box.room.speed` | How fast the movers go along their paths, m/s (1.5). Changes play: recorded in replays. |
| `box.room.movers` | How many of the three movers run (3), when the scene starts. |
| `gfx.resolution` | The resolution mode: `pixels`, `balanced` or `full`. A view setting: never in the hash. |
| `time.scale` | Sim seconds per real second (1). A view setting. |

Set one with `node x set box.room.speed 3`, as a URL parameter (`labs/box/?box.room.speed=3`), or with
`__engine.set('box.room.speed', 3)`; `node x describe setting` lists them all.

## The page

`labs/box/` opens the room; the landing page (`index.html`) opens the box. Its routes: `?scene=room`, `?seed=4`,
`?cam=iso` (a camera code: `cam=topdown`, `cam=iso,45,2,persp`, `cam3=orbit`, `cam3=fly`), any setting by its path,
and `?replay=box-1-room` (a replay played in real time). In the page, `window.__engine.help()` lists every member.

## The quick loop

1. Change a setting or the scene, then run it headless: `node x sim labs/box/scenes/room --steps 600 --set box.room.speed=3`.
2. See it as numbers: `node x shot labs/box --scene room --cam iso` (the ID pass and the look metrics; `--png` for
   a picture, `--thumb box-room-iso` against the baseline).
3. Prove play: `node x replay tests/replays/box-1-room.replay.json --browser page` (the goldens, in Node and in the
   page while it renders).
4. Keep a page open while iterating: `node x inspect --scene room`, then `node x eval "__engine.hash()"`,
   `node x set box.room.speed 3`, `node x dump --step 60 --filter pathMover` and `node x shot labs/box --scene room`
   (it reuses the session); `node x inspect --stop` ends it.
5. Commit with the suites green: `npm run e2e -- tests/e2e/box.spec.ts tests/e2e/parity.spec.ts`.

## Adding a scene or a variant

`node x new scene labs/box/scenes/<name>` writes a box scene with its replay test, which passes its checks; the page
imports every module under `labs/box/scenes/`, so it opens at `labs/box/?scene=<name>`. A variant is a new scene
file or a settings preset, never a change of meaning in a passing scene (PLAN.md §9.0). Keep a replay of it in
`tests/replays/` with goldens from `node x replay <file> --browser sim --update`, and list it here with what it
shows, what covers it and the settings that tune it. The `stress-box` skill (`.claude/skills/stress-box/SKILL.md`)
says the rest.
