/**
 * @file Deterministic `Math` while the sim runs (PLAN.md §6.5; doctrines: Reproducible, Quality under the hood):
 * `withSimMath(fn)` swaps pure-JavaScript ports into `Math` while `fn` runs and puts the native functions back
 * afterwards. V8's own `Math.sin` and `Math.cos` differ by 1 ulp between Node and Chromium on the platform, and `pow`
 * between Node releases (§4.7): stdlib's fdlibm ports replace those three. Since Chromium 153 (WP U-8), 18 more differ:
 * its V8 computes `tan`, the inverse and hyperbolic functions, `exp`, `expm1`, the logarithms and `cbrt` otherwise
 * than Node 24's, which carries fdlibm (src/base/ieee754.cc); engine/core/fdlibm/ ports V8's own code, which gives
 * Node's native bits, so the goldens recorded in Node held. Float64 state fed back through any of them drifts apart
 * within a few hundred steps; under the swap both runtimes give the same bits, and one golden hash per replay holds in
 * both. Game code never sees this module: it writes `Math.sin`, and the sim's entry points (`setup`, `step`, spawns,
 * captures, restores; WP 1.4) run inside the swap, three.js's math classes included.
 *
 * Invariants: the swap covers exactly the functions in `SIM_MATH`, the ones that differ between the platform's
 * runtimes. tests/e2e/drift.spec.ts compares every `Math` function between Node and Chromium on 200,000 inputs each;
 * when a runtime update makes another one differ, a port that gives the goldens' bits joins `SIM_MATH` (the spec names
 * where one comes from).
 * Nested calls are safe: only the outermost swaps and restores, and the functions it restores are the ones `Math`
 * held when it started, also after a throw. `fn` must be synchronous: an `await` inside would leave the swap, so a
 * `fn` that returns a promise is refused with `CORE_SIM_ASYNC`. The swapped `pow` gives ECMAScript's exact results
 * wherever the spec fixes them (NaN, ±0 and ±Infinity arguments), as every runtime's native `pow` does.
 *
 * Measured cost (§4.7): about 14 ns more per `sin` call, inside the sim only; rendering keeps native speed. The
 * swap writes 21 properties of `Math` on entry and on exit, once per outermost call.
 *
 * @example
 * const port = withSimMath(() => Math.sin(1e6)); // stdlib's fdlibm sin, the same bits in Node and Chromium
 * Math.sin === SIM_MATH.sin.native; // true again outside
 * @see engine/core/simMath.test.ts
 * @see tests/e2e/drift.spec.ts
 */
import cos from '@stdlib/math-base-special-cos';
import stdlibPow from '@stdlib/math-base-special-pow';
import sin from '@stdlib/math-base-special-sin';
import { cbrt } from './fdlibm/cbrt';
import { exp, expm1 } from './fdlibm/exp';
import { acosh, asinh, atanh, cosh, sinh, tanh } from './fdlibm/hyperbolic';
import { acos, asin, atan, atan2 } from './fdlibm/inverse';
import { log, log10, log1p, log2 } from './fdlibm/log';
import { tan } from './fdlibm/tan';
import { defineCodes } from './log';

/** The codes this module raises, with their fixes (collected into docs/ERRORS.md by `x docs`). */
export const SIM_MATH_CODES = defineCodes('core', {
  CORE_SIM_ASYNC: {
    template: 'withSimMath ran a function that returned a promise',
    fix: 'keep sim entry points synchronous: the fdlibm swap ends when withSimMath returns, so code after an await would run on the native Math; do the async work outside the sim and pass its result in as an intent',
    doc: 'Raised by withSimMath (engine/core/simMath.ts) when its function returns a promise or another thenable: only the part before the first await would run under the swap, and replays would drift between Node and Chromium.',
  },
});

/** `Math.pow` as this module found it; ECMAScript fixes its results on NaN, ±0 and ±Infinity exactly. */
// eslint-disable-next-line sim/no-restricted-syntax -- the swap's own hold on the native function, on purpose
const nativePow = Math.pow;
/** 2^53: every double of at least this magnitude is an even integer. */
const TWO_53 = 9007199254740992;

/**
 * stdlib's fdlibm `pow` with ECMAScript's special values. Where an argument is NaN, ±0 or ±Infinity, the spec
 * (Number::exponentiate, steps 1–11) defines the result exactly, so the native function gives the same bits in every
 * runtime; stdlib's differs there (it gives NaN for `pow(NaN, 0)`, -0 for `pow(-0, 0.5)`, 1 for `pow(1, Infinity)`).
 * A negative base with |y| ≥ 2^53 takes an even power, which stdlib's odd test gets wrong, so it is `pow(-x, y)`.
 */
function pow(x: number, y: number): number {
  if (x === 0 || y === 0 || !Number.isFinite(x) || !Number.isFinite(y)) return nativePow(x, y);
  return x < 0 && (y >= TWO_53 || y <= -TWO_53) ? stdlibPow(-x, y) : stdlibPow(x, y);
}

/** A `Math` function the sim swaps: its pure-JavaScript port, where the port comes from, and the native one. */
export interface SimMathEntry {
  /**
   * What the swap puts into `Math`: an fdlibm port in pure JavaScript, so it gives the same bits in Node and Chromium
   * (for `pow`, wrapped to give ECMAScript's exact results on NaN, ±0 and ±Infinity).
   */
  port: (...args: number[]) => number;
  /**
   * Where the port comes from: its stdlib package, as package.json pins it (`sin`, `cos`, `pow`), or its module in
   * engine/core/fdlibm/, a port of V8's own code that gives Node 24's native bits.
   */
  source: string;
  /** `Math`'s own function, as it was when this module loaded. */
  native: (...args: number[]) => number;
}

/** The names of the swapped `Math` functions. */
export type SimMathName = 'sin' | 'cos' | 'pow' | (typeof FDLIBM_NAMES)[number];

/** The functions engine/core/fdlibm/ ports, each by its file (WP U-8), in `SIM_MATH`'s order. */
const FDLIBM_NAMES = [
  ...['tan', 'asin', 'acos', 'atan', 'atan2'],
  ...['exp', 'expm1', 'log', 'log1p', 'log2', 'log10', 'cbrt'],
  ...['sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh'],
] as const;
const FDLIBM: Record<(typeof FDLIBM_NAMES)[number], [(...args: number[]) => number, string]> = {
  tan: [tan, 'tan'],
  ...{ asin: [asin, 'inverse'], acos: [acos, 'inverse'], atan: [atan, 'inverse'], atan2: [atan2, 'inverse'] },
  ...{ exp: [exp, 'exp'], expm1: [expm1, 'exp'], cbrt: [cbrt, 'cbrt'] },
  ...{ log: [log, 'log'], log1p: [log1p, 'log'], log2: [log2, 'log'], log10: [log10, 'log'] },
  ...{ sinh: [sinh, 'hyperbolic'], cosh: [cosh, 'hyperbolic'], tanh: [tanh, 'hyperbolic'] },
  ...{ asinh: [asinh, 'hyperbolic'], acosh: [acosh, 'hyperbolic'], atanh: [atanh, 'hyperbolic'] },
};

/** `Math` as a table of functions. */
const table = Math as unknown as Record<string, (...args: number[]) => number>;

/** What the swap puts into `Math`, by function name (PLAN.md §6.5): the functions that differ between runtimes. */
export const SIM_MATH: Readonly<Record<SimMathName, SimMathEntry>> = {
  sin: { port: sin, source: '@stdlib/math-base-special-sin', native: Math.sin },
  cos: { port: cos, source: '@stdlib/math-base-special-cos', native: Math.cos },
  pow: { port: pow, source: '@stdlib/math-base-special-pow', native: Math.pow },
  ...(Object.fromEntries(
    FDLIBM_NAMES.map((name) => {
      const [port, file] = FDLIBM[name];
      return [name, { port, source: `engine/core/fdlibm/${file}.ts`, native: table[name] }];
    }),
  ) as Record<(typeof FDLIBM_NAMES)[number], SimMathEntry>),
};

/** Every swapped name, in `SIM_MATH`'s order. */
export const SIM_MATH_NAMES = Object.keys(SIM_MATH) as SimMathName[];

/** `result`, unless it is a promise or another thenable (`CORE_SIM_ASYNC`): the swap would end at fn's first await. */
function settled<T>(result: T): T {
  if (typeof (result as { then?: unknown } | null | undefined)?.then !== 'function') return result;
  const { template, fix } = SIM_MATH_CODES.CORE_SIM_ASYNC;
  throw new TypeError(`[CORE_SIM_ASYNC] ${template}: ${fix}`);
}

/** How many `withSimMath` calls are running (0 outside the sim). */
let depth = 0;

/** True while a `withSimMath` call is running. */
export function inSimMath(): boolean {
  return depth > 0;
}

/**
 * Runs `fn` with the fdlibm ports in `Math` and returns its result; the previous functions are back afterwards,
 * whether `fn` returns or throws; a `fn` that returns a promise throws `CORE_SIM_ASYNC`. `names` narrows the swap
 * (all of `SIM_MATH` by default): the drift test's fixture leaves one out to prove the test notices. An inner call
 * runs inside the outer swap as it is.
 */
export function withSimMath<T>(fn: () => T, names: readonly SimMathName[] = SIM_MATH_NAMES): T {
  if (depth > 0) {
    depth++;
    try {
      return settled(fn());
    } finally {
      depth--;
    }
  }
  const saved = names.map((name) => table[name]);
  names.forEach((name) => (table[name] = SIM_MATH[name].port));
  depth = 1;
  try {
    return settled(fn());
  } finally {
    depth = 0;
    names.forEach((name, i) => (table[name] = saved[i]));
  }
}
