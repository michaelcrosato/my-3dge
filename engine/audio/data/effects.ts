/**
 * @file The engine's 33 sound effects as data (PLAN.md WP 9.2, I-23): jumps, landings, steps, pickups, hits, shots,
 * explosions, doors, jingles and the menu and text blips, each an `sfx` entry (engine/audio/data/sfx.ts) under the id
 * `sfx:<name>`. Every one renders in Node and hashes the same everywhere (engine/audio/data/sounds.test.ts).
 *
 * Invariants: the voices are the source's numbers, copied as they are; the DSP takes the source chip synth's fields
 * (engine/audio/dsp/voice.ts). The source detuned every play by up to ±3%, so each effect has four variants, `vary`
 * 0.03 (the kind's default), which the runtime picks between. The menu and text sounds play on the `ui` bus, the rest
 * on `effects`.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:3663-3697` (`SFX`).
 *
 * @example
 * EFFECTS['sfx:jump'].voices; // { wave: 'pulse', freq: 280, to: 640, dur: 0.14, vol: 0.3 }
 * Object.keys(EFFECTS).length; // 33
 * @see engine/audio/data/sounds.test.ts
 */
import type { SfxSpec } from './sfx';

/** Variants of each engine effect: the source detuned every play by up to ±3%. */
const VARIANTS = 4;

/** A gameplay effect: four variants, on the effects bus. */
const effect = (voices: SfxSpec['voices']): SfxSpec => ({ voices, variants: VARIANTS });

/** A menu or text sound: four variants, on the ui bus. */
const ui = (voices: SfxSpec['voices']): SfxSpec => ({ voices, variants: VARIANTS, bus: 'ui' });

/** The engine's effects by id. */
export const EFFECTS: Readonly<Record<string, SfxSpec>> = {
  'sfx:jump': effect({ wave: 'pulse', freq: 280, to: 640, dur: 0.14, vol: 0.3 }),
  'sfx:jump2': effect({ wave: 'pulse', freq: 420, to: 900, dur: 0.12, vol: 0.26 }),
  'sfx:land': effect({ wave: 'noise', freq: 500, to: 150, dur: 0.07, vol: 0.25, filter: 'lowpass' }),
  'sfx:step': effect({ wave: 'noise', freq: 3000, dur: 0.03, vol: 0.07, filter: 'highpass' }),
  'sfx:coin': effect({ wave: 'square', freq: 988, arp: [0, 5], step: 0.07, dur: 0.32, vol: 0.26 }),
  'sfx:pickup': effect({ wave: 'triangle', freq: 880, to: 1760, dur: 0.09, vol: 0.4 }),
  'sfx:key': effect({ wave: 'square', freq: 1047, arp: [0, 4, 7, 12], step: 0.045, dur: 0.22, vol: 0.24 }),
  'sfx:powerup': effect({ wave: 'square', freq: 523, arp: [0, 4, 7, 12, 16, 19, 24], step: 0.05, dur: 0.4, vol: 0.26 }),
  'sfx:oneup': effect({ wave: 'square', freq: 659, arp: [0, 3, 12, 8, 10, 15], step: 0.08, dur: 0.5, vol: 0.26 }),
  'sfx:heal': effect({ wave: 'triangle', freq: 523, arp: [0, 7, 12, 19], step: 0.06, dur: 0.3, vol: 0.4 }),
  'sfx:hit': effect([
    { wave: 'noise', freq: 1600, to: 500, dur: 0.12, vol: 0.45 },
    { wave: 'square', freq: 180, to: 60, dur: 0.1, vol: 0.25 },
  ]),
  'sfx:hurt': effect({ wave: 'square', freq: 520, to: 120, dur: 0.28, vol: 0.3, vib: [30, 0.05] }),
  'sfx:stomp': effect({ wave: 'square', freq: 400, to: 820, dur: 0.08, vol: 0.28 }),
  'sfx:bump': effect({ wave: 'triangle', freq: 150, to: 90, dur: 0.08, vol: 0.45 }),
  'sfx:swing': effect({ wave: 'noise', freq: 2400, to: 700, dur: 0.12, vol: 0.2 }),
  'sfx:whoosh': effect({ wave: 'noise', freq: 1600, to: 400, dur: 0.16, vol: 0.18 }),
  'sfx:punch': effect([
    { wave: 'noise', freq: 900, to: 300, dur: 0.08, vol: 0.45, filter: 'lowpass' },
    { wave: 'sine', freq: 140, to: 60, dur: 0.09, vol: 0.5 },
  ]),
  'sfx:kick': effect([
    { wave: 'noise', freq: 600, to: 200, dur: 0.11, vol: 0.45, filter: 'lowpass' },
    { wave: 'sine', freq: 110, to: 45, dur: 0.12, vol: 0.55 },
  ]),
  'sfx:shoot': effect({ wave: 'pulse12', freq: 900, to: 260, dur: 0.1, vol: 0.2 }),
  'sfx:laser': effect({ wave: 'saw', freq: 1500, to: 280, dur: 0.18, vol: 0.18 }),
  'sfx:charge': effect({ wave: 'saw', freq: 200, to: 900, dur: 0.6, vol: 0.12 }),
  'sfx:explode': effect({ wave: 'noise', freq: 900, to: 60, dur: 0.6, vol: 0.55, filter: 'lowpass' }),
  'sfx:boom': effect([
    { wave: 'noise', freq: 600, to: 40, dur: 1.1, vol: 0.6, filter: 'lowpass' },
    { wave: 'sine', freq: 90, to: 30, dur: 0.8, vol: 0.55 },
  ]),
  'sfx:door': effect([
    { wave: 'square', freq: 196, to: 98, dur: 0.22, vol: 0.22 },
    { wave: 'noise', freq: 800, dur: 0.15, vol: 0.18 },
  ]),
  'sfx:secret': effect({
    wave: 'square',
    freq: 784,
    arp: [0, 5, 9, 14, 12, 17, 21, 24],
    step: 0.08,
    dur: 0.7,
    vol: 0.22,
  }),
  'sfx:warp': effect({ wave: 'sine', freq: 200, to: 1200, dur: 0.5, vol: 0.28, vib: [12, 0.1] }),
  'sfx:die': effect({ wave: 'square', freq: 523, arp: [7, 4, 0, -5, -12], step: 0.12, dur: 0.7, vol: 0.26 }),
  'sfx:select': ui({ wave: 'square', freq: 660, dur: 0.045, vol: 0.18 }),
  'sfx:confirm': ui({ wave: 'square', freq: 784, arp: [0, 7, 12], step: 0.05, dur: 0.16, vol: 0.22 }),
  'sfx:cancel': ui({ wave: 'square', freq: 440, to: 220, dur: 0.12, vol: 0.2 }),
  'sfx:pause': ui({ wave: 'square', freq: 988, arp: [0, 12, 0, 12], step: 0.05, dur: 0.22, vol: 0.18 }),
  'sfx:text': ui({ wave: 'square', freq: 820, dur: 0.018, vol: 0.06 }),
  'sfx:blip': ui({ wave: 'square', freq: 1200, dur: 0.025, vol: 0.1 }),
};
