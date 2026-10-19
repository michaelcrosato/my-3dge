/**
 * @file The cameras' soak course, `course:playground-cameras` (docs/PLAYGROUND.md §4 and §9.1, PLAN.md WP 13.8): the
 * player runs a square of about 10 m on the gym's floor by its north end, twice round (`LOOP`), sprinting and sliding
 * east, jumping south, sprinting west a metre off the fences and running north between the 1.5 and 2 m mantle walls,
 * turning a quarter at each corner as a player turns the view, while the camera cycles through the five modes
 * (labs/playground/views.ts), a switch every `SWITCH` steps, each blended as the page's T blends it (the course's
 * `views`). One camera goes the whole way, so its jump, turn and inside numbers are every mode's and every switch's:
 * no frame moves it more than 0.3 m or turns it 4° beyond what the player, the look and a blend account for, and none
 * stands it inside the level. Outside first person, none loses the player: the camera that goes the whole way while
 * the shooter's, then cameras started in the platformer's mode a second after each first person (the feel kit starts a
 * measure's camera at its first step), since the blend out of the eyes starts from a picture with no body in it.
 *
 * Game code (labs/playground/): it imports only the engine's public API and the playground's own files.
 *
 * @example
 * // node x feel labs/playground --course cameras
 * @see labs/playground/courses/courses.test.ts
 */
import { defineCourse } from '../../../engine';
import { PLAYGROUND_CAMERAS } from '../views';
import { BOUNDS } from './bounds';

/** Where the square starts: between the north wall and the mantle walls, facing east. */
export const CAMERAS_START = [17, 0, 5] as const;

/** A leg of the square (steps), the loop's four legs, and a camera switch every this many steps. */
const [LEG, SWITCH] = [120, 96];
const LOOP = 4 * LEG;

/** The views east, south, west and north (rad): a leg's look and heading. */
const HEADINGS = [Math.PI / 2, 0, -Math.PI / 2, Math.PI];

/** Leg `n`'s turn: the move along its heading (world x and z), its look and its keys' frame. */
const leg = (n: number) => {
  const yaw = HEADINGS[n];
  return { move: [Math.round(Math.sin(yaw)), Math.round(Math.cos(yaw))], look: [yaw, 0], cam: yaw };
};

/** One loop's inputs from step `k`: each leg's turn, and what the player does along it. */
const loop = (k: number) => [
  [k, { ...leg(0), b: [] }],
  [k + 50, { b: ['sprint'] }],
  [k + 90, { b: ['sprint', 'crouch'] }],
  [k + LEG, { ...leg(1), b: [] }],
  [k + LEG + 60, { b: ['jump'] }],
  [k + LEG + 61, { b: [] }],
  [k + 2 * LEG, { ...leg(2), b: ['sprint'] }],
  [k + 2 * LEG + 60, { b: ['sprint', 'jump'] }],
  [k + 2 * LEG + 61, { b: ['sprint'] }],
  [k + 3 * LEG, { ...leg(3), b: [] }],
];

/** The switches: the next mode every `SWITCH` steps, from the shooter, twice round the five. */
const VIEWS = Array.from({ length: (2 * LOOP) / SWITCH - 1 }, (_, i) => [(i + 1) * SWITCH, PLAYGROUND_CAMERAS[(i + 1) % PLAYGROUND_CAMERAS.length].code]); // prettier-ignore

/** The spans outside first person and a second after it, with the mode each starts in. */
const SEEN = [
  [2, SWITCH - 1, 0],
  [2 * SWITCH + 60, 6 * SWITCH - 1, 2],
  [7 * SWITCH + 60, 2 * LOOP, 2],
] as const;

defineCourse('course:playground-cameras', {
  description: 'Every camera mode in turn, each switch blended, while the player runs, sprints, slides, jumps and turns a square by the north wall: §4’s camera bounds over it all (docs/PLAYGROUND.md §4).', // prettier-ignore
  scene: 'playground:gym',
  steps: 2 * LOOP,
  inputs: [[0, { dev: 'place', args: { at: CAMERAS_START, yaw: HEADINGS[0], speed: 0 } }], ...loop(0), ...loop(LOOP)], // prettier-ignore
  views: VIEWS,
  measures: [
    { name: 'no jump', metric: 'cameraJump', camera: PLAYGROUND_CAMERAS[0].code, from: 2, reference: 0, tolerance: { abs: BOUNDS.jump } }, // prettier-ignore
    { name: 'no turn', metric: 'cameraTurn', camera: PLAYGROUND_CAMERAS[0].code, from: 2, reference: 0, tolerance: { abs: BOUNDS.turn } }, // prettier-ignore
    { name: 'never inside', metric: 'cameraInside', camera: PLAYGROUND_CAMERAS[0].code, from: 2, reference: 0, tolerance: { abs: 0 } }, // prettier-ignore
    ...SEEN.map(([from, to, mode]) => ({ name: `never lost, ${from} to ${to}`, metric: 'cameraLost', camera: PLAYGROUND_CAMERAS[mode].code, from, to, reference: 0, tolerance: { abs: 0 } })), // prettier-ignore
  ],
});
