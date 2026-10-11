/**
 * @file Tests for the clip library (WP 8.4): loading a set, names and their errors, sampling and travel, the cached
 * bakes and mirrors, edits and their restore, provenance, shardfall's ground-speed rules and the strike time.
 */
import { describe, expect, it } from 'vitest';
import { clipOf, REST, standing } from '../../../tests/unit/anim/clip-fixtures';
import { setOf } from '../../../tests/unit/anim/clip-parity';
import { clipText } from './lens';
import {
  clipPace,
  GROUND_SPEED,
  loadClipLibrary,
  runOverWalk,
  strikeTime,
  walkRate,
  type ClipLibrary,
} from './library';
import { samplePose, type ClipKey } from './readable';

const reach = (t: number, f: number): ClipKey => ({ ...standing(t), armR: [f, 20, -100 + f, 10, 0] });
const test = () =>
  loadClipLibrary({
    set: 'TEST',
    sources: { A: { rest: REST, label: 'Test rig', license: 'CC0 1.0', url: 'https://example.org' } },
    clips: {
      Stand: { src: 'A', dur: 1, loop: true, speed: 50, keys: [standing(0), standing(1)] },
      Punch: { src: 'A', dur: 0.6, keys: [reach(0, 0), reach(0.3, 100), reach(0.6, 0)], orig: 'X/Punch' },
      Walk_Loop: { src: 'A', dur: 1, keys: [standing(0)] },
    },
  });

describe('loadClipLibrary', () => {
  it('loads a set: its names, clips and rest bodies; an unknown name throws with the closest', () => {
    const library = test();
    expect([library.name, library.names]).toEqual(['TEST', ['Stand', 'Punch', 'Walk_Loop']]);
    expect(library.has('Punch')).toBe(true);
    expect(library.rest('Stand')).toBe(REST);
    expect(() => library.clip('Walk_Lop')).toThrow(/ANIM_UNKNOWN_CLIP.*Walk_Lop.*Walk_Loop/s);
    const bare = loadClipLibrary({ set: 'BARE', clips: { Stand: { dur: 1, keys: [standing(0)] } } });
    expect(() => bare.rest('Stand')).toThrow(/ANIM_NO_REST/);
  });

  it('samples like the decode, bakes once a clip and once its mirror', () => {
    const library = test();
    expect([...library.sample('Punch', 0.3)]).toEqual([...samplePose(REST, library.clip('Punch'), 0.3)]);
    expect(library.moveAt('Punch', 0.3)).toBeNull();
    const baked = library.bake('Punch');
    expect(library.bake('Punch')).toBe(baked);
    const mirrored = library.bake('Punch', true);
    expect(mirrored).not.toBe(baked);
    expect(library.bake('Punch', true)).toBe(mirrored);
    expect(mirrored.rotations).not.toEqual(baked.rotations);
  });

  it('swaps in an edited clip, forgetting its bake, and restores the original', () => {
    const library = test();
    const before = library.bake('Punch');
    const edited = clipText({ ...library.clip('Punch'), dur: 1.2 });
    expect(library.replace('Punch', edited).dur).toBe(1.2);
    expect([library.edited('Punch'), library.bake('Punch').duration]).toEqual([true, 1.2]);
    expect(library.text('Punch')).toContain('"dur": 1.2');
    expect(library.restore('Punch').dur).toBe(0.6);
    expect([library.edited('Punch'), library.bake('Punch')]).toEqual([false, expect.not.objectContaining({ duration: 1.2 })]); // prettier-ignore
    expect(library.bake('Punch')).not.toBe(before);
  });

  it('says where a clip came from', () => {
    expect(test().origin('Punch')).toEqual({
      ...{ set: 'TEST', src: 'A', label: 'Test rig', origin: '', license: 'CC0 1.0', url: 'https://example.org' },
      ...{ orig: 'X/Punch', take: null },
    });
  });
});

describe('ground speed (shardfall’s clips.rs:441-476)', () => {
  it('a loop’s pace is its speed in standing hip heights a second; its rate keeps within 0.4–2.5', () => {
    expect(clipPace({ speed: 50 }, 0.9)).toBeCloseTo(0.45, 12);
    expect([clipPace({}, 0.9), clipPace({ speed: 1 }, 0.9)]).toEqual([null, null]);
    expect([walkRate(1, 1.5), walkRate(1, 0.1), walkRate(1, 9), walkRate(null, 3)]).toEqual([1.5, 0.4, 2.5, 1]);
  });

  it('switches to the run above √(w·r) × 1.15 and back below × 0.87, defaults 1.4 and 4 hip heights a second', () => {
    const [w, r, h] = [1.2, 3.6, 0.9];
    const mid = Math.sqrt(w * r);
    expect([runOverWalk(w, r, mid * 1.15 + 1e-9, false, h), runOverWalk(w, r, mid * 1.15 - 1e-9, false, h)]).toEqual([true, false]); // prettier-ignore
    expect([runOverWalk(w, r, mid * 0.87 + 1e-9, true, h), runOverWalk(w, r, mid * 0.87 - 1e-9, true, h)]).toEqual([true, false]); // prettier-ignore
    const defaults = Math.sqrt(GROUND_SPEED.walk * h * GROUND_SPEED.run * h) * GROUND_SPEED.up;
    expect([runOverWalk(null, null, defaults + 1e-9, false, h), runOverWalk(null, null, defaults - 1e-9, false, h)]).toEqual([true, false]); // prettier-ignore
  });

  it('the three walkers: an old man a fifth of an elated walker’s pace or less, each played at its own', () => {
    const library: ClipLibrary = loadClipLibrary(setOf('style100'));
    const h = 0.925; // build:heroic's standing hip height
    const pace = (name: string) => clipPace(library.clip(name), h)!;
    expect(pace('Old_Walk') * 5).toBeLessThan(pace('Elated_Walk'));
    for (const name of ['Old_Walk', 'Zombie_Walk', 'Elated_Walk']) expect(walkRate(pace(name), pace(name))).toBe(1);
  });
});

describe('strikeTime (shardfall’s clips.rs:478-550)', () => {
  it('is when a fist reaches furthest ahead of the hips; a kick’s ankle; a blade’s tip', () => {
    const library = test();
    expect(library.strikeTime('Punch')).toBeCloseTo(0.3, 12);
    expect(library.strikeTime('Punch')).toBe(library.strikeTime('Punch'));
    const kick = clipOf([standing(0), { ...standing(0.25), legR: [90, 0, -20, 0, 0] }, standing(0.5)], { tags: ['kick'] }); // prettier-ignore
    expect(strikeTime(kick, REST)).toBeCloseTo(0.25, 12);
    const swing = (t: number, f: number): ClipKey => ({ ...standing(t), blade: [f, 0, 100 - f] });
    const sword = clipOf([swing(0, 0), swing(0.4, 100), swing(0.8, 0)]);
    expect(strikeTime(sword, REST)).toBeCloseTo(0.4, 12);
    const real = setOf('quaternius');
    const t = strikeTime(real.clips.Sword_Attack, real.sources!.UAL2?.rest ?? Object.values(real.sources!)[0].rest);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(real.clips.Sword_Attack.dur);
  });
});
