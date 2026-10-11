/**
 * @file The engine's front page: the public API for pages and tools (PLAN.md §6.1, §6.9, WP 1.6; doctrine: Quality
 * under the hood). A game's pages import only this module, its sim-side code only engine/sim-api.ts, which this module
 * re-exports whole (ESLint's public-API rule enforces both), so game agents never read the internals. docs/API.md is
 * the manual: every public name with its doc comment; docs/ERRORS.md gives every error and advice code with its fix.
 *
 * What is here, beyond the sim API: `createHeadless`, the engine without a page (Node, tests, `x sim`), whose object
 * is the inspector a page publishes as `window.__engine` (`help()` lists its members); `createEngine`, the engine in
 * a page, arrives with WP 2.7.
 *
 * Invariants: a flat list of `export … from` lines, one name per line, grouped by area, and append-only: each WP adds
 * its public names at the end of their area, so parallel lanes merge cleanly (§11.3). Each name is documented where
 * it is declared (`x docs --check` fails one without). No engine module imports this file or engine/sim-api.ts
 * (ESLint's layer rules): the barrels are for game code.
 *
 * @example
 * // labs/box/main.ts
 * // import { createEngine, defineScene } from '../../engine';
 * @see engine/sim-api.ts
 */

// The sim API: everything sim-side game code uses.
export * from './sim-api';

// Headless: the engine without a page, and its inspector (window.__engine in a page).
export { createHeadless } from './app/headless';
export type { Headless } from './app/headless';
export type { HeadlessOptions } from './app/headless';
export type { Inspector } from './dev/inspector';
export type { EngineInfo } from './dev/inspector';
export type { EntitySummary } from './dev/inspector';

// Materials and procedural textures (WP 2.3): materials as data with three.js's classic parameters, seeded tiling
// texture generators and their helpers, the CPU bake, and the page's material library.
export { defineMaterial } from './gfx/materials/material';
export { getMaterial } from './gfx/materials/material';
export type { MaterialEntry } from './gfx/materials/material';
export type { MaterialSpec } from './gfx/materials/material';
export { createMaterialLibrary } from './gfx/materials/library';
export type { MaterialLibrary } from './gfx/materials/library';
export { defineTexture } from './gfx/textures/texture';
export type { TextureEntry } from './gfx/textures/texture';
export type { Texel } from './gfx/textures/types';
export type { TextureContext } from './gfx/textures/types';
export type { TextureSpec } from './gfx/textures/types';
export type { TextureLook } from './gfx/textures/types';
export { bakeTexture } from './gfx/textures/bake';
export type { TextureBake } from './gfx/textures/bake';
export type { TextureRef } from './gfx/textures/bake';
export { cellHash } from './gfx/textures/tile';
export { wrapIndex } from './gfx/textures/tile';
export { palette } from './gfx/textures/tile';
export { pickTone } from './gfx/textures/tile';
export { runningBond } from './gfx/textures/tile';
export { tileNoise } from './gfx/textures/tile';

// Input (WP 3.3): the devices of a page sampled into intents (keys by physical code, mouse with pointer lock and the
// wheel, gamepads in any slot), action maps and their presets, bindings players change and keep, prompts per device,
// the virtual device that __engine.input drives, and the scripted gamepad for tests.
export { createInput } from './input/input';
export type { Input } from './input/input';
export type { InputOptions } from './input/input';
export type { CameraLike } from './input/input';
export type { CameraInputSample } from './input/input';
export { defineActionMap } from './input/actionMaps';
export { getActionMap } from './input/actionMaps';
export { listActionMaps } from './input/actionMaps';
export { SYSTEM_ACTIONS } from './input/actionMaps';
export { RESERVED_CODES } from './input/actionMaps';
export type { ActionMap } from './input/actionMaps';
export type { ActionMapSpec } from './input/actionMaps';
export { createBindings } from './input/bindings';
export type { Bindings } from './input/bindings';
export type { BindingsOptions } from './input/bindings';
export type { BindingsStorage } from './input/bindings';
export type { BindingsFile } from './input/bindings';
export type { RebindResult } from './input/bindings';
export { codeLabel } from './input/codes';
export { readKeyboardLayout } from './input/codes';
export { isCode } from './input/codes';
export type { DeviceKind } from './input/codes';
export { createVirtualDevice } from './input/devices/virtual';
export type { VirtualDevice } from './input/devices/virtual';
export { connectVirtualDevice } from './input/devices/inspector';
export { createScriptedGamepad } from './input/devices/padScript';
export type { ScriptedGamepad } from './input/devices/padScript';
export type { GamepadLike } from './input/devices/gamepad';
// Geometry kit and level meshes (WP 2.4): shapes standing on the ground with UVs in metres, the geometry registry
// (props and levels name geometry by id), their QA measures, and a compiled level drawn as meshes.
export { boxGeometry } from './gfx/geometry/box';
export type { BoxOptions } from './gfx/geometry/box';
export { roundedBoxGeometry } from './gfx/geometry/roundedBox';
export type { RoundedBoxOptions } from './gfx/geometry/roundedBox';
export { limbGeometry } from './gfx/geometry/limb';
export type { LimbOptions } from './gfx/geometry/limb';
export { rampGeometry } from './gfx/geometry/ramp';
export type { RampOptions } from './gfx/geometry/ramp';
export { frustumGeometry } from './gfx/geometry/frustum';
export type { FrustumOptions } from './gfx/geometry/frustum';
export { pillarGeometry } from './gfx/geometry/pillar';
export { pillarParts } from './gfx/geometry/pillar';
export type { PillarOptions } from './gfx/geometry/pillar';
export type { PillarPart } from './gfx/geometry/pillar';
export { ringGeometry } from './gfx/geometry/ring';
export type { RingOptions } from './gfx/geometry/ring';
export { sidesThenTops } from './gfx/geometry/groups';
export { mergeGeometries } from './gfx/geometry/groups';
export { defineGeometry } from './gfx/geometry/geometry';
export { getGeometry } from './gfx/geometry/geometry';
export { buildGeometry } from './gfx/geometry/geometry';
export type { GeometryEntry } from './gfx/geometry/geometry';
export type { GeometrySpec } from './gfx/geometry/geometry';
export type { GeometryRef } from './gfx/geometry/geometry';
export { inspectGeometry } from './gfx/geometry/inspect';
export type { GeometryReport } from './gfx/geometry/inspect';
export { createLevelMeshes } from './gfx/level/meshes';
export type { LevelMeshes } from './gfx/level/meshes';
export type { LevelMeshesOptions } from './gfx/level/meshes';
export type { LevelMeshPart } from './gfx/level/meshes';
export type { LevelCell } from './gfx/level/cells';
export { LEVEL_RECIPES } from './gfx/level/recipes';
export type { LevelRecipe } from './gfx/level/recipes';
export type { LevelShape } from './gfx/level/recipes';
// Sound data (WP 9.2): effects and songs as registry entries (voices, layers, variants; tracker-notation tracks),
// rendered offline by the DSP core into reproducible samples.
export { defineSfx } from './audio/data/sfx';
export { getSfx } from './audio/data/sfx';
export { renderSfx } from './audio/data/sfx';
export { sfxVoices } from './audio/data/sfx';
export type { Sfx } from './audio/data/sfx';
export type { SfxSpec } from './audio/data/sfx';
export type { SfxLayer } from './audio/data/sfx';
export type { SfxBus } from './audio/data/sfx';
export type { SfxRenderOptions } from './audio/data/sfx';
export { defineSong } from './audio/data/song';
export { getSong } from './audio/data/song';
export { renderSong } from './audio/data/song';
export { songVoices } from './audio/data/song';
export { songTiming } from './audio/data/song';
export type { Song } from './audio/data/song';
export type { SongSpec } from './audio/data/song';
export type { SongTrack } from './audio/data/song';
export type { SongTiming } from './audio/data/song';
export type { SongRenderOptions } from './audio/data/song';
export type { Voice } from './audio/dsp/voice';
export type { SoundDef } from './audio/dsp/voice';
// The audio runtime (WP 9.3): a page's sound through Web Audio, started by the first gesture: buses with ducking and
// voice limits, sounds placed in 3D and occluded through the QueryView, room reverb, and music in intensity layers
// that change on the beat and the bar line.
export { createAudio } from './audio/runtime/audio';
export type { Audio } from './audio/runtime/audio';
export type { AudioOptions } from './audio/runtime/audio';
export type { AudioState } from './audio/runtime/audio';
export type { AudioInfo } from './audio/runtime/audio';
export type { PlayOptions } from './audio/runtime/sound';
export type { Sound } from './audio/runtime/sound';
export type { ListenerPose } from './audio/runtime/spatial';
export type { GestureTarget } from './audio/runtime/gesture';
export type { AudioBus } from './audio/runtime/mixer';
export { BUS_VOLUMES } from './audio/runtime/mixer';
export type { MixerInfo } from './audio/runtime/mixer';
export type { MusicChange } from './audio/runtime/music';
export type { MusicPosition } from './audio/runtime/music';
export type { Quantize } from './audio/runtime/music';
export { ROOMS } from './audio/runtime/reverb';
export type { RoomName } from './audio/runtime/reverb';
export type { RoomSpec } from './audio/runtime/reverb';
export { VOICE_LIMITS } from './audio/runtime/voices';
export type { VoiceLimits } from './audio/runtime/voices';
// The engine in a page (WP 2.7): createEngine reads the routes, starts the scene with its view, publishes
// window.__engine, warms up and runs the frame loop; createHeadless({ view: true }) builds the same view in Node.
export { createEngine } from './app/engine';
export type { Engine } from './app/engine';
export type { EngineOptions } from './app/engine';
export { parseRoutes } from './app/routes';
export { routeQuery } from './app/routes';
export type { Routes } from './app/routes';
export type { CameraInfo } from './app/view';
export type { PlayResult } from './app/playback';
export type { PlayIntoOptions } from './app/playback';
export type { ViewChange } from './app/playback';
// Touch controls (WP 3.12; built, not tested, ADR-0021): a page's touch layout (the corner fan's buttons and the menu
// button) for createEngine's touchLayout and onMenu, the touch device on input.touch, and the touch codes it writes.
export { defineTouchLayout } from './ui/touch';
export { getTouchLayout } from './ui/touch';
export type { TouchLayout } from './ui/touch';
export type { TouchLayoutSpec } from './ui/touch';
export type { TouchButtonSpec } from './ui/touch';
export type { TouchDevice } from './input/devices/touch';
export type { StickView } from './input/devices/touch';
export type { TouchSetting } from './input/devices/touch';
export { touchCode } from './input/codes';
