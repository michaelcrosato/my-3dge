/**
 * @file The library's provenance checks (PLAN.md §10.1, WP 8.6), rewritten from `my-3d2dge:tools/mocap-test.mjs` for
 * every set committed under `data/anim/sets/`: each set carries its credit and its sources, each source with a label,
 * an origin, a license and a URL, and a rest body of finite measurements; each clip names one of its set's sources
 * (`src`), and a clip made from another set's clip names it (`orig`, `SET/Clip`), which that set has; and the import
 * recorded each clip's fit against its capture, `[mean, worst]` in mm, for exactly the set's clips.
 *
 * What SOURCES.md and the catalogs say about the same libraries is tests/unit/data/anim/sources/'s and catalogs/'s.
 *
 * @see data/anim/SOURCES.md
 */
import { describe, expect, it } from 'vitest';
import { SET_DIRS, setOf } from '../../../anim/clip-parity';

/** Every set, joined, by its directory. */
const SETS = SET_DIRS.map((dir) => [dir, setOf(dir)] as const);
/** The sets by name (`QUATERNIUS`). */
const BY_NAME = new Map(SETS.map(([, set]) => [set.set, set]));

/** Every number in `value`, however deep. */
const numbers = (value: unknown): number[] =>
  typeof value === 'number' ? [value] : typeof value === 'object' && value ? Object.values(value).flatMap(numbers) : [];

describe('every set', () => {
  it.each(SETS)(
    '%s carries its credit and its sources, each with a label, origin, license, URL and rest body',
    (_, set) => {
      expect(set.credit?.length).toBeGreaterThan(20);
      const sources = Object.entries(set.sources ?? {});
      expect(sources.length).toBeGreaterThan(0);
      for (const [id, source] of sources) {
        for (const field of ['label', 'origin', 'license', 'url'] as const) {
          expect(source[field]?.trim().length, `${set.set} ${id}.${field}`).toBeGreaterThan(0);
        }
        expect(source.url, `${set.set} ${id}.url`).toMatch(/^https?:\/\//);
        const rest = numbers(source.rest);
        expect(rest.length, `${set.set} ${id}.rest`).toBeGreaterThan(40);
        expect(rest.every(Number.isFinite), `${set.set} ${id}.rest`).toBe(true);
      }
    },
  );

  it.each(SETS)('%s records the fit of each of its clips, and of no other', (_, set) => {
    expect(Object.keys(set.fit ?? {}).sort()).toEqual(Object.keys(set.clips).sort());
    for (const [name, fit] of Object.entries(set.fit ?? {})) {
      expect(fit.length === 2 && fit[0] >= 0 && fit[0] <= fit[1], `${set.set}/${name}: fit ${fit}`).toBe(true);
    }
  });
});

describe('every clip', () => {
  it('names one of its set’s sources', () => {
    const unknown = SETS.flatMap(([, set]) =>
      Object.entries(set.clips)
        .filter(([, clip]) => clip.src === undefined || !Object.hasOwn(set.sources ?? {}, clip.src))
        .map(([name, clip]) => `${set.set}/${name}: src ${clip.src}`),
    );
    expect(unknown).toEqual([]);
  });

  it('made from another set’s clip names it, SET/Clip, which that set has: Mesh2Motion’s 84 re-exports', () => {
    const made = SETS.flatMap(([, set]) =>
      Object.entries(set.clips).flatMap(([name, clip]) =>
        clip.orig === undefined ? [] : [[set.set, name, clip.orig]],
      ),
    );
    expect(made).toHaveLength(84);
    for (const [set, name, orig] of made) {
      const [from = '', clip = ''] = orig.split('/');
      expect(set, `${set}/${name}`).toBe('MESH2MOTION');
      expect(BY_NAME.get(from)?.clips[clip], `${set}/${name}: orig ${orig}`).toBeDefined();
    }
  });
});
