/**
 * @file The tonal oscillators of the DSP core (PLAN.md WP 9.1; doctrine: Quality under the hood): square, pulse 25%,
 * pulse 12.5%, triangle, sine and saw, each a function of a phase. Square, pulse and saw are band-limited with PolyBLEP
 * corrections at their steps, the triangle with PolyBLAMP corrections at its corners, so a 3 kHz saw aliases about
 * ten times less than a naive one (osc.test.ts measures it). White noise and the Karplus–Strong pluck are made in
 * engine/audio/dsp/synth.ts and engine/audio/dsp/pluck.ts.
 *
 * Invariants: `oscillate(wave, phase, dt)` is a pure function: `phase` in [0, 1), `dt` the phase step per sample
 * (|frequency| / rate), clamped to 0.5. Arithmetic only, except the sine's `Math.sin`, called by name so that the
 * render's `withSimMath` swap reaches it (§6.5). Every wave starts at phase 0 on a rising edge or zero crossing, has no
 * DC and peaks at 1, as Web Audio's normalised periodic waves do (the source's pulse waves were 40-harmonic periodic
 * waves): a pulse of duty d is shifted by 1 − 2d and scaled by 1 / (2 − 2d).
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:3730-3735` (the pulse duties), rewritten as sample-by-sample DSP.
 *
 * @example
 * oscillate('sine', 0.25, 0.01); // 1
 * oscillate('square', 0.75, 0.01); // -1
 * @see engine/audio/dsp/osc.test.ts
 */

/** 2π. */
const TAU = 2 * Math.PI;

/** The tonal waves: square, pulse (25% duty), pulse12 (12.5% duty), triangle, sine and saw. */
export const TONAL_WAVES = ['square', 'pulse', 'pulse12', 'triangle', 'sine', 'saw'] as const;

/** One of the tonal waves. */
export type TonalWave = (typeof TONAL_WAVES)[number];

/** The duty cycle of each pulse-like wave: the share of a period spent high. */
export const DUTY: Readonly<Record<'square' | 'pulse' | 'pulse12', number>> = {
  square: 0.5,
  pulse: 0.25,
  pulse12: 0.125,
};

/** `x` wrapped into [0, 1). */
export function wrap(x: number): number {
  return x - Math.floor(x);
}

/**
 * The PolyBLEP residual of a rising unit step at phase 0: what a band-limited step adds to a naive one, for a sample
 * at phase `x` in [0, 1) (just after the step when `x < dt`, just before it when `x > 1 - dt`).
 */
export function blep(x: number, dt: number): number {
  if (x < dt) {
    const d = x / dt - 1;
    return -0.5 * d * d;
  }
  if (x > 1 - dt) {
    const d = (x - 1) / dt + 1;
    return 0.5 * d * d;
  }
  return 0;
}

/** The PolyBLAMP residual of a unit rise in slope (per sample) at phase 0, the integral of `blep`. */
export function blamp(x: number, dt: number): number {
  if (x < dt) {
    const d = 1 - x / dt;
    return (d * d * d) / 6;
  }
  if (x > 1 - dt) {
    const d = (x - 1) / dt + 1;
    return (d * d * d) / 6;
  }
  return 0;
}

/** A band-limited pulse of duty `duty`, without DC, peaking at 1. */
function pulse(phase: number, dt: number, duty: number): number {
  const naive = phase < duty ? 1 : -1;
  const v = naive + 2 * blep(phase, dt) - 2 * blep(wrap(phase - duty), dt);
  return (v - (2 * duty - 1)) / (2 - 2 * duty);
}

/** A band-limited triangle: 0 at phase 0, rising to 1 at 0.25, -1 at 0.75. */
function triangle(phase: number, dt: number): number {
  const p = wrap(phase + 0.25);
  const naive = 1 - 4 * Math.abs(p - 0.5);
  return naive + 8 * dt * (blamp(p, dt) - blamp(wrap(p - 0.5), dt));
}

/**
 * One sample of `wave` at `phase` (in [0, 1)), band-limited for a phase step of `dt` per sample (|frequency| / rate;
 * clamped to 0.5).
 */
export function oscillate(wave: TonalWave, phase: number, dt: number): number {
  const step = dt < 0.5 ? dt : 0.5;
  switch (wave) {
    case 'sine':
      return Math.sin(TAU * phase);
    case 'saw': {
      const p = wrap(phase + 0.5);
      return 2 * p - 1 - 2 * blep(p, step);
    }
    case 'triangle':
      return triangle(phase, step);
    default:
      return pulse(phase, step, DUTY[wave]);
  }
}
