/**
 * @file Tests verifying CMU frame rates (tools/anim/rates.ts, WP 8.5), offline: a C3D header read, an `.amc`'s frames
 * counted, a twin found among takes the ledger measured alike and confirmed by its bytes, a C3D file that disagrees
 * with its `.amc` ignored, and the evidence written into the rows. The committed ledger's 113 verified rows are
 * checked by tests/unit/data/anim/ledger/.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { testAmc, testAsf } from './asf-amc-fixture';
import { readLedger, type Ledger, type Take } from './ledger';
import { amcFrames, applyRates, c3dHeader, twinCandidates, verifyRates } from './rates';

/** The first kilobyte of a C3D file: parameters at block 2 (an Intel file), frames `first`–`last` at `rate`. */
function c3d(rate: number, first: number, last: number): Uint8Array {
  const bytes = new Uint8Array(1024);
  const view = new DataView(bytes.buffer);
  bytes.set([2, 0x50]);
  view.setUint16(6, first, true);
  view.setUint16(8, last, true);
  view.setFloat32(20, rate, true);
  bytes[512 + 3] = 84;
  return bytes;
}
const take = (id: string, fields: Partial<Take>): Take => ({
  ...{ id, subject: id.split('_')[0], fps: '120', sec: '2.5', active: '0.0-2.5', fit: '12/80', travel: '1.0' },
  ...{ hips: '95-105', flags: '', used: '', note: '', desc: '', category: 'undescribed' },
  ...fields,
});

describe('frame rates verified', () => {
  it('reads a C3D header and counts an .amc’s frames', () => {
    expect(c3dHeader(c3d(60, 1, 464))).toEqual({ rate: 60, frames: 464 });
    expect(() => c3dHeader(new Uint8Array(1024))).toThrow(/not a C3D file/);
    const dec = c3d(120, 1, 10);
    dec[515] = 85;
    expect(() => c3dHeader(dec)).toThrow(/processor type 85: only Intel/);
    expect(amcFrames(testAmc(7))).toBe(7);
  });

  it('finds twin candidates among listed takes measured alike', () => {
    const ledger = readLedger();
    expect(twinCandidates(ledger, '121_02')).toEqual(['90_02']);
    expect(twinCandidates(ledger, '84_01')).toEqual(['74_01']);
    expect(twinCandidates(ledger, '02_01')).toEqual([]);
  });

  it('confirms a twin by its bytes and a C3D file by its frames, and writes the evidence into the rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rates-'));
    for (const s of ['97', '98', '99']) writeFileSync(join(dir, `${s}.asf`), testAsf());
    writeFileSync(join(dir, '99_01.amc'), `#!OML:ASF A\n${testAmc(300)}`);
    writeFileSync(join(dir, '98_01.amc'), `#!OML:ASF B\n${testAmc(300)}`);
    writeFileSync(join(dir, '97_01.amc'), testAmc(240));
    const ledger: Ledger = {
      ...{ categories: [], subjects: [], comments: {} },
      takes: [take('98_01', {}), take('99_01', { flags: 'fps? floats' }), take('97_01', { flags: 'fps?', sec: '4.0' })],
    };
    const c3ds: Record<string, Uint8Array> = { '97_01': c3d(60, 1, 240), '99_01': c3d(120, 1, 299) };
    const read = (url: string) => {
      const found = c3ds[url.slice(url.lastIndexOf('/') + 1, -4)];
      if (!found) throw new Error('404');
      return found;
    };
    const evidence = verifyRates(ledger, undefined, dir, read);
    expect(evidence.map((e) => [e.id, e.fps, e.flags])).toEqual([
      ['97_01', 60, ['fps:c3d']],
      ['99_01', 120, ['twin:98_01']],
    ]);
    expect(applyRates(ledger, evidence)).toEqual(['97_01']);
    expect(ledger.takes.map((t) => [t.id, t.fps, t.flags])).toEqual([
      ['98_01', '120', ''],
      ['99_01', '120', 'twin:98_01 floats'],
      ['97_01', '60', 'fps:c3d'],
    ]);
  });
});
