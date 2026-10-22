/**
 * @file The hill course, `course:playground-hill` (docs/PLAYGROUND.md §2.2 and §5.1, PLAN.md WP 10.5): the player,
 * empty-handed, placed at the hill's foot (labs/playground/scenes/hill.ts), runs up its flank east for 3 s (to about
 * 7 m up, over slopes of 10° to 29°), turns and sprints down it west, slides from a crouch at the steepest stretch,
 * gaining speed down the slope, and runs out at its foot; then the body's and every camera's bounds
 * (labs/playground/courses/bounds.ts), so the feet stay planted on the terrain's slopes as on the gym's floors.
 *
 * Game code (labs/playground/): it imports only the engine's public API and the playground's own files.
 *
 * @example
 * // node x feel labs/playground --course hill
 * @see labs/playground/courses/courses.test.ts
 */
import { defineCourse } from '../../../engine';
import { HILL_START } from '../scenes/hill';
import { bodyBounds, cameraBounds } from './bounds';

/** When the run turns down the hill, and when the slide starts (steps). */
const [TURN, SLIDE] = [180, 230];

defineCourse('course:playground-hill', {
  description: 'Up the hill’s flank, then down it sprinting and sliding: the feet planted on terrain (docs/PLAYGROUND.md §2.2).', // prettier-ignore
  scene: 'playground:hill',
  steps: 420,
  inputs: [
    [0, { dev: 'place', args: { at: HILL_START, yaw: Math.PI / 2 } }],
    [1, { move: [1, 0], look: [Math.PI / 2, 0], cam: Math.PI / 2 }],
    [TURN, { move: [-1, 0], look: [-Math.PI / 2, 0], cam: -Math.PI / 2, b: ['sprint'] }],
    [TURN + 2, { b: null }],
    [SLIDE, { b: ['crouch'] }],
  ],
  measures: [
    { name: 'on the ground up the flank', metric: 'grounded', to: TURN, reference: 1, tolerance: { abs: 0 } },
    ...bodyBounds(2),
    ...cameraBounds(2),
  ],
});
