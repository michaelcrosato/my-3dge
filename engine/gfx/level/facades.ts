/**
 * @file A building's facades (PLAN.md WP 13.40; the final visual review: in isometric, where the walls facing the
 * camera are cut to stumps, the walls over their windows and doors, and their frames, stood at full height as loose
 * pillars). `openingFacade(opening)` names the way an opening's wall faces out of the building (an index into
 * engine/gfx/level/linings.ts's `LINING_FACES`: the side its rooms are not on), `INSIDE` for one between two rooms or
 * none; `facadeParts(openings, build)` draws a storey's heads, frames or facings opening by opening into one geometry,
 * what stands at no opening first, then the openings facade by facade, each a range of its index with its cell (its
 * tiles, the way its facade faces), so the cutaway (engine/gfx/cutaway.ts) draws only the ranges it does not cut: an
 * opening's facade facing the camera, or the opening on a line of sight to the player (WP 13.41: a doorway between two
 * rooms, its own facade none, hid him; a lintel over a window beside him did too). One draw group while none is cut; a
 * facade cut by facing is one run of its ranges.
 *
 * An opening's rooms are its compiled ones, a side with none found past the low solids beside it (`openingRooms`,
 * engine/gfx/level/linings.ts's `roomBeside`; WP 13.41): a window over the kitchen's counter opens onto the kitchen, so
 * it stands on the kitchen's facade and its facings take the kitchen's lining.
 *
 * Invariants: pure in the openings; the ranges cover the geometry's index in order, what stands at no opening first.
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

/** An opening between two rooms, or none: it faces no way out; and the key of what stands at no opening. */
export const INSIDE = -1;

/**
 * One range of a part's index and the cell for it: `key`, its opening's index among the storey's openings (`INSIDE`
 * for what stands at no opening: a low ceiling's heads, or a part drawn whole), and `face`, its facade (an index into
 * `LINING_FACES`; `INSIDE` between two rooms or at no opening).
 */
export interface FacadeRange {
  readonly face: number;
  readonly key: number;
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

/** Each tile of `openings`, by its index on a map `cols` wide: its opening's key, the opening's index. */
export function facadeTiles(cols: number, openings: readonly OpeningDescriptor[]): Map<number, number> {
  const tiles = new Map<number, number>();
  openings.forEach(({ tiles: [c0, r0, c1, r1] }, i) => {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) tiles.set(r * cols + c, i);
  });
  return tiles;
}

/**
 * Draws `openings` opening by opening with `build` (an opening, or none, and its key to a geometry, or null) into one
 * geometry with a range an opening (see the file comment), at `bottom` m; null when nothing is drawn. What stands at
 * no opening (`INSIDE`: a low ceiling's heads) takes `inside`, the rectangle of its tiles, as its cell.
 */
export function facadeParts(
  openings: readonly OpeningDescriptor[],
  tile: number,
  bottom: number,
  build: (openings: readonly OpeningDescriptor[], key: number) => BufferGeometry | null,
  inside?: TileRect,
): { geometry: BufferGeometry; facades: FacadeRange[] } | null {
  const geometries: BufferGeometry[] = [];
  const facades: FacadeRange[] = [];
  let start = 0;
  const faces = openings.map(openingFacade);
  const order = (face: number) => (face === INSIDE ? LINING_FACES.length : face); // facade by facade, doorways last
  const keys = [...openings.keys()].sort((a, b) => order(faces[a]) - order(faces[b]) || a - b);
  for (const key of [INSIDE, ...keys]) {
    const own = key === INSIDE ? [] : [openings[key]];
    const geometry = build(own, key);
    if (!geometry) continue;
    const count = geometry.getIndex()?.count ?? geometry.getAttribute('position').count;
    const rect = key === INSIDE ? inside : openings[key].tiles;
    const face = key === INSIDE ? INSIDE : faces[key];
    const { dc, dr } = face >= 0 ? LINING_FACES[face] : { dc: 0, dr: 0 };
    const [x0, z0, x1, z1] = rect ? [rect[0] * tile, rect[1] * tile, (rect[2] + 1) * tile, (rect[3] + 1) * tile] : [0, 0, 0, 0]; // prettier-ignore
    const cell = { centre: [(x0 + x1) / 2, bottom, (z0 + z1) / 2] as [number, number, number], size: [x1 - x0, z1 - z0] as [number, number], out: [dc, dr] as [number, number] }; // prettier-ignore
    facades.push({ face, key, start, count, cell });
    geometries.push(geometry);
    start += count;
  }
  if (!geometries.length) return null;
  const geometry = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries);
  geometry.clearGroups();
  return { geometry, facades };
}

/**
 * The parts of `parts` drawn opening by opening, drawn by the ranges left standing: `targets` for
 * engine/gfx/cutaway.ts's `planCutaway`, one a part (`either`: its ranges' cells, an opening cut where its facade faces
 * the camera or where it stands on a line of sight, a doorway between rooms by the line alone, with what stands at no
 * opening where that has a rectangle: a low ceiling's heads, a part drawn whole, engine/gfx/level/meshes.ts's flights
 * and blocks under a roof, its own draw groups back when it is not cut); `show(cuts)` draws each part's ranges but
 * those `cuts` marks, run together where they meet, a part with none left drawing no group (never its `visible`, which
 * is engine/gfx/storeyCut.ts's: WP 13.41, the upper storey's frames came back over a cut storey); `cut()` names the
 * ranges left out (their keys), by part.
 */
export function facadeDraws(
  parts: readonly Pick<LevelMeshPart, 'name' | 'mesh' | 'facades' | 'bottom' | 'top' | 'storey'>[],
) {
  const drawn = parts.filter((part) => part.facades?.some(({ key, cell }) => key !== INSIDE || cell.size[0] > 0));
  const own = drawn.map(({ mesh }) => mesh.geometry.groups.map((group) => ({ ...group }))); // a part drawn whole: its own
  // each part's target, and each range's cell in it (none for what stands at no opening without a rectangle: never cut)
  const slots: number[][] = drawn.map(({ facades }) => facades!.map(({ key, cell }) => (key === INSIDE && !(cell.size[0] > 0) ? -1 : 0))); // prettier-ignore
  const targets: CutTarget[] = drawn.map(({ facades, bottom, top, storey }, i) => {
    const cells = facades!.filter((_, j) => slots[i][j] >= 0).map(({ cell }) => cell);
    let n = 0;
    slots[i] = slots[i].map((slot) => (slot < 0 ? -1 : n++));
    return { when: 'either', cells, bottom, top, storey };
  });
  const cut = drawn.map(({ facades }) => facades!.map(() => false));
  return {
    targets,
    show(cuts: readonly (readonly boolean[])[]): void {
      drawn.forEach((part, i) => {
        const now = slots[i].map((slot) => slot >= 0 && cuts[i][slot]);
        if (now.every((one, j) => one === cut[i][j])) return;
        cut[i] = now;
        if (part.facades!.length === 1) {
          part.mesh.geometry.clearGroups(); // drawn whole (a flight, the blocks under a roof): its own groups, or none
          if (!now[0]) for (const { start, count, materialIndex } of own[i]) part.mesh.geometry.addGroup(start, count, materialIndex); // prettier-ignore
          return;
        }
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
      Object.fromEntries(drawn.map(({ name, facades }, i) => [name, facades!.filter((_, j) => cut[i][j]).map(({ key }) => key)])), // prettier-ignore
  };
}
