/**
 * @file Level cells and the way they face out (PLAN.md WP 2.4): one cell per piece of a block mesh (a wall tile, a
 * pillar's footprint), with its tiles, its centre and its outward direction, the way it faces out of the room, away
 * from the open floor beside it. A camera on that side looks over the wall: the cutaway (WP 4.4) swaps such walls to
 * their cut twins.
 *
 * The outward direction, on the map (X east, Z south): a piece open to the west (a tile beside it that is not solid)
 * leans east, open to the east leans west, open to the north leans south, open to the south leans north; open on
 * both sides of an axis cancels out. A piece open on no side (inside a thick wall, a corner) faces away from the map's
 * centre, diagonally. Outside the map counts as solid. The direction is of length 1.
 *
 * Carried from the wall cells of `my-3d2dge:src/stress-world/10-hall.js:302-308` (`WALL_CELLS`: `ox`, `oy` from the
 * solid neighbours, the diagonal fallback by the hall's halves), for pieces of any footprint.
 *
 * Invariants: cells in the order of the pieces (reading order, the instances' order); pure, reads only the compiled
 * level's grids.
 *
 * @example
 * // a wall tile on the room's north edge, with floor south of it, faces north: out [0, -1]
 * @see engine/gfx/level/meshes.test.ts
 */
import type { CompiledLevel, TileRect } from '../../world/level/types';

/** One piece of a block mesh: its tiles, its centre on the ground (m), and the way it faces out ([x, z], length 1). */
export interface LevelCell {
  tiles: TileRect;
  centre: [x: number, y: number, z: number];
  out: [x: number, z: number];
}

/** Whether tile (col, row) of `level` is solid; outside the map counts as solid. */
function solid(level: CompiledLevel, col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= level.cols || row >= level.rows) return true;
  return level.solid[row * level.cols + col];
}

/** Whether any of `tiles` (`[col, row]`, the tiles along one side of a piece) is open: not solid. */
function openAlong(level: CompiledLevel, tiles: [number, number][]): boolean {
  return tiles.some(([col, row]) => !solid(level, col, row));
}

/** The cells of `pieces` in `level`, standing at height `bottom` (see the file comment). */
export function levelCells(level: CompiledLevel, pieces: readonly TileRect[], bottom: number): LevelCell[] {
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
  return pieces.map((tiles) => {
    const [c0, r0, c1, r1] = tiles;
    const west = openAlong(
      level,
      range(r0, r1).map((row) => [c0 - 1, row]),
    );
    const east = openAlong(
      level,
      range(r0, r1).map((row) => [c1 + 1, row]),
    );
    const north = openAlong(
      level,
      range(c0, c1).map((col) => [col, r0 - 1]),
    );
    const south = openAlong(
      level,
      range(c0, c1).map((col) => [col, r1 + 1]),
    );
    let x = Number(west) - Number(east);
    let z = Number(north) - Number(south);
    const centre: LevelCell['centre'] = [((c0 + c1 + 1) / 2) * level.tile, bottom, ((r0 + r1 + 1) / 2) * level.tile];
    if (!x && !z) {
      x = (c0 + c1 + 1) / 2 < level.cols / 2 ? -1 : 1;
      z = (r0 + r1 + 1) / 2 < level.rows / 2 ? -1 : 1;
    }
    const length = Math.hypot(x, z);
    return { tiles, centre, out: [x / length, z / length] };
  });
}
