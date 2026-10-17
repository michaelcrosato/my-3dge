/**
 * @file The jumps course, `course:playground-jumps` (docs/PLAYGROUND.md §3.2, PLAN.md WP 13.4): the player, empty-handed,
 * placed in the open floor between the slide ramps and the slope tests, jumps from standing, jumps again as it lands
 * (the press buffered just before), then once more after a rest, then walks and crouch-walks south; its numbers against
 * §3.2's, then the bounds (labs/playground/courses/bounds.ts).
 *
 * The references: a jump of 1.42 m (56 u); straight after a jump's landing, 0.3 of it, 0.43 m (jump fatigue, until
 * 0.15 s after the landing); 0.75 s after, the full height again; the walk 2.53 m/s and the crouch-walk 2.34 m/s,
 * holstered (§3.2's 2.20 and 2.03 armed, ×1.15).
 *
 * Game code (labs/playground/): it imports only the engine's public API and the playground's own files.
 *
 * @example
 * // node x feel labs/playground --course jumps
 * @see labs/playground/courses/courses.test.ts
 */
import { defineCourse } from '../../../engine';
import { bodyBounds, cameraBounds } from './bounds';

/** Where the jumps start: the open floor south of the slide ramps, facing south. */
export const JUMPS_START = [20.25, 0, 52.25] as const;

defineCourse('course:playground-jumps', {
  description: 'Jumps from standing, a tired jump off a landing, a rested one, then the walk and the crouch-walk, empty-handed (docs/PLAYGROUND.md §3.2).', // prettier-ignore
  scene: 'playground:gym',
  steps: 340,
  inputs: [
    [0, { dev: 'place', args: { at: JUMPS_START, yaw: 0 } }],
    [20, { b: ['jump'] }],
    [26, { b: null }],
    [64, { b: ['jump'] }],
    [70, { b: null }],
    [145, { b: ['jump'] }],
    [151, { b: null }],
    [200, { move: [0, 1], look: [0, 0], cam: 0, b: ['walk'] }],
    [260, { b: ['crouch'] }],
    [320, { move: null, b: null }],
  ],
  measures: [
    { name: 'jump', metric: 'apex', from: 20, to: 60, reference: 1.42, tolerance: { abs: 0.02 } },
    { name: 'tired jump', metric: 'apex', from: 67, to: 92, reference: 0.43, tolerance: { abs: 0.02 } },
    { name: 'rested jump', metric: 'apex', from: 145, to: 190, reference: 1.42, tolerance: { abs: 0.02 } },
    { name: 'walk', metric: 'speed', from: 240, to: 260, reference: 2.53, tolerance: { share: 0.02 } },
    { name: 'crouch-walk', metric: 'speed', from: 300, to: 320, reference: 2.34, tolerance: { share: 0.02 } },
    ...bodyBounds(2),
    ...cameraBounds(2),
  ],
});
