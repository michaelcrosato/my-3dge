/**
 * @file The audio-dsp page's module (`tests/pages/audio-dsp.html`), Chromium's half of tests/e2e/audio-dsp.spec.ts:
 * it publishes the DSP core's `render` over the reference sounds and the seeded random ones of
 * tests/pages/audioDspCases.ts as `window.__audioDsp`, then signals ready through `window.__engine`. It renders
 * nothing until the spec calls it, and never touches Web Audio: the buffers are only hashed.
 *
 * Invariants: `samples` returns a buffer as base64 of its float32 bytes, so the spec compares it with Node's bit for
 * bit; everything else returns plain JSON.
 */
import { render, soundHash } from '../../engine/audio/dsp/render';
import type { SoundDef } from '../../engine/audio/dsp/voice';
import { SIM_MATH, SIM_MATH_NAMES } from '../../engine/core/simMath';
import { caseHashes, randomSound, SOUND_CASES } from './audioDspCases';

/** Base64 of a buffer's bytes, in chunks small enough for `String.fromCharCode`. */
function base64(values: Float32Array): string {
  const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/** True when `Math` holds every native function the sim swaps. */
const native = () => SIM_MATH_NAMES.every((name) => Math[name] === SIM_MATH[name].native);

/** What the page offers the spec. */
const audioDsp = {
  /** Each reference sound's hash, by name. */
  caseHashes: () => caseHashes(),
  /** The hash of each random sound made from `seeds`, by name. */
  randomHashes: (seeds: number[]) =>
    Object.fromEntries(
      seeds.map((seed) => {
        const c = randomSound(seed);
        return [c.name, soundHash(render(c.def, c.seed, c.rate))];
      }),
    ),
  /** The reference sound `name`'s samples, as base64 float32 bytes. */
  samples: (name: string) => {
    const c = SOUND_CASES.find((sound) => sound.name === name);
    if (!c) throw new Error(`no reference sound ${name}`);
    return base64(render(c.def, c.seed, c.rate));
  },
  /** Whether Math is native before a render, after it, and after a render that throws, with the thrown code. */
  restores: (good: SoundDef, bad: SoundDef) => {
    const before = native();
    render(good);
    const after = native();
    let code = '';
    try {
      render(bad);
    } catch (error) {
      code = (error as { code?: string }).code ?? String(error);
    }
    return { before, after, afterThrow: native(), code };
  },
};

declare global {
  interface Window {
    __audioDsp: typeof audioDsp;
  }
}

Object.assign(window, { __audioDsp: audioDsp, __engine: { ready: true, errors: [] } });
