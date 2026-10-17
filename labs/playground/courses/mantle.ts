/**
 * @file The mantle course, `course:playground-mantle` (docs/PLAYGROUND.md §3.2, PLAN.md WP 13.6): the player,
 * empty-handed, runs at each of the gym's mantle walls from 1.5 m short of its face, pressing and holding jump once its
 * hull is within the ledge probe's 0.61 m of it, on the ground: Apex's auto mantle. The 0.5 m wall is a step it runs
 * up (Apex's 22 u, 0.56 m), no mantle; the 1 m wall is only pulled over (the pull, 0.3 s: no higher than 42 u,
 * 1.07 m); the 1.5 and 2 m walls take the grab (0.45 s) and then the pull, the 2 m wall at once from the ground; the
 * 2.1 m wall is past the auto mantle's 2.03 m, so the press jumps and it mantles from the air the tick after. Each run
 * stands on its wall's top and leaves it at the run. Then the bounds (labs/playground/courses/bounds.ts) of each run.
 *
 * Game code (labs/playground/): it imports only the engine's public API and the playground's own files.
 *
 * @example
 * // node x feel labs/playground --course mantle
 * @see labs/playground/courses/courses.test.ts
 */
import { defineCourse } from '../../../engine';
import { bodyBounds, cameraBounds } from './bounds';

/** Each run: its wall's height (m) and the x of its middle; each starts at z 8.5, 1.5 m short of the walls' faces. */
export const MANTLE_RUNS = [
  [0.5, 7],
  [1, 11],
  [1.5, 15],
  [2, 19],
  [2.1, 23],
] as const;

/** How long each run is (steps), when it presses jump (steps into it: 0.51 m short), and the run's speed (m/s). */
const [RUN, PRESS, SPEED] = [110, 7, 4.4069 * 1.15];

/** The ticks of the grab and the pull at 60 Hz. */
const [GRAB, PULL] = [27, 18];

const DT = 1 / 60;

defineCourse('course:playground-mantle', {
  description: 'The auto mantle at each mantle wall: a step, a pull, the grab and the pull, and a wall past its reach (docs/PLAYGROUND.md §3.2).', // prettier-ignore
  scene: 'playground:gym',
  steps: RUN * MANTLE_RUNS.length,
  inputs: MANTLE_RUNS.flatMap(([height, x], k) => [
    [k * RUN, { dev: 'place', args: { at: [x, 0, 8.5], yaw: 0, speed: SPEED }, move: [0, 1], look: [0, 0], cam: 0, b: [] }], // prettier-ignore
    [k * RUN + PRESS, { b: height === 0.5 ? [] : ['jump'] }],
  ]),
  measures: MANTLE_RUNS.flatMap(([height], k) => {
    const at = k * RUN;
    const label = `${height} m`;
    const span = { from: at + 2, to: at + RUN - 1 };
    const exit = at + PRESS + (height === 2.1 ? 1 : 0) + (height > 1.0668 ? GRAB : 0) + PULL;
    const mantled =
      height === 0.5
        ? []
        : [
            { name: `${label}: pull`, metric: 'duration', until: 'pulling', ...span, reference: PULL * DT, tolerance: { ticks: 0 } }, // prettier-ignore
            { name: `${label}: grab`, metric: 'duration', until: 'grabbing', ...span, reference: height > 1.0668 ? GRAB * DT : 0, tolerance: { ticks: 0 } }, // prettier-ignore
            { name: `${label}: runs on`, metric: 'speed', from: exit + 2, to: exit + 12, reference: 5.07, tolerance: { share: 0.02 } }, // prettier-ignore
          ];
    return [
      { name: `${label}: stands on top`, metric: 'standHeight', ...span, reference: height, tolerance: { abs: 0.02 } },
      ...(height === 0.5 ? [{ name: `${label}: no mantle`, metric: 'duration', until: 'mantling', ...span, reference: 0, tolerance: { ticks: 0 } }] : []), // prettier-ignore
      ...(height >= 2 ? [{ name: `${label}: mantles after`, metric: 'time', until: 'mantling', from: at + PRESS, to: at + PRESS + 4, reference: (height === 2 ? 1 : 2) * DT, tolerance: { ticks: 0 } }] : []), // prettier-ignore
      ...mantled,
      ...bodyBounds(at + 2, { to: at + RUN - 1, label }),
      ...cameraBounds(at + 2, { to: at + RUN - 1, label }),
    ];
  }),
});
