/**
 * @file Secondary motion (PLAN.md WP 6.2, §5.2; I-11): what follows the body without driving it. `Chain` is one
 * verlet strand (hair, a tail): an anchor, `n` points `seg` apart, gravity, drag, wind, constraint `iterations`,
 * bone-capsule colliders, planes, a floor (a height or a ground probe), a ceiling, and `stiffness` toward a rest
 * shape. `Cape` is two chains held a width apart. The squash spring shows as a volume-preserving root scale
 * (`squashScale`). `Secondary` is the animator layer (slot `secondary`) that runs them on a humanoid: hair from the back of the
 * head, a cape from the shoulders, a tail from the pelvis, each colliding with the body's capsules (`bodyCapsules`).
 *
 * Invariants:
 * - View state only: nothing here reaches the sim or its hash. The layer steps in `apply`, once per tick the animator
 *   re-solves, by the body clock's advance since its last step (none at the detail levels that skip the slot).
 * - A fixed inner step, `CHAIN.substep` (1/120 s): a 60 Hz tick takes two, the anchor and its frame moving linearly
 *   between, a 120 Hz tick one, so both rates give the same strand. Verlet is time-corrected for uneven steps.
 * - A fresh start (`reset`: the chain laid out along its rest shape, at rest) on the first step, on a teleport (the
 *   anchor jumps farther than `teleport` in one step), on a step longer than `CHAIN.maxStep` and on a clock going
 *   back (a loaded state).
 * - Each inner step: verlet with drag, gravity and wind, the pull toward the rest shape, then `iterations` passes of
 *   the segment lengths (the anchor's neighbour moves alone, the others share), the capsules, the planes, the ceiling
 *   and, last, the floor, so a point never ends a step below the floor. A cape on an upright body keeps behind the
 *   plane of its top corners (the source's back plane), so a snap turn never leaves it across the chest.
 * - Metres (the build's lengths times its `size`), m/s², rates per second; the rest shape is in the anchor's frame.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:1832` (the squash spring), `:1900-1916` (hair) and `:2033-2068` (the
 * cape): lengths and accelerations ÷ 16, damping per 1/120 s as drag per second; the body cylinder became bone
 * capsules, and the anchors moved to the 3D body's surface (the build's `chestDepth`).
 *
 * @example
 * import { Vector3 } from '../core/math';
 * import { Animator } from './character';
 * const hair = new Chain({ n: 5, seg: 0.1 });
 * for (let i = 0; i < 240; i++) hair.step(1 / 60, new Vector3(0, 2, 0));
 * hair.points[4].y; // ≈ 1.6: it hangs straight down, 4 segments of 0.1 m
 * const hero = new Animator({ build: 'build:heroic' });
 * const extras = new Secondary({ hair: 'long', cape: true });
 * hero.use('secondary', extras);
 * extras.kick(3); // a landing's jolt
 * hero.update({ velocity: new Vector3(0, 0, 5) });
 * extras.cape?.left.points.length; // 6: the cape's left edge, world metres, for the view to draw
 * @see engine/anim/secondary.test.ts
 */
import { codeError, defineCodes } from '../core/log';
import { MathUtils, Plane, Quaternion, Vector3 } from '../core/math';
import type { Build } from './builds';
import type { Animator } from './character';
import { forwardKinematics, jointPosition, jointRotation, jointToWorld, socketPosition, type WorldPose } from './fk';
import type { GroundHit, GroundProbe } from './ik';
import { jointIndex, type JointName, type Skeleton } from './skeleton';
import type { AnimLayer } from './weights';

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
const innerSteps = (dt: number) => Math.max(1, Math.ceil(dt / CHAIN.substep - 1e-6));

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

/** The squash spring (my-3d2dge's numbers): its pull and damping per second, and its bound either way. */
export const SQUASH = { stiffness: 260, damping: 15, limit: 0.3 } as const;

/** The root scale of a squash: 1 + `squash` tall, 1 / √(1 + `squash`) wide and deep, so the volume stays. */
export function squashScale(squash: number, out: Vector3 = new Vector3()): Vector3 {
  const tall = 1 + squash;
  return out.set(1 / Math.sqrt(tall), tall, 1 / Math.sqrt(tall));
}

/** The capsules `bodyCapsules` builds: joint to joint, `trunk` (half the chestDepth) or `limb` thick, and the head. */
// prettier-ignore
export const BODY_CAPSULES = [
  ['pelvis', 'neck', 'trunk'], ['upperArmL', 'upperArmR', 'trunk'], ['thighL', 'thighR', 'trunk'],
  ['upperArmL', 'forearmL', 'limb'], ['forearmL', 'handL', 'limb'], ['upperArmR', 'forearmR', 'limb'],
  ['forearmR', 'handR', 'limb'], ['thighL', 'shinL', 'limb'], ['shinL', 'footL', 'limb'],
  ['thighR', 'shinR', 'limb'], ['shinR', 'footR', 'limb'],
] as const satisfies readonly (readonly [JointName, JointName, 'trunk' | 'limb'])[];

/** A new capsule for `bodyCapsules` to fill. */
const newCapsule = (): BoneCapsule => ({ a: new Vector3(), b: new Vector3(), radius: 0 });

/** The body's bone capsules in `world` (`BODY_CAPSULES`, then the head as a ball), written into `out`. */
export function bodyCapsules(build: Build, world: WorldPose, out: BoneCapsule[] = []): BoneCapsule[] {
  const s = build.size;
  BODY_CAPSULES.forEach(([from, to, kind], i) => {
    const capsule = (out[i] ??= newCapsule());
    jointPosition(world, from, capsule.a);
    jointPosition(world, to, capsule.b);
    capsule.radius = (kind === 'trunk' ? build.chestDepth / 2 : CHAIN.limb) * s;
  });
  const head = (out[BODY_CAPSULES.length] ??= newCapsule());
  jointToWorld(world, 'head', va.set(0, build.headRadius * s, 0), head.a);
  head.b.copy(head.a);
  head.radius = build.headRadius * s;
  out.length = BODY_CAPSULES.length + 1;
  return out;
}

/** Hair from behind the head (`behind` and `lift` head radii from its centre), the source's numbers. */
// prettier-ignore
export const HAIR = {
  long: { n: 6, seg: 0.11875, lift: 0.1 }, ponytail: { n: 4, seg: 0.1, lift: 0.55 }, behind: 0.8,
  tuning: { gravity: 12.5, drag: 3.6551, iterations: 3 },
  pull: 1.25, // m/s² behind the body's facing: it trails behind a turn
} as const;

/** A cape from the backs of the shoulders (`inset` in, `drop` down, `gap` off the back), the source's numbers. */
// prettier-ignore
export const CAPE = {
  n: 6, seg: 0.15, width: 0.3125, flare: 0.25, gravity: 14.375, drag: 2.1797, iterations: 4, pull: 1.875,
  flutter: 2.5, flutterRate: 11, flutterLag: 0.8, // m/s² at the hem; radians per second; radians from point to point
  inset: 0.0375, drop: 0.0375, gap: 0.02,
  rise: 0.6, // segments it may rise above its top corners: it never whips over the head
  upright: 0.5, // the chest's up above this share of vertical: the cape keeps behind its back plane
} as const;

/** A tail from the back of the pelvis, holding its curve back and up (chosen here: the source had none). */
export const TAIL = { n: 5, seg: 0.1, drag: 3, stiffness: 8, gap: 0.02, rest: [0, 0.3, -1] } as const;

/** What `Secondary` runs: each part is off unless given (the squash is on unless `false`). */
export interface SecondaryOptions {
  /** Its layer name (`secondary`). */
  name?: string;
  /** The squash spring (true). */
  squash?: boolean;
  /** Hair: `HAIR.long` or `HAIR.ponytail`. */
  hair?: 'long' | 'ponytail';
  /** A cape: true for `CAPE`, or options laid over it; `pull` is m/s² behind the body's facing. */
  cape?: boolean | (Partial<CapeOptions> & { pull?: number });
  /** A tail: true for `TAIL`, or options laid over it. */
  tail?: boolean | Partial<ChainOptions>;
  /** A scene's wind, m/s² (copied). */
  wind?: Vector3;
  /** The floor under each point; the ground under the body (its position's height) by default. */
  probe?: GroundProbe;
}

/** Scratch objects for the layer. */
const [anchorL, anchorR, back, scale] = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
const frame = new Quaternion();

/** The secondary-motion layer: squash, hair, cape and tail on a humanoid. See the file comment. */
export class Secondary implements AnimLayer {
  /** Its layer name. */
  readonly name: string;
  /** 0–1: how much of it shows. */
  weight = 1;
  /** The squash: −0.3 (flat) to 0.3 (tall), sprung by `SQUASH`. */
  squash = 0;
  /** The squash's rate, per second. */
  squashSpeed = 0;
  /** The hair, if any. */
  readonly hair: Chain | undefined;
  /** The cape, if any. */
  readonly cape: Cape | undefined;
  /** The tail, if any. */
  readonly tail: Chain | undefined;
  /** The wind, m/s², world. */
  readonly wind: Vector3;
  /** The floor probe, if any. */
  probe: GroundProbe | undefined;
  /** The body's bone capsules at the last step. */
  readonly capsules: BoneCapsule[] = [];
  #clock = NaN;
  /** The hair anchor's lift, head radii, and the cape's pull, m/s². */
  readonly #lift: number;
  readonly #capePull: number;
  readonly #squashes: boolean;
  /** The cape's back plane, through its top corners, facing back. */
  readonly #back = new Plane();
  readonly #behind = [this.#back];

  /** A layer with the parts `options` asks for. */
  constructor(options: SecondaryOptions = {}) {
    this.name = options.name ?? 'secondary';
    this.#squashes = options.squash !== false;
    const hair = options.hair ? HAIR[options.hair] : undefined;
    this.hair = hair && new Chain({ n: hair.n, seg: hair.seg, ...HAIR.tuning });
    this.#lift = hair?.lift ?? 0;
    const { pull = CAPE.pull, ...cape } = options.cape === true ? {} : options.cape || {};
    this.cape = options.cape ? new Cape({ ...CAPE, ...cape }) : undefined;
    this.#capePull = pull;
    const rest = new Vector3(...TAIL.rest);
    this.tail = options.tail ? new Chain({ ...TAIL, rest, ...(options.tail === true ? {} : options.tail) }) : undefined;
    this.wind = options.wind?.clone() ?? new Vector3();
    this.probe = options.probe;
  }

  /** Jolts the squash spring: adds `speed` per second to its rate, + to stretch, − to flatten. */
  kick(speed: number): this {
    this.squashSpeed += speed;
    return this;
  }

  /** Steps the squash and the chains by the body clock's advance, and scales the root by the squash. */
  apply(animator: Animator): void {
    const { skeleton, build, pose, world, position } = animator.body;
    const clock = animator.body.state.clock;
    const dt = clock - this.#clock; // NaN at first, below 0 after a load: the chains start afresh
    this.#clock = clock;
    const count = dt > 0 && dt <= CHAIN.maxStep && this.#squashes ? innerSteps(dt) : 0;
    for (let k = 0; k < count; k++) {
      this.squashSpeed += (-SQUASH.stiffness * this.squash - SQUASH.damping * this.squashSpeed) * (dt / count);
      this.squash = MathUtils.clamp(this.squash + this.squashSpeed * (dt / count), -SQUASH.limit, SQUASH.limit);
    }
    pose.rootScale.multiply(squashScale(this.squash, scale));
    forwardKinematics(skeleton, pose, world);
    bodyCapsules(build, world, this.capsules);
    back.set(0, 0, -1).applyQuaternion(pose.rootRot).setY(0);
    if (back.lengthSq() > 1e-4) back.normalize();
    else back.set(0, 0, 0);
    const s = build.size;
    const place = (chain: Chain, pull: number, ceiling: number) => {
      [chain.colliders, chain.floor, chain.ceiling] = [this.capsules, this.probe ?? position.y, ceiling];
      chain.tuning.wind.copy(this.wind).addScaledVector(back, pull);
    };
    if (this.hair) {
      const r = build.headRadius * s;
      jointToWorld(world, 'head', va.set(0, r * (1 + this.#lift), -r * HAIR.behind), anchorL);
      jointRotation(world, 'head', frame);
      place(this.hair, HAIR.pull, socketPosition(skeleton, world, 'headTop', vb).y);
      this.hair.step(dt, anchorL, frame);
    }
    if (this.cape) {
      const [x, y, z] = capeCorner(skeleton, build);
      jointToWorld(world, 'chest', va.set(x, y, z), anchorL);
      jointToWorld(world, 'chest', va.set(-x, y, z), anchorR);
      jointRotation(world, 'chest', frame);
      const top = Math.max(anchorL.y, anchorR.y) + CAPE.rise * this.cape.left.seg;
      const upright = vb.set(0, 1, 0).applyQuaternion(frame).y > CAPE.upright;
      const behind = vb.set(0, 0, -1).applyQuaternion(frame).setY(0).normalize();
      this.#back.setFromNormalAndCoplanarPoint(behind, va.addVectors(anchorL, anchorR).multiplyScalar(0.5));
      for (const edge of [this.cape.left, this.cape.right]) {
        place(edge, this.#capePull, top);
        edge.planes = upright ? this.#behind : [];
      }
      this.cape.step(dt, anchorL, anchorR, frame);
    }
    if (this.tail) {
      jointToWorld(world, 'pelvis', va.set(0, 0, -(build.chestDepth / 2 + TAIL.gap) * s), anchorL);
      jointRotation(world, 'pelvis', frame);
      place(this.tail, 0, Infinity);
      this.tail.step(dt, anchorL, frame);
    }
  }

  /** The squash and each chain's tip, world metres to 0.1 mm. */
  inspect(): Record<string, unknown> {
    const r = (x: number) => Math.round(x * 1e4) / 1e4 || 0;
    const parts = { hair: this.hair, capeL: this.cape?.left, capeR: this.cape?.right, tail: this.tail };
    const tips = Object.entries(parts).flatMap(([name, c]) => (c ? [[name, c.points[c.n - 1].toArray().map(r)]] : []));
    return { squash: r(this.squash), tips: Object.fromEntries(tips) };
  }
}

/** The cape's left top corner in the chest's frame: behind the left shoulder joint, `inset` in and `drop` down. */
function capeCorner(skeleton: Skeleton, build: Build): [number, number, number] {
  const s = build.size;
  const o = skeleton.offsets;
  const [clavicle, arm] = [jointIndex('clavicleL') * 3, jointIndex('upperArmL') * 3];
  const x = o[clavicle] + o[arm] - CAPE.inset * s;
  const y = o[clavicle + 1] + o[arm + 1] - CAPE.drop * s;
  return [x, y, -(build.chestDepth / 2 + CAPE.gap) * s];
}
