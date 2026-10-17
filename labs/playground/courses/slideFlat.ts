/**
 * @file The flat slide course, `course:playground-slide-flat` (docs/PLAYGROUND.md §3.2, PLAN.md WP 13.5): the player,
 * empty-handed, sprints south down the open lane beside the sprint strip and slides four times: a boosted slide let
 * go fast, two inside the boost's cooldown, and a boosted one held to its end; its numbers against §3.2's, then the
 * bounds (labs/playground/courses/bounds.ts).
 *
 * The references, from §3.2's rules (the holstered sprint 7.59 m/s; the boost +3.81 × 1.15 m/s, capped at
 * 10.16 × 1.15; the slide's friction 2.54 m/s² with crouch held, 10.16 let go, then × 0.7 a second; the end below
 * 3.18 m/s; the cooldown 2 s from each slide's start), stepped at 60 Hz as a tick orders them (the friction, then the
 * decay):
 * - the boosted slide starts at 11.6 m/s, §3.2's own measurement from a holstered sprint;
 * - let go 20 ticks in (at 9.58 m/s, over 8.89) it slides on, braking at 10.16 m/s²: −0.892 m/s in 4 ticks;
 * - a slide 80 ticks after a slide's start has no boost (7.51 m/s: the sprint less a tick's friction), nor one
 *   90 ticks after that (every slide restarts the 2 s);
 * - one 130 ticks later is boosted again, and held, lasts 1.70 s (102 ticks), into the crouch-walk at 2.34 m/s.
 *
 * Game code (labs/playground/): it imports only the engine's public API and the playground's own files.
 *
 * @example
 * // node x feel labs/playground --course slide-flat
 * @see labs/playground/courses/courses.test.ts
 */
import { defineCourse } from '../../../engine';
import { bodyBounds, cameraBounds } from './bounds';

/** Where the flat slides start: the open lane west of the features, facing south. */
export const SLIDE_FLAT_START = [2.25, 0, 8] as const;

/** The slides' crouch presses: a boosted one, two inside the cooldown, a boosted one again (steps). */
const SLIDES = [80, 160, 250, 380] as const;

defineCourse('course:playground-slide-flat', {
  description: 'Four slides down the open lane from a sprint: the boost and its cooldown, letting go fast, and a slide held into the crouch-walk (docs/PLAYGROUND.md §3.2).', // prettier-ignore
  scene: 'playground:gym',
  steps: 540,
  inputs: [
    [0, { dev: 'place', args: { at: SLIDE_FLAT_START, yaw: 0 } }],
    [1, { move: [0, 1], look: [0, 0], cam: 0, b: ['sprint'] }],
    [SLIDES[0], { b: ['crouch'] }],
    [SLIDES[0] + 20, { b: ['sprint'] }],
    [SLIDES[1], { b: ['crouch'] }],
    [SLIDES[1] + 2, { b: ['sprint'] }],
    [SLIDES[2], { b: ['crouch'] }],
    [SLIDES[2] + 2, { b: ['sprint'] }],
    [SLIDES[3], { b: ['crouch'] }],
  ],
  measures: [
    { name: 'sprint', metric: 'speed', from: 60, to: SLIDES[0], reference: 7.59, tolerance: { share: 0.02 } },
    { name: 'boost', metric: 'topSpeed', from: SLIDES[0] + 1, to: SLIDES[0] + 5, reference: 11.6, tolerance: { share: 0.02 } }, // prettier-ignore
    { name: 'let go fast: brakes', metric: 'speedGain', from: SLIDES[0] + 20, to: SLIDES[0] + 24, reference: -0.892, tolerance: { share: 0.05 } }, // prettier-ignore
    { name: 'no boost 80 ticks on', metric: 'topSpeed', from: SLIDES[1] + 1, to: SLIDES[1] + 2, reference: 7.51, tolerance: { share: 0.02 } }, // prettier-ignore
    { name: 'no boost 90 ticks after that', metric: 'topSpeed', from: SLIDES[2] + 1, to: SLIDES[2] + 2, reference: 7.51, tolerance: { share: 0.02 } }, // prettier-ignore
    { name: 'boost again', metric: 'topSpeed', from: SLIDES[3] + 1, to: SLIDES[3] + 5, reference: 11.6, tolerance: { share: 0.02 } }, // prettier-ignore
    { name: 'slide', metric: 'time', from: SLIDES[3], until: 'speedBelow', value: 3.175, reference: 1.7, tolerance: { ticks: 1 } }, // prettier-ignore
    { name: 'into the crouch-walk', metric: 'speed', from: 500, to: 540, reference: 2.34, tolerance: { share: 0.02 } },
    ...bodyBounds(2),
    ...cameraBounds(2),
  ],
});
