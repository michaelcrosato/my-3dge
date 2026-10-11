/**
 * @file Films a page (PLAN.md WP 3.11, I-28): plays a script of steps over `__engine.input` and `step`, shoots a
 * frame wherever the script says, lays the frames out on a labelled contact sheet, and with `--compare <ref>` films
 * the same steps at that commit and attributes every pixel that differs to an object, through the ID pass.
 *
 * The page opens as `x shot` opens it (Vite, Chromium on WebGPU, the virtual clock, seed 1; `--scene`, `--cam` and
 * `--set` as URL parameters), so nothing moves but the steps: words separated by spaces, `;` or new lines. `step [n]`
 * runs n sim steps (1) with what the virtual device holds (`__engine.input.play`, recorded); `shot` films a frame
 * (`__engine.shot`: pixels, ID pass, thumbnail); `rec <n> [every]` films n frames `every` steps apart (1);
 * `press <action>` taps an action for the next step; `hold <action>` and `release <action>`; `axis <name> <x,y|none>`
 * pushes a virtual axis (`move 0,1` walks forward); `cam <code>` switches the camera, view only (`topdown` is
 * `cam=topdown`); `set <key=value>` as `x set`. A script that never shoots films the whole run: a frame, then each
 * `step` in up to 8 even parts with a frame after each. The default is `step 60`.
 *
 * It writes `out/film/<target>/sheet.png` (`--cols` columns, 8 by default, each frame labelled with its number and
 * tick) and `film.json` (each frame's tick, ID-pass entries and thumbnail, and the comparison). `--compare <ref>` (a
 * commit, branch or tag; empty means `HEAD`) checks the ref out in a temporary `git worktree` under out/film/ with
 * this tree's node_modules linked, films it the same way, and removes it; the sheet then shows this tree (A), the
 * ref (B), and A in grey with each differing pixel in magenta. A differing pixel goes to the smallest box, in either
 * frame, of an object whose ID-pass entry changed (what moved owns what it left and took), else of the object the
 * thumbnail's map names there, else of any object; outside every box it is `(empty space)`. On sources unchanged
 * from the ref any difference fails (`FILM_NOT_REPEATABLE`); otherwise it is the change's effect, a warning naming
 * the objects (`FILM_CHANGED`). A ref without the page or the scene, or whose page lacks a member the steps call,
 * gives "no baseline" (`FILM_NO_BASELINE`), a deferred proof rather than a failure. `--thumb <case>` compares each
 * frame's thumbnail with `tests/baselines/thumbs/<case>.json` (24 of 255 per channel per cell); `--update` records.
 *
 * Usage: node x film <page> [--scene s] [--cam code] [--set k=v…] [--steps "…"] [--cols n] [--compare ref]
 * [--thumb case [--update]]. Fails (exit 1) when the page does not start or a step throws, when the film differs
 * from the ref on unchanged sources or the ref's page fails otherwise, or when a thumbnail moved.
 *
 * @example
 * parseSteps('hold sprint rec 2 3').map((step) => step.verb); // ['hold', 'shot', 'step', 'shot']
 * parseSteps('step 2').length; // 5: shot, 1 step, shot, 1 step, shot
 * // node x film labs/box --scene room --steps "axis move 0,1 step 60" --compare HEAD
 * @see tools/cmd/film.test.ts
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { join } from 'node:path';
import type { Browser } from '@playwright/test';
import type { ShotJson } from '../../engine/gfx/shot';
import { browserRuntime, launchBrowser, preparePage, VIEWPORT } from '../lib/browser';
import {
  checkFilmThumbs,
  compareFrames,
  judgeCompare,
  type FilmFrame,
  type FilmVerdict,
  type FrameDiff,
} from '../lib/filmCompare';
import { contactSheet } from '../lib/filmSheet';
import { waitReady, type Signals } from '../lib/page';
import { targetSlug, type Report } from '../lib/report';
import { startVite } from '../lib/vite';
import { closest, UsageError, type Command, type CommandResult } from '../x';
import { pageErrorFinding, pageFailures } from './inspect';
import { encodePng, pageUrl, READY_TIMEOUT_MS, resolvePage } from './shot';

/** One step of a film: the `__engine` member it calls and the arguments; the verb `shot` films a frame. */
export interface FilmStep {
  verb: string;
  member: string;
  args: unknown[];
}

/** A step calling `member(...args)`. */
const call = (verb: string, member: string, ...args: unknown[]): FilmStep => ({ verb, member, args });
/** The shot a film takes: the pixels, the ID pass and the thumbnail, without the look metrics. */
export const SHOT = call('shot', 'shot', { metrics: false, pixels: true });
/** `n` sim steps with what the virtual device holds. */
export const simSteps = (n: number) => call('step', 'input.play', String(n));

/** The verbs of a script, with what each takes. */
const FORMS: Record<string, string> = {
  ...{ step: '[n]', shot: 'nothing', rec: '<n> [every]', press: '<action>', hold: '<action>', release: '<action>' },
  ...{ axis: '<name> <x,y|none>', cam: '<code>', set: '<key=value>' },
};
const VERBS = Object.keys(FORMS);

/** How many parts, each followed by a frame, a `step` is filmed in when the script never shoots. */
export const PARTS = 8;

/** An axis value: `none` (null), one number, or numbers separated by commas; undefined when it is none of those. */
function axisValue(word: string): number | number[] | null | undefined {
  if (word === 'none') return null;
  const parts = word.split(',');
  if (parts.some((part) => part.trim() === '' || !Number.isFinite(Number(part)))) return undefined;
  return parts.length === 1 ? Number(word) : parts.map(Number);
}

/** Reads a script of steps (see the file comment); throws `UsageError` naming the step it cannot read. */
export function parseSteps(script: string): FilmStep[] {
  const words = script.split(/[\s;]+/).filter(Boolean);
  if (!words.length) throw new UsageError('--steps has no steps: try --steps "step 60" or "rec 8 4"');
  const out: FilmStep[] = [];
  let i = 0;
  const count = () => (/^\d+$/.test(words[i] ?? '') ? Number(words[i++]) : undefined);
  const arg = (verb: string, ok = (word: string) => !VERBS.includes(word)) => {
    const word = words[i];
    if (word === undefined || !ok(word)) throw new UsageError(`${verb} takes ${FORMS[verb]}`);
    i++;
    return word;
  };
  while (i < words.length) {
    const verb = words[i++];
    if (verb === 'step' || verb === 'rec') {
      const n = count() ?? (verb === 'step' ? 1 : 0);
      const every = verb === 'rec' ? (count() ?? 1) : 1;
      if (n < 1 || every < 1) throw new UsageError(`${verb} takes ${FORMS[verb]}, whole numbers ≥ 1`);
      if (verb === 'step') out.push(simSteps(n));
      else for (let k = 0; k < n; k++) out.push(...(k ? [simSteps(every)] : []), SHOT);
    } else if (verb === 'shot') out.push(SHOT);
    else if (verb === 'press') out.push(call(verb, 'input.press', arg(verb)));
    else if (verb === 'hold' || verb === 'release') out.push(call(verb, 'input.hold', arg(verb), verb === 'hold'));
    else if (verb === 'axis') {
      const name = arg(verb, (word) => /^(move|look|aim|cam)$|^[a-z][A-Za-z0-9]*:/.test(word));
      out.push(call(verb, 'input.axis', name, axisValue(arg(verb, (word) => axisValue(word) !== undefined))));
    } else if (verb === 'cam') {
      const code = arg(verb);
      out.push(call(verb, 'camera.set', code.includes('=') ? code : `cam=${code}`));
    } else if (verb === 'set') {
      const [key, ...value] = arg(verb, (word) => word.indexOf('=') > 0).split('=');
      out.push(call(verb, 'set', key, value.join('=')));
    } else {
      const near = closest(verb, VERBS);
      throw new UsageError(
        `there is no step "${verb}": ${near ? `did you mean ${near}?` : `steps are ${VERBS.join(', ')}`}`,
      );
    }
  }
  if (out.some((step) => step.verb === 'shot')) return out;
  const filmed: FilmStep[] = [SHOT];
  for (const step of out) {
    const n = step.verb === 'step' ? Number(step.args[0]) : 0;
    const parts = Math.min(n, PARTS);
    if (!parts) filmed.push(step);
    for (let k = 0; k < parts; k++)
      filmed.push(simSteps(Math.round(((k + 1) * n) / parts) - Math.round((k * n) / parts)), SHOT);
  }
  return filmed;
}

/** Runs git in `root`: its output, trimmed; undefined when it fails and `quiet` is set, else the error is thrown. */
function git(root: string, args: string[], quiet = false): string | undefined {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    if (quiet) return undefined;
    throw error;
  }
}

/** The commit `ref` names, in full; throws `UsageError` when it names none. */
export function resolveRef(root: string, ref: string): string {
  const sha = git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], true);
  if (!sha) throw new UsageError(`--compare ${ref} names no commit: give HEAD, a branch, a tag or a commit`);
  return sha;
}

/** Whether commit `sha` has the file `path`. */
export const hasFile = (root: string, sha: string, path: string) =>
  git(root, ['cat-file', '-t', `${sha}:${path}`], true) === 'blob';

/** Whether the working tree's sources are commit `sha`'s: no tracked change, no untracked file git does not ignore. */
export const sameSources = (root: string, sha: string) =>
  git(root, ['diff', '--quiet', sha, '--'], true) !== undefined &&
  git(root, ['ls-files', '--others', '--exclude-standard']) === '';

/** Checks commit `sha` out in a temporary worktree under out/film/, with this tree's node_modules linked into it. */
export function addWorktree(root: string, sha: string): string {
  const dir = join(root, 'out', 'film', `base-${sha.slice(0, 12)}-${process.pid}`);
  if (fs.existsSync(dir)) removeWorktree(root, dir);
  fs.mkdirSync(join(root, 'out', 'film'), { recursive: true });
  git(root, ['worktree', 'add', '--detach', dir, sha]);
  fs.symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir');
  return dir;
}

/** Removes a worktree `addWorktree` made: the node_modules link first (never what it points at), then the checkout. */
export function removeWorktree(root: string, dir: string): void {
  const link = join(dir, 'node_modules');
  if (fs.lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) fs.unlinkSync(link);
  if (git(root, ['worktree', 'remove', '--force', dir], true) !== undefined) return;
  fs.rmSync(dir, { recursive: true, force: true });
  git(root, ['worktree', 'prune']);
}

/** Runs in the page: calls `__engine.<member>(...args)`; gives its result and the tick after, or the member it lacks. */
async function pageCall([member, args]: [string, unknown[]]): Promise<{ value: unknown; tick: number } | string> {
  const engine = (window as unknown as { __engine: Record<string, unknown> }).__engine;
  const fn = member.split('.').reduce<unknown>((at, key) => (at as Record<string, unknown> | undefined)?.[key], engine);
  if (typeof fn !== 'function') return member;
  const value: unknown = await (fn as (...values: unknown[]) => unknown)(...args);
  return { value, tick: (engine.info as () => { tick: number })().tick };
}

/** What to film: the page argument, its URL path and file, its scene, and the steps. */
interface FilmSpec {
  page: string;
  path: string;
  file: string;
  scene?: string;
  steps: FilmStep[];
}

/** Films the page served from `root` (this tree, or the base's worktree), naming it `label` in findings. */
async function filmTree(browser: Browser, root: string, spec: FilmSpec, label: string) {
  const server = await startVite({ root });
  const tab = await browser.newPage({ viewport: VIEWPORT });
  try {
    const watch = await preparePage(tab, { seed: 1, root });
    await tab.goto(`${server.url}${spec.path}`);
    const signals: Signals | undefined = await waitReady(tab, watch, READY_TIMEOUT_MS);
    const thrown = (await watch.errors()).map(pageErrorFinding(label));
    const failures = pageFailures(label, spec.file, signals, thrown);
    const frames: FilmFrame[] = [];
    let lacks: string | undefined;
    for (const [k, step] of failures.length ? [] : spec.steps.entries()) {
      const done = await tab
        .evaluate(pageCall, [step.member, step.args] as [string, unknown[]])
        .catch((error: Error) => {
          const what = `${step.member}(${step.args.map((v) => JSON.stringify(v)).join(', ')})`;
          const why = error.message.split('\n')[0].replace(/^page\.evaluate: /, '');
          failures.push({ id: 'FILM_STEP_FAILED', message: `${label}: step ${k + 1}, ${what}, threw ${why}` });
        });
      if (typeof done === 'string') lacks = done;
      if (!done || typeof done === 'string') break;
      if (step.verb !== 'shot') continue;
      const { width, height, ids, thumbnail, pixels = '' } = done.value as ShotJson;
      const rgba = new Uint8Array(Buffer.from(pixels, 'base64'));
      frames.push({ n: frames.length, tick: done.tick, width, height, rgba, visible: ids?.visible ?? [], thumbnail });
    }
    failures.push(...(await watch.errors()).slice(thrown.length).map(pageErrorFinding(label)));
    return { frames, failures, signals, lacks };
  } finally {
    await tab.close();
    await server.close();
  }
}

/** Films the base: `ref`'s checkout of the page in a temporary worktree, or why there is no baseline. */
async function filmBase(browser: Browser, root: string, sha: string, ref: string, spec: FilmSpec) {
  const none = (why: string) => ({ none: why, frames: [], failures: [] });
  if (!hasFile(root, sha, spec.file)) return none(`${ref} has no ${spec.file}`);
  const dir = addWorktree(root, sha);
  try {
    const base = await filmTree(browser, dir, spec, `${spec.page} at ${ref}`);
    if (base.signals?.errors.some((e) => e.startsWith('APP_BAD_ROUTE: the URL parameter scene=')))
      return none(`${ref} has no scene "${spec.scene}" in ${spec.page}`);
    if (base.lacks) return none(`${ref}'s ${spec.page} has no __engine.${base.lacks}, which the steps call`);
    return { none: undefined, frames: base.frames, failures: base.failures };
  } finally {
    removeWorktree(root, dir);
  }
}

/** The comparison's line, metrics and film.json part. */
function compareReport(ref: string, sha: string, unchanged: boolean, verdict: FilmVerdict, diffs: FrameDiff[] = []) {
  const head = `${ref} (${sha.slice(0, 7)}, ${unchanged ? 'same sources' : 'sources changed'})`;
  const differing = diffs.filter((d) => d.px !== 0).length;
  const objects = verdict.objects.slice(0, 4).map((o) => `${o.name} ${o.px} px`);
  const line = {
    same: `${head}: no difference in ${diffs.length} frames`,
    differs: `${head}: ${differing} of ${diffs.length} frames differ: ${objects.join(', ')}`,
    'no baseline': `${head}: no baseline`,
  }[verdict.verdict];
  const metrics: Report['metrics'] = { verdict: verdict.verdict, differing };
  for (const o of verdict.objects) metrics[`diff.${o.name}`] = o.px;
  return { line, metrics, json: { ref, commit: sha, sameSources: unchanged, ...verdict, diffs } };
}

/** The flags' values, checked before any browser starts. */
function readFlags(root: string, page: string | undefined, values: Record<string, unknown>) {
  const { scene, cam, thumb, cols = '8', steps: script = 'step 60', compare } = values as Record<string, string>;
  if (!page) throw new UsageError('name a page: labs/<name> (labs/box) or an .html file');
  const { file } = resolvePage(page);
  if (!fs.existsSync(join(root, file)))
    throw new UsageError(`there is no ${file} for ${page}: name labs/<name> or an .html file`);
  const steps = parseSteps(script);
  if (!/^[1-9]\d*$/.test(cols)) throw new UsageError(`--cols takes a whole number ≥ 1, not "${cols}"`);
  if (values.update && !thumb) throw new UsageError('--update records thumbnails: name the case with --thumb <case>');
  if (thumb !== undefined && !/^[a-z0-9][a-z0-9-]*$/.test(thumb))
    throw new UsageError(`--thumb takes a case name in lower case, digits and dashes, not "${thumb}"`);
  const ref = compare === undefined ? undefined : compare || 'HEAD';
  const sha = ref === undefined ? undefined : resolveRef(root, ref);
  const path = pageUrl(page, { scene, cam, set: values.set as string[] | undefined });
  const where = `${page}${scene ? ` scene ${scene}` : ''}${cam ? ` from cam ${cam}` : ''}`;
  const target = `${targetSlug(page)}${scene ? `-${scene}` : ''}${cam ? `-${cam}` : ''}`;
  return { spec: { page, file, scene, steps, path }, script, cols: Number(cols), thumb, ref, sha, where, target };
}

export default {
  usage:
    'film <page> [--scene s] [--cam code] [--set k=v…] [--steps "…"] [--cols n] [--compare ref] [--thumb case [--update]]',
  options: {
    ...{ scene: { type: 'string' }, cam: { type: 'string' }, set: { type: 'string', multiple: true } },
    ...{ steps: { type: 'string' }, cols: { type: 'string' }, compare: { type: 'string' } },
    ...{ thumb: { type: 'string' }, update: { type: 'boolean' } },
  },
  maxPositionals: 1,
  async run({ positionals, values, root }): Promise<CommandResult> {
    const { spec, script, cols, thumb, ref, sha, where, target } = readFlags(root, positionals[0], values);
    const unchanged = sha !== undefined && sameSources(root, sha);
    const browser = await launchBrowser();
    const runtime = browserRuntime(browser.version());
    try {
      const a = await filmTree(browser, root, spec, spec.page);
      const message = `${spec.page} has no __engine.${a.lacks}, which the steps call (PLAN.md §8.3)`;
      if (a.lacks) a.failures.push({ id: 'FILM_NO_MEMBER', message });
      if (a.failures.length || !a.frames.length)
        return { ok: false, summary: `${where} did not film`, target, browser: runtime, failures: a.failures };
      const b = sha && ref ? await filmBase(browser, root, sha, ref, spec) : undefined;
      const diffs = b?.frames.length ? a.frames.map((f, i) => compareFrames(f, b.frames[i])) : undefined;
      const filmed = b && (b.none !== undefined || b.frames.length > 0); // else the base's failures say why
      const verdict = filmed && ref ? judgeCompare({ ref, diffs, none: b.none, unchanged }) : undefined;
      const compared = verdict && compareReport(ref!, sha!, unchanged, verdict, diffs);
      const failures = [...(b?.failures ?? []), ...(verdict?.failures ?? [])];
      const out = join('out', 'film', targetSlug(target));
      const sheet = contactSheet(a.frames, { cols, base: diffs && b?.frames, diffs });
      fs.mkdirSync(join(root, out), { recursive: true });
      fs.writeFileSync(join(root, out, 'sheet.png'), encodePng(sheet.width, sheet.height, sheet.rgba));
      const frames = a.frames.map(({ rgba: _pixels, visible, ...frame }) => {
        return { ...frame, visible: visible.map(({ name, px, bbox }) => ({ name, px, bbox })) };
      });
      const json = { page: where, steps: script, frames, compare: compared?.json };
      fs.writeFileSync(join(root, out, 'film.json'), `${JSON.stringify(json, null, 2)}\n`);
      const [first, last] = [a.frames[0], a.frames[a.frames.length - 1]];
      const lines = [`${a.frames.length} frames, ticks ${first.tick}–${last.tick}, ${first.width}×${first.height}`];
      if (compared) lines.push(compared.line);
      if (thumb) {
        const checked = await checkFilmThumbs(root, thumb, a.frames, values.update === true);
        lines.push(...checked.lines);
        failures.push(...checked.failures);
      }
      const underIt = diffs ? `, ${ref}'s under it and the pixels that differ in magenta` : '';
      return {
        ok: failures.length === 0,
        summary: `${where}: ${a.frames.length} frames${verdict ? `, ${verdict.verdict} against ${ref}` : ''}`,
        lines: [...lines, `files: ${out}/sheet.png, ${out}/film.json`],
        ...{ target, browser: runtime, failures, warnings: verdict?.warnings ?? [] },
        metrics: { frames: a.frames.length, firstTick: first.tick, lastTick: last.tick, ...compared?.metrics },
        artifacts: [
          { path: `${out}/sheet.png`, kind: 'image', describes: `${where}: each frame labelled${underIt}` },
          { path: `${out}/film.json`, kind: 'json', describes: 'each frame: tick, ID pass, thumbnail; the comparison' },
        ],
      };
    } finally {
      await browser.close();
    }
  },
} satisfies Command;
