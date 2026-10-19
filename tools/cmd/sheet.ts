/**
 * @file Draws a body's state matrix as a contact sheet, plus its numeric checks (PLAN.md WP 6.6, §8.5): `node x sheet
 * <subject>` runs the humanoid through the states a QA id or prefix names, as the `anim` QA family does
 * (tools/qa/anim.ts `humanoidStates`), draws them with `anim.sheet()` (engine/anim/sheet.ts) from the cameras of a
 * `SHEET_CAMERAS` preset (engine/anim/stateMatrix.ts), and turns the SVG into a PNG in the platform's Chromium. It prints
 * the subject's `anim` QA violations against tests/baselines/qa-anim.json beside it (`humanoid`: every kind of the
 * humanoid's ids, `qaPrefixes`; the library's clips are `node x qa anim --only clip:`'s).
 *
 * Frames: one state (`move:slash`, `pose:kneel`, `reaction:fallBack`) gives `--frames` steps spread over its hold, then
 * the last step, back at rest, each labelled with its time; a prefix (`move:`, `pose:`, `state:`, and on a
 * `plantedStride` `--build` its movement states, `motion:`, WP 13.10) or `humanoid` (every state) gives one frame per
 * state: a move or a reaction halfway through, a held state at its last held step. The cameras are `--cams` (`move` for
 * moves, else `body`). Each camera frames every pose: `anim.sheet()` draws all the frames orthographically at one
 * scale, fitted to every point of every pose in every view (sheet.ts).
 *
 * Images on demand only (§8.5): the sheet is at most `MAX_WIDTH` pixels wide, and `--svg` writes the SVG alone,
 * without a browser. Files: out/sheet/<target>/sheet.svg and sheet.png; report.json has the sheet's hash, frames and
 * size. The blob and the floater have no humanoid skeleton to draw: `node x qa anim --only blob:` checks them.
 *
 * Usage: node x sheet <subject> [--build id] [--facing rad] [--cams body|move|turntable] [--frames n] [--svg].
 * Exit 1 when the subject has a new or worse `anim` QA violation or the browser fails, 2 for an unknown subject.
 *
 * @example
 * const { frames } = sheetFrames('move:slash', { build: 'build:heroic', facing: 0, count: 4 });
 * frames.length; // 5: four steps of the swing, then back at rest
 * @see tools/cmd/sheet.test.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHEET_CAMERAS, stateMatrix } from '../../engine/anim/stateMatrix';
import { animSheet, type Sheet, type SheetFrame, type SheetOptions } from '../../engine/anim/sheet';
import { createSkeleton } from '../../engine/anim/skeleton';
import { browserRuntime, launchBrowser } from '../lib/browser';
import { targetSlug, type Artifact } from '../lib/report';
import { HUMANOIDS, humanoidPrefixes, humanoidStates, makeHumanoid } from '../qa/anim';
import { closest, UsageError, type Command, type CommandResult } from '../x';
import { runQa } from './qa';

/** The widest sheet, pixels (§8.5: contact sheets are capped at 1,600 px). */
export const MAX_WIDTH = 1600;

/** What `sheetFrames` draws. */
export interface SheetFramesOptions {
  build: string;
  facing: number;
  /** Steps spread over one state's hold. */
  count: number;
}

/** The QA ids `subject` names on `build`: itself, or every id it prefixes (`humanoid`: all of them). */
export function subjectIds(subject: string, build?: string): string[] {
  const ids = Object.keys(humanoidStates(build));
  if (subject === 'humanoid') return ids;
  if (ids.includes(subject)) return [subject];
  return ids.filter((id) => id.startsWith(subject));
}

/** The `only` prefixes of `subject`'s `anim` QA: itself, or for `humanoid` its kinds (never the library's clips). */
export function qaPrefixes(subject: string): string[] {
  return subject === 'humanoid' ? humanoidPrefixes() : [subject];
}

/** The frames a sheet of `subject` draws, and whether they are moves (for the cameras). */
export function sheetFrames(subject: string, options: SheetFramesOptions): { frames: SheetFrame[]; moves: boolean } {
  const ids = subjectIds(subject, options.build);
  const all = humanoidStates(options.build);
  const body = HUMANOIDS.find((entry) => entry.build === options.build) ?? { build: options.build, weapon: 'sword' };
  const states = Object.fromEntries(ids.map((id) => [id, all[id]]));
  const runs = stateMatrix(makeHumanoid(body), { states, facings: [options.facing] });
  const moves = ids.every((id) => id.startsWith('move:'));
  if (runs.length === 1) {
    const [run] = runs;
    const [from, to] = run.held;
    const count = Math.max(1, Math.min(options.count, to - from));
    const steps = Array.from(
      { length: count },
      (_, i) => from + Math.round((i * (to - from - 1)) / Math.max(1, count - 1)),
    );
    const label = (step: number) => `${run.state} +${((step - from + 1) * run.dt).toFixed(2)} s`;
    const frames = [...steps, run.poses.length - 1].map((step) => ({ pose: run.poses[step], label: label(step) }));
    frames[frames.length - 1].label = `${run.state} at rest`;
    return { frames, moves };
  }
  const frames = runs.map((run) => {
    const step = all[run.state].script ? (run.held[0] + run.held[1]) >> 1 : run.held[1] - 1;
    return { pose: run.poses[step], label: run.state };
  });
  return { frames, moves };
}

/**
 * The sheet of `subject`: its frames (`sheetFrames`) drawn by `animSheet` from the cameras `cams` names (`move` for
 * moves, else `body`) on the skeleton of `build`, so a build's own proportions are what the sheet shows.
 */
export function sheetFor(
  subject: string,
  options: SheetFramesOptions & { cams?: keyof typeof SHEET_CAMERAS },
): { frames: SheetFrame[]; sheet: Sheet; drawn: SheetOptions } {
  const { build, facing } = options;
  const { frames, moves } = sheetFrames(subject, options);
  const views = SHEET_CAMERAS[options.cams ?? (moves ? 'move' : 'body')];
  const cell = 160;
  const columns = Math.max(1, Math.floor((MAX_WIDTH - 6) / (views.length * cell + 6)));
  const title = `${subject}: ${build}, facing ${facing} rad, ${views.join(' · ')}`;
  const drawn: SheetOptions = { views, cell, columns, title, skeleton: createSkeleton(build) };
  return { frames, sheet: animSheet(frames, drawn), drawn };
}

/** The PNG of `svg` (`width` × `height` pixels), drawn by the platform's Chromium; with the browser's runtime. */
async function rasterize(svg: string, width: number, height: number): Promise<{ png: Buffer; runtime: string }> {
  const browser = await launchBrowser();
  try {
    const tab = await browser.newPage({ viewport: { width, height } });
    await tab.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`);
    const png = await tab.screenshot({ clip: { x: 0, y: 0, width, height }, type: 'png' });
    return { png, runtime: browserRuntime(browser.version()) };
  } finally {
    await browser.close();
  }
}

export default {
  usage: 'sheet <subject> [--build id] [--facing rad] [--cams body|move|turntable] [--frames n] [--svg]',
  options: {
    build: { type: 'string' },
    facing: { type: 'string' },
    cams: { type: 'string' },
    frames: { type: 'string' },
    svg: { type: 'boolean' },
  },
  maxPositionals: 1,
  async run({ positionals, values, root }): Promise<CommandResult> {
    const [subject] = positionals;
    const build = (values.build as string | undefined) ?? HUMANOIDS[0].build;
    const ids = Object.keys(humanoidStates(build));
    if (!subject)
      throw new UsageError(`name a subject: a QA id such as move:slash, a prefix such as pose:, or humanoid`);
    if (subject.startsWith('blob:') || subject.startsWith('floater:')) {
      throw new UsageError(`${subject} has no humanoid skeleton to draw: run node x qa anim --only ${subject}`);
    }
    if (subjectIds(subject, build).length === 0) {
      const near = closest(subject, ids);
      throw new UsageError(`no state matches "${subject}"${near ? `: did you mean ${near}?` : ''} (try move:, pose:, state:, stance:, reaction:, motion: on a planted build, or humanoid)`); // prettier-ignore
    }
    const cams = (values.cams as string | undefined) ?? undefined;
    if (cams !== undefined && !Object.hasOwn(SHEET_CAMERAS, cams)) {
      const near = closest(cams, Object.keys(SHEET_CAMERAS));
      throw new UsageError(`no camera preset "${cams}"${near ? `: did you mean ${near}?` : ''} (presets: ${Object.keys(SHEET_CAMERAS).join(', ')})`); // prettier-ignore
    }
    const [facing, count] = [Number(values.facing ?? 0), Number(values.frames ?? 8)];
    if (!Number.isFinite(facing)) throw new UsageError(`--facing takes radians, not "${values.facing as string}"`);
    if (!Number.isInteger(count) || count < 1) throw new UsageError(`--frames takes a whole number above 0, not "${values.frames as string}"`); // prettier-ignore
    const asked = cams as keyof typeof SHEET_CAMERAS | undefined;
    const { frames, sheet, drawn } = sheetFor(subject, { build, facing, count, cams: asked });
    const views = drawn.views!;
    const target = targetSlug(subject);
    const dir = join(root, 'out', 'sheet', target);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'sheet.svg'), sheet.svg);
    const artifacts: Artifact[] = [
      { path: `out/sheet/${target}/sheet.svg`, kind: 'image', describes: `the SVG sheet of ${subject}` },
    ];
    let browser: string | undefined;
    if (!values.svg) {
      const { png, runtime } = await rasterize(sheet.svg, sheet.width, sheet.height);
      writeFileSync(join(dir, 'sheet.png'), png);
      artifacts.push({
        path: `out/sheet/${target}/sheet.png`,
        kind: 'image',
        describes: `the PNG sheet of ${subject}`,
      });
      browser = runtime;
    }
    const qa = await runQa(root, 'anim', qaPrefixes(subject));
    const lines = [
      `${frames.length} frames × ${views.length} cameras, ${sheet.width} × ${sheet.height} px, hash ${sheet.hash}`,
      `anim QA: ${qa.violations} violations, ${qa.accepted} accepted by tests/baselines/qa-anim*.json`,
    ];
    return {
      ok: qa.failures.length === 0,
      target,
      browser,
      summary: `${subject}: ${qa.failures.length ? `${qa.failures.length} new or worse anim QA violations` : 'drawn, within the anim QA baseline'}`, // prettier-ignore
      lines,
      failures: qa.failures,
      warnings: qa.warnings,
      metrics: {
        frames: frames.length,
        cameras: views.length,
        width: sheet.width,
        height: sheet.height,
        hash: sheet.hash,
      },
      artifacts,
    };
  },
} satisfies Command;
