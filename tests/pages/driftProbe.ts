/**
 * @file The drift probe (PLAN.md §6.5, WP 1.1): every `Math` function, the `**` operator, three.js's math classes and
 * a small feedback sim, each run on seeded inputs natively and inside `withSimMath`, and hashed bit for bit. The
 * drift page (tests/pages/drift.ts) runs it in Chromium, tests/e2e/drift.spec.ts runs the same module in Node, and
 * `compareDrift` turns two results into findings, each naming the stdlib port that would cover a function.
 *
 * Invariants: the inputs come from engine/core/rng.ts and exact arithmetic only (powers of two built by doubling, no
 * `Math` function), so both runtimes feed identical bits; 200,000 inputs a function (pairs for two-argument ones),
 * plus edge values (±0, ±Infinity, NaN, subnormals, the largest doubles, multiples of π). `Math` functions are looked
 * up at call time, so inside `withSimMath` a swapped one is its port. Nothing here touches the DOM.
 *
 * @example
 * // browser
 * const page = runProbe({ inputs: 1000 }); // in the drift page; the spec compares it with Node's
 * @see tests/e2e/drift.spec.ts
 */
import { Fnv64 } from '../../engine/core/hash';
import { Euler, Matrix4, Quaternion, Vector3 } from '../../engine/core/math';
import { derive, Rng } from '../../engine/core/rng';
import { SIM_MATH_NAMES, withSimMath, type SimMathName } from '../../engine/core/simMath';

/** Seeded inputs per function, as PLAN.md WP 1.1 asks. */
export const DRIFT_INPUTS = 200_000;
/** The seed every input stream derives from. */
const SEED = 0xd21f7;

/** Exact powers of two, 2^-1074 … 2^1023, built by doubling and halving (never `Math.pow`). */
const POW2 = new Map<number, number>();
for (let e = 0, v = 1; e <= 1023; e++, v *= 2) POW2.set(e, v);
for (let e = -1, v = 0.5; e >= -1074; e--, v /= 2) POW2.set(e, v);

/** An input generator: one argument from a seeded stream. */
type Domain = (rng: Rng) => number;
const uniform =
  (a: number, b: number): Domain =>
  (rng) =>
    rng.range(a, b);
const integers =
  (a: number, b: number): Domain =>
  (rng) =>
    rng.int(a, b);
/** Magnitudes spread evenly over the binary exponents lo … hi, negative half the time when `signed`. */
const spread =
  (lo: number, hi: number, signed: boolean): Domain =>
  (rng) =>
    (signed && rng.chance(0.5) ? -1 : 1) * (1 + rng.next()) * (POW2.get(rng.int(lo, hi - 1)) as number);
/** One of `parts`' domains, chosen by weight. */
const mixed = (...parts: [number, Domain][]): Domain => {
  const total = parts.reduce((sum, [weight]) => sum + weight, 0);
  return (rng) => {
    let k = rng.next() * total;
    for (const [weight, domain] of parts) if ((k -= weight) < 0) return domain(rng);
    return parts[parts.length - 1][1](rng);
  };
};

const ANGLE = mixed([4, uniform(-6.3, 6.3)], [3, uniform(-1000, 1000)], [3, spread(-30, 40, true)]);
const REAL = mixed([1, uniform(-100, 100)], [1, spread(-40, 40, true)]);
const UNIT = mixed([9, uniform(-1, 1)], [1, uniform(-1.1, 1.1)]);
const EXP = mixed([7, uniform(-20, 20)], [3, uniform(-720, 720)]);
const POSITIVE = mixed([1, uniform(0, 100)], [1, spread(-60, 60, false)]);
const BASE = mixed([2, uniform(0, 10)], [1, spread(-20, 20, false)], [1, uniform(-10, 10)]);
const EXPONENT = mixed([3, uniform(-10, 10)], [1, integers(-12, 12)], [1, (rng) => rng.int(-20, 20) / 2]);
const INT32 = integers(-2147483648, 4294967295);

/** One probed function: its `Math` name (or the operator), its argument domains, and the port that would cover it. */
export interface DriftFunction {
  name: string;
  args: Domain[];
  /** The stdlib package with its pure-JavaScript port; `null` where ECMAScript defines the result exactly. */
  port: string | null;
  /** Called instead of `Math[name]`: the `**` operator, which no swap can reach. */
  call?: (a: number, b: number) => number;
}

const special = (name: string, args: Domain[], port = `@stdlib/math-base-special-${name}`): DriftFunction => ({
  name,
  args,
  port,
});
const exact = (name: string, args: Domain[]): DriftFunction => ({ name, args, port: null });

/** Every `Math` function but `random`, and the `**` operator. */
export const DRIFT_FUNCTIONS: readonly DriftFunction[] = [
  ...['sin', 'cos', 'tan'].map((name) => special(name, [ANGLE])),
  ...['asin', 'acos', 'atanh'].map((name) => special(name, [UNIT])),
  ...['atan', 'asinh', 'cbrt'].map((name) => special(name, [REAL])),
  ...['exp', 'expm1', 'sinh', 'cosh', 'tanh'].map((name) => special(name, [EXP])),
  ...['log2', 'log10', 'sqrt'].map((name) => special(name, [POSITIVE])),
  special('log', [POSITIVE], '@stdlib/math-base-special-ln'),
  special('log1p', [mixed([1, uniform(-1, 1)], [1, spread(-60, 60, false)])]),
  special('acosh', [(rng) => 1 + spread(-40, 20, false)(rng)]),
  special('atan2', [REAL, REAL]),
  special('hypot', [REAL, REAL]),
  special('pow', [BASE, EXPONENT]),
  { name: '**', args: [BASE, EXPONENT], port: '@stdlib/math-base-special-pow', call: (a, b) => a ** b },
  ...['abs', 'ceil', 'floor', 'round', 'trunc', 'sign', 'fround', 'f16round'].map((name) => exact(name, [REAL])),
  ...['min', 'max'].map((name) => exact(name, [REAL, REAL])),
  exact('clz32', [INT32]),
  exact('imul', [INT32, INT32]),
];

/** Edge values every function also gets (pairs of the first 13 for two-argument functions). */
const EDGES = [0, -0, 1, -1, NaN, Infinity, -Infinity, 0.5, 2, Math.PI, -Math.PI / 2, 5e-324, 1.7976931348623157e308];
const MORE_EDGES = [-5e-324, 2.2250738585072014e-308, -1.7976931348623157e308, Math.PI / 4, 1e-300, 1e300, 0.1, 10];

/** The arguments `fn` is probed with, one array per argument: `count` seeded tuples, then the edge values. */
export function inputsOf(fn: DriftFunction, count = DRIFT_INPUTS): Float64Array[] {
  const rng = new Rng(derive(SEED, fn.name));
  const edges =
    fn.args.length === 1 ? [...EDGES, ...MORE_EDGES].map((x) => [x]) : EDGES.flatMap((a) => EDGES.map((b) => [a, b]));
  const columns = fn.args.map(() => new Float64Array(count + edges.length));
  for (let i = 0; i < count; i++) fn.args.forEach((domain, a) => (columns[a][i] = domain(rng)));
  edges.forEach((tuple, i) => tuple.forEach((x, a) => (columns[a][count + i] = x)));
  return columns;
}

/** `fn`'s results on `inputs`, natively or inside `withSimMath` (narrowed to `swap`). */
export function resultsOf(
  fn: DriftFunction,
  inputs: Float64Array[],
  swapped: boolean,
  swap: readonly SimMathName[] = SIM_MATH_NAMES,
): Float64Array {
  const run = () => {
    const call: (...args: number[]) => number =
      fn.call ?? (Math as unknown as Record<string, (...args: number[]) => number>)[fn.name];
    const [xs, ys] = inputs;
    const out = new Float64Array(xs.length);
    if (ys) for (let i = 0; i < xs.length; i++) out[i] = call(xs[i], ys[i]);
    else for (let i = 0; i < xs.length; i++) out[i] = call(xs[i]);
    return out;
  };
  return swapped ? withSimMath(run, swap) : run();
}

const ORDERS = ['XYZ', 'YXZ', 'ZXY', 'ZYX', 'YZX', 'XZY'] as const;

/** three.js's math classes on 20,000 seeded rotations: Euler → Quaternion and Matrix4, slerp, axis-angle. */
function threeProbe(): string {
  const rng = new Rng(derive(SEED, 'three.js'));
  const hash = new Fnv64();
  const [euler, q, r, m, v, axis] = [new Euler(), new Quaternion(), new Quaternion(), new Matrix4(), new Vector3(), new Vector3()]; // prettier-ignore
  for (let i = 0; i < 20_000; i++) {
    euler.set(rng.range(-10, 10), rng.range(-10, 10), rng.range(-10, 10), ORDERS[i % 6]);
    q.setFromEuler(euler);
    m.makeRotationFromEuler(euler);
    axis.set(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).normalize();
    r.setFromAxisAngle(axis, rng.range(-100, 100)).slerp(q, rng.next());
    v.set(1, 2, 3).applyAxisAngle(axis, rng.range(-7, 7));
    hash.numbers(q.toArray()).numbers(r.toArray()).numbers(m.elements).numbers(v.toArray());
  }
  return hash.hex();
}

/** §4.7's feedback sim: 1,000 float64 phases fed back through sin, cos and pow for 600 steps. */
function feedbackSim(): string {
  const phases = Float64Array.from({ length: 1000 }, (_, i) => 0.1 + i * 0.001);
  for (let step = 0; step < 600; step++) {
    for (let i = 0; i < phases.length; i++) {
      const p = phases[i];
      phases[i] =
        p + 0.05 * Math.sin(p * 3.1 + i) + 0.03 * Math.cos(p * 1.7) * Math.pow(Math.abs(Math.sin(p)) + 0.5, 1.5);
    }
  }
  return new Fnv64().numbers(phases).hex();
}

/** Composite probes, by name: run natively and inside the swap like the functions. */
const COMPOSITES: Record<string, () => string> = { 'three.js': threeProbe, 'feedback sim': feedbackSim };

/** What one runtime gave. */
export interface ProbeResult {
  /** `Math`'s functions in this runtime, but `random`. */
  functions: string[];
  /** For each probed function and composite: the digest of its results natively and inside `withSimMath`. */
  hashes: Record<string, { native: string; swapped: string }>;
  /** True when `Math` held the same functions after the probe as before it. */
  restored: boolean;
}

/** Runs every probe natively and inside `withSimMath` (narrowed to `swap`), on `inputs` seeded inputs a function. */
export function runProbe({
  inputs = DRIFT_INPUTS,
  swap = SIM_MATH_NAMES,
}: { inputs?: number; swap?: readonly SimMathName[] } = {}): ProbeResult {
  const table = Math as unknown as Record<string, unknown>;
  const functions = Object.getOwnPropertyNames(Math).filter((k) => typeof table[k] === 'function' && k !== 'random');
  const before = functions.map((name) => table[name]);
  const hashes: ProbeResult['hashes'] = {};
  for (const fn of DRIFT_FUNCTIONS) {
    const args = inputsOf(fn, inputs);
    const digest = (swapped: boolean) => new Fnv64().numbers(resultsOf(fn, args, swapped, swap)).hex();
    hashes[fn.name] = { native: digest(false), swapped: digest(true) };
  }
  for (const [name, probe] of Object.entries(COMPOSITES))
    hashes[name] = { native: probe(), swapped: withSimMath(probe, swap) };
  return { functions, hashes, restored: functions.every((name, i) => table[name] === before[i]) };
}

/** Why a function or composite that differs between the runtimes breaks reproducibility, and what to do. */
function finding(name: string, swapped: boolean, node: string, page: string): string {
  const hashes = `(Node ${node}, Chromium ${page})`;
  const fn = DRIFT_FUNCTIONS.find((f) => f.name === name);
  if (!fn)
    return `${name} differs between Node and Chromium inside withSimMath ${hashes}: a Math function it calls differs there; see the other findings`;
  if (name === '**')
    return `the ** operator differs between Node and Chromium ${hashes}, and no swap can reach an operator: write Math.pow in sim-side code (its port is ${fn.port}) and ban ** there`;
  const subject = `Math.${name}`;
  if (swapped)
    return `${subject} differs between Node and Chromium inside withSimMath ${hashes}: its port, ${fn.port}, no longer gives the same bits in both; pin a release that does (PLAN.md §6.5)`;
  if (!fn.port)
    return `${subject} differs between Node and Chromium ${hashes}, though ECMAScript defines its result exactly: a runtime bug; report it upstream`;
  return `${subject} differs between Node and Chromium ${hashes} and withSimMath does not swap it: add its fdlibm port, ${fn.port}, to SIM_MATH in engine/core/simMath.ts and pin it in package.json (PLAN.md §6.5)`;
}

/**
 * Compares Node's result with Chromium's, given the swap both ran under: a swapped function or a composite must give
 * the same bits inside `withSimMath`, every other function natively; every `Math` function must be probed. Returns
 * one finding per failure (none: reproducible).
 */
export function compareDrift(
  node: ProbeResult,
  page: ProbeResult,
  swap: readonly SimMathName[] = SIM_MATH_NAMES,
): string[] {
  const findings: string[] = [];
  const probed = new Set(DRIFT_FUNCTIONS.map((fn) => fn.name));
  for (const name of new Set([...node.functions, ...page.functions])) {
    if (!probed.has(name))
      findings.push(
        `Math.${name} is not probed: add it to DRIFT_FUNCTIONS in tests/pages/driftProbe.ts, with its input domain and stdlib port`,
      );
    if (!node.functions.includes(name) || !page.functions.includes(name))
      findings.push(`Math.${name} exists in only one runtime (${node.functions.includes(name) ? 'Node' : 'Chromium'})`);
  }
  for (const [name, mine] of Object.entries(node.hashes)) {
    const theirs = page.hashes[name];
    const swapped = !probed.has(name) || swap.includes(name as SimMathName);
    const [a, b] = swapped ? [mine.swapped, theirs.swapped] : [mine.native, theirs.native];
    if (a !== b) findings.push(finding(name, swapped && probed.has(name), a, b));
  }
  if (!node.restored || !page.restored) findings.push('Math did not hold its own functions after withSimMath');
  return findings;
}

/** How two result arrays differ, bit for bit: the count of differing entries and the index of the first. */
export function bitDiff(a: Float64Array, b: Float64Array): { count: number; first: number } {
  const [x, y] = [
    new Uint32Array(a.buffer, a.byteOffset, a.length * 2),
    new Uint32Array(b.buffer, b.byteOffset, b.length * 2),
  ];
  let [count, first] = [a.length === b.length ? 0 : Math.abs(a.length - b.length), -1];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (x[2 * i] !== y[2 * i] || x[2 * i + 1] !== y[2 * i + 1]) {
      count++;
      if (first < 0) first = i;
    }
  }
  return { count, first };
}
