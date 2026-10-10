/**
 * @file Unit tests for the pipeline counter (`engine/gfx/pipelines.ts`): it counts the pipelines and shader modules a
 * device builds, forwarding every call; it reads three.js's pipeline cache and advances its node frame only while
 * they have r182's shape, saying so otherwise; and the pin: the installed three.js is r182 and its sources still
 * hold the fields this module reads, so the test fails when an upgrade changes them. The real renderer is pinned
 * the same way by tests/e2e/renderer.spec.ts.
 */
import { readFileSync } from 'node:fs';
import { REVISION, type WebGPURenderer } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createLog } from '../core/log';
import { advanceFrame, checkPinned, countPipelines, PINNED_REVISION } from './pipelines';

/** A stand-in device whose methods return what they were given, tagged. */
function device() {
  const make = (kind: string) => (descriptor: unknown) => ({ kind, descriptor });
  const makeAsync = (kind: string) => async (descriptor: unknown) => ({ kind, descriptor });
  return {
    createRenderPipeline: make('render'),
    createRenderPipelineAsync: makeAsync('render'),
    createComputePipeline: make('compute'),
    createComputePipelineAsync: makeAsync('compute'),
    createShaderModule: make('shader'),
  };
}

/** A stand-in renderer with r182's internals: `cached` pipelines in the cache, and a node frame. */
function renderer(cached = 2) {
  const frames = { count: 0 };
  const fake = {
    _initialized: true,
    _pipelines: {
      caches: new Map(Array.from({ length: cached }, (_, i) => [`key${i}`, {}])),
      programs: { vertex: new Map(), fragment: new Map(), compute: new Map() },
    },
    _nodes: { nodeFrame: { update: () => frames.count++ } },
  };
  return { frames, fake, renderer: fake as unknown as WebGPURenderer };
}

/** A log that records what it prints. */
function quietLog() {
  const printed: string[] = [];
  return { printed, log: createLog({ console: { warn: (line) => printed.push(line), error: () => {} } }) };
}

describe('countPipelines', () => {
  it('counts render and compute pipelines, sync and async, and shader modules, forwarding each call', async () => {
    const gpu = device();
    const counter = countPipelines(gpu as unknown as GPUDevice);
    expect(gpu.createRenderPipeline({ a: 1 })).toEqual({ kind: 'render', descriptor: { a: 1 } });
    expect(await gpu.createRenderPipelineAsync({ b: 2 })).toEqual({ kind: 'render', descriptor: { b: 2 } });
    gpu.createComputePipeline({});
    await gpu.createComputePipelineAsync({});
    gpu.createShaderModule({});
    gpu.createShaderModule({});
    expect(counter.count()).toEqual({ built: 4, render: 2, compute: 2, shaders: 2, cached: null });
    expect(countPipelines(gpu as unknown as GPUDevice), 'one counter per device').toBe(counter);
  });

  it("reads three.js's cache size while it has r182's shape", () => {
    const counter = countPipelines(device() as unknown as GPUDevice);
    expect(counter.count(renderer(3).renderer).cached).toBe(3);
  });

  it('reads nothing before init(), quietly, and says once when the internals changed', () => {
    const { printed, log } = quietLog();
    const counter = countPipelines(device() as unknown as GPUDevice, { log });
    const { fake, renderer: early } = renderer();
    fake._initialized = false;
    expect(counter.count(early).cached).toBeNull();
    expect(printed).toEqual([]);
    const changed = { _initialized: true, _pipelines: { caches: {}, programs: {} } } as unknown as WebGPURenderer;
    expect(counter.count(changed).cached).toBeNull();
    counter.count(changed);
    expect(printed).toEqual([expect.stringMatching(/^\[GFX_PIPELINES_UNPINNED\] three\.js r\d+'s renderer internals/)]);
  });
});

describe('advanceFrame', () => {
  it("starts a new node frame through r182's internals, or reports it cannot", () => {
    const { frames, renderer: fake } = renderer();
    expect(advanceFrame(fake)).toBe(true);
    expect(frames.count).toBe(1);
    expect(advanceFrame({} as WebGPURenderer)).toBe(false);
  });
});

describe('checkPinned', () => {
  it("finds nothing amiss on r182's shape, and names each difference otherwise", () => {
    expect(checkPinned(renderer().renderer, '182')).toEqual([]);
    expect(checkPinned(renderer().renderer, '183')).toEqual(["three.js is r183, the counter reads r182's internals"]);
    expect(checkPinned({} as WebGPURenderer, '182')).toEqual([
      'renderer._pipelines is missing (call it after `await renderer.init()`)',
      'renderer._nodes.nodeFrame.update is not a function',
    ]);
  });
});

describe('the pin to r182', () => {
  /** A three.js source file as installed. */
  const source = (path: string) => readFileSync(`node_modules/three/src/${path}`, 'utf8');

  it('runs on the release whose internals it reads', () => {
    expect(REVISION).toBe(PINNED_REVISION);
  });

  it("finds the fields it reads in the installed three.js's sources", () => {
    const renderer = source('renderers/common/Renderer.js');
    expect(renderer).toContain('this._pipelines = new Pipelines( backend, this._nodes );');
    expect(renderer).toContain('this._nodes = new Nodes( this, backend );');
    const pipelines = source('renderers/common/Pipelines.js');
    expect(pipelines).toContain('this.caches = new Map();');
    expect(pipelines).toMatch(
      /this\.programs = \{\s+vertex: new Map\(\),\s+fragment: new Map\(\),\s+compute: new Map\(\)/,
    );
    expect(source('renderers/common/nodes/Nodes.js')).toContain('this.nodeFrame = new NodeFrame();');
    expect(source('nodes/core/NodeFrame.js')).toMatch(/update\(\) \{\s+this\.frameId \+\+;/);
    // A node frame advances only in r182's own requestAnimationFrame loop (and compileAsync): why advanceFrame exists.
    expect(source('renderers/common/Animation.js')).toContain('this.nodes.nodeFrame.update();');
  });
});
