/**
 * @file The gameplay kits' part of the public sim API (PLAN.md §6.1, WP 10.4): things that can be hit (the kind
 * `thing`, a thing's state and a scene's things), projectile patterns (shot emitters, their volleys and timing) and
 * awareness (sight, hearing and memory), re-exported whole by engine/sim-api.ts, so that file stays under its line cap,
 * as engine/sim/houseApi.ts does (ADR-0025 amendment 23). Game code imports these names from engine/sim-api.ts (or
 * engine/index.ts), never from here: the public-API rule rejects any other engine path.
 *
 * Invariants: the same as engine/sim-api.ts's: a flat list of `export … from` lines, one name per line, grouped by
 * area and append-only. Only sim-side modules are re-exported, and each name is documented where it is declared.
 *
 * @example
 * // labs/playground/scenes/range.ts
 * // import { defineThing, spawnThing, SHOT_EMITTER_FIELDS, loose, sense } from '../../../engine/sim-api';
 * @see engine/sim-api.ts
 */

// Things (WP 10.4): what can be hit, as a range's targets and a ring's dummies: the kind `thing` (its prop, hit points,
// rise, track and hooks), a thing's state (hits, down and up, its place on its track), and things in a scene (spawned
// as their prop, struck as hits, stood back up and driven along their tracks by the system `things`).
export { defineThing } from '../world/things';
export { getThing } from '../world/things';
export { thingState } from '../world/things';
export { hitThing } from '../world/things';
export { stepThing } from '../world/things';
export { thingAt } from '../world/things';
export { THING_FIELDS } from '../world/things';
export { THING_KIND_FIELDS } from '../world/things';
export type { Thing } from '../world/things';
export type { ThingKind } from '../world/things';
export type { ThingSpec } from '../world/things';
export type { ThingTouch } from '../world/things';
export type { ThingHit } from '../world/things';
export type { ThingOutcome } from '../world/things';
export type { ThingStanding } from '../world/things';
export { spawnThing } from './things';
export { strikeThing } from './things';

// Projectile patterns (WP 10.4): a shot emitter's volleys (aimed, forward, ring, spiral, random) and timing (delay,
// interval, bursts and their pause, range), and the shots it looses over WP 6.3's projectiles.
export { SHOT_EMITTER } from '../world/patterns';
export { SHOT_EMITTER_FIELDS } from '../world/patterns';
export { PATTERNS } from '../world/patterns';
export { MOST_VOLLEYS } from '../world/patterns';
export { volley } from '../world/patterns';
export { stepVolleys } from '../world/patterns';
export { loose } from '../world/patterns';
export { direction } from '../world/patterns';
export { headingTo } from '../world/patterns';
export type { ShotEmitter } from '../world/patterns';
export type { Pattern } from '../world/patterns';
export type { VolleyAim } from '../world/patterns';
export type { LooseOptions } from '../world/patterns';

// Awareness (WP 10.4): beyond WP 5.2's sight, the noises an agent hears and its memory of where it last saw or heard.
export { AWARENESS } from '../world/awareness';
export { AWARENESS_FIELDS } from '../world/awareness';
export { AWARENESS_STATES } from '../world/awareness';
export { sense } from '../world/awareness';
export { hears } from '../world/awareness';
export { earshot } from '../world/awareness';
export type { Awareness } from '../world/awareness';
export type { AwarenessState } from '../world/awareness';
export type { Noise } from '../world/awareness';
export type { SenseInput } from '../world/awareness';
export type { Sensed } from '../world/awareness';
