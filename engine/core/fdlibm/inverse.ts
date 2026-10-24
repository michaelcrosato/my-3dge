/**
 * @file `asin`, `acos`, `atan` and `atan2` in pure JavaScript, as V8 13.6 computes them (PLAN.md §6.5, WP U-8): ports
 * of src/base/ieee754.cc, which carries Sun's fdlibm through FreeBSD's msun, so they give Node 24's native bits. The
 * sim swaps them into `Math` while it steps (engine/core/simMath.ts): Chromium 153 computes these functions otherwise,
 * and under the swap it agrees with Node bit for bit. stdlib's ports are Cephes', which give other bits.
 *
 * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved. Developed at SunSoft, a Sun Microsystems, Inc.
 * business. Permission to use, copy, modify, and distribute this software is freely granted, provided that this
 * notice is preserved.
 *
 * Invariants: each returns what Node 24.22.1's `Math` function of the same name returns, bit for bit
 * (engine/core/fdlibm/fdlibm.test.ts). `asin` and `acos` evaluate one rational approximation R(x²) for |x| < 0.5 and
 * R((1 − |x|)/2) beyond, with √ splitting near ±1; `atan` reduces |x| to one of five intervals around 0, 0.5, 1, 1.5
 * and ∞; `atan2` handles the signed zeros and infinities, then calls `atan(|y/x|)`.
 *
 * @example
 * asin(1); // 1.5707963267948966
 * acos(-1); // 3.141592653589793
 * atan(Infinity); // 1.5707963267948966
 * atan2(-0, -1); // -3.141592653589793
 */
import { high, low, withLow } from './words';

const PI = 3.141592653589793116; // 0x400921FB 54442D18
const PIO2_HI = 1.570796326794896558; // 0x3FF921FB 54442D18
const PIO2_LO = 6.12323399573676603587e-17; // 0x3C91A626 33145C07
const PIO4_HI = 7.85398163397448278999e-1; // 0x3FE921FB 54442D18
const PS0 = 1.66666666666666657415e-1; // 0x3FC55555 55555555
const PS1 = -3.25565818622400915405e-1; // 0xBFD4D612 03EB6F7D
const PS2 = 2.01212532134862925881e-1; // 0x3FC9C155 0E884455
const PS3 = -4.00555345006794114027e-2; // 0xBFA48228 B5688F3B
const PS4 = 7.91534994289814532176e-4; // 0x3F49EFE0 7501B288
const PS5 = 3.4793310759602116757e-5; // 0x3F023DE1 0DFDF709
const QS1 = -2.40339491173441421878; // 0xC0033A27 1C8A2D4B
const QS2 = 2.02094576023350569471; // 0x40002AE5 9C598AC8
const QS3 = -6.8828397160545329303e-1; // 0xBFE6066C 1B8D0159
const QS4 = 7.70381505559019352791e-2; // 0x3FB3B8C5 B12E9282

/** R(t) = p(t)/q(t), the rational approximation of (asin(√t) − √t)/√t that both functions share. */
function rational(t: number): number {
  const p = t * (PS0 + t * (PS1 + t * (PS2 + t * (PS3 + t * (PS4 + t * PS5)))));
  const q = 1 + t * (QS1 + t * (QS2 + t * (QS3 + t * QS4)));
  return p / q;
}

/** The arcsine of `x`, in [−π/2, π/2], as V8's ieee754::asin computes it. */
export function asin(x: number): number {
  const hx = high(x);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x3ff00000) {
    if (((ix - 0x3ff00000) | low(x)) === 0) return x * PIO2_HI + x * PIO2_LO;
    return NaN;
  }
  if (ix < 0x3fe00000) {
    if (ix < 0x3e400000) return x;
    return x + x * rational(x * x);
  }
  const t = (1 - Math.abs(x)) * 0.5;
  const s = Math.sqrt(t);
  let result: number;
  if (ix >= 0x3fef3333) {
    result = PIO2_HI - (2 * (s + s * rational(t)) - PIO2_LO);
  } else {
    const w = withLow(s, 0);
    const c = (t - w * w) / (s + w);
    const p = 2 * s * rational(t) - (PIO2_LO - 2 * c);
    const q = PIO4_HI - 2 * w;
    result = PIO4_HI - (p - q);
  }
  return hx > 0 ? result : -result;
}

/** The arccosine of `x`, in [0, π], as V8's ieee754::acos computes it. */
export function acos(x: number): number {
  const hx = high(x);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x3ff00000) {
    if (((ix - 0x3ff00000) | low(x)) === 0) return hx > 0 ? 0 : PI + 2 * PIO2_LO;
    return NaN;
  }
  if (ix < 0x3fe00000) {
    if (ix <= 0x3c600000) return PIO2_HI + PIO2_LO;
    return PIO2_HI - (x - (PIO2_LO - x * rational(x * x)));
  }
  if (hx < 0) {
    const z = (1 + x) * 0.5;
    const s = Math.sqrt(z);
    const w = rational(z) * s - PIO2_LO;
    return PI - 2 * (s + w);
  }
  const z = (1 - x) * 0.5;
  const s = Math.sqrt(z);
  const df = withLow(s, 0);
  const c = (z - df * df) / (s + df);
  const w = rational(z) * s + c;
  return 2 * (df + w);
}

/** atan(0.5), atan(1), atan(1.5) and atan(∞), each split into a high part and a low one. */
const ATAN_HI = [
  4.63647609000806093515e-1, // 0x3FDDAC67 0561BB4F
  7.85398163397448278999e-1, // 0x3FE921FB 54442D18
  9.82793723247329054082e-1, // 0x3FEF730B D281F69B
  1.570796326794896558, // 0x3FF921FB 54442D18
];
const ATAN_LO = [
  2.26987774529616870924e-17, // 0x3C7A2B7F 222F65E2
  3.06161699786838301793e-17, // 0x3C81A626 33145C07
  1.39033110312309984516e-17, // 0x3C700788 7AF0CBBD
  6.12323399573676603587e-17, // 0x3C91A626 33145C07
];
const AT = [
  3.33333333333329318027e-1, // 0x3FD55555 5555550D
  -1.99999999998764832476e-1, // 0xBFC99999 9998EBC4
  1.42857142725034663711e-1, // 0x3FC24924 920083FF
  -1.1111110405462355788e-1, // 0xBFBC71C6 FE231671
  9.09088713343650656196e-2, // 0x3FB745CD C54C206E
  -7.69187620504482999495e-2, // 0xBFB3B0F2 AF749A6D
  6.66107313738753120669e-2, // 0x3FB10D66 A0D03D51
  -5.83357013379057348645e-2, // 0xBFADDE2D 52DEFD9A
  4.97687799461593236017e-2, // 0x3FA97B4B 24760DEB
  -3.6531572744216915527e-2, // 0xBFA2B444 2C6A6C2F
  1.62858201153657823623e-2, // 0x3F90AD3A E322DA11
];

/** The arctangent of `x`, in [−π/2, π/2], as V8's ieee754::atan computes it. */
export function atan(x: number): number {
  const hx = high(x);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x44100000) {
    if (ix > 0x7ff00000 || (ix === 0x7ff00000 && low(x) !== 0)) return x + x;
    return hx > 0 ? ATAN_HI[3] + ATAN_LO[3] : -ATAN_HI[3] - ATAN_LO[3];
  }
  let id: number;
  if (ix < 0x3fdc0000) {
    if (ix < 0x3e400000) return x;
    id = -1;
  } else {
    x = Math.abs(x);
    if (ix < 0x3ff30000) {
      if (ix < 0x3fe60000) {
        id = 0;
        x = (2 * x - 1) / (2 + x);
      } else {
        id = 1;
        x = (x - 1) / (x + 1);
      }
    } else if (ix < 0x40038000) {
      id = 2;
      x = (x - 1.5) / (1 + 1.5 * x);
    } else {
      id = 3;
      x = -1 / x;
    }
  }
  const z = x * x;
  const w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) return x - x * (s1 + s2);
  const r = ATAN_HI[id] - (x * (s1 + s2) - ATAN_LO[id] - x);
  return hx < 0 ? -r : r;
}

const PI_O_4 = 7.85398163397448279e-1; // 0x3FE921FB 54442D18
const PI_O_2 = 1.570796326794896558; // 0x3FF921FB 54442D18
const PI_LO = 1.2246467991473531772e-16; // 0x3CA1A626 33145C07

/** The angle of the point (x, y) from the +x axis, in [−π, π], as V8's ieee754::atan2 computes it. */
export function atan2(y: number, x: number): number {
  if (x !== x || y !== y) return x + y;
  const hx = high(x);
  const lx = low(x);
  const ix = hx & 0x7fffffff;
  const hy = high(y);
  const ly = low(y);
  const iy = hy & 0x7fffffff;
  if (((hx - 0x3ff00000) | lx) === 0) return atan(y);
  let m = ((hy >> 31) & 1) | ((hx >> 30) & 2);
  if ((iy | ly) === 0) return m < 2 ? y : m === 2 ? PI : -PI;
  if ((ix | lx) === 0) return hy < 0 ? -PI_O_2 : PI_O_2;
  if (ix === 0x7ff00000) {
    if (iy === 0x7ff00000) return [PI_O_4, -PI_O_4, 3 * PI_O_4, -3 * PI_O_4][m];
    return [0, -0, PI, -PI][m];
  }
  if (iy === 0x7ff00000) return hy < 0 ? -PI_O_2 : PI_O_2;
  const k = (iy - ix) >> 20;
  let z: number;
  if (k > 60) {
    z = PI_O_2 + 0.5 * PI_LO;
    m &= 1;
  } else if (hx < 0 && k < -60) {
    z = 0;
  } else {
    z = atan(Math.abs(y / x));
  }
  if (m === 0) return z;
  if (m === 1) return -z;
  if (m === 2) return PI - (z - PI_LO);
  return z - PI_LO - PI;
}
