/**
 * @file The Karplus–Strong pluck of the DSP core (PLAN.md WP 9.1): a burst of seeded noise circulating in a delay
 * line whose loop averages neighbouring samples, so it rings like a plucked string and darkens as it decays. The
 * extended form of Jaffe and Smith: a first-order allpass tunes the loop's fractional delay, so the pitch is right
 * to well under a cent instead of jumping between whole-sample periods.
 *
 * Invariants: the loop delay is rate / freq samples: the whole-sample line, plus half a sample for the two-point
 * average, plus the allpass's fraction in [0.1, 1.1). `decay` scales the loop once a period (1 rings forever, 0.99
 * fades over a few hundred periods); `brightness` low-passes the burst (1: white noise, lower: darker). The burst is
 * drawn from the `Rng` handed in and has no DC. The pitch is fixed: the line is at least two samples long, so the
 * highest playable pitch is about rate / 3. Arithmetic only: the same bits in Node and Chromium.
 *
 * @example
 * const string = new Pluck(220, 44100, new Rng(1));
 * const first = string.next(); // the first sample of the burst
 * @see engine/audio/dsp/pluck.test.ts
 */
import type { Rng } from '../../core/rng';

/** A plucked string: `next()` gives one sample at a time. */
export class Pluck {
  private readonly line: Float64Array;
  private readonly coefficient: number;
  private readonly decay: number;
  private index = 0;
  private previous = 0;
  private allpassIn = 0;
  private allpassOut = 0;

  /** A string tuned to `freq` Hz at `rate`, its burst drawn from `rng`; `decay` and `brightness` are in (0, 1]. */
  constructor(freq: number, rate: number, rng: Rng, decay = 0.996, brightness = 1) {
    const period = Math.max(rate / freq, 2.6) - 0.5;
    const length = Math.floor(period - 0.1);
    const fraction = period - length;
    this.coefficient = (1 - fraction) / (1 + fraction);
    this.decay = decay;
    this.line = new Float64Array(length);
    let y = 0;
    let sum = 0;
    for (let i = 0; i < length; i++) {
      y += brightness * (rng.next() * 2 - 1 - y);
      this.line[i] = y;
      sum += y;
    }
    const mean = sum / length;
    for (let i = 0; i < length; i++) this.line[i] -= mean;
  }

  /** The next sample. */
  next(): number {
    const x = this.line[this.index];
    const average = 0.5 * this.decay * (x + this.previous);
    const tuned = this.coefficient * average + this.allpassIn - this.coefficient * this.allpassOut;
    this.allpassIn = average;
    this.allpassOut = tuned;
    this.previous = x;
    this.line[this.index] = tuned;
    this.index = this.index + 1 === this.line.length ? 0 : this.index + 1;
    return x;
  }
}
