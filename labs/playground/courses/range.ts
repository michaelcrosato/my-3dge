/**
 * @file The range course, `course:playground-range` (docs/PLAYGROUND.md §5.1 and §7.2, PLAN.md WP 13.20): at the
 * range's bench (labs/playground/scenes/site.ts `playground:site-range`), the player draws the pistol, raises its
 * sights and looks about, left and right, up and down (each look glided to over 12 steps, as a mouse turns it), firing
 * a round; then the rifle, its sights up again, a burst held at each look. Its numbers are §5.1's muzzle bound, the gun hand's barrel line within 2° of the aim while the
 * sights are up, and the body's and the cameras' bounds (labs/playground/courses/bounds.ts) with a gun drawn, its
 * shots' climb in the view.
 *
 * Game code (labs/playground/): it imports only the engine's public API and the playground's own files.
 *
 * @example
 * // node x feel labs/playground --course range
 * @see labs/playground/courses/courses.test.ts
 */
import { defineCourse } from '../../../engine';
import { bodyBounds, cameraBounds, muzzleBound } from './bounds';

/** Facing the lanes (+X), and the looks the sights sweep: [yaw, pitch] off it (rad). */
const EAST = Math.PI / 2;
const LOOKS = [
  [0.3, 0.15],
  [-0.3, -0.15],
  [0, 0.35],
  [0, -0.35],
] as const;

/** A look `[yaw, pitch]` off east, as the intents' `look` and `cam`. */
const toward = ([yaw, pitch]: readonly [number, number]) => ({ look: [EAST + yaw, pitch], cam: EAST + yaw });

/** The look glided from `a` to `b` over 12 steps from step `at`, a change each step, as a mouse turns it. */
const glide = (a: readonly [number, number], b: readonly [number, number], at: number) =>
  Array.from({ length: 12 }, (_, k): [number, Record<string, unknown>] => {
    const t = (k + 1) / 12;
    return [at + k, toward([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])];
  });

/** The looks in turn, each glided to from the one before (from straight ahead), from step `at`, `every` steps apart. */
const sweep = (at: number, every: number) => LOOKS.flatMap((look, i) => glide(i ? LOOKS[i - 1] : [0, 0], look, at + every * i)); // prettier-ignore

defineCourse('course:playground-range', {
  description: 'The range: the pistol and the rifle down their sights, looking about, firing (docs/PLAYGROUND.md §5.1).', // prettier-ignore
  scene: 'playground:site-range',
  steps: 520,
  inputs: (
    [
      [0, { look: [EAST, 0], cam: EAST }],
      [5, { b: ['weapon1'] }],
      [6, { b: null }],
      [30, { b: ['aim'] }],
      ...sweep(60, 40),
      [130, { b: ['aim', 'fire'] }],
      [131, { b: ['aim'] }],
      ...glide(LOOKS[LOOKS.length - 1], [0, 0], 200),
      [220, { b: null }],
      [230, { b: ['weapon2'] }],
      [231, { b: null }],
      [270, { b: ['aim'] }],
      ...sweep(300, 50),
      ...LOOKS.flatMap(
        (_, i) =>
          [
            [320 + 50 * i, { b: ['aim', 'fire'] }],
            [332 + 50 * i, { b: ['aim'] }],
          ] as const,
      ), // a burst at each look
    ] as [number, Record<string, unknown>][]
  ).sort(([a], [b]) => a - b), // in step order
  measures: [muzzleBound(60), ...bodyBounds(2), ...cameraBounds(2)],
});
