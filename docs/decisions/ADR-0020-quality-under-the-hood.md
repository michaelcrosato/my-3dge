# ADR-0020: Quality under the hood, behind a public API

Status: accepted · 2026-10-10 · Records PLAN.md §13.1, §3 (Quality under the hood), §6.1, §6.10 rule 7

## Decision
- Game code imports only `engine/index.ts` (pages) and `engine/sim-api.ts` (sim-side code).
- Every public export is documented, and every error names its fix in API terms, so game agents never need to read
  the internals.
- Behind that boundary, internals use the highest-quality approach their builder can execute well, newer releases
  included when a measurement on the platform shows better quality (§6.10, rule 7).

## Why
Doctrines Quality under the hood and Common ground: the engine is built once and used many times; its complexity
stays behind a familiar API.

## Enforced by
ESLint's public-API rule for game code (WP 0.4); `x docs --check` (every export documented, every error code with a
fix); the `verifier`.

## Amendment 1 (2026-10-10, WP-1.1)
three.js's `Color` joins the math classes `core/math` re-exports (§6.1's list; `THREE_MATH` in
tools/eslint/layers.ts, with a layer test). WP 1.1 asks for `color`'s sRGB ↔ linear conversion "over three.js's
`Color` where it fits", and `core/math.ts` is the one file outside `gfx/` that may import three.js, so the plan needs
`Color` there to be consistent. It lives in three.js's `src/math/`, agents know it, and going through it makes
`toLinear('#808080')` equal what a material holds for the same hex (engine/core/color.test.ts checks every reference
colour against `Color.set`). Nothing else from three.js's colour management (`ColorManagement`, the colour-space
constants) is allowed.

## Amendment 2 (2026-10-10, WP-1.6): the barrels and the public-API rule
- **What the barrels hold.** engine/sim-api.ts: scenes (`defineScene` and its types), the world's types,
  `defineComponent`, the phases, `defineKind` and `def`, the schema and settings types, `defineSettings`, the intents
  vocabulary (`held`, `pressed`, `fromCamera`, `INTENT_KEYS` and types), three.js's math classes with core/math's
  helpers, `Rng`, and the event types. engine/index.ts re-exports it with `export * from './sim-api'` (so names
  appended there reach pages unedited) and adds `createHeadless` and the inspector's types. Both are flat lists of
  `export … from` lines, one name per line, grouped by area under a line comment; each name is documented where it
  is declared, which `x docs --check` enforces, so the barrels never restate a doc comment.
- **The rule is on** (`SWITCHES.publicApi`), and the kernel fixture imports only engine/sim-api.ts.
- **What G0 deferred to WP 1.6**, each with failing and passing fixtures in tools/eslint/*.test.ts:
  - every engine layer refuses the barrels (`../index`, `../sim-api`, and `..` however spelt): they re-export the
    engine, so such an import is a cycle;
  - side-effect and dynamic imports go through `public-api/no-unnamed-imports`, a local rule that resolves relative
    sources from the importing file as the named-import rule does (`./../../engine/core/x` is
    `../../engine/core/x`); it replaces the `no-restricted-syntax` selectors, which matched the source as written;
  - a banned three.js name read off a namespace goes through `banned/no-namespace-names`
    (tools/eslint/namespaceNames.ts), which follows the bindings: any namespace name (`import * as T`), computed reads
    (`T['screen']`), destructuring (`const { screen } = TSL`), three.js's `TSL` object (`import { TSL }`,
    `THREE.TSL.x`), and the docs' names unbound; a namespace passed through another variable is not followed. The
    syntax selectors keep the names imported or re-exported by name;
  - Node's `Buffer` global is banned sim-side, with the other Node globals.

## Amendment 3 (2026-10-10, WP-3.2): the character controller does its own steps, snap and pushes
engine/physics/character.ts drives Rapier's `KinematicCharacterController` but does its own steps, snap-to-ground
and pushes, because Rapier 0.21 was measured to fail at each: its autostep misses steps while sliding is on and
creeps about 5 cm above its setting; `computedGrounded` is true against a wall at a jump's apex; its impulses treat a
translation as a velocity. Rapier's autostep, snap and impulses are off.
- **Steps:** a grounded move that a wall stops is retried up by `autostep.height`, then across by at least enough to
  stand, then down. It is kept when it lands on walkable ground no higher than that height, so the configured height
  is exactly the height climbed.
- **Grounded** means a walkable contact on the down leg.
- **Pushing** is an inelastic collision of a push-kg mass, applied level with the centre of mass. This replaces
  shardfall's push_mass/(push_mass+load) scaling.
- **A grounded move goes up by the skin first**, which avoids phantom contacts while skimming the floor. The
  prototype's grounded-flicker workaround was not needed.
- **Files:** the movement maths sit with the meter in engine/physics/feel.ts, and `measureFeel`'s course is in
  engine/sim/actors.ts, to avoid an import cycle.
- **Core change accepted:** engine/physics/world.ts gains `rapierOf(physics)` (a WeakMap and one export, for the
  modules beside it only; not in the barrels), so the controller reaches the Rapier world, including after a restore.

## Amendment 4 (2026-10-10, WP-4.2): convex hull colliders, and the hall's level rules
engine/physics has no hull shape and engine/sim/levelBodies.ts must not import Rapier, so the hall's stairs and dais
need a core change.
- **Core change accepted:** WP 4.2's Owns widens to engine/physics/{world,queries,world.test}.ts, for a collider
  shape used only by bodies: `{ type: 'hull', points }` (`HullShape`), a convex hull in three.js ConvexGeometry's
  terms. It is refused when it has fewer than 4 points or all points lie in one plane (Rapier 0.21's `convexHull`
  never returns null, measured). Owns also gains a one-character edit to engine/gfx/level/meshes.test.ts, whose ledge
  moves from `=` to `L` because `=` is now `glyph:gallery`.
- **Mesh descriptors:** `bottom` is 0 for glyphs whose box or hull collider rises from the ground (a gallery is drawn
  as a block), and the glyph's floor otherwise.
- **Reachability:** areas are strongly connected. Each step is sampled 8 times between centres and climbs at most
  `NAV_CLIMB`; steps down are always allowed.

## Amendment 5 (2026-10-10, WP-4.1, revised after the core review 2026-10-11): kinematic floors carry riders by their own step
Why: Rapier 0.21's kinematic friction acts on each leg of moveCharacter's lift/across/down move that ends within the
floor's prediction distance, so it carried a rider 0, 1 or 2 times a tick. Measured on integration c4ac26e:
- On 6 m rides a rider slipped 0.10 to 0.17 m, and 0.75 m near the leading edge of a 4 s ride.
- With two riders, one was lost (the reviewer measured 0.44 m on another layout).
- On 3 m lifts going down it lost the ground for 47 to 184 ticks of 480.
- A floor sinking as it moved across left the rider 3.6 m behind.
- Turning floors at 1 and 3 rad/s threw it 1.3 and 2.0 m.

**Core change accepted:** WP 4.1's Owns widens to engine/physics/character{,.test}.ts. When the character was
grounded on a kinematic body, stepCharacter computes that body's step at the feet: moved by its linear velocity,
turned about its centre of mass by its angular velocity, as Rapier integrates it. The body's velocities are held at
zero during the move. The horizontal part goes through moveCharacter. The vertical part is added after the move,
because moving up or down through the controller ends on the floor where it is now: the snap leg cancelled a rise, so
riders on lifts from 1.5 m/s peak lost the ground while rising. A rise lifts the rider unchecked; a ceiling over a
lift crushes it, as the rising floor would anyway. A sink takes it down by a controller move that leaves the floor
out, so a ledge the rider overhangs holds it up instead of taking it into the pit.

Measured: riders keep their place within 0.3 mm and stay grounded every tick across, up and down at up to 5 m/s and
turning at up to 3 rad/s. Movers (bodies.ts) are velocity-driven kinematic bodies, so the carry keeps no state and
restores exactly.

## Amendment 6 (2026-10-11, gate G3's review): the character controller's moves in their own module
engine/physics/character.ts had 593 lines, 7 under the hard cap, after WP 4.1's kinematic carry joined WP 3.2's
controller. Its split into move.ts had been open since gate G2 (ledger row 3.2). Gate G3's review made the split.
engine/physics/move.ts holds the controller's moves (`moveCharacter`, `isWall`, `isWalkable`, the step-up, one-way
platforms, and `sink` for a sinking floor), the Rapier controller they share, and amendment 3's "how it moves, and
why". character.ts keeps the character's settings, state and tick (`createCharacter`, `addCharacter`, `feetOf`,
`stepCharacter`, the carry and the pushes): 357 and 271 lines. WP 3.2's Owns, and WP 4.1's extension of it, widen to
engine/physics/move.ts. Nothing behaves differently: every physics test and every replay passes unchanged, in Node and
in Chromium.

## Amendment 7 (2026-10-11, WP-7.3): the v2 textures join the kind, and the tex family draws a contact sheet

Core change accepted: WP 7.3's Owns widens to engine/gfx/textures/{v1,v2,texture,texture.test}.ts and
tools/qa/tex{,.test}.ts. v2.ts lists runes, moss, metal, plaster, dirt, grass and water, and textureKind registers them
after v1, so every registry has 13 generators by id. `node x qa tex` also writes out/qa/tex/sheet.png. Each texture
checked gets three panels (colour, normal, emissive), each tiled 2 × 2 into 128 px with its shape kept and row 0 of a
map at its panel's bottom, three textures to a row. The level floor bake (levelFloorTexture) is a spec builder that a
game defines under its own id; it is not a registered generator. Casters are glyphs with a box collider whose top rises
0.25 m above the tile's floor; walkable blocks (galleries) are floor.

## Amendment 8 (2026-10-11, WP-8.7 integration): the Animation area of the sim API in its own file

engine/sim-api.ts reached 595 of its 600-line hard cap, so WP 8.7's Actions exports could not be appended, and the
action template (`x new action --test`) failed without them. The integrator moved the whole Animation area (WP 3.4
onward, with WP 6.6's animation checks) verbatim into engine/anim/api.ts and added the Actions names there;
engine/sim-api.ts re-exports it with one `export * from './anim/api'` line. The public surface is unchanged plus the
Actions names: game code still imports only engine/sim-api.ts or engine/index.ts, and `x docs` follows the re-export to
each declaration. engine/anim/api.ts keeps sim-api's invariants (one name per line, append-only by area) and sits in
the anim layer, so it re-exports only engine/anim/ modules. Later WPs append animation names to engine/anim/api.ts
(PLAN.md §11.3 and §5 edited). sim-api.ts drops to about 330 lines, anim/api.ts is about 300.
