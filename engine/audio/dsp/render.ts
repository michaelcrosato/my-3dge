/**
 * @file The DSP core's entry point (PLAN.md WP 9.1, §6.5, ADR-0013; doctrines: Assets, Reproducible, Verifiable):
 * `render(def, seed, rate)` turns a sound definition (engine/audio/dsp/voice.ts) into a `Float32Array` of mono samples,
 * and `soundHash` digests one, so every sound is code, renders in Node, and checks by its hash. Web Audio only plays
 * the buffers (engine/audio/runtime, WP 9.3); nothing here touches it, the DOM or a clock.
 *
 * The reproducibility contract: the same definition, seed and rate give the same samples, bit for bit, in Node and in
 * Chromium on the development platform, so one golden hash per sound holds in both (tests/e2e/audio-dsp.spec.ts).
 * - `render` runs its whole body inside `withSimMath` (§6.5): the swapped `sin`, `cos` and `pow` are the fdlibm ports,
 *   every other `Math` function it uses is one the drift test proves equal in both runtimes, and the rest is IEEE
 *   arithmetic. It may be called anywhere: inside a sim step (the swap nests) or outside it, from the audio runtime,
 *   a tool or a test; it is synchronous, and `Math` holds the native functions again when it returns or throws.
 * - The seed drives every random draw: a noise voice draws from the named stream `["noise", <voice index>]` of
 *   `new RngStreams(seed)`, a pluck from `["pluck", <voice index>]`. A sound with neither renders the same for every
 *   seed. No `Math.random`.
 * - Voices are summed in float64 and rounded to float32 once, at the end. Samples are not clipped: a loud layered
 *   sound may pass 1, which the audio QA family (WP 9.4) reports.
 * - The buffer lasts until the last voice ends: `at + dur`, plus its echo's tail.
 *
 * Doctrine: Assets: jsfxr (Unlicense) and ZzFX (MIT) were references only; no code was borrowed from them.
 *
 * @example
 * const jump = render({ wave: 'pulse', freq: 280, to: 640, dur: 0.14, vol: 0.3 }, 0, 44100);
 * jump.length; // 6174 samples: 0.14 s at 44,100 Hz
 * soundHash(jump) === soundHash(render({ wave: 'pulse', freq: 280, to: 640, dur: 0.14, vol: 0.3 }, 0, 44100)); // true
 * @see engine/audio/dsp/render.test.ts
 * @see tests/e2e/audio-dsp.spec.ts
 */
import { hashNumbers } from '../../core/hash';
import { codeError, defineCodes } from '../../core/log';
import { RngStreams } from '../../core/rng';
import { withSimMath } from '../../core/simMath';
import { renderVoice, voiceEnd } from './synth';
import { MAX_SECONDS, normalizeSound, type SoundDef } from './voice';

/** The codes `render` raises beyond a definition's own (engine/audio/dsp/voice.ts), with their fixes. */
export const RENDER_CODES = defineCodes('audio', {
  AUDIO_BAD_RATE: {
    template: 'the sample rate {rate} is not a whole number from 8000 to 192000',
    fix: 'render at a whole number of samples per second from 8000 to 192000, usually 44100 or 48000',
    doc: 'Raised by `render` (engine/audio/dsp/render.ts).',
  },
  AUDIO_BAD_SEED: {
    template: 'the seed {seed} is not a whole number',
    fix: 'pass a whole number as the seed, such as one drawn with rng.int',
    doc: 'Raised by `render` (engine/audio/dsp/render.ts): seeds name random streams exactly, so 1.5 is refused rather than silently rounded.',
  },
  AUDIO_TOO_LONG: {
    template: 'the sound lasts {seconds} s, past the {max} s limit',
    fix: 'shorten its voices (at, dur) or its echo (delay.time, delay.feedback); a song renders section by section',
    doc: 'Raised by `render` (engine/audio/dsp/render.ts) before it allocates the buffer.',
  },
});

/** The sample rate `render` uses when none is given. */
export const DEFAULT_RATE = 44100;

/**
 * The sound `def` as mono samples at `rate` per second, its random draws seeded by `seed`: the same bits in Node and
 * Chromium (see the file comment for the contract).
 */
export function render(def: SoundDef, seed = 0, rate = DEFAULT_RATE): Float32Array {
  if (!Number.isInteger(rate) || rate < 8000 || rate > 192000) throw codeError('AUDIO_BAD_RATE', { rate });
  if (!Number.isSafeInteger(seed)) throw codeError('AUDIO_BAD_SEED', { seed });
  return withSimMath(() => {
    const voices = normalizeSound(def, rate);
    let length = 0;
    for (const voice of voices) length = Math.max(length, voiceEnd(voice, rate));
    if (length > MAX_SECONDS * rate) throw codeError('AUDIO_TOO_LONG', { seconds: length / rate, max: MAX_SECONDS });
    const mix = new Float64Array(length);
    const streams = new RngStreams(seed);
    for (const voice of voices) renderVoice(voice, streams, rate, mix);
    return Float32Array.from(mix);
  });
}

/** The 64-bit FNV-1a hex digest of `samples` (engine/core/hash.ts's `hashNumbers`): one golden per sound. */
export function soundHash(samples: Float32Array): string {
  return hashNumbers(samples);
}
