/**
 * @file Cameras into three.js (PLAN.md WP 2.5, §8.3): `createCamera` makes the camera a code names
 * (engine/gfx/cameras/codes.ts) from the camera before it, and `placeCamera` puts a pose on a three.js camera each
 * frame, so the renderer draws it (`gfx.frame({ scene, camera })`, engine/gfx/renderer.ts). `createCameraPair` holds
 * one `PerspectiveCamera` and one `OrthographicCamera` (both keeping their height boost, engine/gfx/cameras/boost.ts)
 * and places the one a pose's projection names, so switching cameras never makes another three.js camera (that it
 * builds no pipeline either is WP 2.7's measurement).
 *
 * `placeCamera` sets the position, the rotation (Euler `YXZ`: pitch about X, then yaw + π about Y, since a three.js
 * camera looks down its −Z), `near`, `far`, `zoom`, then the lens: `fov` and `aspect`, or the frustum `top = −bottom
 * = frustumSize / 2`, `right = −left = top × aspect`. It sets `coordinateSystem` to WebGPU's (depth 0 to 1) before the
 * projection, as the renderer would on its first frame, and applies the boost last.
 *
 * Invariants: a placed camera's `getWorldDirection()` is `poseForward(pose)` and its up on screen `poseUp(pose)`;
 * the aspect is width / height, positive and finite (`GFX_BAD_CAMERA` otherwise, and for a pose of the other
 * projection). Placing is presentation: nothing here reaches the sim or the hash.
 *
 * Carried from `my-3d2dge:src/stress-world/40-cameras.js:119-148` (`placeCamera`, `setCam`, without the cards).
 *
 * @example
 * const pair = createCameraPair();
 * const camera = pair.place(createCamera('cam=threequarter').update({ follow: [0, 0, 0] }), 16 / 9);
 * camera.type; // 'OrthographicCamera'
 * const fly = createCamera('cam3=fly', { from: createCamera('cam=iso').pose() }); // where the iso view looked from
 * fly.code(); // 'cam3=fly,…': a perspective camera on the iso view's line of sight
 * @see engine/gfx/cameras/place.test.ts
 */
import { OrthographicCamera, PerspectiveCamera, WebGPUCoordinateSystem } from 'three/webgpu';
import { MathUtils } from '../../core/math';
import { BoostedOrthographicCamera, BoostedPerspectiveCamera, boost } from './boost';
import { parseCameraCode, type CameraSpec } from './codes';
import { createFixedCamera } from './fixed';
import { createFlyCamera, type FlyBounds } from './fly';
import { createOrbitCamera, ORBIT_LIMITS } from './orbit';
import { poseTarget, rangeProblems, refuse, type Camera, type CameraPose } from './pose';
import { createViewCamera } from './presets';

/** Puts `pose` on `camera` for a picture `aspect` (width / height) wide, boost included (see the file comment). */
export function placeCamera(pose: CameraPose, camera: PerspectiveCamera | OrthographicCamera, aspect: number): void {
  const ortho = (camera as OrthographicCamera).isOrthographicCamera === true;
  refuse('placeCamera', [
    ...rangeProblems({ aspect: [aspect, 1e-6, 1e6] }),
    ...(ortho !== (pose.projection === 'orthographic')
      ? [
          `a ${pose.projection} pose goes on a ${ortho ? 'PerspectiveCamera' : 'OrthographicCamera'}, not this ${camera.type}`,
        ]
      : []),
  ]);
  camera.coordinateSystem = WebGPUCoordinateSystem;
  camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
  camera.rotation.set(pose.pitch, pose.yaw + Math.PI, 0, 'YXZ');
  camera.near = pose.near;
  camera.far = pose.far;
  camera.zoom = pose.zoom;
  if (camera instanceof OrthographicCamera) {
    const top = pose.frustumSize / 2;
    camera.top = top;
    camera.bottom = -top;
    camera.right = top * aspect;
    camera.left = -top * aspect;
  } else {
    camera.fov = pose.fov;
    camera.aspect = aspect;
  }
  boost(camera, pose.boost);
}

/** One three.js camera per projection, and `place`, which aims the one a pose needs. */
export interface CameraPair {
  readonly perspective: BoostedPerspectiveCamera;
  readonly orthographic: BoostedOrthographicCamera;
  /** Places `pose` on the camera of its projection (`placeCamera`) and returns that camera, to draw with. */
  place(pose: CameraPose, aspect: number): BoostedPerspectiveCamera | BoostedOrthographicCamera;
}

/** A perspective and an orthographic camera, made once (see the file comment). */
export function createCameraPair(): CameraPair {
  const perspective = new BoostedPerspectiveCamera();
  const orthographic = new BoostedOrthographicCamera();
  perspective.name = 'camera:perspective';
  orthographic.name = 'camera:orthographic';
  return {
    perspective,
    orthographic,
    place(pose, aspect) {
      const camera = pose.projection === 'orthographic' ? orthographic : perspective;
      placeCamera(pose, camera, aspect);
      return camera;
    },
  };
}

/** What `createCamera` may start from beyond the code. */
export interface CreateCameraOptions {
  /** The camera before this one: a bare `fly` or `fixed` starts at its pose, a following view or orbit at its target. */
  readonly from?: CameraPose;
  /** The box a fly camera stays in. */
  readonly bounds?: FlyBounds;
}

/**
 * The camera `code` names (a code, or its data from `parseCameraCode`): `cam=iso`, `cam3=orbit,…`. Switching from
 * `from`, the camera before it: a following view or orbit starts on its target (until the first follow), an orbit
 * without angles looks the same way, and a bare `fly` or `fixed` starts at its place (the prototype's switching).
 * Throws `GFX_BAD_CAMERA_CODE` or `GFX_UNKNOWN_CAMERA` for a bad code.
 */
export function createCamera(code: string | CameraSpec, options: CreateCameraOptions = {}): Camera {
  const spec = typeof code === 'string' ? parseCameraCode(code) : code;
  const { from } = options;
  const start = from && !('target' in spec && spec.target) ? poseTarget(from) : undefined;
  switch (spec.type) {
    case 'view': {
      const { type: _view, ...view } = spec;
      return createViewCamera({ ...view, start });
    }
    case 'orbit': {
      const { type: _orbit, ...orbit } = spec;
      const [low, high] = ORBIT_LIMITS.elevation;
      const facing =
        from && orbit.azimuth === undefined
          ? { azimuth: from.yaw - Math.PI, elevation: MathUtils.clamp(-from.pitch, low, high) }
          : {};
      return createOrbitCamera({ ...orbit, ...facing, start });
    }
    case 'fly': {
      const { type: _fly, ...fly } = spec;
      return createFlyCamera({ ...fly, from, bounds: options.bounds });
    }
    default: {
      const { type: _fixed, ...fixed } = spec;
      return createFixedCamera({ ...fixed, from });
    }
  }
}
