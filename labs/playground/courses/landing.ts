/**
 * @file The landing course, `course:playground-landing` (docs/PLAYGROUND.md §3.2, PLAN.md WP 13.18): the player,
 * empty-handed, is placed in the air over the gym's open south floor, running east, and falls 6, 14 and 25 m: under
 * the 7.62 m a fall keeps its speed from, between it and the 20.32 m the stun is full from, and past that. Its speed
 * as it lands against §3.2's stun (the share of speed the impact leaves, by its speed along the floor's normal as
 * v² / 2g: none of it lost from 6 m, half of it from 14 m, all of it from 25 m), and the run's speed again 1 s on,
 * the stun recovered. Then the bounds (labs/playground/courses/bounds.ts) of each run.
 *
 * The references, from §3.2's rules stepped at 60 Hz: the fall is integrated exactly, so it reaches the floor in the
 * first tick whose drop, g t² / 2, is the height, and lands at g t, the stun's impact; the fastest a sample falls is
 * the tick's before, as the floor stops the landing's.
 *
 * Game code (labs/playground/): it imports only the engine's public API and the playground's own files.
 *
 * @example
 * // node x feel labs/playground --course landing
 * @see labs/playground/courses/courses.test.ts
 */
import { defineCourse } from '../../../engine';
import { bodyBounds, cameraBounds } from './bounds';

/** The run, holstered (m/s), Apex's gravity (m/s²), and the stun's heights: none to, full from (m). */
const [RUN_SPEED, G, FROM, FULL] = [4.4069 * 1.15, 19.05, 7.62, 20.32];

/** How long each run is (steps). */
const RUN = 200;

/** Each fall: its height (m) and the row of the south floor it runs along (z), from x 2. */
export const LANDING_RUNS = [
  [6, 91],
  [14, 94],
  [25, 97],
] as const;

/** The tick a fall from `height` lands in, its impact speed (m/s), and the share of speed its stun leaves. */
export function landingOf(height: number): { tick: number; impact: number; share: number } {
  const tick = Math.ceil(Math.sqrt((2 * height) / G) * 60 - 1e-9);
  const impact = (G * tick) / 60;
  const fall = (impact * impact) / (2 * G);
  return { tick, impact, share: fall <= FROM ? 1 : 1 - Math.min((fall - FROM) / (FULL - FROM), 1) };
}

defineCourse('course:playground-landing', {
  description: 'Falls of 6, 14 and 25 m while running: the stun by the impact, none to a full one, and the run again a second on (docs/PLAYGROUND.md §3.2).', // prettier-ignore
  scene: 'playground:gym',
  steps: RUN * LANDING_RUNS.length,
  inputs: LANDING_RUNS.map(([height, z], k) => [k * RUN, { dev: 'place', args: { at: [2, height, z], yaw: Math.PI / 2, speed: RUN_SPEED }, move: [1, 0], look: [Math.PI / 2, 0], cam: Math.PI / 2 }]), // prettier-ignore
  measures: LANDING_RUNS.flatMap(([height], k) => {
    const { tick, impact, share } = landingOf(height);
    const at = k * RUN + tick;
    const span = { to: (k + 1) * RUN - 1, label: `${height} m` };
    return [
      { name: `${height} m: falls at`, metric: 'topFall', from: k * RUN + 1, to: at, reference: impact - (G / 60), tolerance: { share: 0.02 } }, // prettier-ignore
      { name: `${height} m: its speed as it lands`, metric: 'speed', from: at + 1, to: at + 2, reference: RUN_SPEED * share, tolerance: { share: 0.02, abs: 0.02 } }, // prettier-ignore
      { name: `${height} m: the run again`, metric: 'speed', from: at + 70, to: at + 80, reference: RUN_SPEED, tolerance: { share: 0.02 } }, // prettier-ignore
      ...bodyBounds(k * RUN + 2, span),
      ...cameraBounds(k * RUN + 2, span),
    ];
  }),
});
