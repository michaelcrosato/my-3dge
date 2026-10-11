/**
 * @file Unit tests for the filters as data (engine/gfx/post/filters.ts): scopes as masks, a chain's defaults (every
 * filter off), layering, the posterize rule, and the uniforms a chain writes.
 */
import { describe, expect, it } from 'vitest';
import { validate } from '../../core/schema';
import {
  chainOf,
  createFilterUniforms,
  FILTER_FIELDS,
  FILTER_NAMES,
  fixLevels,
  layerChain,
  levelsProblem,
  partialSchema,
  SCOPES,
  scopeMask,
  writeFilters,
} from './filters';

describe('scopeMask', () => {
  it('gives each scope its parts as bits: characters 1, objects 2, environment 4', () => {
    expect(SCOPES.map(scopeMask)).toEqual([0, 7, 1, 2, 4, 3, 5, 6]);
  });
});

describe('a filter chain', () => {
  it('has every filter, each off by default', () => {
    const chain = chainOf();
    expect(Object.keys(chain).sort()).toEqual([...FILTER_NAMES].sort());
    for (const name of FILTER_NAMES) expect(chain[name].scope, name).toBe('off');
  });

  it('layers filter by filter and field by field', () => {
    const chain = chainOf({ pixel: { scope: 'all', size: 6 }, grade: { scope: 'environment', saturation: 0 } });
    const layered = layerChain(chain, { pixel: { scope: 'characters' }, cel: { scope: 'all' } });
    expect(layered.pixel).toMatchObject({ scope: 'characters', size: 6 });
    expect(layered.grade).toMatchObject({ scope: 'environment', saturation: 0 });
    expect(layered.cel).toMatchObject({ scope: 'all', bands: 4 });
  });

  it('validates a partial chain without filling its defaults (the setting `post.filters`)', () => {
    const schema = partialSchema(FILTER_FIELDS);
    expect(validate(schema, { pixel: { size: 6 } })).toEqual({ value: { pixel: { size: 6 } }, problems: [] });
    expect(validate(schema, { pixel: { sise: 6 } }).problems[0].message).toContain('did you mean "size"');
    expect(validate(schema, { bloom: { scope: 'characters' } }).problems).toHaveLength(1);
  });
});

describe('levels', () => {
  it('are 0 or 8 and more: fewer shift the hue of dull colours', () => {
    expect([0, 8, 24].map((levels) => levelsProblem(levels, 'levels'))).toEqual([null, null, null]);
    expect(levelsProblem(4, 'filters.palette.levels')).toContain('8 levels and more');
    const fixed = fixLevels({ palette: { levels: 4, dither: 0.8 }, pixel: { levels: 24 } });
    expect(fixed.spec).toEqual({ palette: { levels: 8, dither: 0.8 }, pixel: { levels: 24 } });
    expect(fixed.raised).toEqual([{ name: 'palette', levels: 4 }]);
  });
});

describe('writeFilters', () => {
  it('writes each filter into its uniforms: masks, numbers, the palette and style by index, colours as sRGB', () => {
    const uniforms = createFilterUniforms();
    expect(uniforms.pixel.value.toArray()).toEqual([0, 4, 0, 1]);
    writeFilters(
      uniforms,
      chainOf({
        pixel: { scope: 'environment', size: 6, levels: 24, outline: false },
        palette: { scope: 'characters+objects', palette: 'pico8', dither: 0.4 },
        outline: { scope: 'all', color: '#ff0000', width: 2 },
        stylize: { scope: 'objects', style: 'ascii', size: 8 },
        chroma: { scope: 'all', amount: 0.3 },
        screen: { scope: 'all', vignette: 0.5 },
      }),
    );
    expect(uniforms.pixel.value.toArray()).toEqual([4, 6, 24, 0]);
    expect(uniforms.palette.value.toArray()).toEqual([3, 2, 8, 0.4]);
    expect(uniforms.outline.value.toArray()).toEqual([7, 2, 0.35, 0.02]);
    expect(uniforms.outline2.value.toArray().map((v) => Math.round(v * 1000) / 1000)).toEqual([1, 0, 0, 1]);
    expect(uniforms.stylize.value.toArray()).toEqual([2, 3, 8, 1]);
    expect(uniforms.grain.value.toArray()).toEqual([0, 0.35, 7, 0.3]);
    expect(uniforms.screen.value.toArray()).toEqual([7, 0, 0.5, 1]);
  });
});
