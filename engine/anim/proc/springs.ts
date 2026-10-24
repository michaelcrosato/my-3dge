/**
 * @file Springs (PLAN.md WP 10.1, §5.6's critically damped springs): `Spring1`, `Spring3` and `SpringQuat` pull a
 * number, a vector or a turn toward a target as a damped oscillator of natural frequency `frequency` (rad/s) and
 * damping ratio `damping` (1 by default: critically damped, the quickest settle without overshoot; below 1 it bounces,
 * as a squash or a flinch does), and `kick` jolts its velocity (a landing, a hit). Each step is the oscillator's exact
 * solution over the step (`oscillate`), not an integrator's, so 60 and 120 steps a second settle alike to rounding and
 * no frequency is too stiff for its step. `limit` bounds how far the value strays from its target (the velocity runs
 * on, as the sources' squash springs do). `SpringQuat` springs a turn's error from its target as a rotation vector
 * (the log of value · target⁻¹, the short way round), its velocity in radians a second about the world's axes.
 *
 * Invariants: plain state (`value`, `velocity`, `target`), no clock and no random stream; a step of 0 changes
 * nothing; `SpringQuat`'s value stays a unit quaternion.
 *
 * Carried from `my-3d2dge:src/emberdeep/22-char-dan.js:61-64` (the scythes' spring: K 900 and 2√K, critically damped,
 * so 30 rad/s) and `src/emberdeep/33-beasts.js:96, 106` (the crawler's squash: 240 and 14 within ±0.35, its kick
 * ×0.6), as the oscillator they integrate. The vector and the turn are new: neither source has one.
 *
 * @example
 * import { Quaternion, Vector3 } from '../../core/math';
 * const scythe = new Spring1({ frequency: 30, target: 1 }); // the source's K 900
 * for (let i = 0; i < 13; i++) scythe.step(1 / 60);
 * scythe.value; // ≈ 0.989: within about 1 % after 0.22 s
 * const squash = new Spring1({ frequency: 15.5, damping: 0.45, limit: 0.35 });
 * squash.kick(3).step(1 / 60); // ≈ 0.044: the jolt stretches it, and it will bounce back past 0
 * const head = new SpringQuat({ frequency: 12 });
 * head.target.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
 * head.step(0.5).angleTo(head.target); // ≈ 0.027 rad from it, as 30 steps of 1/60 s leave it
 * @see engine/anim/proc/springs.test.ts
 */
import { Quaternion, Vector3 } from '../../core/math';

/** A spring's shape: its natural frequency (rad/s), its damping ratio (1: critical) and how far it may stray. */
export interface SpringOptions {
  /** Its natural frequency, rad/s (30 by default: the source's K 900). */
  readonly frequency?: number;
  /** Its damping ratio: 1 (the default) critically damped, below 1 bouncing, above 1 sluggish. */
  readonly damping?: number;
  /** The most its value strays from its target (a number, metres or radians); none by default. */
  readonly limit?: number;
}

/**
 * One exact step of the oscillator y″ = −ω²y − 2ζωy′ from offset `y` and velocity `v` over `dt` seconds, with ω
 * `omega` and ζ `zeta`: the offset and the velocity after it.
 */
export function oscillate(y: number, v: number, omega: number, zeta: number, dt: number): [number, number] {
  if (dt <= 0 || omega <= 0) return [y, v];
  const a = zeta * omega;
  const decay = Math.exp(-a * dt);
  if (zeta < 1 - 1e-9) {
    const wd = omega * Math.sqrt(1 - zeta * zeta);
    const [c, s] = [Math.cos(wd * dt), Math.sin(wd * dt)];
    return [decay * (y * c + ((v + a * y) / wd) * s), decay * (v * c - ((a * v + omega * omega * y) / wd) * s)];
  }
  if (zeta <= 1 + 1e-9) {
    const k = v + omega * y;
    return [decay * (y + k * dt), decay * (v - omega * k * dt)];
  }
  const root = omega * Math.sqrt(zeta * zeta - 1);
  const [r1, r2] = [-a + root, -a - root];
  const c2 = (v - r1 * y) / (r2 - r1);
  const c1 = y - c2;
  const [e1, e2] = [Math.exp(r1 * dt), Math.exp(r2 * dt)];
  return [c1 * e1 + c2 * e2, c1 * r1 * e1 + c2 * r2 * e2];
}

/** A number on a spring (see the file comment). */
export class Spring1 {
  value: number;
  velocity = 0;
  target: number;
  readonly frequency: number;
  readonly damping: number;
  readonly limit: number;

  /** A spring at `value` (0), its target `target` (the value); `options` shape it. */
  constructor(options: SpringOptions & { readonly value?: number; readonly target?: number } = {}) {
    this.value = options.value ?? 0;
    this.target = options.target ?? this.value;
    [this.frequency, this.damping, this.limit] = [options.frequency ?? 30, options.damping ?? 1, options.limit ?? Infinity]; // prettier-ignore
  }

  /** Adds `velocity` (units a second) to its velocity: a jolt. */
  kick(velocity: number): this {
    this.velocity += velocity;
    return this;
  }

  /** Steps `dt` seconds toward `target` (the one it has); returns the value. */
  step(dt: number, target = this.target): number {
    this.target = target;
    const [y, v] = oscillate(this.value - target, this.velocity, this.frequency, this.damping, dt);
    [this.value, this.velocity] = [target + Math.max(-this.limit, Math.min(this.limit, y)), v];
    return this.value;
  }

  /** Puts it at rest at `value` (its target). */
  reset(value = this.target): this {
    [this.value, this.velocity] = [value, 0];
    return this;
  }
}

/** A vector on a spring, each axis its own oscillator of the same shape; `limit` bounds its distance from the target. */
export class Spring3 {
  readonly value: Vector3;
  readonly velocity = new Vector3();
  readonly target: Vector3;
  readonly frequency: number;
  readonly damping: number;
  readonly limit: number;

  /** A spring at `value` (the origin), its target `target` (the value); `options` shape it. */
  constructor(options: SpringOptions & { readonly value?: Vector3; readonly target?: Vector3 } = {}) {
    this.value = options.value?.clone() ?? new Vector3();
    this.target = options.target?.clone() ?? this.value.clone();
    [this.frequency, this.damping, this.limit] = [options.frequency ?? 30, options.damping ?? 1, options.limit ?? Infinity]; // prettier-ignore
  }

  /** Adds `velocity` (m/s) to its velocity: a jolt. */
  kick(velocity: Vector3): this {
    this.velocity.add(velocity);
    return this;
  }

  /** Steps `dt` seconds toward `target` (the one it has); returns the value. */
  step(dt: number, target: Vector3 = this.target): Vector3 {
    if (target !== this.target) this.target.copy(target);
    for (const axis of ['x', 'y', 'z'] as const) {
      const [y, v] = oscillate(this.value[axis] - this.target[axis], this.velocity[axis], this.frequency, this.damping, dt); // prettier-ignore
      [this.value[axis], this.velocity[axis]] = [this.target[axis] + y, v];
    }
    const off = this.value.distanceTo(this.target);
    if (off > this.limit)
      this.value
        .sub(this.target)
        .multiplyScalar(this.limit / off)
        .add(this.target);
    return this.value;
  }

  /** Puts it at rest at `value` (its target). */
  reset(value: Vector3 = this.target): this {
    this.value.copy(value);
    this.velocity.set(0, 0, 0);
    return this;
  }
}

const [error, turn] = [new Vector3(), new Quaternion()];

/** `q`'s rotation vector (axis × angle, the short way round) into `out`. */
export function quatLog(q: Quaternion, out: Vector3): Vector3 {
  const s = Math.hypot(q.x, q.y, q.z);
  if (s < 1e-12) return out.set(2 * q.x, 2 * q.y, 2 * q.z);
  const angle = 2 * Math.atan2(s, Math.abs(q.w));
  return out.set(q.x, q.y, q.z).multiplyScalar(((q.w < 0 ? -1 : 1) * angle) / s);
}

/** The turn of rotation vector `v` (axis × angle) into `out`. */
export function quatExp(v: Vector3, out: Quaternion): Quaternion {
  const angle = v.length();
  if (angle < 1e-12) return out.set(v.x / 2, v.y / 2, v.z / 2, 1).normalize();
  const s = Math.sin(angle / 2) / angle;
  return out.set(v.x * s, v.y * s, v.z * s, Math.cos(angle / 2));
}

/** A turn on a spring: its error from the target as a rotation vector (see the file comment). */
export class SpringQuat {
  readonly value: Quaternion;
  /** Its angular velocity, rad/s about the world's axes. */
  readonly velocity = new Vector3();
  readonly target: Quaternion;
  readonly frequency: number;
  readonly damping: number;
  readonly limit: number;

  /** A spring at `value` (no turn), its target `target` (the value); `limit` bounds the error's angle (rad). */
  constructor(options: SpringOptions & { readonly value?: Quaternion; readonly target?: Quaternion } = {}) {
    this.value = options.value?.clone() ?? new Quaternion();
    this.target = options.target?.clone() ?? this.value.clone();
    [this.frequency, this.damping, this.limit] = [options.frequency ?? 30, options.damping ?? 1, options.limit ?? Infinity]; // prettier-ignore
  }

  /** Adds `velocity` (rad/s about the world's axes) to its angular velocity: a jolt. */
  kick(velocity: Vector3): this {
    this.velocity.add(velocity);
    return this;
  }

  /** Steps `dt` seconds toward `target` (the one it has); returns the value. */
  step(dt: number, target: Quaternion = this.target): Quaternion {
    if (target !== this.target) this.target.copy(target);
    quatLog(turn.copy(this.target).invert().premultiply(this.value), error);
    for (const axis of ['x', 'y', 'z'] as const) {
      [error[axis], this.velocity[axis]] = oscillate(error[axis], this.velocity[axis], this.frequency, this.damping, dt); // prettier-ignore
    }
    const angle = error.length();
    if (angle > this.limit) error.multiplyScalar(this.limit / angle);
    this.value.copy(quatExp(error, turn)).multiply(this.target).normalize();
    return this.value;
  }

  /** Puts it at rest at `value` (its target). */
  reset(value: Quaternion = this.target): this {
    this.value.copy(value);
    this.velocity.set(0, 0, 0);
    return this;
  }
}
