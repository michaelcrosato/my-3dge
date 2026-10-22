/**
 * @file Levels written as storeys (PLAN.md WP 13.13; docs/PLAYGROUND.md §6.1): format 2's structural checks and its
 * compilation. `checkStoreys` reads the parsed storeys, their glyphs already found (validate.ts): the storeys' keys
 * (a base and a height each, every map the size of the first, each base above the ceiling of the storey below, names
 * once, a roof on the top storey only: `LEVEL_BAD_STOREY`, `LEVEL_BAD_ROOF`), each storey's ramps and daises (as
 * format 1 checks them), its flights of stairs to the storey above (`LEVEL_BAD_FLIGHT`), its doors and windows
 * (openings.ts) and the rooms (rooms.ts); compile.ts's `compileStoreys` turns them into the compiled data (types.ts).
 * `storeyView(level, index)` makes one storey read as a format-1 level, for navigation, drawing and ladders.
 *
 * Heights: each storey's glyphs stand on its `base`, so a gallery is 1 m over its storey's floor; a `full` glyph (a
 * wall, a pillar) rises to the floor of the storey above, or under a pitched roof to the roof's underside
 * (roofs.ts); the top storey's full glyphs rise to its ceiling. A storey's floor slab fills the gap under its base
 * (0.3 m under the lowest), under every tile but void ones; a flight rises from its storey's floor to the floor of the
 * storey above, toward the one side where that floor meets it, the tiles over it void (the stairwell). A storey under
 * a gable or a hip may give no height (an attic: its eaves on its floor); its height is the ridge's underside over
 * its floor either way.
 *
 * Colliders, all in `world` (engine/sim/levelBodies.ts): storey by storey, bottom first, its slabs (merged by surface),
 * its glyphs' colliders (as format 1 makes them, from its floor), its heads (a solid from each opening's head or low
 * ceiling up to the full top); then the roof's planes. Each holds its `storey`, and `part` for slabs, heads and roofs.
 *
 * Invariants: pure functions of the text and the legend; lists come in a fixed order (storeys bottom first; within
 * each, as format 1 orders them), so the same text gives the same data and hash, in Node and in a page.
 *
 * @example
 * import { compileLevel } from './compile';
 * const text = '---\nstorey: ground\nbase: 0\nheight: 2.7\n---\n#####\n#<..#\n#####\n---\nstorey: upper\nbase: 3\nheight: 2.7\n---\n#####\n#~..#\n#####\n';
 * const level = compileLevel(text, { file: 'two.txt' });
 * [level.format, level.storeys!.map((s) => s.name), level.storeys![0].ramps[0].top]; // ['my3dge-level/2', ['ground', 'upper'], 3]
 * storeyView(level, 1).floor[7]; // 3: the upper storey's floor
 * @see engine/world/level/storeys.test.ts
 */
import { codeError } from '../../core/log';
import { freezeValue } from '../../core/schema';
import type { Glyph } from './glyph';
import { byText, glyphsOf, holds, type TileGrid } from './grid';
import { findOpenings } from './openings';
import type { ParsedLevel, ParsedStorey } from './parse';
import { levelProblem, where, type LevelProblem } from './problems';
import { findBlocks } from './rects';
import { makeRoof, ROOF_SURFACE } from './roofs';
import { findRooms } from './rooms';
import { findDaises, findRamps, outside, SIDES } from './shapes';
import {
  LEVEL_FORMAT,
  type CompiledLevel,
  type DaisDescriptor,
  type OpeningDescriptor,
  type RampDescriptor,
  type RoofDescriptor,
  type RoomDescriptor,
} from './types';

/** The floor slab under the lowest storey (m). */
export const LOWEST_SLAB = 0.3;

/** One storey, checked: its numbers, its grid and what stands in it, ramps and daises measured from its floor. */
export interface CheckedStorey {
  readonly parsed: ParsedStorey;
  readonly index: number;
  readonly base: number;
  readonly height: number;
  readonly slab: number;
  readonly fullTop: number;
  readonly grid: TileGrid;
  readonly floored: readonly boolean[];
  /** Its ramps and flights, heights from its floor. */
  readonly ramps: readonly RampDescriptor[];
  readonly daises: readonly DaisDescriptor[];
  readonly openings: readonly OpeningDescriptor[];
  readonly roof: RoofDescriptor | null;
}

/** A format-2 level, checked: its storeys and rooms, or the structural problems that stop it. */
export interface CheckedStoreys {
  readonly storeys: readonly CheckedStorey[];
  readonly rooms: readonly RoomDescriptor[];
  readonly roomOf: readonly Int32Array[];
  readonly problems: LevelProblem[];
}

/** A height in metres, to the millimetre, for messages. */
const round = (metres: number) => Math.round(metres * 1000) / 1000;

/** A storey's numbers before its flights are found: from its keys, and its roof. */
interface Heights {
  base: number;
  height: number;
  roof: RoofDescriptor | null;
}

/** The bounds (m) of a grid's floored tiles, `[x0, z0, x1, z1]`, or null when none is. */
function flooredBounds(grid: TileGrid, floored: readonly boolean[]): [number, number, number, number] | null {
  let [c0, r0, c1, r1] = [Infinity, Infinity, -Infinity, -Infinity];
  floored.forEach((yes, i) => {
    if (!yes) return;
    const [c, r] = [i % grid.cols, Math.floor(i / grid.cols)];
    [c0, r0, c1, r1] = [Math.min(c0, c), Math.min(r0, r), Math.max(c1, c), Math.max(r1, r)];
  });
  const t = grid.tile;
  return c1 < 0 ? null : [c0 * t, r0 * t, (c1 + 1) * t, (r1 + 1) * t];
}

/**
 * The flights of `lower` (a flight glyph's filled rectangles) rising `rise` metres to `upper`'s floor, as ramps from
 * the lower floor, and the blocks that make none, each a problem's values.
 */
function findFlights(
  lower: TileGrid,
  upper: { grid: TileGrid; floored: readonly boolean[] } | null,
  rise: number,
  climb: number,
): { ramps: RampDescriptor[]; bad: { glyph: Glyph; first: readonly [number, number]; why: string }[] } {
  const ramps: RampDescriptor[] = [];
  const bad: { glyph: Glyph; first: readonly [number, number]; why: string }[] = [];
  const { cols, rows } = lower;
  for (const glyph of glyphsOf(lower).filter((entry) => entry.floorShape === 'flight')) {
    for (const { first, rect, tiles } of findBlocks(cols, rows, holds(lower, [glyph])).blocks) {
      const [c0, r0, c1, r1] = rect;
      const [w, h] = [c1 - c0 + 1, r1 - r0 + 1];
      if (tiles !== w * h) {
        bad.push({ glyph, first, why: `is not a filled rectangle (${tiles} tiles in a ${w} × ${h} area)` });
        continue;
      }
      if (!upper) {
        bad.push({ glyph, first, why: 'stands on the top storey, with no storey above to rise to' });
        continue;
      }
      let covered: [number, number] | null = null;
      for (let r = r0; r <= r1 && !covered; r++) for (let c = c0; c <= c1 && !covered; c++) if (upper.floored[r * cols + c]) covered = [c, r]; // prettier-ignore
      if (covered) {
        bad.push({ glyph, first, why: `has floor over it on the storey above (column ${covered[0] + 1}, row ${covered[1] + 1} of its map)` }); // prettier-ignore
        continue;
      }
      const meets = (c: number, r: number) => {
        const next = upper.grid.tiles[r * cols + c];
        return upper.floored[r * cols + c] && next.nav.walkable && next.floorShape === 'flat' && Math.abs(next.floor) <= climb; // prettier-ignore
      };
      const sides = SIDES.filter((side) => outside(rect, side, cols, rows).some(([c, r]) => meets(c, r)));
      if (sides.length === 1) {
        ramps.push({ glyph: glyph.id, surface: glyph.surface, tiles: rect, rises: sides[0], bottom: glyph.floor, top: rise }); // prettier-ignore
        continue;
      }
      const why = sides.length
        ? `meets the floor above on ${sides.length} sides (${sides.join(', ')}), so it rises toward none`
        : 'meets the floor above on no side, so it rises toward none';
      bad.push({ glyph, first, why });
    }
  }
  return { ramps, bad };
}

/**
 * The structural problems of a level written as storeys, and its checked storeys and rooms when it has none. `maps`
 * holds each storey's glyphs, row-major, found by validate.ts; `climb` (m) is how near a floor must be to stand at a
 * ramp's or a flight's top.
 */
export function checkStoreys(parsed: ParsedLevel, maps: readonly Glyph[][], climb: number): CheckedStoreys {
  const { file, storeys: written } = parsed;
  const problems: LevelProblem[] = [];
  const none = { storeys: [], rooms: [], roomOf: [], problems };
  const at = (line: number, column: number) => where(file, line, column);
  const storeyProblem = (s: ParsedStorey, problem: string) =>
    problems.push(levelProblem('LEVEL_BAD_STOREY', { at: at(s.line, 1), problem }, s.line, 1));
  const roofProblem = (s: ParsedStorey, why: string) =>
    problems.push(levelProblem('LEVEL_BAD_ROOF', { at: at(s.line, 1), why }, s.line, 1));
  const [first] = written;
  const [cols, rows, tile] = [first.width, first.rows.length, parsed.header.tile];
  const names = new Set<string>();
  written.forEach((s, k) => {
    if (s.name && names.has(s.name)) storeyProblem(s, `the storey ${s.name} is named twice: name each storey once`);
    names.add(s.name);
    if (s.width !== cols || s.rows.length !== rows) {
      storeyProblem(s, `its map is ${s.width} × ${s.rows.length} tiles, the first storey's (${first.name}) ${cols} × ${rows}`); // prettier-ignore
    }
    const { base, height, roof, pitch, ridge, eaves, roofSurface } = s.keys;
    const pitched = roof === 'gable' || roof === 'hip';
    if (base === undefined) storeyProblem(s, "it has no base: give its floor's height (base: 0)");
    if (height === undefined && !pitched) storeyProblem(s, 'it has no height: give its clear height (height: 2.7)');
    if (roof && k < written.length - 1) roofProblem(s, `the storey ${s.name} has a roof, but storeys stand on it`);
    if (pitched && pitch === undefined) roofProblem(s, `a ${roof} roof needs a pitch (pitch: 35)`);
    if (ridge && roof !== 'gable')
      roofProblem(s, 'ridge sets a gable roof’s ridge: give it roof: gable, or leave ridge out');
    if (!roof && (pitch !== undefined || eaves !== undefined || roofSurface !== undefined)) {
      roofProblem(s, 'pitch, eaves and roofSurface describe a roof: give the storey roof: gable, hip or flat');
    }
  });
  if (problems.length) return none;
  const grids = written.map((_, k): TileGrid => ({ cols, rows, tile, tiles: maps[k] }));
  const flooredOf = grids.map((grid) => grid.tiles.map((glyph) => !glyph.void));
  const heights: Heights[] = written.map((s, k) => {
    const base = s.keys.base as number;
    if (!s.keys.roof) return { base, height: s.keys.height as number, roof: null };
    const footprint = flooredBounds(grids[k], flooredOf[k]);
    if (!footprint) {
      roofProblem(s, `the storey ${s.name} has no floor to stand its roof on: every tile of its map is void`);
      return { base, height: s.keys.height ?? 0, roof: null };
    }
    const surface = s.keys.roofSurface ?? ROOF_SURFACE;
    const ceiling = base + (s.keys.height ?? 0);
    const roof = makeRoof(s.keys, { storey: k, base, ceiling, footprint, surface });
    if (roof.kind === 'flat') return { base, height: s.keys.height as number, roof };
    return { base, height: roof.peak - roof.thickness - base, roof };
  });
  heights.forEach(({ base }, k) => {
    if (k === 0) return;
    const below = heights[k - 1];
    const ceiling = below.base + below.height;
    if (!(base > ceiling + 1e-9)) {
      storeyProblem(written[k], `its base, ${base} m, is not above the ceiling of the storey below (${written[k - 1].name}: ${round(ceiling)} m): the gap between them is this storey's floor slab`); // prettier-ignore
    }
  });
  if (problems.length) return none;
  const storeys = written.map((s, k): CheckedStorey => {
    const { base, height, roof } = heights[k];
    const above = heights[k + 1];
    const slab = k === 0 ? LOWEST_SLAB : base - (heights[k - 1].base + heights[k - 1].height);
    const fullTop = above ? above.base : roof?.kind === 'flat' || !roof ? base + height : roof.peak;
    const { ramps, problems: badRamps } = findRamps(grids[k], climb);
    const { daises, problems: badDaises } = findDaises(grids[k]);
    for (const bad of [...badRamps, ...badDaises]) {
      const [line, column] = [s.firstLine + bad.first[1], bad.first[0] + 1];
      const { char, id, top, edge } = bad.glyph;
      const values = { at: at(line, column), char, glyph: id, why: bad.why, top, edge };
      problems.push(levelProblem(bad.shape === 'ramp' ? 'LEVEL_BAD_RAMP' : 'LEVEL_BAD_DAIS', values, line, column));
    }
    const upper = above ? { grid: grids[k + 1], floored: flooredOf[k + 1] } : null;
    const flights = findFlights(grids[k], upper, above ? above.base - base : 0, climb);
    for (const bad of flights.bad) {
      const [line, column] = [s.firstLine + bad.first[1], bad.first[0] + 1];
      const values = { at: at(line, column), char: bad.glyph.char, glyph: bad.glyph.id, why: bad.why };
      problems.push(levelProblem('LEVEL_BAD_FLIGHT', values, line, column));
    }
    const found = findOpenings(grids[k], { index: k, base });
    for (const bad of found.problems) {
      const [line, column] = [s.firstLine + bad.first[1], bad.first[0] + 1];
      const values = { at: at(line, column), char: bad.glyph.char, why: bad.why, kind: bad.glyph.opening };
      problems.push(levelProblem('LEVEL_BAD_OPENING', values, line, column));
    }
    const allRamps = [...ramps, ...flights.ramps].sort((a, b) => byText(a.glyph, b.glyph));
    return { parsed: s, index: k, base, height, slab, fullTop, grid: grids[k], floored: flooredOf[k], ramps: allRamps, daises, openings: found.openings, roof }; // prettier-ignore
  });
  const found = findRooms(storeys.map(({ grid, floored, base }) => ({ grid, floored, base })));
  for (const bad of found.problems) {
    const s = written[bad.storey];
    const [line, column] = [s.firstLine + bad.at[1], bad.at[0] + 1];
    problems.push(levelProblem('LEVEL_BAD_ROOM', { at: at(line, column), why: bad.why }, line, column));
  }
  if (problems.length) return none;
  return { storeys, rooms: found.rooms, roomOf: found.roomOf, problems };
}

/**
 * Storey `index` of `level` read as a format-1 level: its grids, ramps, daises, meshes, colliders, spawns and lights,
 * with `base`, `fullTop` and its roof for the height queries (heights.ts), so navigation, drawing and ladders read any
 * storey as they read a level. A format-1 level is its own storey 0. Throws `LEVEL_NO_STOREY` for another index.
 */
export function storeyView(level: CompiledLevel, index: number): CompiledLevel {
  const s = level.storeys?.[index];
  if (!s) {
    if (!level.storeys && index === 0) return level;
    const count = level.storeys?.length ?? 1;
    const values = { level: level.name, count: `${count} storey${count === 1 ? '' : 's'}`, index, last: count - 1 };
    throw codeError('LEVEL_NO_STOREY', values);
  }
  const t = level.tile;
  return freezeValue({
    format: LEVEL_FORMAT,
    name: level.name,
    description: level.description,
    tile: t,
    cols: level.cols,
    rows: level.rows,
    map: s.map,
    legend: level.legend,
    tiles: s.tiles,
    solid: s.solid,
    walkable: s.walkable,
    floor: s.floor,
    top: s.top,
    bounds: { min: [0, s.base - s.slab, 0], max: [level.cols * t, Math.max(s.fullTop, ...s.top), level.rows * t] },
    ground: level.ground,
    colliders: level.colliders.filter((part) => part.storey === index),
    ramps: s.ramps,
    daises: s.daises,
    meshes: s.meshes,
    spawns: level.spawns.filter((spawn) => spawn.storey === index),
    lights: level.lights.filter((light) => light.storey === index),
    roofs: level.roofs?.filter((roof) => roof.storey === index),
    base: s.base,
    fullTop: s.fullTop,
  } satisfies CompiledLevel);
}
