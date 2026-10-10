/**
 * @file Proves the reproducibility bans for sim-side code (tools/eslint/simSide.ts) with a failing and a passing
 * fixture each, linted from a temporary directory: every banned global, property, spelling and import, in every
 * sim-side directory, with tests and presentation code left free; `Math` destructured, and every function in
 * engine/core/simMath.ts's `SIM_MATH_NAMES` aliased, so a newly swapped function is covered too.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { SIM_MATH_NAMES } from '../../engine/core/simMath';
import { messagesOf } from './family';
import { SIM_SIDE, simSideBlocks } from './simSide';
import { caseProblems, lintCases, uncovered, type Case, type CaseResult } from './testing';

const GLOBALS = [
  'Date',
  'setTimeout',
  'setInterval',
  'setImmediate',
  'requestAnimationFrame',
  'requestIdleCallback',
  'document',
  'window',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
  'AudioContext',
  'OfflineAudioContext',
  'webkitAudioContext',
  'crypto',
  'process',
  'performance',
];

/** A sim-side file for each directory pattern in SIM_SIDE. */
const simFile = (pattern: string) => pattern.replace('/**', '/spawn.ts');

const CASES: Case[] = [
  ...GLOBALS.map((name) => ({
    name: `the global ${name}`,
    file: `engine/sim/${name}.ts`,
    bad: `export const value = ${name};`,
    good: 'export const value = Math.sin(0.5) + Math.cos(0.5);',
    rule: 'sim/no-restricted-globals',
  })),
  {
    name: 'Math.random, against a named stream',
    file: 'engine/world/spawn.ts',
    bad: 'export const roll = Math.random();',
    good: "import { rng } from '../core/rng';\nexport const roll = rng('spawn').next();",
    rule: 'sim/no-restricted-properties',
  },
  {
    name: 'performance.now, against the step count',
    file: 'engine/sim/timers.ts',
    bad: 'export const now = performance.now();',
    good: 'export const now = (step: number) => step / 60;',
    rule: 'sim/no-restricted-globals',
  },
  {
    name: 'performance.timeOrigin, a wall-clock timestamp',
    file: 'engine/core/time.ts',
    bad: 'export const origin = performance.timeOrigin;',
    good: 'export const origin = 0;',
    rule: 'sim/no-restricted-globals',
  },
  {
    name: 'a banned global through globalThis',
    file: 'engine/anim/clock.ts',
    bad: 'export const later = globalThis.setTimeout;',
    good: 'export const tau = globalThis.Math.PI * 2;',
    rule: 'sim/no-restricted-syntax',
  },
  {
    name: "a banned global through globalThis['…']",
    file: 'engine/anim/stamp.ts',
    bad: "export const D = globalThis['Date'];",
    good: "export const tau = globalThis['Math'].PI * 2;",
    rule: 'sim/no-restricted-syntax',
  },
  {
    name: 'a banned global through self[`…`]',
    file: 'engine/anim/later.ts',
    bad: 'export const later = self[`setTimeout`];',
    good: 'export const tau = self[`Math`].PI * 2;',
    rule: 'sim/no-restricted-syntax',
  },
  {
    name: 'a banned global destructured from globalThis',
    file: 'engine/anim/now.ts',
    bad: 'const { performance: p } = globalThis;\nexport const now = p.now();',
    good: 'const { Math: M } = globalThis;\nexport const tau = M.PI * 2;',
    rule: 'sim/no-restricted-syntax',
  },
  {
    name: 'a dynamic import, of three.js or anything else',
    file: 'engine/sim/lazy.ts',
    bad: "export const gfx = import('three/webgpu');",
    good: "export { Vector3 } from '../core/math';",
    rule: 'sim/no-restricted-syntax',
  },
  {
    name: 'the ** operator, which the fdlibm swap cannot reach',
    file: 'engine/sim/falloff.ts',
    bad: 'export const falloff = (d: number) => d ** 2.2;',
    good: 'export const falloff = (d: number) => Math.pow(d, 2.2);',
    rule: 'sim/no-restricted-syntax',
  },
  {
    name: 'compound **=',
    file: 'engine/anim/ease.ts',
    bad: 'export function grow(x: number) {\n  x **= 2;\n  return x;\n}',
    good: 'export function grow(x: number) {\n  x = Math.pow(x, 2);\n  return x;\n}',
    rule: 'sim/no-restricted-syntax',
  },
  {
    name: 'Math destructured, whose names hold the native functions',
    file: 'engine/sim/wave.ts',
    bad: 'const { sin, cos } = Math;\nexport const wave = (t: number) => sin(t) * cos(t);',
    good: 'export const wave = (t: number) => Math.sin(t) * Math.cos(t);',
    rule: 'sim/no-restricted-syntax',
  },
  {
    name: 'Math destructured in an assignment, inside a function',
    file: 'engine/anim/sway.ts',
    bad: 'export function sway(t: number) {\n  let pow;\n  ({ pow } = Math);\n  return pow(t, 3);\n}',
    good: 'export function sway(t: number) {\n  return Math.pow(t, 3);\n}',
    rule: 'sim/no-restricted-syntax',
  },
  ...SIM_MATH_NAMES.map((name) => ({
    name: `Math.${name} aliased at module level, against calling it where it is used`,
    file: `engine/world/${name}.ts`,
    bad: `const alias = Math.${name};\nexport const f = (t: number) => alias(${name === 'pow' ? 't, 2' : 't'});`,
    good: `export const f = (t: number) => Math.${name}(${name === 'pow' ? 't, 2' : 't'});`,
    rule: 'sim/no-restricted-syntax',
  })),
  {
    name: 'a swapped Math function assigned to a variable inside a function, by any spelling',
    file: 'engine/physics/orbit.ts',
    bad: "export function orbit(t: number) {\n  let f = Math.abs;\n  f = Math['cos'];\n  return f(t);\n}",
    good: 'export function orbit(t: number) {\n  const f = Math.abs;\n  return f(Math.cos(t));\n}',
    rule: 'sim/no-restricted-syntax',
  },
  {
    name: 'a dynamic import of another layer',
    file: 'engine/world/lazy.ts',
    bad: "export const draw = () => import('../gfx/draw');",
    good: "export { rng } from '../core/rng';",
    rule: 'sim/no-restricted-syntax',
  },
  {
    name: 'three.js in sim-side code, against core/math',
    file: 'engine/physics/shapes.ts',
    bad: "export { Vector3 } from 'three/webgpu';",
    good: "export { Vector3 } from '../core/math';",
    rule: 'sim/no-restricted-imports',
  },
  {
    name: 'three.js in core/math.ts, its one importer',
    file: 'engine/sim/math.ts',
    bad: "export { Vector3 } from 'three/webgpu';",
    goodFile: 'engine/core/math.ts',
    good: "export { Vector3 } from 'three/webgpu';",
    rule: 'sim/no-restricted-imports',
  },
  {
    name: 'a Node built-in',
    file: 'engine/world/save.ts',
    bad: "export { readFileSync } from 'node:fs';",
    good: "export { hash } from '../core/hash';",
    rule: 'sim/no-restricted-imports',
  },
  {
    name: 'a Node built-in in core/math.ts, which may take three.js',
    file: 'engine/core/math.ts',
    bad: "export { Vector3 } from 'three/webgpu';\nexport { readFileSync } from 'fs';",
    good: "export { Vector3 } from 'three/webgpu';",
    rule: 'sim/no-restricted-imports',
  },
  {
    name: 'a Node built-in without the node: prefix',
    file: 'engine/core/id.ts',
    bad: "import { randomUUID } from 'crypto';\nexport const id = randomUUID();",
    good: "import { rng } from './rng';\nexport const id = rng('ids').next();",
    rule: 'sim/no-restricted-imports',
  },
  {
    name: 'a Node built-in subpath without the prefix',
    file: 'engine/world/load.ts',
    bad: "export { readFile } from 'fs/promises';",
    good: "export { parseLevel } from './level';",
    rule: 'sim/no-restricted-imports',
  },
  ...SIM_SIDE.map((pattern) => ({
    name: `Date in ${pattern}`,
    file: simFile(pattern),
    bad: 'export const stamp = Date.now();',
    good: 'export const stamp = (step: number) => step;',
    rule: 'sim/no-restricted-globals',
  })),
  {
    name: 'unit tests are exempt',
    file: 'engine/sim/world.ts',
    bad: 'export const stamp = Date.now();',
    goodFile: 'engine/sim/world.test.ts',
    good: 'export const stamp = Date.now();',
    rule: 'sim/no-restricted-globals',
  },
  {
    name: 'presentation code may use the clock',
    file: 'engine/sim/loop.ts',
    bad: 'export const frame = requestAnimationFrame(() => performance.now());',
    goodFile: 'engine/app/loop.ts',
    good: 'export const frame = requestAnimationFrame(() => performance.now());',
    rule: 'sim/no-restricted-globals',
  },
];

let results: CaseResult[];
beforeAll(async () => {
  results = await lintCases(CASES);
}, 60_000);

describe('the sim-side bans', () => {
  it.each(CASES.map((item, i) => [item.name, i] as const))('%s', (_name, i) => {
    expect(caseProblems(results[i])).toEqual([]);
  });

  it('every configured ban has a failing fixture', () => {
    expect(uncovered(messagesOf(simSideBlocks()), results)).toEqual([]);
  });

  it('a fixture is written to every sim-side directory', () => {
    const files = new Set(CASES.map((item) => item.file));
    for (const pattern of SIM_SIDE) expect(files.has(simFile(pattern)), pattern).toBe(true);
  });
});
