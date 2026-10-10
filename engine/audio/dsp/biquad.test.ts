/**
 * @file Unit tests for engine/audio/dsp/biquad.ts (T1): every type's gain at the points the Audio EQ Cookbook fixes
 * (the cutoff, the centre, DC and Nyquist), measured on steady sines with Goertzel's algorithm, and stability while
 * a sharp filter sweeps across the whole band.
 * @see engine/audio/dsp/biquad.ts
 */
import { describe, expect, it } from 'vitest';
import { Biquad, FILTER_TYPES, type FilterType } from './biquad';
import { peak, toneAmplitude } from './measure';

const RATE = 44100;

/** The gain of a filter at `freq` Hz: a 0.5 s unit sine through it, measured over its last 0.25 s. */
function gainAt(type: FilterType, cutoff: number, q: number, freq: number, dB = 0): number {
  const filter = new Biquad(type, RATE);
  filter.set(cutoff, q, dB);
  const n = RATE / 2;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = filter.process(Math.sin((2 * Math.PI * freq * i) / RATE));
  return toneAmplitude(out, freq, RATE, n / 2, n);
}

/** The gain of a filter at DC (`nyquist` false) or at Nyquist: its settled response to a constant or to ±1. */
function edgeGain(type: FilterType, cutoff: number, q: number, nyquist: boolean, dB = 0): number {
  const filter = new Biquad(type, RATE);
  filter.set(cutoff, q, dB);
  let y = 0;
  for (let i = 0; i < 20000; i++) y = filter.process(nyquist && i % 2 ? -1 : 1);
  return Math.abs(y);
}

/** A gain in dB as a linear amplitude. */
const amp = (dB: number) => Math.pow(10, dB / 20);

describe('Biquad', () => {
  it('passes everything through until set is called', () => {
    const filter = new Biquad('lowpass', RATE);
    expect([0.5, -1, 0.25].map((x) => filter.process(x))).toEqual([0.5, -1, 0.25]);
  });

  it('gives a lowpass and a highpass the gain Q at the cutoff, 1 in the pass band and little in the stop band', () => {
    for (const q of [Math.SQRT1_2, 1.1, 4]) {
      expect(gainAt('lowpass', 1000, q, 1000), `lowpass Q ${q}`).toBeCloseTo(q, 3);
      expect(gainAt('highpass', 1000, q, 1000), `highpass Q ${q}`).toBeCloseTo(q, 3);
    }
    expect(edgeGain('lowpass', 1000, Math.SQRT1_2, false)).toBeCloseTo(1, 9);
    expect(edgeGain('highpass', 1000, Math.SQRT1_2, true)).toBeCloseTo(1, 9);
    expect(gainAt('lowpass', 1000, Math.SQRT1_2, 8000)).toBeLessThan(0.02);
    expect(gainAt('highpass', 1000, Math.SQRT1_2, 125)).toBeLessThan(0.02);
  });

  it('gives a bandpass unity gain at its centre, a notch none, and an allpass unity everywhere', () => {
    expect(gainAt('bandpass', 2000, 2, 2000)).toBeCloseTo(1, 3);
    expect(gainAt('bandpass', 2000, 2, 200)).toBeLessThan(0.06);
    expect(gainAt('notch', 2000, 2, 2000)).toBeLessThan(1e-3);
    expect(gainAt('notch', 2000, 2, 200)).toBeCloseTo(1, 2);
    for (const freq of [100, 1000, 2000, 9000]) expect(gainAt('allpass', 2000, 2, freq)).toBeCloseTo(1, 3);
  });

  it('gives a peaking filter its gain in dB at the centre, and shelves theirs at DC or Nyquist, half at the corner', () => {
    expect(gainAt('peaking', 1000, 1, 1000, 6)).toBeCloseTo(amp(6), 3);
    expect(gainAt('peaking', 1000, 1, 1000, -12)).toBeCloseTo(amp(-12), 3);
    expect(edgeGain('peaking', 1000, 1, false, 6)).toBeCloseTo(1, 6);
    expect(edgeGain('lowshelf', 1000, 1, false, 9)).toBeCloseTo(amp(9), 6);
    expect(edgeGain('lowshelf', 1000, 1, true, 9)).toBeCloseTo(1, 6);
    expect(gainAt('lowshelf', 1000, 1, 1000, 9)).toBeCloseTo(amp(4.5), 3);
    expect(edgeGain('highshelf', 1000, 1, true, -9)).toBeCloseTo(amp(-9), 6);
    expect(edgeGain('highshelf', 1000, 1, false, -9)).toBeCloseTo(1, 6);
    expect(gainAt('highshelf', 1000, 1, 1000, -9)).toBeCloseTo(amp(-4.5), 3);
  });

  it('stays stable and finite while a sharp filter of every type sweeps from 10 Hz to past Nyquist', () => {
    for (const type of FILTER_TYPES) {
      const filter = new Biquad(type, RATE);
      const out = new Float64Array(RATE);
      let noise = 1;
      for (let i = 0; i < out.length; i++) {
        noise = (Math.imul(noise, 48271) >>> 0) % 0x7fffffff;
        filter.set(10 * Math.pow(3000, i / out.length), 30, 12);
        out[i] = filter.process(noise / 0x7fffffff - 0.5);
      }
      expect(out.every(Number.isFinite), type).toBe(true);
      expect(peak(out), type).toBeLessThan(60);
    }
  });
});
