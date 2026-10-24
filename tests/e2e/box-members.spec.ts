/**
 * @file T2 for the Stress Box's inspector (PLAN.md WP 1.6, WP 2.7): on the box page's room, every inspector member
 * works in the page and `help()` matches the object: each member called once, its answer checked, and the members
 * checked are exactly the ones `help()` lists. Split from tests/e2e/box.spec.ts at its line cap (WP 13.18).
 *
 * Invariants: the page is driven only through `window.__engine` and the virtual clock (tools/lib/browser.ts), as an
 * agent drives it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test, type Harness } from './fixtures';

const ROOT = join(import.meta.dirname, '..', '..');
const REPLAY = readFileSync(join(ROOT, 'tests/replays/box-1-room.replay.json'), 'utf8');
const GOLDEN = (JSON.parse(REPLAY) as { hashes: Record<string, Record<string, string>> }).hashes['linux-x64'];

/** The page's engine, inside `evaluate`. */
declare const __engine: Record<string, unknown> & { [name: string]: (...args: unknown[]) => unknown };

/** Opens the box with `query` and waits for ready on WebGPU. */
async function open(page: Page, harness: Harness, query = '') {
  await page.goto(`labs/box/${query}`);
  await harness.ready({ timeout: 60_000 });
  await harness.assertWebGPU();
}

test.describe('the box’s inspector', () => {
  test('every inspector member works in the page, and help() matches the object', async ({ page, harness }) => {
    await open(page, harness, '?scene=room');
    const api = await page.evaluate(() => {
      const walk = (object: object, prefix = ''): string[] =>
        Object.entries(Object.getOwnPropertyDescriptors(object)).flatMap(([key, d]) => {
          if (d.get) return [prefix + key];
          if (typeof d.value === 'function') return [`${prefix}${key}()`];
          if (d.value && typeof d.value === 'object') return walk(d.value as object, `${prefix}${key}.`);
          return [prefix + key];
        });
      const listed = (__engine.help() as string).split('\n').map((line) => {
        const match = /^([^\s(]+)(\()?/.exec(line)!;
        return `${match[1]}${match[2] ? '()' : ''}`;
      });
      return { own: walk(__engine).sort(), listed: listed.sort() };
    });
    expect(api.own).toEqual(api.listed);
    const results = await page.evaluate(async (replay) => {
      const e = __engine as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      const out: Record<string, unknown> = {};
      out.ready = e.ready;
      out.errors = e.errors;
      out.advice = Array.isArray(e.advice);
      out.info = e.info().scene;
      out.describe = e.describe('setting', 'box.room.speed').id;
      out.help = e.help('replay').startsWith('replay(text');
      out['camera.get'] = e.camera.get().code;
      out['camera.set'] = e.camera.set('cam=topdown').code;
      out['camera.advance'] = e.camera.advance(2).code;
      out['scene.dump'] = e.scene.dump({ filter: 'pillar' }).includes('level:room/pillar InstancedMesh');
      out['fx.stats'] = Object.keys(e.fx.stats()).sort();
      out.pause = e.pause();
      out.resume = e.resume();
      out.timeScale = e.timeScale(1);
      out.step = e.step(10);
      out.entities = e.entities('pathMover').length;
      out.get = e.get(1).pathMover.path;
      out.hash = /^[0-9a-f]{16}$/.test(e.hash());
      out.trace = e.trace().tick;
      out.state = e.state('pathMover').entities.length;
      out.set = e.set('box.room.speed', '2').value;
      const capture = e.capture();
      out.capture = capture.nextId;
      const at = e.scene.dump({ filter: 'pathMover#1' });
      e.step(5);
      const moved = e.scene.dump({ filter: 'pathMover#1' }) !== at;
      e.restore(capture);
      out.restore = { tick: e.info().tick, moved, view: e.scene.dump({ filter: 'pathMover#1' }) === at };
      out['input.press'] = JSON.stringify(e.input.press('jump')).includes('jump');
      out['input.hold'] = JSON.stringify(e.input.hold('jump', false)).includes('held');
      out['input.axis'] = e.input.axis('move', [0, 1]).axes.move;
      out['input.play'] = e.input.play('2').steps;
      out['input.state'] = typeof e.input.state();
      out['input.record'] = e.input.record().steps;
      for (const member of ['feel', 'anim']) {
        try {
          out[member] = e[member](); // the room has no actor
        } catch (error) {
          out[member] = (error as Error).message;
        }
      }
      out['actions.list'] = e.actions.list().map((row: { name: string }) => row.name).join(); // prettier-ignore
      out['actions.run'] = e.actions.run('timeScale', { scale: 1 }).name;
      out.bot = await Promise.resolve(() => e.bot({ to: [{ x: 1.5, z: 1.5 }] })).then((bot) => bot()).catch((error: Error) => error.message.split(':')[0]); // prettier-ignore
      out['gallery.list'] = e.gallery.list().some((row: { kind: string }) => row.kind === 'prop');
      out['gallery.frames'] = e.gallery.frames('prop', 'prop:crate').length; // its turntable's four
      out['gallery.shoot'] = await Promise.resolve().then(() => e.gallery.shoot('prop', 'prop:crate')).catch((error: Error) => error.message.split(':')[0]); // prettier-ignore
      out.eye = await Promise.resolve()
        .then(() => e.eye())
        .catch((error: Error) => error.message.split(':')[0]); // the room has no physics
      out['tune.settings'] = e.tune.settings().some((row: { path: string }) => row.path === 'movement.gaits.sprint');
      out['tune.profile'] = e.tune.profile().startsWith('defineMovement("movement:playtest", {');
      out.render = (await e.render(1)).drawn;
      const stats = e.stats(); // the virtual clock holds time, so only the counts are checked here
      out.stats = { frames: stats.frames > 0, drawCalls: stats.drawCalls > 0, after: stats.pipelinesAfterWarmUp };
      out.shot = (await e.shot({ ids: true, metrics: false, thumbnail: false })).ids.objects;
      out.replay = (await e.replay(replay, { draw: 0 })).hashes['600'];
      out.seed = e.seed(9);
      return out;
    }, REPLAY);
    expect(results).toEqual({
      ready: true,
      errors: [],
      advice: true,
      info: 'box:room',
      describe: 'box.room.speed',
      help: true,
      'camera.get': 'cam=iso',
      'camera.set': 'cam=topdown',
      'camera.advance': 'cam=topdown',
      'scene.dump': true,
      'fx.stats': ['decals', 'drawCalls', 'events', 'gpuParticles', 'particles', 'ribbons', 'skipped', 'sprites'],
      pause: undefined,
      resume: undefined,
      timeScale: 1,
      step: 10,
      entities: 3,
      get: 0,
      hash: true,
      trace: 10,
      state: 3,
      set: 2,
      capture: 4,
      restore: { tick: 10, moved: true, view: true }, // the view follows the restore
      'input.press': true,
      'input.hold': true,
      'input.axis': [0, 1],
      'input.play': 2,
      'input.state': 'object',
      'input.record': 12,
      feel: '[SIM_BAD_ARGUMENT] feel(id) got undefined: pass an actor’s id (none)',
      anim: '[SIM_BAD_ARGUMENT] anim(id) got undefined: pass an animated actor’s id (none)',
      'actions.list': 'freeze,god,spawn,timeScale,travel', // the room has no dev action of its own
      'actions.run': 'timeScale',
      bot: '[SIM_NO_ACTOR] the bot has no actor to work on',
      'gallery.list': true,
      'gallery.frames': 4,
      'gallery.shoot': '[DEV_GALLERY_CLOSED] gallery.shoot films the gallery scene, but the page shows box', // box:room
      eye: '[SIM_BAD_ARGUMENT] __engine.eye() got a scene without physics',
      'tune.settings': true, // the feel panel's rows: every number of the shooter model, even with no actor on it
      'tune.profile': true,
      render: true,
      stats: { frames: true, drawCalls: true, after: 0 },
      // the room's 11 drawables, its effects' 7 (five sprite pages, the decals' page, the ribbons) and the shots' 2
      // (the tracers' page and the holes', engine/gfx/weapons.ts, WP 13.20)
      shot: 20,
      replay: GOLDEN['600'],
      seed: 9,
    });
    const members = api.listed.map((name) => name.replace('()', ''));
    expect(Object.keys(results).sort()).toEqual(members.sort());
  });
});
