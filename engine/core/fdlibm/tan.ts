/**
 * @file The tangent in pure JavaScript, as V8 13.6 computes it (PLAN.md §6.5, WP U-8): ports of src/base/ieee754.cc's
 * tan and __kernel_tan, Sun's fdlibm 5.3 (the kernel of 2004), reducing through engine/core/fdlibm/remPio2.ts, so it
 * gives Node 24's native bits. The sim swaps it into `Math` while it steps (engine/core/simMath.ts): Chromium 153
 * computes it otherwise, and under the swap it agrees with Node bit for bit. stdlib's tan is FreeBSD's, whose kernel
 * gives other bits where the reduced argument is below 2^-28 next to a pole.
 *
 * Copyright 2004 Sun Microsystems, Inc. All Rights Reserved. Permission to use, copy, modify, and distribute this
 * software is freely granted, provided that this notice is preserved.
 *
 * Invariants: it returns what Node 24.22.1's `Math.tan` returns, bit for bit (engine/core/fdlibm/fdlibm.test.ts):
 * x = n·π/2 + r, and tan(x) is the kernel's odd polynomial of r for even n, −1/tan(r), computed with care, for odd n.
 *
 * @example
 * tan(Math.PI / 4); // 0.9999999999999999
 * tan(1e22); // -1.628778225606899
 */
import { remPio2 } from './remPio2';
import { high, low, withLow } from './words';

/** The kernel's coefficients: tan(x) ≈ x + T[0]·x³ + T[1]·x⁵ + … on [−π/4, π/4]. */
const T = [
  3.33333333333334091986e-1, // 0x3FD55555 55555563
  1.33333333333201242699e-1, // 0x3FC11111 1110FE7A
  5.39682539762260521377e-2, // 0x3FABA1BA 1BB341FE
  2.18694882948595424599e-2, // 0x3F9664F4 8406D637
  8.86323982359930005737e-3, // 0x3F8226E3 E96E8493
  3.59207910759131235356e-3, // 0x3F6D6D22 C9560328
  1.45620945432529025516e-3, // 0x3F57DBC8 FEE08315
  5.88041240820264096874e-4, // 0x3F4344D8 F2F26501
  2.46463134818469906812e-4, // 0x3F3026F7 1A8D1068
  7.817944429395570923e-5, // 0x3F147E88 A03792A6
  7.14072491382608190305e-5, // 0x3F12B80F 32F0A7E9
  -1.85586374855275456654e-5, // 0xBEF375CB DB605373
  2.59073051863633712884e-5, // 0x3EFB2A70 74BF7AD4
];
const PIO4 = 7.85398163397448278999e-1; // 0x3FE921FB 54442D18
const PIO4_LO = 3.06161699786838301793e-17; // 0x3C81A626 33145C07

/** −1/(x + y), with the division's error compensated: the odd-n branch of the kernel. */
function negativeReciprocal(x: number, y: number, w: number): number {
  const z = withLow(w, 0);
  const v = y - (z - x);
  const a = -1 / w;
  const t = withLow(a, 0);
  const s = 1 + t * z;
  return t + a * (s + t * v);
}

/** tan(x + y) for |x + y| ≤ π/4 (iy = 1), or −1/tan(x + y) (iy = −1): fdlibm's __kernel_tan. */
function kernelTan(x: number, y: number, iy: number): number {
  const hx = high(x);
  const ix = hx & 0x7fffffff;
  if (ix < 0x3e300000 && (x | 0) === 0) {
    if ((ix | low(x) | (iy + 1)) === 0) return 1 / Math.abs(x);
    return iy === 1 ? x : negativeReciprocal(x, y, x + y);
  }
  const big = ix >= 0x3fe59428;
  if (big) {
    if (hx < 0) {
      x = -x;
      y = -y;
    }
    x = PIO4 - x + (PIO4_LO - y);
    y = 0;
  }
  const z = x * x;
  const w = z * z;
  let r = T[1] + w * (T[3] + w * (T[5] + w * (T[7] + w * (T[9] + w * T[11]))));
  const v = z * (T[2] + w * (T[4] + w * (T[6] + w * (T[8] + w * (T[10] + w * T[12])))));
  const s = z * x;
  r = y + z * (s * (r + v) + y);
  r += T[0] * s;
  const sum = x + r;
  if (big) return (1 - ((hx >> 30) & 2)) * (iy - 2 * (x - ((sum * sum) / (sum + iy) - r)));
  return iy === 1 ? sum : negativeReciprocal(x, r, sum);
}

/** Where the reduction writes x mod π/2. */
const REDUCED = new Float64Array(2);

/** The tangent of `x` (radians), as V8's ieee754::tan computes it. */
export function tan(x: number): number {
  const ix = high(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelTan(x, 0, 1);
  if (ix >= 0x7ff00000) return x - x;
  const n = remPio2(x, REDUCED);
  return kernelTan(REDUCED[0], REDUCED[1], 1 - ((n & 1) << 1));
}
