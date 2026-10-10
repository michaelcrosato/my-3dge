/**
 * @file Biquad filters of the DSP core (PLAN.md WP 9.1): the eight types of Web Audio's `BiquadFilterNode` (lowpass,
 * highpass, bandpass, notch, allpass, peaking, lowshelf, highshelf), with the coefficients of Robert
 * Bristow-Johnson's Audio EQ Cookbook, which Web Audio's own formulas come from.
 *
 * Invariants: `q` is the cookbook's linear Q for every type that uses it (Web Audio reads a lowpass or highpass Q in
 * dB: its 1.1 dB, the source's default, is a linear Q of 1.135), and the shelves use slope 1 as Web Audio does;
 * `gain` is in dB (peaking and shelves only). The frequency is clamped to [10 Hz, 0.49 × rate], so a swept filter
 * stays stable. Direct form I, which stays smooth when the coefficients change every sample during a sweep; `set`
 * recomputes them only when a parameter changed. `Math.sin`, `Math.cos` and `Math.pow` are called by name, so the
 * render's `withSimMath` swap reaches them.
 *
 * @example
 * const lowpass = new Biquad('lowpass', 44100);
 * lowpass.set(1000, Math.SQRT1_2);
 * lowpass.process(1); // the first sample of its step response
 * @see engine/audio/dsp/biquad.test.ts
 */

/** The filter types, Web Audio's names. */
export const FILTER_TYPES = [
  'lowpass',
  'highpass',
  'bandpass',
  'notch',
  'allpass',
  'peaking',
  'lowshelf',
  'highshelf',
] as const;

/** One of the filter types. */
export type FilterType = (typeof FILTER_TYPES)[number];

/** A biquad filter with its state: `set` its parameters, then `process` one sample at a time. */
export class Biquad {
  /** The filter's type. */
  readonly type: FilterType;
  /** Samples per second. */
  readonly rate: number;
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  private last = [NaN, NaN, NaN];

  /** A filter of `type` at `rate`, passing everything through until `set` is called. */
  constructor(type: FilterType, rate: number) {
    this.type = type;
    this.rate = rate;
  }

  /** Sets the frequency (Hz), the linear Q and the gain (dB; peaking and shelves only). */
  set(freq: number, q: number, gain = 0): void {
    const last = this.last;
    if (last[0] === freq && last[1] === q && last[2] === gain) return;
    last[0] = freq;
    last[1] = q;
    last[2] = gain;
    const f = Math.min(Math.max(freq, 10), 0.49 * this.rate);
    const w = (2 * Math.PI * f) / this.rate;
    const cos = Math.cos(w);
    const sin = Math.sin(w);
    const shelf = this.type === 'lowshelf' || this.type === 'highshelf';
    const alpha = shelf ? sin * Math.SQRT1_2 : sin / (2 * q);
    const a = Math.pow(10, gain / 40);
    let [b0, b1, b2, a0, a1, a2] = [0, 0, 0, 1 + alpha, -2 * cos, 1 - alpha];
    switch (this.type) {
      case 'lowpass':
        [b0, b1, b2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
        break;
      case 'highpass':
        [b0, b1, b2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
        break;
      case 'bandpass':
        [b0, b1, b2] = [alpha, 0, -alpha];
        break;
      case 'notch':
        [b0, b1, b2] = [1, -2 * cos, 1];
        break;
      case 'allpass':
        [b0, b1, b2] = [1 - alpha, -2 * cos, 1 + alpha];
        break;
      case 'peaking':
        [b0, b1, b2] = [1 + alpha * a, -2 * cos, 1 - alpha * a];
        [a0, a2] = [1 + alpha / a, 1 - alpha / a];
        break;
      default: {
        const sign = this.type === 'lowshelf' ? 1 : -1;
        const root = 2 * Math.sqrt(a) * alpha;
        const [up, down] = [a + 1, a - 1];
        b0 = a * (up - sign * down * cos + root);
        b1 = 2 * sign * a * (down - sign * up * cos);
        b2 = a * (up - sign * down * cos - root);
        a0 = up + sign * down * cos + root;
        a1 = -2 * sign * (down + sign * up * cos);
        a2 = up + sign * down * cos - root;
      }
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  /** Filters one sample. */
  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}
