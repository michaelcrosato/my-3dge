/**
 * @file Sway and lag (PLAN.md WP 10.1, §5.6's sway chains and lagging parts): parts that move with the body without
 * driving it.
 * - `SwayChain`: a tail, a ribbon or a fin as a wave travelling down a chain of `count` segments `length` apart,
 *   behind its root along its frame's −Z: segment i turns about the frame's up (`axis: 'side'`, a wag) or its right
 *   (`'up'`, a fish's beat) by `amplitude × i / count × sin(phase − lag × i)`, so the swing grows toward the tip and
 *   lags down the chain, and hangs `droop` rad lower a segment. `step(dt, root, frame, sway, rate)` moves the phase on
 *   by `frequency × rate` (integrated, so a gait's speed changing never jumps it) and scales the swing by `sway` (the
 *   source's `(1 + run)(1 − fall)`). Each segment keeps its length: the wave turns segments, it never stretches them.
 * - `LagPart`: a part hung from a pivot that swings behind the body as it moves and turns (an abdomen, a sack, a
 *   lantern): its tip, `length` from the pivot along the body's `rest` direction for it, follows where the body
 *   would hold it on a spring (`Spring3`), stays `length` from the pivot and strays at most `limit` rad from the rest.
 *
 * Invariants: world space, metres, radians and seconds; no clock but the steps' and no random stream; a chain's
 * points are its root then each joint (count + 1), each segment exactly `length`.
 *
 * Carried from `my-3d2dge:src/emberdeep/22-char-dan.js:127-134` (the tail: a sine travelling down it, .7 rad a segment,
 * growing toward the tip and dropping), shardfall@fa2dab6 `crates/pav_core/src/rig.rs:622-632` (the lizard's spine
 * wave) and `my-3d2dge:src/emberdeep/33-beasts.js:107-108, 179-180` (the crawler's abdomen on a lagging spring), as
 * mechanisms; the source's tail kept no lengths.
 *
 * @example
 * import { Quaternion, Vector3 } from '../../core/math';
 * const tail = new SwayChain({ count: 5, length: 0.12, amplitude: 0.5, frequency: 1.9, lag: 0.7, droop: 0.08 });
 * tail.step(1 / 60, new Vector3(0, 0.6, -0.2), new Quaternion()).length; // 6: the root and five joints
 * tail.points[5].z < -0.6; // true: behind the root along −Z
 * const sack = new LagPart({ length: 0.3, rest: new Vector3(0, -0.5, -1).normalize(), frequency: 9, damping: 0.55 });
 * sack.step(1 / 60, new Vector3(0, 0.5, 0), new Quaternion()).distanceTo(new Vector3(0, 0.5, 0)); // 0.3
 * @see engine/anim/proc/sway.test.ts
 */
import { Quaternion, Vector3 } from '../../core/math';
import { Spring3, type SpringOptions } from './springs';

/** A sway chain's shape (see the file comment). */
export interface SwayOptions {
  /** Its segments. */
  readonly count: number;
  /** Each segment's length, m. */
  readonly length: number;
  /** The tip's swing, rad. */
  readonly amplitude: number;
  /** How fast the wave runs, rad/s. */
  readonly frequency: number;
  /** How far the wave lags a segment down the chain, rad. */
  readonly lag: number;
  /** How much lower each segment hangs than the one before, rad (0). */
  readonly droop?: number;
  /** About which axis it sways: the frame's up (`side`, a wag; the default) or its right (`up`, a beat). */
  readonly axis?: 'side' | 'up';
}

const [UP, RIGHT, BACK] = [new Vector3(0, 1, 0), new Vector3(-1, 0, 0), new Vector3(0, 0, -1)];
const [turn, bend, dir] = [new Quaternion(), new Quaternion(), new Vector3()];

/** A wave down a chain (see the file comment). */
export class SwayChain {
  readonly options: Required<SwayOptions>;
  /** The root, then each joint, world metres. */
  readonly points: Vector3[];
  /** The wave's phase, rad. */
  phase = 0;

  /** A chain shaped by `options`, its wave at phase `phase` (0). */
  constructor(options: SwayOptions, phase = 0) {
    this.options = { droop: 0, axis: 'side', ...options };
    this.points = Array.from({ length: options.count + 1 }, () => new Vector3());
    this.phase = phase;
  }

  /** Steps `dt` seconds: the wave on by `rate` × its frequency, the chain from `root` in `frame`, swung by `sway`. */
  step(dt: number, root: Vector3, frame: Quaternion, sway = 1, rate = 1): Vector3[] {
    const { count, length, amplitude, lag, droop, axis } = this.options;
    this.phase += this.options.frequency * rate * dt;
    this.points[0].copy(root);
    for (let i = 1; i <= count; i++) {
      const swing = amplitude * (i / count) * Math.sin(this.phase - lag * i) * sway;
      turn.setFromAxisAngle(axis === 'side' ? UP : RIGHT, swing);
      bend.setFromAxisAngle(RIGHT, droop * i); // about his right: its tip down, toward −Y
      dir.copy(BACK).applyQuaternion(bend).applyQuaternion(turn).applyQuaternion(frame);
      this.points[i].copy(this.points[i - 1]).addScaledVector(dir, length);
    }
    return this.points;
  }
}

/** A lagging part's shape (see the file comment). */
export interface LagOptions extends SpringOptions {
  /** From the pivot to its tip, m. */
  readonly length: number;
  /** Where the body holds it, a unit direction in the body's frame. */
  readonly rest: Vector3;
}

const [held, along] = [new Vector3(), new Vector3()];

/** A part swinging behind its pivot (see the file comment). */
export class LagPart {
  readonly length: number;
  readonly rest: Vector3;
  /** Where its tip is, and how it moves. */
  readonly tip: Spring3;
  readonly #limit: number;
  #started = false;

  /** A part shaped by `options`; `limit` (0.6 rad by default) bounds its swing from the rest. */
  constructor(options: LagOptions) {
    this.length = options.length;
    this.rest = options.rest.clone().normalize();
    this.#limit = options.limit ?? 0.6;
    this.tip = new Spring3({ frequency: options.frequency ?? 9, damping: options.damping ?? 0.55 });
  }

  /** Steps `dt` seconds from `pivot` in the body's `frame`; returns the tip, world metres. */
  step(dt: number, pivot: Vector3, frame: Quaternion): Vector3 {
    held.copy(this.rest).applyQuaternion(frame);
    const rigid = along.copy(held).multiplyScalar(this.length).add(pivot);
    if (!this.#started) this.tip.reset(rigid); // its first step: where the body holds it, at rest
    this.#started = true;
    this.tip.step(dt, rigid);
    dir.copy(this.tip.value).sub(pivot);
    if (dir.lengthSq() < 1e-18) dir.copy(held);
    dir.normalize();
    const angle = Math.acos(Math.max(-1, Math.min(1, dir.dot(held))));
    if (angle > this.#limit) {
      along.copy(dir).addScaledVector(held, -dir.dot(held)).normalize(); // back within its swing: `limit` from rest
      dir.copy(held).multiplyScalar(Math.cos(this.#limit)).addScaledVector(along, Math.sin(this.#limit));
    }
    const radial = this.tip.velocity.dot(dir);
    this.tip.velocity.addScaledVector(dir, -radial); // on its sphere: no speed along the arm
    return this.tip.value.copy(dir).multiplyScalar(this.length).add(pivot);
  }
}
