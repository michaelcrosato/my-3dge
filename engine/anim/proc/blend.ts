/**
 * @file Blends (PLAN.md WP 10.1, §5.6's eased state weights and angle blending): what a procedural rig mixes its
 * poses by.
 * - `StateWeights`: named weights, each easing toward a target its rig sets from what the body does (running, low,
 *   in the air, hurt), linearly at its own rates, up and down (`easeWeight`, engine/anim/weights.ts), so a weight
 *   ramps and stops on its target; a rig reads them into its pose formulas, a product suppressing one by another
 *   (`rear × (1 − fall)`).
 * - `layerPose(base, layers)`: the pose stack: each layer, in order, lerps the values below it toward its own by its
 *   weight, so later layers win (a guard over a ready stance, a swing over both). Plain lerps: angles in a stack do
 *   not wrap, so a pose's own numbers choose the arc it blends along (a blade swept back 171° never blends to a guard
 *   at −70° through the front).
 * - `blendAngles(angles, weights)`: angles averaged round the circle by weight (headings, phases), the short way.
 * - `aimDirection(pitch, yaw)`: the unit direction a pitch (up +) and a yaw (left +, from +Z) point, in a frame
 *   facing +Z (left is +X), as a stack's arm or blade angles turn into a direction.
 *
 * Invariants: pure and plain: no clock, no stream; `StateWeights` keeps each weight within its target's reach of
 * where it was (never past it) and holds a weight with no rate where it is.
 *
 * Carried from `my-3d2dge:src/emberdeep/22-char-dan.js:27, 41-57` (the weights eased up and down, `ease(k, to, up,
 * down)`) and `:101-125` (the pose stack of wrist offsets, pitches and yaws, `pose(w, p, y, k)`), and
 * `src/emberdeep/33-beasts.js:84, 105` (one rate per weight), as mechanisms.
 *
 * @example
 * const body = new StateWeights({ run: 5, low: [14, 7], fall: [2.2, 3] });
 * body.aim({ run: 1 }).step(0.1).get('run'); // 0.5: 5 a second, 0.1 s in
 * layerPose([0, 0], [{ values: [1, 2], weight: 0.5 }, { values: [4, 0], weight: 1 }]); // [4, 0]: the last wins whole
 * blendAngles([Math.PI - 0.1, -Math.PI + 0.1], [1, 1]); // ≈ π: round the back, not through 0
 * aimDirection(0, Math.PI / 2).x; // 1: a quarter turn left, +X facing +Z
 * @see engine/anim/proc/blend.test.ts
 */
import { Vector3 } from '../../core/math';
import { easeWeight, type WeightRates } from '../weights';

/** A weight's rates, per second: one for both ways, or `[up, down]`. */
export type BlendRates = number | WeightRates;

/** Named weights easing toward their targets (see the file comment). */
export class StateWeights<K extends string> {
  /** The weights now, by name. */
  readonly weights: Record<K, number>;
  /** What each weight eases toward, 0 to 1. */
  readonly targets: Record<K, number>;
  readonly #rates: Record<K, WeightRates>;

  /** Weights named by `rates` (each its rates, per second), at `start`'s values (0), aiming at them. */
  constructor(rates: Readonly<Record<K, BlendRates>>, start: Readonly<Partial<Record<K, number>>> = {} as never) {
    const names = Object.keys(rates) as K[];
    this.#rates = Object.fromEntries(names.map((k) => [k, typeof rates[k] === 'number' ? [rates[k], rates[k]] : rates[k]])) as Record<K, WeightRates>; // prettier-ignore
    this.weights = Object.fromEntries(names.map((k) => [k, start[k] ?? 0])) as Record<K, number>;
    this.targets = { ...this.weights };
  }

  /** Sets the targets `targets` names (each clamped to 0 to 1); the others keep theirs. */
  aim(targets: Readonly<Partial<Record<K, number>>>): this {
    for (const k of Object.keys(targets) as K[]) {
      if (k in this.targets) this.targets[k] = Math.max(0, Math.min(1, targets[k] ?? 0));
    }
    return this;
  }

  /** Eases every weight `dt` seconds toward its target at its rates. */
  step(dt: number): this {
    for (const k of Object.keys(this.weights) as K[]) {
      this.weights[k] = easeWeight(this.weights[k], this.targets[k], this.#rates[k], dt);
    }
    return this;
  }

  /** Weight `k`. */
  get(k: K): number {
    return this.weights[k];
  }

  /** Sets every weight on its target at once (a rig placed, a state loaded). */
  settle(): this {
    Object.assign(this.weights, this.targets);
    return this;
  }
}

/** A layer of the pose stack: its values and how much of them it takes, 0 to 1. */
export interface PoseLayer {
  readonly values: readonly number[];
  readonly weight: number;
}

/** `base` with each of `layers`, in order, lerped over it by its weight (see the file comment); into `out`. */
export function layerPose(base: readonly number[], layers: readonly PoseLayer[], out: number[] = []): number[] {
  for (let i = 0; i < base.length; i++) out[i] = base[i];
  out.length = base.length;
  for (const { values, weight } of layers) {
    if (weight <= 0) continue;
    const k = Math.min(1, weight);
    for (let i = 0; i < out.length; i++) out[i] += ((values[i] ?? out[i]) - out[i]) * k;
  }
  return out;
}

/** The weighted mean of `angles` (rad) round the circle, in (−π, π]; `fallback` when they cancel out. */
export function blendAngles(angles: readonly number[], weights: readonly number[], fallback = 0): number {
  let [s, c] = [0, 0];
  angles.forEach((a, i) => {
    s += Math.sin(a) * (weights[i] ?? 0);
    c += Math.cos(a) * (weights[i] ?? 0);
  });
  return Math.hypot(s, c) < 1e-12 ? fallback : Math.atan2(s, c);
}

/** The unit direction of `pitch` (up +) and `yaw` (left +, from +Z) in a frame facing +Z, into `out`. */
export function aimDirection(pitch: number, yaw: number, out = new Vector3()): Vector3 {
  return out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
}
