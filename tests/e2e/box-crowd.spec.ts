/**
 * @file T2 for the Stress Box, stage 4 (PLAN.md §9.0, WP 5.7): the crowd (labs/box/?scene=crowd-100, crowd-5000) on
 * WebGPU. The chase replay, played in the page, gives its goldens and ends with walkers on the west gallery, 1 m up
 * (Done-when 1); the crowd draws through its batches (the ID pass sees the humanoids', the blobs' and the floaters'
 * parts and their shadows, and the dump no stand-in for a member); and the crowd at 5,000 grows, 25 entering a step,
 * with frames drawn at 25, 1,000, 2,500 and 5,000 members, building 0 pipelines after the warm-up (Done-when 3). The
 * CPU-only contract for the crowd (Done-when 4) is tests/e2e/parity.spec.ts: there the chase gives the same goldens
 * drawing a frame after every step through the crowd's level of detail, so the gallery's end state holds while it
 * renders, and this file plays it without drawing (T2's budget).
 *
 * Invariants: the page is driven through `window.__engine` and the virtual clock, as an agent drives it; goldens come
 * from the replay files, never from the page itself.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test, type Harness } from './fixtures';

const ROOT = join(import.meta.dirname, '..', '..');
const CHASE = readFileSync(join(ROOT, 'tests/replays/box-4-chase.replay.json'), 'utf8');
/** The west gallery's tiles (columns 3–22, rows 1–4 of labs/box/levels/hall.txt) and its floor's height (m). */
const GALLERY = { x: [3, 23], z: [1, 5], top: 1 };

/** The page's engine, inside `evaluate`. */
declare const __engine: Record<string, unknown> & { [name: string]: (...args: unknown[]) => unknown };

/** One object the ID pass sees. */
interface Seen {
  name: string;
  px: number;
}

/** A member's crowd agent, as the page reads it. */
interface Agent {
  state: string;
  x: number;
  y: number;
  z: number;
}

/** Calls the member `path` with `args` in the page; resolves with its result. */
function call<T = unknown>(page: Page, path: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ([name, rest]) => {
      const fn = name.split('.').reduce<unknown>((at, part) => (at as Record<string, unknown>)[part], __engine);
      return (fn as (...a: unknown[]) => unknown)(...rest) as T;
    },
    [path, args] as const,
  );
}

/** Every member's crowd agent, read in the page. */
function agents(page: Page): Promise<(Agent & { kind: string })[]> {
  return page.evaluate(() =>
    (__engine.entities('crowdMember') as { id: number }[]).map(({ id }) => {
      const e = __engine.get(id) as Record<string, unknown> & { crowdMember: Agent };
      return { ...e.crowdMember, kind: e.crowdWalker ? 'walker' : e.crowdSlime ? 'slime' : 'wisp' };
    }),
  );
}

/** The golden hashes of a replay's text. */
const goldensOf = (text: string) =>
  (JSON.parse(text) as { hashes: Record<string, Record<string, string>> }).hashes['linux-x64'];

/** Opens `scene` with `query`, ready on WebGPU. */
async function open(page: Page, harness: Harness, scene: string, query = '') {
  await page.goto(`labs/box/?scene=${scene}${query}`);
  await harness.ready({ timeout: 60_000 });
  await harness.assertWebGPU();
}

test.describe('the box, stage 4: the crowd', () => {
  test.setTimeout(420_000);

  test('the chase gives its goldens in the page, and walkers end on the west gallery', async ({ page, harness }) => {
    await open(page, harness, 'crowd-100');
    const run = await call<{ hashes: Record<string, string>; steps: number; frames: number }>(page, 'replay', CHASE, {
      draw: 0,
    });
    expect(run.hashes).toEqual(goldensOf(CHASE));
    expect([run.steps, run.frames]).toEqual([720, 0]);
    const up = (await agents(page)).filter(
      (a) =>
        a.kind === 'walker' &&
        Math.abs(a.y - GALLERY.top) < 0.02 &&
        a.x > GALLERY.x[0] &&
        a.x < GALLERY.x[1] &&
        a.z > GALLERY.z[0] &&
        a.z < GALLERY.z[1],
    );
    expect(up.length).toBeGreaterThanOrEqual(1);
    expect(harness.advice()).toEqual([]);
  });

  test('the crowd draws through its batches: humanoids, blobs and floaters with their shadows, no stand-in', async ({
    page,
    harness,
  }) => {
    await open(page, harness, 'crowd-100', '&cam=iso');
    await call(page, 'step', 240);
    await call(page, 'render', 5);
    const shot = await call<{ ids: { visible: Seen[] } }>(page, 'shot', {
      ids: true,
      metrics: false,
      thumbnail: false,
    });
    const px = (prefix: string) =>
      shot.ids.visible.filter((object) => object.name.startsWith(prefix)).reduce((sum, object) => sum + object.px, 0);
    for (const batch of [
      'crowd/puppets/',
      'crowd/rigs/ball/',
      'crowd/rigs/ball~material:puppetHalo/',
      'crowd/shadows/',
    ]) {
      expect(px(batch), batch).toBeGreaterThan(20);
    }
    const dump = await call<string>(page, 'scene.dump', {});
    expect(dump).not.toMatch(/crowdMember#/);
    expect(dump).toMatch(/crowd\/rigs\/ball\/page0 InstancedMesh/);
    expect(harness.advice()).toEqual([]);
  });

  test('the crowd grows to 5,000, 25 entering a step, and builds 0 pipelines after the warm-up', async ({
    page,
    harness,
  }) => {
    await open(page, harness, 'crowd-5000');
    const grown: [number, { drawn: boolean; built: number }, number | null][] = [];
    for (const steps of [1, 39, 60, 100]) {
      await call(page, 'step', steps);
      const frame = await call<{ drawn: boolean; built: number }>(page, 'render', 2);
      const alive = (await agents(page)).filter((a) => a.state === 'alive').length;
      const stats = await call<{ pipelinesAfterWarmUp: number | null }>(page, 'stats');
      grown.push([alive, frame, stats.pipelinesAfterWarmUp]);
    }
    expect(grown.map(([alive]) => alive)).toEqual([25, 1000, 2500, 5000]);
    for (const [alive, frame, after] of grown) {
      expect(frame, `${alive} in`).toMatchObject({ drawn: true, built: 0 });
      expect(after, `${alive} in`).toBe(0);
    }
    const advice = await page.evaluate(() => (__engine.advice as unknown as { code: string }[]).map((a) => a.code));
    expect(advice).not.toContain('GFX_COLD_PIPELINE');
    expect(harness.advice()).toEqual([]);
  });
});
