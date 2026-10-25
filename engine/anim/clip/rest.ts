/**
 * @file A clip library's rest body as a skeleton (PLAN.md §10.4, WP 8.4; split from engine/anim/clip/retarget.ts
 * after G9, ADR-0014 amendment 17): `restSkeleton(R)` has the humanoid topology with the library's measured bones and
 * rest curve, so FK of a baked pose on it rebuilds the decode's body points (`restPoints`): the parity proof.
 * `restBuild` turns a rest body into a `build` (the mannequin's proportions, gfx/puppets/bodies/mannequin.ts).
 *
 * Invariants: places are metres, +Y up, the character facing +Z; a rest body's skeleton and markers are made once and
 * cached; `restPoints` writes mm in the rig frame, `[forward, right, up]`, as the decode does.
 *
 * @example
 * import { REST } from '../../../tests/unit/anim/clip-fixtures';
 * restSkeleton(REST).build.id; // 'build:rest'
 * restBuild(REST).legUpper > 0; // true: metres, size 1
 * @see engine/anim/clip/bake.test.ts
 */
import { createRegistry } from '../../core/registry';
import { Quaternion, Vector3 } from '../../core/math';
import { defineBuild, type BuildSpec } from '../builds';
import { forwardKinematics, jointPosition, tipPosition } from '../fk';
import type { WorldPose } from '../fk';
import { Pose } from '../pose';
import { JOINT_COUNT, JOINTS, jointIndex, SOCKET_JOINTS, SOCKETS } from '../skeleton';
import type { JointName, Skeleton } from '../skeleton';
import { frameQuaternion, rigToEngine } from './bake';
import { POSE_POINTS, POINT_COUNT } from './readable';
import type { RestBody } from './validate';

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
  const off: Partial<Record<JointName, Vector3>> = { pelvis: new Vector3(0, R.H0 / 1000, 0) };
  const up = [...R.spine, R.neckSeg]; // each bone of the spine and the neck, from the pelvis up
  (['spine1', 'spine2', 'chest', 'neck', 'head'] as const).forEach((joint, i) => (off[joint] = torso(mm(up[i]))));
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
  // Stryker disable next-line ConditionalExpression: a cache: the markers made again are the same markers
  if (!m) markers.set(R, (m = restMarkers(R)));
  for (let i = 0; i < POINT_COUNT; i++) {
    const j = m.joints[i];
    pt.copy(m.offsets[i]).applyQuaternion(rot.fromArray(world.rotations, j * 4));
    pt.add(jointPosition(world, j, at));
    [out[i * 3], out[i * 3 + 1], out[i * 3 + 2]] = [pt.z * 1000, -pt.x * 1000, pt.y * 1000];
  }
  return out;
}
