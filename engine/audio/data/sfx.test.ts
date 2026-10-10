/**
 * @file Unit tests for the `sfx` kind (engine/audio/data/sfx.ts): its checks refuse bad effects with the field named;
 * layers shift, scale and transpose their voices exactly and nest; cycles and unknown layers throw; variant 0 is the
 * sound as written and the others spread their pitch over the whole range, measured on the rendered samples.
 * @see engine/audio/data/sfx.ts
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createRegistry, type Registry } from '../../core/registry';
import { peak, toneAmplitude } from '../dsp/measure';
import { render, soundHash } from '../dsp/render';
import { noteFreq } from '../dsp/voice';
import { defineSfx, getSfx, renderSfx, sfxProblems, sfxVoices, variantPitch } from './sfx';

const RATE = 44100;
/** A steady sine: full volume from 4 ms to 30 ms before the end. */
const TONE = { wave: 'sine', freq: 441, dur: 1, vol: 0.5, hold: true } as const;

let registry: Registry;
beforeEach(() => {
  registry = createRegistry();
  defineSfx('sfx:tone', { voices: TONE }, registry);
});

describe('the sfx kind', () => {
  it('holds the engine effects and fills the defaults', () => {
    const jump = getSfx('sfx:jump', registry);
    expect(jump).toMatchObject({ id: 'sfx:jump', kind: 'sfx', layers: [], variants: 4, vary: 0.03, bus: 'effects' });
    expect(getSfx('sfx:tone', registry)).toMatchObject({ layers: [], variants: 1, vary: 0.03, bus: 'effects' });
    expect(() => getSfx('sfx:jmp', registry)).toThrow(/CORE_NO_ENTRY.*sfx:jump/);
  });

  it('refuses bad effects, naming the field', () => {
    const bad = (spec: object) => () => defineSfx('sfx:bad', spec, registry);
    expect(bad({ voice: TONE })).toThrow(/CORE_BAD_SPEC.*did you mean "voices"/);
    expect(bad({})).toThrow(/neither voices nor layers/);
    expect(bad({ voices: { wave: 'sqaure' } })).toThrow(/AUDIO_UNKNOWN_WAVE.*square/);
    expect(bad({ voices: [] })).toThrow(/at least one voice/);
    expect(bad({ voices: TONE, variants: 0 })).toThrow(/variants/);
    expect(bad({ voices: TONE, vary: 0.6 })).toThrow(/vary/);
    expect(bad({ voices: TONE, bus: 'music' })).toThrow(/bus/);
    expect(bad({ layers: [{ sfx: 'sfx:tone', pitch: 0 }] })).toThrow(/pitch/);
    expect(bad({ layers: [{ id: 'sfx:tone' }] })).toThrow(/layers\[0\]/);
    expect(() => defineSfx('sfx:tone', { voices: TONE }, registry)).toThrow(/CORE_DUPLICATE_ID/);
    expect(sfxProblems({ voices: TONE })).toEqual([]);
    expect(sfxProblems({ layers: [{ sfx: 'sfx:tone' }] })).toEqual([]);
  });
});

describe('layers', () => {
  it('shift a layer by its start, exactly', () => {
    defineSfx('sfx:late', { layers: [{ sfx: 'sfx:tone', at: 0.1 }] }, registry);
    const tone = renderSfx('sfx:tone', { registry });
    const late = renderSfx('sfx:late', { registry });
    expect(late.length).toBe(tone.length + 4410);
    expect(peak(late, 0, 4410)).toBe(0);
    expect(late.subarray(4410)).toEqual(tone);
  });

  it('scale a layer by its gain, exactly', () => {
    defineSfx('sfx:soft', { layers: [{ sfx: 'sfx:tone', vol: 0.5 }] }, registry);
    const tone = renderSfx('sfx:tone', { registry });
    expect(renderSfx('sfx:soft', { registry })).toEqual(tone.map((sample) => sample / 2));
  });

  it('transpose every frequency of a layer, never its timing', () => {
    defineSfx('sfx:up', { layers: [{ sfx: 'sfx:tone', pitch: 2 }] }, registry);
    const up = renderSfx('sfx:up', { registry });
    expect(up.length).toBe(renderSfx('sfx:tone', { registry }).length);
    expect(toneAmplitude(up, 882, RATE, 4410, 39690)).toBeCloseTo(0.5, 2);
    expect(toneAmplitude(up, 441, RATE, 4410, 39690)).toBeLessThan(0.001);
    defineSfx(
      'sfx:named',
      { voices: { freq: 'A4', to: 'A5', filter: { type: 'lowpass', freq: 1000, to: 'C6' } } },
      registry,
    );
    defineSfx('sfx:fifth', { layers: [{ sfx: 'sfx:named', pitch: 1.5 }] }, registry);
    const [voice] = sfxVoices('sfx:fifth', registry);
    expect(voice).toMatchObject({ freq: 660, to: 1320, filter: { type: 'lowpass', freq: 1500 } });
    expect((voice.filter as { to: number }).to).toBeCloseTo(noteFreq('C6') * 1.5, 9);
  });

  it('nest, composing start, gain and pitch, and keep their order', () => {
    defineSfx(
      'sfx:inner',
      { voices: [TONE, { wave: 'noise', at: 0.02 }], layers: [{ sfx: 'sfx:tone', pitch: 1.5 }] },
      registry,
    );
    defineSfx(
      'sfx:outer',
      { voices: { wave: 'square' }, layers: [{ sfx: 'sfx:inner', at: 0.1, vol: 0.5, pitch: 2 }] },
      registry,
    );
    const voices = sfxVoices('sfx:outer', registry);
    expect(voices.map((v) => [v.wave, v.at, v.vol, v.freq])).toEqual([
      ['square', undefined, undefined, undefined],
      ['sine', 0.1, 0.25, 882],
      ['noise', 0.12000000000000001, 0.15, 880],
      ['sine', 0.1, 0.25, 1323],
    ]);
    expect(peak(renderSfx('sfx:outer', { registry }))).toBeGreaterThan(0.3);
  });

  it('throw on a cycle and on an unknown layer when the sound renders', () => {
    defineSfx('sfx:a', { layers: [{ sfx: 'sfx:b' }] }, registry);
    defineSfx('sfx:b', { voices: TONE, layers: [{ sfx: 'sfx:a' }] }, registry);
    expect(() => renderSfx('sfx:a', { registry })).toThrow(/AUDIO_LAYER_CYCLE.*sfx:a → sfx:b → sfx:a/);
    defineSfx('sfx:lost', { layers: [{ sfx: 'sfx:tome' }] }, registry);
    expect(() => sfxVoices('sfx:lost', registry)).toThrow(/CORE_NO_ENTRY.*sfx:tone/);
  });
});

describe('variants', () => {
  it('keep variant 0 as written and render each variant the same every time', () => {
    defineSfx('sfx:steps', { voices: [TONE, { wave: 'noise', dur: 0.1 }], variants: 4, vary: 0.1 }, registry);
    const voices = sfxVoices('sfx:steps', registry);
    expect(renderSfx('sfx:steps', { registry, seed: 7 })).toEqual(render(voices, 7));
    const hashes = [0, 1, 2, 3].map((variant) => soundHash(renderSfx('sfx:steps', { registry, variant })));
    expect(new Set(hashes).size).toBe(4);
    expect([0, 1, 2, 3].map((variant) => soundHash(renderSfx('sfx:steps', { registry, variant })))).toEqual(hashes);
    expect(soundHash(renderSfx('sfx:steps', { registry, variant: 2, seed: 1 }))).not.toBe(hashes[2]);
  });

  it('spread their pitch over the whole range, one slice each, as the samples show', () => {
    const sfx = defineSfx('sfx:spread', { voices: TONE, variants: 4, vary: 0.1 }, registry);
    expect(variantPitch(sfx, 0)).toBe(1);
    const slices = [
      [0.9, 0.9667],
      [0.9667, 1.0334],
      [1.0333, 1.1],
    ];
    for (const seed of [0, 1, 2, 99]) {
      for (const variant of [1, 2, 3]) {
        const pitch = variantPitch(sfx, variant, seed);
        expect(pitch).toBeGreaterThanOrEqual(slices[variant - 1][0]);
        expect(pitch).toBeLessThan(slices[variant - 1][1]);
      }
    }
    for (const variant of [1, 3]) {
      const samples = renderSfx(sfx, { registry, variant });
      const pitch = variantPitch(sfx, variant);
      expect(toneAmplitude(samples, 441 * pitch, RATE, 4410, 39690)).toBeCloseTo(0.5, 2);
      expect(toneAmplitude(samples, 441, RATE, 4410, 39690)).toBeLessThan(0.005);
    }
  });

  it('refuse a variant the effect lacks and a seed that is not whole', () => {
    expect(() => renderSfx('sfx:jump', { registry, variant: 4 })).toThrow(/AUDIO_BAD_VARIANT.*0 to 3/);
    expect(() => renderSfx('sfx:jump', { registry, variant: -1 })).toThrow(/AUDIO_BAD_VARIANT/);
    expect(() => renderSfx('sfx:jump', { registry, variant: 1.5 })).toThrow(/AUDIO_BAD_VARIANT/);
    expect(() => renderSfx('sfx:jump', { registry, variant: 1, seed: 0.5 })).toThrow(/AUDIO_BAD_SEED/);
  });
});
