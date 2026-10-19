/**
 * @file The cameras' hard places, `course:playground-camera-walls` (docs/PLAYGROUND.md §4, PLAN.md WP 13.8, its review):
 * where a follow camera meets the level, the shooter's and the platformer's cameras held to §4's four bounds in three
 * legs. On open floor (`OPEN`) the player stands, then walks, while the look tilts up to `PITCH` (the arm's end under
 * the floor), down to −`PITCH` and back. Along the east perimeter wall (`WALL`), in the corridor between it and the
 * features, he sprints south looking a little away from it (the arm grazing it), jumps looking down (the arm's end over
 * its top, outside) and lands looking up, so the camera comes back over the top, never down behind it. Past the climb
 * walls (`EDGES`), five blocks with gaps between them, he runs west looking south, so the arm swings across their faces
 * and edges.
 *
 * Game code (labs/playground/): it imports only the engine's public API and the playground's own files.
 *
 * @example
 * // node x feel labs/playground --course camera-walls
 * @see labs/playground/courses/courses.test.ts
 */
import { defineCourse } from '../../../engine';
import { PLAYGROUND_CAMERAS } from '../views';
import { BOUNDS } from './bounds';

/** The legs: where each places the player, facing which way, from which step to which. */
export const CAMERA_WALLS = {
  OPEN: { at: [20.25, 0, 10], yaw: 0, from: 0, to: 360 },
  WALL: { at: [39.2, 0, 44], yaw: 0, from: 360, to: 660 },
  EDGES: { at: [30, 0, 26.5], yaw: 0, from: 660, to: 960 },
} as const;

/** How far the look tilts up and down on open floor (rad): past where the shooter's arm meets the floor. */
export const PITCH = 1.2;

/** A ramp of the look's pitch from `a` to `b` over steps `from` to `to`, at heading `yaw`: a change every 2 steps. */
const ramp = (from: number, to: number, yaw: number, a: number, b: number) =>
  Array.from({ length: Math.floor((to - from) / 2) + 1 }, (_, i) => {
    const t = Math.min(1, (2 * i) / (to - from));
    return [from + 2 * i, { look: [yaw, a + (b - a) * t] }] as const;
  });

/** Where the player is placed for a leg. */
const place = (leg: { at: readonly number[]; yaw: number; from: number }) =>
  [leg.from, { dev: 'place', args: { at: leg.at, yaw: leg.yaw, speed: 0 } }] as const;

const { OPEN, WALL, EDGES } = CAMERA_WALLS;

/** Change-points in step order, those on one step merged (a ramp's look beside a key). */
const merged = (points: readonly (readonly [number, Record<string, unknown>])[]) => {
  const at = new Map<number, Record<string, unknown>>();
  for (const [step, change] of points) at.set(step, { ...at.get(step), ...change });
  return [...at.entries()].sort(([a], [b]) => a - b);
};

/** The three legs' inputs (see the file comment). */
const INPUTS = merged([
  place(OPEN),
  [OPEN.from + 1, { look: [0, 0], cam: 0, move: null, b: [] }],
  ...ramp(OPEN.from + 2, OPEN.from + 62, 0, 0, PITCH),
  ...ramp(OPEN.from + 92, OPEN.from + 212, 0, PITCH, -PITCH),
  [OPEN.from + 150, { move: [0, 1], b: ['walk'] }],
  ...ramp(OPEN.from + 242, OPEN.from + 302, 0, -PITCH, 0),
  [OPEN.from + 320, { move: null, b: [] }],
  place(WALL),
  [WALL.from + 1, { look: [-0.5, 0], cam: -0.5, move: [0, 1], b: [] }],
  [WALL.from + 30, { b: ['sprint'] }],
  ...ramp(WALL.from + 80, WALL.from + 110, -0.5, 0, -0.7),
  [WALL.from + 120, { b: ['sprint', 'jump'] }],
  [WALL.from + 121, { b: ['sprint'] }],
  ...ramp(WALL.from + 140, WALL.from + 170, -0.5, -0.7, 0.3),
  ...ramp(WALL.from + 220, WALL.from + 250, -0.5, 0.3, 0),
  place(EDGES),
  [EDGES.from + 1, { look: [0, 0], cam: 0, move: [-1, 0], b: [] }],
  [EDGES.from + 150, { look: [0.4, 0.2], cam: 0.4 }],
  [EDGES.from + 240, { move: null }],
]);

/** §4's four bounds for `camera` over steps `from` to `to`. */
const bounds = (camera: string, label: string, from: number, to: number) => [
  { name: `${label}: no jump`, metric: 'cameraJump', camera, from, to, reference: 0, tolerance: { abs: BOUNDS.jump } },
  { name: `${label}: no turn`, metric: 'cameraTurn', camera, from, to, reference: 0, tolerance: { abs: BOUNDS.turn } },
  { name: `${label}: never inside`, metric: 'cameraInside', camera, from, to, reference: 0, tolerance: { abs: 0 } },
  { name: `${label}: never lost`, metric: 'cameraLost', camera, from, to, reference: 0, tolerance: { abs: 0 } },
];

/** The two cameras measured: the shooter's and the platformer's, the ones that collide. */
const CAMERAS = [PLAYGROUND_CAMERAS[0], PLAYGROUND_CAMERAS[2]];

defineCourse('course:playground-camera-walls', {
  description: 'The shooter’s and the platformer’s cameras where they meet the level: the look tilted up and down on open floor, a run and a jump along the perimeter wall, a run past the climb walls’ edges: §4’s four bounds (docs/PLAYGROUND.md §4).', // prettier-ignore
  scene: 'playground:gym',
  steps: EDGES.to,
  inputs: INPUTS,
  measures: CAMERAS.flatMap(
    (mode) =>
    Object.entries(CAMERA_WALLS).flatMap(([leg, { from, to }]) => bounds(mode.code, `${mode.name}, ${leg.toLowerCase()}`, from + 2, to - 1)), // prettier-ignore
  ),
});
