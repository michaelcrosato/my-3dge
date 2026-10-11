/**
 * @file Hit queries (PLAN.md WP 6.3, §6.4; I-10): which targets a strike reaches, in the sim, against the targets'
 * hurt capsules (engine/world/projectiles.ts `HurtCapsule`: upright capsules on their feet, such as crowd agents)
 * found through a spatial hash of their feet (`HurtSet`). Rules call them in a step, hit what they return (through
 * `Attack.hits`, once per swing) and turn each hit into damage (engine/sim/damage.ts).
 *
 * - **Cones** (`inCone`, `coneHits`): a move's measured hit shape (engine/anim/moves.ts `measureMove`) around the
 *   attacker's feet, facing `yaw`: the ground sector it reaches (range and half angle) meets the target's footprint,
 *   and its height window (`yMin` to `yMax` above the feet) overlaps the target's height. Cheap, for crowds.
 * - **Sweeps** (`sweepTouches`, `sweepHits`): the quad a weapon swept in one step (`Attack.sweep`), as two
 *   triangles, comes within the capsule's radius (plus the blade's `thickness`) of its axis: exact, for
 *   `preciseHits` characters, so a blade that passes a target between two steps strikes it. A step's quad joins its
 *   two segments straight, so a swing's arc is cut to its chord: 4 cm short at a 1.3 m tip turning 0.5 rad a step.
 * - **Walls** (`physicsWalls`): the wall test projectiles take, a ball cast through the physics world.
 *
 * Invariants: the tests are exact geometry (a sector against a disc, a segment against triangles), so a target
 * touched only at an edge is still hit; results are ids in ascending order, whatever order the hash keeps; queries
 * read and never change the targets. Pure arithmetic over the sim's math: no clock, no random stream.
 *
 * Carried from `my-3d2dge:src/stress-world/20-sim.js:225-233` (`rebuildGrid`, `near` and `inArc3`: hits look only
 * near themselves, in a cone at a height the swing reaches), with the measured height window instead of a fixed
 * 24-unit band and footprints instead of centres.
 *
 * @example
 * import { SpatialHash } from '../world/spatial';
 * const foe = { x: 0, y: 0, z: 1.2, radius: 0.3, height: 1 }; // a walker 1.2 m ahead
 * const targets = { hash: new SpatialHash().add(5, foe.x, foe.z), hurt: () => foe };
 * const slash = { range: 1.1, halfAngle: 1.2, yMin: 0.6, yMax: 1.4 }; // measureMove('slash', …) gives one
 * coneHits(targets, [0, 0, 0], 0, slash); // [5]: its footprint is within reach, its body at the swing's height
 * inCone([0, 0, 0], Math.PI, slash, foe); // false: facing away
 * @see engine/sim/hits.test.ts
 */
import type { HitShape } from '../anim/moves';
import type { Sweep } from '../anim/timeline';
import { codeError } from '../core/log';
import { angDiff, Vector3 } from '../core/math';
import { show } from '../core/schema';
import type { GroupName } from '../physics/groups';
import type { Vec3Like } from '../physics/queries';
import type { Physics } from '../physics/world';
import { hurtLength, hurtNear, type HurtCapsule, type HurtSet, type WallTest } from '../world/projectiles';

/** Throws `SIM_BAD_ARGUMENT` unless `ok`. */
function check(ok: boolean, where: string, value: unknown, expected: string): void {
  if (!ok) throw codeError('SIM_BAD_ARGUMENT', { where, value: show(value), expected });
}

/** A point as numbers. */
function xyz(v: Vec3Like, where: string): readonly [number, number, number] {
  const p: readonly number[] = 'x' in v ? [v.x, v.y, v.z] : v;
  check(p.length === 3 && p.every(Number.isFinite), where, v, 'a point in metres: [x, y, z] or { x, y, z }');
  return p as readonly [number, number, number];
}

/** Whether the ground edge from the apex at `angle`, `range` long, passes within `r` of (dx, dz). */
function edgeNear(dx: number, dz: number, angle: number, range: number, r: number): boolean {
  const [ex, ez] = [Math.sin(angle), Math.cos(angle)];
  const along = Math.min(range, Math.max(0, dx * ex + dz * ez));
  const [ox, oz] = [dx - ex * along, dz - ez * along];
  return ox * ox + oz * oz <= r * r;
}

/**
 * Whether `target` is in the hit cone of `shape` (scaled by `size`) from the feet `from`, facing `yaw` (forward is
 * (sin yaw, 0, cos yaw)): its footprint (a disc of its radius) meets the ground sector the strike reaches, and its
 * height overlaps the strike's height window above the feet.
 */
export function inCone(from: Vec3Like, yaw: number, shape: HitShape, target: HurtCapsule, size = 1): boolean {
  const [fx, fy, fz] = xyz(from, 'inCone(from)');
  const r = target.radius;
  const low = target.y - fy;
  if (low + 2 * r + hurtLength(target) < shape.yMin * size || low > shape.yMax * size) return false;
  const range = shape.range * size;
  const [dx, dz] = [target.x - fx, target.z - fz];
  const d2 = dx * dx + dz * dz;
  if (d2 > (range + r) * (range + r)) return false;
  if (d2 <= r * r || shape.halfAngle >= Math.PI) return true;
  if (Math.abs(angDiff(yaw, Math.atan2(dx, dz))) <= shape.halfAngle) return true;
  return edgeNear(dx, dz, yaw + shape.halfAngle, range, r) || edgeNear(dx, dz, yaw - shape.halfAngle, range, r);
}

/** The targets in the hit cone (`inCone`), by id, ascending: those the hash holds near enough, then the exact test. */
export function coneHits(targets: HurtSet, from: Vec3Like, yaw: number, shape: HitShape, size = 1): number[] {
  const [fx, , fz] = xyz(from, 'coneHits(from)');
  check(Number.isFinite(yaw), 'coneHits(yaw)', yaw, 'a facing in radians');
  const found: number[] = [];
  for (const id of hurtNear(targets, fx, fz, shape.range * size)) {
    const hurt = targets.hurt(id);
    if (hurt && inCone(from, yaw, shape, hurt, size)) found.push(id);
  }
  return found.sort((a, b) => a - b);
}

/** Squared lengths below this (m²) are no length: such a segment is a point. */
const EPSILON = 1e-18;
/** A triangle whose sides meet at less than about 1e-6 rad (sin² below this) is a line: its edges are all of it. */
const SLIVER = 1e-12;

/** Scratch vectors for the segment and triangle tests (filled before each read). */
const [P, Q, D1, D2, R, C1, C2, E1, E2, H, S, T] = Array.from({ length: 12 }, () => new Vector3());

/** The squared distance between segments p1q1 and p2q2 (Ericson, Real-Time Collision Detection, 5.1.9). */
function segmentSegment2(p1: Vector3, q1: Vector3, p2: Vector3, q2: Vector3): number {
  const [d1, d2, r] = [D1.subVectors(q1, p1), D2.subVectors(q2, p2), R.subVectors(p1, p2)];
  const [a, e, f] = [d1.dot(d1), d2.dot(d2), d2.dot(r)];
  const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
  let [s, t] = [0, 0];
  if (a <= EPSILON && e <= EPSILON) return r.dot(r);
  if (a <= EPSILON) t = clamp01(f / e);
  else {
    const c = d1.dot(r);
    if (e <= EPSILON) s = clamp01(-c / a);
    else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      s = denom > 0 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) [t, s] = [0, clamp01(-c / a)];
      else if (t > 1) [t, s] = [1, clamp01((b - c) / a)];
    }
  }
  return C1.copy(p1).addScaledVector(d1, s).distanceToSquared(C2.copy(p2).addScaledVector(d2, t));
}

/** The squared distance from p to the triangle abc, which is not degenerate (Ericson 5.1.5). */
function pointTriangle2(p: Vector3, a: Vector3, b: Vector3, c: Vector3): number {
  const ab = E1.subVectors(b, a);
  const ac = E2.subVectors(c, a);
  const ap = S.subVectors(p, a);
  const [d1, d2] = [ab.dot(ap), ac.dot(ap)];
  if (d1 <= 0 && d2 <= 0) return p.distanceToSquared(a);
  const bp = T.subVectors(p, b);
  const [d3, d4] = [ab.dot(bp), ac.dot(bp)];
  if (d3 >= 0 && d4 <= d3) return p.distanceToSquared(b);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return p.distanceToSquared(C1.copy(a).addScaledVector(ab, d1 / (d1 - d3)));
  const cp = T.subVectors(p, c);
  const [d5, d6] = [ab.dot(cp), ac.dot(cp)];
  if (d6 >= 0 && d5 <= d6) return p.distanceToSquared(c);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return p.distanceToSquared(C1.copy(a).addScaledVector(ac, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    return p.distanceToSquared(
      C1.subVectors(c, b)
        .multiplyScalar((d4 - d3) / (d4 - d3 + (d5 - d6)))
        .add(b),
    );
  }
  const k = 1 / (va + vb + vc);
  return p.distanceToSquared(
    C1.copy(a)
      .addScaledVector(ab, vb * k)
      .addScaledVector(ac, vc * k),
  );
}

/** Whether segment pq crosses the triangle abc (Möller and Trumbore), which is not degenerate. */
function crosses(p: Vector3, q: Vector3, a: Vector3, b: Vector3, c: Vector3): boolean {
  const [e1, e2, dir] = [E1.subVectors(b, a), E2.subVectors(c, a), D1.subVectors(q, p)];
  const h = H.crossVectors(dir, e2);
  const det = e1.dot(h);
  if (Math.abs(det) < EPSILON) return false;
  const s = S.subVectors(p, a);
  const u = s.dot(h) / det;
  if (u < 0 || u > 1) return false;
  const k = T.crossVectors(s, e1);
  const v = dir.dot(k) / det;
  const t = e2.dot(k) / det;
  return v >= 0 && u + v <= 1 && t >= 0 && t <= 1;
}

/** The squared distance between segment pq and the triangle abc (its edges when it is a sliver, a line or a point). */
function segmentTriangle2(p: Vector3, q: Vector3, a: Vector3, b: Vector3, c: Vector3): number {
  const edges = Math.min(segmentSegment2(p, q, a, b), segmentSegment2(p, q, b, c), segmentSegment2(p, q, c, a));
  const [ab, ac] = [E1.subVectors(b, a), E2.subVectors(c, a)];
  if (H.crossVectors(ab, ac).lengthSq() <= SLIVER * ab.lengthSq() * ac.lengthSq()) return edges;
  if (crosses(p, q, a, b, c)) return 0;
  return Math.min(edges, pointTriangle2(p, a, b, c), pointTriangle2(q, a, b, c));
}

/**
 * Whether the quad a weapon swept in a step (`Attack.sweep`: its segment at the last step and at this one) comes
 * within `target`'s radius plus `thickness` (the blade's half width, m) of its axis: the target was struck.
 */
export function sweepTouches(sweep: Sweep, target: HurtCapsule, thickness = 0): boolean {
  check(Number.isFinite(thickness) && thickness >= 0, 'sweepTouches(thickness)', thickness, 'metres, 0 or more');
  const { base0, tip0, base1, tip1 } = sweep;
  const p = P.set(target.x, target.y + target.radius, target.z);
  const q = Q.copy(p).setY(p.y + hurtLength(target));
  const near = Math.min(segmentTriangle2(p, q, base0, tip0, tip1), segmentTriangle2(p, q, base0, tip1, base1));
  const reach = target.radius + thickness;
  return near <= reach * reach;
}

/** The targets the swept quad touches (`sweepTouches`), by id, ascending. */
export function sweepHits(targets: HurtSet, sweep: Sweep, thickness = 0): number[] {
  const corners = [sweep.base0, sweep.tip0, sweep.base1, sweep.tip1];
  const cx = corners.reduce((sum, v) => sum + v.x, 0) / 4;
  const cz = corners.reduce((sum, v) => sum + v.z, 0) / 4;
  const reach = Math.max(...corners.map((v) => Math.hypot(v.x - cx, v.z - cz)));
  const found: number[] = [];
  for (const id of hurtNear(targets, cx, cz, reach + thickness)) {
    const hurt = targets.hurt(id);
    if (hurt && sweepTouches(sweep, hurt, thickness)) found.push(id);
  }
  return found.sort((a, b) => a - b);
}

/**
 * The walls projectiles stop at (engine/world/projectiles.ts `WallTest`): a ball cast (a ray for a radius of 0)
 * through `physics` against the collision groups `groups` (the level and props, `world` and `prop`, by default).
 * Queries see the bodies as of the last physics step.
 */
export function physicsWalls(physics: Physics, groups: readonly GroupName[] = ['world', 'prop']): WallTest {
  return (from, delta, radius) => {
    const length = Math.sqrt(delta.x * delta.x + delta.y * delta.y + delta.z * delta.z);
    if (!(length > 0)) return null;
    const options = { maxDistance: length, groups };
    const hit =
      radius > 0
        ? physics.shapeCast({ type: 'ball', radius }, from, delta, options)
        : physics.raycast(from, delta, options);
    if (!hit) return null;
    return {
      share: Math.min(1, hit.distance / length),
      body: hit.body,
      normal: [hit.normal.x, hit.normal.y, hit.normal.z],
    };
  };
}
