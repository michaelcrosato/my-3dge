/**
 * @file x mod π/2, as V8 13.6 reduces a trigonometric argument (PLAN.md §6.5, WP U-8): ports of src/base/ieee754.cc's
 * __ieee754_rem_pio2 and __kernel_rem_pio2, Sun's fdlibm 5.3. `remPio2(x, y)` returns n with x = n·π/2 + y[0] + y[1]
 * and |y[0] + y[1]| ≤ π/4: one subtraction of π/2 in two or three parts up to |x| ≈ 2^19·π/2, then the
 * multiple-precision product with 2/π's first 1,584 bits beyond. engine/core/fdlibm/tan.ts reduces with it. Its medium
 * path is fdlibm 5.3's, which V8 keeps: FreeBSD's later one, which stdlib ports, rounds the multiple otherwise near a
 * pole of tan.
 *
 * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved. Developed at SunSoft, a Sun Microsystems, Inc.
 * business. Permission to use, copy, modify, and distribute this software is freely granted, provided that this
 * notice is preserved.
 *
 * Invariants: y gets the same two doubles V8's reduction gives (engine/core/fdlibm/fdlibm.test.ts holds `tan`, which
 * reads them, to Node's bits); `TWO_OVER_PI` is 2/π in 24-bit chunks and the test recomputes it with BigInt.
 *
 * @example
 * const y = new Float64Array(2);
 * remPio2(Math.PI, y); // 2, with y[0] ≈ -1.2246e-16: the double π lies that far below π
 */
import { fromWords, high, low } from './words';

/** 2/π's first 1,584 bits, in 24-bit chunks (fdlibm's two_over_pi). */
export const TWO_OVER_PI = [
  0xa2f983, 0x6e4e44, 0x1529fc, 0x2757d1, 0xf534dd, 0xc0db62, 0x95993c, 0x439041, 0xfe5163, 0xabdebb, 0xc561b7,
  0x246e3a, 0x424dd2, 0xe00649, 0x2eea09, 0xd1921c, 0xfe1deb, 0x1cb129, 0xa73ee8, 0x8235f5, 0x2ebb44, 0x84e99c,
  0x7026b4, 0x5f7e41, 0x3991d6, 0x398353, 0x39f49c, 0x845f8b, 0xbdf928, 0x3b1ff8, 0x97ffde, 0x05980f, 0xef2f11,
  0x8b5a0a, 0x6d1f6d, 0x367ecf, 0x27cb09, 0xb74f46, 0x3f669e, 0x5fea2d, 0x7527ba, 0xc7ebe5, 0xf17b3d, 0x0739f7,
  0x8a5292, 0xea6bfb, 0x5fb11f, 0x8d5d08, 0x560330, 0x46fc7b, 0x6babf0, 0xcfbc20, 0x9af436, 0x1da9e3, 0x91615e,
  0xe61b08, 0x659985, 0x5f14a0, 0x68408d, 0xffd880, 0x4d7327, 0x310606, 0x1556ca, 0x73a8c9, 0x60e27b, 0xc08c6b,
];

/** The high words of n·π/2 for n = 1 … 32: a reduction near one of them takes the slower, longer path. */
export const NPIO2_HW = [
  0x3ff921fb, 0x400921fb, 0x4012d97c, 0x401921fb, 0x401f6a7a, 0x4022d97c, 0x4025fdbb, 0x402921fb, 0x402c463a,
  0x402f6a7a, 0x4031475c, 0x4032d97c, 0x40346b9c, 0x4035fdbb, 0x40378fdb, 0x403921fb, 0x403ab41b, 0x403c463a,
  0x403dd85a, 0x403f6a7a, 0x40407e4c, 0x4041475c, 0x4042106c, 0x4042d97c, 0x4043a28c, 0x40446b9c, 0x404534ac,
  0x4045fdbb, 0x4046c6cb, 0x40478fdb, 0x404858eb, 0x404921fb,
];

const TWO24 = 1.6777216e7; // 0x41700000 00000000
const TWON24 = 5.9604644775390625e-8; // 0x3E700000 00000000
const INV_PIO2 = 6.36619772367581382433e-1; // 0x3FE45F30 6DC9C883: 53 bits of 2/π
const PIO2_1 = 1.57079632673412561417; // 0x3FF921FB 54400000: π/2's first 33 bits
const PIO2_1T = 6.07710050650619224932e-11; // 0x3DD0B461 1A626331: π/2 − PIO2_1
const PIO2_2 = 6.0771005063039659766e-11; // 0x3DD0B461 1A600000: the next 33 bits
const PIO2_2T = 2.02226624879595063154e-21; // 0x3BA3198A 2E037073: π/2 − (PIO2_1 + PIO2_2)
const PIO2_3 = 2.0222662487111664558e-21; // 0x3BA3198A 2E000000: the next 33 bits
const PIO2_3T = 8.47842766036889956997e-32; // 0x397B839A 252049C1: π/2 − (PIO2_1 + PIO2_2 + PIO2_3)

/** π/2 in 24-bit pieces, for the large path's final product. */
const PIO2 = [
  1.57079625129699707031, // 0x3FF921FB 40000000
  7.54978941586159635335e-8, // 0x3E74442D 00000000
  5.39030252995776476554e-15, // 0x3CF84698 80000000
  3.28200341580791294123e-22, // 0x3B78CC51 60000000
  1.27065575308067607349e-29, // 0x39F01B83 80000000
  1.22933308981111328932e-36, // 0x387A2520 40000000
  2.73370053816464559624e-44, // 0x36E38222 80000000
  2.16741683877804819444e-51, // 0x3569F31D 00000000
];

/** 2^e for an integer e in the normal range (fdlibm's scalbn on 1). */
const pow2 = (e: number) => fromWords((0x3ff + e) << 20, 0);

/**
 * fdlibm's __kernel_rem_pio2 at double precision (prec 2): `x` holds |X|'s mantissa in nx 24-bit chunks scaled by
 * 2^e0, and y gets X mod π/2 as two doubles; returns the low three bits of the multiple.
 */
function kernelRemPio2(x: Float64Array, y: Float64Array, e0: number, nx: number): number {
  const jk = 4;
  const jp = jk;
  const jx = nx - 1;
  const jv = Math.max(0, ((e0 - 3) / 24) | 0);
  let q0 = e0 - 24 * (jv + 1);
  const f = new Float64Array(20);
  const q = new Float64Array(20);
  const fq = new Float64Array(20);
  const iq = new Int32Array(20);
  for (let i = 0, j = jv - jx; i <= jx + jk; i++, j++) f[i] = j < 0 ? 0 : TWO_OVER_PI[j];
  for (let i = 0; i <= jk; i++) {
    let fw = 0;
    for (let j = 0; j <= jx; j++) fw += x[j] * f[jx + i - j];
    q[i] = fw;
  }
  let jz = jk;
  let z: number;
  let n: number;
  let ih: number;
  for (;;) {
    z = q[jz];
    for (let i = 0, j = jz; j > 0; i++, j--) {
      const fw = (TWON24 * z) | 0;
      iq[i] = (z - TWO24 * fw) | 0;
      z = q[j - 1] + fw;
    }
    z *= pow2(q0);
    z -= 8 * Math.floor(z * 0.125);
    n = z | 0;
    z -= n;
    ih = 0;
    if (q0 > 0) {
      const i = iq[jz - 1] >> (24 - q0);
      n += i;
      iq[jz - 1] -= i << (24 - q0);
      ih = iq[jz - 1] >> (23 - q0);
    } else if (q0 === 0) {
      ih = iq[jz - 1] >> 23;
    } else if (z >= 0.5) {
      ih = 2;
    }
    if (ih > 0) {
      n += 1;
      let carry = 0;
      for (let i = 0; i < jz; i++) {
        const j = iq[i];
        if (carry !== 0) {
          iq[i] = 0xffffff - j;
        } else if (j !== 0) {
          carry = 1;
          iq[i] = 0x1000000 - j;
        }
      }
      if (q0 === 1) iq[jz - 1] &= 0x7fffff;
      else if (q0 === 2) iq[jz - 1] &= 0x3fffff;
      if (ih === 2) {
        z = 1 - z;
        if (carry !== 0) z -= pow2(q0);
      }
    }
    if (z !== 0) break;
    let j = 0;
    for (let i = jz - 1; i >= jk; i--) j |= iq[i];
    if (j !== 0) break;
    let k = 1;
    while (jk >= k && iq[jk - k] === 0) k++;
    for (let i = jz + 1; i <= jz + k; i++) {
      f[jx + i] = TWO_OVER_PI[jv + i];
      let fw = 0;
      for (let jj = 0; jj <= jx; jj++) fw += x[jj] * f[jx + i - jj];
      q[i] = fw;
    }
    jz += k;
  }
  if (z === 0) {
    jz -= 1;
    q0 -= 24;
    while (iq[jz] === 0) {
      jz--;
      q0 -= 24;
    }
  } else {
    z *= pow2(-q0);
    if (z >= TWO24) {
      const fw = (TWON24 * z) | 0;
      iq[jz] = z - TWO24 * fw;
      jz += 1;
      q0 += 24;
      iq[jz] = fw;
    } else {
      iq[jz] = z;
    }
  }
  let fw = pow2(q0);
  for (let i = jz; i >= 0; i--) {
    q[i] = fw * iq[i];
    fw *= TWON24;
  }
  for (let i = jz; i >= 0; i--) {
    let sum = 0;
    for (let k = 0; k <= jp && k <= jz - i; k++) sum += PIO2[k] * q[i + k];
    fq[jz - i] = sum;
  }
  let sum = 0;
  for (let i = jz; i >= 0; i--) sum += fq[i];
  y[0] = ih === 0 ? sum : -sum;
  sum = fq[0] - sum;
  for (let i = 1; i <= jz; i++) sum += fq[i];
  y[1] = ih === 0 ? sum : -sum;
  return n & 7;
}

/** Writes x − n·π/2 into y as two doubles (|y[0] + y[1]| ≤ π/4) and returns n, as V8's __ieee754_rem_pio2 does. */
export function remPio2(x: number, y: Float64Array): number {
  const hx = high(x);
  const ix = hx & 0x7fffffff;
  if (ix <= 0x3fe921fb) {
    y[0] = x;
    y[1] = 0;
    return 0;
  }
  if (ix < 0x4002d97c) {
    const sign = hx > 0 ? 1 : -1;
    let z = x - sign * PIO2_1;
    if (ix !== 0x3ff921fb) {
      y[0] = z - sign * PIO2_1T;
      y[1] = z - y[0] - sign * PIO2_1T;
    } else {
      z -= sign * PIO2_2;
      y[0] = z - sign * PIO2_2T;
      y[1] = z - y[0] - sign * PIO2_2T;
    }
    return sign;
  }
  if (ix <= 0x413921fb) {
    const t = Math.abs(x);
    const n = (t * INV_PIO2 + 0.5) | 0;
    let r = t - n * PIO2_1;
    let w = n * PIO2_1T;
    y[0] = r - w;
    if (n >= 32 || ix === NPIO2_HW[n - 1]) {
      const j = ix >> 20;
      let i = j - ((high(y[0]) >> 20) & 0x7ff);
      if (i > 16) {
        let t2 = r;
        w = n * PIO2_2;
        r = t2 - w;
        w = n * PIO2_2T - (t2 - r - w);
        y[0] = r - w;
        i = j - ((high(y[0]) >> 20) & 0x7ff);
        if (i > 49) {
          t2 = r;
          w = n * PIO2_3;
          r = t2 - w;
          w = n * PIO2_3T - (t2 - r - w);
          y[0] = r - w;
        }
      }
    }
    y[1] = r - y[0] - w;
    if (hx >= 0) return n;
    y[0] = -y[0];
    y[1] = -y[1];
    return -n;
  }
  if (ix >= 0x7ff00000) {
    y[0] = y[1] = x - x;
    return 0;
  }
  const e0 = (ix >> 20) - 1046;
  let z = fromWords(ix - (e0 << 20), low(x));
  const tx = new Float64Array(3);
  for (let i = 0; i < 2; i++) {
    tx[i] = z | 0;
    z = (z - tx[i]) * TWO24;
  }
  tx[2] = z;
  let nx = 3;
  while (tx[nx - 1] === 0) nx--;
  const n = kernelRemPio2(tx, y, e0, nx);
  if (hx >= 0) return n;
  y[0] = -y[0];
  y[1] = -y[1];
  return -n;
}
