/**
 * @file The hang course, `course:playground-hang` (docs/PLAYGROUND.md §3.2, PLAN.md WP 13.6): the mantle hang. The
 * player, empty-handed, sprint-jumps at the 3 m climb wall and mantles from the air; letting go of forward in the grab
 * it hangs from the lip, the feet still, for as long as forward stays let go (a second here), then forward pulls it
 * up onto the top. Letting go of forward at the 1.5 m mantle wall hangs not at all: its lip stands lower than the
 * hang's 1.52 m over the ground below, so the grab goes on and it stands on the top. Hanging again from the 3 m wall,
 * back lets go: it drops to the ground. Then the bounds (labs/playground/courses/bounds.ts) of each run.
 *
 * Game code (labs/playground/): it imports only the engine's public API and the playground's own files.
 *
 * @example
 * // node x feel labs/playground --course hang
 * @see labs/playground/courses/courses.test.ts
 */
import { defineCourse } from '../../../engine';
import { bodyBounds, cameraBounds } from './bounds';

/** Where the runs start: at the 3 m climb wall, 2.6 m short of it, and at the 1.5 m mantle wall, 1.5 m short of it. */
export const HANG_STARTS = { high: [7, 0, 19.4], low: [15, 0, 8.5] } as const;

/** How long each run is, and how long it hangs (steps). */
const [RUN, HANG] = [170, 60];

/** When forward lets go (steps into a run: the grab under way), and the sprint and the run (m/s). */
const [LET_GO, SPRINT, SPEED] = [16, 6.604 * 1.15, 4.4069 * 1.15];

const DT = 1 / 60;

/** A run's start: placed, moving south, and its jump. */
const start = (at: number, where: readonly number[], speed: number, press: number, b: string[]) => [
  [at, { dev: 'place', args: { at: where, yaw: 0, speed }, move: [0, 1], look: [0, 0], cam: 0, b }],
  [at + press, { b: [...b, 'jump'] }],
  [at + press + 1, { b }],
];

defineCourse('course:playground-hang', {
  description: 'The mantle hang: hanging from the 3 m wall and pulling up, none where the lip is too low, and letting go (docs/PLAYGROUND.md §3.2).', // prettier-ignore
  scene: 'playground:gym',
  steps: RUN * 3,
  inputs: [
    ...start(0, HANG_STARTS.high, SPRINT, 1, ['sprint']),
    [LET_GO, { move: [0, 0] }],
    [LET_GO + HANG, { move: [0, 1] }],
    ...start(RUN, HANG_STARTS.low, SPEED, 7, []),
    [RUN + 12, { move: [0, 0] }],
    ...start(2 * RUN, HANG_STARTS.high, SPRINT, 1, ['sprint']),
    [2 * RUN + LET_GO, { move: [0, 0] }],
    [2 * RUN + LET_GO + 30, { move: [0, -1] }],
  ],
  measures: [
    { name: 'hangs', metric: 'duration', until: 'hanging', from: 2, to: RUN - 1, reference: HANG * DT, tolerance: { ticks: 0 } }, // prettier-ignore
    { name: 'holds still', metric: 'apex', from: LET_GO + 1, to: LET_GO + HANG, reference: 0, tolerance: { abs: 0.001 } }, // prettier-ignore
    { name: 'holds still across', metric: 'distance', from: LET_GO + 1, to: LET_GO + HANG, reference: 0, tolerance: { abs: 0.001 } }, // prettier-ignore
    { name: 'pulls up after', metric: 'standHeight', from: 2, to: RUN - 1, reference: 3, tolerance: { abs: 0.02 } },
    { name: 'too low: no hang', metric: 'duration', until: 'hanging', from: RUN + 2, to: 2 * RUN - 1, reference: 0, tolerance: { ticks: 0 } }, // prettier-ignore
    { name: 'too low: stands on top', metric: 'standHeight', from: RUN + 2, to: 2 * RUN - 1, reference: 1.5, tolerance: { abs: 0.02 } }, // prettier-ignore
    { name: 'lets go: hangs', metric: 'duration', until: 'hanging', from: 2 * RUN + 2, to: 3 * RUN - 1, reference: 30 * DT, tolerance: { ticks: 0 } }, // prettier-ignore
    { name: 'lets go: drops', metric: 'height', from: 2 * RUN + 2, to: 3 * RUN - 1, reference: 0, tolerance: { abs: 0.02 } }, // prettier-ignore
    ...[0, 1, 2].flatMap((k) => {
      const label = ['hang', 'too low', 'lets go'][k];
      return [...bodyBounds(k * RUN + 2, { to: (k + 1) * RUN - 1, label }), ...cameraBounds(k * RUN + 2, { to: (k + 1) * RUN - 1, label })]; // prettier-ignore
    }),
  ],
});
