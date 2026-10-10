# ADR-0006: The reproducibility contract

Status: accepted · 2026-10-10 · Records PLAN.md §13.1, §6.5, §4.7

## Decision
- Reproducibility is promised on the development platform only (Linux x64, Node 24, Chromium 141).
- Game code writes the standard `Math` and three.js's math. While the sim steps, the engine swaps in stdlib's fdlibm
  ports for the functions that differ between runtimes (`sin`, `cos`, `pow` today), so one golden hash per replay
  holds in Node and in Chromium. A drift test adds functions as runtimes change.
- An ordered world: entities in id order, spawns at step boundaries, Rapier bodies inserted in a fixed order.
- Physics is Rapier 0.21's SIMD build, whose restores continue exactly.
- The hash covers the bodies' state (translation, rotation, velocities) and everything `capture()` holds except
  Rapier's snapshot bytes.
- The proof matrix of §6.5: replays in Node and Chromium, in the rendering page, live play replayed in Node, and
  capture → restore → continue.

## Why
Doctrine Reproducible. V8's `Math.sin` and `Math.cos` differ by 1 ulp between Node and Chromium, and `pow` between
Node releases; float64 state fed back through them diverges (§4.7). The swap keeps game code familiar (doctrine:
Common ground) and the determinism under the hood.

## Enforced by
ESLint's sim-side bans (Appendix B); replay suites in Node and Chromium; capture and restore tests; the drift test.

## Amendment 1 (2026-10-10, WP-1.1)
No swap reaches an operator or an alias, so sim-side code calls the swapped functions by name. `**` and `**=` are
banned there: the operator computes with the runtime's own pow, which differs between Node releases (§4.7), and
`withSimMath` cannot replace it; write `Math.pow`. Names destructured from `Math` (`const { sin, cos } = Math`) and a
swapped function held in a variable (`const pw = Math.pow`) are banned too: made at module load, outside the sim, they
keep the native function. ESLint's `sim/no-restricted-syntax` enforces both (tools/eslint/simSide.ts, which reads the
swapped names from engine/core/simMath.ts, so a function that joins the swap is covered at once); the drift probe
hashes `**` beside `Math.pow` and names this ban if the operator drifts. The swapped `pow` is stdlib's port behind a
guard: where an argument is NaN, ±0 or ±Infinity, ECMAScript fixes the result exactly and the native function gives
it in every runtime, so the guard defers to it (stdlib gives NaN for `pow(NaN, 0)` and -0 for `pow(-0, 0.5)`); a
negative base with |y| ≥ 2^53, always an even power, is computed as `pow(-x, y)`, since stdlib's odd test fails there.
engine/core/simMath.test.ts checks both on the drift probe's edge pairs. PLAN.md §6.5 item 1, Appendix B and WP 1.1
say so.

## Amendment 2 (2026-10-10, WP-1.4)
Calls made where the plan is silent (engine/sim/{world,systems,state,capture}.ts); no deviation:
- **Entities and components are plain objects** (Q13): an entity is `{ id, position: {…}, … }` with a read-only id;
  a component kind is a registry entry of kind `component` (`defineComponent(name, { description, fields })`,
  schema.ts fields, never hooks), and its name is the entity's property. Systems are named functions
  `(w, intents) => void` in phases `intents`, `ai`, `anim`, `physics`, `readback`, `rules` (default `rules`), run by
  phase, then in the order added.
- **One step** (§6.4, made concrete): the phases up to `readback`, the timers' stage (WP 1.3's `timers.step()`), the
  `rules` phase, then the boundary: queued spawns join in id order, queued despawns leave, queued events reach their
  listeners in emit order, repeated while listeners queue more (1,000 rounds at most, `SIM_EVENT_STORM`). Outside a
  step, `spawn`, `despawn` and `emit` act at once, each as an entry point inside `withSimMath`; `run(fn)` is the entry
  point for setup and dev actions. During step k every phase, timer and listener sees `tick` k. Pending entities are
  invisible (`get`, `add`, `query`) until the boundary.
- **The hash**: FNV-1a 64 over a format tag (`my3dge-state/1`), then tagged parts: seed and next id; each entity in id
  order with its components sorted by name and each component's fields in declared order (an absent field has its
  own marker; an undeclared component or field throws instead of being skipped); `timers.state()`; the non-view
  settings; the sim RNG states; the physics hook's `state()`. The seed and next id are hashed because they decide
  future streams and ids. Numbers and component names take a fast path that feeds exactly `Fnv64.value`'s bytes
  (pinned by a test): 5,000 entities with 8 numbers each hash in about 10 ms in Node.
- **Captures are plain data** (canonical, so `serialize` writes them); timer callbacks, being functions, are held
  beside the capture with the world that made it. A capture with pending timers restores only from the object
  `capture()` returned, into that world (`SIM_NO_CALLBACKS` otherwise, since a callback closes over its world); one
  without pending timers restores anywhere with the same component kinds, settings and `time.hz` (fixed when a world
  is made, so another rate is refused). Saves that must survive text keep delays in component fields.
- **A despawned entity's `rng.entity` streams are dropped** (ids are never reused, so they would only grow the hash).
  Visual streams (`fxRng`) derive from `derive(seed, 'fx')` and are never hashed or captured.

## Amendment 3 (2026-10-10, WP-1.5)
Calls made where the plan is silent (engine/input/intents.ts, engine/sim/{scene,replay}.ts, tools/cmd/{sim,replay,perf}.ts,
fixtures/scenes/kernel/, tests/pages/replay.html); no deviation from a Done-when:
- **The intents vocabulary**: `move` `[x, z]`, `cam` (the yaw of the camera's horizontal view direction, forward(ψ) =
  (sin ψ, 0, cos ψ); a three.js camera's `rotation.y` is ψ − π), `aim` `[x, y, z]`, `look` `[yaw, pitch]`, `b` (held,
  sorted) and `p` (pressed), plus custom keys namespaced `game:key` holding plain data. Unknown keys and non-finite
  numbers throw `INPUT_BAD_INTENTS`. `p` is the given taps plus the edges of `b`, so a hold presses once and a tap
  released within a step still presses. `fromCamera(yaw, [right, forward])` scales two keys at once to length 1 and
  uses right(ψ) = forward × up = (−cos ψ, 0, sin ψ).
- **Scenes** are entries of the kind `scene` with `description`, `level`, `settings`, `setup`, `step` and `actions`
  (the scene's dev actions, `(w, args) => void`, until WP 5.6's own kind). `settings` are checked when the scene is
  defined; the caller's settings (`--set`, a replay's) layer over the scene's. The scene's `step` runs as the system
  `scene`, first in the phase `intents`. The default seed is 1.
- **The recorder is the session** (`createSession`, in engine/sim/scene.ts beside `startScene`, so replay.ts imports
  scenes and never the reverse): `step` logs the intents as diffs, `set` logs non-view settings, `act` runs a dev
  action and logs `{ dev, args }`, each at the step it happens, merged in play order (set, then dev, then intents;
  a point that cannot merge starts a new one at the same step). `record()` returns the replay from step 0.
- **Replay semantics**: `[k, change]` applies after k steps, before step k + 1; a hash keyed `"k"` is the state after
  k steps, before the inputs at k (as a live session hashes); default checkpoints are 0, every 60 steps and the last.
  The format adds an optional `description`; `engine`, `three` and `rapier` are written by `--update` (a later
  mismatch of the latter two warns). Unknown keys, view settings and another step rate are refused (`SIM_BAD_REPLAY`).
  Files are written through Prettier with numbers exact (`-0` kept).
- **`x replay`** runs each replay `--runs` times (3) per runtime, and adds `--swap` (Chromium with fewer fdlibm
  ports, `none` for native `Math`): without the swap the kernel replays part from Node at step 0 and after step 6,
  so their goldens prove the swap. `--bisect` hashes every step of a Node run, a second Node run and the Chromium run
  and compares the first pair that parts (`trace()` parts and entities, then `diffStates`). When every run agrees
  but the goldens differ, there is no reference state to compare fields with, so it names the checkpoints between
  which the behaviour changed; comparing with the commit that recorded the goldens in a temporary worktree (as
  `x film --compare` will) waits until that need surfaces.
- **`x sim`** takes a scene module or a scene id (found from `defineScene('<id>'` under `fixtures/scenes/` and
  `labs/<name>/scenes/`, the roots tests/pages/replay.ts globs), steps with no intents through a session, and writes
  `state.json` and `run.replay.json` (this platform's hashes included). **`x perf`** reports Node medians per step,
  hash and capture over `--runs` (5); `--budget` enforces `tests/baselines/perf/<scene>.json`.
