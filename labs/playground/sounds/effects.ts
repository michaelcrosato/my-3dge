/**
 * @file The playground's own sound effects (docs/PLAYGROUND.md §8.1, PLAN.md WP 13.22; doctrine: Assets): what its
 * cast and its places sound like beside the engine's foley (engine/audio/data/foley.ts), as definitions the DSP
 * renders (engine/audio/data/sfx.ts), never sample files. labs/playground/sounds/events.ts says which event plays
 * which; `node x qa audio` checks every one, `node x audio sfx:playgroundBark --spectrogram` shows one.
 *
 * - the dog: `sfx:playgroundBark` (a woof: a falling voiced bark through a mouth's resonance, and its breath),
 *   `sfx:playgroundWhine` (held and waiting), `sfx:playgroundHuff` (a breath out through its nose, sitting or round
 *   its ball), `sfx:playgroundTags` (its collar's tags as it trots off), `sfx:playgroundBounce` (its ball let fall,
 *   bouncing three times);
 * - people's voices, wordless: `sfx:playgroundHey` (shoved: two vowels, rising), `sfx:playgroundGasp` (startled),
 *   `sfx:playgroundGrunt` (a blow, or the effort of getting up), `sfx:playgroundHm` (noticing him),
 *   `sfx:playgroundSigh` (sitting down), and the bench taking a sitter's weight, `sfx:playgroundCreak`;
 * - the places, looped on the ambience bus: `sfx:playgroundOutdoors` (a 5 s pass: a breeze and birds about the block)
 *   and `sfx:playgroundIndoors` (3 s: a house's quiet hum, its 120 Hz turning 360 times a pass), each fading in over
 *   its first second and out over the second past its pass, which the runtime folds over its start (the kind's
 *   `loop`), so the loop has no seam to hear.
 *
 * Invariants: ids start `sfx:playground`, so none meets the engine's; voices are formant-filtered tones and noise, no
 * speech; the often heard ones have variants. Playground content: it stays in labs/playground/ (PLAN.md §5.7).
 *
 * Game code, a page's: it imports only the engine's public API (engine/index.ts).
 *
 * @example
 * import { renderSfx } from '../../../engine';
 * renderSfx('sfx:playgroundBark').length; // 6174: 0.14 s at 44,100 Hz
 * @see labs/playground/sounds/events.test.ts
 */
import { defineSfx } from '../../../engine';

/** A filter round `freq` Hz, `q` wide: a mouth's or a body's resonance. */
const band = (freq: number, q = 1) => ({ type: 'bandpass', freq, q }) as const;

/** The dog's bark: a voiced fall through a mouth's resonance, its breath, and a short second one. */
export const bark = defineSfx('sfx:playgroundBark', {
  voices: [
    { wave: 'saw', freq: 430, to: 290, dur: 0.12, vol: 0.13, attack: 0.008, filter: band(1050, 1.6) },
    { wave: 'saw', freq: 215, to: 150, dur: 0.12, vol: 0.07, attack: 0.008, filter: { type: 'lowpass', freq: 900 } },
    { wave: 'noise', dur: 0.06, vol: 0.06, filter: band(1500) },
    { wave: 'saw', freq: 400, to: 300, dur: 0.07, at: 0.07, vol: 0.06, attack: 0.006, filter: band(1100, 1.6) },
  ],
  variants: 3,
  vary: 0.06,
});

/** The dog held and waiting: a thin whine rising and falling. */
export const whine = defineSfx('sfx:playgroundWhine', {
  voices: [{ wave: 'sine', freq: 900, to: 1150, dur: 0.5, vol: 0.06, attack: 0.08, vib: [6, 0.03] }],
  variants: 2,
  vary: 0.05,
});

/** The dog's breath out through its nose: a short, soft puff. */
export const huff = defineSfx('sfx:playgroundHuff', {
  voices: [
    { wave: 'noise', dur: 0.12, vol: 0.09, attack: 0.01, filter: band(700, 1.4) },
    { wave: 'noise', dur: 0.08, vol: 0.04, filter: band(2200, 2) },
  ],
  variants: 3,
  vary: 0.08,
});

/** The dog's collar tags jingling as it trots off. */
export const tags = defineSfx('sfx:playgroundTags', {
  voices: [
    { wave: 'triangle', freq: 3100, dur: 0.06, vol: 0.035 },
    { wave: 'triangle', freq: 4230, dur: 0.05, at: 0.05, vol: 0.03 },
    { wave: 'triangle', freq: 3600, dur: 0.05, at: 0.11, vol: 0.03 },
    { wave: 'triangle', freq: 4700, dur: 0.04, at: 0.16, vol: 0.025 },
  ],
  variants: 3,
  vary: 0.04,
});

/** The dog's ball let fall: three bounces, each lower and sooner. */
export const bounce = defineSfx('sfx:playgroundBounce', {
  voices: [
    { wave: 'sine', freq: 190, to: 120, dur: 0.05, vol: 0.2 },
    { wave: 'noise', dur: 0.02, vol: 0.06, filter: band(1300, 1.5) },
    { wave: 'sine', freq: 180, to: 115, dur: 0.045, at: 0.21, vol: 0.12 },
    { wave: 'sine', freq: 170, to: 110, dur: 0.04, at: 0.33, vol: 0.06 },
  ],
  variants: 2,
  vary: 0.05,
});

/** A neighbour shoved: "hey", two vowels rising through their resonances. */
export const hey = defineSfx('sfx:playgroundHey', {
  voices: [
    { wave: 'saw', freq: 170, to: 215, dur: 0.24, vol: 0.09, attack: 0.02, filter: band(650, 3) },
    { wave: 'saw', freq: 170, to: 215, dur: 0.24, vol: 0.05, attack: 0.02, filter: band(1850, 4) },
    { wave: 'noise', dur: 0.05, vol: 0.05, filter: band(2600) }, // its h
  ],
  variants: 3,
  vary: 0.08,
});

/** A neighbour startled: a sharp breath in and a short rising voice. */
export const gasp = defineSfx('sfx:playgroundGasp', {
  voices: [
    { wave: 'noise', dur: 0.2, vol: 0.1, attack: 0.03, filter: band(1900, 1.2) },
    { wave: 'saw', freq: 210, to: 270, dur: 0.12, at: 0.04, vol: 0.04, attack: 0.02, filter: band(900, 2.5) },
  ],
  variants: 3,
  vary: 0.08,
});

/** A neighbour struck or getting up: a short low grunt. */
export const grunt = defineSfx('sfx:playgroundGrunt', {
  voices: [
    { wave: 'saw', freq: 135, to: 108, dur: 0.17, vol: 0.1, attack: 0.015, vib: [9, 0.02], filter: band(700, 2.5) },
    { wave: 'noise', dur: 0.06, vol: 0.04, filter: band(1200) },
  ],
  variants: 4,
  vary: 0.1,
});

/** A neighbour noticing him: a soft, closed hum. */
export const hm = defineSfx('sfx:playgroundHm', {
  voices: [{ wave: 'triangle', freq: 150, to: 165, dur: 0.22, vol: 0.06, attack: 0.03, filter: { type: 'lowpass', freq: 600 } }], // prettier-ignore
  variants: 3,
  vary: 0.1,
});

/** A neighbour sitting down: a long breath out, falling, through a relaxed mouth. */
export const sigh = defineSfx('sfx:playgroundSigh', {
  voices: [
    { wave: 'noise', dur: 0.45, vol: 0.07, attack: 0.06, filter: { type: 'bandpass', freq: 900, to: 600, q: 1.2 } },
    { wave: 'saw', freq: 150, to: 120, dur: 0.3, at: 0.05, vol: 0.025, attack: 0.05, filter: band(600, 3) },
  ],
  variants: 2,
  vary: 0.08,
});

/** A bench taking a sitter's weight: the wood's low creak. */
export const creak = defineSfx('sfx:playgroundCreak', {
  voices: [
    { wave: 'saw', freq: 230, to: 190, dur: 0.28, vol: 0.05, attack: 0.03, vib: [11, 0.03], filter: band(520, 6) },
    { wave: 'noise', dur: 0.06, vol: 0.06, filter: band(400, 3) },
  ],
  variants: 3,
  vary: 0.08,
});

/** Birds about the block: when each chirp falls in the outdoor loop, s, its pitch (Hz) and its level. */
const CHIRPS = [
  [0.6, 3400, 0.03],
  [0.72, 3900, 0.025],
  [1.9, 4400, 0.02],
  [2.05, 4100, 0.02],
  [3.3, 3200, 0.025],
  [4.4, 4700, 0.015],
  [4.5, 4300, 0.015],
  [5.2, 3600, 0.02],
] as const;

/** The block outdoors, looped on the ambience bus: a breeze under scattered birdsong. */
export const outdoors = defineSfx('sfx:playgroundOutdoors', {
  voices: [
    { wave: 'noise', dur: 6, vol: 0.05, attack: 1, release: 1, filter: { type: 'lowpass', freq: 450 } },
    ...CHIRPS.map(([at, freq, vol]) => ({ wave: 'sine' as const, freq, to: freq * 1.25, dur: 0.07, at, vol })),
  ],
  bus: 'ambience',
  loop: 5,
});

/** The house indoors, looped on the ambience bus: a quiet room tone and a fridge's far hum. */
export const indoors = defineSfx('sfx:playgroundIndoors', {
  voices: [
    { wave: 'noise', dur: 4, vol: 0.035, attack: 1, release: 1, filter: { type: 'lowpass', freq: 260 } },
    { wave: 'triangle', freq: 120, dur: 4, vol: 0.012, attack: 1, release: 1 },
  ],
  bus: 'ambience',
  loop: 3,
});
