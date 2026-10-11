/**
 * @file Unit tests for the fixture sounds (fixtures/sounds/index.ts): each is defined, renders and has the numbers its
 * file comment promises (lengths, levels, pitches, variants), and the demo song's tracks join by intensity.
 * @see fixtures/sounds/index.ts
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { getSfx, renderSfx, renderSong, songTiming, songVoices, getSong } from '../../engine';
import { createRegistry, type Registry } from '../../engine/core/registry';
import { peak, toneAmplitude } from '../../engine/audio/dsp/measure';
import { soundHash } from '../../engine/audio/dsp/render';
import { defineFixtureSounds } from './index';

const RATE = 44100;

let registry: Registry;
beforeEach(() => {
  registry = createRegistry();
});

describe('the fixture sounds', () => {
  it('are defined once on a registry of their own', () => {
    expect(defineFixtureSounds(registry)).toEqual([
      'sfx:fixtureTone',
      'sfx:fixtureNoise',
      'sfx:fixtureChord',
      'sfx:fixtureBlip',
      'song:fixtureDemo',
    ]);
    expect(() => defineFixtureSounds(registry)).toThrow(/CORE_DUPLICATE_ID/);
  });

  it('have the lengths, levels and pitches their comment gives', () => {
    defineFixtureSounds(registry);
    const tone = renderSfx('sfx:fixtureTone', { registry });
    expect(tone.length).toBe(RATE / 2);
    expect(toneAmplitude(tone, 441, RATE, 441, 20286)).toBeCloseTo(0.5, 3);
    const noise = renderSfx('sfx:fixtureNoise', { registry });
    expect(noise.length).toBe(RATE / 4);
    expect(peak(noise)).toBeGreaterThan(0.05);
    expect(peak(noise)).toBeLessThan(0.4);
    const chord = renderSfx('sfx:fixtureChord', { registry });
    for (const freq of [441, 551.25, 661.5]) expect(toneAmplitude(chord, freq, RATE, 441, 20286)).toBeCloseTo(0.25, 2);
    const blips = [0, 1, 2, 3].map((variant) => soundHash(renderSfx('sfx:fixtureBlip', { registry, variant })));
    expect(new Set(blips).size).toBe(4);
    expect(getSfx('sfx:fixtureBlip', registry)).toMatchObject({ variants: 4, vary: 0.05 });
  });

  it('has a demo song of two bars whose tracks join as the intensity rises', () => {
    defineFixtureSounds(registry);
    const demo = getSong('song:fixtureDemo', registry);
    expect(songTiming(demo)).toEqual({ stepSeconds: 0.125, barSteps: 16, steps: 32, seconds: 4 });
    const waves = (intensity: number) => new Set(songVoices(demo, { registry, intensity }).map((voice) => voice.wave));
    expect(waves(0)).toEqual(new Set(['square', 'triangle']));
    expect(waves(0.25)).toEqual(new Set(['square', 'triangle', 'sine', 'noise']));
    expect(waves(1)).toEqual(new Set(['square', 'triangle', 'sine', 'noise', 'pluck']));
    const samples = renderSong(demo, { registry });
    expect(samples.length).toBe(4 * RATE);
    expect(peak(samples)).toBeGreaterThan(0.1);
    expect(peak(samples)).toBeLessThan(1);
  });
});
