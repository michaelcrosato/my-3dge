/**
 * @file Sound in 3D (PLAN.md WP 9.3, §6.1; doctrine: Common ground): Web Audio's `PannerNode` places a sound, its
 * `AudioListener` follows the camera, and occlusion muffles a sound a wall stands in front of, asked of the sim's
 * read-only `QueryView` (presentation only: nothing here changes play).
 *
 * The listener takes the engine's camera pose (`position`, `yaw`, `pitch`, as engine/gfx/cameras/pose.ts gives it, or
 * any object with those three): it hears along `forward = [sin yaw · cos pitch, sin pitch, cos yaw · cos pitch]`, with
 * the screen's up as its up, so a sound on the camera's right is heard on the right.
 *
 * `PANNER` is how every placed sound is panned: HRTF (the best Web Audio offers for headphones), the inverse distance
 * model (gain `refDistance / d` past 1 m, as three.js's `PositionalAudio`), no cone. `OCCLUSION` is how a blocked one
 * sounds: through a lowpass at `cutoff` Hz (Butterworth, so the lows keep their level) and at `gain`, both eased in
 * with a time constant of `ease` seconds.
 *
 * Invariants: `occluded` casts one ray from the listener to the sound against `OCCLUSION.groups` (the level: `world`),
 * stopping `OCCLUSION.margin` short of the sound, so a torch on a wall is not hidden by its own wall; a sound closer
 * than the margin is never occluded. Positions are world space, metres.
 *
 * @example
 * import { createSettings } from '../../core/settings';
 * import { createPhysics } from '../../physics/world';
 * import { queryView } from '../../sim/queryView';
 * listenerAxes({ yaw: 0, pitch: 0 }); // { forward: [0, 0, 1], up: [-0, 1, -0] }
 * const physics = createPhysics();
 * const wall = { shape: { type: 'box', size: [4, 3, 0.5] } } as const;
 * physics.addBody({ type: 'fixed', position: [0, 1.5, 4], colliders: [wall] });
 * physics.step({ dt: 1 / 60, settings: createSettings().sim }); // queries see it from the next step
 * occluded(queryView(physics), [0, 1.6, 0], [0, 1.6, 8]); // true: the wall stands between
 * @see engine/audio/runtime/spatial.test.ts
 */
import type { QueryView } from '../../sim/queryView';

/** A point or a direction, world space, m: `[x, y, z]`. */
export type Vec3 = readonly [number, number, number];

/** Where the listener is and where it looks: the engine's camera pose (engine/gfx/cameras/pose.ts) satisfies it. */
export interface ListenerPose {
  /** The camera's position, m. */
  readonly position: Vec3;
  /** The heading of the view, rad: 0 looks along +Z, π/2 along +X. */
  readonly yaw: number;
  /** Up or down from level, rad: + up. */
  readonly pitch: number;
}

/** How every placed sound is panned and fades with distance (`PannerNode`'s options). */
export const PANNER: Readonly<PannerOptions> = Object.freeze({
  panningModel: 'HRTF',
  distanceModel: 'inverse',
  refDistance: 1,
  maxDistance: 10000,
  rolloffFactor: 1,
});

/** How an occluded sound is muffled, and how occlusion is tested. */
export const OCCLUSION = Object.freeze({
  /** The lowpass cutoff behind a wall, Hz. */
  cutoff: 900,
  /** The cutoff in the open, Hz (above hearing: the filter passes everything). */
  open: 22000,
  /** The lowpass's Q in dB, as `BiquadFilterNode` takes it: Butterworth's 1/√2, flat below the cutoff. */
  q: -3.0103,
  /** The gain behind a wall. */
  gain: 0.6,
  /** The time constant of the change, s. */
  ease: 0.06,
  /** How far short of the sound the ray stops, m. */
  margin: 0.3,
  /** The collision groups that block sound: the level. */
  groups: 'world' as const,
});

/** The listener's forward and up directions (unit vectors) for `pose`. */
export function listenerAxes(pose: Pick<ListenerPose, 'yaw' | 'pitch'>): { forward: Vec3; up: Vec3 } {
  const [sy, cy, sp, cp] = [Math.sin(pose.yaw), Math.cos(pose.yaw), Math.sin(pose.pitch), Math.cos(pose.pitch)];
  return { forward: [sy * cp, sp, cy * cp], up: [-sy * sp, cp, -cy * sp] };
}

/** Sets three `AudioParam`s to `values` at `time`. */
function setParams(params: readonly AudioParam[], values: Vec3, time: number): void {
  params.forEach((param, i) => param.setValueAtTime(values[i], time));
}

/** Puts the context's listener at `pose` at `time`. */
export function placeListener(listener: AudioListener, pose: ListenerPose, time: number): void {
  const { forward, up } = listenerAxes(pose);
  if (!listener.positionX) {
    // Browsers without the AudioParam form (Firefox) still take the method form.
    listener.setPosition(...pose.position);
    listener.setOrientation(...forward, ...up);
    return;
  }
  setParams([listener.positionX, listener.positionY, listener.positionZ], pose.position, time);
  setParams([listener.forwardX, listener.forwardY, listener.forwardZ], forward, time);
  setParams([listener.upX, listener.upY, listener.upZ], up, time);
}

/** Puts `panner` at `position` at `time`. */
export function placePanner(panner: PannerNode, position: Vec3, time: number): void {
  setParams([panner.positionX, panner.positionY, panner.positionZ], position, time);
}

/** Whether a wall of the level stands between `from` (the listener) and `to` (the sound). */
export function occluded(queries: QueryView, from: Vec3, to: Vec3): boolean {
  const d: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const length = Math.hypot(...d);
  if (length <= OCCLUSION.margin) return false;
  const dir: Vec3 = [d[0] / length, d[1] / length, d[2] / length];
  return queries.raycast(from, dir, { maxDistance: length - OCCLUSION.margin, groups: OCCLUSION.groups }) !== null;
}
