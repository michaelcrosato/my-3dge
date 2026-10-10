/**
 * @file Unit tests for engine/audio/dsp/pluck.ts (T1): the Karplus–Strong string's tuning, measured to a hundredth
 * of a cent by the phase its fundamental gains over 0.1 s, its decay, its brightness and its seeded burst.
 * @see engine/audio/dsp/pluck.ts
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../../core/rng';
import { Biquad } from './biquad';
import { dcOffset, rms, toneAmplitude } from './measure';
import { Pluck } from './pluck';

const RATE = 44100;

/** `n` samples of a string tuned to `freq`. */
function pluck(freq: number, n: number, seed = 3, decay = 0.999, brightness = 1): Float64Array {
  const string = new Pluck(freq, RATE, new Rng(seed), decay, brightness);
  return Float64Array.from({ length: n }, () => string.next());
}

/** The phase (radians) of the component at `freq` in a Hann-windowed 8,192-sample window starting at `from`. */
function phaseAt(samples: Float64Array, freq: number, from: number): number {
  const n = 8192;
  let [re, im] = [0, 0];
  for (let i = 0; i < n; i++) {
    const w = (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))) * samples[from + i];
    const angle = (2 * Math.PI * freq * (from + i)) / RATE;
    re += w * Math.cos(angle);
    im -= w * Math.sin(angle);
  }
  return Math.atan2(im, re);
}

/** How far the string's fundamental is from `freq`, in cents: from the phase it gains over 0.1 s. */
function centsOff(freq: number): number {
  const samples = pluck(freq, RATE);
  const gap = RATE / 10;
  let turn = phaseAt(samples, freq, 2000 + gap) - phaseAt(samples, freq, 2000);
  turn -= 2 * Math.PI * Math.round(turn / (2 * Math.PI));
  const measured = freq + turn / ((2 * Math.PI * gap) / RATE);
  return 1200 * Math.log2(measured / freq);
}

describe('Pluck', () => {
  it('is in tune to a tenth of a cent up to 1 kHz, and to half a cent up to 4 kHz', () => {
    for (const freq of [55, 110, 220, 440, 1000]) expect(Math.abs(centsOff(freq)), `${freq} Hz`).toBeLessThan(0.1);
    for (const freq of [2000, 3000, 4000]) expect(Math.abs(centsOff(freq)), `${freq} Hz`).toBeLessThan(0.5);
  });

  it('rings at its pitch, its fundamental fading by decay once a period, without DC', () => {
    const samples = pluck(220, RATE, 3, 0.99);
    expect(toneAmplitude(samples, 220, RATE, 0, 4410)).toBeGreaterThan(5 * toneAmplitude(samples, 330, RATE, 0, 4410));
    const fundamental = (from: number) => toneAmplitude(samples, 220, RATE, from, from + 4410);
    const perPeriod = 0.99 * Math.cos((Math.PI * 220) / RATE);
    expect(fundamental(RATE - 4410) / fundamental(RATE / 2 - 4410)).toBeCloseTo(Math.pow(perPeriod, 110), 2);
    expect(Math.abs(dcOffset(samples))).toBeLessThan(1e-3);
  });

  it('darkens with lower brightness', () => {
    const highShare = (brightness: number) => {
      const samples = pluck(110, 8820, 5, 0.996, brightness);
      const highpass = new Biquad('highpass', RATE);
      highpass.set(6000, Math.SQRT1_2);
      return rms(samples.map((x) => highpass.process(x))) / rms(samples);
    };
    const shares = [1, 0.5, 0.2, 0.05].map(highShare);
    for (let i = 1; i < shares.length; i++) expect(shares[i]).toBeLessThan(shares[i - 1]);
    expect(shares[2]).toBeLessThan(shares[0] / 2);
  });

  it('draws its burst from the stream it is given: the same seed, the same samples', () => {
    expect(pluck(330, 2000, 9)).toEqual(pluck(330, 2000, 9));
    expect(pluck(330, 2000, 9)).not.toEqual(pluck(330, 2000, 10));
  });

  it('keeps a line of at least two samples at the top of the range', () => {
    const samples = pluck(RATE / 2, 1000);
    expect(samples.every(Number.isFinite)).toBe(true);
    expect(rms(samples)).toBeGreaterThan(0);
  });
});
