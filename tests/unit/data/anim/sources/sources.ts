/**
 * @file Reads `data/anim/SOURCES.md` and the catalogs in `data/anim/catalogs/` for the library's data tests (PLAN.md
 * §10.1, WP 8.1): the **Sources** table (one row per library a catalog's `"$sources"` names) and the **Where each
 * file came from** table (each data file's origin and the values that differ from it).
 *
 * Invariants: cells are read as written, with backticks taken off and a Markdown link read as its target; a table is
 * the first one under its `##` heading. Nothing here writes.
 *
 * @example
 * const ids = readSources().sources.map((row) => row.source); // ['UAL1', 'UAL2', 'M2M_QUATERNIUS', …]
 * @see tests/unit/data/anim/sources/sources.test.ts
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ANIM_DIR } from '../ledger/ledger';

/** `data/anim/SOURCES.md`. */
export const SOURCES_FILE = join(ANIM_DIR, 'SOURCES.md');

/** The catalogs' directory, `data/anim/catalogs/`. */
export const CATALOG_DIR = join(ANIM_DIR, 'catalogs');

/** A row of the Sources table. */
export interface SourceRow {
  /** The id a catalog's `"$sources"` and a clip's `src` use: `UAL1`, `CMU`. */
  source: string;
  library: string;
  /** The set its clips are in: `QUATERNIUS`. */
  set: string;
  /** As a catalog states it: `CC0 1.0`, or `CMU terms` (which a catalog's license starts with). */
  license: string;
  /** The license text's path, relative to `data/anim/`. */
  licenseText: string;
  url: string;
  /** The library's file names, as written (backticks taken off). */
  files: string;
}

/** A row of the Where-each-file-came-from table. */
export interface FileRow {
  /** The data file, relative to `data/anim/`; may hold a `*`. */
  file: string;
  /** `my-3d2dge:<path>`, `shardfall:<path>` or a URL. */
  from: string;
  /** The JSON pointers the Changes cell names (backticked, starting `/`). */
  changed: string[];
}

/** Both tables of SOURCES.md, and its text. */
export interface Sources {
  text: string;
  sources: SourceRow[];
  files: FileRow[];
}

/** One Markdown table cell, as plain text: backticks off, `[text](target)` read as its target. */
function cell(raw: string): string {
  return raw
    .trim()
    .replace(/\[[^\]]*\]\(([^)]*)\)/g, '$1')
    .replaceAll('`', '');
}

/** The rows of the first table under the `## <heading>` of `text`, as raw cells (the header and rule left out). */
export function tableUnder(text: string, heading: string): string[][] {
  const start = text.indexOf(`\n## ${heading}\n`);
  if (start < 0) throw new Error(`SOURCES.md has no "## ${heading}" section`);
  const section = text.slice(start + 1).split(/\n## /)[0] ?? '';
  const lines = section.split('\n').filter((line) => line.startsWith('|'));
  return lines.slice(2).map((line) => line.slice(1, -1).split(' | '));
}

/** Reads SOURCES.md's two tables. */
export function readSources(file: string = SOURCES_FILE): Sources {
  const text = readFileSync(file, 'utf8');
  const sources = tableUnder(text, 'Sources').map((row): SourceRow => {
    const [source = '', library = '', set = '', license = '', licenseText = '', url = '', files = ''] = row.map(cell);
    return { source, library, set, license, licenseText, url, files };
  });
  const files = tableUnder(text, 'Where each file came from').map((row): FileRow => {
    const [file = '', from = '', changes = ''] = row;
    return { file: cell(file), from: cell(from), changed: [...changes.matchAll(/`(\/[^`]+)`/g)].map((m) => m[1] ?? '') };
  });
  return { text, sources, files };
}

/** A catalog's `"$sources"` record for one library. */
export interface CatalogSource {
  label: string;
  origin: string;
  license: string;
  url: string;
}

/** A catalog: clip entries `[tags, description, orig?]` by name, plus its `$sources`, `$skip` and `$pick`. */
export interface Catalog {
  $sources: Record<string, CatalogSource>;
  $skip?: Record<string, string>;
  $pick?: Record<string, [string, ...number[]]>;
  [clip: string]: unknown;
}

/** Each catalog in `data/anim/catalogs/`, by file name (`cmu.json`). */
export function readCatalogs(dir: string = CATALOG_DIR): Record<string, Catalog> {
  const names = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort();
  return Object.fromEntries(names.map((name) => [name, JSON.parse(readFileSync(join(dir, name), 'utf8')) as Catalog]));
}

/** A catalog's clip entries (its keys not starting `$`), by name. */
export function entries(catalog: Catalog): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(catalog).filter(([name]) => !name.startsWith('$')) as [string, string[]][],
  );
}

/** `text` with every run of white space as one space, for comparing verbatim quotes across line breaks. */
export function squash(text: string): string {
  return text.replace(/\s+/g, ' ');
}

/** CMU's terms, as `data/anim/LICENSES/CMU.txt` quotes them: the sentences every record of them must carry verbatim. */
export const CMU_TERMS = [
  'The motion capture data may be copied, modified, or redistributed without permission.',
  'You may include this data in commercially-sold products, but you may not resell this data directly, even in converted form.',
  'The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217.',
] as const;
