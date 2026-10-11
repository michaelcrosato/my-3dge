/**
 * @file Tests the CMU survey (tools/anim/survey.ts, WP 8.5) on a subject written here, offline: each take converted
 * and measured into its ledger row (its rate, length, stretch, fit, travel, hips and flags), a row's note and verified
 * rate kept, and, as a library, a set directory a subject. Its rows reproduce the committed ledger's; that is shown
 * by `x anim cmu rates --write`, which surveyed subject 84 again (data/anim/cmu/README.md).
 */
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { testAmc, testAsf } from './asf-amc-fixture';
import { LEDGER_DIR, readLedger, writeLedger } from './ledger';
import { readSet } from './repack';
import { flagsOf, surveyCmu } from './survey';

describe('the CMU survey', () => {
  const dir = mkdtempSync(join(tmpdir(), 'survey-'));
  writeFileSync(join(dir, '99.asf'), testAsf());
  writeFileSync(join(dir, '99_01.amc'), testAmc(400));
  writeFileSync(join(dir, '99_02.amc'), testAmc(1200, 0));
  const ledgerDir = mkdtempSync(join(tmpdir(), 'survey-ledger-'));
  cpSync(LEDGER_DIR, ledgerDir, { recursive: true });
  const index = [{ id: '99_01', subject: 99, about: 'a test walker', desc: 'walk forward', fps: 120 }];
  // 99_02 is not on the list: verified at 60 by its C3D file, as some of subject 84's are
  const before = readLedger(ledgerDir);
  before.takes.push({
    ...before.takes[0],
    id: '99_02',
    subject: '99',
    fps: '60',
    flags: 'fps:c3d',
    note: 'skip: test',
    desc: '',
    used: '',
  });
  writeLedger(before, ledgerDir);

  it('measures each take into its row, keeping notes and verified rates', () => {
    const { done, ledger } = surveyCmu({ dir, ledgerDir, index, legacy: true });
    expect(done).toBe(2);
    const [walk, still] = ['99_01', '99_02'].map((id) => ledger.takes.find((t) => t.id === id));
    expect(walk).toMatchObject({
      fps: '120',
      sec: '3.3',
      category: 'locomotion',
      flags: '',
      note: '',
      desc: 'walk forward',
    });
    expect(walk?.fit).toMatch(/^\d+\/\d+$/);
    expect(Number(walk?.travel)).toBeGreaterThan(3);
    expect(walk?.hips).toMatch(/^\d+-\d+$/);
    expect(still).toMatchObject({
      fps: '60',
      sec: '20.0',
      flags: 'fps:c3d',
      note: 'skip: test',
      category: 'undescribed',
    });
    expect(readLedger(ledgerDir).subjects.find((s) => s.subject === 99)).toEqual({
      subject: 99,
      takes: 2,
      about: 'a test walker',
    });
  });

  it('converts every take into a set a subject, as the library', () => {
    const libraryDir = mkdtempSync(join(tmpdir(), 'survey-lib-'));
    surveyCmu({ dir, ledgerDir, index, library: true, ledger: false, libraryTol: 50, libraryDir });
    const set = readSet('cmu_99', libraryDir);
    expect(Object.keys(set.clips)).toEqual(['99_01', '99_02_part1', '99_02_part2']); // 20 s at 60 fps: two 10 s parts
    expect(set.clips['99_01']).toMatchObject({ src: 'CMU_99', take: '99_01 0.00-3.33', tags: ['locomotion'] });
  });

  it('flags what its numbers say', () => {
    expect(flagsOf({ inverted: 3, off: 70, n: 100, dur: 0.5, mean: 31 })).toEqual([
      'inverted',
      'floats',
      'short',
      'loose',
    ]);
    expect(flagsOf({ inverted: 2, off: 60, n: 100, dur: 1 })).toEqual([]);
  });
});
