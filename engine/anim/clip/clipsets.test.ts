/**
 * @file Tests engine/anim/clip/clipsets.ts (WP 8.9): a set registers as a `clipset` entry, once, the same set again
 * returning it and a different one refused; `describe` lists the kind's fields and ids; a set directory's files join
 * as tools/anim/repack.ts joins them (the Quaternius set, read both ways); `defineSetBuild` registers the build of a
 * set's rest body, once; a `ClipLayerPool` loads each set once, keeps its layers' make, and loads each layer from the
 * data at every `get`.
 */
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../core/registry';
import { restBuild } from './rest';
import { readSet, readSetDir, SETS_DIR } from '../../../tools/anim/repack';
import { busy, REST, standing } from '../../../tests/unit/anim/clip-fixtures';
import {
  clipSetFromFiles,
  clipSetIds,
  ClipLayerPool,
  defineClipSet,
  defineSetBuild,
  emptyClipState,
  getClipSet,
} from './clipsets';
import { join } from 'node:path';

/** A small set: a stand and a wave, measured on REST. */
const set = (name = 'TEST', extra = {}) => ({
  set: name,
  title: 'Test',
  credit: 'Ours.',
  sources: { A: { rest: REST, label: 'A' } },
  clips: {
    Stand: { src: 'A', dur: 1, loop: true, keys: [standing(0), standing(1)] },
    Wave: { src: 'A', dur: 0.5, keys: [standing(0), busy(0.25), standing(0.5)], ...extra },
  },
});

describe('clip sets in the registry', () => {
  it('registers a set as clipset:<name>, once; the same set again is the same entry, another is refused', () => {
    const registry = createRegistry();
    const entry = defineClipSet(set(), { registry });
    expect([entry.id, entry.kind, entry.set, Object.keys(entry.clips)]).toEqual(['clipset:test', 'clipset', 'TEST', ['Stand', 'Wave']]); // prettier-ignore
    expect(Object.isFrozen(entry.clips.Wave.keys[1])).toBe(true);
    expect(defineClipSet(JSON.stringify(set()), { registry })).toBe(entry);
    expect(() => defineClipSet(set('TEST', { loop: true }), { registry })).toThrow(/CORE_DUPLICATE_ID/);
    expect(getClipSet('clipset:test', registry)).toBe(entry);
    defineClipSet(set('ANOTHER'), { registry });
    expect(clipSetIds(registry)).toEqual(['clipset:another', 'clipset:test']);
    const described = registry.describe('clipset');
    expect(described.ids).toEqual(['clipset:another', 'clipset:test']);
    expect(described.fields.map((field) => field.key)).toContain('credit');
  });

  it('refuses a broken clip with its code, and a missing set names defineClipSet', () => {
    const registry = createRegistry();
    const broken = { ...set(), clips: { Bad: { src: 'A', keys: [{ t: 0 }] } } };
    expect(() => defineClipSet(broken, { registry })).toThrow(/ANIM_CLIP_MISSING_FIELD/);
    expect(() => getClipSet('clipset:nope', registry)).toThrow(/defineClipSet/);
  });

  it('joins a set directory’s files as the tools do: the Quaternius set, read both ways', () => {
    const dir = join(SETS_DIR, 'quaternius');
    const joined = clipSetFromFiles(readSetDir(dir), 'data/anim/sets/quaternius');
    const read = readSet('quaternius');
    expect(Object.keys(joined.clips)).toEqual(Object.keys(read.clips));
    expect(joined).toEqual(read);
    expect(() => clipSetFromFiles({ 'Stand.json': '{}' }, 'here')).toThrow(/ANIM_CLIP_BAD_HEADER.*here/);
    expect(() => clipSetFromFiles({ '_set.json': '{' }, 'here')).toThrow(/ANIM_CLIP_NOT_JSON.*here\/_set\.json/);
  });

  it('registers the build a set’s clips were captured on, once', () => {
    const registry = createRegistry();
    defineClipSet(set(), { registry });
    const build = defineSetBuild('build:test', 'clipset:test', { registry });
    expect(build.legUpper).toBeCloseTo(restBuild(REST).legUpper!, 12);
    expect(defineSetBuild('build:test', 'clipset:test', { registry })).toBe(build);
    expect(() => defineSetBuild('build:other', 'clipset:test', { source: 'B', registry })).toThrow(/ANIM_NO_REST/);
  });
});

describe('ClipLayerPool', () => {
  it('loads each set once a pool, and each layer from its data at every get', () => {
    const registry = createRegistry();
    defineClipSet(set(), { registry });
    const pool = new ClipLayerPool(registry);
    expect(pool.library('clipset:test')).toBe(pool.library('clipset:test'));
    expect(new ClipLayerPool(registry).library('clipset:test')).not.toBe(pool.library('clipset:test'));
    const data = { sets: ['clipset:test'], ik: true, blade: 0, state: emptyClipState() };
    const layer = pool.get(1, data, 'build:heroic');
    layer.play('Wave', { fade: 0 });
    for (let i = 0; i < 6; i++) layer.step();
    expect(layer.current?.clip).toBe('TEST/Wave');
    expect(layer.current?.t).toBeCloseTo(0.1, 12);
    data.state = layer.save();
    expect(pool.get(1, { ...data, state: emptyClipState() }, 'build:heroic')).toBe(layer); // the same make
    expect(layer.current).toBeNull(); // loaded from the data given
    expect(pool.get(1, data, 'build:heroic').current?.t).toBeCloseTo(0.1, 12);
    expect(pool.get(1, { ...data, ik: false }, 'build:heroic')).not.toBe(layer); // another make
    pool.prune(() => false);
    expect(pool.get(1, data, 'build:heroic')).not.toBe(layer);
  });
});
