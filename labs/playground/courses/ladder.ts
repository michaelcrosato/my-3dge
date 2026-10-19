/**
 * @file The ladder course, `course:playground-ladder` (docs/PLAYGROUND.md §3.2, PLAN.md WP 13.7): the tower's ladder,
 * up its north face to its 6 m top. The player, empty-handed, runs at the ladder and takes hold of it, climbs at
 * 2.20 m/s (ours, tuned: the run × 0.5; Apex has no ladders) and mantles over the top, the lip within the pull's
 * reach: no grab. From the tower's top, use takes hold of the ladder's top, the feet 1 m below it, and back climbs
 * it down at 2.20 m/s until it steps off at its foot. A jump a second up the ladder pushes it away at 3.05 m/s,
 * rising 0.5 m; a crouch there lets go, and it drops to the floor. Then the bounds (labs/playground/courses/bounds.ts)
 * of each run.
 *
 * Game code (labs/playground/): it imports only the engine's public API and the playground's own files.
 *
 * @example
 * // node x feel labs/playground --course ladder
 * @see labs/playground/courses/courses.test.ts
 */
import { defineCourse } from '../../../engine';
import { bodyBounds, cameraBounds } from './bounds';

const DT = 1 / 60;

/** The ladder's numbers (ours): its speed, where use from its top puts the feet, the jump off's push and rise. */
const LADDER = { speed: 2.2035, top: 1, away: 3.048, jump: 0.5 } as const;

/** The tower's top (m). */
const TOP = 6;

/** Where the runs start: on the floor 3 m north of the ladder, and on the tower's top half a metre in from it. */
export const LADDER_STARTS = { floor: [29, 0, 57], top: [29, TOP, 60.5] } as const;

/** How long each run is (steps), and when the presses come, from each run's start. */
const [RUN, USE, OFF] = [240, 2, 90];

/** A run's start: placed at `at` facing `yaw`, nothing held. */
const start = (k: number, at: readonly number[], yaw: number) => [
  [k, { dev: 'place', args: { at, yaw, speed: 0 }, move: [0, 0], look: [yaw, 0], cam: yaw, b: [] }],
];

/** A press of `button` at step `k`, let go the step after, with `change` too. */
const press = (k: number, button: string, change: Record<string, unknown> = {}) => [
  [k, { b: [button], ...change }],
  [k + 1, { b: [] }],
];

/** Each run's bounds, under its label. */
const bounds = (k: number, label: string) => {
  const span = { to: (k + 1) * RUN - 1, label };
  return [...bodyBounds(k * RUN + 2, span), ...cameraBounds(k * RUN + 2, span)];
};

defineCourse('course:playground-ladder', {
  description: 'The ladder: taken hold of from the floor and from the top, climbed up and down at 2.20 m/s, mantled over at the top, jumped off and let go of (docs/PLAYGROUND.md §3.2).', // prettier-ignore
  scene: 'playground:gym',
  steps: RUN * 4,
  inputs: [
    ...start(0, LADDER_STARTS.floor, 0),
    [1, { move: [0, 1] }],
    ...start(RUN, LADDER_STARTS.top, Math.PI),
    ...press(RUN + USE, 'interact'),
    [RUN + USE + 1, { move: [0, -1], b: [] }],
    ...start(2 * RUN, LADDER_STARTS.floor, 0),
    [2 * RUN + 1, { move: [0, 1] }],
    ...press(2 * RUN + OFF, 'jump', { move: [0, 0] }),
    ...start(3 * RUN, LADDER_STARTS.floor, 0),
    [3 * RUN + 1, { move: [0, 1] }],
    ...press(3 * RUN + OFF, 'crouch', { move: [0, 0] }),
  ],
  measures: [
    { name: 'takes hold running in, climbs to where the top’s pull takes over', metric: 'duration', until: 'onLadder', from: 2, to: RUN - 1, reference: (TOP - 1.0668 + 0.011) / LADDER.speed, tolerance: { ticks: 2 } }, // prettier-ignore
    { name: 'climbs at 2.20 m/s', metric: 'topRise', from: 2, to: RUN - 1, reference: LADDER.speed, tolerance: { share: 0.02 } }, // prettier-ignore
    { name: 'the top: pulled over, no grab', metric: 'duration', until: 'grabbing', from: 2, to: RUN - 1, reference: 0, tolerance: { ticks: 0 } }, // prettier-ignore
    { name: 'stands on the tower’s top', metric: 'standHeight', from: 2, to: RUN - 1, reference: TOP, tolerance: { abs: 0.02 } }, // prettier-ignore
    { name: 'use takes hold from the top', metric: 'time', until: 'onLadder', from: RUN + USE, to: 2 * RUN - 1, reference: DT, tolerance: { ticks: 0 } }, // prettier-ignore
    { name: 'its feet 1 m below the top', metric: 'heightAt', until: 'onLadder', from: RUN + USE, to: 2 * RUN - 1, reference: TOP - LADDER.top, tolerance: { abs: 0.02 } }, // prettier-ignore
    { name: 'climbs down at 2.20 m/s', metric: 'topFall', from: RUN + USE + 2, to: 2 * RUN - 1, reference: LADDER.speed, tolerance: { share: 0.02 } }, // prettier-ignore
    { name: 'down to its foot', metric: 'duration', until: 'onLadder', from: RUN + USE, to: 2 * RUN - 1, reference: DT + (TOP - LADDER.top) / LADDER.speed, tolerance: { ticks: 1 } }, // prettier-ignore
    { name: 'steps off onto the floor', metric: 'height', from: RUN + USE, to: 2 * RUN - 1, reference: 0, tolerance: { abs: 0.02 } }, // prettier-ignore
    { name: 'a jump pushes it away', metric: 'speed', from: 2 * RUN + OFF + 1, to: 2 * RUN + OFF + 1, reference: LADDER.away, tolerance: { share: 0.02 } }, // prettier-ignore
    { name: 'rising 0.5 m', metric: 'apex', from: 2 * RUN + OFF, to: 2 * RUN + OFF + 40, reference: LADDER.jump, tolerance: { abs: 0.02 } }, // prettier-ignore
    { name: 'a crouch lets go', metric: 'height', from: 3 * RUN + OFF, to: 4 * RUN - 1, reference: 0, tolerance: { abs: 0.02 } }, // prettier-ignore
    { name: 'falling straight down', metric: 'distance', from: 3 * RUN + OFF, to: 4 * RUN - 1, reference: 0, tolerance: { abs: 0.02 } }, // prettier-ignore
    ...bounds(0, 'up'),
    ...bounds(1, 'down'),
    ...bounds(2, 'jump off'),
    ...bounds(3, 'let go'),
  ],
});
