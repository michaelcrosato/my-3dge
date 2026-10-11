/**
 * @file The floater rig (PLAN.md WP 5.3): a hovering body (wisps, ghosts, drones) that banks into its turns, with
 * motes orbiting it. `step(input)` is the sim's part: it eases `state`, plain numbers, one fixed step: the clock, the
 * heading toward the travel (or a given yaw), the bank toward the sideways acceleration, the swell. `hover(y, floor)`
 * gives the sim the vertical speed that holds the body at its height over the floor, bobbing, as my-3d2dge's wisp
 * sets its body's. `pose()` is the view's: from the state alone it writes the core's world matrix and the motes'
 * positions, which a body (WP 5.4) draws.
 *
 * Invariants:
 * - The bank is a roll about the forward axis, positive to the right (the right side drops): it leans into a turn as
 *   an aircraft does, atan(sideways acceleration / `FLOATER.bankAccel`), within ±`bankMax`, through a critically
 *   damped spring, so a jolt of velocity never snaps it.
 * - The motes orbit in the core's frame (its heading and bank), evenly spaced, rising and falling; the swell (a
 *   charge building) grows the core and the orbit up to 1.8 times. The bob is the sim's (`hover`), not the pose's.
 * - A fixed step `dt` (`SIM_DT` by default) and no random stream: the same inputs give the same bits.
 *
 * Carried from `my-3d2dge:src/stress-world/20-sim.js:427-428` (the hover: 20 units over the floor, ±3 at 2 rad/s, a
 * vertical speed of 6 times the gap) and `src/stress-world/30-crowd.js:162-170` (`wispParts`: three motes 6 units
 * out at 4 rad/s, ±2 units at 1.3 times the angle; the charge's swell to 1.8). The heading and the bank are new.
 *
 * @example
 * import { Vector3 } from '../core/math';
 * const wisp = new Floater({ clock: 0 });
 * wisp.hover(0, 0); // 7.5: 1.25 m below its height, it rises at 6 × the gap
 * wisp.step({ velocity: new Vector3(-4, 0, 0) }).state.bank; // ≈ 0.007: a jolt to its right (−X); the spring eases in
 * wisp.pose().motes.length; // 3
 * @see engine/anim/floater.test.ts
 */
import { angDiff, lerpAng, MathUtils, Matrix4, Quaternion, smoothDamp, Vector3 } from '../core/math';
import { SIM_DT } from '../core/time';

/** The floater's tuning: the source's numbers, lengths ÷ 16 in metres, and the bank's. */
export const FLOATER = {
  height: 1.25, // metres over the floor it hovers at (20 units)
  bob: 0.1875, // metres it bobs up and down (3 units)…
  bobRate: 2, // …at this many radians per second
  climb: 6, // per second: its vertical speed is the gap to its height times this
  turnRate: 8, // the share of the way the heading turns toward the travel each second (all of it at most, per step)
  turnMin: 0.25, // m/s: slower, it keeps its heading
  bankAccel: 15, // m/s² sideways that banks it 45°
  bankMax: 0.6, // radians: the most it banks (34°)
  bankTime: 0.2, // seconds the bank's spring takes to settle
  swell: 0.8, // the share the core and the orbit grow by at full swell
  motes: 3, // how many motes orbit it
  orbit: 0.375, // metres from the core to a mote (6 units)…
  orbitRate: 4, // …turning this many radians per second
  rise: 0.125, // metres a mote rises and falls (2 units)…
  riseRate: 1.3, // …at this many times its orbit's angle
} as const;

/** What a floater is made from. */
export interface FloaterOptions {
  /** How many motes orbit it; `FLOATER.motes` by default. */
  motes?: number;
  /** Its heading at first, radians: forward is (sin yaw, 0, cos yaw); 0 by default. */
  yaw?: number;
  /** The bob's and the motes' clock at first, seconds: spread a crowd's phases with the entity's stream; 0 by default. */
  clock?: number;
  /** The fixed step, seconds; `SIM_DT` by default. */
  dt?: number;
}

/** What a floater is told each step; every field is optional. */
export interface FloaterInput {
  /** Where its core is, world metres; kept from the last step when absent. */
  position?: Vector3;
  /** Its velocity, m/s; at rest when absent. The horizontal part turns and banks it. */
  velocity?: Vector3;
  /** The heading to turn to, radians; the direction of travel when absent. */
  yaw?: number;
  /** 0–1: how swollen it is (a charge building); 0 when absent. */
  swell?: number;
}

/** The floater's state: what `step` eases and `pose` reads, plain numbers. */
export interface FloaterState {
  /** Seconds on its clock: the bob and the motes. */
  clock: number;
  /** Its heading, radians in [−π, π). */
  yaw: number;
  /** Its roll about the forward axis, radians, + to the right. */
  bank: number;
  /** The bank's rate, radians per second. */
  bankSpeed: number;
  /** Its last horizontal velocity, m/s: x… */
  vx: number;
  /** …and z. */
  vz: number;
  /** 0–1: how swollen it is. */
  swell: number;
}

/** A floater's pose: the core's world matrix and the motes' world positions. */
export interface FloaterPose {
  /** The core: a unit sphere through it is the body at its swell, turned to its heading and banked. */
  readonly core: Matrix4;
  /** Each mote's centre, world metres. */
  readonly motes: readonly Vector3[];
}

const TAU = Math.PI * 2;
/** Scratch objects. */
const [Y_AXIS, Z_AXIS] = [new Vector3(0, 1, 0), new Vector3(0, 0, 1)];
const [turn, roll, rotation] = [new Quaternion(), new Quaternion(), new Quaternion()];
const size = new Vector3();

/** A floater: its state, its pose. See the file comment. */
export class Floater {
  /** The fixed step, seconds. */
  readonly dt: number;
  /** What `step` eases. */
  readonly state: FloaterState;
  /** Where its core is, world metres. */
  readonly position = new Vector3();
  /** The pose the last `pose()` wrote. */
  readonly joints: FloaterPose;

  /** A floater at the origin, at rest. */
  constructor(options: FloaterOptions = {}) {
    this.dt = options.dt ?? SIM_DT;
    const yaw = angDiff(0, options.yaw ?? 0);
    this.state = { clock: options.clock ?? 0, yaw, bank: 0, bankSpeed: 0, vx: 0, vz: 0, swell: 0 };
    const motes = Array.from({ length: options.motes ?? FLOATER.motes }, () => new Vector3());
    this.joints = { core: new Matrix4(), motes };
    this.pose();
  }

  /** Eases the state one fixed step toward `input`: the sim's part. */
  step(input: FloaterInput = {}): this {
    const { dt, state: s } = this;
    s.clock += dt;
    if (input.position) this.position.copy(input.position);
    const vx = input.velocity?.x ?? 0;
    const vz = input.velocity?.z ?? 0;
    const travel = Math.hypot(vx, vz) > FLOATER.turnMin ? Math.atan2(vx, vz) : s.yaw;
    s.yaw = angDiff(0, lerpAng(s.yaw, input.yaw ?? travel, Math.min(1, dt * FLOATER.turnRate)));
    const sideways = (-(vx - s.vx) * Math.cos(s.yaw) + (vz - s.vz) * Math.sin(s.yaw)) / dt; // along right
    const target = MathUtils.clamp(Math.atan(sideways / FLOATER.bankAccel), -FLOATER.bankMax, FLOATER.bankMax);
    [s.bank, s.bankSpeed] = smoothDamp(s.bank, target, s.bankSpeed, FLOATER.bankTime, dt);
    s.vx = vx;
    s.vz = vz;
    s.swell = MathUtils.clamp(input.swell ?? 0, 0, 1);
    return this;
  }

  /**
   * The vertical speed, m/s, that holds the core at its height over `floor` (world y), bobbing, from its height `y`
   * now: set it on the body each step, after `step`.
   */
  hover(y: number, floor: number): number {
    const want = floor + FLOATER.height + Math.sin(this.state.clock * FLOATER.bobRate) * FLOATER.bob;
    return (want - y) * FLOATER.climb;
  }

  /** Writes and returns the core's matrix and the motes' positions from the state: the view's part. */
  pose(): FloaterPose {
    const { state: s, joints: J } = this;
    const k = 1 + s.swell * FLOATER.swell;
    rotation.multiplyQuaternions(turn.setFromAxisAngle(Y_AXIS, s.yaw), roll.setFromAxisAngle(Z_AXIS, s.bank));
    J.core.compose(this.position, rotation, size.set(k, k, k));
    const orbit = FLOATER.orbit * k;
    for (let i = 0; i < J.motes.length; i++) {
      const a = s.clock * FLOATER.orbitRate + (i * TAU) / J.motes.length;
      J.motes[i].set(Math.cos(a) * orbit, Math.sin(a * FLOATER.riseRate) * FLOATER.rise, Math.sin(a) * orbit);
      J.motes[i].applyQuaternion(rotation).add(this.position);
    }
    return J;
  }
}
