/**
 * @file The CMU ledger, read and written (PLAN.md §10.3, WP 8.5): every take of the CMU database, one row each, split
 * into `data/anim/cmu/<category>.tsv`, with `categories.tsv` (the categories, tried in order, with their patterns)
 * and `subjects.tsv` (each subject's description once). `data/anim/cmu/README.md` explains the columns and flags.
 * The survey (tools/anim/survey.ts) and the rate check (tools/anim/rates.ts) write it; `x anim find` and `x anim cmu
 * ledger` read it. Ported from `my-3d2dge:tools/cmu.mjs:102-145`, whose single file WP 8.1 split.
 *
 * Invariants: written as read: a file's comment lines, then its header, then its rows, each stopping at its last
 * non-empty field (`.editorconfig` trims trailing tabs), so reading and writing an unchanged ledger changes no byte. A
 * take's category comes from its own description only (`categoryOf`; README.md says why). Rows are ordered by subject
 * and take within each file. `note` is the column people edit; the tools keep it.
 *
 * @example
 * const ledger = readLedger();
 * ledger.takes.length; // 2548
 * ledger.takes.find((take) => take.id === '13_29')?.category; // 'jump': "jumping jacks, side twists…"
 * categoryOf('playground - forward jumps, turn around', ledger.categories); // 'jump'
 * @see tools/anim/ledger.test.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../x';

/** The split ledger's directory, `data/anim/cmu/`. */
export const LEDGER_DIR = join(ROOT, 'data', 'anim', 'cmu');
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

/** One take's row, with the category its file names. */
export type Take = Record<(typeof TAKE_COLUMNS)[number], string> & { category: string };
/** One category: its name, its file, its number of takes and its pattern (none for `other` and `undescribed`). */
export interface Category {
  category: string;
  file: string;
  takes: number;
  pattern?: RegExp;
}
/** One subject: its number, its number of takes and its description on the site's motion list. */
export interface Subject {
  subject: number;
  takes: number;
  about: string;
}
/** The whole ledger, and each file's comment lines (kept on writing). */
export interface Ledger {
  categories: Category[];
  takes: Take[];
  subjects: Subject[];
  comments: Record<string, string[]>;
}

/** A tab-separated file: its comment lines, header and rows (padded to the header's length). */
function parseTsv(text: string, file: string) {
  const lines = text.split('\n').filter((line) => line !== '');
  const comments = lines.filter((line) => line.startsWith('#'));
  const [head = '', ...body] = lines.filter((line) => !line.startsWith('#'));
  const header = head.split('\t');
  const rows = body.map((line) => {
    const cells = line.split('\t');
    if (cells.length > header.length) throw new Error(`${file}: a row has more fields than the header: ${line}`);
    return [...cells, ...Array<string>(header.length - cells.length).fill('')];
  });
  return { comments, header, rows };
}

/** A tab-separated file's text: comments, header, rows stopping at their last non-empty field. */
const tsvText = (comments: string[], header: readonly string[], rows: string[][]) =>
  `${[...comments, header.join('\t'), ...rows.map((row) => row.join('\t').replace(/\t+$/, ''))].join('\n')}\n`;

/** Reads the ledger in `dir`. */
export function readLedger(dir: string = LEDGER_DIR): Ledger {
  const read = (file: string) => parseTsv(readFileSync(join(dir, file), 'utf8'), file);
  const index = read('categories.tsv');
  const comments: Record<string, string[]> = { 'categories.tsv': index.comments };
  const categories = index.rows.map(([category = '', file = '', takes = '', pattern = '']): Category => ({
    ...{ category, file, takes: Number(takes) },
    ...(pattern ? { pattern: new RegExp(pattern) } : {}),
  }));
  const takes: Take[] = [];
  for (const { category, file } of categories) {
    const tsv = read(file);
    comments[file] = tsv.comments;
    for (const row of tsv.rows)
      takes.push({ ...(Object.fromEntries(tsv.header.map((k, i) => [k, row[i]])) as Take), category });
  }
  const subjects = read('subjects.tsv');
  comments['subjects.tsv'] = subjects.comments;
  const list = subjects.rows.map(([subject = '', count = '', about = '']) => ({
    subject: +subject,
    takes: +count,
    about,
  }));
  return { categories, takes, subjects: list, comments };
}

/** Numeric order of take ids (`2_10` after `2_9`). */
export function compareIds(a: string, b: string): number {
  const [sa = 0, ta = 0] = a.split('_').map(Number);
  const [sb = 0, tb = 0] = b.split('_').map(Number);
  return sa - sb || ta - tb;
}

/** A take's category: the first whose pattern matches its description, lower-cased; `undescribed` or `other` else. */
export function categoryOf(desc: string, categories: Category[]): string {
  if (!desc) return 'undescribed';
  const lower = desc.toLowerCase();
  return categories.find((entry) => entry.pattern?.test(lower))?.category ?? 'other';
}

/** The ledger's files as text, by name: each category's rows, the index with their counts, and the subjects. */
export function ledgerFiles(ledger: Ledger): Record<string, string> {
  const files: Record<string, string> = {};
  const counts = new Map<string, number>();
  for (const { category, file } of ledger.categories) {
    const rows = ledger.takes.filter((take) => take.category === category).sort((a, b) => compareIds(a.id, b.id));
    counts.set(category, rows.length);
    const about = `# The CMU ledger's takes in category "${category}" (categories.tsv says why; README.md explains the columns).`;
    const comments = ledger.comments[file] ?? [about];
    files[file] = tsvText(
      comments,
      TAKE_COLUMNS,
      rows.map((take) => TAKE_COLUMNS.map((k) => take[k].replace(/[\t\n]/g, ' '))),
    );
  }
  const index = ledger.categories.map((c) => [
    c.category,
    c.file,
    String(counts.get(c.category)),
    c.pattern?.source ?? '',
  ]);
  files['categories.tsv'] = tsvText(
    ledger.comments['categories.tsv'] ?? [],
    ['category', 'file', 'takes', 'pattern'],
    index,
  );
  const perSubject = new Map<number, number>();
  for (const take of ledger.takes) perSubject.set(+take.subject, (perSubject.get(+take.subject) ?? 0) + 1);
  const subjects = [...perSubject.keys()]
    .sort((a, b) => a - b)
    .map((s) => {
      const about = ledger.subjects.find((entry) => entry.subject === s)?.about ?? '';
      return [String(s), String(perSubject.get(s)), about];
    });
  files['subjects.tsv'] = tsvText(ledger.comments['subjects.tsv'] ?? [], ['subject', 'takes', 'about'], subjects);
  return files;
}

/** Writes the ledger into `dir`; returns the files whose text changed. */
export function writeLedger(ledger: Ledger, dir: string = LEDGER_DIR): string[] {
  const changed: string[] = [];
  for (const [file, text] of Object.entries(ledgerFiles(ledger))) {
    let before = '';
    try {
      before = readFileSync(join(dir, file), 'utf8');
    } catch {
      // a new file
    }
    if (before !== text) {
      writeFileSync(join(dir, file), text);
      changed.push(file);
    }
  }
  return changed.sort();
}

/** The takes matching every word (a category's name, or text in the id, description, flags, note or clips used). */
export function queryLedger(ledger: Ledger, words: string[], status?: string): Take[] {
  const q = words.map((w) => w.toLowerCase());
  return ledger.takes
    .filter((r) =>
      q.every((w) => r.category === w || `${r.id} ${r.desc} ${r.flags} ${r.note} ${r.used}`.toLowerCase().includes(w)),
    )
    .filter(
      (r) =>
        !status || (status === 'none' ? !r.used && !r.note : status === 'used' ? !!r.used : r.note.startsWith(status)),
    )
    .sort((a, b) => compareIds(a.id, b.id));
}
