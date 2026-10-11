/**
 * @file Tests for the clip layer (WP 8.4): fades and crossfades, stop and the cancel rules, the `hold`, `next` and
 * `landed` flags, events (a clip's own, a lap's, an attack's hit at its strike time), root motion, masks and additive
 * clips in the animator's pose, the walk–run switch on either side of its lines (Done when), shardfall's three walkers
 * played at their ground speed (Done when), and save and load.
 */
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from '../../core/math';
import { Animator } from '../character';
import { Pose } from '../pose';
import { createSkeleton, jointIndex } from '../skeleton';
import { REST, standing } from '../../../tests/unit/anim/clip-fixtures';
import { setOf } from '../../../tests/unit/anim/clip-parity';
import { CLIP_LAYER, ClipLayer, type ClipLayerEvent, type ClipStepInput } from './layer';
import { clipPace, GROUND_SPEED, loadClipLibrary } from './library';
import type { ClipKey } from './readable';
import { hipRatio, retargetPose } from './retarget';

const raise = (t: number, up: number): ClipKey => ({ ...standing(t), armR: [20, 40, up, 10, 0] });
const library = loadClipLibrary({
  set: 'TEST',
  sources: { A: { rest: REST } },
  clips: {
    Wave: { src: 'A', dur: 0.5, keys: [raise(0, -100), raise(0.25, 100), raise(0.5, -100)], events: [{ t: 0.2, name: 'step', side: 'L' }] }, // prettier-ignore
    Fall: { src: 'A', dur: 1, keys: [standing(0), { ...standing(1), hips: [0, 0, 20] }] },
    Nod: { src: 'A', dur: 0.3, keys: [standing(0), standing(0.3)] },
    Listen: { src: 'A', dur: 1, loop: true, keys: [standing(0), standing(1)], events: [{ t: 0.5, name: 'blink' }] },
    Crawl: {
      src: 'A',
      dur: 1,
      keys: [
        { ...standing(0), root: [0, 0] },
        { ...standing(1), root: [100, -10] },
      ],
    },
    Punch: { src: 'A', dur: 0.6, keys: [raise(0, -100), { ...raise(0.3, 0), armR: [100, 10, 0, 0, 0] }, raise(0.6, -100)] }, // prettier-ignore
    Idle: { src: 'A', dur: 1, loop: true, keys: [standing(0), standing(1)] },
    Walk: { src: 'A', dur: 1, loop: true, speed: 140, keys: [standing(0), raise(0.5, -60), standing(1)] },
    Run: { src: 'A', dur: 0.6, loop: true, speed: 400, keys: [standing(0), raise(0.3, 0), standing(0.6)] },
  },
});
const layerOf = () => new ClipLayer({ library, build: 'build:heroic' });
/** `n` ticks of `layer` with `input`, the events of all of them. */
function run(layer: ClipLayer, n: number, input: ClipStepInput = {}): ClipLayerEvent[] {
  const events: ClipLayerEvent[] = [];
  for (let i = 0; i < n; i++) events.push(...layer.step(input));
  return events;
}

describe('play, stop and the crossfade', () => {
  it('fades a clip in over its fade, then poses the body as retargetPose does, where it stands', () => {
    const layer = layerOf();
    const hero = new Animator({ build: 'build:heroic', clock: 0 }).use('clips', layer);
    layer.play('Wave', { fade: 0.1 });
    run(layer, 3);
    expect(layer.state.current).toMatchObject({ clip: 'TEST/Wave', w: expect.closeTo(0.5, 9), t: expect.closeTo(0.05, 9) }); // prettier-ignore
    run(layer, 3);
    hero.body.position.set(2, 0, -1);
    hero.body.yaw = 0.5;
    hero.step().pose();
    const want = retargetPose(library.bake('Wave'), layer.state.current!.t, createSkeleton('build:heroic'));
    const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.5);
    want.rootPos.applyQuaternion(turn).add(new Vector3(2, 0, -1));
    want.rootRot.copy(turn);
    expect(hero.body.pose.equals(want)).toBe(true);
  });

  it('keeps the clip before under the new one until that is fully in; the same clip only takes the new play', () => {
    const layer = layerOf();
    layer.play('Listen', { fade: 0 });
    run(layer, 10);
    layer.play('Wave', { fade: 0.1 });
    run(layer, 3);
    expect(layer.state.previous).toMatchObject({ clip: 'TEST/Listen', w: 1, t: expect.closeTo(13 / 60, 9) });
    run(layer, 3);
    expect(layer.state.previous).toBeNull();
    layer.play('Wave', { speed: 2 });
    expect(layer.state.current).toMatchObject({ clip: 'TEST/Wave', t: expect.closeTo(0.1, 9), play: { speed: 2 } });
  });

  it('stops over its out time, and the cancel rules: an action at once, moving or a flinch unless it walks', () => {
    const layer = layerOf();
    layer.play('Listen', { fade: 0, out: 0.1 }).stop();
    run(layer, 5);
    expect(layer.state.current?.w).toBeCloseTo(1 / 6, 9);
    run(layer, 1);
    expect(layer.state.current).toBeNull();
    layer.play('Listen', { fade: 0 });
    run(layer, 1, { action: true });
    expect(layer.state.current?.stopping).toBe(CLIP_LAYER.quick);
    for (const input of [{ groundSpeed: 1.3 }, { hurt: true }] as ClipStepInput[]) {
      layer.play('Wave', { fade: 0 });
      run(layer, 1, input);
      expect(layer.state.current?.stopping).toBe(CLIP_LAYER.out);
      layer.play('Listen', { fade: 0, walk: true });
      run(layer, 1, input);
      expect(layer.state.current?.stopping).toBe(0);
    }
  });
});

describe('flags and events', () => {
  it('ends a one-shot once; `hold` keeps its last pose, `next` runs into the next clip, `landed` says it is down', () => {
    const layer = layerOf();
    layer.play('Fall', { fade: 0, hold: true, landed: 0.8 });
    const events = run(layer, 90);
    expect(events).toEqual([
      { type: 'landed', clip: 'TEST/Fall' },
      { type: 'end', clip: 'TEST/Fall' },
    ]);
    expect([layer.state.current?.t, layer.state.current?.w, layer.down()]).toEqual([1, 1, true]);
    layer.play('Nod', { fade: 0, next: 'Listen' });
    expect(run(layer, 20)).toEqual([{ type: 'end', clip: 'TEST/Nod' }]);
    expect(layer.state.current?.clip).toBe('TEST/Listen');
    layer.play('Wave', { fade: 0 });
    expect(run(layer, 60).map((e) => e.type)).toEqual(['event', 'end']);
    expect(layer.state.current).toBeNull();
  });

  it('fires a loop’s events on every lap, and an attack’s hit at its strike time', () => {
    const layer = layerOf();
    layer.play('Listen', { fade: 0 });
    expect(run(layer, 160)).toEqual([0, 1, 2].map(() => ({ type: 'event', clip: 'TEST/Listen', name: 'blink' })));
    layer.play('Wave', { fade: 0 });
    expect(run(layer, 13)).toEqual([{ type: 'event', clip: 'TEST/Wave', name: 'step', side: 'L' }]);
    layer.play('Nod', { fade: 0 }).play('Wave', { fade: 0, mirror: true });
    expect(run(layer, 13)).toEqual([{ type: 'event', clip: 'TEST/Wave', name: 'step', side: 'R' }]);
    layer.play('Punch', { fade: 0, attack: true });
    const strike = library.strikeTime('Punch');
    let at = -1;
    for (let i = 0; i < 40 && at < 0; i++) if (layer.step().some((e) => e.type === 'hit')) at = layer.state.current!.t;
    expect(at - strike).toBeGreaterThan(0);
    expect(at - strike).toBeLessThanOrEqual(1 / 60 + 1e-9);
  });

  it('reports the clip’s travel as root motion, at the layer’s build', () => {
    const layer = layerOf();
    layer.play('Crawl', { fade: 0 });
    let [x, z] = [0, 0];
    for (let i = 0; i < 70; i++) {
      layer.step();
      [x, z] = [x + layer.state.root[0], z + layer.state.root[1]];
    }
    const ratio = hipRatio(library.bake('Crawl'), createSkeleton('build:heroic'));
    expect(z).toBeCloseTo((REST.H0 / 1000) * ratio, 6); // float32 tracks: to a micron
    expect(x).toBeCloseTo((REST.H0 / 10_000) * ratio, 6); // 10% of the hip height to the left (+X)
  });
});

describe('in the animator: masks and additive clips', () => {
  it('an upper-body clip leaves the legs and the root to the body; an additive one adds its change', () => {
    const base = new Animator({ build: 'build:heroic', clock: 0 });
    base.step({ velocity: new Vector3(0, 0, 3) }).pose();
    const layer = layerOf();
    const hero = new Animator({ build: 'build:heroic', clock: 0 }).use('clips', layer);
    layer.play('Wave', { fade: 0, mask: 'upper' });
    layer.step();
    hero.step({ velocity: new Vector3(0, 0, 3) }).pose();
    const rotation = (a: Animator, joint: 'thighL' | 'chest' | 'upperArmR') => a.body.pose.getRotation(joint);
    expect(rotation(hero, 'thighL').equals(rotation(base, 'thighL'))).toBe(true);
    expect(hero.body.pose.rootPos.equals(base.body.pose.rootPos)).toBe(true);
    expect(rotation(hero, 'upperArmR').angleTo(rotation(base, 'upperArmR'))).toBeGreaterThan(0.1);
    const added = layerOf();
    const still = new Animator({ build: 'build:heroic', clock: 0 }).use('clips', added);
    added.play('Wave', { fade: 0, additive: true });
    added.step();
    still.step().pose();
    const plain = new Animator({ build: 'build:heroic', clock: 0 }).step().pose();
    expect(still.body.pose.getRotation('thighL').angleTo(plain.body.pose.getRotation('thighL'))).toBeLessThan(1e-6);
    expect(jointIndex('upperArmR')).toBeGreaterThan(0);
    expect(still.body.pose.equals(new Pose())).toBe(false);
  });
});

describe('locomotion: idle, walk and run by ground speed', () => {
  it('switches the walk to the run just above √(w·r) × 1.15, and back just below × 0.87: one change each way', () => {
    const layer = layerOf().locomote({ idle: 'Idle', walk: 'Walk', run: 'Run' });
    const h = layer.hipHeight;
    const [w, r] = [clipPace(library.clip('Walk'), h)!, clipPace(library.clip('Run'), h)!];
    const mid = Math.sqrt(w * r);
    const changes: string[] = [];
    let last = '';
    const drive = (speed: number, n = 30) => {
      for (let i = 0; i < n; i++) {
        layer.step({ groundSpeed: speed });
        if (layer.state.current!.clip !== last) changes.push((last = layer.state.current!.clip));
      }
    };
    drive(0.05);
    drive(mid * 1.15 - 1e-6); // just below the line up, walking
    drive(mid * 1.15 + 1e-6); // just above it: the run
    drive(mid * 0.87 + 1e-6); // running, just above the line down
    drive(mid * 0.87 - 1e-6); // just below it: the walk again
    expect(changes).toEqual(['TEST/Idle', 'TEST/Walk', 'TEST/Run', 'TEST/Walk']);
    expect(layer.state.current!.rate).toBeCloseTo((mid * 0.87 - 1e-6) / w, 9);
    expect(GROUND_SPEED.idle).toBe(0.1);
  });

  it('plays shardfall’s three walkers each at its ground speed over its own pace', () => {
    const style = loadClipLibrary(setOf('style100'));
    const paces: number[] = [];
    for (const name of ['Old_Walk', 'Zombie_Walk', 'Elated_Walk']) {
      const layer = new ClipLayer({ library: style, build: 'build:heroic' }).locomote({ walk: name });
      const pace = clipPace(style.clip(name), layer.hipHeight)!;
      const ground = pace * 1.1; // each moves near its style's own pace
      run(layer, 60, { groundSpeed: ground });
      expect(layer.state.current?.clip).toBe(`STYLE100/${name}`);
      expect(Math.abs(ground / pace - 1)).toBeLessThan(0.3);
      expect(Math.abs(layer.state.current!.rate - ground / pace)).toBeLessThan(1e-3);
      paces.push(pace);
    }
    expect(paces[0] * 5).toBeLessThan(paces[2]);
  });
});

describe('save and load', () => {
  it('is plain data that continues exactly, and posing never changes it', () => {
    const a = layerOf().locomote({ idle: 'Idle', walk: 'Walk', run: 'Run' });
    const hero = new Animator({ build: 'build:heroic', clock: 0 }).use('clips', a);
    const input = (i: number): ClipStepInput => ({ groundSpeed: (i % 90) / 20 });
    for (let i = 0; i < 100; i++) {
      a.step(input(i));
      hero.pose();
    }
    const b = layerOf().load(JSON.parse(JSON.stringify(a.save())));
    const c = layerOf().load(a.save());
    for (let i = 100; i < 200; i++) {
      expect(b.step(input(i))).toEqual(a.step(input(i)));
      c.step(input(i));
      hero.pose();
    }
    expect([b.save(), c.save()]).toEqual([a.save(), a.save()]);
    expect(a.inspect()).toMatchObject({ current: { clip: expect.stringMatching(/^TEST\//) } });
  });
});

describe('errors', () => {
  it('refuses an unknown clip, mask or next when played, never in a step', () => {
    const layer = layerOf();
    expect(() => layer.play('Wav')).toThrow(/ANIM_UNKNOWN_CLIP.*"Wave"/s);
    expect(() => layer.play('TEST/Wav')).toThrow(/ANIM_UNKNOWN_CLIP.*"TEST\/Wave"/s);
    expect(() => layer.play('Wave', { mask: ['armz' as 'armL'] })).toThrow(/ANIM_UNKNOWN_JOINT/);
    expect(() => layer.play('Wave', { next: 'Nodd' })).toThrow(/ANIM_UNKNOWN_CLIP/);
    expect(layer.state.current).toBeNull();
    expect(layer.play('test/Nod').state.current?.clip).toBe('TEST/Nod'); // a set's name in any case
  });
});
