/**
 * @file One voice rendered into samples (PLAN.md WP 9.1): the pitch path (an exponential sweep, the arpeggio's steps,
 * vibrato), the source (a tonal oscillator with optional FM, seeded white noise, or a Karplus–Strong pluck), the
 * filter, the envelope and the echo, in that order, added into the sound's buffer at the voice's start.
 *
 * Invariants: a pure function of the checked voice (engine/audio/dsp/voice.ts), its noise stream and the rate. The
 * pitch at sample i is `f0 · r^i · arp[k] + depth · sin(2π · rate_vib · i / rate)`, with `r` the sweep's per-sample
 * factor (reaching `to` at the voice's end, applied by repeated multiplication as Web Audio's exponential ramp
 * approximates it) and `k = ⌊i / (step · rate)⌋` (looping or holding the last note). The oscillator's phase is
 * accumulated, so pitch changes never click; FM adds `index · ratio · f · cos(2π φ_mod)` to the instantaneous
 * frequency, which is phase modulation by `index` radians. A filter that follows the pitch takes the pitch path as
 * its frequency; one with its own `freq` sweeps from it to `to` the same way. Noise and the pluck's burst come from
 * the stream named `noise`/`pluck` and the voice's index, so adding a voice never changes another's samples. `Math`
 * functions are called by name: the render's `withSimMath` swap reaches them.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:3736-3760` (`_voice`: the sweep, arpeggio, vibrato and noise filter),
 * rewritten as DSP into a buffer.
 *
 * @example
 * // engine/audio/dsp/render.ts
 * // for (const voice of normalizeSound(def, rate)) renderVoice(voice, streams, rate, out);
 * @see engine/audio/dsp/render.test.ts
 */
import type { RngStreams } from '../../core/rng';
import { Biquad } from './biquad';
import { echo, echoCount, echoSpacing } from './delay';
import { envelopeCurve } from './envelope';
import { oscillate, wrap } from './osc';
import { Pluck } from './pluck';
import type { NormalVoice } from './voice';

/** 2π. */
const TAU = 2 * Math.PI;

/** The voice's length in samples, without its echo. */
export function voiceSamples(voice: NormalVoice, rate: number): number {
  return Math.max(1, Math.round(voice.dur * rate));
}

/** Where the voice ends in the sound, in samples, its echo included. */
export function voiceEnd(voice: NormalVoice, rate: number): number {
  const tail = voice.delay ? echoSpacing(voice.delay, rate) * echoCount(voice.delay) : 0;
  return Math.round(voice.at * rate) + voiceSamples(voice, rate) + tail;
}

/** `n` values sweeping exponentially from `from` to `to` (reached one sample after the end), or `from` throughout. */
function sweep(from: number, to: number, n: number): Float64Array {
  const out = new Float64Array(n);
  const factor = to > 0 ? Math.pow(to / from, 1 / n) : 1;
  let value = from;
  for (let i = 0; i < n; i++, value *= factor) out[i] = value;
  return out;
}

/** The pitch in Hz at each of the voice's `n` samples. */
function pitchPath(voice: NormalVoice, n: number, rate: number): Float64Array {
  const pitch = sweep(voice.f0, voice.to, n);
  if (voice.arp) {
    const { arp, loop } = voice;
    const step = voice.step * rate;
    for (let i = 0; i < n; i++) {
      const k = Math.floor(i / step);
      pitch[i] *= arp[loop ? k % arp.length : Math.min(k, arp.length - 1)];
    }
  }
  if (voice.vib) {
    const [speed, depth] = voice.vib;
    for (let i = 0; i < n; i++) pitch[i] += depth * Math.sin((TAU * speed * i) / rate);
  }
  return pitch;
}

/** The voice's raw source: the oscillator, noise or pluck, before filter and envelope. */
function source(voice: NormalVoice, pitch: Float64Array, streams: RngStreams, rate: number): Float64Array {
  const n = pitch.length;
  const out = new Float64Array(n);
  const { wave } = voice;
  if (wave === 'noise') {
    const rng = streams.stream('noise', voice.index);
    for (let i = 0; i < n; i++) out[i] = rng.next() * 2 - 1;
  } else if (wave === 'pluck') {
    const { decay, brightness } = voice.pluck as NonNullable<NormalVoice['pluck']>;
    const string = new Pluck(voice.f0, rate, streams.stream('pluck', voice.index), decay, brightness);
    for (let i = 0; i < n; i++) out[i] = string.next();
  } else {
    const fm = voice.fm;
    let phase = 0;
    let modulator = 0;
    for (let i = 0; i < n; i++) {
      let f = pitch[i];
      if (fm) {
        const index = fm.index + ((fm.to - fm.index) * i) / n;
        f += index * fm.ratio * f * Math.cos(TAU * modulator);
        modulator = wrap(modulator + (fm.ratio * pitch[i]) / rate);
      }
      const dt = f / rate;
      out[i] = oscillate(wave, phase, dt < 0 ? -dt : dt);
      phase = wrap(phase + dt);
    }
  }
  return out;
}

/** Filters `samples` in place with the voice's filter, if it has one. */
function filtered(voice: NormalVoice, samples: Float64Array, pitch: Float64Array, rate: number): void {
  const spec = voice.filter;
  if (!spec) return;
  const biquad = new Biquad(spec.type, rate);
  const freq = spec.freq > 0 ? sweep(spec.freq, spec.to, samples.length) : pitch;
  for (let i = 0; i < samples.length; i++) {
    biquad.set(freq[i], spec.q, spec.gain);
    samples[i] = biquad.process(samples[i]);
  }
}

/** Renders `voice` and adds it into `out` at its start; `streams` gives its noise. */
export function renderVoice(voice: NormalVoice, streams: RngStreams, rate: number, out: Float64Array): void {
  if (voice.vol === 0) return;
  const n = voiceSamples(voice, rate);
  const pitch = pitchPath(voice, n, rate);
  const samples = source(voice, pitch, streams, rate);
  filtered(voice, samples, pitch, rate);
  const gain = envelopeCurve(voice.env, voice.vol, n, rate);
  for (let i = 0; i < n; i++) samples[i] *= gain[i];
  const done = voice.delay ? echo(samples, voice.delay, rate) : samples;
  const start = Math.round(voice.at * rate);
  for (let i = 0; i < done.length; i++) out[start + i] += done[i];
}
