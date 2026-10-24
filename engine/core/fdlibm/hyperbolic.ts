/**
 * @file The hyperbolic functions and their inverses in pure JavaScript, as V8 13.6 computes them (PLAN.md §6.5, WP
 * U-8): `sinh`, `cosh`, `tanh`, `asinh`, `acosh` and `atanh`, ports of src/base/ieee754.cc, which carries Sun's fdlibm
 * through FreeBSD's msun, built on this folder's `exp`, `expm1`, `log` and `log1p`, so they give Node 24's native
 * bits. The sim swaps them into `Math` while it steps (engine/core/simMath.ts): Chromium 153 computes these functions
 * otherwise, and under the swap it agrees with Node bit for bit. stdlib's sinh, cosh and tanh are Cephes', which give
 * other bits.
 *
 * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved. Developed at SunSoft, a Sun Microsystems, Inc.
 * business. Permission to use, copy, modify, and distribute this software is freely granted, provided that this
 * notice is preserved.
 *
 * Invariants: each returns what Node 24.22.1's `Math` function of the same name returns, bit for bit
 * (engine/core/fdlibm/fdlibm.test.ts); tiny arguments come back unchanged (cosh's as 1), and the overflow thresholds
 * are fdlibm's.
 *
 * @example
 * sinh(1); // 1.1752011936438014
 * cosh(1); // 1.5430806348152437
 * tanh(30); // 1
 * asinh(-0); // -0
 * acosh(1); // 0
 * atanh(0.5); // 0.5493061443340548
 */
import { exp, expm1 } from './exp';
import { log, log1p } from './log';
import { high, low, withHigh } from './words';

/** sinh and cosh overflow past this |x| (0x408633CE 8FB9F87D). */
const OVERFLOW = 710.4758600739439;
/** ln of the largest double, rounded down to an empty low word (0x40862E42 00000000). */
const LOG_MAXD = 709.7822265625;
const LN2 = 6.93147180559945286227e-1; // 0x3FE62E42 FEFA39EF

/** The hyperbolic sine of `x`, as V8's ieee754::sinh computes it. */
export function sinh(x: number): number {
  const h = x < 0 ? -0.5 : 0.5;
  const ax = Math.abs(x);
  if (ax < 22) {
    if (ax < 3.725290298461914e-9) return x;
    const t = expm1(ax);
    if (ax < 1) return h * (2 * t - (t * t) / (t + 1));
    return h * (t + t / (t + 1));
  }
  if (ax < LOG_MAXD) return h * exp(ax);
  if (ax <= OVERFLOW) {
    const w = exp(0.5 * ax);
    return h * w * w;
  }
  return x * 1e307;
}

/** The hyperbolic cosine of `x`, as V8's ieee754::cosh computes it. */
export function cosh(x: number): number {
  const ix = high(x) & 0x7fffffff;
  if (ix < 0x3fd62e43) {
    const t = expm1(Math.abs(x));
    const w = 1 + t;
    if (ix < 0x3c800000) return w;
    return 1 + (t * t) / (w + w);
  }
  if (ix < 0x40360000) {
    const t = exp(Math.abs(x));
    return 0.5 * t + 0.5 / t;
  }
  if (ix < 0x40862e42) return 0.5 * exp(Math.abs(x));
  if (Math.abs(x) <= OVERFLOW) {
    const w = exp(0.5 * Math.abs(x));
    return 0.5 * w * w;
  }
  if (ix >= 0x7ff00000) return x * x;
  return Infinity;
}

/** The hyperbolic tangent of `x`, as V8's ieee754::tanh computes it. */
export function tanh(x: number): number {
  const jx = high(x);
  const ix = jx & 0x7fffffff;
  if (ix >= 0x7ff00000) return jx >= 0 ? 1 / x + 1 : 1 / x - 1;
  let z: number;
  if (ix < 0x40360000) {
    if (ix < 0x3e300000) return x;
    if (ix >= 0x3ff00000) {
      const t = expm1(2 * Math.abs(x));
      z = 1 - 2 / (t + 2);
    } else {
      const t = expm1(-2 * Math.abs(x));
      z = -t / (t + 2);
    }
  } else {
    z = 1;
  }
  return jx >= 0 ? z : -z;
}

/** The inverse hyperbolic sine of `x`, as V8's ieee754::asinh computes it. */
export function asinh(x: number): number {
  const hx = high(x);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x7ff00000) return x + x;
  if (ix < 0x3e300000) return x;
  let w: number;
  if (ix > 0x41b00000) {
    w = log(Math.abs(x)) + LN2;
  } else if (ix > 0x40000000) {
    const t = Math.abs(x);
    w = log(2 * t + 1 / (Math.sqrt(x * x + 1) + t));
  } else {
    const t = x * x;
    w = log1p(Math.abs(x) + t / (1 + Math.sqrt(1 + t)));
  }
  return hx > 0 ? w : -w;
}

/** The inverse hyperbolic cosine of `x`, NaN below 1, as V8's ieee754::acosh computes it. */
export function acosh(x: number): number {
  const hx = high(x);
  if (hx < 0x3ff00000) return NaN;
  if (hx >= 0x41b00000) return hx >= 0x7ff00000 ? x + x : log(x) + LN2;
  if (((hx - 0x3ff00000) | low(x)) === 0) return 0;
  if (hx > 0x40000000) return log(2 * x - 1 / (x + Math.sqrt(x * x - 1)));
  const t = x - 1;
  return log1p(t + Math.sqrt(2 * t + t * t));
}

/** The inverse hyperbolic tangent of `x`, NaN beyond ±1, as V8's ieee754::atanh computes it. */
export function atanh(x: number): number {
  const hx = high(x);
  const ix = hx & 0x7fffffff;
  if ((ix | (low(x) !== 0 ? 1 : 0)) > 0x3ff00000) return NaN;
  if (ix === 0x3ff00000) return x > 0 ? Infinity : -Infinity;
  if (ix < 0x3e300000) return x;
  const ax = withHigh(x, ix);
  const t = ix < 0x3fe00000 ? 0.5 * log1p(ax + ax + ((ax + ax) * ax) / (1 - ax)) : 0.5 * log1p((ax + ax) / (1 - ax));
  return hx >= 0 ? t : -t;
}
