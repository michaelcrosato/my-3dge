/**
 * @file Volume envelopes of the DSP core (PLAN.md WP 9.1): the source's percussive envelope (a linear attack, then an
 * exponential fall to 0.0005 at the end, as Web Audio's `exponentialRampToValueAtTime` gives it) and ADSR (attack,
 * decay, sustain, release), which also covers the source's `hold` (sustain at full volume, a 30 ms release).
 *
 * Invariants: `envelopeCurve(env, vol, n, rate)` is a pure function returning one gain per sample, `vol` included.
 * A voice lasts its duration in total: an ADSR's release ends on the last sample, so the gate closes `release`
 * seconds before it, and a release that starts during the attack or the decay falls from the level reached there.
 * Segments are linear, except the fall, whose per-sample factor is one `Math.pow` (called by name, so the render's
 * `withSimMath` swap reaches it) applied by repeated multiplication: exact IEEE arithmetic, the same bits in Node and
 * Chromium.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:3738-3740` (the attack, exponential fall and hold), with ADSR added.
 *
 * @example
 * const gain = envelopeCurve({ kind: 'adsr', attack: 0.01, decay: 0.05, sustain: 0.5, release: 0.1 }, 0.8, 22050, 44100);
 * gain[441]; // 0.8: the end of the attack
 * @see engine/audio/dsp/envelope.test.ts
 */

/** Where the source's exponential fall ends, as a gain: Web Audio cannot ramp exponentially to 0. */
export const FALL_FLOOR = 0.0005;

/** The source's percussive envelope: a linear attack to full volume, then an exponential fall to `FALL_FLOOR`. */
export interface FallEnvelope {
  kind: 'fall';
  /** Seconds from 0 to full volume. */
  attack: number;
}

/** Attack, decay, sustain and release; the release ends at the voice's end. */
export interface AdsrEnvelope {
  kind: 'adsr';
  /** Seconds from 0 to full volume. */
  attack: number;
  /** Seconds from full volume to the sustain level. */
  decay: number;
  /** The level held after the decay, from 0 to 1 of the volume. */
  sustain: number;
  /** Seconds from the sustain level (or wherever the gate closed) to 0, ending on the voice's last sample. */
  release: number;
}

/** A volume envelope. */
export type Envelope = FallEnvelope | AdsrEnvelope;

/** The source's `hold`: an ADSR sustaining full volume, with a 30 ms release (shorter when the attack leaves less). */
export function holdEnvelope(attack: number, dur: number): AdsrEnvelope {
  return { kind: 'adsr', attack, decay: 0, sustain: 1, release: Math.max(0, Math.min(0.03, dur - attack)) };
}

/** The ADSR's level (0 to 1) while the gate is open, `i` samples in. */
function opened(i: number, attack: number, decay: number, sustain: number): number {
  if (i < attack) return i / attack;
  if (i < attack + decay) return 1 - ((1 - sustain) * (i - attack)) / decay;
  return sustain;
}

/** `n` gains, one per sample at `rate`, for `env` at volume `vol`. */
export function envelopeCurve(env: Envelope, vol: number, n: number, rate: number): Float64Array {
  const gain = new Float64Array(n);
  const attack = Math.min(n, Math.round(env.attack * rate));
  if (env.kind === 'fall') {
    for (let i = 0; i < attack; i++) gain[i] = (vol * i) / attack;
    const length = n - attack;
    if (length > 0 && vol > 0) {
      const factor = Math.pow(FALL_FLOOR / vol, 1 / length);
      let g = vol;
      for (let i = attack; i < n; i++, g *= factor) gain[i] = g;
    }
    return gain;
  }
  const decay = Math.round(env.decay * rate);
  const close = Math.max(0, n - Math.round(env.release * rate));
  for (let i = 0; i < close; i++) gain[i] = vol * opened(i, attack, decay, env.sustain);
  const from = vol * opened(close, attack, decay, env.sustain);
  for (let i = close; i < n; i++) gain[i] = (from * (n - i)) / (n - close);
  return gain;
}
