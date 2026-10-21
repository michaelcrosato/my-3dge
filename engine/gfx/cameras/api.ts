/**
 * @file The cameras part of the public page API (PLAN.md §6.1, WP 13.8; doctrine: Common ground: a camera is a function
 * of input and time): every name a page or a game takes to make, step and add cameras, re-exported whole by
 * engine/index.ts, so engine/index.ts stays under its line cap, as engine/anim/api.ts does for animation. Game code
 * imports these names from engine/index.ts, never from here: the public-API rule rejects any other engine path.
 *
 * What is here: the camera codes' reader and maker (`readCameraCode`, `createCamera`), each mode's factory (the
 * shooter's, the platformer's, first person, the chase, the classic views), the wrapper that makes a camera of a game's
 * own pure steps (`followCamera`) and the registry kind that gives it a code (`defineCamera`), the rig a view steps
 * (blends and effects) with its view settings, the effects and blends on their own, and the pose math a camera needs.
 *
 * Invariants: the same as engine/index.ts's: a flat list of `export … from` lines, one name per line, grouped by area
 * and append-only. Only engine/gfx/cameras/ modules are re-exported, and each name is documented where it is declared.
 *
 * @example
 * // labs/game/cameras.ts: a game's own mode, cam3=low, that __engine.camera.set and the page's switches reach
 * // import { createShoulderCamera, defineCamera } from '../../engine';
 * // defineCamera('low', { create: (_code, { from }) => createShoulderCamera({ pitch: 0.2, from }) });
 * @see engine/index.ts
 */

// Camera modes (WP 2.5, WP 3.9, WP 13.8): a code to a camera, each mode's factory, and a game's own.
export { readCameraCode } from './place';
export { createCamera } from './place';
export type { AnyCamera } from './place';
export type { AnyCameraSpec } from './place';
export { createShoulderCamera } from './shoulder';
export { SHOULDER } from './shoulder';
export type { ShoulderInput } from './shoulder';
export type { ShoulderSpec } from './shoulder';
export { createFollowCamera } from './follow';
export { FOLLOW_RIG } from './follow';
export type { FollowInput } from './follow';
export type { FollowSpec } from './follow';
export { createFirstCamera } from './first';
export { createChaseCamera } from './chase';
export { createViewCamera } from './presets';
export { followCamera } from './chase';
export type { FollowCamera } from './chase';
export type { FollowSteps } from './chase';
export { defineCamera } from './define';
export type { CameraKindSpec } from './define';
export type { Camera } from './pose';
export type { CameraInput } from './pose';
export { makePose } from './pose';
export { poseForward } from './pose';
export { poseRight } from './pose';
export { poseUp } from './pose';
export { poseTarget } from './pose';

// The rig a view steps (WP 13.8): blends on live switches, the view effects, the view settings cam.*.
export { createCameraRig } from './rig';
export { rigOptions } from './rig';
export { CAMERA_SETTINGS } from './rig';
export type { CameraRig } from './rig';
export type { RigOptions } from './rig';
export type { RigInput } from './rig';
export { blendCameras } from './blend';
export { BLEND_TIME } from './blend';
export { createCameraEffects } from './effects';
export { applyEffects } from './effects';
export { cameraPlayer } from './effects';
export { apexFov } from './effects';
export { EFFECTS } from './effects';
export type { CameraPlayer } from './effects';
export type { EffectWeights } from './effects';
export type { EffectsFrame } from './effects';
