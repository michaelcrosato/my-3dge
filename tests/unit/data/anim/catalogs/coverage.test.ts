/**
 * @file The coverage map's checks (PLAN.md §10.6, WP 8.1): `docs/ANIMATION-RESEARCH.md` maps every item of its
 * ranked list (§5, items 1–40) to the library, once and in order, under the item's own name; every clip it names is
 * in a catalog or is a `pick` of the CMU ledger; every count of ledger takes it states is the ledger's; and every
 * item the library does not fully cover says what fills the gap.
 *
 * @see docs/ANIMATION-RESEARCH.md
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readLedger } from '../ledger/ledger';
import { entries, readCatalogs } from '../sources/sources';
import { readCoverage, RESEARCH_FILE, type Verdict } from './catalogs';

const text = readFileSync(RESEARCH_FILE, 'utf8');
const rows = readCoverage(text);
const ledger = readLedger();

/** The ranked list's items (§5): number → bold name. */
const ranked = new Map(
  [...text.matchAll(/^\| (\d+) \| \*\*([^*]+)\*\*/gm)].map((match) => [Number(match[1]), match[2] ?? '']),
);

/** Every clip a catalog describes, and every clip the ledger marks `pick: Name`. */
const known = new Set([
  ...Object.values(readCatalogs()).flatMap((catalog) => Object.keys(entries(catalog))),
  ...ledger.takes.flatMap((take) => /^pick: (\S+)/.exec(take.note)?.[1] ?? []),
]);

describe('the coverage map', () => {
  it('maps the ranked list’s 40 items, once each and in order, under their own names', () => {
    expect([...ranked.keys()]).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    expect(rows.map((row) => row.item)).toEqual([...ranked.keys()]);
    for (const row of rows) expect(ranked.get(row.item)?.startsWith(row.name), `item ${row.item}`).toBe(true);
  });

  it('gives each item a verdict, names a clip for each it covers, and says what fills each gap', () => {
    const verdicts: Verdict[] = ['covered', 'partial', 'missing', 'not a clip'];
    for (const row of rows) {
      expect(verdicts, `item ${row.item}`).toContain(row.verdict);
      if (row.verdict === 'covered' || row.verdict === 'partial') {
        expect(row.clips.length, `item ${row.item} names no clip`).toBeGreaterThan(0);
      }
      if (row.verdict !== 'covered') expect(row.fill.length, `item ${row.item}: what fills it`).toBeGreaterThan(5);
    }
  });

  it('names only clips of the catalogs or picks of the ledger', () => {
    for (const row of rows)
      for (const clip of row.clips) expect(known.has(clip), `item ${row.item}: ${clip}`).toBe(true);
  });

  it('states the ledger’s own count of takes for each category it counts', () => {
    const counted = rows.flatMap((row) => row.takes.map((entry) => ({ ...entry, item: row.item })));
    expect(counted.length).toBeGreaterThan(0);
    for (const { category, count, item } of counted) {
      const takes = ledger.takes.filter((take) => take.category === category).length;
      expect(takes, `item ${item}: ${count} \`${category}\` takes`).toBe(count);
    }
  });
});
