/**
 * @file Hovering (PLAN.md WP 10.1, §5.6's floaters: hover, bank, fold): what a floating body does with its height, its
 * lean and its limbs, from how it moves. `Hover` keeps:
 * - **the hover**: its core `height` m over its floor, bobbing `bob` m at `rate` rad/s (the phase integrated) and
 *   rising `rise` m more at full speed (`speed` m/s);
 * - **the bank**: a roll into its sideways motion (the right side down while it moves right), its sideways speed over
 *   `bankSpeed` rad within ±`bankMax`, on a critically damped spring (`Spring1`), so a jolt of velocity never snaps it;
 * - **the lean**: its top trailing its glide, a pitch of its forward speed over `leanSpeed` rad within ±`leanMax`,
 *   about a pivot `pivot` m below its core, on a spring too;
 * - **the fold**: a weight its limbs fold in by, eased toward the target a step gives at `foldRates` a second: a
 *   point of the body comes in by `fold.side` of its sideways reach, `fold.forward` of its forward reach and
 *   `fold.up` of its height off the core.
 * `place(local, floor, yaw)` stands a point of the body (its frame: x left, y up, z forward, from its core) where it
 * is drawn: folded, leaned and banked about the pivot, turned by `yaw`, the hover's height over `floor`.
 *
 * Invariants: metres, radians and seconds; no clock but the steps' and no random stream; at rest (still, unfolded)
 * the bank and the lean are 0, and a point stands at its place over the floor, the bob aside.
 *
 * Carried from `my-3d2dge:src/emberdeep/21-codex.js:46-131, 161-176` (CodexRig: the hover bobbing at 2.8 rad/s and
 * rising with the run, the bank of the sideways speed, the top trailing the glide, the fold's 0.65, 0.35 and 0.76),
 * as mechanisms: there a shear and a linear approach, here a rotation about a low pivot on springs.
 *
 * @example
 * import { Vector3 } from '../../core/math';
 * const ghost = new Hover();
 * for (let i = 0; i < 60; i++) ghost.step(1 / 60, new Vector3(-2, 0, 0), 0); // drifting to its right (−X facing +Z)
 * ghost.bank > 0.1; // true: its right side down into the drift
 * ghost.place(new Vector3(), new Vector3(), 0).y > 0.2; // true: its core over the floor
 * @see engine/anim/proc/hover.test.ts
 */
import { approach, Quaternion, Vector3 } from '../../core/math';
import { Spring1 } from './springs';

/** A hover's numbers (see the file comment); the defaults are a ghost's, a quarter metre up. */
export interface HoveringOptions {
  readonly height?: number;
  readonly bob?: number;
  readonly rate?: number;
  readonly rise?: number;
  readonly speed?: number;
  readonly bankSpeed?: number;
  readonly bankMax?: number;
  readonly leanSpeed?: number;
  readonly leanMax?: number;
  readonly pivot?: number;
  /** The bank's and the lean's springs, rad/s. */
  readonly frequency?: number;
  readonly foldRates?: readonly [number, number];
  readonly fold?: { readonly side: number; readonly forward: number; readonly up: number };
}

const DEFAULTS: Required<HoveringOptions> = {
  height: 0.25,
  bob: 0.044,
  rate: 2.8,
  rise: 0.075,
  speed: 5,
  bankSpeed: 6.9,
  bankMax: 0.5,
  leanSpeed: 36,
  leanMax: 0.3,
  pivot: 0.6,
  frequency: 8,
  foldRates: [15, 9],
  fold: { side: 0.65, forward: 0.35, up: 0.76 },
};

const [LEFT, UP, FORWARD] = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];
const [tilt, part, turn] = [new Quaternion(), new Quaternion(), new Quaternion()];

/** A floating body's hover, bank, lean and fold (see the file comment). */
export class Hover {
  readonly options: Required<HoveringOptions>;
  /** The bob's phase, rad. */
  phase = 0;
  /** How far up it is off its height for its speed, 0 to 1 of `rise`. */
  climb = 0;
  /** How far its limbs are folded in, 0 to 1. */
  fold = 0;
  readonly #bank: Spring1;
  readonly #lean: Spring1;

  /** A hover shaped by `options` (see `HoveringOptions`). */
  constructor(options: HoveringOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.#bank = new Spring1({ frequency: this.options.frequency });
    this.#lean = new Spring1({ frequency: this.options.frequency });
  }

  /** The bank now, rad (its right side down +). */
  get bank(): number {
    return this.#bank.value;
  }

  /** The lean now, rad (its top back, its front up +). */
  get lean(): number {
    return this.#lean.value;
  }

  /** The core's height over its floor now, m. */
  get offset(): number {
    return this.options.height + this.options.bob * Math.sin(this.phase) + this.options.rise * this.climb;
  }

  /** Steps `dt` seconds moving at `velocity` (m/s, world) facing `yaw`, its limbs folding toward `fold` (0 to 1). */
  step(dt: number, velocity: Vector3, yaw: number, fold = 0): this {
    const o = this.options;
    const [s, c] = [Math.sin(yaw), Math.cos(yaw)];
    const [ahead, right] = [velocity.x * s + velocity.z * c, -(velocity.x * c - velocity.z * s)];
    const speed = Math.hypot(velocity.x, velocity.z);
    this.phase += o.rate * dt;
    this.climb = approach(this.climb, Math.min(1, speed / o.speed), 4 * dt);
    this.#bank.step(dt, Math.max(-o.bankMax, Math.min(o.bankMax, right / o.bankSpeed)));
    this.#lean.step(dt, Math.max(-o.leanMax, Math.min(o.leanMax, ahead / o.leanSpeed)));
    this.fold = approach(this.fold, Math.max(0, Math.min(1, fold)), dt * (fold > this.fold ? o.foldRates[0] : o.foldRates[1])); // prettier-ignore
    return this;
  }

  /** The body's turn facing `yaw`: the yaw, then the lean about its right, then the bank about its forward. */
  frame(yaw: number, out = new Quaternion()): Quaternion {
    turn.setFromAxisAngle(UP, yaw);
    tilt.setFromAxisAngle(LEFT, -this.lean).multiply(part.setFromAxisAngle(FORWARD, this.bank));
    return out.copy(turn).multiply(tilt);
  }

  /** Where the body's point `local` (its frame, from its core) is drawn over `floor` facing `yaw` (see the file comment). */ // prettier-ignore
  place(local: Vector3, floor: Vector3, yaw: number, out = new Vector3()): Vector3 {
    const { fold: shares, pivot } = this.options;
    const k = this.fold;
    out.set(local.x * (1 - shares.side * k), local.y * (1 - shares.up * k), local.z * (1 - shares.forward * k));
    out.y += pivot;
    out.applyQuaternion(tilt.setFromAxisAngle(LEFT, -this.lean).multiply(part.setFromAxisAngle(FORWARD, this.bank)));
    out.y -= pivot;
    return out.applyQuaternion(turn.setFromAxisAngle(UP, yaw)).add(floor).addScaledVector(UP, this.offset);
  }
}
