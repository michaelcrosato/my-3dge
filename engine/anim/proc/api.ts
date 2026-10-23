/**
 * @file The procedural rigs' part of the public sim API (PLAN.md §6.1, WP 10.1): the building blocks a creature beyond
 * the humanoid is made of (springs, eased weights and the pose stack, the digitigrade leg, sway chains and lagging
 * parts, the planted gait for N legs, path chains, looking and blinking, hovering, orbiters and detached parts, pose
 * history, extras on sockets, tip trails, the measured reach) and the contract its rig meets and is checked by,
 * re-exported whole by engine/sim-api.ts, so that file stays under its line cap, as engine/sim/kitsApi.ts does. Game
 * code imports these names from engine/sim-api.ts (or engine/index.ts), never from here: the public-API rule rejects
 * any other engine path. The verlet strand is engine/anim/chain.ts's `Chain` (WP 6.2), exported with the animator.
 *
 * Invariants: the same as engine/sim-api.ts's: a flat list of `export … from` lines, one name per line, grouped by
 * area and append-only. Only engine/anim/ modules are re-exported, and each name is documented where it is declared.
 *
 * @example
 * // fixtures/rigs/hexapod/index.ts
 * // import { LegGait, LagPart, rigCheck, type ProcRig } from '../../../engine/sim-api';
 * @see engine/sim-api.ts
 */

// Springs and blends (WP 10.1): numbers, vectors and turns on exact damped springs with kicks; named weights eased up
// and down; the pose stack, angles averaged round the circle, a pitch and a yaw as a direction.
export { Spring1 } from './springs';
export { Spring3 } from './springs';
export { SpringQuat } from './springs';
export type { SpringOptions } from './springs';
export { StateWeights } from './blend';
export type { BlendRates } from './blend';
export { layerPose } from './blend';
export type { PoseLayer } from './blend';
export { blendAngles } from './blend';
export { aimDirection } from './blend';
// Legs and bodies (WP 10.1): the digitigrade leg's reverse knee; sway chains and lagging parts; the planted gait for N
// legs in groups, its feet on raycast ground or gripping walls; path chains following their head.
export { digitigrade } from './digitigrade';
export type { DigitigradeLeg } from './digitigrade';
export type { DigitigradeFrame } from './digitigrade';
export type { DigitigradeSolve } from './digitigrade';
export { SwayChain } from './sway';
export type { SwayOptions } from './sway';
export { LagPart } from './sway';
export type { LagOptions } from './sway';
export { LegGait } from './gait';
export type { GaitLeg } from './gait';
export type { GaitOptions } from './gait';
export type { GaitFoot } from './gait';
export type { GaitProbe } from './gait';
export type { GaitBody } from './gait';
export { PathChain } from './path';
export type { PathOptions } from './path';
// Faces and floating parts (WP 10.1): looking within bounds and blinking from a named stream; hovering, banking,
// leaning and folding; orbiters and detached parts; pose history played back late; extras on sockets; tip trails.
export { LookAt } from './look';
export type { LookAtOptions } from './look';
export { Blink } from './look';
export type { BlinkOptions } from './look';
export { Hover } from './hover';
export type { HoveringOptions } from './hover';
export { Orbiters } from './orbit';
export type { OrbitOptions } from './orbit';
export { DetachedPart } from './orbit';
export type { DetachedOptions } from './orbit';
export { PoseHistory } from './history';
export type { HistoryOptions } from './history';
export { socketMatrix } from './sockets';
export { placeExtras } from './sockets';
export { along } from './sockets';
export { alongDirection } from './sockets';
export type { Socket } from './sockets';
export type { SocketJoints } from './sockets';
export { TipTrail } from './trails';
export type { TrailOptions } from './trails';
export type { TipSample } from './trails';
// Reach and the rig contract (WP 10.1): an attack's reach measured off its animation; what a procedural rig names
// (its points, bones, feet and states) and the check it passes, as anim.check holds the humanoid.
export { measureReach } from './reach';
export type { ReachPose } from './reach';
export type { ReachOptions } from './reach';
export type { Reach } from './reach';
export type { ProcRig } from './rig';
export type { ProcRigBody } from './rig';
export type { RigRun } from './rig';
export { driveRig } from './rig';
export { rigCheck } from './rig';
export { rigClosed } from './rig';
