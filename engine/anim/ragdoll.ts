/**
 * @file The humanoid's ragdoll (PLAN.md WP 10.2; I-11): what a body's bones become when physics takes it over, and how
 * the parts come back onto the bones. `ragdollOf(build, world)` describes the ragdoll of a body posed as `world`
 * (engine/anim/fk.ts) as plain data, for engine/physics/ragdoll.ts to build: its parts (`RAGDOLL_PARTS`: the pelvis
 * with the hips, the chest with the shoulders, the head, each arm's upper arm and forearm with the hand, each leg's
 * thigh and shin with the foot), each at its joint and turned as its bone, its capsules joint to joint at
 * `bodyCapsules`' radii; and the joints between them (`RAGDOLL_JOINTS`): balls at the spine and the neck, sprung
 * toward straight, and at the shoulders and hips, each within a body's limits; hinges at the elbows and knees about
 * the IK's hinges (ik.ts `LIMBS`), bending only their own way. Every joint rests where the T-pose has it (every bone's frame the body's), so a limb's
 * limits and a spring's pull measure from there whatever the pose at the hand-off.
 *
 * `RagdollLayer` (the slot `physics`) lays the parts' poses (7 numbers a part, `readRagdoll`'s) on the bones: the root
 * where the pelvis part puts the pelvis, each part's joint turned as its body, the joints between shared out (the
 * spine's four from the pelvis to the chest, the neck and the head from the chest to the head), the clavicles, hands
 * and feet as the animation had them. Its weight fades it in at the hand-off and out as the body gets up
 * (`RAGDOLL_FADE`); `blendRagdollPoses` draws it between two steps.
 *
 * `ragdollRest(build, poses)` says how a ragdoll that has come to rest lies, for the get-up: on its back or its face
 * (`lyingOf` its chest, so `Reactions.getUp` picks the get-up), and where the humanoid lying the same way puts its
 * feet and faces (`KNOCKDOWN`: on its back the head lies behind it, on its face ahead), its pelvis where the ragdoll's is.
 *
 * Invariants: pure data and math, the same in the sim and the view; the parts in `RAGDOLL_PARTS` order everywhere.
 *
 * @example
 * import { Vector3 } from '../core/math';
 * import { Animator } from './character';
 * const body = new Animator({ build: 'build:adult' }).update({}, { at: new Vector3(), yaw: 0 }).body;
 * const spec = ragdollOf(body.build, body.world); // 11 parts and 10 joints, for addRagdoll
 * spec.joints[3].kind.type; // 'hinge': the left elbow
 * @see engine/anim/ragdoll.test.ts
 */
import { MathUtils, Matrix4, Quaternion, Vector3 } from '../core/math';
import type { Build } from './builds';
import { Animator } from './character';
import { CHAIN } from './chain';
import { jointPosition, jointRotation, jointToWorld, type WorldPose } from './fk';
import { LIMBS } from './ik';
import { lyingOf, Reactions, type Lying } from './reactions';
import { JOINTS, jointIndex, PARENTS, type JointName } from './skeleton';
import type { AnimLayer } from './weights';

/** A capsule of a part, joint to joint (or to a hand's fingertips): `trunk` thick (half the chestDepth) or `limb`. */
type End = JointName | 'fingersL' | 'fingersR';
type Capsule = readonly [from: End, to: End, thick: 'trunk' | 'limb'];

/** The parts, in order: the joint whose frame each takes, its parent part, and its capsules (the head is a ball). */
// prettier-ignore
export const RAGDOLL_PARTS = [
  { joint: 'pelvis', parent: -1, capsules: [['pelvis', 'spine2', 'trunk'], ['thighL', 'thighR', 'trunk']] },
  { joint: 'chest', parent: 0, capsules: [['spine2', 'neck', 'trunk'], ['upperArmL', 'upperArmR', 'trunk']] },
  { joint: 'head', parent: 1, capsules: [] },
  { joint: 'upperArmL', parent: 1, capsules: [['upperArmL', 'forearmL', 'limb']] },
  { joint: 'forearmL', parent: 3, capsules: [['forearmL', 'handL', 'limb'], ['handL', 'fingersL', 'limb']] },
  { joint: 'upperArmR', parent: 1, capsules: [['upperArmR', 'forearmR', 'limb']] },
  { joint: 'forearmR', parent: 5, capsules: [['forearmR', 'handR', 'limb'], ['handR', 'fingersR', 'limb']] },
  { joint: 'thighL', parent: 0, capsules: [['thighL', 'shinL', 'limb']] },
  { joint: 'shinL', parent: 7, capsules: [['shinL', 'footL', 'limb'], ['footL', 'toeL', 'limb']] },
  { joint: 'thighR', parent: 0, capsules: [['thighR', 'shinR', 'limb']] },
  { joint: 'shinR', parent: 9, capsules: [['shinR', 'footR', 'limb'], ['footR', 'toeR', 'limb']] },
] as const satisfies readonly { joint: JointName; parent: number; capsules: readonly Capsule[] }[];

type V3 = readonly [number, number, number];
type Range = readonly [number, number];

/**
 * A joint of the ragdoll as data: a ball, its frame at rest (its X along the child bone, its Y given, its Z their
 * cross) with its limits about each axis (rad, engine/physics/joints.ts), or a hinge about its `LIMBS` hinge.
 */
export type RagdollJointKind =
  | { readonly type: 'ball'; readonly axes: readonly [x: V3, y: V3]; readonly limits: readonly [Range, Range, Range]; readonly spring: number; readonly damping: number } // prettier-ignore
  | { readonly type: 'hinge'; readonly axis: V3; readonly limits: Range; readonly damping: number };

const [UP, DOWN, LEFT, RIGHT] = [
  [0, 1, 0],
  [0, -1, 0],
  [1, 0, 0],
  [-1, 0, 0],
] as const;

/**
 * Each part's joint to its parent (the pelvis has none), at the part's own joint (the spine's at spine2), and its
 * kind. The balls' limits are a body's, about the bone (a twist), then about Y and Z of its frame: the spine and the
 * neck bend forward more than back (about the body's left), the shoulders swing the arm forward more than back and
 * lower it to the side, the hips swing the leg forward far and back a little and out more than in.
 */
// prettier-ignore
export const RAGDOLL_JOINTS: readonly (RagdollJointKind | null)[] = [
  null,
  { type: 'ball', axes: [UP, LEFT], limits: [[-0.6, 0.6], [-0.4, 1], [-0.5, 0.5]], spring: 10, damping: 4 }, // the spine
  { type: 'ball', axes: [UP, LEFT], limits: [[-1.2, 1.2], [-0.7, 0.9], [-0.6, 0.6]], spring: 8, damping: 3 }, // the neck
  { type: 'ball', axes: [LEFT, UP], limits: [[-1.4, 1.4], [-2, 0.8], [-1.7, 1.2]], spring: 0, damping: 2 }, // the left shoulder
  { type: 'hinge', axis: LIMBS.handL.hinge, limits: [0, 2.5], damping: 1.5 }, // the left elbow
  { type: 'ball', axes: [RIGHT, UP], limits: [[-1.4, 1.4], [-0.8, 2], [-1.7, 1.2]], spring: 0, damping: 2 },
  { type: 'hinge', axis: LIMBS.handR.hinge, limits: [0, 2.5], damping: 1.5 },
  { type: 'ball', axes: [DOWN, LEFT], limits: [[-0.7, 0.7], [-2, 0.5], [-0.3, 0.8]], spring: 2, damping: 2 }, // the left hip
  { type: 'hinge', axis: LIMBS.footL.hinge, limits: [0, 2.4], damping: 1.5 }, // the left knee
  { type: 'ball', axes: [DOWN, LEFT], limits: [[-0.7, 0.7], [-2, 0.5], [-0.8, 0.3]], spring: 2, damping: 2 },
  { type: 'hinge', axis: LIMBS.footR.hinge, limits: [0, 2.4], damping: 1.5 },
];

/** A joint of the ragdoll as the physics world takes it (engine/physics/joints.ts `JointKind`). */
export type RagdollJointData =
  | { readonly type: 'ball'; readonly limits: readonly [Range, Range, Range]; readonly spring: number; readonly damping: number } // prettier-ignore
  | { readonly type: 'hinge'; readonly axis: V3; readonly limits: Range; readonly damping: number };

/** Where the ball joint between the pelvis and the chest holds: where their capsules meet. */
const SPINE_AT: JointName = 'spine2';
/** Numbers a part takes in a ragdoll's poses: its position (3) and rotation (4). */
export const PART_NUMBERS = 7;
/** Seconds the view fades a ragdoll in at the hand-off, and out as the body gets up (the sim keeps it that long). */
export const RAGDOLL_FADE = { in: 0.1, out: 0.3 } as const;
/** The rest of every joint: the T-pose, the bones' frames all the body's. */
const REST = [0, 0, 0, 1] as const;

/** A part's capsule or ball in world metres now, and its radius. */
export interface RagdollShapeData {
  from: [number, number, number];
  to?: [number, number, number];
  radius: number;
}

/** A ragdoll as plain data (engine/physics/ragdoll.ts `RagdollSpec`, without its velocity and group). */
export interface RagdollData {
  parts: { position: [number, number, number]; rotation: [number, number, number, number]; shapes: RagdollShapeData[] }[]; // prettier-ignore
  joints: { parent: number; child: number; at: [number, number, number]; kind: RagdollJointData; rest: readonly [number, number, number, number]; frame?: [number, number, number, number] }[]; // prettier-ignore
}

const [va, vb, vc] = [new Vector3(), new Vector3(), new Vector3()];
const basis = new Matrix4();
const [qa, qb, qc] = [new Quaternion(), new Quaternion(), new Quaternion()];
const xyz = (v: Vector3): [number, number, number] => [v.x, v.y, v.z];

/** Where `name` is in `world`: a joint, or a hand's fingertips (`handLength` along its bone). */
function point(build: Build, world: WorldPose, name: End, out: Vector3): Vector3 {
  if (name === 'fingersL' || name === 'fingersR') {
    const side = name === 'fingersL' ? 1 : -1; // the hands reach along ±X in the T-pose
    return jointToWorld(world, name === 'fingersL' ? 'handL' : 'handR', vb.set(side * build.handLength * build.size, 0, 0), out); // prettier-ignore
  }
  return jointPosition(world, name, out);
}

/** The ragdoll of a body of `build` posed as `world` (see the file comment). */
export function ragdollOf(build: Build, world: WorldPose): RagdollData {
  const s = build.size;
  const radius = (thick: Capsule[2]) => (thick === 'trunk' ? build.chestDepth / 2 : CHAIN.limb) * s;
  const parts = RAGDOLL_PARTS.map((part) => {
    const shapes: RagdollShapeData[] = part.capsules.map(([from, to, thick]) => ({ from: xyz(point(build, world, from, va)), to: xyz(point(build, world, to, va)), radius: radius(thick) })); // prettier-ignore
    if (part.joint === 'head') shapes.push({ from: xyz(jointToWorld(world, 'head', vb.set(0, build.headRadius * s, 0), va)), radius: build.headRadius * s }); // prettier-ignore
    const r = jointRotation(world, part.joint, qa);
    return { position: xyz(jointPosition(world, part.joint, va)), rotation: [r.x, r.y, r.z, r.w] as [number, number, number, number], shapes }; // prettier-ignore
  });
  const joints = RAGDOLL_PARTS.flatMap((part, child): RagdollData['joints'] => {
    const kind = RAGDOLL_JOINTS[child];
    const parent = RAGDOLL_PARTS.at(part.parent);
    if (!kind || part.parent < 0 || !parent) return [];
    const at = xyz(jointPosition(world, child === 1 ? SPINE_AT : part.joint, va));
    const turn = jointRotation(world, parent.joint, qa); // the parent bone's now: its frame is the body's at rest
    if (kind.type === 'hinge') return [{ parent: part.parent, child, at, kind: { ...kind, axis: xyz(va.fromArray(kind.axis).applyQuaternion(turn)) }, rest: REST }]; // prettier-ignore
    const [x, y] = [va.fromArray(kind.axes[0]), vb.fromArray(kind.axes[1])];
    const frame = qb.setFromRotationMatrix(basis.makeBasis(x, y, vc.crossVectors(x, y))).premultiply(turn);
    const { limits, spring, damping } = kind;
    return [{ parent: part.parent, child, at, kind: { type: 'ball', limits, spring, damping }, rest: REST, frame: [frame.x, frame.y, frame.z, frame.w] as [number, number, number, number] }]; // prettier-ignore
  });
  return { parts, joints };
}

/** The parts each of the in-between joints shares its turn with: from a part to its child part, in equal shares. */
const SHARED: Readonly<Partial<Record<JointName, readonly [from: number, to: number, share: number]>>> = {
  spine0: [0, 1, 1 / 4],
  spine1: [0, 1, 1 / 4],
  spine2: [0, 1, 1 / 4],
  chest: [0, 1, 1 / 4], // prettier-ignore
  neck: [1, 2, 1 / 2],
  head: [1, 2, 1 / 2], // prettier-ignore
};
/** Each joint's part, or −1. */
const PART_OF: readonly number[] = JOINTS.map((name) => RAGDOLL_PARTS.findIndex((part) => part.joint === name));

/** What `new RagdollLayer` takes. */
export interface RagdollLayerOptions {
  /** Its layer's name (`ragdoll`). */
  name?: string;
}

/** The layer that lays a ragdoll's parts on the bones (see the file comment). */
export class RagdollLayer implements AnimLayer {
  readonly name: string;
  /** 0–1: how much of the ragdoll shows; the owner eases it. */
  weight = 0;
  /** The parts' poses now, `PART_NUMBERS` a part in `RAGDOLL_PARTS` order; fewer: nothing to lay. */
  poses: number[] = [];
  readonly #world = JOINTS.map(() => new Quaternion());
  readonly #shares = new Map<number, Quaternion>();

  constructor(options: RagdollLayerOptions = {}) {
    this.name = options.name ?? 'ragdoll';
  }

  /** Adds it to `animator`'s slot `physics`. */
  attach(animator: Animator): this {
    animator.use('physics', this);
    return this;
  }

  /** The part `i`'s rotation, from `poses`. */
  #part(i: number, out: Quaternion): Quaternion {
    const o = i * PART_NUMBERS + 3;
    return out.set(this.poses[o], this.poses[o + 1], this.poses[o + 2], this.poses[o + 3]).normalize();
  }

  apply(animator: Animator): void {
    if (this.poses.length < RAGDOLL_PARTS.length * PART_NUMBERS) return;
    const { pose, skeleton } = animator.body;
    const W = this.#world;
    this.#shares.clear();
    for (const [from, to] of [
      [0, 1],
      [1, 2],
    ] as const) {
      const turn = qb.copy(this.#part(from, qa)).invert().multiply(this.#part(to, qc));
      this.#shares.set(to, new Quaternion().slerp(turn, SHARED[to === 1 ? 'chest' : 'head']![2]));
    }
    const pelvis = this.#part(0, W[0]);
    pose.setRotation('pelvis', qa.copy(pose.rootRot).invert().multiply(pelvis));
    const offset = va.fromArray(skeleton.offsets, 0).multiply(pose.rootScale).applyQuaternion(pose.rootRot);
    pose.rootPos.fromArray(this.poses, 0).sub(offset);
    for (let j = 1; j < JOINTS.length; j++) {
      const parent = W[PARENTS[j]];
      const shared = SHARED[JOINTS[j]];
      if (shared) pose.setRotation(j, this.#shares.get(shared[1])!);
      else if (PART_OF[j] >= 0) pose.setRotation(j, qa.copy(parent).invert().multiply(this.#part(PART_OF[j], qb)));
      W[j].copy(parent).multiply(pose.getRotation(j, qa)); // the animation's own for the rest
    }
  }

  inspect(): Record<string, unknown> {
    return { parts: Math.floor(this.poses.length / PART_NUMBERS) };
  }
}

/** The poses `k` (0 to 1) of the way from `a` to `b`, part by part (positions lerped, rotations slerped), into `out`. */
export function blendRagdollPoses(a: readonly number[], b: readonly number[], k: number, out: number[] = []): number[] {
  out.length = b.length;
  for (let o = 0; o + PART_NUMBERS <= b.length; o += PART_NUMBERS) {
    for (let i = 0; i < 3; i++) out[o + i] = a[o + i] + (b[o + i] - a[o + i]) * k;
    qa.fromArray(a, o + 3)
      .slerp(qb.fromArray(b, o + 3), k)
      .toArray(out, o + 3);
  }
  return out;
}

/** How a ragdoll at rest lies, and where the humanoid lying the same way stands (`ragdollRest`). */
export interface RagdollRest {
  /** On its back (`up`) or its face (`down`). */
  lying: Lying;
  /** Its chest's rotation, for `Reactions.getUp`. */
  chest: Quaternion;
  /** Its heading, radians. */
  yaw: number;
  /** The ground point under it, world metres: its pelvis where the ragdoll's is. */
  at: Vector3;
}

/**
 * Where the pelvis of a humanoid of `build` lies (`lying`) at the origin facing +Z: the mean over 4 s of its breathing
 * and sway (±2 cm), measured once a build and side.
 */
const lyingPelvis = new Map<string, Vector3>();
function pelvisLying(build: Build, lying: Lying): Vector3 {
  const key = `${build.id}:${lying}`;
  let found = lyingPelvis.get(key);
  if (!found) {
    const animator = new Animator({ build: build.id });
    new Reactions().attach(animator).lying = lying;
    found = new Vector3();
    const [settle, sampled] = [60, 240];
    for (let k = 0; k < settle + sampled; k++) {
      animator.update({ down: 1 }, { at: va.set(0, 0, 0), yaw: 0 });
      if (k >= settle) found.add(jointPosition(animator.body.world, jointIndex('pelvis'), vb));
    }
    lyingPelvis.set(key, found.divideScalar(sampled));
  }
  return found;
}

/** How a ragdoll of `build` whose parts are posed as `poses` lies, and where the humanoid lying so stands. */
export function ragdollRest(build: Build, poses: readonly number[]): RagdollRest {
  const chest = new Quaternion().fromArray(poses, PART_NUMBERS + 3).normalize();
  const lying = lyingOf(chest);
  const pelvis = new Vector3().fromArray(poses, 0);
  const up = va.fromArray(poses, PART_NUMBERS).sub(pelvis).setY(0); // toward its head
  const facing = lying === 'up' ? up.negate() : up; // on its back its head is behind it
  const yaw = facing.lengthSq() > 1e-12 ? Math.atan2(facing.x, facing.z) : 0;
  const lies = vb.copy(pelvisLying(build, lying)).applyAxisAngle(va.set(0, 1, 0), yaw);
  const at = new Vector3(pelvis.x - lies.x, pelvis.y - lies.y, pelvis.z - lies.z);
  return { lying, chest, yaw: MathUtils.euclideanModulo(yaw + Math.PI, 2 * Math.PI) - Math.PI, at };
}
