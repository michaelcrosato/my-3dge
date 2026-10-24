/**
 * @file Unit tests for engine/core/fdlibm/ (PLAN.md §6.5, WP U-8): every port gives Node 24.22.1's native bits, the
 * runtime the goldens were recorded on, on seeded inputs over each function's domains, on random bit patterns and on
 * the edge values; so swapping them into `Math` (engine/core/simMath.ts) changed no golden in Node, and Chromium,
 * running the same JavaScript, gives the same bits. The reduction's tables are recomputed from π with BigInt. A
 * wider run of the same comparison (millions of inputs a function) passed when the ports landed (WP U-8's ledger row).
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../rng';
import { cbrt } from './cbrt';
import { exp, expm1 } from './exp';
import { acosh, asinh, atanh, cosh, sinh, tanh } from './hyperbolic';
import { acos, asin, atan, atan2 } from './inverse';
import { log, log10, log1p, log2 } from './log';
import { NPIO2_HW, remPio2, TWO_OVER_PI } from './remPio2';
import { tan } from './tan';
import { fromWords, high } from './words';

type Fn = (...args: number[]) => number;
const PORTS: Record<string, Fn> = {
  ...{ exp, expm1, log, log1p, log2, log10, asin, acos, atan, atan2 },
  ...{ sinh, cosh, tanh, asinh, acosh, atanh, cbrt, tan },
};
const native = (name: string) => (Math as unknown as Record<string, Fn>)[name];

const rng = new Rng(0xfd1b);
const BITS = new Float64Array(1);
const WORDS = new Uint32Array(BITS.buffer);
/** Any double at all: two random words. */
const anyDouble = () => ((WORDS[0] = rng.int(0, 0xffffffff)), (WORDS[1] = rng.int(0, 0xffffffff)), BITS[0]);
/** 2^e for e in [−1074, 1023], exactly. */
const twoTo = (e: number) =>
  e >= -1022 ? fromWords((e + 1023) << 20, 0) : fromWords((e + 2045) << 20, 0) * fromWords(0x00100000, 0);
/** ±(1..2)·2^e for e in [lo, hi). */
const spread = (lo: number, hi: number) => () =>
  (rng.chance(0.5) ? -1 : 1) * (1 + rng.next()) * twoTo(rng.int(lo, hi - 1));
const uniform = (a: number, b: number) => () => rng.range(a, b);
const positive = (domain: () => number) => () => Math.abs(domain());
/** Within ±10⁻⁹ of an odd multiple of π/2, where tan is near a pole. */
const pole = () => (rng.int(-2000, 1999) + 0.5) * Math.PI + rng.range(-1e-9, 1e-9);

const DOMAINS: Record<string, (() => number)[]> = {
  exp: [uniform(-20, 20), uniform(-745, 710), spread(-1074, 10), uniform(1 - 1e-12, 1 + 1e-12)],
  expm1: [uniform(-40, 40), spread(-1074, 10), uniform(-1, 1)],
  log: [positive(spread(-1074, 1024)), uniform(1 - 1e-3, 1 + 1e-3), uniform(0, 4)],
  log1p: [uniform(-1, 1), spread(-1074, 1024), uniform(-1e-6, 1e-6)],
  log2: [positive(spread(-1074, 1024)), uniform(1 - 1e-3, 1 + 1e-3), uniform(0, 4)],
  log10: [positive(spread(-1074, 1024)), uniform(1 - 1e-3, 1 + 1e-3), uniform(0, 100)],
  asin: [uniform(-1, 1), spread(-1074, 0), uniform(0.99, 1.01), uniform(-1.01, -0.99)],
  acos: [uniform(-1, 1), spread(-1074, 0), uniform(0.99, 1.01), uniform(-1.01, -0.99)],
  atan: [uniform(-100, 100), spread(-1074, 1024), uniform(-3, 3)],
  sinh: [uniform(-30, 30), uniform(-712, 712), spread(-1074, 10)],
  cosh: [uniform(-30, 30), uniform(-712, 712), spread(-1074, 10)],
  tanh: [uniform(-25, 25), spread(-1074, 6)],
  asinh: [spread(-1074, 1024), uniform(-10, 10)],
  acosh: [() => 1 + Math.abs(spread(-60, 1024)()), uniform(1, 4)],
  atanh: [uniform(-1, 1), spread(-1074, 0), () => (rng.chance(0.5) ? -1 : 1) * (1 - Math.abs(spread(-53, -1)()))],
  cbrt: [spread(-1074, 1024), uniform(-100, 100)],
  tan: [uniform(-10, 10), spread(-1074, 1024), pole, uniform(-1e6, 1e6), spread(15, 60)],
};
/** atan2's argument domains, each against each. */
const PAIRS = [spread(-60, 60), anyDouble, uniform(-2, 2), spread(-1074, 1024)];
const EDGES = [0, -0, Infinity, -Infinity, NaN, 1, -1, 0.5, -0.5, 2, 5e-324, -5e-324, 2.2250738585072014e-308];
EDGES.push(1.7976931348623157e308, -1.7976931348623157e308, Math.PI, -Math.PI, Math.PI / 2, Math.PI / 4, 1e-300);
EDGES.push(1e300, 0.1, 10, 22, -22, 709.78, 710.4758600739439, 1e22);

/** Inputs where `port` and Node's native function give other bits (NaNs are all one), at most three. */
function differences(name: string, inputs: number[][]): string[] {
  const [port, own] = [PORTS[name], native(name)];
  const found: string[] = [];
  for (const args of inputs) {
    const [a, b] = [own(...args), port(...args)];
    if (!Object.is(a, b) && !(a !== a && b !== b) && found.length < 3) found.push(`${name}(${args}): ${a}, port ${b}`);
  }
  return found;
}

describe('the fdlibm ports', () => {
  for (const name of Object.keys(PORTS)) {
    it(`${name} gives Node's native bits on seeded inputs, random doubles and the edges`, () => {
      const unary = name !== 'atan2';
      const draws = unary
        ? [...DOMAINS[name], anyDouble].flatMap((domain) => Array.from({ length: 20_000 }, () => [domain()]))
        : Array.from({ length: 160_000 }, (_, i) => [PAIRS[i % 4](), PAIRS[(i >> 2) % 4]()]);
      const edges = unary ? EDGES.map((x) => [x]) : EDGES.flatMap((y) => EDGES.map((x) => [y, x]));
      expect(differences(name, [...draws, ...edges])).toEqual([]);
    });
  }
});

/** π·2^bits, rounded down, from Machin's formula π = 16·atan(1/5) − 4·atan(1/239) in fixed point. */
function piFixed(bits: number): bigint {
  const one = 1n << BigInt(bits + 32);
  const arctanInverse = (x: bigint) => {
    let [term, sum, k] = [one / x, one / x, 1n];
    for (let sign = -1n; term !== 0n; sign = -sign, k += 2n) {
      term /= x * x;
      sum += (sign * term) / (k + 2n);
    }
    return sum;
  };
  return (16n * arctanInverse(5n) - 4n * arctanInverse(239n)) >> 32n;
}

describe("the reduction's tables", () => {
  it("hold 2/π's first 1,584 bits in 24-bit chunks", () => {
    const bits = 24 * TWO_OVER_PI.length;
    const twoOverPi = (2n << BigInt(2 * bits + 64)) / piFixed(bits + 64); // ⌊2/π · 2^bits⌋
    const chunks = TWO_OVER_PI.map((_, i) => Number((twoOverPi >> BigInt(bits - 24 * (i + 1))) & 0xffffffn));
    expect(chunks).toEqual(TWO_OVER_PI);
  });

  it('hold the high words of n·π/2 for n = 1 … 32', () => {
    const pi = piFixed(120);
    const words = NPIO2_HW.map((_, i) => {
      const multiple = BigInt(i + 1) * pi; // n·π·2^120 = n·π/2 · 2^121
      const exponent = multiple.toString(2).length - 1 - 121; // ⌊log2(n·π/2)⌋
      const top = Number(multiple >> BigInt(exponent + 121 - 20)) & 0xfffff; // the 20 fraction bits after the 1
      return ((exponent + 1023) << 20) | top;
    });
    expect(words).toEqual(NPIO2_HW);
    expect(NPIO2_HW.map((_, i) => high((i + 1) * (Math.PI / 2)))).toEqual(NPIO2_HW);
  });

  it('reduce the double π to 2·π/2 and its distance from π, −1.2246e-16, in two parts', () => {
    const y = new Float64Array(2);
    expect(remPio2(Math.PI, y)).toBe(2);
    expect(y[0] + y[1]).toBe(-1.2246467991473532e-16);
    expect(remPio2(1e22, y)).toBe(remPio2(1e22, new Float64Array(2)));
  });
});
