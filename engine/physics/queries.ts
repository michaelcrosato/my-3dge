/**
 * @file Queries (PLAN.md WP 3.1, §6.1; doctrine: Common ground): raycasts, shape casts, overlaps and the ground
 * `probe(x, z)` over a Rapier world, in plain terms, and the plain-data shapes and vectors that bodies and queries share.
 * engine/physics/world.ts offers them on a physics world; engine/sim/queryView.ts hands them, read-only, to
 * presentation code (the chase camera's wall avoidance, audio occlusion, foot placement).
 *
 * Terms: vectors are three.js's `Vector3` or `{ x, y, z }` or `[x, y, z]`; rotations `Quaternion`, `{ x, y, z, w }` or
 * `[x, y, z, w]`. Shapes are sized as three.js sizes its geometries: a box by its full `size` (BoxGeometry's width,
 * height, depth), a capsule by `radius` and the `height` of its straight middle (CapsuleGeometry), a cylinder by
 * `radius` and full `height`. Bodies also take a convex hull (`HullShape`: the smallest convex solid holding its points,
 * for ramps and platforms; WP 4.2), which queries do not cast. A hit names the body it struck by id (engine/physics/capture.ts), never a Rapier object,
 * with `distance` in metres along the direction (normalized first), the world-space `point` and the surface `normal`.
 *
 * Invariants: queries read and never change the world. They see colliders as of the last physics step: Rapier updates
 * its broad phase inside the step, so a body added since is seen from the next step on. Sensors never block a query.
 * `groups` names the collision groups a query hits (engine/physics/groups.ts; all of them by default, the ground's
 * `world` and `prop` for `probe`); `exclude` skips one body (the caster's own); `fixed` meets fixed bodies only (the
 * level, never a door, a lift or a prop that moves: a camera's walls). `overlap` lists body ids in id order, each once. A bad argument throws `PHYSICS_BAD_ARGUMENT` naming it.
 *
 * Rapier's own names differ, a trap §4.8 measured: `timeOfImpact` on ray hits, `time_of_impact` on shape-cast hits,
 * and `castShape`'s `targetDistance` (here `margin`). This module is the only place that meets them.
 *
 * @example
 * import { createSettings } from '../core/settings';
 * import { createPhysics } from './world';
 * const p = createPhysics();
 * p.addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [10, 1, 10] }, position: [0, -0.5, 0] }] });
 * p.step({ dt: 1 / 60, settings: createSettings().sim }); // queries see the floor from this step on
 * p.raycast([0, 5, 0], [0, -1, 0]); // { body: 0, distance: 5, point: Vector3(0, 0, 0), normal: Vector3(0, 1, 0) }
 * p.probe(0, 0); // { y: 0, normal: Vector3(0, 1, 0), body: 0 }
 * p.overlap({ type: 'ball', radius: 0.5 }, [0, 0.2, 0]); // [0]
 * @see engine/physics/queries.test.ts
 */
import RAPIER from '@dimforge/rapier3d-simd-compat';
import { codeError, defineCodes } from '../core/log';
import { Quaternion, Vector3 } from '../core/math';
import { show } from '../core/schema';
import { bodyId, liveBody } from './capture';
import { queryBits, type GroupName } from './groups';

/** The codes this module raises, with their fixes. */
export const QUERY_CODES = defineCodes('physics', {
  PHYSICS_BAD_ARGUMENT: {
    template: '{where} got {value}',
    fix: 'pass {expected}',
    doc: 'Raised by bodies and queries (engine/physics/world.ts, engine/physics/queries.ts) for a vector, rotation, shape, size or option that is not of the right kind: non-finite numbers, a zero direction, a size that is not positive, an unknown shape type.',
  },
});

/** A vector: three.js's `Vector3`, `{ x, y, z }` or `[x, y, z]`. */
export type Vec3Like = Readonly<{ x: number; y: number; z: number }> | readonly [number, number, number];

/** A rotation: three.js's `Quaternion`, `{ x, y, z, w }` or `[x, y, z, w]`. */
export type QuatLike =
  Readonly<{ x: number; y: number; z: number; w: number }> | readonly [number, number, number, number];

/** A shape, sized like three.js's geometries (see the file comment). */
export type Shape =
  | { readonly type: 'box'; readonly size: Vec3Like }
  | { readonly type: 'ball'; readonly radius: number }
  | { readonly type: 'capsule'; readonly radius: number; readonly height: number }
  | { readonly type: 'cylinder'; readonly radius: number; readonly height: number };

/** A convex hull, for bodies only: the smallest convex solid holding `points` (m, in the body's frame), at least 4 not all in one plane. */
export interface HullShape {
  readonly type: 'hull';
  readonly points: readonly Vec3Like[];
}

/** What every query takes: the groups it hits, and a body it skips. */
export interface QueryOptions {
  /** The collision groups it hits (all of them by default). */
  groups?: GroupName | readonly GroupName[];
  /** A body id it ignores: the caster's own body. */
  exclude?: number;
  /** Whether it meets fixed bodies only: the level, never what moves (a door, a lift, a prop). False by default. */
  fixed?: boolean;
}

/** A raycast's options. */
export interface RayOptions extends QueryOptions {
  /** How far it looks (m; 1000). */
  maxDistance?: number;
  /** Whether a ray starting inside a shape hits it at distance 0 (true) or at its far side (false). */
  solid?: boolean;
}

/** A shape cast's options. */
export interface ShapeCastOptions extends QueryOptions {
  /** How far it travels (m; 1000). */
  maxDistance?: number;
  /** The shape's rotation (none by default). */
  rotation?: QuatLike;
  /** A hit counts once the shape comes this close (m; 0, touching). Rapier calls it `targetDistance`. */
  margin?: number;
}

/** An overlap's options. */
export interface OverlapOptions extends QueryOptions {
  /** The shape's rotation (none by default). */
  rotation?: QuatLike;
}

/** A probe's options: where the downward ray starts, and the groups that count as ground. */
export interface ProbeOptions extends QueryOptions {
  /** The height the ray starts from (m; 1000). */
  from?: number;
  /** How far below 0 it looks (m; 1000). */
  depth?: number;
}

/** What a raycast or shape cast struck. */
export interface Hit {
  /** The body struck, by id. */
  body: number;
  /** Metres travelled along the direction. */
  distance: number;
  /** The point struck, world space (on the body struck). */
  point: Vector3;
  /** The struck surface's outward normal, world space. */
  normal: Vector3;
}

/** The ground under a point: its height, its normal and the body it belongs to. */
export interface Ground {
  y: number;
  normal: Vector3;
  body: number;
}

/** How far a query looks by default (m). */
const FAR = 1000;
/** Sensors never block a query. */
const FLAGS = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
/** Nor, with `fixed`, any body that moves. */
const FIXED_FLAGS = FLAGS | RAPIER.QueryFilterFlags.ONLY_FIXED;
/** The groups `probe` counts as ground by default. */
const GROUND: readonly GroupName[] = ['world', 'prop'];

/** Throws `PHYSICS_BAD_ARGUMENT` unless `ok`. */
export function check(ok: boolean, where: string, value: unknown, expected: string): void {
  if (!ok) throw codeError('PHYSICS_BAD_ARGUMENT', { where, value: show(value), expected });
}

/** A finite number, or throws. */
function finite(value: unknown, where: string): number {
  check(typeof value === 'number' && Number.isFinite(value), where, value, 'a finite number');
  return value as number;
}

/** A positive finite number, or throws. */
function positive(value: unknown, where: string): number {
  check(typeof value === 'number' && Number.isFinite(value) && value > 0, where, value, 'a number above 0');
  return value as number;
}

/** A vector as Rapier's `{ x, y, z }`, checked. */
export function vec(value: Vec3Like, where: string): RAPIER.Vector {
  const [x, y, z] = Array.isArray(value) ? value : [(value as Vector3).x, (value as Vector3).y, (value as Vector3).z];
  const ok =
    [x, y, z].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    (!Array.isArray(value) || value.length === 3);
  check(ok, where, value, 'a vector: a Vector3, { x, y, z } or [x, y, z] of finite numbers');
  return { x, y, z };
}

/** A rotation as Rapier's `{ x, y, z, w }`, checked and normalized. */
export function quat(value: QuatLike | undefined, where: string): RAPIER.Rotation {
  if (value === undefined) return { x: 0, y: 0, z: 0, w: 1 };
  const q = value as Quaternion;
  const [x, y, z, w] = Array.isArray(value) ? value : [q.x, q.y, q.z, q.w];
  const length = Math.hypot(x, y, z, w);
  const ok =
    [x, y, z, w].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    length > 0 &&
    (!Array.isArray(value) || value.length === 4);
  check(ok, where, value, 'a rotation: a Quaternion, { x, y, z, w } or [x, y, z, w], not all zero');
  return { x: x / length, y: y / length, z: z / length, w: w / length };
}

/** A unit direction, checked: not zero. */
function direction(value: Vec3Like, where: string): RAPIER.Vector {
  const { x, y, z } = vec(value, where);
  const length = Math.hypot(x, y, z);
  check(length > 0, where, value, 'a direction: a vector that is not zero');
  return { x: x / length, y: y / length, z: z / length };
}

/** Half extents and radii of a shape, checked: `[kind, ...numbers]` as Rapier's constructors take them. */
export function shapeArgs(shape: Shape, where: string): ['cuboid' | 'ball' | 'capsule' | 'cylinder', ...number[]] {
  const type = (shape as { type?: unknown } | undefined)?.type;
  if (type === 'box') {
    const size = vec((shape as { size: Vec3Like }).size, `${where}.size`);
    for (const axis of ['x', 'y', 'z'] as const) positive(size[axis], `${where}.size.${axis}`);
    return ['cuboid', size.x / 2, size.y / 2, size.z / 2];
  }
  if (type === 'ball') return ['ball', positive((shape as { radius: number }).radius, `${where}.radius`)];
  if (type === 'capsule' || type === 'cylinder') {
    const { radius, height } = shape as { radius: number; height: number };
    // A capsule's straight middle may be 0 (a ball); a cylinder needs a height.
    const half = type === 'capsule' ? finite(height, `${where}.height`) / 2 : positive(height, `${where}.height`) / 2;
    check(half >= 0, `${where}.height`, height, 'a height of 0 or more');
    return [type, half, positive(radius, `${where}.radius`)];
  }
  check(false, `${where}.type`, type, "a shape type: 'box', 'ball', 'capsule' or 'cylinder'");
  throw new Error('unreachable');
}

/** How far (m) a hull's points must reach off a line, then off a plane, to make a solid. */
const HULL_TOLERANCE = 1e-6;

/** Whether flattened points span a solid: some 4 of them are not on one plane. */
function spansSolid(flat: Float32Array): boolean {
  const n = flat.length / 3;
  const from0 = (i: number) => [flat[3 * i] - flat[0], flat[3 * i + 1] - flat[1], flat[3 * i + 2] - flat[2]];
  const cross = (a: number[], b: number[]) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const length = (a: number[]) => Math.sqrt(dot(a, a));
  let [axis, normal] = [
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 1; i < n && length(axis) <= HULL_TOLERANCE; i++) axis = from0(i);
  if (length(axis) <= HULL_TOLERANCE) return false;
  for (let i = 1; i < n && length(normal) <= HULL_TOLERANCE * length(axis); i++) normal = cross(axis, from0(i));
  if (length(normal) <= HULL_TOLERANCE * length(axis)) return false;
  for (let i = 1; i < n; i++) if (Math.abs(dot(normal, from0(i))) > HULL_TOLERANCE * length(normal)) return true;
  return false;
}

/** A hull's points, checked (at least 4 finite vectors, not all on one plane), flattened as Rapier takes them. */
export function hullPoints(shape: HullShape, where: string): Float32Array {
  const { points } = shape;
  check(Array.isArray(points) && points.length >= 4, `${where}.points`, points, 'at least 4 points, [x, y, z] each');
  const flat = new Float32Array(points.length * 3);
  points.forEach((point, i) => {
    const { x, y, z } = vec(point, `${where}.points[${i}]`);
    flat.set([x, y, z], i * 3);
  });
  check(spansSolid(flat), `${where}.points`, points, 'points that are not all on one plane (a hull is a solid)');
  return flat;
}

/** A Rapier shape for a query. */
function rapierShape(shape: Shape, where: string): RAPIER.Shape {
  const [kind, a, b, c] = shapeArgs(shape, where);
  if (kind === 'cuboid') return new RAPIER.Cuboid(a, b, c);
  if (kind === 'ball') return new RAPIER.Ball(a);
  return kind === 'capsule' ? new RAPIER.Capsule(a, b) : new RAPIER.Cylinder(a, b);
}

/** The Rapier filter arguments of query options: flags, groups, the excluded body. */
function filter(world: RAPIER.World, options: QueryOptions, where: string, groups?: readonly GroupName[]) {
  const { exclude, fixed } = options;
  check(fixed === undefined || typeof fixed === 'boolean', `${where}({ fixed })`, fixed, 'true or false');
  let body: RAPIER.RigidBody | undefined;
  if (exclude !== undefined) {
    check(Number.isInteger(exclude) && exclude >= 0, `${where}({ exclude })`, exclude, 'a body id');
    body = liveBody(world, exclude) ?? undefined;
    check(body !== undefined, `${where}({ exclude })`, exclude, 'the id of a body in this world');
  }
  return [fixed ? FIXED_FLAGS : FLAGS, queryBits(options.groups ?? groups), undefined, body] as const;
}

/** The id of the body a collider belongs to. */
const ownerOf = (collider: RAPIER.Collider) => bodyId(collider.parent()!.handle);

/** The first body a ray from `origin` along `dir` strikes within `maxDistance`, or null. */
export function raycast(world: RAPIER.World, origin: Vec3Like, dir: Vec3Like, options: RayOptions = {}): Hit | null {
  const from = vec(origin, 'raycast(origin)');
  const along = direction(dir, 'raycast(direction)');
  const max = positive(options.maxDistance ?? FAR, 'raycast({ maxDistance })');
  const ray = new RAPIER.Ray(from, along);
  const hit = world.castRayAndGetNormal(ray, max, options.solid ?? true, ...filter(world, options, 'raycast'));
  if (!hit) return null;
  const t = hit.timeOfImpact;
  return {
    body: ownerOf(hit.collider),
    distance: t,
    point: new Vector3(from.x + along.x * t, from.y + along.y * t, from.z + along.z * t),
    normal: new Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
  };
}

/** The first body `shape`, moved from `from` along `dir`, strikes within `maxDistance`, or null. */
export function shapeCast(
  world: RAPIER.World,
  shape: Shape,
  from: Vec3Like,
  dir: Vec3Like,
  options: ShapeCastOptions = {},
): Hit | null {
  const cast = rapierShape(shape, 'shapeCast(shape)');
  const start = vec(from, 'shapeCast(from)');
  const along = direction(dir, 'shapeCast(direction)');
  const max = positive(options.maxDistance ?? FAR, 'shapeCast({ maxDistance })');
  const margin = options.margin ?? 0;
  check(Number.isFinite(margin) && margin >= 0, 'shapeCast({ margin })', margin, 'a distance of 0 or more');
  const rotation = quat(options.rotation, 'shapeCast({ rotation })');
  const args = filter(world, options, 'shapeCast');
  const hit = world.castShape(start, rotation, along, cast, margin, max, true, ...args);
  if (!hit) return null;
  return {
    body: ownerOf(hit.collider),
    distance: hit.time_of_impact,
    point: new Vector3(hit.witness1.x, hit.witness1.y, hit.witness1.z),
    normal: new Vector3(hit.normal1.x, hit.normal1.y, hit.normal1.z),
  };
}

/** The bodies `shape` at `position` overlaps, by id, in id order, each once. */
export function overlap(world: RAPIER.World, shape: Shape, position: Vec3Like, options: OverlapOptions = {}): number[] {
  const test = rapierShape(shape, 'overlap(shape)');
  const at = vec(position, 'overlap(position)');
  const rotation = quat(options.rotation, 'overlap({ rotation })');
  const found = new Set<number>();
  const [flags, groups, , body] = filter(world, options, 'overlap');
  world.intersectionsWithShape(
    at,
    rotation,
    test,
    (collider) => !!found.add(ownerOf(collider)),
    flags,
    groups,
    undefined,
    body,
  );
  return [...found].sort((a, b) => a - b);
}

/** The ground under `(x, z)`: the first surface a ray straight down from `from` meets, or null where there is none. */
export function probe(world: RAPIER.World, x: number, z: number, options: ProbeOptions = {}): Ground | null {
  const top = finite(options.from ?? FAR, 'probe({ from })');
  const depth = finite(options.depth ?? FAR, 'probe({ depth })');
  check(top + depth > 0, 'probe({ from, depth })', { from: top, depth }, 'a start above the bottom: from > −depth');
  const origin: Vec3Like = [finite(x, 'probe(x)'), top, finite(z, 'probe(z)')];
  const hit = raycast(world, origin, [0, -1, 0], {
    groups: options.groups ?? GROUND,
    exclude: options.exclude,
    maxDistance: top + depth,
  });
  return hit && { y: hit.point.y, normal: hit.normal, body: hit.body };
}
