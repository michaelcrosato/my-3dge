/**
 * @file The sets' checks (PLAN.md §10.3 and §10.5 steps 4 and 5, WPs 8.3 and 8.10): `data/anim/sets/` holds ten
 * sets, each a directory of one `<Clip_Slug>.json` per clip, `_set.json` and a generated `catalog.tsv` (repack.ts):
 * - my-3d2dge's two curated sets left after WP 8.10, `mesh2motion` and `cmu` (HERO dropped). Rejoined, each is the
 *   source's object, apart from the `alt` tag on each of Mesh2Motion's 84 Quaternius re-exports, and the license in
 *   each of `cmu`'s 25 source records: CMU's terms, as the CMU catalog states them (WP 8.5; my-3d2dge's said "free for
 *   all uses"), which `x anim import --cmu --legacy` writes;
 * - shardfall's eight (tools/anim/shardfall.ts): 100STYLE's seven `style100*` sets and Quaternius v2's `quaternius`,
 *   which replaced v1's. Rejoined, each is shardfall's file, apart from its `body`, the `via` marks and, in
 *   `quaternius`, `Punch_Enter`, kept from v1 (its clip and its `fit` entry).
 * Every clip file is its clip's `text()`, so `text()` output is unchanged.
 *
 * "The source's object" is proved twice: offline, by the SHA-256 of `JSON.stringify` of each rejoined set with those
 * changes taken off, against the source's recorded here (key order included, so the clips' order and every field's
 * order count, not only the values); and, when the checkout resolves (else deferred: no source), against the source
 * itself: deep-equal, the same `text()` for every clip, and the tool writing exactly the committed files.
 *
 * @see tools/anim/repack.ts
 * @see tools/anim/shardfall.ts
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clipText } from '../../../../../engine/anim/clip/lens';
import type { Clip } from '../../../../../engine/anim/clip/readable';
import { parseClip, type ClipSet } from '../../../../../engine/anim/clip/validate';
import {
  ALT_TAG,
  CATALOG_COLUMNS,
  CATALOG_FILE,
  catalogTsv,
  clipSlug,
  joinSet,
  legacySetFiles,
  readSet,
  readSetDir,
  SET_FILE,
  SETS_DIR,
  splitSet,
} from '../../../../../tools/anim/repack';
import { shardfallSet } from '../../../../../tools/anim/shardfall';
import { requireSource } from '../../../../../tools/lib/source';
import { legacy } from '../../../anim/clip-fixtures';
import { canonicalSha256 } from '../catalogs/catalogs';

/** Where a set came from: its checkout, its file there, its clips, and the SHA-256 of the source's object. */
interface SourceSet {
  source: 'my-3d2dge' | 'shardfall';
  from: string;
  clips: number;
  sha256: string;
}

/** Each set, by directory: my-3d2dge@e37e4ee's (WP 8.3) and shardfall@fa2dab6's (WP 8.10). */
const SOURCE_SETS: Record<string, SourceSet> = {
  mesh2motion: {
    source: 'my-3d2dge',
    from: 'src/mocap/sets/mesh2motion.js',
    clips: 177,
    sha256: '93997b1ee3de44e7be628af3f78452e89431f42736112ed79f974f22744a0598',
  },
  cmu: {
    source: 'my-3d2dge',
    from: 'src/mocap/sets/cmu.js',
    clips: 60,
    sha256: '042068d134e719cfc0213c8e2259af5159ecdb118ac2e12ef6621b843dd33727',
  },
  quaternius: {
    source: 'shardfall',
    from: 'anim/quaternius.json',
    clips: 103,
    sha256: 'baacfa6dd1c0c55c9fec00cc663379cd5df8b435a712e6a8d6ef84a3a4e3a1e3',
  },
  style100: {
    source: 'shardfall',
    from: 'anim/style100.json',
    clips: 98,
    sha256: '4fc08f04d8b9d5f71b7472e2c90c73085a0c0693b2a1217696eaa9a445869b53',
  },
  style100_back: {
    source: 'shardfall',
    from: 'anim/100style/style100_back.json',
    clips: 98,
    sha256: 'a957e68d0064538d346d3ed969800a0917f3d6b9ee349c7e8685e475cf3c589f',
  },
  style100_backrun: {
    source: 'shardfall',
    from: 'anim/100style/style100_backrun.json',
    clips: 98,
    sha256: '651f523806f0388d5bdeee176fcb031877d630314b0957cd8710c237e11b50d5',
  },
  style100_idle: {
    source: 'shardfall',
    from: 'anim/100style/style100_idle.json',
    clips: 98,
    sha256: 'b0693101d3e73633317cd6f46579c26ad5f274d711b7768c4b67cf24c274cd17',
  },
  style100_run: {
    source: 'shardfall',
    from: 'anim/100style/style100_run.json',
    clips: 98,
    sha256: 'a577c74d7b77ce5f887cb10a39ba82547d5dc7520ad2b568115f43f9a046107f',
  },
  style100_side: {
    source: 'shardfall',
    from: 'anim/100style/style100_side.json',
    clips: 194,
    sha256: '4e3337a3e1452ce5281af0117ae21b489d23c511fbea8be2042b9ab66dd81703',
  },
  style100_siderun: {
    source: 'shardfall',
    from: 'anim/100style/style100_siderun.json',
    clips: 194,
    sha256: '2b305faa05b7492e99f3260915b78f4b1f1170d0be356ea62797ced5b9869874',
  },
};

/** The set as the source wrote it: each re-export's `alt` tag, which the repacker puts last, taken off. */
function withoutAltTags(set: ClipSet): ClipSet {
  const untag = (clip: Clip): Clip =>
    clip.orig === undefined || clip.tags?.at(-1) !== ALT_TAG ? clip : { ...clip, tags: clip.tags.slice(0, -1) };
  const clips = Object.fromEntries(Object.entries(set.clips).map(([name, clip]) => [name, untag(clip)]));
  return { ...set, clips };
}

/** my-3d2dge's license in the CMU set's source records, which CMU's terms replaced (WP 8.5). */
const LEGACY_CMU_LICENSE = 'free for all uses (may be copied, modified, or redistributed without permission)';

/** The CMU set as my-3d2dge wrote it: its sources' licenses as they were. */
function withLegacyLicense(set: ClipSet): ClipSet {
  const sources = Object.entries(set.sources ?? {}).map(([id, s]) => [id, { ...s, license: LEGACY_CMU_LICENSE }]);
  return { ...set, sources: Object.fromEntries(sources) };
}

/** The set as shardfall wrote it: its `body`, each clip's `via`, and the clips kept from v1 and their fit taken off. */
function asShardfallWroteIt(set: ClipSet): ClipSet {
  const { body: _body, fit, clips, ...header } = set;
  const kept = new Set(Object.keys(clips).filter((name) => clips[name]?.via === 'v1'));
  const unmarked = Object.entries(clips)
    .filter(([name]) => !kept.has(name))
    .map(([name, { via: _via, ...clip }]) => [name, clip]);
  const fits = fit && Object.fromEntries(Object.entries(fit).filter(([name]) => !kept.has(name)));
  return { ...header, ...(fits && { fit: fits }), clips: Object.fromEntries(unmarked) } as ClipSet;
}

/** The set as its source wrote it, the repacker's and the adoption's changes taken off. */
const restore = (dir: string, set: ClipSet) =>
  SOURCE_SETS[dir]?.source === 'shardfall'
    ? asShardfallWroteIt(set)
    : dir === 'cmu'
      ? withLegacyLicense(withoutAltTags(set))
      : withoutAltTags(set);

const sets = Object.fromEntries(Object.keys(SOURCE_SETS).map((dir) => [dir, readSet(dir)]));
const read = (dir: string, file: string) => readFileSync(join(SETS_DIR, dir, file), 'utf8');
/** What the repacker writes from the my-3d2dge checkout at `source`, by directory: made once. */
let repackedFromSource: ReturnType<typeof legacySetFiles> | undefined;
const fromSource = (source: string) => (repackedFromSource ??= legacySetFiles(source));

describe('data/anim/sets/', () => {
  it('holds ten sets, 1,218 clips, one directory each: two from my-3d2dge (HERO dropped), eight from shardfall', () => {
    const dirs = readdirSync(SETS_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    expect(dirs.map((entry) => entry.name).sort()).toEqual(Object.keys(SOURCE_SETS).sort());
    expect(Object.values(sets).reduce((sum, set) => sum + Object.keys(set.clips).length, 0)).toBe(1218);
    expect(Object.values(sets).map((set) => set.set)).not.toContain('HERO');
  });

  it('tags alt exactly the 84 Mesh2Motion clips re-exported from Quaternius (those with an orig), last', () => {
    const tagged = Object.values(sets).flatMap((set) =>
      Object.values(set.clips).filter((c) => c.tags?.includes('alt')),
    );
    expect(tagged).toHaveLength(84);
    for (const clip of tagged) {
      expect([clip.src, clip.orig?.startsWith('QUATERNIUS/')], clip.clip).toEqual(['M2M_QUATERNIUS', true]);
      expect(clip.tags?.indexOf(ALT_TAG), clip.clip).toBe((clip.tags?.length ?? 0) - 1);
    }
    const reexports = Object.values(sets.mesh2motion?.clips ?? {}).filter((clip) => clip.orig !== undefined);
    expect(reexports.map((clip) => clip.clip)).toEqual(tagged.map((clip) => clip.clip));
  });

  it("holds Quaternius v2's 102 clips and v1's Punch_Enter in quaternius, and only v2's from shardfall", () => {
    const clips = Object.values(sets.quaternius?.clips ?? {});
    expect(clips.filter((clip) => clip.via === 'shardfall')).toHaveLength(102);
    expect(clips.filter((clip) => clip.via !== 'shardfall').map((clip) => [clip.clip, clip.via])).toEqual([
      ['Punch_Enter', 'v1'],
    ]);
  });

  for (const [dir, { source, from, clips, sha256 }] of Object.entries(SOURCE_SETS)) {
    describe(dir, () => {
      const set = sets[dir] as ClipSet;
      const files = readSetDir(join(SETS_DIR, dir));
      const changes =
        source === 'shardfall' ? 'body, via marks and v1 clips' : dir === 'cmu' ? 'licenses (CMU’s terms)' : 'alt tags';

      it(`is _set.json, catalog.tsv and ${clips} clip files, each named by its clip's slug`, () => {
        expect(set.set.toLowerCase()).toBe(dir);
        const named = Object.values(set.clips).map((clip) => `${clipSlug(clip.clip ?? '')}.json`);
        expect(Object.keys(files).sort()).toEqual([SET_FILE, CATALOG_FILE, ...named].sort());
        expect(named).toHaveLength(clips);
        for (const [name, clip] of Object.entries(set.clips)) expect(clip.clip, `${dir}/${name}`).toBe(name);
      });

      it(`rejoined, is ${source}:${from} apart from the ${changes} (SHA-256 of the object, key order included)`, () => {
        expect(canonicalSha256(restore(dir, set))).toBe(sha256);
      });

      it('lays each clip file out as its text(), _set.json as the repacker does, and generates catalog.tsv', () => {
        const repacked = splitSet(set);
        for (const [file, text] of Object.entries(files)) {
          if (file === SET_FILE || file === CATALOG_FILE) continue;
          expect(text, `${dir}/${file}`).toBe(`${clipText(parseClip(text, file))}\n`);
        }
        expect(files).toEqual(repacked);
        expect(read(dir, CATALOG_FILE)).toBe(catalogTsv(set));
        expect(joinSet(repacked)).toEqual(set);
      });

      it('lists every clip in catalog.tsv in set order, with the columns name to fit, speed among them', () => {
        const lines = read(dir, CATALOG_FILE).trimEnd().split('\n');
        const rows = lines.filter((line) => !line.startsWith('#')).map((line) => line.split('\t'));
        expect(rows[0]).toEqual([...CATALOG_COLUMNS]);
        expect(rows[0]).toContain('speed');
        expect(rows.slice(1).map((row) => row[0])).toEqual(Object.keys(set.clips));
        for (const row of rows.slice(1)) {
          const clip = set.clips[row[0] ?? ''] as Clip;
          const [mean, worst] = set.fit?.[clip.clip ?? ''] ?? [];
          expect(row.length, clip.clip).toBeLessThanOrEqual(CATALOG_COLUMNS.length);
          expect([row[1], row[2], row[3], row[4], row[9]], clip.clip).toEqual([
            String(clip.dur),
            String(clip.loop ?? ''),
            String(clip.speed ?? ''),
            clip.tags?.join(' ') ?? '',
            `${mean}/${worst}`,
          ]);
        }
      });

      if (source === 'my-3d2dge') {
        it(`deep-equals ${from}, prints the same text() with the source's codec, and repacks to these files (needs the my-3d2dge checkout)`, (context) => {
          const { MR, sets: sources, source: path } = legacy(context);
          const original = sources[dir] as unknown as ClipSet;
          const restored = restore(dir, set);
          expect(restored).toEqual(original);
          expect(JSON.stringify(restored)).toBe(JSON.stringify(original));
          expect(canonicalSha256(original), 'the recorded SHA-256').toBe(sha256);
          for (const [name, clip] of Object.entries(original.clips)) {
            expect(MR.text(restored.clips[name] as Clip), `${dir}/${name}`).toBe(MR.text(clip));
            expect(MR.text(set.clips[name] as Clip), `${dir}/${name}`).toBe(clipText(set.clips[name] as Clip));
          }
          expect(fromSource(path)[dir]).toEqual(files);
        });
      } else {
        const needs = dir === 'quaternius' ? 'the shardfall and my-3d2dge checkouts' : 'the shardfall checkout';
        it(`deep-equals ${from} but for the ${changes}, with the same text(), adopted as committed (needs ${needs})`, (context) => {
          const original = JSON.parse(readFileSync(join(requireSource('shardfall', context), from), 'utf8')) as ClipSet;
          const restored = asShardfallWroteIt(set);
          expect(restored).toEqual(original);
          expect(JSON.stringify(restored)).toBe(JSON.stringify(original));
          expect(canonicalSha256(original), 'the recorded SHA-256').toBe(sha256);
          for (const [name, clip] of Object.entries(original.clips)) {
            expect(clipText(restored.clips[name] as Clip), `${dir}/${name}`).toBe(clipText(clip));
          }
          const v1 = dir === 'quaternius' ? requireSource('my-3d2dge', context) : undefined;
          expect(splitSet(shardfallSet(dir, requireSource('shardfall', context), v1))).toEqual(files);
        });
      }
    });
  }
});
