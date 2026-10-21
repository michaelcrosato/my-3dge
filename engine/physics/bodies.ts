/**
 * @file Bodies and props (PLAN.md WP 4.1; doctrines: Common ground, Reproducible): what scenes build props, movers
 * and triggers with, on the physics world (engine/physics/world.ts), in plain terms. Scenes keep the state (movers,
 * what a trigger holds) in components and call these from systems; fixtures/scenes/physics-props is the worked example.
 *
 * - **Props.** `addBox(physics, size, spec)`, `addBall`, `addCapsule` and `addCylinder` add a dynamic body of one
 *   shape, sized as three.js sizes its geometries, made of `PROP_MATERIAL` (the prototype's crates and barrels) unless
 *   the spec says otherwise. Stacks stand; bodies at rest fall asleep (a settled stack within a second) and wake when
 *   touched, and `readBody(id).sleeping` says which. `applyTorqueImpulse` turns a body (N·m·s); `knock(physics, id,
 *   from)` is the prototype's knock: a push away from `from` across the ground and up, the same for every mass, and a
 *   tip toward the push with a twist.
 * - **Movers** (shardfall's): kinematic bodies whose pose is a function of time, `moverPose(mover, t)`: back and forth
 *   along `offset` (waiting `hold` at the ends, eased when `smooth`), turning about +Y at `spin`. `driveMover` sets
 *   the velocities that bring the body there when the world steps, so the character controller carries riders, and
 *   reads only the component and the body's pose, so a restore continues exactly. Call it in the phase `ai`, before
 *   the actors move, with the world (`w.time` in step k is k·dt, the step's end: shardfall's `pose((tick + 1) · dt)`).
 * - **Triggers.** `addSensor(physics, shape, spec)` adds a fixed (or kinematic) body whose collider blocks nothing and
 *   detects every dynamic and kinematic body it overlaps; `sensorHits` lists those as of the last step, and
 *   `updateTrigger(physics, trigger)` compares them with `trigger.inside` and returns who entered and left, for the
 *   scene to emit as events. Fixed bodies (the level) never trip one.
 * The lost-body rescue is engine/physics/rescue.ts's (split from here at its cap, WP 13.16).
 *
 * Invariants: no state beside Rapier's and the caller's (`trigger.inside`, the mover's fields); lists are in id order.
 * A mover's colliders sit on its body's origin.
 *
 * Carried from `my-3d2dge:src/stress-world/20-sim.js:141-171` (the props' material and damping, `knockProp`, in SI:
 * 16 units to the metre, the hero's 2,500 mass units to its 70 kg), and shardfall@fa2dab6
 * `crates/pav_core/src/behaviors.rs:14-75` (`drive`, movers) and `entity.rs:118-150` (`MoverDef::amount`).
 *
 * @example
 * import { createPhysics } from './world';
 * const p = createPhysics();
 * p.addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [20, 1, 20] }, position: [0, -0.5, 0] }] });
 * const crate = addBox(p, [0.75, 0.75, 0.75], { position: [0, 0.375, 0] }); // 24 kg of PROP_MATERIAL
 * knock(p, crate, [-1, 0, 0]); // off east at 4.7 m/s and up at 2.5 m/s, tipping east
 * moverPose({ ...MOVER, origin: [0, 0, 0], offset: [6, 0, 0], period: 4 }, 2).position.x; // 6: the far end
 * @see engine/physics/bodies.test.ts
 */
import RAPIER from '@dimforge/rapier3d-simd-compat';
import { codeError } from '../core/log';
import { Quaternion, Vector3 } from '../core/math';
import { copyValue, defineSchema, freezeValue, isPlainObject, show } from '../core/schema';
import { bodyId, handleOf } from './capture';
import type { GroupName } from './groups';
import { check, quat, vec, type HullShape, type QuatLike, type Shape, type Vec3Like } from './queries';
import { rapierOf, type BodySpec, type Physics } from './world';

/**
 * The props' material: a hollow wooden crate's (24 kg at 0.75 m), Coulomb friction, a little bounce, and damping that
 * lets a knocked prop slide and roll to rest. The prototype's 0.5 a cubic unit, its hero 2,500, gives 57 kg/m³.
 */
export const PROP_MATERIAL = Object.freeze({
  /** kg/m³. */
  density: 57,
  friction: 0.7,
  restitution: 0.05,
  /** Per second. */
  linearDamping: 0.3,
  /** Per second. */
  angularDamping: 0.8,
});

/** A prop as `addProp` takes it: a body's pose, velocities and options, and its material. */
export interface PropSpec extends Omit<BodySpec, 'type' | 'colliders'> {
  /** kg/m³ (`PROP_MATERIAL`'s). */
  density?: number;
  friction?: number;
  restitution?: number;
}

/** The Rapier body of `id`, or throws `PHYSICS_NO_BODY`. */
function rigid(physics: Physics, id: number): RAPIER.RigidBody {
  const found = Number.isInteger(id) && id >= 0 ? rapierOf(physics).bodies.get(handleOf(id)) : null;
  if (found) return found;
  const why = Number.isInteger(id) && id >= 0 ? ': it was removed, or never added' : ': ids are whole numbers from 0';
  throw codeError('PHYSICS_NO_BODY', { id: show(id), why });
}

/** A finite number, or the fallback; throws `PHYSICS_BAD_ARGUMENT`. */
function finite(value: number | undefined, fallback: number, where: string): number {
  check(value === undefined || Number.isFinite(value), where, value, 'a finite number');
  return value ?? fallback;
}

/** Adds a dynamic body of one `shape` (a hull too: a rock), of `PROP_MATERIAL` unless `spec` says otherwise; its id. */
export function addProp(physics: Physics, shape: Shape | HullShape, spec: PropSpec = {}): number {
  check(isPlainObject(spec), 'addProp(spec)', spec, 'a prop: { position?, rotation?, density?, friction?, … }');
  const { density, friction, restitution, ...body } = spec;
  const m = PROP_MATERIAL;
  return physics.addBody({
    ...body,
    type: 'dynamic',
    linearDamping: body.linearDamping ?? m.linearDamping,
    angularDamping: body.angularDamping ?? m.angularDamping,
    colliders: [
      {
        shape,
        density: density ?? m.density,
        friction: friction ?? m.friction,
        restitution: restitution ?? m.restitution,
      },
    ],
  });
}

/** Adds a box prop, sized as BoxGeometry (full width, height, depth); returns its id. */
export function addBox(physics: Physics, size: Vec3Like, spec?: PropSpec): number {
  return addProp(physics, { type: 'box', size }, spec);
}

/** Adds a ball prop; returns its id. */
export function addBall(physics: Physics, radius: number, spec?: PropSpec): number {
  return addProp(physics, { type: 'ball', radius }, spec);
}

/** Adds a capsule prop, standing up (`height` is its straight middle, as CapsuleGeometry's); returns its id. */
export function addCapsule(physics: Physics, radius: number, height: number, spec?: PropSpec): number {
  return addProp(physics, { type: 'capsule', radius, height }, spec);
}

/** Adds a cylinder prop, standing up (a barrel); returns its id. */
export function addCylinder(physics: Physics, radius: number, height: number, spec?: PropSpec): number {
  return addProp(physics, { type: 'cylinder', radius, height }, spec);
}

/** Turns a body: an angular impulse (N·m·s) about its centre of mass, waking it. */
export function applyTorqueImpulse(physics: Physics, id: number, torque: Vec3Like): void {
  rigid(physics, id).applyTorqueImpulse(vec(torque, 'applyTorqueImpulse(torque)'), true);
}

/** How hard `knock` hits: speeds, the same for every mass. */
export interface KnockOptions {
  /** Away from `from`, across the ground (4.6875 m/s: the prototype's sword hit, 75 units/s). */
  speed?: number;
  /** Upward (2.5 m/s). */
  up?: number;
  /** The twist about +Y, −0.5 to 0.5 (0): draw it from a sim stream, `w.rng('knock').range(-0.5, 0.5)`. */
  spin?: number;
}

/** The prototype's tip and twist, per kg (m²/s): 40 and 60 units²/s. */
const TIP = 40 / 256;
const TWIST = 60 / 256;

/** Knocks a body away from `from`: a push across the ground and up, a tip toward the push and a twist (`knockProp`). */
export function knock(physics: Physics, id: number, from: Vec3Like, options: KnockOptions = {}): void {
  const b = rigid(physics, id);
  const at = vec(from, 'knock(from)');
  const speed = finite(options.speed, 4.6875, 'knock({ speed })');
  const up = finite(options.up, 2.5, 'knock({ up })');
  const spin = finite(options.spin, 0, 'knock({ spin })');
  const [p, m] = [b.translation(), b.mass()];
  const [dx, dz] = [p.x - at.x, p.z - at.z];
  const d = Math.hypot(dx, dz) || 1;
  const [ux, uz] = [dx / d, dz / d];
  b.applyImpulse({ x: ux * speed * m, y: up * m, z: uz * speed * m }, true);
  b.applyTorqueImpulse({ x: uz * m * TIP, y: spin * m * TWIST, z: -ux * m * TIP }, true); // about up × push
}

/** A mover's fields, for a scene's component: `defineComponent('platform', { description, fields: MOVER_FIELDS })`. */
export const MOVER_FIELDS = defineSchema({
  body: { type: 'integer', default: -1, minimum: -1, description: 'The kinematic body it drives.' },
  origin: { type: 'array', items: { type: 'number' }, default: [0, 0, 0], unit: 'm', description: 'Where it starts.' },
  offset: {
    type: 'array',
    items: { type: 'number' },
    default: [0, 0, 3],
    unit: 'm',
    description: 'The far end of its path, from the origin.',
  },
  period: { type: 'number', default: 4, minimum: 0.05, unit: 's', description: 'One cycle, there and back.' },
  phase: { type: 'number', default: 0, minimum: 0, maximum: 1, description: 'Where in its cycle it is at time 0.' },
  hold: {
    type: 'number',
    default: 0,
    minimum: 0,
    maximum: 0.9,
    description: 'The share of the cycle it waits at the ends, half at each (doors, crushers).',
  },
  smooth: { type: 'boolean', default: true, description: 'Eases in and out; false: constant speed.' },
  yaw: { type: 'number', default: 0, unit: 'rad', description: 'Its heading about +Y at time 0.' },
  spin: { type: 'number', default: 0, unit: 'rad/s', description: 'How fast it turns about +Y.' },
});

/** A mover: a kinematic body's path as a function of time (`MOVER_FIELDS` says what each field means). */
export interface Mover {
  body: number;
  origin: number[];
  offset: number[];
  period: number;
  phase: number;
  hold: number;
  smooth: boolean;
  yaw: number;
  spin: number;
}

/** A mover with every field at its default (no body). */
export const MOVER: Readonly<Mover> = freezeValue(
  Object.fromEntries(
    Object.entries(MOVER_FIELDS).map(([key, field]) => [key, copyValue(field.default)]),
  ) as unknown as Mover,
);

/** Up, the axis movers turn about. */
const UP = new Vector3(0, 1, 0);

/** Where a mover is at `time` (s): back and forth along its offset, turning at its spin (shardfall's `amount`). */
export function moverPose(mover: Mover, time: number): { position: Vector3; rotation: Quaternion } {
  const u = (((time / mover.period + mover.phase) % 1) + 1) % 1;
  const tri = 1 - Math.abs(2 * u - 1);
  const s = Math.min(1, Math.max(0, (tri - mover.hold / 2) / (1 - mover.hold)));
  const a = mover.smooth ? s * s * (3 - 2 * s) : s;
  const [o, d] = [mover.origin, mover.offset];
  const position = new Vector3(o[0] + d[0] * a, o[1] + d[1] * a, o[2] + d[2] * a);
  return { position, rotation: new Quaternion().setFromAxisAngle(UP, mover.yaw + mover.spin * time) };
}

/** Sets a kinematic body's velocities so that it reaches `position` and `rotation` when the world steps `dt`. */
export function driveBody(physics: Physics, id: number, position: Vec3Like, rotation: QuatLike, dt: number): void {
  const b = rigid(physics, id);
  check(b.isKinematic(), 'driveBody(id)', id, 'a kinematic body');
  check(Number.isFinite(dt) && dt > 0, 'driveBody(dt)', dt, 'a step length above 0');
  const [to, at] = [vec(position, 'driveBody(position)'), b.translation()];
  b.setLinvel({ x: (to.x - at.x) / dt, y: (to.y - at.y) / dt, z: (to.z - at.z) / dt }, true);
  const [q, r] = [quat(rotation, 'driveBody(rotation)'), b.rotation()];
  const turn = new Quaternion(q.x, q.y, q.z, q.w).multiply(new Quaternion(-r.x, -r.y, -r.z, r.w));
  const sign = turn.w < 0 ? -1 : 1; // the short way round
  const s = Math.hypot(turn.x, turn.y, turn.z);
  const rate = s > 1e-9 ? (2 * Math.atan2(s, sign * turn.w)) / (s * dt) : 0;
  b.setAngvel({ x: sign * turn.x * rate, y: sign * turn.y * rate, z: sign * turn.z * rate }, true);
}

/** Drives a mover's body toward its pose at `sim.time` (the end of the step being run): `driveMover(physics, m, w)`. */
export function driveMover(physics: Physics, mover: Mover, sim: { readonly time: number; readonly dt: number }): void {
  const { position, rotation } = moverPose(mover, sim.time);
  driveBody(physics, mover.body, position, rotation, sim.dt);
}

/** Where a sensor goes and how it moves. */
export interface SensorSpec {
  /** `'fixed'` (the default) or `'kinematic'`, to move it with `driveBody` or a mover. */
  type?: 'fixed' | 'kinematic';
  position?: Vec3Like;
  rotation?: QuatLike;
  /** Its collision group: what it detects (`world`, everything, by default). */
  group?: GroupName;
}

/** Adds a body whose one collider is a sensor of `shape`: it blocks nothing and detects bodies. Returns its id. */
export function addSensor(physics: Physics, shape: Shape, spec: SensorSpec = {}): number {
  check(isPlainObject(spec), 'addSensor(spec)', spec, 'a sensor: { type?, position?, rotation?, group? }');
  const { type = 'fixed', position, rotation, group } = spec;
  check(type === 'fixed' || type === 'kinematic', 'addSensor({ type })', type, "'fixed' or 'kinematic'");
  const id = physics.addBody({ type, position, rotation, group, colliders: [{ shape, sensor: true }] });
  rigid(physics, id).collider(0).setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL); // kinematic actors too
  return id;
}

/** The dynamic and kinematic bodies a body's sensors overlapped at the last step, in id order. */
export function sensorHits(physics: Physics, id: number): number[] {
  const [world, b] = [rapierOf(physics), rigid(physics, id)];
  const colliders: number[] = [];
  for (let i = 0; i < b.numColliders(); i++) {
    const sensor = b.collider(i);
    if (sensor.isSensor()) world.intersectionPairsWith(sensor, (other) => void colliders.push(other.handle));
  }
  const hits = new Set<number>();
  for (const handle of colliders) {
    const owner = world.getCollider(handle).parent();
    if (owner && owner.handle !== b.handle && !owner.isFixed()) hits.add(bodyId(owner.handle));
  }
  return [...hits].sort((x, y) => x - y);
}

/** A trigger's fields, for a scene's component: `defineComponent('zone', { description, fields: TRIGGER_FIELDS })`. */
export const TRIGGER_FIELDS = defineSchema({
  body: { type: 'integer', default: -1, minimum: -1, description: 'Its sensor body (addSensor).' },
  inside: {
    type: 'array',
    items: { type: 'integer' },
    default: [],
    description: 'The bodies inside it after the last step, in id order.',
  },
});

/** A trigger: its sensor body and the bodies inside it. */
export interface Trigger {
  body: number;
  inside: number[];
}

/** Brings `trigger.inside` up to date with its sensor and returns the bodies that entered and left, in id order. */
export function updateTrigger(physics: Physics, trigger: Trigger): { entered: number[]; left: number[] } {
  const now = sensorHits(physics, trigger.body);
  const [before, after] = [new Set(trigger.inside), new Set(now)];
  const left = trigger.inside.filter((id) => !after.has(id));
  trigger.inside = now;
  return { entered: now.filter((id) => !before.has(id)), left };
}
