/**
 * @file The bounds every playground course checks beside its own numbers (docs/PLAYGROUND.md §4, §5.1 and §9.1, PLAN.md
 * WP 13.4): from the step after a course places the player, its body's (a planted foot slides at most 5 cm in one
 * contact, the anim QA's limit; no point jumps past the QA's pop of 9/16 m in a step) and, for each of the
 * playground's five cameras (labs/playground/views.ts), §4's: no frame moves the camera more than 0.3 m beyond the
 * player's own move or turns it more than 4°, none stands it inside the level, and none loses the player (but first
 * person, whose arms come with WP 13.12). The feet are watched until WP 13.10, the locomotion's animation, plants them:
 * at WP 13.4 the procedural run held a stance foot within 3 cm mid-stance but slid it about 16 cm at the touchdown and
 * 19 cm at the lift-off, 0.36 m a contact at a 5 m/s run and 0.53 to 0.73 m sprinting (out/feel/<course>/report.json).
 *
 * Invariants: data only; a course spreads these into its own measures.
 *
 * Game code (labs/playground/): it imports only the engine's public API and the playground's own files.
 *
 * @example
 * cameraBounds(2).length; // 19: four numbers for each camera, three for first person
 * @see labs/playground/courses/courses.test.ts
 */
import { PLAYGROUND_CAMERAS } from '../views';

/** §4's and §5.1's bounds: the camera's move (m) and turn (rad) in a frame, a sole's slide (m), a point's pop (m). */
export const BOUNDS = { jump: 0.3, turn: (4 * Math.PI) / 180, slide: 0.05, pop: 9 / 16 } as const;

/** The body's bounds, from step `from`. */
export function bodyBounds(from: number): Record<string, unknown>[] {
  return [
    { name: 'feet planted', metric: 'footSlide', from, reference: 0, tolerance: { abs: BOUNDS.slide }, watch: 'WP 13.10' }, // prettier-ignore
    { name: 'no pops', metric: 'pop', from, reference: 0, tolerance: { abs: BOUNDS.pop } },
  ];
}

/** Every camera's bounds, from step `from` (see the file comment). */
export function cameraBounds(from: number): Record<string, unknown>[] {
  return PLAYGROUND_CAMERAS.flatMap(({ name, code }) => {
    const measure = (what: string, metric: string, abs: number) => ({ name: `${name}: ${what}`, metric, camera: code, from, reference: 0, tolerance: { abs } }); // prettier-ignore
    const lost = name === 'first' ? [] : [measure('lost', 'cameraLost', 0)];
    return [measure('jump', 'cameraJump', BOUNDS.jump), measure('turn', 'cameraTurn', BOUNDS.turn), measure('inside', 'cameraInside', 0), ...lost]; // prettier-ignore
  });
}
