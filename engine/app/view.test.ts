/**
 * @file Unit tests for engine/app/view.ts through `createHeadless({ view: true })` (T1, PLAN.md §8.3, WP 2.7): in
 * Node, the box room's view is built without a GPU: `scene.dump()` lists the floor, every wall run, the low wall, the
 * pillar and the three movers, which move as the sim steps; `render` and `shot` throw `DEV_NO_RENDERER`; cameras
 * switch by code and never change the hash; a restart reads the new run, and a restore or a dev action snaps the view
 * to the world (the dump and the next frame, at any alpha, show no place from before) while its effects play no event
 * twice (a restart's new world plays from its first); with the effects off, a flying bolt is a named stand-in from the
 * first step or frame after they are turned off, a frame with no step included, and theirs again from the first frame
 * after they are turned on; an engine without a view refuses
 * `scene.dump` (`APP_NO_VIEW`), and one whose level is not registered refuses to start (`APP_NO_LEVEL`); `replay`
 * plays the box's replays to their goldens headless. WP 3.10: in the room with a hero, the hero is a puppet, the
 * cameras follow him, the chase camera stays inside the room, first person hides his body but the hands, and the
 * cutaway cuts the wall before a side view. WP 7.8: a level entry's material swaps reach the stage's level meshes, and
 * the stage's sky, once shown, follows the frames: its pool's lights picked near the focus, flickering as they go.
 * WP 13.8: on the playground's shooter model first person stands at its eye height, a live switch blends (its first
 * frame the old camera's, halfway far from both) and a plain one cuts; the gym's rides are drawn (WP 13.7). WP 13.9:
 * the aim from the camera drawn last, the centre's ray past the player's own body and the pointer onto his floor.
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
import { defineComponent } from '../sim/state';
import { defineLevel } from '../world/level/level';
import { PROJECTILE, PROJECTILE_FIELDS } from '../world/projectiles';
import { GYM_TEXT } from '../../labs/playground/levels/gym';
import '../../labs/playground/bodies/player';
import '../../labs/playground/scenes/gym';
import { BLEND_TIME } from '../gfx/cameras/blend';
import { CAMERA_EYE } from '../gfx/cameras/effects';
import { FIRST_ARMS } from '../gfx/cameras/first';
import { SHOULDER } from '../gfx/cameras/shoulder';
import { createHeadless, headlessHost } from './headless';
import type { AppHost } from './viewMembers';

const ROOM = 'labs/box/levels/room.txt';
if (!registry.has('level', 'level:room')) defineLevel('level:room', { text: readFileSync(ROOM, 'utf8'), file: ROOM });

type Dumps = { dump(options?: object): string };
type Cameras = { get(): { code: string; describe: string; yaw: number }; set(code: string): { code: string } };

/** A view of `view:bolt`, one bolt flying at (1, 1, 1), and how it is drawn: by a stand-in, named, by the sprites. */
async function boltView() {
  if (!registry.has('component', 'viewBolt')) {
    defineComponent('viewBolt', { description: 'A bolt.', fields: PROJECTILE_FIELDS });
    defineScene('view:bolt', {
      setup: (w) => void w.spawn({ viewBolt: { ...PROJECTILE, state: 'flying', x: 1, y: 1, z: 1 } }),
    });
  }
  const engine = await createHeadless({ scene: 'view:bolt', view: true });
  const host = headlessHost(engine) as AppHost;
  const drawn = () => ({
    standIn: host.view!.stage.standIns.has(1),
    named: (engine.scene as Dumps).dump({ filter: 'viewBolt#1' }).includes('entity 1'),
    sprites: host.view!.stage.fx.effects.stats().sprites > 0,
  });
  return { engine, host, drawn };
}

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

  it("plays each event once across a restore or a dev action, and a restart's new world from its first", async () => {
    if (!registry.has('scene', 'view:sparks')) {
      defineScene('view:sparks', {
        setup: () => {},
        step: (w) => w.emit('hit', { position: [1, 1, 1] }), // one burst a step
        actions: { poke: () => {} },
      });
    }
    const engine = await createHeadless({ scene: 'view:sparks', view: true });
    const host = headlessHost(engine) as AppHost;
    const played = () => {
      host.view!.frame({ alpha: 1, dt: 1 / 60, aspect: 16 / 9 });
      return host.view!.stage.fx.effects.stats().events;
    };
    engine.step(5);
    expect(played()).toBe(5);
    const capture = engine.capture();
    engine.step(1);
    expect(played()).toBe(6);
    engine.restore(capture); // the same world: its trace (6 events) is history, read already
    expect(played()).toBe(6);
    engine.step(1);
    expect(played()).toBe(7); // the restored run's step plays its own event
    host.session.act('poke', {});
    expect(played()).toBe(7);
    engine.seed(3); // a new world, its events numbered from 1 again
    engine.step(2);
    expect(played()).toBe(9);
  });

  it('draws a flying bolt as its stand-in while the effects are off, from the step they are turned off', async () => {
    const { engine, host, drawn } = await boltView();
    expect(drawn()).toEqual({ standIn: false, named: false, sprites: true }); // the effects draw it
    host.session.set('gfx.effects', false);
    engine.step(1); // no frame yet: the sprites the last one drew stay until the next
    expect(drawn()).toMatchObject({ standIn: true, named: true }); // named, as the ID pass names it
    host.session.set('gfx.effects', true);
    engine.step(1);
    expect(host.view!.stage.standIns.has(1)).toBe(false);
  });

  it('hands a flying bolt over in the first frame after the effects are switched, with no step between', async () => {
    const { engine, host, drawn } = await boltView();
    // A paused page, a hit-stop or a shot: a frame with no step since the setting changed.
    const frame = () => host.view!.frame({ alpha: 0.5, dt: 1 / 60, aspect: 16 / 9 });
    engine.step(1);
    frame();
    expect(drawn()).toEqual({ standIn: false, named: false, sprites: true });
    host.session.set('gfx.effects', false);
    frame();
    expect(drawn()).toEqual({ standIn: true, named: true, sprites: false });
    engine.step(1);
    frame();
    expect(drawn()).toEqual({ standIn: true, named: true, sprites: false });
    host.session.set('gfx.effects', true);
    frame(); // on again: the effects draw it from this frame, and the next step keeps it theirs
    expect(drawn()).toEqual({ standIn: false, named: false, sprites: true });
    engine.step(1);
    expect(host.view!.stage.standIns.has(1)).toBe(false);
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

  it("draws the level with its entry's material swaps, and the stage's sky follows the frames", async () => {
    const HALL = 'labs/box/levels/hall.txt';
    if (!registry.has('level', 'level:viewHall')) {
      const swaps = { 'material:flagstone': 'material:planks' };
      defineLevel('level:viewHall', { text: readFileSync(HALL, 'utf8'), file: HALL, materials: swaps });
      defineScene('view:hall', { level: 'level:viewHall', setup: () => {} });
    }
    const engine = await createHeadless({ scene: 'view:hall', view: true });
    expect((engine.scene as Dumps).dump({ filter: 'level:viewHall/floor' })).toMatch(/floor Mesh .*material:planks /);
    expect((engine.scene as Dumps).dump({ filter: 'stairs' })).toMatch(/stairs.* material:stone /); // not swapped
    const view = (headlessHost(engine) as AppHost).view!;
    view.stage.sky.show('sky:hall');
    const slots = () => view.stage.sky.report().sky!.slots;
    view.frame({ alpha: 1, dt: 0.5, aspect: 16 / 9 });
    const first = slots();
    expect(first.every((slot) => slot.source >= 0 && slot.intensity > 0)).toBe(true); // 12 torches near the middle
    view.frame({ alpha: 1, dt: 0.25, aspect: 16 / 9 });
    expect(slots().map((slot) => slot.intensity)).not.toEqual(first.map((slot) => slot.intensity));
  });

  it('draws the hero as a puppet and follows him: chase inside the room, first person without his body', async () => {
    const engine = await createHeadless({ scene: 'box:room-hero', view: true });
    type Info = { code: string; pose: CameraPose; culled?: string[]; arms?: string[] };
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
    expect(first.culled).toEqual([...JOINTS]); // his body hidden from the camera, its shadow kept (WP 13.12)
    expect(first.arms).toEqual(FIRST_ARMS); // and his arms drawn against it
    expect(Math.hypot(first.pose.position[0] - hero.x, first.pose.position[2] - hero.z)).toBeLessThan(0.5); // eyes ahead of the feet, leaning into the walk
    expect(first.pose.position[1] - hero.y).toBeGreaterThan(0.8); // at his eyes
    expect(cameras.set('cam=iso').culled).toBeUndefined();
    cameras.set('cam=side'); // from the south, level with him: the south wall cuts low so the view sees him
    expect((engine.scene as Dumps).dump({ filter: ':cut' })).toMatch(/wall@1,11-14,11:cut InstancedMesh .*×14/);
  });

  it('stands first person at the shooter model’s eye height, and blends a live switch where a plain one cuts', async () => {
    if (!registry.has('level', 'level:gym')) defineLevel('level:gym', { text: GYM_TEXT, file: 'labs/playground/levels/gym.ts' }); // prettier-ignore
    const engine = await createHeadless({ scene: 'playground:gym', view: true, cam: 'cam3=first' });
    const view = (headlessHost(engine) as AppHost).view!;
    const frame = (dt: number) => view.frame({ alpha: 1, dt, aspect: 16 / 9 });
    engine.step(2);
    frame(1 / 60);
    const actor = engine.get(1)!.actor as { x: number; y: number; z: number };
    expect(view.cameraInfo().pose.position[1] - actor.y).toBeCloseTo(CAMERA_EYE.stand, 2); // not the body's eyes
    const before = view.cameraInfo().pose;
    const blended = view.setCamera('cam3=shoulder', { blend: true });
    expect(blended.code).toMatch(/^cam3=shoulder/);
    expect(blended.pose.position).toEqual(before.position); // the blend's first frame is the old camera's
    frame(BLEND_TIME / 2);
    const half = view.cameraInfo().pose.position;
    frame(BLEND_TIME);
    const end = view.cameraInfo().pose.position;
    expect(Math.hypot(...half.map((v, i) => v - before.position[i]))).toBeGreaterThan(0.5);
    expect(Math.hypot(...half.map((v, i) => v - end[i]))).toBeGreaterThan(0.5); // halfway: far from both ends
    const { pitch } = view.cameraInfo().pose; // first person's, kept
    expect(end[1] - actor.y).toBeCloseTo(CAMERA_EYE.stand + SHOULDER.up - SHOULDER.back * Math.sin(pitch), 1);
    expect(view.setCamera('cam=overhead').pose.pitch).toBeCloseTo(-Math.PI / 2, 9); // a plain set cuts
  });

  it('draws the gym’s rides: its ziplines, its ladder and its launchers, read with the entities it places', async () => {
    if (!registry.has('level', 'level:gym')) defineLevel('level:gym', { text: GYM_TEXT, file: 'labs/playground/levels/gym.ts' }); // prettier-ignore
    const engine = await createHeadless({ scene: 'playground:gym', view: true, cam: 'cam3=shoulder' });
    const view = (headlessHost(engine) as AppHost).view!;
    engine.step(1);
    const rides = ['zipline', 'ladder', 'launcher'].flatMap((kind) => engine.entities(kind) as { id: number }[]);
    expect(rides.length).toBeGreaterThan(3);
    const drawn = view.stage.rides.root.children.map((group) => group.name).sort();
    expect(drawn).toEqual(rides.map(({ id }) => drawn.find((name) => name.endsWith(`#${id}`))).sort());
    expect(drawn.every((name) => /^(zipline|ladder|launcher)#\d+$/.test(name))).toBe(true);
  });

  it('aims from the camera drawn last: the centre’s ray past the player’s own body, the pointer onto his floor', async () => {
    if (!registry.has('level', 'level:gym')) defineLevel('level:gym', { text: GYM_TEXT, file: 'labs/playground/levels/gym.ts' }); // prettier-ignore
    const engine = await createHeadless({ scene: 'playground:gym', view: true, cam: 'cam3=first' });
    const view = (headlessHost(engine) as AppHost).view!;
    const frame = () => view.frame({ alpha: 1, dt: 1 / 60, aspect: 16 / 9 });
    engine.step(2);
    frame();
    const actor = engine.get(1)!.actor as { x: number; y: number; z: number };
    const { position, yaw, pitch } = view.cameraInfo().pose;
    const forward = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
    const along = view.aim('centre')!.map((v, i) => v - position[i]);
    const reach = Math.hypot(...along);
    expect(reach).toBeGreaterThan(0.5); // never his own capsule, which the eye stands in
    along.forEach((v, i) => expect(v / reach).toBeCloseTo(forward[i], 6)); // straight along the view
    expect(view.aim('none')).toBeUndefined();
    view.setCamera('cam=overhead');
    frame();
    const top = view.cameraInfo().pose; // straight down, north (−Z) up the picture
    const half = top.frustumSize / 2 / top.zoom;
    const at = (pointer: [number, number]) => view.aim('pointer', { pointer })!;
    at([0, 0]).forEach((v, i) => expect(v).toBeCloseTo([top.position[0], actor.y, top.position[2]][i], 6)); // his floor
    at([0, 1]).forEach((v, i) => expect(v).toBeCloseTo([top.position[0], actor.y, top.position[2] - half][i], 6));
    expect(view.aim('pointer')).toBeUndefined(); // no pointer over the picture, no stick
  });
});
