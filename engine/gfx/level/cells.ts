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
 * both sides, or the outdoors on both, faces nowhere (`out` [0, 0]), so only a line of sight cuts it; a doorway beside
 * it is neither (WP 13.41: a door's jamb took its doorway for the outdoors, faced across the wall and stood whole)
 * (engine/gfx/cutaway.ts). A piece open on no side faces away from the map's centre, as before. A run of a mesh's
 * pieces (4-connected) whose every open side opens onto a room stands in the rooms (a chimney's breast, a counter,
 * the kitchen's island: WP 13.41, the breast's corner stood whole beside its cut sides, a loose post): its pieces face
 * nowhere and share a `group`, which the cutaway cuts whole. Standing: its open sides open onto rooms alone (one or
 * more, never the outdoors), and it is a block, holding a square of 2 × 2 pieces, not a wall's line, of at most
 * `STANDING_AREA` (the basement's earth between its rooms, written as partitions, is larger).
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
  /** A run of pieces standing in one room (see the file comment): its first tile's index; none for any other piece. */
  group?: number;
}

/** The most a block standing in rooms covers (m²): a chimney's breast, a counter, an island (see the file comment). */
export const STANDING_AREA = 4;

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
  /** Whether tile `at` is an opening's (a doorway's): open, in no room, yet not the outdoors either. */
  const opening = (at: number) => !['', 'none', undefined].includes(level.legend?.[level.tiles?.[at]]?.opening);
  /** Whether any of `tiles` opens onto a room's floor (`inRoom`), or onto the outdoors, on a building's storey. */
  const opensOnto = (tiles: [number, number][], inRoom: boolean) =>
    tiles.some(([col, row]) => !solid(level, col, row) && !opening(row * level.cols + col) && (room?.[row * level.cols + col] ?? -1) >= 0 === inRoom); // prettier-ignore
  /** On a building's storey, the way along an axis from side `a` to side `b`: away from a room, to the outdoors. */
  const lean = (a: [number, number][], b: [number, number][]) =>
    Math.sign(Number(opensOnto(a, true)) - Number(opensOnto(b, true)) + Number(opensOnto(b, false)) - Number(opensOnto(a, false))); // prettier-ignore
  const stands = room ? standing(level, room, pieces) : new Map<number, number>();
  return pieces.map((tiles) => {
    const [c0, r0, c1, r1] = tiles;
    const group = stands.get(r0 * level.cols + c0);
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
    if (group !== undefined) return { tiles, centre, size, out: [0, 0], group }; // standing in a room: cut whole
    if (!x && !z && settled) return { tiles, centre, size, out: [0, 0] }; // between rooms, or the outdoors both sides
    if (!x && !z) {
      x = (c0 + c1 + 1) / 2 < level.cols / 2 ? -1 : 1;
      z = (r0 + r1 + 1) / 2 < level.rows / 2 ? -1 : 1;
    }
    const length = Math.hypot(x, z);
    return { tiles, centre, size, out: [x / length, z / length] };
  });
}

/**
 * The pieces of `pieces` standing in one room (see the file comment), by their first tile's index: their run's group,
 * the index of its first tile in reading order.
 */
function standing(level: CompiledLevel, room: readonly number[], pieces: readonly TileRect[]): Map<number, number> {
  const { cols } = level;
  const piece = new Map<number, number>(); // each tile of a piece: the index of the piece's first tile
  for (const [c0, r0, c1, r1] of pieces) for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) piece.set(r * cols + c, r0 * cols + c0); // prettier-ignore
  const groups = new Map<number, number>();
  const seen = new Set<number>();
  for (const first of [...piece.keys()].sort((a, b) => a - b)) {
    if (seen.has(first)) continue;
    const [run, queue, rooms] = [[] as number[], [first], new Set<number>()];
    seen.add(first);
    while (queue.length > 0) {
      const at = queue.pop()!;
      run.push(at);
      const [col, row] = [at % cols, Math.floor(at / cols)];
      for (const [c, r] of [
        [col - 1, row],
        [col + 1, row],
        [col, row - 1],
        [col, row + 1],
      ]) {
        const next = r * cols + c;
        if (c < 0 || r < 0 || c >= cols || r >= level.rows)
          rooms.add(-1); // the map's edge: no room
        else if (!piece.has(next)) {
          if (!solid(level, c, r)) rooms.add(room[next]); // what its open side opens onto
        } else if (!seen.has(next)) {
          queue.push(next);
          seen.add(next);
        }
      }
    }
    const square = (at: number) => [at + 1, at + cols, at + cols + 1].every((one) => piece.has(one)) && at % cols < cols - 1; // prettier-ignore
    const small = run.length * level.tile * level.tile <= STANDING_AREA;
    if (rooms.size === 0 || rooms.has(-1) || !small || !run.some(square)) continue; // see the file comment
    for (const at of run) if (piece.get(at) === at) groups.set(at, first);
  }
  return groups;
}

/** Each cell's neighbours in a list of cells, by index, made once a list (`cellNeighbours`). */
const neighbourLists = new WeakMap<readonly unknown[], number[][]>();

/**
 * The indexes of the cells of `cells` beside each one: sharing an edge on the ground (their boxes touch along a side,
 * not at a corner). Made once for each list, which a part keeps for its life.
 */
export function cellNeighbours(cells: readonly Pick<LevelCell, 'centre' | 'size'>[]): readonly (readonly number[])[] {
  const known = neighbourLists.get(cells);
  if (known) return known;
  const touch = (a: number, b: number, reach: number) => Math.abs(Math.abs(a - b) - reach) < 1e-6;
  const overlap = (a: number, b: number, reach: number) => Math.abs(a - b) < reach - 1e-6;
  const lists = cells.map(({ centre: [x, , z], size: [w, d] }, i) =>
    cells.flatMap(({ centre: [x2, , z2], size: [w2, d2] }, j) => {
      const [rx, rz] = [(w + w2) / 2, (d + d2) / 2];
      const beside = (touch(x, x2, rx) && overlap(z, z2, rz)) || (touch(z, z2, rz) && overlap(x, x2, rx));
      return i !== j && beside ? [j] : [];
    }),
  );
  neighbourLists.set(cells, lists);
  return lists;
}

/**
 * Settles the cuts `cuts` planned for each list of `lists` (engine/gfx/cutaway.ts's `planCutaway`): a cell of a
 * `group` is cut when any of its group's is; one whose neighbours in its list (`cellNeighbours`) are all cut is cut
 * with them, so no piece stands alone, a post, beside its cut ones (a jamb beside its doorway, a partition's end); and a cell two lists share (a wall's
 * piece and its lining, engine/gfx/level/linings.ts) is cut in both when either cuts it.
 */
export function settleCuts(
  lists: readonly (readonly Pick<LevelCell, 'centre' | 'size' | 'group'>[])[],
  cuts: readonly (readonly boolean[])[],
): boolean[][] {
  const settled = lists.map((cells, k) => {
    const cut = cuts[k];
    const whole = new Set(cells.filter((cell, i) => cut[i] && cell.group !== undefined).map(({ group }) => group));
    const near = cut.some(Boolean) ? cellNeighbours(cells) : [];
    return cells.map((cell, i) => cut[i] || whole.has(cell.group) || ((near[i]?.length ?? 0) > 0 && near[i].every((j) => cut[j]))); // prettier-ignore
  });
  const gone = new Set(lists.flatMap((cells, k) => cells.filter((_, i) => settled[k][i])));
  return lists.map((cells, k) => cells.map((cell, i) => settled[k][i] || gone.has(cell)));
}
