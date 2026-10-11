/**
 * @file Unit tests for engine/audio/dsp/envelope.ts (T1): the source's percussive fall (a linear attack, then an
 * exponential fall reaching 0.0005 one sample past the end), ADSR's segments and its early release, and `hold`.
 * @see engine/audio/dsp/envelope.ts
 */
import { describe, expect, it } from 'vitest';
import { envelopeCurve, FALL_FLOOR, holdEnvelope } from './envelope';

const RATE = 44100;

describe('the fall envelope', () => {
  it('rises linearly to the volume over the attack, then falls exponentially to the floor at the end', () => {
    const n = 4410;
    const gain = envelopeCurve({ kind: 'fall', attack: 0.004 }, 0.5, n, RATE);
    const attack = Math.round(0.004 * RATE);
    expect(gain[0]).toBe(0);
    expect(gain[attack / 2]).toBeCloseTo(0.25, 12);
    expect(gain[attack]).toBe(0.5);
    const factor = gain[attack + 1] / gain[attack];
    expect(factor).toBeLessThan(1);
    for (let i = attack + 1; i < n; i++) expect(gain[i] / gain[i - 1]).toBeCloseTo(factor, 10);
    expect(gain[n - 1] * factor).toBeCloseTo(FALL_FLOOR, 12);
  });

  it('starts at full volume with no attack, and is silent at volume 0', () => {
    expect(envelopeCurve({ kind: 'fall', attack: 0 }, 0.3, 100, RATE)[0]).toBe(0.3);
    expect(envelopeCurve({ kind: 'fall', attack: 0.001 }, 0, 100, RATE).every((g) => g === 0)).toBe(true);
  });
});

describe('the ADSR envelope', () => {
  const adsr = { kind: 'adsr', attack: 0.01, decay: 0.05, sustain: 0.5, release: 0.1 } as const;

  it("matches its file comment's example: full volume at the end of the attack", () => {
    expect(envelopeCurve(adsr, 0.8, 22050, RATE)[441]).toBe(0.8);
  });

  it('attacks, decays to the sustain level, holds it, and releases to 0 on the last sample', () => {
    const n = 22050;
    const gain = envelopeCurve(adsr, 1, n, RATE);
    const [attack, decay, release] = [441, 2205, 4410];
    expect(gain[0]).toBe(0);
    expect(gain[attack]).toBe(1);
    expect(gain[attack + decay]).toBe(0.5);
    expect(gain[attack + decay + 1000]).toBe(0.5);
    expect(gain[n - release - 1]).toBe(0.5);
    expect(gain[n - release]).toBe(0.5);
    expect(gain[n - release / 2]).toBeCloseTo(0.25, 12);
    expect(gain[n - 1]).toBeCloseTo(0.5 / release, 12);
    for (let i = 1; i <= attack; i++) expect(gain[i]).toBeGreaterThan(gain[i - 1]);
    for (let i = n - release + 1; i < n; i++) expect(gain[i]).toBeLessThan(gain[i - 1]);
  });

  it('releases from the level the attack had reached when the gate closes early', () => {
    const n = 441;
    const gain = envelopeCurve({ kind: 'adsr', attack: 0.01, decay: 0, sustain: 1, release: 0.005 }, 1, n, RATE);
    const close = n - Math.round(0.005 * RATE);
    expect(gain[close]).toBeCloseTo(close / 441, 12);
    expect(Math.max(...gain)).toBeLessThan(1);
    expect(gain[n - 1]).toBeGreaterThan(0);
  });

  it("models the source's hold: full volume, then a 30 ms release, shorter when the attack leaves less", () => {
    expect(holdEnvelope(0.004, 0.5)).toEqual({ kind: 'adsr', attack: 0.004, decay: 0, sustain: 1, release: 0.03 });
    expect(holdEnvelope(0.004, 0.02).release).toBeCloseTo(0.016, 12);
    expect(holdEnvelope(0.05, 0.02).release).toBe(0);
    const gain = envelopeCurve(holdEnvelope(0.006, 0.2), 0.2, 8820, RATE);
    expect(gain[265]).toBe(0.2);
    expect(gain[8820 - 1323]).toBe(0.2);
    expect(gain[8819]).toBeCloseTo(0.2 / 1323, 12);
  });
});
