/**
 * @file Tests the importer (tools/anim/import.ts, WP 8.5) on libraries built here (a rigged `.glb` in memory, a CMU
 * subject written as text), offline: the catalog's words, loops, skips and source records; format 2 by default (each
 * loop's speed from its stride, shardfall's rule; a root-motion twin lending loops their stride and adding one-shots
 * that travel as `<clip>_RM`; the source's rate; `via`); format 1 with `legacy`; and the CMU picks, cut and recorded
 * per subject. With the my-3d2dge checkout (else deferred: no source): `legacy` imports a `.glb` exactly as the
 * source's `tools/anim-import.mjs` does, every byte of the set.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clipText } from '../../engine/anim/clip/lens';
import type { Clip } from '../../engine/anim/clip/readable';
import { CHILD_TIMEOUT_MS } from '../x';
import { requireSource } from '../lib/source';
import { testAmc, testAsf } from './asf-amc-fixture';
import { riggedGlb, turn, type FixtureTrack } from './glb-fixture';
import { importSet, type Catalog } from './import';
import { loadLegacyReadable, readLegacySet } from './legacy-readable';
import { readPlainSet, splitSet } from './repack';

/** The left arm's swing, as a track over `dur` seconds, plus `extra` tracks. */
const swing = (dur: number, ...extra: FixtureTrack[]): FixtureTrack[] => [
  {
    bone: 'upperarm_l',
    path: 'rotation',
    times: [0, dur / 2, dur],
    values: [...turn([0, 0, 1], 0), ...turn([0, 0, 1], -60), ...turn([0, 0, 1], 0)],
  },
  ...extra,
];
/** The root moving `metres` forward over `dur` seconds. */
const travel = (dur: number, metres: number): FixtureTrack => ({
  bone: 'root',
  path: 'translation',
  times: [0, dur],
  values: [0, 0, 0, 0, 0, metres],
});

describe('importing .glb libraries', () => {
  const catalog: Catalog = {
    $sources: { LIB: { label: 'A test library', license: 'CC0 1.0' } },
    $skip: { Broken: 'its arm flips' },
    Wave_Loop: ['wave greet', 'Waves, a loop by its name'],
    Swing: ['loop arms', 'Swings an arm, a loop by its tags'],
  };
  const glb = riggedGlb({ Wave_Loop: swing(1), Swing: swing(1.2), Broken: swing(0.5), _rest: swing(0.1) });

  it('fits every clip, with the catalog’s words, loops and skips, and records each library', () => {
    const { set, notes } = importSet({
      glbs: [{ file: 'lib.glb', bytes: glb }],
      catalog,
      sources: ['LIB'],
      name: 'TEST',
    });
    expect(Object.keys(set.clips)).toEqual(['Wave_Loop', 'Swing']);
    expect(notes).toContain('left out Broken: its arm flips');
    expect(set.clips.Swing).toMatchObject({ clip: 'Swing', src: 'LIB', loop: true, tags: ['arms'], via: 'source' });
    expect(set.clips.Wave_Loop).toMatchObject({
      loop: true,
      tags: ['wave', 'greet'],
      desc: 'Waves, a loop by its name',
    });
    expect(set.sources?.LIB).toMatchObject({
      file: 'lib.glb',
      rig: 'unreal',
      label: 'A test library',
      license: 'CC0 1.0',
    });
    expect(set.fit?.Swing?.[0]).toBeLessThan(30);
    expect(Object.keys(set)).toEqual(['set', 'format', 'credit', 'fps', 'sources', 'body', 'fit', 'clips']);
  });

  it('writes format 2 by default: loops take their twin’s travel as their stride, one-shots that travel join as _RM', () => {
    const main = riggedGlb({ Walk_Loop: swing(1), Jump: swing(0.8), Wave: swing(0.6) });
    const twin = riggedGlb({
      Walk_Loop: swing(1, travel(1, 1.2)),
      Jump: swing(0.8, travel(0.8, 0.4)),
      Wave: swing(0.6, travel(0.6, 0.03)),
    });
    const { set, notes } = importSet({ glbs: [{ file: 'ual.glb', bytes: main, rm: twin }], name: 'UAL' });
    expect(set.format).toBe(2);
    expect(Object.keys(set.clips)).toEqual(['Walk_Loop', 'Jump', 'Wave', 'Jump_RM']);
    const H0 = set.sources?.ual.rest.H0 ?? 0;
    expect(set.clips.Walk_Loop.speed).toBe(Math.round(((1200 / H0) * 100) / 1));
    expect(set.clips.Jump.speed).toBeUndefined();
    expect(set.clips.Jump_RM.keys.at(-1)?.root?.[0]).toBe(Math.round((400 / H0) * 100));
    expect(set.clips.Walk_Loop).toMatchObject({ fps: 2, via: 'source' });
    expect(notes).toContain('ual.glb: 1 loops take their speed from its twin, 1 clips that travel added as _RM');
  });

  it('leaves out a speed below 10% of hip height a second, and everything format 2 adds with legacy', () => {
    const main = riggedGlb({ Sway_Loop: swing(2) });
    const twin = riggedGlb({ Sway_Loop: swing(2, travel(2, 0.1)) });
    const format2 = importSet({ glbs: [{ file: 'a.glb', bytes: main, rm: twin }] }).set;
    expect(format2.clips.Sway_Loop.speed).toBeUndefined();
    const legacy = importSet({ glbs: [{ file: 'a.glb', bytes: main, rm: twin }], legacy: true }).set;
    expect(legacy.format).toBe(1);
    expect(Object.keys(legacy.clips.Sway_Loop)).toEqual(['clip', 'src', 'dur', 'loop', 'keys']);
  });
});

describe('importing CMU picks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'import-cmu-'));
  writeFileSync(join(dir, '99.asf'), testAsf());
  writeFileSync(join(dir, '99_01.amc'), testAmc(600));
  const catalog: Catalog = {
    $sources: { CMU: { label: 'CMU motion capture', origin: 'mocap.cs.cmu.edu', license: 'CMU terms', url: 'x' } },
    $pick: { Walk_Loop: ['99_01', 0.5, 4], Start: ['99_01', 0.2, 1.7] },
    Walk_Loop: ['walk loop', 'A walk, in place'],
    Start: ['walk', 'Sets off'],
  };
  const index = [{ id: '99_01', subject: 99, about: 'a test walker', desc: 'walk', fps: 120 }];
  const ledger = { categories: [], takes: [], subjects: [], comments: {} };

  it('cuts each pick from its take, a source record per subject, the take and rate on each clip', () => {
    const { set, notes } = importSet({ cmu: true, catalog, index, ledger, cmuDir: dir });
    expect([set.set, set.title, set.format]).toEqual(['CMU', 'CMU', 2]);
    expect(set.sources?.CMU_99).toMatchObject({
      file: '99.asf',
      rig: 'cmu',
      label: 'CMU motion capture, subject 99 (a test walker)',
      url: 'http://mocap.cs.cmu.edu/search.php?subjectnumber=99',
    });
    expect(set.clips.Walk_Loop).toMatchObject({ src: 'CMU_99', loop: true, fps: 120, via: 'source' });
    expect(set.clips.Walk_Loop.take).toMatch(/^99_01 \d\.\d\d-\d\.\d\d$/);
    expect(set.clips.Walk_Loop.speed).toBeGreaterThan(90);
    expect(set.clips.Start).toMatchObject({ take: '99_01 0.20-1.70', loop: false });
    expect(set.clips.Start.speed).toBeUndefined();
    expect(notes.some((note) => note.startsWith('Walk_Loop: a 1.0'))).toBe(true);
  });

  it('needs the catalog’s picks', () => {
    expect(() => importSet({ cmu: true, catalog: {}, index, ledger, cmuDir: dir })).toThrow(
      /--cmu needs the catalog's "\$pick"/,
    );
  });
});

describe('against the source (needs the my-3d2dge checkout)', () => {
  it('imports a .glb with legacy exactly as tools/anim-import.mjs does', { timeout: CHILD_TIMEOUT_MS }, (context) => {
    const source = requireSource('my-3d2dge', context);
    const dir = mkdtempSync(join(tmpdir(), 'import-oracle-'));
    const bytes = riggedGlb({ Wave_Loop: swing(1), Punch: swing(0.7, travel(0.7, 0.2)), A_TPose: swing(0.1) });
    writeFileSync(join(dir, 'lib.glb'), bytes);
    const args = [join(source, 'tools/anim-import.mjs'), join(dir, 'lib.glb'), '--name', 'TEST', '--title', 'Test'];
    const run = spawnSync(
      process.execPath,
      [...args, '--sources', 'LIB', '--out', join(dir, 'src/mocap/sets/test.js')],
      {
        encoding: 'utf8',
        timeout: CHILD_TIMEOUT_MS,
      },
    );
    expect(run.status, run.stderr).toBe(0);
    const theirs = readLegacySet(dir, 'test');
    const ours = importSet({
      glbs: [{ file: 'lib.glb', bytes }],
      ...{ name: 'TEST', title: 'Test', sources: ['LIB'] },
      legacy: true,
    });
    // the set's files, byte for byte (in memory, a key's fields come in the order the encoder writes them)
    expect(splitSet(ours.set)).toEqual(splitSet(readPlainSet(theirs)));
    const MR = loadLegacyReadable(source);
    for (const [name, clip] of Object.entries(theirs.clips))
      expect(clipText(ours.set.clips[name] as Clip), name).toBe(MR.text(clip));
  });
});
