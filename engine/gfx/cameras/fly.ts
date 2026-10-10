/**
 * @file The fly camera (PLAN.md WP 2.5; doctrine: Agent-operable): a free perspective camera that flies where it
 * looks, the prototype's free camera. `stepFly` and `flyPose` are the pure steps; `createFlyCamera` wraps them in a
 * `Camera`.
 *
 * `input.move` is `[right, forward, up]`: forward flies along the view direction (pitch included), right strafes level,
 * up climbs straight up, at `FLY_SPEED` (`FLY_FAST_SPEED` with `input.fast`). `input.look` turns the view right and
 * up directly; `input.turn` at `FLY_TURN_SPEED`. `input.zoom` narrows the lens by 5° a step. Made from another
 * camera's pose (`from`), it starts where that one is; from an orthographic view, on the same line of sight as far
 * from the target as its lens frames the same picture (`perspectiveFrom`, engine/gfx/cameras/pose.ts).
 *
 * Invariants: the pitch stays within ±`FLY_MAX_PITCH`, the lens within `FLY_FOV_RANGE` degrees, and the position
 * inside `bounds` when given (a level's box, say). Speeds are per real second, so a fly is the same at any frame rate.
 * Pure: each step returns a new state.
 *
 * Carried from `my-3d2dge:src/stress-world/40-cameras.js:105-114` (`flyStep`: speeds, turn rates, the pitch limit,
 * converted to metres) and `:226-233` (the lens steps).
 *
 * @example
 * const fly = createFlyCamera({ position: [0, 1.7, 0], yaw: 0, pitch: 0 });
 * fly.update({ move: [0, 1, 0] }, 0.5).position; // [0, 1.7, 2]: half a second forward along +Z at 4 m/s
 * fly.update({ move: [1, 0, 0] }, 0.25).position; // [-1, 1.7, 2]: right is −X when looking along +Z
 * fly.code(); // 'cam3=fly,-1,1.7,2,0,0,70'
 * @see engine/gfx/cameras/fly.test.ts
 */
import { MathUtils } from '../../core/math';
import type { FreeSpec } from './codes';
import {
  cameraFrom,
  makePose,
  perspectiveFrom,
  poseForward,
  poseRight,
  pointProblems,
  rangeProblems,
  refuse,
  wrapAngle,
  type Camera,
  type CameraInput,
  type CameraPose,
  type Vec3,
} from './pose';

/** Flying speed, m/s (the prototype's 64 units/s). */
export const FLY_SPEED = 4;
/** Flying speed with `input.fast`, m/s (the prototype's 170 units/s). */
export const FLY_FAST_SPEED = 10.625;
/** Turn rates at full `input.turn`, rad/s: `[right, up]`. */
export const FLY_TURN_SPEED = Object.freeze([1.7, 1.2] as const);
/** How far up or down the fly camera looks, rad. */
export const FLY_MAX_PITCH = 1.5;
/** The fly camera's lens, degrees (`PerspectiveCamera.fov`). */
export const FLY_FOV = 70;
/** The lens range of zoom steps, degrees. */
export const FLY_FOV_RANGE = Object.freeze([30, 110] as const);
/** Where a fly camera starts with neither a position nor a pose to start from: eye height at the origin. */
const START: Vec3 = [0, 1.7, 0];

/** An axis-aligned box the camera stays in, m (`Box3`'s min and max, as plain points). */
export interface FlyBounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

/** A fly camera's state: plain data, replaced by each step. */
export interface FlyState {
  readonly position: Vec3;
  readonly yaw: number;
  readonly pitch: number;
  readonly fov: number;
  readonly bounds: FlyBounds | null;
}

/** Options for a fly camera: its code's data, a pose to start from when the code has no position, and bounds. */
export interface FlyOptions extends Omit<FreeSpec, 'type'> {
  readonly from?: CameraPose;
  readonly bounds?: FlyBounds;
}

/** Clamps `p` into `bounds`. */
function inside(p: Vec3, bounds: FlyBounds | null): Vec3 {
  if (!bounds) return p;
  const { min, max } = bounds;
  return [
    MathUtils.clamp(p[0], min[0], max[0]),
    MathUtils.clamp(p[1], min[1], max[1]),
    MathUtils.clamp(p[2], min[2], max[2]),
  ];
}

/** A checked fly state for `options`. Throws `GFX_BAD_CAMERA`. */
export function flyState(options: FlyOptions = {}): FlyState {
  const fov = options.fov ?? FLY_FOV;
  const start = options.position ? null : options.from ? perspectiveFrom(options.from, fov) : null;
  const state: FlyState = {
    position: [...(options.position ?? start?.position ?? START)],
    yaw: options.yaw ?? start?.yaw ?? 0,
    pitch: options.pitch ?? start?.pitch ?? 0,
    fov,
    bounds: options.bounds ?? null,
  };
  refuse('the fly camera', [
    ...pointProblems('position', state.position),
    ...rangeProblems({
      yaw: [state.yaw, -1e6, 1e6],
      pitch: [state.pitch, -Math.PI / 2, Math.PI / 2],
      fov: [fov, 1, 179],
    }),
    ...(state.bounds
      ? [...pointProblems('bounds.min', state.bounds.min), ...pointProblems('bounds.max', state.bounds.max)]
      : []),
  ]);
  return {
    ...state,
    pitch: MathUtils.clamp(state.pitch, -FLY_MAX_PITCH, FLY_MAX_PITCH),
    position: inside(state.position, state.bounds),
  };
}

/** Steps a fly camera by one rendered frame: turned by `look` and `turn`, moved by `move`, its lens by `zoom`. */
export function stepFly(state: FlyState, input: CameraInput, dt: number): FlyState {
  const right = (input.look?.[0] ?? 0) + (input.turn?.[0] ?? 0) * FLY_TURN_SPEED[0] * dt;
  const up = (input.look?.[1] ?? 0) + (input.turn?.[1] ?? 0) * FLY_TURN_SPEED[1] * dt;
  const yaw = wrapAngle(state.yaw - right);
  const pitch = MathUtils.clamp(state.pitch + up, -FLY_MAX_PITCH, FLY_MAX_PITCH);
  const [mr, mf, mu] = input.move ?? [0, 0, 0];
  const step = (input.fast ? FLY_FAST_SPEED : FLY_SPEED) * dt;
  const f = poseForward({ yaw, pitch });
  const r = poseRight({ yaw });
  const [x, y, z] = state.position;
  const position = inside(
    [x + (f[0] * mf + r[0] * mr) * step, y + (f[1] * mf + mu) * step, z + (f[2] * mf + r[2] * mr) * step],
    state.bounds,
  );
  const fov = input.zoom ? MathUtils.clamp(state.fov - input.zoom * 5, ...FLY_FOV_RANGE) : state.fov;
  return { ...state, position, yaw, pitch, fov };
}

/** The fly camera's pose. */
export function flyPose(state: FlyState): CameraPose {
  return makePose({
    position: state.position,
    yaw: state.yaw,
    pitch: state.pitch,
    fov: state.fov,
    near: 0.1,
    far: 500,
  });
}

/** The fly camera's code data. */
export function flySpec(state: FlyState): FreeSpec {
  return { type: 'fly', position: state.position, yaw: state.yaw, pitch: state.pitch, fov: state.fov };
}

/** A fly camera: at `position`, else where `from` (the camera before it) was, else at eye height over the origin. */
export function createFlyCamera(options: FlyOptions = {}): Camera {
  return cameraFrom('fly', flyState(options), { step: stepFly, pose: flyPose, spec: flySpec });
}
