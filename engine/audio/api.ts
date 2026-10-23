/**
 * @file The sound part of the public page API (PLAN.md §6.1, WP 9.2, WP 9.3, WP 13.22; doctrine: Common ground): every
 * name a page or a game takes to define, render and play sound, re-exported whole by engine/index.ts, so
 * engine/index.ts stays under its line cap, as engine/input/api.ts does for the input. Game code imports these names
 * from engine/index.ts, never from here: the public-API rule rejects any other engine path. The footsteps by surface
 * and gait are sound data sim-side code reads too, so engine/sim-api.ts lists them.
 *
 * What is here: effects and songs as registry entries, rendered offline by the DSP core (WP 9.2); the audio runtime, a
 * page's sound through Web Audio (WP 9.3); a room's reverb worked out of what it is, and the walls between a sound and
 * the listener counted, each muffling it more (WP 13.22).
 *
 * Invariants: the same as engine/index.ts's: a flat list of `export … from` lines, one name per line, grouped by area
 * and append-only. Only engine/audio/ modules are re-exported, and each name is documented where it is declared.
 *
 * @example
 * // labs/playground/sounds/page.ts: a room's reverb from what it is
 * // import { roomAcoustics } from '../../engine';
 * // audio.room(roomAcoustics({ area: 16, height: 2.7, floor: 'carpet' }));
 * @see engine/index.ts
 */

// Sound data (WP 9.2): effects and songs as registry entries (voices, layers, variants; tracker-notation tracks),
// rendered offline by the DSP core into reproducible samples.
export { defineSfx } from './data/sfx';
export { getSfx } from './data/sfx';
export { renderSfx } from './data/sfx';
export { sfxVoices } from './data/sfx';
export type { Sfx } from './data/sfx';
export type { SfxSpec } from './data/sfx';
export type { SfxLayer } from './data/sfx';
export type { SfxBus } from './data/sfx';
export type { SfxRenderOptions } from './data/sfx';
export { defineSong } from './data/song';
export { getSong } from './data/song';
export { renderSong } from './data/song';
export { songVoices } from './data/song';
export { songTiming } from './data/song';
export type { Song } from './data/song';
export type { SongSpec } from './data/song';
export type { SongTrack } from './data/song';
export type { SongTiming } from './data/song';
export type { SongRenderOptions } from './data/song';
export type { Voice } from './dsp/voice';
export type { SoundDef } from './dsp/voice';
// The audio runtime (WP 9.3): a page's sound through Web Audio, started by the first gesture: buses with ducking and
// voice limits, sounds placed in 3D and occluded through the QueryView, room reverb, and music in intensity layers
// that change on the beat and the bar line.
export { createAudio } from './runtime/audio';
export type { Audio } from './runtime/audio';
export type { AudioOptions } from './runtime/audio';
export type { AudioState } from './runtime/audio';
export type { AudioInfo } from './runtime/audio';
export type { PlayOptions } from './runtime/sound';
export type { Sound } from './runtime/sound';
export type { ListenerPose } from './runtime/spatial';
export type { GestureTarget } from './runtime/gesture';
export type { AudioBus } from './runtime/mixer';
export { BUS_VOLUMES } from './runtime/mixer';
export type { MixerInfo } from './runtime/mixer';
export type { MusicChange } from './runtime/music';
export type { MusicPosition } from './runtime/music';
export type { Quantize } from './runtime/music';
export { ROOMS } from './runtime/reverb';
export { roomReverb } from './runtime/reverb';
export type { RoomName } from './runtime/reverb';
export type { RoomSpec } from './runtime/reverb';
export { VOICE_LIMITS } from './runtime/voices';
export type { VoiceLimits } from './runtime/voices';
// Sound for places (WP 13.22): a room's reverb out of its size and what it is made of (Sabine's RT60), the walls
// between a sound and the listener counted, each muffling it more.
export { roomAcoustics } from './runtime/reverb';
export { ABSORPTION } from './runtime/reverb';
export { CONTENTS } from './runtime/reverb';
export type { RoomMake } from './runtime/reverb';
export { wallsBetween } from './runtime/spatial';
export { muffling } from './runtime/spatial';
export { OCCLUSION } from './runtime/spatial';
