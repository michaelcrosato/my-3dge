/**
 * @file Unit tests for engine/world/level/level.ts (T1): `defineLevel` keeps a level's text after checking it
 * compiles, refusing a structural problem at its line and column; `getLevel` compiles it, named after its id, with
 * its registry's legend; a missing id names the closest; `describe` lists the kind; a level's material swaps (WP 7.8)
 * are kept as given, none by default, and a swap that is not a material id is refused.
 * @see engine/world/level/level.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hashValue, type Canonical } from '../../core/hash';
import { EngineError } from '../../core/log';
import { createRegistry } from '../../core/registry';
import { compileLevel } from './compile';
import { defineGlyph } from './glyph';
import { defineLevel, getLevel } from './level';

const ROOM = readFileSync(join(import.meta.dirname, '..', '..', '..', 'fixtures', 'levels', 'room.txt'), 'utf8');

/** The EngineError `fn` throws. */
function errorOf(fn: () => unknown): EngineError {
  try {
    fn();
  } catch (error) {
    if (error instanceof EngineError) return error;
    throw error;
  }
  throw new Error('expected an EngineError');
}

describe('defineLevel and getLevel', () => {
  it('registers the text and compiles it on request, named after the id', () => {
    const reg = createRegistry();
    const entry = defineLevel('level:room', { text: ROOM, file: 'fixtures/levels/room.txt' }, reg);
    expect([entry.kind, entry.file]).toEqual(['level', 'fixtures/levels/room.txt']);
    const level = getLevel('level:room', reg);
    const direct = compileLevel(ROOM, { file: 'fixtures/levels/room.txt', registry: reg });
    expect(hashValue(level as unknown as Canonical)).toBe(hashValue(direct as unknown as Canonical));
    expect(level.name).toBe('room');
    expect(reg.describe('level').ids).toEqual(['level:room']);
  });

  it('refuses a level that does not compile, naming each problem where it is', () => {
    const error = errorOf(() => defineLevel('level:bad', { text: '###\n#Z#\n##\n' }, createRegistry()));
    expect(error.code).toBe('CORE_BAD_SPEC');
    expect(error.message).toContain('[LEVEL_RAGGED_ROW] level:bad:3:3');
    expect(error.message).toContain('[LEVEL_UNKNOWN_GLYPH] level:bad:2:2: "Z" is not in the legend');
  });

  it("reads the legend of the level's own registry", () => {
    const reg = createRegistry();
    expect(errorOf(() => defineLevel('level:x', { text: '#c#\n' }, reg)).message).toContain('"c" is not in the legend');
    defineGlyph('glyph:crate', { char: 'c', mesh: 'floor', spawn: 'crate' }, reg);
    defineLevel('level:x', { text: '###\n#c#\n###\n' }, reg);
    expect(getLevel('level:x', reg).spawns.map((spawn) => spawn.id)).toEqual(['spawn:crate']);
  });

  it('keeps its material swaps, none by default, and refuses a swap that is not an id', () => {
    const reg = createRegistry();
    expect(defineLevel('level:plain', { text: ROOM }, reg).materials).toEqual({});
    const swaps = { 'material:flagstone': 'material:planks' };
    expect(defineLevel('level:swapped', { text: ROOM, materials: swaps }, reg).materials).toEqual(swaps);
    const bad = { 'material:flagstone': 3 } as unknown as Record<string, string>;
    const error = errorOf(() => defineLevel('level:bad', { text: ROOM, materials: bad }, reg));
    expect([error.code, error.message]).toEqual([
      'CORE_BAD_SPEC',
      expect.stringContaining('materials["material:flagstone"]'),
    ]);
  });

  it('names the closest ids for a missing one', () => {
    const reg = createRegistry();
    defineLevel('level:room', { text: '#\n' }, reg);
    const error = errorOf(() => getLevel('level:rom', reg));
    expect(error.code).toBe('CORE_NO_ENTRY');
    expect(error.message).toContain('"level:room"');
  });
});
