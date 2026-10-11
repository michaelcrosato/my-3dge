/**
 * @file Searching the library (PLAN.md §10.3, WP 8.5): `x anim find <words>` looks through every set's generated
 * `catalog.tsv` (data/anim/sets/<set>/, tools/anim/repack.ts), then the CMU ledger's takes not yet in a set
 * (tools/anim/ledger.ts), so an agent picks a clip without opening the library. Agents search it; they never read it
 * whole.
 *
 * How it ranks: a clip matches when every word is in its name, tags or description (any case); a word in its name
 * counts most, a tag next, its description least, and a clip that is another set's again (tagged `alt`) comes after
 * the original. `cat` keeps clips with that tag and takes in that category. Takes the CMU set already uses are left
 * out (their clips are found instead). Results are lines short enough to scan, at most `max` in all with the count.
 *
 * @example
 * const found = findClips(['punch']);
 * found.clips[0].ref; // 'cmu/Punch_Combo': a clip named for the word first
 * found.lines.length <= 18; // true: with the verdict (the count) and the report path, 20 lines
 * @see tools/anim/find.test.ts
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLedger, type Ledger } from './ledger';
import { ALT_TAG, CATALOG_COLUMNS, CATALOG_FILE, SETS_DIR } from './repack';

/** One clip a search found: its `set/clip`, its catalog row and its score. */
export interface ClipHit {
  ref: string;
  row: Record<(typeof CATALOG_COLUMNS)[number], string>;
  score: number;
}
/** One CMU take a search found, not yet in a set. */
export interface TakeHit {
  id: string;
  category: string;
  sec: string;
  fit: string;
  flags: string;
  desc: string;
}
/** What a search found: every hit, a count, and the lines that show the best. */
export interface Found {
  clips: ClipHit[];
  takes: TakeHit[];
  summary: string;
  lines: string[];
}

/** Every set's catalog rows, in set and clip order. */
export function catalogRows(setsDir: string = SETS_DIR): { set: string; row: ClipHit['row'] }[] {
  const sets = existsSync(setsDir) ? readdirSync(setsDir).sort() : [];
  return sets.flatMap((set) => {
    const file = join(setsDir, set, CATALOG_FILE);
    if (!existsSync(file)) return [];
    const lines = readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l && !l.startsWith('#'));
    return lines.slice(1).map((line) => {
      const cells = line.split('\t');
      return { set, row: Object.fromEntries(CATALOG_COLUMNS.map((c, i) => [c, cells[i] ?? ''])) as ClipHit['row'] };
    });
  });
}

/** How well a clip's row matches `words` (0: it does not). */
function score(row: ClipHit['row'], words: string[]): number {
  const [name, tags, desc] = [
    row.name.toLowerCase().replace(/_/g, ' '),
    row.tags.toLowerCase().split(' '),
    row.desc.toLowerCase(),
  ];
  let total = 0;
  for (const w of words) {
    const s = (name.includes(w) ? 3 : 0) + (tags.some((t) => t.includes(w)) ? 2 : 0) + (desc.includes(w) ? 1 : 0);
    if (!s) return 0;
    total += s;
  }
  return total - (tags.includes(ALT_TAG) ? 10 : 0);
}

/** A clip's line: `set/Clip  1.2s loop  tags — desc`, cut to 110 characters. */
function clipLine(hit: ClipHit): string {
  const r = hit.row;
  const kind = r.loop === 'true' ? 'loop' : 'once';
  const line = `${hit.ref}  ${r.sec}s ${kind}${r.speed ? ` speed ${r.speed}` : ''}  ${r.tags}${r.desc ? ` — ${r.desc}` : ''}`;
  return line.length > 110 ? `${line.slice(0, 109)}…` : line;
}

/** A take's line: `cmu 13_17  26.5s combat  fit 17/88  boxing`, cut to 110 characters. */
function takeLine(t: TakeHit): string {
  const line = `cmu ${t.id}  ${t.sec}s ${t.category}  fit ${t.fit}${t.flags ? ` (${t.flags})` : ''}  ${t.desc}`;
  return line.length > 110 ? `${line.slice(0, 109)}…` : line;
}

/** Searches the sets, then the ledger, for `words` (see the file comment). */
export function findClips(
  words: string[],
  options: { cat?: string; max?: number; setsDir?: string; ledger?: Ledger } = {},
): Found {
  const { cat, max = 20 } = options;
  const q = words.map((w) => w.toLowerCase()).filter(Boolean);
  const clips = catalogRows(options.setsDir)
    .filter(({ row }) => !cat || row.tags.split(' ').includes(cat))
    .map(({ set, row }) => ({ ref: `${set}/${row.name}`, row, score: q.length ? score(row, q) : 1 }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score);
  const ledger = options.ledger ?? readLedger();
  const takes = ledger.takes
    .filter((t) => !t.used && (!cat || t.category === cat))
    .filter((t) => q.every((w) => `${t.desc} ${t.category}`.toLowerCase().includes(w)))
    .map((t) => ({ id: t.id, category: t.category, sec: t.sec, fit: t.fit, flags: t.flags, desc: t.desc }));
  // room for the verdict (the count) and the report path: `max` lines in all
  const room = Math.max(1, max - 2);
  const shownClips = clips.slice(0, Math.max(room - Math.min(takes.length, Math.ceil(room / 4)), 0));
  const shownTakes = takes.slice(0, room - shownClips.length);
  const count = `${clips.length} clip${clips.length === 1 ? '' : 's'} and ${takes.length} CMU take${takes.length === 1 ? '' : 's'}`;
  const showing = shownClips.length + shownTakes.length < clips.length + takes.length ? ', the best shown' : '';
  const lines = [...shownClips.map(clipLine), ...shownTakes.map(takeLine)];
  return { clips, takes, summary: `${count} match${showing}`, lines };
}
