/**
 * @file The drift page's module (`tests/pages/drift.html`), Chromium's half of tests/e2e/drift.spec.ts: it publishes
 * the drift probe (tests/pages/driftProbe.ts) and `withSimMath` as `window.__drift`, then signals ready through
 * `window.__engine`. It draws nothing and runs nothing until the spec calls it.
 *
 * Invariants: `__drift.results` returns raw results as base64 of their float64 bytes, so the spec compares them with
 * Node's bit for bit; everything else returns plain JSON.
 */
import { SIM_MATH, SIM_MATH_NAMES, withSimMath, type SimMathName } from '../../engine/core/simMath';
import { DRIFT_FUNCTIONS, inputsOf, resultsOf, runProbe } from './driftProbe';

/** Base64 of an array's bytes, in chunks small enough for `String.fromCharCode`. */
function base64(values: Float64Array): string {
  const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/** What the page offers the spec. */
const drift = {
  runProbe,
  withSimMath,
  /** The swapped names and, for each, whether `Math` holds its native function or its port right now. */
  state: () =>
    Object.fromEntries(
      SIM_MATH_NAMES.map((name) => {
        const held = (Math as unknown as Record<string, unknown>)[name];
        return [name, held === SIM_MATH[name].native ? 'native' : held === SIM_MATH[name].port ? 'port' : 'other'];
      }),
    ),
  /** One function's raw results on `inputs` seeded inputs, natively or inside the swap, as base64 float64 bytes. */
  results: (name: string, swapped: boolean, inputs: number, swap: SimMathName[] = SIM_MATH_NAMES) => {
    const fn = DRIFT_FUNCTIONS.find((f) => f.name === name);
    if (!fn) throw new Error(`no probed function ${name}`);
    return base64(resultsOf(fn, inputsOf(fn, inputs), swapped, swap));
  },
};

declare global {
  interface Window {
    __drift: typeof drift;
  }
}

Object.assign(window, { __drift: drift, __engine: { ready: true, errors: [] } });
