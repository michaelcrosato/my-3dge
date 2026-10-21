/**
 * @file Walls under a pitched roof (PLAN.md WP 13.14; docs/PLAYGROUND.md §2.1, §6.1): `underRoofGeometry(roof, rects,
 * bottom)` draws each rectangle (m) of a storey's full glyph or head from `bottom` up to the roof's underside, the very
 * convex hull its collider is (engine/world/level/roofs.ts's `wallUnder`), so an attic's gable end rises into the
 * gable, the eaves' walls stop under the slope, and nothing stands through the roof. The other storeys' walls are the
 * wall recipe's instanced blocks (engine/gfx/level/shapes.ts), from their floor to the storey above.
 *
 * Each hull is three.js's `ConvexHull` (three/addons) of its points, its faces written as the level's are (`axesOf`):
 * an upright face with u along it and v up in metres, as a block's sides; a level one with u along X and v along -Z; a
 * sloped one in its own plane. One draw group, the recipe's first material.
 *
 * Invariants: pure in its inputs; a rectangle the underside never clears is left out; null when every one is.
 *
 * @example
 * // const geometry = underRoofGeometry(level.roofs[0], [[0, 0, 0.5, 6]], 6); // an attic's west gable end
 * @see engine/gfx/level/walls.test.ts
 */
import { Vector3, type BufferGeometry } from 'three/webgpu';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import { wallUnder } from '../../world/level/roofs';
import type { RoofDescriptor } from '../../world/level/types';
import { createWriter, cross, normalize, type Vec3, type Writer } from '../geometry/writer';

/**
 * A face's UV axes, `u × v` its `normal`: upright, u along it and v up; level, u along X and v along -Z (or +Z facing
 * down); sloped, u level along it and v across it, in its plane.
 */
export function axesOf(normal: Vec3): [Vec3, Vec3] {
  const [nx, ny, nz] = normal;
  if (Math.abs(ny) < 1e-6) return [normalize(cross([0, 1, 0], normal)), [0, 1, 0]];
  if (Math.abs(ny) > 1 - 1e-6) return [[1, 0, 0], ny > 0 ? [0, 0, -1] : [0, 0, 1]];
  const u = normalize([-nz, 0, nx]);
  return [u, cross(normal, u)];
}

/** Writes the convex hull of `points` into `writer`, each face with UVs in metres (see the file comment). */
export function writeHull(writer: Writer, points: readonly (readonly [number, number, number])[]): void {
  const hull = new ConvexHull().setFromPoints(points.map(([x, y, z]) => new Vector3(x, y, z)));
  for (const face of hull.faces) {
    const loop: Vec3[] = [];
    let edge = face.edge;
    do {
      const { x, y, z } = edge.head().point;
      loop.push([x, y, z]);
      edge = edge.next;
    } while (edge !== face.edge);
    const [u, v] = axesOf([face.normal.x, face.normal.y, face.normal.z]);
    writer.face(loop, u, v);
  }
}

/** The rectangles `rects` (m, `[x0, z0, x1, z1]`) from `bottom` up to `roof`'s underside, or null when none clears it. */
export function underRoofGeometry(
  roof: RoofDescriptor,
  rects: readonly (readonly [number, number, number, number])[],
  bottom: number,
): BufferGeometry | null {
  const writer = createWriter();
  for (const rect of rects) {
    const points = wallUnder(roof, rect, bottom);
    if (points) writeHull(writer, points);
  }
  return writer.count ? writer.build() : null;
}
