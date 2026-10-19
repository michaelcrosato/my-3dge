/**
 * @file The launcher course, `course:playground-launcher` (docs/PLAYGROUND.md §2.3, PLAN.md WP 13.7): the gym's jump
 * pad and trampoline (labs/playground/levels/gym.ts). The player, empty-handed, runs onto the jump pad: it throws it
 * 6.5 m up, keeping its run across. Standing on the trampoline's mat, 0.5 m up, it is thrown 2 m above the mat, again
 * and again. Jumping off the tower's top, walking west, it falls from the jump's apex (6 + 1.42 m) onto the mat and
 * bounces back 0.9 of the speed it fell in at: 0.81 of the fall, 5.61 m above the mat, looking down at it once it has
 * jumped (the shooter's camera looks where the player aims). (Walking off the edge, the
 * capsule rolls over the corner, 17 cm down, before it falls: a jump falls from a height known to the millimetre.)
 * Then the bounds (labs/playground/courses/bounds.ts) of each run.
 *
 * Game code (labs/playground/): it imports only the engine's public API and the playground's own files.
 *
 * @example
 * // node x feel labs/playground --course launcher
 * @see labs/playground/courses/courses.test.ts
 */
import { defineCourse } from '../../../engine';
import { GYM_LAUNCHERS } from '../levels/gym';
import { bodyBounds, cameraBounds } from './bounds';

/** The pad and the trampoline: where their tops are (m), the heights they throw to, the trampoline's bounce. */
const [PAD, TRAMPOLINE] = GYM_LAUNCHERS;

/** Apex's holstered run (m/s). */
const RUN_SPEED = 4.4069 * 1.15;

/** The tower's top (m), which the third run jumps off onto the trampoline, and Apex's jump (m). */
const [TOWER, JUMP] = [6, 1.4224];

/** Where the runs start: 2.75 m north of the pad; on the trampoline's mat; on the tower's top, 0.5 m in from its west edge. */ // prettier-ignore
export const LAUNCHER_STARTS = {
  pad: [PAD.at[0], 0, PAD.at[2] - 2.75],
  mat: TRAMPOLINE.at,
  tower: [27.5, TOWER, TRAMPOLINE.at[2]],
} as const;

/** How long each run is (steps). */
const RUN = 240;

/** How far down the drop looks once it has jumped, rad: at the mat, as a player would, so the shooter's camera (its view the aim) sees it land. */ // prettier-ignore
const LOOK_DOWN = -0.9;

/** A run's start: placed at `at` facing `yaw`, nothing held. */
const start = (k: number, at: readonly number[], yaw: number) => [
  [k, { dev: 'place', args: { at, yaw, speed: 0 }, move: [0, 0], look: [yaw, 0], cam: yaw, b: [] }],
];

/** Each run's bounds, under its label. */
const bounds = (k: number, label: string) => {
  const span = { to: (k + 1) * RUN - 1, label };
  return [...bodyBounds(k * RUN + 2, span), ...cameraBounds(k * RUN + 2, span)];
};

defineCourse('course:playground-launcher', {
  description: 'Launchers: the jump pad’s 6.5 m, the trampoline’s 2 m, and its bounce back from a fall onto it (docs/PLAYGROUND.md §2.3).', // prettier-ignore
  scene: 'playground:gym',
  steps: RUN * 3,
  inputs: [
    ...start(0, LAUNCHER_STARTS.pad, 0),
    [1, { move: [0, 1] }],
    [40, { move: [0, 0] }],
    ...start(RUN, LAUNCHER_STARTS.mat, 0),
    ...start(2 * RUN, LAUNCHER_STARTS.tower, -Math.PI / 2),
    [2 * RUN + 1, { move: [-1, 0], b: ['walk'] }],
    [2 * RUN + 4, { b: ['jump', 'walk'] }],
    [2 * RUN + 10, { move: [0, 0], look: [-Math.PI / 2, LOOK_DOWN], b: [] }],
  ],
  measures: [
    { name: 'the jump pad throws 6.5 m', metric: 'top', from: 1, to: RUN - 1, reference: PAD.height, tolerance: { abs: 0.02 } }, // prettier-ignore
    { name: 'keeping its run across', metric: 'speed', from: 35, to: 90, reference: RUN_SPEED, tolerance: { share: 0.02 } }, // prettier-ignore
    { name: 'the trampoline throws 2 m over its mat', metric: 'top', from: RUN + 1, to: RUN + 60, reference: TRAMPOLINE.at[1] + TRAMPOLINE.height, tolerance: { abs: 0.02 } }, // prettier-ignore
    { name: 'again and again', metric: 'top', from: RUN + 61, to: 2 * RUN - 1, reference: TRAMPOLINE.at[1] + TRAMPOLINE.height, tolerance: { abs: 0.02 } }, // prettier-ignore
    { name: 'bounces 0.9 of a fall from the jump’s apex back', metric: 'top', from: 2 * RUN + 85, to: 2 * RUN + 200, reference: TRAMPOLINE.at[1] + TRAMPOLINE.bounce ** 2 * (TOWER + JUMP - TRAMPOLINE.at[1]), tolerance: { abs: 0.02 } }, // prettier-ignore
    ...bounds(0, 'pad'),
    ...bounds(1, 'trampoline'),
    ...bounds(2, 'drop'),
  ],
});
