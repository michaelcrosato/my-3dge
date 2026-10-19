/**
 * @file The crawl course, `course:playground-crawl` (docs/PLAYGROUND.md §3.2, PLAN.md WP 13.5): the player, empty-handed,
 * crouch-walks into the crawl tunnel (1.4 m clear, 8 m long), lets crouch go inside and goes on crouched under the roof,
 * standing up and running once out; then slides under the bar (1.3 m up) from a sprint. Apex's crouched hull, 1.19 m,
 * fits under both; its standing one, 1.83 m, under neither. Each run's numbers against §3.2's, then its bounds
 * (labs/playground/courses/bounds.ts).
 *
 * The references, from §3.2: the crouch-walk 2.34 m/s and the run 5.07 m/s, holstered; and the slide's speed just
 * past the bar, 38 to 42 ticks after its boost to 10.16 × 1.15 m/s, by its friction (2.54 m/s² then × 0.7 a second,
 * stepped at 60 Hz): 7.89 to 7.53 m/s, 7.71 on average, so the bar took nothing. Every camera keeps every bound: the
 * shooter's stays under the roof behind the crouched eye and draws in to it with the wall behind the bar's start (WP
 * 13.8; the chase camera that stood in for it stood in the roof, 208 frames, and snapped in by 5 m under the bar).
 *
 * Game code (labs/playground/): it imports only the engine's public API and the playground's own files.
 *
 * @example
 * // node x feel labs/playground --course crawl
 * @see labs/playground/courses/courses.test.ts
 */
import { defineCourse } from '../../../engine';
import { bodyBounds, cameraBounds } from './bounds';

/** Where the tunnel run starts (4 m north of the tunnel, in its middle) and where the bar's does (facing south). */
export const CRAWL_STARTS = { tunnel: [7.5, 0, 66], bar: [14.5, 0, 66.5] } as const;

/** When the bar's run starts, and when crouch is let go in the tunnel (steps). */
const [BAR, LET_GO] = [400, 200];

defineCourse('course:playground-crawl', {
  description: 'Through the crawl tunnel crouched, crouch let go under its roof, and a slide under the bar (docs/PLAYGROUND.md §3.2).', // prettier-ignore
  scene: 'playground:gym',
  steps: BAR + 120,
  inputs: [
    [0, { dev: 'place', args: { at: CRAWL_STARTS.tunnel, yaw: 0 } }],
    [1, { move: [0, 1], look: [0, 0], cam: 0, b: ['crouch'] }],
    [LET_GO, { b: null }],
    [BAR, { dev: 'place', args: { at: CRAWL_STARTS.bar, yaw: 0, speed: 6.604 * 1.15 }, b: ['crouch'] }],
  ],
  measures: [
    { name: 'tunnel: crouch-walk', metric: 'speed', from: 100, to: LET_GO, reference: 2.34, tolerance: { share: 0.02 } }, // prettier-ignore
    { name: 'tunnel: crouch let go', metric: 'speed', from: LET_GO + 10, to: LET_GO + 80, reference: 2.34, tolerance: { share: 0.02 } }, // prettier-ignore
    { name: 'tunnel: out and running', metric: 'speed', from: LET_GO + 140, to: BAR - 1, reference: 5.07, tolerance: { share: 0.02 } }, // prettier-ignore
    { name: 'bar: slides under', metric: 'speed', from: BAR + 40, to: BAR + 44, reference: 7.71, tolerance: { share: 0.02 } }, // prettier-ignore
    ...bodyBounds(2, { to: BAR - 1, label: 'tunnel' }),
    ...cameraBounds(2, { to: BAR - 1, label: 'tunnel' }),
    ...bodyBounds(BAR + 2, { label: 'bar' }),
    ...cameraBounds(BAR + 2, { label: 'bar' }),
  ],
});
