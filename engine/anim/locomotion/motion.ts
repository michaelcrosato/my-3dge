/**
 * @file What the playground's movement tells the view's animation (PLAN.md WP 13.10, docs/PLAYGROUND.md §5.1): the
 * shooter model's state (the component `motion`, engine/physics/movement/model.ts: its mode, duck, slide, floor and
 * landing) and the actor's velocity, read on the view's side as plain data, so the animation follows the movement
 * without the sim's animator holding more than it does (its state is hashed; this is presentation, and no replay
 * golden changes).
 * - `plantsFeet(motion)`: whether the foot plant may lock a foot in stance now (engine/anim/footPlant.ts
 *   `FootPlant.locks`): only on the ground and not sliding, so a slide, a jump, a mantle, a climb or a ride never holds
 *   a foot where it stood.
 * - `MovementPose`: the view's own ease of what the body shows (`ShownMovement`, set on `Humanoid.shown` before each
 *   pose and posed by engine/anim/locomotion/shown.ts): the crouch (its duck going down or down) and the slide, the
 *   pelvis tilted to the slope it slides on, the lean into the acceleration and the turn, the rise and the fall by the
 *   vertical speed, and the landing's dip, soft or hard by the speed it lands at, unwinding as the body leaves the
 *   ground again (`MOVEMENT_POSE`).
 *
 * Invariants: `plantsFeet` is pure; a body without a movement model (`motion` absent) plants and stands as it always
 * has; a `MovementPose` keeps only its eased numbers and the last step's velocity and mode, stepped once a sim step by
 * whoever draws the body.
 *
 * @example
 * plantsFeet({ mode: 'ground', sliding: false }); // true
 * plantsFeet({ mode: 'ground', sliding: true }); // false: the slide glides
 * new MovementPose().update({ duck: 'ducked' }, 1 / 60).shown.crouch; // 0.15: easing down at 9 a second
 * @see engine/anim/locomotion/motion.test.ts
 */
import { approach, MathUtils } from '../../core/math';
import type { Animator } from '../character';
import { createShown, type ShownMovement } from './shown';

/** The part of the shooter model's state the animation reads (engine/physics/movement/model.ts `MotionState`). */
export interface MotionView {
  /** On the ground, in the air, mantling, climbing, on a zipline or a ladder, skydiving. */
  readonly mode?: string;
  /** Its duck: standing, going down, down, or getting up. */
  readonly duck?: string;
  /** It slides. */
  readonly sliding?: boolean;
  /** The ground's normal under it after its last move: east, up, south. */
  readonly floorX?: number;
  readonly floorY?: number;
  readonly floorZ?: number;
}

/** The actor's velocity (m/s) and heading (rad), as the sim left them: what the lean and the air read. */
export interface BodyView {
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  readonly yaw: number;
}

/** The view's eases: rates a second, angles in radians, speeds in m/s. */
export const MOVEMENT_POSE = {
  crouch: 9, // the shown crouch's and slide's rates (the humanoid's pose and stance rates)
  slide: 10,
  fall: 8, // the rise's and fall's rate, and the vertical speed that is a full one
  fallSpeed: 8,
  lean: 6, // the lean's rate, and its largest forward and side angles: atan(a / g), halved
  leanMax: 0.2,
  bankMax: 0.3,
  pitch: 6, // the slide's tilt to the slope: its rate and its share of the slope's angle
  pitchShare: 0.6,
  softSpeed: 4, // landing speeds (m/s down): from which it dips, at which the dip is full (a jump's 7.4 under the
  fullSpeed: 8, // playground's 19 m/s² lands soft), from which it turns hard, at which it is all hard (a 5 m fall)
  hardSpeed: 9,
  hardFull: 14,
  landIn: 0.15, // seconds the dip takes to go down, a hard one's hold at the bottom, and its way back up from a soft
  hardHold: 0.3, // and from a hard one (smoothstepped)
  softOut: 0.25,
  hardOut: 0.55,
} as const;

const G = 9.81;

/** Whether the foot plant may lock a foot in stance for a body moving as `motion` says (see the file comment). */
export function plantsFeet(motion: MotionView | null | undefined): boolean {
  return !motion || ((motion.mode ?? 'ground') === 'ground' && motion.sliding !== true);
}

/** The view's eased movement of one body (see the file comment). */
export class MovementPose {
  /** What it shows now. */
  readonly shown: ShownMovement = createShown();
  #last: { vx: number; vz: number; vy: number; mode: string } | null = null;
  /** Seconds into the last landing's dip, how deep it goes and how hard it was (0 to 1); NaN before any. */
  #landing = { time: NaN, depth: 0, hard: 0 };

  /** Eases toward what `motion` and `body` do over `dt` seconds (one sim step); returns itself. */
  update(motion: MotionView | null | undefined, dt: number, body?: BodyView | null): this {
    const P = MOVEMENT_POSE;
    const s = this.shown;
    const down = motion?.duck === 'ducking' || motion?.duck === 'ducked';
    s.crouch = approach(s.crouch, down ? 1 : 0, dt * P.crouch);
    s.slide = approach(s.slide, motion?.sliding === true ? 1 : 0, dt * P.slide);
    const mode = motion?.mode ?? 'ground';
    const last = this.#last;
    if (body) {
      const [fx, fz] = [Math.sin(body.yaw), Math.cos(body.yaw)];
      const [ax, az] = last ? [(body.vx - last.vx) / dt, (body.vz - last.vz) / dt] : [0, 0];
      const lean = MathUtils.clamp(Math.atan((ax * fx + az * fz) / G) / 2, -P.leanMax, P.leanMax);
      const bank = MathUtils.clamp(Math.atan((-ax * fz + az * fx) / G) / 2, -P.bankMax, P.bankMax);
      const grounded = mode === 'ground' && s.slide < 0.5;
      s.lean = approach(s.lean, grounded ? lean : 0, dt * P.lean);
      s.bank = approach(s.bank, grounded ? bank : 0, dt * P.lean);
      s.fall = approach(s.fall, mode === 'air' ? MathUtils.clamp(-body.vy / P.fallSpeed, -1, 1) : 0, dt * P.fall);
      if (last && last.mode === 'air' && mode === 'ground') this.#land(-last.vy);
      const n = [motion?.floorX ?? 0, motion?.floorZ ?? 0];
      const slope = Math.asin(MathUtils.clamp(n[0] * fx + n[1] * fz, -1, 1)); // + downhill ahead
      s.pitch = approach(s.pitch, s.slide * P.pitchShare * slope, dt * P.pitch);
      this.#last = { vx: body.vx, vz: body.vz, vy: body.vy, mode };
    }
    const L = this.#landing;
    L.time += dt;
    if (mode !== 'ground') L.depth = approach(L.depth, 0, dt / P.landIn); // off the ground again: the dip unwinds
    const [hold, out] = [P.landIn + P.hardHold * L.hard, P.softOut + (P.hardOut - P.softOut) * L.hard];
    const dip = !(L.time < hold + out) ? 0 : L.time < P.landIn ? L.time / P.landIn : Math.min(1, 1 - (L.time - hold) / out); // prettier-ignore
    [s.land, s.hard] = [MathUtils.smoothstep(dip, 0, 1) * L.depth, L.hard];
    return this;
  }

  /** Shows it on `animator`'s body, for its next pose. */
  apply(animator: Animator): void {
    Object.assign(animator.body.shown, this.shown);
  }

  /** Starts a landing's dip at `speed` m/s down (see `MOVEMENT_POSE`). */
  #land(speed: number): void {
    const P = MOVEMENT_POSE;
    if (!(speed > P.softSpeed)) return;
    const depth = MathUtils.clamp((speed - P.softSpeed) / (P.fullSpeed - P.softSpeed), 0, 1);
    this.#landing = { time: 0, depth, hard: MathUtils.clamp((speed - P.hardSpeed) / (P.hardFull - P.hardSpeed), 0, 1) };
  }
}
