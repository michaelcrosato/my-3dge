/**
 * @file The catalogs' checks (PLAN.md §10.3 and §10.5 step 2, WP 8.1): each catalog SOURCES.md says came from
 * my-3d2dge is that file, apart from exactly the values its Changes cell names; and every catalog is well formed:
 * each entry `[tags, description, orig?]`, each `orig` a clip of the named set's catalog, each `$skip` and `$pick`
 * readable.
 *
 * "Apart from its changes" is proved twice: offline, by restoring the source's recorded values at the named pointers
 * and matching the source's recorded SHA-256 (`JSON.stringify` of the parsed file, so formatting never counts); and,
 * when the my-3d2dge checkout resolves, against the file itself (deferred: no source otherwise). Files that later WPs
 * bring from shardfall (WP 8.10) are proved by their own tests.
 *
 * @see data/anim/SOURCES.md
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { requireSource } from '../../../../../tools/lib/source';
import { readLedger } from '../ledger/ledger';
import { CATALOG_DIR, entries, readCatalogs, readSources } from '../sources/sources';
import { canonicalSha256, differences, sourceOrigin, valueAt, withValueAt } from './catalogs';

/** What my-3d2dge's catalogs were at e37e4ee: the SHA-256 of each as `JSON.stringify` writes it. */
const SOURCE_SHA256: Record<string, string> = {
  'src/mocap/catalogs/quaternius.json': 'afdf4b5542307e36f45a62b28d052f0466f29e44040d674af31d9ffeb83b9af5',
  'src/mocap/catalogs/mesh2motion.json': 'e809824caf552734ae3f37855029c4d67221092ad78d96e4525f63df0c85c6cd',
  'src/mocap/catalogs/cmu.json': 'a0d9b7522edb432910c7fa82c790ddd3e0ff065993b1f2749740978ff1dcff78',
};

/** The source's values at the pointers SOURCES.md names as changed, by source path. */
const SOURCE_VALUES: Record<string, Record<string, unknown>> = {
  'src/mocap/catalogs/cmu.json': {
    '/$sources/CMU/license': 'free for all uses (may be copied, modified, or redistributed without permission)',
  },
};

const catalogs = readCatalogs();
const copied = readSources()
  .files.filter((row) => row.file.startsWith('catalogs/'))
  .map((row) => ({ ...row, origin: sourceOrigin(row.from) }))
  .filter((row) => row.origin?.source === 'my-3d2dge');
const readCatalog = (file: string): unknown => JSON.parse(readFileSync(join(CATALOG_DIR, file), 'utf8'));

describe('the catalogs copied from my-3d2dge', () => {
  it('each have their source’s fingerprint recorded here (cmu and mesh2motion stay; WP 8.10 replaces quaternius)', () => {
    expect(copied.map((row) => row.file)).toEqual(
      expect.arrayContaining(['catalogs/cmu.json', 'catalogs/mesh2motion.json']),
    );
    for (const row of copied) expect(SOURCE_SHA256[row.origin?.path ?? ''], row.from).toBeDefined();
  });

  for (const row of copied) {
    const path = row.origin?.path ?? '';
    it(`${row.file} is ${path} apart from ${row.changed.length || 'no'} named change(s) (SHA-256)`, () => {
      expect(Object.keys(SOURCE_VALUES[path] ?? {}).sort(), 'the recorded values').toEqual([...row.changed].sort());
      let restored = readCatalog(row.file.slice('catalogs/'.length));
      for (const pointer of row.changed) {
        expect(valueAt(restored, pointer), `${pointer} changed`).not.toEqual(SOURCE_VALUES[path]?.[pointer]);
        restored = withValueAt(restored, pointer, SOURCE_VALUES[path]?.[pointer]);
      }
      expect(canonicalSha256(restored)).toBe(SOURCE_SHA256[path]);
    });

    it(`${row.file} differs from ${path} exactly where SOURCES.md says (needs the my-3d2dge checkout)`, (context) => {
      const source = JSON.parse(readFileSync(join(requireSource('my-3d2dge', context), path), 'utf8')) as unknown;
      expect(canonicalSha256(source), 'the recorded SHA-256').toBe(SOURCE_SHA256[path]);
      expect(differences(source, readCatalog(row.file.slice('catalogs/'.length)))).toEqual(row.changed);
      for (const pointer of row.changed) expect(valueAt(source, pointer)).toEqual(SOURCE_VALUES[path]?.[pointer]);
    });
  }
});

describe('every catalog', () => {
  const names = (file: string) => new Set(Object.keys(entries(catalogs[file] ?? { $sources: {} })));

  it('describes each clip as [tags, description] or [tags, description, orig]', () => {
    for (const [file, catalog] of Object.entries(catalogs)) {
      for (const [clip, entry] of Object.entries(entries(catalog))) {
        expect(Array.isArray(entry) && [2, 3].includes(entry.length), `${file}: ${clip}`).toBe(true);
        const [tags = '', desc = '', orig] = entry;
        expect(tags, `${file}: ${clip}'s tags`).toMatch(/^[a-z0-9-]+( [a-z0-9-]+)*$/);
        expect(desc.length > 10 && desc.trim() === desc, `${file}: ${clip}'s description`).toBe(true);
        if (orig !== undefined) expect(orig, `${file}: ${clip}'s orig`).toMatch(/^[A-Z0-9_]+\/.+$/);
      }
    }
  });

  it('names in each orig a clip of that set’s catalog', () => {
    for (const [file, catalog] of Object.entries(catalogs)) {
      for (const [clip, [, , orig]] of Object.entries(entries(catalog))) {
        if (orig === undefined) continue;
        const [set = '', name = ''] = orig.split('/');
        expect(names(`${set.toLowerCase()}.json`).has(name), `${file}: ${clip} is made from ${orig}`).toBe(true);
      }
    }
  });

  it('records each source with a label, origin, license and URL, and gives each skip a reason', () => {
    for (const [file, catalog] of Object.entries(catalogs)) {
      expect(Object.keys(catalog.$sources).length, file).toBeGreaterThan(0);
      for (const [id, record] of Object.entries(catalog.$sources)) {
        for (const field of ['label', 'origin', 'license', 'url'] as const) {
          expect(typeof record[field] === 'string' && record[field].length > 0, `${file}: ${id}.${field}`).toBe(true);
        }
      }
      for (const [clip, reason] of Object.entries(catalog.$skip ?? {})) {
        expect(reason.length, `${file}: $skip.${clip}`).toBeGreaterThan(20);
      }
    }
  });

  it('picks CMU stretches as [take, start?, end?, shortest cycle?], each clip once, inside its take', () => {
    const takes = new Map(readLedger().takes.map((take) => [take.id, take]));
    const picks = Object.entries(catalogs['cmu.json']?.$pick ?? {});
    expect(picks.map(([clip]) => clip).sort()).toEqual([...names('cmu.json')].sort());
    for (const [clip, [take, start, end, cycle]] of picks) {
      const sec = Number(takes.get(take)?.sec);
      expect(sec, `${clip}: take ${take}`).toBeGreaterThan(0);
      if (start !== undefined) expect(start >= 0 && start < sec, `${clip}: start ${start} in ${sec} s`).toBe(true);
      if (end !== undefined) expect(end > (start ?? 0) && end <= sec + 0.05, `${clip}: end ${end}`).toBe(true);
      if (cycle !== undefined) expect(cycle > 0 && cycle < (end ?? sec) - (start ?? 0), `${clip}: cycle`).toBe(true);
    }
  });
});
