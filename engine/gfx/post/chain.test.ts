/**
 * @file Unit tests for the post chain's GPU-free parts (engine/gfx/post/chain.ts): its view settings, reachable like
 * any other and kept out of the hash, and the block grid the camera snaps to.
 */
import { describe, expect, it } from 'vitest';
import { createSettings } from '../../core/settings';
import { POST_SETTINGS, snapBlock } from './chain';
import { chainOf } from './filters';

describe('the chain’s settings', () => {
  it('are view settings: a look id, part of a filter chain, what to show', () => {
    const settings = createSettings();
    expect(Object.keys(POST_SETTINGS)).toEqual(['post.look', 'post.filters', 'post.show']);
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
