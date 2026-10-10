/**
 * @file The fixed camera (PLAN.md WP 2.5): a perspective camera that stays where it is put, the prototype's "Fix"
 * (F): the hero is the devices' again while the camera watches. `stepFixed` and `fixedPose` are the pure steps;
 * `createFixedCamera` wraps them in a `Camera`.
 *
 * It ignores every input but `input.zoom`, which narrows its lens by 5° a step (`FLY_FOV_RANGE`, as the fly camera).
 * Made from another camera's pose (`from`: fixing the camera on screen), it keeps that camera's place and lens; an
 * orthographic view becomes a camera on the same line of sight, as far from the target as its lens frames the same
 * picture (`perspectiveFrom`, engine/gfx/cameras/pose.ts). Fixing a classic view on the spot is the view's own
 * `target` instead (engine/gfx/cameras/presets.ts), which keeps its projection.
 *
 * Invariants: nothing but `zoom` moves it; its pitch stays within ±π/2. Pure: each step returns a new state.
 *
 * Carried from `my-3d2dge:src/stress-world/40-cameras.js:116-119, 251-258` (the fixed pose, `toggleFix`).
 *
 * @example
 * const fixed = createFixedCamera({ position: [0, 3, -6], yaw: 0, pitch: -0.3, fov: 60 });
 * fixed.update({ move: [0, 1, 0], look: [1, 1] }, 1).position; // [0, 3, -6]: it stays
 * fixed.update({ zoom: 2 }).fov; // 50
 * fixed.code(); // 'cam3=fixed,0,3,-6,0,-17.19,50'
 * @see engine/gfx/cameras/fixed.test.ts
 */
import { MathUtils } from '../../core/math';
import type { FreeSpec } from './codes';
import { FLY_FOV, FLY_FOV_RANGE } from './fly';
import {
  cameraFrom,
  makePose,
  perspectiveFrom,
  pointProblems,
  rangeProblems,
  refuse,
  type Camera,
  type CameraInput,
  type CameraPose,
  type Vec3,
} from './pose';

/** A fixed camera's state: plain data. */
export interface FixedState {
  readonly position: Vec3;
  readonly yaw: number;
  readonly pitch: number;
  readonly fov: number;
}

/** Options for a fixed camera: its code's data, and the pose to fix when the code has no position. */
export interface FixedOptions extends Omit<FreeSpec, 'type'> {
  readonly from?: CameraPose;
}

/** A checked fixed state for `options`: the code's place, else `from`'s, else the origin at eye height. */
export function fixedState(options: FixedOptions = {}): FixedState {
  const lens = options.from?.projection === 'perspective' ? options.from.fov : FLY_FOV;
  const fov = options.fov ?? lens;
  const start = options.position ? null : options.from ? perspectiveFrom(options.from, fov) : null;
  const state: FixedState = {
    position: [...(options.position ?? start?.position ?? [0, 1.7, 0])],
    yaw: options.yaw ?? start?.yaw ?? 0,
    pitch: options.pitch ?? start?.pitch ?? 0,
    fov,
  };
  refuse('the fixed camera', [
    ...pointProblems('position', state.position),
    ...rangeProblems({
      yaw: [state.yaw, -1e6, 1e6],
      pitch: [state.pitch, -Math.PI / 2, Math.PI / 2],
      fov: [fov, 1, 179],
    }),
  ]);
  return state;
}

/** Steps a fixed camera: only `input.zoom` changes it (its lens). */
export function stepFixed(state: FixedState, input: CameraInput): FixedState {
  return input.zoom ? { ...state, fov: MathUtils.clamp(state.fov - input.zoom * 5, ...FLY_FOV_RANGE) } : state;
}

/** The fixed camera's pose. */
export function fixedPose(state: FixedState): CameraPose {
  return makePose({
    position: state.position,
    yaw: state.yaw,
    pitch: state.pitch,
    fov: state.fov,
    near: 0.1,
    far: 500,
  });
}

/** The fixed camera's code data. */
export function fixedSpec(state: FixedState): FreeSpec {
  return { type: 'fixed', position: state.position, yaw: state.yaw, pitch: state.pitch, fov: state.fov };
}

/** A fixed camera: at `position`, else where `from` (the camera on screen) is, else at eye height over the origin. */
export function createFixedCamera(options: FixedOptions = {}): Camera {
  return cameraFrom('fixed', fixedState(options), { step: stepFixed, pose: fixedPose, spec: fixedSpec });
}
