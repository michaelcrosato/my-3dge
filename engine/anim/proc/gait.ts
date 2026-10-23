/**
 * @file The planted gait for N legs (PLAN.md WP 10.1, §5.6's multi-leg planted gait): `LegGait` keeps each foot of a
 * creature planted where it stood until it strays too far from where the body wants it, then steps it there in an arc.
 * Each leg (`GaitLeg`) has a hip and a rest spot in the body's frame (x left, y up, z forward; the rest spot on the
 * ground under the body's origin) and a group: the feet of one group step together, and none starts while a foot of
 * another group is in the air, so groups alternate (two diagonals trot, two tripods walk an insect).
 * - **When a foot steps**: a planted foot steps once it lies farther than the threshold from its rest spot (turned by
 *   the body's yaw, `lead` seconds ahead along its velocity), measured across the ground: `base` plus `perSpeed` a
 *   metre a second of the body's speed (a fast body strides farther), `still` while it stands (slower than `stand`
 *   m/s: it squares its feet up when it stops). Past `force` moving thresholds (`base` and its speed's share, even
 *   standing) a foot steps whatever the others do (a sharp turn, a shove), so a body turning in place alternates too.
 * - **The step**: `0.75 ×` the threshold over the speed (within `stepTime`'s bounds) long; it aims at the spot it
 *   measured from carried `0.35` of the step further, found again every step (so a fast foot lands ahead of where it
 *   measures, not behind it), eased in and out, lifted `lift` (more when faster) at its middle on a half sine.
 * - **Where a foot stands** (`GaitProbe`, the world's raycast): where a ray down from above the spot meets the ground;
 *   or, when a wall stands between the hip and the spot, on the wall's face where the ray from the hip meets it (a
 *   spider's leg gripping it). Without a probe, the spot itself.
 * - `fly(dt)` tucks every foot under its hip while the body is in the air; the next `step` lands each under the body as
 *   that step finds it. `plant` stands every foot on its spot (the first step does); `save`, `load`: plain `GaitState`.
 * - `lifting()`: how much of its weight is off its feet (Σ sin πt over the feet stepping), for a bob; `tilt()`: its
 *   pitch and roll from every foot's height (as shardfall's: one mid-step lifts its side), as uneven ground leans it.
 *
 * Invariants: world space, metres, seconds; waiting feet start the farthest from their spots first (by the millimetre,
 * the first leg breaking a tie), every count taken as feet start; inner steps of `GAIT_SUBSTEP` (1/120 s), aground and
 * aloft, the body's place, heading and velocity moving on linearly between steps, so 60 and 120 steps a second take
 * the same decisions for a body moving so; no clock, no random stream.
 *
 * Carried from `my-3d2dge:src/emberdeep/33-beasts.js:81-153, 238-244` (`BST_Crawler`: the groups, the threshold
 * growing with speed, the step's length, the lead, the arc and the wall grip; there its tiles, here a raycast) and
 * shardfall@fa2dab6 `crates/pav_core/src/rig.rs:295-450` (the tuck in the air, the tilt from the feet), as mechanisms.
 *
 * @example
 * import { Vector3 } from '../../core/math';
 * const legs = [-1, 1].flatMap((side) => [0.3, -0.3].map((z) => ({ hip: [0.12 * side, 0.4, z], rest: [0.15 * side, 0, z], group: (side > 0) === (z > 0) ? 0 : 1 }) as const)); // prettier-ignore
 * const dog = new LegGait({ legs });
 * const body = { position: new Vector3(), yaw: 0, velocity: new Vector3(0, 0, 1.2) };
 * for (let i = 0; i < 60; i++) dog.step(1 / 60, { ...body, position: body.position.addScaledVector(body.velocity, 1 / 60) }); // prettier-ignore
 * dog.lifted() <= 2; // true: one diagonal in the air at a time
 * @see engine/anim/proc/gait.test.ts
 */
import { ease, lerpAng, Vector3 } from '../../core/math';
import type { GroundHit } from '../ik';

/** A leg of a gait (see the file comment): its hip and its foot's rest spot in the body's frame, m, and its group. */
export interface GaitLeg {
  readonly hip: readonly [number, number, number];
  readonly rest: readonly [number, number, number];
  readonly group: number;
}

/** A gait's numbers (see the file comment); each has a default for a body about half a metre high. */
export interface GaitOptions {
  readonly legs: readonly GaitLeg[];
  /** How far a planted foot strays before it steps, moving: `base` m, `perSpeed` m more per m/s, up to `maxSpeed`. */
  readonly threshold?: {
    readonly base: number;
    readonly perSpeed: number;
    readonly maxSpeed: number;
    /** The threshold while the body stands, m (its feet squared up), and the speed below which it stands, m/s. */
    readonly still: number;
    readonly stand: number;
  };
  /** A step's bounds, s, and the slowest speed its length reckons with, m/s. */
  readonly stepTime?: { readonly min: number; readonly max: number; readonly speed: number };
  /** How high a step lifts the foot: `base` m, `perSpeed` m more per m/s. */
  readonly lift?: { readonly base: number; readonly perSpeed: number };
  /** How far ahead along the velocity a planted foot measures its spot, s. */
  readonly lead?: number;
  /** How many moving thresholds away (`base` and its speed's share, standing too) a foot steps whatever others do. */
  readonly force?: number;
}

/** A foot: where it is, where its step left from and aims, the surface under it, and how far into its step it is. */
export interface GaitFoot {
  readonly position: Vector3;
  readonly from: Vector3;
  readonly to: Vector3;
  /** The surface it stands on or steps onto: up on the ground, a wall's normal when it grips one. */
  readonly normal: Vector3;
  /** −1 planted, 0 to 1 into its step, 2 in the air (`fly`). */
  t: number;
  /** Its step's length, s. */
  duration: number;
}

/** A ray into the world: from `origin` along unit `direction` up to `distance` m; true with the hit written. */
export type GaitProbe = (origin: Vector3, direction: Vector3, distance: number, hit: GroundHit) => boolean;

/** The body a gait carries: its ground point, its heading (rad, 0 facing +Z) and its velocity, m/s. */
export interface GaitBody {
  readonly position: Vector3;
  readonly yaw: number;
  readonly velocity: Vector3;
}

const [UP, DOWN] = [new Vector3(0, 1, 0), new Vector3(0, -1, 0)];
const [spot, hip, ray, flat] = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
const hit: GroundHit = { point: new Vector3(), normal: new Vector3() };
const between = { position: new Vector3(), yaw: 0, velocity: new Vector3() };

/** A gait as plain data (`LegGait.save`, `load`): every foot's numbers, whether it stands yet, the last step's body. */
export interface GaitState {
  /** Per foot: its position, from, to and normal (x, y, z each), then t and duration: `GAIT_FOOT` numbers a foot. */
  feet: number[];
  placed: boolean;
  /** The body as the last step left it: its position (x, y, z), yaw and velocity (x, y, z). */
  last: number[];
}

/** Numbers a foot takes in a `GaitState`. */
export const GAIT_FOOT = 14;

/** The gait's inner step, s: a 60 Hz step takes two, a 120 Hz one, so both rates step the same feet. */
export const GAIT_SUBSTEP = 1 / 120;

/** A planted gait (see the file comment). */
export class LegGait {
  readonly legs: readonly GaitLeg[];
  readonly feet: GaitFoot[];
  readonly options: Required<Omit<GaitOptions, 'legs'>>;
  #placed = false;
  /** The body as the last step left it: inner steps move it on linearly from there. */
  readonly #last = { position: new Vector3(), yaw: 0, velocity: new Vector3() };

  /** A gait of `options.legs` (see `GaitOptions` for the rest). */
  constructor(options: GaitOptions) {
    this.legs = options.legs;
    this.options = {
      threshold: options.threshold ?? { base: 0.15, perSpeed: 0.026, maxSpeed: 8, still: 0.01, stand: 0.05 },
      stepTime: options.stepTime ?? { min: 0.055, max: 0.17, speed: 0.9 },
      lift: options.lift ?? { base: 0.09, perSpeed: 0.022 },
      lead: options.lead ?? 0.09,
      force: options.force ?? 2.3,
    };
    const v = () => new Vector3();
    this.feet = options.legs.map(() => ({
      position: v(),
      from: v(),
      to: v(),
      normal: v().copy(UP),
      t: -1,
      duration: 0,
    }));
  }

  /** Where leg `i`'s foot should stand for `body`, `ahead` s along its velocity, into `out` and its surface normal. */
  spot(i: number, body: GaitBody, ahead: number, probe: GaitProbe | undefined, out: Vector3, normal: Vector3): Vector3 {
    const [c, s] = [Math.cos(body.yaw), Math.sin(body.yaw)];
    const turn = (p: readonly number[], to: Vector3) => to.set(p[0] * c + p[2] * s, p[1], p[2] * c - p[0] * s).add(body.position); // prettier-ignore
    turn(this.legs[i].rest, out).addScaledVector(flat.copy(body.velocity).setY(0), ahead);
    normal.copy(UP);
    if (!probe) return out;
    turn(this.legs[i].hip, hip);
    const reach = ray.copy(out).sub(hip).length();
    if (reach > 1e-6 && probe(hip, ray.divideScalar(reach), reach, hit) && hit.normal.y < 0.7) {
      normal.copy(hit.normal);
      return out.copy(hit.point); // a wall between the hip and the spot: grip its face
    }
    const above = Math.max(0.05, hip.y - body.position.y);
    ray.copy(out).addScaledVector(UP, above);
    if (!probe(ray, DOWN, above * 2, hit)) return out; // no ground under it: the spot, at the body's height
    normal.copy(hit.normal);
    return out.copy(hit.point);
  }

  /** Stands every foot on its spot at once, planted. */
  plant(body: GaitBody, probe?: GaitProbe): this {
    this.feet.forEach((foot, i) => {
      this.spot(i, body, 0, probe, foot.position, foot.normal);
      [foot.t, foot.duration] = [-1, 0];
      foot.from.copy(foot.position);
      foot.to.copy(foot.position);
    });
    this.#placed = true;
    this.#keep(body);
    return this;
  }

  /** Keeps `body` as the last step left it. */
  #keep(body: GaitBody): void {
    this.#last.position.copy(body.position);
    this.#last.yaw = body.yaw;
    this.#last.velocity.copy(body.velocity);
  }

  /** Runs `inner` over `dt` in inner steps of `GAIT_SUBSTEP`, the body moving on linearly from the last step's. */
  #through(dt: number, body: GaitBody, inner: (dt: number, body: GaitBody) => void): void {
    const n = Math.max(1, Math.round(dt / GAIT_SUBSTEP));
    for (let k = 1; k <= n; k++) {
      between.position.lerpVectors(this.#last.position, body.position, k / n);
      between.yaw = lerpAng(this.#last.yaw, body.yaw, k / n);
      between.velocity.lerpVectors(this.#last.velocity, body.velocity, k / n);
      inner(dt / n, between);
    }
    this.#keep(body);
  }

  /** One step of `dt` seconds of `body`'s gait, in inner steps of `GAIT_SUBSTEP` (see the file comment). */
  step(dt: number, body: GaitBody, probe?: GaitProbe): this {
    if (!this.#placed) return this.plant(body, probe);
    for (const foot of this.feet) if (foot.t === 2) this.#land(foot, body, probe); // under the body as it is now
    this.#through(dt, body, (d, b) => this.#inner(d, b, probe));
    return this;
  }

  /** One inner step of `dt` seconds (see the file comment). */
  #inner(dt: number, body: GaitBody, probe: GaitProbe | undefined): void {
    const { threshold, stepTime, lift, lead, force } = this.options;
    const speed = Math.hypot(body.velocity.x, body.velocity.z);
    const moving = threshold.base + threshold.perSpeed * Math.min(speed, threshold.maxSpeed);
    const reach = speed < threshold.stand ? threshold.still : moving;
    const busy = new Map<number, number>(); // feet stepping, by group, counted as feet start
    const start = (group: number) => busy.set(group, (busy.get(group) ?? 0) + 1);
    this.feet.forEach((foot, i) => {
      if (foot.t >= 0) start(this.legs[i].group);
    });
    const waiting = this.feet.flatMap((foot, i) => {
      if (foot.t >= 0) return [];
      this.spot(i, body, lead, probe, spot, foot.normal);
      const off = flat.copy(foot.position).sub(spot).setY(0).length();
      return [{ i, off, rank: Math.round(off * 1000) }]; // whole millimetres: mirror-image feet tie, whatever the rate
    });
    waiting.sort((a, b) => b.rank - a.rank || a.i - b.i); // the farthest first: a group just landed yields
    for (const { i, off } of waiting) {
      const [foot, group] = [this.feet[i], this.legs[i].group];
      const others = [...busy].some(([g, n]) => g !== group && n > 0);
      if (!((off > reach && !others) || off > force * moving)) continue;
      [foot.t, foot.duration] = [0, Math.max(stepTime.min, Math.min(stepTime.max, (0.75 * reach) / Math.max(speed, stepTime.speed)))]; // prettier-ignore
      foot.from.copy(foot.position);
      start(group);
    }
    this.feet.forEach((foot, i) => {
      if (foot.t < 0) return;
      foot.t = Math.min(1, foot.t + dt / foot.duration);
      this.spot(i, body, lead + foot.duration * 0.35, probe, foot.to, foot.normal); // past the spot it measures from
      const arc = Math.sin(Math.PI * foot.t) * (lift.base + lift.perSpeed * speed);
      foot.position.lerpVectors(foot.from, foot.to, ease.inOut(foot.t)).addScaledVector(UP, arc);
      if (foot.t < 1) return;
      foot.t = -1; // planted where it aimed
      foot.position.copy(foot.to);
    });
  }

  /** Lifts every foot off, easing it toward its tuck under the hip (`tuck` of the way from hip to rest), in the air. */
  fly(dt: number, body: GaitBody, tuck = 0.5): this {
    if (!this.#placed) this.#keep(body); // never stood: it takes off from where it is
    this.#through(dt, body, (d, b) => {
      const [c, s, k] = [Math.cos(b.yaw), Math.sin(b.yaw), 1 - Math.exp(-14 * d)];
      this.feet.forEach((foot, i) => {
        const { hip: h, rest: r } = this.legs[i];
        const [x, y, z] = [h[0] + (r[0] - h[0]) * tuck, h[1] + (r[1] - h[1]) * tuck, h[2] + (r[2] - h[2]) * tuck];
        spot.set(x * c + z * s, y, z * c - x * s).add(b.position);
        foot.position.lerp(spot, k);
        foot.t = 2;
      });
    });
    return this;
  }

  /** The gait as plain data, into `out` (see `GaitState`): a component holds it, `load` takes it back. */
  save(out: GaitState = { feet: [], placed: false, last: [] }): GaitState {
    out.feet.length = 0;
    for (const f of this.feet) out.feet.push(...f.position.toArray(), ...f.from.toArray(), ...f.to.toArray(), ...f.normal.toArray(), f.t, f.duration); // prettier-ignore
    out.placed = this.#placed;
    out.last = [...this.#last.position.toArray(), this.#last.yaw, ...this.#last.velocity.toArray()];
    return out;
  }

  /** Takes the gait back from `state` (`save`'s): the same steps then give the same feet. */
  load(state: Readonly<GaitState>): this {
    this.feet.forEach((f, i) => {
      const k = i * GAIT_FOOT;
      [f.position, f.from, f.to, f.normal].forEach((v, j) => v.fromArray(state.feet, k + 3 * j));
      [f.t, f.duration] = [state.feet[k + 12], state.feet[k + 13]];
    });
    this.#placed = state.placed;
    this.#last.position.fromArray(state.last, 0);
    this.#last.yaw = state.last[3];
    this.#last.velocity.fromArray(state.last, 4);
    return this;
  }

  /** How many feet are stepping. */
  lifted(): number {
    return this.feet.filter((foot) => foot.t >= 0 && foot.t < 2).length;
  }

  /** How much of the body's weight is off its feet: Σ sin πt over the feet stepping. */
  lifting(): number {
    return this.feet.reduce((sum, foot) => sum + (foot.t >= 0 && foot.t < 2 ? Math.sin(Math.PI * foot.t) : 0), 0);
  }

  /** The body's pitch (its nose up +) and roll (its left up +) from its feet's heights, rad, within ±0.6 and ±0.5. */
  tilt(): [number, number] {
    const side = (pick: (leg: GaitLeg) => boolean) => {
      const heights = this.feet.filter((_, i) => pick(this.legs[i])).map((foot) => foot.position.y);
      return heights.length ? heights.reduce((a, b) => a + b, 0) / heights.length : 0;
    };
    const span = Math.max(0.4, 2 * Math.max(...this.legs.map((leg) => Math.abs(leg.rest[2]))));
    const width = 2 * Math.max(0.2, ...this.legs.map((leg) => Math.abs(leg.rest[0])));
    const pitch = Math.atan((side((leg) => leg.rest[2] >= 0) - side((leg) => leg.rest[2] < 0)) / span);
    const roll = Math.atan((side((leg) => leg.rest[0] > 0) - side((leg) => leg.rest[0] <= 0)) / width);
    return [Math.max(-0.6, Math.min(0.6, pitch)), Math.max(-0.5, Math.min(0.5, roll))];
  }

  /** Lands a foot that was in the air where it is now, on the ground under it, planted. */
  #land(foot: GaitFoot, body: GaitBody, probe: GaitProbe | undefined): void {
    foot.position.y = body.position.y;
    if (probe && probe(ray.copy(foot.position).addScaledVector(UP, 0.5), DOWN, 1, hit)) foot.position.copy(hit.point);
    foot.t = -1;
    foot.normal.copy(UP);
    foot.from.copy(foot.position);
    foot.to.copy(foot.position);
  }
}
