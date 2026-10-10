/**
 * @file What can be wrong with a level, and how it is said (PLAN.md WP 2.2, §6.8; doctrine: Agent-operable): the
 * level codes, each naming its fix in the level's own terms, and `LevelProblem`, one problem at a line and column of
 * the level's text. engine/world/level/parse.ts and validate.ts find problems; compile.ts refuses a level that has
 * structural ones (`LEVEL_INVALID`, listing them), and `node x qa level` reports them for every level file.
 *
 * A problem's `message` is `[CODE] <file>:<line>:<column>: <what is wrong>: <the fix>`, the form editors and agents
 * jump to. Lines count the whole file from 1, front matter included; columns count characters (code points) from 1.
 *
 * Invariants: `LEVEL_UNREACHABLE_SPAWN` and `LEVEL_UNREACHABLE_AREA` are content checks (`validateLevel`, the QA
 * family); every other code is structural, and `compileLevel` refuses a level that has one.
 *
 * @example
 * const p = levelProblem('LEVEL_EMPTY', { at: 'room.txt:4:1' }, 4, 1);
 * p.message.startsWith('[LEVEL_EMPTY] room.txt:4:1: the level has no map'); // true
 * @see engine/world/level/validate.test.ts
 */
import { codeInfo, defineCodes, fill, type CodeValues } from '../../core/log';

/** The level codes, with their fixes (collected into docs/ERRORS.md by `x docs`). */
export const LEVEL_CODES = defineCodes('level', {
  LEVEL_BAD_HEADER: {
    template: '{at}: {problem}',
    fix: 'write the front matter as key: value lines between two lines holding only ---, before the map; its keys are description (text) and tile (metres per character, above 0)',
    doc: 'Raised by `validateLevel` and `compileLevel` (engine/world/level/parse.ts) for an unknown or repeated key, a bad value, a line that is not `key: value`, or front matter that is never closed.',
  },
  LEVEL_EMPTY: {
    template: '{at}: the level has no map',
    fix: 'write the map after the front matter: one row of legend characters per line, the first row the north edge',
  },
  LEVEL_RAGGED_ROW: {
    template: '{at}: the map is {width} characters wide, but this row is {length}',
    fix: '{change} so every row is {width} characters wide: the map is a rectangle (close its edges with walls, #)',
    doc: 'Raised by `validateLevel` and `compileLevel` (engine/world/level/parse.ts). The map is as wide as most of its rows are; each other row is named at the column where it stops matching.',
  },
  LEVEL_UNKNOWN_GLYPH: {
    template: '{at}: {shown} is not in the legend ({count})',
    fix: "write one of the legend's characters instead{suggestion} (the legend: {chars}), or define it before compiling: defineGlyph('glyph:<name>', { char: {quoted}, description: '…' })",
    doc: 'Raised by `validateLevel` and `compileLevel` (engine/world/level/validate.ts), once per unknown character, at its first tile, with the number of tiles that use it. `node x describe glyph` lists the legend.',
  },
  LEVEL_BAD_BLOCK: {
    template: '{at}: this {char} block {shape}, but {glyph} stands in whole {n} × {n} squares',
    fix: 'redraw the block as a filled rectangle whose sides are multiples of {n} tiles (a pillar is PP over PP)',
    doc: 'Raised by `validateLevel` and `compileLevel` (engine/world/level/validate.ts) for a glyph with a footprint above 1 whose touching tiles do not make a filled rectangle of whole footprint squares.',
  },
  LEVEL_UNREACHABLE_SPAWN: {
    template: '{at}: the spawn {spawn} ({char}) {why}',
    fix: 'open a gap in the walls round it, or move the {char} onto the main floor',
    doc: 'Reported by `validateLevel` (engine/world/level/validate.ts) and `node x qa level`, not by `compileLevel`: the spawn stands on a tile nobody walks on, or in an area cut off from the main floor (the largest area bodies can walk across, stepping between tiles at most the climb limit apart).',
  },
  LEVEL_UNREACHABLE_AREA: {
    template: '{at}: the walkable area from here ({count}) is cut off from the main floor ({main})',
    fix: 'open a gap to it, or fill it with a solid glyph (#) if nobody should stand there',
    doc: 'Reported by `validateLevel` (engine/world/level/validate.ts) and `node x qa level`, not by `compileLevel`, once per cut-off area without a spawn, at its first tile in reading order.',
  },
  LEVEL_INVALID: {
    template: '{where} has {count}: {list}',
    fix: 'fix each at the line and column it names (validateLevel(text) lists them; node x qa level checks every level file)',
    doc: 'Thrown by `compileLevel` and `defineLevel` (engine/world/level/compile.ts) for a level with structural problems; the error carries them as `values.problems`.',
  },
});

/** A level code. */
export type LevelCode = keyof typeof LEVEL_CODES;

/** One problem with a level: its code, where it is (from 1, in the whole file) and the sentence naming its fix. */
export interface LevelProblem {
  code: LevelCode;
  /** The line of the level's text, from 1, front matter included. */
  line: number;
  /** The column, in characters from 1. */
  column: number;
  /** `[CODE] <file>:<line>:<column>: <what is wrong>: <the fix>`. */
  message: string;
}

/** A problem with `code` at `line`:`column`, its message filled from `values` (which name `at`). */
export function levelProblem(code: LevelCode, values: CodeValues, line: number, column: number): LevelProblem {
  const text = codeInfo(code) ?? LEVEL_CODES[code];
  return { code, line, column, message: `[${code}] ${fill(text.template, values)}: ${fill(text.fix, values)}` };
}

/** `<file>:<line>:<column>`, the `at` of a problem's message. */
export const where = (file: string, line: number, column: number): string => `${file}:${line}:${column}`;
