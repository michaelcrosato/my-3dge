/**
 * @file Unit tests for the post chain's GPU-free parts (engine/gfx/post/chain.ts): its view settings, declared on the
 * shared registry and on another when asked, are reachable like any other and are kept out of the hash; and the block
 * grid the camera snaps to.
 */
import { describe, expect, it } from 'vitest';
import { createRegistry, registry as sharedRegistry } from '../../core/registry';
import { createSettings } from '../../core/settings';
import { snapBlock } from './chain';
import { definePostSettings, POST_SETTINGS } from './settings';
import { chainOf } from './filters';

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

describe('snapBlock', () => {
  it("snaps to pixel art's blocks only while the environment is pixel art, else to the screen's low resolution", () => {
    expect(snapBlock(chainOf())).toBe(1);
    expect(snapBlock(chainOf({ pixel: { scope: 'all', size: 6 } }))).toBe(6);
    expect(snapBlock(chainOf({ pixel: { scope: 'objects+environment', size: 5 } }))).toBe(5);
    expect(snapBlock(chainOf({ pixel: { scope: 'characters+objects', size: 5 } }))).toBe(1);
    expect(snapBlock(chainOf({ pixel: { scope: 'all', size: 6, snap: false } }))).toBe(1);
    expect(snapBlock(chainOf({ screen: { scope: 'all', pixelate: 3 } }))).toBe(3);
  });
});
