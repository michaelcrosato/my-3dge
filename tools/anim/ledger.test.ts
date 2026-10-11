/**
 * @file Tests reading and writing the CMU ledger (tools/anim/ledger.ts, WP 8.5): the committed ledger reads, and
 * writes back byte for byte; a take changed is written into its category's file and the counts follow; queries by
 * category, word and status. The ledger's own data checks are tests/unit/data/anim/ledger/.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { categoryOf, LEDGER_DIR, ledgerFiles, queryLedger, readLedger, writeLedger } from './ledger';

describe('the CMU ledger', () => {
  const ledger = readLedger();

  it('reads every take, and writes the files back byte for byte', () => {
    expect(ledger.takes).toHaveLength(2548);
    expect(ledger.categories).toHaveLength(17);
    for (const [file, text] of Object.entries(ledgerFiles(ledger))) {
      expect(text, file).toBe(readFileSync(join(LEDGER_DIR, file), 'utf8'));
    }
  });

  it('files a changed take under its category, and counts it there', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
    for (const [file, text] of Object.entries(ledgerFiles(ledger))) writeFileSync(join(dir, file), text);
    const copy = readLedger(dir);
    const take = copy.takes.find((t) => t.id === '02_01');
    if (!take) throw new Error('02_01 is missing');
    Object.assign(take, {
      desc: 'cartwheel',
      category: categoryOf('cartwheel', copy.categories),
      note: 'pick: X (test)',
    });
    expect(writeLedger(copy, dir)).toEqual(['acrobatics.tsv', 'categories.tsv', 'locomotion.tsv']);
    const again = readLedger(dir);
    expect(again.takes.find((t) => t.id === '02_01')).toMatchObject({ category: 'acrobatics', note: 'pick: X (test)' });
    const acrobatics = again.categories.find((c) => c.category === 'acrobatics');
    expect(acrobatics?.takes).toBe(ledger.categories.find((c) => c.category === 'acrobatics')!.takes + 1);
  });

  it('gives a take the category of its own words', () => {
    expect(categoryOf('playground - forward jumps, turn around', ledger.categories)).toBe('jump');
    expect(categoryOf('', ledger.categories)).toBe('undescribed');
    expect(categoryOf('alaskan vacation', ledger.categories)).toBe('other');
  });

  it('finds takes by category, words and status', () => {
    expect(queryLedger(ledger, ['acrobatics', 'cartwheel']).map((t) => t.id)).toContain('49_06');
    expect(queryLedger(ledger, ['cartwheel'], 'used').map((t) => t.used)).toEqual(['Cartwheel']);
    expect(queryLedger(ledger, [], 'pick')).toHaveLength(30);
  });
});
