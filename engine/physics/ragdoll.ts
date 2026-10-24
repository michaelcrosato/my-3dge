/**
 * @file Ragdolls (PLAN.md WP 10.2; doctrine: Reproducible): a body of parts held together by joints, falling in the
 * physics world (engine/physics/world.ts). `addRagdoll(physics, spec)` adds one dynamic body a part, at its frame (a
 * bone's: its joint's position and rotation in the world now) with its capsules and balls, and the joints between the
 * parts (engine/physics/joints.ts), and returns their ids; `readRagdoll` copies every part's pose, 7 numbers a part
 * (its position, then its rotation's x, y, z, w), for the animation to lay on the bones (engine/anim/ragdoll.ts);
 * `ragdollSpeed` is its fastest part's speed, for when it has come to rest; `removeRagdoll` takes it out, its joints
 * with its bodies.
 *
 * Every part moves as the whole body did (`velocity`, and `angularVelocity` about the first part), so a body thrown
 * flies on as one. The parts are in the group `corpse` unless the spec names another: the level and props stop them,
 * while actors, the crowd and the ragdoll's own parts pass through (engine/physics/groups.ts), so a limb never catches
 * on the next. They are damped (`RAGDOLL.damping`) and rough (`RAGDOLL.friction`), so a fall comes to rest, then sleeps.
 *
 * Invariants: parts and joints enter Rapier in the spec's order, so the same spec gives the same ids, and all of a
 * spec goes in or none (a bad part or joint adds nothing); the ragdoll keeps nothing outside Rapier (its ids are the
 * caller's to hold in a component); points are world metres now.
 *
 * @example
 * import { createPhysics } from './world';
 * const p = createPhysics();
 * const doll = addRagdoll(p, {
 *   parts: [
 *     { position: [0, 1, 0], shapes: [{ from: [0, 1, 0], to: [0, 1.5, 0], radius: 0.12 }] }, // a trunk
 *     { position: [0, 1.6, 0], shapes: [{ from: [0, 1.7, 0], radius: 0.1 }] }, // a head
 *   ],
 *   joints: [{ parent: 0, child: 1, at: [0, 1.6, 0], kind: { type: 'ball', spring: 20, damping: 4 } }],
 * });
 * readRagdoll(p, doll).length; // 14: two parts, 7 numbers each
 * @see engine/physics/ragdoll.test.ts
 */
import { Quaternion, Vector3 } from '../core/math';
import { isPlainObject } from '../core/schema';
import type { GroupName } from './groups';
import { addJoint, type JointKind } from './joints';
import { check, quat, vec, type QuatLike, type Vec3Like } from './queries';
import type { BodySpec, ColliderSpec, Physics } from './world';

/**
 * A ragdoll's tuning: its parts' damping (per second) and friction, its default density (kg/m³), and the solver
 * passes its parts take beyond the pinned four (engine/physics/params.ts): over eight measured falls, the worst bends
 * a knee 10° past its limit for a moment (21° without them); an elbow still swings 24° past as a hand strikes the floor.
 */
export const RAGDOLL = { damping: { linear: 0.1, angular: 3 }, friction: 0.8, density: 1000, iterations: 4 } as const;

/** A collider of a part: a capsule from `from` to `to`, or a ball at `from` (no `to`), `radius` round; world metres. */
export interface RagdollShape {
  readonly from: Vec3Like;
  readonly to?: Vec3Like;
  readonly radius: number;
}

/** A part: its frame in the world now (its joint's position, its bone's rotation) and its colliders. */
export interface RagdollPart {
  readonly position: Vec3Like;
  readonly rotation?: QuatLike;
  readonly shapes: readonly RagdollShape[];
  /** kg/m³ (`RAGDOLL.density`). */
  readonly density?: number;
}

/** A joint between two parts, by their indexes: where it holds (world metres now), its kind, and its rest. */
export interface RagdollJoint {
  readonly parent: number;
  readonly child: number;
  readonly at: Vec3Like;
  readonly kind: JointKind;
  /** The child's rotation relative to the parent's at rest (engine/physics/joints.ts `rest`): theirs now by default. */
  readonly rest?: QuatLike;
  /** The joint's frame in the world now (engine/physics/joints.ts `frame`). */
  readonly frame?: QuatLike;
}

/** A ragdoll as `addRagdoll` takes it. */
export interface RagdollSpec {
  readonly parts: readonly RagdollPart[];
  readonly joints: readonly RagdollJoint[];
  /** The whole body's velocity now (m/s). */
  readonly velocity?: Vec3Like;
  /** The whole body's spin now (rad/s), about the first part. */
  readonly angularVelocity?: Vec3Like;
  /** The parts' group (`corpse`). */
  readonly group?: GroupName;
}

/** A ragdoll's ids: a body a part, in the spec's order, and its joints. */
export interface Ragdoll {
  readonly bodies: readonly number[];
  readonly joints: readonly number[];
}

/** Numbers a part takes in `readRagdoll`: its position (3) and rotation (4). */
export const PART_STRIDE = 7;

const [Y, va, vb, vc] = [new Vector3(0, 1, 0), new Vector3(), new Vector3(), new Vector3()];
const [qa, qb] = [new Quaternion(), new Quaternion()];

/** A part's collider for `shape`, in the frame at `at` turned `turn` (its inverse `back`). */
function collider(
  shape: RagdollShape,
  at: Vector3,
  back: Quaternion,
  density: number,
  group: GroupName,
  where: string,
): ColliderSpec {
  // prettier-ignore
  check(isPlainObject(shape) && Number.isFinite(shape.radius) && shape.radius > 0, where, shape, '{ from, to?, radius > 0 }'); // prettier-ignore
  const from = vec(shape.from, `${where}.from`);
  const a = va.set(from.x, from.y, from.z).sub(at).applyQuaternion(back);
  const common = { density, friction: RAGDOLL.friction, group };
  if (shape.to === undefined)
    return { shape: { type: 'ball', radius: shape.radius }, position: a.toArray(), ...common };
  const to = vec(shape.to, `${where}.to`);
  const b = vb.set(to.x, to.y, to.z).sub(at).applyQuaternion(back);
  const along = vc.subVectors(b, a);
  const height = Math.max(along.length(), 1e-4);
  const rotation = qb.setFromUnitVectors(Y, along.lengthSq() > 0 ? along.normalize() : Y);
  const middle = a.add(b).multiplyScalar(0.5);
  return { shape: { type: 'capsule', radius: shape.radius, height }, position: middle.toArray(), rotation: rotation.toArray() as [number, number, number, number], ...common }; // prettier-ignore
}

/** Adds a ragdoll as `spec` says (see the file comment) and returns its ids. Throws `PHYSICS_BAD_ARGUMENT`. */
export function addRagdoll(physics: Physics, spec: RagdollSpec): Ragdoll {
  check(isPlainObject(spec) && Array.isArray(spec.parts) && spec.parts.length > 0 && Array.isArray(spec.joints), 'addRagdoll(spec)', spec, '{ parts: [at least one], joints: [] }'); // prettier-ignore
  const group = spec.group ?? 'corpse';
  const v = vec(spec.velocity ?? [0, 0, 0], 'addRagdoll({ velocity })');
  const spin = vec(spec.angularVelocity ?? [0, 0, 0], 'addRagdoll({ angularVelocity })');
  const centre = vec(spec.parts[0].position, 'addRagdoll({ parts[0].position })');
  for (const [i, joint] of spec.joints.entries()) {
    const ok = isPlainObject(joint) && [joint.parent, joint.child].every((k) => Number.isInteger(k) && k >= 0 && k < spec.parts.length) && joint.parent !== joint.child; // prettier-ignore
    check(ok, `addRagdoll({ joints[${i}] })`, joint, `{ parent, child }: two parts' indexes from 0 to ${spec.parts.length - 1}`); // prettier-ignore
  }
  const specs = spec.parts.map((part, i): BodySpec => {
    const where = `addRagdoll({ parts[${i}] })`;
    check(isPlainObject(part) && Array.isArray(part.shapes) && part.shapes.length > 0, where, part, '{ position, rotation?, shapes: [at least one] }'); // prettier-ignore
    const p = vec(part.position, `${where}.position`);
    const r = quat(part.rotation, `${where}.rotation`);
    const [at, back] = [new Vector3(p.x, p.y, p.z), qa.set(r.x, r.y, r.z, r.w).invert().clone()];
    const density = part.density ?? RAGDOLL.density;
    check(Number.isFinite(density) && density > 0, `${where}.density`, density, 'kg/m³ above 0');
    const colliders = part.shapes.map((shape, k) => collider(shape, at, back, density, group, `${where}.shapes[${k}]`));
    const arm = vb.set(p.x - centre.x, p.y - centre.y, p.z - centre.z);
    const moving = va
      .set(spin.x, spin.y, spin.z)
      .cross(arm)
      .add(vc.set(v.x, v.y, v.z)); // the body's, at this part
    const { linear, angular } = RAGDOLL.damping;
    return { position: [p.x, p.y, p.z], rotation: [r.x, r.y, r.z, r.w], velocity: moving.toArray(), angularVelocity: [spin.x, spin.y, spin.z], colliders, group, linearDamping: linear, angularDamping: angular, solverIterations: RAGDOLL.iterations }; // prettier-ignore
  });
  const bodies = specs.map((body) => physics.addBody(body)); // every part checked first, so all or none go in
  let joints: number[];
  try {
    joints = spec.joints.map((joint) => addJoint(physics, { a: bodies[joint.parent], b: bodies[joint.child], at: joint.at, kind: joint.kind, ...(joint.rest ? { rest: joint.rest } : {}), ...(joint.frame ? { frame: joint.frame } : {}) })); // prettier-ignore
  } catch (error) {
    for (const id of bodies) physics.removeBody(id); // a bad joint takes the parts out again, its joints with them
    throw error;
  }
  return { bodies, joints };
}

/** Every part's pose now, `PART_STRIDE` numbers a part in the parts' order, written into `out`. */
export function readRagdoll(physics: Physics, ragdoll: Ragdoll, out: number[] = []): number[] {
  out.length = ragdoll.bodies.length * PART_STRIDE;
  ragdoll.bodies.forEach((id, i) => {
    const { position: p, rotation: r } = physics.readBody(id);
    out.splice(i * PART_STRIDE, PART_STRIDE, p.x, p.y, p.z, r.x, r.y, r.z, r.w);
  });
  return out;
}

/** The fastest part's speed (m/s), counting its spin at `reach` metres from its middle (a head turning slowly is still). */
export function ragdollSpeed(physics: Physics, ragdoll: Ragdoll, reach = 0.1): number {
  let fastest = 0;
  for (const id of ragdoll.bodies) {
    const { velocity, angularVelocity } = physics.readBody(id);
    fastest = Math.max(fastest, velocity.length() + angularVelocity.length() * reach);
  }
  return fastest;
}

/** Removes the ragdoll's bodies, and with them its joints. */
export function removeRagdoll(physics: Physics, ragdoll: Ragdoll): void {
  for (const id of ragdoll.bodies) if (physics.hasBody(id)) physics.removeBody(id);
}
