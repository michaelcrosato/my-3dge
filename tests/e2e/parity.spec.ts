/**
 * @file The CPU-only gameplay contract (PLAN.md §6.7, §6.5 item 9, I-07; doctrine: WebGPU only), from Box 1 on: each
 * stage adds its scenes (`STAGES`: Box 1's room and its movers, Box 2's room with the hero, Box 3's hall with the hero
 * and the hall with its props, Box 4's hall with a crowd of 100, drawn through the crowd's level of detail, Box 5's
 * fight, its blows, bodies, telegraphs and bolts). In the
 * scene's own page (labs/box), rendering as it steps:
 * 1. every replay of the stage gives its golden hashes, a frame drawn after each step (`__engine.replay`, the same
 *    player as `x replay --browser page`), and so do its swept replays (`swept`: all of them, or for Box 4 the chase,
 *    its mixed crowd) while every camera preset and resolution mode is switched (the crowd's bands and culling too),
 *    and with `looks` (Box 3's hall with its props, the hero and the three parts a filter scopes; WP 7.8) up to the
 *    checkpoint after each of the engine's 86 looks is switched in turn, 5 steps each (the first in a material style joins the style
 *    set to the warm-up) and the effects off and on; the box's looks, under their torch-lit sky, whose point shadows
 *    make a frame several times dearer on SwiftShader, are tests/e2e/box-look.spec.ts's, with the same replay;
 * 2. live play recorded in the page (devices, a setting changed mid-run, the camera switched) replays in Node to the
 *    same hashes, so the renderer never wrote the sim;
 * 3. turning every optional GPU feature off never changes the hashes of its swept replays (all, or Box 4's hop);
 * 4. the gameplay entities in view appear in the ID pass;
 * 5. a second box scene, made and recorded as the scene template and the stress-box skill say (in a scratch copy of
 *    the repository, so this one's page never changes), gives its goldens through `x replay --browser page`, which
 *    opens the page on each replay's scene, and `?replay=<name>` alone starts the replay's scene.
 *
 * Invariants: goldens come from the replay files (one set per platform, recorded in Node and the sim-only page), so
 * these tests compare the rendering page with them, never with themselves. Each test opens its own page and shares
 * nothing, so they run in parallel: in order, on one worker, this file alone held T2 past its 6-minute budget. For the
 * same budget, the longest tests are queued first, so none starts late and ends T2 alone: test 5, then the stages
 * newest first (at G5, in file order, Box 4's began 4 minutes into T2 and ended it); and Box 4 sweeps each replay
 * once: each draws a crowd for 720–780 steps, both give their goldens drawn in test 1 and `x replay --browser page`,
 * and the chase, the costlier to draw (74 s in the page against the hop's 32 s at G5), is swept by test 2 alone.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import type { Page } from '@playwright/test';
import '../../labs/box/scenes/room';
import '../../labs/box/scenes/room-hero';
import '../../labs/box/scenes/hall';
import '../../labs/box/scenes/hall-props';
import '../../labs/box/scenes/crowd-100';
import '../../labs/box/scenes/fight';
import { playReplay, type Replay } from '../../engine/sim/replay';
import { CAMERA_3D, VIEW_NAMES } from '../../engine/gfx/cameras/codes';
import { FOLLOW_CAMERAS } from '../../engine/gfx/cameras/place';
import { RESOLUTION_MODES } from '../../engine/gfx/resolution';
import { expect, test, type Harness } from './fixtures';

test.describe.configure({ mode: 'parallel' });

const ROOT = join(import.meta.dirname, '..', '..');
/** A replay file's name and text. */
const replay = (name: string) => ({
  name,
  text: readFileSync(join(ROOT, `tests/replays/${name}.replay.json`), 'utf8'),
});

/** A box stage's scene and its replays, and live play to record in it (inside `evaluate`, ticking the virtual clock). */
interface Stage {
  stage: string;
  scene: string;
  /** The component its gameplay entities hold. */
  component: string;
  replays: { name: string; text: string }[];
  /** The replays, by name, the camera-switching and GPU-features-off tests play: all of `replays` when absent. */
  swept?: { cameras: string[]; featuresOff: string[] };
  /** Whether its replays are also played through each of the engine's looks (see the file comment). */
  looks?: boolean;
  /** Plays live in the page through the devices and `__engine`, from the first frame. */
  live: () => void;
}

/** The stages and what each proves the contract with. */
const STAGES: Stage[] = [
  {
    stage: 'Box 1',
    scene: 'room',
    component: 'pathMover',
    replays: ['box-1-room', 'box-1-tuned'].map(replay),
    live: () => {
      const tick = (frames: number) => window.__clock.tick(frames);
      tick(1); // the clock's origin
      __engine.input.axis('move', [0, 1]);
      tick(45);
      __engine.set('box.room.speed', '2.5');
      __engine.input.hold('jump');
      tick(30);
      __engine.camera.set('cam=topdown');
      __engine.input.hold('jump', false);
      __engine.input.axis('move', null);
      tick(50);
    },
  },
  {
    stage: 'Box 2',
    scene: 'room-hero',
    component: 'actor',
    replays: ['box-2-walk', 'box-2-dash', 'box-2-jump'].map(replay),
    live: () => {
      const tick = (frames: number) => window.__clock.tick(frames);
      tick(1);
      __engine.input.axis('move', [1, 0.3]);
      tick(30);
      __engine.input.press('dash');
      tick(20);
      __engine.camera.set('cam3=chase');
      __engine.input.axis('move', [0, 1]);
      tick(25);
      __engine.input.hold('jump');
      tick(15);
      __engine.camera.set('cam3=first');
      __engine.input.hold('jump', false);
      tick(20);
      __engine.input.axis('move', [-1, 0]);
      __engine.camera.set('cam=side');
      tick(30);
      __engine.input.axis('move', null);
      tick(20);
    },
  },
  {
    stage: 'Box 3',
    scene: 'hall',
    component: 'actor',
    replays: ['box-3-climb', 'box-3-dais'].map(replay),
    live: () => {
      const tick = (frames: number) => window.__clock.tick(frames);
      tick(1);
      __engine.input.axis('move', [-0.8, 0.6]);
      tick(40); // off the dais, down its slope
      __engine.camera.set('cam3=chase');
      __engine.input.press('dash');
      tick(20);
      __engine.input.axis('move', [0, -1]);
      __engine.input.hold('jump');
      tick(15);
      __engine.camera.set('cam3=first');
      __engine.input.hold('jump', false);
      tick(25);
      __engine.input.axis('move', [1, 0]);
      __engine.camera.set('cam=iso');
      tick(30);
      __engine.input.axis('move', null);
      tick(20);
    },
  },
  {
    stage: 'Box 3, props',
    scene: 'hall-props',
    component: 'actor',
    replays: ['box-3-knock'].map(replay),
    looks: true,
    live: () => {
      const tick = (frames: number) => window.__clock.tick(frames);
      tick(1);
      __engine.input.axis('move', [-1, 0]);
      tick(110); // off the dais, into the crate west of it, pushing it
      __engine.input.axis('move', null);
      __engine.camera.set('cam3=chase');
      tick(10);
      __engine.input.press('attack');
      tick(40);
      __engine.input.axis('move', [0.7, 0.7]);
      __engine.camera.set('cam3=first');
      tick(30);
      __engine.input.press('attack');
      __engine.input.axis('move', null);
      tick(30);
    },
  },
  {
    stage: 'Box 4',
    scene: 'crowd-100',
    component: 'actor',
    replays: ['box-4-chase', 'box-4-hop'].map(replay),
    swept: { cameras: ['box-4-chase'], featuresOff: ['box-4-hop'] },
    live: () => {
      const tick = (frames: number) => window.__clock.tick(frames);
      tick(1);
      __engine.input.axis('move', [-0.8, -0.6]);
      tick(50); // off the dais, the crowd entering round him
      __engine.camera.set('cam3=chase');
      tick(30);
      __engine.input.press('dash');
      __engine.camera.set('cam3=orbit');
      tick(20);
      __engine.input.axis('move', [1, 0]);
      __engine.camera.set('cam=topdown');
      tick(30);
      __engine.input.axis('move', null);
      tick(20);
    },
  },
  {
    stage: 'Box 5',
    scene: 'fight',
    component: 'actor',
    replays: ['box-5-fight'].map(replay),
    live: () => {
      const tick = (frames: number) => window.__clock.tick(frames);
      tick(1);
      __engine.input.axis('move', [0.8, 0.6]);
      tick(40); // off the dais, the fight joining round him
      __engine.input.press('attack');
      tick(12);
      __engine.input.press('attack');
      tick(12);
      __engine.camera.set('cam3=chase');
      __engine.input.press('attack');
      tick(25);
      __engine.input.press('skill');
      tick(15);
      __engine.input.press('dash');
      tick(4);
      __engine.input.press('attack');
      __engine.camera.set('cam3=orbit');
      tick(30);
      __engine.input.axis('move', null);
      tick(20);
    },
  },
];
const goldens = (text: string) => (JSON.parse(text) as Replay).hashes['linux-x64'];
/** Variables a test runner sets for its own workers; the `x` children start without them. */
const RUNNER_VARIABLE = /^(VITEST|TEST_WORKER_INDEX$|TEST_PARALLEL_INDEX$|PW_TS_ESM|PW_TEST_SOURCE_TRANSFORM)/;
/** What a scratch copy of the repository leaves out: it links node_modules' entries, and makes its own out/. */
const NOT_COPIED = new Set(['.git', '.cache', 'node_modules', 'out', 'dist', 'test-results', '.vercel']);
/**
 * The entries of node_modules a scratch copy does not link: Vite's caches. Vite's dependency hash includes the root,
 * so a shared node_modules/.vite would be re-optimized and swapped by every Vite the copy starts, under this
 * repository's servers.
 */
const OWN_CACHES = new Set(['.vite', '.vite-temp']);

/** Runs `node x <args>` in `root`; returns its exit code and printed text. */
function x(root: string, ...args: string[]) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !RUNNER_VARIABLE.test(key)));
  const run = spawnSync(process.execPath, ['x', ...args], { cwd: root, encoding: 'utf8', env, timeout: 180_000 });
  return { code: run.status, output: `${run.stdout}${run.stderr}` };
}

/**
 * A scratch copy of the repository (its own pages, scenes and replays), sharing the packages: its node_modules is a
 * directory of links to this one's entries, without Vite's caches (`OWN_CACHES`), which the copy writes for itself.
 * Remove it after.
 */
function scratchCopy(): string {
  const root = mkdtempSync(join(tmpdir(), 'parity-'));
  cpSync(ROOT, root, { recursive: true, filter: (path) => !NOT_COPIED.has(relative(ROOT, path).split(sep)[0]) });
  mkdirSync(join(root, 'node_modules'));
  for (const entry of readdirSync(join(ROOT, 'node_modules'))) {
    if (!OWN_CACHES.has(entry)) symlinkSync(join(ROOT, 'node_modules', entry), join(root, 'node_modules', entry));
  }
  return root;
}

/**
 * Every camera preset: each classic view in both projections, then each 3D camera (engine/gfx/cameras/codes.ts), then
 * the cameras that follow the hero (chase, first person, the depth rail; engine/gfx/cameras/place.ts).
 */
const CAMERA_PRESETS = [
  ...VIEW_NAMES.flatMap((view) => [`cam=${view}`, `cam=${view},persp`]),
  ...CAMERA_3D.map((type) => `cam3=${type}`),
  ...FOLLOW_CAMERAS.map((type) => `cam3=${type}`),
];

/** The page's engine, inside `evaluate`. */
declare const __engine: Record<string, (...args: unknown[]) => unknown> & {
  input: Record<string, (...a: unknown[]) => unknown>;
  camera: Record<string, (...a: unknown[]) => unknown>;
};

/** What `__engine.replay` resolves with. */
interface PlayResult {
  hashes: Record<string, string>;
  steps: number;
  frames: number;
}

/** Plays a replay's text in the page with `options`. */
function play(page: Page, text: string, options: object = {}): Promise<PlayResult> {
  return page.evaluate(([t, o]) => __engine.replay(t, o) as Promise<PlayResult>, [text, options] as const);
}

/** Each of the engine's looks in turn from step 10, 5 steps each, and the effects off and on: a stage's `looks`. */
function lookViews(page: Page): Promise<[number, { set: Record<string, unknown> }][]> {
  return page.evaluate(() => {
    const { ids } = __engine.describe('look') as { ids: string[] };
    const fields = (id: string) =>
      (__engine.describe('look', id) as { fields: { key: string; value: unknown }[] }).fields;
    const own = ids.filter((id) => fields(id).some(({ key, value }) => key === 'sky' && value === ''));
    const views = own.map((id, i): [number, { set: Record<string, unknown> }] => [
      10 + i * 5,
      { set: { 'post.look': id } },
    ]);
    return [...views, [200, { set: { 'gfx.effects': false } }], [260, { set: { 'gfx.effects': true } }]];
  });
}

/** Opens the box with `query`, ready on WebGPU. */
async function open(page: Page, harness: Harness, query = '?scene=room') {
  await page.goto(`labs/box/${query}`);
  await harness.ready({ timeout: 60_000 });
  await harness.assertWebGPU();
}

test.describe('the CPU-only gameplay contract, a new box scene', () => {
  test("a second box scene's replay gives its goldens in the page, which ?replay alone opens on that scene", async () => {
    test.setTimeout(300_000);
    const root = scratchCopy();
    try {
      const made = x(root, 'new', 'scene', 'labs/box/scenes/spinners');
      expect(made.code, made.output).toBe(0);
      const ran = x(root, 'sim', 'labs/box/scenes/spinners', '--steps', '600');
      expect(ran.code, ran.output).toBe(0);
      const file = 'tests/replays/box-1-spinners.replay.json';
      copyFileSync(join(root, 'out', 'sim', 'box-spinners', 'run.replay.json'), join(root, file));
      const recorded = x(root, 'replay', file, '--browser', 'sim', '--update');
      expect(recorded.code, recorded.output).toBe(0);
      // the room's replay after it: the page opens again on the room
      const both = [file, 'tests/replays/box-1-room.replay.json'];
      const played = x(root, 'replay', ...both, '--browser', 'page', '--runs', '1');
      expect(played.code, played.output).toBe(0);
      expect(played.output).toMatch(/box-1-spinners: 600 steps, .*Chromium page ×1, all match/);
      expect(played.output).toMatch(/box-1-room: 600 steps, .*Chromium page ×1, all match/);
      const shot = x(root, 'shot', 'labs/box/?replay=box-1-spinners');
      expect(shot.code, shot.output).toBe(0);
      const shotFile = join(root, 'out', 'shot', 'labs-box-replay-box-1-spinners', 'shot.json');
      const { ids } = JSON.parse(readFileSync(shotFile, 'utf8')) as { ids: { visible: { name: string }[] } };
      expect(ids.visible.map((object) => object.name)).toContain('spinnersCrate#1');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// The newest stage first (see the file comment).
for (const { stage, scene, component, replays, swept, looks, live } of [...STAGES].reverse()) {
  test.describe(`the CPU-only gameplay contract, ${stage}`, () => {
    test.setTimeout(240_000);
    const sweep = {
      cameras: swept?.cameras.map(replay) ?? replays,
      featuresOff: swept?.featuresOff.map(replay) ?? replays,
    };
    /** Annotates the running test with the replays it plays, so out/e2e/report.json says which replays T2 played. */
    const playing = (played: { name: string }[]) =>
      test.info().annotations.push({ type: 'replays', description: played.map(({ name }) => name).join(', ') });

    test('each replay gives its golden hashes while the scene renders as it steps', async ({ page, harness }) => {
      playing(replays);
      await open(page, harness, `?scene=${scene}`);
      for (const { name, text } of replays) {
        const run = await play(page, text);
        expect(run.hashes, name).toEqual(goldens(text));
        const { steps } = JSON.parse(text) as Replay;
        expect([run.steps, run.frames], name).toEqual([steps, steps]);
      }
    });

    test('switching every camera preset and resolution mode during a replay leaves its hashes unchanged', async ({
      page,
      harness,
    }) => {
      playing(sweep.cameras);
      await open(page, harness, `?scene=${scene}`);
      const views: [number, { cam?: string; set?: Record<string, unknown> }][] = [];
      const every = Math.floor(560 / CAMERA_PRESETS.length);
      CAMERA_PRESETS.forEach((cam, i) => views.push([10 + i * every, { cam }]));
      RESOLUTION_MODES.forEach((mode, i) => views.push([25 + i * 170, { set: { 'gfx.resolution': mode } }]));
      for (const { name, text } of sweep.cameras) {
        const run = await play(page, text, { views });
        expect(run.hashes, name).toEqual(goldens(text));
      }
      const advice = await page.evaluate(() => (__engine.advice as unknown as { code: string }[]).map((a) => a.code));
      expect(advice).not.toContain('GFX_COLD_PIPELINE');
    });

    if (looks) {
      test("switching each of the engine's looks during a replay leaves its hashes unchanged", async ({
        page,
        harness,
      }) => {
        playing(replays);
        await open(page, harness, `?scene=${scene}`);
        const views = await lookViews(page);
        const until = Math.ceil((Math.max(...views.map(([step]) => step)) + 10) / 60) * 60; // a checkpoint past the last
        for (const { name, text } of replays) {
          const run = await play(page, text, { views, until });
          const golden = Object.entries(goldens(text)).filter(([step]) => Number(step) <= until);
          expect(run.hashes, name).toEqual(Object.fromEntries(golden));
        }
        const advice = await page.evaluate(() => (__engine.advice as unknown as { code: string }[]).map((a) => a.code));
        expect(advice).not.toContain('GFX_COLD_PIPELINE');
      });
    }

    test('turning every optional GPU feature off never changes the hash', async ({ page, harness }) => {
      const off = encodeURIComponent(
        JSON.stringify(['feature:timestamps', 'feature:float32Filtering', 'feature:largeBuffers']),
      );
      playing(sweep.featuresOff);
      await open(page, harness, `?scene=${scene}&gfx.featuresOff=${off}`);
      const downgrades = await page.evaluate(() => (__engine.info() as { downgrades: string[] }).downgrades);
      expect(downgrades.length).toBeGreaterThan(0);
      for (const { name, text } of sweep.featuresOff) {
        expect((await play(page, text)).hashes, name).toEqual(goldens(text));
      }
      harness.advice(); // the downgrades' advice is the point of this test
    });

    test('live play recorded in the page replays in Node to the same hashes', async ({ page, harness }) => {
      await open(page, harness, `?scene=${scene}&cam=threequarter`);
      await page.evaluate(live);
      const recorded = await page.evaluate(() => ({
        replay: __engine.input.record() as Replay,
        hash: __engine.hash() as string,
      }));
      expect(recorded.replay.steps).toBeGreaterThanOrEqual(120); // a step a frame, give or take the clock's rounding
      expect(recorded.replay.scene).toBe(`box:${scene}`);
      expect(recorded.replay.inputs.some(([, change]) => Array.isArray(change.move))).toBe(true);
      if (scene === 'room') {
        expect(recorded.replay.inputs.some(([, change]) => change.set?.['box.room.speed'] === 2.5)).toBe(true);
      }
      const node = playReplay(recorded.replay);
      expect(node.hashes[String(recorded.replay.steps)]).toBe(recorded.hash);
    });

    test('the gameplay entities in view appear in the ID pass', async ({ page, harness }) => {
      await open(page, harness, `?scene=${scene}&cam=topdown`);
      await play(page, replays[0].text, { until: 300, draw: 0 });
      const seen = await page.evaluate(async (kind) => {
        await __engine.render(30); // a camera that follows the player settles on him: the hall is larger than a view
        const shot = (await __engine.shot({ ids: true, metrics: false, thumbnail: false })) as {
          ids: { visible: { entity?: number }[] };
        };
        const entities = (__engine.entities(kind) as { id: number }[]).map((e) => e.id);
        return { entities, visible: shot.ids.visible.flatMap((e) => (e.entity === undefined ? [] : [e.entity])) };
      }, component);
      expect(seen.entities.length).toBeGreaterThan(0);
      expect(seen.visible.sort()).toEqual(seen.entities);
    });
  });
}
