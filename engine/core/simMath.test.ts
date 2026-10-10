/**
 * @file Unit tests for engine/core/simMath.ts (T1), in Node: inside `withSimMath`, `Math.sin`, `cos` and `pow` are
 * stdlib's ports (three.js's math classes use them too); outside, `Math` holds what it held before, also after a
 * throw and after nested calls; a narrowed swap leaves the rest native; and the ports' results over 300,000 seeded
 * inputs hash to the recorded digest, so a stdlib update that changes a bit (and with it every replay golden) fails
 * here first. The swapped `pow` gives ECMAScript's results wherever the spec fixes them exactly (the drift probe's
 * edge pairs and more), and the right sign for negative bases with |y| ≥ 2^53. tests/e2e/drift.spec.ts proves that
 * Chromium gives the same bits.
 * @see engine/core/simMath.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DRIFT_FUNCTIONS, inputsOf, type DriftFunction } from '../../tests/pages/driftProbe';
import { Fnv64 } from './hash';
import { Euler, Quaternion } from './math';
import { Rng } from './rng';
import { inSimMath, SIM_MATH, SIM_MATH_NAMES, withSimMath } from './simMath';

const NATIVE = { sin: Math.sin, cos: Math.cos, pow: Math.pow };

afterEach(() => {
  vi.restoreAllMocks();
});

/** Asserts `Math` holds its native functions. */
function expectNative(): void {
  expect(Math.sin).toBe(NATIVE.sin);
  expect(Math.cos).toBe(NATIVE.cos);
  expect(Math.pow).toBe(NATIVE.pow);
  expect(inSimMath()).toBe(false);
}

describe('withSimMath', () => {
  it('puts the ports into Math while fn runs, returns its result, and the native functions back after', () => {
    expectNative();
    const result = withSimMath(() => {
      expect(Math.sin).toBe(SIM_MATH.sin.port);
      expect(Math.cos).toBe(SIM_MATH.cos.port);
      expect(Math.pow).toBe(SIM_MATH.pow.port);
      expect(inSimMath()).toBe(true);
      return Math.sin(1e6) + Math.cos(2) + Math.pow(1.1, 7.5);
    });
    expect(result).toBe(SIM_MATH.sin.port(1e6) + SIM_MATH.cos.port(2) + SIM_MATH.pow.port(1.1, 7.5));
    expectNative();
    expect(SIM_MATH.sin.native).toBe(NATIVE.sin);
  });

  it('restores the native functions after a throw, and lets the error through', () => {
    const boom = new Error('boom');
    expect(() =>
      withSimMath(() => {
        throw boom;
      }),
    ).toThrow(boom);
    expectNative();
    expect(() => withSimMath(() => withSimMath(() => JSON.parse('{')))).toThrow(SyntaxError);
    expectNative();
  });

  it('is safe nested: an inner call keeps the swap, and only the outermost restores', () => {
    withSimMath(() => {
      withSimMath(() => expect(Math.sin).toBe(SIM_MATH.sin.port));
      expect(Math.sin).toBe(SIM_MATH.sin.port);
      expect(() =>
        withSimMath(() => {
          throw new Error('inner');
        }),
      ).toThrow('inner');
      expect(Math.cos).toBe(SIM_MATH.cos.port);
      expect(inSimMath()).toBe(true);
    });
    expectNative();
  });

  it('restores whatever Math held when it started', () => {
    const spy = vi.spyOn(Math, 'sin');
    const held = Math.sin;
    withSimMath(() => expect(Math.sin).toBe(SIM_MATH.sin.port));
    expect(Math.sin).toBe(held);
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses an async fn with CORE_SIM_ASYNC, since the swap would end at its first await', () => {
    const pending = Promise.resolve(1);
    expect(() => withSimMath(() => pending)).toThrow(/^\[CORE_SIM_ASYNC\]/);
    expectNative();
    expect(() => withSimMath(() => withSimMath(async () => Math.sin(1)))).toThrow(/^\[CORE_SIM_ASYNC\]/);
    expectNative();
    expect(() => withSimMath(() => ({ then: 1 }))).not.toThrow();
  });

  it('swaps only the names it is given, as the drift fixture that leaves cos out does', () => {
    withSimMath(
      () => {
        expect(Math.sin).toBe(SIM_MATH.sin.port);
        expect(Math.cos).toBe(NATIVE.cos);
        expect(Math.pow).toBe(SIM_MATH.pow.port);
      },
      SIM_MATH_NAMES.filter((name) => name !== 'cos'),
    );
    expectNative();
  });

  it("reaches three.js's math classes, which call Math.sin and Math.cos at run time", () => {
    const euler = new Euler(0.3, -1.2, 2.9, 'YXZ');
    const swapped = withSimMath(() => new Quaternion().setFromEuler(euler));
    const { sin, cos } = { sin: SIM_MATH.sin.port, cos: SIM_MATH.cos.port };
    const [c1, c2, c3] = [cos(0.15), cos(-0.6), cos(1.45)];
    const [s1, s2, s3] = [sin(0.15), sin(-0.6), sin(1.45)];
    expect(swapped.toArray()).toEqual([
      s1 * c2 * c3 + c1 * s2 * s3,
      c1 * s2 * c3 - s1 * c2 * s3,
      c1 * c2 * s3 - s1 * s2 * c3,
      c1 * c2 * c3 + s1 * s2 * s3,
    ]);
  });
});

describe('the ports', () => {
  it('give the recorded digest over 300,000 seeded inputs (a changed bit changes every replay golden)', () => {
    const rng = new Rng(0x51e);
    const hash = new Fnv64();
    for (let i = 0; i < 100_000; i++) {
      const x = i % 2 ? rng.range(-20, 20) : rng.range(-1e5, 1e5);
      hash.number(SIM_MATH.sin.port(x)).number(SIM_MATH.cos.port(x));
      hash.number(SIM_MATH.pow.port(rng.range(0, 10), rng.range(-8, 8)));
    }
    expect(hash.hex()).toBe('b4ed1c0a7b2b310a');
  });

  it('are pure JavaScript, not the native functions', () => {
    for (const name of SIM_MATH_NAMES) {
      expect(SIM_MATH[name].port).not.toBe(SIM_MATH[name].native);
      expect(SIM_MATH[name].package).toBe(`@stdlib/math-base-special-${name}`);
    }
  });
});

/** `x` as text, `-0` included. */
const show = (x: number) => (Object.is(x, -0) ? '-0' : String(x));

/** True where ECMAScript's Number::exponentiate fixes `x ** y` exactly (its steps 1–12); elsewhere it approximates. */
const specExact = (x: number, y: number) =>
  [x, y].some((v) => v === 0 || !Number.isFinite(v)) || (x < 0 && !Number.isInteger(y));

describe('the swapped pow', () => {
  const port = SIM_MATH.pow.port;

  it("agrees with the native pow wherever ECMAScript defines the result exactly, on the drift probe's edge pairs", () => {
    const [xs, ys] = inputsOf(DRIFT_FUNCTIONS.find((fn) => fn.name === 'pow') as DriftFunction, 0);
    const pairs = [...xs].map((x, i) => [x, ys[i]]);
    for (const x of [0, -0, Infinity, -Infinity]) for (const y of [1e-310, -1e-310, 3, -3, 2 ** 60]) pairs.push([x, y]);
    const exact = pairs.filter(([x, y]) => specExact(x, y));
    expect(exact.length).toBeGreaterThan(120);
    const misses = exact
      .filter(([x, y]) => !Object.is(port(x, y), NATIVE.pow(x, y)))
      .map(([x, y]) => `pow(${show(x)}, ${show(y)}) = ${show(port(x, y))}, not ${show(NATIVE.pow(x, y))}`);
    expect(misses).toEqual([]);
  });

  it('gives negative bases the sign of an even power when |y| ≥ 2^53, where every double is an even integer', () => {
    expect(port(-1, 2 ** 60)).toBe(1);
    expect(port(-1, -(2 ** 53))).toBe(1);
    expect(port(-2, 2 ** 60)).toBe(Infinity);
    expect(port(-3, 2 ** 53 + 2)).toBe(Infinity);
    expect(Object.is(port(-2, -(2 ** 60)), 0)).toBe(true);
    expect(Object.is(port(-0.5, 2 ** 60), 0)).toBe(true);
    expect(port(-(1 + 2 ** -52), 2 ** 53)).toBe(port(1 + 2 ** -52, 2 ** 53));
    expect(port(-1, 2 ** 53 - 1)).toBe(-1); // the largest odd double keeps its sign
    expect(port(-2, 3)).toBe(-8);
  });
});
