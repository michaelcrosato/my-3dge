/**
 * @file Unit tests for engine/audio/dsp/render.ts, synth.ts and voice.ts (T1): the reproducibility contract (the same
 * definition and seed give the same hash run after run, equal to the golden of every reference sound in
 * tests/pages/audioDspCases.ts; seeds reach only noise and plucks; a voice's noise does not depend on the others; Math
 * is restored), each feature measured on the rendered samples (pitch, sweep, arpeggio, vibrato, FM, filter, envelope,
 * echo, pluck, layering), the buffer's length, and the coded errors of a bad definition. tests/e2e/audio-dsp.spec.ts
 * proves the same hashes in Chromium.
 * @see engine/audio/dsp/render.ts
 */
import { describe, expect, it } from 'vitest';
import { GOLDEN, randomSound, SOUND_CASES } from '../../../tests/pages/audioDspCases';
import { SIM_MATH, SIM_MATH_NAMES, withSimMath } from '../../core/simMath';
import { FALL_FLOOR } from './envelope';
import { peak, rms, toneAmplitude } from './measure';
import { DEFAULT_RATE, render, soundHash } from './render';
import { MAX_SECONDS, normalizeSound, noteFreq, type SoundDef, type Voice } from './voice';

const RATE = 44100;
const PLATFORM = `${process.platform}-${process.arch}`;

/** Upward zero crossings in `[from, to)`: the whole cycles a tone completes there, give or take one. */
function cycles(samples: Float32Array, from: number, to: number): number {
  let count = 0;
  for (let i = from + 1; i < to; i++) if (samples[i - 1] < 0 && samples[i] >= 0) count++;
  return count;
}

/** Expects the tone in `[from, to)` to complete `expected` cycles, give or take the one a crossing count may miss. */
function expectCycles(samples: Float32Array, from: number, to: number, expected: number, label = ''): void {
  expect(Math.abs(cycles(samples, from, to) - expected), `${label} cycles`).toBeLessThanOrEqual(1);
}

/** A steady sine at full volume: no attack, no release. */
const steady = (voice: Voice): Voice => ({ wave: 'sine', vol: 1, attack: 0, sustain: 1, release: 0, ...voice });

describe('render: the reproducibility contract', () => {
  it('gives the same samples and hash for the same definition and seed, run after run', () => {
    for (const c of [...SOUND_CASES, ...Array.from({ length: 20 }, (_, i) => randomSound(i + 1))]) {
      const first = render(c.def, c.seed, c.rate);
      const again = render(c.def, c.seed, c.rate);
      expect(again, c.name).toEqual(first);
      expect(soundHash(again), c.name).toBe(soundHash(first));
      expect(first.every(Number.isFinite), c.name).toBe(true);
    }
  });

  it.runIf(PLATFORM in GOLDEN)(`matches the golden hash of every reference sound (${PLATFORM})`, () => {
    const golden = GOLDEN[PLATFORM];
    const hashes = Object.fromEntries(SOUND_CASES.map((c) => [c.name, soundHash(render(c.def, c.seed, c.rate))]));
    expect(hashes).toEqual(golden);
  });

  it('draws noise and plucks from the seed, and renders a sound with neither the same for every seed', () => {
    const noise: SoundDef = { wave: 'noise', freq: 2000, dur: 0.05 };
    const pluck: SoundDef = { wave: 'pluck', freq: 220, dur: 0.05 };
    for (const def of [noise, pluck]) {
      expect(soundHash(render(def, 1))).not.toBe(soundHash(render(def, 2)));
      expect(soundHash(render(def, 1))).toBe(soundHash(render(def, 1)));
    }
    const tonal: SoundDef = [{ wave: 'saw', freq: 300, to: 90, dur: 0.1, fm: { ratio: 2, index: 1 } }];
    expect(soundHash(render(tonal, 1))).toBe(soundHash(render(tonal, 99)));
  });

  it("keeps each voice's noise its own: adding or silencing another voice never changes it", () => {
    const a: Voice = { wave: 'noise', freq: 1000, dur: 0.05 };
    const b: Voice = { wave: 'noise', freq: 3000, dur: 0.05 };
    const both = render([a, b], 4);
    const onlyA = render([a, { ...b, vol: 0 }], 4);
    const onlyB = render([{ ...a, vol: 0 }, b], 4);
    for (let i = 0; i < both.length; i++) expect(both[i]).toBeCloseTo(onlyA[i] + onlyB[i], 6);
    expect(render([a], 4)).toEqual(onlyA);
  });

  it('runs under withSimMath and puts the native Math back, also after a throw; inside a sim step it nests', () => {
    const native = () => SIM_MATH_NAMES.every((name) => Math[name] === SIM_MATH[name].native);
    const def: SoundDef = {
      wave: 'sine',
      freq: 300,
      to: 900,
      dur: 0.05,
      filter: { type: 'peaking', freq: 500, gain: 6 },
    };
    const outside = render(def);
    expect(native()).toBe(true);
    expect(() => render({ wave: 'sine', dur: -1 })).toThrow(/AUDIO_BAD_VALUE/);
    expect(native()).toBe(true);
    expect(withSimMath(() => render(def))).toEqual(outside);
    expect(native()).toBe(true);
  });

  it('mixes voices in float64, rounds to float32 once and never clips', () => {
    const loud: SoundDef = [steady({ freq: 441, dur: 0.1 }), steady({ freq: 441, dur: 0.1 })];
    const samples = render(loud);
    expect(samples).toBeInstanceOf(Float32Array);
    expect(peak(samples)).toBeCloseTo(2, 5);
    const one = render(steady({ freq: 441, dur: 0.1 }));
    for (let i = 0; i < one.length; i++) expect(samples[i]).toBe(Math.fround(2 * one[i]));
  });
});

describe('render: length', () => {
  it("matches its file comment's example: 0.14 s at 44,100 Hz is 6174 samples", () => {
    expect(render({ wave: 'pulse', freq: 280, to: 640, dur: 0.14, vol: 0.3 }, 0, 44100).length).toBe(6174);
    expect(DEFAULT_RATE).toBe(44100);
  });

  it('lasts until the last voice ends, its start and its echo included', () => {
    expect(render([{ dur: 0.1 }, { at: 0.25, dur: 0.1 }], 0, 8000).length).toBe(2800);
    const echoed = render({ dur: 0.1, delay: { time: 0.1, feedback: 0, mix: 0.5 } }, 0, 8000);
    expect(echoed.length).toBe(1600);
    expect(render({ dur: 0 }, 0, 8000).length).toBe(Math.round(0.012 * 8000));
  });
});

describe('render: what each feature does to the samples', () => {
  it('plays the pitch and volume asked for, by number or note name', () => {
    const a4 = render(steady({ freq: 'A4', dur: 1, vol: 0.5 }));
    expect(toneAmplitude(a4, 440, RATE)).toBeCloseTo(0.5, 4);
    expectCycles(a4, 0, RATE, 440);
    expect(render(steady({ freq: 440, dur: 0.2 }))).toEqual(render(steady({ freq: 'A4', dur: 0.2 })));
  });

  it('sweeps the pitch exponentially from freq to to', () => {
    const sweep = render(steady({ freq: 200, to: 800, dur: 1 }));
    expectCycles(sweep, 0, RATE, (200 * 3) / Math.log(4), 'all');
    expectCycles(sweep, 0, RATE / 2, 200 / Math.log(4), 'first half');
  });

  it('steps through an arpeggio, holding its last note or looping', () => {
    const arp = (loop: boolean) => render(steady({ freq: 440, arp: [0, 12, 7], step: 0.1, dur: 0.4, loop }));
    const fifth = 44 * Math.pow(2, 7 / 12);
    const [held, looped] = [arp(false), arp(true)];
    [44, 88, fifth, fifth].forEach((n, k) => expectCycles(held, k * 4410, (k + 1) * 4410, n, `held note ${k}`));
    [44, 88, fifth, 44].forEach((n, k) => expectCycles(looped, k * 4410, (k + 1) * 4410, n, `looped note ${k}`));
  });

  it('swings the pitch by its depth at the vibrato rate', () => {
    const vib = render(steady({ freq: 440, dur: 0.2, vib: [5, 0.1] }));
    const extra = (44 * 2) / (10 * Math.PI);
    expectCycles(vib, 0, 4410, 44 + extra, 'rising half');
    expectCycles(vib, 4410, 8820, 44 - extra, 'falling half');
  });

  it('modulates the phase by index radians with FM: sidebands at the Bessel amplitudes', () => {
    const fm = render(steady({ freq: 1000, dur: 1, fm: { ratio: 0.25, index: 1 } }));
    const bessel = [0.7651976866, 0.4400505857, 0.1149034849];
    bessel.forEach((amplitude, n) => {
      expect(toneAmplitude(fm, 1000 + 250 * n, RATE), `n = ${n}`).toBeCloseTo(amplitude, 3);
      expect(toneAmplitude(fm, 1000 - 250 * n, RATE), `n = -${n}`).toBeCloseTo(amplitude, 3);
    });
  });

  it("filters the voice: a lowpass at its own frequency, and a noise voice's bandpass following its pitch", () => {
    const saw: Voice = { wave: 'saw', freq: 110, dur: 1, vol: 1, attack: 0, sustain: 1, release: 0 };
    const dry = render(saw);
    const wet = render({ ...saw, filter: { type: 'lowpass', freq: 1000, q: Math.SQRT1_2 } });
    expect(toneAmplitude(wet, 110, RATE) / toneAmplitude(dry, 110, RATE)).toBeCloseTo(1, 2);
    expect(toneAmplitude(wet, 4400, RATE) / toneAmplitude(dry, 4400, RATE)).toBeLessThan(0.06);
    const noise = render({ wave: 'noise', freq: 2000, dur: 1, vol: 1, attack: 0, hold: true }, 3);
    const band = (centre: number) => {
      let sum = 0;
      for (let k = -10; k <= 10; k++) sum += toneAmplitude(noise, centre * (1 + k / 100), RATE);
      return sum / 21;
    };
    expect(band(2000)).toBeGreaterThan(5 * band(200));
    expect(band(2000)).toBeGreaterThan(5 * band(16000));
  });

  it("shapes the volume: the source's fall reaches the floor at the end, hold sustains, ADSR decays", () => {
    const fall = render({ wave: 'sine', freq: 441, dur: 0.5, vol: 0.5 });
    expect(peak(fall, 0, 2205)).toBeGreaterThan(0.4);
    expect(peak(fall, fall.length - 441)).toBeLessThan(2 * FALL_FLOOR);
    const hold = render({ wave: 'sine', freq: 441, dur: 0.5, vol: 0.5, hold: true });
    expect(peak(hold, 19845, 20286)).toBeCloseTo(0.5, 3);
    const adsr = render({ wave: 'sine', freq: 441, dur: 0.5, vol: 0.5, decay: 0.1, sustain: 0.4, release: 0.1 });
    expect(peak(adsr, 8820, 13230)).toBeCloseTo(0.2, 2);
  });

  it('echoes a voice: repeats every delay.time, the first at mix, then feedback times the last', () => {
    const blip: Voice = steady({ freq: 1000, dur: 0.05, delay: { time: 0.1, feedback: 0.5, mix: 0.4 } });
    const samples = render(blip);
    const at = (k: number) => rms(samples, k * 4410, k * 4410 + 2205);
    expect(at(1) / at(0)).toBeCloseTo(0.4, 4);
    expect(at(2) / at(1)).toBeCloseTo(0.5, 4);
    expect(rms(samples, 2205, 4410)).toBe(0);
  });

  it('plucks a string at the note asked for', () => {
    const e2 = render({ wave: 'pluck', freq: 'E2', dur: 1, vol: 1, attack: 0 }, 1);
    const f = noteFreq('E2');
    expect(toneAmplitude(e2, f, RATE)).toBeGreaterThan(4 * toneAmplitude(e2, f * 1.5, RATE));
  });
});

describe('normalizeSound and noteFreq', () => {
  it('fills the source chip synth’s defaults', () => {
    const [square] = normalizeSound({}, RATE);
    expect(square).toMatchObject({ wave: 'square', f0: 440, to: 0, dur: 0.15, vol: 0.3, at: 0, step: 0.06 });
    expect(square.env).toEqual({ kind: 'fall', attack: 0.004 });
    expect(square.filter).toBeNull();
    const [noise] = normalizeSound({ wave: 'noise', freq: 5 }, RATE);
    expect(noise.filter).toEqual({ type: 'bandpass', freq: 0, to: 0, q: 1.1, gain: 0 });
    expect(noise.f0).toBe(20);
    expect(normalizeSound({ hold: true, dur: 0.2 }, RATE)[0].env).toEqual({
      kind: 'adsr',
      attack: 0.004,
      decay: 0,
      sustain: 1,
      release: 0.03,
    });
    expect(normalizeSound({ dur: 0.001 }, RATE)[0].dur).toBe(0.012);
    expect(normalizeSound({ wave: 'pluck', dur: 0.5 }, RATE)[0].env).toMatchObject({ kind: 'adsr', sustain: 1 });
    expect(normalizeSound({ wave: 'pluck', hold: false }, RATE)[0].env.kind).toBe('fall');
  });

  it('reads note names in equal temperament, A4 = 440 Hz', () => {
    expect(noteFreq('A4')).toBe(440);
    expect(noteFreq('A5')).toBe(880);
    expect(noteFreq('C4')).toBeCloseTo(261.6255653, 6);
    expect(noteFreq('C#5')).toBeCloseTo(554.365262, 6);
    expect(noteFreq('Bb2')).toBeCloseTo(116.5409404, 6);
    expect(noteFreq('a-1')).toBeCloseTo(13.75, 9);
    expect(noteFreq(123.5)).toBe(123.5);
  });

  it('refuses a bad definition with a coded error naming the voice, the field and the fix', () => {
    const cases: [unknown, RegExp][] = [
      [{ wave: 'sqaure' }, /\[AUDIO_UNKNOWN_WAVE\] voice 0: there is no wave "sqaure" \(did you mean "square"\?\)/],
      [[{}, { frq: 2 }], /\[AUDIO_UNKNOWN_FIELD\] voice 1 has no field "frq" \(did you mean "freq"\?\)/],
      [{ fm: { ratio: 1, indx: 2 } }, /\[AUDIO_UNKNOWN_FIELD\] voice 0 fm has no field "indx"/],
      [{ vol: -1 }, /\[AUDIO_BAD_VALUE\] voice 0: vol is -1: make vol a number from 0 to 10/],
      [{ dur: '1' }, /\[AUDIO_BAD_VALUE\] voice 0: dur is "1"/],
      [{ freq: 'H4' }, /\[AUDIO_BAD_NOTE\] voice 0: "H4" is not a note/],
      [{ freq: 0 }, /\[AUDIO_BAD_NOTE\]/],
      [{ wave: 'pluck', to: 300 }, /\[AUDIO_BAD_VALUE\] voice 0: to is 300: make to absent: a pluck keeps one pitch/],
      [{ wave: 'noise', fm: { ratio: 1, index: 1 } }, /fm needs a tonal wave/],
      [{ pluck: { decay: 0.9 } }, /make pluck absent unless wave is 'pluck'/],
      [{ filter: 'lowpas' }, /make filter one of lowpass, .* \(did you mean "lowpass"\?\)/],
      [{ filter: { type: 'lowpass', to: 300 } }, /make filter.to absent unless filter.freq is set/],
      [{ fm: { ratio: 2 } }, /make fm.index a number from 0 to 100 \(it is required\)/],
      [{ arp: [] }, /make arp a list of semitones/],
      [{ vib: [0, 0.1] }, /make vib \[rate in Hz/],
      [{ hold: 1 }, /make hold true or false/],
      [{ delay: { time: 3 } }, /make delay.time a number from 0.001 to 2/],
      [[], /\[AUDIO_BAD_VALUE\] the sound: the voice list is \[\]/],
      [null, /\[AUDIO_BAD_VALUE\] voice 0: the voice is null: make the voice an object with the fields wave, freq/],
    ];
    for (const [def, message] of cases) expect(() => render(def as SoundDef), JSON.stringify(def)).toThrow(message);
  });

  it('refuses a bad rate, a fractional seed and a sound past the length limit', () => {
    expect(() => render({}, 0, 4000)).toThrow(/\[AUDIO_BAD_RATE\] the sample rate 4000/);
    expect(() => render({}, 0, 44100.5)).toThrow(/AUDIO_BAD_RATE/);
    expect(() => render({}, 1.5)).toThrow(/\[AUDIO_BAD_SEED\] the seed 1.5 is not a whole number/);
    expect(() => render({ at: 1, dur: MAX_SECONDS })).toThrow(/\[AUDIO_TOO_LONG\] the sound lasts 601 s/);
  });
});
