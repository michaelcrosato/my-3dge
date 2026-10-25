/**
 * @file Tests for the clip layer (WP 8.4): fades and crossfades, stop and the cancel rules, no joint jumping in a
 * tick when a crossfade is stopped, cancelled or cut short, the `hold`, `next` and `landed` flags, events (a clip's
 * own, a lap's, an attack's hit at its strike time; none from a clip fading out, so a cancelled attack lands no hit),
 * root motion, masks and additive clips in the animator's pose and over another clip, a mirrored clip's hand
 * contacts, the walk–run switch on either side of both its lines with the walk and with the run playing, each change
 * at the drive that makes it (Done when), shardfall's three walkers played at their ground speed (Done when), save and
 * load, and the errors (a layer refuses an animator of another build). The play options: layer-play.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from '../../core/math';
import { Animator } from '../character';
import { createWorldPose, jointPosition } from '../fk';
import { Pose } from '../pose';
import { createSkeleton, jointIndex, JOINTS } from '../skeleton';
import { busy, REST, standing } from '../../../tests/unit/anim/clip-fixtures';
import { setOf } from '../../../tests/unit/anim/clip-parity';
import { CLIP_LAYER, ClipLayer, type ClipLayerEvent, type ClipStepInput } from './layer';
import { clipPace, GROUND_SPEED, loadClipLibrary } from './library';
import type { ClipKey } from './readable';
import { restSkeleton } from './rest';
import { hipRatio, retargetPose } from './retarget';

const raise = (t: number, up: number): ClipKey => ({ ...standing(t), armR: [20, 40, up, 10, 0] });
const reach = (t: number): ClipKey => ({ ...standing(t), armL: [100, -20, 0, 10, 0], armR: [100, 20, 0, 10, 0] });
const kneel = (t: number): ClipKey => ({ ...standing(t), hips: [0, 0, 60], legL: [60, 0, -40, 90, 0], legR: [60, 0, -40, 90, 0] }); // prettier-ignore
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
    Reach: { src: 'A', dur: 1, loop: true, keys: [reach(0), reach(1)] },
    Kneel: { src: 'A', dur: 1, loop: true, keys: [kneel(0), kneel(1)] },
    Touch: { src: 'A', dur: 1, contacts: [{ part: 'handL', from: 0, to: 1 }], keys: [busy(0), busy(1)] },
  },
});
const layerOf = () => new ClipLayer({ library, build: 'build:heroic' });
/** `n` ticks of `layer` with `input`, the events of all of them. */
function run(layer: ClipLayer, n: number, input: ClipStepInput = {}): ClipLayerEvent[] {
  const events: ClipLayerEvent[] = [];
  for (let i = 0; i < n; i++) events.push(...layer.step(input));
  return events;
}
/** A heroic animator posed with `layer`, standing still. */
const heroOf = (layer: ClipLayer) => new Animator({ build: 'build:heroic', clock: 0 }).use('clips', layer);
/**
 * `n` ticks of `layer` and `hero`, posed each tick: the most any joint turns in one tick, and from the first pose to
 * the last (radians).
 */
function turns(hero: Animator, layer: ClipLayer, n: number, input: (i: number) => ClipStepInput = () => ({})) {
  const first = hero.step().pose().body.pose.clone();
  const last = first.clone();
  const most = (a: Pose, b: Pose) => Math.max(...JOINTS.map((j) => a.getRotation(j).angleTo(b.getRotation(j))));
  let tick = 0;
  for (let i = 0; i < n; i++) {
    layer.step(input(i));
    tick = Math.max(tick, most(hero.step().pose().body.pose, last));
    last.copy(hero.body.pose);
  }
  return { tick, span: most(last, first) };
}

describe('play, stop and the crossfade', () => {
  it('fades a clip in over its fade, then poses the body as retargetPose does, where it stands', () => {
    const layer = layerOf();
    expect([layer.save(), layer.events, layer.current]).toEqual([{ slots: [], moving: null, running: false, ground: 0, root: [0, 0] }, [], null]); // prettier-ignore
    const hero = new Animator({ build: 'build:heroic', clock: 0 }).use('clips', layer);
    layer.play('Wave', { fade: 0.1 });
    run(layer, 3);
    expect(layer.current).toMatchObject({ clip: 'TEST/Wave', w: expect.closeTo(0.5, 9), t: expect.closeTo(0.05, 9) }); // prettier-ignore
    run(layer, 3);
    hero.body.position.set(2, 0, -1);
    hero.body.yaw = 0.5;
    hero.step().pose();
    const want = retargetPose(library.bake('Wave'), layer.current!.t, createSkeleton('build:heroic'));
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
    expect(layer.state.slots[0]).toMatchObject({ clip: 'TEST/Listen', w: 1, t: expect.closeTo(13 / 60, 9) });
    run(layer, 3);
    expect(layer.state.slots.map((s) => s.clip)).toEqual(['TEST/Wave']);
    layer.play('Wave', { speed: 2 });
    expect(layer.current).toMatchObject({ clip: 'TEST/Wave', t: expect.closeTo(0.1, 9), play: { speed: 2 } });
  });

  it('fades what a full-body clip covers out with it when it stops first, so no joint jumps in a tick', () => {
    // each mid-crossfade, then stopped, cancelled by an action, a one-shot ending before it is in, `locomote(null)`
    // during the walk–run crossfade; the most a joint may turn in a tick, as a share of all it turns
    const cases: [string, (layer: ClipLayer) => void, (i: number) => ClipStepInput, number][] = [
      ['stop', (l) => l.play('Reach', { fade: 0.3 }), () => ({}), 0.2],
      ['action', (l) => l.play('Reach', { fade: 0.3 }), (i) => ({ action: i === 0 }), 0.45],
      ['end', (l) => l.play('Nod', { fade: 0.5, out: 0.3 }), () => ({}), 0.2],
      ['locomote', (l) => run(l, 30, { groundSpeed: 1 }), () => ({}), 0.2],
    ];
    for (const [name, start, input, most] of cases) {
      const layer = name === 'locomote' ? layerOf().locomote({ walk: 'Walk', run: 'Run' }) : layerOf();
      const hero = heroOf(layer);
      if (name !== 'locomote') run(layer.play('Listen', { fade: 0 }), 1);
      start(layer);
      run(layer, 5, { groundSpeed: name === 'locomote' ? 5 : 0 });
      expect(layer.state.slots.length, name).toBe(2);
      if (name === 'stop') layer.stop(0.3);
      if (name === 'locomote') layer.locomote(null);
      const { tick, span } = turns(hero, layer, 40, input);
      expect(layer.state.slots, name).toEqual([]);
      expect(span, name).toBeGreaterThan(0.3); // from the clips' arms to the body's own
      expect(tick / span, name).toBeLessThan(most); // by the fades' steps (a clip dropped at once: about 0.98)
    }
  });

  it('stops over its out time, and the cancel rules: an action at once, moving or a flinch unless it walks', () => {
    const layer = layerOf();
    layer.play('Listen', { fade: 0, out: 0.1 }).stop();
    run(layer, 5);
    expect(layer.current?.w).toBeCloseTo(1 / 6, 9);
    run(layer, 1);
    expect(layer.current).toBeNull();
    layer.play('Listen', { fade: 0 });
    run(layer, 1, { action: true });
    expect(layer.current?.stopping).toBe(CLIP_LAYER.quick);
    for (const input of [{ groundSpeed: 1.3 }, { hurt: true }] as ClipStepInput[]) {
      layer.play('Wave', { fade: 0 });
      run(layer, 1, input);
      expect(layer.current?.stopping).toBe(CLIP_LAYER.out);
      layer.play('Listen', { fade: 0, walk: true });
      run(layer, 1, input);
      expect(layer.current?.stopping).toBe(0);
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
    expect([layer.current?.t, layer.current?.w, layer.down()]).toEqual([1, 1, true]);
    layer.play('Nod', { fade: 0, next: 'Listen' });
    expect(run(layer, 20)).toEqual([{ type: 'end', clip: 'TEST/Nod' }]);
    expect(layer.current?.clip).toBe('TEST/Listen');
    layer.play('Wave', { fade: 0 });
    expect(run(layer, 60).map((e) => e.type)).toEqual(['event', 'end']);
    expect(layer.current).toBeNull();
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
    for (let i = 0; i < 40 && at < 0; i++) if (layer.step().some((e) => e.type === 'hit')) at = layer.current!.t;
    expect(at - strike).toBeGreaterThan(0);
    expect(at - strike).toBeLessThanOrEqual(1 / 60 + 1e-9);
  });

  it('lands no hit from an attack cancelled or stopped before its strike, and no `landed` from a fall stopped early', () => {
    const before = Math.floor(library.strikeTime('Punch') * 60) - 3; // three ticks before the strike
    const cancels: [string, (layer: ClipLayer) => void, ClipStepInput][] = [
      ['plays on', () => {}, {}],
      ['a flinch', () => {}, { hurt: true }],
      ['an action', () => {}, { action: true }],
      ['moving', () => {}, { groundSpeed: 3 }],
      ['stop()', (layer) => layer.stop(), {}],
    ];
    const hits = cancels.map(([how, cancel, input]) => {
      const layer = layerOf().play('Punch', { fade: 0, attack: true });
      const events = run(layer, before);
      cancel(layer);
      events.push(...run(layer, 30, input));
      return [how, events.filter((e) => e.type === 'hit').length];
    });
    expect(hits).toEqual(cancels.map(([how], i) => [how, i === 0 ? 1 : 0]));
    for (const stopped of [false, true]) {
      const layer = layerOf().play('Fall', { fade: 0, hold: true, landed: 0.8 });
      const events = run(layer, 45);
      if (stopped) layer.stop();
      events.push(...run(layer, 60));
      expect(events.filter((e) => e.type === 'landed')).toHaveLength(stopped ? 0 : 1);
    }
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

describe('over another clip: masked and additive clips, a mirrored clip’s contacts', () => {
  it('keeps the full-body clip under an upper-body or additive one playing, during it and after it', () => {
    for (const play of [{ mask: 'upper' }, { additive: true }] as const) {
      const [layer, alone] = [layerOf(), layerOf()];
      const [hero, kneeling] = [heroOf(layer), heroOf(alone)];
      for (const l of [layer, alone]) run(l.play('Kneel', { fade: 0 }), 1);
      layer.play('Wave', { ...play, fade: 0.12 });
      for (let i = 0; i < 60; i++) {
        for (const l of [layer, alone]) l.step();
        const [a, b] = [hero.step().pose(), kneeling.step().pose()].map((h) => h.body.pose.getRotation('thighL'));
        const apart = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z, a.w - b.w); // `angleTo` reads 2e-4 for the same
        expect(apart, `${JSON.stringify(play)} at ${i}`).toBeLessThan(1e-6);
      }
      expect(layer.state.slots.map((s) => [s.clip, s.t])).toEqual([['TEST/Kneel', expect.closeTo(61 / 60, 9)]]);
    }
  });

  it('plays the loops under a wave that walks, and on after it, never from their start again', () => {
    const layer = layerOf().locomote({ walk: 'Walk', run: 'Run' });
    run(layer, 30, { groundSpeed: 1 });
    const walk = layer.current!;
    layer.play('Wave', { mask: 'upper', walk: true });
    run(layer, 30, { groundSpeed: 1 });
    expect(layer.state.slots.map((s) => s.clip)).toEqual(['TEST/Walk', 'TEST/Wave']);
    run(layer, 30, { groundSpeed: 1 });
    expect(layer.state.slots).toEqual([walk]);
    expect(walk.t).toBeCloseTo((90 / 60) * walk.rate, 9);
  });

  it('reaches with the hand a mirrored clip’s contact names, the other side', () => {
    const [layer, free] = [layerOf(), new ClipLayer({ library, build: 'build:heroic', ik: false })];
    const [hero, loose] = [heroOf(layer), heroOf(free)];
    for (const l of [layer, free]) run(l.play('Touch', { fade: 0, mirror: true }), 1);
    for (const h of [hero, loose]) h.step().pose();
    const source = createWorldPose();
    const mirrored = library.bake('Touch', true);
    expect(mirrored.contacts).toEqual([{ part: 'handR', from: 0, to: 1 }]);
    retargetPose(mirrored, 1 / 60, restSkeleton(REST), new Pose(), { world: source, ik: false, lift: false });
    const want = jointPosition(source, 'handR').multiplyScalar(hipRatio(mirrored, createSkeleton('build:heroic')));
    const [reached, loose_] = [hero, loose].map((h) => jointPosition(h.body.world, 'handR').sub(want));
    expect(Math.hypot(reached.x, reached.z)).toBeLessThan(1e-6);
    expect(Math.hypot(loose_.x, loose_.z)).toBeGreaterThan(0.005);
  });
});

describe('locomotion: idle, walk and run by ground speed', () => {
  it('switches the walk to the run just above √(w·r) × 1.15, and back just below × 0.87: one change each way', () => {
    const layer = layerOf().locomote({ idle: 'Idle', walk: 'Walk', run: 'Run' });
    const h = layer.hipHeight;
    const [w, r] = [clipPace(library.clip('Walk'), h)!, clipPace(library.clip('Run'), h)!];
    const [up, down, e] = [Math.sqrt(w * r) * 1.15, Math.sqrt(w * r) * 0.87, 1e-6];
    // each change, with the drive and the tick within it where it happened
    const changes: [string, number, string][] = [];
    let last = '';
    const drive = (label: string, speed: number, n = 30) => {
      for (let i = 0; i < n; i++) {
        layer.step({ groundSpeed: speed });
        expect(layer.state.running, `${label} at ${i}`).toBe(layer.current!.clip === 'TEST/Run');
        if (layer.current!.clip !== last) changes.push([label, i, (last = layer.current!.clip)]);
      }
    };
    drive('idle', 0.05);
    drive('walk at its pace', w);
    drive('walking, just below the line down', down - e); // both lines with the walk playing
    drive('walking, just above the line down', down + e);
    drive('walking, just below the line up', up - e);
    drive('walking, just above the line up', up + e); // the run
    drive('running, just above the line up', up + e); // both lines with the run playing
    drive('running, just below the line up', up - e);
    drive('running, just above the line down', down + e);
    drive('running, just below the line down', down - e); // the walk again
    drive('walking again, just above the line down', down + e);
    drive('walking again, just below the line up', up - e);
    expect(changes).toEqual([
      ['idle', 0, 'TEST/Idle'],
      ['walk at its pace', 0, 'TEST/Walk'],
      ['walking, just above the line up', 0, 'TEST/Run'],
      ['running, just below the line down', 0, 'TEST/Walk'],
    ]);
    expect(layer.current!.rate).toBeCloseTo((up - e) / w, 9);
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
      expect(layer.current?.clip).toBe(`STYLE100/${name}`);
      expect(Math.abs(ground / pace - 1)).toBeLessThan(0.3);
      expect(Math.abs(layer.current!.rate - ground / pace)).toBeLessThan(1e-3);
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
    expect(a.inspect()).toMatchObject({ slots: [{ clip: expect.stringMatching(/^TEST\//) }] });
  });
});

describe('errors', () => {
  it('refuses an unknown clip, mask or next when played, never in a step', () => {
    const layer = layerOf();
    expect(() => layer.play('Wav')).toThrow(/ANIM_UNKNOWN_CLIP.*"Wave"/s);
    expect(() => layer.play('TEST/Wav')).toThrow(/ANIM_UNKNOWN_CLIP.*"TEST\/Wave"/s);
    expect(() => layer.play('Wave', { mask: ['armz' as 'armL'] })).toThrow(/ANIM_UNKNOWN_JOINT/);
    expect(() => layer.play('Wave', { next: 'Nodd' })).toThrow(/ANIM_UNKNOWN_CLIP/);
    expect(layer.current).toBeNull();
    expect(layer.play('test/Nod').current?.clip).toBe('TEST/Nod'); // a set's name in any case
  });

  it('refuses to pose an animator of another build, whose paces and root motion it would measure wrong', () => {
    const chibi = new ClipLayer({ library }).play('Crawl'); // its build left out: build:chibi
    const hero = heroOf(chibi); // build:heroic
    expect(run(chibi, 3)).toEqual([]);
    expect(() => hero.pose()).toThrow(
      /ANIM_LAYER_BUILD.*on build:chibi.*plays build:heroic.*build: animator\.body\.build/s,
    );
    const layer = new ClipLayer({ library, build: hero.body.build }).play('Crawl');
    run(layer, 3);
    expect(() => heroOf(layer).pose()).not.toThrow();
    // what it fixes: chibi's root motion, short by the hip-height ratio
    expect(layer.state.root[1] / chibi.state.root[1]).toBeCloseTo(layer.hipHeight / chibi.hipHeight, 2);
  });
});
