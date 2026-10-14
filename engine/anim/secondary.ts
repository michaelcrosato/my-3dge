/**
 * @file Secondary motion (PLAN.md WP 6.2, §5.2; I-11): what follows the body without driving it. The squash spring
 * shows as a volume-preserving root scale (`squashScale`). `Secondary` is the animator layer (slot `secondary`) that
 * runs chains (engine/anim/chain.ts `Chain`, `Cape`) on a humanoid: hair from the back of the head, a cape from the
 * shoulders, a tail from the pelvis, each colliding with the body's capsules (`bodyCapsules`).
 *
 * Invariants:
 * - View state only: nothing here reaches the sim or its hash. The layer steps in `apply`, once per tick the animator
 *   re-solves, by the body clock's advance since its last step (none at the detail levels that skip the slot).
 * - The squash steps by the chains' inner step (`CHAIN.substep`), so 60 Hz and 120 Hz ticks give the same spring.
 * - A cape on an upright body keeps behind the plane of its top corners (the source's back plane), so a snap turn
 *   never leaves it across the chest.
 * - Metres (the build's lengths times its `size`), m/s², rates per second.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:1832` (the squash spring), `:1900-1916` (hair) and `:2033-2068` (the
 * cape): the body cylinder became bone capsules, and the anchors moved to the 3D body's surface (the build's
 * `chestDepth`).
 *
 * @example
 * import { Vector3 } from '../core/math';
 * import { Animator } from './character';
 * const hero = new Animator({ build: 'build:heroic' });
 * const extras = new Secondary({ hair: 'long', cape: true });
 * hero.use('secondary', extras);
 * extras.kick(3); // a landing's jolt
 * hero.update({ velocity: new Vector3(0, 0, 5) });
 * extras.cape?.left.points.length; // 6: the cape's left edge, world metres, for the view to draw
 * squashScale(0.21).y; // 1.21: taller, and narrower by 1 / 1.1
 * @see engine/anim/secondary.test.ts
 */
import { MathUtils, Plane, Quaternion, Vector3 } from '../core/math';
import type { Build } from './builds';
import { CAPE, Cape, CHAIN, Chain, innerSteps, type BoneCapsule, type CapeOptions, type ChainOptions } from './chain';
import type { Animator } from './character';
import { forwardKinematics, jointPosition, jointRotation, jointToWorld, socketPosition, type WorldPose } from './fk';
import type { GroundProbe } from './ik';
import { jointIndex, type JointName, type Skeleton } from './skeleton';
import type { AnimLayer } from './weights';

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
const [va, vb] = [new Vector3(), new Vector3()];
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
