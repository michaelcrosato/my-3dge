/**
 * @file What can be wrong with a level, and how it is said (PLAN.md WP 2.2, §6.8; doctrine: Agent-operable): the
 * level codes, each naming its fix in the level's own terms, and `LevelProblem`, one problem at a line and column of
 * the level's text. engine/world/level/parse.ts and validate.ts find problems; compile.ts refuses a level that has
 * structural ones (`LEVEL_INVALID`, listing them), and `node x qa level` reports them for every level file.
 *
 * A problem's `message` is `[CODE] <file>:<line>:<column>: <what is wrong>: <the fix>`, the form editors and agents
 * jump to. Lines count the whole file from 1, front matter included; columns count characters (code points) from 1.
 *
 * Invariants: the codes of `LEVEL_CONTENT_CODES` are content checks (`validateLevel`, the QA family); every other code
 * is structural, and `compileLevel` refuses a level that has one.
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
  LEVEL_BAD_RAMP: {
    template: '{at}: this {char} block {why}',
    fix: 'draw {glyph} as a filled rectangle with exactly one side against walkable floor {top} m up (a gallery, =): it rises toward that side',
    doc: 'Raised by `validateLevel` and `compileLevel` (engine/world/level/shapes.ts) for a block of a ramp glyph (stairs, ^) that is not a filled rectangle, or whose neighbours at its top height (walkable, flat, within the climb limit) lie on no side or on several, so the direction it rises is not clear.',
  },
  LEVEL_BAD_DAIS: {
    template: '{at}: this {char} block {why}',
    fix: 'redraw {glyph} as an octagon in a square of tiles (as many rows as columns), wide enough that its base reaches more than its {edge} m edge from its centre',
    doc: 'Raised by `validateLevel` and `compileLevel` (engine/world/level/shapes.ts) for a block of a dais glyph (o) whose bounding box is not square, or too small for its sloped edge.',
  },
  LEVEL_UNREACHABLE_SPAWN: {
    template: '{at}: the spawn {spawn} ({char}) {why}',
    fix: 'open a gap in the walls round it, or move the {char} onto the main floor',
    doc: 'Reported by `validateLevel` (engine/world/level/validate.ts) and `node x qa level`, not by `compileLevel`: the spawn stands on a tile nobody walks on, or in an area cut off from the main floor (the largest area whose tiles bodies walk between both ways, never climbing more than the climb limit at once; engine/world/level/walk.ts).',
  },
  LEVEL_UNREACHABLE_AREA: {
    template: '{at}: the walkable area from here ({count}) is cut off from the main floor ({main})',
    fix: 'open a gap to it, or fill it with a solid glyph (#) if nobody should stand there',
    doc: 'Reported by `validateLevel` (engine/world/level/validate.ts) and `node x qa level`, not by `compileLevel`, once per cut-off area without a spawn, at its first tile in reading order.',
  },
  LEVEL_BAD_STOREY: {
    template: '{at}: {problem}',
    fix: 'write each storey as a block between two lines holding only --- before its map, bottom storey first: storey (a name), base (its floor, m) and height (its clear height, m), each base above the ceiling of the storey below; the top storey may add roof (gable, hip or flat), pitch (°), ridge (x or z), eaves (m) and roofSurface; every map the size of the first',
    doc: 'Raised by `validateLevel` and `compileLevel` (engine/world/level/parse.ts, storeys.ts) for a storey block that is never closed, names no storey, has an unknown, repeated or bad key, lacks its base or height, does not rise above the storey below (the gap is its floor slab), repeats a name, or whose map is not the size of the first storey’s.',
  },
  LEVEL_NEEDS_STOREY: {
    template: '{at}: {char} ({glyph}) {why}, which only a storey has',
    fix: 'write the map as a storey (format 2): a block before it between two lines holding only ---, with storey: ground, base: 0 and height: 2.7',
    doc: 'Raised by `validateLevel` and `compileLevel` (engine/world/level/validate.ts) for a format-1 map (no storey blocks) using a glyph that needs a storey: void, a door, a window, a low ceiling, a room marker or a flight of stairs.',
  },
  LEVEL_BAD_FLIGHT: {
    template: '{at}: this {char} block {why}',
    fix: 'draw {glyph} as a filled rectangle on the lower storey with exactly one side against floor of the storey above, and void (~) over all of it on the storey above: it rises toward that side, to that floor',
    doc: 'Raised by `validateLevel` and `compileLevel` (engine/world/level/storeys.ts) for a flight of stairs between storeys that is not a filled rectangle, stands on the top storey, has no void over it on the storey above, or meets that storey’s floor on no side or on several.',
  },
  LEVEL_BAD_OPENING: {
    template: '{at}: this {char} block {why}',
    fix: 'draw each {kind} as a filled rectangle in a wall, one wall thick, with the wall (a full-height solid glyph, #) at both of its ends',
    doc: 'Raised by `validateLevel` and `compileLevel` (engine/world/level/openings.ts) for a door or a window that is not a filled rectangle, or has no wall at both ends of its longer side, so the way through it is not clear.',
  },
  LEVEL_BAD_ROOM: {
    template: '{at}: {why}',
    fix: 'give each room one marker, each room a name of its own, and close each room off from the next with walls and doors',
    doc: 'Raised by `validateLevel` and `compileLevel` (engine/world/level/rooms.ts) for a room marker on a tile with no floor, two markers of one room, two rooms named alike, or two rooms whose markers share one floor.',
  },
  LEVEL_BAD_ROOF: {
    template: '{at}: {why}',
    fix: 'give the roof to the top storey only, with a pitch for gable and hip (roof: gable, pitch: 35), and a map holding floor under it',
    doc: 'Raised by `validateLevel` and `compileLevel` (engine/world/level/storeys.ts) for a roof on a storey below the top one, a gable or hip without a pitch, a ridge on a roof that is not a gable, roof keys on a storey with no roof, or a storey with no floor to stand it on.',
  },
  LEVEL_NARROW_DOOR: {
    template: '{at}: the door is {width} m wide, narrower than a body ({body} m across)',
    fix: 'widen it to at least {need} tiles along its wall',
    doc: 'Reported by `validateLevel` (engine/world/level/validate.ts) and `node x qa level`, not by `compileLevel`: bodies cannot pass a door no wider than the largest standard body (the shooter model’s hull, 0.8128 m).',
  },
  LEVEL_LOW_HEADROOM: {
    template:
      '{at}: {count} walkable, the lowest {headroom} m under what is above, where a crouched body needs {body} m',
    fix: 'raise what is above (the storey’s height, the low ceiling’s head, the storey above), or make the tiles solid if nobody should stand there',
    doc: 'Reported by `validateLevel` (engine/world/level/validate.ts) and `node x qa level`, not by `compileLevel`, once per storey, at its first such tile in reading order: a crouched body (the shooter model’s, 1.19 m) does not fit there.',
  },
  LEVEL_STEEP_FLIGHT: {
    template: '{at}: the flight rises {rise} m over {run} m, {angle}°, steeper than bodies walk ({limit}°)',
    fix: 'lengthen it to at least {need} tiles along its rise',
    doc: 'Reported by `validateLevel` (engine/world/level/validate.ts) and `node x qa level`, not by `compileLevel`, for a flight of stairs between storeys steeper than the shooter model’s walkable slope (45°).',
  },
  LEVEL_UNREACHABLE_ROOM: {
    template: '{at}: the room {room} ({count}) is cut off from the main floor ({main})',
    fix: 'give it a door, a flight of stairs or a ladder to the rest',
    doc: 'Reported by `validateLevel` (engine/world/level/validate.ts) and `node x qa level`, not by `compileLevel`: bodies cannot walk from the main floor (the largest area, over every storey, through flights and ladders) into the room and back.',
  },
  LEVEL_NO_STOREY: {
    template: '{level} has {count}; there is no storey {index}',
    fix: 'ask for a storey from 0 (the lowest) to {last}: level.storeys lists them',
    doc: 'Thrown by `storeyView` (engine/world/level/storeys.ts) for an index the level has no storey at; a format-1 level has one, 0.',
  },
  LEVEL_INVALID: {
    template: '{where} has {count}: {list}',
    fix: 'fix each at the line and column it names (validateLevel(text) lists them; node x qa level checks every level file)',
    doc: 'Thrown by `compileLevel` and `defineLevel` (engine/world/level/compile.ts) for a level with structural problems; the error carries them as `values.problems`.',
  },
});

/** A level code. */
export type LevelCode = keyof typeof LEVEL_CODES;

/** The content codes: `validateLevel` and `node x qa level` report them; `compileLevel` compiles a level that has them. */
export const LEVEL_CONTENT_CODES: readonly LevelCode[] = [
  'LEVEL_UNREACHABLE_SPAWN',
  'LEVEL_UNREACHABLE_AREA',
  'LEVEL_UNREACHABLE_ROOM',
  'LEVEL_NARROW_DOOR',
  'LEVEL_LOW_HEADROOM',
  'LEVEL_STEEP_FLIGHT',
];

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
