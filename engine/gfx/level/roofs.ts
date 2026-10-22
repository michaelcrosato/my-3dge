/**
 * @file Roofs drawn (PLAN.md WP 13.14; docs/PLAYGROUND.md §2.1, §6.1): `roofGeometry(roof)` draws a storey's roof
 * (engine/world/level/roofs.ts) as the slab its colliders are: each plane (a gable's two, a hip's four, a flat roof's
 * one) its top, its underside and its edges, the eaves reaching past the walls. Slot 0 is the tops, which the roof's
 * first material draws (shingles, say); slot 1 the undersides and edges (the soffit and the fascia).
 *
 * Each face is written by engine/gfx/level/faces.ts's `polygon`, wound to face out of its plane's slab, its UVs in
 * metres along axes in its own plane (engine/gfx/level/walls.ts's `axesOf`: a sloped top's u level along the eaves,
 * v up the slope), so a tiled texture keeps its size on every slope. A chimney is a glyph that rises through the roof
 * (the wall recipe's block), not a part of it.
 *
 * Invariants: pure in the roof; the tops are exactly the roof's walkable surface (`roofHeight`), the undersides its
 * thickness lower.
 *
 * @example
 * // roofGeometry(level.roofs[0]).groups.length; // 2: the tops, then the undersides and edges
 * @see engine/gfx/level/roofs.test.ts
 */
import type { BufferGeometry } from 'three/webgpu';
import { roofColliders } from '../../world/level/roofs';
import type { RoofDescriptor } from '../../world/level/types';
import { cross, dot, normalize, type Vec3 } from '../geometry/writer';
import { polygon, slotted } from './faces';
import { axesOf } from './walls';

/** `a − b`. */
const minus = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** The normal of the flat polygon `points` (Newell's method), unit. */
function normalOf(points: readonly Vec3[]): Vec3 {
  let [x, y, z] = [0, 0, 0];
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length];
    x += (p[1] - q[1]) * (p[2] + q[2]);
    y += (p[2] - q[2]) * (p[0] + q[0]);
    z += (p[0] - q[0]) * (p[1] + q[1]);
  });
  return normalize([x, y, z]);
}

/** The roof's slab (see the file comment): tops in slot 0, undersides and edges in slot 1. */
export function roofGeometry(roof: RoofDescriptor): BufferGeometry {
  const writers = slotted();
  const write = (slot: number, points: Vec3[], outward: Vec3) => {
    const [u, v] = axesOf(outward);
    const [p0] = points;
    polygon(writers.slot(slot), points, points.map((p) => [dot(minus(p, p0), u), dot(minus(p, p0), v)] as const), outward); // prettier-ignore
  };
  for (const hull of roofColliders(roof)) {
    const n = hull.length / 2;
    const top = hull.slice(0, n) as Vec3[];
    const under = hull.slice(n) as Vec3[];
    let up = normalOf(top);
    if (up[1] < 0) up = [-up[0], -up[1], -up[2]];
    write(0, top, up);
    write(1, under, [-up[0], -up[1], -up[2]]);
    const centre = top.reduce<Vec3>((sum, p) => [sum[0] + p[0] / n, sum[1] + p[1] / n, sum[2] + p[2] / n], [0, 0, 0]);
    top.forEach((a, i) => {
      const b = top[(i + 1) % n];
      const side: Vec3[] = [a, b, under[(i + 1) % n], under[i]];
      let out = normalize(cross(minus(b, a), [0, -1, 0]));
      if (dot(out, minus(a, centre)) < 0) out = [-out[0], -out[1], -out[2]];
      write(1, side, out);
    });
  }
  return writers.build();
}
