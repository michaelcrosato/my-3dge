/**
 * @file Contact sheets from the gallery (PLAN.md WP 7.7, §8.5): `node x gallery <kind> [id]` films every entry of a
 * kind with a `gallery` field (engine/core/gallery.ts), or the one named, in a page's gallery: it opens
 * `<page>#gallery/<kind>/<id>` as `x shot` opens a page (Vite, Chromium on WebGPU, the virtual clock, seed 1), calls
 * `__engine.gallery.shoot` for each entry (engine/dev/galleryShoot.ts: each frame staged, its camera fitted, shot),
 * and lays the frames out on x film's contact sheet (tools/lib/filmSheet.ts), each labelled: an entry a row, or eight
 * entries a row when each has one frame. Without a kind it lists the kinds the gallery films, with their entries.
 *
 * Every frame must show its subject: the ID pass sees at least `SHOWN` of the frame besides the ground (`shows`), and
 * an emitter's fullest frame `BURST_SHOWN` (`emptyFrames`: a burst thins to its last specks); one that shows less is a
 * failure naming its entry and frame. The page is `--page`: tests/pages/gallery.html by default, which registers every
 * lab's entries; a lab's page films its own (labs/playground). The shots are `--size` (240x135); `--look <id>` draws
 * every frame in that look (the view setting `post.look`; a look's own frames draw in it). Files:
 * out/gallery/<kind>[-<id>][-<look>]/sheet.png and gallery.json (every frame's label, tick, camera and ID pass).
 *
 * Usage: node x gallery [kind [id]] [--page p] [--size WxH] [--look id]. Exit 1 when a frame shows too little or the
 * page fails, 2 for a kind or id the gallery lacks (the message lists the valid ones) or a bad flag.
 *
 * @example
 * shows({ visible: [{ name: 'stage/ground', share: 0.9 }] }); // false: only the ground
 * // node x gallery body
 * // node x gallery material --look look:playground-pixel
 * @see tools/cmd/gallery.test.ts
 */
import * as fs from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import type { GalleryShot } from '../../engine/dev/galleryShoot';
import { browserRuntime, launchBrowser, preparePage, VIEWPORT } from '../lib/browser';
import type { FilmFrame } from '../lib/filmCompare';
import { contactSheet } from '../lib/filmSheet';
import { waitReady } from '../lib/page';
import { targetSlug, type Finding } from '../lib/report';
import { startVite } from '../lib/vite';
import { UsageError, type Command, type CommandResult } from '../x';
import { pageErrorFinding, pageFailures } from './inspect';
import { encodePng, READY_TIMEOUT_MS, resolvePage } from './shot';

/** The page the gallery films unless `--page` says: every lab's entries registered. */
export const PAGE = 'tests/pages/gallery.html';

/** The shots' size unless `--size` says: 16:9, wide enough for a 30-letter label. */
export const SIZE = { width: 240, height: 135 } as const;

/** An entry's filmed frames, as `gallery.shoot` returns them; `burst` for an emitter's. */
export interface Filmed {
  id: string;
  burst?: boolean;
  frames: GalleryShot[];
}

/** The least share of a frame a still subject covers in each of its frames: about 65 pixels of 240 × 135. */
export const SHOWN = 0.002;

/**
 * The least share an emitter covers in its fullest frame, about 8 pixels of 240 × 135: a burst thins to its last
 * specks, and a sky effect run from the floor (snow, which no floor stops) falls out of sight at once.
 */
export const BURST_SHOWN = SHOWN / 8;

/** What a shot's ID pass sees of its subject: the share of the frame besides the stage's ground (stage.ts). */
export function seenShare(shot: { visible: readonly { name: string; share: number }[] }): number {
  const seen = shot.visible.filter((entry) => !entry.name.startsWith('stage/ground'));
  return seen.reduce((sum, entry) => sum + entry.share, 0);
}

/** Whether a shot shows its subject: its ID pass sees at least `SHOWN` of it. */
export const shows = (shot: Parameters<typeof seenShare>[0]): boolean => seenShare(shot) >= SHOWN;

/** The frames of `entry` that show too little: each of a still subject's below `SHOWN`; a burst's all of them when its fullest is below `BURST_SHOWN`. */ // prettier-ignore
export function emptyFrames(entry: Filmed): GalleryShot[] {
  if (!entry.burst) return entry.frames.filter((shot) => !shows(shot));
  return Math.max(0, ...entry.frames.map(seenShare)) >= BURST_SHOWN ? [] : entry.frames;
}

/** Reads `--size WxH`; throws `UsageError`. */
export function readSize(text: string | undefined): { width: number; height: number } {
  if (text === undefined) return { ...SIZE };
  const [, w, h] = /^(\d+)x(\d+)$/.exec(text) ?? [];
  if (!w || Number(w) < 16 || Number(h) < 16 || Number(w) > 1920 || Number(h) > 1080)
    throw new UsageError(`--size takes WxH in pixels, 16 to 1920 by 16 to 1080 (--size 240x135), not "${text}"`);
  return { width: Number(w), height: Number(h) };
}

/** The sheet's frames: every entry's in order, labelled, with its pixels. */
export function sheetFrames(entries: readonly Filmed[]): (FilmFrame & { label: string })[] {
  const frames = entries.flatMap((entry) => entry.frames);
  return frames.map((shot, n) => {
    const { label, tick, width, height, visible, pixels } = shot;
    return { n, tick, width, height, rgba: new Uint8Array(Buffer.from(pixels, 'base64')), visible, label };
  });
}

/** Calls `__engine.<member>(...args)` in the page; an error thrown there comes back as its message. */
async function call<T>(tab: Page, member: string, ...args: unknown[]): Promise<T> {
  const done = await tab.evaluate(
    async ([name, rest]) => {
      const engine = (window as unknown as { __engine: Record<string, unknown> }).__engine;
      const fn = name.split('.').reduce<unknown>((at, key) => (at as Record<string, unknown> | undefined)?.[key], engine); // prettier-ignore
      if (typeof fn !== 'function') return { error: `the page has no __engine.${name}` };
      try {
        return { value: (await (fn as (...values: unknown[]) => unknown)(...rest)) as unknown };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
    [member, args] as [string, unknown[]],
  );
  if ('error' in done) throw new Error(done.error);
  return done.value as T;
}

export default {
  usage: 'gallery [kind [id]] [--page p] [--size WxH] [--look id]',
  options: { page: { type: 'string' }, size: { type: 'string' }, look: { type: 'string' } },
  maxPositionals: 2,
  async run({ positionals, values, root }): Promise<CommandResult> {
    const [kind, id] = positionals;
    const page = (values.page as string | undefined) ?? PAGE;
    const size = readSize(values.size as string | undefined);
    const { path, file } = resolvePage(page);
    if (!fs.existsSync(join(root, file)))
      throw new UsageError(`there is no ${file} for --page ${page}: name labs/<name> or an .html file`);
    const look = values.look as string | undefined;
    const target = targetSlug([kind ?? 'kinds', id, look?.replace(/^look:/, '')].filter(Boolean).join('-'));
    const browser = await launchBrowser();
    const runtime = browserRuntime(browser.version());
    const server = await startVite({ root });
    const tab = await browser.newPage({ viewport: VIEWPORT });
    try {
      const watch = await preparePage(tab, { seed: 1, root });
      await tab.goto(`${server.url}${path}#gallery/${[kind, id].filter(Boolean).join('/')}`);
      const signals = await waitReady(tab, watch, READY_TIMEOUT_MS);
      const thrown = (await watch.errors()).map(pageErrorFinding(page));
      const failures: Finding[] = pageFailures(page, file, signals, thrown);
      if (failures.length) return { ok: false, summary: `${page}'s gallery did not open`, target, browser: runtime, failures }; // prettier-ignore
      if (!kind) {
        const kinds = await call<{ kind: string; count: number }[]>(tab, 'gallery.list');
        const lines = kinds.map((k) => `${k.kind}: ${k.count} entries (node x gallery ${k.kind})`);
        return { ok: true, summary: `${page}'s gallery films ${kinds.length} kinds`, lines, target, browser: runtime };
      }
      if (look !== undefined) {
        const looks = await call<string[]>(tab, 'gallery.list', 'look');
        if (!looks.includes(look))
          throw new UsageError(`--look names no look of ${page}: looks are ${looks.join(', ')}`);
        await call(tab, 'set', 'post.look', look);
      }
      const ids = await call<string[]>(tab, 'gallery.list', kind).catch((error: Error) => {
        throw new UsageError(error.message.replace(/^\[\w+\] /, ''));
      });
      if (id !== undefined && !ids.includes(id))
        throw new UsageError(`the gallery has no ${kind} "${id}": ${kind}s are ${ids.join(', ')}`);
      const entries: Filmed[] = [];
      for (const each of id !== undefined ? [id] : ids) {
        const filmed = await call<Filmed>(tab, 'gallery.shoot', kind, each, size);
        entries.push({ id: each, burst: filmed.burst, frames: filmed.frames });
        for (const frame of emptyFrames(filmed))
          failures.push({ id: 'GALLERY_EMPTY_FRAME', message: `${frame.label} shows next to nothing but the ground (camera ${frame.camera})` }); // prettier-ignore
      }
      failures.push(...(await watch.errors()).slice(thrown.length).map(pageErrorFinding(page)));
      const frames = sheetFrames(entries);
      const most = Math.max(...entries.map((entry) => entry.frames.length));
      const sheet = contactSheet(frames, { cols: most > 1 ? most : 8 });
      const out = join('out', 'gallery', target);
      fs.mkdirSync(join(root, out), { recursive: true });
      fs.writeFileSync(join(root, out, 'sheet.png'), encodePng(sheet.width, sheet.height, sheet.rgba));
      const json = entries.map((entry) => ({ id: entry.id, frames: entry.frames.map(({ pixels: _pixels, ...frame }) => frame) })); // prettier-ignore
      fs.writeFileSync(
        join(root, out, 'gallery.json'),
        `${JSON.stringify({ page, kind, look, entries: json }, null, 2)}\n`,
      );
      const lines = entries.map((entry) => `${entry.id}: ${entry.frames.length} frames, ${entry.frames.filter(shows).length} showing it`); // prettier-ignore
      return {
        ok: failures.length === 0,
        summary: `${page}'s gallery: ${entries.length} ${kind} ${entries.length === 1 ? 'entry' : 'entries'}, ${frames.length} frames${look ? ` in ${look}` : ''}`, // prettier-ignore
        lines: [...lines, `files: ${out}/sheet.png, ${out}/gallery.json`],
        ...{ target, browser: runtime, failures },
        metrics: { entries: entries.length, frames: frames.length, empty: entries.flatMap(emptyFrames).length },
        artifacts: [
          { path: `${out}/sheet.png`, kind: 'image', describes: `every ${kind}'s gallery frames, labelled, an entry a row` }, // prettier-ignore
          { path: `${out}/gallery.json`, kind: 'json', describes: "each frame's label, tick, camera and ID pass" },
        ],
      };
    } finally {
      await tab.close();
      await server.close();
      await browser.close();
    }
  },
} satisfies Command;
