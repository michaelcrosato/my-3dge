/**
 * @file Orbiters and detached parts (PLAN.md WP 10.1, §5.6's orbiters and detached parts): parts that float about a
 * body with no chain to it.
 * - `Orbiters`: `count` parts evenly spaced round a ring of `radius` about a centre, in the plane of its frame's
 *   forward and left, going round at `rate` rad/s, each rising and falling `bob` m at `bobRate` rad/s on a phase of
 *   its own. `step(dt, centre, frame, rate, radius)` integrates the angle, so a change of rate (a dash spinning them
 *   up) never jumps them, and eases the radius at `ease` a second (a flare spreading them out).
 * - `DetachedPart`: a part following a spot of the body (a floating hand, a mask, a shield) on a spring (`Spring3`),
 *   so it trails as the body moves and catches up, drifting `sway` m about its spot at `swayRate` rad/s when still.
 *
 * Invariants: world space, metres, radians and seconds; no clock but the steps' and no random stream; orbiters stay
 * evenly spaced and exactly `radius` (as eased) from the centre in its plane, the bob aside.
 *
 * Carried from `my-3d2dge:src/emberdeep/21-codex.js:101-130, 337-382` (CodexRig's leaves, three round it bobbing on
 * their own phases, and its gauntlets with no arm chain) and shardfall@fa2dab6 `crates/pav_core/src/parts.rs:190-201`
 * (orbs on a ring), as mechanisms: the source's angle was time × rate, which jumped when its rate changed.
 *
 * @example
 * import { Quaternion, Vector3 } from '../../core/math';
 * const leaves = new Orbiters({ count: 3, radius: 0.75, rate: 0.9 });
 * leaves.step(1 / 60, new Vector3(0, 1, 0), new Quaternion()).length; // 3
 * leaves.points[0].distanceTo(new Vector3(0, 1, 0)) >= 0.75; // true: on its ring, its bob aside
 * const hand = new DetachedPart({ frequency: 10, damping: 0.8 });
 * hand.step(1 / 60, new Vector3(0.3, 1, 0.2)).x; // ≈ 0.3: its first step on its spot
 * @see engine/anim/proc/orbit.test.ts
 */
import { approach, Quaternion, Vector3 } from '../../core/math';
import { Spring3, type SpringOptions } from './springs';

const drift = new Vector3();

/** A ring of orbiters (see the file comment). */
export interface OrbitOptions {
  readonly count: number;
  readonly radius: number;
  readonly rate: number;
  readonly bob?: number;
  readonly bobRate?: number;
  /** How fast the radius eases to a new one, m/s (1). */
  readonly ease?: number;
}

/** Orbiters round a centre (see the file comment). */
export class Orbiters {
  readonly options: Required<OrbitOptions>;
  /** Each orbiter, world metres. */
  readonly points: Vector3[];
  /** The ring's angle, rad. */
  angle = 0;
  /** The ring's radius now, m. */
  radius: number;
  #time = 0;

  /** A ring shaped by `options`. */
  constructor(options: OrbitOptions) {
    this.options = { bob: 0.19, bobRate: 1.35, ease: 1, ...options };
    this.points = Array.from({ length: options.count }, () => new Vector3());
    this.radius = options.radius;
  }

  /** Steps `dt` seconds round `centre` in `frame`, at `rate` rad/s and toward `radius` m (the ring's own). */
  step(
    dt: number,
    centre: Vector3,
    frame: Quaternion,
    rate = this.options.rate,
    radius = this.options.radius,
  ): Vector3[] {
    const { count, bob, bobRate, ease } = this.options;
    this.angle += rate * dt;
    this.#time += dt;
    this.radius = approach(this.radius, radius, ease * dt);
    this.points.forEach((p, i) => {
      const a = this.angle + (i * 2 * Math.PI) / count;
      const lift = bob * Math.sin(bobRate * this.#time + i * 1.7);
      p.set(this.radius * Math.sin(a), lift, this.radius * Math.cos(a))
        .applyQuaternion(frame)
        .add(centre);
    });
    return this.points;
  }
}

/** A detached part's spring and its drift (see the file comment). */
export interface DetachedOptions extends SpringOptions {
  /** How far it drifts about its spot when still, m (0.02). */
  readonly sway?: number;
  /** How fast it drifts, rad/s (1.7). */
  readonly swayRate?: number;
}

/** A part following a spot of the body with no chain to it (see the file comment). */
export class DetachedPart {
  readonly part: Spring3;
  readonly sway: number;
  readonly swayRate: number;
  #time = 0;
  #started = false;
  readonly #at = new Vector3();

  /** A part on a spring shaped by `options` (10 rad/s, 0.8 damped by default). */
  constructor(options: DetachedOptions = {}) {
    this.part = new Spring3({ frequency: options.frequency ?? 10, damping: options.damping ?? 0.8, limit: options.limit }); // prettier-ignore
    [this.sway, this.swayRate] = [options.sway ?? 0.02, options.swayRate ?? 1.7];
  }

  /** Steps `dt` seconds after `spot` (world); returns where the part is. */
  step(dt: number, spot: Vector3): Vector3 {
    this.#time += dt;
    const t = this.#time * this.swayRate;
    drift.set(Math.sin(t), Math.sin(1.3 * t + 1), Math.cos(0.7 * t)).multiplyScalar(this.sway);
    this.#at.copy(spot).add(drift);
    if (!this.#started) this.part.reset(spot);
    this.#started = true;
    return this.part.step(dt, this.#at);
  }
}
