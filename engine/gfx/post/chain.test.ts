/**
 * @file Unit tests for the post chain's GPU-free parts (engine/gfx/post/chain.ts): its view settings, declared on the
 * shared registry and on another when asked, are reachable like any other and are kept out of the hash; and the edge
 * smoothing it draws, TRAA only while `feature:traa` is on (WP 11.5). The block grid the camera snaps to is
 * engine/gfx/post/grid.test.ts's.
 */
import { describe, expect, it } from 'vitest';
import { createRegistry, registry as sharedRegistry } from '../../core/registry';
import { createSettings } from '../../core/settings';
import { temporalAaFor } from '../features';
import { aaKindFor } from './aa';
import { definePostSettings, POST_SETTINGS } from './settings';

describe('the chain’s settings', () => {
  it('exist on the shared registry, and on another once a chain or an engine declares them', () => {
    expect(sharedRegistry.has('setting', 'post.look'), 'the shared registry has them, for x set in Node').toBe(true);
    const registry = createRegistry();
    const settings = createSettings({ registry });
    expect(() => settings.set('post.look', 'look:game-boy')).toThrow(/CORE_UNKNOWN_SETTING.*post\.look/);
    expect(() => settings.fromUrl('?post.look=look:game-boy')).toThrow(/post\.look/);
    definePostSettings(registry);
    definePostSettings(registry); // a second chain declares nothing new
    expect(settings.set('post.look', 'look:game-boy').value).toBe('look:game-boy');
    expect(settings.get('quality')).toBeDefined();
  });

  it('are view settings: a look id, part of a filter chain, what to show, the edge smoothing', () => {
    const registry = createRegistry();
    definePostSettings(registry);
    const settings = createSettings({ registry });
    expect(Object.keys(POST_SETTINGS)).toEqual(['post.look', 'post.filters', 'post.show', 'post.aa']);
    expect(() => settings.set('post.aa', 'msaa')).toThrow(/traa/);
    settings.set('post.aa', 'traa');
    expect(settings.setText('post.filters', '{"pixel":{"scope":"environment","size":6}}').value).toEqual({
      pixel: { scope: 'environment', size: 6 },
    });
    expect(() => settings.set('post.filters', { pixel: { sise: 6 } })).toThrow(/size/);
    expect(() => settings.set('post.show', 'depth')).toThrow(/parts/);
    settings.set('post.look', 'look:hd-2d');
    expect(Object.keys(settings.values({ view: false })).filter((path) => path.startsWith('post.'))).toEqual([]);
  });
});

describe("the chain's edge smoothing", () => {
  it('draws TRAA where post.aa asks only while feature:traa is on, else FXAA in its place, and the others as asked', () => {
    const report = (on: string[]) => ({ on, off: [], downgrades: [] });
    expect(temporalAaFor(report([]))).toBeNull();
    expect(temporalAaFor(report(['feature:traa']))).not.toBeNull();
    expect([aaKindFor('traa', false), aaKindFor('traa', true)]).toEqual(['fxaa', 'traa']);
    expect([aaKindFor('smaa', false), aaKindFor('fxaa', true)]).toEqual(['smaa', 'fxaa']);
  });
});
