/**
 * @file Clip mode headless (PLAN.md WP 8.9; labs/box/scenes/clips.ts), with every set of the library registered as the
 * Node hosts register them (tools/anim/library.ts `defineLibrary`): the mannequin plays every clip of every set in the
 * box, at its first, middle and last frame, each pose finite with every bone at its length (the anim QA,
 * tools/qa/anim/clips.ts, holds the floor and reach, with its baseline); `node x anim show <set>/<clip>` and the
 * setting `box.clips.clip` select the same clip, and frame for frame the drawn mannequin (the view's puppets,
 * engine/gfx/puppets/actors.ts) stands as `x anim bake`'s bake of it, retargeted; frame stepping holds a frame; a
 * one-shot holds its end, then plays again; the hero walks under a clip laid over his upper body; two runs give one
 * hash; and its replay, tests/replays/box-8-clips.replay.json, gives its goldens in Node every run, and shows what it
 * says (a clip change, frame stepping, the hero walking under a one-shot laid over his upper body). Its goldens in
 * Chromium, drawn or not: `node x replay tests/replays/box-8-clips.replay.json --browser page` and
 * tests/e2e/parity.spec.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { animCheck } from '../../../engine/anim/check';
import { AnimatorPool, type AnimatorData } from '../../../engine/anim/character';
import { BAKE_FPS } from '../../../engine/anim/clip/bake';
import { clipSetId, ClipLayerPool, getClipSet, type ClipsData } from '../../../engine/anim/clip/clipsets';
import { clipText } from '../../../engine/anim/clip/lens';
import { retargetPose } from '../../../engine/anim/clip/retarget';
import { getBuild } from '../../../engine/anim/builds';
import { createWorldPose, forwardKinematics, socketPosition } from '../../../engine/anim/fk';
import { Pose } from '../../../engine/anim/pose';
import { createSkeleton, SOCKETS } from '../../../engine/anim/skeleton';
import { Vector3 } from '../../../engine/core/math';
import { createHeadless, headlessHost } from '../../../engine/app/headless';
import { createMaterialLibrary } from '../../../engine/gfx/materials/library';
import { createActorPuppets } from '../../../engine/gfx/puppets/actors';
import type { World } from '../../../engine/sim/world';
import { clipLayerOf } from '../../../engine/sim/actorClips';
import { defineLibrary, libraryDirs } from '../../../tools/anim/library';
import { bakeReport, resolveClip } from '../../../tools/anim/view';
import { dispatch, ROOT } from '../../../tools/x';
import { CLIPS_START } from './clips';

/** Every set directory of the library. */
const DIRS = libraryDirs();
/** One clip of each set, as x anim show names it: the library page's picks (tests/e2e/library.spec.ts). */
const PICKS = [
  'cmu/Cartwheel',
  'mesh2motion/Backflip',
  'quaternius/Sword_Attack',
  'style100/Old_Walk',
  'style100_back/Old_WalkBack',
  'style100_backrun/Old_RunBack',
  'style100_idle/Old_Idle',
  'style100_run/Old_Run',
  'style100_side/Old_SideLeft',
  'style100_siderun/Old_SideRunRight',
];

beforeAll(() => void defineLibrary());

/** The clips component of entity `id`. */
const clipsOf = (world: World, id: number) => (world.get(id) as unknown as { clips: ClipsData }).clips;
/** The clip on top of entity `id`. */
const topOf = (world: World, id: number) => clipsOf(world, id).state.slots.at(-1)!;

/** Clip mode started headless with `settings`, and its world. */
async function start(settings: Record<string, unknown> = {}) {
  const engine = await createHeadless({ scene: 'box:clips', settings });
  return { engine, world: headlessHost(engine).session.world as unknown as World };
}

/** What `x anim` printed between its summary and its report line, the whole output when the print was cut. */
function printed(lines: readonly string[]): string {
  const cut = /^… \d+ more in (\S+)$/.exec(lines.at(-2) ?? '');
  const all = cut ? readFileSync(join(ROOT, cut[1]), 'utf8').trimEnd().split('\n') : lines.slice(0, -1);
  return all.slice(1).join('\n');
}

/** Poses entity `id` as the view does: its animator, its clip layer in the clips slot (engine/gfx/puppets/actors.ts). */
function poser(world: World) {
  const [animators, layers] = [new AnimatorPool(), new ClipLayerPool()];
  return (id: number) => {
    const entity = world.get(id) as unknown as { actor: { x: number; y: number; z: number; yaw: number } };
    const data = (entity as unknown as { animator: AnimatorData }).animator;
    const animator = animators.get(id, data, { dt: world.dt });
    const layer = layers.get(id, clipsOf(world, id), animator.body.build, world.dt);
    if (animator.layer('clips') !== layer) animator.drop('clips').use('clips', layer);
    const { x, y, z, yaw } = entity.actor;
    return animator.pose({ at: new Vector3(x, y, z), yaw });
  };
}

describe('clip mode in the box, headless', () => {
  it('the mannequin plays every clip of every set: first, middle and last frame, each pose sound', async () => {
    const { engine, world } = await start({ 'box.clips.cast': 'mannequin' });
    const pose = poser(world);
    const problems: string[] = [];
    let played = 0;
    for (const dir of DIRS) {
      const { set, clips } = getClipSet(clipSetId(dir));
      for (const [name, clip] of Object.entries(clips)) {
        engine.set('box.clips.clip', `${dir}/${name}`);
        const last = Math.round(clip.dur * BAKE_FPS);
        for (const frame of [0, last >> 1, last]) {
          engine.set('box.clips.frame', frame);
          engine.step(1);
          const top = topOf(world, 1);
          expect([top.clip, top.w, top.t], `${dir}/${name}`).toEqual([`${set}/${name}`, 1, Math.min(frame / BAKE_FPS, clip.dur)]); // prettier-ignore
          const { body } = pose(1);
          const found = animCheck({ skeleton: body.skeleton, poses: [body.pose] }).problems;
          for (const p of found) if (p.check === 'finite' || p.check === 'length') problems.push(`${dir}/${name}: ${p.message}`); // prettier-ignore
        }
        played++;
      }
    }
    expect(problems).toEqual([]);
    expect(played).toBe(DIRS.reduce((n, dir) => n + Object.keys(getClipSet(clipSetId(dir)).clips).length, 0));
    expect(played).toBeGreaterThanOrEqual(1218);
  }, 120_000);

  it('x anim show <clip> and box.clips.clip select the same clip, and the drawn mannequin stands as its bake, frame for frame', async () => {
    const { engine, world } = await start({ 'box.clips.cast': 'mannequin', 'box.clips.ik': false });
    const actors = createActorPuppets({ materials: createMaterialLibrary() });
    const skeleton = createSkeleton(getBuild('build:mannequin'));
    const [want, world2, at, drawn, expected] = [new Pose(), createWorldPose(), new Vector3(), new Vector3(), new Vector3()]; // prettier-ignore
    for (const ref of PICKS) {
      const lines: string[] = [];
      expect(await dispatch(['anim', 'show', ref], { print: (line) => lines.push(line) }), ref).toBe(0);
      const shown = resolveClip(ref); // what x anim show printed
      engine.set('box.clips.clip', ref);
      engine.set('box.clips.frame', 0);
      engine.step(1);
      const [library, name] = clipLayerOf(world, 1).resolve(ref);
      expect(library.clip(name), ref).toEqual(shown.clip);
      expect(printed(lines), ref).toBe(clipText(library.clip(name)));
      const { baked } = bakeReport(shown); // x anim bake's
      let worst = 0;
      for (let frame = 0; frame < baked.frames; frame++) {
        engine.set('box.clips.frame', frame);
        engine.step(1);
        expect(topOf(world, 1).t, `${ref} frame ${frame}`).toBe(Math.min(frame / BAKE_FPS, shown.clip.dur));
        actors.capture(world.query('actor'), world.dt);
        actors.draw(1);
        retargetPose(baked, topOf(world, 1).t, skeleton, want, { ik: false, lift: false });
        const { x, y, z } = (world.get(1) as unknown as { actor: { x: number; y: number; z: number } }).actor;
        want.rootPos.add(at.set(x, y, z)); // the yaw is 0
        forwardKinematics(skeleton, want, world2);
        for (const socket of SOCKETS) {
          actors.puppets.get(1)!.socketPosition(socket, drawn);
          worst = Math.max(worst, drawn.distanceTo(socketPosition(skeleton, world2, socket, expected)));
        }
      }
      expect(worst, `${ref}: the drawn mannequin against x anim's bake, m`).toBeLessThan(1e-6);
    }
    expect(CLIPS_START).toEqual([3.5, 0, 2.5]);
  }, 120_000);

  it('takes a bare clip name only one set has, and refuses one two sets have, as x anim show does', async () => {
    const print = () => undefined;
    expect(await dispatch(['anim', 'show', 'Cartwheel'], { print })).toBe(0);
    const { engine, world } = await start({ 'box.clips.clip': 'Cartwheel' });
    engine.step(1);
    expect(topOf(world, 1).clip).toBe('CMU/Cartwheel');
    expect(await dispatch(['anim', 'show', 'Sword_Attack'], { print })).toBe(1);
    engine.set('box.clips.clip', 'Sword_Attack');
    expect(() => engine.step(1)).toThrow(
      /Sword_Attack is in mesh2motion and quaternius: name it as <set>\/Sword_Attack/,
    );
  });

  it('frame stepping holds a frame; a one-shot holds its end 0.8 s, then plays again', async () => {
    const { engine, world } = await start({ 'box.clips.clip': 'quaternius/Sword_Attack', 'box.clips.frame': 12 });
    engine.step(30);
    for (const id of [1, 2]) expect([topOf(world, id).t, topOf(world, id).w]).toEqual([12 / BAKE_FPS, 1]);
    engine.set('box.clips.frame', -1);
    engine.step(1);
    expect(topOf(world, 1).t).toBeCloseTo(12 / BAKE_FPS + world.dt, 9);
    const dur = getClipSet('clipset:quaternius').clips.Sword_Attack.dur;
    let ticks = 0;
    while (topOf(world, 1).t < dur) [ticks] = [ticks + 1, engine.step(1)];
    engine.step(Math.round(0.8 / world.dt) - 2);
    expect(topOf(world, 1).t).toBe(dur); // still holding its end
    engine.step(2);
    expect(topOf(world, 1).t).toBeLessThan(2 * world.dt); // and again from the start
    expect(ticks).toBeGreaterThan(0);
  });

  it('the hero walks under a clip laid over his upper body, which plays on', async () => {
    const { engine, world } = await start({ 'box.clips.clip': 'quaternius/Dance_Loop', 'box.clips.mask': 'upper' });
    engine.step(30, { move: [1, 0] });
    const { actor } = world.get(1) as unknown as { actor: { x: number } };
    expect(actor.x - CLIPS_START[0]).toBeGreaterThan(2);
    expect(topOf(world, 1)).toMatchObject({ clip: 'QUATERNIUS/Dance_Loop', w: 1, play: { mask: 'upper', walk: true } });
    const anim = engine.anim as (id?: number) => { layers: { slot: string; layers: Record<string, unknown>[] }[] };
    const clips = anim(1).layers.find((layer) => layer.slot === 'clips')?.layers[0];
    expect(clips).toMatchObject({
      name: 'clips',
      weight: 1,
      slots: [{ clip: 'QUATERNIUS/Dance_Loop', mask: 'upper' }],
    });
  });

  it('runs the same twice: one hash, the clips in it', async () => {
    const run = async () => {
      const { engine } = await start({ 'box.clips.clip': 'cmu/Cartwheel' });
      engine.step(40);
      engine.set('box.clips.clip', 'quaternius/Sword_Attack');
      engine.step(40);
      return engine.hash();
    };
    const [a, b] = [await run(), await run()];
    expect(a).toBe(b);
    const { engine } = await start({ 'box.clips.clip': 'cmu/Cartwheel' });
    engine.step(40);
    engine.set('box.clips.clip', 'quaternius/Dance_Loop');
    engine.step(40);
    expect(engine.hash()).not.toBe(a);
  });

  it('box-8-clips gives its goldens every run, and shows a clip change, a frame held and a walk under a one-shot', async () => {
    const text = readFileSync(join(ROOT, 'tests/replays/box-8-clips.replay.json'), 'utf8');
    const goldens = (JSON.parse(text) as { hashes: Record<string, object> }).hashes[`${process.platform}-${process.arch}`]; // prettier-ignore
    const play = async (until?: number) => {
      const { engine } = await start();
      const replay = engine.replay as (text: string, options: { until?: number }) => Promise<{ hashes: object }>;
      const { hashes } = await replay(text, { until });
      return { hashes, world: headlessHost(engine).session.world as unknown as World }; // the replay's own session
    };
    for (const run of [await play(), await play()]) expect(run.hashes).toEqual(goldens);
    const changed = await play(70); // 10 steps into the crossfade from the dance to the cartwheel
    expect(clipsOf(changed.world, 1).state.slots.map((slot) => slot.clip)).toEqual(['QUATERNIUS/Dance_Loop', 'CMU/Cartwheel']); // prettier-ignore
    for (const [until, t] of [
      [179, 30],
      [209, 31],
    ]) {
      const { world } = await play(until); // frame 30 held for 30 steps, then 31
      for (const id of [1, 2]) expect(topOf(world, id).t).toBe(t / BAKE_FPS);
    }
    const walked = await play(390); // south, east, north and west, under the one-shot, which ended and holds
    const { actor } = walked.world.get(1) as unknown as { actor: { x: number; z: number } };
    expect(Math.hypot(actor.x - CLIPS_START[0], actor.z - CLIPS_START[2])).toBeGreaterThan(3);
    expect(topOf(walked.world, 1)).toMatchObject({ clip: 'QUATERNIUS/Sword_Attack', play: { mask: 'upper' } });
    const again = await play(420); // it held its end 0.8 s, then played again
    expect(topOf(again.world, 1).t).toBeLessThan(0.5);
  });
});
