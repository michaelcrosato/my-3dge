/**
 * @file Unit tests for the look a chain draws (engine/gfx/post/resolveLook.ts): the look `post.look` names with
 * `post.filters` laid over its filters (`post.combine`'s looks under them, `post.strength` over it all), the same
 * objects while the settings stay and new ones once they change; a perspective camera's variant, its filters and toon
 * numbers under the same layers, the look staying the look; and a layer's levels raised to 8, its advice given once.
 */
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../core/registry';
import { createSettings } from '../../core/settings';
import { defineLook, defineLooks } from './looks';
import { createLookResolver } from './resolveLook';
import { definePostSettings } from './settings';

/** A registry with the engine's looks and a look with a perspective variant, its settings, and a resolver over them. */
function setup() {
  const registry = createRegistry();
  definePostSettings(registry);
  defineLooks(registry);
  defineLook('look:test-variant', { description: 'For the perspective cameras.', toon: { bands: 5 }, filters: { pixel: { scope: 'all', size: 2 } } }, registry); // prettier-ignore
  defineLook('look:test-main', { description: 'Pixels, a variant for perspective.', perspective: 'look:test-variant', toon: { bands: 3 }, filters: { pixel: { scope: 'all', size: 4 } } }, registry); // prettier-ignore
  const settings = createSettings({ registry });
  const warned: string[] = [];
  const log = { warnOnce: (code: string) => (warned.push(code), true) };
  return { settings, warned, resolve: createLookResolver({ settings, registry, log }) };
}

describe('the look a chain draws', () => {
  it('is the look post.look names, post.filters laid over its filters, the same objects until a setting changes', () => {
    const { settings, resolve } = setup();
    settings.set('post.look', 'look:game-boy');
    const first = resolve();
    expect([first.look.id, first.chain.palette.palette]).toEqual(['look:game-boy', 'gameboy']);
    expect(resolve()).toBe(first);
    settings.set('post.filters', { palette: { palette: 'pico8' } });
    const layered = resolve();
    expect(layered).not.toBe(first);
    expect([layered.chain.palette.palette, layered.chain.palette.scope]).toEqual(['pico8', first.chain.palette.scope]);
  });

  it("gives a perspective camera the variant's filters and toon numbers under the same layer, the look its own", () => {
    const { settings, resolve } = setup();
    settings.set('post.look', 'look:test-main');
    settings.set('post.filters', { outline: { scope: 'all', width: 2 } });
    const [flat, deep] = [resolve(false), resolve(true)];
    expect([flat.chain.pixel.size, deep.chain.pixel.size]).toEqual([4, 2]);
    expect([flat.toon.bands, deep.toon.bands]).toEqual([3, 5]);
    expect([deep.look.id, deep.chain.outline.width]).toEqual(['look:test-main', 2]);
    expect(resolve(true)).toBe(deep);
    settings.set('post.look', 'look:game-boy'); // no variant: a perspective camera draws the look
    expect(resolve(true)).toBe(resolve(false));
  });

  it('lays post.combine over the look, then post.filters field by field, then scales it all by post.strength', () => {
    const { settings, resolve } = setup();
    settings.set('post.combine', [{ look: 'look:test-main', amount: 0.5 }]);
    const combined = resolve();
    expect([combined.look.id, combined.chain.pixel.scope, combined.chain.pixel.amount]).toEqual(['look:clean', 'all', 0.5]); // prettier-ignore
    expect(resolve()).toBe(combined);
    settings.set('post.filters', { pixel: { size: 6 } });
    settings.set('post.strength', 0.5);
    const layered = resolve();
    expect([layered.chain.pixel.size, layered.chain.pixel.amount]).toEqual([6, 0.25]);
    settings.set('post.look', 'look:test-main'); // a perspective camera's variant takes the same layers
    expect([resolve(true).chain.pixel.size, resolve(true).chain.pixel.amount]).toEqual([6, 0.5]);
  });

  it("raises a layer's levels under 8 to 8, its advice given once", () => {
    const { settings, warned, resolve } = setup();
    settings.set('post.filters', { palette: { scope: 'all', levels: 4 } });
    expect(resolve().chain.palette.levels).toBe(8);
    resolve();
    expect(warned).toEqual(['GFX_POST_FEW_LEVELS']);
  });
});
