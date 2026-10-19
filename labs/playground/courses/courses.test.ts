/**
 * @file Unit tests for the playground's feel courses (labs/playground/courses/): each runs on the gym from starts on
 * its open floor (the slide ramps' on their decks, the rides' on the tower's top where they say so), checks the
 * bounds (labs/playground/courses/bounds.ts) besides its own numbers, a run's under its label, and passes, every
 * number within its tolerance: the run `node x feel labs/playground` makes (tools/cmd/feel.test.ts runs it through
 * the command). The bounds take four numbers for each
 * camera, three for first person, and watch a camera's where a course names the WP that will make it pass.
 * @see labs/playground/courses/strip.ts
 * @see labs/playground/courses/jumps.ts
 * @see labs/playground/courses/air.ts
 * @see labs/playground/courses/slideFlat.ts
 * @see labs/playground/courses/slideRamps.ts
 * @see labs/playground/courses/slideJump.ts
 * @see labs/playground/courses/crawl.ts
 * @see labs/playground/courses/mantle.ts
 * @see labs/playground/courses/fences.ts
 * @see labs/playground/courses/climb.ts
 * @see labs/playground/courses/hang.ts
 * @see labs/playground/courses/superglide.ts
 * @see labs/playground/courses/zipline.ts
 * @see labs/playground/courses/ladder.ts
 * @see labs/playground/courses/launcher.ts
 * @see labs/playground/courses/skydive.ts
 * @see labs/playground/courses/cameras.ts
 * @see labs/playground/courses/camera-walls.ts
 * @see labs/playground/courses/bounds.ts
 */
import { describe, expect, it } from 'vitest';
import { getCourse, runCourse } from '../../../engine';
import { topHeight } from '../../../engine/sim-api';
import { GYM } from '../scenes/gym';
import { AIR_START } from './air';
import { bodyBounds, cameraBounds } from './bounds';
import { CAMERA_WALLS } from './camera-walls';
import { CAMERAS_START } from './cameras';
import { BOUNCE_RUNS, CLIMB_RUNS } from './climb';
import { CRAWL_STARTS } from './crawl';
import { FENCE_RUNS } from './fences';
import { HANG_STARTS } from './hang';
import { JUMPS_START } from './jumps';
import { LADDER_STARTS } from './ladder';
import { LAUNCHER_STARTS } from './launcher';
import { MANTLE_RUNS } from './mantle';
import { SLIDE_FLAT_START } from './slideFlat';
import { SLIDE_JUMPS } from './slideJump';
import { SLIDE_RAMPS, SLIDE_UPHILL } from './slideRamps';
import { STRIP_START } from './strip';
import { SKYDIVE_START } from './skydive';
import { GLIDE_START } from './superglide';
import { ZIPLINE_STARTS } from './zipline';

/** Each course's starts on the gym's floor, where nothing stands. */
const STARTS: Readonly<Record<string, readonly (readonly [number, number, number])[]>> = {
  strip: [STRIP_START],
  jumps: [JUMPS_START],
  air: [AIR_START],
  'slide-flat': [SLIDE_FLAT_START],
  'slide-ramps': [SLIDE_UPHILL],
  'slide-jump': SLIDE_JUMPS.map(([z]) => [2.25, 0, z] as const),
  crawl: [CRAWL_STARTS.tunnel, CRAWL_STARTS.bar],
  mantle: MANTLE_RUNS.map(([, x]) => [x, 0, 8.5] as const),
  fences: FENCE_RUNS.map(([, x]) => [x, 0, 14.5] as const),
  climb: [...CLIMB_RUNS.map(([, x]) => [x, 0, 19.4] as const), ...BOUNCE_RUNS.map(([, z]) => [19, 0, z] as const)],
  hang: [HANG_STARTS.high, HANG_STARTS.low],
  superglide: [GLIDE_START],
  'mantle-boost': [GLIDE_START],
  zipline: [ZIPLINE_STARTS.low, ZIPLINE_STARTS.balloon],
  ladder: [LADDER_STARTS.floor],
  launcher: [LAUNCHER_STARTS.pad, LAUNCHER_STARTS.mat],
  skydive: [SKYDIVE_START],
  cameras: [CAMERAS_START],
  'camera-walls': Object.values(CAMERA_WALLS).map((leg) => leg.at),
};

/** The starts on the tower's top (6 m): the zipline's pulley, the ladder's top, the drop onto the trampoline. */
const ON_THE_TOWER = [ZIPLINE_STARTS.top, LADDER_STARTS.top, LAUNCHER_STARTS.tower];

describe('the playground’s courses', () => {
  it('check the body’s bounds and four of each camera’s, three of first person’s, a run’s under its label', () => {
    expect(bodyBounds(2).map((m) => m.metric)).toEqual(['footSlide', 'pop', 'handContact']);
    expect(cameraBounds(2)).toHaveLength(19);
    const run = cameraBounds(2, { to: 90, label: 'run 1', watch: { shooter: 'WP 13.12' } });
    expect(run[0]).toMatchObject({ name: 'run 1: shooter: jump', to: 90, watch: 'WP 13.12' });
    expect(run.filter((m) => m.watch)).toHaveLength(4); // the shooter's four, the others judged
  });

  it('start each run on open floor, and each ramp’s on its deck', () => {
    for (const [name, starts] of Object.entries(STARTS)) {
      for (const [x, , z] of starts) expect(topHeight(GYM, x, z), name).toBe(0); // nothing stands there
    }
    for (const [degrees, x, deck] of SLIDE_RAMPS) expect(topHeight(GYM, x, 30.5), `${degrees}°`).toBeCloseTo(deck, 6);
    for (const [x, y, z] of ON_THE_TOWER) expect([topHeight(GYM, x, z), y]).toEqual([6, 6]);
  });

  for (const name of Object.keys(STARTS)) {
    it(`${name}: keeps every number within its tolerance`, () => {
      const course = getCourse(`course:playground-${name}`);
      expect(course.scene).toBe('playground:gym');
      const result = runCourse(course);
      expect(result.results.filter((r) => !r.pass && r.watch === undefined)).toEqual([]);
      expect(result.pass).toBe(true);
    });
  }
});
