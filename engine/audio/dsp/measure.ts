/**
 * @file Numbers about rendered samples (PLAN.md WP 9.1, §8.5; doctrine: Verifiable without a display): peak, RMS,
 * DC offset and the amplitude of one frequency (Goertzel's algorithm), so tests and tools judge a sound by numbers
 * instead of by ear. The audio QA family and `x audio` (WP 9.4) build their metrics on these.
 *
 * Invariants: pure functions over `[from, to)` sample ranges (the whole buffer by default). `toneAmplitude` returns
 * the amplitude of a sinusoid at `freq` (1 for a full-scale sine whose frequency completes whole cycles in the
 * range), measured with a Hann window, so energy at frequencies a few bins away barely leaks in.
 *
 * @example
 * const tone = render({ wave: 'sine', freq: 441, dur: 1, attack: 0, hold: true, vol: 1, release: 0 });
 * toneAmplitude(tone, 441, 44100); // ≈ 1
 * peak(tone); // ≈ 1
 * @see engine/audio/dsp/measure.test.ts
 */

/** The largest absolute sample in `[from, to)`. */
export function peak(samples: ArrayLike<number>, from = 0, to = samples.length): number {
  let max = 0;
  for (let i = from; i < to; i++) max = Math.max(max, Math.abs(samples[i]));
  return max;
}

/** The root mean square of `[from, to)`. */
export function rms(samples: ArrayLike<number>, from = 0, to = samples.length): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return to > from ? Math.sqrt(sum / (to - from)) : 0;
}

/** The mean of `[from, to)`: the DC offset. */
export function dcOffset(samples: ArrayLike<number>, from = 0, to = samples.length): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i];
  return to > from ? sum / (to - from) : 0;
}

/** The amplitude of the sinusoid at `freq` Hz in `[from, to)` at `rate` samples per second (Goertzel, Hann window). */
export function toneAmplitude(
  samples: ArrayLike<number>,
  freq: number,
  rate: number,
  from = 0,
  to = samples.length,
): number {
  const n = to - from;
  if (n < 2) return 0;
  const w = (2 * Math.PI * freq) / rate;
  const coefficient = 2 * Math.cos(w);
  let [s1, s2, windowSum] = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    windowSum += hann;
    const s = samples[from + i] * hann + coefficient * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  const power = s1 * s1 + s2 * s2 - coefficient * s1 * s2;
  return (2 * Math.sqrt(Math.max(0, power))) / windowSum;
}
