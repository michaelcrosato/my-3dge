/**
 * @file The crowds' and combat's part of the public sim API (PLAN.md §6.1, WPs 5.1 to 6.4): crowd bodies, the steering
 * kit (with attack tokens and WP 5.2's sight), crowd members' looks, telegraphs and the combat helpers (hit queries,
 * damage, hit-stop, projectiles), re-exported whole by engine/sim-api.ts, so that file stays under its line cap, as
 * engine/sim/houseApi.ts does (ADR-0025 amendment 23). Game code imports these names from engine/sim-api.ts (or
 * engine/index.ts), never from here: the public-API rule rejects any other engine path.
 *
 * Invariants: the same as engine/sim-api.ts's: a flat list of `export … from` lines, one name per line, grouped by
 * area and append-only. Only sim-side modules are re-exported, and each name is documented where it is declared.
 *
 * @example
 * // fixtures/scenes/crowd-1000/index.ts
 * // import { addAgent, seek, damage, stepProjectiles } from '../../../engine/sim-api';
 * @see engine/sim-api.ts
 */

// Crowd bodies (WP 5.1): agents as dynamic capsules and balls driven by the velocities their AI wants (approach
// limits, only on their feet), knockback and launches, the corpse group and its timers, spawn and despawn queues.
export { CROWD_AGENT_FIELDS } from '../physics/crowd';
export { CROWD_AGENT } from '../physics/crowd';
export type { CrowdAgent } from '../physics/crowd';
export type { AgentState } from '../physics/crowd';
export { CROWD_MATERIAL } from '../physics/crowd';
export { CROWD_LIMITS } from '../physics/crowd';
export { CROWD_GROUNDED } from '../physics/crowd';
export { addAgent } from '../physics/crowd';
export { removeAgent } from '../physics/crowd';
export { setVelocity } from '../physics/crowd';
export type { VelocityOptions } from '../physics/crowd';
export { knockback } from '../physics/crowd';
export { launch } from '../physics/crowd';
export { killAgent } from '../physics/crowd';
export { updateCrowd } from '../physics/crowd';
export type { CrowdOptions } from '../physics/crowd';
export type { CrowdChanges } from '../physics/crowd';
export type { CrowdStepper } from '../physics/crowd';

// Steering kit (WP 5.2): the velocity a crowd agent wants (seek and arrive, flow-field following, approach rings, a
// flyer's hover, a jumper's hop), attack tokens that cap the attackers at once, and awareness by distance and sight.
export { seek } from '../world/steer';
export { followFlow } from '../world/steer';
export { approachRing } from '../world/steer';
export { hover } from '../world/steer';
export { airTime } from '../world/steer';
export { hop } from '../world/steer';
export { FOLLOW } from '../world/steer';
export { APPROACH_RING } from '../world/steer';
export { HOVER } from '../world/steer';
export { HOP } from '../world/steer';
export type { SteerPoint } from '../world/steer';
export type { FollowOptions } from '../world/steer';
export type { ApproachRingOptions } from '../world/steer';
export type { HoverOptions } from '../world/steer';
export { ATTACK_TOKENS_FIELDS } from '../world/ai';
export { ATTACK_TOKENS } from '../world/ai';
export type { AttackTokens } from '../world/ai';
export { takeToken } from '../world/ai';
export { releaseToken } from '../world/ai';
export { holdsToken } from '../world/ai';
export { keepTokens } from '../world/ai';
export { canSee } from '../world/ai';
export { clearSight } from '../world/ai';
export { SIGHT } from '../world/ai';
export type { SightOptions } from '../world/ai';

// Crowd bodies (WP 5.7): a crowd member's look and rig (a humanoid in a build, a blob, a floater) in the component
// crowdBody, its rig stepped in the sim by stepCrowdBody; the stage draws them through a crowd with its level of detail.
export { CROWD_BODY_FIELDS } from './crowdBodies';
export { CROWD_BODY } from './crowdBodies';
export type { CrowdBody } from './crowdBodies';
export type { CrowdRig } from './crowdBodies';
export type { CrowdBodyInput } from './crowdBodies';
export { stepCrowdBody } from './crowdBodies';

// Telegraphs (WP 6.4): an attack's warning shape on the floor as data (an arc, a ring, a line or a cone, in metres),
// and the geometry sim code tests it with as it goes off: a body inside it is hit, one just outside it a near miss.
export { TELEGRAPH_SHAPES } from '../world/telegraphs';
export { defineTelegraph } from '../world/telegraphs';
export { getTelegraph } from '../world/telegraphs';
export { telegraphGap } from '../world/telegraphs';
export { inTelegraph } from '../world/telegraphs';
export { nearMiss } from '../world/telegraphs';
export { telegraphFill } from '../world/telegraphs';
export { coneOf } from '../world/telegraphs';
export type { Telegraph } from '../world/telegraphs';
export type { TelegraphSpec } from '../world/telegraphs';
export type { TelegraphPlace } from '../world/telegraphs';
export type { PointLike } from '../world/telegraphs';

// Combat helpers (WP 6.3): hit queries against hurt capsules found through a spatial hash (cones with height windows,
// weapon sweeps), damage on health and crowd bodies (knockback as momentum, launches, death into the corpse group, the
// event damage), hit-stop handed to the frame clock's budget, and projectiles with swept tests.
export { PROJECTILE_FIELDS } from '../world/projectiles';
export { PROJECTILE } from '../world/projectiles';
export type { Projectile } from '../world/projectiles';
export type { ProjectileState } from '../world/projectiles';
export type { ProjectileStep } from '../world/projectiles';
export type { ProjectileHit } from '../world/projectiles';
export { stepProjectiles } from '../world/projectiles';
export type { HurtCapsule } from '../world/projectiles';
export type { HurtSet } from '../world/projectiles';
export { capsuleCast } from '../world/projectiles';
export type { WallTest } from '../world/projectiles';
export type { WallContact } from '../world/projectiles';
export { inCone } from './hits';
export { coneHits } from './hits';
export { sweepTouches } from './hits';
export { sweepHits } from './hits';
export { physicsWalls } from './hits';
export { HEALTH_FIELDS } from './damage';
export { HEALTH } from './damage';
export type { Health } from './damage';
export type { DamageTarget } from './damage';
export type { HitSpec } from './damage';
export type { DamageEvent } from './damage';
export type { DamageEvents } from './damage';
export { damage } from './damage';
export { requestHitStop } from './damage';
