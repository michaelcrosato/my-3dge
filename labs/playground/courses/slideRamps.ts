/**
 * @file The slide ramps course, `course:playground-slide-ramps` (docs/PLAYGROUND.md §3.2, PLAN.md WP 13.5): the player,
 * empty-handed, is put on the deck of each slide ramp (5°, 10°, 20° and 30°, 12 m long) at a holstered sprint's
 * 7.59 m/s, crouching, so it slides off the deck, down the ramp and out across the run-out; then at the 30° ramp's foot,
 * sliding up it. Each run's numbers against §3.2's, then each run's bounds (labs/playground/courses/bounds.ts).
 *
 * The references, from §3.2's rules (the boost to 10.16 × 1.15 m/s on the landing ducked; the friction 2.54 m/s²
 * and × 0.7 a second; the pull g · n_y along the floor, g = 19.05 m/s², half before the walk and half after; the end
 * below 3.18 m/s), stepped at 60 Hz as a tick orders them over the deck's 1.25 m from the landing, the ramp's 12 m and
 * the flat after, the feet's place choosing the floor: on the flat a slide lasts 1.70 s (course slide-flat); down 5°
 * it lasts 2.183 s, down 10° 2.45 s, down 20° 2.767 s and down 30° 2.95 s, gaining to 12.47 m/s at the ramp's foot; up
 * 30° from 5.75 m before its foot, 1.0 s. The runs come within a tick of these: the capsule meets a slope's floor a
 * little after its feet reach it, and the model reads the floor a tick late.
 *
 * Game code (labs/playground/): it imports only the engine's public API and the playground's own files.
 *
 * @example
 * // node x feel labs/playground --course slide-ramps
 * @see labs/playground/courses/courses.test.ts
 */
import { defineCourse } from '../../../engine';
import { bodyBounds, cameraBounds } from './bounds';

/** The runs: each ramp's slope (°), its lane's middle (x), its deck's height (m) and how long the slide lasts (s). */
export const SLIDE_RAMPS = [
  [5, 8, 1.05, 2.183],
  [10, 15, 2.116, 2.45],
  [20, 22, 4.368, 2.767],
  [30, 29, 6.928, 2.95],
] as const;

/** How long each run is (steps), and the holstered sprint's speed the player is put on each deck at (m/s). */
const [RUN, SPRINT] = [190, 6.604 * 1.15];

/** Where the uphill run starts: the 30° ramp's run-out, 6 m south of its foot, facing north. */
export const SLIDE_UPHILL = [29, 0, 50] as const;

/** The uphill run's first step. */
const UP = RUN * SLIDE_RAMPS.length;

defineCourse('course:playground-slide-ramps', {
  description: 'Slides down the 5°, 10°, 20° and 30° ramps from a sprint, and up the 30° one: the pull along the floor (docs/PLAYGROUND.md §3.2).', // prettier-ignore
  scene: 'playground:gym',
  steps: UP + RUN,
  inputs: [
    ...SLIDE_RAMPS.flatMap(([, x, deck], k) => [
      [k * RUN, { dev: 'place', args: { at: [x, deck, 30.5], yaw: 0, speed: SPRINT } }] as const,
      ...(k === 0 ? [[0, { move: [0, 1], look: [0, 0], cam: 0, b: ['crouch'] }] as const] : []),
    ]),
    [UP, { dev: 'place', args: { at: SLIDE_UPHILL, yaw: Math.PI, speed: SPRINT }, move: [0, -1], look: [Math.PI, 0], cam: Math.PI }], // prettier-ignore
  ],
  measures: [
    ...SLIDE_RAMPS.flatMap(([degrees, , , lasts], k) => {
      const [from, to, label] = [k * RUN + 2, (k + 1) * RUN - 1, `${degrees}°`];
      const gain = degrees === 30 ? [{ name: `${label}: gains`, metric: 'topSpeed', from, to, reference: 12.47, tolerance: { share: 0.02 } }] : []; // prettier-ignore
      return [
        { name: `${label}: lasts`, metric: 'time', from, to, until: 'stopsSliding', reference: lasts, tolerance: { ticks: 1 } }, // prettier-ignore
        ...gain,
        ...bodyBounds(from, { to, label }),
        ...cameraBounds(from, { to, label }),
      ];
    }),
    { name: 'up 30°: lasts', metric: 'time', from: UP + 2, until: 'stopsSliding', reference: 1, tolerance: { ticks: 1 } }, // prettier-ignore
    ...bodyBounds(UP + 2, { label: 'up 30°' }),
    ...cameraBounds(UP + 2, { label: 'up 30°' }),
  ],
});
