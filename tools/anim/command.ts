/**
 * @file The shared parts of `node x anim`'s subcommands (tools/cmd/anim.ts, PLAN.md §10, WP 8.5): its flags read
 * (`text`, `list`, `number`), the directory of sets `--sets` names and a set in it, a set's files written or checked
 * (`writeOrCheck`, `--check`: list the files that differ), and `import` (`runImport`: .glb files or the CMU takes into
 * a set, its committed clips re-imported from their source kept). Split from tools/cmd/anim.ts at its line cap.
 *
 * Invariants: a missing directory or set names the flag that would find it; a number flag takes digits only.
 *
 * @example
 * number({ tol: '12' }, 'tol', 30); // 12
 * list({ clips: 'Walk, Run' }, 'clips'); // ['Walk', 'Run']
 * @see tools/cmd/anim.test.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { UsageError, type CommandResult } from '../x';
import { listGlb } from './glb-library';
import { importSet, type Catalog } from './import';
import { keepUpgrades, readSet, readSetDir, SET_FILE, setDirName, splitSet, SETS_DIR, writeSetDir, type SetFiles } from './repack'; // prettier-ignore
import { shownDir } from './view';

/** A command's flag values. */
export type Values = Record<string, unknown>;

/** A flag's text, if given. */
export const text = (values: Values, flag: string) =>
  typeof values[flag] === 'string' ? (values[flag] as string) : undefined;
/** A flag's comma-separated list, if given. */
export const list = (values: Values, flag: string) =>
  text(values, flag)
    ?.split(',')
    .map((s) => s.trim());
/** A flag's number, `fallback` when not given; a usage error when not a number. */
export const number = (values: Values, flag: string, fallback: number) => {
  const raw = text(values, flag);
  if (raw === undefined) return fallback;
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new UsageError(`--${flag} takes a number, not "${raw}"`);
  return +raw;
};

/** The directory of sets `--sets` names, from `root` (`data/anim/sets` by default); a missing one names the flag. */
export function setsOf(values: Values, root: string): string {
  const given = text(values, 'sets');
  const dir = resolve(root, given ?? 'data/anim/sets');
  if (!existsSync(dir))
    throw new Error(`no directory ${given ?? 'data/anim/sets'}: --sets takes a directory of set directories`);
  return dir;
}

/** The set in directory `dir` of `sets` (or at `dir`, when absolute); a missing one names `--sets`. */
export function setIn(dir: string, sets: string) {
  if (!existsSync(join(resolve(sets, dir), SET_FILE)))
    throw new Error(
      `no set ${dir} in ${shownDir(sets)}: name one of its set directories, or another with --sets <dir>`,
    );
  return readSet(dir, sets);
}

/** Writes `files` into `dir`, or with `check` lists the files that differ; a result either way. */
export function writeOrCheck(dir: string, files: SetFiles, check: boolean, root: string): CommandResult {
  const where = relative(root, dir);
  if (!check) {
    const { written, removed } = writeSetDir(dir, files);
    const summary = `${where}: ${Object.keys(files).length} files, ${written.length} written, ${removed.length} removed`;
    return { ok: true, summary, lines: [...written, ...removed.map((f) => `removed ${f}`)] };
  }
  const on = existsSync(dir) ? readSetDir(dir) : {};
  const differ = [...new Set([...Object.keys(on), ...Object.keys(files)])].filter((f) => on[f] !== files[f]).sort();
  const failures = differ.map((f) => ({
    id: 'ANIM_SET_DIFFERS',
    message: `${where}/${f} differs from what the tool writes: run it without --check, or find why`,
    file: `${where}/${f}`,
  }));
  return {
    ok: !differ.length,
    summary: differ.length
      ? `${differ.length} of ${Object.keys(files).length} files differ`
      : `${where}: all ${Object.keys(files).length} files as the tool writes them`,
    failures,
  };
}

/** `x anim import …` (see the file comment). */
export function runImport(files: string[], values: Values, root: string): CommandResult {
  const cmu = values.cmu === true;
  if (!files.length && !cmu) throw new UsageError('import needs .glb files, or --cmu');
  if (values.list) {
    const lines = files.flatMap((file) => {
      const what = listGlb(readFileSync(resolve(root, file)), file);
      return [
        `${file}: rig ${what.rig ?? 'not recognised'}`,
        `clips: ${what.clips.join(', ')}`,
        `bones: ${what.bones.join(', ')}`,
      ];
    });
    return { ok: true, summary: `${files.length} file(s) listed`, lines };
  }
  const catalogFile = text(values, 'catalog') ?? (cmu ? 'data/anim/catalogs/cmu.json' : undefined);
  const catalog = catalogFile ? (JSON.parse(readFileSync(resolve(root, catalogFile), 'utf8')) as Catalog) : undefined;
  const rm = list(values, 'rm') ?? [];
  const glbs = files.map((file, i) => ({
    file,
    bytes: readFileSync(resolve(root, file)),
    ...(rm[i] ? { rm: readFileSync(resolve(root, rm[i])) } : {}),
  }));
  const blade = text(values, 'blade');
  const { set, notes } = importSet({
    ...{ glbs, cmu, catalog, name: text(values, 'name'), title: text(values, 'title'), credit: text(values, 'credit') },
    ...{ sources: list(values, 'sources'), rest: list(values, 'rest'), clips: list(values, 'clips') },
    ...{ tol: number(values, 'tol', 30), fps: number(values, 'fps', 30), legacy: values.legacy === true },
    ...(blade ? { blade: new RegExp(blade) } : {}),
  });
  const committed = join(SETS_DIR, setDirName(set.set));
  const out = resolve(root, text(values, 'out') ?? committed);
  // into the committed set, its clips re-imported from their source (WP 8.8) stay as committed: never undone
  const result = writeOrCheck(out, splitSet(out === committed ? keepUpgrades(set) : set), values.check === true, root);
  const count = `${Object.keys(set.clips).length} clips, format ${set.format}`;
  return { ...result, summary: `${set.set}: ${count}; ${result.summary}`, lines: [...(result.lines ?? []), ...notes] };
}
