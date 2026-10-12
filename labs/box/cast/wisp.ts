/**
 * @file The box's wisp (PLAN.md §9.0, WP 5.7): a floater that hovers after the hero and circles him, from Box 4 on.
 * `WISP` holds its numbers, `CROWD_WISP` its own component (`crowdWisp`: which way it circles and its hover's clock,
 * beside the crowd agent the scene keeps), `makeWisp` draws one, and `steerWisp` gives the velocity it wants each
 * step, for `setVelocity` (engine/physics/crowd.ts), up and down too: it is a flyer (the group `flyer`, through the
 * crowd and the hero, stopped by the level alone).
 *
 * Its steering, the prototype's swarm: it closes in on the hero from beyond `WISP.far` (by the flow field when it has
 * a way, so it rounds walls and rises by the stairs), backs off inside `WISP.near`, and between the two only circles
 * him, its own way round; it circles him at every distance. It hovers over whatever is below it, the floor, the dais
 * or a gallery (`hover`, engine/world/steer.ts: its feet `HOVER.height` up, bobbing on its clock).
 *
 * Its numbers are the stress test's wisp (`my-3d2dge:src/stress-world/20-sim.js:204-207, 415-428`), in SI units
 * (PLAN.md Appendix C: 16 units a metre), as starting values (§9.0: similar, not identical): a ball of radius 5 units
 * → 0.3125 m; in from beyond 100 units → 6.25 m and out from inside 70 → 4.375 m at 60 units/s² against a drag of 1.6
 * a second (so 2.34 m/s at most), round at 34 units/s² (1.33 m/s); steered at 3.75 m/s², the prototype's 60 units/s²;
 * hovering 20 units → 1.25 m up, ±3 units at 2 rad/s, climbing at 6 times the gap (`HOVER`).
 *
 * Its shot (Box 5, WP 6.7): `WISP_ATTACK`. Within `range` of the hero, every `every` s plus up to `spread` (the first
 * after `first` plus up to `spread`), it charges for `charge` s, its line telegraph (`telegraph:boxShot`) filling on
 * the floor toward him, swelling as it goes, then shoots at his chest (`chest` m up): a bolt at `speed` m/s that lives
 * `life` s and takes `damage` hit points. Walls stop it. It takes no attack token: the prototype's wisps shot
 * whenever they were charged. A hit on it breaks its charge off. It has `health` hit points.
 *
 * Its body is drawn as a floater (a crowd body, engine/sim/crowdBodies.ts), banking into its turns, its motes round it.
 *
 * Game code, sim-side: it imports only engine/sim-api.ts.
 *
 * @example
 * WISP.far; // 6.25: m, beyond which it closes in
 * // setVelocity(physics, agent, steerWisp(agent, wisp, chase, new Vector3()), w);
 * @see labs/box/cast/crowd.test.ts
 */
import {
  defineComponent,
  defineTelegraph,
  followFlow,
  hover,
  type CrowdAgent,
  type Rng,
  type Vector3,
} from '../../../engine/sim-api';
import type { Chase } from './walker';

/** The prototype's units per metre (PLAN.md Appendix C). */
const UNITS = 16;
/** The prototype's drag on a wisp, per second: its top speeds are its pulls over this. */
const DRAG = 1.6;

/** The wisp's numbers (see the file comment). */
export const WISP = Object.freeze({
  /** Its body: a flying ball (m), steered at `acceleration` (m/s²). */
  agent: Object.freeze({ shape: 'ball', radius: 5 / UNITS, flyer: true, acceleration: 60 / UNITS } as const),
  /** Beyond this distance from the hero (m) it closes in; inside `near` it backs off. */
  far: 100 / UNITS,
  near: 70 / UNITS,
  /** Its speed in or out (m/s), and round the hero (m/s). */
  speed: 60 / UNITS / DRAG,
  circle: 34 / UNITS / DRAG,
});

/** The wisp's own state, beside its crowd agent. */
export interface WispData {
  orbit: number;
  clock: number;
}

/** The wisp's component: which way it circles, and its hover's clock. */
export const CROWD_WISP = defineComponent('crowdWisp', {
  description: 'A box wisp’s own state, beside its crowd agent: which way it circles the hero, and its hover’s clock.',
  fields: {
    orbit: {
      type: 'integer',
      default: 1,
      minimum: -1,
      maximum: 1,
      description: '1 anticlockwise seen from above, −1 clockwise.',
    },
    clock: { type: 'number', default: 0, unit: 's', description: 'Its hover’s clock: the bob’s phase.' },
  },
});

/** A new wisp's own state: its way round and its clock (up to 9 s) drawn from `rng`. */
export function makeWisp(rng: Pick<Rng, 'next'>): WispData {
  return { orbit: rng.next() < 0.5 ? 1 : -1, clock: rng.next() * 9 };
}

/** The velocity (m/s) the wisp wants this step, into `out`, its clock advanced (see the file comment). */
export function steerWisp(agent: CrowdAgent, wisp: WispData, chase: Chase, out: Vector3): Vector3 {
  wisp.clock += chase.dt;
  const [dx, dz] = [chase.hero.x - agent.x, chase.hero.z - agent.z];
  const distance = Math.sqrt(dx * dx + dz * dz) || 1;
  const [ux, uz] = [dx / distance, dz / distance];
  if (distance > WISP.far) followFlow(chase.field, agent, chase.hero, out).multiplyScalar(WISP.speed);
  else out.set(0, 0, 0);
  if (distance < WISP.near) out.set(-ux * WISP.speed, 0, -uz * WISP.speed);
  const round = wisp.orbit * WISP.circle;
  out.x -= uz * round;
  out.z += ux * round;
  out.y = hover(agent.y, chase.floor(agent.x, agent.z), wisp.clock);
  return out;
}

/** The wisp's shot (see the file comment): seconds, metres, m/s and hit points. */
export const WISP_ATTACK = Object.freeze({
  /** Its hit points, and the hit points its shot takes. */
  health: 14,
  damage: 8,
  /** It shoots within this distance of the hero across the floor (m). */
  range: 160 / UNITS,
  /** Its charge (s), and the seconds between shots: `every` plus up to `spread`, the first `first` plus up to `spread`. */
  charge: 0.6,
  every: 2.5,
  first: 2,
  spread: 2,
  /** Its shot: speed (m/s), life (s), radius (m), aimed this high above the hero's feet (m). */
  speed: 95 / UNITS,
  life: 3,
  radius: 3 / UNITS,
  chest: 14 / UNITS,
  /** Its telegraph: a line from the floor under it toward the hero. */
  telegraph: 'telegraph:boxShot',
});

/** The wisp's shot on the floor: a narrow line from under it, as far as it shoots. */
export const WISP_SHOT = defineTelegraph(WISP_ATTACK.telegraph, {
  description: 'A box wisp’s shot: the line on the floor under its path, toward the hero.',
  shape: 'line',
  length: 160 / UNITS,
  width: 0.3,
  yMin: 0,
  yMax: 3,
  near: 0.5,
  color: '#c78bff',
});
