/**
 * @file Poses (PLAN.md WP 3.4, I-08, I-49): `Pose` holds a root transform and one local rotation per joint of the
 * humanoid skeleton; `blendPoses` crossfades two (slerp or nlerp) under a bone mask, `makeAdditive` and `addPose` make
 * and apply additive layers, and `hashPose` digests one. Forward kinematics (fk.ts) turns a pose into joint positions.
 *
 * Invariants:
 * - Rotations are three.js `Quaternion`s when read or written (`getRotation`, `setRotation`) and flat floats in
 *   storage for speed: `local` is a `Float32Array` of 23 × (x, y, z, w), in `JOINTS` order, relative to the parent
 *   joint's frame; all identities is the skeleton's rest pose. Write unit quaternions (anim.check reports others).
 * - `rootPos`, `rootRot` and `rootScale` place the whole skeleton: FK applies position × rotation × scale to the
 *   pelvis's rest offset, so a crouch lowers `rootPos.y`, and the squash channel scales about the root.
 * - Blending and layers follow three.js's animation mixer: slerp takes the short way round, `t` = 0 and 1 give the
 *   inputs exactly, and an additive layer is reference⁻¹ × pose, applied as base × slerp(identity, delta, weight).
 *   The root's position and scale blend linearly; an additive layer adds the position and multiplies the scale.
 * - `out` may be one of the inputs. Nothing reads a clock or a random stream, so the same inputs give the same bits.
 *
 * @example
 * import { Quaternion, Vector3 } from '../core/math';
 * import { boneMask } from './skeleton';
 * const a = new Pose();
 * const b = new Pose().setRotation('chest', new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 1));
 * const half = blendPoses(a, b, 0.5);
 * 2 * Math.acos(half.getRotation('chest').w); // ≈ 0.5: halfway
 * blendPoses(a, b, 1, new Pose(), { mask: boneMask('legs') }).equals(a); // true: the chest is not a leg
 * hashPose(a) === hashPose(new Pose()); // true
 * @see engine/anim/pose.test.ts
 */
import { Fnv64 } from '../core/hash';
import { Quaternion, Vector3 } from '../core/math';
import { jointIndex, JOINT_COUNT, type BoneMask, type JointName } from './skeleton';

/** A joint, by name or by index in `JOINTS`. */
export type JointRef = JointName | number;

/** How many numbers `toArray` writes: root position (3), rotation (4), scale (3), then 23 × 4 local rotations. */
export const POSE_LENGTH = 10 + JOINT_COUNT * 4;

/** A skeleton pose: the root transform plus each joint's local rotation. A new pose is the rest pose. */
export class Pose {
  /** Where the root stands, in metres, in the space FK writes (the character's own, or the world). */
  readonly rootPos = new Vector3();
  /** The root's rotation: the body's facing (yaw about +Y), and any whole-body tilt. */
  readonly rootRot = new Quaternion();
  /** The squash channel: scale about the root, (1, 1, 1) at rest. */
  readonly rootScale = new Vector3(1, 1, 1);
  /** Each joint's local rotation, (x, y, z, w) in `JOINTS` order. */
  readonly local = new Float32Array(JOINT_COUNT * 4);

  constructor() {
    for (let j = 0; j < JOINT_COUNT; j++) this.local[j * 4 + 3] = 1;
  }

  /** The local rotation of `joint`, written into `out`. Throws `ANIM_UNKNOWN_JOINT`. */
  getRotation(joint: JointRef, out: Quaternion = new Quaternion()): Quaternion {
    return out.fromArray(this.local, jointIndex(joint) * 4);
  }

  /** Sets the local rotation of `joint` (a unit quaternion). Throws `ANIM_UNKNOWN_JOINT`. */
  setRotation(joint: JointRef, rotation: Quaternion): this {
    rotation.toArray(this.local, jointIndex(joint) * 4);
    return this;
  }

  /** Back to the rest pose: the root at the origin, unturned and unscaled, every rotation the identity. */
  reset(): this {
    this.rootPos.set(0, 0, 0);
    this.rootRot.identity();
    this.rootScale.set(1, 1, 1);
    this.local.fill(0);
    for (let j = 0; j < JOINT_COUNT; j++) this.local[j * 4 + 3] = 1;
    return this;
  }

  /** Copies `pose` into this one. */
  copy(pose: Pose): this {
    this.rootPos.copy(pose.rootPos);
    this.rootRot.copy(pose.rootRot);
    this.rootScale.copy(pose.rootScale);
    this.local.set(pose.local);
    return this;
  }

  /** A new pose equal to this one. */
  clone(): Pose {
    return new Pose().copy(this);
  }

  /** Whether `pose` holds exactly the same numbers. */
  equals(pose: Pose): boolean {
    return (
      this.rootPos.equals(pose.rootPos) &&
      this.rootRot.equals(pose.rootRot) &&
      this.rootScale.equals(pose.rootScale) &&
      this.local.every((value, i) => value === pose.local[i])
    );
  }

  /** The pose as `POSE_LENGTH` numbers, as three.js's `toArray` writes: root position, rotation, scale, locals. */
  toArray(array: number[] = [], offset = 0): number[] {
    this.rootPos.toArray(array, offset);
    this.rootRot.toArray(array, offset + 3);
    this.rootScale.toArray(array, offset + 7);
    for (let i = 0; i < this.local.length; i++) array[offset + 10 + i] = this.local[i];
    return array;
  }

  /** Reads what `toArray` wrote. */
  fromArray(array: ArrayLike<number>, offset = 0): this {
    this.rootPos.fromArray(array, offset);
    this.rootRot.fromArray(array, offset + 3);
    this.rootScale.fromArray(array, offset + 7);
    for (let i = 0; i < this.local.length; i++) this.local[i] = array[offset + 10 + i];
    return this;
  }
}

/** How `blendPoses` blends. */
export interface BlendOptions {
  /** How much of the blend reaches each joint and the root (`boneMask`); everything when absent. */
  mask?: BoneMask;
  /** `slerp` (the default: constant speed) or `nlerp` (cheaper, for crowds; the same ends, a slightly uneven middle). */
  method?: 'slerp' | 'nlerp';
}

/** A flat array of quaternions: (x, y, z, w) from an offset. */
type Flat = Float32Array | Float64Array;

/**
 * three.js's flat quaternion helpers. They take typed arrays (three's own animation mixer passes them), though
 * @types/three declares `number[]`.
 */
const flat = Quaternion as unknown as {
  slerpFlat(dst: Flat, dstOffset: number, a: Flat, aOffset: number, b: Flat, bOffset: number, t: number): void;
  multiplyQuaternionsFlat(dst: Flat, dstOffset: number, a: Flat, aOffset: number, b: Flat, bOffset: number): void;
};

/** Scratch quaternions, flat: [0, 4) and [4, 8) hold inputs, [8, 12) a result. */
const scratch = new Float64Array(12);
/** A scratch quaternion and vector, so `out` may alias an input. */
const tmpQ = new Quaternion();
const tmpV = new Vector3();

/** dst[d..d+4) = normalize(a + (b − a) t), b taken on a's side of the sphere; exactly a or b at t = 0 or 1. */
function nlerpFlat(
  dst: Float32Array | Float64Array,
  d: number,
  a: ArrayLike<number>,
  i: number,
  b: ArrayLike<number>,
  k: number,
  t: number,
): void {
  if (t === 0 || t === 1) {
    const [src, o] = t === 0 ? [a, i] : [b, k];
    for (let c = 0; c < 4; c++) dst[d + c] = src[o + c];
    return;
  }
  const sign = a[i] * b[k] + a[i + 1] * b[k + 1] + a[i + 2] * b[k + 2] + a[i + 3] * b[k + 3] < 0 ? -1 : 1;
  const s = 1 - t;
  const u = t * sign;
  const x = a[i] * s + b[k] * u;
  const y = a[i + 1] * s + b[k + 1] * u;
  const z = a[i + 2] * s + b[k + 2] * u;
  const w = a[i + 3] * s + b[k + 3] * u;
  const n = Math.hypot(x, y, z, w) || 1;
  dst[d] = x / n;
  dst[d + 1] = y / n;
  dst[d + 2] = z / n;
  dst[d + 3] = w / n;
}

/** `out.rootRot` = slerp(a, b, t), safe when `out` is `a` or `b`. */
function slerpRoot(out: Quaternion, a: Quaternion, b: Quaternion, t: number): void {
  a.toArray(scratch, 0);
  b.toArray(scratch, 4);
  flat.slerpFlat(scratch, 8, scratch, 0, scratch, 4, t);
  out.fromArray(scratch, 8);
}

/**
 * The pose `t` of the way from `a` to `b` (0 gives `a`, 1 gives `b`), each joint's share scaled by `options.mask`,
 * written into `out` (a new pose by default; `a` or `b` may be `out`).
 */
export function blendPoses(a: Pose, b: Pose, t: number, out: Pose = new Pose(), options: BlendOptions = {}): Pose {
  const { mask, method = 'slerp' } = options;
  const rootT = t * (mask ? mask.root : 1);
  out.rootPos.lerpVectors(a.rootPos, b.rootPos, rootT);
  out.rootScale.lerpVectors(a.rootScale, b.rootScale, rootT);
  slerpRoot(out.rootRot, a.rootRot, b.rootRot, rootT);
  for (let j = 0; j < JOINT_COUNT; j++) {
    const share = mask ? t * mask.weights[j] : t;
    if (method === 'nlerp') nlerpFlat(out.local, j * 4, a.local, j * 4, b.local, j * 4, share);
    else flat.slerpFlat(out.local, j * 4, a.local, j * 4, b.local, j * 4, share);
  }
  return out;
}

/** dst[0..4) = conjugate(src[i..i+4)): the inverse of a unit quaternion. */
function conjugate(dst: Float64Array, src: ArrayLike<number>, i: number): Float64Array {
  dst[0] = -src[i];
  dst[1] = -src[i + 1];
  dst[2] = -src[i + 2];
  dst[3] = src[i + 3];
  return dst;
}

/**
 * The additive layer that turns `reference` into `pose`: each joint's reference⁻¹ × pose, the root's position
 * difference, rotation difference and scale ratio, written into `out`. `addPose(reference, layer)` gives `pose` back.
 */
export function makeAdditive(pose: Pose, reference: Pose, out: Pose = new Pose()): Pose {
  out.rootPos.subVectors(pose.rootPos, reference.rootPos);
  out.rootScale.copy(tmpV.copy(pose.rootScale).divide(reference.rootScale));
  out.rootRot.copy(tmpQ.copy(reference.rootRot).invert().multiply(pose.rootRot));
  for (let j = 0; j < JOINT_COUNT; j++) {
    const inverse = conjugate(scratch, reference.local, j * 4);
    flat.multiplyQuaternionsFlat(out.local, j * 4, inverse, 0, pose.local, j * 4);
  }
  return out;
}

/** The identity rotation, flat. */
const IDENTITY = new Float64Array([0, 0, 0, 1]);

/**
 * `base` with the additive `layer` (from `makeAdditive`) applied at `weight` (0–1, scaled per joint by `mask`):
 * each joint becomes base × slerp(identity, delta, weight), written into `out` (`base` may be `out`).
 */
export function addPose(base: Pose, layer: Pose, weight = 1, out: Pose = new Pose(), mask?: BoneMask): Pose {
  const rootW = weight * (mask ? mask.root : 1);
  out.rootPos.copy(base.rootPos).addScaledVector(layer.rootPos, rootW);
  out.rootScale.set(
    base.rootScale.x * (1 + (layer.rootScale.x - 1) * rootW),
    base.rootScale.y * (1 + (layer.rootScale.y - 1) * rootW),
    base.rootScale.z * (1 + (layer.rootScale.z - 1) * rootW),
  );
  layer.rootRot.toArray(scratch, 0);
  flat.slerpFlat(scratch, 8, IDENTITY, 0, scratch, 0, rootW);
  out.rootRot.copy(base.rootRot).multiply(tmpQ.fromArray(scratch, 8));
  for (let j = 0; j < JOINT_COUNT; j++) {
    flat.slerpFlat(scratch, 8, IDENTITY, 0, layer.local, j * 4, mask ? weight * mask.weights[j] : weight);
    flat.multiplyQuaternionsFlat(out.local, j * 4, base.local, j * 4, scratch, 8);
  }
  return out;
}

/** The pose's 64-bit FNV-1a digest (16 hex digits) over the numbers `toArray` gives: equal numbers, equal hash. */
export function hashPose(pose: Pose): string {
  const { rootPos: p, rootRot: q, rootScale: s } = pose;
  const hash = new Fnv64().number(p.x).number(p.y).number(p.z).number(q.x).number(q.y).number(q.z).number(q.w);
  return hash.number(s.x).number(s.y).number(s.z).numbers(pose.local).hex();
}
