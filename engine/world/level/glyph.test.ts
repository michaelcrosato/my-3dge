/**
 * @file Unit tests for engine/world/level/glyph.ts and legend.ts (T1): the v1 legend on every registry, with
 * PLAN.md Appendix C's heights; `defineGlyph` filling defaults and refusing each malformed glyph with a sentence that
 * names the field; `legendOf` keyed by character.
 * @see engine/world/level/glyph.ts
 * @see engine/world/level/legend.ts
 */
import { describe, expect, it } from 'vitest';
import { EngineError } from '../../core/log';
import { createRegistry, registry as shared } from '../../core/registry';
import { defineGlyph, legendOf, type GlyphSpec } from './glyph';

/** The message of the EngineError `fn` throws. */
function errorOf(fn: () => unknown): EngineError {
  try {
    fn();
  } catch (error) {
    if (error instanceof EngineError) return error;
    throw error;
  }
  throw new Error('expected an EngineError');
}

describe('the v1 legend', () => {
  it('is on the shared registry and on any registry the level code touches', () => {
    expect([...legendOf(shared).keys()].sort()).toEqual([
      '#',
      '.',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '@',
      'P',
      'w',
    ]);
    expect(legendOf(createRegistry()).size).toBe(14);
  });

  it("uses Appendix C's heights, in metres", () => {
    const legend = legendOf(createRegistry());
    const pick = (char: string) => {
      const g = legend.get(char)!;
      return [g.id, g.floor, g.top, g.solid, g.collider, g.mesh, g.nav.walkable, g.nav.standable, g.footprint];
    };
    expect(pick('.')).toEqual(['glyph:floor', 0, 0, false, 'none', 'floor', true, false, 1]);
    expect(pick('#')).toEqual(['glyph:wall', 0, 3, true, 'box', 'wall', false, false, 1]);
    expect(pick('w')).toEqual(['glyph:lowWall', 0, 0.75, true, 'box', 'lowWall', false, true, 1]);
    expect(pick('P')).toEqual(['glyph:pillar', 0, 3.5, true, 'box', 'pillar', false, false, 2]);
    expect([legend.get('@')!.spawn, legend.get('7')!.spawn, legend.get('7')!.id]).toEqual([
      'hero',
      '7',
      'glyph:marker7',
    ]);
  });
});

describe('defineGlyph', () => {
  it('fills the defaults and joins the legend', () => {
    const reg = createRegistry();
    const glyph = defineGlyph(
      'glyph:torch',
      { char: 't', description: 'A torch spot.', light: 'torch', lightHeight: 1.5 },
      reg,
    );
    expect(glyph).toMatchObject({ floor: 0, top: 0, solid: false, collider: 'none', mesh: 'none', surface: 'stone' });
    expect(glyph.nav).toEqual({ walkable: true, standable: false });
    expect(legendOf(reg).get('t')?.id).toBe('glyph:torch');
  });

  it('refuses each malformed glyph, naming the problem', () => {
    const problems = (spec: GlyphSpec) => errorOf(() => defineGlyph('glyph:bad', spec, createRegistry())).message;
    expect(problems({ char: '#' })).toContain('char "#" already writes glyph:wall; pick another character');
    expect(problems({ char: 'ab' })).toContain('char is "ab"; it must be exactly one character');
    expect(problems({ char: ' ' })).toContain('a map character cannot be whitespace');
    expect(problems({ char: 'x', floor: 1, top: 0.5 })).toContain('top 0.5 is below floor 1');
    expect(problems({ char: 'x', solid: true })).toContain(
      'a solid glyph is not walkable: add nav: { walkable: false }',
    );
    expect(problems({ char: 'x', spawn: 'a b' })).toContain('spawn "a b" must be a word');
    expect(problems({ char: 'x', light: 'a:b' })).toContain('light "a:b" must be a word');
    expect(problems({ char: 'x', collider: 'box' })).toContain('a box collider needs a top above 0');
    expect(problems({ char: 'x', mesh: '' })).toContain("mesh is empty; name a recipe, or 'none'");
    expect(problems({ char: 'x', footprint: 0 })).toContain('footprint is 0, below its minimum 1');
    expect(problems({ char: 'x', collider: 'hull' as 'box' })).toContain(
      'collider is "hull", not one of "none", "box"',
    );
    expect(errorOf(() => defineGlyph('glyph:bad', { char: '#' }, createRegistry())).code).toBe('CORE_BAD_SPEC');
  });

  it('refuses an id defined twice', () => {
    const reg = createRegistry();
    defineGlyph('glyph:x', { char: 'x' }, reg);
    expect(errorOf(() => defineGlyph('glyph:x', { char: 'y' }, reg)).code).toBe('CORE_DUPLICATE_ID');
  });
});
