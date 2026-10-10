/**
 * @file The banned and renamed three.js APIs (PLAN.md Appendix B; doctrine: Mastery), scoped by path, each message
 * naming the replacement: legacy and fragile APIs, names from releases newer than the pinned r182, r182's
 * deprecations (any deprecation warning fails a test anyway), and GPU readbacks outside the two files allowed them.
 *
 * Scope: code under `engine/`, `labs/` and `fixtures/`, tests included. A name that is distinctive is banned as an
 * identifier wherever it appears; a common word (`equals`, `label`, `screen`) only as an import from `three/tsl`, as
 * `TSL.<name>`, or, for node methods (`.label()`, `.cache()`), inside `engine/gfx/`, the only layer that imports TSL.
 * Also: no bare `three` import (Node would load the WebGL build; §6.10), and no `eval` or `new Function`.
 *
 * Invariants: path exceptions are zones (family.ts): `mrt()` only in `engine/gfx/post/mrt.ts`, readbacks only in
 * `engine/gfx/shot.ts` and `engine/gfx/enhanced/timing.ts`, renderer internals only in `engine/gfx/pipelines.ts`, and
 * `positionLocal` banned in the outline material, whose pushes need the pre-instancing position.
 *
 * @example
 * // engine/gfx/post/bloom.ts: renderer.renderAsync(scene, camera);
 * // → banned/no-restricted-properties: r181 deprecated the async forms: await renderer.init() once, then render() …
 * @see tools/eslint/banned.test.ts
 */
import type { Linter } from 'eslint';
import { family, zoned, type Ban } from './family';

/** The plugin the banned-API blocks use: core's restriction rules as `banned/<rule>`. */
export const bannedPlugin = family(
  'banned',
  'no-restricted-imports',
  'no-restricted-syntax',
  'no-restricted-properties',
);

/** Where the bans apply. */
export const BANNED_FILES = ['engine/**', 'labs/**', 'fixtures/**'];

const GFX = 'engine/gfx/';
const READBACK_FILES = ['engine/gfx/shot.ts', 'engine/gfx/enhanced/timing.ts'];
const r182 = (what: string, use: string) => `${what} is deprecated in three.js r182: use ${use} (Appendix B)`;
const newer = (name: string, use: string) => `${name} is not in the pinned three.js r182: ${use} (Appendix B)`;
/** An identifier ban: the name anywhere (imports, members, types). */
const identifier = (names: string[], message: string, scope: Partial<Ban> = {}): Ban => ({
  selector: `Identifier[name=/^(${names.join('|')})$/]`,
  message,
  ...scope,
});
/** A call of a method named `name` (`x.name(…)`), with `args` arguments when given. */
const method = (name: string, message: string, args?: number): Ban => ({
  selector: `CallExpression${args === undefined ? '' : `[arguments.length=${args}]`}[callee.property.name='${name}']`,
  message,
  only: [GFX],
});

/** TSL functions whose names are common words: banned as imports from `three/tsl` and as `TSL.<name>`. */
const TSL_WORDS: Record<string, string> = {
  atan2: r182('atan2(y, x)', 'atan(y, x)'),
  equals: r182('equals', 'equal (inside a vector: bvec*(equal(…)))'),
  burn: r182('burn', 'blendBurn'),
  dodge: r182('dodge', 'blendDodge'),
  overlay: r182('overlay', 'blendOverlay'),
  screen: r182('screen', 'blendScreen'),
  append: r182('append', 'Stack, or .toStack()'),
  label: r182('label()', 'setName()'),
  cache: r182('cache()', '.isolate() (r182: three/tsl exports no named isolate)'),
  PI2: r182('PI2', 'TWO_PI'),
};

/** `banned/no-restricted-imports`: the bare entry, the import names and the WebGL-only paths. */
const IMPORTS = {
  paths: [
    {
      name: 'three',
      message:
        "import three.js as 'three/webgpu' (or 'three/tsl', 'three/addons/*'): Vite maps a bare 'three' to three/webgpu, but Node loads the WebGL build (PLAN.md §6.10)",
    },
    {
      name: 'three/webgpu',
      importNames: ['Clock'],
      message:
        'Clock is deprecated from r183: use core/time for sim time, or Timer inside engine/gfx/ only (Appendix B)',
    },
    ...Object.entries(TSL_WORDS).map(([name, message]) => ({ name: 'three/tsl', importNames: [name], message })),
    {
      name: '@dimforge/rapier3d-compat',
      message:
        'use engine/physics (@dimforge/rapier3d-simd-compat 0.21); rapier3d-compat 0.12 is only in the lockfile because @types/three pulls it in (tools/deps.json)',
    },
  ],
  patterns: [
    {
      regex: '^three/(?:examples/jsm|addons)/postprocessing/',
      caseSensitive: true,
      message:
        "EffectComposer's post-processing is WebGL-only: use PostProcessing with the TSL display nodes from 'three/addons/tsl/display/*' (Appendix B)",
    },
    {
      regex: '^three/examples/jsm/(?!postprocessing/)',
      caseSensitive: true,
      message: "import three.js's addons as 'three/addons/*', the path the engine uses everywhere (PLAN.md §6.10)",
    },
  ],
};

const INSTANCE_USAGE =
  "CallExpression[callee.property.name='setUsage'][callee.object.property.name=/^instance(Matrix|Color)$/]";

/** `banned/no-restricted-syntax`, zoned. */
const SYNTAX: Ban[] = [
  identifier(
    ['WebGLRenderer', 'WebGLBackend', 'forceWebGL'],
    'WebGPU is the only renderer: use WebGPURenderer, on WebGPU only, with no WebGL fallback (PLAN.md §6.7, Appendix B)',
  ),
  identifier(
    ['ShaderMaterial', 'RawShaderMaterial'],
    'use node materials and TSL inside engine/gfx/, and material data in game code (Appendix B)',
  ),
  identifier(
    ['onBeforeCompile'],
    'WebGPURenderer never runs onBeforeCompile: use node inputs (colorNode, positionNode…) (Appendix B)',
  ),
  identifier(
    ['EffectComposer'],
    "use PostProcessing with the TSL display nodes from 'three/addons/tsl/display/*' (Appendix B)",
  ),
  identifier(['RenderPipeline'], newer('RenderPipeline (r183)', 'use PostProcessing')),
  identifier(
    ['DynamicLighting', 'ClusteredLighting'],
    newer('this lighting class', 'use the light pool (WP 7.1), or the TiledLighting addon (WP 11.5)'),
  ),
  identifier(['TextureSource'], newer('TextureSource', 'r182 calls it Source')),
  identifier(['packNormalToRGB'], newer('packNormalToRGB', 'use directionToColor')),
  identifier(['unpackRGBToNormal'], newer('unpackRGBToNormal', 'use colorToDirection')),
  identifier(['negateOnBackSide'], newer('negateOnBackSide', 'use directionToFaceDirection')),
  identifier(['GodraysNode'], newer('GodraysNode', 'write a custom TSL pass when a look needs one')),
  identifier(['modInt'], r182('modInt', 'mod(int(…))')),
  identifier(['rangeFog'], r182('rangeFog(c, n, f)', 'fog(c, rangeFogFactor(n, f))')),
  identifier(['densityFog'], r182('densityFog(c, d)', 'fog(c, densityFogFactor(d))')),
  identifier(['viewportResolution'], r182('viewportResolution', 'screenSize')),
  identifier(['transformedNormalView'], r182('transformedNormalView', 'normalView')),
  identifier(['transformedNormalWorld'], r182('transformedNormalWorld', 'normalWorld')),
  identifier(['transformedClearcoatNormalView'], r182('transformedClearcoatNormalView', 'clearcoatNormalView')),
  identifier(['storageObject'], r182('storageObject', 'storage().setPBO(true)')),
  {
    selector: `MemberExpression[object.name='TSL'][property.name=/^(${Object.keys(TSL_WORDS).join('|')})$/]`,
    message: `a TSL function deprecated in r182: ${Object.entries(TSL_WORDS)
      .map(([name, message]) => `${name} → ${message.split(': use ')[1].replace(' (Appendix B)', '')}`)
      .join('; ')} (Appendix B)`,
  },
  {
    selector: `${INSTANCE_USAGE}:matches([arguments.0.name='DynamicDrawUsage'], [arguments.0.property.name='DynamicDrawUsage'])`,
    message:
      'use the instancing service, which keeps StaticDrawUsage with update ranges: r182 loses dynamic-usage updates above 1,000 instances (PLAN.md §4.7, Appendix B)',
  },
  {
    selector: "CallExpression:matches([callee.name='mrt'], [callee.property.name=/^(mrt|setMRT)$/])",
    message:
      'the MRT is fixed and set up once, in engine/gfx/post/mrt.ts: change per-object flags through uniforms, never the outputs (PLAN.md §6.7)',
    except: ['engine/gfx/post/mrt.ts'],
  },
  {
    selector:
      'MemberExpression[property.name=/^_/]:matches([object.name=/^(renderer|backend)$/], [object.property.name=/^(renderer|backend)$/])',
    message:
      "read the renderer's internals only in engine/gfx/pipelines.ts, through its public pipeline counter (Appendix B)",
    except: ['engine/gfx/pipelines.ts'],
  },
  {
    // A light's own custom shadow node (`light.shadow.shadowNode`) is current r182 API; a material's is deprecated.
    selector:
      "MemberExpression[property.name='shadowNode']:not([object.name='shadow'], [object.property.name='shadow'])",
    message: r182('material.shadowNode', 'castShadowNode'),
  },
  identifier(
    ['positionLocal'],
    'r182 assigns the instance-transformed position to positionLocal: push the outline along positionGeometry (PLAN.md §4.1, Appendix B)',
    { only: ['engine/gfx/materials/outline.ts'] },
  ),
  {
    selector: "CallExpression[callee.name='eval'], :matches(CallExpression, NewExpression)[callee.name='Function']",
    message:
      'no eval or new Function in the engine: write the code, or describe the behaviour as data an entry reads (Appendix B)',
  },
  method('append', r182('.append()', '.toStack()'), 0),
  method('label', r182('.label()', '.setName()')),
  method('cache', r182('.cache()', '.isolate()')),
  method('varying', r182('.varying()', '.toVarying()')),
  method('vertexStage', r182('.vertexStage()', '.toVertexStage()')),
  method('uv', r182('texture(…).uv(u)', '.sample(u)'), 1),
  {
    selector: 'CallExpression[callee.property.name=/^(set|get)Resolution$/][callee.object.name=/([Pp]ass|Node)$/]',
    message: r182("PassNode's setResolution() and getResolution()", 'setResolutionScale() and getResolutionScale()'),
    only: [GFX],
  },
  {
    selector:
      ":matches(CallExpression[callee.name='reflector'] Property[key.name='resolution'], MemberExpression[property.name='resolution'][object.name=/[Rr]eflector/])",
    message: r182("ReflectorNode's resolution", 'resolutionScale'),
    only: [GFX],
  },
];

/** An async render or clear method r181 deprecated, and its synchronous form. */
const asyncForm = (property: string, use: string): Ban => ({
  property,
  message: `r181 deprecated the async forms: await renderer.init() once, then ${use} (Appendix B)`,
});

/** `banned/no-restricted-properties`, zoned. */
const PROPERTIES: Ban[] = [
  asyncForm('renderAsync', 'render()'),
  asyncForm('clearAsync', 'clear()'),
  asyncForm('clearColorAsync', 'clearColor()'),
  asyncForm('clearDepthAsync', 'clearDepth()'),
  asyncForm('clearStencilAsync', 'clearStencil()'),
  asyncForm('initTextureAsync', 'initTexture()'),
  asyncForm('hasFeatureAsync', 'hasFeature()'),
  asyncForm('fromSceneAsync', 'fromScene()'),
  asyncForm('fromEquirectangularAsync', 'fromEquirectangular()'),
  asyncForm('fromCubemapAsync', 'fromCubemap()'),
  {
    property: 'waitForGPU',
    message: 'r181 removed waitForGPU(): await renderer.init() once; compileAsync() is the warm-up (Appendix B)',
  },
  {
    property: 'renderMultiDrawInstances',
    message: 'use renderMultiDraw with indirection: r184 removes renderMultiDrawInstances (Appendix B)',
  },
  ...['readRenderTargetPixels', 'getImageData', 'readPixels'].map((property) => ({
    property,
    message: `${property} reads the GPU synchronously: use readRenderTargetPixelsAsync, and only in engine/gfx/shot.ts (Appendix B)`,
  })),
  ...['readRenderTargetPixelsAsync', 'getArrayBufferAsync'].map((property) => ({
    property,
    message: `GPU results never reach the sim: ${property} is allowed only in engine/gfx/shot.ts and engine/gfx/enhanced/timing.ts (Appendix B)`,
    except: READBACK_FILES,
  })),
  { property: 'shadowPositionNode', message: r182('material.shadowPositionNode', 'receivedShadowPositionNode') },
  { property: 'getColorBufferType', message: r182('renderer.getColorBufferType()', 'getOutputBufferType()') },
  {
    property: 'fromWorkingColorSpace',
    message: r182('ColorManagement.fromWorkingColorSpace()', 'workingToColorSpace()'),
  },
  { property: 'toWorkingColorSpace', message: r182('ColorManagement.toWorkingColorSpace()', 'colorSpaceToWorking()') },
  {
    property: 'parseAnimation',
    message: r182('AnimationClip.parseAnimation()', 'clips built from data through the clip layer (r185 removes it)'),
  },
];

/** The banned-API blocks: imports over every file in scope, then syntax and properties by zone. */
export function bannedBlocks(): Linter.Config[] {
  return [
    {
      name: 'banned: imports',
      files: BANNED_FILES,
      plugins: { banned: bannedPlugin },
      rules: { 'banned/no-restricted-imports': ['error', IMPORTS] },
    },
    ...zoned('banned: syntax', bannedPlugin, 'banned/no-restricted-syntax', SYNTAX, BANNED_FILES),
    ...zoned('banned: properties', bannedPlugin, 'banned/no-restricted-properties', PROPERTIES, BANNED_FILES),
  ];
}
