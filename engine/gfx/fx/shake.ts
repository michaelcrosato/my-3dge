/**
 * @file Screen shake (PLAN.md WP 6.4, §6.4: camera only): `ScreenShake` keeps an amplitude in metres that hits and
 * explosions add to (capped at `SHAKE.max`) and that dies away by `exp(−9 t)`; `apply(camera)` moves the camera along
 * its own right and up by two sums of sines of the presentation time, and `restore(camera)` takes the move back, so
 * the view places the camera, applies the shake, draws, and restores. With `reduced` (the player asked for reduced
 * motion) nothing is added.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:1568, 1694, 1719-1720` (`shake`: added, capped at 10 units, `exp(−9 t)`,
 * the offsets `(sin 83t + sin 57.3t) / 2` across and `(sin 71t + sin 49.7t) / 2` down, nothing below 0.05 units) and
 * `src/stress-world/40-cameras.js:124-129` (0.0125 m a unit on a 3D camera, along its right and up).
 *
 * Invariants: presentation only: it moves only the camera it is given, and never reaches the sim, the hash or a
 * random stream; `restore` after `apply` leaves the camera where it was.
 *
 * @example
 * const shake = new ScreenShake();
 * shake.add(0.03);
 * shake.update(1 / 60);
 * shake.amount; // ≈ 0.026 m: dying away
 * @see engine/gfx/fx/shake.test.ts
 */
import { Vector3, type Camera } from 'three/webgpu';

/** The shake's tuning: the 2D engine's, in metres. */
export const SHAKE = {
  max: 0.125, // the most it shakes (10 units)
  decay: 9, // per second
  still: 0.000625, // under this (0.05 units) it does not move the camera
} as const;

/** Camera shake: see the file comment. */
export class ScreenShake {
  /** The amplitude now (m). */
  amount = 0;
  /** Presentation time (s), advanced by `update`. */
  time = 0;
  /** Whether shake is off (reduced motion). */
  reduced = false;
  readonly #moved = new Vector3();

  /** Adds `amount` metres (nothing when reduced), capped at `SHAKE.max`. */
  add(amount: number): void {
    if (this.reduced || !(amount > 0)) return;
    this.amount = Math.min(SHAKE.max, this.amount + amount);
  }

  /** Lets `dt` seconds pass: the amplitude dies away. */
  update(dt: number): void {
    this.time += dt;
    this.amount *= Math.exp(-SHAKE.decay * dt);
    if (this.amount < 1e-6) this.amount = 0;
  }

  /** The offset now (m): across (along the camera's right) and down (against its up). */
  offset(): [across: number, down: number] {
    if (this.amount <= SHAKE.still) return [0, 0];
    const t = this.time;
    return [
      (Math.sin(t * 83) + Math.sin(t * 57.3)) * 0.5 * this.amount,
      (Math.sin(t * 71) + Math.sin(t * 49.7)) * 0.5 * this.amount,
    ];
  }

  /** Moves `camera` by the offset, along its own right and up (its world matrix as last updated). */
  apply(camera: Camera): void {
    const [across, down] = this.offset();
    const e = camera.matrixWorld.elements;
    this.#moved.set(e[0], e[1], e[2]).normalize().multiplyScalar(across);
    this.#moved.addScaledVector(new Vector3(e[4], e[5], e[6]).normalize(), -down);
    camera.position.add(this.#moved);
    camera.updateMatrixWorld();
  }

  /** Takes back what the last `apply` moved. */
  restore(camera: Camera): void {
    camera.position.sub(this.#moved);
    this.#moved.set(0, 0, 0);
    camera.updateMatrixWorld();
  }
}
