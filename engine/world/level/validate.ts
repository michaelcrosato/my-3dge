/**
 * @file Level validation (PLAN.md WP 2.2, WP 4.2, WP 13.13, §8.6, I-22): every problem a level's text has, each at its
 * line and column with its fix in the level's terms. `checkLevel` finds the structural ones, which `compileLevel`
 * refuses: the text's own (parse.ts: front matter, storey blocks, no map, ragged rows), characters the legend lacks
 * (`LEVEL_UNKNOWN_GLYPH`), glyphs only a storey has in a map that writes none (`LEVEL_NEEDS_STOREY`), blocks that do not
 * fill whole footprint squares (`LEVEL_BAD_BLOCK`, a pillar that is not PP over PP), stairs that make no ramp
 * (`LEVEL_BAD_RAMP`) and daises that make no octagon (`LEVEL_BAD_DAIS`; shapes.ts finds both), and for a level
 * written as storeys storeys.ts's (storeys, flights, openings, rooms, roofs). It also returns what compile.ts builds
 * from: the ramps and daises, or the checked storeys. `validateLevel` adds the content checks the QA family (`node x
 * qa level`) runs: spawns nobody can reach (`LEVEL_UNREACHABLE_SPAWN`), walkable areas cut off from the main floor
 * (`LEVEL_UNREACHABLE_AREA`), and in storeys rooms cut off (`LEVEL_UNREACHABLE_ROOM`), doors no wider than a body
 * (`LEVEL_NARROW_DOOR`), floor a crouched body does not fit over (`LEVEL_LOW_HEADROOM`) and flights too steep to walk
 * (`LEVEL_STEEP_FLIGHT`), measured against the shooter model's hull (`LEVEL_BODY`), the largest the engine ships.
 *
 * Reachability (walk.ts): bodies step between the 4 neighbouring walkable tiles where the floor between their centres
 * never rises more than the climb limit at once (`NAV_CLIMB`, the prototype crowd's 3.5 units: 0.219 m; PLAN.md
 * Appendix C), so stairs and a dais's edge are climbed, and a gallery is dropped from but climbed only by its stairs:
 * steps are one-way where floors differ. In storeys, a flight's top links to the floor above it and a ladder to the
 * floor round its top, both ways. An area is a set of tiles that reach each other both ways; the main floor is the
 * largest (the first in reading order on a tie). A spawn or a room marker on a tile that is not walkable, or outside
 * the main floor, is unreachable; every other area is reported once, at its first tile: bodies there cannot walk to
 * the main floor and back.
 *
 * Invariants: problems come in a fixed order (the text's; unknown characters by first tile; glyphs needing a storey by
 * id; bad blocks by storey, then glyph id, then reading order; bad ramps, then bad daises, by glyph id, then reading
 * order; then storeys.ts's; unreachable spawns, rooms, then cut-off areas, in reading order; narrow doors; low
 * headroom, one per storey; steep flights), each unknown character once, so the same text gives the same list.
 *
 * @example
 * const problems = validateLevel('#######\n#@#...#\n#######\n', { file: 'cell.txt' });
 * problems.map((p) => p.code); // ['LEVEL_UNREACHABLE_SPAWN']: the main floor is the 3 tiles east of the wall
 * validateLevel('###\n#X#\n###\n')[0].message; // '[LEVEL_UNKNOWN_GLYPH] level:2:2: "X" is not in the legend (1 tile): …'
 * validateLevel('###\n#+#\n###\n')[0].code; // 'LEVEL_NEEDS_STOREY': a door needs a storey
 * @see engine/world/level/validate.test.ts
 */
import type { Registry } from '../../core/registry';
import { legendOf, type Glyph } from './glyph';
import { floorHeight, type HeightSource } from './heights';
import { parseLevel, type ParsedLevel } from './parse';
import { levelProblem, where, type LevelProblem } from './problems';
import { findBlocks } from './rects';
import { roofUnder } from './roofs';
import { findDaises, findRamps, type ShapeProblem } from './shapes';
import { checkStoreys, type CheckedStoreys } from './storeys';
import type { DaisDescriptor, RampDescriptor } from './types';
import { walkAreas, walkStoreys } from './walk';

/** The default climb limit between neighbouring tiles' floors (m): the prototype's `CLIMB`, 3.5 units. */
export const NAV_CLIMB = 3.5 / 16;

/**
 * The body format 2's content checks measure against (m): the shooter model's hull (`movement:apex`, 16 Source units
 * in radius: 0.8128 m across; 1.19 m tall crouched), the largest the engine ships.
 */
export const LEVEL_BODY = { width: 0.8128, crouched: 1.19 } as const;

/** The steepest flight of stairs bodies walk (°): the shooter model's walkable slope, 45.57°, rounded down. */
export const FLIGHT_LIMIT = 45;

/** Where a level comes from, for messages, and the legend to read it with. */
export interface LevelSource {
  /** The level's file, as messages name it (`fixtures/levels/room.txt`); `level` by default. */
  file?: string;
  /** The registry whose glyphs are the legend; the shared one by default. */
  registry?: Registry;
}

/** A level read against its legend: the parsed text, the glyph of every tile, its slopes, and the structural problems. */
export interface CheckedLevel {
  parsed: ParsedLevel;
  /** Each tile's glyph, row-major; empty when the text has structural problems or writes storeys. */
  glyphs: Glyph[];
  /** The ramps and daises (engine/world/level/shapes.ts); empty when the text has structural problems or storeys. */
  ramps: RampDescriptor[];
  daises: DaisDescriptor[];
  /** A level written as storeys without structural problems: its checked storeys and rooms (storeys.ts). */
  storeys?: CheckedStoreys;
  problems: LevelProblem[];
}

/** `1 tile`, `3 tiles`. */
const tilesText = (count: number) => `${count} tile${count === 1 ? '' : 's'}`;

/** A character as a message shows it: quoted, or named when it is invisible. */
function showChar(char: string): string {
  if (char === ' ') return 'a space';
  if (char === '\t') return 'a tab';
  if (/^\p{Cc}$/u.test(char)) return `the control character U+${char.codePointAt(0)?.toString(16).padStart(4, '0')}`;
  return JSON.stringify(char);
}

/** A map as checkLevel reads it: its rows, the line its first row is on, and its width. */
type MapRows = Pick<ParsedLevel, 'rows' | 'firstLine' | 'width'>;

/** Each map's glyphs, row-major, with one `LEVEL_UNKNOWN_GLYPH` per character the legend lacks, at its first tile. */
function readGlyphs(maps: readonly MapRows[], legend: Map<string, Glyph>, file: string, problems: LevelProblem[]) {
  const unknown = new Map<string, { line: number; column: number; count: number }>();
  const glyphs = maps.map(({ rows, firstLine }) => {
    const found: Glyph[] = [];
    rows.forEach((row, r) =>
      row.forEach((char, c) => {
        const glyph = legend.get(char);
        if (glyph) return void found.push(glyph);
        const seen = unknown.get(char);
        if (seen) seen.count++;
        else unknown.set(char, { line: firstLine + r, column: c + 1, count: 1 });
      }),
    );
    return found;
  });
  const chars = [...legend.keys()].sort();
  for (const [char, { line, column, count }] of unknown) {
    const near = chars.filter((option) => option !== char && option.toLowerCase() === char.toLowerCase());
    const values = {
      at: where(file, line, column),
      shown: showChar(char),
      count: tilesText(count),
      suggestion: near.length ? ` (did you mean "${near[0]}"?)` : '',
      chars: chars.join(' '),
      quoted: char === "'" ? `"'"` : JSON.stringify(char).replace(/^"|"$/g, "'"),
    };
    problems.push(levelProblem('LEVEL_UNKNOWN_GLYPH', values, line, column));
  }
  return glyphs;
}

/** What only a storey has, said of a glyph, or '' for a glyph any level may use. */
function storeyOnly(glyph: Glyph): string {
  if (glyph.void) return 'is void';
  if (glyph.opening !== 'none') return `is a ${glyph.opening}`;
  if (glyph.floorShape === 'flight') return 'is a flight of stairs to the storey above';
  if (glyph.room) return `marks the room ${glyph.room}`;
  if (glyph.head > 0) return `has a head ${glyph.head} m up`;
  return '';
}

/** `LEVEL_NEEDS_STOREY` for each glyph of a format-1 map that only a storey has, by id, at its first tile. */
function needsStorey(glyphs: readonly Glyph[], map: MapRows, file: string, problems: LevelProblem[]): void {
  const used = [...new Set(glyphs)].filter((glyph) => storeyOnly(glyph)).sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const glyph of used) {
    const i = glyphs.indexOf(glyph);
    const [line, column] = [map.firstLine + Math.floor(i / map.width), (i % map.width) + 1];
    const values = { at: where(file, line, column), char: glyph.char, glyph: glyph.id, why: storeyOnly(glyph) };
    problems.push(levelProblem('LEVEL_NEEDS_STOREY', values, line, column));
  }
}

/** `LEVEL_BAD_BLOCK` for each block of a footprint glyph that does not fill whole footprint squares. */
function badBlocks(glyphs: readonly Glyph[], map: MapRows, file: string, problems: LevelProblem[]): void {
  const { width: cols, rows, firstLine } = map;
  const used = [...new Set(glyphs)].filter((glyph) => glyph.footprint > 1).sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const glyph of used) {
    const n = glyph.footprint;
    const { blocks } = findBlocks(cols, rows.length, (c, r) => glyphs[r * cols + c] === glyph);
    for (const { first, rect, tiles } of blocks) {
      const [w, h] = [rect[2] - rect[0] + 1, rect[3] - rect[1] + 1];
      if (tiles === w * h && w % n === 0 && h % n === 0) continue;
      const [line, column] = [firstLine + first[1], first[0] + 1];
      const shape =
        tiles === w * h ? `is ${w} × ${h} tiles` : `is not a filled rectangle (${tiles} tiles in a ${w} × ${h} area)`;
      const values = { at: where(file, line, column), char: glyph.char, shape, n, glyph: glyph.id };
      problems.push(levelProblem('LEVEL_BAD_BLOCK', values, line, column));
    }
  }
}

/** The structural problems of a level's text: the text's own, unknown characters and bad footprint blocks. */
export function checkLevel(text: string, source: LevelSource = {}): CheckedLevel {
  const parsed = parseLevel(text, { file: source.file });
  const problems = [...parsed.problems];
  const none = { ramps: [], daises: [] };
  const maps: readonly MapRows[] = parsed.format === 2 ? parsed.storeys : [parsed];
  if (maps.every((map) => map.rows.length === 0)) return { parsed, glyphs: [], ...none, problems };
  const { file } = parsed;
  const glyphMaps = readGlyphs(maps, legendOf(source.registry), file, problems);
  if (problems.length) return { parsed, glyphs: [], ...none, problems };
  if (parsed.format === 1) needsStorey(glyphMaps[0], parsed, file, problems);
  maps.forEach((map, k) => badBlocks(glyphMaps[k], map, file, problems));
  if (parsed.format === 2) {
    if (problems.length) return { parsed, glyphs: [], ...none, problems };
    const storeys = checkStoreys(parsed, glyphMaps, NAV_CLIMB);
    if (storeys.problems.length) return { parsed, glyphs: [], ...none, problems: storeys.problems };
    return { parsed, glyphs: [], ...none, storeys, problems };
  }
  const [glyphs] = glyphMaps;
  const { rows, width: cols, firstLine } = parsed;
  const grid = { cols, rows: rows.length, tile: parsed.header.tile, tiles: glyphs };
  const { ramps, problems: badRamps } = findRamps(grid, NAV_CLIMB);
  const { daises, problems: badDaises } = findDaises(grid);
  for (const bad of [...badRamps, ...badDaises]) problems.push(shapeProblem(bad, file, firstLine));
  return problems.length ? { parsed, glyphs: [], ...none, problems } : { parsed, glyphs, ramps, daises, problems };
}

/** A ramp or dais block that makes none, as a problem at its first tile. */
function shapeProblem(bad: ShapeProblem, file: string, firstLine: number): LevelProblem {
  const [line, column] = [firstLine + bad.first[1], bad.first[0] + 1];
  const { char, id, top, edge } = bad.glyph;
  const values = { at: where(file, line, column), char, glyph: id, why: bad.why, top, edge };
  return levelProblem(bad.shape === 'ramp' ? 'LEVEL_BAD_RAMP' : 'LEVEL_BAD_DAIS', values, line, column);
}

/**
 * Every problem of a level's text, structural and content (see the file comment), in a fixed order; `[]` when it
 * is fine. Never throws. `climb` is the largest floor step between neighbouring tiles that bodies walk (m).
 */
export function validateLevel(text: string, source: LevelSource & { climb?: number } = {}): LevelProblem[] {
  const { parsed, glyphs, ramps, daises, storeys, problems } = checkLevel(text, source);
  if (problems.length) return problems;
  const climb = source.climb ?? NAV_CLIMB;
  if (storeys) return validateStoreys(parsed, storeys, climb);
  const { rows, firstLine, width: cols, file } = parsed;
  const legend: Record<string, Glyph> = {};
  for (const glyph of glyphs) legend[glyph.char] ??= glyph;
  const tiles = glyphs.map((glyph) => glyph.char);
  const level: HeightSource = { tile: parsed.header.tile, cols, rows: rows.length, tiles, legend, ramps, daises };
  const { areas: blocks, areaOf: blockOf } = walkAreas(level, climb);
  let main = -1;
  blocks.forEach((block, i) => {
    if (main < 0 || block.tiles > blocks[main].tiles) main = i;
  });
  const mainTiles = tilesText(main < 0 ? 0 : blocks[main].tiles);
  const holdsSpawn = new Set<number>();
  glyphs.forEach((glyph, i) => {
    if (!glyph.spawn) return;
    const [c, r] = [i % cols, Math.floor(i / cols)];
    const [line, column] = [firstLine + r, c + 1];
    const block = blockOf[i];
    if (block === main && block >= 0) return;
    holdsSpawn.add(block);
    const why =
      block < 0
        ? `stands on a tile nobody walks on (${glyph.id} is not walkable)`
        : `is cut off from the main floor (its area has ${tilesText(blocks[block].tiles)}, the main floor ${mainTiles})`;
    const values = { at: where(file, line, column), spawn: `spawn:${glyph.spawn}`, char: glyph.char, why };
    problems.push(levelProblem('LEVEL_UNREACHABLE_SPAWN', values, line, column));
  });
  blocks.forEach((block, i) => {
    if (i === main || holdsSpawn.has(i)) return;
    const [line, column] = [firstLine + block.first[1], block.first[0] + 1];
    const values = { at: where(file, line, column), count: tilesText(block.tiles), main: mainTiles };
    problems.push(levelProblem('LEVEL_UNREACHABLE_AREA', values, line, column));
  });
  return problems;
}

/** The index of a ramp's first tile in a grid `cols` wide. */
const ramp0 = (ramp: RampDescriptor, cols: number) => ramp.tiles[1] * cols + ramp.tiles[0];

/** The content problems of a level written as storeys: reach, rooms, doors, headroom and flights. */
function validateStoreys(parsed: ParsedLevel, checked: CheckedStoreys, climb: number): LevelProblem[] {
  const problems: LevelProblem[] = [];
  const { storeys, rooms } = checked;
  const { file } = parsed;
  const { cols, rows, tile: t } = storeys[0].grid;
  const n = cols * rows;
  const legend: Record<string, Glyph> = {};
  for (const s of storeys) for (const glyph of s.grid.tiles) legend[glyph.char] ??= glyph;
  const sources: HeightSource[] = storeys.map((s) => ({
    tile: t,
    cols,
    rows,
    tiles: s.grid.tiles.map((glyph) => glyph.char),
    legend,
    ramps: s.ramps,
    daises: s.daises,
  }));
  const at = (k: number, i: number) => {
    const [line, column] = [storeys[k].parsed.firstLine + Math.floor(i / cols), (i % cols) + 1];
    return { at: where(file, line, column), line, column };
  };
  const links: [number, number][] = [];
  storeys.forEach((s, k) => {
    const above = storeys[k + 1];
    if (!above) return;
    const open = (i: number) => above.floored[i] && above.grid.tiles[i].nav.walkable;
    for (const ramp of s.ramps.filter((each) => legend[s.grid.tiles[ramp0(each, cols)].char].floorShape === 'flight')) {
      const [c0, r0, c1, r1] = ramp.tiles;
      const edge: [number, number, number, number][] =
        ramp.rises === 'north' || ramp.rises === 'south'
          ? Array.from({ length: c1 - c0 + 1 }, (_, j) => (ramp.rises === 'north' ? [c0 + j, r0, c0 + j, r0 - 1] : [c0 + j, r1, c0 + j, r1 + 1])) // prettier-ignore
          : Array.from({ length: r1 - r0 + 1 }, (_, j) => (ramp.rises === 'west' ? [c0, r0 + j, c0 - 1, r0 + j] : [c1, r0 + j, c1 + 1, r0 + j])); // prettier-ignore
      for (const [c, r, oc, or] of edge) if (open(or * cols + oc)) links.push([k * n + r * cols + c, (k + 1) * n + or * cols + oc]); // prettier-ignore
    }
    s.grid.tiles.forEach((glyph, i) => {
      if (!glyph.ladder) return;
      const [c, r] = [i % cols, Math.floor(i / cols)];
      for (const [dc, dr] of [
        [0, 0],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const [nc, nr] = [c + dc, r + dr];
        if (nc >= 0 && nr >= 0 && nc < cols && nr < rows && open(nr * cols + nc)) links.push([k * n + i, (k + 1) * n + nr * cols + nc]); // prettier-ignore
      }
    });
  });
  const { areas, areaOf } = walkStoreys(sources, links, climb);
  let main = -1;
  areas.forEach((area, i) => {
    if (main < 0 || area.tiles > areas[main].tiles) main = i;
  });
  const mainTiles = tilesText(main < 0 ? 0 : areas[main].tiles);
  const held = new Set<number>();
  storeys.forEach((s, k) =>
    s.grid.tiles.forEach((glyph, i) => {
      const area = areaOf[k * n + i];
      if (!glyph.spawn || (area === main && area >= 0)) return;
      held.add(area);
      const why =
        area < 0
          ? `stands on a tile nobody walks on (${glyph.id} is not walkable)`
          : `is cut off from the main floor (its area has ${tilesText(areas[area].tiles)}, the main floor ${mainTiles})`;
      const { at: where_, line, column } = at(k, i);
      const values = { at: where_, spawn: `spawn:${glyph.spawn}`, char: glyph.char, why };
      problems.push(levelProblem('LEVEL_UNREACHABLE_SPAWN', values, line, column));
    }),
  );
  for (const room of rooms) {
    const i = room.marker[1] * cols + room.marker[0];
    const area = areaOf[room.storey * n + i];
    if (area === main && area >= 0) continue;
    held.add(area);
    const { at: where_, line, column } = at(room.storey, i);
    const count = tilesText(area < 0 ? 0 : areas[area].tiles);
    problems.push(levelProblem('LEVEL_UNREACHABLE_ROOM', { at: where_, room: room.name, count, main: mainTiles }, line, column)); // prettier-ignore
  }
  areas.forEach((area, i) => {
    if (i === main || held.has(i)) return;
    const [k, c, r] = area.first;
    const { at: where_, line, column } = at(k, r * cols + c);
    problems.push(levelProblem('LEVEL_UNREACHABLE_AREA', { at: where_, count: tilesText(area.tiles), main: mainTiles }, line, column)); // prettier-ignore
  });
  for (const opening of storeys.flatMap((s) => s.openings)) {
    if (opening.kind !== 'door' || opening.width > LEVEL_BODY.width) continue;
    const { at: where_, line, column } = at(opening.storey, opening.tiles[1] * cols + opening.tiles[0]);
    const values = { at: where_, width: opening.width, body: LEVEL_BODY.width, need: Math.floor(LEVEL_BODY.width / t) + 1 }; // prettier-ignore
    problems.push(levelProblem('LEVEL_NARROW_DOOR', values, line, column));
  }
  storeys.forEach((s, k) => {
    let [count, first, lowest] = [0, -1, Infinity];
    s.grid.tiles.forEach((glyph, i) => {
      if (!glyph.nav.walkable || !s.floored[i]) return;
      const [x, z] = [((i % cols) + 0.5) * t, (Math.floor(i / cols) + 0.5) * t];
      let ceiling = glyph.head > 0 ? s.base + glyph.head : Infinity;
      const over = storeys.slice(k + 1).find((up) => up.floored[i]);
      if (over) ceiling = Math.min(ceiling, over.base - over.slab);
      if (s.roof) ceiling = Math.min(ceiling, roofUnder(s.roof, x, z));
      const room = ceiling - (s.base + floorHeight(sources[k], x, z));
      if (!(room < LEVEL_BODY.crouched - 1e-9)) return;
      [count, first, lowest] = [count + 1, first < 0 ? i : first, Math.min(lowest, room)];
    });
    if (!count) return;
    const { at: where_, line, column } = at(k, first);
    const values = { at: where_, count: tilesText(count), headroom: Math.round(lowest * 1000) / 1000, body: LEVEL_BODY.crouched }; // prettier-ignore
    problems.push(levelProblem('LEVEL_LOW_HEADROOM', values, line, column));
  });
  storeys.forEach((s, k) => {
    for (const ramp of s.ramps.filter((each) => legend[s.grid.tiles[ramp0(each, cols)].char].floorShape === 'flight')) {
      const [c0, r0, c1, r1] = ramp.tiles;
      const rise = ramp.top - ramp.bottom;
      const run = (ramp.rises === 'north' || ramp.rises === 'south' ? r1 - r0 + 1 : c1 - c0 + 1) * t;
      const angle = (Math.atan2(rise, run) * 180) / Math.PI;
      if (!(angle > FLIGHT_LIMIT + 1e-9)) continue;
      const { at: where_, line, column } = at(k, r0 * cols + c0);
      const values = { at: where_, rise, run, angle: Math.round(angle * 10) / 10, limit: FLIGHT_LIMIT, need: Math.ceil(rise / t - 1e-9) }; // prettier-ignore
      problems.push(levelProblem('LEVEL_STEEP_FLIGHT', values, line, column));
    }
  });
  return problems;
}
