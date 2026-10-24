/**
 * @file Unit tests for the playground's feel courses (labs/playground/courses/): each runs on the gym from starts on
 * its open floor (the slide ramps' on their decks, the gaps' on the lane's platforms, the landings' over the floor,
 * the rides' on the tower's top where they say so), checks the
 * bounds (labs/playground/courses/bounds.ts) besides its own numbers, a run's under its label, and passes, every
 * number within its tolerance: the run `node x feel labs/playground` makes (tools/cmd/feel.test.ts runs it through
 * the command). The bounds take four numbers for each
 * camera, three for first person, and watch a camera's where a course names the WP that will make it pass. The hill's
 * course runs on the hill's terrain (WP 10.5), the range's at the site's range with the guns drawn, §5.1's muzzle bound
 * among its numbers (WP 13.20).
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
 * @see labs/playground/courses/climbAgain.ts
 * @see labs/playground/courses/hang.ts
 * @see labs/playground/courses/superglide.ts
 * @see labs/playground/courses/zipline.ts
 * @see labs/playground/courses/ladder.ts
 * @see labs/playground/courses/launcher.ts
 * @see labs/playground/courses/skydive.ts
 * @see labs/playground/courses/gaps.ts
 * @see labs/playground/courses/steps.ts
 * @see labs/playground/courses/crouch.ts
 * @see labs/playground/courses/landing.ts
 * @see labs/playground/courses/cameras.ts
 * @see labs/playground/courses/camera-walls.ts
 * @see labs/playground/courses/range.ts
 * @see labs/playground/courses/bounds.ts
 */
import { describe, expect, it } from 'vitest';
import { getCourse, runCourse } from '../../../engine';
import { topHeight } from '../../../engine/sim-api';
import { GYM } from '../scenes/gym';
import '../scenes/site'; // the range's course runs at the site's range
import { AIR_START } from './air';
import { BOUNDS, bodyBounds, cameraBounds, muzzleBound } from './bounds';
import { CAMERA_WALLS } from './camera-walls';
import { CAMERAS_START } from './cameras';
import { BOUNCE_RUNS, CLIMB_RUNS } from './climb';
import { CLIMB_AGAIN_START } from './climbAgain';
import { CRAWL_STARTS } from './crawl';
import { CROUCH_START } from './crouch';
import { FENCE_RUNS } from './fences';
import { GAP_RUNS } from './gaps';
import { HANG_STARTS } from './hang';
import './hill';
import './range';
import { JUMPS_START } from './jumps';
import { LADDER_STARTS } from './ladder';
import { LANDING_RUNS } from './landing';
import { LAUNCHER_STARTS } from './launcher';
import { MANTLE_RUNS } from './mantle';
import { SLIDE_FLAT_START } from './slideFlat';
import { SLIDE_JUMPS } from './slideJump';
import { SLIDE_RAMPS, SLIDE_UPHILL } from './slideRamps';
import { STEP_RUNS } from './steps';
import { STRIP_START } from './strip';
import { SKYDIVE_START } from './skydive';
import { GLIDE_START } from './superglide';
import { ZIPLINE_STARTS } from './zipline';

/** Each course's starts on the gym's floor, where nothing stands; the gaps' on the lane's platforms, or its floor. */
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
  'climb-again': [CLIMB_AGAIN_START],
  gaps: GAP_RUNS.map(({ at }) => at),
  steps: STEP_RUNS.map(([, at]) => at),
  crouch: [CROUCH_START],
  landing: LANDING_RUNS.map(([, z]) => [2, 0, z] as const), // the floor it falls to
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
  it('check the body’s bounds and four of each camera’s, first person’s arms never cut, a run’s under its label', () => {
    expect(bodyBounds(2).map((m) => m.metric)).toEqual(['footSlide', 'pop', 'handContact']);
    expect(cameraBounds(2)).toHaveLength(21);
    expect(cameraBounds(2).filter((m) => String(m.name).startsWith('first:')).map((m) => m.metric)).toEqual(['cameraJump', 'cameraTurn', 'cameraInside', 'cameraLost', 'cameraClip']); // prettier-ignore
    const run = cameraBounds(2, { to: 90, label: 'run 1', watch: { shooter: 'WP 13.12' } });
    expect(run[0]).toMatchObject({ name: 'run 1: shooter: jump', to: 90, watch: 'WP 13.12' });
    expect(run.filter((m) => m.watch)).toHaveLength(4); // the shooter's four, the others judged
  });

  it('start each run on open floor or a gap’s platform, and each ramp’s on its deck', () => {
    for (const [name, starts] of Object.entries(STARTS)) {
      for (const [x, y, z] of starts) expect(topHeight(GYM, x, z), name).toBe(name === 'gaps' ? y : 0); // nothing else stands there
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

  it('range: keeps every number within its tolerance at the site’s range, the muzzle on the aim', () => {
    const course = getCourse('course:playground-range');
    expect(course.scene).toBe('playground:site-range');
    expect(muzzleBound(60)).toMatchObject({ metric: 'muzzle', from: 60, tolerance: { abs: BOUNDS.muzzle } });
    expect(course.measures.map((m) => m.metric)).toContain('muzzle');
    const result = runCourse(course);
    expect(result.results.filter((r) => !r.pass)).toEqual([]);
    expect(result.pass).toBe(true);
  }, 120_000);

  it('hill: keeps every number within its tolerance, on the hill’s terrain', () => {
    const course = getCourse('course:playground-hill');
    expect(course.scene).toBe('playground:hill');
    const result = runCourse(course);
    expect(result.results.filter((r) => !r.pass)).toEqual([]);
    expect(result.pass).toBe(true);
  });
});
