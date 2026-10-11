/**
 * @file The sets' checks (PLAN.md §10.3 and §10.5 step 4, WP 8.3): `data/anim/sets/` holds my-3d2dge's three curated
 * sets, HERO dropped, each a directory of one `<Clip_Slug>.json` per clip, `_set.json` and a generated `catalog.tsv`
 * (tools/anim/repack.ts). Rejoined, each set is the source's object, apart from the `alt` tag on each of
 * Mesh2Motion's 84 Quaternius re-exports, and every clip file is its clip's `text()`, so `text()` output is unchanged.
 *
 * "The source's object" is proved twice: offline, by the SHA-256 of `JSON.stringify` of each rejoined set with its
 * `alt` tags taken off, against the source's recorded here (key order included, so the clips' order and every field's
 * order count, not only the values); and, when the my-3d2dge checkout resolves (else deferred: no source), against
 * the source itself: deep-equal, the same `text()` from the source's own codec for every clip, and the repacker
 * writing exactly the committed files.
 *
 * @see tools/anim/repack.ts
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
import { legacy } from '../../../anim/clip-fixtures';
import { canonicalSha256 } from '../catalogs/catalogs';

/** Each set this WP repacks, by directory: its source file at my-3d2dge@e37e4ee, its clips, and its object's SHA-256. */
const SOURCE_SETS: Record<string, { from: string; clips: number; sha256: string }> = {
  quaternius: {
    from: 'src/mocap/sets/quaternius.js',
    clips: 88,
    sha256: 'df0f25c4f7864ea3d446999ee0bd3fd46bd177d0eeac4b6328965061b4f44c5e',
  },
  mesh2motion: {
    from: 'src/mocap/sets/mesh2motion.js',
    clips: 177,
    sha256: '93997b1ee3de44e7be628af3f78452e89431f42736112ed79f974f22744a0598',
  },
  cmu: {
    from: 'src/mocap/sets/cmu.js',
    clips: 60,
    sha256: '042068d134e719cfc0213c8e2259af5159ecdb118ac2e12ef6621b843dd33727',
  },
};

/** The set as the source wrote it: each re-export's `alt` tag, which the repacker puts last, taken off. */
function withoutAltTags(set: ClipSet): ClipSet {
  const untag = (clip: Clip): Clip =>
    clip.orig === undefined || clip.tags?.at(-1) !== ALT_TAG ? clip : { ...clip, tags: clip.tags.slice(0, -1) };
  const clips = Object.fromEntries(Object.entries(set.clips).map(([name, clip]) => [name, untag(clip)]));
  return { ...set, clips };
}

const sets = Object.fromEntries(Object.keys(SOURCE_SETS).map((dir) => [dir, readSet(dir)]));
const read = (dir: string, file: string) => readFileSync(join(SETS_DIR, dir, file), 'utf8');
/** What the repacker writes from the my-3d2dge checkout at `source`, by directory: made once. */
let repackedFromSource: ReturnType<typeof legacySetFiles> | undefined;
const fromSource = (source: string) => (repackedFromSource ??= legacySetFiles(source));

describe('data/anim/sets/', () => {
  it('holds the three curated sets, 325 clips, one directory each: HERO is dropped', () => {
    const dirs = readdirSync(SETS_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    expect(dirs.map((entry) => entry.name).sort()).toEqual(Object.keys(SOURCE_SETS).sort());
    expect(Object.values(sets).reduce((sum, set) => sum + Object.keys(set.clips).length, 0)).toBe(325);
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

  for (const [dir, { from, clips, sha256 }] of Object.entries(SOURCE_SETS)) {
    describe(dir, () => {
      const set = sets[dir] as ClipSet;
      const files = readSetDir(join(SETS_DIR, dir));

      it(`is _set.json, catalog.tsv and ${clips} clip files, each named by its clip's slug`, () => {
        expect(set.set.toLowerCase()).toBe(dir);
        const named = Object.values(set.clips).map((clip) => `${clipSlug(clip.clip ?? '')}.json`);
        expect(Object.keys(files).sort()).toEqual([SET_FILE, CATALOG_FILE, ...named].sort());
        expect(named).toHaveLength(clips);
        for (const [name, clip] of Object.entries(set.clips)) expect(clip.clip, `${dir}/${name}`).toBe(name);
      });

      it(`rejoined, is ${from} apart from the alt tags (SHA-256 of the object, key order included)`, () => {
        expect(canonicalSha256(withoutAltTags(set))).toBe(sha256);
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
          expect([row[1], row[2], row[4], row[9]], clip.clip).toEqual([
            String(clip.dur),
            String(clip.loop ?? ''),
            clip.tags?.join(' ') ?? '',
            `${mean}/${worst}`,
          ]);
        }
      });

      it(`deep-equals ${from}, prints the same text() with the source's codec, and repacks to these files (needs the my-3d2dge checkout)`, (context) => {
        const { MR, sets: sources, source } = legacy(context);
        const original = sources[dir] as unknown as ClipSet;
        const restored = withoutAltTags(set);
        expect(restored).toEqual(original);
        expect(JSON.stringify(restored)).toBe(JSON.stringify(original));
        expect(canonicalSha256(original), 'the recorded SHA-256').toBe(sha256);
        for (const [name, clip] of Object.entries(original.clips)) {
          expect(MR.text(restored.clips[name] as Clip), `${dir}/${name}`).toBe(MR.text(clip));
          expect(MR.text(set.clips[name] as Clip), `${dir}/${name}`).toBe(clipText(set.clips[name] as Clip));
        }
        expect(fromSource(source)[dir]).toEqual(files);
      });
    });
  }
});
