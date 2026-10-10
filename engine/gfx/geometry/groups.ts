/**
 * @file Draw groups and merging (PLAN.md WP 2.4): `sidesThenTops(geometry)` sorts a geometry's triangles into two
 * draw groups, its sides (material 0) then its tops and bottoms (material 1), so a box, a pillar or a wall drawn with
 * a face material and a top material costs two draw calls instead of one per face; `mergeGeometries` joins indexed
 * geometries with the same attributes into one.
 *
 * Where a triangle goes is decided by its own normal (from its corners, so the winding decides): a top or a bottom
 * when it points within 45° of straight up or down, a side otherwise. That works for any shape, not only boxes: a
 * ramp's gentle slope is a top, a frustum's slanted faces are sides.
 *
 * Carried from `sidesThenTops`, `my-3d2dge:src/stress-world/10-hall.js:259-263` (a box's index reordered into two
 * groups), generalised from `BoxGeometry`'s face order to any indexed geometry.
 *
 * Invariants: `sidesThenTops` keeps every triangle and its winding, keeps the order of triangles within each group,
 * changes only the index and the groups, and adds no empty group; `mergeGeometries` keeps each part's triangles and
 * groups, offset into the whole.
 *
 * @example
 * import { boxGeometry } from './box';
 * sidesThenTops(boxGeometry()).groups; // [{ start: 0, count: 24, materialIndex: 0 }, { start: 24, count: 12, materialIndex: 1 }]
 * @see engine/gfx/geometry/kit.test.ts
 */
import { BufferAttribute, BufferGeometry } from 'three/webgpu';
import { badGeometry } from './checks';

/** How far from vertical a top's normal may lean: 45°. */
const TOP = Math.SQRT1_2;

/** The index of `geometry`, or 0, 1, 2… for a geometry without one. */
function indexOf(geometry: BufferGeometry): number[] {
  const index = geometry.getIndex();
  if (index) return Array.from(index.array as ArrayLike<number>);
  return Array.from({ length: geometry.getAttribute('position').count }, (_, i) => i);
}

/**
 * Sorts the triangles of `geometry` into its sides (group 0, material 0) then its tops and bottoms (group 1,
 * material 1), and returns it (changed in place).
 */
export function sidesThenTops(geometry: BufferGeometry): BufferGeometry {
  const index = indexOf(geometry);
  const p = geometry.getAttribute('position');
  const sides: number[] = [];
  const tops: number[] = [];
  for (let t = 0; t + 2 < index.length; t += 3) {
    const [a, b, c] = [index[t], index[t + 1], index[t + 2]];
    const [ux, uy, uz] = [p.getX(b) - p.getX(a), p.getY(b) - p.getY(a), p.getZ(b) - p.getZ(a)];
    const [vx, vy, vz] = [p.getX(c) - p.getX(a), p.getY(c) - p.getY(a), p.getZ(c) - p.getZ(a)];
    const [nx, ny, nz] = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const length = Math.hypot(nx, ny, nz);
    (length > 0 && Math.abs(ny) / length > TOP ? tops : sides).push(a, b, c);
  }
  geometry.setIndex([...sides, ...tops]);
  geometry.clearGroups();
  if (sides.length) geometry.addGroup(0, sides.length, 0);
  if (tops.length) geometry.addGroup(sides.length, tops.length, 1);
  return geometry;
}

/**
 * Joins `geometries` into one, in order: their attributes end to end, their indices offset. Each part's groups are
 * kept, offset; a part without groups becomes one group of material 0 only when another part has groups. Throws
 * `GFX_BAD_GEOMETRY` when the parts' attributes differ.
 */
export function mergeGeometries(geometries: readonly BufferGeometry[]): BufferGeometry {
  if (!geometries.length) badGeometry('merge', 'no geometries were given', 'at least one geometry');
  const names = Object.keys(geometries[0].attributes).sort();
  const merged = new BufferGeometry();
  for (const name of names) {
    const size = geometries[0].getAttribute(name).itemSize;
    const parts = geometries.map((geometry, i) => {
      const attribute = geometry.getAttribute(name) as BufferAttribute | undefined;
      const same = Object.keys(geometry.attributes).sort().join() === names.join();
      if (!attribute || !same || attribute.itemSize !== size) {
        badGeometry(
          'merge',
          `part ${i} has attributes ${Object.keys(geometry.attributes).sort().join(', ')}`,
          `parts that all have ${names.join(', ')}`,
        );
      }
      return Array.from(attribute.array as ArrayLike<number>);
    });
    merged.setAttribute(name, new BufferAttribute(new Float32Array(parts.flat()), size));
  }
  const index: number[] = [];
  const grouped = geometries.some((geometry) => geometry.groups.length > 0);
  let offset = 0;
  for (const geometry of geometries) {
    const start = index.length;
    index.push(...indexOf(geometry).map((i) => i + offset));
    if (geometry.groups.length) {
      for (const group of geometry.groups) merged.addGroup(start + group.start, group.count, group.materialIndex ?? 0);
    } else if (grouped) merged.addGroup(start, index.length - start, 0);
    offset += geometry.getAttribute('position').count;
  }
  merged.setIndex(index);
  return merged;
}
