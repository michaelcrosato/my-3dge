/**
 * @file Camera poses (PLAN.md WP 2.5, §6.3; doctrine: Common ground): what every camera computes each frame, as plain
 * data in three.js's camera words, and the pure math over it. A `CameraPose` is a position, a heading (`yaw`) and a
 * `pitch`, the lens (`projection`, `fov`, `frustumSize`, `zoom`, `near`, `far`, as `PerspectiveCamera` and
 * `OrthographicCamera` name them), the height `boost` (engine/gfx/cameras/boost.ts) and the `distance` to the point
 * it looks at. Every camera (engine/gfx/cameras/{presets,orbit,fly,fixed}.ts) is a pure step `(state, input, dt) →
 * state` and a pure `(state) → pose`, wrapped in a `Camera` object; engine/gfx/cameras/place.ts puts a pose on a
 * three.js camera. None of it needs a GPU, so all of it is tested in Node.
 *
 * Conventions (§6.3): metres, radians, +Y up. `yaw` is the heading of the view direction, forward(ψ) = (sin ψ cos θ,
 * sin θ, cos ψ cos θ) with θ the pitch (+ up), the same angle as the intents' `cam` (engine/input/intents.ts), so
 * `camera.yaw()` goes straight to `intents.fromCamera` and W walks away from the camera; three.js's
 * `camera.rotation.y` is ψ + π, since a camera looks down its −Z. right = forward × up = (−cos ψ, 0, sin ψ).
 * `fov` is vertical and in degrees, as `PerspectiveCamera.fov`. A camera's input (`CameraInput`) is plain data that
 * presentation code builds from the devices: gfx never imports input/ (PLAN.md §6.1).
 *
 * Invariants: a pose is frozen and finite (`makePose` checks it: `GFX_BAD_CAMERA`); poses and camera state are view
 * state, never read by the sim or hashed; `dt` is real seconds since the last rendered frame, so a camera's smoothing
 * is the same at any frame rate.
 *
 * @example
 * const pose = makePose({ position: [0, 2, -5], yaw: 0, pitch: 0 }); // at z = -5, looking along +Z
 * poseForward(pose); // [0, 0, 1]
 * poseRight(pose); // [-1, 0, 0]
 * lookAt([0, 10, 10], [0, 0, 0]).pitch; // -π/4: looking down at 45°
 * frameSize(makePose({ position: [0, 0, 0], projection: 'orthographic', frustumSize: 10, zoom: 2 }), 1.5); // { width: 7.5, height: 5 }
 * @see engine/gfx/cameras/pose.test.ts
 */
import { codeError } from '../../core/log';
import { describeCamera, formatCameraCode, type CameraSpec, type CameraType } from './codes';

/** A point or direction, world space, m: `[x, y, z]`. */
export type Vec3 = readonly [number, number, number];

/** The two projections three.js has: `PerspectiveCamera` and `OrthographicCamera`. */
export type Projection = 'perspective' | 'orthographic';

/** Where a camera is, where it looks and its lens, in a frame: plain, frozen data (see the file comment). */
export interface CameraPose {
  /** The camera's position, m. */
  readonly position: Vec3;
  /** The heading of the view direction, rad (the intents' `cam`). */
  readonly yaw: number;
  /** Up or down from level, rad: + up, −π/2 straight down. */
  readonly pitch: number;
  readonly projection: Projection;
  /** Vertical field of view, degrees (`PerspectiveCamera.fov`). */
  readonly fov: number;
  /** Orthographic: the frustum's height at zoom 1, m (`top − bottom`, three.js's examples' `frustumSize`). */
  readonly frustumSize: number;
  /** As three.js cameras' `zoom`: 2 shows half as much (a narrower lens, a smaller frustum). */
  readonly zoom: number;
  readonly near: number;
  readonly far: number;
  /** Heights (world y) are stretched by this in the picture only; 1 shows true heights. */
  readonly boost: number;
  /** From the position to the point the camera looks at (its target), m. */
  readonly distance: number;
}

/** What the devices give a camera in a frame; every field is optional (orbit and fly turn, fly moves, views zoom). */
export interface CameraInput {
  /** Look this frame `[right, up]`, rad: turn the view right and tilt it up (a captured mouse × its sensitivity). */
  readonly look?: readonly [number, number];
  /** Turn rates `[right, up]`, −1 to 1 (arrow keys, a right stick), times the camera's turn speed. */
  readonly turn?: readonly [number, number];
  /** Move axes `[right, forward, up]`, −1 to 1 (WASD, then E or Space up and Q down): fly cameras. */
  readonly move?: readonly [number, number, number];
  /** Move at the fast speed (Shift). */
  readonly fast?: boolean;
  /** Zoom steps, + in (wheel notches, + and −): views step their zoom, orbits come closer, fly and fixed narrow. */
  readonly zoom?: number;
  /** 45° turns of a classic view, + raising its azimuth (the prototype's `]` key). */
  readonly turnSteps?: number;
  /** The point views and orbits follow (the hero's feet, or a point just ahead of his aim), m. */
  readonly follow?: Vec3;
}

/** A camera: its state, stepped once per rendered frame, and its pose. Made by the factories, or `createCamera`. */
export interface Camera {
  readonly type: CameraType;
  /** Steps the camera by one rendered frame (`dt` real seconds) and returns its new pose. */
  update(input?: CameraInput, dt?: number): CameraPose;
  /** The pose after the last update. */
  pose(): CameraPose;
  /** The heading, rad: what `intents.fromCamera` and the intents' `cam` take (engine/input/intents.ts). */
  yaw(): number;
  /** The camera as a code's data (engine/gfx/cameras/codes.ts). */
  spec(): CameraSpec;
  /** The camera as a code: `cam=…` or `cam3=…`. */
  code(): string;
  /** The camera in words. */
  describe(): string;
}

/** Defaults for the fields `makePose` is not given (the lens is three.js's `PerspectiveCamera` default). */
export const POSE_DEFAULTS = Object.freeze({
  yaw: 0,
  pitch: 0,
  projection: 'perspective' as Projection,
  fov: 50,
  frustumSize: 10,
  zoom: 1,
  near: 0.1,
  far: 2000,
  boost: 1,
  distance: 10,
});

/** A problem for each value that is missing, not finite, or outside `[min, max]`. */
export function rangeProblems(values: Record<string, readonly [unknown, number, number]>): string[] {
  const problems: string[] = [];
  for (const [name, [value, min, max]] of Object.entries(values)) {
    if (typeof value !== 'number' || !Number.isFinite(value))
      problems.push(`${name} is ${String(value)}, not a finite number`);
    else if (value < min || value > max) problems.push(`${name} is ${value}; it must be from ${min} to ${max}`);
  }
  return problems;
}

/** Throws `GFX_BAD_CAMERA` for `where` when `problems` is not empty. */
export function refuse(where: string, problems: string[]): void {
  if (problems.length) throw codeError('GFX_BAD_CAMERA', { where, problems: problems.join('; ') });
}

/** A finite point, or a problem. */
export function pointProblems(name: string, point: unknown): string[] {
  const ok =
    Array.isArray(point) && point.length === 3 && point.every((v) => typeof v === 'number' && Number.isFinite(v));
  return ok ? [] : [`${name} is ${JSON.stringify(point)}, not three finite numbers [x, y, z]`];
}

/** A checked, frozen pose: `fields` over `POSE_DEFAULTS`. Throws `GFX_BAD_CAMERA` naming every bad field. */
export function makePose(fields: Partial<CameraPose> & { position: Vec3 }): CameraPose {
  const p = { ...POSE_DEFAULTS, ...fields };
  const problems = [
    ...pointProblems('position', p.position),
    ...rangeProblems({
      yaw: [p.yaw, -1e9, 1e9],
      pitch: [p.pitch, -Math.PI / 2, Math.PI / 2],
      fov: [p.fov, 1, 179],
      frustumSize: [p.frustumSize, 1e-6, 1e9],
      zoom: [p.zoom, 1e-3, 1e3],
      near: [p.near, 1e-6, 1e9],
      far: [p.far, p.near, 1e9],
      boost: [p.boost, 0.01, 100],
      distance: [p.distance, 0, 1e9],
    }),
  ];
  if (p.projection !== 'perspective' && p.projection !== 'orthographic') {
    problems.push(`projection is ${JSON.stringify(p.projection)}; it must be 'perspective' or 'orthographic'`);
  }
  refuse('makePose', problems);
  return Object.freeze({ ...p, position: Object.freeze([...p.position]) as unknown as Vec3 });
}

/** The unit view direction (three.js's `camera.getWorldDirection()`). */
export function poseForward(pose: Pick<CameraPose, 'yaw' | 'pitch'>): Vec3 {
  const c = Math.cos(pose.pitch);
  return [Math.sin(pose.yaw) * c, Math.sin(pose.pitch), Math.cos(pose.yaw) * c];
}

/** The unit right direction on screen: forward × up, level whatever the pitch. */
export function poseRight(pose: Pick<CameraPose, 'yaw'>): Vec3 {
  return [-Math.cos(pose.yaw), 0, Math.sin(pose.yaw)];
}

/** The unit up direction on screen: right × forward (the heading when the camera looks straight down). */
export function poseUp(pose: Pick<CameraPose, 'yaw' | 'pitch'>): Vec3 {
  const s = Math.sin(pose.pitch);
  return [-Math.sin(pose.yaw) * s, Math.cos(pose.pitch), -Math.cos(pose.yaw) * s];
}

/** The point the camera looks at: `distance` along its view direction. */
export function poseTarget(pose: CameraPose): Vec3 {
  const f = poseForward(pose);
  const [x, y, z] = pose.position;
  return [x + f[0] * pose.distance, y + f[1] * pose.distance, z + f[2] * pose.distance];
}

/** The yaw, pitch and distance that look from `from` at `to` (as `Object3D.lookAt`); straight up or down keeps yaw 0. */
export function lookAt(from: Vec3, to: Vec3): { yaw: number; pitch: number; distance: number } {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const level = Math.hypot(dx, dz);
  return { yaw: level > 0 ? Math.atan2(dx, dz) : 0, pitch: Math.atan2(dy, level), distance: Math.hypot(level, dy) };
}

/**
 * The point at `distance` from `target`, at `azimuth` round it (from +Z toward +X) and `elevation` above its horizon:
 * three.js's `Vector3.setFromSphericalCoords(distance, π/2 − elevation, azimuth)`, added to the target.
 */
export function orbitPoint(target: Vec3, azimuth: number, elevation: number, distance: number): Vec3 {
  const c = Math.cos(elevation) * distance;
  return [
    target[0] + Math.sin(azimuth) * c,
    target[1] + Math.sin(elevation) * distance,
    target[2] + Math.cos(azimuth) * c,
  ];
}

/** `angle` wrapped into (−π, π]. */
export function wrapAngle(angle: number): number {
  const a = angle % (2 * Math.PI);
  return a > Math.PI ? a - 2 * Math.PI : a <= -Math.PI ? a + 2 * Math.PI : a;
}

/** The heading of a camera that stands at `azimuth` round its target and looks at it: azimuth + π, wrapped. */
export function headingOf(azimuth: number): number {
  return wrapAngle(azimuth + Math.PI);
}

/** The picture's size at the camera's target, m: the frustum (orthographic), or the lens's frame at `distance`. */
export function frameSize(pose: CameraPose, aspect: number): { width: number; height: number } {
  const height =
    pose.projection === 'orthographic'
      ? pose.frustumSize / pose.zoom
      : (2 * pose.distance * Math.tan(((pose.fov / 2) * Math.PI) / 180)) / pose.zoom;
  return { width: height * aspect, height };
}

/**
 * A perspective framing of `pose` with a `fov` lens: an orthographic pose becomes a camera on the same line of sight
 * to the same target, as far from it as frames the same picture height; a perspective pose keeps its place.
 */
export function perspectiveFrom(pose: CameraPose, fov: number): { position: Vec3; yaw: number; pitch: number } {
  if (pose.projection === 'perspective') return { position: pose.position, yaw: pose.yaw, pitch: pose.pitch };
  const target = poseTarget(pose);
  const d = frameSize(pose, 1).height / 2 / Math.tan(((fov / 2) * Math.PI) / 180);
  const f = poseForward(pose);
  return {
    position: [target[0] - f[0] * d, target[1] - f[1] * d, target[2] - f[2] * d],
    yaw: pose.yaw,
    pitch: pose.pitch,
  };
}

/** Exponential smoothing toward `to`: `k` = 1 − e^(−dt/τ) moves the same share per second at any frame rate. */
export function approach(from: Vec3, to: Vec3, k: number): Vec3 {
  return [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k, from[2] + (to[2] - from[2]) * k];
}

/** The steps a camera type supplies to `cameraFrom`. */
export interface CameraSteps<S> {
  step(state: S, input: CameraInput, dt: number): S;
  pose(state: S): CameraPose;
  spec(state: S): CameraSpec;
}

/** Wraps a camera's pure steps and its first state in a `Camera` (the factories use it). */
export function cameraFrom<S>(type: CameraType, first: S, steps: CameraSteps<S>): Camera {
  let state = first;
  let pose = steps.pose(state);
  return {
    type,
    update(input = {}, dt = 0) {
      refuse(`${type} camera update`, rangeProblems({ dt: [dt, 0, 3600] }));
      state = steps.step(state, input, dt);
      pose = steps.pose(state);
      return pose;
    },
    pose: () => pose,
    yaw: () => wrapAngle(pose.yaw),
    spec: () => steps.spec(state),
    code: () => formatCameraCode(steps.spec(state)),
    describe: () => describeCamera(steps.spec(state), pose),
  };
}
