/**
 * @file The box's slime (PLAN.md §9.0, WP 5.7): a ball that hops after the hero, from Box 4 on. `SLIME` holds its
 * numbers, `CROWD_SLIME` its own component (`crowdSlime`: where it is in its hop and for how long, beside the crowd
 * agent the scene keeps), `makeSlime` draws one, and `steerSlime` moves it each step: on the floor it brakes, rests,
 * crouches and leaps; in the air it flies on until it lands.
 *
 * Its hop, the prototype's: after a rest it crouches for `SLIME.crouch`, then leaps (`hop`, engine/world/steer.ts)
 * `SLIME.reach` metres along the flow field toward the hero's tile, up at `SLIME.up` m/s, so it lands where it aimed
 * under its own gravity, onto a stair as well as across the floor; level with the hero it keeps to a ring round him
 * instead, leaping in from beyond it by what it lacks and out from inside it. A hop too short to bother with, or one
 * out of reach, waits a moment. After landing it rests for `SLIME.rest` plus up to `SLIME.restSpread`, drawn from the
 * crowd's stream.
 *
 * Its pounce (Box 5, WP 6.7): `SLIME_ATTACK`. Resting on its ring round the hero, cooled down and granted one of his
 * attack tokens, it squats for `wind` s, its line telegraph (`telegraph:boxPounce`) filling toward him, then leaps at
 * where he stood, up at `up` m/s, to land just short of him; touching him on the way takes `damage` hit points and
 * throws it back off him. Landed, it gives the token back and rests `rest` s plus up to `SLIME.restSpread`. A hit on
 * it breaks its pounce off. It has `health` hit points.
 *
 * Its numbers are the stress test's slime (`my-3d2dge:src/stress-world/20-sim.js:200-203, 387-414`), in SI units
 * (PLAN.md Appendix C: 16 units a metre), as starting values (§9.0: similar, not identical): a ball of radius 6 units
 * → 0.375 m; leaps of 150 units/s up → 9.375 m/s (`HOP.up`), at most 44 units → 2.75 m (`HOP.reach`), after a crouch
 * of 0.28 s; a rest of 0.45 s plus up to 0.6 s; braking at 400 units/s² → 25 m/s²; its ring 34 units → 2.125 m, its
 * band 8 units → 0.5 m. Its first rest is drawn from its spawn, up to 1 s.
 *
 * Its body is drawn as a blob (a crowd body, engine/sim/crowdBodies.ts) in one of `SLIME.looks`, squashed by where it
 * is in its hop (`SLIME.squash`); the blob's spring makes the bounce.
 *
 * Game code, sim-side: it imports only engine/sim-api.ts.
 *
 * @example
 * SLIME.reach; // 2.75: m, its longest hop
 * // steerSlime(physics, agent, slime, chase); // in the phase ai, each step
 * @see labs/box/cast/crowd.test.ts
 */
import {
  HOP,
  defineComponent,
  defineTelegraph,
  followFlow,
  hop,
  knockback,
  launch,
  setVelocity,
  Vector3,
  type CrowdAgent,
  type Physics,
  type Rng,
} from '../../../engine/sim-api';
import { levelWith, type Chase } from './walker';

/** The prototype's units per metre (PLAN.md Appendix C). */
const UNITS = 16;

/** The slime's numbers (see the file comment). */
export const SLIME = Object.freeze({
  /** Its body: a ball (m). */
  agent: Object.freeze({ shape: 'ball', radius: 6 / UNITS } as const),
  /** How fast it leaps up (m/s), and its longest leap (m). */
  up: HOP.up,
  reach: HOP.reach,
  /** A leap shorter than this (m) is not worth it: it waits `SLIME.wait` instead. */
  least: 4 / UNITS,
  /** Seconds it crouches before a leap, waits after a leap it skipped, and rests after landing (plus a spread). */
  crouch: 0.28,
  wait: 0.3,
  rest: 0.45,
  restSpread: 0.6,
  /** In the air at least this long (s) before it can land. */
  airborne: 0.1,
  /** How hard it brakes on the floor (m/s²). */
  brake: 400 / UNITS,
  /** The ring it keeps round the hero (m), and its band either side (m). */
  ring: Object.freeze({ radius: 34 / UNITS, band: 8 / UNITS }),
  /** Its looks, one drawn per slime: the prototype's `SLIME_PARTS`, plain twice, horns, cat ears, wings. */
  looks: Object.freeze(['', '', 'horns', 'ears', 'wings']),
  /** The squash its body eases to (engine/anim/blob.ts): flat in its crouch, stretched rising, braced falling. */
  squash: Object.freeze({ rest: 0, crouch: -0.35, rising: 0.25, falling: -0.1 }),
});

/** Where a slime is in its hop. */
export type SlimeHop = 'rest' | 'crouch' | 'air';

/** The slime's own state, beside its crowd agent. */
export interface SlimeData {
  hop: SlimeHop;
  timer: number;
}

/** The slime's component: where it is in its hop, and the time left in that part (or spent in the air). */
export const CROWD_SLIME = defineComponent('crowdSlime', {
  description: 'A box slime’s own state, beside its crowd agent: where it is in its hop and the seconds that part has.',
  fields: {
    hop: {
      type: 'string',
      enum: ['rest', 'crouch', 'air'],
      default: 'rest',
      description: 'rest (on the floor), crouch (about to leap), air (leaping).',
    },
    timer: {
      type: 'number',
      default: 0,
      unit: 's',
      description: 'Resting or crouching: the seconds left; in the air: the seconds since it leapt.',
    },
  },
});

/** A new slime's own state: resting, its first rest drawn from `rng`, up to 1 s. */
export function makeSlime(rng: Pick<Rng, 'next'>): SlimeData {
  return { hop: 'rest', timer: rng.next() };
}

const [way, to] = [new Vector3(), new Vector3()];
const STILL = [0, 0, 0] as const;

/** The way a slime leaps, into `way`, and how far (m); 0 when it stays. */
function aim(agent: CrowdAgent, chase: Chase): number {
  const [dx, dz] = [chase.hero.x - agent.x, chase.hero.z - agent.z];
  const distance = Math.sqrt(dx * dx + dz * dz);
  if (levelWith(chase, agent.y) && distance > 1e-3) {
    const gap = distance - SLIME.ring.radius;
    if (Math.abs(gap) < SLIME.ring.band) return 0;
    way.set(dx / distance, 0, dz / distance);
    if (gap < 0) way.negate();
    return Math.min(Math.abs(gap), SLIME.reach);
  }
  followFlow(chase.field, agent, chase.hero, way);
  return way.x * way.x + way.z * way.z > 1e-6 ? SLIME.reach : 0;
}

/**
 * Moves a living slime one step (see the file comment): in the air until it lands, else braking on the floor while it
 * rests and crouches, then a leap by `knockback` and `launch` (engine/physics/crowd.ts). Draws its rests from
 * `chase.rng`.
 */
export function steerSlime(physics: Physics, agent: CrowdAgent, slime: SlimeData, chase: Chase): void {
  if (agent.state !== 'alive') return;
  const { dt } = chase;
  if (slime.hop === 'air') {
    slime.timer += dt;
    if (slime.timer < SLIME.airborne || !agent.grounded) return;
    [slime.hop, slime.timer] = ['rest', SLIME.rest + chase.rng.next() * SLIME.restSpread];
  }
  setVelocity(physics, agent, STILL, { dt, acceleration: SLIME.brake });
  slime.timer -= dt;
  if (slime.timer > 0) return;
  if (slime.hop === 'rest') {
    [slime.hop, slime.timer] = ['crouch', SLIME.crouch];
    return;
  }
  const length = aim(agent, chase);
  const x = agent.x + way.x * length;
  const z = agent.z + way.z * length;
  const leap =
    length >= SLIME.least
      ? hop(agent, to.set(x, chase.floor(x, z), z), SLIME.up, chase.gravity * agent.gravityScale)
      : null;
  if (!leap) {
    [slime.hop, slime.timer] = ['rest', SLIME.wait];
    return;
  }
  knockback(physics, agent, [leap.x - agent.vx, 0, leap.z - agent.vz]);
  launch(physics, agent, leap.y);
  [slime.hop, slime.timer] = ['air', 0];
}

/** The slime's pounce (see the file comment): seconds, metres, m/s and hit points. */
export const SLIME_ATTACK = Object.freeze({
  /** Its hit points, and the hit points its pounce takes. */
  health: 20,
  damage: 6,
  /** Its squat before it leaps (s), and how far off its ring it may stand to start one (m). */
  wind: 0.5,
  slack: 0.25,
  /** Its leap up (m/s), landing this far short of the hero's feet (m), its body touching his within `touch` m. */
  up: 85 / UNITS,
  short: 0.4,
  touch: 1 / UNITS,
  /** Thrown back off him as it touches (a share of its speed) and up (m/s). */
  bounce: 0.7,
  bounceUp: 90 / UNITS,
  /** Its rest after a pounce (s), before `SLIME.restSpread`. */
  rest: 1.1,
  /** Its telegraph: a line from it toward the hero, as long as its ring is wide and a little more. */
  telegraph: 'telegraph:boxPounce',
});

/** The slime's pounce on the floor: a line its own width, from it to just past the hero on its ring. */
export const SLIME_POUNCE = defineTelegraph(SLIME_ATTACK.telegraph, {
  description: 'A box slime’s pounce: the strip of floor it leaps along, from it to the hero.',
  shape: 'line',
  length: 34 / UNITS + 0.5,
  width: (2 * 6) / UNITS,
  yMin: 0,
  yMax: 1.5,
  near: 0.5,
  color: '#ff6aa8',
});
