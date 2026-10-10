/**
 * @file The CMU ledger's checks (PLAN.md §10.3 and §10.5 step 2, WP 8.1): the split into category files and
 * `subjects.tsv` joins back to my-3d2dge's single-file ledger exactly (with my-3d2dge's category rule restored); every
 * take sits in the category its own description gives; and the index, the subjects, the counts in `README.md` and the
 * CMU catalog's picks all agree with the rows.
 *
 * The join-back is proved twice: against the original rows' SHA-256, recorded here, and, when the my-3d2dge checkout
 * resolves, line by line against its file (deferred: no source otherwise).
 *
 * @see data/anim/cmu/README.md
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { requireSource } from '../../../../../tools/lib/source';
import {
  ANIM_DIR,
  categoryOf,
  compareIds,
  fallbackCategoryOf,
  joinBack,
  LEDGER_DIR,
  ledgerFiles,
  originalRows,
  readLedger,
  TAKE_COLUMNS,
} from './ledger';

/** SHA-256 of the header and rows of `my-3d2dge:src/mocap/catalogs/cmu-takes.tsv` at e37e4ee (no comment lines). */
const ORIGINAL_ROWS_SHA256 = 'c9b672279bf7973ee9a4b70b2c7c6b0b757cccb92894fb88d17119bd09523514';

const ledger = readLedger();
const byId = new Map(ledger.takes.map((take) => [take.id, take]));

/** A catalog entry list keyed by clip name, plus the `$` records. */
type Catalog = Record<string, unknown> & { $pick: Record<string, [string, ...number[]]> };
const cmuCatalog = JSON.parse(readFileSync(join(ANIM_DIR, 'catalogs', 'cmu.json'), 'utf8')) as Catalog;

describe('the split ledger', () => {
  it('lists 17 categories, each with its own file, other and undescribed last', () => {
    const names = ledger.categories.map((entry) => entry.category);
    expect(names).toHaveLength(17);
    expect(new Set(names).size).toBe(17);
    expect(names.slice(-2)).toEqual(['other', 'undescribed']);
    for (const entry of ledger.categories) {
      expect(entry.file).toBe(`${entry.category.replaceAll(' ', '-')}.tsv`);
      expect(entry.pattern === undefined, entry.category).toBe(['other', 'undescribed'].includes(entry.category));
    }
    const files = [...ledger.categories.map((entry) => entry.file), 'categories.tsv', 'subjects.tsv'].sort();
    expect(ledgerFiles()).toEqual(files);
  });

  it('gives every category file the same columns, and the index the right number of takes', () => {
    for (const header of Object.values(ledger.headers)) expect(header).toEqual([...TAKE_COLUMNS]);
    for (const entry of ledger.categories) {
      const count = ledger.takes.filter((take) => take.category === entry.category).length;
      expect(entry.takes, entry.category).toBe(count);
    }
  });

  it('puts every take in the category its own description gives, ordered by subject and take', () => {
    for (const take of ledger.takes) expect(take.category, take.id).toBe(categoryOf(take.desc, ledger.categories));
    for (const entry of ledger.categories) {
      const ids = ledger.takes.filter((take) => take.category === entry.category).map((take) => take.id);
      expect(ids, entry.file).toEqual([...ids].sort(compareIds));
    }
  });

  it('holds each take once, and each id names its subject', () => {
    expect(byId.size).toBe(ledger.takes.length);
    for (const take of ledger.takes) {
      expect(take.id, take.id).toMatch(/^\d+_\d+$/);
      expect(Number(take.id.split('_')[0]), take.id).toBe(Number(take.subject));
    }
  });

  it('describes every subject once, with its number of takes', () => {
    const counts = new Map<number, number>();
    for (const take of ledger.takes) counts.set(Number(take.subject), (counts.get(Number(take.subject)) ?? 0) + 1);
    expect(ledger.subjects.map((entry) => entry.subject)).toEqual([...counts.keys()].sort((a, b) => a - b));
    for (const entry of ledger.subjects)
      expect(entry.takes, `subject ${entry.subject}`).toBe(counts.get(entry.subject));
  });
});

describe('the join-back', () => {
  it('rebuilds the original rows exactly (SHA-256)', () => {
    const rebuilt = joinBack(ledger);
    expect(rebuilt.split('\n')).toHaveLength(2_548 + 2);
    expect(createHash('sha256').update(rebuilt).digest('hex')).toBe(ORIGINAL_ROWS_SHA256);
  });

  it('rebuilds the original rows line for line (needs the my-3d2dge checkout)', (context) => {
    const source = requireSource('my-3d2dge', context);
    const original = originalRows(readFileSync(join(source, 'src/mocap/catalogs/cmu-takes.tsv'), 'utf8')).split('\n');
    const rebuilt = joinBack(ledger).split('\n');
    const first = original.findIndex((line, i) => line !== rebuilt[i]);
    expect(first === -1 ? null : { line: first, original: original[first], rebuilt: rebuilt[first] }).toBeNull();
    expect(rebuilt).toHaveLength(original.length);
  });

  it('changes only the takes that fell back on their subject: 191, now other', () => {
    const about = new Map(ledger.subjects.map((entry) => [entry.subject, entry.about]));
    const moved = ledger.takes.filter(
      (take) =>
        fallbackCategoryOf(take.desc, about.get(Number(take.subject)) ?? '', ledger.categories) !== take.category,
    );
    expect(moved).toHaveLength(191);
    for (const take of moved) expect(take.category, take.id).toBe('other');
    expect(moved.map((take) => take.id)).toContain('144_30');
  });
});

describe('the counts', () => {
  const flagged = (flag: string) => ledger.takes.filter((take) => take.flags.split(' ').includes(flag)).length;
  const computed: Record<string, string> = {
    Takes: ledger.takes.length.toLocaleString('en-US'),
    Subjects: String(ledger.subjects.length),
    Seconds: ledger.takes
      .reduce((sum, take) => sum + Number(take.sec), 0)
      .toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    'Takes at 60 fps': String(ledger.takes.filter((take) => take.fps === '60').length),
    'Takes `used` by the CMU set': String(ledger.takes.filter((take) => take.used).length),
    'Takes marked `pick`': String(ledger.takes.filter((take) => take.note.startsWith('pick')).length),
  };
  for (const flag of ['inverted', 'fps?', 'floats', 'loose', 'short']) {
    computed[`Takes flagged \`${flag}\``] = String(flagged(flag));
  }

  it('match README.md', () => {
    const readme = readFileSync(join(LEDGER_DIR, 'README.md'), 'utf8');
    const table = readme.slice(readme.indexOf('## Counts'));
    const rows = Object.fromEntries(
      [...table.matchAll(/^\| (.+?) \| ([\d,.]+) \|$/gm)].map((match) => [match[1], match[2]]),
    );
    expect(rows).toEqual(computed);
  });

  it('are 2,548 takes of 113 subjects, 113 of them fps? at an assumed 120 fps, and 30 picks', () => {
    expect(ledger.takes).toHaveLength(2_548);
    expect(ledger.subjects).toHaveLength(113);
    const assumed = ledger.takes.filter((take) => take.flags.split(' ').includes('fps?'));
    expect(assumed).toHaveLength(113);
    for (const take of assumed) expect(take.fps, take.id).toBe('120');
    const picks = ledger.takes.filter((take) => take.note);
    expect(picks).toHaveLength(30);
    for (const take of picks) expect(take.note, take.id).toMatch(/^pick: [A-Z][A-Za-z_]* \(.+\)$/);
  });
});

describe('the CMU set in the ledger', () => {
  const picks = Object.entries(cmuCatalog.$pick);

  it('lists each clip of the CMU catalog under the take it was cut from', () => {
    for (const [clip, [take]] of picks) {
      expect(byId.has(take), `${clip}: take ${take}`).toBe(true);
      expect(byId.get(take)?.used.split(' '), `${take} used`).toContain(clip);
    }
  });

  it('names in used only clips of the CMU catalog cut from that take: 60 clips from 59 takes', () => {
    const used = ledger.takes.filter((take) => take.used);
    expect(used).toHaveLength(59);
    const names = used.flatMap((take) => take.used.split(' ').map((clip) => [clip, take.id] as const));
    expect(names).toHaveLength(60);
    for (const [clip, take] of names) expect(cmuCatalog.$pick[clip]?.[0], clip).toBe(take);
  });
});
