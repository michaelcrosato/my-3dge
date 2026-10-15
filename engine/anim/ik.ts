/**
 * @file Inverse kinematics for the humanoid skeleton (PLAN.md WP 3.5, I-11): `twoBone` (my-3d2dge's `ik3`) places a
 * limb's middle joint, `twoBoneRot` turns a leg or an arm to a target with a pole, `aim` spreads a look-at over chest,
 * neck and head within limits, and `handTo` puts a grip in a hand; `GroundProbe` is how a solver asks for the ground
 * (engine/anim/footPlant.ts's `footPlant`, moved there after G9, stands the feet on it).
 *
 * Invariants:
 * - Each solver takes a pose and its FK and keeps them in step: it writes local rotations and runs FK again. Targets,
 *   poles and rotations are world space. Fade a solve with `blendPoses`.
 * - Limbs solve in model space (the root transform undone), so bone lengths hold under any root position, turn and
 *   squash. Knees and elbows are hinges: the middle joint turns about its `LIMBS` hinge only, by 0 to π, and keeps
 *   its twist; the upper joint's roll follows the pole, and without a pole the bend keeps its direction.
 * - `twoBone` is `ik3` verbatim in metres, in the source's axis order: the source's bits under (x, y, z)/16 →
 *   (x, z, y). One fix: a pole along the limb falls back to a unit horizontal (the source's was not unit length).
 * - Nothing reads a clock or a random stream.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:129-140` (`ik3`).
 *
 * @example
 * import { Vector3 } from '../core/math';
 * import { forwardKinematics } from './fk';
 * import { Pose } from './pose';
 * import { createSkeleton } from './skeleton';
 * twoBone(new Vector3(0, 1, 0), new Vector3(0, 0.2, 0), 0.5, 0.5, new Vector3(0, 0, 1))[0]; // ≈ (0, 0.6, 0.3)
 * const skeleton = createSkeleton('build:heroic');
 * const pose = new Pose();
 * const world = forwardKinematics(skeleton, pose);
 * twoBoneRot(skeleton, pose, world, 'footL', new Vector3(0.15, 0.3, 0.2)); // ≈ 0: the ankle is on the target
 * aim(skeleton, pose, world, new Vector3(1, 1.8, 3)); // ≈ 0: the gaze is on the point
 * handTo(skeleton, pose, world, 'handR', new Vector3(-0.3, 1.1, 0.35)); // ≈ 0: the grip is in the hand
 * @see engine/anim/ik.test.ts
 */
import { codeError, defineCodes, didYouMean } from '../core/log';
import { angDiff, MathUtils, Matrix4, Quaternion, swingTwist, Vector3 } from '../core/math';
import { forwardKinematics, jointToWorld, socketPosition, type WorldPose } from './fk';
import type { Pose } from './pose';
import { JOINT_COUNT, jointIndex, PARENTS, socketIndex, type JointName, type Skeleton } from './skeleton';

/** The codes this module raises, with their fixes. */
export const IK_CODES = defineCodes('anim', {
  ANIM_BAD_TARGET: {
    template: 'the {what} given to {solver} is ({x}, {y}, {z})',
    fix: 'pass finite world coordinates in metres',
    doc: 'Raised by the IK solvers (engine/anim/ik.ts) for a target, pole or grip with a coordinate that is NaN or infinite, which would spread NaN through the pose.',
  },
});

/** A joint that ends a two-bone limb: an ankle or a wrist. */
export type LimbEnd = 'footL' | 'footR' | 'handL' | 'handR';

/**
 * A two-bone limb: the joint it hangs from (`upper`: hip or shoulder), its hinge (`middle`: knee or elbow), and the
 * hinge's axis in the upper joint's frame (`hinge`; a positive turn bends the shin back and the forearm forward).
 */
export type Limb = Readonly<{ upper: JointName; middle: JointName; hinge: readonly [number, number, number] }>;

/** The skeleton's four limbs, by their end joint. Each is straight at rest (skeleton.ts). */
export const LIMBS: Readonly<Record<LimbEnd, Limb>> = {
  footL: { upper: 'thighL', middle: 'shinL', hinge: [1, 0, 0] },
  footR: { upper: 'thighR', middle: 'shinR', hinge: [1, 0, 0] },
  handL: { upper: 'upperArmL', middle: 'forearmL', hinge: [0, -1, 0] },
  handR: { upper: 'upperArmR', middle: 'forearmR', hinge: [0, 1, 0] },
};

/** `ik3`'s 0.01-unit margin in metres: a limb stops this short of straight, and a target is never nearer. */
export const SLACK = 0.01 / 16;

/** Scratch objects, so the solvers allocate nothing. */
const v = Array.from({ length: 16 }, () => new Vector3());
const q = Array.from({ length: 10 }, () => new Quaternion());
const basis = new Matrix4();
const pair: [Vector3, Vector3] = [v[3], v[4]];
const [UP, FORWARD, ORIGIN] = [new Vector3(0, 1, 0), new Vector3(0, 0, 1), new Vector3()];
/** The inverse of the current pose's root rotation. */
const rootInverse = new Quaternion();
/** The unit direction `twoBone` last bent in, from the root–end line toward the middle joint. */
const BEND = new Vector3();

/** Throws `ANIM_BAD_TARGET` unless every coordinate of `p` is finite. */
function finite({ x, y, z }: Vector3, what: string, solver: string): void {
  if (!Number.isFinite(x + y + z)) throw codeError('ANIM_BAD_TARGET', { what, solver, x, y, z });
}

/** The limb `end` ends; `ANIM_UNKNOWN_JOINT` when it is none of `ends`. */
function limbOf(end: string, ends: readonly string[] = Object.keys(LIMBS)): Limb {
  if (ends.includes(end)) return LIMBS[end as LimbEnd];
  const values = { name: JSON.stringify(end), what: 'limb end', suggestion: didYouMean(end, ends) };
  throw codeError('ANIM_UNKNOWN_JOINT', { ...values, names: ends.join(', ') });
}

/** World point `p` (or direction, with `direction`) in model space: the root's position, turn and scale undone. */
function toModel(pose: Pose, p: Vector3, out: Vector3, direction = false): Vector3 {
  out.copy(p);
  if (!direction) out.sub(pose.rootPos);
  return out.applyQuaternion(rootInverse).divide(pose.rootScale);
}

/** Joint `j`'s rotation in model space (the identity for the root, `j` = −1). */
function modelRotation(world: WorldPose, j: number, out: Quaternion): Quaternion {
  return j < 0 ? out.identity() : out.fromArray(world.rotations, j * 4).premultiply(rootInverse);
}

/** Two new vectors for `twoBone` to write: the middle joint and the end. */
const pairOf = (): [joint: Vector3, end: Vector3] => [new Vector3(), new Vector3()];

/**
 * Two-bone IK on positions (`ik3`): the middle joint (knee, elbow) and the end of a limb of bone lengths `upper` and
 * `lower` from `root` toward `target`, bent toward the direction `pole`; out of reach, the end stops on the line to
 * the target. Writes into `out` and returns it.
 */
export function twoBone(root: Vector3, target: Vector3, upper: number, lower: number, pole: Vector3, out = pairOf()) {
  // the source's axis order is (x, y, z) with z up: ours is (x, z, y)
  const [joint, end] = out;
  const ax = root.x, ay = root.y, az = root.z; // prettier-ignore
  let dx = target.x - ax, dy = target.y - ay, dz = target.z - az; // prettier-ignore
  let dist = Math.hypot(dx, dz, dy);
  const max = upper + lower - SLACK;
  if (dist > max) {
    const s = max / dist;
    [dx, dy, dz] = [dx * s, dy * s, dz * s];
    end.set(ax + dx, ay + dy, az + dz);
    dist = max;
  } else end.copy(target);
  dist = Math.max(dist, SLACK);
  const inv = 1 / dist;
  const nx = dx * inv, ny = dy * inv, nz = dz * inv; // prettier-ignore
  const along = pole.x * nx + pole.z * nz + pole.y * ny;
  let hx = pole.x - nx * along, hy = pole.y - ny * along, hz = pole.z - nz * along; // prettier-ignore
  const hl = Math.hypot(hx, hz, hy);
  const flat = Math.hypot(nz, nx); // a pole along the limb: a horizontal, or forward for a vertical limb
  if (hl < 1e-4) [hx, hy, hz] = flat < 1e-4 ? [0, 0, 1] : [nz / flat, 0, -nx / flat];
  else [hx, hy, hz] = [hx * (1 / hl), hy * (1 / hl), hz * (1 / hl)];
  BEND.set(hx, hy, hz);
  const x = (upper * upper - lower * lower + dist * dist) / (2 * dist);
  const y = Math.sqrt(Math.max(0, upper * upper - x * x));
  joint.set(ax + nx * x + hx * y, ay + ny * x + hy * y, az + nz * x + hz * y);
  return out;
}

/** How `twoBoneRot` and `handTo` solve. To fade a solve in or out, blend the poses before and after it. */
export interface TwoBoneOptions {
  /** The world direction the knee or elbow bends toward; by default the way it bends now. */
  pole?: Vector3;
  /** The end joint's world rotation afterwards; by default the one it has now. */
  rotation?: Quaternion;
  /** A point in the end joint's frame (a socket's offset) to bring to the target instead of the joint. */
  offset?: Vector3;
}

/**
 * Turns the limb ending at `end` (an ankle or a wrist) through its three joints' local rotations so the end reaches
 * `target`, then runs FK. Returns how far short it stops (0 in reach). Throws `ANIM_UNKNOWN_JOINT`, `ANIM_BAD_TARGET`.
 */
export function twoBoneRot(
  skeleton: Skeleton,
  pose: Pose,
  world: WorldPose,
  end: LimbEnd,
  target: Vector3,
  options: TwoBoneOptions = {},
): number {
  const limb = limbOf(end);
  finite(target, 'target', 'twoBoneRot');
  if (options.pole) finite(options.pole, 'pole', 'twoBoneRot');
  const [e, m, r] = [jointIndex(end), jointIndex(limb.middle), jointIndex(limb.upper)];
  const [a, t, pole, joint, tip, u0, h0, v0, u, n, w] = v;
  const [parent, upper, last, rest, solved, middle, swing, twist] = q;
  rootInverse.copy(pose.rootRot).invert();
  u0.fromArray(skeleton.offsets, m * 3).normalize();
  v0.fromArray(skeleton.offsets, e * 3).normalize();
  h0.fromArray(limb.hinge);
  toModel(pose, a.fromArray(world.positions, r * 3), a);
  toModel(pose, target, t);
  modelRotation(world, PARENTS[r], parent);
  modelRotation(world, r, upper);
  if (options.rotation) last.copy(options.rotation).premultiply(rootInverse);
  else modelRotation(world, e, last);
  if (options.offset) t.sub(w.copy(options.offset).applyQuaternion(last));
  if (options.pole) toModel(pose, options.pole, pole, true);
  else pole.crossVectors(u0, h0).applyQuaternion(upper);
  twoBone(a, t, skeleton.lengths[m], skeleton.lengths[e], pole, pair);
  // the upper joint takes the rest bone and hinge (u0, h0) to the bone and bend normal (u, n)
  u.subVectors(joint, a).normalize();
  n.crossVectors(BEND, w.subVectors(tip, a).normalize());
  rest.setFromRotationMatrix(basis.makeBasis(u0, h0, w.crossVectors(u0, h0)));
  solved.setFromRotationMatrix(basis.makeBasis(u, n, w.crossVectors(u, n))).multiply(rest.invert());
  // the middle joint bends about its hinge, from u to the lower bone, and keeps its twist
  w.subVectors(tip, joint).normalize();
  const angle = Math.atan2(v[14].crossVectors(u, w).dot(n), u.dot(w));
  swingTwist(pose.getRotation(m, middle), v0, swing, twist);
  middle.setFromAxisAngle(h0, angle).multiply(twist);
  pose.setRotation(r, parent.invert().multiply(solved));
  pose.setRotation(m, middle);
  pose.setRotation(e, solved.multiply(middle).invert().multiply(last));
  forwardKinematics(skeleton, pose, world);
  return jointToWorld(world, e, options.offset ?? ORIGIN, v[13]).distanceTo(target);
}

/**
 * One joint of an aim chain: the `joint`, its `share` of the turn (a chain's shares need not add up to 1), and the
 * most it turns the gaze left or right (`yaw`) and up or down (`pitch`), in radians.
 */
export type AimLink = Readonly<{ joint: JointName; share: number; yaw: number; pitch: number }>;

/** The default chain, from the body up: about 103° of yaw and 69° of pitch in all. */
export const AIM_CHAIN: readonly AimLink[] = [
  { joint: 'chest', share: 0.2, yaw: 0.5, pitch: 0.25 },
  { joint: 'neck', share: 0.3, yaw: 0.6, pitch: 0.45 },
  { joint: 'head', share: 0.5, yaw: 0.7, pitch: 0.5 },
];

/** How `aim` turns. To fade it in or out, blend the poses before and after (`blendPoses`). */
export interface AimOptions {
  /** The joints that share the turn, from the body up; `AIM_CHAIN` by default. */
  chain?: readonly AimLink[];
}

/** How far each link has turned the gaze: yaw, pitch. */
const turned = new Float64Array(JOINT_COUNT * 2);

/** The gaze in model space: from between the eyes (`eyes`) along the head's +Z (`forward`). */
function gaze(skeleton: Skeleton, pose: Pose, world: WorldPose, eyes: Vector3, forward: Vector3): void {
  socketPosition(skeleton, world, 'eyeL', eyes).add(socketPosition(skeleton, world, 'eyeR', v[13]));
  toModel(pose, eyes.multiplyScalar(0.5), eyes);
  forward.copy(FORWARD).applyQuaternion(modelRotation(world, jointIndex('head'), q[8]));
}

/**
 * Turns the chain so the gaze (from between the eyes along the head's +Z) points at `target`: each joint takes its
 * share within its limits, then passes from the head down take up the rest. Runs FK; returns the angle the gaze
 * still misses by, in radians (0 within the limits). Throws `ANIM_BAD_TARGET`.
 */
export function aim(
  skeleton: Skeleton,
  pose: Pose,
  world: WorldPose,
  target: Vector3,
  options: AimOptions = {},
): number {
  finite(target, 'target', 'aim');
  const chain = options.chain ?? AIM_CHAIN;
  rootInverse.copy(pose.rootRot).invert();
  const goal = toModel(pose, target, v[8]);
  /** Turns link `i` by `share` of what the gaze still lacks, within its limits, as pitch then yaw in model space. */
  const turn = (i: number, share: number) => {
    const [eyes, forward, to, axis] = [v[9], v[10], v[11], v[12]];
    gaze(skeleton, pose, world, eyes, forward);
    if (to.subVectors(goal, eyes).lengthSq() < 1e-12) return;
    to.normalize();
    const yaw = angDiff(Math.atan2(forward.x, forward.z), Math.atan2(to.x, to.z));
    const pitch = Math.atan2(to.y, Math.hypot(to.x, to.z)) - Math.atan2(forward.y, Math.hypot(forward.x, forward.z));
    const dy = MathUtils.clamp(turned[i * 2] + yaw * share, -chain[i].yaw, chain[i].yaw) - turned[i * 2];
    const dp = MathUtils.clamp(turned[i * 2 + 1] + pitch * share, -chain[i].pitch, chain[i].pitch) - turned[i * 2 + 1];
    turned[i * 2] += dy;
    turned[i * 2 + 1] += dp;
    const delta = q[0].setFromAxisAngle(axis.set(-forward.z, 0, forward.x).normalize(), dp);
    delta.premultiply(q[1].setFromAxisAngle(UP, dy));
    const j = jointIndex(chain[i].joint);
    const rotation = modelRotation(world, j, q[2]).premultiply(delta);
    pose.setRotation(j, modelRotation(world, PARENTS[j], q[3]).invert().multiply(rotation));
    forwardKinematics(skeleton, pose, world);
  };
  turned.fill(0);
  let left = chain.reduce((sum, link) => sum + link.share, 0);
  chain.forEach((link, i) => {
    turn(i, left > 0 ? link.share / left : 1);
    left -= link.share;
  });
  for (let pass = 0; pass < 3; pass++) for (let i = chain.length - 1; i >= 0; i--) turn(i, 1);
  gaze(skeleton, pose, world, v[9], v[10]);
  return v[10].angleTo(v[11].subVectors(goal, v[9]));
}

/** Where a ground probe hit, in world space: the `point`, and the surface's unit `normal` there. */
export type GroundHit = { readonly point: Vector3; readonly normal: Vector3 };

/** Casts a ray straight down from `origin`, at most `distance` metres; on a hit it fills `hit` and returns true. */
export type GroundProbe = (origin: Vector3, distance: number, hit: GroundHit) => boolean;

/** `handTo`'s scratch: the weapon socket's offset in the hand's frame. */
const grasp = new Vector3();

/**
 * `twoBoneRot` for the arm of `hand`, bringing its weapon socket (`weaponL`, `weaponR`) to `grip`: returns how far
 * the socket stays from it (0 in reach). Throws `ANIM_UNKNOWN_JOINT` or `ANIM_BAD_TARGET`.
 */
export function handTo(
  skeleton: Skeleton,
  pose: Pose,
  world: WorldPose,
  hand: 'handL' | 'handR',
  grip: Vector3,
  options: TwoBoneOptions = {},
): number {
  limbOf(hand, ['handL', 'handR']);
  finite(grip, 'grip', 'handTo');
  const offset = grasp.fromArray(skeleton.socketOffsets, socketIndex(hand === 'handL' ? 'weaponL' : 'weaponR') * 3);
  return twoBoneRot(skeleton, pose, world, hand, grip, { ...options, offset });
}
