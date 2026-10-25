/**
 * @file The sample of mutants `npx stryker run` tests (PLAN.md WP 12.2; stryker.config.json): a StrykerJS ignore
 * plugin, `sample`, that keeps the mutants of a fixed, random share of the mutated files' outermost functions and
 * ignores the rest, so a run over every file of engine/sim and engine/anim measures their mutation score in a run's
 * time instead of most of a day's (measured: 1,714 mutants that are not static in 105 minutes at two runners).
 *
 * A function is kept when the hash of its file, its name and its place among the functions of that name in that file
 * (`functionKey`) falls under `SAMPLE.rate` (FNV-1a, `share`), seeded by `SAMPLE.seed`: whole functions, so every
 * mutant of one is in or out together, each with the same chance, and the same set on every run while the functions
 * keep their names (an edit elsewhere in a file moves no function in or out). A function with no name of its own, its
 * key's or its variable's (a private method, a callback) goes by `anonymous` and its place among the file's: adding
 * one before it can move it in or out. Code outside every function runs as its module loads, static mutants the config
 * ignores (`ignoreStatic`), but for a class's field initializers, which run as an instance is made: every class's are
 * kept, a stratum of their own (WP 12.2's run: 63 of 1,714 mutants). An ignored mutant counts in no score; Stryker
 * reports it with this plugin's reason.
 *
 * `OUT_OF_SCOPE` names the functions whose mutants no run tests, each with its measured reason: a function so hot that
 * instrumenting it (a check before every mutable expression, a count after) makes the suites too slow to test its
 * mutants. Their own tests still run in every run, against everything else's mutants.
 *
 * Invariants: pure; the same function gets the same answer every time; changing the seed or the rate draws another
 * sample, and incremental results then hold for the functions both samples keep.
 *
 * @example
 * share('wp-12.2'); // a number in [0, 1), the same every time
 * @see tools/stryker/sample.test.ts
 */
import { declareValuePlugin, PluginKind } from '@stryker-mutator/api/plugin';

/** The sample: the share of functions kept, and the seed that draws them. */
export const SAMPLE = Object.freeze({ rate: 0.1, seed: 'wp-12.2' });

/** The functions no run mutates, by `functionKey`, each with its reason (measured; see the file comment). */
export const OUT_OF_SCOPE: Readonly<Record<string, string>> = Object.freeze({
  'engine/anim/fk.ts:forwardKinematics#0':
    'forward kinematics runs in every pose, and instrumented it slows the anim suites about 100 times (engine/anim/humanoid.test.ts: 2.2 s, then 280 s), so its mutants alone would take a day; fk.test.ts holds it to three.js’s bones, and humanoid.test.ts every joint to my-3d2dge’s',
});

/** FNV-1a (32 bits) of `text`, as a share of 2³²: a number in [0, 1), spread evenly. */
export function share(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash / 0x100000000;
}

/** The parts of a Babel path this plugin reads (Stryker hands it Babel's NodePath, its hub the file's). */
export interface SamplePath {
  readonly node: { readonly type: string } & Record<string, unknown>;
  readonly parentPath: SamplePath | null;
  readonly hub?: { readonly file?: { readonly opts?: { readonly filename?: string } } };
}

const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod', 'ClassPrivateMethod']); // prettier-ignore

/** Whether `path` is a function inside no other function. */
function outermost(path: SamplePath): boolean {
  if (!FUNCTIONS.has(path.node.type)) return false;
  for (let up = path.parentPath; up; up = up.parentPath) if (FUNCTIONS.has(up.node.type)) return false;
  return true;
}

/** A node's identifier's name, when it has one. */
const nameIn = (node: unknown): string | undefined => {
  const named = node as { type?: string; name?: string; value?: unknown } | undefined;
  if (named?.type === 'Identifier' || named?.type === 'PrivateName') return named.name;
  if (named?.type === 'StringLiteral' || named?.type === 'NumericLiteral') return String(named.value);
  return undefined;
};

/** The name a function goes by: its own, its method's or property's key, or the variable it is assigned to. */
export function functionName(path: SamplePath): string {
  const own = nameIn(path.node.id) ?? nameIn(path.node.key);
  if (own) return own;
  const parent = path.parentPath?.node;
  return nameIn(parent?.id) ?? nameIn(parent?.key) ?? nameIn(parent?.left) ?? 'anonymous';
}

/** How many functions of each name each file has shown so far, for `functionKey`'s place. */
const seen = new Map<string, number>();

/** The function's key: its file, its name and its place among that file's functions of that name (`#0`, `#1`…). */
export function functionKey(path: SamplePath): string {
  const absolute = (path.hub?.file?.opts?.filename ?? '').replace(/\\/g, '/');
  const file = absolute.slice(absolute.lastIndexOf('/engine/') + 1); // from the repository's root, wherever it is
  const name = `${file}:${functionName(path)}`;
  const place = seen.get(name) ?? 0;
  seen.set(name, place + 1);
  return `${name}#${place}`;
}

/** Forgets the places counted so far: Stryker instruments each file once a run, from its start. */
export function resetPlaces(): void {
  seen.clear();
}

/** The ignorer: an outermost function out of scope or outside the sample is ignored, with the reason Stryker reports. */
export const sample = {
  shouldIgnore(path: SamplePath): string | undefined {
    if (!outermost(path)) return undefined;
    const key = functionKey(path);
    if (OUT_OF_SCOPE[key]) return `out of scope (tools/stryker/sample.ts): ${OUT_OF_SCOPE[key]}`;
    if (share(`${SAMPLE.seed}:${key}`) < SAMPLE.rate) return undefined;
    return `outside the sample: StrykerJS tests ${SAMPLE.rate * 100}% of the functions, drawn by tools/stryker/sample.ts`;
  },
};

/** The plugins StrykerJS loads from this module (stryker.config.json's `appendPlugins`). */
export const strykerPlugins = [declareValuePlugin(PluginKind.Ignore, 'sample', sample)];
