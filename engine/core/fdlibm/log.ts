/**
 * @file `log`, `log1p`, `log2` and `log10` in pure JavaScript, as V8 13.6 computes them (PLAN.md §6.5, WP U-8): ports
 * of src/base/ieee754.cc, which carries FreeBSD's msun after Sun's fdlibm (`log10` the older fdlibm algorithm, through
 * `log`; `log2` FreeBSD's, through `kLog1p`), so they give Node 24's native bits. The sim swaps them into `Math` while
 * it steps (engine/core/simMath.ts): Chromium 153 computes these functions otherwise, and under the swap it agrees
 * with Node bit for bit.
 *
 * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved. Developed at SunSoft, a Sun Microsystems, Inc.
 * business. Permission to use, copy, modify, and distribute this software is freely granted, provided that this
 * notice is preserved.
 *
 * Invariants: each returns what Node 24.22.1's `Math` function of the same name returns, bit for bit
 * (engine/core/fdlibm/fdlibm.test.ts). x = 2^k·(1 + f) with √2/2 < 1 + f < √2, and log(1 + f) comes from a minimax
 * polynomial in s = f/(2 + f); subnormals are scaled by 2^54 first.
 *
 * @example
 * log(Math.E); // 1
 * log1p(-1); // -Infinity
 * log2(8); // 3
 * log10(1000); // 3
 */
import { fromWords, high, low, withHigh, withLow } from './words';

const LN2_HI = 6.9314718036912381649e-1; // 0x3FE62E42 FEE00000
const LN2_LO = 1.90821492927058770002e-10; // 0x3DEA39EF 35793C76
const TWO54 = 1.8014398509481984e16; // 0x43500000 00000000
const LG1 = 6.66666666666673513e-1; // 0x3FE55555 55555593
const LG2 = 3.999999999940941908e-1; // 0x3FD99999 9997FA04
const LG3 = 2.857142874366239149e-1; // 0x3FD24924 94229359
const LG4 = 2.222219843214978396e-1; // 0x3FCC71C5 1D8E78AF
const LG5 = 1.818357216161805012e-1; // 0x3FC74664 96CB03DE
const LG6 = 1.531383769920937332e-1; // 0x3FC39A09 D078C69F
const LG7 = 1.479819860511658591e-1; // 0x3FC2F112 DF3E5244

/** The natural logarithm of `x`, as V8's ieee754::log computes it. */
export function log(x: number): number {
  let hx = high(x);
  const lx = low(x);
  let k = 0;
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | lx) === 0) return -Infinity;
    if (hx < 0) return NaN;
    k -= 54;
    x *= TWO54;
    hx = high(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  let i = (hx + 0x95f64) & 0x100000;
  x = withHigh(x, hx | (i ^ 0x3ff00000));
  k += i >> 20;
  const f = x - 1;
  if ((0x000fffff & (2 + hx)) < 3) {
    if (f === 0) return k === 0 ? 0 : k * LN2_HI + k * LN2_LO;
    const r = f * f * (0.5 - 0.33333333333333333 * f);
    return k === 0 ? f - r : k * LN2_HI - (r - k * LN2_LO - f);
  }
  const s = f / (2 + f);
  const z = s * s;
  i = hx - 0x6147a;
  const w = z * z;
  const j = 0x6b851 - hx;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  i |= j;
  const r = t2 + t1;
  if (i > 0) {
    const hfsq = 0.5 * f * f;
    if (k === 0) return f - (hfsq - s * (hfsq + r));
    return k * LN2_HI - (hfsq - (s * (hfsq + r) + k * LN2_LO) - f);
  }
  if (k === 0) return f - s * (f - r);
  return k * LN2_HI - (s * (f - r) - k * LN2_LO - f);
}

/** ln(1 + x), accurate near 0, as V8's ieee754::log1p computes it. */
export function log1p(x: number): number {
  const hx = high(x);
  const ax = hx & 0x7fffffff;
  let k = 1;
  let f = 0;
  let c = 0;
  let hu = 0;
  if (hx < 0x3fda827a) {
    if (ax >= 0x3ff00000) return x === -1 ? -Infinity : NaN;
    if (ax < 0x3e200000) return ax < 0x3c900000 ? x : x - x * x * 0.5;
    if (hx > 0 || hx <= (0xbfd2bec4 | 0)) {
      k = 0;
      f = x;
      hu = 1;
    }
  }
  if (hx >= 0x7ff00000) return x + x;
  if (k !== 0) {
    let u: number;
    if (hx < 0x43400000) {
      u = 1 + x;
      hu = high(u);
      k = (hu >> 20) - 1023;
      c = k > 0 ? 1 - (u - x) : x - (u - 1);
      c /= u;
    } else {
      u = x;
      hu = high(u);
      k = (hu >> 20) - 1023;
      c = 0;
    }
    hu &= 0x000fffff;
    if (hu < 0x6a09e) {
      u = withHigh(u, hu | 0x3ff00000);
    } else {
      k += 1;
      u = withHigh(u, hu | 0x3fe00000);
      hu = (0x00100000 - hu) >> 2;
    }
    f = u - 1;
  }
  const hfsq = 0.5 * f * f;
  if (hu === 0) {
    if (f === 0) return k === 0 ? 0 : k * LN2_HI + (c + k * LN2_LO);
    const r = hfsq * (1 - 0.66666666666666666 * f);
    return k === 0 ? f - r : k * LN2_HI - (r - (k * LN2_LO + c) - f);
  }
  const s = f / (2 + f);
  const z = s * s;
  const r = z * (LG1 + z * (LG2 + z * (LG3 + z * (LG4 + z * (LG5 + z * (LG6 + z * LG7))))));
  if (k === 0) return f - (hfsq - s * (hfsq + r));
  return k * LN2_HI - (hfsq - (s * (hfsq + r) + (k * LN2_LO + c)) - f);
}

/** log(1 + f) − f + f²/2 for √2/2 − 1 ≤ f ≤ √2 − 1: FreeBSD's k_log1p, the common part of `log2`. */
function kLog1p(f: number): number {
  const s = f / (2 + f);
  const z = s * s;
  const w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  return s * (0.5 * f * f + (t2 + t1));
}

const IVLN2HI = 1.44269504072144627571; // 0x3FF71547 65200000
const IVLN2LO = 1.67517131648865118353e-10; // 0x3DE705FC 2EEFA200

/** The base-2 logarithm of `x`, as V8's ieee754::log2 computes it (exact at powers of two). */
export function log2(x: number): number {
  let hx = high(x);
  const lx = low(x);
  let k = 0;
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | lx) === 0) return -Infinity;
    if (hx < 0) return NaN;
    k -= 54;
    x *= TWO54;
    hx = high(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  if (hx === 0x3ff00000 && lx === 0) return 0;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  const i = (hx + 0x95f64) & 0x100000;
  x = withHigh(x, hx | (i ^ 0x3ff00000));
  k += i >> 20;
  const f = x - 1;
  const hfsq = 0.5 * f * f;
  const r = kLog1p(f);
  const hi = withLow(f - hfsq, 0);
  const lo = f - hi - hfsq + r;
  const valHi = hi * IVLN2HI;
  let valLo = (lo + hi) * IVLN2LO + lo * IVLN2HI;
  const w = k + valHi;
  valLo += k - w + valHi;
  return valLo + w;
}

const IVLN10 = 4.34294481903251816668e-1; // 0x3FDBCB7B 1526E50E
const LOG10_2HI = 3.01029995663611771306e-1; // 0x3FD34413 509F6000
const LOG10_2LO = 3.69423907715893078616e-13; // 0x3D59FEF3 11F12B36

/** The base-10 logarithm of `x`, as V8's ieee754::log10 computes it: n·log10(2) + log(x·2^-n)/ln(10). */
export function log10(x: number): number {
  let hx = high(x);
  let lx = low(x);
  let k = 0;
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | lx) === 0) return -Infinity;
    if (hx < 0) return NaN;
    k -= 54;
    x *= TWO54;
    hx = high(x);
    lx = low(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  if (hx === 0x3ff00000 && lx === 0) return 0;
  k += (hx >> 20) - 1023;
  const i = k < 0 ? 1 : 0;
  const y = k + i;
  const z = y * LOG10_2LO + IVLN10 * log(fromWords((hx & 0x000fffff) | ((0x3ff - i) << 20), lx));
  return z + y * LOG10_2HI;
}
