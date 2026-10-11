/**
 * @file Faces for the level's shapes (PLAN.md WP 4.4): what the stairs, gallery, dais and brazier builders
 * (engine/gfx/level/{stairs,slab,dais,brazier}.ts) write their faces with. `polygon` writes a flat polygon facing a
 * given way, whichever way its points wind; `upright` a vertical quad along a ground edge; `tread` a level rectangle
 * facing up. `slotted` keeps one writer per material slot and joins them into one geometry, one draw group per slot
 * that holds triangles, in slot order.
 *
 * UVs are in metres and anchored to the world, so a texture runs on from face to face and from piece to piece: a
 * level face has u along X and v along -Z (as the floor, engine/gfx/level/surface.ts); an upright face has u along
 * its edge (left to right seen from the front) and v up. A face that is neither is given its UVs by its builder.
 *
 * Invariants: every triangle is counter-clockwise seen from the side its normal points to, its normal the face's;
 * a polygon is written as a fan from its first point, so it must be convex or star-shaped from that point.
 *
 * @example
 * const writers = slotted();
 * upright(writers.slot(0), [0, 0], [1, 0], 0, 3); // a 1 × 3 m quad facing +Z
 * tread(writers.slot(1), [0, 0, 1, 1], 3);
 * writers.build().groups.length; // 2
 * @see engine/gfx/level/shapes.test.ts
 */
import type { BufferGeometry } from 'three/webgpu';
import { mergeGeometries } from '../geometry/groups';
import { createWriter, cross, dot, normalize, type Vec3, type Writer } from '../geometry/writer';

/** A point on the ground (m): `[x, z]`. */
export type Ground = readonly [x: number, z: number];

/**
 * Writes the flat polygon `points` (a fan from the first) with `uvs`, facing `outward`: its points are taken in the
 * other order when they wind against it.
 */
export function polygon(
  writer: Writer,
  points: readonly Vec3[],
  uvs: readonly (readonly [number, number])[],
  outward: Vec3,
): void {
  const [a, b, c] = points;
  let normal = normalize(cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]));
  const order = points.map((_, i) => i);
  if (dot(normal, outward) < 0) {
    normal = [-normal[0], -normal[1], -normal[2]];
    order.splice(1, order.length - 1, ...order.slice(1).reverse());
  }
  const first = writer.count;
  for (const i of order) writer.vertex(points[i], normal, [uvs[i][0], uvs[i][1]]);
  for (let i = 1; i + 1 < order.length; i++) writer.triangle(first, first + i, first + i + 1);
}

/**
 * Writes the upright quad over the ground edge `a` → `b` from height `y0` to `y1`. It faces left of the edge seen
 * from above with +Z down the page (an edge running east faces south), so `a` is its left end seen from the front.
 */
export function upright(writer: Writer, a: Ground, b: Ground, y0: number, y1: number): void {
  const [dx, dz] = [b[0] - a[0], b[1] - a[1]];
  const length = Math.hypot(dx, dz);
  const [ux, uz] = [dx / length, dz / length];
  const u = (p: Ground) => p[0] * ux + p[1] * uz;
  polygon(
    writer,
    [
      [a[0], y0, a[1]],
      [b[0], y0, b[1]],
      [b[0], y1, b[1]],
      [a[0], y1, a[1]],
    ],
    [
      [u(a), y0],
      [u(b), y0],
      [u(b), y1],
      [u(a), y1],
    ],
    [-uz, 0, ux],
  );
}

/** Writes the level rectangle `[x0, z0, x1, z1]` at height `y`, facing up. */
export function tread(writer: Writer, rect: readonly [number, number, number, number], y: number): void {
  const [x0, z0, x1, z1] = rect;
  const corners: Vec3[] = [
    [x0, y, z0],
    [x0, y, z1],
    [x1, y, z1],
    [x1, y, z0],
  ];
  polygon(
    writer,
    corners,
    corners.map(([x, , z]) => [x, -z] as const),
    [0, 1, 0],
  );
}

/** One writer per material slot, joined by `build` into one geometry with a draw group per slot used. */
export interface Slotted {
  slot(index: number): Writer;
  /** Joins the slots' geometries (and `extra`, each given the slot it belongs to), groups in slot order. */
  build(extra?: readonly { slot: number; geometry: BufferGeometry }[]): BufferGeometry;
}

/** Makes an empty set of slot writers (see the file comment). */
export function slotted(): Slotted {
  const writers: Writer[] = [];
  return {
    slot(index) {
      writers[index] ??= createWriter();
      return writers[index];
    },
    build(extra = []) {
      const parts = writers.flatMap((writer, slot) => (writer?.count ? [{ slot, geometry: writer.build() }] : []));
      const joined = [...parts, ...extra].sort((a, b) => a.slot - b.slot);
      const geometries = joined.map(({ slot, geometry }) => {
        geometry.clearGroups();
        geometry.addGroup(0, geometry.getIndex()!.count, slot);
        return geometry;
      });
      const merged = mergeGeometries(geometries);
      // One group per slot: neighbours of the same slot join.
      const groups = merged.groups.reduce<{ start: number; count: number; materialIndex?: number }[]>((out, group) => {
        const last = out[out.length - 1];
        if (last && last.materialIndex === group.materialIndex) last.count += group.count;
        else out.push({ ...group });
        return out;
      }, []);
      merged.clearGroups();
      for (const group of groups) merged.addGroup(group.start, group.count, group.materialIndex);
      geometries.forEach((geometry) => geometry.dispose());
      return merged;
    },
  };
}
