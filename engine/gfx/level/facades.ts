/**
 * @file A building's facades (PLAN.md WP 13.40; the final visual review: in isometric, where the walls facing the
 * camera are cut to stumps, the walls over their windows and doors, and their frames, stood at full height as loose
 * pillars). `openingFacade(opening)` names the way an opening's wall faces out of the building (an index into
 * engine/gfx/level/linings.ts's `LINING_FACES`: the side its rooms are not on), `INSIDE` for one between two rooms or
 * none; `facadeParts(openings, build)` draws a storey's heads, frames or facings facade by facade into one geometry,
 * inside first, each facade a range of its index with a cell standing for it (its openings' middle, their extent, the
 * way it faces), so the cutaway (engine/gfx/cutaway.ts) draws only the ranges of the facades it does not cut by facing:
 * one draw group while none is cut, two at most when a classic view cuts two facades side by side.
 *
 * An opening's rooms are its compiled ones, a side with none found past the low solids beside it (`openingRooms`,
 * engine/gfx/level/linings.ts's `roomBeside`; WP 13.41): a window over the kitchen's counter opens onto the kitchen, so
 * it stands on the kitchen's facade and its facings take the kitchen's lining.
 *
 * Invariants: pure in the openings; the ranges cover the geometry's index in order, inside first.
 *
 * @example
 * openingFacade({ axis: 'x', rooms: [-1, 2] } as never); // 2: the outdoors to its north, a north wall's opening
 * @see engine/gfx/level/facades.test.ts
 */
import type { BufferGeometry } from 'three/webgpu';
import { sidesOf } from '../../world/level/openings';
import type { OpeningDescriptor } from '../../world/level/types';
import type { CutTarget } from '../cutaway';
import { mergeGeometries } from '../geometry/groups';
import type { LevelCell } from './cells';
import { LINING_FACES, roomBeside, type RoomView } from './linings';
import type { LevelMeshPart } from './meshes';

/** An opening between two rooms, or none: it faces no way out. */
export const INSIDE = -1;

/** One facade's range of a part's index (`face` an index into `LINING_FACES`, or `INSIDE`) and the cell for it. */
export interface FacadeRange {
  readonly face: number;
  readonly start: number;
  readonly count: number;
  readonly cell: Pick<LevelCell, 'centre' | 'size' | 'out'>;
}

/** The way `opening`'s wall faces out of the building (see the file comment). */
export function openingFacade(opening: Pick<OpeningDescriptor, 'axis' | 'rooms'>): number {
  const [low, high] = opening.rooms; // the lower x or z side's room first
  if (low < 0 === high < 0) return INSIDE;
  const names = opening.axis === 'x' ? ['north', 'south'] : ['west', 'east'];
  return LINING_FACES.findIndex((face) => face.name === names[low < 0 ? 0 : 1]);
}

/** `opening`'s rooms on `view`, the lower x or z side's first, one with none found past its low solids. */
export function openingRooms(view: RoomView, opening: OpeningDescriptor): [number, number] {
  const sides = sidesOf(opening, view.cols, view.rows);
  return opening.rooms.map((room, k) => {
    const tile = sides[k];
    return room >= 0 || !tile ? room : roomBeside(view, tile[0], tile[1]);
  }) as [number, number];
}

/** Each tile of `openings` on a facade, by its index on a map `cols` wide: the facade its opening faces. */
export function facadeTiles(cols: number, openings: readonly OpeningDescriptor[]): Map<number, number> {
  const tiles = new Map<number, number>();
  for (const opening of openings) {
    const face = openingFacade(opening);
    const [c0, r0, c1, r1] = opening.tiles;
    if (face !== INSIDE) for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) tiles.set(r * cols + c, face);
  }
  return tiles;
}

/**
 * Draws `openings` facade by facade with `build` (a facade's openings and its face to a geometry, or null) into one
 * geometry with a range a facade (see the file comment), at `bottom` m; null when nothing is drawn.
 */
export function facadeParts(
  openings: readonly OpeningDescriptor[],
  tile: number,
  bottom: number,
  build: (openings: readonly OpeningDescriptor[], face: number) => BufferGeometry | null,
): { geometry: BufferGeometry; facades: FacadeRange[] } | null {
  const geometries: BufferGeometry[] = [];
  const facades: FacadeRange[] = [];
  let start = 0;
  for (const face of [INSIDE, ...LINING_FACES.keys()]) {
    const own = openings.filter((opening) => openingFacade(opening) === face);
    const geometry = face === INSIDE || own.length ? build(own, face) : null;
    if (!geometry) continue;
    const count = geometry.getIndex()?.count ?? geometry.getAttribute('position').count;
    const rects = own.map(({ tiles: [c0, r0, c1, r1] }) => [c0 * tile, r0 * tile, (c1 + 1) * tile, (r1 + 1) * tile]);
    const [x0, z0] = [Math.min(...rects.map((r) => r[0])), Math.min(...rects.map((r) => r[1]))];
    const [x1, z1] = [Math.max(...rects.map((r) => r[2])), Math.max(...rects.map((r) => r[3]))];
    const { dc, dr } = face === INSIDE ? { dc: 0, dr: 0 } : LINING_FACES[face];
    const cell = rects.length ? { centre: [(x0 + x1) / 2, bottom, (z0 + z1) / 2] as [number, number, number], size: [x1 - x0, z1 - z0] as [number, number], out: [dc, dr] as [number, number] } : { centre: [0, bottom, 0] as [number, number, number], size: [0, 0] as [number, number], out: [0, 0] as [number, number] }; // prettier-ignore
    facades.push({ face, start, count, cell });
    geometries.push(geometry);
    start += count;
  }
  if (!geometries.length) return null;
  const geometry = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries);
  geometry.clearGroups();
  return { geometry, facades };
}

/**
 * The parts of `parts` drawn facade by facade, drawn by the facades left standing: `targets`, a facing target a part
 * (its facades' cells) for engine/gfx/cutaway.ts's `planCutaway`; `show(cuts)` draws each part's ranges but those of
 * the facades `cuts` marks, run together where they meet, a part with none left drawing no group (never its
 * `visible`, which is engine/gfx/storeyCut.ts's: WP 13.41, the upper storey's frames came back over a cut storey);
 * `cut()` names the facades left out, by part.
 */
export function facadeDraws(
  parts: readonly Pick<LevelMeshPart, 'name' | 'mesh' | 'facades' | 'bottom' | 'top' | 'storey'>[],
) {
  const drawn = parts.filter((part) => part.facades?.some(({ face }) => face !== INSIDE));
  const targets: CutTarget[] = drawn.map(({ facades, bottom, top, storey }) => ({ when: 'facing', cells: facades!.map(({ cell }) => cell), bottom, top, storey })); // prettier-ignore
  const cut = drawn.map(({ facades }) => facades!.map(() => false));
  return {
    targets,
    show(cuts: readonly (readonly boolean[])[]): void {
      drawn.forEach((part, i) => {
        if (cuts[i].every((one, j) => one === cut[i][j])) return;
        cut[i] = [...cuts[i]];
        const ranges: [number, number][] = [];
        part.facades!.forEach(({ start, count }, j) => {
          if (cuts[i][j]) return;
          const last = ranges.at(-1);
          if (last && last[0] + last[1] === start) last[1] += count;
          else ranges.push([start, count]);
        });
        part.mesh.geometry.clearGroups(); // none left: no group, so it draws nothing (its `visible` is the storey cut's)
        for (const [start, count] of ranges) part.mesh.geometry.addGroup(start, count, 0);
      });
    },
    cut: (): Record<string, number[]> =>
      Object.fromEntries(drawn.map(({ name, facades }, i) => [name, facades!.filter((_, j) => cut[i][j]).map(({ face }) => face)])), // prettier-ignore
  };
}
