/**
 * @file The gaps course, `course:playground-gaps` (docs/PLAYGROUND.md §2.3 and §3.2, PLAN.md WP 13.18): the jump's
 * reach on the gym's lane of gaps, its platforms 1.5 m up and 3 m long. The player, empty-handed, is placed on a
 * platform moving south and takes off at its edge: running across the 3 m gap, sprinting across the 5 m one,
 * slide-jumping across the 7 m one; then, from the 4 m gap's floor, it sprints at the next platform's face and
 * superglides out of the mantle, over that platform and the 5 m gap past it. Each lands on the far platform: its
 * flight (a jump's air time, the superglide's rise) and its speed across against §3.2's, and the height it next
 * stands at, the far platform's. Then the bounds (labs/playground/courses/bounds.ts) of each run.
 *
 * The references, from §3.2's rules: a jump flies 2 × 7.36 / 19.05 = 0.772 s, at the run's 5.07 m/s (3.9 m, past the
 * 3 m gap) or the sprint's 7.59 m/s (5.9 m, past 5 m); a slide-jump, its crouch held, rises 1.27 m and flies 0.730 s
 * at the slide's speed, 10.08 m/s 15 ticks into a boosted slide (the slide-jump course's 9.98 at 16, a tick's friction
 * less; the 3 m platform leaves no room for a 16th), 7.4 m, past 7 m; a superglide rises
 * the same 1.27 m from where its hop has lifted it, at 13.7 m/s, so at the platforms' height it flies 0.730 s and
 * 10.0 m: its reach across the 9 m gap, but the lane has no wall before a gap to mantle, so a superglide here carries
 * the platform it mantled onto, 3 m, and clears the 5 m gap after it.
 *
 * A place lands the player (engine/sim/actors.ts `placeActor` sets it a skin over the floor), and a jump faster than
 * the sprint within the bunny hop's window after a landing loses 2.54 m/s; a 3 m platform leaves no room for a run-up
 * of 1 s, so the course takes §3.2's contested 0.1 s window (`movement.hop.window`): the slide-jump then jumps as one
 * from a run-up would. The hop's cost itself is the air course's (labs/playground/courses/air.ts).
 *
 * Game code (labs/playground/): it imports only the engine's public API and the playground's own files.
 *
 * @example
 * // node x feel labs/playground --course gaps
 * @see labs/playground/courses/courses.test.ts
 */
import { defineCourse } from '../../../engine';
import { bodyBounds, cameraBounds } from './bounds';

/** The run and the sprint, holstered, a slide-jump 15 ticks in, and a superglide (m/s); the platforms' height (m). */
const [RUN_SPEED, SPRINT, SLIDE_JUMP, GLIDE, TOP] = [4.4069 * 1.15, 6.604 * 1.15, 10.08, 13.716, 1.5];

/** A jump's flight from take-off to landing at the same height (s): 2v / g. */
const FLIGHT = (2 * Math.sqrt(2 * 19.05 * 1.42)) / 19.05;

/** How long each run is (steps). */
const RUN = 150;

/** One run on the lane (see the file comment). */
interface GapRun {
  name: string;
  /** Where it is placed, on the lane's middle (m), how fast (m/s), and the buttons it holds. */
  at: readonly [number, number, number];
  speed: number;
  held: readonly string[];
  /** Its buttons from each step into the run. */
  changes: readonly (readonly [number, readonly string[]])[];
  /** The step its take-off is pressed at, then its speed across (m/s), and its air time (s) or its rise (m). */
  off: number;
  across: number;
  flight?: number;
  rise?: number;
}

/** The course's runs, north to south along the lane (see the file comment). */
export const GAP_RUNS: readonly GapRun[] = [
  { name: 'run: 3 m', at: [36, TOP, 20.5], speed: RUN_SPEED, held: [], changes: [[29, ['jump']], [35, []]], off: 29, across: RUN_SPEED, flight: FLIGHT }, // prettier-ignore
  { name: 'sprint: 5 m', at: [36, TOP, 33.5], speed: SPRINT, held: ['sprint'], changes: [[19, ['sprint', 'jump']], [25, ['sprint']]], off: 19, across: SPRINT, flight: FLIGHT }, // prettier-ignore
  { name: 'slide-jump: 7 m', at: [36, TOP, 50.05], speed: SPRINT, held: ['sprint'], changes: [[2, ['sprint', 'crouch']], [17, ['crouch', 'jump']], [23, ['crouch']]], off: 17, across: SLIDE_JUMP, flight: (2 * Math.sqrt(2 * 19.05 * 1.27)) / 19.05 }, // prettier-ignore
  // The superglide course's timing (labs/playground/courses/superglide.ts): jump held into the mantle and let go, the
  // hop in the pull's window, crouch the tick after, let go the tick after that (held, the duck tucks the feet up).
  { name: 'superglide: 3 + 5 m', at: [36, 0, 31.5], speed: SPRINT, held: ['sprint'], changes: [[4, ['sprint', 'jump']], [34, ['sprint']], [43, ['sprint', 'jump']], [44, ['sprint', 'jump', 'crouch']], [45, ['sprint', 'jump']], [50, ['sprint']]], off: 43, across: GLIDE, rise: 1.27 }, // prettier-ignore
];

defineCourse('course:playground-gaps', {
  description: 'The jump’s reach across the lane of gaps: running 3 m, sprinting 5 m, slide-jumping 7 m, and a superglide over a platform and the 5 m gap (docs/PLAYGROUND.md §2.3, §3.2).', // prettier-ignore
  scene: 'playground:gym',
  settings: { 'movement.hop.window': 0.1 },
  steps: RUN * GAP_RUNS.length,
  inputs: GAP_RUNS.flatMap(({ at, speed, held, changes }, k) => [
    [k * RUN, { dev: 'place', args: { at, yaw: 0, speed }, move: [0, 1], look: [0, 0], cam: 0, b: [...held] }],
    ...changes.map(([step, b]) => [k * RUN + step, { b: [...b] }]),
  ]),
  measures: GAP_RUNS.flatMap(({ name, off, across, flight, rise }, k) => {
    const at = k * RUN + off;
    const span = { to: (k + 1) * RUN - 1, label: name };
    return [
      flight === undefined
        ? { name: `${name}: rises`, metric: 'apex', from: at + 1, to: at + 40, reference: rise, tolerance: { abs: 0.02 } } // prettier-ignore
        : { name: `${name}: flies`, metric: 'time', from: at + 1, until: 'grounded', reference: flight, tolerance: { ticks: 1 } }, // prettier-ignore
      { name: `${name}: across at`, metric: 'speed', from: at + 3, to: at + 40, reference: across, tolerance: { share: 0.02 } }, // prettier-ignore
      { name: `${name}: lands on the far platform`, metric: 'standHeight', from: at + 5, to: span.to, reference: TOP, tolerance: { abs: 0.02 } }, // prettier-ignore
      ...bodyBounds(k * RUN + 2, { ...span, holds: name.startsWith('superglide') }),
      ...cameraBounds(k * RUN + 2, span),
    ];
  }),
});
