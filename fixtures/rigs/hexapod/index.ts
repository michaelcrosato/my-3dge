/**
 * @file A hexapod (PLAN.md WP 10.1; fixtures/rigs/README.md): an insect of the procedural blocks alone
 * (engine/sim-api.ts). Six legs walk on alternate tripods (`LegGait`, two groups), each foot on the ground a raycast
 * finds or gripping a wall that stands between its hip and its spot; each leg bends its knee up and out by two-bone IK
 * (`twoBone`); its body rides lower as its feet lift and tilts with its feet's heights (the gait's `lifting` and
 * `tilt`) on springs (`Spring1`); its abdomen swings behind on a lagging part (`LagPart`) as it turns. `HEXAPOD` is
 * its rig (engine/anim/proc/rig.ts): rest, walk, turn (left and back) and wall (along a wall at its right, its right
 * feet on it).
 *
 * Invariants: metres, seconds, +Y up, facing +Z; a fixed step; nothing random.
 *
 * @example
 * import { Vector3 } from '../../../engine/sim-api';
 * const bug = new Hexapod();
 * for (let i = 0; i < 60; i++) bug.step({ velocity: new Vector3(0, 0, 0.6) });
 * bug.gait.lifted() <= 3; // true: a tripod at a time
 * @see fixtures/rigs/hexapod/index.test.ts
 */
import { LagPart, LegGait, Quaternion, Spring1, twoBone, Vector3, type GaitLeg, type GaitProbe, type GroundHit, type ProcRig } from '../../../engine/sim-api'; // prettier-ignore

/** Its sizes, m: the body's height, the legs' two bones, the abdomen. */
export const HEXAPOD_SIZE = { height: 0.14, femur: 0.14, tibia: 0.2, abdomen: 0.16 } as const;

/** Its legs: three a side, front to back, alternate tripods (left front, right middle, left back, and the others). */
export const HEXAPOD_LEGS: readonly GaitLeg[] = [1, -1].flatMap(
  (side) =>
  [0.12, 0, -0.12].map((z, k) => ({ hip: [0.06 * side, HEXAPOD_SIZE.height, z], rest: [0.26 * side, 0, z * 1.3], group: (k + (side > 0 ? 0 : 1)) % 2 }) as const), // prettier-ignore
);

const [UP, LEFT] = [new Vector3(0, 1, 0), new Vector3(1, 0, 0)];
const at = (base: Vector3, turn: Quaternion, x: number, y: number, z: number) => new Vector3(x, y, z).applyQuaternion(turn).add(base); // prettier-ignore

/** A floor, and a wall `wall` m to the right of where it started facing `yaw` (none: Infinity). */
export function hexapodWorld(yaw: number, wall = Infinity): GaitProbe {
  const right = new Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
  return (o: Vector3, d: Vector3, max: number, hit: GroundHit) => {
    const [toward, off] = [d.dot(right), wall - o.dot(right)];
    const [floor, face] = [d.y < 0 ? -o.y / d.y : Infinity, toward > 1e-9 && Number.isFinite(wall) ? off / toward : Infinity]; // prettier-ignore
    const t = Math.min(floor, face);
    if (!(t >= 0 && t <= max)) return false;
    hit.point.copy(o).addScaledVector(d, t);
    hit.normal.copy(t === face ? right.clone().negate() : UP);
    return true;
  };
}

/** The hexapod (see the file comment). */
export class Hexapod {
  readonly root = new Vector3();
  readonly turn = new Quaternion();
  readonly gait = new LegGait({ legs: HEXAPOD_LEGS, threshold: { base: 0.08, perSpeed: 0.03, maxSpeed: 3, still: 0.01, stand: 0.05 }, lift: { base: 0.05, perSpeed: 0.02 } }); // prettier-ignore
  readonly abdomen = new LagPart({ length: HEXAPOD_SIZE.abdomen, rest: new Vector3(0, -0.35, -1), frequency: 8, damping: 0.5, limit: 0.7 }); // prettier-ignore
  readonly drop = new Spring1({ frequency: 14 });
  readonly pitch = new Spring1({ frequency: 10 });
  readonly roll = new Spring1({ frequency: 10 });
  readonly dt: number;
  readonly probe: GaitProbe;
  yaw: number;
  #points: Vector3[] = [];

  /** A hexapod at the origin facing `yaw`, stepped every `dt` s, walking the world `probe` finds (a flat floor). */
  constructor(options: { yaw?: number; dt?: number; probe?: GaitProbe } = {}) {
    [this.yaw, this.dt] = [options.yaw ?? 0, options.dt ?? 1 / 60];
    this.probe = options.probe ?? hexapodWorld(this.yaw);
  }

  /** One step: moving at `velocity`, turning at `spin` rad/s. */
  step(input: { velocity?: Vector3; spin?: number } = {}): this {
    const dt = this.dt;
    const velocity = input.velocity ?? new Vector3();
    this.root.addScaledVector(velocity, dt);
    this.yaw += (input.spin ?? 0) * dt;
    this.gait.step(dt, { position: this.root, yaw: this.yaw, velocity }, this.probe);
    const [pitch, roll] = this.gait.tilt();
    this.turn.setFromAxisAngle(UP, this.yaw);
    const tilted = this.turn.clone().multiply(new Quaternion().setFromAxisAngle(LEFT, -this.pitch.step(dt, pitch))).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), this.roll.step(dt, roll))); // prettier-ignore
    const body = at(this.root, this.turn, 0, HEXAPOD_SIZE.height - this.drop.step(dt, 0.01 * this.gait.lifting()), 0);
    const [head, waist] = [at(body, tilted, 0, 0.01, 0.16), at(body, tilted, 0, 0, -0.14)];
    const tip = this.abdomen.step(dt, waist, tilted).clone();
    const legs = HEXAPOD_LEGS.flatMap((leg, i) => {
      const hip = at(body, tilted, leg.hip[0], 0, leg.hip[2]);
      const pole = UP.clone().addScaledVector(at(new Vector3(), this.turn, Math.sign(leg.hip[0]), 0, 0), 0.6);
      const [knee, foot] = twoBone(hip, this.gait.feet[i].position, HEXAPOD_SIZE.femur, HEXAPOD_SIZE.tibia, pole);
      return [hip, knee.clone(), foot.clone()];
    });
    this.#points = [this.root.clone(), body, head, waist, tip, ...legs];
    return this;
  }

  /** Its points, in `HEXAPOD.names`' order (after a step). */
  points(): Vector3[] {
    return this.#points;
  }
}

const LEG_NAMES = HEXAPOD_LEGS.map((_, i) => `leg${i}`);

/** The hexapod's rig: its points, its bones, its six feet, and its states. */
export const HEXAPOD: ProcRig = {
  id: 'rig:hexapod',
  names: ['root', 'body', 'head', 'waist', 'abdomen', ...LEG_NAMES.flatMap((leg) => [`${leg} hip`, `${leg} knee`, `${leg} foot`])], // prettier-ignore
  bones: [['body', 'head'], ['body', 'waist'], ['waist', 'abdomen'], ...LEG_NAMES.flatMap((leg) => [[`${leg} hip`, `${leg} knee`], [`${leg} knee`, `${leg} foot`]] as [string, string][])], // prettier-ignore
  feet: LEG_NAMES.map((leg) => `${leg} foot`),
  states: { rest: 1, walk: 2, turn: 1.5, wall: 2 },
  make(state, facing, dt) {
    const bug = new Hexapod({ yaw: facing, dt, probe: hexapodWorld(facing, state === 'wall' ? 0.2 : Infinity) });
    const ahead = new Vector3(Math.sin(facing), 0, Math.cos(facing));
    return {
      step(time) {
        const on = time !== undefined;
        const speed = on && state === 'walk' ? 0.6 : on && state === 'wall' ? 0.4 : 0;
        const spin = on && state === 'turn' ? (time < 0.75 ? 2 : -2) : 0; // left, then back
        return bug.step({ velocity: ahead.clone().multiplyScalar(speed), spin }).root;
      },
      points: () => bug.points(),
    };
  },
};
