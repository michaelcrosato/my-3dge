/**
 * @file The movement part of the public sim API (PLAN.md §6.1, Phase 13, ADR-0025 amendment 7): every name sim-side
 * game code takes for a player's movement (movement profiles, the live tuning, rides), re-exported whole by
 * engine/sim-api.ts, so engine/sim-api.ts stays under its line cap, as engine/anim/api.ts does for animation
 * (ADR-0020 amendment 8). Game code imports these names from engine/sim-api.ts (or engine/index.ts), never from here:
 * the public-API rule rejects any other engine path.
 *
 * Invariants: the same as engine/sim-api.ts's: a flat list of `export … from` lines, one name per line, grouped by
 * area and append-only; each Phase 13 WP appends its movement names at the end of their area. Only sim-side modules are
 * re-exported, and each name is documented where it is declared.
 *
 * @example
 * // labs/playground/scenes/gym.ts
 * // import { addZipline, placeActor } from '../../../engine/sim-api';
 * @see engine/sim-api.ts
 */

// Movement profiles (WP 13.3): the registry kind `movement`, and the shooter model (Apex's) a profile gives a character.
export { defineMovement } from '../physics/movement/profile';
export { getMovement } from '../physics/movement/profile';
export { listMovements } from '../physics/movement/profile';
export type { MovementProfile } from '../physics/movement/profile';
export type { MovementSpec } from '../physics/movement/profile';
export { MODEL_FIELDS } from '../physics/movement/model';
export type { MovementModel } from '../physics/movement/model';
export type { MovementModelSpec } from '../physics/movement/model';
export { MOTION_FIELDS } from '../physics/movement/model';
export type { MotionState } from '../physics/movement/model';
export type { MotionFeel } from '../physics/feel';

// The feel kit, sim-side (WP 13.4): the shooter model's live tuning, `movement.<group>.<field>` (a setting off its
// default replaces that number in every model character's model, from the next step), and an actor placed at rest
// (a scene's dev action: a feel course's start).
export { MOVEMENT_SETTINGS } from '../physics/movement/settings';
export { movementOverrides } from '../physics/movement/settings';
export { tuneCharacter } from '../physics/movement/settings';
export type { MovementOverride } from '../physics/movement/settings';
export { placeActor } from './actors';

// Rides (WP 13.7): ziplines, ladders and launchers as world data (engine/world/traverse.ts), placed in a scene
// (engine/sim/rides.ts) and ridden by the shooter model (engine/physics/movement/ride.ts, ladder.ts): a zipline and the
// poles under its anchors, the redeploy balloon's line and its skydive, a ladder (or every ladder a level's ladder glyph
// `|` stands), a jump pad or a trampoline. Use is the button `interact`; the look's pitch picks a vertical zipline's
// way and a skydive's dive.
export { addZipline } from './rides';
export { addLadder } from './rides';
export { addLauncher } from './rides';
export { addLevelLadders } from './rides';
export { ridesOf } from './rides';
export { levelLadders } from '../world/traverse';
export type { ZiplineSpec } from '../world/traverse';
export type { LadderSpec } from '../world/traverse';
export type { LauncherSpec } from '../world/traverse';
export type { Rides } from '../physics/movement/ride';
export type { RideCable } from '../physics/movement/ride';
export type { RideLadder } from '../physics/movement/ride';
export type { RideLauncher } from '../physics/movement/ride';
