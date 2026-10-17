/**
 * @file The air course, `course:playground-air` (docs/PLAYGROUND.md §3.2, PLAN.md WP 13.4): the player, empty-handed,
 * placed at the west end of the open floor south of the slide ramps, sprints east holding sprint and jumps three
 * times: 0.1 s into the first, a side key replaces forward (a lurch); the second it takes with a side key held from
 * the take-off (an air strafe); the third it presses just before landing (a bunny hop); then it runs on and stops. Its
 * numbers against §3.2's, then the bounds (labs/playground/courses/bounds.ts).
 *
 * The references: the lurch changes the velocity by its cap, 4.6 m/s (a 90° key at full strength, 0.7 of 10.7 m/s);
 * the strafe gains 0.20 m/s (the air speed's cap, 1.52 m/s × 1.15 holstered, across a 7.59 m/s sprint:
 * √(7.59² + 1.75²) − 7.59); the hop leaves the sprint's 7.59 m/s (2.54 m/s of cost, never below the sprint).
 *
 * Game code (labs/playground/): it imports only the engine's public API and the playground's own files.
 *
 * @example
 * // node x feel labs/playground --course air
 * @see labs/playground/courses/courses.test.ts
 */
import { defineCourse } from '../../../engine';
import { bodyBounds, cameraBounds } from './bounds';

/** Where the air course starts: the west lane at the open floor's middle, facing east. */
export const AIR_START = [1.75, 0, 56.25] as const;

/** East, as the view's yaw and the camera's heading. */
const EAST = Math.PI / 2;

defineCourse('course:playground-air', {
  description: 'A sprint east with a lurch, an air strafe and a bunny hop, empty-handed (docs/PLAYGROUND.md §3.2).',
  scene: 'playground:gym',
  steps: 330,
  inputs: [
    [0, { dev: 'place', args: { at: AIR_START, yaw: EAST } }],
    [1, { move: [1, 0], look: [EAST, 0], cam: EAST, b: ['sprint'] }],
    [90, { b: ['jump', 'sprint'] }],
    [96, { b: ['sprint'], move: [0, -1] }],
    [138, { move: [1, 0] }],
    [210, { b: ['jump', 'sprint'], move: [0, 1] }],
    [216, { b: ['sprint'] }],
    [255, { b: ['jump', 'sprint'], move: [1, 0] }],
    [262, { b: ['sprint'] }],
    [300, { move: null, b: null }],
  ],
  measures: [
    { name: 'lurch', metric: 'velocityChange', from: 96, to: 97, reference: 4.6, tolerance: { share: 0.02 } },
    { name: 'strafe gain', metric: 'speedGain', from: 210, to: 255, reference: 0.2, tolerance: { share: 0.05 } },
    { name: 'hop', metric: 'speed', from: 260, to: 262, reference: 7.59, tolerance: { share: 0.02 } },
    ...bodyBounds(2),
    ...cameraBounds(2),
  ],
});
