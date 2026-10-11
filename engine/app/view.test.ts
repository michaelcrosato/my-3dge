/**
 * @file Unit tests for engine/app/view.ts through `createHeadless({ view: true })` (T1, PLAN.md §8.3, WP 2.7): in
 * Node, the box room's view is built without a GPU: `scene.dump()` lists the floor, every wall run, the low wall, the
 * pillar and the three movers, which move as the sim steps; `render` and `shot` throw `DEV_NO_RENDERER`; cameras
 * switch by code and never change the hash; a restart reads the new run, and a restore or a dev action snaps the view
 * to the world (the dump and the next frame, at any alpha, show no place from before); an engine without a view refuses
 * `scene.dump` (`APP_NO_VIEW`), and one whose level is not registered refuses to start (`APP_NO_LEVEL`); `replay`
 * plays the box's replays to their goldens headless. WP 3.10: in the room with a hero, the hero is a puppet, the
 * cameras follow him, the chase camera stays inside the room, first person hides his body but the hands, and the
 * cutaway cuts the wall before a side view.
 * @see engine/app/view.ts
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROOM_PATHS } from '../../labs/box/scenes/room';
import '../../labs/box/scenes/room-hero';
import { JOINTS } from '../anim/skeleton';
import { poseTarget, type CameraPose } from '../gfx/cameras/pose';
import { createRegistry, registry } from '../core/registry';
import { defineScene } from '../sim/scene';
import { defineLevel } from '../world/level/level';
import { createHeadless, headlessHost } from './headless';
import type { AppHost } from './viewMembers';

const ROOM = 'labs/box/levels/room.txt';
if (!registry.has('level', 'level:room')) defineLevel('level:room', { text: readFileSync(ROOM, 'utf8'), file: ROOM });

type Dumps = { dump(options?: object): string };
type Cameras = { get(): { code: string; describe: string; yaw: number }; set(code: string): { code: string } };

describe('createHeadless({ view: true })', () => {
  it("dumps the room's scene graph: the floor, every wall run, the low wall, the pillar and the movers", async () => {
    const engine = await createHeadless({ scene: 'box:room', view: true });
    const dump = (engine.scene as Dumps).dump();
    for (const name of [
      'level:room/floor Mesh',
      'level:room/wall@0,0-15,0 InstancedMesh',
      'level:room/wall@0,1-0,11 InstancedMesh',
      'level:room/wall@15,1-15,11 InstancedMesh',
      'level:room/wall@1,11-14,11 InstancedMesh',
      'level:room/lowWall InstancedMesh',
      'level:room/pillar InstancedMesh',
      'stage/ground Mesh',
    ]) {
      expect(dump).toContain(name);
    }
    const movers = dump.split('\n').filter((line) => line.includes('pathMover#'));
    expect(movers).toEqual([
      '    pathMover#1 Mesh at 3.5,0,4.5 size 0.8×0.8×0.8 material:planks tris 12 entity 1',
      '    pathMover#2 Mesh at 6.5,0,7.5 size 0.8×0.8×0.8 material:planks tris 12 entity 2',
      '    pathMover#3 Mesh at 10.5,0,5.5 size 0.8×0.8×0.8 material:planks tris 12 entity 3',
    ]);
    expect(ROOM_PATHS).toHaveLength(3);
    engine.step(60);
    const moved = (engine.scene as Dumps).dump({ filter: 'pathMover#1' });
    expect(moved).toMatch(/pathMover#1 Mesh at 5,0,4\.5 /); // 1.5 m/s for 1 s along the line east
    expect((engine.scene as Dumps).dump({ depth: 1 }).split('\n')).toHaveLength(9); // the scene, sky, sun, its target, ground, level, stand-ins, actors, effects
  });

  it('throws no renderer for render and shot, and switches cameras without touching the hash', async () => {
    const engine = await createHeadless({ scene: 'box:room', view: true });
    await expect(Promise.resolve().then(() => (engine.render as () => unknown)())).rejects.toThrow(/DEV_NO_RENDERER/);
    expect(() => (engine.shot as () => unknown)()).toThrow(/DEV_NO_RENDERER/);
    const cameras = engine.camera as Cameras;
    expect(cameras.get()).toMatchObject({ code: 'cam=iso', describe: expect.stringContaining('Isometric') });
    const hash = engine.hash();
    for (const code of ['cam=topdown', 'cam=side', 'cam3=orbit', 'cam3=fly', 'cam=iso,45,2,persp']) {
      expect(cameras.set(code).code.split(',')[0]).toBe(code.split(',')[0]);
    }
    expect(engine.hash()).toBe(hash);
    expect(() => cameras.set('cam=nosuch')).toThrow(/GFX_UNKNOWN_CAMERA/);
    engine.step(30);
    const before = (engine.scene as Dumps).dump({ filter: 'pathMover' });
    expect(engine.seed(4)).toBe(4);
    expect((engine.scene as Dumps).dump({ filter: 'pathMover' })).not.toBe(before); // the new run, from step 0
    expect((engine.scene as Dumps).dump({ filter: 'pathMover#1' })).toContain('at 3.5,0,4.5');
  });

  it('snaps the view to the world after a restore or a dev action: the dump and every alpha of the next frame', async () => {
    const engine = await createHeadless({ scene: 'box:room', view: true });
    const { view } = headlessHost(engine) as AppHost;
    const mover = () => (engine.scene as Dumps).dump({ filter: 'pathMover#1' });
    const capture = engine.capture();
    engine.step(60);
    expect(mover()).toContain('at 5,0,4.5');
    engine.restore(capture);
    expect(engine.get(1)).toMatchObject({ pathMover: { x: 3.5, z: 4.5 } });
    expect(mover()).toContain('at 3.5,0,4.5');
    for (const alpha of [0, 0.5, 1]) {
      view!.frame({ alpha, dt: 0, aspect: 16 / 9 });
      expect(mover(), `alpha ${alpha}`).toContain('at 3.5,0,4.5'); // nothing between the old place and the restored one
    }
    engine.step(1);
    view!.frame({ alpha: 0, dt: 0, aspect: 16 / 9 });
    expect(mover()).toContain('at 3.5,0,4.5'); // the step after interpolates from the restored place

    if (!registry.has('scene', 'view:nudge')) {
      defineScene<{ pathMover: { x: number; z: number } }>('view:nudge', {
        setup: (w) => void w.spawn({ pathMover: { x: 1, z: 2 } }),
        actions: { nudge: (w, args) => void (w.get(1)!.pathMover!.x = (args as { x: number }).x) },
      });
    }
    const nudged = await createHeadless({ scene: 'view:nudge', view: true });
    headlessHost(nudged).session.act('nudge', { x: 4 });
    const dump = (nudged.scene as Dumps).dump({ filter: 'pathMover#1' });
    expect(dump).toContain('at 4,0,2');
    (headlessHost(nudged) as AppHost).view!.frame({ alpha: 0, dt: 0, aspect: 16 / 9 });
    expect((nudged.scene as Dumps).dump({ filter: 'pathMover#1' })).toBe(dump);
  });

  it('plays the box replays to their goldens headless, the view following', async () => {
    const engine = await createHeadless({ scene: 'box:room', view: true });
    for (const name of ['box-1-room', 'box-1-tuned']) {
      const text = readFileSync(`tests/replays/${name}.replay.json`, 'utf8');
      const run = (await (engine.replay as (t: string) => Promise<{ hashes: object; frames: number }>)(text)) ?? {};
      expect(run.hashes, name).toEqual(JSON.parse(text).hashes['linux-x64']);
      expect(run.frames).toBe(0);
    }
    expect(engine.info()).toMatchObject({ scene: 'box:room', seed: 7, tick: 600 });
  });

  it('refuses scene.dump without a view, and a view whose level is not registered', async () => {
    const plain = await createHeadless({ scene: 'box:room' });
    expect(() => (plain.scene as Dumps).dump()).toThrow(/APP_NO_VIEW.*createHeadless\(\{ scene, view: true \}\)/);
    expect(() => (plain.camera as Cameras).get()).toThrow(/APP_NO_VIEW/);
    const lonely = createRegistry();
    defineScene('lost', { level: 'level:nowhere', setup: () => {} }, lonely);
    await expect(createHeadless({ scene: 'lost', registry: lonely, view: true })).rejects.toThrow(
      /APP_NO_LEVEL.*defineLevel\('level:nowhere'/,
    );
  });

  it('draws the hero as a puppet and follows him: chase inside the room, first person without his body', async () => {
    const engine = await createHeadless({ scene: 'box:room-hero', view: true });
    type Info = { code: string; pose: CameraPose; culled?: string[] };
    const cameras = engine.camera as { get(): Info; set(code: string): Info };
    const start = poseTarget(cameras.get().pose); // the first follow snaps to him, not to the room's middle (8, 6)
    expect(start[0]).toBeCloseTo(3.5, 9);
    expect(start[2]).toBeCloseTo(2.5, 9);
    engine.step(40, { move: [1, 0] });
    const hero = engine.get(1)!.actor as { x: number; y: number; z: number };
    expect((engine.scene as Dumps).dump({ filter: 'actor#1' })).toMatch(/actor#1 SkinnedMesh .*entity 1/);
    const chase = cameras.set('cam3=chase,0,-20,5.5');
    expect(chase.culled).toBeUndefined();
    const [x, y, z] = chase.pose.position;
    expect(x > 1 && x < 15 && z > 1 && z < 11 && y > hero.y).toBe(true); // in front of the north wall, not in it
    const first = cameras.set('cam3=first');
    expect(first.culled).toEqual(JOINTS.filter((joint) => joint !== 'handL' && joint !== 'handR'));
    expect(Math.hypot(first.pose.position[0] - hero.x, first.pose.position[2] - hero.z)).toBeLessThan(0.5); // eyes ahead of the feet, leaning into the walk
    expect(first.pose.position[1] - hero.y).toBeGreaterThan(0.8); // at his eyes
    expect(cameras.set('cam=iso').culled).toBeUndefined();
    cameras.set('cam=side'); // from the south, level with him: the south wall cuts low so the view sees him
    expect((engine.scene as Dumps).dump({ filter: ':cut' })).toMatch(/wall@1,11-14,11:cut InstancedMesh .*×14/);
  });
});
