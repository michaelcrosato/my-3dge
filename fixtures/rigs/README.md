# Fixture rigs

Creatures made of the procedural building blocks alone (PLAN.md WP 10.1), each a `ProcRig` (engine/anim/proc/rig.ts)
that `rigCheck` passes and `node x qa anim --only rig:` drives through its states. Each rig's file comment says what
it is and how it is built; `node x new rig labs/<lab>/rigs/<name>` starts a new one from the template.

| Rig | What it is |
|---|---|
| biped/ | a digitigrade raptor: two legs on toes, a tail, a looking, blinking head, small arms |
| hexapod/ | an insect on alternate tripods, gripping a wall, its abdomen swinging behind |
| serpent/ | a snake following its head's path, rising like a cobra, flinching, a crest down its back, its tail trailing |
| floater/ | a ghost hovering, banking, leaning and folding, motes round it, its hands floating free |
| multiarm/ | a four-armed swordsman, its lower arms echoing its upper ones, its swing's reach measured |
| tentacle/ | an octopus on verlet tentacles, a raised arm waving, its head sac lagging |
| dummy/ | the training dummy that takes hits (WP 6.1) |

## The sixteen blocks, and the rigs that show each

| Block | Where | Rigs |
|---|---|---|
| Eased state weights | engine/anim/proc/blend.ts `StateWeights` | biped, multiarm |
| Springs with a kick | engine/anim/proc/springs.ts `Spring1`, `Spring3`, `SpringQuat` | biped, hexapod, serpent, floater, tentacle |
| The digitigrade leg | engine/anim/proc/digitigrade.ts `digitigrade` | biped |
| Angle blending, the pose stack | engine/anim/proc/blend.ts `layerPose`, `aimDirection` (`blendAngles`, round the circle, in its unit tests) | biped, multiarm |
| Sway chains | engine/anim/proc/sway.ts `SwayChain` | biped, tentacle |
| The planted gait for N legs | engine/anim/proc/gait.ts `LegGait` | biped, hexapod |
| A lagging spring part | engine/anim/proc/sway.ts `LagPart` | hexapod, tentacle |
| Path chains | engine/anim/proc/path.ts `PathChain` | serpent |
| Verlet strands | engine/anim/chain.ts `Chain` (WP 6.2) | tentacle |
| Look-at and blink | engine/anim/proc/look.ts `LookAt`, `Blink` | biped, serpent, floater |
| Floaters: hover, bank, fold | engine/anim/proc/hover.ts `Hover` | floater |
| Orbiters and detached parts | engine/anim/proc/orbit.ts `Orbiters`, `DetachedPart` | floater |
| Delayed pose replay | engine/anim/proc/history.ts `PoseHistory` | multiarm |
| Extras on sockets | engine/anim/proc/sockets.ts `placeExtras` (`socketMatrix` by name), `along`, `alongDirection` | multiarm, serpent |
| Tip trails | engine/anim/proc/trails.ts `TipTrail` | serpent, multiarm, tentacle |
| Animation-measured reach | engine/anim/proc/reach.ts `measureReach` | multiarm |
