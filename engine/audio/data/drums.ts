/**
 * @file The engine's six drums and the drum kit songs play them from (PLAN.md WP 9.2, I-23): a kick, a snare, a
 * closed and an open hi-hat, a crash and a tom, each an `sfx` entry (engine/audio/data/sfx.ts), and `DRUM_KIT`, the
 * one-letter tokens a song's `drums` track writes (`k s h o c t`), each naming its drum's id.
 *
 * Invariants: the voices are the source's numbers, as they are. A drum plays exactly as written (one variant), as the
 * source's sequencer played it; a `drums` track's `vol` scales it (engine/audio/data/song.ts). A song may name its own
 * kit, mapping tokens to any `sfx` ids.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:3698-3707` (`DRUMS`).
 *
 * @example
 * DRUM_KIT.k; // 'sfx:drumKick'
 * DRUMS[DRUM_KIT.s].voices; // the snare: a noise burst and a falling triangle
 * @see engine/audio/data/sounds.test.ts
 */
import type { SfxSpec } from './sfx';

/** The engine's drums by id. */
export const DRUMS: Readonly<Record<string, SfxSpec>> = {
  'sfx:drumKick': { voices: [{ wave: 'sine', freq: 150, to: 42, dur: 0.14, vol: 0.7 }] },
  'sfx:drumSnare': {
    voices: [
      { wave: 'noise', freq: 1800, dur: 0.12, vol: 0.38 },
      { wave: 'triangle', freq: 220, to: 130, dur: 0.06, vol: 0.3 },
    ],
  },
  'sfx:drumHat': { voices: [{ wave: 'noise', freq: 7500, dur: 0.035, vol: 0.14, filter: 'highpass' }] },
  'sfx:drumOpenHat': { voices: [{ wave: 'noise', freq: 6500, dur: 0.2, vol: 0.13, filter: 'highpass' }] },
  'sfx:drumCrash': { voices: [{ wave: 'noise', freq: 4500, dur: 0.7, vol: 0.18, filter: 'highpass' }] },
  'sfx:drumTom': { voices: [{ wave: 'triangle', freq: 180, to: 90, dur: 0.16, vol: 0.45 }] },
};

/** The drum kit: a `drums` track's tokens (kick, snare, hat, open hat, crash, tom) and the drums they play. */
export const DRUM_KIT: Readonly<Record<string, string>> = {
  k: 'sfx:drumKick',
  s: 'sfx:drumSnare',
  h: 'sfx:drumHat',
  o: 'sfx:drumOpenHat',
  c: 'sfx:drumCrash',
  t: 'sfx:drumTom',
};
