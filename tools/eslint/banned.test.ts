/**
 * @file Proves the banned and renamed three.js APIs (tools/eslint/banned.ts, PLAN.md Appendix B) with a failing and a
 * passing fixture per ban, linted from a temporary directory, including the path exceptions (mrt.ts, shot.ts,
 * timing.ts, pipelines.ts, the outline material) and the common words left alone outside TSL.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { bannedBlocks } from './banned';
import { messagesOf } from './family';
import { caseProblems, lintCases, uncovered, type Case, type CaseResult } from './testing';

const SYNTAX = 'banned/no-restricted-syntax';
const PROPERTIES = 'banned/no-restricted-properties';
const IMPORTS = 'banned/no-restricted-imports';
let count = 0;
/** A case in its own file (the name is the file's), so cases never collide. */
const ban = (rule: string, name: string, bad: string, good: string, dir = 'engine/gfx'): Case => ({
  name,
  file: `${dir}/case${++count}.ts`,
  bad,
  good,
  rule,
});
/** A case at a fixed path, with the passing source at `goodFile` when the path is the point. */
const at = (rule: string, name: string, file: string, bad: string, good: string, goodFile?: string): Case => ({
  name,
  file,
  bad,
  good,
  goodFile,
  rule,
});

const CASES: Case[] = [
  ban(IMPORTS, 'a bare three', "export { Mesh } from 'three';", "export { Mesh } from 'three/webgpu';"),
  ban(IMPORTS, 'Clock', "export { Clock } from 'three/webgpu';", "export { Timer } from 'three/webgpu';"),
  ban(IMPORTS, 'atan2 from three/tsl', "export { atan2 } from 'three/tsl';", "export { atan } from 'three/tsl';"),
  ban(IMPORTS, 'equals', "export { equals } from 'three/tsl';", "export { equal } from 'three/tsl';"),
  ban(IMPORTS, 'burn', "export { burn } from 'three/tsl';", "export { blendBurn } from 'three/tsl';"),
  ban(IMPORTS, 'dodge', "export { dodge } from 'three/tsl';", "export { blendDodge } from 'three/tsl';"),
  ban(IMPORTS, 'overlay', "export { overlay } from 'three/tsl';", "export { blendOverlay } from 'three/tsl';"),
  ban(IMPORTS, 'screen', "export { screen } from 'three/tsl';", "export { blendScreen } from 'three/tsl';"),
  ban(IMPORTS, 'append', "export { append } from 'three/tsl';", "export { Stack } from 'three/tsl';"),
  ban(IMPORTS, 'label', "export { label } from 'three/tsl';", "export { uniform } from 'three/tsl';"),
  ban(IMPORTS, 'cache', "export { cache } from 'three/tsl';", "export { isolate } from 'three/tsl';"),
  ban(IMPORTS, 'PI2', "export { PI2 } from 'three/tsl';", "export { TWO_PI } from 'three/tsl';"),
  ban(
    IMPORTS,
    'EffectComposer post-processing paths',
    "export { RenderPass } from 'three/addons/postprocessing/RenderPass.js';",
    "export { bloom } from 'three/addons/tsl/display/BloomNode.js';",
  ),
  ban(
    IMPORTS,
    'three/examples/jsm paths',
    "export { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';",
    "export { OrbitControls } from 'three/addons/controls/OrbitControls.js';",
  ),
  ban(SYNTAX, 'WebGLRenderer', 'export const r = new WebGLRenderer();', 'export const r = new WebGPURenderer();'),
  ban(
    SYNTAX,
    'forceWebGL',
    'export const r = new WebGPURenderer({ forceWebGL: true });',
    'export const r = new WebGPURenderer({ antialias: true });',
  ),
  ban(
    SYNTAX,
    'ShaderMaterial',
    'export const m = new ShaderMaterial();',
    'export const m = new MeshStandardNodeMaterial();',
  ),
  ban(
    SYNTAX,
    'onBeforeCompile',
    'material.onBeforeCompile = () => undefined;',
    'material.colorNode = color(0xff0000);',
  ),
  ban(SYNTAX, 'EffectComposer', 'export const c = new EffectComposer(r);', 'export const c = new PostProcessing(r);'),
  ban(
    SYNTAX,
    'RenderPipeline (r183)',
    'export const p = new RenderPipeline(r);',
    'export const p = new PostProcessing(r);',
  ),
  ban(SYNTAX, 'ClusteredLighting', 'export const l = new ClusteredLighting();', 'export const l = lights.pool();'),
  ban(SYNTAX, 'TextureSource', 'export const s = new TextureSource(img);', 'export const s = new Source(img);'),
  ban(SYNTAX, 'packNormalToRGB', 'export const c = packNormalToRGB(n);', 'export const c = directionToColor(n);'),
  ban(SYNTAX, 'unpackRGBToNormal', 'export const n = unpackRGBToNormal(c);', 'export const n = colorToDirection(c);'),
  ban(
    SYNTAX,
    'negateOnBackSide',
    'export const n = negateOnBackSide(v);',
    'export const n = directionToFaceDirection(v);',
  ),
  ban(SYNTAX, 'GodraysNode', 'export const g = new GodraysNode();', 'export const g = godrays(scenePass);'),
  ban(SYNTAX, 'modInt', 'export const m = modInt(a, b);', 'export const m = mod(int(a), int(b));'),
  ban(SYNTAX, 'rangeFog', 'export const f = rangeFog(c, 1, 9);', 'export const f = fog(c, rangeFogFactor(1, 9));'),
  ban(SYNTAX, 'densityFog', 'export const f = densityFog(c, 0.1);', 'export const f = fog(c, densityFogFactor(0.1));'),
  ban(SYNTAX, 'viewportResolution', 'export const s = viewportResolution;', 'export const s = screenSize;'),
  ban(SYNTAX, 'transformedNormalView', 'export const n = transformedNormalView;', 'export const n = normalView;'),
  ban(SYNTAX, 'transformedNormalWorld', 'export const n = transformedNormalWorld;', 'export const n = normalWorld;'),
  ban(
    SYNTAX,
    'transformedClearcoatNormalView',
    'export const n = transformedClearcoatNormalView;',
    'export const n = clearcoatNormalView;',
  ),
  ban(
    SYNTAX,
    'storageObject',
    'export const s = storageObject(a, t, 4);',
    'export const s = storage(a, t, 4).setPBO(true);',
  ),
  ban(
    SYNTAX,
    'TSL.atan2 through the namespace',
    'export const a = TSL.atan2(y, x);',
    'export const a = TSL.atan(y, x);',
  ),
  ban(
    SYNTAX,
    'DynamicDrawUsage on instance matrices',
    'mesh.instanceMatrix.setUsage(DynamicDrawUsage);',
    'geometry.attributes.position.setUsage(DynamicDrawUsage);',
  ),
  at(
    SYNTAX,
    'mrt() outside mrt.ts',
    'engine/gfx/post/bloom.ts',
    'export const out = mrt({ output, normal });',
    'export const out = mrt({ output, normal });',
    'engine/gfx/post/mrt.ts',
  ),
  ban(SYNTAX, 'setMRT outside mrt.ts', 'scenePass.setMRT(outputs);', 'scenePass.setResolutionScale(0.5);'),
  at(
    SYNTAX,
    'renderer internals outside pipelines.ts',
    'engine/gfx/stats.ts',
    'export const n = renderer._pipelines.size;',
    'export const n = renderer._pipelines.size;',
    'engine/gfx/pipelines.ts',
  ),
  at(
    SYNTAX,
    'positionLocal in the outline material',
    'engine/gfx/materials/outline.ts',
    'export const push = positionLocal.add(normalLocal.mul(width));',
    'export const push = positionGeometry.add(normalLocal.mul(width));',
  ),
  ban(SYNTAX, 'eval', 'export const v = eval(code);', 'export const v = JSON.parse(code);', 'engine/world'),
  ban(SYNTAX, 'new Function', 'export const f = new Function(code);', 'export const f = () => code;', 'labs/box'),
  ban(SYNTAX, '.append()', 'export const s = node.append();', 'export const s = node.toStack();'),
  ban(SYNTAX, '.label()', "export const n = node.label('glow');", "export const n = node.setName('glow');"),
  ban(SYNTAX, '.cache()', 'export const n = node.cache();', 'export const n = node.isolate();'),
  ban(SYNTAX, '.varying()', 'export const v = node.varying();', 'export const v = node.toVarying();'),
  ban(SYNTAX, '.vertexStage()', 'export const v = node.vertexStage();', 'export const v = node.toVertexStage();'),
  ban(SYNTAX, 'texture().uv(u)', 'export const t = texture(map).uv(u);', 'export const t = texture(map).sample(u);'),
  ban(SYNTAX, 'PassNode.setResolution()', 'scenePass.setResolution(0.5);', 'scenePass.setResolutionScale(0.5);'),
  ban(
    SYNTAX,
    "ReflectorNode's resolution",
    'export const r = reflector({ resolution: 0.5 });',
    'export const r = reflector({ resolutionScale: 0.5 });',
  ),
  ...[
    ['renderAsync', 'render'],
    ['clearAsync', 'clear'],
    ['clearColorAsync', 'clearColor'],
    ['clearDepthAsync', 'clearDepth'],
    ['clearStencilAsync', 'clearStencil'],
    ['initTextureAsync', 'initTexture'],
    ['hasFeatureAsync', 'hasFeature'],
    ['fromSceneAsync', 'fromScene'],
    ['fromEquirectangularAsync', 'fromEquirectangular'],
    ['fromCubemapAsync', 'fromCubemap'],
    ['waitForGPU', 'init'],
    ['renderMultiDrawInstances', 'renderMultiDraw'],
    ['getColorBufferType', 'getOutputBufferType'],
    ['fromWorkingColorSpace', 'workingToColorSpace'],
    ['toWorkingColorSpace', 'colorSpaceToWorking'],
    ['parseAnimation', 'clipFromData'],
  ].map(([old, use]) => ban(PROPERTIES, old, `export const v = target.${old}();`, `export const v = target.${use}();`)),
  ...['readRenderTargetPixels', 'getImageData', 'readPixels'].map((name) =>
    at(
      PROPERTIES,
      `${name} (sync) even in shot.ts`,
      'engine/gfx/shot.ts',
      `export const p = target.${name}(0, 0, 1, 1);`,
      'export const p = renderer.readRenderTargetPixelsAsync(target, 0, 0, 1, 1);',
    ),
  ),
  at(
    PROPERTIES,
    'readRenderTargetPixelsAsync outside shot.ts',
    'engine/gfx/post/probe.ts',
    'export const p = renderer.readRenderTargetPixelsAsync(target, 0, 0, 1, 1);',
    'export const p = renderer.readRenderTargetPixelsAsync(target, 0, 0, 1, 1);',
    'engine/gfx/shot.ts',
  ),
  at(
    PROPERTIES,
    'getArrayBufferAsync outside timing.ts',
    'engine/sim/probe.ts',
    'export const p = renderer.getArrayBufferAsync(buffer);',
    'export const p = renderer.getArrayBufferAsync(buffer);',
    'engine/gfx/enhanced/timing.ts',
  ),
  ban(
    SYNTAX,
    "material.shadowNode, but not a light shadow's own",
    'material.shadowNode = shadow;',
    'material.castShadowNode = shadow;\nlight.shadow.shadowNode = custom;',
  ),
  ban(
    PROPERTIES,
    'material.shadowPositionNode',
    'material.shadowPositionNode = p;',
    'material.receivedShadowPositionNode = p;',
  ),
  ban(
    PROPERTIES,
    'common words stay free outside TSL: Math.atan2, vector.equals, el.append(child)',
    'export const r = renderer.renderAsync(scene, camera);',
    'export const a = [Math.atan2(1, 2), v.equals(w), el.append(child), list.label];',
    'labs/box',
  ),
];

let results: CaseResult[];
beforeAll(async () => {
  results = await lintCases(CASES);
}, 60_000);

describe('the banned three.js APIs', () => {
  it.each(CASES.map((item, i) => [item.name, i] as const))('%s', (_name, i) => {
    expect(caseProblems(results[i])).toEqual([]);
  });

  it('every configured ban has a failing fixture', () => {
    expect(uncovered(messagesOf(bannedBlocks()), results)).toEqual([]);
  });

  it('applies to tests too, but not outside engine/, labs/ and fixtures/', async () => {
    const [inTest, inTools] = await lintCases([
      at(SYNTAX, 'test', 'engine/gfx/renderer.test.ts', 'export const r = new WebGLRenderer();', 'export {};'),
      at(
        SYNTAX,
        'tools',
        'engine/gfx/a.ts',
        'export const r = new WebGLRenderer();',
        'export const r = new WebGLRenderer();',
        'tools/lib/a.ts',
      ),
    ]);
    expect(caseProblems(inTest)).toEqual([]);
    expect(caseProblems(inTools)).toEqual([]);
  });
});
