/**
 * @file The repacker (PLAN.md §10.3 and §10.5 step 4, WP 8.3): a set of clips stored as a directory,
 * `data/anim/sets/<set>/`, one file per clip, so an agent opens only the clips it uses. `splitSet` writes a set as:
 * - `<Clip_Slug>.json`, one per clip: the clip's `text()` (`clipText`, engine/anim/clip/lens.ts: the header on one
 *   line, then three lines a key), named by `clipSlug` of its name, the real name kept inside in `clip`;
 * - `_set.json`: the rest of the set, in its own order: its name, credit, `sources` (rest bodies, licenses), `body`,
 *   and `fit`, each clip's `[mean, worst]` in mm, which also lists the clips in the set's order;
 * - `catalog.tsv`: generated, one row per clip (`CATALOG_COLUMNS`), for grep and WP 8.5's `find`.
 *
 * `joinSet` reads the files back into the set it was split from: equal, and exact, key order included, when each key's
 * fields are in `text()`'s order, as in every set `text()` wrote (all of my-3d2dge's and shardfall's).
 *
 * Sets come in two ways: my-3d2dge's `src/mocap/sets/<set>.js`, read through the legacy oracle
 * (tools/anim/legacy-readable.ts), which `legacySetFiles` repacks into data/anim/sets/ (the three curated sets, HERO
 * dropped, each of Mesh2Motion's Quaternius re-exports tagged `alt` by `tagAlternates`, and CMU's sources given CMU's
 * terms by `withCmuTerms`); and plain JSON sets, as shardfall writes them (`readPlainSet`; WP 8.10's
 * tools/anim/shardfall.ts).
 *
 * Invariants: a clip file holds its clip's `text()` and nothing else, so the repack leaves `text()` output unchanged.
 * Every file is read through the codec's parser (engine/anim/clip/validate.ts), so a broken one is refused with its
 * file named. File names never differ in case only (some file systems ignore case). The directory is generated:
 * `writeSetDir` removes the files a set no longer has. Prettier leaves the directory alone (`.prettierignore`), since
 * it would spread each key over 13 lines.
 *
 * Usage: `node x anim repack [--check]` (or `npx tsx tools/anim/repack.ts [--check]`) repacks the curated sets from
 * `$MY3D2DGE_SRC` (`node x src`) into data/anim/sets/, or with `--check` only compares; `node x anim repack
 * <set.json>… [--check]` does the same for plain JSON sets. Exit 1 on a difference or an error.
 *
 * @example
 * clipSlug('Bow Pull Back'); // 'Bow_Pull_Back'
 * const cmu = readSet('cmu'); // data/anim/sets/cmu/, rejoined
 * Object.keys(cmu.clips).length; // 60
 * Object.keys(splitSet(cmu)).length; // 62: a file per clip, _set.json and catalog.tsv
 * catalogTsv(cmu).split('\n')[3]; // 'name\tsec\tloop\tspeed\ttags\tdesc\tsrc\torig\ttake\tfit'
 * @see tools/anim/repack.test.ts
 * @see tests/unit/data/anim/sets/sets.test.ts
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { clipText } from '../../engine/anim/clip/lens';
import type { Clip } from '../../engine/anim/clip/readable';
import { parseClip, parseClipSet, type ClipSet } from '../../engine/anim/clip/validate';
import { layout } from '../cmd/port';
import { resolveSource, sourceSpecs } from '../lib/source';
import { ROOT } from '../x';
import { CURATED_SETS, readLegacySet } from './legacy-readable';

/** The sets' directory, `data/anim/sets/`: one directory per set, named by `setDirName`. */
export const SETS_DIR = join(ROOT, 'data', 'anim', 'sets');
/** The file that holds a set's header: everything but its clips. */
export const SET_FILE = '_set.json';
/** The generated index of a set's clips. */
export const CATALOG_FILE = 'catalog.tsv';
/** The tag of a clip that is another set's clip again (it has an `orig`): finders rank it after the original. */
export const ALT_TAG = 'alt';
/** The columns of `catalog.tsv`: a clip's name, length, loop, speed, tags, description, origins and fit. */
export const CATALOG_COLUMNS = ['name', 'sec', 'loop', 'speed', 'tags', 'desc', 'src', 'orig', 'take', 'fit'] as const;

/** A set's directory as text: file name → contents. */
export type SetFiles = Record<string, string>;

/**
 * The file name of a clip, without `.json`: its name with each run of characters other than letters, digits, `_`
 * and `-` made one `_`, and `_` and `-` trimmed from the ends. Throws for a name with nothing left.
 */
export function clipSlug(name: string): string {
  const slug = name.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^[_-]+|[_-]+$/g, '');
  if (!slug) throw new Error(`the clip "${name}" has no letter or digit to name its file by: rename the clip`);
  return slug;
}

/** A set's directory name: its name, slugged, in lower case (`STYLE100_BACK` → `style100_back`). */
export const setDirName = (set: string) => clipSlug(set).toLowerCase();

/** The set's `fit` with the clips' entries first, in the clips' order, so `joinSet` can restore that order. */
function fitInClipOrder(set: ClipSet): ClipSet['fit'] {
  const fit = set.fit ?? {};
  const listed = Object.keys(set.clips).filter((name) => Object.hasOwn(fit, name));
  const others = Object.keys(fit).filter((name) => !Object.hasOwn(set.clips, name));
  return Object.fromEntries([...listed, ...others].map((name) => [name, fit[name]]));
}

/** Writes a set as its directory's files: one `text()` per clip, `_set.json` and `catalog.tsv` (the file comment). */
export function splitSet(set: ClipSet): SetFiles {
  const files: SetFiles = {};
  const taken = new Map<string, string>();
  for (const [name, value] of Object.entries(set.clips)) {
    if (value.clip !== undefined && value.clip !== name) {
      const fix = 'a clip’s "clip" is its name in the set: rename one so they agree';
      throw new Error(`${set.set}/${name} says "clip": "${value.clip}": ${fix}`);
    }
    const file = `${clipSlug(name)}.json`;
    const clash = taken.get(file.toLowerCase());
    if (clash !== undefined) {
      const why = 'some file systems ignore case';
      throw new Error(
        `set ${set.set}: clips "${name}" and "${clash}" would share the file ${file} (${why}): rename one`,
      );
    }
    taken.set(file.toLowerCase(), name);
    files[file] = `${clipText(value.clip === undefined ? { clip: name, ...value } : value)}\n`;
  }
  const { clips: _clips, ...header } = set;
  files[SET_FILE] = `${layout(set.fit ? { ...header, fit: fitInClipOrder(set) } : header)}\n`;
  files[CATALOG_FILE] = catalogTsv(set);
  return files;
}

/** A catalog cell: text as written (tabs and line breaks read as spaces), lists by spaces, nothing for none. */
function cell(value: unknown): string {
  if (value === undefined || value === null) return '';
  return (Array.isArray(value) ? value.join(' ') : String(value)).replace(/[\t\r\n]+/g, ' ');
}

/**
 * The set's `catalog.tsv`: three `#` comment lines, the columns, then one row per clip in the set's order, each
 * stopping at its last field (`.editorconfig` trims trailing tabs). `fit` is `mean/worst` in mm, from the clip or the
 * set.
 */
export function catalogTsv(set: ClipSet): string {
  const about = [
    `# ${set.set}'s clips, generated by tools/anim/repack.ts from the clip files beside it: never edit it by hand.`,
    '# Each clip is <name>.json, its name slugged (clipSlug). sec: seconds; loop: true for a loop; fit: mean/worst',
    "# mm against its capture; speed: a loop's travel as captured, % of standing hip height a second.",
  ];
  const rows = Object.entries(set.clips).map(([name, clip]) => {
    const fit = clip.fit ?? set.fit?.[name];
    const values = [name, clip.dur, clip.loop, clip.speed, clip.tags, clip.desc, clip.src, clip.orig, clip.take];
    return [...values, fit && `${fit[0]}/${fit[1]}`].map(cell).join('\t').replace(/\t+$/, '');
  });
  return `${[...about, CATALOG_COLUMNS.join('\t'), ...rows].join('\n')}\n`;
}

/**
 * Reads a set's directory files back into the set it was split from (`where` names it in errors): the clips in
 * the order `_set.json`'s `fit` lists them, then any others by file name. Throws, naming the file and the fix, for a
 * missing `_set.json`, a clip that does not parse, or a clip file not named by its clip.
 */
export function joinSet(files: SetFiles, where = 'the set'): ClipSet {
  const head = files[SET_FILE];
  if (head === undefined) {
    throw new Error(`${where} has no ${SET_FILE}: write the set's header there ("set", "sources", "fit"…)`);
  }
  let header: Omit<ClipSet, 'clips'>;
  try {
    header = JSON.parse(head) as Omit<ClipSet, 'clips'>;
  } catch (error) {
    throw new Error(`${where}/${SET_FILE} is not JSON: ${(error as Error).message}: fix it, or repack the set`);
  }
  const clips = new Map<string, Clip>();
  const names = Object.keys(files).filter((file) => file.endsWith('.json') && file !== SET_FILE);
  for (const file of names.sort()) {
    const clip = parseClip(files[file] ?? '', `${where}/${file}`);
    if (clip.clip === undefined) throw new Error(`${where}/${file} has no "clip": add "clip": "<its name>" first`);
    const named = `${clipSlug(clip.clip)}.json`;
    if (named !== file) {
      const fix = `name the file ${named}, or the clip "${file.slice(0, -'.json'.length)}"`;
      throw new Error(`${where}/${file} holds "${clip.clip}": ${fix}`);
    }
    clips.set(clip.clip, clip);
  }
  const fit = header.fit ?? {};
  const order = [
    ...Object.keys(fit).filter((name) => clips.has(name)),
    ...[...clips.keys()].filter((name) => !Object.hasOwn(fit, name)),
  ];
  return parseClipSet({ ...header, clips: Object.fromEntries(order.map((name) => [name, clips.get(name)])) });
}

/** A plain JSON set, as shardfall writes it (text, or an object), read through the codec's parser. */
export function readPlainSet(input: string | object): ClipSet {
  return parseClipSet(input);
}

/** The set with `alt` added last to the tags of each clip made from another set's clip (one with an `orig`). */
export function tagAlternates(set: ClipSet): ClipSet {
  const tag = (clip: Clip): Clip =>
    clip.orig === undefined || clip.tags?.includes(ALT_TAG) ? clip : { ...clip, tags: [...(clip.tags ?? []), ALT_TAG] };
  return { ...set, clips: Object.fromEntries(Object.entries(set.clips).map(([name, clip]) => [name, tag(clip)])) };
}

/** Reads a set's directory: every file in it, by name. */
export function readSetDir(dir: string): SetFiles {
  const files = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile());
  return Object.fromEntries(files.map((entry) => [entry.name, readFileSync(join(dir, entry.name), 'utf8')]));
}

/** The set stored in `data/anim/sets/<dir>/` (or under `root`), rejoined. */
export function readSet(dir: string, root: string = SETS_DIR): ClipSet {
  return joinSet(readSetDir(join(root, dir)), relative(ROOT, join(root, dir)));
}

/** Writes a set's files into `dir`, made if missing, and removes the files it no longer has; lists what changed. */
export function writeSetDir(dir: string, files: SetFiles): { written: string[]; removed: string[] } {
  mkdirSync(dir, { recursive: true });
  const before = readSetDir(dir);
  const removed = Object.keys(before).filter((file) => !Object.hasOwn(files, file));
  for (const file of removed) rmSync(join(dir, file));
  const written = Object.keys(files).filter((file) => before[file] !== files[file]);
  for (const file of written) writeFileSync(join(dir, file), files[file] ?? '');
  return { written: written.sort(), removed: removed.sort() };
}

/** The curated sets that tools/anim/shardfall.ts writes from shardfall's files instead (WP 8.10). */
const SHARDFALL_WRITES = new Set(['quaternius']);

/** The CMU catalog, whose `$sources.CMU.license` states CMU's terms (data/anim/SOURCES.md). */
const CMU_CATALOG = join(ROOT, 'data', 'anim', 'catalogs', 'cmu.json');

/**
 * The CMU set with CMU's terms in each of its source records, as the CMU catalog states them: my-3d2dge's set said
 * "free for all uses"; WP 8.1 corrected the catalog, and the importer (`x anim import --cmu`) writes what it says.
 */
export function withCmuTerms(set: ClipSet, catalog: string = CMU_CATALOG): ClipSet {
  const license = (JSON.parse(readFileSync(catalog, 'utf8')) as { $sources?: { CMU?: { license?: string } } }).$sources
    ?.CMU?.license;
  if (!license) throw new Error(`${catalog} has no "$sources".CMU.license: restore CMU's terms there`);
  const sources = Object.entries(set.sources ?? {}).map(([id, source]) => [id, { ...source, license }]);
  return { ...set, sources: Object.fromEntries(sources) };
}

/** The files of my-3d2dge's three curated sets (HERO dropped), from the checkout at `sourcePath`, by directory. */
export function legacySetFiles(sourcePath: string): Record<string, SetFiles> {
  const sets = CURATED_SETS.map((name) => tagAlternates(readPlainSet(readLegacySet(sourcePath, name)))).map((set) =>
    set.set === 'CMU' ? withCmuTerms(set) : set,
  );
  return Object.fromEntries(sets.map((set) => [setDirName(set.set), splitSet(set)]));
}

/**
 * Repacks sets into `root` (see the file comment): plain JSON sets from `paths`, else the curated sets the my-3d2dge
 * checkout still provides (mesh2motion and cmu; WP 8.10 replaced quaternius); with `check` it only compares. Returns a line per set and how many files differ.
 */
export function repackSets(
  paths: string[],
  check: boolean,
  root: string = SETS_DIR,
): { lines: string[]; differ: number } {
  let sets: Record<string, SetFiles>;
  if (paths.length) {
    const read = paths.map((path) => readPlainSet(readFileSync(path, 'utf8')));
    sets = Object.fromEntries(read.map((set) => [setDirName(set.set), splitSet(set)]));
  } else {
    const spec = sourceSpecs().find((candidate) => candidate.name === 'my-3d2dge');
    const source = spec && resolveSource(spec);
    if (!source?.ok || !source.path) throw new Error(source?.problem ?? 'no my-3d2dge source in scripts/setup.sh');
    // quaternius is v2's now, which tools/anim/shardfall.ts writes (WP 8.10): only the others come from my-3d2dge
    sets = Object.fromEntries(
      Object.entries(legacySetFiles(source.path)).filter(([dir]) => !SHARDFALL_WRITES.has(dir)),
    );
  }
  const lines: string[] = [];
  let differ = 0;
  for (const [dir, files] of Object.entries(sets)) {
    const path = join(root, dir);
    if (check) {
      const on = existsSync(path) ? readSetDir(path) : {};
      const changed = [...new Set([...Object.keys(on), ...Object.keys(files)])].filter((f) => on[f] !== files[f]);
      differ += changed.length;
      const count = `${changed.length} file${changed.length === 1 ? ' differs' : 's differ'}`;
      lines.push(`${dir}: ${changed.length ? `${count}: ${changed.slice(0, 5).join(', ')}` : 'ok'}`);
    } else {
      const { written, removed } = writeSetDir(path, files);
      lines.push(`${dir}: ${Object.keys(files).length} files, ${written.length} written, ${removed.length} removed`);
    }
  }
  return { lines, differ };
}

/** The command line (see the file comment). Returns the exit code. */
export function main(args: string[], root: string = SETS_DIR): number {
  try {
    const { lines, differ } = repackSets(
      args.filter((arg) => arg !== '--check'),
      args.includes('--check'),
      root,
    );
    for (const line of lines) console.log(line);
    return differ ? 1 : 0;
  } catch (error) {
    console.error(`repack: FAIL: ${(error as Error).message}`);
    return 1;
  }
}

if (import.meta.main) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`repack: FAIL: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
