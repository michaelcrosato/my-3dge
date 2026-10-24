/**
 * @file Joints (PLAN.md WP 10.2, §5.8; doctrines: Common ground, Reproducible): what holds two bodies of the physics
 * world (engine/physics/world.ts) together, as plain data, after shardfall's joints. `addJoint(physics, spec)` joins
 * body `a` to body `b`, or to the world, at a point, and returns the joint's id; `removeJoint` takes it out, and
 * removing a body removes its joints. Rapier holds them, as it holds bodies, so its snapshot captures them.
 *
 * The kinds (`JointKind`, SI units, angles in radians):
 * - `fixed`: glued as they are.
 * - `ball`: free to turn about the point, within `limits` of its rest about its frame's X (a twist), Y and Z (two
 *   swings), as Rapier measures them (a turn's share about each axis: exact for a turn about that axis alone);
 *   `spring` pulls it back toward its rest, `damping` slows its turns.
 * - `hinge`: turns about `axis` only, within `limits` of its rest; `spring` pulls it back to its rest (a door that
 *   closes itself), else a motor turns it at `motorSpeed` (rad/s) with `motorForce`, and `damping` alone is friction.
 * - `slider`: moves along `axis` only, within `limits` (m) of its rest; `spring` and `damping` as a hinge's.
 * - `rope`: keeps the points at most `length` apart. `spring`: a spring between them, `length` long at rest.
 *
 * The rest: a hinge's angle, a slider's offset and a ball's springs measure from `rest`, the rotation of `b`
 * relative to `a` (`a⁻¹ · b`) at which the joint rests (of `a` in the world, for a joint to the world), by default
 * their rotations now. The point is in world metres at the bodies' poses now (`at`; `atB` for a spring or a rope that
 * starts stretched), the axis a world direction now. A joint to the world (`b: null`) holds to a fixed body of its
 * own at `at`, with no colliders (`jointBodies` names it first), which stays until it is removed.
 *
 * Invariants: joints live in Rapier only, so a capture restores them and the world steps on exactly; their ids come
 * from Rapier's handles as bodies' do (`slot + generation · 2³²`, engine/physics/capture.ts); the two bodies a joint
 * holds do not touch each other unless `contacts`. Motors are Rapier's acceleration-based ones: the same for any mass.
 *
 * Carried from shardfall@fa2dab6 `crates/pav_core/src/joints.rs` (`JointKind`, `JointLink::at`, `generic`,
 * `world_anchor`), in SI (its hinge limits and motor speeds were degrees), with the rest made explicit.
 *
 * @example
 * import { createPhysics } from './world';
 * const p = createPhysics();
 * const bob = p.addBody({ position: [1, 3, 0], colliders: [{ shape: { type: 'ball', radius: 0.1 } }] });
 * const rope = addJoint(p, { a: bob, b: null, at: [0, 3, 0], kind: { type: 'ball' } }); // a pendulum 1 m long
 * jointBodies(p, rope); // [anchor, bob]: the anchor a fixed body at [0, 3, 0]
 * @see engine/physics/joints.test.ts
 */
import RAPIER from '@dimforge/rapier3d-simd-compat';
import { codeError, defineCodes } from '../core/log';
import { Quaternion, Vector3 } from '../core/math';
import { isPlainObject, show } from '../core/schema';
import { bodyId, handleOf, liveBody } from './capture';
import { check, quat, vec, type QuatLike, type Vec3Like } from './queries';
import { rapierOf, type Physics } from './world';

/** The codes this module raises, with their fixes. */
export const JOINT_CODES = defineCodes('physics', {
  PHYSICS_NO_JOINT: {
    template: 'there is no joint {id}{why}',
    fix: 'use an id addJoint() returned while its joint exists (removing a body removes its joints; joints() lists them)',
  },
});

/** A joint's kind as data (see the file comment): springs and damping per second², angles in radians. */
export type JointKind =
  | { readonly type: 'fixed' }
  | {
      readonly type: 'ball';
      /** Its turn's bounds from its rest (rad): about its frame's X, Y and Z. */
      readonly limits?: readonly [readonly [number, number], readonly [number, number], readonly [number, number]];
      readonly spring?: number;
      readonly damping?: number;
    }
  | {
      readonly type: 'hinge';
      readonly axis?: Vec3Like;
      readonly limits?: readonly [number, number];
      readonly motorSpeed?: number;
      readonly motorForce?: number;
      readonly spring?: number;
      readonly damping?: number;
    }
  | {
      readonly type: 'slider';
      readonly axis?: Vec3Like;
      readonly limits?: readonly [number, number];
      readonly spring?: number;
      readonly damping?: number;
    }
  | { readonly type: 'rope'; readonly length: number }
  | { readonly type: 'spring'; readonly length: number; readonly stiffness?: number; readonly damping?: number };

/** A joint as `addJoint` takes it. */
export interface JointSpec {
  /** The body that owns it. */
  readonly a: number;
  /** The other body, or null: the world. */
  readonly b: number | null;
  /** Where it holds, world metres, at the bodies' poses now. */
  readonly at: Vec3Like;
  /** Where it holds on `b`, for a spring or a rope that starts stretched (`at`). */
  readonly atB?: Vec3Like;
  readonly kind: JointKind;
  /** `b`'s rotation relative to `a`'s at rest (`a`'s own for a joint to the world): their rotations now by default. */
  readonly rest?: QuatLike;
  /** The joint's frame in the world now: its X a hinge's or slider's axis, a ball's twist (from `kind.axis` by default). */
  readonly frame?: QuatLike;
  /** Whether the two bodies touch each other (false). */
  readonly contacts?: boolean;
}

/** shardfall's spring defaults: stiffness and damping. */
const SPRING = { stiffness: 200, damping: 8 } as const;
const AXES = [RAPIER.JointAxis.AngX, RAPIER.JointAxis.AngY, RAPIER.JointAxis.AngZ] as const;
const [X, Y] = [new Vector3(1, 0, 0), new Vector3(0, 1, 0)];
const [qa, qb, qr, qf] = [new Quaternion(), new Quaternion(), new Quaternion(), new Quaternion()];
const va = new Vector3();

/** A rotation as three.js's, from Rapier's. */
const q3 = (r: RAPIER.Rotation, out: Quaternion) => out.set(r.x, r.y, r.z, r.w);

/** A non-negative finite number (or its default, when there is one), checked. */
function amount(value: unknown, fallback: number | null, where: string): number {
  if (value === undefined && fallback !== null) return fallback;
  check(typeof value === 'number' && Number.isFinite(value) && value >= 0, where, value, 'a finite number, 0 or more');
  return value as number;
}

/** The body `id` names, or `PHYSICS_NO_BODY` (world.ts's code) naming the field. */
function bodyOf(world: RAPIER.World, id: unknown, where: string): RAPIER.RigidBody {
  const found = typeof id === 'number' ? liveBody(world, id) : null;
  if (!found) throw codeError('PHYSICS_NO_BODY', { id: show(id), why: ` (${where})` });
  return found;
}

/** Rapier's description of `kind` between the local anchors, before its frames are set. */
function jointData(kind: JointKind, a1: RAPIER.Vector, a2: RAPIER.Vector): RAPIER.JointData {
  switch (kind.type) {
    case 'fixed':
      return RAPIER.JointData.fixed(a1, { x: 0, y: 0, z: 0, w: 1 }, a2, { x: 0, y: 0, z: 0, w: 1 });
    case 'ball':
      return RAPIER.JointData.spherical(a1, a2);
    case 'hinge':
      return RAPIER.JointData.revolute(a1, a2, X);
    case 'slider':
      return RAPIER.JointData.prismatic(a1, a2, X);
    case 'rope':
      return RAPIER.JointData.rope(amount(kind.length, null, 'addJoint({ kind: { length } })'), a1, a2);
    case 'spring': {
      const where = 'addJoint({ kind })';
      const [stiffness, damping] = [amount(kind.stiffness, SPRING.stiffness, where), amount(kind.damping, SPRING.damping, where)]; // prettier-ignore
      return RAPIER.JointData.spring(amount(kind.length, null, `${where.slice(0, -2)}: { length } })`), stiffness, damping, a1, a2); // prettier-ignore
    }
  }
}

/** A hinge's or slider's limits, checked: low ≤ high. */
function limits(value: unknown): readonly [number, number] | null {
  if (value === undefined) return null;
  const ok = Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) && value[0] <= value[1];
  check(ok, 'addJoint({ kind: { limits } })', value, '[low, high], finite, low ≤ high');
  return value as [number, number];
}

/** The raw joint set's per-axis limits, which a hinge's and a slider's `setLimits` call and a ball's class lacks. */
type RawLimits = { jointSetLimits(handle: number, axis: number, min: number, max: number): void };

/**
 * What sets a joint's motors and limits from its kind, its numbers checked first. Rapier 0.21 hands a ball joint back
 * typed as a generic one, without its motors, so a ball's springs go through its own class over the same handle, and
 * its JS has no limits for a ball, so they go through the joint set's raw per-axis call, as a hinge's do underneath.
 */
function driveOf(kind: JointKind, world: RAPIER.World): (joint: RAPIER.ImpulseJoint) => void {
  const where = 'addJoint({ kind })';
  if (kind.type === 'ball') {
    const [spring, damping] = [amount(kind.spring, 0, where), amount(kind.damping, 0, where)];
    const bounds = kind.limits === undefined ? null : kind.limits;
    check(bounds === null || (Array.isArray(bounds) && bounds.length === 3), 'addJoint({ kind: { limits } })', bounds, 'three [low, high] pairs: about X, Y and Z'); // prettier-ignore
    const ranges = bounds ? bounds.map((range) => limits(range ?? null) as [number, number]) : null; // a missing pair throws
    return (joint) => {
      if (ranges) ranges.forEach(([lo, hi], i) => (world.impulseJoints.raw as unknown as RawLimits).jointSetLimits(joint.handle, AXES[i], lo, hi)); // prettier-ignore
      if (!(spring > 0 || damping > 0)) return;
      const ball = new RAPIER.SphericalImpulseJoint(world.impulseJoints.raw, world.bodies, joint.handle);
      for (const axis of AXES) ball.configureMotorPosition(axis, 0, spring, damping);
    };
  }
  if (kind.type !== 'hinge' && kind.type !== 'slider') return () => {};
  const range = limits(kind.limits);
  const [spring, damping] = [amount(kind.spring, 0, where), amount(kind.damping, 0, where)];
  const force = kind.type === 'hinge' ? amount(kind.motorForce, 0, where) : 0;
  const speed = kind.type === 'hinge' && kind.motorSpeed !== undefined ? kind.motorSpeed : 0;
  check(Number.isFinite(speed), where, kind, 'a motorSpeed in rad/s, finite');
  return (joint) => {
    const unit = joint as RAPIER.UnitImpulseJoint;
    if (range) unit.setLimits(range[0], range[1]);
    if (spring > 0) unit.configureMotorPosition(0, spring, damping);
    else if (force > 0) unit.configureMotorVelocity(speed, force);
    else if (damping > 0) unit.configureMotorVelocity(0, damping);
  };
}

/** Joins two bodies, or a body to the world, as `spec` says (see the file comment); returns the joint's id. */
export function addJoint(physics: Physics, spec: JointSpec): number {
  check(isPlainObject(spec), 'addJoint(spec)', spec, 'a joint: { a, b, at, kind }');
  const world = rapierOf(physics);
  const kind = spec.kind;
  const types = ['fixed', 'ball', 'hinge', 'slider', 'rope', 'spring'];
  check(isPlainObject(kind) && types.includes(kind.type), 'addJoint({ kind })', kind, `a kind: { type: ${types.map((t) => `'${t}'`).join(', ')} }`); // prettier-ignore
  const owner = bodyOf(world, spec.a, 'addJoint({ a })');
  const other = spec.b === null ? null : bodyOf(world, spec.b, 'addJoint({ b })');
  const at = vec(spec.at, 'addJoint({ at })');
  const atB = vec(spec.atB ?? spec.at, 'addJoint({ atB })');
  // Rapier measures the second body from the first: a joint to the world holds `a` from its anchor at `atB`
  const [first, second] = other ? [owner, other] : [null, owner];
  const p1 = first ? first.translation() : atB;
  const r1 = first ? q3(first.rotation(), qa) : qa.identity();
  const [p2, r2] = [second.translation(), q3(second.rotation(), qb)];
  const rest = spec.rest === undefined ? qr.copy(r1).invert().multiply(r2) : q3(quat(spec.rest, 'addJoint({ rest })'), qr); // prettier-ignore
  const toward = 'axis' in kind && kind.axis !== undefined ? vec(kind.axis, 'addJoint({ kind: { axis } })') : null;
  const axis = toward ? va.set(toward.x, toward.y, toward.z) : va.copy(kind.type === 'slider' ? Y : X);
  check(axis.lengthSq() > 0, 'addJoint({ kind: { axis } })', kind, 'an axis that is not zero');
  const given = spec.frame === undefined ? null : quat(spec.frame, 'addJoint({ frame })');
  const frame = given ? q3(given, qf) : qf.setFromUnitVectors(X, axis.normalize()); // its X the axis
  const frame1 = new Quaternion().copy(r1).invert().multiply(frame);
  const frame2 = new Quaternion().copy(rest).invert().multiply(frame1); // the frames meet when b rests on a
  const local = (p: RAPIER.Vector, r: Quaternion, point: RAPIER.Vector) =>
    new Vector3(point.x - p.x, point.y - p.y, point.z - p.z).applyQuaternion(r.clone().invert());
  const [a1, a2] = [local(p1, r1, other ? at : atB), local(p2, r2, other ? atB : at)];
  const data = jointData(kind, a1, a2);
  const drive = driveOf(kind, world);
  const anchor = first ?? world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(atB.x, atB.y, atB.z));
  const joint = world.createImpulseJoint(data, anchor, second, true);
  if (kind.type !== 'rope' && kind.type !== 'spring') {
    joint.setLocalFrame1(a1, frame1);
    joint.setLocalFrame2(a2, frame2);
  }
  drive(joint);
  joint.setContactsEnabled(spec.contacts ?? false);
  return bodyId(joint.handle);
}

/** The joint `id` names, or null: removed, never added, or its slot reused since. */
function liveJoint(world: RAPIER.World, id: number): RAPIER.ImpulseJoint | null {
  const found = Number.isInteger(id) && id >= 0 ? world.getImpulseJoint(handleOf(id)) : null;
  return found && bodyId(found.handle) === id ? found : null;
}

/** The joint `id` names, or `PHYSICS_NO_JOINT`. */
function jointOf(physics: Physics, id: number): RAPIER.ImpulseJoint {
  const found = liveJoint(rapierOf(physics), id);
  if (found) return found;
  const why = Number.isInteger(id) && id >= 0 ? ': it was removed, or its body was' : ': ids are whole numbers from 0';
  throw codeError('PHYSICS_NO_JOINT', { id: show(id), why });
}

/** Removes a joint (a joint to the world leaves its anchor, `jointBodies(…)[0]`). Throws `PHYSICS_NO_JOINT`. */
export function removeJoint(physics: Physics, id: number): void {
  rapierOf(physics).removeImpulseJoint(jointOf(physics, id), true);
}

/** Whether the joint exists. */
export function hasJoint(physics: Physics, id: number): boolean {
  return liveJoint(rapierOf(physics), id) !== null;
}

/** Every joint's id, in id order. */
export function joints(physics: Physics): number[] {
  const ids: number[] = [];
  rapierOf(physics).impulseJoints.forEach((joint) => void ids.push(bodyId(joint.handle)));
  return ids.sort((a, b) => a - b);
}

/** The two bodies a joint holds: `a` and `b`, or the anchor and `a` for a joint to the world. */
export function jointBodies(physics: Physics, id: number): [number, number] {
  const joint = jointOf(physics, id);
  return [bodyId(joint.body1().handle), bodyId(joint.body2().handle)];
}
