/**
 * @file The platformer's camera (PLAN.md WP 13.8, docs/PLAYGROUND.md §4; doctrine: Common ground): orbit and follow,
 * as 3D platformers frame a run and a jump. `stepFollow` and `followPose` are the pure steps; `createFollowCamera`
 * wraps them in a camera.
 *
 * It looks at a pivot at the hero's eye height (`input.eye`'s, else `FOLLOW_RIG.height`) over the ground he stands on, from
 * `distance` back along the view (`yaw`, `pitch`: −20° to start); `input.look` and `input.turn` orbit it,
 * `input.zoom` steps the arm in by `ORBIT_ZOOM_STEP`. What it reads of him (`input.player`, engine/gfx/cameras/
 * effects.ts) shapes the rest:
 * - recentring: after `FOLLOW_RIG.idle` seconds without look input, the view turns behind his movement across the ground
 *   (faster than `FOLLOW_RIG.moving`), eased by `FOLLOW_RIG.ease` and at most `FOLLOW_RIG.recentre` rad/s;
 * - look-ahead: the pivot leads him by up to `FOLLOW_RIG.ahead` along his movement (all of it at `FOLLOW_RIG.run`), eased with
 *   a time constant of `FOLLOW_RIG.lead`, by the share of its arm the camera stands out (held in, it looks at him);
 * - the vertical dead zone: the pivot's ground follows the ground he stands on (eased by `FOLLOW_RIG.settle`) and keeps
 *   still while he is in the air within `FOLLOW_RIG.zone` of it, so a jump does not shake the frame; beyond, it is carried
 *   at the zone's edge;
 * - lag: across, the pivot follows with a time constant of `FOLLOW_RIG.lag`, never more than `FOLLOW_RIG.trail` behind;
 * - the lift: while the arm is cut more than `FOLLOW_RIG.room` short (a slope or a wall behind him), the camera tilts down
 *   at `FOLLOW_RIG.raise` rad/s, up to `FOLLOW_RIG.lift`, rising over it, and back at `FOLLOW_RIG.lower` once the arm clears.
 *
 * Walls (engine/gfx/cameras/collide.ts, their fixed bodies): the ball is swept from his eye to the pivot; the camera
 * moves on as `moveCamera` moves it (carried with the arm, then toward the arm's end as far as a sweep back from the
 * pivot clears, along the pivot's trail when it lost sight of it), so it moves at a pace (two cuts left, collide.ts's)
 * and never stands in a wall; held off its arm, it looks off its view toward the pivot (`FollowState.aim`), turning
 * that look at most `FOLLOW_RIG.aim` rad/s, right over it straight down and half as fast again (WP 13.27: indoors,
 * where the walls keep it from behind him).
 *
 * Invariants: with `queries` and the eye at least `COLLIDE_RADIUS` from every wall, the camera's ball never ends
 * inside one; the pivot's height is within `FOLLOW_RIG.zone` of the feet's ground; the pitch within `FOLLOW_LIMITS.pitch`.
 * Pure: each step returns a new state.
 *
 * Codes: `cam3=follow[,<yaw>,<pitch>,<distance>]` (degrees, metres); a bare one keeps the last camera's heading.
 *
 * @example
 * const follow = createFollowCamera();
 * follow.update({ follow: [0, 0, 0] }).position; // [0, 3.40…, -5.16…]: 5.5 m back from his eye, 20° down
 * follow.code(); // 'cam3=follow,0,-20,5.5'
 * @see engine/gfx/cameras/follow.test.ts
 */
import { MathUtils } from '../../core/math';
import { codeDegrees, codeNumber, followCamera, readCode, type CodePart, type FollowCamera } from './chase';
import { carry, COLLIDE_PULL, COLLIDE_RADIUS, follow, moveCamera, reach, type CameraBall, type Walls } from './collide';
import type { CameraPlayer, EffectWeights } from './effects';
import { ORBIT_ZOOM_STEP } from './orbit';
import { approach, makePose, poseForward, rangeProblems, refuse, wrapAngle, type CameraInput, type CameraPose, type Vec3 } from './pose'; // prettier-ignore

const DEG = MathUtils.DEG2RAD;

/** The rig's numbers (see the file comment): metres, seconds, rad/s; `lens` its lens, degrees. */
export const FOLLOW_RIG = Object.freeze({
  pitch: -20 * DEG,
  back: 5.5,
  height: 1.524,
  idle: 1.5,
  moving: 0.5,
  ease: 0.6,
  recentre: 1.5,
  ahead: 1,
  run: 5,
  lead: 0.5,
  zone: 1.5,
  settle: 0.3,
  lag: 0.1,
  trail: 0.5,
  lift: 50 * DEG,
  raise: 1.5,
  lower: 0.6,
  room: 0.25,
  lens: 60,
  aim: (2 * Math.PI) / 3,
});
/** The range of the pitch (rad) and the arm (m). */
export const FOLLOW_LIMITS = Object.freeze({ pitch: [-1.4, 0.8] as const, distance: [1, 20] as const });
/** Turn rates at full `input.turn`, rad/s: `[right, up]`. */
export const FOLLOW_TURN_SPEED = Object.freeze([2.2, 1.2] as const);
/** The effects it takes (engine/gfx/cameras/effects.ts): a little of the punch. */
export const FOLLOW_EFFECTS: EffectWeights = Object.freeze({ eye: 0, bob: 0, roll: 0, fov: 0, punch: 0.3, aim: 0 });

/** A follow camera's input: the devices', the hero (his eye and what he does) and the walls. */
export interface FollowInput extends CameraInput, Walls {
  /** The hero's eye, m: the pivot stands at its height over his feet. */
  readonly eye?: Vec3;
  /** What he does: his velocity (recentring, look-ahead) and whether he stands (the dead zone). */
  readonly player?: CameraPlayer | null;
}

/** A follow camera's code as data: without the numbers it keeps the heading of the camera before it. */
export interface FollowSpec {
  readonly type: 'follow';
  readonly yaw?: number;
  readonly pitch?: number;
  /** The arm when nothing is in the way, m. */
  readonly distance?: number;
}

/** A follow camera's state: plain data, replaced by each step. */
export interface FollowState {
  readonly yaw: number;
  readonly pitch: number;
  readonly distance: number;
  readonly fov: number;
  /** Seconds since the last look input. */
  readonly idle: number;
  /** The look-ahead now, m, across the ground. */
  readonly lead: Vec3;
  /** The dead zone's ground, m; null until the first follow. */
  readonly ground: number | null;
  /** The pivot, m, as it follows (the walls aside); null until the first follow. */
  readonly pivot: Vec3 | null;
  /** The arm's base: the pivot as far as a ball from his eye reaches it, m; null until the first follow. */
  readonly base: Vec3 | null;
  /** How much further down it looks to rise over what cuts the arm, rad (the lift). */
  readonly lift: number;
  /** The camera after the walls (collide.ts's `moveCamera`); null until the first follow. */
  readonly ball: CameraBall | null;
  /**
   * How far off its view it looks, `[yaw, pitch]` rad: toward the base from the ball when the walls keep the ball off
   * its arm, the offset changed at most `FOLLOW_RIG.aim` rad/s (the view's own turns are the view's).
   */
  readonly aim: readonly [number, number];
}

/** Options for a follow camera: its code's data, the lens, and the camera before it. */
export interface FollowOptions extends Omit<FollowSpec, 'type'> {
  readonly fov?: number;
  /** The camera before this one: a follow camera without a yaw keeps its heading. */
  readonly from?: CameraPose;
}

/** A checked follow state for `options`. Throws `GFX_BAD_CAMERA`. */
export function followState(options: FollowOptions = {}): FollowState {
  const distance = options.distance ?? FOLLOW_RIG.back;
  const state: FollowState = {
    yaw: options.yaw ?? options.from?.yaw ?? 0,
    pitch: options.pitch ?? FOLLOW_RIG.pitch,
    distance,
    fov: options.fov ?? FOLLOW_RIG.lens,
    idle: 0,
    lead: [0, 0, 0],
    ground: null,
    pivot: null,
    base: null,
    lift: 0,
    ball: null,
    aim: [0, 0],
  };
  refuse('the follow camera', [
    ...rangeProblems({
      yaw: [state.yaw, -1e6, 1e6],
      pitch: [state.pitch, ...FOLLOW_LIMITS.pitch],
      distance: [distance, ...FOLLOW_LIMITS.distance],
      fov: [state.fov, 1, 179],
    }),
  ]);
  return state;
}

/** Steps a follow camera by one rendered frame (see the file comment). */
export function stepFollow(state: FollowState, input: FollowInput, dt: number): FollowState {
  const right = (input.look?.[0] ?? 0) + (input.turn?.[0] ?? 0) * FOLLOW_TURN_SPEED[0] * dt;
  const up = (input.look?.[1] ?? 0) + (input.turn?.[1] ?? 0) * FOLLOW_TURN_SPEED[1] * dt;
  let yaw = wrapAngle(state.yaw - right);
  const pitch = MathUtils.clamp(state.pitch + up, ...FOLLOW_LIMITS.pitch);
  const idle = right !== 0 || up !== 0 ? 0 : state.idle + dt;
  const distance = MathUtils.clamp(state.distance / Math.pow(ORBIT_ZOOM_STEP, input.zoom ?? 0), ...FOLLOW_LIMITS.distance); // prettier-ignore
  const f = input.follow;
  if (!f) return { ...state, yaw, pitch, idle, distance };
  const v = input.player?.velocity ?? [0, 0, 0];
  const speed = Math.hypot(v[0], v[2]);
  if (idle >= FOLLOW_RIG.idle && speed > FOLLOW_RIG.moving) {
    const gap = wrapAngle(Math.atan2(v[0], v[2]) - yaw);
    const most = FOLLOW_RIG.recentre * dt;
    yaw = wrapAngle(yaw + MathUtils.clamp(gap * (1 - Math.exp(-dt / FOLLOW_RIG.ease)), -most, most));
  }
  // the look-ahead by the share of the arm the camera stands out: a camera held in close looks at him, not past him
  const out = state.ball && state.base ? Math.min(1, Math.hypot(...state.ball.at.map((v, i) => v - state.base![i])) / distance) : 1; // prettier-ignore
  const ahead = speed > 1e-3 ? (FOLLOW_RIG.ahead * out * Math.min(speed / FOLLOW_RIG.run, 1)) / speed : 0;
  const lead = approach(state.lead, [v[0] * ahead, 0, v[2] * ahead], 1 - Math.exp(-dt / FOLLOW_RIG.lead));
  const standing = input.player?.grounded ?? true;
  let ground = state.ground ?? f[1];
  if (standing) ground += (f[1] - ground) * (1 - Math.exp(-dt / FOLLOW_RIG.settle));
  ground = MathUtils.clamp(ground, f[1] - FOLLOW_RIG.zone, f[1] + FOLLOW_RIG.zone);
  const height = input.eye ? input.eye[1] - f[1] : FOLLOW_RIG.height;
  const want: Vec3 = [f[0] + lead[0], ground + height, f[2] + lead[2]];
  let pivot = state.pivot ? approach(state.pivot, want, 1 - Math.exp(-dt / FOLLOW_RIG.lag)) : want;
  const gap = Math.hypot(pivot[0] - want[0], pivot[2] - want[2]);
  if (gap > FOLLOW_RIG.trail) pivot = approach(want, pivot, FOLLOW_RIG.trail / gap); // never more than `trail` behind
  pivot = [pivot[0], want[1], pivot[2]]; // the height has its own easing: the dead zone's
  const eye: Vec3 = input.eye ?? [f[0], f[1] + height, f[2]];
  const step = (state.pivot ? Math.hypot(...pivot.map((v, i) => v - state.pivot![i])) : Infinity) + COLLIDE_PULL * dt; // prettier-ignore
  const base = follow(input, state.base, eye, pivot, step);
  const tilted = (lift: number) => MathUtils.clamp(pitch - lift, ...FOLLOW_LIMITS.pitch);
  const cut = (lift: number) => {
    const [x, y, z] = poseForward({ yaw, pitch: tilted(lift) });
    return input.queries !== undefined && reach(input, base, [-x, -y, -z], distance) < distance - FOLLOW_RIG.room;
  };
  let lift = state.lift;
  const lower = Math.max(0, lift - FOLLOW_RIG.lower * dt);
  if (cut(lift)) lift = Math.min(FOLLOW_RIG.lift, lift + FOLLOW_RIG.raise * dt);
  else if (lift > 0 && !cut(lower)) lift = lower;
  const view = tilted(lift);
  const [fx, fy, fz] = poseForward({ yaw, pitch: view });
  const end: Vec3 = [base[0] - fx * distance, base[1] - fy * distance, base[2] - fz * distance];
  const before = state.ball && state.base ? { base: state.base, yaw: state.yaw, pitch: MathUtils.clamp(state.pitch - state.lift, ...FOLLOW_LIMITS.pitch) } : null; // prettier-ignore
  const turned = { base, yaw: wrapAngle(state.yaw - right), pitch: MathUtils.clamp(pitch - state.lift, ...FOLLOW_LIMITS.pitch) }; // prettier-ignore
  const carried = before && state.ball ? carry(state.ball.at, before, turned) : end; // its own turns (recentre, lift): to `end` at its pace
  const ball = moveCamera(input, state.ball, base, carried, end, dt);
  const aim = aimAt(state.ball ? state.aim : null, ball.at, base, [yaw, view], dt);
  return { ...state, yaw, pitch, idle, distance, lead, ground, pivot, base, lift, ball, aim };
}

/**
 * How far off the view `[yaw, pitch]` the camera at `at` looks to look at `base` (its pivot), changed from `aim` by
 * at most `FOLLOW_RIG.aim` rad/s (at once with no `aim`), so the player stays in the picture when the walls keep the
 * ball off its arm; none when the ball stands on the arm; right over the base, its heading as it was, looking down.
 */
function aimAt(
  aim: readonly [number, number] | null,
  at: Vec3,
  base: Vec3,
  view: readonly [number, number],
  dt: number,
): readonly [number, number] {
  // prettier-ignore
  const d: Vec3 = [base[0] - at[0], base[1] - at[1], base[2] - at[2]];
  const flat = Math.hypot(d[0], d[2]);
  const over = flat < COLLIDE_RADIUS; // right over it: its heading as it was, looking as far down as it may
  const pitch = MathUtils.clamp(over ? Math.sign(d[1]) * Math.PI : Math.atan2(d[1], flat), ...FOLLOW_LIMITS.pitch);
  const want = [over ? (aim?.[0] ?? 0) : wrapAngle(Math.atan2(d[0], d[2]) - view[0]), pitch - view[1]] as const;
  if (!aim) return want;
  const step = FOLLOW_RIG.aim * dt * (over ? 1.5 : 1); // right over it, only its pitch turns: half as fast again
  return [aim[0] + MathUtils.clamp(wrapAngle(want[0] - aim[0]), -step, step), aim[1] + MathUtils.clamp(want[1] - aim[1], -step, step)]; // prettier-ignore
}

/** The follow camera's pose: where its ball stands (the arm back from the pivot), looking along its view. */
export function followPose(state: FollowState): CameraPose {
  const p = state.base ?? [0, FOLLOW_RIG.height, 0];
  const yaw = wrapAngle(state.yaw + state.aim[0]);
  const pitch = MathUtils.clamp(state.pitch - state.lift + state.aim[1], ...FOLLOW_LIMITS.pitch);
  const f = poseForward({ yaw, pitch });
  const position: Vec3 = state.ball?.at ?? [p[0] - f[0] * state.distance, p[1] - f[1] * state.distance, p[2] - f[2] * state.distance]; // prettier-ignore
  const ahead = (p[0] - position[0]) * f[0] + (p[1] - position[1]) * f[1] + (p[2] - position[2]) * f[2];
  return makePose({
    position,
    yaw,
    pitch,
    fov: state.fov,
    near: 0.05,
    far: 500,
    distance: Math.max(ahead, 0.05),
  });
}

/** The follow camera's code data. */
export function followSpec(state: FollowState): FollowSpec {
  return { type: 'follow', yaw: state.yaw, pitch: state.pitch, distance: state.distance };
}

const PARTS: readonly CodePart[] = [
  ['yaw', -1e6, 1e6],
  ['pitch', FOLLOW_LIMITS.pitch[0] / DEG, FOLLOW_LIMITS.pitch[1] / DEG],
  ['distance', ...FOLLOW_LIMITS.distance],
];

/** Reads a follow camera's code: `cam3=follow[,<yaw>,<pitch>,<distance>]`. Throws `GFX_BAD_CAMERA_CODE`. */
export function parseFollowCode(code: string): FollowSpec {
  const [yaw, pitch, distance] = readCode(code, 'follow', PARTS, [0, 3]);
  return yaw === undefined ? { type: 'follow' } : { type: 'follow', yaw: yaw * DEG, pitch: pitch * DEG, distance };
}

/** The canonical code of a follow camera's data (numbers rounded: 0.01°, 0.001 m). */
export function formatFollowCode(spec: FollowSpec): string {
  if (spec.yaw === undefined) return 'cam3=follow';
  const parts = [codeDegrees(spec.yaw, true), codeDegrees(spec.pitch ?? FOLLOW_RIG.pitch), codeNumber(spec.distance ?? FOLLOW_RIG.back, 3)]; // prettier-ignore
  return `cam3=follow,${parts.join(',')}`;
}

/** A follow camera in words. */
export function describeFollow(spec: FollowSpec, pose: CameraPose): string {
  const lens = `Platformer camera (perspective, ${codeNumber(pose.fov, 0)}° field of view)`;
  const arm = codeNumber(spec.distance ?? FOLLOW_RIG.back, 3);
  return `${lens}, ${arm} m behind, heading ${codeDegrees(pose.yaw, true)}°, pitch ${codeDegrees(pose.pitch)}°`;
}

/** A follow camera: orbiting the hero and following him (see the file comment). */
export function createFollowCamera(options: FollowOptions = {}): FollowCamera<'follow', FollowSpec, FollowInput> {
  const steps = { step: stepFollow, pose: followPose, spec: followSpec, code: formatFollowCode, describe: describeFollow }; // prettier-ignore
  return followCamera('follow', followState(options), steps, { effects: FOLLOW_EFFECTS, fade: true });
}
