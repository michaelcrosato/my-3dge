/**
 * @file The box's walker (PLAN.md §9.0, WP 5.7): the crowd's foot soldier from Box 4 on, a capsule that walks after
 * the hero. `WALKER` holds its numbers, `CROWD_WALKER` its own component (`crowdWalker`: its speed, heading and sway
 * phase, beside the crowd agent the scene keeps), `makeWalker` draws one, and `steerWalker` gives the velocity it
 * wants each step, for `setVelocity` (engine/physics/crowd.ts), whose acceleration limit and the solver do the rest.
 * `Chase` is what every member of the cast steers by (the slime and the wisp take it too).
 *
 * Its steering, the prototype's swarm: level with the hero (within `WALKER.level` of his height) it waits on a ring
 * round him (`approachRing`): in by the flow field from beyond it, backing off inside it, drifting round it on it as
 * its sway turns; anywhere else (on the floor below his gallery, on the stairs) it follows the flow field toward his
 * tile (`followFlow`), up the stairs when he is up. It faces where it walks, turning at `WALKER.turn`, and him while
 * it waits.
 *
 * Its numbers are the stress test's husk walker (`my-3d2dge:src/stress-world/20-sim.js:73-74, 196-199, 371-385`), in
 * SI units (PLAN.md Appendix C: 16 units a metre), as starting values (§9.0: similar, not identical):
 * - the capsule: radius 5 units → 0.3125 m, a straight middle of 16 → 1 m (the crowd agent's own make), 1.625 m tall;
 * - walking at 28 units/s plus up to 12 more, drawn per walker → 1.75 to 2.5 m/s, at 500 units/s² (the agent's
 *   31.25 m/s²);
 * - the ring: the hero's reach plus 10 units → 1.5 m, a band of 3 units either side, backing off at half speed and
 *   drifting round at 0.4 of it, the sway's phase drawn per walker at 0.9 rad/s; level within 14 units → 0.875 m;
 * - turning at 5 rad/s. Its attacks arrive with Box 5 (PLAN.md §9.0).
 *
 * Its body is drawn as the neutral humanoid (a crowd body, engine/sim/crowdBodies.ts) in one of `WALKER.looks`: the
 * prototype's mixed husks, knights and skeletons, as builds.
 *
 * Game code, sim-side: it imports only engine/sim-api.ts.
 *
 * @example
 * WALKER.speed.min; // 1.75: m/s
 * // const out = steerWalker(agent, walker, chase, new Vector3()); setVelocity(physics, agent, out, w);
 * @see labs/box/cast/crowd.test.ts
 */
import {
  approachAng,
  approachRing,
  defineComponent,
  followFlow,
  type CrowdAgent,
  type FlowField,
  type Rng,
  type SteerPoint,
  type Vector3,
} from '../../../engine/sim-api';

/** The prototype's units per metre (PLAN.md Appendix C). */
const UNITS = 16;

/** The walker's numbers (see the file comment). */
export const WALKER = Object.freeze({
  /** Its body: the crowd agent's capsule (CROWD_AGENT's own radius and straight middle, m). */
  agent: Object.freeze({ shape: 'capsule', radius: 5 / UNITS, height: 16 / UNITS } as const),
  /** Its walking speed (m/s): `min` plus up to `spread`, drawn per walker. */
  speed: Object.freeze({ min: 28 / UNITS, spread: 12 / UNITS }),
  /** The ring it waits on round the hero (m), and its band either side (m). */
  ring: Object.freeze({ radius: 1.5, band: 3 / UNITS }),
  /** Within this height of the hero (m) it is level with him and waits on the ring. */
  level: 14 / UNITS,
  /** Its sway's rate (rad/s): how fast it drifts one way round the ring, then the other. */
  sway: 0.9,
  /** How fast it turns to face where it goes (rad/s). */
  turn: 5,
  /** The builds it is drawn in, one drawn per walker: the prototype's mixed skins (husk, knight, skeleton) and more. */
  looks: Object.freeze(['build:chibi', 'build:heroic', 'build:bulky', 'build:skeleton']),
});

/** The walker's own state, beside its crowd agent. */
export interface WalkerData {
  speed: number;
  yaw: number;
  sway: number;
}

/** The walker's component: its speed, heading and sway phase. */
export const CROWD_WALKER = defineComponent('crowdWalker', {
  description: 'A box walker’s own state, beside its crowd agent: its speed, its heading and its sway’s phase.',
  fields: {
    speed: { type: 'number', default: WALKER.speed.min, minimum: 0, unit: 'm/s', description: 'Its walking speed.' },
    yaw: { type: 'number', default: 0, unit: 'rad', description: 'Where it faces: forward is (sin yaw, 0, cos yaw).' },
    sway: { type: 'number', default: 0, unit: 'rad', description: 'Its sway’s phase on the ring.' },
  },
});

/** What every member of the cast steers by, each step. */
export interface Chase {
  /** The hero's feet (m). */
  readonly hero: SteerPoint;
  /** The flow field toward his tile, on the crowd's grid. */
  readonly field: FlowField;
  /** The floor's height under a point (m): the level's. */
  readonly floor: (x: number, z: number) => number;
  /** The sim's time (s) and step (s). */
  readonly time: number;
  readonly dt: number;
  /** The gravity a crowd agent falls under, before its own scale (m/s²): the `physics.gravity` setting. */
  readonly gravity: number;
  /** The stream the crowd's choices are drawn from while it plays. */
  readonly rng: Pick<Rng, 'next' | 'range'>;
}

/** A new walker's own state, its speed and sway's phase drawn from `rng`, facing `yaw`. */
export function makeWalker(rng: Pick<Rng, 'next' | 'range'>, yaw = 0): WalkerData {
  return { speed: WALKER.speed.min + rng.next() * WALKER.speed.spread, yaw, sway: rng.range(0, 2 * Math.PI) };
}

/** Whether a point at height `y` (m) is level with the hero. */
export const levelWith = (chase: Chase, y: number) => Math.abs(chase.hero.y - y) < WALKER.level;

/** The velocity (m/s) the walker wants this step, into `out`, turning it toward where it goes (see the file comment). */
export function steerWalker(agent: CrowdAgent, walker: WalkerData, chase: Chase, out: Vector3): Vector3 {
  const { hero } = chase;
  const level = levelWith(chase, agent.y);
  if (level) {
    const sway = Math.sin(chase.time * WALKER.sway + walker.sway);
    approachRing(chase.field, agent, hero, WALKER.ring, sway, out);
  } else followFlow(chase.field, agent, hero, out);
  const [dx, dz] = [hero.x - agent.x, hero.z - agent.z];
  const waiting = level && dx * dx + dz * dz < (WALKER.ring.radius + 1) * (WALKER.ring.radius + 1);
  const moving = out.x * out.x + out.z * out.z > 1e-6;
  const facing = waiting ? Math.atan2(dx, dz) : moving ? Math.atan2(out.x, out.z) : walker.yaw;
  walker.yaw = approachAng(walker.yaw, facing, chase.dt * WALKER.turn);
  return out.multiplyScalar(walker.speed);
}
