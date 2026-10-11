/**
 * @file Retargeting (PLAN.md §10.4, WP 8.4): a baked clip (bake.ts) played on a skeleton. `retargetPose` copies the
 * rotations, scales the pelvis by the hip-height ratio and plants the feet with contact IK (ik.ts `twoBoneRot`), then
 * lifts a pose that dips below the floor; `clipJSON` makes the same tracks three.js's `AnimationClip` JSON for one
 * skeleton (`AnimationClip.parse`), so a page can play them with an `AnimationMixer`, for presentation only.
 *
 * The rest body's own skeleton (`restSkeleton`) has the humanoid topology with the library's measured bones and rest
 * curve, so FK of a baked pose on it rebuilds the decode's body points (`restPoints`): the parity proof. `restBuild`
 * turns a rest body into a `build` (the mannequin's proportions, gfx/puppets/bodies/mannequin.ts). On another
 * skeleton the copy is aligned at rest: each spine bone, the neck, the head and each foot and toe turns so its bone
 * points where the rest body's does (a build's straight spine takes the library's curve); the limbs' bones run the
 * same way on both, so their rotations copy unchanged. What a build's layout still moves (shoulders in line with the
 * neck, hips beside the pelvis) is measured on the mannequin in tests/baselines/anim-clips.json.
 *
 * From my-3d2dge's `drive` (`my-3d2dge:src/mocap/mocap.js`), its ideas on the rotation skeleton: the sole, not the
 * ankle, goes to the floor (the sole target fades out as the ankle rises 0.3 m); a clip that dips below the ground is
 * lifted by its lowest point; the blade runs along the knuckles (bake.ts turns the hand's +Z to it). The heading
 * trust ramp is not needed: the pelvis carries its whole turn.
 *
 * Invariants: a skeleton's standing hip height is its hip joints' rest height (straight legs: `legUpper + legLower`
 * times `size` for a build); the hip-height ratio is the target's over the rest body's, and every place of the clip
 * scales by it. Feet: the ankle aims where the source's sole is, scaled, plus the target's own ankle height; the foot
 * keeps the clip's turn. Hands reach only inside a format-2 `contacts` interval. Places are metres in the
 * character's frame, the root on the ground at the origin.
 *
 * @example
 * import { createSkeleton } from '../skeleton';
 * import { bakeClip } from './bake';
 * import { REST, standing, clipOf } from '../../../tests/unit/anim/clip-fixtures';
 * const baked = bakeClip(clipOf([standing(0), standing(1)]), REST);
 * const heroic = createSkeleton('build:heroic');
 * hipRatio(baked, heroic); // 0.9924: heroic's straight legs, 0.925 m, over REST's hip joints, 0.9321 m
 * retargetPose(baked, 0.5, heroic).rootPos.y; // -0.0153: REST's pelvis sits under its hip joints, so heroic's does
 * @see engine/anim/clip/retarget.test.ts
 */
import { createRegistry } from '../../core/registry';
import { Quaternion, Vector3 } from '../../core/math';
import { defineBuild, type BuildSpec } from '../builds';
import { createWorldPose, forwardKinematics, jointPosition, socketPosition, tipPosition, type WorldPose } from '../fk';
import { twoBoneRot, type LimbEnd } from '../ik';
import { Pose } from '../pose';
import {
  JOINT_COUNT,
  JOINTS,
  jointIndex,
  PARENTS,
  SOCKET_JOINTS,
  SOCKETS,
  type JointName,
  type Skeleton,
} from '../skeleton';
import { frameQuaternion, rigToEngine, sampleBaked, travelAt, type BakedClip } from './bake';
import { POSE_POINTS, POINT_COUNT } from './readable';
import type { RestBody } from './validate';

/** Contact IK's tuning: the rise (m) of the source's ankle over its standing height at which its sole stops counting. */
export const RETARGET = { soleFade: 0.3 } as const;

const mm = (v: readonly number[]) => rigToEngine(v, new Vector3(), 0.001);
const along = (side: 'L' | 'R', length: number, y = 0, z = 0) => new Vector3(side === 'L' ? length : -length, y, z);

/** A rest body's places for the skeleton: each joint's offset, the tips, the extra points, in metres. */
function restGeometry(R: RestBody) {
  const [Pr, Cr, Hr] = [frameQuaternion(R.Pr), frameQuaternion(R.Cr), frameQuaternion(R.Hr)];
  const unPr = Pr.clone().invert();
  const torso = (v: Vector3) => v.applyQuaternion(unPr);
  const chestOf = (v: Vector3) => torso(v.applyQuaternion(Cr));
  const headOf = (v: Vector3) => torso(v.applyQuaternion(Hr));
  const pitched = (length: number, deg: number) =>
    new Vector3(0, -Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180)).multiplyScalar(length / 1000);
  const off: Partial<Record<JointName, Vector3>> = {
    pelvis: new Vector3(0, R.H0 / 1000, 0),
    spine1: torso(mm(R.spine[0])),
    spine2: torso(mm(R.spine[1])),
    chest: torso(mm(R.spine[2])),
    neck: torso(mm(R.spine[3])),
    head: torso(mm(R.neckSeg)),
  };
  for (const s of ['L', 'R'] as const) {
    off[`clavicle${s}`] = torso(mm(R.clav[s]).applyQuaternion(Cr).add(mm(R.spine[3])));
    off[`upperArm${s}`] = chestOf(mm(R.cv[s]));
    off[`forearm${s}`] = along(s, R.up / 1000);
    off[`hand${s}`] = along(s, R.fore / 1000);
    off[`thigh${s}`] = mm(R.hip[s]);
    off[`shin${s}`] = new Vector3(0, -R.thigh / 1000, 0);
    off[`foot${s}`] = new Vector3(0, -R.shin / 1000, 0);
    off[`toe${s}`] = pitched(R.ab, R.abPitch);
  }
  const top = headOf(mm(R.topH));
  return { off, top, face: headOf(mm(R.faceH)), chestF: chestOf(mm([120, 0, 0])), toe: pitched(R.bt, R.btPitch) };
}

/** The proportions of rest body `R` as a build's fields (metres, size 1): the mannequin's, for the quaternius set. */
export function restBuild(R: RestBody): BuildSpec {
  const sum = R.spine.reduce((a, v) => a.add(mm(v)), new Vector3());
  const [legUpper, legLower, ankleHeight] = [R.thigh / 1000, (R.shin + R.ankleZ) / 1000, R.ankleZ / 1000];
  const legs = (legUpper + legLower) / 0.75; // the chibi default's legs, for the gait fields
  const toeAhead = (R.ab * Math.cos((R.abPitch * Math.PI) / 180) + R.bt) / 1000;
  return {
    ...{ legUpper, legLower, ankleHeight, hipHeight: Math.min(R.H0 / 1000, legUpper + legLower) },
    ...{ hipHalf: Math.abs(R.hip.R[1]) / 1000, footSpread: Math.abs(R.hip.R[1]) / 1000, torso: sum.length() },
    ...{ neck: mm(R.neckSeg).length(), headRadius: mm(R.topH).length() / 2 },
    shoulderHalf: Math.abs(R.clav.R[1] + R.cv.R[1]) / 1000,
    ...{ armUpper: R.up / 1000, armLower: R.fore / 1000, handLength: R.fist / 1000, footLength: toeAhead / 0.75 },
    ...{ stride: 0.40625 * legs, lift: 0.2125 * legs, swing: 0.25 * legs, speedRef: 4.375 * legs },
  };
}

const restSkeletons = new WeakMap<RestBody, Skeleton>();

/**
 * The humanoid skeleton of rest body `R`: its bones measured, its rest curve kept (see the file comment). FK of a
 * baked pose on it rebuilds the decode's points; cached per rest body.
 */
export function restSkeleton(R: RestBody): Skeleton {
  const held = restSkeletons.get(R);
  if (held) return held;
  const g = restGeometry(R);
  const offsets = new Float64Array(JOINT_COUNT * 3);
  const tips = new Float64Array(JOINT_COUNT * 3);
  const socketOffsets = new Float64Array(SOCKETS.length * 3);
  JOINTS.forEach((joint, j) => g.off[joint]?.toArray(offsets, j * 3));
  g.top.toArray(tips, jointIndex('head') * 3);
  const sole = (s: 'L' | 'R') => new Vector3(0, -R.ankleZ / 1000, g.off[`toe${s}`]!.z / 2);
  const socket: Record<string, Vector3> = { headTop: g.top, back: new Vector3(0, 0.05, -0.1) };
  for (const s of ['L', 'R'] as const) {
    along(s, R.fist / 1000).toArray(tips, jointIndex(`hand${s}`) * 3);
    g.toe.toArray(tips, jointIndex(`toe${s}`) * 3);
    [socket[`weapon${s}`], socket[`contact${s}`]] = [along(s, R.fist / 1000), sole(s)];
    socket[`eye${s}`] = g.face.clone().add(along(s, 0.03));
  }
  SOCKETS.forEach((name, i) => socket[name].toArray(socketOffsets, i * 3));
  const lengths = new Float64Array(JOINT_COUNT);
  for (let j = 0; j < JOINT_COUNT; j++) lengths[j] = Math.hypot(offsets[j * 3], offsets[j * 3 + 1], offsets[j * 3 + 2]);
  const socketJoints = SOCKETS.map((name) => jointIndex(SOCKET_JOINTS[name]));
  const build = defineBuild('build:rest', restBuild(R), createRegistry());
  const base = { build, offsets, lengths, tips, socketJoints, socketOffsets, headRadius: build.headRadius, height: 0 };
  const height = tipPosition(base, forwardKinematics(base, new Pose()), 'head').y;
  const skeleton: Skeleton = Object.freeze({ ...base, height });
  restSkeletons.set(R, skeleton);
  return skeleton;
}

/** Each decode point on the rest skeleton: its joint and where on it, metres (index and pinky: ±2 cm on +Z). */
function restMarkers(R: RestBody): { joints: number[]; offsets: Vector3[] } {
  const g = restGeometry(R);
  const at: Record<string, [JointName, Vector3?]> = {
    ...{ pelvis: ['pelvis'], spine1: ['spine1'], spine2: ['spine2'], chest: ['chest'], neck: ['neck'], head: ['head'] },
    ...{ headTop: ['head', g.top], faceF: ['head', g.face], chestF: ['chest', g.chestF] },
    pelvisF: ['pelvis', new Vector3(0, 0, 0.12)],
  };
  for (const s of ['L', 'R'] as const) {
    const fist = R.fist / 1000;
    Object.assign(at, {
      ...{ [`clav${s}`]: [`clavicle${s}`], [`sh${s}`]: [`upperArm${s}`], [`elbow${s}`]: [`forearm${s}`] },
      ...{ [`wrist${s}`]: [`hand${s}`], [`index${s}`]: [`hand${s}`, along(s, fist, 0, 0.02)] },
      ...{
        [`knuck${s}`]: [`hand${s}`, along(s, R.knuck / 1000)],
        [`pinky${s}`]: [`hand${s}`, along(s, fist, 0, -0.02)],
      },
      ...{ [`fist${s}`]: [`hand${s}`, along(s, fist)], [`hip${s}`]: [`thigh${s}`], [`knee${s}`]: [`shin${s}`] },
      ...{ [`ankle${s}`]: [`foot${s}`], [`ball${s}`]: [`toe${s}`], [`toe${s}`]: [`toe${s}`, g.toe] },
    });
  }
  return {
    joints: POSE_POINTS.map((p) => jointIndex(at[p][0])),
    offsets: POSE_POINTS.map((p) => at[p][1] ?? new Vector3()),
  };
}
const markers = new WeakMap<RestBody, ReturnType<typeof restMarkers>>();
const [pt, at, rot] = [new Vector3(), new Vector3(), new Quaternion()];

/**
 * The 36 decode points of `world` (FK on `restSkeleton(R)`), written into `out` as the decode writes them: mm in the
 * rig frame, `[forward, right, up]` in `POSE_POINTS` order.
 */
export function restPoints<T extends { [i: number]: number }>(R: RestBody, world: WorldPose, out: T): T {
  let m = markers.get(R);
  if (!m) markers.set(R, (m = restMarkers(R)));
  for (let i = 0; i < POINT_COUNT; i++) {
    const j = m.joints[i];
    pt.copy(m.offsets[i]).applyQuaternion(rot.fromArray(world.rotations, j * 4));
    pt.add(jointPosition(world, j, at));
    [out[i * 3], out[i * 3 + 1], out[i * 3 + 2]] = [pt.z * 1000, -pt.x * 1000, pt.y * 1000];
  }
  return out;
}

/**
 * A skeleton's standing hip height, metres: its hip joints' rest height (straight legs; for a build, its pelvis's,
 * `legUpper + legLower` times `size`).
 */
export function standingHipHeight(skeleton: Skeleton): number {
  const [l, r] = [jointIndex('thighL'), jointIndex('thighR')];
  return skeleton.offsets[1] + (skeleton.offsets[l * 3 + 1] + skeleton.offsets[r * 3 + 1]) / 2;
}

/** The bones aligned at rest: each joint and the child (or its own tip) its bone runs to. */
// prettier-ignore
const ALIGNED = [
  ['spine0', 'spine1'], ['spine1', 'spine2'], ['spine2', 'chest'], ['chest', 'neck'], ['neck', 'head'], ['head', 'head'],
  ['footL', 'toeL'], ['footR', 'toeR'], ['toeL', 'toeL'], ['toeR', 'toeR'],
] as const;

/** How a source rest body maps onto a skeleton: each joint's rest alignment, the hip-height ratio, the pelvis. */
interface Mapping {
  readonly align: Quaternion[];
  readonly ratio: number;
  readonly pelvis: Vector3;
}
const mappings = new WeakMap<Skeleton, WeakMap<RestBody, Mapping>>();

/** The mapping of rest body `R` onto `skeleton`, made once a pair. */
function mappingOf(R: RestBody, skeleton: Skeleton): Mapping {
  let held = mappings.get(skeleton);
  if (!held) mappings.set(skeleton, (held = new WeakMap()));
  const found = held.get(R);
  if (found) return found;
  const rest = restSkeleton(R);
  const bone = (k: Skeleton, joint: JointName, child: JointName) =>
    new Vector3().fromArray(joint === child ? k.tips : k.offsets, jointIndex(child) * 3).normalize();
  const align = JOINTS.map(() => new Quaternion());
  for (const [joint, child] of ALIGNED) {
    const [from, to] = [bone(skeleton, joint, child), bone(rest, joint, child)];
    if (from.lengthSq() > 0.5 && to.lengthSq() > 0.5) align[jointIndex(joint)].setFromUnitVectors(from, to);
  }
  const ratio = standingHipHeight(skeleton) / standingHipHeight(rest);
  const mapping = { align, ratio, pelvis: new Vector3().fromArray(skeleton.offsets, 0) };
  held.set(R, mapping);
  return mapping;
}

/**
 * The hip-height ratio of `skeleton` to the rest body `baked` was measured on (their standing hip joints): the clip's
 * places scale by it on that skeleton (the pelvis, the feet's targets, the travel).
 */
export const hipRatio = (baked: BakedClip, skeleton: Skeleton) => mappingOf(baked.rest, skeleton).ratio;

const [mq, pq] = [new Quaternion(), new Quaternion()];
/**
 * `source` (a pose on the rest skeleton, its root unturned) as a pose on another skeleton, into `out`: each joint's
 * rotation copied, turned by its rest alignment (a bone of the spine, neck, head or foot points where the source's
 * does), and the pelvis at the source's `hips` times the ratio.
 */
function mapPose(m: Mapping, source: Pose, hips: Vector3, out: Pose): Pose {
  for (let j = 0; j < JOINT_COUNT; j++) {
    mq.fromArray(source.local, j * 4);
    if (PARENTS[j] >= 0) mq.premultiply(pq.copy(m.align[PARENTS[j]]).invert());
    mq.multiply(m.align[j]).toArray(out.local, j * 4);
  }
  out.rootRot.identity();
  out.rootScale.set(1, 1, 1);
  out.rootPos.copy(hips).multiplyScalar(m.ratio).sub(m.pelvis);
  return out;
}

/** What `retargetPose` does beyond the rotation copy. */
export interface RetargetOptions {
  /** Plant the feet (and hands in a `contacts` interval) with IK (true). */
  ik?: boolean;
  /** Lift a pose whose lowest point dips below the floor (true). */
  lift?: boolean;
  /** Format 2's contact intervals, for the hands. */
  contacts?: readonly { part: string; from: number; to: number }[];
  /** FK to fill (a scratch one by default): the result's world pose. */
  world?: WorldPose;
}

const [hips, target, source] = [new Vector3(), new Vector3(), new Vector3()];
const [sourcePose, sourceWorld, scratchWorld] = [new Pose(), createWorldPose(), createWorldPose()];
const LOWEST = ['contactL', 'contactR'] as const;

/**
 * `baked` at `t` seconds on `skeleton`, written into `out` (a new pose by default): the rotations copied and aligned
 * at rest, the pelvis at the clip's hips times the hip-height ratio, the root at the origin unturned; then the feet
 * planted and the pose lifted (`options`). FK is left in `options.world`.
 */
export function retargetPose(
  baked: BakedClip,
  t: number,
  skeleton: Skeleton,
  out = new Pose(),
  options: RetargetOptions = {},
): Pose {
  const world = options.world ?? scratchWorld;
  const m = mappingOf(baked.rest, skeleton);
  const rest = restSkeleton(baked.rest);
  sampleBaked(baked, t, sourcePose.local, hips);
  sourcePose.rootPos.copy(hips).sub(target.fromArray(rest.offsets, 0));
  forwardKinematics(skeleton, mapPose(m, sourcePose, hips, out), world);
  if (options.ik ?? true) {
    forwardKinematics(rest, sourcePose, sourceWorld);
    const ankle = baked.rest.ankleZ / 1000;
    for (const end of ['footL', 'footR'] as const) {
      jointPosition(sourceWorld, end, source);
      const fade = Math.min(1, Math.max(0, 1 - (source.y - ankle) / RETARGET.soleFade));
      const own = -skeleton.socketOffsets[SOCKETS.indexOf(end === 'footL' ? 'contactL' : 'contactR') * 3 + 1];
      target.copy(source).setY(source.y - ankle * fade).multiplyScalar(m.ratio); // prettier-ignore
      target.y = Math.max(0, target.y) + own * fade;
      twoBoneRot(skeleton, out, world, end, target);
    }
    for (const c of options.contacts ?? []) {
      if ((c.part !== 'handL' && c.part !== 'handR') || t < c.from || t > c.to) continue;
      twoBoneRot(skeleton, out, world, c.part as LimbEnd, jointPosition(sourceWorld, c.part, target).multiplyScalar(m.ratio)); // prettier-ignore
    }
  }
  if (options.lift ?? true) {
    let low = 0;
    for (let j = 0; j < JOINT_COUNT; j++) low = Math.min(low, world.positions[j * 3 + 1]);
    for (const s of LOWEST) low = Math.min(low, socketPosition(skeleton, world, s, target).y);
    for (const j of ['toeL', 'toeR', 'handL', 'handR', 'head'] as const) {
      low = Math.min(low, tipPosition(skeleton, world, j, target).y);
    }
    if (low < 0) {
      out.rootPos.y -= low;
      forwardKinematics(skeleton, out, world);
    }
  }
  return out;
}

/** What three.js's `AnimationClip.parse` reads: the clip's name, length and tracks. */
export interface AnimationClipJSON {
  name: string;
  duration: number;
  uuid: string;
  /** three.js's `NormalAnimationBlendMode`. */
  blendMode: 2500;
  tracks: { name: string; type: 'quaternion' | 'vector'; times: number[]; values: number[] }[];
}

/**
 * `baked` as three.js `AnimationClip` JSON for `skeleton`: a `<joint>.quaternion` track per joint (the rotation copy)
 * and `root.position` (the pelvis by the hip-height ratio; with `travel`, plus the clip's travel), keyed on bones
 * named as the puppets' are (`root` and the joints). `AnimationClip.parse(json)` makes the clip; no contact IK.
 */
export function clipJSON(baked: BakedClip, skeleton: Skeleton, options: { travel?: boolean } = {}): AnimationClipJSON {
  const { frames } = baked;
  const m = mappingOf(baked.rest, skeleton);
  const values = JOINTS.map(() => new Array<number>(frames * 4));
  const root = new Array<number>(frames * 3);
  const pose = new Pose();
  const times = Array.from(baked.times);
  for (let i = 0; i < frames; i++) {
    sourcePose.local.set(baked.rotations.subarray(i * JOINT_COUNT * 4, (i + 1) * JOINT_COUNT * 4));
    hips.fromArray(baked.hips, i * 3);
    if (options.travel) hips.add(travelAt(baked, times[i], target));
    mapPose(m, sourcePose, hips, pose).rootPos.toArray(root, i * 3);
    values.forEach((track, j) => {
      for (let c = 0; c < 4; c++) track[i * 4 + c] = pose.local[j * 4 + c];
    });
  }
  const quaternions = JOINTS.map((joint, j) => ({ name: `${joint}.quaternion`, type: 'quaternion' as const, times, values: values[j] })); // prettier-ignore
  const tracks = [...quaternions, { name: 'root.position', type: 'vector' as const, times, values: root }];
  const uuid = `clip:${baked.name}@${skeleton.build.id}`;
  return { name: baked.name, duration: baked.duration, uuid, blendMode: 2500, tracks };
}
