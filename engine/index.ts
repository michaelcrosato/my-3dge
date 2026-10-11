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
// Level meshes v2 and the cutaway (WP 4.4): galleries, stairs, the dais, pillars with plinths and capitals and
// brazier stands as recipe shapes; walls facing an outside camera cut low and pillars before the hero as stumps.
export { createCutaway } from './gfx/cutaway';
export { planCutaway } from './gfx/cutaway';
export type { Cutaway } from './gfx/cutaway';
export type { CutawayReport } from './gfx/cutaway';
export type { CutTarget } from './gfx/cutaway';
export type { LevelCut } from './gfx/level/recipes';
export type { CutWhen } from './gfx/level/recipes';
export type { PartCut } from './gfx/level/shapes';
// Instancing and puppets (WP 3.8): batches of instanced copies in pages above r182's 1,000-slot uniform path; puppet
// bodies as data (one line per part on the humanoid skeleton's bones, mirrored parts, material slots), compiled per
// build and drawn as one rigid-skinned mesh per character or as instanced parts for crowds; blob shadows.
export { createInstancedBatch } from './gfx/instancing';
export type { InstancedBatch } from './gfx/instancing';
export type { InstancedBatchOptions } from './gfx/instancing';
export type { InstancedBatchStats } from './gfx/instancing';
export type { InstanceColor } from './gfx/instancing';
export { defineBody } from './gfx/puppets/grammar';
export { getBody } from './gfx/puppets/grammar';
export type { Body } from './gfx/puppets/grammar';
export type { BodySpec } from './gfx/puppets/grammar';
export type { BodyPart } from './gfx/puppets/grammar';
export type { BodyPoint } from './gfx/puppets/grammar';
export type { BodyLength } from './gfx/puppets/grammar';
export type { PartOptions } from './gfx/puppets/grammar';
export { compileBody } from './gfx/puppets/compile';
export { recolor } from './gfx/puppets/compile';
export type { CompiledBody } from './gfx/puppets/compile';
export type { BodyPiece } from './gfx/puppets/compile';
export type { PieceShape } from './gfx/puppets/compile';
export { createPuppet } from './gfx/puppets/draw';
export type { Puppet } from './gfx/puppets/draw';
export type { PuppetMaterials } from './gfx/puppets/draw';
export { createPuppetBatches } from './gfx/puppets/draw';
export type { PuppetBatches } from './gfx/puppets/draw';
export { createBlobShadows } from './gfx/puppets/blobShadow';
export { blobScale } from './gfx/puppets/blobShadow';
export type { BlobShadows } from './gfx/puppets/blobShadow';
// The HTML/CSS overlay (WP 6.5): world-anchored labels and damage numbers placed from projected coordinates each
// frame (three.js's CSS2DRenderer pattern), HUD lines and a crosshair over the canvas; ui.state() for tests.
export { createOverlay } from './ui/overlay';
export type { Overlay } from './ui/overlay';
export type { OverlayOptions } from './ui/overlay';
export type { HudOptions } from './ui/overlay';
export type { HudPlace } from './ui/overlay';
export type { Label } from './ui/labels';
export type { LabelOptions } from './ui/labels';
export type { DamageOptions } from './ui/labels';
export type { WorldPoint } from './ui/labels';
export type { Anchor } from './ui/labels';
export type { OverlayCamera } from './ui/labels';
export { DAMAGE_NUMBERS } from './ui/labels';
export { uiState } from './ui/state';
export type { UiState } from './ui/state';
export type { UiElementState } from './ui/state';
// Lights, shadows, atmosphere and sky (WP 7.1): light kinds for a level's light spots, a fixed pool of point lights
// near the focus with a shadow budget by quality tier, and sky presets (background, dome, backdrop, sun, ambient
// light, fog) that a sky puts on a scene.
export { defineLight } from './gfx/lights';
export type { LightEntry } from './gfx/lights';
export type { LightSource } from './gfx/lights';
export { defineSky } from './gfx/sky';
export type { SkyEntry } from './gfx/sky';
export type { SkySpec } from './gfx/sky';
export { createSky } from './gfx/sky';
export type { Sky } from './gfx/sky';
// Materials v2 (WP 7.2): the same material data drawn in four styles (lambert, toon, flat, pbr), switched at run time
// with every style warmed; the toon look (bands and rim) as uniforms; outline shells for meshes and instanced batches.
export { createStyleSet } from './gfx/materials/styles';
export { MATERIAL_STYLES } from './gfx/materials/styles';
export type { MaterialStyle } from './gfx/materials/styles';
export type { StyleSet } from './gfx/materials/styles';
export type { StyleSetOptions } from './gfx/materials/styles';
export { TOON_LOOK } from './gfx/materials/toon';
export type { ToonLook } from './gfx/materials/toon';
export type { ToonUniforms } from './gfx/materials/toon';
export { createOutline } from './gfx/materials/outline';
export { OUTLINE_MODES } from './gfx/materials/outline';
export type { Outline } from './gfx/materials/outline';
export type { OutlineMode } from './gfx/materials/outline';
export type { OutlineOptions } from './gfx/materials/outline';
export type { OutlineShells } from './gfx/materials/outline';
// Props drawn (WP 4.5): every prop part a batch of the instancing service, posed by its body, the flames dancing on
// the visual streams, the light spots flickering, for the light pool.
export { createPropMeshes } from './gfx/props';
export type { PropMeshes } from './gfx/props';
export type { PropMeshesOptions } from './gfx/props';
export type { PropMeshPose } from './gfx/props';
export type { PropLight } from './gfx/props';
export { FLICKER } from './gfx/props';
// Crowd rendering and pose LOD (WP 5.4): thousands of humanoids, blobs and floaters in a few dozen draw calls over the
// instancing service, each body seen through bands of detail by its distance (the animator's pose level, capes),
// culled by the view; the blob and floater bodies as data.
export { createCrowd } from './gfx/puppets/crowd';
export type { Crowd } from './gfx/puppets/crowd';
export type { CrowdDraw } from './gfx/puppets/crowd';
export type { CrowdRigDraw } from './gfx/puppets/crowd';
export type { CrowdStats } from './gfx/puppets/crowd';
export type { RigBody } from './gfx/puppets/crowd';
export type { RigPart } from './gfx/puppets/crowd';
export type { RigJoints } from './gfx/puppets/crowd';
export type { RigShape } from './gfx/puppets/crowd';
export { createCrowdLod } from './gfx/puppets/lod';
export { CROWD_LOD } from './gfx/puppets/lod';
export type { CrowdLod } from './gfx/puppets/lod';
export type { CrowdLodOptions } from './gfx/puppets/lod';
export type { CrowdLodCounts } from './gfx/puppets/lod';
export type { CrowdBand } from './gfx/puppets/lod';
export type { CrowdBandSpec } from './gfx/puppets/lod';
export { BLOB_BODY } from './gfx/puppets/bodies/blob';
export { blobBody } from './gfx/puppets/bodies/blob';
export type { BlobFeatures } from './gfx/puppets/bodies/blob';
export { FLOATER_BODY } from './gfx/puppets/bodies/floater';
// Performance counters (WP 5.5): what `__engine.stats()` returns, means in ms and the renderer's counts, never fps.
export type { EngineStats } from './dev/stats';
// The texture library (v2, WP 7.3): a level's whole floor as a texture generator (define it under a game's id), with
// moss at the walls' feet, a rune circle on each dais and contact shadows along every block's foot.
export { levelFloorTexture } from './gfx/textures/contactShadow';
export type { LevelFloorOptions } from './gfx/textures/contactShadow';
export type { ContactShadowOptions } from './gfx/textures/contactShadow';
export type { FloorMossOptions } from './gfx/textures/contactShadow';
export type { FloorRuneOptions } from './gfx/textures/contactShadow';
// Clips in pages (WP 8.4): three.js's AnimationClip and AnimationMixer, for presentation only (a page plays a baked
// clip on a puppet with clipJSON and AnimationClip.parse); the sim samples the same tracks through the clip layer.
// The mannequin: the Quaternius figure the library was measured on, as a body and a build.
/** three.js's animation clip: `AnimationClip.parse(clipJSON(baked, skeleton))` makes one from a baked clip. */
export { AnimationClip } from 'three/webgpu';
/** three.js's animation mixer: plays clips on an object's bones (a puppet's mesh), for presentation only. */
export { AnimationMixer } from 'three/webgpu';
export { defineMannequin } from './gfx/puppets/bodies/mannequin';
export { mannequinBody } from './gfx/puppets/bodies/mannequin';
export { MANNEQUIN_SLOTS } from './gfx/puppets/bodies/mannequin';
export type { MannequinData } from './gfx/puppets/bodies/mannequin';
// Effects (WP 6.4): particles as data (emitters: shardfall's presets, the 2D engine's kinds, event effects), drawn
// with telegraphs on the floor, socket trails, bolts and camera shake by a view's effects; never part of the hash.
export { createEffects } from './gfx/fx/effects';
export { FX_BUDGET } from './gfx/fx/effects';
export { BOLT } from './gfx/fx/effects';
export type { Effects } from './gfx/fx/effects';
export type { EffectsOptions } from './gfx/fx/effects';
export type { FxEventPayload } from './gfx/fx/payload';
export type { FxStats } from './gfx/fx/effects';
export { defineEmitter } from './gfx/fx/emitters';
export { getEmitter } from './gfx/fx/emitters';
export type { Emitter } from './gfx/fx/emitters';
export type { EmitterSpec } from './gfx/fx/emitters';
export type { EmitterLayer } from './gfx/fx/emitters';
export type { ParticleFields } from './gfx/fx/emitters';
export type { FxLight } from './gfx/fx/emitters';
export type { BurstOptions } from './gfx/fx/particles';
export type { ParticleStats } from './gfx/fx/particles';
export { TRAIL_TINTS } from './gfx/fx/ribbons';
export type { TrailSampleLike } from './gfx/fx/ribbons';
export { ScreenShake } from './gfx/fx/shake';
export { SHAKE } from './gfx/fx/shake';
