/**
 * @file A building's linings (PLAN.md WP 13.40; the final visual review: from inside, the house's outer walls showed
 * their siding, so a room read as open to the outside): `liningParts(view, walls, linings)` lines each face of a lined
 * recipe's wall pieces that opens onto a room's floor (on a storey of a level with rooms: its view's `room` grid,
 * engine/world/level/storeys.ts) with a quad `FACING` out of it in the recipe's `lining` material
 * (engine/gfx/level/recipes.ts), one instanced part a face's way (west, east, north, south), size and height a storey.
 * Each lining's cell is its wall piece's, so the cutaway (engine/gfx/cutaway.ts) cuts it exactly when it cuts the wall
 * behind it, to a stump as tall as the wall's, and the storey cut (engine/gfx/storeyCut.ts) lifts it with its storey.
 * A quad's ends reach `FACING` past its piece, so two linings meet in a room's corners. A face looks over a solid
 * at most `LOW_SOLID` over its floor (a counter, WP 13.41: the kitchen's wall behind its counter showed siding) to
 * the room beside it (`roomBeside`), as engine/gfx/level/facades.ts's openings do.
 *
 * Invariants: pure in the view and the parts; no lining where a recipe has none, nor on a level without rooms.
 *
 * @example
 * liningGeometry(0, [0.5, 0.5], 2.7).getAttribute('normal').getX(0); // -1: the west face's lining faces west
 * @see engine/gfx/level/linings.test.ts
 */
import type { BufferGeometry } from 'three/webgpu';
import type { CompiledLevel } from '../../world/level/types';
import { createWriter, type Vec3 } from '../geometry/writer';
import { openingAt, type LevelCell } from './cells';
import { FACING } from './openings';

/** A piece's four faces: the step to the neighbour each opens onto, and the face's normal and u along it. */
export const LINING_FACES = [
  { name: 'west', dc: -1, dr: 0, u: [0, 0, 1] },
  { name: 'east', dc: 1, dr: 0, u: [0, 0, -1] },
  { name: 'north', dc: 0, dr: -1, u: [-1, 0, 0] },
  { name: 'south', dc: 0, dr: 1, u: [1, 0, 0] },
] as const;

/** A wall part to line: its recipe's name, its pieces' cells, its height range, and its cut's height and rule. */
export interface LinedWall {
  readonly recipe: string;
  readonly cells: readonly LevelCell[];
  readonly bottom: number;
  readonly top: number;
  readonly cut: { readonly height: number; readonly when: 'facing' | 'blocking' | 'either' } | null;
}

/** One lining part: a face's way of a recipe's walls, its quad and stump, the cells it lines and its material. */
export interface LiningPart {
  readonly name: string;
  readonly material: string;
  readonly face: number;
  readonly cells: readonly LevelCell[];
  readonly bottom: number;
  readonly top: number;
  readonly geometry: BufferGeometry;
  readonly cut: { readonly height: number; readonly when: 'facing' | 'blocking' | 'either'; geometry(): BufferGeometry } | null; // prettier-ignore
}

/**
 * The quad lining face `face` (an index into `LINING_FACES`) of a piece `size` across ([x, z], m) and `height` tall
 * from its foot, `FACING` out of it, its ends `FACING` past it, u along it and v up in metres.
 */
export function liningGeometry(face: number, [w, d]: readonly [number, number], height: number): BufferGeometry {
  const { dc, dr, u } = LINING_FACES[face];
  const out = (dc ? w : d) / 2 + FACING; // from the piece's centre to the quad
  const half = (dc ? d : w) / 2 + FACING; // along the face, past its ends
  const writer = createWriter();
  const at = (along: number, y: number): Vec3 => [dc * out + u[0] * along, y, dr * out + u[2] * along];
  writer.face([at(-half, 0), at(half, 0), at(half, height), at(-half, height)], [...u], [0, 1, 0]);
  return writer.build();
}

/** A solid at most this high over its floor (m) is furniture a room's face looks over: a counter (0.9 m), a bath. */
export const LOW_SOLID = 1.2;

/** What `roomBeside` reads of a storey's view: its grids, and its tiles' tops, floors and legend where it has them. */
export type RoomView = Pick<CompiledLevel, 'cols' | 'rows' | 'solid' | 'room'> & Partial<Pick<CompiledLevel, 'top' | 'floor' | 'legend' | 'tiles'>>; // prettier-ignore

/** The most tiles of low solids `roomBeside` looks over (a counter's run is some 40). */
const LOW_RUN = 256;

/**
 * The room tile (`col`, `row`) of `view` opens onto: its own when it is open floor; past a solid at most `LOW_SOLID`
 * over its floor, the room beside the run of such solids it stands in (the first found, none where the run meets the
 * outdoors; an opening, a doorway or a window's sill, is neither); −1 for a taller solid, the outdoors or the map's
 * edge.
 */
export function roomBeside(view: RoomView, col: number, row: number): number {
  const { cols, rows } = view;
  const inside = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows;
  const low = (at: number) =>
    view.solid[at] && !openingAt(view, at) && (view.top?.[at] ?? Infinity) - (view.floor?.[at] ?? 0) <= LOW_SOLID; // prettier-ignore a window's sill is no counter
  const first = row * cols + col;
  if (!inside(col, row)) return -1;
  if (!view.solid[first]) return view.room?.[first] ?? -1;
  if (!low(first)) return -1;
  const [run, seen] = [[first], new Set([first])];
  let found = -1;
  for (let i = 0; i < run.length && run.length <= LOW_RUN; i++) {
    const [c, r] = [run[i] % cols, Math.floor(run[i] / cols)];
    for (const [x, z] of [
      [c - 1, r],
      [c + 1, r],
      [c, r - 1],
      [c, r + 1],
    ]) {
      const at = z * cols + x;
      if (!inside(x, z) || seen.has(at)) continue;
      seen.add(at);
      if (low(at)) run.push(at);
      else if (!view.solid[at] && !openingAt(view, at)) {
        const room = view.room?.[at] ?? -1;
        if (room < 0) return -1; // the run stands outdoors too
        if (found < 0) found = room;
      }
    }
  }
  return found;
}

/**
 * The lining parts of `walls` on `view` (see the file comment): `linings` gives a recipe's lining material, or
 * undefined for one that has none.
 */
export function liningParts(
  view: RoomView,
  walls: readonly LinedWall[],
  linings: (recipe: string) => string | undefined,
): LiningPart[] {
  if (!view.room) return [];
  const groups = new Map<string, { wall: LinedWall; material: string; face: number; size: [number, number]; cells: LevelCell[] }>(); // prettier-ignore
  for (const wall of walls) {
    const material = linings(wall.recipe);
    if (!material) continue;
    for (const cell of wall.cells) {
      const [c0, r0, c1, r1] = cell.tiles;
      LINING_FACES.forEach(({ dc, dr }, face) => {
        const side: [number, number][] = dc
          ? Array.from({ length: r1 - r0 + 1 }, (_, i) => [dc < 0 ? c0 - 1 : c1 + 1, r0 + i])
          : Array.from({ length: c1 - c0 + 1 }, (_, i) => [c0 + i, dr < 0 ? r0 - 1 : r1 + 1]);
        if (!side.some(([col, row]) => roomBeside(view, col, row) >= 0)) return;
        const key = [wall.recipe, face, ...cell.size, wall.bottom, wall.top, wall.cut?.height ?? '', wall.cut?.when ?? ''].join('|'); // prettier-ignore
        const group = groups.get(key) ?? { wall, material, face, size: [...cell.size], cells: [] };
        group.cells.push(cell);
        groups.set(key, group);
      });
    }
  }
  return [...groups.values()].map(({ wall, material, face, size, cells }) => {
    const height = wall.top - wall.bottom;
    const cut = wall.cut && { ...wall.cut, geometry: () => liningGeometry(face, size, Math.min(wall.cut!.height, height)) }; // prettier-ignore
    const name = `lining:${wall.recipe}:${LINING_FACES[face].name}`;
    return { name, material, face, cells, bottom: wall.bottom, top: wall.top, geometry: liningGeometry(face, size, height), cut }; // prettier-ignore
  });
}
