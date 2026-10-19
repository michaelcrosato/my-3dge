/**
 * @file The zipline course, `course:playground-zipline` (docs/PLAYGROUND.md §3.2, PLAN.md WP 13.7): the tower's 40 m
 * zipline and the balloon's line. The player, empty-handed, stands on the tower's top by the pulley and uses the
 * zipline: caught at once, it rides down at 10.16 m/s² to 15.24 m/s and lets go short of the far pulley, on the floor.
 * Under the line near its low end it jumps into the cable: caught from the air, it rides up the way it looks at
 * 25.4 m/s², and a second later jumps off, keeping its speed across (faster than 11.3 m/s), a full jump high. Caught
 * again at the top and jumping off half a second in, looking down the line, it leaves at 11.3 m/s across: the ride's
 * speed and 10.16 m/s along the view, capped. A crouch a second into a ride drops it, keeping the ride's velocity.
 * On the balloon's line it rides up and drops, flying on up, and is caught again twice (three catches between two
 * touches of the ground); the fourth time it falls to the floor. Then the bounds (labs/playground/courses/bounds.ts) of each run.
 *
 * The references follow from §3.2's rules stepped at 60 Hz: a ride caught by use speeds up 10.16 / 60 m/s a tick
 * from the speed along the cable it had (none at rest), so it is at 15.24 m/s 90 ticks after the catch; the ride from
 * the tower's catch, `zipline.end` (0.61 m) along the cable, to as far short of the far anchor takes the speed-up's
 * 11.43 m, then the rest at 15.24 m/s.
 *
 * Game code (labs/playground/): it imports only the engine's public API and the playground's own files.
 *
 * @example
 * // node x feel labs/playground --course zipline
 * @see labs/playground/courses/courses.test.ts
 */
import { defineCourse } from '../../../engine';
import { GYM_BALLOON, GYM_ZIPLINE } from '../levels/gym';
import { bodyBounds, cameraBounds } from './bounds';

const DT = 1 / 60;

/** §3.2's zipline: the top speeds (sloped, vertical), the speed-ups (by use, jumping on), the jump off's add and cap. */
const ZIP = { speed: 15.24, vertical: 12.192, accel: 10.16, jumpOn: 25.4, jump: 10.16, jumpMax: 11.303, end: 0.6096 } as const; // prettier-ignore

/** The tower's cable: its length, its share across the ground, and the yaw of its way down. */
const [FROM, TO] = [GYM_ZIPLINE.from, GYM_ZIPLINE.to];
const LENGTH = Math.hypot(TO[0] - FROM[0], TO[1] - FROM[1], TO[2] - FROM[2]);
const ACROSS = Math.hypot(TO[0] - FROM[0], TO[2] - FROM[2]) / LENGTH;
const DOWN = Math.atan2(TO[0] - FROM[0], TO[2] - FROM[2]);

/** The point `t` metres down the cable, on the floor below it. */
const under = (t: number) => [FROM[0] + ((TO[0] - FROM[0]) * t) / LENGTH, 0, FROM[2] + ((TO[2] - FROM[2]) * t) / LENGTH] as const; // prettier-ignore

/** Where the runs start: on the tower's top by its pulley, under the cable near its low end, by the balloon's line. */
export const ZIPLINE_STARTS = { top: [29, 6, 62.5], low: under(37), balloon: [16, 0, 51] } as const;

/** How long each run is (steps), and when the presses come, from each run's start. */
const RUN = 360;
const [USE, JUMP, OFF, CROUCH] = [2, 2, 62, 62];

/** A ride caught by use at rest, `ticks` ticks on from its catch tick (which speeds it up too): its speed (m/s). */
const byUse = (ticks: number) => Math.min(ticks * ZIP.accel * DT, ZIP.speed);

/** The ride down from the tower's catch to the far end (s): the speed-up, then the rest at the top speed. */
const RIDE = (() => {
  const span = LENGTH - 2 * ZIP.end;
  const up = (ZIP.speed * ZIP.speed) / (2 * ZIP.accel);
  return ZIP.speed / ZIP.accel + (span - up) / ZIP.speed;
})();

/** A run's start: placed at `at` facing and looking `yaw`, nothing held. */
const start = (k: number, at: readonly number[], yaw: number) => [
  [k, { dev: 'place', args: { at, yaw, speed: 0 }, move: [0, 0], look: [yaw, 0], cam: yaw, b: [] }],
];

/** A press of `button` at step `k`, let go the step after. */
const press = (k: number, button: string) => [
  [k, { b: [button] }],
  [k + 1, { b: [] }],
];

/**
 * The bounds from step `from` to `to`, under `label`; the cameras that WP 13.8 is to bring within them watched: the
 * shooter's (the chase camera's collision snaps in by the tower's pole, and loses the player riding up the line),
 * and after a fall of 20 m every camera's catching up with the stop (0.33 to 0.36 m a frame).
 */
const bounds = (from: number, to: number, label: string, watch: readonly string[] = ['shooter']) => {
  const watched = Object.fromEntries(watch.map((name) => [name, 'WP 13.8']));
  return [...bodyBounds(from, { to, label }), ...cameraBounds(from, { to, label, watch: watched })];
};

/** Every camera's name. */
const ALL = ['shooter', 'first', 'platformer', 'isometric', 'top-down'];

defineCourse('course:playground-zipline', {
  description: 'Ziplines: caught by use or jumping on, ridden either way at their speed-ups to their top speeds, left by a jump, a drop or an end, three catches a jump (docs/PLAYGROUND.md §3.2).', // prettier-ignore
  scene: 'playground:gym',
  steps: RUN * 4,
  inputs: [
    ...start(0, ZIPLINE_STARTS.top, 0),
    ...press(USE, 'interact'),
    ...start(RUN, ZIPLINE_STARTS.low, DOWN + Math.PI),
    ...press(RUN + JUMP, 'jump'),
    [RUN + OFF - 1, { look: [DOWN + Math.PI / 2, 0] }], // looking across the line, as a player leaves one
    ...press(RUN + OFF, 'jump'),
    ...start(2 * RUN, ZIPLINE_STARTS.top, DOWN),
    ...press(2 * RUN + USE, 'interact'),
    ...press(2 * RUN + 32, 'jump'),
    [2 * RUN + 120, { dev: 'place', args: { at: ZIPLINE_STARTS.top, yaw: DOWN, speed: 0 } }],
    ...press(2 * RUN + 122, 'interact'),
    ...press(2 * RUN + 122 + CROUCH, 'crouch'),
    ...start(3 * RUN, ZIPLINE_STARTS.balloon, 0),
    ...press(3 * RUN + USE, 'interact'),
    ...press(3 * RUN + 60, 'crouch'),
    ...press(3 * RUN + 95, 'crouch'),
    ...press(3 * RUN + 130, 'crouch'),
  ],
  measures: [
    { name: 'use catches it', metric: 'time', until: 'riding', from: USE, to: RUN - 1, reference: DT, tolerance: { ticks: 0 } }, // prettier-ignore
    { name: 'speeds up at 10.16 m/s²', metric: 'rideGain', from: USE + 1, to: USE + 31, reference: 30 * ZIP.accel * DT, tolerance: { share: 0.05 } }, // prettier-ignore
    { name: 'top speed 15.24 m/s', metric: 'rideSpeed', from: USE + 1, to: USE + 120, reference: ZIP.speed, tolerance: { share: 0.02 } }, // prettier-ignore
    { name: 'rides the line', metric: 'duration', until: 'riding', from: USE, to: RUN - 1, reference: RIDE, tolerance: { ticks: 1 } }, // prettier-ignore
    { name: 'lets go short of the far pulley, onto the floor', metric: 'height', from: USE, to: RUN - 1, reference: 0, tolerance: { abs: 0.02 } }, // prettier-ignore
    { name: 'jumping on: speeds up at 25.4 m/s²', metric: 'rideGain', from: RUN + JUMP + 8, to: RUN + JUMP + 23, reference: 15 * ZIP.jumpOn * DT, tolerance: { share: 0.05 } }, // prettier-ignore
    { name: 'up the line as it looks', metric: 'topRise', from: RUN + JUMP + 30, to: RUN + OFF, reference: ZIP.speed * Math.sqrt(1 - ACROSS * ACROSS), tolerance: { share: 0.02 } }, // prettier-ignore
    { name: 'jumps off keeping its speed', metric: 'speed', from: RUN + OFF + 1, to: RUN + OFF + 1, reference: ZIP.speed * ACROSS, tolerance: { share: 0.02 } }, // prettier-ignore
    { name: 'a full jump high', metric: 'apex', from: RUN + OFF, to: RUN + OFF + 60, reference: 1.4224, tolerance: { abs: 0.03 } }, // prettier-ignore
    { name: 'jumps off a slow ride at 11.3 m/s', metric: 'speed', from: 2 * RUN + 33, to: 2 * RUN + 33, reference: ZIP.jumpMax, tolerance: { share: 0.02 } }, // prettier-ignore
    { name: 'a crouch drops it at the ride’s speed', metric: 'speed', from: 2 * RUN + 123 + CROUCH, to: 2 * RUN + 123 + CROUCH, reference: byUse(CROUCH) * ACROSS, tolerance: { share: 0.02 } }, // prettier-ignore
    { name: 'three catches a jump', metric: 'catches', from: 3 * RUN + 1, to: 4 * RUN - 1, reference: 3, tolerance: { abs: 0 } }, // prettier-ignore
    { name: 'the fourth refused: down to the floor', metric: 'height', from: 3 * RUN + 1, to: 4 * RUN - 1, reference: GYM_BALLOON.from[1], tolerance: { abs: 0.02 } }, // prettier-ignore
    ...bounds(2, RUN - 1, 'use'),
    ...bounds(RUN + 2, 2 * RUN - 1, 'jump on'),
    ...bounds(2 * RUN + 2, 2 * RUN + 119, 'jump off'),
    ...bounds(2 * RUN + 122, 3 * RUN - 1, 'drop'),
    ...bounds(3 * RUN + 2, 4 * RUN - 1, 'three catches', ALL),
  ],
});
