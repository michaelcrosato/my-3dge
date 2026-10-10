/**
 * @file T2's drift test (PLAN.md §6.5, WP 1.1; doctrine: Reproducible): the sim's math gives the same bits in Node
 * and in Chromium, so one golden hash per replay holds in both. Node's half runs in this spec's own process, Chromium's
 * in tests/pages/drift.html; both run tests/pages/driftProbe.ts on the same seeded inputs: every `Math` function on
 * 200,000 inputs, the `**` operator, three.js's math classes and a feedback sim, natively and inside `withSimMath`.
 *
 * What fails: a swapped function (`sin`, `cos`, `pow`) or a composite that differs inside the swap; any other
 * function that differs natively (the finding names the stdlib port to add to `SIM_MATH`); a `Math` function the
 * probe does not cover; `Math` not restored after the swap, also after a throw. The swapped functions are also
 * compared result by result, bit for bit, and the fixture that leaves `cos` out of the swap must fail, naming
 * `@stdlib/math-base-special-cos`. Native differences inside the swap's coverage are recorded as annotations.
 */
import { SIM_MATH_NAMES, type SimMathName } from '../../engine/core/simMath';
import {
  bitDiff,
  compareDrift,
  DRIFT_FUNCTIONS,
  DRIFT_INPUTS,
  inputsOf,
  resultsOf,
  runProbe,
  type DriftFunction,
} from '../pages/driftProbe';
import { expect, test } from './fixtures';

const PAGE = 'tests/pages/drift.html';

test.describe.configure({ timeout: 120_000 });

test.beforeEach(async ({ page, harness }) => {
  await page.goto(PAGE);
  await harness.ready();
});

/** The probed function named `name`. */
const probed = (name: string) => DRIFT_FUNCTIONS.find((fn) => fn.name === name) as DriftFunction;

/** Decodes the page's base64 float64 bytes. */
const decode = (text: string) => {
  const bytes = Buffer.from(text, 'base64');
  return new Float64Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 8);
};

/** One line on how two runtimes' results differ: how many, and the first input with both results. */
function describeDiff(fn: DriftFunction, inputs: Float64Array[], node: Float64Array, page: Float64Array): string {
  const { count, first } = bitDiff(node, page);
  if (count === 0) return `${fn.name}: all ${node.length} results equal`;
  const args = inputs.map((column) => column[first]).join(', ');
  return `${fn.name}: ${count} of ${node.length} results differ (${((100 * count) / node.length).toFixed(2)}%), first ${fn.name}(${args}): Node ${node[first]}, Chromium ${page[first]}`;
}

test('every Math function, three.js and a feedback sim give the same bits in Node and Chromium where the sim relies on them', async ({
  page,
}) => {
  const node = runProbe();
  const chromium = await page.evaluate(() => window.__drift.runProbe());
  expect(compareDrift(node, chromium)).toEqual([]);
  expect(node.functions.length).toBe(35);
  const native = Object.keys(node.hashes).filter((name) => node.hashes[name].native !== chromium.hashes[name].native);
  test.info().annotations.push({
    type: 'differs natively, the same inside withSimMath',
    description: native.join(', ') || 'none',
  });
});

test('under withSimMath, sin, cos and pow give the same bits in Node and Chromium on every input', async ({ page }) => {
  const notes = test.info().annotations;
  for (const name of SIM_MATH_NAMES) {
    const fn = probed(name);
    const inputs = inputsOf(fn);
    const results = async (swapped: boolean) =>
      decode(await page.evaluate((args) => window.__drift.results(...args), [name, swapped, DRIFT_INPUTS] as const));
    const [swapped, native] = [await results(true), await results(false)];
    const mine = resultsOf(fn, inputs, true);
    expect(swapped.length).toBe(inputs[0].length);
    expect(inputs[0].length).toBeGreaterThan(DRIFT_INPUTS);
    expect(bitDiff(mine, swapped).count, describeDiff(fn, inputs, mine, swapped)).toBe(0);
    notes.push({ type: 'native', description: describeDiff(fn, inputs, resultsOf(fn, inputs, false), native) });
  }
});

test('outside withSimMath, Math holds the native functions again in Chromium, also after a throw and when nested', async ({
  page,
}) => {
  const seen = await page.evaluate(() => {
    const drift = window.__drift;
    const before = drift.state();
    let [inside, nested] = [before, before];
    let error = '';
    try {
      drift.withSimMath(() => {
        inside = drift.state();
        drift.withSimMath(() => undefined);
        nested = drift.state();
        throw new Error('thrown inside');
      });
    } catch (thrown) {
      error = (thrown as Error).message;
    }
    return { before, inside, nested, after: drift.state(), error };
  });
  const all = (held: string) => Object.fromEntries(SIM_MATH_NAMES.map((name) => [name, held]));
  expect(seen).toEqual({
    before: all('native'),
    inside: all('port'),
    nested: all('port'),
    after: all('native'),
    error: 'thrown inside',
  });
});

test('the drift test fails on a fixture that leaves cos out of the swap, naming its stdlib port', async ({ page }) => {
  const swap: SimMathName[] = SIM_MATH_NAMES.filter((name) => name !== 'cos');
  const node = runProbe({ swap });
  const chromium = await page.evaluate((s) => window.__drift.runProbe({ swap: s }), swap);
  const findings = compareDrift(node, chromium, swap);
  const cos = findings.filter((finding) => finding.startsWith('Math.cos differs'));
  expect(
    cos,
    'native Math.cos must differ between Node and Chromium for this fixture to fail; if it no longer does, cos may leave SIM_MATH (PLAN.md §6.5)',
  ).toHaveLength(1);
  expect(cos[0]).toContain('add its fdlibm port, @stdlib/math-base-special-cos, to SIM_MATH');
  expect(findings.filter((finding) => /Math\.(sin|pow)\b/.test(finding))).toEqual([]);
  test.info().annotations.push({ type: 'findings', description: findings.join(' | ') });
});
