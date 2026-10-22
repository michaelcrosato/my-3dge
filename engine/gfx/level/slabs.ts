/**
 * @file A storey's slab, seen (PLAN.md WP 13.14; docs/PLAYGROUND.md §6.1): `ceilingGeometry(level, storey)` draws what
 * of a storey's floor slab (engine/world/level/storeys.ts) the floor recipe does not: its underside, the ceiling of the
 * storey below, under its floored tiles, and its edges, where a floored tile meets void or the map's edge (a
 * stairwell's rim, an upper floor over the porch). Its top is the floor the glyphs' recipes draw; the lowest storey's
 * underside stands on nothing anyone sees and is left out.
 *
 * The underside is the floored tiles merged into few rectangles (engine/world/level/rects.ts), facing down, u along X
 * and v along Z in metres; each edge is a quad from the slab's underside up to the floor, facing out of the tile, u
 * along it and v up in metres (engine/gfx/level/faces.ts). One draw group.
 *
 * Invariants: pure in the level and the storey; null when the storey draws nothing (the lowest storey with no edge).
 *
 * @example
 * // const geometry = ceilingGeometry(level, level.storeys[1]); // the ground floor's slab, seen from the cellar
 * @see engine/gfx/level/slabs.test.ts
 */
import type { BufferGeometry } from 'three/webgpu';
import { mergeRects } from '../../world/level/rects';
import type { CompiledLevel, StoreyDescriptor } from '../../world/level/types';
import { createWriter, type Vec3 } from '../geometry/writer';
import { upright } from './faces';

/** The four sides of a tile: the step to its neighbour, and its edge as a ground edge facing out of the tile. */
const SIDES = [
  {
    dc: 0,
    dr: -1,
    edge: (x0: number, z0: number, x1: number) =>
      [
        [x1, z0],
        [x0, z0],
      ] as const,
  }, // north
  {
    dc: 1,
    dr: 0,
    edge: (_x0: number, z0: number, x1: number, z1: number) =>
      [
        [x1, z1],
        [x1, z0],
      ] as const,
  }, // east
  {
    dc: 0,
    dr: 1,
    edge: (x0: number, _z0: number, x1: number, z1: number) =>
      [
        [x0, z1],
        [x1, z1],
      ] as const,
  }, // south
  {
    dc: -1,
    dr: 0,
    edge: (x0: number, z0: number, _x1: number, z1: number) =>
      [
        [x0, z0],
        [x0, z1],
      ] as const,
  }, // west
] as const;

/** The underside and void edges of `storey`'s slab (see the file comment), or null when there is nothing to draw. */
export function ceilingGeometry(
  level: Pick<CompiledLevel, 'cols' | 'rows' | 'tile'>,
  storey: Pick<StoreyDescriptor, 'index' | 'base' | 'slab' | 'floored'>,
): BufferGeometry | null {
  const { cols, rows, tile: t } = level;
  const writer = createWriter();
  const [bottom, top] = [storey.base - storey.slab, storey.base];
  const floored = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && storey.floored[r * cols + c];
  if (storey.index > 0) {
    for (const [c0, r0, c1, r1] of mergeRects(cols, rows, floored)) {
      const [x0, z0, x1, z1] = [c0 * t, r0 * t, (c1 + 1) * t, (r1 + 1) * t];
      const corners: Vec3[] = [
        [x0, bottom, z0],
        [x1, bottom, z0],
        [x1, bottom, z1],
        [x0, bottom, z1],
      ];
      writer.face(corners, [1, 0, 0], [0, 0, 1]);
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!floored(c, r)) continue;
      const [x0, z0, x1, z1] = [c * t, r * t, (c + 1) * t, (r + 1) * t];
      for (const { dc, dr, edge } of SIDES) {
        if (floored(c + dc, r + dr)) continue;
        const [a, b] = edge(x0, z0, x1, z1);
        upright(writer, a, b, bottom, top);
      }
    }
  }
  return writer.count ? writer.build() : null;
}
