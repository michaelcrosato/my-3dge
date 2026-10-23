# Replays

Each `*.replay.json` here is a recorded run of a scene: its inputs from step 0 and its golden hashes. One set of
goldens per platform holds in Node and in Chromium alike (PLAN.md §6.5, §8.4). The format, its checks and the player
are in engine/sim/replay.ts; the inputs' vocabulary is engine/input/intents.ts.

```json
{
  "format": "my3dge-replay/1",
  "description": "What the run shows, in a sentence.",
  "scene": "kernel",
  "settings": { "kernel.movers": 24 },
  "seed": 7,
  "hz": 60,
  "steps": 600,
  "inputs": [
    [0, { "cam": 0.785, "move": [0.7071067811865475, 0.7071067811865476] }],
    [90, { "b": ["boost"] }],
    [150, { "b": null }],
    [240, { "set": { "kernel.speed": 2 } }],
    [300, { "dev": "nudge", "args": { "id": 3, "dx": 0.5 } }]
  ],
  "hashes": { "linux-x64": { "0": "…", "60": "…", "600": "…" } }
}
```

- `[k, change]` applies after k steps, before the next: its `set` first, then its `dev` action (the scene's
  `actions`), then its intents. Held intents repeat until a later point changes them; `null` clears one; `p`
  (pressed) belongs to its step only. Settings marked `view` never go in a replay.
- A hash keyed `"k"` is the state after k steps, before the inputs at k. Each platform's goldens (`<os>-<arch>` as
  Node names them: `linux-x64`, `darwin-arm64`) cover the run: they hold the last step's hash at least, keyed by whole
  numbers written plainly (`"60"`, never `"060"`). `--update` records 0, every 60 steps and the last.
- `engine`, `three` and `rapier` are written by `--update`.
- A session records setting changes made through `session.set` or its own store (`session.settings`), and dev actions
  (all or nothing: one that throws changes nothing and is not recorded).

## Coordinates and inputs

The world is SI metres with +Y up (ADR-0004): +X is east, +Z south, and a body facing yaw ψ looks along
(sin ψ, 0, cos ψ), so yaw 0 faces +Z. A level's tile (col, row) has its centre at ((col + 0.5) × tile, (row + 0.5) ×
tile) on the floor, rows running +Z; the box's tiles are 1 m, so `labs/box/levels/room.txt`'s `@` in column 3, row 2
is the spawn at (3.5, 2.5). An input's `move` is a world-space direction [x, z], length 1 at most: `[0, { "move": [0, 1] }]`
walks the hero south (+Z) from step 0 until a later point changes it, `[60, { "move": null }]` stops him,
`[90, { "p": ["jump"] }]` jumps once and `[90, { "b": ["jump"] }]` holds it. engine/input/intents.ts lists every
key (`b` held and `p` pressed buttons: `jump`, `dash`, `attack`, `skill`). `node x sim <scene>` steps with no
intents, so the replay it writes (`out/sim/<slug>/run.replay.json`) has `"inputs": []`: edit them there, then record
(`--update`, below) and check where the run ends with `--state`.

## Working with them

| Task | Command |
|---|---|
| Check every replay, in Node and in Chromium (tests/pages/replay.html) | `node x replay tests/replays --browser sim` |
| Record or re-record the goldens of this platform (writes only when every file and the page pass) | `node x replay <file> --browser sim --update` (say why in the commit) |
| Find the first step, entity and field where runs part | `node x replay <file> --browser sim --bisect` |
| Show that a replay depends on the fdlibm swap | `node x replay <file> --browser sim --swap none` (must fail) |
| See the state a replay ends in: every entity's components (where the hero, a prop, a body stands) and the trace | `node x replay <file> --state` writes it to `out/replay/<name>/state.json`; `--until <n>` the state after step n |
| Make a new one | write it by hand, or copy `out/sim/<slug>/run.replay.json` from `node x sim <scene>` (the slug is the scene id as a directory name: `box:room` → `box-room`), then `node x replay <file> --browser sim --update` |
| Make one for a box scene | the six steps in labs/box/README.md, "Adding a scene or a variant": named `box-<stage>-<name>.replay.json`, checked with `--browser page`, listed in that README and, for a stage, in tests/e2e/parity.spec.ts's `STAGES` (T2's page check plays only those) |

The kernel replays (`kernel-*.replay.json`) run fixtures/scenes/kernel/index.ts. Without the swap, Node and Chromium
part at step 0 (kernel-crowd) and by step 60 (kernel-movers), so their one set of goldens proves the swap end to end.
On another platform a replay runs twice, compares the runs, and reports "golden: other platform". The
`determinism-debugging` skill (.claude/skills/determinism-debugging/SKILL.md) says what to check when runs part.

## History

- The kernel goldens were re-recorded (`--update`, Node ×3 and Chromium ×3 agreeing) when the hash format became
  `my3dge-state/2` (the WP-1.4 review fixes, ADR-0006 amendment 3: the world's step rate is hashed). The runs
  themselves did not change: each replay's final state, step rate and format tag aside, is the same field for field
  as under `my3dge-state/1`; only the hashes moved.
- The kernel goldens were re-recorded (`--update`, Node ×3 and Chromium ×3 agreeing) when the hash format became
  `my3dge-state/3` (the G1 re-review fixes, ADR-0006 amendment 5: firing n of `every` is due at its start plus n
  periods, so each timer's state holds its start tick and firing count; finals now `e82d3715dd7ebf60` for
  kernel-crowd and `123e33f07be4148e` for kernel-movers). The runs themselves did not change: the kernel's
  `every(2.5)` is a whole 150 ticks, and each replay's final state, timer tuples and format tag aside, is the same
  field for field as under `my3dge-state/2`; only the hashes moved.
- The goldens of the eight replays with a hero (box-2-walk, box-2-dash, box-2-jump, box-3-climb, box-3-dais,
  box-3-knock, box-4-chase, box-4-hop) were re-recorded (`--update`, Node ×3 and Chromium ×3 agreeing) when the
  humanoid's state gained the arm path, `HumanoidState.arm` (WP 6.1: a move told as the body state `body` plays
  on the arms), which the hero's animator saves into the hashed state. The runs themselves did not change: with
  `arm` left out of the animator's saved state, all fifteen replays gave their earlier goldens in Node and Chromium.
- box-5-fight's goldens were re-recorded (`--update`, Node ×3 and Chromium ×3 agreeing) at gate G7's review, when the
  fight's blows began to go through the bodies' reactions (WP 7.8, ADR-0018 amendment 1): the hero and every walker
  struck carry the component `reactions` (hashed), a big blow knocks a walker down to lie and get up, attacking
  nothing meanwhile, and the hero carries his cape (`secondary`, drawn by the view only). The run itself changed: it
  still kills 5 foes and throws a body 1.72 m up, and the walkers it knocks down near the end still lie at step 600.
- The goldens of the eleven replays with the box's hero (box-2-dash, -jump, -walk, box-3-climb, -dais, -knock,
  box-4-chase, -hop, box-5-fight, box-8-clips, and the new box-4-stairs) were re-recorded (`--update`, Node ×3 and
  Chromium ×3 agreeing) after G9, when his character gained `shoves: ['crowd']` (WP 5.7, ADR-0020 amendment 9): his
  controller passes the crowd, which his capsule shoves aside. The runs without a crowd did not change: with `shoves`
  left out of the hashed state, every checkpoint gave its earlier golden. box-4-chase, box-4-hop and box-5-fight did:
  he walks through the crowd rather than round it.
- The goldens of the four playground replays (playground-climb, -gym, -moves, -rides) were re-recorded (`--update`,
  Node ×3 and Chromium ×3 agreeing) at WP 13.10's visual review, when the adult's stride grew from 0.42 to 0.5 and a
  planted stride's share from 1 to 1.25 sprinting (engine/anim/locomotion.ts `strideShare`, ADR-0025 amendment 10):
  the player's animator phase, hashed, advances more slowly. The runs themselves did not change: with the old stride
  and share all four gave their earlier goldens, and in playground-moves' and -rides' final states only that phase
  differs. playground-climb's and -moves' again at the review's second round, when the sim told an actor's animator
  its movement model's duck as the pose `crouch` (engine/sim/actors.ts), a crouched planted stride 30% shorter
  (`GAIT.crouchStride`): with the duck left out both gave the goldens above, and in their final states only the
  player's animator phase differs. All four again at the third round, when a planted stride's steps grew shorter as
  the move turns sideways (`GAIT.sideStride`, 35% straight across, by the square of the move's sideways share): with
  it left out all four gave the goldens above, and in their final states only the player's animator phase differs.
- playground-site's goldens were re-recorded (`--update`, Node ×3 and Chromium ×3 agreeing) with WP 13.19's melee
  (ADR-0025 amendment 24): its two strikes on the living room's door were instant, and are door kicks now, each landing
  0.83 s after its press and 1.41 s long, so its second press moved 180 steps after the first (a look toward the burst
  leaf before it: the kick's cone is 30°), every input after it 140 steps later and the run 140 steps longer (780);
  the site also gained melee and the ring's dummies (hashed). The story is the same, event for event
  (labs/playground/scenes/site.test.ts). playground-melee is new with that WP: the ring's story (scenes/ring.test.ts).
- playground-site's and playground-melee's goldens were re-recorded (`--update`, Node ×3 and Chromium ×3 agreeing)
  with WP 13.20's firearms (ADR-0025 amendment 25): the site's player carries the pistol and the rifle, holstered (the
  component `weapons`, hashed), and the range's targets are things (the components `thing` and `popup`, hashed) where
  fixed props stood. Neither run draws a gun or fires a shot: their inputs are as they were, and their stories the
  same, event for event (labs/playground/scenes/site.test.ts, ring.test.ts). playground-range is new with that WP:
  the range's story (labs/playground/weapons/range.test.ts), its inputs written from a scripted run that aimed each
  shot at its target's plate as the sim had it.
- playground-site's, playground-melee's and playground-range's goldens were re-recorded (`--update`, Node ×3 and
  Chromium ×3 agreeing) with WP 10.2's ragdolls (ADR-0025 amendment 26): the ring stands two sparring partners
  (actors with an animator, `health` and the component `sparringPartner`, hashed) and the site adds the systems
  `ragdolls` and `partners`. No run strikes them: their inputs are as they were, and their stories the same, event for
  event (labs/playground/scenes/site.test.ts, ring.test.ts, labs/playground/weapons/range.test.ts). ragdoll-falls and
  ragdoll-strike are new with that WP: the box's ragdolls (labs/box/scenes/ragdoll.test.ts).
