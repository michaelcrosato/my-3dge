/**
 * @file The animation library's tools (PLAN.md §10, WP 8.5): find a clip, show it, bake it, draw it, cut a smaller
 * set, import libraries, fetch their sources and re-import them, all from the command line, with no browser. Usage:
 * node x anim <find|show|cut|import|cmu|bake|sheet|repack|fetch|upgrade> …. Exit 0 when it did what was asked
 * (`--check`: nothing differs), 1 when it failed (a difference, a fetch, a broken file), 2 on a usage error naming the
 * closest choice.
 *
 * - `find <words…> [--cat tag] [--max 20] [--json]`: every set's catalog, then the CMU ledger's takes not yet in a set
 *   (tools/anim/find.ts); the best first, `max` lines in all; `--json` writes every hit to `find.json`.
 * - `show <set>/<clip> [--lens]`: the clip's text (each angle folded to ±180° with `--lens`) and what the validator
 *   warns of. A clip name only one set has needs no set.
 * - `bake <set>/<clip> [--json]`: baked on its rest body: frames, bytes, FK parity with the decode (mean, worst);
 *   `--json` writes it as three.js `AnimationClip` JSON for its rest skeleton (`clip.json`).
 * - `sheet <set>/<clip> [--frames 8] [--views front,side]`: a contact sheet, `sheet.svg` (engine/anim/sheet.ts).
 * - `cut <set…> --clips A,SET:B --name NAME --out <dir> [--title T] [--credit C] [--check]`: a smaller set, one file
 *   a clip (tools/anim/cut.ts).
 * - `--sets <dir>` (find, show, bake, sheet, cut): the directory of set directories they read, from the repository
 *   root: `data/anim/sets` by default, `.cache/anim/cmu-lib` for `cmu library`'s sets, the parent of an `import --out`.
 * - `import <a.glb…> [--rm a_RM.glb,…] [--sources A,…] [--rest clip,…] [--catalog file] [--name SET] [--title T]
 *   [--credit C] [--tol 30] [--fps 30] [--clips A,B] [--blade Sword] [--legacy] [--out dir] [--check] [--list]`, or
 *   `import --cmu [--legacy] [--check]` (the CMU catalog's picks, fetched by ranges): tools/anim/import.ts. Format 2
 *   by default; `--legacy` writes format 1 as my-3d2dge's importer did. It writes `data/anim/sets/<set>/` unless
 *   `--out` says; `--check` compares instead. `--list` prints a `.glb`'s rig, clips and bones.
 * - `cmu <find|subject|get|all|survey|library|ledger|rates> …`: the CMU database (tools/anim/cmu-cli.ts): find words
 *   or a subject's takes on the site's list; get takes or all into `.cache/anim/cmu/`; survey them into the ledger
 *   (`--subjects 5,13`, `--legacy`) or convert them into `.cache/anim/cmu-lib/`; query the ledger (`[category|word…]
 *   [--status none|used|pick|skip] [--top N] [--json]`); verify the rates of takes the list leaves out (`rates [ids…]
 *   [--write]`).
 * - `repack [set.json…] [--check]`: my-3d2dge's curated sets, or plain JSON sets, split into set directories
 *   (tools/anim/repack.ts).
 * - `fetch`: Mesh2Motion's three `.glb` files into `.cache/anim/mesh2motion/`, at a pinned commit, each checked by its
 *   sha256 (tools/anim/fetch.ts). `upgrade <set> [--check]`: the set re-imported from its sources in format 2 and
 *   swapped in clip by clip where it keeps parity, the clips kept listed with their reasons in data/anim/upgrade.json
 *   (tools/anim/upgrade.ts; mesh2motion and cmu: quaternius waits for the owner's files, 100STYLE for a defect).
 *
 * @example
 * subcommandOf(['find', 'punch']); // 'find'
 * targetOf(['show', 'cmu/Walk_Loop']); // 'show-cmu-Walk_Loop'
 * @see tools/cmd/anim.test.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { normalizedLens, clipText } from '../../engine/anim/clip/lens';
import { restSkeleton } from '../../engine/anim/clip/rest';
import { clipJSON } from '../../engine/anim/clip/retarget';
import { validateClip } from '../../engine/anim/clip/validate';
import { SHEET_VIEWS, type SheetView } from '../../engine/anim/sheet';
import { CMU_SUBCOMMANDS, cmuTargets, runCmu } from '../anim/cmu-cli';
import { cutSet } from '../anim/cut';
import { findClips } from '../anim/find';
import { listGlb } from '../anim/glb-library';
import { fetchMesh2Motion, MESH2MOTION, SET_SOURCES } from '../anim/fetch';
import { importSet, type Catalog } from '../anim/import';
import {
  readSet,
  readSetDir,
  repackSets,
  SET_FILE,
  setDirName,
  splitSet,
  SETS_DIR,
  writeSetDir,
  type SetFiles,
} from '../anim/repack';
import { readUpgraded, reimport, upgradedOf, upgradeSet, writeUpgraded } from '../anim/upgrade';
import { bakeReport, clipSheet, resolveClip, shownDir } from '../anim/view';
import { targetSlug } from '../lib/report';
import { closest, UsageError, type Command, type CommandResult } from '../x';

const SUBCOMMANDS = ['find', 'show', 'cut', 'import', 'cmu', 'bake', 'sheet', 'repack', 'fetch', 'upgrade'] as const;
type Sub = (typeof SUBCOMMANDS)[number];
/** The flags each subcommand takes; any other is a usage error. */
const FLAGS: Record<Sub, string[]> = {
  find: ['cat', 'max', 'json', 'sets'],
  show: ['lens', 'sets'],
  cut: ['clips', 'name', 'title', 'credit', 'out', 'check', 'sets'],
  import: [
    ...['cmu', 'legacy', 'list', 'check', 'out', 'catalog', 'sources', 'rest', 'rm', 'name', 'title', 'credit'],
    ...['tol', 'fps', 'clips', 'blade'],
  ],
  cmu: ['subjects', 'legacy', 'tol', 'status', 'top', 'json', 'write'],
  bake: ['json', 'sets'],
  sheet: ['frames', 'views', 'sets'],
  repack: ['check'],
  fetch: [],
  upgrade: ['check'],
};
type Values = Record<string, unknown>;

/** The subcommand named first, or a usage error naming the closest. */
export function subcommandOf(positionals: string[]): Sub {
  const [sub = ''] = positionals;
  if ((SUBCOMMANDS as readonly string[]).includes(sub)) return sub as Sub;
  const near = closest(sub, SUBCOMMANDS);
  throw new UsageError(`anim takes one of ${SUBCOMMANDS.join(', ')}${near ? `: did you mean ${near}?` : ''}`);
}

/** The report's target: the subcommand and its first arguments. */
export const targetOf = (positionals: string[]) => targetSlug(positionals.slice(0, 3).join('-').replace(/\//g, '-'));

const text = (values: Values, flag: string) =>
  typeof values[flag] === 'string' ? (values[flag] as string) : undefined;
const list = (values: Values, flag: string) =>
  text(values, flag)
    ?.split(',')
    .map((s) => s.trim());
const number = (values: Values, flag: string, fallback: number) => {
  const raw = text(values, flag);
  if (raw === undefined) return fallback;
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new UsageError(`--${flag} takes a number, not "${raw}"`);
  return +raw;
};

/** The directory of sets `--sets` names, from `root` (`data/anim/sets` by default); a missing one names the flag. */
function setsOf(values: Values, root: string): string {
  const given = text(values, 'sets');
  const dir = resolve(root, given ?? 'data/anim/sets');
  if (!existsSync(dir))
    throw new Error(`no directory ${given ?? 'data/anim/sets'}: --sets takes a directory of set directories`);
  return dir;
}

/** The set in directory `dir` of `sets` (or at `dir`, when absolute); a missing one names `--sets`. */
function setIn(dir: string, sets: string) {
  if (!existsSync(join(resolve(sets, dir), SET_FILE)))
    throw new Error(
      `no set ${dir} in ${shownDir(sets)}: name one of its set directories, or another with --sets <dir>`,
    );
  return readSet(dir, sets);
}

/** Writes `files` into `dir`, or with `check` lists the files that differ; a result either way. */
function writeOrCheck(dir: string, files: SetFiles, check: boolean, root: string): CommandResult {
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
function runImport(files: string[], values: Values, root: string): CommandResult {
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
  const out = resolve(root, text(values, 'out') ?? join(SETS_DIR, setDirName(set.set)));
  const result = writeOrCheck(out, splitSet(set), values.check === true, root);
  const count = `${Object.keys(set.clips).length} clips, format ${set.format}`;
  return { ...result, summary: `${set.set}: ${count}; ${result.summary}`, lines: [...(result.lines ?? []), ...notes] };
}

/** Writes `body` under `out/anim/<target>/<file>`; the artifact. */
function artifact(root: string, target: string, file: string, body: string, describes: string) {
  const path = `out/anim/${targetSlug(target)}/${file}`;
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), body);
  return { path, kind: file.endsWith('.svg') ? 'image' : 'json', describes };
}

/** Runs one subcommand. */
function run(sub: Sub, positionals: string[], values: Values, root: string): CommandResult {
  const target = targetOf(positionals);
  const args = positionals.slice(1);
  const one = () => {
    if (args.length !== 1) throw new UsageError(`${sub} takes one clip, as <set>/<clip>`);
    return resolveClip(args[0], setsOf(values, root));
  };
  switch (sub) {
    case 'find': {
      if (!args.length && !values.cat) throw new UsageError('find needs words, or --cat');
      const found = findClips(args, {
        cat: text(values, 'cat'),
        max: number(values, 'max', 20),
        setsDir: setsOf(values, root),
      });
      const artifacts = values.json
        ? [
            artifact(
              root,
              target,
              'find.json',
              `${JSON.stringify({ clips: found.clips, takes: found.takes }, null, 2)}\n`,
              'every clip and take found',
            ),
          ]
        : [];
      return { ok: true, summary: found.summary, lines: found.lines, target, artifacts };
    }
    case 'show': {
      const ref = one();
      const lines = clipText(values.lens ? normalizedLens(ref.clip) : ref.clip).split('\n');
      const warnings = validateClip(ref.clip, `${ref.set}/${ref.name}`).map((w) => ({
        id: w.code,
        message: w.message,
      }));
      const summary = `${ref.set}/${ref.name}: ${ref.clip.dur} s, ${ref.clip.loop ? 'a loop' : 'once'}, ${ref.clip.keys.length} keys`;
      return { ok: true, summary, lines, target, warnings };
    }
    case 'bake': {
      const ref = one();
      const { baked, bytes, parity } = bakeReport(ref);
      const at = `worst ${parity.worst.toFixed(1)} mm at ${parity.at.toFixed(3)} s`;
      const summary = `${ref.set}/${ref.name}: ${baked.frames} frames, ${(bytes / 1024).toFixed(1)} KB of tracks; FK parity mean ${parity.mean.toFixed(2)} mm, ${at}`;
      const json = values.json ? JSON.stringify(clipJSON(baked, restSkeleton(ref.rest))) : '';
      const artifacts = json
        ? [
            artifact(
              root,
              target,
              'clip.json',
              `${json}\n`,
              'the clip as three.js AnimationClip JSON for its rest skeleton',
            ),
          ]
        : [];
      return {
        ok: true,
        summary,
        target,
        artifacts,
        metrics: { frames: baked.frames, bytes, meanMm: parity.mean, worstMm: parity.worst },
      };
    }
    case 'sheet': {
      const ref = one();
      const views = (list(values, 'views') ?? ['front', 'side']) as SheetView[];
      for (const v of views)
        if (!(v in SHEET_VIEWS)) throw new UsageError(`--views takes ${Object.keys(SHEET_VIEWS).join(', ')}, not ${v}`);
      const sheet = clipSheet(ref, { frames: number(values, 'frames', 8), views });
      const svg = artifact(
        root,
        target,
        'sheet.svg',
        sheet.svg,
        `${ref.set}/${ref.name}: ${sheet.frames} frames, ${views.join(' and ')}`,
      );
      return {
        ok: true,
        summary: `${ref.set}/${ref.name}: ${sheet.frames} frames, ${sheet.width} × ${sheet.height} px, hash ${sheet.hash}`,
        target,
        artifacts: [svg],
      };
    }
    case 'cut': {
      const [clips, name, out] = [list(values, 'clips'), text(values, 'name'), text(values, 'out')];
      if (!args.length || !clips || !name || !out)
        throw new UsageError('cut needs sets, --clips A,SET:B, --name NAME and --out <dir>');
      const sets = setsOf(values, root);
      const set = cutSet(
        args.map((dir) => setIn(dir, sets)),
        clips,
        { name, title: text(values, 'title'), credit: text(values, 'credit') },
      );
      return { ...writeOrCheck(resolve(root, out), splitSet(set), values.check === true, root), target };
    }
    case 'import':
      return { ...runImport(args, values, root), target: values.cmu ? 'import-cmu' : target };
    case 'repack': {
      const { lines, differ } = repackSets(
        args.map((file) => resolve(root, file)),
        values.check === true,
      );
      const summary = values.check
        ? differ
          ? `${differ} file(s) differ`
          : 'every set as the repacker writes it'
        : 'repacked';
      return { ok: !differ, summary, lines, target };
    }
    case 'fetch': {
      const lines = fetchMesh2Motion(root);
      return {
        ok: true,
        summary: `mesh2motion: ${lines.length} files at ${MESH2MOTION.commit.slice(0, 7)}`,
        lines,
        target,
      };
    }
    case 'upgrade': {
      if (args.length !== 1) throw new UsageError(`upgrade takes one set: ${Object.keys(SET_SOURCES).join(', ')}`);
      const { set, verdicts } = upgradeSet(readSet(args[0]), reimport(args[0], root));
      const line = upgradedOf(verdicts);
      const check = values.check === true;
      const result = writeOrCheck(join(SETS_DIR, setDirName(set.set)), splitSet(set), check, root);
      const listed = JSON.stringify(readUpgraded(root)[args[0]]) === JSON.stringify(line);
      if (!check) writeUpgraded(root, args[0], line);
      const kept = Object.entries(line.kept).map(([clip, why]) => `kept ${clip}: ${why}`);
      return {
        ...result,
        ok: result.ok && (listed || !check),
        summary: `${args[0]}: ${line.swapped} of ${line.of} clips swapped in from the source; ${result.summary}`,
        lines: [...kept, ...(result.lines ?? [])],
        target,
      };
    }
    case 'cmu': {
      const cmuTarget = cmuTargets(args);
      const result = runCmu({ args, values, root, jsonPath: `out/anim/${targetSlug(cmuTarget)}/cmu.json` });
      if (result.usage)
        throw new UsageError(
          `${result.usage}${args[0] && !CMU_SUBCOMMANDS.includes(args[0]) ? `: did you mean ${closest(args[0], CMU_SUBCOMMANDS) ?? 'ledger'}?` : ''}`,
        );
      return { ...result, target: cmuTarget };
    }
  }
}

const command: Command = {
  usage: 'anim <find|show|cut|import|cmu|bake|sheet|repack|fetch|upgrade> [args]',
  options: {
    ...Object.fromEntries(
      ['cat', 'max', 'clips', 'name', 'title', 'credit', 'out', 'catalog', 'sources', 'rest', 'rm', 'sets'].map((f) => [
        f,
        { type: 'string' as const },
      ]),
    ),
    ...Object.fromEntries(
      ['tol', 'fps', 'blade', 'subjects', 'status', 'top', 'frames', 'views'].map((f) => [
        f,
        { type: 'string' as const },
      ]),
    ),
    ...Object.fromEntries(
      ['json', 'lens', 'check', 'cmu', 'legacy', 'list', 'write'].map((f) => [f, { type: 'boolean' as const }]),
    ),
  },
  maxPositionals: 64,
  async run({ values, positionals, root }): Promise<CommandResult> {
    const sub = subcommandOf(positionals);
    const given = Object.keys(values).filter((flag) => values[flag] !== undefined);
    const stray = given.filter((flag) => !FLAGS[sub].includes(flag));
    if (stray.length) {
      const near = closest(stray[0], FLAGS[sub]);
      throw new UsageError(
        `anim ${sub} takes no --${stray[0]}${near ? `: did you mean --${near}?` : ''} (it takes ${FLAGS[sub].map((f) => `--${f}`).join(', ') || 'no flags'})`,
      );
    }
    try {
      return run(sub, positionals, values, root);
    } catch (error) {
      if (error instanceof UsageError) throw error;
      const message = (error as Error).message;
      return {
        ok: false,
        summary: message.split('\n')[0],
        target: targetOf(positionals),
        failures: [{ id: 'ANIM_FAILED', message }],
      };
    }
  },
};

export default command;
