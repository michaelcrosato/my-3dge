/**
 * @file Unit tests for running feel courses (engine/dev/feel/run.ts): a course runs as its replay plays, to the same
 * hash, and measuring it never changes the run; its move, animation and camera measures read the run; a measure
 * passes within any one tolerance it names (a share, an amount or whole ticks); a time runs from its step to the first
 * sample that meets its end, a duration as long as a state lasts from its first sample; a ride's states, the
 * highest the feet go, the fastest fall, the height a state begins at, the ride's speed and its catches read as their
 * samples hold them; a scene without a player, or an animation measure on a player without an animator, is refused
 * naming the fix.
 * @see engine/dev/feel/run.ts
 */
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../core/registry';
import { createCharacter } from '../../physics/character';
import { physicsOf } from '../../physics/binding';
import { defineActorKinds, spawnActor } from '../../sim/actors';
import { playReplay, REPLAY_FORMAT } from '../../sim/replay';
import { defineScene } from '../../sim/scene';
import type { World } from '../../sim/world';
import { defineCourse, type Measure } from './course';
import { judge, measure, runCourse, type CourseSample } from './run';

/** A registry with `feel:track` (a `movement:apex` player on a long floor, animated) and `feel:empty` (no actor). */
function scenes(animated = true) {
  const registry = createRegistry();
  defineActorKinds(registry);
  const floor = (w: World) =>
    physicsOf(w).addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [400, 1, 60] }, position: [0, -0.5, 0] }] }); // prettier-ignore
  const character = createCharacter({ movement: 'movement:apex' });
  const setup = (w: World) => {
    floor(w);
    spawnActor(w, { at: [-150, 0, 0], character, ...(animated ? { anim: { build: 'build:adult' } } : {}) });
  };
  defineScene('feel:track', { physics: true, setup }, registry);
  defineScene('feel:empty', { physics: true, setup: floor }, registry);
  return registry;
}

/** A sprint east from rest for 3 s, measuring the move, the body and a chase camera. */
const SPRINT = {
  scene: 'feel:track',
  steps: 180,
  inputs: [[0, { move: [1, 0], look: [Math.PI / 2, 0], b: ['sprint'] }]],
  measures: [
    { name: 'sprint', metric: 'topSpeed', reference: 7.59, tolerance: { share: 0.02 } },
    { name: 'flat', metric: 'apex', reference: 0, tolerance: { abs: 0.001 } },
    { name: 'standing', metric: 'grounded', reference: 1, tolerance: { abs: 0 } },
    { name: 'to the run', metric: 'time', from: 0, until: 'speedAbove', value: 4.5, reference: 0.15, tolerance: { ticks: 2 } }, // prettier-ignore
    { name: 'slide', metric: 'footSlide', from: 30, reference: 0, tolerance: { abs: 10 } },
    { name: 'pops', metric: 'pop', from: 30, reference: 0, tolerance: { abs: 10 } },
    { name: 'chase', metric: 'cameraJump', camera: 'cam3=chase', from: 1, reference: 0, tolerance: { abs: 0.3 } },
    { name: 'chase lost', metric: 'cameraLost', camera: 'cam3=chase', from: 1, reference: 0, tolerance: { abs: 0 } },
  ],
};

describe('running a course', () => {
  it('plays its inputs as its replay does, to the same hash, and judges each measure', () => {
    const registry = scenes();
    const result = runCourse(defineCourse('course:sprint', SPRINT, registry), { registry });
    const replay = { format: REPLAY_FORMAT, scene: 'feel:track', settings: {}, seed: 1, hz: 60, steps: 180, inputs: SPRINT.inputs, hashes: {} }; // prettier-ignore
    expect(result.hash).toBe(playReplay(replay, { registry, checkpoints: [180] }).hashes['180']);
    expect(result.samples).toHaveLength(181);
    expect(result.results.map((r) => [r.name, r.pass])).toEqual(SPRINT.measures.map((m) => [m.name, true]));
    expect(result.results[0].value).toBeCloseTo(6.604 * 1.15, 3); // holstered
    expect(result.pass).toBe(true);
    expect(runCourse(defineCourse('course:again', SPRINT, registry), { registry }).results).toEqual(result.results);
  });

  it('passes a measure within any one tolerance it names', () => {
    const m = (tolerance: Measure['tolerance'], reference = 5): Measure => ({ name: 'm', metric: 'speed', from: 1, reference, tolerance }); // prettier-ignore
    expect(judge(m({ share: 0.02 }), 5.09, 1 / 60).pass).toBe(true);
    expect(judge(m({ share: 0.02 }), 5.11, 1 / 60)).toMatchObject({ pass: false, off: expect.closeTo(0.11, 9) });
    expect(judge(m({ abs: 0.3 }, 0), 0.3, 1 / 60).pass).toBe(true);
    expect(judge(m({ ticks: 1 }, 0.5), 0.5 + 1 / 60, 1 / 60).pass).toBe(true);
    expect(judge(m({ ticks: 1 }, 0.5), 0.5 + 2 / 60, 1 / 60).pass).toBe(false);
    expect(judge(m({ abs: 1 }), Infinity, 1 / 60).pass).toBe(false); // a time that never ended
  });

  it('times from its step to the first sample that meets its end', () => {
    const sample = (speed: number, grounded = true): CourseSample => ({ feet: [0, 0, 0], velocity: [speed, 0, 0], grounded, yaw: 0 }); // prettier-ignore
    const samples = [0, 1, 2, 3, 4, 5].map((v) => sample(v));
    const time = (until: Measure['until'], from: number, value?: number) =>
      measure({ name: 't', metric: 'time', from, until, value, reference: 0, tolerance: { ticks: 0 } }, { samples, cameras: {} }, 5, 0.5); // prettier-ignore
    expect(time('speedAbove', 0, 2.5)).toBe(1.5); // samples 0, 1, 2 fall short; sample 3 is 1.5 s on
    expect(time('speedAbove', 2, 2.5)).toBe(0.5);
    expect(time('speedBelow', 0, 0.5)).toBe(0);
    expect(time('airborne', 0)).toBe(Infinity);
  });

  it('times how long a state lasts from its first sample, and reads the fastest rise and the highest stand', () => {
    const sample = (mode: string, mantle: string, vy = 0): CourseSample => ({ feet: [0, 0, 0], velocity: [0, vy, 0], grounded: false, yaw: 0, mode, mantle }); // prettier-ignore
    const samples = [sample('air', 'none'), sample('mantle', 'grab'), sample('mantle', 'grab', 2), sample('mantle', 'pull'), sample('ground', 'none', -1), sample('mantle', 'grab')]; // prettier-ignore
    const run = { samples, cameras: {} };
    const duration = (until: Measure['until'], from = 0) =>
      measure({ name: 'd', metric: 'duration', from, until, reference: 0, tolerance: { ticks: 0 } }, run, 5, 0.5);
    expect(duration('mantling')).toBe(1.5); // samples 1 to 3, not the later one
    expect(duration('grabbing')).toBe(1);
    expect(duration('pulling')).toBe(0.5);
    expect(duration('hanging')).toBe(0);
    expect(duration('grabbing', 5)).toBe(0.5); // to the run's end
    expect(measure({ name: 'r', metric: 'topRise', from: 0, reference: 0, tolerance: { abs: 0 } }, run, 5, 0.5)).toBe(2); // prettier-ignore
    const stood = [true, false, true].map((grounded, k): CourseSample => ({ feet: [0, [0, 3, 1.5][k], 0], velocity: [0, 0, 0], grounded, yaw: 0 })); // prettier-ignore
    expect(measure({ name: 's', metric: 'standHeight', from: 0, reference: 0, tolerance: { abs: 0 } }, { samples: stood, cameras: {} }, 2, 0.5)).toBe(1.5); // prettier-ignore
  });

  it('reads a ride: its states, the highest and the fastest fall, the height a state begins at, its speed and catches', () => {
    const sample = (y: number, vy: number, mode: string, rideSpeed = 0, catches = 0, landing = false): CourseSample => ({ feet: [0, y, 0], velocity: [0, vy, 0], grounded: false, yaw: 0, mode, rideSpeed, catches, landing }); // prettier-ignore
    const samples = [sample(0, 0, 'ground'), sample(1, 2, 'zipline', 2, 1), sample(3, 4, 'zipline', 6, 1), sample(9, -20, 'skydive', 0, 2), sample(5, -10, 'skydive', 0, 2, true), sample(4, -2, 'ladder', 1)]; // prettier-ignore
    const run = { samples, cameras: {} };
    const read = (metric: Measure['metric'], until?: Measure['until'], from = 0, to?: number) =>
      measure({ name: 'm', metric, from, ...(to === undefined ? {} : { to }), ...(until ? { until } : {}), reference: 0, tolerance: { abs: 0 } }, run, 5, 0.5); // prettier-ignore
    expect([read('time', 'riding'), read('time', 'skydiving'), read('time', 'landingPose'), read('time', 'onLadder')]).toEqual([0.5, 1.5, 2, 2.5]); // prettier-ignore
    expect([read('top'), read('topFall'), read('heightAt', 'landingPose'), read('heightAt', 'climbing')]).toEqual([9, 20, 5, Infinity]); // prettier-ignore
    expect([read('rideSpeed', undefined, 0, 2), read('rideGain', undefined, 1, 2), read('catches')]).toEqual([6, 4, 2]);
  });

  it('refuses a scene without a player, and an animation measure on a player without an animator', () => {
    const registry = scenes(false);
    const empty = defineCourse('course:empty', { ...SPRINT, scene: 'feel:empty' }, registry);
    expect(() => runCourse(empty, { registry })).toThrow(/DEV_COURSE_NO_PLAYER.*feel:empty/);
    const course = defineCourse('course:unposed', SPRINT, registry);
    expect(() => runCourse(course, { registry })).toThrow(/DEV_COURSE_NO_ANIMATOR.*slide/);
  });
});
