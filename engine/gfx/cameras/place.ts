/**
 * @file Cameras into three.js (PLAN.md WP 2.5, §8.3): `createCamera` makes the camera a code names
 * (engine/gfx/cameras/codes.ts, and the `FOLLOW_CAMERAS`, WP 3.9's chase camera, first person and depth rail and WP
 * 13.8's shooter and platformer, whose modules read their own codes: `readCameraCode` reads them all) from the camera
 * before it, and
 * `placeCamera` puts a pose on a three.js camera each
 * frame, so the renderer draws it (`gfx.frame({ scene, camera })`, engine/gfx/renderer.ts). `createCameraPair` holds
 * one `PerspectiveCamera` and one `OrthographicCamera` (both keeping their height boost, engine/gfx/cameras/boost.ts)
 * and places the one a pose's projection names, so switching cameras never makes another three.js camera (that it
 * builds no pipeline either is WP 2.7's measurement).
 *
 * `placeCamera` sets the position, the rotation (Euler `YXZ`: pitch about X, then yaw + π about Y, since a three.js
 * camera looks down its −Z, and −roll about its view axis), `near`, `far`, `zoom`, then the lens: `fov` and `aspect`,
 * or the frustum `top = −bottom = frustumSize / 2`, `right = −left = top × aspect`. It sets `coordinateSystem` to
 * WebGPU's (depth 0 to 1) before the projection, as the renderer would on its first frame, and applies the boost last.
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
import { createChaseCamera, parseChaseCode, type ChaseSpec } from './chase';
import { FOLLOW_CAMERAS, parseCameraCode, type CameraSpec } from './codes';
import { cameraEntry } from './define';
import { createFirstCamera, parseFirstCode, type FirstSpec } from './first';
import { createFixedCamera } from './fixed';
import { createFlyCamera, type FlyBounds } from './fly';
import { createOrbitCamera, ORBIT_LIMITS } from './orbit';
import { poseTarget, rangeProblems, refuse, type Camera, type CameraPose } from './pose';
import { createViewCamera } from './presets';
import { createFollowCamera, parseFollowCode, type FollowSpec } from './follow';
import { createRailCamera, parseRailCode, type RailSpec } from './rail';
import { createShoulderCamera, parseShoulderCode, type ShoulderSpec } from './shoulder';

export { FOLLOW_CAMERAS };

/** A game's own camera's code (engine/gfx/cameras/define.ts): its name and the code its `create` reads. */
export interface GameCameraSpec {
  readonly type: 'game';
  readonly name: string;
  readonly code: string;
}

/** The code data of any camera: codes.ts's, a follow camera's, or a game camera's. */
export type AnyCameraSpec = CameraSpec | ChaseSpec | FirstSpec | RailSpec | ShoulderSpec | FollowSpec | GameCameraSpec;

/** Any camera `createCamera` makes: codes.ts's (`Camera`), or a follow camera, whose inputs add the hero's. */
export type AnyCamera =
  | Camera
  | ReturnType<typeof createChaseCamera>
  | ReturnType<typeof createFirstCamera>
  | ReturnType<typeof createRailCamera>
  | ReturnType<typeof createShoulderCamera>
  | ReturnType<typeof createFollowCamera>;

/** Each follow camera's code reader, by its name. */
const READERS: Readonly<Record<(typeof FOLLOW_CAMERAS)[number], (code: string) => AnyCameraSpec>> = {
  chase: parseChaseCode,
  first: parseFirstCode,
  rail: parseRailCode,
  shoulder: parseShoulderCode,
  follow: parseFollowCode,
};

/**
 * Reads any camera's code: a follow camera's (`cam3=chase…`, `cam3=first…`, `cam3=rail…`, `cam3=shoulder…`,
 * `cam3=follow…`) by its module, a game camera's (`defineCamera`) as its name and code, every other by
 * `parseCameraCode`. Throws `GFX_BAD_CAMERA_CODE` or `GFX_UNKNOWN_CAMERA`.
 */
export function readCameraCode(code: string): AnyCameraSpec {
  const text = String(code).trim();
  const head = /^\??(?:cam3?=)?([^,]*)/.exec(text)?.[1].trim() ?? '';
  if (Object.hasOwn(READERS, head)) return READERS[head as keyof typeof READERS](code);
  if (cameraEntry(head)) return { type: 'game', name: head, code: text.replace(/^\?/, '') };
  return parseCameraCode(code);
}

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
  camera.rotation.set(pose.pitch, pose.yaw + Math.PI, -pose.roll, 'YXZ');
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
 * The camera `code` names (a code, or its data from `readCameraCode`): `cam=iso`, `cam3=orbit,…`, `cam3=chase`.
 * Switching from `from`, the camera before it: a following view or orbit starts on its target (until the first
 * follow), an orbit without angles looks the same way, a bare `fly` or `fixed` starts at its place (the prototype's
 * switching), and a bare chase, first person, shooter or platformer camera keeps its heading. Throws
 * `GFX_BAD_CAMERA_CODE` or `GFX_UNKNOWN_CAMERA` for a bad code.
 */
export function createCamera(code: string | AnyCameraSpec, options: CreateCameraOptions = {}): AnyCamera {
  const spec = typeof code === 'string' ? readCameraCode(code) : code;
  const { from } = options;
  if (spec.type === 'chase') return createChaseCamera({ ...spec, from });
  if (spec.type === 'first') return createFirstCamera({ ...spec, from });
  if (spec.type === 'rail') return createRailCamera(spec);
  if (spec.type === 'game') return cameraEntry(spec.name)!.create(spec.code, { from }) as AnyCamera;
  if (spec.type === 'shoulder') return createShoulderCamera({ ...spec, from });
  if (spec.type === 'follow') return createFollowCamera({ ...spec, from });
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
