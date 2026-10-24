/**
 * @file The cube root in pure JavaScript, as V8 13.6 computes it (PLAN.md §6.5, WP U-8): a port of
 * src/base/ieee754.cc's cbrt, FreeBSD's msun s_cbrt.c after Sun's fdlibm, so it gives Node 24's native bits. The sim
 * swaps it into `Math` while it steps (engine/core/simMath.ts): Chromium 153 computes it otherwise, and under the swap
 * it agrees with Node bit for bit.
 *
 * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved. Developed at SunPro, a Sun Microsystems, Inc.
 * business. Permission to use, copy, modify, and distribute this software is freely granted, provided that this
 * notice is preserved. Optimized by Bruce D. Evans.
 *
 * Invariants: it returns what Node 24.22.1's `Math.cbrt` returns, bit for bit (engine/core/fdlibm/fdlibm.test.ts): a
 * 5-bit guess from the exponent, a polynomial to 23 bits, rounding away from zero to 23 bits, then one Newton step.
 *
 * @example
 * cbrt(27); // 3
 * cbrt(-8); // -2
 */
import { fromWords, high, low } from './words';

/** (1023 − 1023/3 − 0.03306235651)·2^20 and the same less 54/3, for subnormals. */
const B1 = 715094163;
const B2 = 696219795;
const P0 = 1.87595182427177009643; // 0x3FFE03E6 0F61E692
const P1 = -1.88497979543377169875; // 0xBFFE28E0 92F02420
const P2 = 1.62142972010535446614; // 0x3FF9F160 4A49D6C2
const P3 = -7.58397934778766047437e-1; // 0xBFE844CB BEE751D9
const P4 = 1.45996192886612446982e-1; // 0x3FC2B000 D4E4EDD7

/** The real cube root of `x`, as V8's ieee754::cbrt computes it. */
export function cbrt(x: number): number {
  let hx = high(x);
  const lx = low(x);
  const sign = hx & 0x80000000;
  hx ^= sign;
  if (hx >= 0x7ff00000) return x + x;
  let t: number;
  if (hx < 0x00100000) {
    if ((hx | lx) === 0) return x;
    t = fromWords(0x43500000, 0) * x;
    t = fromWords((sign | ((((high(t) & 0x7fffffff) / 3) | 0) + B2)) >>> 0, 0);
  } else {
    t = fromWords((sign | (((hx / 3) | 0) + B1)) >>> 0, 0);
  }
  let r = t * t * (t / x);
  t = t * (P0 + r * (P1 + r * P2) + r * r * r * (P3 + r * P4));
  // round t away from zero to 23 bits: add 2^31 to its 64 bits, then clear the low 30
  const lo = low(t) + 0x80000000;
  t = fromWords((high(t) + (lo > 0xffffffff ? 1 : 0)) >>> 0, (lo >>> 0) & 0xc0000000);
  const s = t * t;
  r = x / s;
  const w = t + t;
  r = (r - t) / (w + r);
  return t + t * r;
}
