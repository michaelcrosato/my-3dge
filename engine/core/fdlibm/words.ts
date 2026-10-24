/**
 * @file The two 32-bit words of a double, as fdlibm reads and writes them (PLAN.md §6.5, WP U-8): the high word holds
 * the sign, the exponent and the top 20 bits of the fraction, the low word the other 32. engine/core/fdlibm/'s ports
 * call these where the C code says GET_HIGH_WORD, GET_LOW_WORD, SET_HIGH_WORD, SET_LOW_WORD and INSERT_WORDS. One
 * Float64Array is viewed as two Uint32s; the platform is little-endian (x64), so the low word comes first.
 *
 * Invariants: every function writes the shared double before it reads it, so no call sees another's bits; `high`
 * gives the signed int32 the C code's `int32_t hx` holds, `low` the unsigned `u_int32_t lx`.
 *
 * @example
 * high(1); // 1072693248 (0x3ff00000)
 * low(1); // 0
 * fromWords(0x3ff00000, 0); // 1
 * withLow(Math.PI, 0) < Math.PI; // true: the low 32 bits of the fraction cleared
 */

/** The double the words are read from and written to. */
const DOUBLE = new Float64Array(1);
/** Its words: [low, high] on a little-endian machine. */
const WORDS = new Uint32Array(DOUBLE.buffer);

/** The high word of `x`, as a signed int32. */
export function high(x: number): number {
  DOUBLE[0] = x;
  return WORDS[1] | 0;
}

/** The low word of `x`, unsigned. */
export function low(x: number): number {
  DOUBLE[0] = x;
  return WORDS[0];
}

/** The double whose high word is `hi` and low word `lo` (INSERT_WORDS). */
export function fromWords(hi: number, lo: number): number {
  WORDS[1] = hi;
  WORDS[0] = lo;
  return DOUBLE[0];
}

/** `x` with its high word replaced by `hi` (SET_HIGH_WORD). */
export function withHigh(x: number, hi: number): number {
  DOUBLE[0] = x;
  WORDS[1] = hi;
  return DOUBLE[0];
}

/** `x` with its low word replaced by `lo` (SET_LOW_WORD). */
export function withLow(x: number, lo: number): number {
  DOUBLE[0] = x;
  WORDS[0] = lo;
  return DOUBLE[0];
}
