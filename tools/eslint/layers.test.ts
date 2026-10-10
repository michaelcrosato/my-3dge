/**
 * @file Proves the layer rules (tools/eslint/layers.ts, PLAN.md §6.1) with a failing and a passing fixture per layer
 * and per shared restriction, linted from a temporary directory: forbidden edges, type-only edges, the single owners of
 * three.js and Rapier, gfx/enhanced, and the exemption for unit tests.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { messagesOf } from './family';
import { layerBlocks } from './layers';
import { caseProblems, lintCases, uncovered, type Case, type CaseResult } from './testing';

const RULE = 'layer/no-restricted-imports';
const layer = (name: string, file: string, bad: string, good: string, goodFile?: string): Case => ({
  name,
  file,
  bad,
  good,
  goodFile,
  rule: RULE,
});

const CASES: Case[] = [
  layer(
    'core imports nothing from the other layers',
    'engine/core/registry.ts',
    "export { World } from '../sim/world';",
    "export { hash } from './hash';",
  ),
  layer(
    'a climb through engine/ is the same edge',
    'engine/core/registry.ts',
    "export { World } from '../../engine/sim/world';",
    "export { hash } from '../../engine/core/hash';",
  ),
  layer(
    'a detour is the same edge',
    'engine/core/registry.ts',
    "import { World } from './../core/../sim/world';\nexport const w = new World();",
    "import { hash } from './../core/hash';\nexport const h = hash;",
  ),
  layer(
    'a file at the engine root climbing back into engine/',
    'engine/sim-api.ts',
    "export { draw } from '../engine/gfx/draw';",
    "export { stepWorld } from '../engine/sim/world';",
  ),
  layer(
    'gfx climbing through engine/ into physics',
    'engine/gfx/level/mesh.ts',
    "export { body } from '../../../engine/physics/bodies';",
    "export { pose } from '../../../engine/anim/pose';",
  ),
  layer(
    'core/math takes only the math classes',
    'engine/core/math.ts',
    "export { Mesh } from 'three/webgpu';",
    "export { Vector3, Quaternion, MathUtils } from 'three/webgpu';",
  ),
  layer(
    "core/math takes three.js's Color, but not its colour management",
    'engine/core/math.ts',
    "export { ColorManagement } from 'three/webgpu';",
    "export { Color } from 'three/webgpu';",
  ),
  layer(
    'core/math takes nothing from three/tsl',
    'engine/core/math.ts',
    "export { uniform } from 'three/tsl';",
    "export { Matrix4 } from 'three/webgpu';",
  ),
  layer(
    'core/math takes nothing from a bare three',
    'engine/core/math.ts',
    "export { Vector3 } from 'three';",
    "export { Vector3 } from 'three/webgpu';",
  ),
  layer(
    'core/math imports no other layer',
    'engine/core/math.ts',
    "export { draw } from '../gfx/draw';",
    "export { clamp } from './scalar';",
  ),
  layer(
    'anim imports only core',
    'engine/anim/clip/sample.ts',
    "export { body } from '../../physics/bodies';",
    "export { Vector3 } from '../../core/math';",
  ),
  layer(
    'world imports only core',
    'engine/world/level/compile.ts',
    "export { pose } from '../../anim/pose';",
    "export { rng } from '../../core/rng';",
  ),
  layer(
    'input devices import core and input/intents',
    'engine/input/keyboard.ts',
    "export { draw } from '../gfx/draw';",
    "export { toIntent } from './intents';",
  ),
  layer(
    'input/intents imports only core',
    'engine/input/intents.ts',
    "export { keys } from './keyboard';",
    "export { rng } from '../core/rng';",
  ),
  layer(
    'audio/dsp imports only core',
    'engine/audio/dsp/osc.ts',
    "export { play } from '../runtime/player';",
    "export { rng } from '../../core/rng';",
  ),
  layer(
    'audio/runtime imports audio/dsp, core and sim types',
    'engine/audio/runtime/player.ts',
    "export { nav } from '../../world/nav';",
    "import type { QueryView } from '../../sim/snapshot';\nexport { osc } from '../dsp/osc';\nexport type View = QueryView;",
  ),
  layer(
    'audio/runtime takes sim types, never values',
    'engine/audio/runtime/occlusion.ts',
    "export { stepWorld } from '../../sim/world';",
    "import type { Snapshot } from '../../sim/snapshot';\nexport type Heard = Snapshot;",
  ),
  layer(
    'physics imports core and Rapier',
    'engine/physics/bodies.ts',
    "export { World } from '../sim/world';",
    "export { World } from '@dimforge/rapier3d-simd-compat';",
  ),
  layer(
    'sim imports input/intents, never the devices',
    'engine/sim/step.ts',
    "export { keyboard } from '../input/keyboard';",
    "export { readIntents } from '../input/intents';",
  ),
  layer(
    'gfx never imports physics',
    'engine/gfx/level/mesh.ts',
    "export { body } from '../../physics/bodies';",
    "export { pose } from '../../anim/pose';\nexport { Mesh } from 'three/webgpu';",
  ),
  layer(
    'gfx takes sim types, never values',
    'engine/gfx/draw.ts',
    "export { stepWorld } from '../sim/world';",
    "import type { Snapshot } from '../sim/snapshot';\nexport type Drawn = Snapshot;",
  ),
  layer(
    'only gfx/features.ts imports gfx/enhanced',
    'engine/gfx/renderer.ts',
    "export { ssao } from './enhanced/ssao';",
    "export { ssao } from './enhanced/ssao';",
    'engine/gfx/features.ts',
  ),
  layer(
    'gfx/features.ts follows the gfx rules otherwise',
    'engine/gfx/features.ts',
    "export { keyboard } from '../input/keyboard';",
    "export { uniform } from 'three/tsl';",
  ),
  layer(
    'gfx/enhanced imports gfx and core',
    'engine/gfx/enhanced/timing.ts',
    "export { level } from '../../world/level';",
    "export { renderer } from '../renderer';\nexport { uniform } from 'three/tsl';",
  ),
  layer(
    'ui imports core, input/intents and gfx',
    'engine/ui/hud.ts',
    "export { stepWorld } from '../sim/world';",
    "export { project } from '../gfx/camera';",
  ),
  layer(
    'dev imports everything but app',
    'engine/dev/inspector.ts',
    "export { createEngine } from '../app/engine';",
    "export { stepWorld } from '../sim/world';\nexport { draw } from '../gfx/draw';",
  ),
  layer(
    'dev/bot.ts imports only the sim-side layers',
    'engine/dev/bot.ts',
    "export { inspector } from './inspector';",
    "export { stepWorld } from '../sim/world';",
  ),
  layer(
    'app imports every layer, but three.js only through gfx',
    'engine/app/engine.ts',
    "export { WebGPURenderer } from 'three/webgpu';",
    "export { createRenderer } from '../gfx/renderer';\nexport { stepWorld } from '../sim/world';",
  ),
  layer(
    'ui never takes three.js directly',
    'engine/ui/overlay.ts',
    "export { Vector3 } from 'three/webgpu';",
    "export { Vector3 } from '../core/math';",
  ),
  layer(
    'sim-api.ts re-exports sim-side modules only',
    'engine/sim-api.ts',
    "export { draw } from './gfx/draw';",
    "export { Vector3 } from './core/math';\nexport { stepWorld } from './sim/world';",
  ),
  layer(
    'only physics imports Rapier',
    'engine/sim/bodies.ts',
    "export { World } from '@dimforge/rapier3d-simd-compat';",
    "export { createBody } from '../physics/bodies';",
  ),
  layer(
    'engine code never imports labs, fixtures, tests or tools',
    'engine/core/scenes.ts',
    "export { room } from '../../labs/box/scenes/room';",
    "export { hash } from './hash';",
  ),
  layer(
    'core never imports the page barrel',
    'engine/core/registry.ts',
    "export { createHeadless } from '../index';",
    "export { hash } from './hash';",
  ),
  layer(
    'the sim never imports the sim barrel',
    'engine/sim/world.ts',
    "import { defineScene } from '../sim-api';\nexport const d = defineScene;",
    "import { defineScene } from './scene';\nexport const d = defineScene;",
  ),
  layer(
    'nor engine/ itself, however it is spelt',
    'engine/sim/scene.ts',
    "export { held } from '../../engine';\nexport { pressed } from '..';\nexport { fromCamera } from '../';",
    "export { held } from '../input/intents';",
  ),
  layer(
    'nor from deeper in a layer',
    'engine/gfx/level/mesh.ts',
    "export { Vector3 } from '../../sim-api.ts';",
    "export { Vector3 } from '../../core/math';",
  ),
  layer(
    'unit tests may import any layer',
    'engine/core/clock.ts',
    "export { draw } from '../gfx/draw';",
    "export { draw } from '../gfx/draw';",
    'engine/core/clock.test.ts',
  ),
];

let results: CaseResult[];
beforeAll(async () => {
  results = await lintCases(CASES);
}, 60_000);

describe('the layer rules', () => {
  it.each(CASES.map((item, i) => [item.name, i] as const))('%s', (_name, i) => {
    expect(caseProblems(results[i])).toEqual([]);
  });

  it('every configured restriction has a failing fixture', () => {
    expect(uncovered(messagesOf(layerBlocks()), results)).toEqual([]);
  });

  it('each message names the rule and the way round it', () => {
    const message = results[0].bad.find((item) => item.ruleId === RULE)?.message ?? '';
    expect(message).toContain('engine/core may import only core: keep core self-contained');
    expect(message).toContain('(PLAN.md §6.1)');
  });

  it('each spelling of engine/ is refused once', () => {
    const barrels = results.find((result) => result.case.name.startsWith('nor engine/ itself'));
    expect(barrels?.bad.filter((item) => item.ruleId === RULE)).toHaveLength(3);
  });

  it('a path is matched as resolved from the importing file, and quoted as written', () => {
    const message = results[1].bad.find((item) => item.ruleId === RULE)?.message ?? '';
    expect(message).toMatch(/^'\.\.\/\.\.\/engine\/sim\/world' import is restricted/);
  });
});
