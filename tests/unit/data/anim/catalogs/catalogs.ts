/**
 * @file Compares the library's catalogs with the files they were copied from, and reads the coverage map of
 * `docs/ANIMATION-RESEARCH.md`, for the library's data tests (PLAN.md §10.5 step 2 and §10.6, WP 8.1).
 *
 * A catalog is "copied verbatim apart from its named changes" when restoring the source's values at the JSON
 * pointers SOURCES.md names gives back the source's object, key order included. `differences` finds those pointers;
 * `canonicalSha256` fingerprints an object as `JSON.stringify` writes it, so the formatting (Prettier's, the
 * source's) never counts. The coverage map is the table under `## 7. The coverage map`: one row per item of the
 * ranked list (§5 of that document), the clips that cover it in backticks, and ledger categories as "N `cat` takes".
 *
 * Invariants: pointers follow RFC 6901 (`~0` for `~`, `~1` for `/`). Nothing here writes.
 *
 * @example
 * const changed = differences({ a: 1, b: [2, 3] }, { a: 1, b: [2, 4] }); // ['/b/1']
 * @see tests/unit/data/anim/catalogs/catalogs.test.ts
 * @see tests/unit/data/anim/catalogs/coverage.test.ts
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../../../../../tools/x';
import { tableUnder } from '../sources/sources';

/** The research document that carries the coverage map. */
export const RESEARCH_FILE = join(ROOT, 'docs', 'ANIMATION-RESEARCH.md');

/** The coverage map's heading in the research document, without its `## `. */
export const COVERAGE_HEADING = '7. The coverage map';

/** A JSON value as `JSON.parse` returns it. */
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** The pointer to `key` inside the value at `at`. */
function child(at: string, key: string | number): string {
  return `${at}/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`;
}

/** The keys of a pointer, unescaped. */
function keysOf(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) throw new Error(`not a JSON pointer: ${pointer}`);
  return pointer
    .slice(1)
    .split('/')
    .map((key) => key.replaceAll('~1', '/').replaceAll('~0', '~'));
}

/** True for a plain object (not an array, not null). */
function isObject(value: unknown): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The pointers at which `a` and `b` differ, in `a`'s order: a value that differs, a key or index that only one has,
 * or an object whose keys are in another order (reported at the object).
 */
export function differences(a: unknown, b: unknown, at = ''): string[] {
  if (Array.isArray(a) && Array.isArray(b)) {
    const length = Math.max(a.length, b.length);
    return Array.from({ length }, (_, i) =>
      i < a.length && i < b.length ? differences(a[i], b[i], child(at, i)) : [child(at, i)],
    ).flat();
  }
  if (isObject(a) && isObject(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    const inner = keys.flatMap((key) =>
      key in a && key in b ? differences(a[key], b[key], child(at, key)) : [child(at, key)],
    );
    const shared = (from: object, other: object) => Object.keys(from).filter((key) => key in other);
    return shared(a, b).join('\0') === shared(b, a).join('\0') ? inner : [at, ...inner];
  }
  return Object.is(a, b) ? [] : [at];
}

/** The value at `pointer` inside `doc`, or undefined. */
export function valueAt(doc: unknown, pointer: string): unknown {
  let value: unknown = doc;
  for (const key of keysOf(pointer)) {
    if (Array.isArray(value)) value = value[Number(key)];
    else if (isObject(value)) value = value[key];
    else return undefined;
  }
  return value;
}

/** A copy of `doc` with `value` at `pointer` (whose parent must exist). */
export function withValueAt<T>(doc: T, pointer: string, value: unknown): T {
  const keys = keysOf(pointer);
  const last = keys.pop();
  if (last === undefined) return structuredClone(value) as T;
  const copy = structuredClone(doc);
  const parent = valueAt(copy, keys.map((key) => child('', key)).join(''));
  if (Array.isArray(parent)) parent[Number(last)] = value as Json;
  else if (isObject(parent)) parent[last] = value as Json;
  else throw new Error(`no parent for ${pointer}`);
  return copy;
}

/** SHA-256 of `value` as `JSON.stringify` writes it (no spaces, keys in their order). */
export function canonicalSha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** A `my-3d2dge:<path>` or `shardfall:<path>` origin, split; undefined for a URL. */
export function sourceOrigin(from: string): { source: 'my-3d2dge' | 'shardfall'; path: string } | undefined {
  const match = /^(my-3d2dge|shardfall):(\S+)$/.exec(from);
  return match ? { source: match[1] as 'my-3d2dge' | 'shardfall', path: match[2] ?? '' } : undefined;
}

/** What a coverage row says of its item. */
export type Verdict = 'covered' | 'partial' | 'missing' | 'not a clip';

/** One row of the coverage map. */
export interface CoverageRow {
  /** The item's number in the ranked list. */
  item: number;
  /** The item's name, as the map gives it. */
  name: string;
  /** The clips named in the library column (backticked names not followed by "takes"). */
  clips: string[];
  /** Ledger categories the row counts, with the count it states: "177 `jump` takes". */
  takes: { category: string; count: number }[];
  verdict: Verdict;
  /** How the gap is filled, as written. */
  fill: string;
}

/** Reads the coverage map out of `text` (the research document). */
export function readCoverage(text: string = readFileSync(RESEARCH_FILE, 'utf8')): CoverageRow[] {
  return tableUnder(text, COVERAGE_HEADING).map(([item = '', name = '', library = '', verdict = '', fill = '']) => {
    const counted = [...library.matchAll(/([\d,]+) `([^`]+)` takes/g)];
    const takes = counted.map((match) => ({
      category: match[2] ?? '',
      count: Number((match[1] ?? '').replace(',', '')),
    }));
    const clips = [...library.replace(/([\d,]+) `([^`]+)` takes/g, '').matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? '');
    return {
      item: Number(item.trim()),
      name: name.trim().replaceAll('**', ''),
      clips,
      takes,
      verdict: verdict.trim().toLowerCase() as Verdict,
      fill: fill.trim(),
    };
  });
}
