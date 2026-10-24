/**
 * @file `exp` and `expm1` in pure JavaScript, as V8 13.6 computes them (PLAN.md §6.5, WP U-8): ports of
 * src/base/ieee754.cc, which carries FreeBSD's msun after Sun's fdlibm, so they give Node 24's native bits. The sim
 * swaps them into `Math` while it steps (engine/core/simMath.ts): Chromium 153 computes these functions otherwise,
 * and under the swap it agrees with Node bit for bit.
 *
 * Copyright (C) 1993, 2004 by Sun Microsystems, Inc. All rights reserved. Developed at SunSoft, a Sun Microsystems,
 * Inc. business. Permission to use, copy, modify, and distribute this software is freely granted, provided that this
 * notice is preserved.
 *
 * Invariants: each returns what Node 24.22.1's `Math.exp` and `Math.expm1` return, bit for bit
 * (engine/core/fdlibm/fdlibm.test.ts): `exp` reduces x to r = x − k·ln2 with |r| ≤ ln2/2 and evaluates a rational
 * approximation of exp(r), and `exp(1)` is `Math.E`, as V8 special-cases it; `expm1` keeps the subtraction of 1
 * exact near 0.
 *
 * @example
 * exp(1) === Math.E; // true
 * exp(-1000); // 0
 * expm1(1e-10); // 1.00000000005e-10
 */
import { fromWords, high, low } from './words';

const HALF = [0.5, -0.5];
const O_THRESHOLD = 7.09782712893383973096e2; // 0x40862E42 FEFA39EF
const U_THRESHOLD = -7.4513321910194110842e2; // 0xC0874910 D52D3051
const LN2_HI = [6.9314718036912381649e-1, -6.9314718036912381649e-1]; // 0x3FE62E42 FEE00000
const LN2_LO = [1.90821492927058770002e-10, -1.90821492927058770002e-10]; // 0x3DEA39EF 35793C76
const INV_LN2 = 1.442695040888963387; // 0x3FF71547 652B82FE
const P1 = 1.66666666666666019037e-1; // 0x3FC55555 5555553E
const P2 = -2.77777777770155933842e-3; // 0xBF66C16C 16BEBD93
const P3 = 6.61375632143793436117e-5; // 0x3F11566A AF25DE2C
const P4 = -1.6533902205465251539e-6; // 0xBEBBBD41 C5D26BF1
const P5 = 4.13813679705723846039e-8; // 0x3E663769 72BEA4D0
/** e, which V8 returns for exp(1): the reduction below gets its last bit wrong. */
const E = 2.718281828459045;
/** 2^-1000 and 2^1023, for results near the ends of the range. */
const TWO_M1000 = 9.3326361850321887899e-302;
const TWO_1023 = 8.98846567431158e307;

/** e^x, as V8's ieee754::exp computes it. */
export function exp(x: number): number {
  let hx = high(x);
  const xsb = hx >>> 31;
  hx &= 0x7fffffff;
  if (hx >= 0x40862e42) {
    if (hx >= 0x7ff00000) {
      if (((hx & 0xfffff) | low(x)) !== 0) return x + x;
      return xsb === 0 ? x : 0;
    }
    if (x > O_THRESHOLD) return Infinity;
    if (x < U_THRESHOLD) return 0;
  }
  let hi = 0;
  let lo = 0;
  let k = 0;
  if (hx > 0x3fd62e42) {
    if (hx < 0x3ff0a2b2) {
      if (x === 1) return E;
      hi = x - LN2_HI[xsb];
      lo = LN2_LO[xsb];
      k = 1 - xsb - xsb;
    } else {
      k = (INV_LN2 * x + HALF[xsb]) | 0;
      hi = x - k * LN2_HI[0];
      lo = k * LN2_LO[0];
    }
    x = hi - lo;
  } else if (hx < 0x3e300000) {
    return 1 + x;
  }
  const t = x * x;
  const twopk = fromWords(0x3ff00000 + ((k >= -1021 ? k : k + 1000) << 20), 0);
  const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((x * c) / (c - 2) - x);
  const y = 1 - (lo - (x * c) / (2 - c) - hi);
  if (k >= -1021) return k === 1024 ? y * 2 * TWO_1023 : y * twopk;
  return y * twopk * TWO_M1000;
}

const Q1 = -3.33333333333331316428e-2; // 0xBFA11111 111110F4
const Q2 = 1.58730158725481460165e-3; // 0x3F5A01A0 19FE5585
const Q3 = -7.93650757867487942473e-5; // 0xBF14CE19 9EAADBB7
const Q4 = 4.00821782732936239552e-6; // 0x3ED0CFCA 86E65239
const Q5 = -2.01099218183624371326e-7; // 0xBE8AFDB7 6E09C32D

/** e^x − 1, accurate near 0, as V8's ieee754::expm1 computes it. */
export function expm1(x: number): number {
  let hx = high(x);
  const negative = hx < 0;
  hx &= 0x7fffffff;
  if (hx >= 0x4043687a) {
    if (hx >= 0x40862e42) {
      if (hx >= 0x7ff00000) {
        if (((hx & 0xfffff) | low(x)) !== 0) return x + x;
        return negative ? -1 : x;
      }
      if (x > O_THRESHOLD) return Infinity;
    }
    if (negative) return -1;
  }
  let k = 0;
  let c = 0;
  if (hx > 0x3fd62e42) {
    let hi: number;
    let lo: number;
    if (hx < 0x3ff0a2b2) {
      k = negative ? -1 : 1;
      hi = x - k * LN2_HI[0];
      lo = k * LN2_LO[0];
    } else {
      k = (INV_LN2 * x + (negative ? -0.5 : 0.5)) | 0;
      hi = x - k * LN2_HI[0];
      lo = k * LN2_LO[0];
    }
    x = hi - lo;
    c = hi - x - lo;
  } else if (hx < 0x3c900000) {
    return x;
  }
  const hfx = 0.5 * x;
  const hxs = x * hfx;
  const r1 = 1 + hxs * (Q1 + hxs * (Q2 + hxs * (Q3 + hxs * (Q4 + hxs * Q5))));
  const t = 3 - r1 * hfx;
  let e = hxs * ((r1 - t) / (6 - x * t));
  if (k === 0) return x - (x * e - hxs);
  const twopk = fromWords(0x3ff00000 + (k << 20), 0);
  e = x * (e - c) - c;
  e -= hxs;
  if (k === -1) return 0.5 * (x - e) - 0.5;
  if (k === 1) return x < -0.25 ? -2 * (e - (x + 0.5)) : 1 + 2 * (x - e);
  if (k <= -2 || k > 56) {
    const y = 1 - (e - x);
    return (k === 1024 ? y * 2 * TWO_1023 : y * twopk) - 1;
  }
  if (k < 20) return (fromWords(0x3ff00000 - (0x200000 >> k), 0) - (e - x)) * twopk;
  return (x - (e + fromWords((0x3ff - k) << 20, 0)) + 1) * twopk;
}
