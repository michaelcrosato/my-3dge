/**
 * @file Proves the public-API rule (tools/eslint/publicApi.ts, PLAN.md §6.1, ADR-0020) with failing and passing
 * fixtures linted from a temporary directory, with the rule switched on (since WP 1.6) and off: named, side-effect and
 * dynamic imports, relative sources matched as resolved.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { messagesOf } from './family';
import { publicApiBlocks } from './publicApi';
import { ALL_ON, caseProblems, lintCases, uncovered, type Case, type CaseResult } from './testing';

const RULE = 'public-api/no-restricted-imports';
const SIDE_EFFECTS = 'public-api/no-unnamed-imports';

const CASES: Case[] = [
  {
    name: 'a page imports only the barrels',
    file: 'labs/box/main.ts',
    bad: "export { createRenderer } from '../../engine/gfx/renderer';",
    good: "export { createEngine } from '../../engine/index';\nexport { Vector3 } from '../../engine/sim-api';",
    rule: RULE,
  },
  {
    name: 'a scene imports only the sim barrel',
    file: 'labs/box/scenes/room.ts',
    bad: "export { createEngine } from '../../../engine/index';",
    good: "export { Vector3, defineScene } from '../../../engine/sim-api';",
    rule: RULE,
  },
  {
    name: 'the cast imports only the sim barrel',
    file: 'labs/box/cast/slime.ts',
    bad: "export { rng } from '../../../engine/core/rng';",
    good: "export { rng } from '../../../engine/sim-api';",
    rule: RULE,
  },
  {
    name: 'game code never imports three.js; the harness page may',
    file: 'labs/box/main.ts',
    bad: "export { Mesh } from 'three/webgpu';",
    goodFile: 'labs/hello/main.ts',
    good: "export { Mesh } from 'three/webgpu';",
    rule: RULE,
  },
  {
    name: 'a fixture scene never imports Rapier',
    file: 'fixtures/scenes/drop.ts',
    bad: "export { World } from '@dimforge/rapier3d-simd-compat';",
    good: "export { createBody } from '../../engine/sim-api';",
    rule: RULE,
  },
  {
    name: 'a side-effect import of three.js',
    file: 'labs/box/main.ts',
    bad: "import 'three/webgpu';",
    good: "import '../../engine/index';",
    rule: SIDE_EFFECTS,
  },
  {
    name: 'a side-effect import of engine internals',
    file: 'labs/box/main.ts',
    bad: "import '../../engine/gfx/renderer';",
    good: "import '../../engine/index';",
    rule: SIDE_EFFECTS,
  },
  {
    name: 'a dynamic import of engine internals, or of Rapier',
    file: 'labs/box/menu.ts',
    bad: "export const load = () => [import('../../engine/gfx/renderer'), import('@dimforge/rapier3d-simd-compat')];",
    good: "export const load = () => import('../../engine/index');",
    rule: SIDE_EFFECTS,
  },
  {
    name: 'a side-effect import of the page barrel in sim-side game code',
    file: 'fixtures/scenes/drop.ts',
    bad: "import '../../engine/index';",
    good: "import '../../engine/sim-api';",
    rule: SIDE_EFFECTS,
  },
  {
    name: 'a side-effect import of engine internals is matched as resolved',
    file: 'labs/box/main.ts',
    bad: "import './../../engine/core/registry';",
    good: "import './../../engine/index';",
    rule: SIDE_EFFECTS,
  },
  {
    name: 'a dynamic import with a template source, matched as resolved',
    file: 'labs/box/menu.ts',
    bad: 'export const load = () => import(`./../box/../../engine/gfx/renderer`);',
    good: 'export const load = () => import(`./../box/../../engine/index`);',
    rule: SIDE_EFFECTS,
  },
  {
    name: 'the kernel fixture: a fixture scene that imports engine/sim/world is refused',
    file: 'fixtures/scenes/kernel/index.ts',
    bad: "import type { World } from '../../../engine/sim/world';\nexport type W = World;",
    good: "import type { World } from '../../../engine/sim-api';\nexport type W = World;",
    rule: RULE,
  },
  {
    name: 'a detour into engine internals is matched as resolved',
    file: 'labs/box/main.ts',
    bad: "export { createRenderer } from '../box/../../engine/gfx/renderer';",
    good: "export { createEngine } from '../box/../../engine/index';",
    rule: RULE,
  },
  {
    name: "a game's unit test may import anything",
    file: 'labs/box/scenes/arena.ts',
    bad: "export { stepWorld } from '../../../engine/sim/world';",
    goodFile: 'labs/box/scenes/arena.test.ts',
    good: "export { stepWorld } from '../../../engine/sim/world';",
    rule: RULE,
  },
];

let results: CaseResult[];
let off: CaseResult[];
beforeAll(async () => {
  [results, off] = await Promise.all([lintCases(CASES), lintCases(CASES, { ...ALL_ON, publicApi: false })]);
}, 60_000);

describe('the public-API rule, switched on', () => {
  it.each(CASES.map((item, i) => [item.name, i] as const))('%s', (_name, i) => {
    expect(caseProblems(results[i])).toEqual([]);
  });

  it('every configured restriction has a failing fixture', () => {
    expect(uncovered(messagesOf(publicApiBlocks(true)), results)).toEqual([]);
  });

  it('names the refused import, and the barrel to take it from', () => {
    const [message] = results[0].bad.map((item) => item.message);
    expect(message).toContain("'createRenderer' import from '../../engine/gfx/renderer'");
    expect(message).toContain('engine/index.ts (pages) or engine/sim-api.ts (sim-side code) under the same name');
  });
});

describe('the public-API rule, switched off', () => {
  it('reports nothing', () => {
    expect(off.flatMap((result) => result.bad.filter((item) => item.ruleId?.startsWith('public-api/')))).toEqual([]);
  });
});
