/**
 * @file The orbit camera (PLAN.md WP 2.5; doctrine: Common ground): a perspective camera on a sphere round a target,
 * turned, tilted and pulled in by the devices, as three.js's OrbitControls does, and following a point unless fixed.
 * `stepOrbit` and `orbitPose` are the pure steps; `createOrbitCamera` wraps them in a `Camera`.
 *
 * Its state is OrbitControls' spherical coordinates: `azimuth` (round the target from +Z toward +X, the azimuthal
 * angle), `elevation` (above the target's horizon; OrbitControls' polar angle is π/2 − elevation) and `distance`.
 * `input.look` and `input.turn` turn the view right (the azimuth falls, as a drag to the right does in OrbitControls)
 * and up (the camera sinks: the elevation falls); `input.zoom` steps the distance by `ORBIT_ZOOM_STEP`.
 *
 * Invariants: the elevation stays within `ORBIT_LIMITS.elevation`, the distance within `ORBIT_LIMITS.distance`. The
 * target follows `input.follow` (raised by `ORBIT_LIFT`) with a time constant of `ORBIT_LAG` real seconds, snaps to
 * it the first time (unless it started on another camera's target), and stays put when the camera was made with a
 * target. Pure: each step returns a new state.
 *
 * Carried from `my-3d2dge:src/lab3d/50-cameras.js:19-22, 69-72` (the orbit, its numbers) and
 * `my-3d2dge:src/lab3d/60-panel.js:75, 88` (its drag and wheel).
 *
 * @example
 * const orbit = createOrbitCamera({ azimuth: 0, elevation: Math.PI / 4, distance: 10, target: [0, 1, 0] });
 * orbit.pose().position; // [0, 8.07…, 7.07…]: south of the target (+Z), 45° up
 * orbit.yaw(); // π: it looks along −Z
 * orbit.update({ look: [0.1, 0] }).yaw; // π − 0.1: turned right
 * orbit.code(); // 'cam3=orbit,354.27,45,10,0,1,0'
 * @see engine/gfx/cameras/orbit.test.ts
 */
import { MathUtils } from '../../core/math';
import type { OrbitSpec } from './codes';
import {
  approach,
  cameraFrom,
  headingOf,
  makePose,
  orbitPoint,
  pointProblems,
  rangeProblems,
  refuse,
  type Camera,
  type CameraInput,
  type CameraPose,
  type Vec3,
} from './pose';

const DEG = MathUtils.DEG2RAD;

/** The orbit's starting place (lab3d's): azimuth and elevation in rad, distance in m. */
export const ORBIT_DEFAULTS = Object.freeze({ azimuth: 35 * DEG, elevation: 32 * DEG, distance: 17 });
/** The range of the elevation (rad) and the distance (m). */
export const ORBIT_LIMITS = Object.freeze({ elevation: [2 * DEG, 89 * DEG] as const, distance: [1, 100] as const });
/** The orbit's lens, degrees (`PerspectiveCamera.fov`). */
export const ORBIT_FOV = 35;
/** How high above the followed point the orbit looks, m. */
export const ORBIT_LIFT = 0.8;
/** The time constant of the orbit's follow, real seconds. */
export const ORBIT_LAG = 0.2;
/** How much one zoom step brings the camera in (the distance is divided by it). */
export const ORBIT_ZOOM_STEP = 1.15;
/** Turn rates at full `input.turn`, rad/s: `[right, up]`. */
export const ORBIT_TURN_SPEED = Object.freeze([1.7, 1.2] as const);

/** An orbit camera's state: plain data, replaced by each step. */
export interface OrbitState {
  readonly azimuth: number;
  readonly elevation: number;
  readonly distance: number;
  /** The lens, degrees. */
  readonly fov: number;
  /** What it looks at, m; null until the first follow (the origin, raised by `ORBIT_LIFT`, meanwhile). */
  readonly target: Vec3 | null;
  /** The target stays put. */
  readonly fixed: boolean;
}

/** Options for an orbit beyond its code: the lens. */
export interface OrbitOptions extends Omit<OrbitSpec, 'type'> {
  readonly fov?: number;
  /** The target until the first follow, m (switching from another camera: where it looked). */
  readonly start?: Vec3;
}

/** A checked orbit state for `options`. Throws `GFX_BAD_CAMERA`. */
export function orbitState(options: OrbitOptions = {}): OrbitState {
  const state: OrbitState = {
    azimuth: options.azimuth ?? ORBIT_DEFAULTS.azimuth,
    elevation: options.elevation ?? ORBIT_DEFAULTS.elevation,
    distance: options.distance ?? ORBIT_DEFAULTS.distance,
    fov: options.fov ?? ORBIT_FOV,
    target: options.target ? [...options.target] : options.start ? [...options.start] : null,
    fixed: options.target !== undefined,
  };
  refuse('the orbit camera', [
    ...rangeProblems({
      azimuth: [state.azimuth, -1e6, 1e6],
      elevation: [state.elevation, ...ORBIT_LIMITS.elevation],
      distance: [state.distance, ...ORBIT_LIMITS.distance],
      fov: [state.fov, 1, 179],
    }),
    ...(state.target ? pointProblems('target', state.target) : []),
  ]);
  return state;
}

/** Steps an orbit by one rendered frame: turned and tilted by `look` and `turn`, pulled in by `zoom`, following. */
export function stepOrbit(state: OrbitState, input: CameraInput, dt: number): OrbitState {
  const right = (input.look?.[0] ?? 0) + (input.turn?.[0] ?? 0) * ORBIT_TURN_SPEED[0] * dt;
  const up = (input.look?.[1] ?? 0) + (input.turn?.[1] ?? 0) * ORBIT_TURN_SPEED[1] * dt;
  let next: OrbitState = {
    ...state,
    azimuth: state.azimuth - right,
    elevation: MathUtils.clamp(state.elevation - up, ...ORBIT_LIMITS.elevation),
    distance: MathUtils.clamp(state.distance / Math.pow(ORBIT_ZOOM_STEP, input.zoom ?? 0), ...ORBIT_LIMITS.distance),
  };
  if (input.follow && !next.fixed) {
    const want: Vec3 = [input.follow[0], input.follow[1] + ORBIT_LIFT, input.follow[2]];
    next = { ...next, target: next.target ? approach(next.target, want, 1 - Math.exp(-dt / ORBIT_LAG)) : want };
  }
  return next;
}

/** The orbit's pose: on its sphere round the target, looking at it. */
export function orbitPose(state: OrbitState): CameraPose {
  const target = state.target ?? [0, ORBIT_LIFT, 0];
  return makePose({
    position: orbitPoint(target, state.azimuth, state.elevation, state.distance),
    yaw: headingOf(state.azimuth),
    pitch: -state.elevation,
    projection: 'perspective',
    fov: state.fov,
    near: 0.05,
    far: 500,
    distance: state.distance,
  });
}

/** The orbit's code data. */
export function orbitSpec(state: OrbitState): OrbitSpec {
  const { azimuth, elevation, distance } = state;
  return {
    type: 'orbit',
    azimuth,
    elevation,
    distance,
    ...(state.fixed && state.target ? { target: state.target } : {}),
  };
}

/** An orbit camera (a target given makes it fixed there; without one it follows `input.follow`). */
export function createOrbitCamera(options: OrbitOptions = {}): Camera {
  return cameraFrom('orbit', orbitState(options), { step: stepOrbit, pose: orbitPose, spec: orbitSpec });
}
