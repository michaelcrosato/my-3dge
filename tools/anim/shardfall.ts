/**
 * @file Adopts the sets and catalogs shardfall converted (PLAN.md §5.8 and §10.5 step 5, WP 8.10): 100STYLE's 878
 * loops as seven sets, `style100` (forward walks) and `style100_back`, `_backrun`, `_idle`, `_run`, `_side` and
 * `_siderun`, and version 2 of Quaternius' Universal Animation Library (102 clips) in place of v1's `quaternius`, with
 * their eight catalogs. They are plain JSON in shardfall at `$SHARDFALL_SRC` (`node x src`), format 1 plus a clip
 * `speed`, written by its importer from the original captures; each set goes through the repacker
 * (tools/anim/repack.ts) into `data/anim/sets/<set>/`, and each catalog into `data/anim/catalogs/`.
 *
 * What changes on the way, and nothing else:
 * - every clip is marked `via: "shardfall"` (format 2), written last in its header, before its keys;
 * - each set gains a `body` after its `sources`: `null` for 100STYLE's, and v1's for `quaternius` (the mannequin's
 *   height, segments and bands, which WP 8.4 builds the mannequin from and shardfall's files leave out);
 * - `quaternius` keeps `Punch_Enter`, which v2 dropped, from v1 (`V1_KEPT`): marked `via: "v1"`, with its `fit` entry,
 *   after the clip it followed in v1. Its `src` is still `UAL1`, so it decodes on v2's UAL1 rest body, which keeps it
 *   within its fit of its v1 decode (tests/unit/data/anim/shardfall.test.ts);
 * - the catalogs are shardfall's, formatted by Prettier.
 *
 * v1's body and `Punch_Enter` are read from my-3d2dge's own set at `$MY3D2DGE_SRC`, so the output depends on the two
 * pinned checkouts only. The 100STYLE sets keep shardfall's `credit` and `sources` verbatim: CC BY 4.0 requires the
 * credit, and `data/anim/SOURCES.md` says where it must be shown.
 *
 * Invariants: the output is a function of the two checkouts; `--check` writes nothing. This file, not the
 * repacker's own run (`repack.ts` with no set file, which writes my-3d2dge's three curated sets), writes `quaternius`
 * from now on.
 *
 * Usage: `npx tsx tools/anim/shardfall.ts [--check]` writes the eight sets into data/anim/sets/ and the eight catalogs
 * into data/anim/catalogs/, or with `--check` only compares them. Exit 1 on a difference or an error.
 *
 * @example
 * import { REST, standing } from '../../tests/unit/anim/clip-fixtures';
 * const walk = { clip: 'Walk', src: 'A', dur: 1, loop: true, keys: [standing(0), standing(1)] };
 * const set = adoptSet({ set: 'DEMO', sources: { A: { rest: REST } }, clips: { Walk: walk } }); // as shardfall writes
 * [set.clips.Walk?.via, set.body]; // ['shardfall', null]
 * Object.keys(SHARDFALL_SETS).length; // 8: style100, its six other gaits, and quaternius (v1's body and Punch_Enter)
 * @see tests/unit/data/anim/shardfall.test.ts
 * @see tests/unit/data/anim/sets/sets.test.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import type { Clip } from '../../engine/anim/clip/readable';
import type { ClipSet } from '../../engine/anim/clip/validate';
import { resolveSource, sourceSpecs } from '../lib/source';
import { ROOT } from '../x';
import { readLegacySet } from './legacy-readable';
import { readPlainSet, readSetDir, SETS_DIR, splitSet, writeSetDir, type SetFiles } from './repack';

/** The sets that come from shardfall, by directory: each one's file in shardfall at `fa2dab6`. */
export const SHARDFALL_SETS: Readonly<Record<string, string>> = {
  style100: 'anim/style100.json',
  ...Object.fromEntries(
    ['back', 'backrun', 'idle', 'run', 'side', 'siderun'].map((gait) => [
      `style100_${gait}`,
      `anim/100style/style100_${gait}.json`,
    ]),
  ),
  quaternius: 'anim/quaternius.json',
};

/** The catalogs that come from shardfall (its `anim/catalogs/`), by file name: 100STYLE's seven and Quaternius v2's. */
export const SHARDFALL_CATALOGS: readonly string[] = [
  ...['', '_back', '_backrun', '_idle', '_run', '_side', '_siderun'].map((gait) => `100style${gait}.json`),
  'quaternius.json',
];

/** The catalogs' directory, `data/anim/catalogs/`. */
export const CATALOGS_DIR = join(ROOT, 'data', 'anim', 'catalogs');

/** The clips a set keeps from my-3d2dge's v1 of it, by directory: those shardfall's version dropped. */
export const V1_KEPT: Readonly<Record<string, readonly string[]>> = { quaternius: ['Punch_Enter'] };

/** The set of my-3d2dge whose `body` and `V1_KEPT` clips a shardfall set takes, by directory. */
export const V1_SETS: Readonly<Record<string, string>> = { quaternius: 'quaternius' };

/** The clip, marked as having come `via` that route (`shardfall`, `v1`): `via` last in its header, before its keys. */
export function markVia(clip: Clip, via: NonNullable<Clip['via']>): Clip {
  const { keys, ...head } = clip;
  return { ...head, via, keys };
}

/**
 * A set of shardfall's as this library keeps it (the file comment): each clip marked `via: "shardfall"`, a `body`
 * after its `sources` (v1's, or `null` without `v1`), and the clips named in `keep` taken from `v1`, marked
 * `via: "v1"`, each after the clip it followed in v1, with its `fit` entry. Throws, naming the fix, for a kept clip
 * that v1 lacks or that shardfall's set still has.
 */
export function adoptSet(set: ClipSet, v1?: ClipSet, keep: readonly string[] = []): ClipSet {
  const { fit, clips, ...header } = set;
  const order = Object.keys(clips);
  const taken: Record<string, Clip> = {};
  for (const name of keep) {
    const clip = v1?.clips[name];
    if (!clip) throw new Error(`${set.set}: v1 has no clip "${name}" to keep: drop it from V1_KEPT`);
    if (Object.hasOwn(clips, name)) {
      throw new Error(`${set.set}: shardfall's set has "${name}" itself: drop it from V1_KEPT`);
    }
    const before = Object.keys(v1.clips);
    const after = before
      .slice(0, before.indexOf(name))
      .reverse()
      .find((other) => order.includes(other));
    order.splice(after === undefined ? 0 : order.indexOf(after) + 1, 0, name);
    const { clip: _named, ...unnamed } = clip;
    taken[name] = markVia({ clip: name, ...unnamed }, 'v1');
  }
  const adopted = Object.fromEntries(
    order.map((name) => [name, taken[name] ?? markVia(clips[name] as Clip, 'shardfall')]),
  );
  const fitOf = (name: string) => (Object.hasOwn(taken, name) ? v1?.fit?.[name] : fit?.[name]);
  const entries = order.filter((name) => fitOf(name) !== undefined).map((name) => [name, fitOf(name)]);
  const others = Object.entries(fit ?? {}).filter(([name]) => !Object.hasOwn(clips, name));
  const body = v1 ? (JSON.parse(JSON.stringify(v1.body ?? null)) as object | null) : null;
  const marked = { ...header, body, ...(fit && { fit: Object.fromEntries([...entries, ...others]) }) };
  return { ...marked, clips: adopted } as ClipSet;
}

/** The set of shardfall's in `dir` (a key of `SHARDFALL_SETS`), read from the checkout at `shardfallPath`, as is. */
export function readShardfallSet(shardfallPath: string, dir: string): ClipSet {
  const path = SHARDFALL_SETS[dir];
  if (path === undefined) throw new Error(`no shardfall set "${dir}": use one of ${Object.keys(SHARDFALL_SETS)}`);
  return readPlainSet(readFileSync(join(shardfallPath, path), 'utf8'));
}

/** my-3d2dge's set `name` from the checkout at `my3d2dgePath`, read through the codec's parser. */
export const readV1Set = (my3d2dgePath: string, name: string) =>
  readPlainSet(JSON.parse(JSON.stringify(readLegacySet(my3d2dgePath, name))) as object);

/**
 * The set in `dir` as this library keeps it, from the shardfall checkout and, for a set in `V1_SETS`, the my-3d2dge
 * checkout (throws without it, naming the fix).
 */
export function shardfallSet(dir: string, shardfallPath: string, my3d2dgePath?: string): ClipSet {
  const set = readShardfallSet(shardfallPath, dir);
  const v1Name = V1_SETS[dir];
  if (v1Name === undefined) return adoptSet(set);
  if (my3d2dgePath === undefined) {
    throw new Error(`${dir} takes its body and ${V1_KEPT[dir]?.join(', ')} from my-3d2dge: resolve it (node x src)`);
  }
  return adoptSet(set, readV1Set(my3d2dgePath, v1Name), V1_KEPT[dir]);
}

/** The files of every set in `SHARDFALL_SETS`, by directory, as the repacker writes them. */
export function shardfallSetFiles(shardfallPath: string, my3d2dgePath: string): Record<string, SetFiles> {
  const dirs = Object.keys(SHARDFALL_SETS);
  return Object.fromEntries(dirs.map((dir) => [dir, splitSet(shardfallSet(dir, shardfallPath, my3d2dgePath))]));
}

/** The catalogs in `SHARDFALL_CATALOGS`, by file name: shardfall's, formatted by Prettier as the repository is. */
export async function shardfallCatalogFiles(shardfallPath: string): Promise<Record<string, string>> {
  const config = (await resolveConfig(join(CATALOGS_DIR, 'quaternius.json'))) ?? {};
  const files: Record<string, string> = {};
  for (const name of SHARDFALL_CATALOGS) {
    const text = readFileSync(join(shardfallPath, 'anim', 'catalogs', name), 'utf8');
    files[name] = await format(text, { ...config, filepath: join(CATALOGS_DIR, name) });
  }
  return files;
}

/** Both checkouts' paths, or the problem that stops them resolving. */
function checkouts(): { shardfall: string; my3d2dge: string } | { problem: string } {
  const paths: Record<string, string> = {};
  for (const name of ['shardfall', 'my-3d2dge']) {
    const spec = sourceSpecs().find((candidate) => candidate.name === name);
    const source = spec && resolveSource(spec);
    if (!source?.ok || !source.path) return { problem: source?.problem ?? `no ${name} source in scripts/setup.sh` };
    paths[name] = source.path;
  }
  return { shardfall: paths.shardfall ?? '', my3d2dge: paths['my-3d2dge'] ?? '' };
}

/** The files that differ between `want` and the directory's `have`, either way. */
const changed = (have: SetFiles, want: SetFiles) =>
  [...new Set([...Object.keys(have), ...Object.keys(want)])].filter((file) => have[file] !== want[file]);

/** The line printed for `dir` under `--check`: ok, or how many files differ and the first five. */
function checkLine(dir: string, differ: string[]): string {
  const count = `${differ.length} file${differ.length === 1 ? ' differs' : 's differ'}`;
  return `${dir}: ${differ.length ? `${count}: ${differ.slice(0, 5).join(', ')}` : 'ok'}`;
}

/** The command line (see the file comment), writing under `sets` and `catalogs`. Returns the exit code. */
export async function main(args: string[], sets: string = SETS_DIR, catalogs: string = CATALOGS_DIR): Promise<number> {
  const check = args.includes('--check');
  const unknown = args.filter((arg) => arg !== '--check');
  if (unknown.length) {
    console.error(`shardfall: FAIL: unknown argument ${unknown.join(' ')}: the only option is --check`);
    return 1;
  }
  const paths = checkouts();
  if ('problem' in paths) {
    console.error(`shardfall: FAIL: ${paths.problem}`);
    return 1;
  }
  let differ = 0;
  for (const [dir, files] of Object.entries(shardfallSetFiles(paths.shardfall, paths.my3d2dge))) {
    const path = join(sets, dir);
    if (check) {
      const found = changed(existsSync(path) ? readSetDir(path) : {}, files);
      differ += found.length;
      console.log(checkLine(dir, found));
    } else {
      const { written, removed } = writeSetDir(path, files);
      console.log(`${dir}: ${Object.keys(files).length} files, ${written.length} written, ${removed.length} removed`);
    }
  }
  const catalogFiles = await shardfallCatalogFiles(paths.shardfall);
  const have = Object.fromEntries(
    Object.keys(catalogFiles)
      .filter((name) => existsSync(join(catalogs, name)))
      .map((name) => [name, readFileSync(join(catalogs, name), 'utf8')]),
  );
  const found = changed(have, catalogFiles);
  if (check) {
    differ += found.length;
    console.log(checkLine('catalogs', found));
  } else {
    for (const name of found) writeFileSync(join(catalogs, name), catalogFiles[name] ?? '');
    console.log(`catalogs: ${Object.keys(catalogFiles).length} files, ${found.length} written`);
  }
  return differ ? 1 : 0;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
    (error: unknown) => {
      console.error(`shardfall: FAIL: ${(error as Error).message}`);
      process.exitCode = 1;
    },
  );
}
