/**
 * @file The delay (echo) effect of the DSP core (PLAN.md WP 9.1): a feedback delay line, as a `DelayNode` looped
 * through a feedback `GainNode` and mixed back with the dry signal is in Web Audio.
 *
 * Invariants: `echo(dry, spec, rate)` is a pure function returning a new buffer: the dry samples plus `mix` times
 * the wet line, where the wet line repeats the dry signal every `time` seconds (rounded to whole samples, at least
 * one), each repeat `feedback` times the previous one. The buffer grows by the tail: whole repeats until a repeat's
 * gain (`mix × feedback^k`) falls below `ECHO_FLOOR`, at most `MAX_ECHOES`. Arithmetic only: the same bits in Node and
 * Chromium.
 *
 * @example
 * const wet = echo(new Float64Array([1]), { time: 0.001, feedback: 0.5, mix: 0.5 }, 1000);
 * [wet[0], wet[1], wet[2]]; // [1, 0.5, 0.25]
 * @see engine/audio/dsp/delay.test.ts
 */

/** A repeat quieter than this gain ends the tail. */
export const ECHO_FLOOR = 0.001;

/** The most repeats a tail holds. */
export const MAX_ECHOES = 64;

/** The echo's settings, all required here (engine/audio/dsp/voice.ts fills the defaults). */
export interface EchoSpec {
  /** Seconds between repeats. */
  time: number;
  /** Each repeat's gain relative to the previous one, from 0 to 0.95. */
  feedback: number;
  /** The first repeat's gain relative to the dry signal, from 0 to 1. */
  mix: number;
}

/** How many repeats `spec` keeps before they fall below `ECHO_FLOOR`. */
export function echoCount(spec: EchoSpec): number {
  let gain = spec.mix;
  let count = 1;
  while (count < MAX_ECHOES && gain * spec.feedback >= ECHO_FLOOR) {
    gain *= spec.feedback;
    count++;
  }
  return count;
}

/** The time between repeats in whole samples. */
export function echoSpacing(spec: EchoSpec, rate: number): number {
  return Math.max(1, Math.round(spec.time * rate));
}

/** `dry` with its echoes, lengthened by the tail. */
export function echo(dry: Float64Array, spec: EchoSpec, rate: number): Float64Array {
  const spacing = echoSpacing(spec, rate);
  const out = new Float64Array(dry.length + spacing * echoCount(spec));
  const wet = new Float64Array(out.length);
  for (let i = 0; i < out.length; i++) {
    const dryNow = i < dry.length ? dry[i] : 0;
    if (i >= spacing) {
      const back = i - spacing;
      wet[i] = (back < dry.length ? dry[back] : 0) + spec.feedback * wet[back];
    }
    out[i] = dryNow + spec.mix * wet[i];
  }
  return out;
}
