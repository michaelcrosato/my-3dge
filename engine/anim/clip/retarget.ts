/**
 * @file Retargeting (PLAN.md §10.4, WP 8.4): a baked clip (bake.ts) played on a skeleton. `retargetPose` copies the
 * rotations, stands the hip joints where the clip's are by the hip-height ratio, plants the feet with contact IK
 * (ik.ts `twoBoneRot`) and lifts a pose that dips below the floor; `clipJSON` makes the same tracks three.js's
 * `AnimationClip` JSON for one skeleton, so a page can play them with an `AnimationMixer`, for presentation only.
 *
 * The rest body's own skeleton (engine/anim/clip/rest.ts's `restSkeleton`, split from here after G9) is the source
 * the copy reads. On another skeleton the copy is aligned at rest: each spine bone, the neck, the head and each foot
 * and toe turns so its bone points where the rest body's does (a build's straight spine takes the library's curve);
 * the limbs' bones run the same way on both, so their rotations copy unchanged. What a build's layout still moves (shoulders in line with the
 * neck; hips level with the pelvis, so its spine stands on its hips, 10 cm under CMU's pelvis and 5 cm ahead of
 * Quaternius') is measured on the mannequin in tests/baselines/anim-clips.json.
 *
 * From my-3d2dge's `drive` (`my-3d2dge:src/mocap/mocap.js`), its ideas on the rotation skeleton: the legs hang from
 * the hip joints' centre, scaled (`hipC`, `mocap.js:200`); the sole, not the ankle, goes to the floor; a clip that
 * dips below the ground is lifted by its lowest point (here only by how far it sinks below the source's own, so a
 * clip that goes below its floor keeps its depth); the blade runs along the knuckles (bake.ts turns the hand's +Z
 * to it), and a held blade (`blade`, its length) never goes below the floor: the hand turns its tip up until the
 * blade lies along the floor, keeping its heading (`mocap.js:251-257`). The heading trust ramp is not needed: the
 * pelvis carries its whole turn.
 *
 * Invariants: a skeleton's standing hip height is its hip joints' rest height (straight legs: `legUpper + legLower`
 * times `size` for a build); the hip-height ratio is the target's over the rest body's, and every place of the clip
 * scales by it: the hip joints' centre, the feet, the hands, the travel. Feet: each ankle aims where the source's is,
 * at the height that puts the foot's lowest point (sole, ball or toe tip) where the source's is, never below the
 * floor, and keeps the clip's turn; the knee bends toward the source's knee once it stands `KNEE_POLE` off its
 * hip–ankle line (after G9); the pelvis drops as far as the lower foot needs to reach with a straight leg
 * (footPlant.ts `footPlant`'s rule), fully for a foot on the floor, not at all `soleFade` up. Hands reach only inside a
 * format-2 `contacts` interval (a loop's on every lap). Places are metres in the character's frame, root at the origin.
 *
 * @example
 * import { createSkeleton } from '../skeleton';
 * import { bakeClip } from './bake';
 * import { REST, standing, clipOf } from '../../../tests/unit/anim/clip-fixtures';
 * const baked = bakeClip(clipOf([standing(0), standing(1)]), REST);
 * const heroic = createSkeleton('build:heroic');
 * hipRatio(baked, heroic); // 0.9924: heroic's straight legs, 0.925 m, over REST's hip joints, 0.9321 m
 * retargetPose(baked, 0.5, heroic).rootPos; // ≈ (0, -0.0027, 0.0511): its hips on REST's, 5 cm ahead of REST's pelvis
 * @see engine/anim/clip/retarget.test.ts
 */
import { MathUtils, Quaternion, Vector3 } from '../../core/math';
import { holdAlong } from '../authoring';
import { createWorldPose, forwardKinematics, jointPosition, jointRotation, socketPosition, tipPosition } from '../fk';
import type { WorldPose } from '../fk';
import { twoBoneRot, type LimbEnd } from '../ik';
import { Pose } from '../pose';
import { JOINT_COUNT, JOINTS, jointIndex, PARENTS } from '../skeleton';
import type { JointName, Skeleton } from '../skeleton';
import { frameAt, sampleBaked, travelAt, type BakedClip } from './bake';
import { restSkeleton } from './rest';
import type { RestBody } from './validate';

/**
 * Contact IK's tuning: the height (m) of the source's foot's lowest point at which the foot stops pulling the pelvis
 * down; the height (m) a held blade's tip keeps over the floor (drive's 0.3 units).
 */
export const RETARGET = { soleFade: 0.3, bladeFloor: 0.3 / 16 } as const;

const HIPS = [jointIndex('thighL') * 3, jointIndex('thighR') * 3] as const;
const [at, rot] = [new Vector3(), new Quaternion()];
/** The centre of a skeleton's hip joints, in the pelvis's frame. */
const hipCentre = (k: Skeleton) =>
  new Vector3().fromArray(k.offsets, HIPS[0]).lerp(at.fromArray(k.offsets, HIPS[1]), 0.5);

/**
 * A skeleton's standing hip height, metres: its hip joints' rest height (straight legs; for a build, its pelvis's,
 * `legUpper + legLower` times `size`).
 */
export const standingHipHeight = (skeleton: Skeleton) => skeleton.offsets[1] + hipCentre(skeleton).y;

/** The bones aligned at rest: each joint and the child (or its own tip) its bone runs to. */
// prettier-ignore
const ALIGNED = [
  ['spine0', 'spine1'], ['spine1', 'spine2'], ['spine2', 'chest'], ['chest', 'neck'], ['neck', 'head'], ['head', 'head'],
  ['footL', 'toeL'], ['footR', 'toeR'], ['toeL', 'toeL'], ['toeR', 'toeR'],
] as const;

/**
 * How a source rest body maps onto a skeleton: each joint's rest alignment, the hip-height ratio, the pelvis's offset,
 * and the `shift` from the source's pelvis, scaled, to the skeleton's that puts their hip joints' centres (`hipCentre`)
 * together, in the pelvis's frame.
 */
type Mapping = Readonly<{ align: Quaternion[]; ratio: number; pelvis: Vector3; shift: Vector3 }>;
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
  const shift = hipCentre(rest).multiplyScalar(ratio).sub(hipCentre(skeleton).applyQuaternion(align[0]));
  const mapping = { align, ratio, pelvis: new Vector3().fromArray(skeleton.offsets, 0), shift };
  held.set(R, mapping);
  return mapping;
}

/**
 * The hip-height ratio of `skeleton` to the rest body `baked` was measured on (their standing hip joints): the clip's
 * places scale by it on that skeleton (the hip joints, the feet's goals, the travel).
 */
export const hipRatio = (baked: BakedClip, skeleton: Skeleton) => mappingOf(baked.rest, skeleton).ratio;

const [mq, pq, own] = [new Quaternion(), new Quaternion(), new Vector3()];
/**
 * `source`'s local rotations (a pose on the rest skeleton) as another skeleton's, into `out`, its root unturned: each
 * copied, turned by its rest alignment (a bone of the spine, neck, head or foot points where the source's does).
 */
function mapPose(m: Mapping, source: Pose, out: Pose): Pose {
  for (let j = 0; j < JOINT_COUNT; j++) {
    mq.fromArray(source.local, j * 4);
    if (PARENTS[j] >= 0) mq.premultiply(pq.copy(m.align[PARENTS[j]]).invert());
    mq.multiply(m.align[j]).toArray(out.local, j * 4);
  }
  out.rootRot.identity();
  out.rootScale.set(1, 1, 1);
  return out;
}

/**
 * Frame `k`'s root on the mapped skeleton: its hip joints' centre where the source's is, times the ratio, so the legs
 * stand where the source's do whether the hips sit level with the pelvis (a build's) or under it (CMU's, by 10 cm).
 * Between frames the root moves straight, as three.js's mixer plays `clipJSON`'s `root.position`.
 */
function rootAt(m: Mapping, baked: BakedClip, k: number, out: Vector3): Vector3 {
  out.copy(m.shift).applyQuaternion(mq.fromArray(baked.rotations, k * JOINT_COUNT * 4)); // the pelvis's turn (joint 0)
  return out.add(own.fromArray(baked.hips, k * 3).multiplyScalar(m.ratio)).sub(m.pelvis);
}

/** What `retargetPose` does beyond the rotation copy. */
export interface RetargetOptions {
  /** Plant the feet (and hands in a `contacts` interval) with IK (true). */
  ik?: boolean;
  /** Lift a pose whose lowest point sinks below the source's own (scaled; the floor when the source is above it) (true). */
  lift?: boolean;
  /** Format 2's contact intervals, for the hands (the bake's own). */
  contacts?: readonly { part: string; from: number; to: number }[];
  /** A blade held in the right hand: its length, metres, along the weaponR socket's +Z; its tip stays above the floor. */
  blade?: number;
  /** FK to fill (a scratch one by default): the result's world pose. */
  world?: WorldPose;
}

const [hips, target, hip, goals] = [new Vector3(), new Vector3(), new Vector3(), [new Vector3(), new Vector3()]];
const [sourcePose, sourceWorld, scratchWorld] = [new Pose(), createWorldPose(), createWorldPose()];
const LEGS = (['L', 'R'] as const).map((s) => [`foot${s}`, `contact${s}`, `toe${s}`, `thigh${s}`, `shin${s}`] as const);
/** The height of a foot's lowest point (its sole, its ball, its toe's tip), metres. */
const footLow = (k: Skeleton, world: WorldPose, [, contact, toe]: (typeof LEGS)[number]) =>
  Math.min(socketPosition(k, world, contact, at).y, jointPosition(world, toe, at).y, tipPosition(k, world, toe, at).y);

/** The height of a pose's lowest point (a joint, a foot's sole, ball or toe tip, a hand's or the head's tip), m. */
function lowest(k: Skeleton, world: WorldPose): number {
  let low = Infinity;
  for (let j = 0; j < JOINT_COUNT; j++) low = Math.min(low, world.positions[j * 3 + 1]);
  for (const leg of LEGS) low = Math.min(low, footLow(k, world, leg));
  for (const j of ['handL', 'handR', 'head'] as const) low = Math.min(low, tipPosition(k, world, j, target).y);
  return low;
}

/** How far (m) the source's knee must stand off its hip–ankle line before contact IK bends the leg its way. */
const KNEE_POLE = 0.02;
const [poles, bends] = [
  [new Vector3(), new Vector3()],
  [false, false],
];

/**
 * Contact IK's feet (see the file comment): each ankle's goal, the pelvis dropped as far as the lower planted foot
 * needs to reach its goal (footPlant.ts `footPlant`'s rule, with straight legs, faded as the foot rises), then each leg
 * turned to its goal. `sourceWorld` holds the source's FK. Runs FK.
 */
function plantFeet(rest: Skeleton, m: Mapping, skeleton: Skeleton, pose: Pose, world: WorldPose): void {
  let drop = 0;
  LEGS.forEach((leg, i) => {
    const [end, , , thigh, shin] = leg;
    // the source's knee, seen from the middle of its hip and ankle: the way the leg bends, when it bends (after G9:
    // without it a deep fold took the thigh frame's default and swung the knee through)
    const knee = jointPosition(sourceWorld, shin, poles[i]);
    knee.sub(
      jointPosition(sourceWorld, thigh, hip)
        .add(jointPosition(sourceWorld, end, target))
        .multiplyScalar(0.5),
    );
    bends[i] = knee.length() > KNEE_POLE;
    const low = footLow(rest, sourceWorld, leg);
    const fade = MathUtils.clamp(1 - low / RETARGET.soleFade, 0, 1);
    const goal = jointPosition(sourceWorld, end, goals[i]).multiplyScalar(m.ratio);
    goal.y = jointPosition(world, end, target).y - footLow(skeleton, world, leg) + Math.max(0, low * m.ratio);
    jointPosition(world, thigh, hip);
    // a hair short of straight, so twoBone reaches (ik.ts: twice its slack)
    const reach = skeleton.lengths[jointIndex(shin)] + skeleton.lengths[jointIndex(end)] - 0.01 / 8;
    const [across, below] = [Math.hypot(goal.x - hip.x, goal.z - hip.z), hip.y - goal.y];
    drop = Math.max(drop, fade * (across < reach ? below - Math.sqrt(reach * reach - across * across) : below));
  });
  pose.rootPos.y -= drop;
  if (drop > 0) forwardKinematics(skeleton, pose, world);
  for (let i = 0; i < 2; i++)
    twoBoneRot(skeleton, pose, world, LEGS[i][0], goals[i], bends[i] ? { pole: poles[i] } : {});
}

const [dir, want] = [new Vector3(), new Vector3()];
/**
 * The held blade's tip kept above the floor (see the file comment): the blade lowered no further than to lie along
 * it, the right hand turned to it as `holdAlong` holds a weapon (which moves the grip a little: two more passes
 * take that in, to 0.1 mm). Runs FK.
 */
function keepBladeUp(skeleton: Skeleton, pose: Pose, world: WorldPose, length: number): void {
  const floor = RETARGET.bladeFloor;
  for (let pass = 0; pass < 3; pass++) {
    const grip = socketPosition(skeleton, world, 'weaponR', target).y;
    dir.set(0, 0, 1).applyQuaternion(jointRotation(world, 'handR', rot));
    if (grip + dir.y * length >= floor - 1e-6 || grip + length <= floor) return; // above it, or too low to lie along it
    const y = (floor - grip) / length;
    const [flat, across] = [Math.hypot(dir.x, dir.z), Math.sqrt(Math.max(0, 1 - y * y))];
    if (flat > 1e-6) want.set((dir.x / flat) * across, y, (dir.z / flat) * across);
    else want.set(0, y, across);
    holdAlong({ skeleton, pose, world, rootOffset: target }, want); // it reads the pose, its FK and the skeleton
  }
}

/**
 * `baked` at `t` seconds on `skeleton`, written into `out` (a new pose by default): the rotations copied and aligned
 * at rest, the hip joints where the clip's are times the hip-height ratio, the root at the origin unturned; then the
 * feet planted, the pose lifted and a held blade kept above the floor (`options`). FK is left in `options.world`.
 */
export function retargetPose(
  baked: BakedClip,
  t: number,
  skeleton: Skeleton,
  out = new Pose(),
  options: RetargetOptions = {},
): Pose {
  const world = options.world ?? scratchWorld;
  const [m, rest, [i, u]] = [mappingOf(baked.rest, skeleton), restSkeleton(baked.rest), frameAt(baked, t)];
  sampleBaked(baked, t, sourcePose.local, hips);
  sourcePose.rootPos.copy(hips).sub(target.fromArray(rest.offsets, 0));
  rootAt(m, baked, i, mapPose(m, sourcePose, out).rootPos).lerp(rootAt(m, baked, i + 1, target), u);
  forwardKinematics(skeleton, out, world);
  if (options.ik ?? true) {
    forwardKinematics(rest, sourcePose, sourceWorld);
    plantFeet(rest, m, skeleton, out, world);
    const d = baked.duration;
    const lap = baked.loop && d > 0 ? ((t % d) + d) % d : t;
    for (const c of options.contacts ?? baked.contacts) {
      if ((c.part !== 'handL' && c.part !== 'handR') || lap < c.from || lap > c.to) continue;
      twoBoneRot(skeleton, out, world, c.part as LimbEnd, jointPosition(sourceWorld, c.part, target).multiplyScalar(m.ratio)); // prettier-ignore
    }
  }
  if (options.lift ?? true) {
    // only as far as the pose sinks below the scaled source's own lowest point (after G9): a clip that goes below
    // its floor (a swim, a dive) keeps its depth instead of standing on the floor, which made it hover
    if (!(options.ik ?? true)) forwardKinematics(rest, sourcePose, sourceWorld);
    const sink = Math.min(0, lowest(rest, sourceWorld) * m.ratio) - lowest(skeleton, world);
    if (sink > 0) {
      out.rootPos.y += sink;
      forwardKinematics(skeleton, out, world);
    }
  }
  if (options.blade) keepBladeUp(skeleton, out, world, options.blade);
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
 * and `root.position` (the hip joints by the hip-height ratio; with `travel`, plus the clip's travel), keyed on bones
 * named as the puppets' are (`root` and the joints). `AnimationClip.parse(json)` makes the clip; no contact IK.
 */
export function clipJSON(baked: BakedClip, skeleton: Skeleton, options: { travel?: boolean } = {}): AnimationClipJSON {
  const [frames, m, pose, times] = [baked.frames, mappingOf(baked.rest, skeleton), new Pose(), Array.from(baked.times)];
  const [values, root] = [JOINTS.map(() => new Array<number>(frames * 4)), new Array<number>(frames * 3)];
  for (let i = 0; i < frames; i++) {
    sourcePose.local.set(baked.rotations.subarray(i * JOINT_COUNT * 4, (i + 1) * JOINT_COUNT * 4));
    mapPose(m, sourcePose, pose);
    values.forEach((track, j) => track.splice(i * 4, 4, ...pose.local.subarray(j * 4, j * 4 + 4)));
    rootAt(m, baked, i, hips);
    if (options.travel) hips.add(travelAt(baked, times[i], target).multiplyScalar(m.ratio));
    hips.toArray(root, i * 3);
  }
  const quaternions = JOINTS.map((joint, j) => ({ name: `${joint}.quaternion`, type: 'quaternion' as const, times, values: values[j] })); // prettier-ignore
  const tracks = [...quaternions, { name: 'root.position', type: 'vector' as const, times, values: root }];
  const uuid = `clip:${baked.name}@${skeleton.build.id}`;
  return { name: baked.name, duration: baked.duration, uuid, blendMode: 2500, tracks };
}
