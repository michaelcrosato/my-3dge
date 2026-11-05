/**
 * @file Level cells and the way they face out (PLAN.md WP 2.4): one cell per piece of a block mesh (a wall tile, a
 * pillar's footprint), with its tiles, its centre, its size and its outward direction, the way it faces out of the
 * room, away from the open floor beside it. A camera on that side looks over the wall: the cutaway
 * (engine/gfx/cutaway.ts) swaps such walls to their cut twins, and stumps a pillar whose cell stands in the way.
 *
 * The outward direction, on the map (X east, Z south): a piece open to the west (a tile beside it that is not solid)
 * leans east, open to the east leans west, open to the north leans south, open to the south leans north; open on
 * both sides of an axis cancels out. A piece open on no side (inside a thick wall, a corner) faces away from the map's
 * centre, diagonally. Outside the map counts as solid. The direction is of length 1, but where it faces nowhere.
 *
 * On a storey of a level with rooms (its view's `room`, engine/world/level/storeys.ts) a piece faces along each axis
 * away from a room's floor and toward the outdoors (open floor outside every room): a wall with a room on one side and
 * the outdoors on the other faces the outdoors, as a house's thin outer walls do (open both ways, they fell back to
 * the map-centre diagonal: 410 of the house's 925 wall tiles, so a camera north of its east wall cut it, WP 13.39),
 * and so does one open to the outdoors alone (a corner, a thick wall's outer layer, which faced in); one with rooms on
 * both sides, or the outdoors on both, faces nowhere (`out` [0, 0]), so only a line of sight cuts it
 * (engine/gfx/cutaway.ts). A piece open on no side faces away from the map's centre, as before.
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
 * @see engine/gfx/level/cells.test.ts
 */
import type { CompiledLevel, TileRect } from '../../world/level/types';

/**
 * One piece of a block mesh: its tiles, its centre on the ground (m), its size across (m), and the way it faces out
 * ([x, z], length 1, or [0, 0] where it faces nowhere: see the file comment).
 */
export interface LevelCell {
  tiles: TileRect;
  centre: [x: number, y: number, z: number];
  size: [x: number, z: number];
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
  const { room } = level;
  /** Whether any of `tiles` opens onto a room's floor (`inRoom`), or onto the outdoors, on a building's storey. */
  const opensOnto = (tiles: [number, number][], inRoom: boolean) =>
    tiles.some(([col, row]) => !solid(level, col, row) && (room?.[row * level.cols + col] ?? -1) >= 0 === inRoom);
  /** On a building's storey, the way along an axis from side `a` to side `b`: away from a room, to the outdoors. */
  const lean = (a: [number, number][], b: [number, number][]) =>
    Math.sign(Number(opensOnto(a, true)) - Number(opensOnto(b, true)) + Number(opensOnto(b, false)) - Number(opensOnto(a, false))); // prettier-ignore
  return pieces.map((tiles) => {
    const [c0, r0, c1, r1] = tiles;
    const sides: [number, number][][] = [
      range(r0, r1).map((row) => [c0 - 1, row]), // west
      range(r0, r1).map((row) => [c1 + 1, row]), // east
      range(c0, c1).map((col) => [col, r0 - 1]), // north
      range(c0, c1).map((col) => [col, r1 + 1]), // south
    ];
    const [west, east, north, south] = sides.map((side) => openAlong(level, side));
    let x = Number(west) - Number(east);
    let z = Number(north) - Number(south);
    const settled = !!room && (west || east || north || south); // a building's storey, the piece open somewhere
    if (settled) [x, z] = [lean(sides[0], sides[1]), lean(sides[2], sides[3])];
    const centre: LevelCell['centre'] = [((c0 + c1 + 1) / 2) * level.tile, bottom, ((r0 + r1 + 1) / 2) * level.tile];
    const size: LevelCell['size'] = [(c1 - c0 + 1) * level.tile, (r1 - r0 + 1) * level.tile];
    if (!x && !z && settled) return { tiles, centre, size, out: [0, 0] }; // between rooms, or the outdoors both sides
    if (!x && !z) {
      x = (c0 + c1 + 1) / 2 < level.cols / 2 ? -1 : 1;
      z = (r0 + r1 + 1) / 2 < level.rows / 2 ? -1 : 1;
    }
    const length = Math.hypot(x, z);
    return { tiles, centre, size, out: [x / length, z / length] };
  });
}
