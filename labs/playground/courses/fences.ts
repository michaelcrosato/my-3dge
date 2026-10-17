/**
 * @file The fences course, `course:playground-fences` (docs/PLAYGROUND.md §3.2, PLAN.md WP 13.6): the player,
 * empty-handed, sprints at each of the gym's fences (half a metre thick) from 1.5 m short of its face, pressing and
 * holding jump once within the ledge probe of it: Apex has no vault, so a fence is mantled over. The 0.6 and 0.9 m
 * fences are only pulled over (0.3 s), the 1.2 m one takes the grab (0.45 s) first; each leaves at the sprint,
 * 1.15 × 6.60 m/s, over the fence and down the far side, sprinting on. Then the bounds
 * (labs/playground/courses/bounds.ts) of each run.
 *
 * Game code (labs/playground/): it imports only the engine's public API and the playground's own files.
 *
 * @example
 * // node x feel labs/playground --course fences
 * @see labs/playground/courses/courses.test.ts
 */
import { defineCourse } from '../../../engine';
import { bodyBounds, cameraBounds } from './bounds';

/** Each run: its fence's height (m) and the x of its middle; each starts at z 14.5, 1.5 m short of the faces. */
export const FENCE_RUNS = [
  [0.6, 7.5],
  [0.9, 13.5],
  [1.2, 19.5],
] as const;

/** How long each run is (steps), when it presses jump (steps into it: 0.46 m short), and the sprint (m/s). */
const [RUN, PRESS, SPRINT] = [90, 5, 6.604 * 1.15];

/** The ticks of the grab and the pull at 60 Hz. */
const [GRAB, PULL] = [27, 18];

const DT = 1 / 60;

defineCourse('course:playground-fences', {
  description: 'Each fence mantled over at a sprint, only pulled over the low ones, sprinting out (docs/PLAYGROUND.md §3.2).', // prettier-ignore
  scene: 'playground:gym',
  steps: RUN * FENCE_RUNS.length,
  inputs: FENCE_RUNS.flatMap(([, x], k) => [
    [k * RUN, { dev: 'place', args: { at: [x, 0, 14.5], yaw: 0, speed: SPRINT }, move: [0, 1], look: [0, 0], cam: 0, b: ['sprint'] }], // prettier-ignore
    [k * RUN + PRESS, { b: ['sprint', 'jump'] }],
  ]),
  measures: FENCE_RUNS.flatMap(([height], k) => {
    const at = k * RUN;
    const label = `${height} m`;
    const span = { from: at + 2, to: at + RUN - 1 };
    const grab = height > 1.0668 ? GRAB : 0;
    const exit = at + PRESS + grab + PULL + 1;
    return [
      { name: `${label}: pull`, metric: 'duration', until: 'pulling', ...span, reference: PULL * DT, tolerance: { ticks: 0 } }, // prettier-ignore
      { name: `${label}: grab`, metric: 'duration', until: 'grabbing', ...span, reference: grab * DT, tolerance: { ticks: 0 } }, // prettier-ignore
      { name: `${label}: sprints out`, metric: 'speed', from: exit + 1, to: exit + 30, reference: SPRINT, tolerance: { share: 0.02 } }, // prettier-ignore
      ...bodyBounds(at + 2, { to: at + RUN - 1, label }),
      ...cameraBounds(at + 2, { to: at + RUN - 1, label }),
    ];
  }),
});
