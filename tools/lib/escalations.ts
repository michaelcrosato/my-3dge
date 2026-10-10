/**
 * @file Escalation records (DOCTRINE.md, Escalation; PLAN.md §8.14, ADR-0017): `docs/escalations/ESC-NNNN-<slug>.md`,
 * front matter then a short body. Reads, writes and validates them and generates `docs/escalations/README.md`;
 * tools/cmd/esc.ts is the command that changes them and the `x check` plugin that checks them.
 *
 * Invariants:
 * - The front matter holds exactly `FIELDS`, in that order, one `key: value` per line: a string is plain when YAML
 *   would read it as the same string, else JSON-quoted; `options` is a list of `  - "…"` lines. A YAML reader and
 *   this one agree.
 * - Times are ISO 8601 in UTC, to the second; `deadline` is `WAIT_MINUTES` (15) after `raised`.
 * - Ids count up from ESC-0001 and never repeat; two lanes that pick the same number fail `x check` until the later
 *   one is renumbered.
 * - Status moves open → answered (the owner replied) or decided-in-absence (a call at a commit) → closed (the owner
 *   reviewed it); an answer may still follow a call. A call always names its commit.
 * - The README depends only on the records, never on the clock, and is Prettier-formatted, so `prettier --check`
 *   passes and a stale file shows as a difference.
 *
 * @example
 * const text = serializeRecord({ id: 'ESC-0001', title: 'Commit a PNG?', status: 'open', principle: 'Assets',
 *   raised: '2026-10-10T12:00:00Z', deadline: '2026-10-10T12:15:00Z', run: 'local', options: ['Generate it',
 *   'Commit it'], recommendation: 1, answer: null, call: null, commit: null, followUp: null }, '# ESC-0001');
 * validateFields(parseRecord(text).fields, 'ESC-0001-commit-a-png.md'); // []
 * @see tools/cmd/esc.test.ts
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { closest } from '../x';

/** Where the records live, from the repository root. */
export const DIR = 'docs/escalations';
/** The generated index of the records. */
export const INDEX = `${DIR}/README.md`;
/** How long the owner has to answer before the agent decides (DOCTRINE.md, Escalation). */
export const WAIT_MINUTES = 15;
/** A record's statuses, in the order they are reached. */
export const STATUSES = ['open', 'answered', 'decided-in-absence', 'closed'] as const;
/** A record's status. */
export type Status = (typeof STATUSES)[number];
/** The doctrine's short names (PLAN.md §3), plus its framing sections, which `principle` may cite. */
export const PRINCIPLES = [
  'Agent-readable',
  'Agent-operable',
  'Verifiable',
  'Assets',
  'Reproducible',
  'WebGPU only',
  'Common ground',
  'Quality under the hood',
  'Mastery',
  'Discovery first',
  'Escalation',
  'How to read this',
  'North Star',
] as const;
/** The front-matter fields, in their written order. */
export const FIELDS = [
  'id',
  'title',
  'status',
  'principle',
  'raised',
  'deadline',
  'run',
  'options',
  'recommendation',
  'answer',
  'call',
  'commit',
  'followUp',
] as const;

/** A record's front matter. */
export interface Escalation {
  /** `ESC-NNNN`, also the start of the file name. */
  id: string;
  /** The question, in one line. */
  title: string;
  status: Status;
  /** One or more of `PRINCIPLES`, comma-separated. */
  principle: string;
  /** When it was opened (ISO 8601, UTC). */
  raised: string;
  /** `raised` plus 15 minutes: the call is due then if the owner has not answered. */
  deadline: string;
  /** The session or workflow run that raised it. */
  run: string;
  /** The choices put to the owner (at least two). */
  options: string[];
  /** The recommended option, 1-based. */
  recommendation: number;
  /** The owner's answer, once given. */
  answer: string | null;
  /** The call made without an answer: what was done and why. */
  call: string | null;
  /** The commit the call was made at. */
  commit: string | null;
  /** What still has to happen: a WP, a reversal, a check. */
  followUp: string | null;
}

/** A record as read from disk: its file name, its front matter (unchecked) and body, and what is wrong with it. */
export interface RecordFile {
  file: string;
  fields: Record<string, unknown>;
  body: string;
  problems: string[];
}

const NAME = /^(ESC-\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;
const SHA = /^[0-9a-f]{7,40}$/;
const PLAIN = /^[A-Za-z0-9][A-Za-z0-9_.:+-]*$/;
const RESERVED = /^(?:null|true|false|yes|no|on|off|~|[-+]?[\d.]+(?:e[-+]?\d+)?|0x[\da-f]+|0o[0-7]+)$/i;

/** A time as the records write it: ISO 8601, UTC, to the second. */
export const isoSeconds = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** The deadline for a record raised at `raised`: 15 minutes later. */
export const deadlineFor = (raised: Date) => new Date(raised.getTime() + WAIT_MINUTES * 60_000);

/** A file-name slug for a question: lower case, words joined by `-`, at most 48 characters, cut at a word. */
export function slugOf(question: string): string {
  const plain = question.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  let slug = '';
  for (const word of plain.split(/[^a-z0-9]+/).filter(Boolean)) {
    if (slug && slug.length + 1 + word.length > 48) break;
    slug = slug ? `${slug}-${word}` : word.slice(0, 48);
  }
  return slug || 'question';
}

/** The canonical spelling of a `principle` value (comma-separated short names, any case); throws naming the closest. */
export function canonicalPrinciple(text: string): string {
  const names = text.split(',').map((name) => name.trim());
  return names
    .map((name) => {
      const found = PRINCIPLES.find((principle) => principle.toLowerCase() === name.toLowerCase());
      if (found) return found;
      const near = closest(name, PRINCIPLES);
      throw new Error(
        `"${name}" is not one of the doctrine's short names${near ? `: did you mean "${near}"?` : ''} (${PRINCIPLES.join(', ')})`,
      );
    })
    .join(', ');
}

/** Writes one front-matter value: plain when YAML reads it back as the same string, else JSON-quoted. */
function scalar(value: string | number | null): string {
  if (value === null) return 'null';
  if (typeof value === 'number') return String(value);
  return PLAIN.test(value) && !RESERVED.test(value) ? value : JSON.stringify(value);
}

/** Reads one front-matter value back. */
function readScalar(raw: string): unknown {
  const text = raw.trim();
  if (text === 'null' || text === '~') return null;
  if (/^-?\d+$/.test(text)) return Number(text);
  if (text.startsWith('"')) return JSON.parse(text) as unknown;
  return text;
}

/** The record's text: front matter (`FIELDS` in order) then `body`. */
export function serializeRecord(fields: Escalation, body: string): string {
  const lines = ['---'];
  for (const key of FIELDS) {
    const value = fields[key];
    if (Array.isArray(value)) lines.push(`${key}:`, ...value.map((item) => `  - ${scalar(item)}`));
    else lines.push(`${key}: ${scalar(value)}`);
  }
  return `${lines.join('\n')}\n---\n\n${body.trim()}\n`;
}

/** Splits a record's text into its front matter (unchecked) and body, with the problems found reading it. */
export function parseRecord(text: string): Omit<RecordFile, 'file'> {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n'));
  if (!match) return { fields: {}, body: text, problems: ['it has no front matter (--- … --- first)'] };
  const fields: Record<string, unknown> = {};
  const problems: string[] = [];
  let list: unknown[] | undefined;
  match[1].split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    try {
      const item = /^\s+-\s+(.*)$/.exec(line);
      if (item) {
        if (list) list.push(readScalar(item[1]));
        else problems.push(`line ${i + 2} is a list item outside a list`);
        return;
      }
      const pair = /^([A-Za-z]+):(?:[ \t]+(.*))?$/.exec(line);
      if (!pair) return void problems.push(`line ${i + 2} is not "key: value": ${line.trim()}`);
      if (pair[1] in fields) problems.push(`"${pair[1]}" appears twice`);
      list = pair[2] === undefined || pair[2].trim() === '' ? [] : undefined;
      fields[pair[1]] = list ?? readScalar(pair[2] ?? '');
    } catch (error) {
      problems.push(`line ${i + 2} holds a malformed quoted string: ${(error as Error).message}`);
    }
  });
  return { fields, body: match[2], problems };
}

const text = (value: unknown) => typeof value === 'string' && value.trim() !== '';
const nullable = (value: unknown) => value === null || text(value);

/** What is wrong with a record's front matter, read from `file` (its name only); empty when it is well-formed. */
export function validateFields(fields: Record<string, unknown>, file: string): string[] {
  const problems: string[] = [];
  for (const key of Object.keys(fields)) {
    if ((FIELDS as readonly string[]).includes(key)) continue;
    const near = closest(key, FIELDS);
    problems.push(`unknown field "${key}"${near ? `: did you mean "${near}"?` : ''}`);
  }
  const missing = FIELDS.filter((key) => !(key in fields));
  if (missing.length) problems.push(`missing ${missing.map((key) => `"${key}"`).join(', ')}`);
  const f = fields as Partial<Record<(typeof FIELDS)[number], unknown>>;
  const name = NAME.exec(file);
  if (!name) problems.push(`the file name must be ESC-NNNN-<slug>.md (lower-case words joined by -)`);
  if (typeof f.id !== 'string' || !/^ESC-\d{4}$/.test(f.id)) problems.push('"id" must be ESC-NNNN');
  else if (name && name[1] !== f.id) problems.push(`"id" is ${f.id} but the file name says ${name[1]}`);
  if (!text(f.title)) problems.push('"title" must be the question, in one line');
  if (!(STATUSES as readonly unknown[]).includes(f.status)) problems.push(`"status" must be ${STATUSES.join(', ')}`);
  try {
    if (typeof f.principle !== 'string' || canonicalPrinciple(f.principle) !== f.principle) {
      problems.push(`"principle" must be the doctrine's short names, spelled as ${PRINCIPLES.join(', ')}`);
    }
  } catch (error) {
    problems.push(`"principle": ${(error as Error).message}`);
  }
  const times = (['raised', 'deadline'] as const).map((key) => {
    const ok = typeof f[key] === 'string' && TIME.test(f[key]) && !Number.isNaN(Date.parse(f[key]));
    if (!ok) problems.push(`"${key}" must be a UTC time to the second, like 2026-10-10T12:00:00Z`);
    return ok ? Date.parse(f[key] as string) : undefined;
  });
  if (times[0] !== undefined && times[1] !== undefined && times[1] - times[0] !== WAIT_MINUTES * 60_000) {
    problems.push(`"deadline" must be ${WAIT_MINUTES} minutes after "raised"`);
  }
  if (!text(f.run)) problems.push('"run" must name the session or workflow run');
  const options = Array.isArray(f.options) && f.options.every(text) ? f.options : undefined;
  if (!options || options.length < 2) problems.push('"options" must list at least two choices');
  const count = options?.length ?? 0;
  if (!Number.isInteger(f.recommendation) || (f.recommendation as number) < 1 || (f.recommendation as number) > count) {
    problems.push(`"recommendation" must be the number of one of the options (1 to ${count})`);
  }
  for (const key of ['answer', 'call', 'followUp'] as const) {
    if (!nullable(f[key])) problems.push(`"${key}" must be null or a sentence`);
  }
  if (f.commit !== null && !(typeof f.commit === 'string' && SHA.test(f.commit))) {
    problems.push('"commit" must be null or a commit sha (7 to 40 hex digits)');
  }
  if ((f.call === null) !== (f.commit === null))
    problems.push('"call" and "commit" go together: a call names its commit');
  if (f.status === 'open' && (f.answer !== null || f.call !== null)) {
    problems.push('an open record has no answer and no call yet: its status must say what happened');
  }
  if (f.status === 'answered' && !text(f.answer)) problems.push('an answered record needs its "answer"');
  if (f.status === 'decided-in-absence' && !text(f.call)) problems.push('a decided-in-absence record needs its "call"');
  return problems;
}

/** Reads every file in `docs/escalations/` but the README, each with the problems found; sorted by name. */
export function readRecords(root: string): RecordFile[] {
  const dir = join(root, DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file !== 'README.md')
    .sort()
    .map((file) => {
      if (!file.endsWith('.md')) return { file, fields: {}, body: '', problems: ['only records belong here'] };
      const parsed = parseRecord(readFileSync(join(dir, file), 'utf8'));
      const bare = Object.keys(parsed.fields).length === 0 && parsed.problems.length > 0;
      const problems = bare ? parsed.problems : [...parsed.problems, ...validateFields(parsed.fields, file)];
      if (!parsed.body.trim()) problems.push('it needs a short body after the front matter');
      return { file, ...parsed, problems };
    });
}

/** The records that are well-formed, as front matter, in id order. */
export function wellFormed(records: readonly RecordFile[]): (Escalation & { file: string })[] {
  return records
    .filter((record) => record.problems.length === 0)
    .map((record) => ({ ...(record.fields as unknown as Escalation), file: record.file }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** The next free id: one past the highest number in use, malformed records included. */
export function nextId(records: readonly RecordFile[]): string {
  const numbers = records.map((record) => Number(/^ESC-(\d{4})/.exec(record.file)?.[1] ?? 0));
  return `ESC-${String(Math.max(0, ...numbers) + 1).padStart(4, '0')}`;
}

/** Writes a record to `docs/escalations/<file>` under `root`. */
export function writeRecord(root: string, file: string, fields: Escalation, body: string): void {
  writeFileSync(join(root, DIR, file), serializeRecord(fields, body));
}

/** Whether a record is open past its deadline with no call, at `now`. */
export const isOverdue = (record: Escalation, now: Date) =>
  record.status === 'open' && record.call === null && now.getTime() > Date.parse(record.deadline);

/** The index's sections, in order: the calls awaiting the owner's review first. */
const SECTIONS: { status: Status; heading: string; note: string; columns: [string, (e: Escalation) => string][] }[] = [
  {
    status: 'decided-in-absence',
    heading: "Calls awaiting the owner's review",
    note: 'Made without an answer after the deadline: keep or reverse each, then `node x esc close ESC-NNNN`.',
    columns: [
      ['Call', (e) => e.call ?? ''],
      ['Commit', (e) => e.commit ?? ''],
    ],
  },
  {
    status: 'open',
    heading: 'Open',
    note: 'Waiting for an answer until the deadline; then the agent decides and records the call.',
    columns: [
      ['Deadline', (e) => e.deadline],
      ['Recommended', (e) => e.options[e.recommendation - 1] ?? ''],
    ],
  },
  {
    status: 'answered',
    heading: 'Answered',
    note: 'The owner answered: the agent acts on it, then closes the record.',
    columns: [['Answer', (e) => e.answer ?? '']],
  },
  {
    status: 'closed',
    heading: 'Closed',
    note: 'Reviewed and settled.',
    columns: [
      ['Outcome', (e) => e.answer ?? e.call ?? 'closed without an answer or a call'],
      ['Follow-up', (e) => e.followUp ?? ''],
    ],
  },
];

const cell = (value: string) => value.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();

/** The README's Markdown before formatting: the records by status, the calls awaiting review first. */
export function indexMarkdown(records: readonly (Escalation & { file: string })[]): string {
  const out = [
    '<!-- Generated by node x esc from the records beside it: every x esc that changes a record rewrites it, and',
    '`node x esc list --write` regenerates it. Never edit it by hand. -->',
    '',
    '# Escalations',
    '',
    "Every escalation, every later conflict and every call made without the owner's answer (DOCTRINE.md, Escalation;",
    'PLAN.md §8.14), one record per file, written by `node x esc`. `node x esc list --open` lists what still needs',
    'review; the owner closes a record with `node x esc close ESC-NNNN`, keeping or reversing its call.',
  ];
  for (const section of SECTIONS) {
    const rows = records.filter((record) => record.status === section.status);
    out.push('', `## ${section.heading} (${rows.length})`, '', section.note, '');
    if (!rows.length) {
      out.push('None.');
      continue;
    }
    const head = ['Record', 'Principle', 'Raised', 'Question', ...section.columns.map(([name]) => name)];
    out.push(`| ${head.join(' | ')} |`, `|${head.map(() => ' --- |').join('')}`);
    for (const row of rows) {
      const values = [`[${row.id}](${row.file})`, row.principle, row.raised, row.title];
      out.push(`| ${[...values, ...section.columns.map(([, value]) => value(row))].map(cell).join(' | ')} |`);
    }
  }
  return `${out.join('\n')}\n`;
}

/** The README as `node x esc` writes it: generated from the records under `root`, Prettier-formatted. */
export async function generateIndex(root: string, records = readRecords(root)): Promise<string> {
  const path = join(root, INDEX);
  return format(indexMarkdown(wellFormed(records)), { ...((await resolveConfig(path)) ?? {}), filepath: path });
}

/** Rewrites the README when it differs from the records; returns whether it wrote. */
export async function writeIndex(root: string): Promise<boolean> {
  const generated = await generateIndex(root);
  const path = join(root, INDEX);
  if (existsSync(path) && readFileSync(path, 'utf8') === generated) return false;
  writeFileSync(path, generated);
  return true;
}
