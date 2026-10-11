/**
 * @file Unit tests for engine/world/level/glyph.ts and legend.ts (T1): the v1 and v2 legend on every registry, with
 * PLAN.md Appendix C's heights and the prototype hall's sizes; `defineGlyph` filling defaults and refusing each
 * malformed glyph (its floor shape and collider included) with a sentence that names the field; `legendOf` keyed by
 * character.
 * @see engine/world/level/glyph.ts
 * @see engine/world/level/legend.ts
 */
import { describe, expect, it } from 'vitest';
import { EngineError } from '../../core/log';
import { createRegistry, registry as shared } from '../../core/registry';
import { defineGlyph, legendOf, type GlyphSpec } from './glyph';
import { V2_GLYPHS } from './legend';

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

describe('the v1 and v2 legend', () => {
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
      '=',
      '@',
      'P',
      '^',
      'o',
      't',
      'w',
    ]);
    expect(legendOf(createRegistry()).size).toBe(18);
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

  it("has the hall's v2 glyphs, in metres: a gallery 1 m up, stairs up to it, the dais 0.5 m up, braziers", () => {
    const legend = legendOf(createRegistry());
    const pick = (char: string) => {
      const g = legend.get(char)!;
      return [g.id, g.floor, g.top, g.floorShape, g.solid, g.collider, g.mesh, g.nav.walkable];
    };
    expect(pick('=')).toEqual(['glyph:gallery', 1, 1, 'flat', false, 'box', 'gallery', true]);
    expect(pick('^')).toEqual(['glyph:stairs', 0, 1, 'ramp', false, 'hull', 'stairs', true]);
    expect(pick('o')).toEqual(['glyph:dais', 0, 0.5, 'dais', false, 'hull', 'dais', true]);
    expect(pick('t')).toEqual(['glyph:brazier', 0, 0.75, 'flat', true, 'cylinder', 'brazier', false]);
    // The prototype's units, 16 to the metre: the dais's edge 24, a brazier 5 across and its torch 16 up.
    const [dais, brazier] = [legend.get('o')!, legend.get('t')!];
    expect([dais.edge, brazier.radius, brazier.top + brazier.lightHeight, brazier.light]).toEqual([
      24 / 16,
      5 / 16,
      16 / 16,
      'torch',
    ]);
    expect(V2_GLYPHS['glyph:stairs'].char).toBe('^');
  });
});

describe('defineGlyph', () => {
  it('fills the defaults and joins the legend', () => {
    const reg = createRegistry();
    const glyph = defineGlyph(
      'glyph:torch',
      { char: 'T', description: 'A torch spot.', light: 'torch', lightHeight: 1.5 },
      reg,
    );
    expect(glyph).toMatchObject({ floor: 0, top: 0, solid: false, collider: 'none', mesh: 'none', surface: 'stone' });
    expect(glyph).toMatchObject({ floorShape: 'flat', edge: 0, radius: 0 });
    expect(glyph.nav).toEqual({ walkable: true, standable: false });
    expect(legendOf(reg).get('T')?.id).toBe('glyph:torch');
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
    expect(problems({ char: 'x', collider: 'sphere' as 'box' })).toContain(
      'collider is "sphere", not one of "none", "box", "hull", "cylinder"',
    );
    expect(problems({ char: 'x', floorShape: 'ramp', top: 0 })).toContain(
      'a ramp rises: give it a top above its floor',
    );
    expect(problems({ char: 'x', floorShape: 'ramp', top: 1, solid: true, nav: { walkable: false } })).toContain(
      'a ramp is walked on: it cannot be solid',
    );
    expect(problems({ char: 'x', floorShape: 'ramp', top: 1, collider: 'box' })).toContain(
      "a ramp's collider is 'hull' (under its slope) or 'none', not 'box'",
    );
    expect(problems({ char: 'x', floorShape: 'dais', top: 1 })).toContain('a dais needs an edge above 0');
    expect(problems({ char: 'x', top: 1, collider: 'hull' })).toContain(
      "a hull collider follows the floor's slope: give it floorShape: 'ramp' or 'dais'",
    );
    expect(problems({ char: 'x', top: 1, collider: 'cylinder' })).toContain(
      'a cylinder collider needs a radius above 0',
    );
    expect(problems({ char: 'x', radius: 0.2, collider: 'cylinder' })).toContain(
      'a cylinder collider stands from floor to top: give it a top above its floor',
    );
    expect(errorOf(() => defineGlyph('glyph:bad', { char: '#' }, createRegistry())).code).toBe('CORE_BAD_SPEC');
  });

  it('refuses an id defined twice', () => {
    const reg = createRegistry();
    defineGlyph('glyph:x', { char: 'x' }, reg);
    expect(errorOf(() => defineGlyph('glyph:x', { char: 'y' }, reg)).code).toBe('CORE_DUPLICATE_ID');
  });
});
