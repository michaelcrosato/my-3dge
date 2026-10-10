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
- A hash keyed `"k"` is the state after k steps, before the inputs at k.
- `engine`, `three` and `rapier` are written by `--update`.

## Working with them

| Task | Command |
|---|---|
| Check every replay, in Node and in Chromium (tests/pages/replay.html) | `node x replay tests/replays --browser sim` |
| Record or re-record the goldens of this platform | `node x replay <file> --update` (say why in the commit) |
| Find the first step, entity and field where runs part | `node x replay <file> --browser sim --bisect` |
| Show that a replay depends on the fdlibm swap | `node x replay <file> --browser sim --swap none` (must fail) |
| Make a new one | write it by hand, or copy `out/sim/<scene>/run.replay.json` from `node x sim <scene>`, then `--update` |

The kernel replays (`kernel-*.replay.json`) run fixtures/scenes/kernel/index.ts. Without the swap, Node and Chromium
part at step 0 (kernel-crowd) and by step 60 (kernel-movers), so their one set of goldens proves the swap end to end.
On another platform a replay runs twice, compares the runs, and reports "golden: other platform". The
`determinism-debugging` skill (.claude/skills/determinism-debugging/SKILL.md) says what to check when runs part.

## History

- The kernel goldens were re-recorded (`--update`, Node ×3 and Chromium ×3 agreeing) when the hash format became
  `my3dge-state/2` (the WP-1.4 review fixes, ADR-0006 amendment 3: the world's step rate is hashed). The runs
  themselves did not change: each replay's final state, step rate and format tag aside, is the same field for field
  as under `my3dge-state/1`; only the hashes moved.
