/**
 * @file Unit tests for engine/world/level/validate.ts and problems.ts (T1): every seeded error in
 * fixtures/levels/broken/ is caught at its line and column, with nothing else reported; every level code is seeded
 * somewhere; the good fixtures validate clean; the messages name the fix in the level's terms; spawns on tiles nobody
 * walks on, and the climb limit, decide reachability.
 * @see engine/world/level/validate.ts
 * @see engine/world/level/problems.ts
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../core/registry';
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

describe('validateLevel', () => {
  it('lists the seeded errors of every broken fixture', () => {
    expect(readdirSync(join(DIR, 'broken')).sort()).toEqual(Object.keys(SEEDED));
  });

  it.each(Object.keys(SEEDED))('catches every seeded error of broken/%s, and nothing else', (file) => {
    expect(found(`broken/${file}`)).toEqual(SEEDED[file]);
  });

  it('has every level code seeded in a broken fixture (LEVEL_INVALID is compile’s wrapper)', () => {
    const seeded = new Set(Object.values(SEEDED).flatMap((list) => list.map(([code]) => code)));
    expect(Object.keys(LEVEL_CODES).filter((code) => !seeded.has(code))).toEqual(['LEVEL_INVALID']);
  });

  it.each(readdirSync(DIR).filter((file) => file.endsWith('.txt')))('finds nothing wrong with %s', (file) => {
    expect(found(file)).toEqual([]);
  });

  it('names the fix in the level’s own terms', () => {
    const messages = (file: string) => validateLevel(read(file), { file }).map((p) => p.message);
    expect(messages('broken/unknown-glyph.txt')[1]).toBe(
      `[LEVEL_UNKNOWN_GLYPH] broken/unknown-glyph.txt:6:4: "p" is not in the legend (1 tile): write one of the legend's characters instead (did you mean "P"?) (the legend: # . 1 2 3 4 5 6 7 8 9 @ P w), or define it before compiling: defineGlyph('glyph:<name>', { char: 'p', description: '…' })`,
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
    defineGlyph('glyph:ledge', { char: '=', floor: 1, top: 1, mesh: 'floor' }, reg);
    const level = '########\n#@s=...#\n########\n';
    const found = (climb?: number) =>
      validateLevel(level, { registry: reg, climb }).map((p) => `${p.code} ${p.column}`);
    expect(NAV_CLIMB).toBe(0.21875);
    expect(found()).toEqual(['LEVEL_UNREACHABLE_SPAWN 2', 'LEVEL_UNREACHABLE_AREA 4']);
    expect(found(0.1)).toEqual(['LEVEL_UNREACHABLE_SPAWN 2', 'LEVEL_UNREACHABLE_AREA 3', 'LEVEL_UNREACHABLE_AREA 4']);
    expect(found(1)).toEqual([]);
  });
});
