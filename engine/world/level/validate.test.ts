/**
 * @file Unit tests for engine/world/level/validate.ts and problems.ts (T1): every seeded error in
 * fixtures/levels/broken/, and in the inline levels of bad stairs, daises and storeys (WP 13.13), is caught at its line
 * and column, with nothing else reported; every level code is seeded somewhere; the good fixtures validate clean; the
 * messages name the fix in the level's terms; spawns on tiles nobody walks on, the climb limit and one-way drops off a
 * gallery decide reachability, and in storeys flights and ladders link the floors.
 * @see engine/world/level/validate.ts
 * @see engine/world/level/problems.ts
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defineStoreyFixtureGlyphs } from '../../../fixtures/levels/storeys/glyphs';
import { createRegistry, type Registry } from '../../core/registry';
import { defineGlyph } from './glyph';
import { LEVEL_CODES } from './problems';
import { checkLevel, NAV_CLIMB, validateLevel } from './validate';

const DIR = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'levels');
const read = (file: string) => readFileSync(join(DIR, file), 'utf8');
const found = (file: string) =>
  validateLevel(read(file), { file: `fixtures/levels/${file}` }).map((p) => [p.code, p.line, p.column]);

/** Each broken fixture's seeded errors: code, line, column. */
const SEEDED: Record<string, [string, number, number][]> = {
  'bad-block.txt': [
    ['LEVEL_BAD_BLOCK', 6, 3],
    ['LEVEL_BAD_BLOCK', 7, 8],
    ['LEVEL_BAD_BLOCK', 9, 4],
  ],
  'bad-header.txt': [
    ['LEVEL_BAD_HEADER', 2, 1],
    ['LEVEL_BAD_HEADER', 3, 7],
    ['LEVEL_BAD_HEADER', 4, 1],
    ['LEVEL_BAD_HEADER', 5, 1],
    ['LEVEL_BAD_HEADER', 6, 14],
  ],
  'empty.txt': [['LEVEL_EMPTY', 4, 1]],
  'ragged.txt': [
    ['LEVEL_RAGGED_ROW', 3, 7],
    ['LEVEL_RAGGED_ROW', 4, 8],
  ],
  'unclosed-header.txt': [['LEVEL_BAD_HEADER', 1, 1]],
  'unknown-glyph.txt': [
    ['LEVEL_UNKNOWN_GLYPH', 5, 4],
    ['LEVEL_UNKNOWN_GLYPH', 6, 4],
    ['LEVEL_UNKNOWN_GLYPH', 7, 3],
  ],
  'unreachable.txt': [
    ['LEVEL_UNREACHABLE_SPAWN', 5, 2],
    ['LEVEL_UNREACHABLE_SPAWN', 10, 9],
    ['LEVEL_UNREACHABLE_AREA', 7, 8],
  ],
};

/**
 * The v2 shapes' seeded errors (WP 4.2), written here because fixtures/levels/broken/ is WP 2.2's: each level's text,
 * and its errors: code, line, column. In bad-ramp, the stairs at 2:2 rise to the gallery north of them, and are fine.
 */
/** A registry with the storey fixtures' room markers and a duct: floor under a ceiling 1 m up (too low to crouch). */
const ROOMS: Registry = createRegistry();
defineStoreyFixtureGlyphs(ROOMS);
defineGlyph('glyph:test-duct', { char: 'd', description: 'A duct 1 m high.', mesh: 'floor', head: 1 }, ROOMS);

/** A storey's block and map, as format 2 writes them. */
const storey = (keys: string, ...map: string[]) => ['---', ...keys.split('; '), '---', ...map];

const INLINE: Record<string, { text: string; seeded: [string, number, number][]; registry?: Registry }> = {
  'bad-ramp': {
    text: [
      '############',
      '#===...====#',
      '#^^^...^^..#', // an L of stairs at 3:8: not a filled rectangle
      '#......^...#',
      '#..^^......#', // stairs with no gallery beside them at 5:4
      '#..........#',
      '#==^==.....#', // stairs between two galleries at 7:4
      '#..........#',
      '############',
    ].join('\n'),
    seeded: [
      ['LEVEL_BAD_RAMP', 3, 8],
      ['LEVEL_BAD_RAMP', 5, 4],
      ['LEVEL_BAD_RAMP', 7, 4],
    ],
  },
  'bad-dais': {
    text: [
      '##########',
      '#oooo....#', // a dais 4 × 2 tiles at 2:2: not a square
      '#oooo....#',
      '#........#',
      '#.o......#', // a dais one tile across at 5:3: too small for its 1.5 m edge
      '#........#',
      '#....ooo.#', // a 3 × 3 dais: fine
      '#....ooo.#',
      '#....ooo.#',
      '##########',
    ].join('\n'),
    seeded: [
      ['LEVEL_BAD_DAIS', 2, 2],
      ['LEVEL_BAD_DAIS', 5, 3],
    ],
  },
  'bad-storey-block': {
    // a height that is no number at 4:9; a block naming no storey at 9:1
    text: [...storey('storey: ground; base: 0; height: tall', '###', '#.#', '###'), ...storey('base: 3; height: 2.7', '###', '#.#', '###')].join('\n'), // prettier-ignore
    seeded: [
      ['LEVEL_BAD_STOREY', 4, 9],
      ['LEVEL_BAD_STOREY', 9, 1],
    ],
  },
  'bad-storey': {
    // the second storey at 9:1: named twice, its map 5 wide, no height
    text: [...storey('storey: ground; base: 0; height: 2.7', '####', '#..#', '####'), ...storey('storey: ground; base: 3', '#####', '#...#', '#####')].join('\n'), // prettier-ignore
    seeded: [
      ['LEVEL_BAD_STOREY', 9, 1],
      ['LEVEL_BAD_STOREY', 9, 1],
      ['LEVEL_BAD_STOREY', 9, 1],
    ],
  },
  'bad-base': {
    // the ground floor at 9:1 stands on the cellar's ceiling, with no slab between
    text: [...storey('storey: cellar; base: -3; height: 3', '####', '#..#', '####'), ...storey('storey: ground; base: 0; height: 2.7', '####', '#..#', '####')].join('\n'), // prettier-ignore
    seeded: [['LEVEL_BAD_STOREY', 9, 1]],
  },
  'needs-storey': {
    text: ['#####', '#+~.#', '#####'].join('\n'), // a door and void in a map with no storey
    seeded: [
      ['LEVEL_NEEDS_STOREY', 2, 2],
      ['LEVEL_NEEDS_STOREY', 2, 3],
    ],
  },
  'bad-flight': {
    // an L of stairs at 7:2; stairs with floor over them at 7:9; stairs on the top storey at 21:5
    text: [
      ...storey('storey: ground; base: 0; height: 2.7', '##########', '#<<.....<#', '#<<.....<#', '#<......<#', '#.......<#', '##########'), // prettier-ignore
      ...storey('storey: upper; base: 3; height: 2.7', '##########', '#~~......#', '#~~......#', '#~.......#', '#...<....#', '##########'), // prettier-ignore
    ].join('\n'),
    seeded: [
      ['LEVEL_BAD_FLIGHT', 7, 2],
      ['LEVEL_BAD_FLIGHT', 7, 9],
      ['LEVEL_BAD_FLIGHT', 21, 5],
    ],
  },
  'bad-opening': {
    // a door that is no filled rectangle at 10:3, a window with floor at its ends at 8:4
    text: storey('storey: ground; base: 0; height: 2.7', '#######', '#.....#', '#..:..#', '#.....#', '##++###', '##+####', '#######').join('\n'), // prettier-ignore
    seeded: [
      ['LEVEL_BAD_OPENING', 10, 3],
      ['LEVEL_BAD_OPENING', 8, 4],
    ],
  },
  'bad-room': {
    // the kitchen marked twice at 7:9; the hall named on two storeys at 16:2; the cellar and the study on one floor at 16:6
    text: [...storey('storey: ground; base: 0; height: 2.7', '###########', '#h..#k..k##', '#...#....##', '###########'), ...storey('storey: upper; base: 3; height: 2.7', '###########', '#h..#c.s..#', '#...#.....#', '###########')].join('\n'), // prettier-ignore
    registry: ROOMS,
    seeded: [
      ['LEVEL_BAD_ROOM', 7, 9],
      ['LEVEL_BAD_ROOM', 16, 2],
      ['LEVEL_BAD_ROOM', 16, 6],
    ],
  },
  'bad-roof': {
    // a roof on the ground floor at 1:1; at 10:1 a hip with no pitch and a ridge it does not take
    text: [...storey('storey: ground; base: 0; height: 2.7; roof: flat', '###', '#.#', '###'), ...storey('storey: top; base: 3; roof: hip; ridge: z', '###', '#.#', '###')].join('\n'), // prettier-ignore
    seeded: [
      ['LEVEL_BAD_ROOF', 1, 1],
      ['LEVEL_BAD_ROOF', 10, 1],
      ['LEVEL_BAD_ROOF', 10, 1],
    ],
  },
  'storey-content': {
    // the kitchen walled off at 19:2; a door half a metre wide at 10:5; a duct 1 m high at 11:2; stairs 3 m up a metre at 10:6
    text: [
      '---',
      'tile: 0.5',
      '---',
      ...storey('storey: ground; base: 0; height: 2.7', '##########', '#h..+<<###', '#dd.#<<###', '##########'),
      ...storey('storey: upper; base: 3; height: 2.7', '##########', '#k.##~~..#', '#..##~~..#', '##########'),
    ].join('\n'),
    registry: ROOMS,
    seeded: [
      ['LEVEL_UNREACHABLE_ROOM', 19, 2],
      ['LEVEL_NARROW_DOOR', 10, 5],
      ['LEVEL_LOW_HEADROOM', 11, 2],
      ['LEVEL_STEEP_FLIGHT', 10, 6],
    ],
  },
};

describe('validateLevel', () => {
  it('lists the seeded errors of every broken fixture', () => {
    expect(readdirSync(join(DIR, 'broken')).sort()).toEqual(Object.keys(SEEDED));
  });

  it.each(Object.keys(SEEDED))('catches every seeded error of broken/%s, and nothing else', (file) => {
    expect(found(`broken/${file}`)).toEqual(SEEDED[file]);
  });

  it.each(Object.keys(INLINE))('catches every seeded error of %s, and nothing else', (name) => {
    const { text, seeded, registry } = INLINE[name];
    const found = validateLevel(text, { file: `${name}.txt`, registry });
    expect(found.map((p) => [p.code, p.line, p.column])).toEqual(seeded);
  });

  it('has every level code seeded in a broken fixture or inline (storeyView throws LEVEL_NO_STOREY; LEVEL_INVALID is compile’s wrapper)', () => {
    const lists = [...Object.values(SEEDED), ...Object.values(INLINE).map((inline) => inline.seeded)];
    const seeded = new Set(lists.flatMap((list) => list.map(([code]) => code)));
    expect(Object.keys(LEVEL_CODES).filter((code) => !seeded.has(code))).toEqual(['LEVEL_NO_STOREY', 'LEVEL_INVALID']);
  });

  it("names a storey's problems in its own terms", () => {
    const message = (name: string, i = 0) => validateLevel(INLINE[name].text, { file: `${name}.txt`, registry: INLINE[name].registry })[i].message; // prettier-ignore
    expect(message('bad-base')).toContain('its base, 0 m, is not above the ceiling of the storey below (cellar: 0 m)');
    expect(message('needs-storey')).toBe(
      '[LEVEL_NEEDS_STOREY] needs-storey.txt:2:2: + (glyph:door) is a door, which only a storey has: write the map as a storey (format 2): a block before it between two lines holding only ---, with storey: ground, base: 0 and height: 2.7',
    );
    expect(message('bad-flight', 1)).toContain('has floor over it on the storey above (column 9, row 2 of its map)');
    expect(message('bad-opening', 1)).toContain('has no wall at both of its ends (north and south)');
    expect(message('bad-room', 2)).toContain('the rooms cellar and study share one floor');
    expect(message('storey-content', 0)).toContain(
      'the room kitchen (4 tiles) is cut off from the main floor (15 tiles)',
    );
    expect(message('storey-content', 1)).toContain('the door is 0.5 m wide, narrower than a body (0.8128 m across): widen it to at least 2 tiles'); // prettier-ignore
    expect(message('storey-content', 2)).toContain('2 tiles walkable, the lowest 1 m under what is above, where a crouched body needs 1.19 m'); // prettier-ignore
    expect(message('storey-content', 3)).toContain('the flight rises 3 m over 1 m, 71.6°, steeper than bodies walk (45°): lengthen it to at least 6 tiles'); // prettier-ignore
  });

  it.each(readdirSync(DIR).filter((file) => file.endsWith('.txt')))('finds nothing wrong with %s', (file) => {
    expect(found(file)).toEqual([]);
  });

  it('names the fix in the level’s own terms', () => {
    const messages = (file: string) => validateLevel(read(file), { file }).map((p) => p.message);
    expect(messages('broken/unknown-glyph.txt')[1]).toBe(
      `[LEVEL_UNKNOWN_GLYPH] broken/unknown-glyph.txt:6:4: "p" is not in the legend (1 tile): write one of the legend's characters instead (did you mean "P"?) (the legend: ! # + . 1 2 3 4 5 6 7 8 9 : < = @ P ^ _ o t w | ~), or define it before compiling: defineGlyph('glyph:<name>', { char: 'p', description: '…' })`,
    );
    expect(messages('broken/unknown-glyph.txt')[2]).toContain('a tab is not in the legend');
    expect(validateLevel("#'#\n")[0].message).toContain(`defineGlyph('glyph:<name>', { char: "'", description: '…' })`);
    expect(messages('broken/bad-block.txt')[0]).toBe(
      '[LEVEL_BAD_BLOCK] broken/bad-block.txt:6:3: this P block is 3 × 2 tiles, but glyph:pillar stands in whole 2 × 2 squares: redraw the block as a filled rectangle whose sides are multiples of 2 tiles (a pillar is PP over PP)',
    );
    expect(messages('broken/bad-block.txt')[2]).toContain('is not a filled rectangle (3 tiles in a 2 × 2 area)');
    expect(messages('broken/unreachable.txt')).toEqual([
      '[LEVEL_UNREACHABLE_SPAWN] broken/unreachable.txt:5:2: the spawn spawn:hero (@) is cut off from the main floor (its area has 4 tiles, the main floor 50 tiles): open a gap in the walls round it, or move the @ onto the main floor',
      '[LEVEL_UNREACHABLE_SPAWN] broken/unreachable.txt:10:9: the spawn spawn:2 (2) is cut off from the main floor (its area has 1 tile, the main floor 50 tiles): open a gap in the walls round it, or move the 2 onto the main floor',
      '[LEVEL_UNREACHABLE_AREA] broken/unreachable.txt:7:8: the walkable area from here (2 tiles) is cut off from the main floor (50 tiles): open a gap to it, or fill it with a solid glyph (#) if nobody should stand there',
    ]);
    expect(messages('broken/bad-header.txt')[0]).toContain('unknown key "descripton" (did you mean "description"?)');
  });

  it('names what is wrong with stairs and a dais, and the fix', () => {
    const messages = (name: string) => validateLevel(INLINE[name].text, { file: `${name}.txt` }).map((p) => p.message);
    const fix =
      'draw glyph:stairs as a filled rectangle with exactly one side against walkable floor 1 m up (a gallery, =): it rises toward that side';
    expect(messages('bad-ramp')).toEqual([
      `[LEVEL_BAD_RAMP] bad-ramp.txt:3:8: this ^ block is not a filled rectangle (3 tiles in a 2 × 2 area): ${fix}`,
      `[LEVEL_BAD_RAMP] bad-ramp.txt:5:4: this ^ block meets no floor at its top (1 m) on any side, so it rises toward none: ${fix}`,
      `[LEVEL_BAD_RAMP] bad-ramp.txt:7:4: this ^ block meets floors at its top (1 m) on 2 sides (west, east), so it rises toward none: ${fix}`,
    ]);
    const daisFix =
      'redraw glyph:dais as an octagon in a square of tiles (as many rows as columns), wide enough that its base reaches more than its 1.5 m edge from its centre';
    expect(messages('bad-dais')).toEqual([
      `[LEVEL_BAD_DAIS] bad-dais.txt:2:2: this o block spans 4 × 2 tiles, not a square: ${daisFix}`,
      `[LEVEL_BAD_DAIS] bad-dais.txt:5:3: this o block is too small for its 1.5 m edge: its base reaches 1 m from its centre: ${daisFix}`,
    ]);
  });

  it('reaches a gallery only by its stairs, and drops off it anywhere', () => {
    const level = (stairs: string) => `#######\n#===.@#\n#${stairs}....#\n#.....#\n#######\n`;
    expect(validateLevel(level('^'))).toEqual([]);
    expect(validateLevel(level('.')).map((p) => p.message)).toEqual([
      '[LEVEL_UNREACHABLE_AREA] level:2:2: the walkable area from here (3 tiles) is cut off from the main floor (12 tiles): open a gap to it, or fill it with a solid glyph (#) if nobody should stand there',
    ]);
    // Stairs between two galleries rise toward neither: a structural problem, before any reachability.
    expect(validateLevel('#######\n#===.@#\n#^....#\n#=....#\n#######\n').map((p) => p.code)).toEqual([
      'LEVEL_BAD_RAMP',
    ]);
  });

  it('reports unknown characters even when rows are ragged, but no blocks then', () => {
    const problems = validateLevel('####\n#X.\n#PP#\n####\n');
    expect(problems.map((p) => [p.code, p.line, p.column])).toEqual([
      ['LEVEL_RAGGED_ROW', 2, 4],
      ['LEVEL_UNKNOWN_GLYPH', 2, 2],
    ]);
    expect(checkLevel('####\n#X.\n').glyphs).toEqual([]);
  });

  it('finds a spawn on a tile nobody walks on', () => {
    const reg = createRegistry();
    defineGlyph(
      'glyph:perch',
      { char: 'p', top: 1, solid: true, collider: 'box', nav: { walkable: false }, spawn: 'bird' },
      reg,
    );
    const problems = validateLevel('#####\n#p..#\n#####\n', { registry: reg, file: 'perch.txt' });
    expect(problems.map((p) => p.message)).toEqual([
      '[LEVEL_UNREACHABLE_SPAWN] perch.txt:2:2: the spawn spawn:bird (p) stands on a tile nobody walks on (glyph:perch is not walkable): open a gap in the walls round it, or move the p onto the main floor',
    ]);
  });

  it('joins floors no more than the climb limit apart', () => {
    const reg = createRegistry();
    defineGlyph('glyph:step', { char: 's', floor: 0.2, top: 0.2, mesh: 'floor' }, reg);
    defineGlyph('glyph:ledge', { char: 'L', floor: 1, top: 1, mesh: 'floor' }, reg); // = is the engine's gallery
    const level = '########\n#@sL...#\n########\n';
    const found = (climb?: number) =>
      validateLevel(level, { registry: reg, climb }).map((p) => `${p.code} ${p.column}`);
    expect(NAV_CLIMB).toBe(0.21875);
    expect(found()).toEqual(['LEVEL_UNREACHABLE_SPAWN 2', 'LEVEL_UNREACHABLE_AREA 4']);
    expect(found(0.1)).toEqual(['LEVEL_UNREACHABLE_SPAWN 2', 'LEVEL_UNREACHABLE_AREA 3', 'LEVEL_UNREACHABLE_AREA 4']);
    expect(found(1)).toEqual([]);
  });
});
