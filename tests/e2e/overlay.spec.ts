/**
 * @file T2 for the HTML/CSS overlay (PLAN.md WP 6.5, I-50; doctrine: WebGPU only) in the overlay page
 * (tests/pages/overlay.html: the box room on WebGPU in an offset canvas, the overlay over it). The Done-when, in the
 * browser:
 * - a world-anchored label's centre matches its projection (three.js's `Vector3.project`) within 1 px, under seven
 *   cameras (orthographic and perspective, with and without a height boost, an orbit and a fly camera), and after
 *   the canvas is resized and moved;
 * - DOM queries find each damage number with its value, stacked one above another when hits come quickly;
 * - `ui.state()` gives the elements' text, boxes and visibility as the page lays them out;
 * - the overlay never changes the hash: the box-1 room replay, with labels, numbers and HUD lines following it every
 *   step and a frame drawn every 10 steps, gives its golden hashes.
 * And the damage numbers' CSS animation follows the overlay's clock: the pop, two blinks in the last quarter, gone
 * after 0.8 s.
 *
 * Invariants: the page draws only when a test calls it; goldens come from the replay file, never from this suite.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import type { Replay } from '../../engine/sim/replay';
import type { UiState } from '../../engine/ui/state';
import { expect, test } from './fixtures';

const ROOT = join(import.meta.dirname, '..', '..');
const ROOM = readFileSync(join(ROOT, 'tests/replays/box-1-room.replay.json'), 'utf8');

/** What the overlay page publishes (tests/pages/overlay.ts), as far as the tests use it. */
interface OverlayPage {
  ui: {
    label(text: string, options: { at: readonly number[]; id?: string }): { remove(): void; at: readonly number[] };
    damage(value: number | string, options: { at: readonly number[]; stack?: boolean }): void;
    hud(id: string, text: string | null, options?: { at?: string; keys?: boolean }): void;
    crosshair(on: boolean): void;
    state(): UiState;
  };
  frame(dt?: number): Promise<void>;
  camera(code: string): string;
  project(point: readonly number[]): [number, number];
  movers(): Record<string, number[]>;
  play(
    text: string,
    options?: { draw?: number; hits?: number },
  ): Promise<{ hashes: Record<string, string>; steps: number; numbers: number; labels: number; shownMost: number }>;
}

declare global {
  interface Window {
    __overlay: OverlayPage;
  }
}

/** Opens the overlay page and waits for its first frame. */
async function open(page: Page, harness: { ready(): Promise<void>; assertWebGPU(): Promise<unknown> }) {
  await page.goto('tests/pages/overlay.html');
  await harness.ready();
  await harness.assertWebGPU();
}

/** World points in and around the room (16 × 12 m), m. */
const POINTS = [
  [8, 0, 6],
  [3.5, 1, 4.5],
  [12, 2.5, 9],
  [1, 0.2, 10.5],
  [14.5, 3, 1.5],
];

/** The cameras the label test runs under: orthographic and perspective, with and without a height boost. */
const CAMERAS = [
  'cam=iso',
  'cam=topdown',
  'cam=threequarter',
  'cam=threequarter,persp',
  'cam=brawler,persp',
  'cam3=orbit,30,35,14,8,0,6',
  'cam3=fly,2,1.7,1,40,-10',
];

test.describe('the HTML/CSS overlay', () => {
  test("a world-anchored label's centre matches its projection within 1 px, under every camera and size", async ({
    page,
    harness,
  }) => {
    await open(page, harness);
    const worst = await page.evaluate(
      async ({ points, cameras }) => {
        const o = window.__overlay;
        const labels = points.map((at, i) => o.ui.label(`point ${i}`, { at, id: `p${i}` }));
        const errors: Record<string, number> = {};
        const measure = async (name: string) => {
          await o.frame(1 / 60);
          let most = 0;
          let seen = 0;
          for (let i = 0; i < points.length; i++) {
            const el = document.querySelector<HTMLElement>(`[data-ui=label][data-id=p${i}]`)!;
            if (el.hidden) continue;
            const r = el.getBoundingClientRect();
            const [x, y] = o.project(points[i]);
            most = Math.max(most, Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y));
            seen++;
          }
          errors[`${name} (${seen} seen)`] = most;
        };
        for (const code of cameras) {
          o.camera(code);
          await measure(code);
        }
        const canvas = document.querySelector('canvas')!;
        Object.assign(canvas.style, { left: '120px', top: '64px', width: '533px', height: '611px' });
        o.camera('cam=iso');
        await measure('cam=iso, resized and moved');
        for (const label of labels) label.remove();
        return errors;
      },
      { points: POINTS, cameras: CAMERAS },
    );
    expect(Object.keys(worst)).toHaveLength(CAMERAS.length + 1);
    for (const [name, error] of Object.entries(worst)) {
      expect(name).not.toContain('(0 seen)');
      expect(error, name).toBeLessThan(1);
    }
  });

  test('DOM queries find each damage number with its value; quick hits stack in a column', async ({
    page,
    harness,
  }) => {
    await open(page, harness);
    const movers = await page.evaluate(() => window.__overlay.movers());
    const ids = Object.keys(movers);
    expect(ids).toHaveLength(3);
    await page.evaluate(
      async ({ movers }) => {
        const o = window.__overlay;
        Object.values(movers).forEach((p, i) => o.ui.damage(10 + i, { at: [p[0], p[1] + 1, p[2]], stack: false }));
        for (const value of [5, 6, 7]) o.ui.damage(value, { at: [8, 1.5, 6] });
        await o.frame(0.05);
      },
      { movers },
    );
    for (const value of ['10', '11', '12', '5', '6', '7']) {
      const number = page.locator(`[data-ui=damage][data-value="${value}"]`);
      await expect(number).toHaveCount(1);
      await expect(number).toHaveText(value);
      await expect(number).toBeVisible();
    }
    const boxes = await Promise.all(
      ['5', '6', '7'].map(async (v) => (await page.locator(`[data-ui=damage][data-value="${v}"]`).boundingBox())!),
    );
    for (let i = 1; i < 3; i++) {
      expect(boxes[i - 1].y - boxes[i].y).toBeCloseTo(boxes[i].height, 1); // one number's height above the last
      expect(boxes[i].x + boxes[i].width / 2).toBeCloseTo(boxes[0].x + boxes[0].width / 2, 1); // in one column
    }
  });

  test('ui.state() gives text, boxes and visibility as the page lays them out', async ({ page, harness }) => {
    await open(page, harness);
    const state = await page.evaluate(async () => {
      const o = window.__overlay;
      o.camera('cam=iso');
      o.ui.label('Pillar', { at: [8, 1, 6], id: 'pillar' });
      o.ui.label('Behind', { at: [8, 1, -500], id: 'far' });
      o.ui.damage(42, { at: [8, 2, 6] });
      o.ui.hud('score', 'Score 120', { at: 'top-left' });
      o.ui.hud('note', 'The room', { at: 'top' });
      o.ui.hud('hint', 'Space: jump', { at: 'bottom-right', keys: true });
      o.ui.crosshair(true);
      await o.frame(1 / 60);
      return o.ui.state();
    });
    expect(state.size).toEqual([800, 450]);
    expect(state.touch).toBe(false);
    const byKind = (kind: string, id?: string) => state.elements.find((e) => e.kind === kind && (!id || e.id === id))!;
    for (const placed of [byKind('label', 'pillar'), byKind('damage'), byKind('crosshair')]) {
      expect(placed.visible).toBe(true);
      const [x, y, w, h] = placed.box!;
      expect(Math.hypot(x + w / 2 - placed.at![0], y + h / 2 - placed.at![1]), placed.kind).toBeLessThan(0.5);
    }
    expect(byKind('crosshair').at).toEqual([400, 225]);
    expect(byKind('label', 'far').visible).toBe(false);
    expect(byKind('damage')).toMatchObject({ value: '42', text: '42' });
    for (const id of ['score', 'note', 'hint']) {
      const line = byKind('hud', id);
      const [x, y, w, h] = line.box!;
      expect(line.visible).toBe(true);
      expect([x >= 0, y >= 0, x + w <= 800, y + h <= 450, w > 0, h > 0]).toEqual([true, true, true, true, true, true]);
    }
    const [score, note, hint] = ['score', 'note', 'hint'].map((id) => byKind('hud', id).box!);
    expect(score[0]).toBeLessThan(40); // top left
    expect(Math.abs(note[0] + note[2] / 2 - 400)).toBeLessThan(1); // top, centred
    expect([hint[0] + hint[2] > 760, hint[1] + hint[3] > 410]).toEqual([true, true]); // bottom right
    const overlay = await page.locator('.ui-overlay').boundingBox();
    expect(overlay).toEqual({ x: 37, y: 21, width: 800, height: 450 }); // over the canvas
  });

  test("damage numbers pop, blink twice in their last quarter and go, on the overlay's clock", async ({
    page,
    harness,
  }) => {
    await open(page, harness);
    const looks = await page.evaluate(async () => {
      const o = window.__overlay;
      o.ui.damage(9, { at: [8, 1.5, 6] });
      const looks: [number, string, string, boolean][] = [];
      let age = 0;
      for (const next of [0, 0.3, 0.62, 0.67, 0.72, 0.77, 0.81]) {
        await o.frame(next - age);
        age = next;
        const number = document.querySelector<HTMLElement>('[data-ui=damage]');
        const look = number ? getComputedStyle(number.firstElementChild!) : null;
        looks.push([next, look?.opacity ?? 'gone', look?.transform ?? 'gone', number !== null]);
      }
      return looks;
    });
    expect(looks).toEqual([
      [0, '1', 'matrix(1.45, 0, 0, 1.45, 0, 0)', true],
      [0.3, '1', 'matrix(1, 0, 0, 1, 0, 0)', true],
      [0.62, '0', 'matrix(1, 0, 0, 1, 0, 0)', true],
      [0.67, '1', 'matrix(1, 0, 0, 1, 0, 0)', true],
      [0.72, '0', 'matrix(1, 0, 0, 1, 0, 0)', true],
      [0.77, '1', 'matrix(1, 0, 0, 1, 0, 0)', true],
      [0.81, 'gone', 'gone', false],
    ]);
  });

  test('the overlay never changes the hash: the room replay gives its goldens with the overlay following it', async ({
    page,
    harness,
  }) => {
    test.setTimeout(240_000);
    await open(page, harness);
    const run = await page.evaluate((text) => window.__overlay.play(text, { draw: 10, hits: 15 }), ROOM);
    const replay = JSON.parse(ROOM) as Replay;
    expect(run.steps).toBe(replay.steps);
    expect(run.hashes).toEqual(replay.hashes['linux-x64']);
    expect([run.labels, run.numbers]).toEqual([3, 40]);
    expect(run.shownMost).toBeGreaterThanOrEqual(7); // three labels, a number, two HUD lines, the crosshair
  });
});
