/**
 * @file Damage (PLAN.md WP 6.3, §6.4): what a hit does once the rules have decided it, generic and without formulas,
 * stats or balance: `damage(w, target, hit)` takes `hit.amount` from the target's health, pushes its crowd body
 * away from the blow as momentum the solver carries on, throws it up, kills it into the corpse group with the kill
 * launch, asks for a hit-stop and emits the event `damage` for the view (numbers, sparks, sounds). How much a hit
 * takes and how hard it pushes are the game's numbers, passed in.
 *
 * - **Health**: the game keeps it in a component (`HEALTH_FIELDS`): hit points, and when and by whom it was last hit,
 *   which flinches, stuns and flashes read (`w.tick - health.hitAt`). At 0 or below it is dead.
 * - **Bodies**: a crowd agent's (engine/physics/crowd.ts): `knockback` adds the push the same for every mass and the
 *   solver carries it into the crowd; `launch` throws it up; `killAgent` moves it to the group `corpse`, which the
 *   crowd walks through, and `updateCrowd` removes it later.
 * - **Hit-stop**: a sim decision the frame clock carries out (engine/core/time.ts). `requestHitStop` keeps the longest
 *   stop asked in the step (they never add up); the run's host takes it after the step (`takeHitStop`) for
 *   `clock.hitStop`, whose leaky budget shrinks stops that follow closely, so a crowd hit stops time once however many
 *   it strikes. The clock is outside the hash: a stop changes how many steps a frame runs, never what a step does.
 *
 * Invariants: a dead or absent target (health at 0 or below, a body no longer `alive`) takes no hit: `damage` returns
 * null and changes nothing. Everything a hit changes is in the target's components and its body, and the events are
 * plain data, so a capture restores it. The asked stop waits in a side table by world, an outbox the sim never reads
 * (no listener: a listener would join the world's captured schedule), so it never changes the hash. Only hosts take it:
 * engine/sim-api.ts leaves `takeHitStop` out. No clock, no random stream: a rule that wants randomness draws from a
 * named stream and passes the result in.
 *
 * Carried from `my-3d2dge:src/stress-world/20-sim.js:324-342` (`damageEnemy`: the knockback along the blow, the big
 * hit's launch, the kill launch and its 1.3 carry, the switch to the dead group, the freeze), the hit-stop through
 * the budget of `src/emberdeep/10-combat.js:45-76` (engine/core/time.ts).
 *
 * @example
 * import { createPhysics } from '../physics/world';
 * import { attachPhysics } from '../physics/binding';
 * import { createWorld } from './world';
 * const w = createWorld({ seed: 1 });
 * attachPhysics(w, createPhysics()); // a scene with physics: true has this
 * const health = { ...HEALTH, hp: 3 };
 * damage(w, { id: 4, health }, { amount: 5, from: [0, 0, 0], stop: 0.06 }); // { killed: true, hp: -2, … }; an agent's body is also knocked
 * takeHitStop(w); // 0.06: the host hands it to its frame clock (clock.hitStop), once
 * takeHitStop(w); // 0: taken
 * @see engine/sim/damage.test.ts
 */
import type { EventMap } from '../core/events';
import { codeError } from '../core/log';
import { copyValue, defineSchema, freezeValue, isPlainObject, show } from '../core/schema';
import { killAgent, knockback, launch, type CrowdAgent } from '../physics/crowd';
import type { Vec3Like } from '../physics/queries';
import { physicsOf } from '../physics/binding';
import type { World } from './world';

/** A target's health, for a scene's component: `defineComponent('health', { description, fields: HEALTH_FIELDS })`. */
export const HEALTH_FIELDS = defineSchema({
  hp: { type: 'number', default: 1, description: 'Hit points left: at 0 or below, it is dead.' },
  hitAt: {
    type: 'integer',
    default: -1,
    minimum: -1,
    description: 'The step it was last hit (w.tick; −1: never): flinches, stuns and flashes count from it.',
  },
  hitBy: { type: 'integer', default: -1, minimum: -1, description: 'Who hit it last (an entity id; −1: unknown).' },
});

/** A target's health (`HEALTH_FIELDS` says what each field means). */
export interface Health {
  hp: number;
  hitAt: number;
  hitBy: number;
}

/** Health with every field at its default: 1 hit point, never hit. */
export const HEALTH: Readonly<Health> = freezeValue(
  Object.fromEntries(
    Object.entries(HEALTH_FIELDS).map(([key, field]) => [key, copyValue(field.default)]),
  ) as unknown as Health,
);

/** What a hit lands on: the entity (named in the events), its health and its crowd body, either optional. */
export interface DamageTarget {
  readonly id: number;
  readonly health?: Health | null;
  readonly agent?: CrowdAgent | null;
}

/** A hit as the rules decided it. Speeds are what the body gains, the same for every mass (m/s). */
export interface HitSpec {
  /** Hit points it takes (0). */
  readonly amount?: number;
  /** Where the blow comes from (m): the attacker's feet, a projectile's centre. The push points away from it. */
  readonly from: Vec3Like;
  /** The push's direction instead (a projectile's flight): only its part along the ground counts. */
  readonly direction?: Vec3Like;
  /** Where it struck, for the event (m): the middle of the crowd body by default, else `from`. */
  readonly at?: Vec3Like;
  /** Who hit (an entity id; −1). */
  readonly source?: number;
  /** The push across the ground (m/s; 0). */
  readonly knockback?: number;
  /** The throw: its upward speed becomes at least this (m/s; 0). */
  readonly launch?: number;
  /** When it kills: the kill launch's upward speed (m/s; 0) and how much its speed across the ground grows (×; 1). */
  readonly kill?: { readonly launch?: number; readonly carry?: number };
  /** The hit-stop it asks for (s; 0): the frame clock's budget decides how much it gets. */
  readonly stop?: number;
}

/** The event `damage`: a hit landed. Plain data. */
export interface DamageEvent {
  /** The entity hit, and who hit it (−1: unknown). */
  readonly target: number;
  readonly source: number;
  /** Hit points it took, and those left (null: a target without health). */
  readonly amount: number;
  readonly hp: number | null;
  /** Whether this hit killed it. */
  readonly killed: boolean;
  /** Where it struck (m), and the push's direction along the ground (a unit vector; zero when there was none). */
  readonly at: readonly [number, number, number];
  readonly dir: readonly [number, number, number];
  /** The hit-stop it asked for (s). */
  readonly stop: number;
}

/** The events this module emits, for a world's event map: `World<Components, DamageEvents & MyEvents>`. */
export type DamageEvents = { damage: DamageEvent };

/** The longest hit-stop asked of each world since its host last took it (s): an outbox the sim never reads. */
const asked = new WeakMap<object, number>();

/** Throws `SIM_BAD_ARGUMENT` unless `ok`. */
function check(ok: boolean, where: string, value: unknown, expected: string): void {
  if (!ok) throw codeError('SIM_BAD_ARGUMENT', { where, value: show(value), expected });
}

/** A point or direction as numbers, checked. */
function xyz(v: Vec3Like, where: string): [number, number, number] {
  const p: readonly number[] = 'x' in v ? [v.x, v.y, v.z] : v;
  check(p.length === 3 && p.every(Number.isFinite), where, v, 'metres: [x, y, z] or { x, y, z }');
  return [p[0], p[1], p[2]];
}

/** A finite number of 0 or more, or the fallback when absent. */
function amount(value: number | undefined, where: string, unit: string): number {
  check(value === undefined || (Number.isFinite(value) && value >= 0), where, value, `${unit}, 0 or more`);
  return value ?? 0;
}

/** The middle of a crowd agent's body (m): half its height above its feet. */
function middle(agent: CrowdAgent): [number, number, number] {
  return [agent.x, agent.y + agent.radius + (agent.shape === 'ball' ? 0 : agent.height / 2), agent.z];
}

/** The unit vector along the ground of (x, z), or zero. */
function flat(x: number, z: number): [number, number, number] {
  const d = Math.sqrt(x * x + z * z);
  return d > 1e-9 ? [x / d, 0, z / d] : [0, 0, 0];
}

/**
 * Asks the frame clock for a hit-stop of `seconds` (real seconds, before its budget): kept until the run's host takes
 * it after the step (`takeHitStop`), the longest of the step winning. Nothing for 0.
 */
export function requestHitStop<C extends object, E extends EventMap>(world: World<C, E>, seconds: number): void {
  amount(seconds, 'requestHitStop(w, seconds)', 'seconds');
  if (seconds > 0) asked.set(world, Math.max(asked.get(world) ?? 0, seconds));
}

/**
 * For the run's host (the page's or a headless run's step, never sim code, so not in engine/sim-api.ts): the longest
 * hit-stop asked since the last take (s; 0 for none), forgotten once taken. Hand it to the frame clock after each
 * step: `clock.hitStop(s)`.
 */
export function takeHitStop<C extends object, E extends EventMap>(world: World<C, E>): number {
  const seconds = asked.get(world) ?? 0;
  asked.delete(world);
  return seconds;
}

/**
 * Lands a hit on `target`: takes `hit.amount` from its health, and on its crowd body (in the scene's physics world)
 * adds the knockback away from `hit.from`, the launch, and when the hit kills, the switch to the corpse group and
 * the kill launch; asks for `hit.stop` of hit-stop; emits `damage` and returns the event. A dead or absent target
 * takes no hit: null, nothing changed.
 */
export function damage<C extends object, E extends EventMap>(
  world: World<C, E>,
  target: DamageTarget,
  hit: HitSpec,
): DamageEvent | null {
  const w = world as unknown as World<object, DamageEvents>;
  check(
    isPlainObject(target) && Number.isInteger(target.id),
    'damage(w, target)',
    target,
    'a target: { id, health?, agent? }',
  );
  check(isPlainObject(hit), 'damage(w, target, hit)', hit, 'a hit: { from, amount?, knockback?, launch?, … }');
  const { health, agent } = target;
  const taken = amount(hit.amount, 'damage(…, { amount })', 'hit points');
  const push = amount(hit.knockback, 'damage(…, { knockback })', 'm/s');
  const up = amount(hit.launch, 'damage(…, { launch })', 'm/s');
  const stop = amount(hit.stop, 'damage(…, { stop })', 'seconds');
  const kill = {
    launch: amount(hit.kill?.launch, 'damage(…, { kill: { launch } })', 'm/s'),
    carry: hit.kill?.carry ?? 1,
  };
  check(
    Number.isFinite(kill.carry) && kill.carry >= 0,
    'damage(…, { kill: { carry } })',
    kill.carry,
    'a factor of 0 or more',
  );
  const source = hit.source ?? -1;
  check(Number.isInteger(source), 'damage(…, { source })', source, 'an entity id, or −1');
  const from = xyz(hit.from, 'damage(…, { from })');
  const struck = hit.at ? xyz(hit.at, 'damage(…, { at })') : null;
  const along = hit.direction ? xyz(hit.direction, 'damage(…, { direction })') : null;
  if ((health && !(health.hp > 0)) || (agent && agent.state !== 'alive')) return null;

  let killed = false;
  if (health) {
    [health.hp, health.hitAt, health.hitBy] = [health.hp - taken, w.tick, source];
    killed = !(health.hp > 0);
  }
  const at = struck ?? (agent ? middle(agent) : from);
  const [px, pz] = agent ? [agent.x, agent.z] : [at[0], at[2]];
  const dir = along ? flat(along[0], along[2]) : flat(px - from[0], pz - from[2]);
  if (agent) {
    const physics = physicsOf(w);
    if (push > 0) knockback(physics, agent, [dir[0] * push, 0, dir[2] * push]);
    if (up > 0) launch(physics, agent, up);
    if (killed) {
      killAgent(physics, agent);
      if (kill.launch > 0 || kill.carry !== 1) launch(physics, agent, kill.launch, kill.carry);
    }
  }
  requestHitStop(w, stop);
  const event: DamageEvent = {
    target: target.id,
    source,
    amount: taken,
    hp: health ? health.hp : null,
    killed,
    at,
    dir,
    stop,
  };
  w.emit('damage', event);
  return event;
}
