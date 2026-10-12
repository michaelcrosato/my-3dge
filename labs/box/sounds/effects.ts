/**
 * @file The box's sound effects (PLAN.md §9.0, WP 9.5, I-23; doctrine: Assets): what its sim events sound like, as
 * definitions the DSP renders (engine/audio/data/sfx.ts), never sample files. labs/box/sounds/events.ts says which
 * event plays which; `node x qa audio` checks every one, `node x audio sfx:boxHit --spectrogram` shows one.
 *
 * - `sfx:boxStep`: a footstep on stone, a heel's low thump under a gritty scuff;
 * - `sfx:boxStepIron`: a footstep on iron, a tick and a short metal ring;
 * - `sfx:boxThud`: a body coming down (a landing, a slime's pounce), a falling sine with a dull burst;
 * - `sfx:boxHit`: a blow landing, a bright crack over a low knock;
 * - `sfx:boxLaunch`: a bolt leaving, a rising saw with a hiss;
 * - `sfx:boxDeath`: a body falling for good, a sinking groan, then the thud;
 * - `sfx:boxTorch`: a torch's crackle on the ambience bus, 2 s of pops over a soft roar, played looped (it starts
 *   and ends quiet, so the loop has no seam to hear).
 *
 * Invariants: ids start `sfx:box`, so none meets the engine's own; the often heard ones have variants, so a hundred
 * steps never repeat exactly. Box content: it stays in labs/box/ (PLAN.md §5.7).
 *
 * @example
 * import { renderSfx } from '../../../engine';
 * renderSfx('sfx:boxStep', { variant: 2 }).length; // 3528: 0.08 s at 44,100 Hz
 * @see labs/box/sounds/events.test.ts
 */
import { defineSfx } from '../../../engine';

/** A footstep on stone: a heel's low thump under a gritty scuff. */
export const boxStep = defineSfx('sfx:boxStep', {
  voices: [
    { wave: 'noise', freq: 1400, to: 500, dur: 0.08, vol: 0.2, filter: 'lowpass' },
    { wave: 'sine', freq: 150, to: 70, dur: 0.07, vol: 0.3 },
  ],
  variants: 4,
  vary: 0.08,
});

/** A footstep on iron: a tick and a short metal ring. */
export const boxStepIron = defineSfx('sfx:boxStepIron', {
  voices: [
    { wave: 'noise', freq: 4000, dur: 0.03, vol: 0.12, filter: 'highpass' },
    { wave: 'triangle', freq: 1250, dur: 0.18, vol: 0.14 },
    { wave: 'triangle', freq: 1873, dur: 0.12, vol: 0.08 },
  ],
  variants: 4,
  vary: 0.05,
});

/** A body coming down (a landing, a slime's pounce): a falling sine with a dull burst. */
export const boxThud = defineSfx('sfx:boxThud', {
  voices: [
    { wave: 'sine', freq: 120, to: 50, dur: 0.2, vol: 0.5 },
    { wave: 'noise', freq: 700, to: 150, dur: 0.12, vol: 0.3, filter: 'lowpass' },
  ],
  variants: 3,
  vary: 0.06,
});

/** A blow landing: a bright crack over a low knock. */
export const boxHit = defineSfx('sfx:boxHit', {
  voices: [
    { wave: 'noise', freq: 2600, to: 900, dur: 0.07, vol: 0.35 },
    { wave: 'square', freq: 190, to: 70, dur: 0.11, vol: 0.22, filter: 'lowpass' },
  ],
  variants: 4,
  vary: 0.1,
});

/** A bolt leaving: a rising saw with a hiss. */
export const boxLaunch = defineSfx('sfx:boxLaunch', {
  voices: [
    { wave: 'saw', freq: 300, to: 1400, dur: 0.16, vol: 0.16, filter: 'lowpass' },
    { wave: 'noise', freq: 3000, to: 1200, dur: 0.12, vol: 0.12 },
  ],
  variants: 3,
});

/** A body falling for good: a sinking groan, then the thud. */
export const boxDeath = defineSfx('sfx:boxDeath', {
  voices: { wave: 'saw', freq: 220, to: 70, dur: 0.45, vol: 0.18, filter: 'lowpass', vib: [7, 0.03] },
  layers: [{ sfx: 'sfx:boxThud', at: 0.3, vol: 0.8 }],
  variants: 3,
});

/** When the torch's pops fall in its 2 s loop, s, each with its own level. */
const POPS = [
  [0.01, 0.22],
  [0.19, 0.15],
  [0.34, 0.28],
  [0.58, 0.13],
  [0.71, 0.22],
  [0.97, 0.16],
  [1.16, 0.25],
  [1.38, 0.15],
  [1.51, 0.2],
  [1.76, 0.13],
] as const;

/** A torch's crackle, looped on the ambience bus: pops over a soft roar that rises from and falls to silence. */
export const boxTorch = defineSfx('sfx:boxTorch', {
  voices: [
    { wave: 'noise', freq: 500, dur: 2, vol: 0.1, filter: 'lowpass', attack: 0.3, release: 0.3 },
    ...POPS.map(([at, vol]) => ({
      wave: 'noise' as const,
      freq: 3200,
      dur: 0.03,
      vol,
      at,
      filter: 'bandpass' as const,
    })),
  ],
  variants: 3,
  vary: 0.04,
  bus: 'ambience',
});
