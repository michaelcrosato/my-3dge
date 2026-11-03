/**
 * @file Unit tests for the filters as data (engine/gfx/post/filters.ts): scopes as masks, a chain's defaults (every
 * filter off, every amount 1) and when a chain is plain, layering, the posterize rule, every colour field's check, the
 * uniforms a chain writes (the new filters' too, and every amount in its slot), and amounts folded into the strengths
 * of the passes before the composite.
 */
import { describe, expect, it } from 'vitest';
import { validate } from '../../core/schema';
import {
  AMOUNT_SLOTS,
  chainOf,
  colorFields,
  createFilterUniforms,
  FILTER_FIELDS,
  FILTER_NAMES,
  fixColor,
  fixLevels,
  foldAmounts,
  isPlain,
  layerChain,
  levelsProblem,
  colorProblem,
  partialSchema,
  SCOPES,
  SCREEN_SCOPES,
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

  it('is plain only while every filter is off, whatever its numbers', () => {
    expect(isPlain(chainOf()), 'every filter off').toBe(true);
    expect(isPlain(chainOf({ grade: { saturation: 0 }, pixel: { size: 8 } })), 'numbers, scopes off').toBe(true);
    for (const name of FILTER_NAMES) {
      const scoped = (FILTER_FIELDS[name].properties.scope.enum as readonly string[]).includes('environment');
      expect(isPlain(chainOf({ [name]: { scope: scoped ? 'environment' : 'all' } })), name).toBe(false);
    }
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

describe('outline colours', () => {
  it("are hex, a CSS colour name or '' (darken): a layer drops another, so the line darkens", () => {
    expect(['', '#000', '#1A1a2e', 'black', 'RebeccaPurple'].map((c) => colorProblem(c, 'color'))).toEqual(Array(5).fill(null)); // prettier-ignore
    for (const bad of ['blakc', '#12', '#1234567', 'rgb(0, 0, 0)'])
      expect(colorProblem(bad, 'filters.outline.color')).toContain('which is no colour');
    const fixed = fixColor({ outline: { scope: 'all', color: 'blakc', width: 2 }, pixel: { size: 6 } });
    expect(fixed).toEqual({
      spec: { outline: { scope: 'all', width: 2 }, pixel: { size: 6 } },
      dropped: { where: 'outline.color', color: 'blakc' },
    });
    const kept = { outline: { color: '#ff0000' } };
    expect(fixColor(kept)).toEqual({ spec: kept, dropped: null });
  });

  it("cover every colour field, '' only where it is the default", () => {
    expect(colorFields().map(([name, key, empty]) => `${name}.${key}${empty ? " ''" : ''}`)).toEqual([
      'streaks.tint',
      "outline.color ''",
      'paper.color',
      'split.shadows',
      'split.highlights',
      'duotone.dark',
      'duotone.mid',
      'duotone.light',
      'speedlines.color',
      'vignette.color',
      'letterbox.color',
    ]);
    expect(colorProblem('', 'filters.duotone.dark', false)).toContain('which is no colour');
    const fixed = fixColor({ duotone: { scope: 'all', dark: '', light: 'navy' }, vignette: { color: 'nope' } });
    expect(fixed).toEqual({
      spec: { duotone: { scope: 'all', light: 'navy' }, vignette: {} },
      dropped: { where: 'duotone.dark', color: '' },
    });
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

describe('the filters Style Lab brought', () => {
  it('take their scopes: the camera and screen ones only off and all, the rest by part; every amount is 1', () => {
    const own = ['grain', 'chroma']; // their amount is their strength (engine/gfx/post/filterUniforms.ts)
    const screen = ['lens', 'dof', 'tiltshift', 'flare', 'streaks', 'crt', 'vhs', 'speedlines', 'vignette', 'letterbox'];
    for (const name of FILTER_NAMES) {
      const scopes = FILTER_FIELDS[name].properties.scope.enum as readonly string[];
      if (screen.includes(name)) expect(scopes, name).toEqual(SCREEN_SCOPES);
      if (!own.includes(name)) expect(chainOf()[name].amount, name).toBe(1);
    }
    expect(FILTER_FIELDS.duotone.properties.scope.enum).toEqual(SCOPES);
  });

  it('write their numbers, colours (sRGB) and kinds into their uniforms, and every amount into its slot', () => {
    const uniforms = createFilterUniforms();
    expect(uniforms.letterbox.value.toArray(), 'off').toEqual([0, 0, 0, 0]);
    writeFilters(
      uniforms,
      chainOf({
        lens: { scope: 'all', distortion: 0.2, amount: 0.5 },
        dof: { scope: 'all', focus: 4, range: 3, blur: 5 },
        paper: { scope: 'environment', kind: 'canvas', scale: 2, strength: 0.3, color: '#ffffff' },
        duotone: { scope: 'objects', dark: '#000000', mid: '#ff0000', light: '#ffffff', amount: 0.25 },
        letterbox: { scope: 'all', aspect: 2, color: '#ff0000' },
        pixel: { scope: 'all', amount: 0.4 },
      }),
    );
    expect(uniforms.lens.value.toArray()).toEqual([7, 0.1, 0, 0]); // the distortion scaled by its amount
    expect(uniforms.dof.value.toArray()).toEqual([7, 4, 3, 5]);
    expect(uniforms.paper.value.toArray()).toEqual([4, 2, 2, 0.3]);
    expect(uniforms.paper2.value.toArray().map((v) => Math.round(v * 1000) / 1000)).toEqual([1, 1, 1, 0]);
    expect([uniforms.duo1.value.w, Math.round(uniforms.duo2.value.x * 1000) / 1000, uniforms.am5.value.x]).toEqual([2, 1, 0.25]);
    expect(uniforms.letterbox.value.toArray().map((v) => Math.round(v * 1000) / 1000)).toEqual([2, 1, 0, 0]);
    expect(uniforms.pixel.value.x, 'blocks off under half their amount').toBe(0);
    writeFilters(uniforms, chainOf());
    expect([uniforms.am5.value.x, uniforms.lens.value.x]).toEqual([1, 0]);
  });

  it('have one amount slot each, every filter the composite draws but grain and chroma (their strength serves)', () => {
    const slots = Object.values(AMOUNT_SLOTS).map(([i, axis]) => `${i}${axis}`);
    expect(new Set(slots).size).toBe(slots.length);
    const before = ['ao', 'gi', 'ssr', 'air', 'bloom', 'aa', 'grain', 'chroma', 'lens'];
    expect(FILTER_NAMES.filter((name) => !before.includes(name) && !AMOUNT_SLOTS[name])).toEqual([]);
  });
});

describe('foldAmounts', () => {
  it("folds the amounts of the passes before the composite into their strengths, and is the chain itself at 1", () => {
    const chain = chainOf({ bloom: { scope: 'all', strength: 0.8 }, ao: { scope: 'all' } });
    expect(foldAmounts(chain)).toBe(chain);
    const half = foldAmounts(chainOf({ bloom: { scope: 'all', strength: 0.8, amount: 0.5 }, aa: { scope: 'all', amount: 0.4 } })); // prettier-ignore
    expect([half.bloom.strength, half.aa.scope]).toEqual([0.4, 'off']);
  });
});
