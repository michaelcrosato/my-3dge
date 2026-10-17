/**
 * @file Unit tests for the playground's two looks (labs/playground/looks/cel.ts, pixel.ts): each parses with every
 * filter scoped, posterizes with 0 or 8 and more levels (the pixel look with 24, as pixel art wants), lights the
 * playground with daylight, and `node x set post.look <id>` switches to it, so the chain draws this look and not the
 * fallback.
 * @see labs/playground/looks/cel.ts
 * @see labs/playground/looks/pixel.ts
 */
import { describe, expect, it } from 'vitest';
import { registry } from '../../../engine/core/registry';
import '../../../engine/gfx/sky';
import { checkSetting } from '../../../tools/cmd/set';
import { look as cel } from './cel';
import { look as pixel } from './pixel';

describe.each([cel, pixel])('$id', (look) => {
  it('parses: its description, and every filter with a scope', () => {
    expect(look.description).not.toBe('');
    for (const [name, filter] of Object.entries(look.filters)) expect(typeof filter.scope, name).toBe('string');
  });

  it('posterizes with 0 or 8 and more levels, so dull colours keep their hue', () => {
    for (const [name, filter] of Object.entries(look.filters)) {
      if ('levels' in filter) expect(filter.levels === 0 || filter.levels >= 8, `filters.${name}.levels`).toBe(true);
    }
  });

  it('lights the playground with daylight, a registered sky', () => {
    expect(look.sky).toBe('sky:daylight');
    expect(registry.has('sky', look.sky)).toBe(true);
  });

  it('switches with node x set post.look: the chain draws this look, not the fallback', () => {
    const change = checkSetting('post.look', look.id);
    expect(change.value).toBe(look.id);
    expect(registry.get('look', String(change.value))).toBe(look);
  });
});

describe('look:playground-pixel', () => {
  it('cuts the whole picture into blocks with a rim, 24 shades a channel, lightly dithered', () => {
    expect(pixel.filters.pixel).toMatchObject({ scope: 'all', size: 3, outline: true });
    expect(pixel.filters.palette).toMatchObject({ scope: 'all', palette: 'none', levels: 24 });
    expect(pixel.filters.palette.dither).toBeGreaterThan(0);
  });
});
