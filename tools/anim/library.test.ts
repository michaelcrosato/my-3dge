/**
 * @file Tests for the animation library in Node (tools/anim/library.ts): `defineLibrary` registers every set of
 * data/anim/sets/ and the mannequin, once per registry, and the registry ends with the very entries the box page
 * registers (labs/box/library.ts `loadLibrary`, given the same files as text), so clip mode's replays hold one set of
 * goldens in Node and in Chromium; the tools' own join of a set (tools/anim/repack.ts `readSet`) gives the same sets.
 * @see tools/anim/library.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clipSetIds, getClipSet } from '../../engine/anim/clip/clipsets';
import { createRegistry, registry as sharedRegistry, sameValue } from '../../engine/core/registry';
import { loadLibrary } from '../../labs/box/library';
import { walk } from '../lib/docs';
import { ROOT } from '../x';
import { defineLibrary, libraryDirs } from './library';
import { readSet, readSetDir } from './repack';

describe('defineLibrary', () => {
  it('registers every set, sorted, then the mannequin, once per registry', () => {
    const registry = createRegistry();
    let reads = 0;
    const read: typeof readSetDir = (dir) => (reads++, readSetDir(dir));
    const ids = defineLibrary(registry, read);
    expect(reads).toBe(libraryDirs().length);
    expect(libraryDirs()).toEqual([...libraryDirs()].sort());
    expect(ids).toEqual(libraryDirs().map((dir) => `clipset:${dir}`));
    expect(ids).toContain('clipset:quaternius');
    expect([registry.has('build', 'build:mannequin'), registry.has('body', 'body:mannequin')]).toEqual([true, true]);
    expect(defineLibrary(registry, read)).toEqual(ids);
    expect(reads).toBe(libraryDirs().length); // nothing read again
  });

  it('ends with the entries the box page registers, and the sets the tools join', async () => {
    const registry = createRegistry();
    defineLibrary(registry);
    const files = walk(ROOT, 'data/anim/sets').filter((file) => /^data\/anim\/sets\/[^/]+\/[^/]+\.json$/.test(file));
    const loaders = Object.fromEntries(files.map((file) => [file, async () => readFileSync(join(ROOT, file), 'utf8')]));
    expect(await loadLibrary(loaders)).toEqual(clipSetIds(registry));
    for (const id of clipSetIds(registry)) {
      expect(sameValue(getClipSet(id, registry), getClipSet(id, sharedRegistry)), id).toBe(true);
      const { id: _id, kind: _kind, ...set } = getClipSet(id, registry);
      expect(sameValue(set, readSet(id.slice('clipset:'.length))), id).toBe(true);
    }
    expect(sameValue(registry.get('body', 'body:mannequin'), sharedRegistry.get('body', 'body:mannequin'))).toBe(true);
  });
});
