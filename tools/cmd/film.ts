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
import type { IdEntry } from '../../engine/gfx/idpass';
import type { ShotJson } from '../../engine/gfx/shot';
import { compareThumbnails, type Thumbnail } from '../../engine/gfx/thumbnail';
import { browserRuntime, launchBrowser, preparePage, VIEWPORT } from '../lib/browser';
import { waitReady, type Signals } from '../lib/page';
import { targetSlug, type Finding, type Report } from '../lib/report';
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

/** One filmed frame: its number, the sim tick, its pixels (row-major RGBA), the ID pass's visible objects, thumbnail. */
export interface FilmFrame {
  n: number;
  tick: number;
  width: number;
  height: number;
  rgba: Uint8Array;
  visible: IdEntry[];
  thumbnail?: Thumbnail;
}

/** How a frame differs from the base's: the pixels that differ (-1: not comparable) by object, the changed entries. */
export interface FrameDiff {
  n: number;
  tick: number;
  px: number;
  objects: Record<string, number>;
  /** The objects whose ID-pass entry differs: `50 px at x0,y0,x1,y1` in each, or `unseen`. */
  changed: { name: string; a: string; b: string }[];
  /** Why the frames could not be compared: `480×270 against 240×135`, `missing in the base`. */
  size?: string;
}

/** What a differing pixel that no object's box holds is attributed to. */
export const EMPTY = '(empty space)';

/** A frame's visible objects by name; a name several objects share gets `#<id>`, as `x shot` reports them. */
function keyed(visible: readonly IdEntry[]): Map<string, IdEntry> {
  const repeated = new Set(visible.map((e) => e.name).filter((name, i, all) => all.indexOf(name) !== i));
  return new Map(visible.map((e) => [repeated.has(e.name) ? `${e.name}#${e.id}` : e.name, e]));
}

/** The name the thumbnail's map gives pixel (x, y) of `frame`: its cell's (engine/gfx/thumbnail.ts `span`), if any. */
function mapName(frame: FilmFrame, x: number, y: number): string | undefined {
  const thumb = frame.thumbnail;
  if (!thumb?.map || !thumb.legend) return undefined;
  const cell = (at: number, cells: number, size: number) =>
    Math.min(cells - 1, Math.ceil(((at + 1) * cells) / size) - 1);
  return thumb.legend[thumb.map[cell(y, thumb.height, frame.height)][cell(x, thumb.width, frame.width)]];
}

/** Whether the pixel at byte offset `p` has the same RGBA in both buffers. */
const samePixel = (a: Uint8Array, b: Uint8Array, p: number) =>
  a[p] === b[p] && a[p + 1] === b[p + 1] && a[p + 2] === b[p + 2] && a[p + 3] === b[p + 3];

/** Compares frame `a` with the base's frame `b` pixel by pixel, attributing each difference (see the file comment). */
export function compareFrames(a: FilmFrame, b: FilmFrame | undefined): FrameDiff {
  const diff: FrameDiff = { n: a.n, tick: a.tick, px: 0, objects: {}, changed: [] };
  if (!b) return { ...diff, px: -1, size: 'missing in the base' };
  if (a.width !== b.width || a.height !== b.height)
    return { ...diff, px: -1, size: `${a.width}×${a.height} against ${b.width}×${b.height}` };
  const [ea, eb] = [keyed(a.visible), keyed(b.visible)];
  const show = (e?: IdEntry) => (e ? `${e.px} px at ${e.bbox.join(',')}` : 'unseen');
  const boxes: { name: string; bbox: IdEntry['bbox']; area: number; moved: boolean }[] = [];
  for (const name of new Set([...ea.keys(), ...eb.keys()])) {
    const [p, q] = [ea.get(name), eb.get(name)];
    const moved = show(p) !== show(q);
    if (moved) diff.changed.push({ name, a: show(p), b: show(q) });
    for (const { bbox } of [p, q].filter((e) => e !== undefined))
      boxes.push({ name, bbox, area: (bbox[2] - bbox[0] + 1) * (bbox[3] - bbox[1] + 1), moved });
  }
  boxes.sort((p, q) => p.area - q.area);
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      if (samePixel(a.rgba, b.rgba, (y * a.width + x) * 4)) continue;
      const holds = boxes.filter(({ bbox: [x0, y0, x1, y1] }) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
      const named = [mapName(b, x, y), mapName(a, x, y)];
      const owner =
        holds.find((box) => box.moved) ??
        holds.find((box) => named.includes(box.name.replace(/#\d+$/, ''))) ??
        holds[0];
      const name = owner?.name ?? EMPTY;
      diff.px++;
      diff.objects[name] = (diff.objects[name] ?? 0) + 1;
    }
  }
  return diff;
}

/** An object that differs over a film: its pixels, the frames, and whether its ID-pass entry changed (it moved). */
export interface FilmObject {
  name: string;
  px: number;
  frames: number[];
  coverage: 'changed' | 'same';
}

/** The verdict on a comparison, its findings, and the objects that differ, most pixels first. */
export interface FilmVerdict {
  verdict: 'same' | 'differs' | 'no baseline';
  failures: Finding[];
  warnings: Finding[];
  objects: FilmObject[];
}

/** Judges a comparison with `ref`: `none` says why there is no baseline, `unchanged` that the sources are the ref's. */
export function judgeCompare(input: { ref: string; diffs?: FrameDiff[]; none?: string; unchanged: boolean }) {
  const verdict: FilmVerdict = { verdict: 'same', failures: [], warnings: [], objects: [] };
  if (input.none !== undefined) {
    const message = `no baseline: ${input.none}; the comparison is a deferred proof`;
    return { ...verdict, verdict: 'no baseline' as const, warnings: [{ id: 'FILM_NO_BASELINE', message }] };
  }
  const diffs = input.diffs ?? [];
  const differ = diffs.filter((d) => d.px !== 0);
  if (!differ.length) return verdict;
  const objects = new Map<string, FilmObject>();
  for (const d of differ) {
    for (const [name, px] of Object.entries(d.objects)) {
      const o = objects.get(name) ?? { name, px: 0, frames: [], coverage: 'same' };
      const coverage = d.changed.some((c) => c.name === name) ? 'changed' : o.coverage;
      objects.set(name, { name, px: o.px + px, frames: [...o.frames, d.n], coverage });
    }
  }
  verdict.objects = [...objects.values()].sort((p, q) => q.px - p.px || p.name.localeCompare(q.name));
  const parts = [
    ...verdict.objects.slice(0, 5).map((o) => `${o.name} ${o.px} px`),
    ...differ.filter((d) => d.size).map((d) => `frame ${d.n}: ${d.size}`),
  ];
  const px = differ.reduce((sum, d) => sum + Math.max(0, d.px), 0);
  const what = `${differ.length} of ${diffs.length} frames differ from ${input.ref} (${px} px): ${parts.join(', ')}`;
  if (input.unchanged) {
    const message = `${what}, although this tree's sources are ${input.ref}'s: the film does not repeat; find where the runs part (node x replay --bisect, the determinism-debugging skill) or what the view reads besides the sim`;
    return { ...verdict, verdict: 'differs' as const, failures: [{ id: 'FILM_NOT_REPEATABLE', message }] };
  }
  const message = `${what}; check that your change does only this (the sheet's third row marks each pixel in magenta)`;
  return { ...verdict, verdict: 'differs' as const, warnings: [{ id: 'FILM_CHANGED', message }] };
}

/** The sheet's colours (background, labels, "same") and the space around frames, in pixels. */
const [BACK, INK, GREEN, PAD] = [[27, 27, 36, 255], [200, 200, 224], [122, 216, 138], 4] as const;
/** The colour of a pixel that differs from the base's, on the sheet's diff row. */
export const MAGENTA = [255, 40, 220] as const;
/** The height of a label under a frame, in pixels: the 3 × 5 font at twice its size, with a margin. */
export const LABEL = 14;

/** The 3 × 5 font: each glyph's five rows of three bits (the left pixel highest), as three base-36 digits. */
const GLYPHS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ#.:-/=?,%()@_+><\'"';
const FONT =
  'odr8t3mw7mofi4po27o33mmqohbogf8odl9qbabl7yo13o10bcbi5pn133myi3xeg7iy5l7x8kql9g8kzl9pb66n0yi27i22i65hwthw2mnbiv1' +
  '0020sw0cg3ok2t4mma00kgbp429djo8o300715cdhw45t740hs0';

/** A contact sheet, or any RGBA image: its size and its pixels, row-major. */
export interface Sheet {
  width: number;
  height: number;
  rgba: Uint8Array;
}

/** Draws `text` in upper case on `sheet` at `at`, each font pixel 2 × 2, cut before x `clip`; `?` for other glyphs. */
export function drawText(sheet: Sheet, at: [number, number], text: string, colour: readonly number[], clip = Infinity) {
  for (const [k, char] of [...text.toUpperCase().replace(/×/g, 'X')].entries()) {
    const glyph = GLYPHS.includes(char) ? GLYPHS.indexOf(char) : GLYPHS.indexOf('?');
    const bits = char === ' ' ? 0 : parseInt(FONT.slice(glyph * 3, glyph * 3 + 3), 36);
    for (let p = 0; p < 60; p++) {
      const [x, y] = [at[0] + (k * 4 + ((p >> 2) % 3)) * 2 + (p & 1), at[1] + Math.floor(p / 12) * 2 + ((p >> 1) & 1)];
      if (bits & (1 << (14 - (p >> 2))) && x < Math.min(clip, sheet.width) && y < sheet.height)
        sheet.rgba.set(colour, (y * sheet.width + x) * 4);
    }
  }
}

/** How to lay a sheet out: in `cols` columns; with the base's frames and the diffs, rows A, B and the diff. */
interface SheetOptions {
  cols: number;
  base?: readonly FilmFrame[];
  diffs?: readonly FrameDiff[];
}

/** Lays frames out in `cols` columns, each labelled; with the base's frames and the diffs, rows A, B and the diff. */
export function contactSheet(frames: readonly FilmFrame[], options: SheetOptions): Sheet {
  const [w, h, rows, cols] = [frames[0].width, frames[0].height, options.base ? 3 : 1, options.cols];
  const cell = h + LABEL + PAD;
  const width = Math.min(cols, frames.length) * (w + PAD) + PAD;
  const height = Math.ceil(frames.length / cols) * rows * cell + PAD;
  const sheet = { width, height, rgba: new Uint8Array(width * height * 4) };
  const { rgba } = sheet;
  for (let p = 0; p < rgba.length; p += 4) rgba.set(BACK, p);
  const blit = (frame: FilmFrame, x0: number, y0: number, other?: Uint8Array) => {
    for (let y = 0; y < Math.min(h, frame.height); y++) {
      for (let x = 0; x < Math.min(w, frame.width); x++) {
        const [q, to] = [(y * frame.width + x) * 4, ((y0 + y) * width + x0 + x) * 4];
        const grey = Math.round((frame.rgba[q] + frame.rgba[q + 1] + frame.rgba[q + 2]) / 9 + 20);
        if (!other) rgba.set(frame.rgba.subarray(q, q + 4), to);
        else rgba.set(samePixel(frame.rgba, other, q) ? [grey, grey, grey, 255] : [...MAGENTA, 255], to);
      }
    }
  };
  for (const [i, frame] of frames.entries()) {
    const [x0, y0] = [PAD + (i % cols) * (w + PAD), PAD + Math.floor(i / cols) * rows * cell];
    const label = (row: number, text: string, colour: readonly number[] = INK) =>
      drawText(sheet, [x0, y0 + row * cell + h + 2], text, colour, x0 + w);
    blit(frame, x0, y0);
    label(0, `${options.base ? 'A ' : ''}frame ${frame.n}, tick ${frame.tick}`);
    const [b, d] = [options.base?.[i], options.diffs?.[i]];
    if (b) blit(b, x0, y0 + cell);
    if (b) label(1, `B frame ${b.n}, tick ${b.tick}`);
    if (!d) continue;
    if (b && d.px >= 0) blit(frame, x0, y0 + 2 * cell, b.rgba);
    const top = Object.entries(d.objects).sort((p, q) => q[1] - p[1])[0]?.[0];
    const text = d.px < 0 ? `${d.size}` : d.px ? `${d.px} px differ: ${top}` : 'same';
    label(d.px < 0 && !b ? 1 : 2, text, d.px ? MAGENTA : GREEN);
  }
  return sheet;
}

/** A film's thumbnail baseline: each frame's thumbnail, with its tick. */
type FilmThumbs = { case: string; frames: (Thumbnail & { tick: number })[] };

/** Compares each frame's thumbnail with the baseline's (24 of 255): a line per frame that moved, or the counts. */
export function compareFilmThumbs(expected: FilmThumbs['frames'], frames: readonly FilmFrame[]): string[] {
  if (expected.length !== frames.length)
    return [`the film has ${frames.length} frames, the baseline ${expected.length}`];
  return frames.flatMap((frame, i) => {
    const diff = frame.thumbnail && compareThumbnails(expected[i], frame.thumbnail);
    if (diff?.cells === 0) return [];
    if (!diff) return [`frame ${frame.n} (tick ${frame.tick}) has no thumbnail`];
    const worst = diff.worst.slice(0, 3).map((c) => `(${c.x},${c.y}) ${c.expected}→${c.actual}`);
    return [`frame ${frame.n} (tick ${frame.tick}): ${diff.cells} cells moved, worst ${worst.join(', ')}`];
  });
}

/** Records the film's thumbnails as `tests/baselines/thumbs/<name>.json` with `update`, else compares them with it. */
export async function checkFilmThumbs(root: string, name: string, frames: readonly FilmFrame[], update: boolean) {
  const baseline = join('tests', 'baselines', 'thumbs', `${name}.json`);
  const file = join(root, baseline);
  if (update) {
    const prettier = await import('prettier');
    const thumbs: FilmThumbs = { case: name, frames: frames.map((f) => ({ tick: f.tick, ...f.thumbnail! })) };
    const options = { ...(await prettier.resolveConfig(file)), filepath: file };
    fs.writeFileSync(file, await prettier.format(JSON.stringify(thumbs), options));
    return { lines: [`thumbnails recorded: ${baseline}`], failures: [] };
  }
  if (!fs.existsSync(file)) {
    const message = `there is no thumbnail baseline ${baseline}: record it with --thumb ${name} --update, and say why in the commit`;
    return { lines: [], failures: [{ id: 'FILM_NO_THUMB', message }] };
  }
  const moved = compareFilmThumbs((JSON.parse(fs.readFileSync(file, 'utf8')) as FilmThumbs).frames, frames);
  const fix = 'fix the change, or re-record with --update and say why';
  return {
    lines: [`thumbnails: ${moved.length ? `${moved.length} frames moved from` : 'every frame matches'} ${baseline}`],
    failures: moved.map((m) => ({ id: 'FILM_THUMB_MOVED', message: `${m}: ${fix}`, file: baseline })),
  };
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
