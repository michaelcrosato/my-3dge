/**
 * @file The input part of the public page API (PLAN.md §6.1, WP 3.3, WP 13.9; doctrine: Common ground): every name a
 * page or a game takes to read the devices, re-exported whole by engine/index.ts, so engine/index.ts stays under its
 * line cap, as engine/gfx/cameras/api.ts does for the cameras. Game code imports these names from engine/index.ts, never
 * from here: the public-API rule rejects any other engine path.
 *
 * What is here: the devices of a page sampled into intents (keys by physical code, the mouse with pointer lock and the
 * wheel, gamepads in any slot), action maps and their presets, bindings players change and keep, prompts per device,
 * the virtual device that __engine.input drives and the scripted gamepad for tests (WP 3.3); aiming, the point the
 * intents' `aim` carries by a map's rule, and the look settings `input.*` that scale mouse and stick (WP 13.9).
 *
 * Invariants: the same as engine/index.ts's: a flat list of `export … from` lines, one name per line, grouped by area
 * and append-only. Only engine/input/ modules are re-exported, and each name is documented where it is declared.
 *
 * @example
 * // labs/playground/controls.ts: an action map per camera mode
 * // import { defineActionMap } from '../../engine';
 * // defineActionMap('actionMap:my-first', { actions: { jump: ['Space'] }, look: true, aimWith: 'centre', lock: true });
 * @see engine/index.ts
 */

// Input (WP 3.3): the devices of a page sampled into intents (keys by physical code, mouse with pointer lock and the
// wheel, gamepads in any slot), action maps and their presets, bindings players change and keep, prompts per device,
// the virtual device that __engine.input drives, and the scripted gamepad for tests.
export { createInput } from './input';
export type { Input } from './input';
export type { InputOptions } from './input';
export type { CameraLike } from './input';
export type { CameraInputSample } from './input';
export { defineActionMap } from './actionMaps';
export { getActionMap } from './actionMaps';
export { listActionMaps } from './actionMaps';
export { SYSTEM_ACTIONS } from './actionMaps';
export { RESERVED_CODES } from './actionMaps';
export type { ActionMap } from './actionMaps';
export type { ActionMapSpec } from './actionMaps';
export { createBindings } from './bindings';
export type { Bindings } from './bindings';
export type { BindingsOptions } from './bindings';
export type { BindingsStorage } from './bindings';
export type { BindingsFile } from './bindings';
export type { RebindResult } from './bindings';
export { codeLabel } from './codes';
export { readKeyboardLayout } from './codes';
export { isCode } from './codes';
export type { DeviceKind } from './codes';
export { createVirtualDevice } from './devices/virtual';
export type { VirtualDevice } from './devices/virtual';
export { connectVirtualDevice } from './devices/inspector';
export { createScriptedGamepad } from './devices/padScript';
export type { ScriptedGamepad } from './devices/padScript';
export type { GamepadLike } from './devices/gamepad';

// Aiming and look (WP 13.9): the point the intents' aim carries by a map's rule, and the look settings input.*.
export { aimPoint } from './aim';
export { screenRay } from './aim';
export { onFloor } from './aim';
export { AIM_RULES } from './aim';
export { AIM_RANGE } from './aim';
export { STICK_REACH } from './aim';
export type { AimRule } from './aim';
export type { AimPose } from './aim';
export type { AimView } from './aim';
export type { AimDevices } from './aim';
export type { AimRay } from './aim';
export { lookOptions } from './look';
export { scaleLook } from './look';
export { LOOK_SETTING_FIELDS } from './look';
export { LOOK_SETTINGS } from './look';
export { DEGREES_PER_COUNT } from './look';
export type { LookOptions } from './look';
export type { RawLook } from './look';
export type { ScaledLook } from './look';
