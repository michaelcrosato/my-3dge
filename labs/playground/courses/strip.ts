/**
 * @file The strip course, `course:playground-strip` (docs/PLAYGROUND.md §2.3 and §3.2, PLAN.md WP 13.4): the player,
 * empty-handed (holstered: every speed ×1.15), placed at the strip's north end, runs south from standing for 1.5 s,
 * sprints on a press (the sticky sprint keeps it), then lets go and stops; its numbers against §3.2's, then the bounds
 * (labs/playground/courses/bounds.ts).
 *
 * The references, holstered: the run 5.07 m/s and the sprint 7.59 (§3.2); 90% of the run in 0.13 s, as armed (the
 * speeds and the accelerations both scale by 1.15); from a steady run to the sprint in 0.865 s (2.54 m/s² × 1.15 over
 * the 2.53 m/s between them: §3.2's 0.83 s is from rest, the run's band overshooting the run by a tick); the stop in
 * 0.24 s (31.75 m/s², which does not scale, from 7.59 m/s).
 *
 * Game code (labs/playground/): it imports only the engine's public API and the playground's own files.
 *
 * @example
 * // node x feel labs/playground --course strip
 * @see labs/playground/courses/courses.test.ts
 */
import { defineCourse } from '../../../engine';
import { bodyBounds, cameraBounds } from './bounds';

/** Where the strip starts: its north end, on the lane west of the features, facing south. */
export const STRIP_START = [2.25, 0, 7.25] as const;

defineCourse('course:playground-strip', {
  description: 'The strip: from standing, the run, the sprint on a press and the stop, empty-handed (docs/PLAYGROUND.md §3.2).', // prettier-ignore
  scene: 'playground:gym',
  steps: 300,
  inputs: [
    [0, { dev: 'place', args: { at: STRIP_START, yaw: 0 } }],
    [1, { move: [0, 1], look: [0, 0], cam: 0 }],
    [90, { b: ['sprint'] }],
    [92, { b: null }],
    [240, { move: null }],
  ],
  measures: [
    { name: 'to the run', metric: 'time', from: 1, until: 'speedAbove', value: 0.9 * 5.068, reference: 0.13, tolerance: { ticks: 1 } }, // prettier-ignore
    { name: 'run', metric: 'speed', from: 60, to: 90, reference: 5.07, tolerance: { share: 0.02 } },
    { name: 'run to sprint', metric: 'time', from: 90, until: 'speedAbove', value: 7.594, reference: 0.865, tolerance: { ticks: 1 } }, // prettier-ignore
    { name: 'sprint', metric: 'speed', from: 200, to: 240, reference: 7.59, tolerance: { share: 0.02 } },
    { name: 'stop', metric: 'time', from: 240, until: 'speedBelow', value: 0.01, reference: 0.24, tolerance: { ticks: 1 } }, // prettier-ignore
    ...bodyBounds(2),
    ...cameraBounds(2),
  ],
});
