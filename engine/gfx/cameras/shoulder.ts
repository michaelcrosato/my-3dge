/**
 * @file The shooter's camera (PLAN.md WP 13.8, docs/PLAYGROUND.md §4; doctrine: Common ground): over the shoulder, as
 * third-person shooters frame it. `stepShoulder` and `shoulderPose` are the pure steps; `createShoulderCamera` wraps
 * them in a camera.
 *
 * The pivot is the hero's eye (`input.eye`, else `SHOULDER.height` above `input.follow`), followed with a time
 * constant of `SHOULDER.lag` real seconds and never more than `SHOULDER.trail` behind it; the shoulder point stands
 * `SHOULDER.right` to its right (to the left once swapped: `side` −1) and `SHOULDER.up` above it, and the camera
 * `SHOULDER.back` behind that along the view, looking along the view (`yaw`, `pitch`), so the screen's centre is
 * where the hero aims and he stands left of it; room for an arm shorter than `SHOULDER.close` behind his eye draws the
 * shoulder point in to the eye by its share across and the share squared up (eased by `SHOULDER.draw`), so a camera
 * backed against a wall still sees him. `input.look` and `input.turn` turn the view, or `input.view` sets it
 * (the sim's look, when no device turns the camera); `input.swap` swaps the shoulder, eased over `SHOULDER.swap`
 * seconds; `input.aim` (0 to 1, how far the sights are raised: engine/gfx/cameras/effects.ts) pulls the arm in to
 * `SHOULDER.aim`. The lens is `input.lens` (the player's field of view, engine/gfx/cameras/rig.ts), else its own.
 *
 * Walls (engine/gfx/cameras/collide.ts): the ball is swept from the eye to the pivot's lag, then to the shoulder
 * point; the camera moves on as `moveCamera` moves it (carried with the arm, then toward the arm's end as far as a
 * sweep back from the shoulder point clears, in at up to `COLLIDE_PULL`, out eased), so it moves at a pace (two cuts
 * left, collide.ts's) and never stands in a wall.
 *
 * Invariants: with `queries` and the eye at least `COLLIDE_RADIUS` from every wall, the camera's ball never ends
 * inside one (shoulder.test.ts); the pitch stays within `SHOULDER_LIMITS.pitch`. Pure: each step returns a new state.
 *
 * Codes: `cam3=shoulder[,<yaw>,<pitch>,<distance>[,<side>]]` (degrees, metres; side 1 right, −1 left); a bare one
 * looks where the camera before it looked.
 *
 * @example
 * const shoulder = createShoulderCamera();
 * shoulder.update({ follow: [0, 0, 0] }).position; // [-0.5, 1.824, -3.8]: right of and behind his eye, looking along +Z
 * shoulder.code(); // 'cam3=shoulder,0,0,3.8'
 * createShoulderCamera({ side: -1 }).update({ follow: [0, 0, 0] }).position[0]; // 0.5: over his left shoulder
 * @see engine/gfx/cameras/shoulder.test.ts
 */
import { MathUtils } from '../../core/math';
import { codeDegrees, codeNumber, followCamera, readCode, type CodePart, type FollowCamera } from './chase';
import { carry, COLLIDE_PULL, COLLIDE_TELEPORT, follow, moveCamera, reach, sweep, type CameraBall, type Walls } from './collide'; // prettier-ignore
import type { EffectWeights } from './effects';
import { approach, makePose, poseForward, poseRight, rangeProblems, refuse, wrapAngle, type CameraInput, type CameraPose, type Vec3 } from './pose'; // prettier-ignore

const DEG = MathUtils.DEG2RAD;

/** The rig's numbers (see the file comment): metres and real seconds; `lens` its own lens, degrees (Apex's 90 at 4:3). */
export const SHOULDER = Object.freeze({
  right: 0.5,
  up: 0.3,
  back: 3.8,
  aim: 1.5,
  height: 1.524,
  lag: 1 / 20,
  trail: 0.5,
  swap: 0.12,
  close: 1.2,
  draw: 0.1,
  lens: 73.74,
});
/** The range of the pitch (rad) and of the arm (m). */
export const SHOULDER_LIMITS = Object.freeze({ pitch: [-1.4, 1.4] as const, distance: [0.5, 20] as const });
/** Turn rates at full `input.turn`, rad/s: `[right, up]`. */
export const SHOULDER_TURN_SPEED = Object.freeze([2.2, 1.2] as const);
/** The effects it takes (engine/gfx/cameras/effects.ts): the lens, the sights, half the roll and the punch. */
export const SHOULDER_EFFECTS: EffectWeights = Object.freeze({ eye: 0, bob: 0, roll: 0.5, fov: 1, punch: 0.5, aim: 1 }); // prettier-ignore

/** A shoulder camera's input: the devices', the hero's eye and the walls. */
export interface ShoulderInput extends CameraInput, Walls {
  /** The hero's eye, m; without it `SHOULDER.height` above `follow`. */
  readonly eye?: Vec3;
  /** The view to look along, `[yaw, pitch]` rad, when no device turns the camera (the sim's look). */
  readonly view?: readonly [number, number];
  /** Swap the shoulder this frame. */
  readonly swap?: boolean;
  /** How far the sights are raised, 0 to 1: the arm pulls in to `SHOULDER.aim`. */
  readonly aim?: number;
  /** The lens, vertical degrees: the player's field of view. */
  readonly lens?: number;
}

/** A shoulder camera's code as data: without the numbers it looks where the camera before it looked. */
export interface ShoulderSpec {
  readonly type: 'shoulder';
  readonly yaw?: number;
  readonly pitch?: number;
  /** The arm when nothing is in the way and the sights are down, m. */
  readonly distance?: number;
  /** 1 over the right shoulder, −1 over the left. */
  readonly side?: number;
}

/** A shoulder camera's state: plain data, replaced by each step. */
export interface ShoulderState {
  readonly yaw: number;
  readonly pitch: number;
  readonly distance: number;
  readonly side: number;
  /** The side shown, easing toward `side` after a swap. */
  readonly shown: number;
  readonly fov: number;
  /** The pivot, m: the eye with its lag, the walls aside; null until the first follow. */
  readonly pivot: Vec3 | null;
  /** The shoulder point after the walls, m. */
  readonly shoulder: Vec3 | null;
  /** How far out the shoulder point stands, 0 (at the eye) to 1: a short arm draws it in. */
  readonly near: number;
  /** The camera after the walls (collide.ts's `moveCamera`); null until the first follow. */
  readonly ball: CameraBall | null;
}

/** Options for a shoulder camera: its code's data, the lens, and the camera before it. */
export interface ShoulderOptions extends Omit<ShoulderSpec, 'type'> {
  readonly fov?: number;
  /** The camera before this one: without a yaw and pitch, it looks the same way. */
  readonly from?: CameraPose;
}

/** A checked shoulder state for `options`. Throws `GFX_BAD_CAMERA`. */
export function shoulderState(options: ShoulderOptions = {}): ShoulderState {
  const distance = options.distance ?? SHOULDER.back;
  const side = options.side ?? 1;
  const state: ShoulderState = {
    yaw: options.yaw ?? options.from?.yaw ?? 0,
    pitch: options.pitch ?? options.from?.pitch ?? 0,
    distance,
    side,
    shown: side,
    fov: options.fov ?? SHOULDER.lens,
    pivot: null,
    shoulder: null,
    near: 1,
    ball: null,
  };
  refuse('the shoulder camera', [
    ...rangeProblems({
      yaw: [state.yaw, -1e6, 1e6],
      pitch: [state.pitch, -Math.PI / 2, Math.PI / 2],
      distance: [distance, ...SHOULDER_LIMITS.distance],
      fov: [state.fov, 1, 179],
    }),
    ...(side === 1 || side === -1 ? [] : [`side is ${side}; it must be 1 (right) or -1 (left)`]),
  ]);
  return { ...state, pitch: MathUtils.clamp(state.pitch, ...SHOULDER_LIMITS.pitch) };
}

/** The shoulder point for a pivot, a view heading and a side shown: right of and above the pivot (`near` of it). */
const shoulderOf = (pivot: Vec3, yaw: number, shown: number, near = 1): Vec3 => {
  const right = poseRight({ yaw });
  const across = SHOULDER.right * shown * near;
  return [pivot[0] + right[0] * across, pivot[1] + SHOULDER.up * near * near, pivot[2] + right[2] * across];
};

/** Steps a shoulder camera by one rendered frame (see the file comment). */
export function stepShoulder(state: ShoulderState, input: ShoulderInput, dt: number): ShoulderState {
  const right = (input.look?.[0] ?? 0) + (input.turn?.[0] ?? 0) * SHOULDER_TURN_SPEED[0] * dt;
  const up = (input.look?.[1] ?? 0) + (input.turn?.[1] ?? 0) * SHOULDER_TURN_SPEED[1] * dt;
  const yaw = input.view ? wrapAngle(input.view[0]) : wrapAngle(state.yaw - right);
  const pitch = MathUtils.clamp(input.view ? input.view[1] : state.pitch + up, ...SHOULDER_LIMITS.pitch);
  const side = input.swap ? -state.side : state.side;
  const shown = side + (state.shown - side) * Math.exp(-dt / SHOULDER.swap);
  const aim = MathUtils.clamp(input.aim ?? 0, 0, 1);
  const want = state.distance + (Math.min(SHOULDER.aim, state.distance) - state.distance) * aim;
  const f = input.follow;
  const eye: Vec3 | null = input.eye ?? (f ? [f[0], f[1] + SHOULDER.height, f[2]] : null);
  let pivot = state.pivot;
  if (eye) {
    pivot = pivot ? approach(pivot, eye, 1 - Math.exp(-dt / SHOULDER.lag)) : eye;
    const lag: Vec3 = [pivot[0] - eye[0], pivot[1] - eye[1], pivot[2] - eye[2]];
    const gap = Math.hypot(...lag);
    if (gap > SHOULDER.trail) pivot = approach(eye, pivot, SHOULDER.trail / gap); // never more than `trail` behind
  }
  if (!pivot) return { ...state, yaw, pitch, side, shown, fov: input.lens ?? state.fov };
  const held = eye ? sweep(input, eye, pivot) : pivot; // the walls stop the lag; it follows on as it would
  const [fx, fy, fz] = poseForward({ yaw, pitch });
  const room = MathUtils.clamp(reach(input, held, [-fx, -fy, -fz], want) / SHOULDER.close, 0, 1);
  const jumped = !state.shoulder || Math.hypot(...held.map((v, i) => v - state.shoulder![i])) > COLLIDE_TELEPORT;
  const near = jumped ? room : state.near + (room - state.near) * (1 - Math.exp(-dt / SHOULDER.draw));
  const step = (state.pivot ? Math.hypot(...pivot.map((v, i) => v - state.pivot![i])) : Infinity) + COLLIDE_PULL * dt; // prettier-ignore
  const shoulder = follow(input, state.shoulder, held, shoulderOf(held, yaw, shown, near), step);
  const end: Vec3 = [shoulder[0] - fx * want, shoulder[1] - fy * want, shoulder[2] - fz * want];
  const before = state.ball && state.shoulder ? { base: state.shoulder, yaw: state.yaw, pitch: state.pitch } : null;
  const carried = before && state.ball ? carry(state.ball.at, before, { base: shoulder, yaw, pitch }) : end;
  const ball = moveCamera(input, state.ball, shoulder, carried, end, dt);
  return { ...state, yaw, pitch, side, shown, fov: input.lens ?? state.fov, pivot, shoulder, near, ball };
}

/** The shoulder camera's pose: where its ball stands (the arm back from the shoulder point), looking along the view. */
export function shoulderPose(state: ShoulderState): CameraPose {
  const at = state.shoulder ?? shoulderOf([0, SHOULDER.height, 0], state.yaw, state.shown);
  const f = poseForward(state);
  const position: Vec3 = state.ball?.at ?? [at[0] - f[0] * state.distance, at[1] - f[1] * state.distance, at[2] - f[2] * state.distance]; // prettier-ignore
  const ahead = (at[0] - position[0]) * f[0] + (at[1] - position[1]) * f[1] + (at[2] - position[2]) * f[2];
  return makePose({
    position,
    yaw: state.yaw,
    pitch: state.pitch,
    fov: state.fov,
    near: 0.05,
    far: 500,
    distance: Math.max(ahead, 0.05),
  });
}

/** The shoulder camera's code data. */
export function shoulderSpec(state: ShoulderState): ShoulderSpec {
  return { type: 'shoulder', yaw: state.yaw, pitch: state.pitch, distance: state.distance, side: state.side };
}

const PARTS: readonly CodePart[] = [
  ['yaw', -1e6, 1e6],
  ['pitch', SHOULDER_LIMITS.pitch[0] / DEG, SHOULDER_LIMITS.pitch[1] / DEG],
  ['distance', ...SHOULDER_LIMITS.distance],
  ['side', -1, 1],
];

/** Reads a shoulder camera's code: `cam3=shoulder[,<yaw>,<pitch>,<distance>[,<side>]]`. Throws `GFX_BAD_CAMERA_CODE`. */
export function parseShoulderCode(code: string): ShoulderSpec {
  const [yaw, pitch, distance, side] = readCode(code, 'shoulder', PARTS, [0, 3, 4]);
  if (yaw === undefined) return { type: 'shoulder' };
  const spec: ShoulderSpec = { type: 'shoulder', yaw: yaw * DEG, pitch: pitch * DEG, distance };
  return side === undefined ? spec : { ...spec, side: side < 0 ? -1 : 1 };
}

/** The canonical code of a shoulder camera's data (numbers rounded: 0.01°, 0.001 m; the side only when left). */
export function formatShoulderCode(spec: ShoulderSpec): string {
  if (spec.yaw === undefined) return 'cam3=shoulder';
  const parts = [codeDegrees(spec.yaw, true), codeDegrees(spec.pitch ?? 0), codeNumber(spec.distance ?? SHOULDER.back, 3)]; // prettier-ignore
  return `cam3=shoulder,${parts.join(',')}${spec.side === -1 ? ',-1' : ''}`;
}

/** A shoulder camera in words. */
export function describeShoulder(spec: ShoulderSpec, pose: CameraPose): string {
  const lens = `Shooter camera (perspective, ${codeNumber(pose.fov, 0)}° field of view)`;
  const where = `over the ${spec.side === -1 ? 'left' : 'right'} shoulder, ${codeNumber(spec.distance ?? SHOULDER.back, 3)} m back`; // prettier-ignore
  return `${lens}, ${where}, heading ${codeDegrees(pose.yaw, true)}°, pitch ${codeDegrees(pose.pitch)}°`;
}

/** A shoulder camera: over the hero's shoulder (`input.eye`), turned by the devices, in front of the walls. */
export function createShoulderCamera(
  options: ShoulderOptions = {},
): FollowCamera<'shoulder', ShoulderSpec, ShoulderInput> {
  const steps = { step: stepShoulder, pose: shoulderPose, spec: shoulderSpec, code: formatShoulderCode, describe: describeShoulder }; // prettier-ignore
  return followCamera('shoulder', shoulderState(options), steps, { effects: SHOULDER_EFFECTS, fade: true });
}
