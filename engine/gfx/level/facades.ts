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
import type { CompiledLevel, OpeningDescriptor, StoreyDescriptor, TileRect } from '../../world/level/types';
import type { CutTarget } from '../cutaway';
import { mergeGeometries } from '../geometry/groups';
import type { LevelCell } from './cells';
import { LINING_FACES, roomBeside, type RoomView } from './linings';
import type { LevelMeshPart } from './meshes';

/** An opening between two rooms, or none: it faces no way out. */
export const INSIDE = -1;

/** The key of a storey's first doorway between two rooms (its own range, cut where it blocks the view); the next +1. */
export const DOORWAY = LINING_FACES.length;

/**
 * One range of a part's index and the cell for it: `face`, the facade's (an index into `LINING_FACES`), a doorway's
 * between two rooms (`DOORWAY` on), or `INSIDE` for what stands at no opening (a low ceiling's heads).
 */
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

/**
 * The rectangle holding `storey`'s tiles under a low ceiling (a glyph's `head` that is not an opening's: the
 * crawlspace's), what a storey's heads draw at no opening; undefined where it has none.
 */
export function lowCeiling(
  level: Pick<CompiledLevel, 'cols' | 'legend'>,
  storey: Pick<StoreyDescriptor, 'tiles'>,
): TileRect | undefined {
  const [cols, rows] = [[] as number[], [] as number[]];
  storey.tiles.forEach((char, at) => {
    const glyph = level.legend[char];
    if (!((glyph?.head ?? 0) > 0) || !['', 'none', undefined].includes(glyph.opening)) return;
    cols.push(at % level.cols);
    rows.push(Math.floor(at / level.cols));
  });
  return cols.length ? [Math.min(...cols), Math.min(...rows), Math.max(...cols), Math.max(...rows)] : undefined;
}

/** Each of `openings`' key: its facade's, or a doorway's between two rooms (`DOORWAY` on, in their order). */
export function openingKeys(openings: readonly Pick<OpeningDescriptor, 'axis' | 'rooms'>[]): number[] {
  let doorways = 0;
  return openings.map((opening) => {
    const face = openingFacade(opening);
    return face === INSIDE ? DOORWAY + doorways++ : face;
  });
}

/** Each tile of `openings`, by its index on a map `cols` wide: its opening's key (`openingKeys`). */
export function facadeTiles(cols: number, openings: readonly OpeningDescriptor[]): Map<number, number> {
  const tiles = new Map<number, number>();
  const keys = openingKeys(openings);
  openings.forEach(({ tiles: [c0, r0, c1, r1] }, i) => {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) tiles.set(r * cols + c, keys[i]);
  });
  return tiles;
}

/**
 * Draws `openings` facade by facade with `build` (a facade's openings and its face to a geometry, or null) into one
 * geometry with a range a facade (see the file comment), at `bottom` m; null when nothing is drawn. What stands at no
 * opening (`INSIDE`: a low ceiling's heads) takes `inside`, the rectangle of its tiles, as its cell.
 */
export function facadeParts(
  openings: readonly OpeningDescriptor[],
  tile: number,
  bottom: number,
  build: (openings: readonly OpeningDescriptor[], face: number) => BufferGeometry | null,
  inside?: TileRect,
): { geometry: BufferGeometry; facades: FacadeRange[] } | null {
  const geometries: BufferGeometry[] = [];
  const facades: FacadeRange[] = [];
  let start = 0;
  const keys = openingKeys(openings);
  for (const face of [INSIDE, ...LINING_FACES.keys(), ...keys.filter((key) => key >= DOORWAY)]) {
    const own = openings.filter((_, i) => keys[i] === face);
    const geometry = face === INSIDE || own.length ? build(own, face) : null;
    if (!geometry) continue;
    const count = geometry.getIndex()?.count ?? geometry.getAttribute('position').count;
    const rects = [...own.map(({ tiles }) => tiles), ...(face === INSIDE && inside ? [inside] : [])].map(([c0, r0, c1, r1]) => [c0 * tile, r0 * tile, (c1 + 1) * tile, (r1 + 1) * tile]); // prettier-ignore
    const [x0, z0] = [Math.min(...rects.map((r) => r[0])), Math.min(...rects.map((r) => r[1]))];
    const [x1, z1] = [Math.max(...rects.map((r) => r[2])), Math.max(...rects.map((r) => r[3]))];
    const { dc, dr } = face >= 0 && face < DOORWAY ? LINING_FACES[face] : { dc: 0, dr: 0 };
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
 * The parts of `parts` drawn facade by facade, drawn by the ranges left standing: `targets` for engine/gfx/cutaway.ts's
 * `planCutaway`, a part's facades a facing target and its doorways between rooms a blocking one, with its `INSIDE`
 * range where that has a rectangle (a low ceiling's heads: the crawlspace's hid the basement's rooms); `show(cuts)` draws each part's ranges but those `cuts` marks, run together where they meet, a part
 * with none left drawing no group (never its `visible`, which is engine/gfx/storeyCut.ts's: WP 13.41, the upper
 * storey's frames came back over a cut storey); `cut()` names the ranges left out (their keys), by part.
 */
export function facadeDraws(
  parts: readonly Pick<LevelMeshPart, 'name' | 'mesh' | 'facades' | 'bottom' | 'top' | 'storey'>[],
) {
  const drawn = parts.filter((part) => part.facades?.some(({ face }) => face !== INSIDE));
  const targets: CutTarget[] = [];
  // where each range's cut comes from: its target and its cell there, or none (`INSIDE`)
  const slots = drawn.map(({ facades, bottom, top, storey }) => {
    const first = targets.length; // this part's targets: those from here on
    return facades!.map(({ face, cell }) => {
      if (face === INSIDE && !(cell.size[0] > 0)) return null; // nothing at no opening: never cut
      const when = face >= 0 && face < DOORWAY ? 'facing' : 'blocking';
      let target = targets.findIndex((one, k) => k >= first && one.when === when);
      if (target < 0) [target] = [targets.push({ when, cells: [], bottom, top, storey }) - 1];
      (targets[target].cells as CutTarget['cells'][number][]).push(cell);
      return [target, targets[target].cells.length - 1] as const;
    });
  });
  const cut = drawn.map(({ facades }) => facades!.map(() => false));
  return {
    targets,
    show(cuts: readonly (readonly boolean[])[]): void {
      drawn.forEach((part, i) => {
        const now = slots[i].map((slot) => !!slot && cuts[slot[0]][slot[1]]);
        if (now.every((one, j) => one === cut[i][j])) return;
        cut[i] = now;
        const ranges: [number, number][] = [];
        part.facades!.forEach(({ start, count }, j) => {
          if (now[j]) return;
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
