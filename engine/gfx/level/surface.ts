/**
 * @file Level surfaces (PLAN.md WP 2.4): `surfaceGeometry(tile, pieces, y)` lays one flat surface over a level's
 * pieces at height `y`, facing up: the floor. Each tile is two triangles, and tiles share their corners, so the
 * surface is welded: no T-junctions, so no cracks between tiles, and about one vertex per tile however the tiles are
 * arranged. UVs are in metres, u along X and v along -Z (a `PlaneGeometry` laid flat), so a floor texture runs on
 * across tiles without a seam.
 *
 * Carried from the floor of `my-3d2dge:src/stress-world/10-hall.js:286-299` (`floorPoly`: the floor at its height,
 * counter-clockwise seen from above), as tiles instead of one polygon, so a floor with holes (walls, pillars) needs no
 * polygon triangulation.
 *
 * Invariants: vertices in the order the pieces first reach them (reading order), so equal pieces give equal buffers;
 * every normal is +Y; every triangle faces up.
 *
 * @example
 * surfaceGeometry(1, [[0, 0, 1, 0]], 0).getAttribute('position').count; // 6: two tiles side by side share an edge
 * @see engine/gfx/level/meshes.test.ts
 */
import type { BufferGeometry } from 'three/webgpu';
import type { TileRect } from '../../world/level/types';
import { createWriter } from '../geometry/writer';

/** A flat surface at height `y` over every tile of `pieces`, tiles `tile` metres wide (see the file comment). */
export function surfaceGeometry(tile: number, pieces: readonly TileRect[], y: number): BufferGeometry {
  const writer = createWriter();
  const corners = new Map<string, number>();
  const corner = (col: number, row: number) => {
    const key = `${col},${row}`;
    let index = corners.get(key);
    if (index === undefined) {
      const [x, z] = [col * tile, row * tile];
      index = writer.vertex([x, y, z], [0, 1, 0], [x, -z]);
      corners.set(key, index);
    }
    return index;
  };
  for (const [c0, r0, c1, r1] of pieces) {
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const [nw, ne, se, sw] = [
          corner(col, row),
          corner(col + 1, row),
          corner(col + 1, row + 1),
          corner(col, row + 1),
        ];
        writer.triangle(nw, sw, se);
        writer.triangle(nw, se, ne);
      }
    }
  }
  return writer.build();
}
