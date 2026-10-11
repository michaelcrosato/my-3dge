---
name: rapier
description: Rapier physics in my-3dge under the reproducibility contract — bodies, queries, stepping, the hash and captures through engine/physics (the only module that imports Rapier), the collision groups and pinned parameters, and the traps measured on Rapier 0.21 (timeOfImpact vs time_of_impact vs toi, castShape's targetDistance, queries before the first step, handles as float64 bits, the controller's across-then-down move, autostep climbing about 5 cm high). Use when adding bodies, colliders or queries, touching engine/physics, or debugging a physics hash or capture.
---

# Rapier in my-3dge

The build is `@dimforge/rapier3d-simd-compat` 0.21.0 (PLAN.md §4.7): SIMD, its WebAssembly inlined (no `.wasm` to
serve), the same state run to run in Node and Chromium, and restores that continue exactly. Only `engine/physics/`
imports it (ESLint's layer rule); everything else meets plain data, body ids and three.js math classes.

## The API, in plain terms

- A scene asks for one: `defineScene(id, { physics: true, setup(w) { physicsOf(w).addBody(…) } })` (game code
  imports `physicsOf` from engine/sim-api.ts); fixtures/scenes/physics-40/ is a worked example. Underneath,
  `createPhysics()` (engine/physics/world.ts) makes the world; Rapier is initialized once when that module loads (a
  top-level `await`, about 50 ms in Node), so every call after is synchronous.
- Bodies: `addBody({ type, position, rotation, velocity, angularVelocity, colliders: [{ shape, position, density,
  friction, restitution, group, sensor }], group, ccd, canSleep, gravityScale })` returns an id; `readBody(id)`
  copies its pose and velocities; `setBody`, `applyImpulse` (N·s), `removeBody`. Shapes are sized like three.js's
  geometries: `{ type: 'box', size }`, `{ type: 'ball', radius }`, `{ type: 'capsule', radius, height }` (the
  straight middle), `{ type: 'cylinder', radius, height }`. Densities are kg/m³ (1,000 by default).
- Queries (engine/physics/queries.ts): `raycast`, `shapeCast`, `overlap` and `probe(x, z)` → `{ y, normal, body }`.
  Hits name a body id, a `distance` in metres, a world-space `point` and `normal`. Presentation code gets only the
  read-only `QueryView` (engine/sim/queryView.ts) and imports its type, never `engine/physics/`.
- Levels: `addLevelBodies(physics, level)` (engine/sim/levelBodies.ts) makes one fixed body of the compiled level's
  ground slab and merged boxes.
- Collision groups (engine/physics/groups.ts): `world`, `prop`, `actor`, `crowd`, `flyer`, `corpse`, one symmetric
  table. Name groups; never write Rapier's `membership << 16 | filter` bits by hand.

## The reproducibility contract (PLAN.md §6.5)

1. **Insertion order is the identity.** Bodies and colliders enter Rapier in the order code adds them, and a body's
   id comes from its handle: `slot + generation · 2³²`. Add bodies in a deterministic order (in `setup`, in a system,
   by entity id), never from a `Map` or `Set` filled in timing order.
2. **Step inside the sim.** The physics world steps as the system `physics`, in the phase of that name, after `ai`
   and `anim`, before `readback`. `step` sets `dt` from the sim (`1 / hz`) and gravity from the `physics.gravity`
   setting (9.81 m/s² down; a scene overrides it, characters have their own, WP 3.2) before every step. Never call
   `world.step()` on Rapier directly, and never step it from presentation.
3. **The parameters are pinned** in one table (engine/physics/params.ts), applied at creation and after a restore,
   so an upgrade that moves a default cannot change play unnoticed. Change a value there, with a reason, and record
   new goldens.
4. **The hash** covers every body's id, translation, rotation, linear and angular velocity, in id order. Snapshot
   bytes are never hashed (5.7 MB at 5,000 bodies).
5. **Captures** hold Rapier's snapshot (`{ rapier: 'simd-compat 0.21.0', snapshot }`): bodies, contacts with their
   warm-start impulses, islands, sleep, the broad phase, gravity and the parameters. A restore continues exactly with
   no extra step (0.19.3 drifted 4–13 cm; 0.21 does not). Snapshots are version-locked: a capture names its build and
   a restore under another refuses it (`PHYSICS_BAD_CAPTURE`). As text, the bytes become a list of numbers.
6. **No state beside Rapier's.** The physics world keeps nothing of its own, so the snapshot is the whole of it.
   Anything else (a controller's settings, a mover's phase) lives in components, where the sim hashes and captures
   it. Rapier's JS-side objects (character controllers, PID controllers) are *not* in snapshots: rebuild them from
   components after a restore (WP 3.2).

## Traps, measured on 0.21 (PLAN.md §4.7, §4.8)

- **Three names for one thing:** ray hits call it `timeOfImpact`, shape-cast hits `time_of_impact`, controller
  collisions `toi`. `castShape` takes a `targetDistance` before `maxToi` (our `margin`). Typical code written from
  memory fails type-checking in exactly these places: trust `tsc`.
- **Queries see the world as of the last step.** Rapier updates its broad phase inside `step`, so a body added in
  `setup` is invisible to queries until the first physics step. Query from step 1's `readback` or later, or step once.
- **Handles are float64 bit patterns:** the second body's handle is `5e-324`. Use the engine's ids; never sort or
  compare raw handles as numbers across generations.
- **`World.restoreSnapshot` returns null** for bytes it cannot read; the engine turns that into `PHYSICS_BAD_CAPTURE`.
- **Rays starting inside a solid** strike it at distance 0 (`solid: true`, the default); pass `solid: false` for the
  far side.
- **The character controller** (engine/physics/character.ts) does its own steps, snap and pushes; Rapier's autostep,
  snap and impulses are off. Never call a Rapier method inside a query or controller filter: the reentrant call
  throws, and the collider silently counts as solid.
- **Free what you make in tests:** `physics.dispose()` releases Rapier's memory; a world is unusable after it.

## Debugging a physics mismatch

Follow the determinism-debugging skill: `node x replay <file> --browser sim --bisect` names the first step and part.
A `physics` part that parts first, with entities equal, points at insertion order (1), a step outside the `physics`
phase (2), a parameter or gravity changed without new goldens (3), or state kept outside Rapier and components (6).
