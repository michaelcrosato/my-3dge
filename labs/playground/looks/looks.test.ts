/**
 * @file Unit tests for the playground's looks (labs/playground/looks/cel.ts, pixel.ts, pixelPerspective.ts): each
 * parses with every filter scoped, posterizes with 0 or 8 and more levels (the pixel looks with 24, as pixel art
 * wants), lights the playground with daylight in the toon style, and `node x set post.look <id>` switches to it; the
 * cel look's ramp, ink, shells and sky gradient (WP 13.24); the pixel look's art block from the lines, its snap and
 * glide, its dithered ramps, and its variant for the perspective cameras, unsnapped, sharing its style and sky.
 * @see labs/playground/looks/cel.ts
 * @see labs/playground/looks/pixel.ts
 * @see labs/playground/looks/pixelPerspective.ts
 */
import { describe, expect, it } from 'vitest';
import { registry } from '../../../engine/core/registry';
import '../../../engine/gfx/sky';
import { checkSetting } from '../../../tools/cmd/set';
import { look as cel } from './cel';
import { look as pixel } from './pixel';
import { look as variant } from './pixelPerspective';

describe.each([cel, pixel, variant])('$id', (look) => {
  it('parses: its description, and every filter with a scope', () => {
    expect(look.description).not.toBe('');
    for (const [name, filter] of Object.entries(look.filters)) expect(typeof filter.scope, name).toBe('string');
  });

  it('posterizes with 0 or 8 and more levels, so dull colours keep their hue', () => {
    for (const [name, filter] of Object.entries(look.filters)) {
      if ('levels' in filter) expect(filter.levels === 0 || filter.levels >= 8, `filters.${name}.levels`).toBe(true);
    }
  });

  it('lights the playground with daylight, a registered sky, in the toon style', () => {
    expect([look.sky, look.style]).toEqual(['sky:daylight', 'toon']);
    expect(registry.has('sky', look.sky)).toBe(true);
  });

  it('switches with node x set post.look: the chain draws this look, not the fallback', () => {
    const change = checkSetting('post.look', look.id);
    expect(change.value).toBe(look.id);
    expect(registry.get('look', String(change.value))).toBe(look);
  });
});

describe('look:playground-cel', () => {
  it('ramps every material in three bands and a rim with hue-shifted shadows, smoothed edges', () => {
    expect(cel.toon).toEqual({ bands: 3, rim: 0.35, shade: 0.7, dither: 0 });
  });

  it('inks 1 px at 270 lines, scaled with the picture, outlines the props and bodies, and draws a gradient sky', () => {
    expect(cel.filters.outline).toMatchObject({ scope: 'all', width: 1, lines: 270 });
    expect(cel.shells).toEqual({ width: 1, color: '#1a1420' });
    expect([cel.skyGradient, cel.perspective]).toEqual([1, '']);
  });
});

describe('look:playground-pixel', () => {
  it('draws the art block the lines give, snapped and gliding, with 1-pixel ink and 24 shades', () => {
    expect(pixel.filters.pixel).toMatchObject({ scope: 'all', size: 0, snap: true, smooth: true, outline: false });
    expect(pixel.filters.outline).toMatchObject({ scope: 'all', width: 1, lines: 270 });
    expect(pixel.filters.palette).toMatchObject({ scope: 'all', palette: 'none', levels: 24 });
  });

  it('ramps every material in four shades, the steps dithered, the shadows shifted in hue', () => {
    expect(pixel.toon.bands).toBe(4);
    expect([pixel.toon.dither > 0, pixel.toon.shade > 0]).toEqual([true, true]);
    expect(pixel.shells.width).toBe(0); // its ink is the outline filter's, a pixel wide
  });

  it('draws its variant for the perspective cameras: unsnapped, no glide, a lighter dither, its style and sky', () => {
    expect(pixel.perspective).toBe(variant.id);
    expect(variant.filters.pixel).toMatchObject({ size: 0, snap: false, smooth: false });
    expect(variant.toon.dither).toBeLessThan(pixel.toon.dither);
    expect([variant.style, variant.sky]).toEqual([pixel.style, pixel.sky]);
    const { pixel: own, ...rest } = pixel.filters;
    const { pixel: theirs, ...others } = variant.filters;
    expect([own.size, own.levels]).toEqual([theirs.size, theirs.levels]);
    expect(rest).toEqual(others);
  });
});
