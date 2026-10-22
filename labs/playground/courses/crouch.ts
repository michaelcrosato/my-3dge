/**
 * @file The crouch course, `course:playground-crouch` (docs/PLAYGROUND.md §3.2, PLAN.md WP 13.18): the player,
 * empty-handed and standing on the open floor east of the slope tests, crouches and holds it, stands up, then spams
 * crouch, pressing it for 0.3 s at a time with 0.15 s between. Its hull's timing against §3.2's: the duck goes down in
 * 0.4 s and the hull shrinks as it ends, counted in whole milliseconds, 16 a tick, as Apex does: 25 ticks after the
 * press's own (0.433 s from it, as engine/physics/movement/crouch.test.ts counts them); getting up stands the hull as
 * it starts, in the release's own tick; a re-press within the 0.4 s never shrinks it. Then the bounds
 * (labs/playground/courses/bounds.ts).
 *
 * Game code (labs/playground/): it imports only the engine's public API and the playground's own files.
 *
 * @example
 * // node x feel labs/playground --course crouch
 * @see labs/playground/courses/courses.test.ts
 */
import { defineCourse } from '../../../engine';
import { bodyBounds, cameraBounds } from './bounds';

/** Where it stands: the open floor east of the slope tests. */
export const CROUCH_START = [27, 0, 47] as const;

/** When it crouches, stands up, and starts spamming (steps); each spam press's and gap's length (steps). */
const [DOWN, UP, SPAM, PRESS, GAP] = [10, 60, 100, 18, 9];

defineCourse('course:playground-crouch', {
  description: 'The duck’s 0.4 s down, getting up at once, and crouch spam never shrinking the hull (docs/PLAYGROUND.md §3.2).', // prettier-ignore
  scene: 'playground:gym',
  steps: 200,
  inputs: [
    [0, { dev: 'place', args: { at: CROUCH_START, yaw: 0 }, look: [0, 0], cam: 0 }],
    [DOWN, { b: ['crouch'] }],
    [UP, { b: null }],
    ...[0, 1, 2].flatMap((k) => [
      [SPAM + k * (PRESS + GAP), { b: ['crouch'] }],
      [SPAM + k * (PRESS + GAP) + PRESS, { b: null }],
    ]),
  ],
  measures: [
    { name: 'down', metric: 'time', from: DOWN, until: 'crouched', reference: (1 + 400 / 16) / 60, tolerance: { ticks: 1 } }, // prettier-ignore
    { name: 'up at once', metric: 'time', from: UP, until: 'standing', reference: 1 / 60, tolerance: { ticks: 1 } },
    { name: 'spam: never down', metric: 'duration', from: SPAM, to: SPAM + 3 * (PRESS + GAP), until: 'crouched', reference: 0, tolerance: { abs: 0 } }, // prettier-ignore
    ...bodyBounds(2),
    ...cameraBounds(2),
  ],
});
