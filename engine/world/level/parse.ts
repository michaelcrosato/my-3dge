/**
 * @file The level text format, read (PLAN.md WP 2.2, WP 13.13, §9.0; doctrine: Agent-accessible assets): optional
 * front matter, then the map, one character per tile, or a map per storey. `parseLevel(text)` returns the header, the
 * map's rows (or the storeys) and the line each row is on, with the problems of the text itself: front matter
 * (`LEVEL_BAD_HEADER`), a storey's block (`LEVEL_BAD_STOREY`), no map (`LEVEL_EMPTY`), rows of different lengths
 * (`LEVEL_RAGGED_ROW`). What the characters mean is the legend's business (validate.ts), and what the storeys' keys
 * mean storeys.ts's.
 *
 * Format 1, as a level file (`labs/box/levels/room.txt`, `fixtures/levels/*.txt`) writes it:
 *
 *     ---
 *     description: A 16 × 12 m room with a pillar.    # front matter: YAML-style key: value lines
 *     tile: 1                                         # metres per character (1 by default)
 *     ---
 *     ################
 *     #..@...........#                                # row 1 is the north edge (z = 0), column 1 the west (x = 0)
 *
 * Format 2 (`fixtures/levels/storeys/*.txt`, docs/PLAYGROUND.md §6.1) writes a map per storey, bottom storey first,
 * each after a block of its own (`ParsedStorey` shows one); the level's front matter, when there is one, comes before
 * them. A fenced block holding a `storey` key opens a storey; the file's first block without one is the front matter.
 *
 * Front matter, as Markdown files write it, is optional; its keys are `description` and `tile`. Values may be quoted
 * ('…' or "…"); `#` after a space starts a comment, as in YAML, and so does a line starting with `#`. Blank lines
 * right after a block and at the end of a map are skipped; any other line is a map row, so a map has no comments (the
 * description holds the prose). A line holding only `---` always fences. Lines end in `\n` or `\r\n`.
 *
 * Invariants: lines count the whole file from 1; columns count code points from 1. A map's width is the length most
 * of its rows share (the first such row's on a tie); every other row is one ragged-row problem. Format 1's result is
 * the same as before format 2 existed. Carried from `my-3d2dge:engine/my-3d2dge.js:2679-2700` (`parseLevel`: rows top
 * first, one character a tile), with the header, positions, storeys and problems added; the prototype padded ragged
 * rows and warned, this names them.
 *
 * @example
 * const parsed = parseLevel('---\ntile: 2\n---\n###\n#.#\n###\n', { file: 'box.txt' });
 * [parsed.header.tile, parsed.width, parsed.rows.length, parsed.firstLine, parsed.format]; // [2, 3, 3, 4, 1]
 * parseLevel('##\n#\n').problems[0].message; // '[LEVEL_RAGGED_ROW] level:2:2: the map is 2 characters wide, but this row is 1: …'
 * const two = parseLevel('---\nstorey: ground\nbase: 0\nheight: 2.7\n---\n###\n#.#\n###\n');
 * [two.format, two.storeys[0].name, two.storeys[0].keys, two.storeys[0].firstLine]; // [2, 'ground', { base: 0, height: 2.7 }, 6]
 * @see engine/world/level/parse.test.ts
 */
import { didYouMean } from '../../core/log';
import { levelProblem, where, type LevelCode, type LevelProblem } from './problems';

/** The front matter's values, defaults filled. */
export interface LevelHeader {
  /** What the level is, in plain sentences ('' when not given). */
  description: string;
  /** Metres per map character: one tile is tile × tile metres. */
  tile: number;
}

/** A storey's keys as its block writes them, absent when not given (engine/world/level/storeys.ts reads them). */
export interface StoreyKeys {
  /** Its floor's height (m). */
  base?: number;
  /** Its clear height, floor to ceiling (m). */
  height?: number;
  /** The roof over it: `'gable'`, `'hip'` or `'flat'` (the top storey's only). */
  roof?: 'gable' | 'hip' | 'flat';
  /** A pitched roof's slope (°). */
  pitch?: number;
  /** The axis a gable's ridge runs along: `'x'` (east to west) or `'z'` (north to south). */
  ridge?: 'x' | 'z';
  /** How far the roof reaches past the storey's walls (m). */
  eaves?: number;
  /** The roof's surface tag (footsteps, particles). */
  roofSurface?: string;
}

/**
 * One storey of a format-2 level, read: its name, keys, map rows and their positions. A storey as a file writes it:
 *
 *     ---
 *     storey: ground          # its name, a word
 *     base: 0                 # its floor's height (m), below 0 for a basement
 *     height: 2.7             # its clear height (m), floor to ceiling
 *     ---
 *     ##########
 *     #........#
 *
 * The top storey's block may also give its roof: `roof` (gable, hip or flat), `pitch` (°), `ridge` (x or z), `eaves`
 * (m) and `roofSurface`.
 */
export interface ParsedStorey {
  /** Its name (`storey: ground`). */
  name: string;
  /** The line of its block's opening fence, from 1. */
  line: number;
  keys: StoreyKeys;
  /** Its map's rows, north first, each an array of its characters (code points). */
  rows: string[][];
  /** The line of the file its first map row is on, from 1. */
  firstLine: number;
  /** Its map's width in characters: the length most rows share. */
  width: number;
}

/** A level's text, read: header, map rows (each an array of characters) or storeys, positions and problems. */
export interface ParsedLevel {
  /** The name used in messages: the file, or `level`. */
  file: string;
  header: LevelHeader;
  /** The map's rows, north first, each an array of its characters (code points); empty in format 2. */
  rows: string[][];
  /** The line of the file the first map row is on, from 1 (format 2: the first storey's). */
  firstLine: number;
  /** The map's width in characters: the length most rows share (format 2: the first storey's). */
  width: number;
  problems: LevelProblem[];
  /** 2 when the text writes storeys, else 1. */
  format: 1 | 2;
  /** The storeys, bottom first (format 2); empty in format 1. */
  storeys: ParsedStorey[];
}

/** The front matter's keys. */
const HEADER_KEYS = ['description', 'tile'] as const;

/** A storey block's keys. */
const STOREY_KEYS = ['storey', 'base', 'height', 'roof', 'pitch', 'ridge', 'eaves', 'roofSurface'] as const;

/** A storey's name, a roof's surface: a word. */
const WORD = /^[A-Za-z0-9_-]+$/;

/** A front-matter fence: a line holding only `---`. */
const isFence = (line: string | undefined) => line !== undefined && line.trimEnd() === '---';

/** A blank line: nothing but whitespace. */
const isBlank = (line: string) => line.trim() === '';

/** A block's key: value line: the key and the rest. */
const KEY_LINE = /^([A-Za-z_][\w-]*)\s*:(.*)$/;

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

/** Says a problem at a line and column (from 1). */
type Bad = (line: number, column: number, problem: string) => void;

/**
 * Reads the key: value lines strictly between `open` and `close` (indexes into `lines`), handing each known key's
 * value to `take` with its line and column (from 1); unknown and repeated keys and broken values go to `bad`.
 */
function readKeys(
  lines: string[],
  open: number,
  close: number,
  keys: readonly string[],
  bad: Bad,
  take: (key: string, value: string, line: number, column: number) => void,
): void {
  const seen = new Set<string>();
  for (let i = open + 1; i < close; i++) {
    const line = lines[i];
    const indent = line.length - line.trimStart().length;
    if (isBlank(line) || line.trimStart().startsWith('#')) continue;
    const match = KEY_LINE.exec(line.trim());
    if (!match) {
      bad(i + 1, indent + 1, `${JSON.stringify(line.trim())} is not a key: value line`);
      continue;
    }
    const [, key, raw] = match;
    const valueColumn = indent + key.length + 2 + (raw.length - raw.trimStart().length);
    const known = keys.includes(key);
    if (!known) bad(i + 1, indent + 1, `unknown key "${key}"${didYouMean(key, keys)}`);
    else if (seen.has(key)) bad(i + 1, indent + 1, `the key "${key}" is given twice`);
    seen.add(key);
    const read = readValue(raw);
    if ('problem' in read) bad(i + 1, valueColumn, read.problem);
    else if (known) take(key, read.value, i + 1, valueColumn);
  }
}

/** The index of the fence closing the block opened at `open`, or −1. */
const closeOf = (lines: string[], open: number) => lines.findIndex((line, i) => i > open && isFence(line));

/** Whether the block opened at `open` (closed at `close`) holds a `storey` key: it opens a storey. */
const opensStorey = (lines: string[], open: number, close: number) =>
  lines.slice(open + 1, close).some((line) => /^\s*storey\s*:/.test(line));

/**
 * A map's rows from `lines[start, end)` with blank lines at both ends skipped, the line its first row is on and its
 * width, with its ragged rows as problems; `LEVEL_EMPTY` at `after` (a line, from 1) when it has none.
 */
function readMap(lines: string[], start: number, end: number, after: number, file: string, problems: LevelProblem[]) {
  while (start < end && isBlank(lines[start])) start++;
  while (end > start && isBlank(lines[end - 1])) end--;
  const rows = lines.slice(start, end).map((line) => Array.from(line));
  const firstLine = start + 1;
  if (rows.length === 0) {
    problems.push(levelProblem('LEVEL_EMPTY', { at: where(file, after, 1) }, after, 1));
    return { rows, firstLine: after, width: 0 };
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
  return { rows, firstLine, width };
}

/** What a storey's numeric keys may hold, as a phrase, and the test. */
const STOREY_NUMBERS: Record<string, readonly [phrase: string, ok: (n: number) => boolean]> = {
  base: ['a number of metres', (n) => Number.isFinite(n)],
  height: ['a number of metres above 0', (n) => n > 0 && n <= 1000],
  pitch: ['a number of degrees above 0 and below 80', (n) => n > 0 && n < 80],
  eaves: ['a number of metres from 0 to 10', (n) => n >= 0 && n <= 10],
};

/** A storey key's value read, or a problem sentence. */
function storeyValue(key: string, value: string): { value: string | number } | { problem: string } {
  const quoted = JSON.stringify(value);
  if (key === 'storey' || key === 'roofSurface') {
    return WORD.test(value) ? { value } : { problem: `${key} is ${quoted}; it must be a word (letters, digits, _ and -)` }; // prettier-ignore
  }
  if (key === 'roof') {
    return ['gable', 'hip', 'flat'].includes(value) ? { value } : { problem: `roof is ${quoted}; it is gable, hip or flat` }; // prettier-ignore
  }
  if (key === 'ridge') {
    return value === 'x' || value === 'z' ? { value } : { problem: `ridge is ${quoted}; it is x (east to west) or z (north to south)` }; // prettier-ignore
  }
  const [phrase, ok] = STOREY_NUMBERS[key];
  const number = value === '' ? NaN : Number(value);
  return ok(number) ? { value: number } : { problem: `${key} is ${quoted}; it must be ${phrase}` };
}

/** The storeys written from line index `start` on, each a block and its map, bottom first. */
function readStoreys(lines: string[], start: number, file: string, problems: LevelProblem[]): ParsedStorey[] {
  const storeys: ParsedStorey[] = [];
  const bad: Bad = (line, column, problem) =>
    problems.push(levelProblem('LEVEL_BAD_STOREY', { at: where(file, line, column), problem }, line, column));
  let open = start;
  while (open < lines.length) {
    const close = closeOf(lines, open);
    if (close < 0) {
      bad(open + 1, 1, 'the storey block opened here is never closed by a line holding only ---');
      break;
    }
    const keys: Record<string, string | number> = {};
    readKeys(lines, open, close, STOREY_KEYS, bad, (key, raw, line, column) => {
      const read = storeyValue(key, raw);
      if ('problem' in read) bad(line, column, read.problem);
      else keys[key] = read.value;
    });
    if (!opensStorey(lines, open, close)) bad(open + 1, 1, 'this block names no storey: give it a storey key (storey: ground)'); // prettier-ignore
    let next = close + 1;
    while (next < lines.length && !isFence(lines[next])) next++;
    const map = readMap(lines, close + 1, next, close + 2, file, problems);
    const { storey: name = '', ...rest } = keys;
    storeys.push({ name: String(name), line: open + 1, keys: rest as StoreyKeys, ...map });
    open = next;
  }
  return storeys;
}

/**
 * Reads a level's text: its front matter, its map rows (or its storeys) and their positions, and the problems of the
 * text itself. `file` names it in messages. Never throws; compile.ts refuses a level with problems.
 */
export function parseLevel(text: string, options: { file?: string } = {}): ParsedLevel {
  const file = options.file ?? 'level';
  const lines = text.split(/\r?\n/);
  const problems: LevelProblem[] = [];
  const header: LevelHeader = { description: '', tile: 1 };
  const badAs =
    (code: LevelCode): Bad =>
    (line, column, problem) =>
      problems.push(levelProblem(code, { at: where(file, line, column), problem }, line, column));
  const bad = badAs('LEVEL_BAD_HEADER');
  const result = (rows: string[][], firstLine: number, width: number, storeys: ParsedStorey[] = []): ParsedLevel => {
    const format = storeys.length ? 2 : 1;
    return { file, header, rows, firstLine, width, problems, format, storeys };
  };
  let start = 0;
  if (isFence(lines[0])) {
    const close = closeOf(lines, 0);
    if (close < 0) {
      bad(1, 1, 'the front matter opened here is never closed by a line holding only ---');
      return result([], 1, 0);
    }
    if (!opensStorey(lines, 0, close)) {
      readKeys(lines, 0, close, HEADER_KEYS, bad, (key, value, line, column) => {
        if (key !== 'tile') return void (header.description = value);
        const tile = value === '' ? NaN : Number(value);
        if (Number.isFinite(tile) && tile > 0) header.tile = tile;
        else bad(line, column, `tile is ${JSON.stringify(value)}; it must be a number of metres above 0`);
      });
      start = close + 1;
    }
  }
  let first = start;
  while (first < lines.length && isBlank(lines[first])) first++;
  if (isFence(lines[first])) {
    const storeys = readStoreys(lines, first, file, problems);
    return storeys.length ? result([], storeys[0].firstLine, storeys[0].width, storeys) : result([], first + 1, 0);
  }
  const map = readMap(lines, start, lines.length, start + 1, file, problems);
  return result(map.rows, map.firstLine, map.width);
}
