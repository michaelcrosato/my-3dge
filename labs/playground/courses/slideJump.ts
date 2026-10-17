/**
 * @file The slide-jump course, `course:playground-slide-jump` (docs/PLAYGROUND.md §3.2, PLAN.md WP 13.5): the player,
 * empty-handed, sprints south down the open lane, slides, and jumps out of the slide three times: once its crouch is
 * down, once while it is still going down (a dead slide), and once as the slide slows through the long jump's band;
 * each run's numbers against §3.2's, then each run's bounds (labs/playground/courses/bounds.ts).
 *
 * The references, from §3.2's rules stepped at 60 Hz (the boost to 10.16 × 1.15 m/s; the friction 2.54 m/s² then
 * × 0.7 a second; a slide's crouch goes down in 0.2 s; the slide-jump 1.27 m high, keeping its speed, there being no
 * air friction; a boost jumped while its crouch still goes down is taken back; a boosted slide jumped between 0.85 of
 * 8.89 m/s and 8.89 m/s jumps at 8.89):
 * - jumped 16 ticks in, its crouch down, it rises 1.27 m and flies at the slide's 9.98 m/s;
 * - jumped 4 ticks in, the boost (4.09 m/s) comes back off: it flies at 7.15 m/s;
 * - jumped 30 ticks in, at 8.62 m/s, it flies at 8.89 m/s (the long jump).
 *
 * Game code (labs/playground/): it imports only the engine's public API and the playground's own files.
 *
 * @example
 * // node x feel labs/playground --course slide-jump
 * @see labs/playground/courses/courses.test.ts
 */
import { defineCourse } from '../../../engine';
import { bodyBounds, cameraBounds } from './bounds';

/** Each run: where it starts on the open lane (z), and how many ticks into its slide it jumps. */
export const SLIDE_JUMPS = [
  [8, 16],
  [40, 4],
  [66, 30],
] as const;

/** How long each run is (steps), when its slide starts (steps into the run) and how long a jump is held (steps). */
const [RUN, SLIDE, HOLD] = [200, 80, 6];

/** The runs' change-points: placed, sprinting, sliding, jumping out of it and letting the jump go. */
const inputs = SLIDE_JUMPS.flatMap(([z, after], k) => {
  const at = k * RUN;
  return [
    [at, { dev: 'place', args: { at: [2.25, 0, z], yaw: 0 } }],
    [at + 1, { move: [0, 1], look: [0, 0], cam: 0, b: ['sprint'] }],
    [at + SLIDE, { b: ['crouch'] }],
    [at + SLIDE + after, { b: ['crouch', 'jump'] }],
    [at + SLIDE + after + HOLD, { b: ['crouch'] }],
  ] as const;
});

/** Each run's flight: from the jump to just before it lands (a 1.27 m jump flies 0.73 s). */
const flight = (k: number) => {
  const jump = k * RUN + SLIDE + SLIDE_JUMPS[k][1];
  return { from: jump + 2, to: jump + 40 };
};

defineCourse('course:playground-slide-jump', {
  description: 'Jumps out of a slide: its height and speed, a dead slide giving its boost back, and the long jump (docs/PLAYGROUND.md §3.2).', // prettier-ignore
  scene: 'playground:gym',
  steps: RUN * SLIDE_JUMPS.length,
  inputs,
  measures: [
    { name: 'slide-jump: height', metric: 'apex', from: SLIDE + 16, to: SLIDE + 70, reference: 1.27, tolerance: { abs: 0.02 } }, // prettier-ignore
    { name: 'slide-jump: keeps its speed', metric: 'speed', ...flight(0), reference: 9.98, tolerance: { share: 0.02 } }, // prettier-ignore
    { name: 'dead slide: the boost back off', metric: 'speed', ...flight(1), reference: 7.15, tolerance: { share: 0.02 } }, // prettier-ignore
    { name: 'long jump', metric: 'speed', ...flight(2), reference: 8.89, tolerance: { share: 0.02 } },
    ...SLIDE_JUMPS.flatMap((_, k) => {
      const span = { to: (k + 1) * RUN - 1, label: `run ${k + 1}` };
      return [...bodyBounds(k * RUN + 2, span), ...cameraBounds(k * RUN + 2, span)];
    }),
  ],
});
