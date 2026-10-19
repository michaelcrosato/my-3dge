/**
 * @file The skydive course, `course:playground-skydive` (docs/PLAYGROUND.md §3.2, PLAN.md WP 13.7): the redeploy
 * balloon. The player, empty-handed, uses the balloon's line from the floor and rides it up at 12.19 m/s; at the
 * balloon it is thrown up into the skydive. With the view level it falls at 20 m/s and the push steers it across at
 * up to 12 m/s (ours); looking straight down it dives at 35 m/s; 30 m over the floor the landing pose takes over and
 * slows the fall to 6.1 m/s (ours), and it lands with no stun, running off at once. Then the bounds
 * (labs/playground/courses/bounds.ts) of the run.
 *
 * The gym's balloon stands 90 m up (labs/playground/levels/gym.ts), so the glide and the dive both fit before the
 * landing pose.
 *
 * Game code (labs/playground/): it imports only the engine's public API and the playground's own files.
 *
 * @example
 * // node x feel labs/playground --course skydive
 * @see labs/playground/courses/courses.test.ts
 */
import { defineCourse } from '../../../engine';
import { GYM_BALLOON } from '../levels/gym';
import { bodyBounds, cameraBounds } from './bounds';

const DT = 1 / 60;

/** §3.2's numbers: the vertical line's top speed, the skydive's fall gliding and diving, the landing pose's height; ours: the speed across, the touch-down. */ // prettier-ignore
const SKY = { vertical: 12.192, glide: 20, dive: 35, land: 30, across: 12, touch: 6.096 } as const;

/** Where the run starts: on the floor a metre north of the balloon's line, facing it. */
export const SKYDIVE_START = [GYM_BALLOON.from[0], 0, GYM_BALLOON.from[2] - 1] as const;

/** When things happen (steps): the use, the push across in the glide, the dive, the push after landing, the end. */
const STEP = { use: 2, push: 520, release: 645, dive: 650, run: 840, end: 960 } as const;

defineCourse('course:playground-skydive', {
  description: 'The redeploy balloon: up its line, the skydive’s glide and dive, the landing pose at 30 m, a landing with no stun (docs/PLAYGROUND.md §3.2).', // prettier-ignore
  scene: 'playground:gym',
  steps: STEP.end,
  inputs: [
    [0, { dev: 'place', args: { at: SKYDIVE_START, yaw: 0, speed: 0 }, move: [0, 0], look: [0, 0], cam: 0, b: [] }],
    [STEP.use, { b: ['interact'] }],
    [STEP.use + 1, { b: [] }],
    [STEP.push, { move: [0, 1] }],
    [STEP.release, { move: [0, 0] }],
    [STEP.dive, { look: [0, -Math.PI / 2] }],
    [STEP.run, { move: [1, 0], look: [Math.PI / 2, 0], cam: Math.PI / 2 }],
  ],
  measures: [
    { name: 'use catches the line', metric: 'time', until: 'riding', from: STEP.use, reference: DT, tolerance: { ticks: 0 } }, // prettier-ignore
    { name: 'rides up at 12.19 m/s', metric: 'topRise', from: STEP.use, to: STEP.push - 60, reference: SKY.vertical, tolerance: { share: 0.02 } }, // prettier-ignore
    { name: 'thrown into the skydive at the balloon', metric: 'heightAt', until: 'skydiving', from: STEP.use, reference: GYM_BALLOON.to[1] - 0.6096 - 2.032, tolerance: { abs: SKY.vertical * DT } }, // prettier-ignore
    { name: 'glides at 20 m/s', metric: 'topFall', from: STEP.push + 80, to: STEP.release, reference: SKY.glide, tolerance: { share: 0.02 } }, // prettier-ignore
    { name: 'steered across at 12 m/s', metric: 'topSpeed', from: STEP.push, to: STEP.release, reference: SKY.across, tolerance: { share: 0.02 } }, // prettier-ignore
    { name: 'dives at 35 m/s', metric: 'topFall', from: STEP.dive, to: STEP.run, reference: SKY.dive, tolerance: { share: 0.02 } }, // prettier-ignore
    { name: 'the landing pose 30 m up', metric: 'heightAt', until: 'landingPose', from: STEP.push, reference: SKY.land, tolerance: { abs: SKY.dive * DT } }, // prettier-ignore
    { name: 'touches down slowed', metric: 'topFall', from: STEP.run - 40, to: STEP.run, reference: SKY.touch, tolerance: { share: 0.02 } }, // prettier-ignore
    { name: 'runs off at once: no stun', metric: 'speed', from: STEP.run + 40, to: STEP.end, reference: 4.4069 * 1.15, tolerance: { share: 0.02 } }, // prettier-ignore
    ...bodyBounds(STEP.use, { label: 'skydive' }),
    ...cameraBounds(STEP.use, { label: 'skydive' }),
  ],
});
