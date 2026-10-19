/**
 * @file The climb course, `course:playground-climb` (docs/PLAYGROUND.md §3.2, PLAN.md WP 13.6): the player,
 * empty-handed, sprints at each of the gym's climb walls and jumps 2.6 m short of its face, holding forward. The 3 m
 * wall is mantled straight from the jump; the 4 to 6.9 m walls are climbed, at up to 5.72 m/s, and topped out into
 * the mantle; the 6.9 m wall (Apex's highest ledge, 6.93 m) only by the end boost, the climb having caught high
 * enough (1.36 m up) that the climb space's cutoff, 3.73 m over the last ground, ends it: 0.71 m higher the lip is in
 * the mantle's reach; the 7.2 m wall is past it, the boost's apex 4.44 m, and it falls back. Then three jumps off the
 * 6 m wall, one from each zone of the climb space: from the mini zone (a jump at the wall, caught at once) 0.72 m up and
 * 4.78 m/s away; from low in the green zone (caught 0.64 m up from a jump 1.2 m short) a big lift, 6.55 m/s away; from
 * the neutral zone (2 m up) 6.55 m/s away, keeping only the climb's rise. Then the bounds
 * (labs/playground/courses/bounds.ts) of each run, every camera's kept topping out since WP 13.8 (the chase camera that
 * stood in for the shooter's jumped 1.1 to 1.2 m a frame there).
 *
 * The green zone's lift is ours (a full jump at the zone's foot, falling to none at its top: the measures say only
 * that it falls): caught at 0.645 m and jumping off from there the tick after, it rises 1.4224 × (1.1938 − 0.645) /
 * 0.7112 = 1.098 m. The neutral zone's rise is the climb's own, 5.715² / 2g = 0.857 m. The mini run walks up to the
 * wall from 0.34 m off it and jumps there, so it catches the wall at once.
 *
 * Game code (labs/playground/): it imports only the engine's public API and the playground's own files.
 *
 * @example
 * // node x feel labs/playground --course climb
 * @see labs/playground/courses/courses.test.ts
 */
import { defineCourse } from '../../../engine';
import { bodyBounds, cameraBounds } from './bounds';

/** Each climb: its wall's height (m) and the x of its middle; each starts at z 19.4, 2.6 m short of the faces. */
export const CLIMB_RUNS = [
  [3, 7],
  [4, 11],
  [5, 15],
  [6, 19],
  [6.9, 23],
  [7.2, 27],
] as const;

/** Each bounce off the 6 m wall: its zone, where it starts (z), its speed (m/s), and when it jumps and jumps off. */
export const BOUNCE_RUNS = [
  ['mini', 21.25, 0, 8, 10],
  ['green', 20.8, 6.604 * 1.15, 1, 7],
  ['neutral', 19.4, 6.604 * 1.15, 1, 25],
] as const;

/** How long each run is (steps), and the sprint, holstered (m/s). */
const [RUN, SPRINT] = [170, 6.604 * 1.15];

/** Where the bounces start (steps). */
const BOUNCES = RUN * CLIMB_RUNS.length;

/** What each bounce measures: its speed away (m/s) and its rise from where it jumps off (m). */
const BOUNCE_REFS = { mini: [4.7752, 0.7165], green: [6.5532, 1.098], neutral: [6.5532, 0.857] } as const;

defineCourse('course:playground-climb', {
  description: 'Each climb wall climbed from a sprint jump and topped out, the highest by the end boost, the tallest refused; a wall-bounce from each zone (docs/PLAYGROUND.md §3.2).', // prettier-ignore
  scene: 'playground:gym',
  steps: BOUNCES + RUN * BOUNCE_RUNS.length,
  inputs: [
    ...CLIMB_RUNS.flatMap(([, x], k) => [
      [k * RUN, { dev: 'place', args: { at: [x, 0, 19.4], yaw: 0, speed: SPRINT }, move: [0, 1], look: [0, 0], cam: 0, b: ['sprint'] }], // prettier-ignore
      [k * RUN + 1, { b: ['sprint', 'jump'] }],
      [k * RUN + 2, { b: ['sprint'] }],
    ]),
    ...BOUNCE_RUNS.flatMap(([, z, speed, jump, off], k) => {
      const at = BOUNCES + k * RUN;
      return [
        [at, { dev: 'place', args: { at: [19, 0, z], yaw: 0, speed }, move: [0, 1], look: [0, 0], cam: 0, b: ['sprint'] }], // prettier-ignore
        [at + jump, { b: ['sprint', 'jump'] }],
        [at + jump + 1, { b: ['sprint'] }],
        [at + off, { move: [0, 0], b: ['jump'] }],
        [at + off + 1, { b: [] }],
      ] as const;
    }),
  ],
  measures: [
    ...CLIMB_RUNS.flatMap(([height], k) => {
      const at = k * RUN;
      const label = `${height} m`;
      const span = { from: at + 2, to: at + RUN - 1 };
      const refused = height > 6.93;
      return [
        { name: `${label}: stands on top`, metric: 'standHeight', ...span, reference: refused ? 0 : height, tolerance: { abs: 0.02 } }, // prettier-ignore
        ...(height >= 5 ? [{ name: `${label}: climbs at`, metric: 'topRise', from: at + 20, to: at + RUN - 1, reference: 5.715, tolerance: { share: 0.02 } }] : []), // prettier-ignore
        ...(refused ? [{ name: `${label}: the end boost's apex`, metric: 'apex', from: at + 1, to: at + RUN - 1, reference: 3.7338 + 0.7112, tolerance: { abs: 0.02 } }] : []), // prettier-ignore
        ...bodyBounds(at + 2, { to: at + RUN - 1, label }),
        ...cameraBounds(at + 2, { to: at + RUN - 1, label }),
      ];
    }),
    ...BOUNCE_RUNS.flatMap(([zone, , , , off], k) => {
      const at = BOUNCES + k * RUN;
      const [away, rise] = BOUNCE_REFS[zone];
      const label = `bounce: ${zone}`;
      return [
        { name: `${label}: away`, metric: 'speed', from: at + off + 2, to: at + off + 10, reference: away, tolerance: { share: 0.02 } }, // prettier-ignore
        { name: `${label}: rise`, metric: 'apex', from: at + off, to: at + off + 60, reference: rise, tolerance: { abs: 0.02 } }, // prettier-ignore
        ...bodyBounds(at + 2, { to: at + RUN - 1, label }),
        ...cameraBounds(at + 2, { to: at + RUN - 1, label }),
      ];
    }),
  ],
});
