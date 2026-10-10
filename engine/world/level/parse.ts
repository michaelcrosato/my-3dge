/**
 * @file The level text format, read (PLAN.md WP 2.2, §9.0; doctrine: Agent-accessible assets): optional front matter,
 * then the map, one character per tile. `parseLevel(text)` returns the header, the map's rows and the line each row
 * is on, with the problems of the text itself: front matter (`LEVEL_BAD_HEADER`), no map (`LEVEL_EMPTY`), rows of
 * different lengths (`LEVEL_RAGGED_ROW`). What the characters mean is the legend's business (validate.ts).
 *
 * The format, as a level file (`labs/box/levels/room.txt`, `fixtures/levels/*.txt`) writes it:
 *
 *     ---
 *     description: A 16 × 12 m room with a pillar.    # front matter: YAML-style key: value lines
 *     tile: 1                                         # metres per character (1 by default)
 *     ---
 *     ################
 *     #..@...........#                                # row 1 is the north edge (z = 0), column 1 the west (x = 0)
 *
 * Front matter, as Markdown files write it, is optional; its keys are `description` and `tile`. Values may be quoted
 * ('…' or "…"); `#` after a space starts a comment, as in YAML, and so does a line starting with `#`. Blank lines
 * right after the front matter and at the end of the file are skipped; any other line is a map row, so the map has no
 * comments (the description holds the prose). Lines end in `\n` or `\r\n`.
 *
 * Invariants: lines count the whole file from 1; columns count code points from 1. The map's width is the length most
 * rows share (the first such row's on a tie); every other row is one ragged-row problem.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:2679-2700` (`parseLevel`: rows top first, one character a tile), with
 * the header, positions and problems added; the prototype padded ragged rows and warned, this names them.
 *
 * @example
 * const parsed = parseLevel('---\ntile: 2\n---\n###\n#.#\n###\n', { file: 'box.txt' });
 * [parsed.header.tile, parsed.width, parsed.rows.length, parsed.firstLine]; // [2, 3, 3, 4]
 * parseLevel('##\n#\n').problems[0].message; // '[LEVEL_RAGGED_ROW] level:2:2: the map is 2 characters wide, but this row is 1: …'
 * @see engine/world/level/parse.test.ts
 */
import { didYouMean } from '../../core/log';
import { levelProblem, where, type LevelProblem } from './problems';

/** The front matter's values, defaults filled. */
export interface LevelHeader {
  /** What the level is, in plain sentences ('' when not given). */
  description: string;
  /** Metres per map character: one tile is tile × tile metres. */
  tile: number;
}

/** A level's text, read: header, map rows (each an array of characters), positions and problems. */
export interface ParsedLevel {
  /** The name used in messages: the file, or `level`. */
  file: string;
  header: LevelHeader;
  /** The map's rows, north first, each an array of its characters (code points). */
  rows: string[][];
  /** The line of the file the first map row is on, from 1. */
  firstLine: number;
  /** The map's width in characters: the length most rows share. */
  width: number;
  problems: LevelProblem[];
}

/** The front matter's keys. */
const HEADER_KEYS = ['description', 'tile'] as const;

/** A front-matter fence: a line holding only `---`. */
const isFence = (line: string | undefined) => line !== undefined && line.trimEnd() === '---';

/** A blank line: nothing but whitespace. */
const isBlank = (line: string) => line.trim() === '';

/** A value with its quotes and trailing comment removed, or a problem sentence when its quotes are broken. */
function readValue(raw: string): { value: string } | { problem: string } {
  const text = raw.trim();
  const quote = text[0];
  if (quote === '"' || quote === "'") {
    let end = 1;
    let value = '';
    for (; end < text.length; end++) {
      const ch = text[end];
      if (quote === "'" && ch === "'" && text[end + 1] === "'") value += text[++end];
      else if (quote === '"' && ch === '\\' && end + 1 < text.length) value += text[++end];
      else if (ch === quote) break;
      else value += ch;
    }
    if (end >= text.length) return { problem: `the value ${text} has no closing ${quote}` };
    const rest = text.slice(end + 1).trim();
    if (rest && !rest.startsWith('#')) return { problem: `${rest} follows the quoted value; put it inside the quotes` };
    return { value };
  }
  const comment = text.search(/\s#/);
  return { value: (comment < 0 ? text : text.slice(0, comment)).trim() };
}

/**
 * Reads a level's text: its front matter, its map rows and their positions, and the problems of the text itself.
 * `file` names it in messages. Never throws; compile.ts refuses a level with problems.
 */
export function parseLevel(text: string, options: { file?: string } = {}): ParsedLevel {
  const file = options.file ?? 'level';
  const lines = text.split(/\r?\n/);
  const problems: LevelProblem[] = [];
  const header: LevelHeader = { description: '', tile: 1 };
  const bad = (line: number, column: number, problem: string) =>
    problems.push(levelProblem('LEVEL_BAD_HEADER', { at: where(file, line, column), problem }, line, column));
  let start = 0;
  if (isFence(lines[0])) {
    const close = lines.findIndex((line, i) => i > 0 && isFence(line));
    if (close < 0) {
      bad(1, 1, 'the front matter opened here is never closed by a line holding only ---');
      return { file, header, rows: [], firstLine: 1, width: 0, problems };
    }
    const seen = new Set<string>();
    for (let i = 1; i < close; i++) {
      const line = lines[i];
      const indent = line.length - line.trimStart().length;
      if (isBlank(line) || line.trimStart().startsWith('#')) continue;
      const match = /^([A-Za-z_][\w-]*)\s*:(.*)$/.exec(line.trim());
      if (!match) {
        bad(i + 1, indent + 1, `${JSON.stringify(line.trim())} is not a key: value line`);
        continue;
      }
      const [, key, raw] = match;
      const valueColumn = indent + key.length + 2 + (raw.length - raw.trimStart().length);
      const known = (HEADER_KEYS as readonly string[]).includes(key);
      if (!known) bad(i + 1, indent + 1, `unknown key "${key}"${didYouMean(key, HEADER_KEYS)}`);
      else if (seen.has(key)) bad(i + 1, indent + 1, `the key "${key}" is given twice`);
      seen.add(key);
      const read = readValue(raw);
      if ('problem' in read) {
        bad(i + 1, valueColumn, read.problem);
        continue;
      }
      if (!known) continue;
      if (key === 'tile') {
        const tile = read.value === '' ? NaN : Number(read.value);
        if (Number.isFinite(tile) && tile > 0) header.tile = tile;
        else bad(i + 1, valueColumn, `tile is ${JSON.stringify(read.value)}; it must be a number of metres above 0`);
      } else {
        header.description = read.value;
      }
    }
    start = close + 1;
  }
  const after = start + 1;
  let end = lines.length;
  while (start < end && isBlank(lines[start])) start++;
  while (end > start && isBlank(lines[end - 1])) end--;
  const rows = lines.slice(start, end).map((line) => Array.from(line));
  const firstLine = start + 1;
  if (rows.length === 0) {
    problems.push(levelProblem('LEVEL_EMPTY', { at: where(file, after, 1) }, after, 1));
    return { file, header, rows, firstLine: after, width: 0, problems };
  }
  const counts = new Map<number, number>();
  for (const row of rows) counts.set(row.length, (counts.get(row.length) ?? 0) + 1);
  let width = rows[0].length;
  for (const row of rows) if ((counts.get(row.length) ?? 0) > (counts.get(width) ?? 0)) width = row.length;
  rows.forEach((row, r) => {
    if (row.length === width) return;
    const line = firstLine + r;
    const column = Math.min(row.length, width) + 1;
    const off = Math.abs(width - row.length);
    const change =
      row.length < width
        ? `add ${off} character${off === 1 ? '' : 's'} to it`
        : `remove ${off} character${off === 1 ? '' : 's'} from it`;
    const values = { at: where(file, line, column), length: row.length, width, change };
    problems.push(levelProblem('LEVEL_RAGGED_ROW', values, line, column));
  });
  return { file, header, rows, firstLine, width, problems };
}
