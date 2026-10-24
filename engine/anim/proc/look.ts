/**
 * @file Looking and blinking (PLAN.md WP 10.1, §5.6's look-at and blink): what a creature's eye or head does.
 * - `LookAt`: a unit direction turning toward what it looks at (none: the frame's forward), the angle left shrinking by
 *   e^(−`rate` × dt) each step about the axis between them, so any step count turns it alike and a target straight
 *   behind still turns it (about the frame's up). `yaw` and `pitch` bound how far from the frame's forward it may
 *   look (left and right, up and down); `angles(frame)` is the look in the frame, for a head or an eye joint.
 * - `Blink`: an eye that blinks every `every` seconds (between its two numbers, drawn from the stream it is given),
 *   closing and opening on a half sine over `close` seconds; `step(dt, hold)` returns how open it is, 1 open, and
 *   skips the blinks due while `hold` (a charge, a stare) without putting them off.
 *
 * Invariants: world space; the look stays unit; `Blink` draws only from the stream it is handed (a rig's own, named:
 * `w.rng.entity(id, 'blink')`, or a seeded `Rng`), one number a blink, so the same stream blinks alike.
 *
 * Carried from `my-3d2dge:src/emberdeep/33-beasts.js:863, 870-875, 887-895` (`BST_Eye`: the look eased at 7 a
 * second, the blink 1.5 to 5 s apart, 0.16 s on a half sine, skipped while charging), as mechanisms; the source's
 * look had no bounds and stuck on a target straight behind it, and drew its blinks from `Math.random`.
 *
 * @example
 * import { Quaternion, Vector3 } from '../../core/math';
 * import { Rng } from '../../core/rng';
 * const eye = new LookAt({ rate: 7, yaw: 1.2, pitch: 0.6 });
 * eye.step(0.1, new Vector3(0, 1, 0), new Vector3(3, 1, 3), new Quaternion()).x > 0.2; // true: turning left toward it
 * const lid = new Blink(new Rng(7), { every: [1.5, 5], close: 0.16 });
 * lid.step(1 / 60); // 1: open until its first blink
 * @see engine/anim/proc/look.test.ts
 */
import { Quaternion, Vector3 } from '../../core/math';

/** A look's bounds and speed (see the file comment). */
export interface LookAtOptions {
  /** How fast it turns, per second: the angle left shrinks by e^(−rate) a second (7). */
  readonly rate?: number;
  /** How far left or right of the frame's forward it may look, rad (π: anywhere). */
  readonly yaw?: number;
  /** How far up or down, rad (π / 2). */
  readonly pitch?: number;
}

const [FORWARD, UP] = [new Vector3(0, 0, 1), new Vector3(0, 1, 0)];
const [wanted, axis, local] = [new Vector3(), new Vector3(), new Vector3()];
const [inverse, spin] = [new Quaternion(), new Quaternion()];

/** A look turning toward what it looks at (see the file comment). */
export class LookAt {
  /** Where it looks, world, unit. */
  readonly direction = new Vector3(0, 0, 1);
  readonly rate: number;
  readonly yaw: number;
  readonly pitch: number;

  /** A look along +Z, bounded and paced by `options`. */
  constructor(options: LookAtOptions = {}) {
    [this.rate, this.yaw, this.pitch] = [options.rate ?? 7, options.yaw ?? Math.PI, options.pitch ?? Math.PI / 2];
  }

  /** Steps `dt` seconds from `from` toward `target` (null: the frame's forward) in `frame`; returns the look. */
  step(dt: number, from: Vector3, target: Vector3 | null, frame: Quaternion): Vector3 {
    if (target) wanted.subVectors(target, from);
    if (!target || wanted.lengthSq() < 1e-12) wanted.copy(FORWARD).applyQuaternion(frame);
    inverse.copy(frame).invert();
    local.copy(wanted).normalize().applyQuaternion(inverse);
    const yaw = Math.max(-this.yaw, Math.min(this.yaw, Math.atan2(local.x, local.z)));
    const pitch = Math.max(-this.pitch, Math.min(this.pitch, Math.asin(Math.max(-1, Math.min(1, local.y)))));
    wanted
      .set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
      .applyQuaternion(frame);
    const angle = Math.acos(Math.max(-1, Math.min(1, this.direction.dot(wanted))));
    if (angle < 1e-12) return this.direction.copy(wanted);
    axis.crossVectors(this.direction, wanted);
    if (axis.lengthSq() < 1e-18) axis.copy(UP).applyQuaternion(frame); // straight behind: turn about the frame's up
    spin.setFromAxisAngle(axis.normalize(), angle * (1 - Math.exp(-this.rate * dt)));
    return this.direction.applyQuaternion(spin).normalize();
  }

  /** The look in `frame`: its yaw (left +) and pitch (up +), rad. */
  angles(frame: Quaternion): [number, number] {
    local.copy(this.direction).applyQuaternion(inverse.copy(frame).invert());
    return [Math.atan2(local.x, local.z), Math.asin(Math.max(-1, Math.min(1, local.y)))];
  }
}

/** A blink's timing (see the file comment). */
export interface BlinkOptions {
  /** The shortest and the longest time between blinks, s (1.5 to 5). */
  readonly every?: readonly [number, number];
  /** How long a blink takes, closing and opening, s (0.16). */
  readonly close?: number;
}

/** An eye that blinks (see the file comment). */
export class Blink {
  readonly every: readonly [number, number];
  readonly close: number;
  /** Seconds to the next blink; below 0, how far into one (negated). */
  timer: number;
  /** How open it is, 0 shut to 1 open. */
  open = 1;
  readonly #stream: { next(): number };

  /** An eye drawing its blinks from `stream` (a named one: see the file comment). */
  constructor(stream: { next(): number }, options: BlinkOptions = {}) {
    [this.every, this.close, this.#stream] = [options.every ?? [1.5, 5], options.close ?? 0.16, stream];
    this.timer = this.#draw();
  }

  /** Steps `dt` seconds; with `hold`, a blink due is skipped. Returns how open it is. */
  step(dt: number, hold = false): number {
    this.timer -= dt;
    if (this.timer < -this.close) this.timer = this.#draw() + (this.timer + this.close); // the next, from when this ended
    const shut = this.timer < 0 && !hold ? Math.sin((Math.PI * -this.timer) / this.close) : 0;
    this.open = 1 - Math.max(0, shut);
    return this.open;
  }

  /** The time to the next blink, from the stream. */
  #draw(): number {
    return this.every[0] + this.#stream.next() * (this.every[1] - this.every[0]);
  }
}
