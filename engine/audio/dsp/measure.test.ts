/**
 * @file Unit tests for engine/audio/dsp/measure.ts (T1): peak, RMS and DC over ranges, and Goertzel's amplitude of
 * one frequency, which barely sees a neighbouring tone.
 * @see engine/audio/dsp/measure.ts
 */
import { describe, expect, it } from 'vitest';
import { dcOffset, peak, rms, toneAmplitude } from './measure';
import { render } from './render';

const RATE = 44100;

/** One second of `amplitude · sin(2π freq t)`. */
const sine = (freq: number, amplitude = 1) =>
  Float64Array.from({ length: RATE }, (_, i) => amplitude * Math.sin((2 * Math.PI * freq * i) / RATE));

describe('measure', () => {
  it('gives the peak, RMS and DC offset of a range', () => {
    const samples = [0.5, -2, 1, 1];
    expect(peak(samples)).toBe(2);
    expect(peak(samples, 2)).toBe(1);
    expect(rms(samples)).toBeCloseTo(Math.sqrt(6.25 / 4), 12);
    expect(dcOffset(samples)).toBe(0.125);
    expect(dcOffset(samples, 2, 4)).toBe(1);
    expect(rms([], 0, 0)).toBe(0);
    expect(rms(sine(441))).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it("measures a tone's amplitude and ignores another tone a few bins away", () => {
    expect(toneAmplitude(sine(441), 441, RATE)).toBeCloseTo(1, 6);
    expect(toneAmplitude(sine(441, 0.25), 441, RATE)).toBeCloseTo(0.25, 6);
    expect(toneAmplitude(sine(441), 451, RATE)).toBeLessThan(1e-6);
    expect(toneAmplitude(sine(441), 441, RATE, 0, 1)).toBe(0);
  });

  it("matches its file comment's example", () => {
    const tone = render({ wave: 'sine', freq: 441, dur: 1, attack: 0, hold: true, vol: 1, release: 0 });
    expect(toneAmplitude(tone, 441, 44100)).toBeCloseTo(1, 6);
    expect(peak(tone)).toBeCloseTo(1, 6);
  });
});
