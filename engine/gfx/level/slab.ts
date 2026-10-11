/**
 * @file Slabs (PLAN.md WP 4.4): `slabGeometry(tile, pieces, bottom, top)` draws a raised block of tiles as one solid,
 * a gallery: its walk, one welded surface over every tile at `top` (engine/gfx/level/surface.ts), and its sides,
 * upright faces from `bottom` to `top` along the outline only, where a piece's tile meets a tile that is not one of
 * the pieces' (or the map's edge). So a 20 × 4 gallery is 105 walk vertices and its rim, not 80 boxes with their
 * hidden faces, and costs two draw calls (sides, then walk) however many tiles it has.
 *
 * Each side face is one tile's edge, so its corners are the walk's corners and nothing meets an edge part-way: no
 * T-junctions, no cracks. UVs are in metres anchored to the world (engine/gfx/level/faces.ts), so the walk's
 * flagstones run on from the floor's and the bricks of one side run on from tile to tile.
 *
 * Carried from the galleries of `my-3d2dge:src/stress-world/10-hall.js:375-382` (a slab of bricks topped with the
 * floor's flagstones), as one mesh over the gallery's tiles instead of a box and a polygon per gallery rectangle.
 *
 * Invariants: slot 0 the sides, slot 1 the walk; pure in its inputs; every side faces out of the slab; a slab whose
 * top is not above its bottom is its walk alone.
 *
 * @example
 * slabGeometry(1, [[0, 0, 0, 0], [1, 0, 1, 0]], 0, 1).groups.length; // 2: sides (6 tile edges), then the walk
 * @see engine/gfx/level/shapes.test.ts
 */
import type { BufferGeometry } from 'three/webgpu';
import type { TileRect } from '../../world/level/types';
import { slotted, upright, type Ground } from './faces';
import { surfaceGeometry } from './surface';

/** A raised block over `pieces` from `bottom` to `top` (m), tiles `tile` metres wide (see the file comment). */
export function slabGeometry(tile: number, pieces: readonly TileRect[], bottom: number, top: number): BufferGeometry {
  const inside = new Set<string>();
  for (const [c0, r0, c1, r1] of pieces) {
    for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) inside.add(`${col},${row}`);
  }
  const writers = slotted();
  const sides = writers.slot(0);
  const at = (col: number, row: number): Ground => [col * tile, row * tile];
  for (const key of top > bottom ? inside : []) {
    const [col, row] = key.split(',').map(Number);
    const open = (c: number, r: number) => !inside.has(`${c},${r}`);
    // Each edge runs so that its face looks out of the slab (faces.ts's `upright`).
    if (open(col, row - 1)) upright(sides, at(col + 1, row), at(col, row), bottom, top);
    if (open(col, row + 1)) upright(sides, at(col, row + 1), at(col + 1, row + 1), bottom, top);
    if (open(col - 1, row)) upright(sides, at(col, row), at(col, row + 1), bottom, top);
    if (open(col + 1, row)) upright(sides, at(col + 1, row + 1), at(col + 1, row), bottom, top);
  }
  return writers.build([{ slot: 1, geometry: surfaceGeometry(tile, pieces, top) }]);
}
