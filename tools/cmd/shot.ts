/**
 * @file Renders a page on WebGPU in the platform's Chromium and reports what it drew as numbers and text: the look
 * metrics, the ID pass (which object covers which pixels) and a 48 × 27 text thumbnail; images only on demand.
 *
 * `node x shot <page>` serves the repository with Vite (tools/lib/vite.ts, on a free port), opens the page the way
 * the e2e fixture does (tools/lib/browser.ts: the WebGPU flags, the virtual clock, seed 1) with `--scene`, `--cam`
 * and each `--set key=value` as URL parameters, waits for `window.__engine.ready`, and calls `__engine.shot(options)`
 * (engine/gfx/shot.ts: the frame drawn into a render target and read back, the ID pass, the look metrics, the
 * thumbnail). report.json gets the look metrics (coverage, luma P5 and P95 and their spread, the dark and blown-out
 * shares, colours, palette, flat share, dithering, edge density, the largest object and its share, whether the
 * protagonist is visible), the ID-pass list (`px.<name>`, `share.<name>`, `bbox.<name>` as `x0,y0,x1,y1` from the
 * top left, `unseen.<name>`: `hidden`, `outside` or `covered`; a repeated name gets `#<id>`), and each look note as
 * a warning with its number and fix; `out/shot/<target>/shot.json` holds the whole result, thumbnail and object map
 * included (out/ is never committed). A page without `__engine.shot` (labs/hello) is screenshotted instead: look
 * metrics and thumbnail, no ID pass.
 *
 * Flags: `--ids` (the ID pass only) and `--metrics` (the look only), both when neither is given; `--marks` numbers
 * what the ID pass sees on `marks.png`, the legend as `mark.<n>` (shardfall's `see`); `--png` writes `frame.png`;
 * `--thumb <case>` compares the thumbnail with `tests/baselines/thumbs/<case>.json` (24 of 255 per channel per
 * cell), and with `--update` records it (tests/baselines/thumbs/README.md). A page is `labs/<name>` (its index.html)
 * or an `.html` file, with an optional query: `node x shot labs/hello`, `node x shot tests/pages/shot.html --cam iso
 * --marks`.
 *
 * Usage: node x shot <page> [--scene s] [--cam code] [--set k=v…] [--ids] [--metrics] [--marks] [--png]
 * [--thumb case [--update]]. Fails (exit 1) when the page signals an error or throws, reports another backend than
 * WebGPU, draws a blank frame, has no ID pass for `--ids` or `--marks`, or its thumbnail misses the baseline.
 * Console warnings no advice baseline lists are warnings.
 *
 * @example
 * pageUrl('labs/box', { scene: 'room', cam: 'iso' }); // 'labs/box/?scene=room&cam=iso'
 * @see tools/cmd/shot.test.ts
 * @see tests/e2e/shot.spec.ts
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import type { IdEntry, IdUnseen } from '../../engine/gfx/idpass';
import { judgeLook, lookMetrics, type LookMetrics, type LookNote } from '../../engine/gfx/lookMetrics';
import type { ShotJson, ShotOptions } from '../../engine/gfx/shot';
import { compareThumbnails, thumbnail, type Thumbnail } from '../../engine/gfx/thumbnail';
import { browserRuntime, describePageError, launchBrowser, preparePage, VIEWPORT } from '../lib/browser';
import { decodePng } from '../lib/png';
import { targetSlug, type Artifact, type Finding, type Report } from '../lib/report';
import { startVite } from '../lib/vite';
import { UsageError, type Command, type CommandResult } from '../x';

/** How long a page may take to signal ready or an error, in milliseconds. */
export const READY_TIMEOUT_MS = 30_000;

/** The look metrics of a frame of RGBA bytes (engine/gfx/lookMetrics.ts), as the e2e suites import them from here. */
export const frameMetrics = (rgba: Uint8Array, width: number, height: number): LookMetrics =>
  lookMetrics(rgba, width, height);

/** The verdict on a frame's look notes: notes that fail are failures, the others warnings. */
export function judgeFrame(notes: readonly LookNote[]): { failures: Finding[]; warnings: Finding[] } {
  const finding = ({ id, message }: LookNote): Finding => ({ id, message });
  return {
    failures: notes.filter((note) => note.level === 'fail').map(finding),
    warnings: notes.filter((note) => note.level === 'warn').map(finding),
  };
}

/** Turns a page argument into the URL path to open (relative to the server) and the file that must exist for it. */
export function resolvePage(page: string): { path: string; file: string } {
  const [rawPath, query] = page.split(/\?(.*)/s, 2);
  const path = rawPath.replace(/^\.?\//, '');
  const suffix = query === undefined ? '' : `?${query}`;
  if (path.endsWith('.html')) return { path: `${path}${suffix}`, file: path };
  const dir = path.replace(/\/+$/, '');
  return { path: `${dir}/${suffix}`, file: `${dir}/index.html` };
}

/** The page's URL path with `scene`, `cam` and each `key=value` of `set` added as URL parameters. */
export function pageUrl(page: string, options: { scene?: string; cam?: string; set?: readonly string[] } = {}): string {
  const { path } = resolvePage(page);
  const [base, query = ''] = path.split(/\?(.*)/s, 2);
  const params = new URLSearchParams(query);
  if (options.scene !== undefined) params.set('scene', options.scene);
  if (options.cam !== undefined) params.set('cam', options.cam);
  for (const pair of options.set ?? []) {
    const at = pair.indexOf('=');
    if (at < 1) throw new UsageError(`--set takes key=value (a setting's path, then its value), not "${pair}"`);
    params.set(pair.slice(0, at), pair.slice(at + 1));
  }
  const search = params.toString();
  return search ? `${base}?${search}` : base;
}

/** Encodes RGBA bytes as an 8-bit RGBA PNG (Node's zlib; no image dependency). */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const end = chunk('IEND', Buffer.alloc(0));
  return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), end]);
}

/** A shot's numbers for report.json: the look metrics, the ID-pass list and the marks' legend, flat. */
export function shotMetrics(shot: Pick<ShotJson, 'width' | 'height' | 'metrics' | 'ids' | 'marks'>): Report['metrics'] {
  const out: Report['metrics'] = { width: shot.width, height: shot.height };
  for (const [key, value] of Object.entries(shot.metrics ?? {})) if (value !== null) out[key] = value;
  const names = new Map<number, string>();
  if (shot.ids) {
    const { ids } = shot;
    Object.assign(out, { objects: ids.objects, visible: ids.visible.length, empty: ids.empty, stray: ids.stray });
    const all: (IdEntry | IdUnseen)[] = [...ids.visible, ...ids.unseen];
    const repeated = new Set(all.map((e) => e.name).filter((name, i, list) => list.indexOf(name) !== i));
    for (const e of all) names.set(e.id, repeated.has(e.name) ? `${e.name}#${e.id}` : e.name);
    for (const e of ids.visible) {
      const key = names.get(e.id)!;
      Object.assign(out, { [`px.${key}`]: e.px, [`share.${key}`]: e.share, [`bbox.${key}`]: e.bbox.join(',') });
    }
    for (const e of ids.unseen) out[`unseen.${names.get(e.id)}`] = e.reason;
    if (ids.protagonist && out.protagonist === undefined) out.protagonist = ids.protagonist.px > 0;
  }
  for (const mark of shot.marks ?? []) out[`mark.${mark.n}`] = names.get(mark.id) ?? mark.name;
  return out;
}

/** The lab pages there are, for a usage error. */
function labPages(root: string): string[] {
  const labs = join(root, 'labs');
  if (!existsSync(labs)) return [];
  return readdirSync(labs)
    .filter((name) => existsSync(join(labs, name, 'index.html')))
    .map((name) => `labs/${name}`);
}

/** The page's signal (PLAN.md §8.3), read once: ready, its errors as lines, its info, and whether it can shoot. */
interface Signals {
  ready: boolean;
  errors: string[];
  info?: Record<string, unknown>;
  shoots: boolean;
}

/** Runs in the page, through `evaluate`: reads `window.__engine`, if the page has published it. */
function pageSignals(): Signals | undefined {
  const engine = (window as unknown as { __engine?: Record<string, unknown> }).__engine;
  if (!engine) return undefined;
  const errors = ((engine.errors ?? []) as { code?: string; message?: string; fix?: string }[]).map(
    (error) => `${error.code ?? 'ERROR'}: ${error.message ?? ''}${error.fix ? ` (fix: ${error.fix})` : ''}`,
  );
  const info = typeof engine.info === 'function' ? (engine.info as () => Record<string, unknown>)() : undefined;
  return { ready: engine.ready === true, errors, info, shoots: typeof engine.shot === 'function' };
}

/** Runs in the page, through `evaluate`: `__engine.shot(options)`, which returns `shotForJson`'s shape. */
function pageShot(options: ShotOptions): Promise<ShotJson> {
  const engine = (window as unknown as { __engine: { shot(options: ShotOptions): Promise<ShotJson> } }).__engine;
  return engine.shot(options);
}

/** `label: a, b, c`, cut to one line of about 150 characters. */
function listLine(label: string, items: string[]): string {
  let line = `${label}: `;
  for (const [i, item] of items.entries()) {
    const next = `${i ? ', ' : ''}${item}`;
    if (line.length + next.length > 150) return `${line}, … (${items.length - i} more)`;
    line += next;
  }
  return line;
}

/** Shoots through the page's `__engine.shot`, or screenshots a page that has none (look metrics only). */
async function shootPage(
  tab: import('@playwright/test').Page,
  signals: Signals,
  options: ShotOptions & { where: string },
): Promise<{ shot: ShotJson; noIds?: string }> {
  if (signals.shoots) return { shot: await tab.evaluate(pageShot, options) };
  const { width, height, rgba } = decodePng(await tab.locator('canvas').first().screenshot());
  const metrics = lookMetrics(rgba, width, height);
  const shot: ShotJson = { width, height, readback: { bytesPerRow: width * 4, bytes: rgba.length }, built: 0, ms: 0 };
  Object.assign(shot, { metrics, notes: judgeLook(metrics, options.where), thumbnail: thumbnail(rgba, width, height) });
  if (options.pixels) shot.pixels = Buffer.from(rgba).toString('base64');
  return {
    shot,
    noIds: `${options.where} has no __engine.shot, so there is no ID pass (engine/gfx/shot.ts; the box's engine registers it): the canvas was screenshotted for the look metrics`,
  };
}

/** Compares the thumbnail with its baseline, or records it with `update`; returns the lines and metrics to report. */
async function checkThumb(root: string, name: string, thumb: Thumbnail, update: boolean, where: string) {
  const baseline = join('tests', 'baselines', 'thumbs', `${name}.json`);
  const file = join(root, baseline);
  if (update) {
    const prettier = await import('prettier');
    const options = (await prettier.resolveConfig(file)) ?? {};
    writeFileSync(
      file,
      await prettier.format(JSON.stringify({ case: name, ...thumb }), { ...options, filepath: file }),
    );
    return { lines: [`thumbnail recorded: ${baseline}`], metrics: {}, failures: [] };
  }
  if (!existsSync(file)) {
    const message = `there is no thumbnail baseline ${baseline}: record it with --thumb ${name} --update, and say why in the commit`;
    return { lines: [], metrics: {}, failures: [{ id: 'SHOT_NO_THUMB', message }] };
  }
  const diff = compareThumbnails(JSON.parse(readFileSync(file, 'utf8')) as Thumbnail, thumb);
  const lines = [`thumbnail: ${diff.cells} cells moved beyond 24 (largest change ${diff.maxDelta}) from ${baseline}`];
  const metrics = { thumbCells: diff.cells, thumbMaxDelta: diff.maxDelta, thumbMeanDelta: diff.meanDelta };
  if (diff.cells === 0) return { lines, metrics, failures: [] };
  const cells = diff.worst.map((cell) => `(${cell.x},${cell.y}) ${cell.expected}→${cell.actual}`).join(', ');
  const message = `${where} moved from its thumbnail in ${diff.cells} cells, worst ${cells}: fix the change, or re-record with --update and say why`;
  return { lines, metrics, failures: [{ id: 'SHOT_THUMB_MOVED', message, file: baseline }] };
}

export default {
  usage:
    'shot <page> [--scene s] [--cam code] [--set k=v…] [--ids] [--metrics] [--marks] [--png] [--thumb case [--update]]',
  options: {
    scene: { type: 'string' },
    cam: { type: 'string' },
    set: { type: 'string', multiple: true },
    ids: { type: 'boolean' },
    metrics: { type: 'boolean' },
    marks: { type: 'boolean' },
    png: { type: 'boolean' },
    thumb: { type: 'string' },
    update: { type: 'boolean' },
  },
  maxPositionals: 1,
  async run({ positionals, values, root }): Promise<CommandResult> {
    const [page] = positionals;
    if (!page)
      throw new UsageError(`name a page: labs/<name> or an .html file (${labPages(root).join(', ') || 'no labs yet'})`);
    const { file } = resolvePage(page);
    if (!existsSync(join(root, file))) {
      throw new UsageError(
        `there is no ${file} for ${page}; pages: ${labPages(root).join(', ') || 'none'}, or an .html file`,
      );
    }
    const [scene, cam, thumb] = [values.scene, values.cam, values.thumb] as (string | undefined)[];
    if (values.update && !thumb) throw new UsageError('--update records a thumbnail: name it with --thumb <case>');
    if (thumb !== undefined && !/^[a-z0-9][a-z0-9-]*$/.test(thumb))
      throw new UsageError(`--thumb takes a case name in lower case, digits and dashes, not "${thumb}"`);
    const path = pageUrl(page, { scene, cam, set: (values.set ?? []) as string[] });
    const neither = !values.ids && !values.metrics;
    const marks = values.marks === true;
    const target = `${targetSlug(page)}${scene ? `-${scene}` : ''}${cam ? `-${cam}` : ''}`;
    const where = `${page}${scene ? ` scene ${scene}` : ''}${cam ? ` from cam ${cam}` : ''}`;
    const out = join('out', 'shot', targetSlug(target));
    const server = await startVite({ root });
    const browser = await launchBrowser();
    try {
      const tab = await browser.newPage({ viewport: VIEWPORT });
      const watch = await preparePage(tab, { seed: 1, root });
      let pageErrors = 0;
      tab.on('pageerror', () => pageErrors++);
      await tab.goto(`${server.url}${path}`);
      const deadline = Date.now() + READY_TIMEOUT_MS;
      let signals = await tab.evaluate(pageSignals);
      while (!signals?.ready && !signals?.errors.length && pageErrors === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        signals = await tab.evaluate(pageSignals);
      }
      const runtime = browserRuntime(browser.version());
      const failures: Finding[] = (await watch.errors()).map((error) => ({
        id: 'SHOT_PAGE_ERROR',
        message: `${page} threw: ${describePageError(error)}`,
        ...(error.file ? { file: error.file, line: error.line } : {}),
      }));
      for (const error of signals?.errors ?? [])
        failures.push({ id: 'SHOT_PAGE_SIGNAL', message: `${page} signalled ${error}` });
      if (!signals?.ready && failures.length === 0) {
        const message = `${page} signalled neither window.__engine.ready nor an error within ${READY_TIMEOUT_MS} ms; publish __engine (PLAN.md §8.3)`;
        failures.push({ id: 'SHOT_NOT_READY', message, file });
      }
      const info = signals?.info ?? {};
      if (failures.length === 0 && info.backend !== undefined && info.backend !== 'WebGPU') {
        failures.push({
          id: 'SHOT_NOT_WEBGPU',
          message: `${page} reports backend ${String(info.backend)}, not WebGPU (PLAN.md §6.7)`,
        });
      }
      if (failures.length > 0 || !signals)
        return { ok: false, summary: `${page} did not draw`, target, browser: runtime, failures };

      const options = { ids: neither || values.ids === true || marks, metrics: neither || values.metrics === true };
      const { shot, noIds } = await shootPage(tab, signals, { ...options, marks, pixels: values.png === true, where });
      const warnings: Finding[] = [];
      if (noIds) (values.ids || marks ? failures : warnings).push({ id: 'SHOT_NO_ID_PASS', message: noIds });
      const verdict = judgeFrame(shot.notes ?? []);
      failures.push(...verdict.failures);
      // Loaded here, not at the top: these test modules join the program only when a shot runs.
      const { describeUnlisted, findUnlisted, loadAllowList } = await import('../../tests/setup/adviceTrap');
      for (const warning of findUnlisted(watch.console, loadAllowList()))
        warnings.push({ id: 'SHOT_CONSOLE', message: describeUnlisted([warning], ` in ${page}`) });
      warnings.push(...verdict.warnings);

      const metrics = shotMetrics(shot);
      const lines: string[] = [];
      if (shot.ids) {
        lines.push(
          listLine(
            'visible',
            shot.ids.visible.map((e) => `${e.name} ${(e.share * 100).toFixed(1)}%`),
          ),
        );
        const unseen = shot.ids.unseen.map((e) => `${e.name} (${e.reason})`);
        if (unseen.length) lines.push(listLine('unseen', unseen));
      }
      if (shot.marks)
        lines.push(
          listLine(
            'marks',
            shot.marks.map((mark) => `${mark.n} ${mark.name}`),
          ),
        );
      mkdirSync(join(root, out), { recursive: true });
      const artifacts: Artifact[] = [];
      const image = (name: string, base64: string | undefined, describes: string) => {
        if (base64 === undefined) return;
        writeFileSync(join(root, out, name), encodePng(shot.width, shot.height, Buffer.from(base64, 'base64')));
        artifacts.push({ path: `${out}/${name}`, kind: 'image', describes });
      };
      image('frame.png', shot.pixels, `${where}, as the frame draws it (WebGPU)`);
      image('marks.png', shot.marked, `${where}, each object the ID pass sees numbered (the legend: mark.<n>)`);
      if (thumb && shot.thumbnail) {
        const checked = await checkThumb(root, thumb, shot.thumbnail, values.update === true, where);
        lines.push(...checked.lines);
        Object.assign(metrics, checked.metrics);
        failures.push(...checked.failures);
      }
      const saved: Partial<ShotJson> = { ...shot };
      delete saved.pixels;
      delete saved.marked;
      writeFileSync(join(root, out, 'shot.json'), `${JSON.stringify({ page: where, ...saved }, null, 2)}\n`);
      const describes = 'the whole shot: the ID pass, the look metrics and notes, the thumbnail and its map, the marks';
      artifacts.push({ path: `${out}/shot.json`, kind: 'json', describes });
      const m = shot.metrics;
      const look = m ? `, coverage ${(m.coverage * 100).toFixed(1)}%, luma ${m.lumaP5}–${m.lumaP95}` : '';
      const seen = shot.ids ? `, ${shot.ids.visible.length} of ${shot.ids.objects} objects visible` : '';
      return {
        ok: failures.length === 0,
        summary: `${where}: ${shot.width}×${shot.height}${look}${seen}`,
        lines: [...lines, `files: ${artifacts.map((artifact) => artifact.path).join(', ')}`],
        target,
        browser: runtime,
        failures,
        warnings,
        metrics: {
          ...metrics,
          backend: String(info.backend ?? 'unreported'),
          three: String(info.three ?? 'unreported'),
        },
        artifacts,
      };
    } finally {
      await browser.close();
      await server.close();
    }
  },
} satisfies Command;
