/**
 * @file Unit tests for engine/audio/dsp/osc.ts (T1): each tonal wave's shape (start, peak, no DC), the PolyBLEP and
 * PolyBLAMP residuals' continuity, the harmonics a band-limited wave keeps, and how much less it aliases than a naive
 * wave, measured with Goertzel's algorithm (engine/audio/dsp/measure.ts).
 * @see engine/audio/dsp/osc.ts
 */
import { describe, expect, it } from 'vitest';
import { toneAmplitude } from './measure';
import { blamp, blep, DUTY, oscillate, TONAL_WAVES, wrap, type TonalWave } from './osc';

const RATE = 44100;

/** A naive (not band-limited) reference wave. */
type Naive = 'naive saw' | 'naive square' | 'naive pulse' | 'naive pulse12' | 'naive triangle';

/** One sample of a naive wave at `phase`, shaped as `oscillate` shapes the band-limited one. */
function naive(wave: Naive, phase: number): number {
  if (wave === 'naive saw') return 2 * wrap(phase + 0.5) - 1;
  if (wave === 'naive triangle') return 1 - 4 * Math.abs(wrap(phase + 0.25) - 0.5);
  const d = DUTY[wave === 'naive square' ? 'square' : wave === 'naive pulse' ? 'pulse' : 'pulse12'];
  return ((phase < d ? 1 : -1) - (2 * d - 1)) / (2 - 2 * d);
}

/** One second of a wave at `freq` Hz: one of the oscillators, or a naive reference. */
function play(wave: TonalWave | Naive, freq: number): Float64Array {
  const out = new Float64Array(RATE);
  const dt = freq / RATE;
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    out[i] = wave.startsWith('naive') ? naive(wave as Naive, phase) : oscillate(wave as TonalWave, phase, dt);
    phase = wrap(phase + dt);
  }
  return out;
}

/** The sinc² droop of a two-sample PolyBLEP at `freq`: what it keeps of a harmonic's amplitude. */
function droop(freq: number): number {
  const x = (Math.PI * freq) / RATE;
  return Math.pow(Math.sin(x) / x, 2);
}

/**
 * The RMS amplitude of what a wave at `freq` folds back below Nyquist: its harmonics from Nyquist to twice the rate,
 * mirrored. At 1, 3 and 5 kHz each folds to its own multiple of 100 Hz, at least 100 Hz from a true harmonic and from
 * the others, so a 1 s Hann window keeps them apart.
 */
function aliasing(samples: Float64Array, freq: number): number {
  let power = 0;
  for (let k = 1; k * freq < 2 * RATE; k++) {
    if (k * freq < RATE / 2) continue;
    const folded = (k * freq) % RATE;
    power += Math.pow(toneAmplitude(samples, folded > RATE / 2 ? RATE - folded : folded, RATE), 2);
  }
  return Math.sqrt(power);
}

describe('oscillate', () => {
  it('starts each wave at phase 0 on a zero crossing or a rising edge, peaks at 1 and has no DC', () => {
    expect(oscillate('sine', 0, 0.001)).toBe(0);
    expect(oscillate('sine', 0.25, 0.001)).toBe(1);
    expect(oscillate('saw', 0, 0.001)).toBe(0);
    expect(oscillate('triangle', 0, 0.001)).toBe(0);
    expect(oscillate('triangle', 0.25, 0.001)).toBeCloseTo(1 - (8 * 0.001) / 6, 12);
    expect(oscillate('triangle', 0.75, 0.001)).toBeCloseTo(-1 + (8 * 0.001) / 6, 12);
    expect(oscillate('square', 0.25, 0.001)).toBe(1);
    expect(oscillate('square', 0.75, 0.001)).toBe(-1);
    for (const wave of TONAL_WAVES) {
      const samples = play(wave, 100);
      let [max, sum] = [-Infinity, 0];
      for (const s of samples) [max, sum] = [Math.max(max, s), sum + s];
      expect(max, wave).toBeGreaterThan(0.99);
      expect(max, wave).toBeLessThan(1.01);
      expect(Math.abs(sum / samples.length), wave).toBeLessThan(1e-3);
    }
  });

  it('gives each pulse its duty: high for that share of a period, low for the rest', () => {
    for (const wave of ['square', 'pulse', 'pulse12'] as const) {
      const d = DUTY[wave];
      expect(oscillate(wave, d / 2, 0.001), wave).toBeCloseTo(1, 12);
      expect(oscillate(wave, (1 + d) / 2, 0.001), wave).toBeCloseTo(-d / (1 - d), 12);
    }
  });

  it("keeps a wave's harmonics, less the PolyBLEP's sinc² droop", () => {
    const saw = play('saw', 1000);
    for (let k = 1; k <= 10; k++) {
      expect(toneAmplitude(saw, k * 1000, RATE) / ((2 / (Math.PI * k)) * droop(k * 1000)), `k = ${k}`).toBeCloseTo(
        1,
        2,
      );
    }
    const square = play('square', 1000);
    expect(toneAmplitude(square, 1000, RATE) / ((4 / Math.PI) * droop(1000))).toBeCloseTo(1, 2);
    expect(toneAmplitude(square, 2000, RATE)).toBeLessThan(1e-3);
    expect(toneAmplitude(play('sine', 1000), 1000, RATE)).toBeCloseTo(1, 6);
  });

  it('aliases at least 4.5 times less than a naive wave (the triangle 3.5 times), at 1, 3 and 5 kHz', () => {
    const pairs = [
      ['saw', 'naive saw', 4.5],
      ['square', 'naive square', 4.5],
      ['pulse', 'naive pulse', 4.5],
      ['pulse12', 'naive pulse12', 4.5],
      ['triangle', 'naive triangle', 3.5],
    ] as const;
    for (const [wave, reference, factor] of pairs) {
      for (const freq of [1000, 3000, 5000]) {
        const ratio = aliasing(play(reference, freq), freq) / aliasing(play(wave, freq), freq);
        expect(ratio, `${wave} at ${freq} Hz`).toBeGreaterThan(factor);
      }
    }
    expect(aliasing(play('naive saw', 3000), 3000) / aliasing(play('saw', 3000), 3000)).toBeGreaterThan(5.5);
  });

  it('stays bounded when the phase step passes 0.5 (it is clamped)', () => {
    for (const wave of TONAL_WAVES) {
      for (let phase = 0; phase < 1; phase += 0.01) {
        expect(Math.abs(oscillate(wave, phase, 0.9)), wave).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('blep and blamp', () => {
  it('are continuous, zero away from the step, and blep jumps by -1 across it as a unit step needs', () => {
    const dt = 0.05;
    expect(blep(0.5, dt)).toBe(0);
    expect(blamp(0.5, dt)).toBe(0);
    expect(blep(dt - 1e-12, dt)).toBeCloseTo(0, 9);
    expect(blep(1 - dt + 1e-12, dt)).toBeCloseTo(0, 9);
    expect(blep(1 - 1e-12, dt) - blep(0, dt)).toBeCloseTo(1, 9);
    expect(blamp(1 - 1e-12, dt)).toBeCloseTo(blamp(0, dt), 9);
    expect(blamp(dt - 1e-12, dt)).toBeCloseTo(0, 9);
    expect(blamp(0, dt)).toBeCloseTo(1 / 6, 12);
  });

  it('wraps phases into [0, 1)', () => {
    expect(wrap(1.25)).toBe(0.25);
    expect(wrap(-0.25)).toBe(0.75);
    expect(wrap(0)).toBe(0);
  });
});
