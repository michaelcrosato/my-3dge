/**
 * @file The frame comparison of `x film` (tools/cmd/film.ts, PLAN.md WP 3.11): `compareFrames` compares a filmed frame
 * with the base's pixel by pixel and gives each differing pixel to an object through the ID pass, `judgeCompare` turns
 * a film's differences into its verdict and findings, and `checkFilmThumbs` holds each frame's thumbnail to
 * `tests/baselines/thumbs/<case>.json`. The rules they follow are film.ts's file comment, which is `x help film`.
 *
 * Invariants: everything here is a pure function of the frames, but `checkFilmThumbs`, which reads or writes the
 * baseline; nothing opens a page.
 *
 * @example
 * const frame = { n: 1, tick: 60, width: 1, height: 1, rgba: new Uint8Array([0, 0, 0, 255]), visible: [] };
 * compareFrames(frame, frame).px; // 0
 * judgeCompare({ ref: 'HEAD', diffs: [compareFrames(frame, frame)], unchanged: true }).verdict; // 'same'
 * @see tools/cmd/film.test.ts
 */
import * as fs from 'node:fs';
import { join } from 'node:path';
import type { IdEntry } from '../../engine/gfx/idpass';
import { compareThumbnails, type Thumbnail } from '../../engine/gfx/thumbnail';
import type { Finding } from './report';

/** One filmed frame: its number, the sim tick, its pixels (row-major RGBA), the ID pass's visible objects, thumbnail. */
export interface FilmFrame {
  n: number;
  tick: number;
  /** What the sheet labels it, instead of its number and tick (a gallery frame's entry and view). */
  label?: string;
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
export const samePixel = (a: Uint8Array, b: Uint8Array, p: number) =>
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
