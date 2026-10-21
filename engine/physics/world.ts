/**
 * @file The physics world (PLAN.md WP 3.1, §6.1, §6.5 items 4–7; doctrines: Reproducible, Quality under the hood):
 * Rapier behind plain terms. `createPhysics()` makes a world that holds rigid bodies, steps inside the sim, answers
 * queries and is the sim world's physics hook: its state is hashed with the rest of the sim, and its capture restores
 * exactly. This module and its siblings (`rapierOf`) are the only ones that import Rapier (ESLint's layer rule).
 *
 * Rapier is `@dimforge/rapier3d-simd-compat` 0.21.0 (§4.7): the SIMD build, its WebAssembly inlined, the same state
 * run to run and in Node and Chromium, and restores that continue exactly. This module initializes it once, when it is
 * first imported (a top-level `await`, about 50 ms in Node), so everything after is synchronous.
 *
 * Bodies are plain data in, ids out: `addBody({ type, position, rotation, velocity, angularVelocity, colliders, group,
 * … })` returns the body's id (engine/physics/capture.ts), `readBody(id)` copies its pose and velocities into three.js
 * math classes, and `setBody`, `applyImpulse` and `removeBody` change it. Shapes and vectors are those of
 * engine/physics/queries.ts, and a collider may also be a convex hull of points (`{ type: 'hull', points }`: a ramp's
 * wedge, a dais's frustum) or a heightfield (terrain: engine/physics/heightfield.ts); colliders take their group from
 * the body (`prop` for dynamic bodies, `world` otherwise) unless they name one (engine/physics/groups.ts). Densities
 * are in kg/m³ (1,000, water, by default).
 *
 * Stepping: `step(sim)` sets the step length to the sim's `dt` and gravity to the `physics.gravity` setting
 * (engine/physics/params.ts), then steps Rapier once. The sim runs it as the system `physics`, in the phase of the
 * same name, after `ai` and `anim` and before `readback`, where systems copy results into components.
 *
 * Invariants (the ordered world, §6.5 item 4): bodies and their colliders enter Rapier in the order game code adds
 * them, so the same calls give the same handles and ids; `bodies()` and the hashed state go in id order. The physics
 * world holds no state of its own beside Rapier's, so a restore (Rapier's snapshot, engine/physics/capture.ts) brings
 * everything back. A body's id stays its own until it is removed; a later body may reuse its slot under another id.
 * An unknown id throws `PHYSICS_NO_BODY`. A scene with `physics: true` gets one, bound to its sim world
 * (engine/physics/binding.ts: `physicsOf(w)` returns it).
 *
 * @example
 * import { createSettings } from '../core/settings';
 * const p = createPhysics();
 * const floor = p.addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [20, 1, 20] }, position: [0, -0.5, 0] }] });
 * const crate = p.addBody({ position: [0, 2, 0], colliders: [{ shape: { type: 'box', size: [1, 1, 1] } }] });
 * const settings = createSettings().sim;
 * for (let i = 0; i < 120; i++) p.step({ dt: 1 / 60, settings });
 * p.readBody(crate).position.y; // 0.5, resting on the floor
 * p.raycast([0, 5, 0], [0, -1, 0])?.body === crate; // true
 * @see engine/physics/world.test.ts
 */
import RAPIER from '@dimforge/rapier3d-simd-compat';
import { codeError, defineCodes } from '../core/log';
import { Quaternion, Vector3 } from '../core/math';
import { isPlainObject, show } from '../core/schema';
import {
  bodyId,
  bodyIds,
  capturePhysics,
  handleOf,
  physicsState,
  restorePhysics,
  type PhysicsCapture,
} from './capture';
import { groupBits, type GroupName } from './groups';
import { heightfieldDesc, type HeightfieldShape } from './heightfield';
import { INTEGRATION_PARAMETERS } from './params';
import {
  check,
  overlap,
  probe,
  quat,
  raycast,
  hullPoints,
  shapeArgs,
  shapeCast,
  vec,
  type Ground,
  type Hit,
  type HullShape,
  type OverlapOptions,
  type ProbeOptions,
  type QuatLike,
  type RayOptions,
  type Shape,
  type ShapeCastOptions,
  type Vec3Like,
} from './queries';

await RAPIER.init();

/** The codes this module raises, with their fixes. */
export const WORLD_CODES = defineCodes('physics', {
  PHYSICS_NO_BODY: {
    template: 'there is no body {id}{why}',
    fix: 'use an id addBody() returned while its body exists (hasBody(id) tells); bodies() lists them',
  },
});

/** How a body moves: pushed by forces and contacts, never, or by the velocity code gives it. */
export type BodyType = 'dynamic' | 'fixed' | 'kinematic';

/** One collider of a body: a shape where the body puts it, and its material. */
export interface ColliderSpec {
  /** A query shape, or a convex hull of points or a heightfield (bodies only: engine/physics/heightfield.ts). */
  shape: Shape | HullShape | HeightfieldShape;
  /** Where it sits on the body (the body's origin by default). */
  position?: Vec3Like;
  rotation?: QuatLike;
  /** kg/m³ (1,000). */
  density?: number;
  /** Coulomb friction (0.5). */
  friction?: number;
  /** Bounciness, 0 to 1 (0). */
  restitution?: number;
  /** Its collision group (the body's by default). */
  group?: GroupName;
  /** A sensor detects overlaps and blocks nothing. */
  sensor?: boolean;
}

/** A body as `addBody` takes it. */
export interface BodySpec {
  /** `'dynamic'` (the default), `'fixed'` or `'kinematic'` (moved by the velocity code gives it). */
  type?: BodyType;
  position?: Vec3Like;
  rotation?: QuatLike;
  /** Linear velocity (m/s). */
  velocity?: Vec3Like;
  /** Angular velocity (rad/s). */
  angularVelocity?: Vec3Like;
  /** Its colliders, at least one for a body that should touch anything. */
  colliders?: readonly ColliderSpec[];
  /** Its colliders' group: `prop` for a dynamic body, `world` for the others, by default. */
  group?: GroupName;
  linearDamping?: number;
  angularDamping?: number;
  /** Continuous collision detection, for fast small bodies. */
  ccd?: boolean;
  /** Whether it may fall asleep when it rests (true). */
  canSleep?: boolean;
  /** How much of the world's gravity it feels (1). */
  gravityScale?: number;
}

/** A body's state, copied: changing it changes nothing. */
export interface BodyState {
  id: number;
  type: BodyType;
  position: Vector3;
  rotation: Quaternion;
  velocity: Vector3;
  angularVelocity: Vector3;
  sleeping: boolean;
  /** kg. */
  mass: number;
}

/** The changes `setBody` makes; each wakes the body. */
export interface BodyChange {
  position?: Vec3Like;
  rotation?: QuatLike;
  velocity?: Vec3Like;
  angularVelocity?: Vec3Like;
}

/** What `step` reads from the sim: the step length and the settings (`physics.gravity`). */
export interface PhysicsStepper {
  readonly dt: number;
  readonly settings: { get(path: string): unknown };
}

/** A physics world: bodies, stepping, queries, and the sim's physics hook (`state`, `capture`, `restore`). */
export interface Physics {
  /** Bodies in the world. */
  readonly count: number;
  /** Adds a body and returns its id. Throws `PHYSICS_BAD_ARGUMENT` naming a bad field. */
  addBody(spec: BodySpec): number;
  /** Removes a body and its colliders. */
  removeBody(id: number): void;
  /** Whether the body exists. */
  hasBody(id: number): boolean;
  /** Every body's id, in id order. */
  bodies(): number[];
  /** A copy of a body's state. */
  readBody(id: number): BodyState;
  /** Moves, turns or sets the velocities of a body, waking it. */
  setBody(id: number, change: BodyChange): void;
  /** Applies an impulse (N·s), at a world-space point or at the centre of mass. */
  applyImpulse(id: number, impulse: Vec3Like, point?: Vec3Like): void;
  /** One step: `sim.dt` long, under `physics.gravity`. */
  step(sim: PhysicsStepper): void;
  /** The first body a ray strikes, or null (engine/physics/queries.ts). */
  raycast(origin: Vec3Like, direction: Vec3Like, options?: RayOptions): Hit | null;
  /** The first body a moving shape strikes, or null. */
  shapeCast(shape: Shape, from: Vec3Like, direction: Vec3Like, options?: ShapeCastOptions): Hit | null;
  /** The bodies a shape overlaps, by id, in id order. */
  overlap(shape: Shape, position: Vec3Like, options?: OverlapOptions): number[];
  /** The ground under `(x, z)`: height, normal and body, or null. */
  probe(x: number, z: number, options?: ProbeOptions): Ground | null;
  /** The hook's state: every body's id, translation, rotation and velocities, in id order (what the hash covers). */
  state(): Float64Array;
  /** The hook's capture: Rapier's snapshot (engine/physics/capture.ts). */
  capture(): PhysicsCapture;
  /** Puts back a capture; the next step continues exactly. Restoring alone desyncs the sim: use `w.restore`. */
  restore(data: unknown): void;
  /** Frees Rapier's memory; the world is unusable after. */
  dispose(): void;
}

/** Collider defaults: Rapier's friction, no bounce, water's density. */
const COLLIDER_DEFAULTS = { density: 1000, friction: 0.5, restitution: 0 };

/** Rapier's body types, by our names, and back. */
const TYPES: Record<BodyType, () => RAPIER.RigidBodyDesc> = {
  dynamic: () => RAPIER.RigidBodyDesc.dynamic(),
  fixed: () => RAPIER.RigidBodyDesc.fixed(),
  kinematic: () => RAPIER.RigidBodyDesc.kinematicVelocityBased(),
};
const NAMES: Record<number, BodyType> = {
  [RAPIER.RigidBodyType.Dynamic]: 'dynamic',
  [RAPIER.RigidBodyType.Fixed]: 'fixed',
  [RAPIER.RigidBodyType.KinematicVelocityBased]: 'kinematic',
  [RAPIER.RigidBodyType.KinematicPositionBased]: 'kinematic',
};

/** A number in range, or the fallback; throws `PHYSICS_BAD_ARGUMENT`. */
function num(value: number | undefined, fallback: number, where: string, min = 0, max = Infinity): number {
  if (value === undefined) return fallback;
  check(Number.isFinite(value) && value >= min && value <= max, where, value, `a number from ${min} to ${max}`);
  return value;
}

/** Applies the pinned integration parameters (engine/physics/params.ts). */
function pin(world: RAPIER.World): void {
  const p = INTEGRATION_PARAMETERS;
  Object.assign(world.integrationParameters, {
    numSolverIterations: p.numSolverIterations,
    numInternalPgsIterations: p.numInternalPgsIterations,
    maxCcdSubsteps: p.maxCcdSubsteps,
    lengthUnit: p.lengthUnit,
    normalizedAllowedLinearError: p.normalizedAllowedLinearError,
    normalizedPredictionDistance: p.normalizedPredictionDistance,
    contact_natural_frequency: p.contactNaturalFrequency,
  });
}

/** A Rapier collider description of a shape: a hull from its points, a heightfield from its heights, the others from their sizes. */
function shapeDesc(shape: Shape | HullShape | HeightfieldShape, where: string): RAPIER.ColliderDesc {
  if ((shape as { type?: unknown } | undefined)?.type === 'heightfield') return heightfieldDesc(shape as HeightfieldShape, where); // prettier-ignore
  if ((shape as { type?: unknown } | undefined)?.type === 'hull') {
    const hull = RAPIER.ColliderDesc.convexHull(hullPoints(shape as HullShape, where));
    check(hull !== null, `${where}.points`, (shape as HullShape).points, 'points Rapier can wrap in a hull');
    return hull as RAPIER.ColliderDesc;
  }
  const [kind, a, b, c] = shapeArgs(shape as Shape, where);
  if (kind === 'cuboid') return RAPIER.ColliderDesc.cuboid(a, b, c);
  if (kind === 'ball') return RAPIER.ColliderDesc.ball(a);
  return kind === 'capsule' ? RAPIER.ColliderDesc.capsule(a, b) : RAPIER.ColliderDesc.cylinder(a, b);
}

/** A Rapier collider description from a spec. */
function colliderDesc(spec: ColliderSpec, group: GroupName, where: string): RAPIER.ColliderDesc {
  check(isPlainObject(spec), where, spec, 'a collider: { shape, position?, rotation?, density?, friction?, … }');
  const desc = shapeDesc(spec.shape, `${where}.shape`);
  const at = vec(spec.position ?? [0, 0, 0], `${where}.position`);
  return desc
    .setTranslation(at.x, at.y, at.z)
    .setRotation(quat(spec.rotation, `${where}.rotation`))
    .setDensity(num(spec.density, COLLIDER_DEFAULTS.density, `${where}.density`))
    .setFriction(num(spec.friction, COLLIDER_DEFAULTS.friction, `${where}.friction`))
    .setRestitution(num(spec.restitution, COLLIDER_DEFAULTS.restitution, `${where}.restitution`, 0, 1))
    .setCollisionGroups(groupBits(spec.group ?? group))
    .setSensor(spec.sensor ?? false);
}

/** Makes a physics world (Rapier initialized at import): empty, with the pinned integration parameters. */
export function createPhysics(): Physics {
  let world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  pin(world);
  const body = (id: number): RAPIER.RigidBody => {
    const found = Number.isInteger(id) && id >= 0 ? world.bodies.get(handleOf(id)) : null;
    if (found) return found;
    const why = Number.isInteger(id) && id >= 0 ? ': it was removed, or never added' : ': ids are whole numbers from 0';
    throw codeError('PHYSICS_NO_BODY', { id: show(id), why });
  };
  const physics: Physics = {
    get count() {
      return world.bodies.len();
    },
    addBody(spec) {
      check(isPlainObject(spec), 'addBody(spec)', spec, 'a body: { type?, position?, colliders: [{ shape }], … }');
      const type = spec.type ?? 'dynamic';
      check(Object.hasOwn(TYPES, type), 'addBody({ type })', type, "'dynamic', 'fixed' or 'kinematic'");
      const at = vec(spec.position ?? [0, 0, 0], 'addBody({ position })');
      const v = vec(spec.velocity ?? [0, 0, 0], 'addBody({ velocity })');
      const desc = TYPES[type]()
        .setTranslation(at.x, at.y, at.z)
        .setRotation(quat(spec.rotation, 'addBody({ rotation })'))
        .setLinvel(v.x, v.y, v.z)
        .setAngvel(vec(spec.angularVelocity ?? [0, 0, 0], 'addBody({ angularVelocity })'))
        .setLinearDamping(num(spec.linearDamping, 0, 'addBody({ linearDamping })'))
        .setAngularDamping(num(spec.angularDamping, 0, 'addBody({ angularDamping })'))
        .setGravityScale(num(spec.gravityScale, 1, 'addBody({ gravityScale })', -Infinity))
        .setCcdEnabled(spec.ccd ?? false)
        .setCanSleep(spec.canSleep ?? true);
      const group = spec.group ?? (type === 'dynamic' ? 'prop' : 'world');
      groupBits(group); // an unknown group throws before anything is added
      const colliders = spec.colliders ?? [];
      check(Array.isArray(colliders), 'addBody({ colliders })', colliders, 'a list of colliders');
      const descs = colliders.map((collider, i) => colliderDesc(collider, group, `addBody({ colliders[${i}] })`));
      const made = world.createRigidBody(desc);
      for (const collider of descs) world.createCollider(collider, made);
      return bodyId(made.handle);
    },
    removeBody: (id) => world.removeRigidBody(body(id)),
    hasBody: (id) => Number.isInteger(id) && id >= 0 && world.bodies.contains(handleOf(id)),
    bodies: () => bodyIds(world),
    readBody(id) {
      const b = body(id);
      const [t, r, v, w] = [b.translation(), b.rotation(), b.linvel(), b.angvel()];
      return {
        id,
        type: NAMES[b.bodyType()],
        position: new Vector3(t.x, t.y, t.z),
        rotation: new Quaternion(r.x, r.y, r.z, r.w),
        velocity: new Vector3(v.x, v.y, v.z),
        angularVelocity: new Vector3(w.x, w.y, w.z),
        sleeping: b.isSleeping(),
        mass: b.mass(),
      };
    },
    setBody(id, change) {
      const b = body(id);
      check(
        isPlainObject(change),
        'setBody(id, change)',
        change,
        '{ position?, rotation?, velocity?, angularVelocity? }',
      );
      const { position, rotation, velocity, angularVelocity } = change;
      const values = {
        position: position && vec(position, 'setBody({ position })'),
        rotation: rotation && quat(rotation, 'setBody({ rotation })'),
        velocity: velocity && vec(velocity, 'setBody({ velocity })'),
        angularVelocity: angularVelocity && vec(angularVelocity, 'setBody({ angularVelocity })'),
      };
      if (values.position) b.setTranslation(values.position, true);
      if (values.rotation) b.setRotation(values.rotation, true);
      if (values.velocity) b.setLinvel(values.velocity, true);
      if (values.angularVelocity) b.setAngvel(values.angularVelocity, true);
    },
    applyImpulse(id, impulse, point) {
      const b = body(id);
      const push = vec(impulse, 'applyImpulse(impulse)');
      if (point === undefined) b.applyImpulse(push, true);
      else b.applyImpulseAtPoint(push, vec(point, 'applyImpulse(point)'), true);
    },
    step(sim) {
      check(Number.isFinite(sim?.dt) && sim.dt > 0, 'step(sim)', sim?.dt, 'a sim with a step length dt above 0');
      world.timestep = sim.dt;
      const gravity = sim.settings.get('physics.gravity');
      check(typeof gravity === 'number' && Number.isFinite(gravity), 'step(sim)', gravity, 'a physics.gravity setting');
      world.gravity = { x: 0, y: -(gravity as number), z: 0 };
      world.step();
    },
    raycast: (origin, direction, options) => raycast(world, origin, direction, options),
    shapeCast: (shape, from, direction, options) => shapeCast(world, shape, from, direction, options),
    overlap: (shape, position, options) => overlap(world, shape, position, options),
    probe: (x, z, options) => probe(world, x, z, options),
    state: () => physicsState(world),
    capture: () => capturePhysics(world),
    restore(data) {
      const restored = restorePhysics(data);
      world.free();
      world = restored;
      pin(world);
    },
    dispose: () => world.free(),
  };
  rapierWorlds.set(physics, () => world);
  return physics;
}

/** The Rapier world behind each physics world, for `rapierOf`. */
const rapierWorlds = new WeakMap<Physics, () => RAPIER.World>();

/** The Rapier world behind `physics` now (a restore replaces it): for the modules beside this one only. */
export function rapierOf(physics: Physics): RAPIER.World {
  const world = rapierWorlds.get(physics);
  if (!world) throw codeError('PHYSICS_NONE', { what: 'this object' });
  return world();
}
