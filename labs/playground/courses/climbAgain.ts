/**
 * @file The climb-again course, `course:playground-climb-again` (docs/PLAYGROUND.md §3.2, PLAN.md WP 13.18): the
 * player, empty-handed, sprints at the gym's 6 m climb wall and jumps 2.6 m short of its face, holding forward, as
 * the climb course's neutral bounce does; climbing, it lets go (pulling back two ticks), then pushes at the wall again
 * as it falls. §3.2's rule: a new climb starts lower than the last, letting go lowering the climb space 3.25 m, so the
 * space's cutoff, 3.73 m over the last ground, stands 0.48 m over the floor: it catches the wall again only in the
 * first step that starts with its feet that low, not at the 1.33 m it first caught at, and that step moves it on a
 * tick's fall (9.3 m/s there, from the 2.74 m its let-go rose to), so the catch lies in the tick-wide window from 0.48 m
 * less two ticks' falls to 0.48 m less one. Then the bounds (labs/playground/courses/bounds.ts).
 *
 * Game code (labs/playground/): it imports only the engine's public API and the playground's own files.
 *
 * @example
 * // node x feel labs/playground --course climb-again
 * @see labs/playground/courses/courses.test.ts
 */
import { defineCourse } from '../../../engine';
import { bodyBounds, cameraBounds } from './bounds';

/** Where it starts: 2.6 m short of the 6 m wall's face, at its middle. */
export const CLIMB_AGAIN_START = [19, 0, 19.4] as const;

/** The sprint, holstered (m/s); the climb space's cutoff and what letting go lowers it by (m); gravity (m/s²). */
const [SPRINT, CUTOFF, DROP, G] = [6.604 * 1.15, 3.7338, 3.2512, 19.05];

/** Where it catches again (m): the cutoff over the lowered space, less a tick's fall from the let-go's apex, 2.74 m. */
const AGAIN_AT = CUTOFF - DROP;
const TICK_FALL = Math.sqrt(2 * G * (2.74 - AGAIN_AT)) / 60;

/** When it jumps, lets go and pushes at the wall again (steps). */
const [JUMP, LET_GO, AGAIN] = [1, 25, 27];

defineCourse('course:playground-climb-again', {
  description: 'Letting go of a climb and pushing at the wall again: it catches only 3.25 m lower (docs/PLAYGROUND.md §3.2).', // prettier-ignore
  scene: 'playground:gym',
  steps: 150,
  inputs: [
    [0, { dev: 'place', args: { at: CLIMB_AGAIN_START, yaw: 0, speed: SPRINT }, move: [0, 1], look: [0, 0], cam: 0, b: ['sprint'] }], // prettier-ignore
    [JUMP, { b: ['sprint', 'jump'] }],
    [JUMP + 1, { b: ['sprint'] }],
    [LET_GO, { move: [0, -1] }],
    [AGAIN, { move: [0, 1] }],
  ],
  measures: [
    {
      name: 'catches again 3.25 m lower',
      metric: 'heightAt',
      from: AGAIN,
      until: 'climbing',
      reference: AGAIN_AT - 1.5 * TICK_FALL,
      tolerance: { abs: TICK_FALL / 2 },
    }, // a tick's window under the cutoff, less that tick's fall // prettier-ignore
    ...bodyBounds(2, { holds: true }),
    ...cameraBounds(2),
  ],
});
