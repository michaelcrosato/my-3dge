/**
 * @file Chains (PLAN.md WP 6.2, §5.2; I-11): the strands secondary motion hangs (engine/anim/secondary.ts runs them on
 * a humanoid). `Chain` is one verlet strand (hair, a tail): an anchor, `n` points `seg` apart, gravity, drag, wind,
 * constraint `iterations`, bone-capsule colliders, planes, a floor (a height or a ground probe), a ceiling, and
 * `stiffness` toward a rest shape. `Cape` is two chains held a width apart, flaring and fluttering by `CAPE`.
 *
 * Invariants:
 * - View state only: nothing here reaches the sim or its hash.
 * - A fixed inner step, `CHAIN.substep` (1/120 s): a 60 Hz tick takes two, the anchor and its frame moving linearly
 *   between, a 120 Hz tick one, so both rates give the same strand. Verlet is time-corrected for uneven steps.
 * - A fresh start (`reset`: the chain laid out along its rest shape, at rest) on the first step, on a teleport (the
 *   anchor jumps farther than `teleport` in one step), on a step longer than `CHAIN.maxStep` and on a clock going
 *   back (a loaded state).
 * - Each inner step: verlet with drag, gravity and wind, the pull toward the rest shape, then `iterations` passes of
 *   the segment lengths (the anchor's neighbour moves alone, the others share), the capsules, the planes, the ceiling
 *   and, last, the floor, so a point never ends a step below the floor.
 * - Metres, m/s², rates per second; the rest shape is in the anchor's frame.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:1900-1916` (hair) and `:2033-2068` (the cape): lengths and
 * accelerations ÷ 16, damping per 1/120 s as drag per second. Split from secondary.ts to keep each under 400 lines
 * (ADR-0014 amendment 16).
 *
 * @example
 * import { Vector3 } from '../core/math';
 * const hair = new Chain({ n: 5, seg: 0.1 });
 * for (let i = 0; i < 240; i++) hair.step(1 / 60, new Vector3(0, 2, 0));
 * hair.points[4].y; // ≈ 1.6: it hangs straight down, 4 segments of 0.1 m
 * const cape = new Cape({ n: 6, seg: 0.15, width: 0.3 });
 * cape.step(1 / 60, new Vector3(-0.15, 1.5, 0), new Vector3(0.15, 1.5, 0)).right.points.length; // 6
 * @see engine/anim/secondary.test.ts
 */
import { codeError, defineCodes } from '../core/log';
import { MathUtils, Plane, Quaternion, Vector3 } from '../core/math';
import type { GroundHit, GroundProbe } from './ik';

/** The codes this module raises, with their fixes. */
export const SECONDARY_CODES = defineCodes('anim', {
  ANIM_BAD_CHAIN: {
    template: 'a chain cannot have {field} {value}',
    fix: 'give a chain n ≥ 2 points, seg > 0 metres and iterations ≥ 1',
    doc: 'Thrown by `new Chain` and `new Cape` (engine/anim/secondary.ts) for fewer than 2 points, a segment that is not a positive length, or no constraint pass: such a chain has nothing to hang or never holds its length.',
  },
});

/** The chains' shared tuning. */
export const CHAIN = {
  substep: 1 / 120, // the inner step, seconds
  maxStep: 0.25, // a longer step starts the chain afresh (the view was not drawing it)
  teleport: 1, // metres the anchor may jump in one step before the chain starts afresh
  gravity: 9.81, // m/s² down, unless a chain says otherwise
  drag: 2, // per second
  iterations: 3, // constraint passes per inner step
  stretch: 1.1, // the most a segment ends a pass stretched, a share of its length (a violent jolt)
  radius: 0.02, // metres: a point's thickness against capsules, the ceiling and the floor
  probeAbove: 0.5, // a floor probe starts this far above each point…
  probeBelow: 1.5, // …and looks this far below it
  limb: 0.05, // a limb capsule's radius, metres before size (a trunk's is half the build's chestDepth)
} as const;

/** A bone capsule: the segment `a`–`b` with a `radius`, world metres (a sphere when `a` equals `b`). */
export type BoneCapsule = { readonly a: Vector3; readonly b: Vector3; radius: number };

/** What a chain is made of: `n` points (2 or more, the anchor first) `seg` metres apart, and its tuning. */
export interface ChainOptions extends Partial<ChainTuning> {
  n: number;
  seg: number;
  /** The rest shape in the anchor's frame: one direction for every segment, or one each. Straight down by default. */
  rest?: Vector3 | readonly Vector3[];
}

/** A chain's tuning, which may change between steps; the defaults are `CHAIN`'s (stiffness 0, wind none). */
export interface ChainTuning {
  /** m/s² down. */
  gravity: number;
  /** Per second: the share of its speed a point keeps each second is e^−drag. */
  drag: number;
  /** m/s², world. */
  wind: Vector3;
  /** Constraint passes per inner step, 1 or more. */
  iterations: number;
  /** Metres: each point's thickness. */
  radius: number;
  /** Per second: how fast each segment turns toward its rest direction (0, a rope). */
  stiffness: number;
  /** Metres the anchor may jump in one step before the chain starts afresh. */
  teleport: number;
}

const IDENTITY = new Quaternion();
const DOWN = new Vector3(0, -1, 0);
/** Scratch objects. */
const [va, vb, vc, vd, ve] = [new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3()];
const qa = new Quaternion();
const hit: GroundHit = { point: new Vector3(), normal: new Vector3() };

/** Pushes `p` out of `capsule`, padded by `pad`. */
function pushOut(p: Vector3, capsule: BoneCapsule, pad: number): void {
  const axis = vc.subVectors(capsule.b, capsule.a);
  const len2 = axis.lengthSq();
  const t = len2 > 0 ? MathUtils.clamp(vd.subVectors(p, capsule.a).dot(axis) / len2, 0, 1) : 0;
  const closest = vd.copy(capsule.a).addScaledVector(axis, t);
  const away = ve.subVectors(p, closest);
  const [d, r] = [away.length(), capsule.radius + pad];
  if (d >= r) return;
  if (d > 1e-9) p.copy(closest).addScaledVector(away, r / d);
  else p.copy(closest).y += r;
}

/** The inner steps a step of `dt` seconds takes. */
export const innerSteps = (dt: number): number => Math.max(1, Math.ceil(dt / CHAIN.substep - 1e-6));

/** One verlet strand. See the file comment. */
export class Chain {
  /** Points, the anchor first. */
  readonly n: number;
  /** Metres between neighbours. */
  readonly seg: number;
  /** Its tuning, every default filled in: change a field to retune it. */
  readonly tuning: ChainTuning;
  /** Each segment's rest direction (unit), in the anchor's frame. */
  readonly rest: readonly Vector3[];
  /** The points, world metres, the anchor first. */
  readonly points: readonly Vector3[];
  /** The points one inner step ago: verlet's velocity. */
  readonly previous: readonly Vector3[];
  /** The bone capsules it collides with, world metres. */
  colliders: readonly BoneCapsule[] = [];
  /** Planes each point keeps to the front of (three.js's `Plane`: its normal's side). */
  planes: readonly Plane[] = [];
  /** The floor: a height, world metres, or a probe cast down at each point once a step. */
  floor: number | GroundProbe = -Infinity;
  /** The highest a point may go, world metres. */
  ceiling = Infinity;
  /** Seconds it has run, for forces that vary in time. */
  time = 0;
  #h: number = CHAIN.substep;
  #ready = false;
  readonly #from = new Vector3();
  readonly #fromFrame = new Quaternion();
  /** Under each point, the floor the probe found: a point, a normal, and whether it found one. */
  readonly #planes: { point: Vector3; normal: Vector3; found: boolean }[];

  /** A chain made from `options`, not yet laid out. Throws `ANIM_BAD_CHAIN` for n < 2, seg ≤ 0 or no iterations. */
  constructor(options: ChainOptions) {
    const { n, seg, iterations = CHAIN.iterations, rest = DOWN } = options;
    const bad = (field: string, value: number) => codeError('ANIM_BAD_CHAIN', { field, value: String(value) });
    if (!(Number.isInteger(n) && n >= 2)) throw bad('n', n);
    if (!(seg > 0)) throw bad('seg', seg);
    if (!(Number.isInteger(iterations) && iterations >= 1)) throw bad('iterations', iterations);
    [this.n, this.seg] = [n, seg];
    const o = options;
    // prettier-ignore
    this.tuning = {
      gravity: o.gravity ?? CHAIN.gravity, drag: o.drag ?? CHAIN.drag, wind: o.wind?.clone() ?? new Vector3(), iterations,
      radius: o.radius ?? CHAIN.radius, stiffness: o.stiffness ?? 0, teleport: o.teleport ?? CHAIN.teleport,
    };
    const restOf = (i: number) => (rest instanceof Vector3 ? rest : (rest[i] ?? rest.at(-1) ?? DOWN));
    this.rest = Array.from({ length: n - 1 }, (_, i) => restOf(i).clone().normalize());
    this.points = Array.from({ length: n }, () => new Vector3());
    this.previous = Array.from({ length: n }, () => new Vector3());
    this.#planes = Array.from({ length: n }, () => ({ point: new Vector3(), normal: new Vector3(), found: false }));
  }

  /** Lays the chain out from `anchor` along its rest shape turned by `frame`, at rest, above the floor. */
  reset(anchor: Vector3, frame: Quaternion = IDENTITY): this {
    const { points: p, previous: q } = this;
    p[0].copy(anchor);
    for (let i = 1; i < this.n; i++) this.#rested(i, frame, p[i]);
    this.#probe();
    this.#contain();
    for (let i = 0; i < this.n; i++) q[i].copy(p[i]);
    this.#h = CHAIN.substep;
    this.#ready = true;
    this.#from.copy(anchor);
    this.#fromFrame.copy(frame);
    return this;
  }

  /** Moves the chain `dt` seconds on, its anchor moving to `anchor` and its frame turning to `frame`. */
  step(dt: number, anchor: Vector3, frame: Quaternion = IDENTITY): this {
    const count = this.begin(dt, anchor, frame);
    for (let k = 1; k <= count; k++) {
      this.integrate(dt / count, k / count, anchor, frame);
      for (let it = 0; it < this.tuning.iterations; it++) this.relax();
    }
    return this;
  }

  /**
   * The first part of `step`, for chains joined by a constraint of their own (a cape's width): the inner steps to
   * take for `dt`, or 0 when there is no time or the chain started afresh. Probes the floor.
   */
  begin(dt: number, anchor: Vector3, frame: Quaternion = IDENTITY): number {
    const jump = this.#from.distanceTo(anchor) > this.tuning.teleport;
    const fresh = !this.#ready || !(dt >= 0) || dt > CHAIN.maxStep || jump;
    if (fresh) this.reset(anchor, frame);
    if (fresh || dt === 0) return 0;
    this.#probe();
    return innerSteps(dt);
  }

  /**
   * One inner step of `h` seconds, `share` of the way through `step`'s (the anchor and its frame moved that far toward
   * `to` and `toFrame`): verlet with drag, gravity, wind and `push` (more m/s² for point `i`), then the pull toward
   * the rest shape.
   */
  integrate(h: number, share: number, to: Vector3, toFrame: Quaternion, push?: (i: number, a: Vector3) => void): void {
    const { points: p, previous: q, tuning: t } = this;
    const at = va.lerpVectors(this.#from, to, share);
    const turn = qa.slerpQuaternions(this.#fromFrame, toFrame, share);
    p[0].copy(at);
    q[0].copy(at);
    const keep = Math.exp(-t.drag * h) * (h / this.#h);
    const reach = (h * (h + this.#h)) / 2;
    for (let i = 1; i < this.n; i++) {
      const velocity = vb.subVectors(p[i], q[i]).multiplyScalar(keep);
      const accel = vc.copy(t.wind);
      accel.y -= t.gravity;
      push?.(i, accel);
      q[i].copy(p[i]);
      p[i].add(velocity).addScaledVector(accel, reach);
    }
    if (t.stiffness > 0) {
      const k = 1 - Math.exp(-t.stiffness * h);
      for (let i = 1; i < this.n; i++) p[i].lerp(this.#rested(i, turn, vd), k);
    }
    this.#h = h;
    this.time += h;
    if (share < 1) return;
    this.#from.copy(to);
    this.#fromFrame.copy(toFrame);
  }

  /** Where point `i` rests from point `i − 1`, the rest shape turned by `turn`: written into `out`. */
  #rested(i: number, turn: Quaternion, out: Vector3): Vector3 {
    out.copy(this.rest[i - 1]).applyQuaternion(turn);
    return out.multiplyScalar(this.seg).add(this.points[i - 1]);
  }

  /**
   * One constraint pass: the segment lengths (then, from the anchor out, none longer than `CHAIN.stretch` of its
   * length), the capsules, the planes, the ceiling and the floor.
   */
  relax(): void {
    const p = this.points;
    for (let i = 1; i < this.n; i++) {
      const d = vb.subVectors(p[i], p[i - 1]);
      const length = d.length() || 1e-9;
      const k = (length - this.seg) / length;
      if (i > 1) p[i - 1].addScaledVector(d, k / 2);
      p[i].addScaledVector(d, i > 1 ? -k / 2 : -k);
    }
    for (let i = 1; i < this.n; i++) {
      const d = vb.subVectors(p[i], p[i - 1]);
      const length = d.length();
      if (length > this.seg * CHAIN.stretch)
        p[i].copy(p[i - 1]).addScaledVector(d, (this.seg * CHAIN.stretch) / length);
    }
    this.#contain();
  }

  /** Keeps each point out of the capsules, in front of the planes, under the ceiling and, last, above the floor. */
  #contain(): void {
    const { floor } = this;
    const pad = this.tuning.radius;
    for (let i = 1; i < this.n; i++) {
      const p = this.points[i];
      for (const capsule of this.colliders) pushOut(p, capsule, pad);
      for (const plane of this.planes) p.addScaledVector(plane.normal, Math.max(0, pad - plane.distanceToPoint(p)));
      p.y = Math.min(p.y, this.ceiling - pad);
      if (typeof floor === 'number') p.y = Math.max(p.y, floor + pad);
      else if (this.#planes[i].found) {
        const { point, normal } = this.#planes[i];
        const d = va.subVectors(p, point).dot(normal);
        if (d < pad) p.addScaledVector(normal, pad - d);
      }
    }
  }

  /** Casts the floor probe down at each point. */
  #probe(): void {
    const probe = this.floor;
    if (typeof probe === 'number') return;
    for (let i = 1; i < this.n; i++) {
      const plane = this.#planes[i];
      const from = va.copy(this.points[i]);
      from.y += CHAIN.probeAbove;
      plane.found = probe(from, CHAIN.probeAbove + CHAIN.probeBelow, hit);
      if (!plane.found) continue;
      plane.point.copy(hit.point);
      plane.normal.copy(hit.normal).normalize();
    }
  }
}

/** What a cape is made of: its edges' chain options, `width` metres apart at the top, and `CAPE`'s flare and flutter. */
export interface CapeOptions extends ChainOptions {
  width: number;
  /** How much wider it is at the hem, a share of `width` (`CAPE.flare`). */
  flare?: number;
  /** m/s² of flutter at the hem, up and down (`CAPE.flutter`). */
  flutter?: number;
}

/** A cape: two chains, its left and right edges, held `width` apart (wider toward the hem by `flare`). */
export class Cape {
  /** The left edge (+X at rest). */
  readonly left: Chain;
  /** The right edge. */
  readonly right: Chain;
  /** Metres between the edges at the top. */
  width: number;
  /** Share of `width` it widens by at the hem. */
  flare: number;
  /** m/s² of flutter at the hem, a wave that runs down each edge (`CAPE.flutterRate`, `CAPE.flutterLag`). */
  flutter: number;
  /** Each edge's flutter, as `Chain.integrate` takes it. */
  readonly #push = [-1, 1].map((side) => (i: number, a: Vector3) => {
    const wave = Math.sin(this.left.time * CAPE.flutterRate - i * CAPE.flutterLag + side);
    a.y += this.flutter * wave * (i / this.left.n);
  });

  /** A cape made from `options`. Throws `ANIM_BAD_CHAIN` as `Chain` does. */
  constructor(options: CapeOptions) {
    this.left = new Chain(options);
    this.right = new Chain(options);
    this.width = options.width;
    this.flare = options.flare ?? CAPE.flare;
    this.flutter = options.flutter ?? CAPE.flutter;
  }

  /** Moves the cape `dt` seconds on, its top corners moving to `left` and `right` and its frame turning to `frame`. */
  step(dt: number, left: Vector3, right: Vector3, frame: Quaternion = IDENTITY): this {
    const [L, R] = [this.left, this.right];
    const count = L.begin(dt, left, frame);
    if (R.begin(dt, right, frame) !== count) return this.reset(left, right, frame);
    for (let k = 1; k <= count; k++) {
      L.integrate(dt / count, k / count, left, frame, this.#push[0]);
      R.integrate(dt / count, k / count, right, frame, this.#push[1]);
      for (let it = 0; it < L.tuning.iterations; it++) {
        this.#hold();
        L.relax();
        R.relax();
      }
    }
    return this;
  }

  /** Lays both edges out afresh (`Chain.reset`). */
  reset(left: Vector3, right: Vector3, frame: Quaternion = IDENTITY): this {
    this.left.reset(left, frame);
    this.right.reset(right, frame);
    return this;
  }

  /** Holds each pair of points its width apart. */
  #hold(): void {
    const [L, R, n] = [this.left.points, this.right.points, this.left.n];
    for (let i = 1; i < n; i++) {
      const d = vb.subVectors(R[i], L[i]);
      const length = d.length() || 1e-9;
      const k = ((length - this.width * (1 + (this.flare * i) / n)) / length) * 0.5;
      L[i].addScaledVector(d, k);
      R[i].addScaledVector(d, -k);
    }
  }
}
/** A cape from the backs of the shoulders (`inset` in, `drop` down, `gap` off the back), the source's numbers. */
// prettier-ignore
export const CAPE = {
  n: 6, seg: 0.15, width: 0.3125, flare: 0.25, gravity: 14.375, drag: 2.1797, iterations: 4, pull: 1.875,
  flutter: 2.5, flutterRate: 11, flutterLag: 0.8, // m/s² at the hem; radians per second; radians from point to point
  inset: 0.0375, drop: 0.0375, gap: 0.02,
  rise: 0.6, // segments it may rise above its top corners: it never whips over the head
  upright: 0.5, // the chest's up above this share of vertical: the cape keeps behind its back plane
} as const;
