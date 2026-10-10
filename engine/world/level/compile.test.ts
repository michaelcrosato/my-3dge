/**
 * @file Unit tests for engine/world/level/compile.ts, colliders.ts, meshes.ts, grid.ts and heights.ts (T1), on the
 * fixture levels (fixtures/levels/*.txt): each compiles to its golden hash, the same again, under the sim's fdlibm
 * swap and on a fresh registry; the merged colliders cover exactly the solid tiles, each once, from the ground to
 * the glyph's top; colliders, pieces, spawns and heights match values computed by hand; the result is frozen plain
 * data; a structural problem throws `LEVEL_INVALID` with the problems, a content problem does not stop it.
 * @see engine/world/level/compile.ts
 * @see engine/world/level/colliders.ts
 * @see engine/world/level/meshes.ts
 * @see engine/world/level/grid.ts
 * @see engine/world/level/heights.ts
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deserialize, hashValue, serialize, type Canonical } from '../../core/hash';
import { EngineError } from '../../core/log';
import { createRegistry } from '../../core/registry';
import { withSimMath } from '../../core/simMath';
import { compileLevel, levelName } from './compile';
import { defineGlyph } from './glyph';
import { floorHeight, solidAt, tileAt, topHeight } from './heights';
import type { CompiledLevel } from './types';

const DIR = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'levels');
const FIXTURES = readdirSync(DIR).filter((file) => file.endsWith('.txt'));
const text = (file: string) => readFileSync(join(DIR, file), 'utf8');
const compile = (file: string) => compileLevel(text(file), { file: `fixtures/levels/${file}` });
const hash = (level: CompiledLevel) => hashValue(level as unknown as Canonical);

/** Each fixture's compiled hash: a change here is a change of the compiled shape or of a v1 glyph. */
const GOLDEN: Record<string, string> = {
  'hall-v1.txt': '0f8fead48e003460',
  'heights.txt': '87e43d7f346d34f7',
  'room.txt': 'e67a59b6ffdfc096',
};

describe('compileLevel on the fixtures', () => {
  it('has a golden hash for every fixture', () => {
    expect(FIXTURES).toEqual(Object.keys(GOLDEN));
  });

  it.each(FIXTURES)('%s compiles to its golden hash, again, under the fdlibm swap and on a fresh registry', (file) => {
    const level = compile(file);
    expect(hash(level)).toBe(GOLDEN[file]);
    expect(hash(compile(file))).toBe(GOLDEN[file]);
    expect(withSimMath(() => hash(compile(file)))).toBe(GOLDEN[file]);
    const fresh = compileLevel(text(file), { file: `fixtures/levels/${file}`, registry: createRegistry() });
    expect(hash(fresh)).toBe(GOLDEN[file]);
    expect(hashValue(deserialize(serialize(level as unknown as Canonical)))).toBe(GOLDEN[file]);
  });

  it.each(FIXTURES)('%s: the merged colliders cover exactly the solid tiles, each once, ground to top', (file) => {
    const level = compile(file);
    const t = level.tile;
    const cover = new Array(level.cols * level.rows).fill(0);
    for (const box of level.colliders) {
      const [c0, r0, c1, r1] = box.tiles;
      expect(box.min).toEqual([c0 * t, 0, r0 * t]);
      expect(box.max).toEqual([(c1 + 1) * t, level.legend[level.map[r0][c0]].top, (r1 + 1) * t]);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          cover[r * level.cols + c]++;
          expect(level.legend[[...level.map[r]][c]].id).toBe(box.glyph);
        }
      }
    }
    expect(cover).toEqual(level.solid.map((solid) => (solid ? 1 : 0)));
  });
});

describe('the room fixture, by hand', () => {
  const room = compile('room.txt');

  it('has its size, legend and grids', () => {
    expect([room.format, room.name, room.tile, room.cols, room.rows]).toEqual(['my3dge-level/1', 'room', 1, 16, 12]);
    expect(Object.keys(room.legend).sort()).toEqual(['#', '.', '1', '2', '3', '@', 'P', 'w']);
    expect(room.solid.filter(Boolean).length).toBe(52 + 4 + 6);
    expect(room.walkable.filter(Boolean).length).toBe(16 * 12 - 62);
    expect(room.bounds).toEqual({ min: [0, 0, 0], max: [16, 3.5, 12] });
    expect(room.ground).toEqual({ min: [-1, -1, -1], max: [17, 0, 13] });
    expect(room.description).toMatch(/^A 16 × 12 m room/);
  });

  it('merges its colliders as the prototype would: 4 wall boxes, 1 pillar, 1 low wall', () => {
    expect(room.colliders.map((box) => [box.glyph, box.tiles, box.max[1]])).toEqual([
      ['glyph:lowWall', [4, 6, 9, 6], 0.75],
      ['glyph:pillar', [11, 3, 12, 4], 3.5],
      ['glyph:wall', [0, 0, 15, 0], 3],
      ['glyph:wall', [0, 1, 0, 11], 3],
      ['glyph:wall', [15, 1, 15, 11], 3],
      ['glyph:wall', [1, 11, 14, 11], 3],
    ]);
  });

  it('places its spawns at tile centres, in reading order', () => {
    expect(room.spawns.map((spawn) => [spawn.id, spawn.col, spawn.row, spawn.position])).toEqual([
      ['spawn:hero', 3, 2, [3.5, 0, 2.5]],
      ['spawn:1', 3, 4, [3.5, 0, 4.5]],
      ['spawn:2', 3, 8, [3.5, 0, 8.5]],
      ['spawn:3', 11, 8, [11.5, 0, 8.5]],
    ]);
    expect(room.lights).toEqual([]);
  });

  it('groups its meshes by recipe, the spawn markers joining the floor', () => {
    expect(
      room.meshes.map((mesh) => [mesh.recipe, mesh.glyphs.length, mesh.bottom, mesh.top, mesh.pieces.length]),
    ).toEqual([
      ['floor', 5, 0, 0, 130],
      ['lowWall', 1, 0, 0.75, 6],
      ['pillar', 1, 0, 3.5, 1],
      ['wall', 1, 0, 3, 52],
    ]);
    expect(room.meshes[2].pieces).toEqual([[11, 3, 12, 4]]);
    expect(room.meshes[3].rects).toEqual(room.colliders.slice(2).map((box) => box.tiles));
  });

  it('answers height queries with the hand-computed values', () => {
    const probes: [number, number][] = [
      [3.5, 2.5], // the hero's spawn: floor
      [0.5, 0.5], // the north-west wall
      [11.99, 3], // the pillar, its west edge
      [12.999, 4.999], // the pillar, its south-east corner
      [13, 5], // just past it: floor
      [6.2, 6.7], // the low wall
      [-0.01, 5], // outside, west
      [16, 5], // outside, on the east edge
    ];
    expect(probes.map(([x, z]) => [floorHeight(room, x, z), topHeight(room, x, z), solidAt(room, x, z)])).toEqual([
      [0, 0, false],
      [0, 3, true],
      [0, 3.5, true],
      [0, 3.5, true],
      [0, 0, false],
      [0, 0.75, true],
      [0, 0, true],
      [0, 0, true],
    ]);
    expect([tileAt(room, 11.99, 3), tileAt(room, 16, 5), tileAt(room, Number.NaN, 0)]).toEqual([
      { col: 11, row: 3 },
      null,
      null,
    ]);
  });

  it('is frozen plain data', () => {
    expect(
      Object.isFrozen(room) && Object.isFrozen(room.colliders[0].min) && Object.isFrozen(room.legend['#'].nav),
    ).toBe(true);
    expect(() => (room.solid as boolean[]).push(true)).toThrow(TypeError);
  });
});

describe('the heights fixture (half-metre tiles), by hand', () => {
  const level = compile('heights.txt');

  it('scales every position by the tile size', () => {
    expect([level.tile, level.cols, level.rows, level.bounds.max]).toEqual([0.5, 10, 8, [5, 3.5, 4]]);
    expect(
      level.colliders.filter((box) => box.glyph !== 'glyph:wall').map((box) => [box.glyph, box.min, box.max]),
    ).toEqual([
      ['glyph:lowWall', [3.5, 0, 1.5], [4, 0.75, 3]],
      ['glyph:lowWall', [1.5, 0, 2.5], [3, 0.75, 3]],
      ['glyph:pillar', [1, 0, 1], [3, 3.5, 2]],
    ]);
    expect(level.spawns[0].position).toEqual([0.75, 0, 3.25]);
    expect(level.ground).toEqual({ min: [-0.5, -1, -0.5], max: [5.5, 0, 4.5] });
  });

  it('splits the pillar block into two pieces under one box', () => {
    const pillars = level.meshes.find((mesh) => mesh.recipe === 'pillar')!;
    expect([pillars.footprint, pillars.pieces, pillars.rects]).toEqual([
      2,
      [
        [2, 2, 3, 3],
        [4, 2, 5, 3],
      ],
      [[2, 2, 5, 3]],
    ]);
  });

  it('answers height queries in metres', () => {
    const probes: [number, number][] = [
      [1.25, 1.25],
      [2.99, 1.99],
      [3.75, 1.75],
      [1.75, 2.75],
      [3.25, 2.75],
      [0.75, 3.25],
    ];
    expect(probes.map(([x, z]) => topHeight(level, x, z))).toEqual([3.5, 3.5, 0.75, 0.75, 0, 0]);
    expect(probes.map(([x, z]) => floorHeight(level, x, z))).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe('compileLevel', () => {
  it('names the level after its file, or as told', () => {
    expect(levelName('fixtures/levels/room.txt')).toBe('room');
    expect(levelName('C:\\levels\\hall.txt')).toBe('hall');
    expect(compileLevel('#\n').name).toBe('level');
    expect(compileLevel('#\n', { file: 'a/b/cell.txt', name: 'cell-2' }).name).toBe('cell-2');
  });

  it("lists a game glyph's light spots and raised floors", () => {
    const reg = createRegistry();
    defineGlyph(
      'glyph:brazier',
      { char: 't', top: 1, solid: true, collider: 'box', nav: { walkable: false }, light: 'torch', lightHeight: 0.5 },
      reg,
    );
    defineGlyph('glyph:ledge', { char: '=', floor: 1, top: 1, collider: 'box', mesh: 'gallery' }, reg);
    const level = compileLevel('#####\n#t.=#\n#####\n', { registry: reg });
    expect(level.lights).toEqual([{ tag: 'torch', glyph: 'glyph:brazier', col: 1, row: 1, position: [1.5, 1.5, 1.5] }]);
    expect([floorHeight(level, 3.5, 1.5), topHeight(level, 3.5, 1.5), solidAt(level, 3.5, 1.5)]).toEqual([1, 1, false]);
    expect(level.colliders.map((box) => box.glyph)).toEqual([
      'glyph:brazier',
      'glyph:ledge',
      'glyph:wall',
      'glyph:wall',
      'glyph:wall',
      'glyph:wall',
    ]);
    expect(level.meshes.map((mesh) => [mesh.recipe, mesh.bottom])).toEqual([
      ['floor', 0],
      ['gallery', 1],
      ['wall', 0],
    ]);
  });

  it('throws LEVEL_INVALID for structural problems, with each one, and compiles past content problems', () => {
    let error: unknown;
    try {
      compile('broken/ragged.txt');
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(EngineError);
    const engineError = error as EngineError;
    expect(engineError.code).toBe('LEVEL_INVALID');
    expect(engineError.message).toMatch(
      /^\[LEVEL_INVALID\] fixtures\/levels\/broken\/ragged\.txt has 2 problems: \[LEVEL_RAGGED_ROW\] fixtures\/levels\/broken\/ragged\.txt:3:7: /,
    );
    expect((engineError.values.problems as { code: string }[]).map((p) => p.code)).toEqual([
      'LEVEL_RAGGED_ROW',
      'LEVEL_RAGGED_ROW',
    ]);
    const many =
      '#'.repeat(3) +
      '\n' +
      'XYZUV'
        .split('')
        .map((c) => `#${c}#`)
        .join('\n')
        .concat('\n#Q#\n');
    expect(() => compileLevel(many)).toThrow(/; and 1 more: fix each/);
    expect(compile('broken/unreachable.txt').spawns.length).toBe(2);
  });
});
