/**
 * @file Every inspector member, headless (T1, PLAN.md §8.3, WP 2.7's Done-when: "every inspector member is tested in
 * the browser and headless, and help() matches the API"): one call per member `help()` lists, on the box room with
 * its view, each checked for what it gives headless; a member nobody wrote a call for fails the test, so a new member
 * arrives with its check. tests/e2e/box.spec.ts calls the same members in the page.
 * @see engine/app/viewMembers.ts
 * @see tests/e2e/box.spec.ts
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import '../../labs/box/scenes/room';
import { apiOf, helpNames } from '../../tools/lib/docsHelp';
import { registry } from '../core/registry';
import '../dev/members'; // declares the kind before the input members register
import '../input/devices/inspector';
import { defineLevel } from '../world/level/level';
import { createHeadless, type Headless } from './headless';

const ROOM = 'labs/box/levels/room.txt';
if (!registry.has('level', 'level:room')) defineLevel('level:room', { text: readFileSync(ROOM, 'utf8'), file: ROOM });

/** A member's call, by the name `help()` lists (`step()`, `errors`), and what it must give headless. */
type Call = (engine: Headless, call: (path: string, ...args: unknown[]) => unknown) => Promise<void> | void;

const REPLAY = readFileSync('tests/replays/box-1-room.replay.json', 'utf8');

/** Every member's headless check. */
const CALLS: Record<string, Call> = {
  advice: (e) => expect(Array.isArray(e.advice)).toBe(true),
  'camera.get()': (_e, call) => expect(call('camera.get')).toMatchObject({ code: 'cam=iso' }),
  'camera.set()': (_e, call) => expect(call('camera.set', 'cam=brawler')).toMatchObject({ code: 'cam=brawler' }),
  'capture()': (e) => {
    const capture = e.capture();
    e.step(5);
    e.restore(capture);
    expect(e.info().tick).toBe(0);
  },
  'describe()': (e) => expect(e.describe('setting', 'box.room.speed')).toMatchObject({ id: 'box.room.speed' }),
  'entities()': (e) => expect(e.entities('pathMover').map((entity) => entity.id)).toEqual([1, 2, 3]),
  errors: (e) => expect(e.errors).toEqual([]),
  'get()': (e) => expect(e.get(1)).toMatchObject({ id: 1, pathMover: { x: 3.5, z: 4.5 } }),
  'hash()': (e) => expect(e.hash()).toMatch(/^[0-9a-f]{16}$/),
  'help()': (e) => expect(e.help('scene.dump')).toContain('options'),
  'info()': (e) => expect(e.info()).toMatchObject({ scene: 'box:room', headless: true, runtime: 'node' }),
  'input.axis()': (_e, call) => expect(call('input.axis', 'move', [0, 1])).toMatchObject({ axes: { move: [0, 1] } }),
  'input.hold()': (_e, call) => expect(JSON.stringify(call('input.hold', 'jump'))).toContain('jump'),
  'input.play()': (_e, call) => expect(call('input.play', '3')).toEqual({ steps: 3, tick: 3 }),
  'input.press()': (_e, call) => expect(JSON.stringify(call('input.press', 'jump'))).toContain('jump'),
  'input.record()': (e, call) => {
    e.step(2);
    expect(call('input.record')).toMatchObject({ scene: 'box:room', steps: 2 });
  },
  'input.state()': (_e, call) => expect(call('input.state')).toBeTypeOf('object'),
  'pause()': (e) => {
    e.pause();
    expect(e.state().settings).toEqual({});
    e.resume();
  },
  ready: (e) => expect(e.ready).toBe(true),
  'render()': async (_e, call) => expect(() => call('render')).toThrow(/DEV_NO_RENDERER/),
  'replay()': async (_e, call) => {
    const run = (await call('replay', REPLAY)) as { hashes: Record<string, string> };
    expect(run.hashes).toEqual(JSON.parse(REPLAY).hashes['linux-x64']);
  },
  'restore()': (e) => expect(() => e.restore({} as never)).toThrow(/SIM_FOREIGN_CAPTURE/),
  'resume()': (e) => expect(e.resume()).toBeUndefined(),
  'scene.dump()': (_e, call) =>
    expect(call('scene.dump', { filter: 'pillar' })).toContain('level:room/pillar InstancedMesh'),
  'seed()': (e) => expect(e.seed(3)).toBe(3),
  'set()': (e) => expect(e.set('box.room.speed', '2')).toMatchObject({ value: 2, previous: 1.5, when: 'now' }),
  'shot()': (_e, call) => expect(() => call('shot')).toThrow(/DEV_NO_RENDERER/),
  'state()': (e) => expect(e.state('pathMover').entities).toHaveLength(3),
  'step()': (e) => expect(e.step(10)).toBe(10),
  'timeScale()': (e) => expect(e.timeScale(0.5)).toBe(0.5),
  'trace()': (e) => expect(e.trace().tick).toBe(0),
};

describe('every inspector member, headless', () => {
  it('has a check here, and help() lists exactly what the object has', async () => {
    const engine = await createHeadless({ scene: 'box:room', view: true });
    expect(helpNames(engine.help())).toEqual(apiOf(engine));
    expect(Object.keys(CALLS).sort()).toEqual(helpNames(engine.help()));
  });

  for (const [name, check] of Object.entries(CALLS)) {
    it(name, async () => {
      const engine = await createHeadless({ scene: 'box:room', view: true });
      const call = (path: string, ...args: unknown[]) => {
        const parts = path.split('.');
        const fn = parts.reduce<unknown>((at, part) => (at as Record<string, unknown>)[part], engine);
        return (fn as (...a: unknown[]) => unknown)(...args);
      };
      await check(engine, call);
    });
  }
});
