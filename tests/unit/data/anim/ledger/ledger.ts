/**
 * @file Reads the CMU ledger in `data/anim/cmu/` for the library's data tests (PLAN.md §10.3, WP 8.1): the category
 * index (`categories.tsv`), one file of takes per category and `subjects.tsv`. It also holds the two category rules,
 * the ledger's own (a take's description only) and my-3d2dge's (the subject's description when the take's matched
 * nothing), and rebuilds the original single-file ledger's rows from the split, so a test can join them back.
 *
 * Invariants: a row that stops short of its last, empty fields (`.editorconfig` trims trailing tabs) reads as if they
 * were there; `#` lines are comments. Nothing here writes.
 *
 * @example
 * const ledger = readLedger();
 * const jumps = ledger.takes.filter((take) => take.category === 'jump').length; // 177
 * @see tests/unit/data/anim/ledger/ledger.test.ts
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../../../../../tools/x';

/** The library's data directory, `data/anim/`. */
export const ANIM_DIR = join(ROOT, 'data', 'anim');

/** The split ledger's directory, `data/anim/cmu/`. */
export const LEDGER_DIR = join(ANIM_DIR, 'cmu');

/** The columns of each category file, in order. */
export const TAKE_COLUMNS = [
  'id',
  'subject',
  'fps',
  'sec',
  'active',
  'fit',
  'travel',
  'hips',
  'flags',
  'used',
  'note',
  'desc',
] as const;

/** The columns of my-3d2dge's single-file ledger (`my-3d2dge:src/mocap/catalogs/cmu-takes.tsv`), in order. */
export const ORIGINAL_COLUMNS = [
  'id',
  'subject',
  'fps',
  'sec',
  'category',
  'active',
  'fit',
  'travel',
  'hips',
  'flags',
  'used',
  'note',
  'desc',
  'about',
] as const;

/** A tab-separated file: its comment lines, its header and its rows, each padded to the header's length. */
export interface Tsv {
  comments: string[];
  header: string[];
  rows: string[][];
}

/** Parses tab-separated `text`: `#` lines are comments, the first other line is the header, empty lines are skipped. */
export function parseTsv(text: string): Tsv {
  const lines = text.split('\n').filter((line) => line !== '');
  const comments = lines.filter((line) => line.startsWith('#'));
  const [head = '', ...body] = lines.filter((line) => !line.startsWith('#'));
  const header = head.split('\t');
  const rows = body.map((line) => {
    const cells = line.split('\t');
    if (cells.length > header.length) throw new Error(`more fields than the header has: ${line}`);
    return [...cells, ...Array<string>(header.length - cells.length).fill('')];
  });
  return { comments, header, rows };
}

/** One category of `categories.tsv`. */
export interface Category {
  category: string;
  /** Its file in `data/anim/cmu/`. */
  file: string;
  /** How many takes the index says its file holds. */
  takes: number;
  /** Its pattern, tried against a description in lower case; undefined for `other` and `undescribed`. */
  pattern?: RegExp;
}

/** One take: a row of a category file, with the category its file names. */
export type Take = Record<(typeof TAKE_COLUMNS)[number], string> & { category: string };

/** One row of `subjects.tsv`. */
export interface Subject {
  subject: number;
  takes: number;
  about: string;
}

/** The whole split ledger, as read. */
export interface Ledger {
  categories: Category[];
  /** Every take, in file order (category files in index order). */
  takes: Take[];
  subjects: Subject[];
  /** Each category file's header, by file name. */
  headers: Record<string, string[]>;
}

/** Reads a file of the split ledger. */
export function readLedgerFile(file: string, dir: string = LEDGER_DIR): Tsv {
  return parseTsv(readFileSync(join(dir, file), 'utf8'));
}

/** Reads `categories.tsv`, `subjects.tsv` and every category file under `dir`. */
export function readLedger(dir: string = LEDGER_DIR): Ledger {
  const categories = readLedgerFile('categories.tsv', dir).rows.map(
    ([category = '', file = '', takes = '', pattern = '']): Category => ({
      category,
      file,
      takes: Number(takes),
      ...(pattern ? { pattern: new RegExp(pattern) } : {}),
    }),
  );
  const headers: Record<string, string[]> = {};
  const takes: Take[] = [];
  for (const { category, file } of categories) {
    const tsv = readLedgerFile(file, dir);
    headers[file] = tsv.header;
    for (const row of tsv.rows) {
      takes.push({ ...(Object.fromEntries(tsv.header.map((key, i) => [key, row[i]])) as Take), category });
    }
  }
  const subjects = readLedgerFile('subjects.tsv', dir).rows.map(([subject = '', count = '', about = '']): Subject => ({
    subject: Number(subject),
    takes: Number(count),
    about,
  }));
  return { categories, takes, subjects, headers };
}

/** The `.tsv` files in `dir`, sorted. */
export function ledgerFiles(dir: string = LEDGER_DIR): string[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.tsv'))
    .sort();
}

/** The first category whose pattern matches `text` (lower-cased), if any. */
function firstMatch(text: string, categories: Category[]): string | undefined {
  const lower = text.toLowerCase();
  return categories.find((entry) => entry.pattern?.test(lower))?.category;
}

/** The ledger's rule: a take's category from its own description only (`data/anim/cmu/README.md`). */
export function categoryOf(desc: string, categories: Category[]): string {
  if (!desc) return 'undescribed';
  return firstMatch(desc, categories) ?? 'other';
}

/** my-3d2dge's rule (`my-3d2dge:tools/cmu.mjs:122`): the take's description first, then its subject's. */
export function fallbackCategoryOf(desc: string, about: string, categories: Category[]): string {
  if (!desc) return 'undescribed';
  return firstMatch(desc, categories) ?? firstMatch(about, categories) ?? 'other';
}

/** Numeric order of take ids (`2_10` after `2_9`, `10_01` after `9_99`). */
export function compareIds(a: string, b: string): number {
  const [sa = 0, ta = 0] = a.split('_').map(Number);
  const [sb = 0, tb = 0] = b.split('_').map(Number);
  return sa - sb || ta - tb;
}

/**
 * The original ledger's header and rows, rebuilt from the split: every take in id order, its subject's description
 * restored and its category given by my-3d2dge's rule. Text in the original's format, one line each.
 */
export function joinBack(ledger: Ledger): string {
  const about = new Map(ledger.subjects.map((entry) => [entry.subject, entry.about]));
  const rows = [...ledger.takes].sort((a, b) => compareIds(a.id, b.id));
  const lines = rows.map((take) => {
    const subject = about.get(Number(take.subject)) ?? '';
    const full = { ...take, about: subject, category: fallbackCategoryOf(take.desc, subject, ledger.categories) };
    return ORIGINAL_COLUMNS.map((key) => full[key]).join('\t');
  });
  return [ORIGINAL_COLUMNS.join('\t'), ...lines].join('\n') + '\n';
}

/** The header and rows of the original ledger's text: its comment and empty lines left out. */
export function originalRows(text: string): string {
  return (
    text
      .split('\n')
      .filter((line) => line !== '' && !line.startsWith('#'))
      .join('\n') + '\n'
  );
}
