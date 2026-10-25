/**
 * @file The acceptance of the eval task box-fog-preset (evals/box-fog-preset/prompt.md), run by `node x evals` in the
 * attempt's copy: labs/box/looks/moor.ts defines the sky `sky:moor` (grey, sunless, its ambient and fog as asked: range
 * fog from 4 m past the focus, whole at 40 m, height fog low on the floor) and the look `look:moor`, that sky over the
 * scene's own style with no filter, which `x set post.look` switches to.
 */
import { describe, expect, it } from 'vitest';
import { registry } from '../../engine/core/registry';
import { fogAt } from '../../engine/gfx/atmosphere';
import type { SkyEntry } from '../../engine/gfx/sky';
import { checkSetting } from '../../tools/cmd/set';
import '../../labs/box/looks/moor';

const sky = registry.get('sky', 'sky:moor') as SkyEntry;
const look = registry.get('look', 'look:moor') as unknown as { sky: string; style: string; filters: Record<string, { scope: string }> }; // prettier-ignore

describe('the moor', () => {
  it('is a grey, sunless sky with a soft light from above', () => {
    expect([sky.background.toLowerCase(), sky.sun.intensity]).toEqual(['#8a929a', 0]);
    const { sky: above, ground, intensity } = sky.ambient;
    expect([above.toLowerCase(), ground.toLowerCase(), intensity]).toEqual(['#9aa4ae', '#3a3f44', 1.4]);
  });

  it('fogs thickly from 4 m past the focus, whole at 40 m, and lies low on the floor', () => {
    const { fog } = sky;
    expect(fog.color.toLowerCase()).toBe('#a7afb7');
    expect(fog).toMatchObject({ start: 4, end: 40, amount: 0.9, floor: 0, ceiling: 2, height: 0.6 });
    const focus = 10;
    expect(fogAt(fog, focus + 3, 3, focus)).toBe(0); // clear near the hero, above the height fog
    expect(fogAt(fog, focus + 40, 3, focus)).toBeCloseTo(0.9, 6); // whole at 40 m
    expect(fogAt(fog, focus + 20, 0, focus)).toBeGreaterThan(fogAt(fog, focus + 20, 3, focus)); // thicker on the floor
  });

  it('is shown by look:moor over the scene’s own style, with no filter, which x set post.look switches to', () => {
    expect([look.sky, look.style]).toEqual(['sky:moor', '']);
    expect(Object.entries(look.filters).filter(([, filter]) => filter.scope !== 'off')).toEqual([]);
    expect(checkSetting('post.look', 'look:moor').value).toBe('look:moor');
  });
});
