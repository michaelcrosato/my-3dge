/**
 * @file The superglide courses (docs/PLAYGROUND.md §3.2, PLAN.md WP 13.6): `course:playground-superglide` sprints at
 * the 1.5 m mantle wall holding jump (the auto mantle: the grab, 27 ticks, then the pull, 18) and, in the pull's last
 * 0.15 s (its last 9 ticks), lets jump go and presses it, then presses crouch the very next tick: the superglide,
 * about 13.7 m/s out of the mantle (Apex's 540 u/s; ours 1.8 × the holstered sprint, 13.67). With the crouch a tick
 * late, on the jump's own tick, or the jump before the window, it only hops out at the sprint (still in the air 15
 * ticks after the crouch, past where a pull that never hopped would have ended on the top). The mantle boost,
 * `course:playground-mantle-boost` (its setting on): a crouch press alone in the window, let go the tick after (held,
 * the duck would tuck the feet up 0.32 m), glides at the same speed, rising a full jump, 1.42 m. Then the bounds (labs/playground/courses/bounds.ts) of each run.
 *
 * Game code (labs/playground/): it imports only the engine's public API and the playground's own files.
 *
 * @example
 * // node x feel labs/playground --course superglide,mantle-boost
 * @see labs/playground/courses/courses.test.ts
 */
import { defineCourse } from '../../../engine';
import { bodyBounds, cameraBounds } from './bounds';

/** Where every run starts: 1.5 m short of the 1.5 m mantle wall's face. */
export const GLIDE_START = [15, 0, 8.5] as const;

/** How long a run is, when it presses jump at the wall, and its pull's 13th tick, inside the window (steps). */
const [RUN, PRESS, LATE] = [120, 4, 43];

/** The sprint, holstered, and a superglide out of it (m/s; §3.2's reference, Apex's 540 u/s). */
const [SPRINT, GLIDE] = [6.604 * 1.15, 13.716];

/** Each run: its name, when (steps into it) the jump is pressed again (none: −1) and when crouch is pressed. */
const RUNS = [
  ['superglide', LATE, LATE + 1],
  ['a tick late', LATE, LATE + 2],
  ['on the jump’s tick', LATE, LATE],
  ['before the window', LATE - 8, LATE - 7],
] as const;

/**
 * One run's change-points from step `at`: placed sprinting, jump pressed at the wall (the auto mantle) and let go
 * during the grab, then jump pressed again at `jump` (none: −1) and crouch at `crouch`, each held on.
 */
function run(at: number, jump: number, crouch: number) {
  const held = (s: number) => [
    'sprint',
    ...((s >= PRESS && s < PRESS + 30) || (jump >= 0 && s >= jump) ? ['jump'] : []),
    ...(s >= crouch ? ['crouch'] : []),
  ];
  const steps = [...new Set([PRESS, PRESS + 30, crouch, ...(jump >= 0 ? [jump] : [])])].sort((a, b) => a - b);
  return [
    [at, { dev: 'place', args: { at: GLIDE_START, yaw: 0, speed: SPRINT }, move: [0, 1], look: [0, 0], cam: 0, b: held(0) }], // prettier-ignore
    ...steps.map((s) => [at + s, { b: held(s) }]),
  ];
}

defineCourse('course:playground-superglide', {
  description: 'The superglide out of the 1.5 m wall’s mantle, and three near misses (docs/PLAYGROUND.md §3.2).',
  scene: 'playground:gym',
  steps: RUN * RUNS.length,
  inputs: RUNS.flatMap(([, jump, crouch], k) => run(k * RUN, jump, crouch)),
  measures: RUNS.flatMap(([name, , crouch], k) => {
    const at = k * RUN;
    const glides = name === 'superglide';
    return [
      { name: `${name}: speed`, metric: 'speed', from: at + crouch + 2, to: at + crouch + 12, reference: glides ? GLIDE : SPRINT, tolerance: { share: 0.02 } }, // prettier-ignore
      { name: `${name}: hopped out`, metric: 'grounded', from: at + crouch + 15, to: at + crouch + 15, reference: 0, tolerance: { abs: 0 } }, // prettier-ignore
      ...bodyBounds(at + 2, { to: at + RUN - 1, label: name, holds: true }),
      ...cameraBounds(at + 2, { to: at + RUN - 1, label: name }),
    ];
  }),
});

defineCourse('course:playground-mantle-boost', {
  description: 'The mantle boost, Apex’s one-button superglide, its setting on: a crouch press in the pull’s window (docs/PLAYGROUND.md §3.2).', // prettier-ignore
  scene: 'playground:gym',
  settings: { 'movement.mantle.boost': true },
  steps: RUN,
  inputs: [...run(0, -1, LATE), [LATE + 1, { b: ['sprint'] }]], // crouch let go: no duck tucks the feet up
  measures: [
    { name: 'speed', metric: 'speed', from: LATE + 2, to: LATE + 12, reference: GLIDE, tolerance: { share: 0.02 } },
    { name: 'rise', metric: 'apex', from: LATE, to: RUN - 1, reference: 1.4224, tolerance: { abs: 0.02 } },
    ...bodyBounds(2, { to: RUN - 1, holds: true }),
    ...cameraBounds(2, { to: RUN - 1 }),
  ],
});
