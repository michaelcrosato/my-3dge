/**
 * @file The library's provenance checks (PLAN.md §10.1 and §10.5 step 1, WP 8.1): `data/anim/SOURCES.md` lists every
 * library a catalog names, each with its license, license text, URL and file names; CMU's no-resale terms and
 * acknowledgment are recorded verbatim wherever its license is; the CC0 text is CC0 1.0's legal code; and every file
 * under `data/anim/{catalogs,cmu,LICENSES}/` says where it came from.
 *
 * @see data/anim/SOURCES.md
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANIM_DIR, readLedger } from '../ledger/ledger';
import { CMU_TERMS, entries, readCatalogs, readSources, squash } from './sources';

/** SHA-256 of https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt, CC0 1.0 Universal's legal code. */
const CC0_SHA256 = 'a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499';

const { text, sources, files } = readSources();
const catalogs = readCatalogs();
const read = (path: string) => readFileSync(join(ANIM_DIR, path), 'utf8');

describe('SOURCES.md: the libraries', () => {
  it('lists each library once, with its license, license text, URL and file names', () => {
    expect(new Set(sources.map((row) => row.source)).size).toBe(sources.length);
    for (const row of sources) {
      expect(row.library, row.source).not.toBe('');
      expect(row.license, row.source).not.toBe('');
      expect(row.licenseText, row.source).toMatch(/^LICENSES\/[\w.-]+\.txt$/);
      expect(read(row.licenseText).length, row.licenseText).toBeGreaterThan(200);
      expect(row.url, row.source).toMatch(/^https?:\/\/\S+$/);
      expect(row.files, row.source).toMatch(/\.(glb|zip|asf|amc|bvh|json)\b/);
    }
  });

  it('lists every library a catalog names, with the catalog’s license and URL, and none that no catalog names', () => {
    const named = new Set<string>();
    for (const [name, catalog] of Object.entries(catalogs)) {
      for (const [id, record] of Object.entries(catalog.$sources)) {
        named.add(id);
        const row = sources.find((candidate) => candidate.source === id);
        expect(row, `${name}: "$sources".${id} has no row in SOURCES.md`).toBeDefined();
        expect(record.license.startsWith(row?.license ?? '?'), `${name}: ${id}'s license`).toBe(true);
        expect(record.url, `${name}: ${id}'s URL`).toBe(row?.url);
        expect(record.label && record.origin, `${name}: ${id}'s label and origin`).toBeTruthy();
      }
    }
    expect(sources.map((row) => row.source).sort()).toEqual([...named].sort());
  });

  it('names each library’s set, whose catalog exists', () => {
    for (const row of sources) {
      const catalog = catalogs[`${row.set.toLowerCase()}.json`];
      expect(catalog, `${row.source}: no catalog for set ${row.set}`).toBeDefined();
      expect(Object.keys(catalog?.$sources ?? {}), row.source).toContain(row.source);
    }
  });

  it('records CMU’s no-resale terms and acknowledgment verbatim, in SOURCES.md, its license text and its catalog', () => {
    const cmu = catalogs['cmu.json']?.$sources.CMU;
    for (const sentence of CMU_TERMS) {
      expect(squash(text), 'SOURCES.md').toContain(sentence);
      expect(squash(read('LICENSES/CMU.txt')), 'LICENSES/CMU.txt').toContain(sentence);
      expect(cmu?.license, 'catalogs/cmu.json "$sources".CMU.license').toContain(sentence);
    }
  });

  it('keeps CC0 1.0’s legal code unchanged', () => {
    expect(createHash('sha256').update(read('LICENSES/CC0-1.0.txt')).digest('hex')).toBe(CC0_SHA256);
  });

  it('states the CMU numbers the ledger and catalog hold: 2,548 takes, 113 subjects; 60 clips, 59 takes, 25 subjects', () => {
    const ledger = readLedger();
    const picks = Object.values(catalogs['cmu.json']?.$pick ?? {}).map(([take]) => take);
    const subjects = new Set(picks.map((take) => take.split('_')[0]));
    expect(ledger.takes.length.toLocaleString('en-US')).toBe('2,548');
    expect(ledger.subjects).toHaveLength(113);
    expect([picks.length, new Set(picks).size, subjects.size]).toEqual([60, 59, 25]);
    expect(Object.keys(entries(catalogs['cmu.json'] ?? { $sources: {} }))).toHaveLength(60);
    expect(squash(text)).toContain('2,548 takes by more than 100 people (113 subject numbers');
    expect(squash(text)).toContain('60 moments cut from 59 takes of 25 subjects');
  });
});

describe('SOURCES.md: where each file came from', () => {
  /** Every file under the directories WP 8.1 fills, relative to data/anim/, Markdown left out. */
  const dataFiles = ['catalogs', 'cmu', 'LICENSES'].flatMap((dir) =>
    readdirSync(join(ANIM_DIR, dir))
      .filter((name) => !name.endsWith('.md'))
      .map((name) => `${dir}/${name}`),
  );
  const pattern = (file: string) => new RegExp(`^${file.replace(/[.]/g, '\\.').replace(/\*/g, '[^/]*')}$`);

  it('names an origin for every data file', () => {
    for (const file of dataFiles) {
      const row = files.find((candidate) => pattern(candidate.file).test(file));
      expect(row, `${file} has no row in SOURCES.md's "Where each file came from"`).toBeDefined();
      expect(row?.from, file).toMatch(/^(my-3d2dge|shardfall):\S+$|^https?:\/\/\S+/);
    }
  });

  it('has no row that matches no file', () => {
    for (const row of files) {
      expect(
        dataFiles.some((file) => pattern(row.file).test(file)),
        `${row.file} matches no file`,
      ).toBe(true);
      expect(existsSync(join(ANIM_DIR, posix.dirname(row.file))), row.file).toBe(true);
    }
  });
});
