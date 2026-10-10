/**
 * @file Level validation (PLAN.md WP 2.2, §8.6, I-22): every problem a level's text has, each at its line and column
 * with its fix in the level's terms. `checkLevel` finds the structural ones, which `compileLevel` refuses: the text's
 * own (parse.ts: front matter, no map, ragged rows), characters the legend lacks (`LEVEL_UNKNOWN_GLYPH`) and blocks
 * that do not fill whole footprint squares (`LEVEL_BAD_BLOCK`, a pillar that is not PP over PP). `validateLevel` adds
 * the content checks the QA family (`node x qa level`) runs: spawns nobody can reach (`LEVEL_UNREACHABLE_SPAWN`) and
 * walkable areas cut off from the main floor (`LEVEL_UNREACHABLE_AREA`).
 *
 * Reachability: bodies walk between the 4 neighbouring walkable tiles whose floors differ by at most the climb limit
 * (`NAV_CLIMB`, the prototype crowd's 3.5 units: 0.219 m; PLAN.md Appendix C), so diagonal moves, which never cut
 * corners, connect nothing more. The main floor is the largest such area (the first in reading order on a tie). A
 * spawn on a tile that is not walkable, or outside the main floor, is unreachable; every other cut-off area is
 * reported once, at its first tile. WP 4.2 adds stairs, whose climbs are one-way.
 *
 * Invariants: problems come in a fixed order (the text's; unknown characters by first tile; bad blocks by glyph id,
 * then reading order; unreachable spawns, then cut-off areas, in reading order), each unknown character once, so the
 * same text gives the same list.
 *
 * @example
 * const problems = validateLevel('#######\n#@#...#\n#######\n', { file: 'cell.txt' });
 * problems.map((p) => p.code); // ['LEVEL_UNREACHABLE_SPAWN']: the main floor is the 3 tiles east of the wall
 * validateLevel('###\n#X#\n###\n')[0].message; // '[LEVEL_UNKNOWN_GLYPH] level:2:2: "X" is not in the legend (1 tile): …'
 * @see engine/world/level/validate.test.ts
 */
import type { Registry } from '../../core/registry';
import { legendOf, type Glyph } from './glyph';
import { parseLevel, type ParsedLevel } from './parse';
import { levelProblem, where, type LevelProblem } from './problems';
import { findBlocks } from './rects';

/** The default climb limit between neighbouring tiles' floors (m): the prototype's `CLIMB`, 3.5 units. */
export const NAV_CLIMB = 3.5 / 16;

/** Where a level comes from, for messages, and the legend to read it with. */
export interface LevelSource {
  /** The level's file, as messages name it (`fixtures/levels/room.txt`); `level` by default. */
  file?: string;
  /** The registry whose glyphs are the legend; the shared one by default. */
  registry?: Registry;
}

/** A level read against its legend: the parsed text, the glyph of every tile, and the structural problems. */
export interface CheckedLevel {
  parsed: ParsedLevel;
  /** Each tile's glyph, row-major; empty when the text has structural problems. */
  glyphs: Glyph[];
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

/** The structural problems of a level's text: the text's own, unknown characters and bad footprint blocks. */
export function checkLevel(text: string, source: LevelSource = {}): CheckedLevel {
  const parsed = parseLevel(text, { file: source.file });
  const problems = [...parsed.problems];
  if (parsed.rows.length === 0) return { parsed, glyphs: [], problems };
  const legend = legendOf(source.registry);
  const { rows, firstLine, width: cols, file } = parsed;
  const unknown = new Map<string, { line: number; column: number; count: number }>();
  const glyphs: Glyph[] = [];
  rows.forEach((row, r) =>
    row.forEach((char, c) => {
      const glyph = legend.get(char);
      if (glyph) return void glyphs.push(glyph);
      const seen = unknown.get(char);
      if (seen) seen.count++;
      else unknown.set(char, { line: firstLine + r, column: c + 1, count: 1 });
    }),
  );
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
  if (problems.length) return { parsed, glyphs: [], problems };
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
  return { parsed, glyphs: problems.length ? [] : glyphs, problems };
}

/**
 * Every problem of a level's text, structural and content (see the file comment), in a fixed order; `[]` when it
 * is fine. Never throws. `climb` is the largest floor step between neighbouring tiles that bodies walk (m).
 */
export function validateLevel(text: string, source: LevelSource & { climb?: number } = {}): LevelProblem[] {
  const { parsed, glyphs, problems } = checkLevel(text, source);
  if (problems.length) return problems;
  const climb = source.climb ?? NAV_CLIMB;
  const { rows, firstLine, width: cols, file } = parsed;
  const walkable = (c: number, r: number) => glyphs[r * cols + c].nav.walkable;
  const step = (c: number, r: number, c2: number, r2: number) =>
    Math.abs(glyphs[r * cols + c].floor - glyphs[r2 * cols + c2].floor) <= climb;
  const { blocks, blockOf } = findBlocks(cols, rows.length, walkable, step);
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
