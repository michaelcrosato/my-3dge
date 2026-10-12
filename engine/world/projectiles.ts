/**
 * @file Projectiles (PLAN.md WP 6.3, §6.4; doctrine: Reproducible): shots that fly a straight segment each fixed step
 * (bolts, arrows, spit), tested along the whole segment, so a fast one never passes through a thin target or wall
 * between two steps. A scene keeps each shot in a component (`PROJECTILE_FIELDS`), calls `stepProjectiles` from a
 * system, turns its hits into damage (engine/sim/damage.ts) and despawns the shots that stopped.
 *
 * - **A step**: gravity, then the move `v × dt`, swept: the targets the moving ball touches, in the order it reaches
 *   them, and the first wall (`walls`, a test the caller gives: engine/sim/hits.ts `physicsWalls` casts through the
 *   physics world). A target hit stops it unless it still pierces; a wall stops it; past its `life` it expires.
 * - **Targets** are hurt capsules (`HurtCapsule`: upright capsules on their feet; a crowd agent is one) found through
 *   a spatial hash of their feet (`HurtSet`); `capsuleCast` is the exact swept test, the first contact of a moving
 *   ball with a capsule. engine/sim/hits.ts asks the same sets for cones and weapon sweeps.
 *
 * Invariants: everything a shot is lives in its fields (plain data the sim hashes and captures); shots step in list
 * order and their targets in contact order (ties by id), so the hits come out the same everywhere. A piercing shot
 * strikes each target once (`hit`). A shot that stopped is left as it is: its `state` says why, at the place it
 * stopped. Pure arithmetic: no clock, no random stream, no module state carried between calls.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:3553-3606` (`Bullets`: `fire`'s fields, `update`'s gravity, life and
 * wall stop, `hit`'s teams and piercing), moved to 3D, in SI, with swept tests (the old ones tested one point a step,
 * so a fast bullet passed through targets). The patterns (`E.pattern`) are WP 10.4's.
 *
 * @example
 * import { SpatialHash } from './spatial';
 * const bolt = { ...PROJECTILE, x: 0, y: 1, z: 0, vz: 600, radius: 0.05 }; // 10 m a step
 * const post = { x: 0, y: 0, z: 6, radius: 0.1, height: 1.6 }; // a thin post 6 m ahead
 * const targets = { hash: new SpatialHash().add(7, post.x, post.z), hurt: () => post };
 * stepProjectiles([bolt], { dt: 1 / 60, targets }); // [{ shot: 0, target: 7, share: 0.585, … }]: no tunnelling
 * [bolt.state, bolt.z]; // ['hit', 5.85]: stopped where it touched the post
 * @see engine/world/projectiles.test.ts
 */
import { codeError } from '../core/log';
import { copyValue, defineSchema, freezeValue } from '../core/schema';
import type { SpatialHash } from './spatial';
import type { SteerPoint } from './steer';

/** A shot's fields, for a scene's component: `defineComponent('bolt', { description, fields: PROJECTILE_FIELDS })`. */
export const PROJECTILE_FIELDS = defineSchema({
  state: {
    type: 'string',
    enum: ['flying', 'hit', 'wall', 'expired'],
    default: 'flying',
    description: 'flying, or why it stopped: hit (a target), wall, expired (its life ran out). Despawn it then.',
  },
  kind: { type: 'string', default: '', description: 'What it is, for the rules and the view (a bolt, an arrow).' },
  team: { type: 'string', default: '', description: 'Whose it is: the step’s `targets(shot)` picks what it hits.' },
  source: { type: 'integer', default: -1, minimum: -1, description: 'The entity that fired it (−1: none).' },
  x: { type: 'number', default: 0, unit: 'm', description: 'Its centre, east.' },
  y: { type: 'number', default: 0, unit: 'm', description: 'Its centre, up.' },
  z: { type: 'number', default: 0, unit: 'm', description: 'Its centre, south.' },
  vx: { type: 'number', default: 0, unit: 'm/s', description: 'Its velocity, east.' },
  vy: { type: 'number', default: 0, unit: 'm/s', description: 'Its velocity, up.' },
  vz: { type: 'number', default: 0, unit: 'm/s', description: 'Its velocity, south.' },
  radius: { type: 'number', default: 0.05, minimum: 0, maximum: 100, unit: 'm', description: 'Its ball’s radius.' },
  gravity: {
    type: 'number',
    default: 0,
    minimum: 0,
    unit: 'm/s²',
    description: 'How fast it falls: 0 flies straight (a bolt), 9.81 drops like an arrow.',
  },
  life: { type: 'number', default: 3, minimum: 0, unit: 's', description: 'How long it flies before it expires.' },
  age: { type: 'integer', default: 0, minimum: 0, description: 'Steps it has flown.' },
  pierce: {
    type: 'integer',
    default: 0,
    minimum: 0,
    description: 'Targets it passes through: the one after them stops it (0: the first does).',
  },
  hit: {
    type: 'array',
    items: { type: 'integer' },
    default: [],
    description: 'The ids it has hit, in order: a piercing shot strikes each once.',
  },
});

/** Where a shot is in its flight: see `PROJECTILE_FIELDS.state`. */
export type ProjectileState = 'flying' | 'hit' | 'wall' | 'expired';

/** A shot: what it is, where it flies and what it hit (`PROJECTILE_FIELDS` says what each means). */
export interface Projectile {
  state: ProjectileState;
  kind: string;
  team: string;
  source: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  radius: number;
  gravity: number;
  life: number;
  age: number;
  pierce: number;
  hit: number[];
}

/** A shot with every field at its default: a 5 cm ball at the origin, at rest, flying for 3 s. */
export const PROJECTILE: Readonly<Projectile> = freezeValue(
  Object.fromEntries(
    Object.entries(PROJECTILE_FIELDS).map(([key, field]) => [key, copyValue(field.default)]),
  ) as unknown as Projectile,
);

/**
 * A target's hurt volume: an upright capsule standing on its feet at `x`, `y`, `z` (m), `radius` wide, its straight
 * middle `height` long (CapsuleGeometry's sizes; 2 × radius + height tall), or a ball (`shape: 'ball'`, or height 0).
 * A crowd agent (engine/physics/crowd.ts) is one.
 */
export interface HurtCapsule {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  readonly height: number;
  readonly shape?: 'capsule' | 'ball';
}

/**
 * Targets for hit tests: a spatial hash of their feet by id (filled this step, engine/world/spatial.ts) and their
 * hurt capsules. `hurt(id)` returns undefined (or null) for one to skip: dead, on the shooter's team.
 */
export interface HurtSet {
  readonly hash: SpatialHash;
  hurt(id: number): HurtCapsule | null | undefined;
  /** The widest hurt radius among them (m; 1): how far past a test's own reach the hash is searched. */
  readonly margin?: number;
}

/** A wall a shot struck: the share of its move where it touched, the body (−1: none) and the surface's normal. */
export interface WallContact {
  readonly share: number;
  readonly body: number;
  readonly normal: readonly [number, number, number];
}

/** A wall test: the first wall a ball of `radius` meets moving from `from` by `delta` (m), or null. */
export type WallTest = (from: SteerPoint, delta: SteerPoint, radius: number) => WallContact | null;

/** How `stepProjectiles` steps. */
export interface ProjectileStep {
  /** The step's length (s): the world's `dt`. */
  readonly dt: number;
  /** What the shots can hit: one set for all, or a set per shot (by its team), undefined for none. */
  readonly targets?: HurtSet | ((shot: Projectile, index: number) => HurtSet | null | undefined);
  /** What stops them besides targets (engine/sim/hits.ts `physicsWalls`); nothing by default. */
  readonly walls?: WallTest;
}

/** A shot's hit this step: a target or a wall, where along the move and where the shot's centre was then. */
export interface ProjectileHit {
  /** The shot's index in the list. */
  readonly shot: number;
  /** The target's id; −1 for a wall. */
  readonly target: number;
  /** The wall's body; −1 for a target or a wall without one. */
  readonly body: number;
  /** The share of this step's move at the contact, 0 to 1 (0: touching as the step began). */
  readonly share: number;
  /** The shot's centre at the contact (m). */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** The wall's outward normal; null for a target. */
  readonly normal: readonly [number, number, number] | null;
}

/** A life ends on the first step whose age reaches it within this (s): 3 s ends after exactly 180 steps of 1/60. */
const LIFE_EPSILON = 1e-9;

/** The ids within `reach` (plus the set's margin) of (x, z) on the ground, in the hash's fixed order. */
export function hurtNear(targets: HurtSet, x: number, z: number, reach: number): number[] {
  const radius = reach + (targets.margin ?? 1);
  let out = new Int32Array(64);
  let found = targets.hash.query(x, z, radius, out);
  if (found > out.length) {
    out = new Int32Array(found);
    found = targets.hash.query(x, z, radius, out);
  }
  return Array.from(out.subarray(0, found));
}

/** The length of a hurt capsule's straight middle: 0 for a ball. */
export const hurtLength = (t: HurtCapsule): number => (t.shape === 'ball' ? 0 : Math.max(0, t.height));

/** The entry share (≥ 0) of a ray from p by d (|d|² = dd) into the ball of radius r at c; Infinity for none. */
function ballEntry(p: readonly number[], d: readonly number[], dd: number, c: readonly number[], r: number): number {
  const [ox, oy, oz] = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
  const b = ox * d[0] + oy * d[1] + oz * d[2];
  const h = b * b - dd * (ox * ox + oy * oy + oz * oz - r * r);
  if (h < 0) return Infinity;
  const s = (-b - Math.sqrt(h)) / dd;
  return s >= 0 ? s : Infinity;
}

/**
 * Where a ball of `radius` moving from `from` by `delta` (m) first touches `target`: the share of the move, 0 to 1
 * (0 when it touches already), or −1 when it never does. Exact: the target's capsule grown by the radius, met by
 * the move's segment (the side of its cylinder, then the balls at its ends).
 */
export function capsuleCast(from: SteerPoint, delta: SteerPoint, radius: number, target: HurtCapsule): number {
  const reach = target.radius + radius;
  const length = hurtLength(target);
  const a = [target.x, target.y + target.radius, target.z];
  const p = [from.x, from.y, from.z];
  const d = [delta.x, delta.y, delta.z];
  const along = Math.min(length, Math.max(0, p[1] - a[1]));
  const [ox, oy, oz] = [p[0] - a[0], p[1] - a[1] - along, p[2] - a[2]];
  if (ox * ox + oy * oy + oz * oz <= reach * reach) return 0;
  const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  if (!(dd > 0)) return -1;
  let best = Infinity;
  const flat = d[0] * d[0] + d[2] * d[2];
  if (length > 0 && flat > 0) {
    const [cx, cz] = [p[0] - a[0], p[2] - a[2]];
    const b = cx * d[0] + cz * d[2];
    const h = b * b - flat * (cx * cx + cz * cz - reach * reach);
    const s = h >= 0 ? (-b - Math.sqrt(h)) / flat : -1;
    const y = p[1] + d[1] * s - a[1];
    if (s >= 0 && y >= 0 && y <= length) best = s;
  }
  best = Math.min(best, ballEntry(p, d, dd, a, reach));
  if (length > 0) best = Math.min(best, ballEntry(p, d, dd, [a[0], a[1] + length, a[2]], reach));
  return best <= 1 ? best : -1;
}

/** Throws `CORE_BAD_SPEC` naming `problems` unless `ok`. */
function check(ok: boolean, where: string, problems: string): void {
  if (!ok) throw codeError('CORE_BAD_SPEC', { where, problems });
}

/** The targets a shot moving by `d` touches this step, not hit before: [share, id], in contact order. */
function contacts(set: HurtSet, shot: Projectile, d: SteerPoint): [number, number][] {
  const [mx, mz] = [shot.x + d.x / 2, shot.z + d.z / 2];
  const half = Math.sqrt(d.x * d.x + d.z * d.z) / 2;
  const found: [number, number][] = [];
  for (const id of hurtNear(set, mx, mz, half + shot.radius)) {
    const hurt = set.hurt(id);
    if (!hurt || shot.hit.includes(id)) continue;
    const share = capsuleCast(shot, d, shot.radius, hurt);
    if (share >= 0) found.push([share, id]);
  }
  return found.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
}

/**
 * Steps every flying shot once (`step.dt`): gravity, then its move swept against its targets and the walls. A target
 * it touches is hit (once per shot) and stops it, unless it still pierces; a wall nearer than the next target stops
 * it; a shot still flying ages and expires at its life. Returns the hits in shot order, each shot's in contact order;
 * stopped shots are left at the contact with their `state` set.
 */
export function stepProjectiles(shots: readonly Projectile[], step: ProjectileStep): ProjectileHit[] {
  const dt = step?.dt;
  check(
    Number.isFinite(dt) && dt > 0,
    'stepProjectiles(shots, { dt })',
    `dt ${String(dt)} is no step: give seconds above 0`,
  );
  const hits: ProjectileHit[] = [];
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    if (s.state !== 'flying') continue;
    s.vy -= s.gravity * dt;
    const d = { x: s.vx * dt, y: s.vy * dt, z: s.vz * dt };
    const moving = d.x !== 0 || d.y !== 0 || d.z !== 0;
    const wall = moving && step.walls ? step.walls({ x: s.x, y: s.y, z: s.z }, d, s.radius) : null;
    const set = typeof step.targets === 'function' ? step.targets(s, i) : step.targets;
    let end = 1;
    const at = (share: number) => ({ x: s.x + d.x * share, y: s.y + d.y * share, z: s.z + d.z * share });
    for (const [share, id] of set ? contacts(set, s, d) : []) {
      if (wall && share > wall.share) break;
      s.hit = [...s.hit, id]; // a new array: a shot made from PROJECTILE shares its frozen []
      hits.push({ shot: i, target: id, body: -1, share, ...at(share), normal: null });
      if (s.hit.length <= s.pierce) continue;
      [end, s.state] = [share, 'hit'];
      break;
    }
    if (s.state === 'flying' && wall) {
      [end, s.state] = [wall.share, 'wall'];
      hits.push({ shot: i, target: -1, body: wall.body, share: end, ...at(end), normal: wall.normal });
    }
    [s.x, s.y, s.z] = [s.x + d.x * end, s.y + d.y * end, s.z + d.z * end];
    if (s.state === 'flying' && ++s.age * dt >= s.life - LIFE_EPSILON) s.state = 'expired';
  }
  return hits;
}
