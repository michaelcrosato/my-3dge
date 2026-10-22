/**
 * @file The steps-and-slopes course, `course:playground-steps` (docs/PLAYGROUND.md §2.3 and §3.2, PLAN.md WP 13.18):
 * the player, empty-handed, runs south up the gym's stairs (four 0.25 m risers, each step 1 m deep, to 1 m), up the
 * slope test at 45°, just inside the walkable limit of 45.57°, to its deck 4 m up, and at the one at 51°, past it,
 * which it never stands on. Its numbers against §3.2's (steps up to 0.56 m climbed at the run's speed; walkable up to
 * 45.57°), then the bounds (labs/playground/courses/bounds.ts) of each run.
 *
 * Game code (labs/playground/): it imports only the engine's public API and the playground's own files.
 *
 * @example
 * // node x feel labs/playground --course steps
 * @see labs/playground/courses/courses.test.ts
 */
import { defineCourse } from '../../../engine';
import { bodyBounds, cameraBounds } from './bounds';

/** The run, holstered (m/s). */
const RUN_SPEED = 4.4069 * 1.15;

/** How long each run is (steps). */
const RUN = 160;

/** Each run: its name, its start 4 m north of the feature's foot (z 60), and the height it stands at (m). */
export const STEP_RUNS = [
  ['stairs', [7.5, 0, 56], 1],
  ['slope 45°', [14.5, 0, 56], 4],
  ['slope 51°', [21.5, 0, 56], 0],
] as const;

defineCourse('course:playground-steps', {
  description: 'Up the stairs’ 0.25 m risers at the run’s speed, up the 45° slope to its deck, and refused by the 51° one (docs/PLAYGROUND.md §2.3, §3.2).', // prettier-ignore
  scene: 'playground:gym',
  steps: RUN * STEP_RUNS.length,
  inputs: STEP_RUNS.map(([, at], k) => [k * RUN, { dev: 'place', args: { at, yaw: 0, speed: RUN_SPEED }, move: [0, 1], look: [0, 0], cam: 0, b: [] }]), // prettier-ignore
  measures: STEP_RUNS.flatMap(([name, , height], k) => {
    const span = { to: (k + 1) * RUN - 1, label: name };
    return [
      { name: `${name}: stands at`, metric: 'standHeight', from: k * RUN + 2, to: span.to, reference: height, tolerance: { abs: 0.02 } }, // prettier-ignore
      ...(name === 'stairs' ? [{ name: 'stairs: keeps the run’s speed', metric: 'speed', from: k * RUN + 48, to: k * RUN + 92, reference: RUN_SPEED, tolerance: { share: 0.02 } }] : []), // prettier-ignore
      ...bodyBounds(k * RUN + 2, span),
      ...cameraBounds(k * RUN + 2, span),
    ];
  }),
});
