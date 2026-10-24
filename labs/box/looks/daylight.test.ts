/**
 * @file Unit tests for the look `look:daylight` (labs/box/looks/daylight.ts): its entry parses, it posterizes with 0
 * or 8 and more levels, it lights the scene with the day sky, and `node x set post.look look:daylight`
 * switches to it: the look the chain then draws is this one, not the fallback.
 * @see labs/box/looks/daylight.ts
 */
import { describe, expect, it } from 'vitest';
import { registry } from '../../../engine/core/registry';
import '../../../engine/gfx/sky';
import { checkSetting } from '../../../tools/cmd/set';
import { look } from './daylight';

describe('look:daylight', () => {
  it('parses: its id, its description, and every filter with a scope', () => {
    expect(look.id).toBe('look:daylight');
    expect(look.description).not.toBe('');
    for (const [name, filter] of Object.entries(look.filters)) expect(typeof filter.scope, name).toBe('string');
  });

  it('posterizes with 0 or 8 and more levels, so dull colours keep their hue', () => {
    for (const [name, filter] of Object.entries(look.filters)) {
      if ('levels' in filter) expect(filter.levels === 0 || filter.levels >= 8, `filters.${name}.levels`).toBe(true);
    }
  });

  it('lights the scene with the day sky, a registered preset', () => {
    expect(look.sky).toBe('sky:daylight');
    expect(registry.has('sky', look.sky)).toBe(true);
  });

  it('switches with node x set post.look: the chain draws this look, not the fallback', () => {
    const change = checkSetting('post.look', look.id);
    expect(change.value).toBe(look.id);
    expect(registry.get('look', String(change.value))).toBe(look);
  });
});
