/**
 * @file The public pipeline counter (PLAN.md §6.7, §8.7, I-18, Appendix B): how many GPU pipelines and shader modules
 * the renderer has built, so "0 pipelines built after warm-up" is a number tests assert, never a hope. WebGPU's
 * `renderer.info` has no program count (§8.7), so `countPipelines(device)` counts at the device: before three.js ever
 * sees it, it wraps the device's `createRenderPipeline`, `createRenderPipelineAsync`, `createComputePipeline`,
 * `createComputePipelineAsync` and `createShaderModule` with forwarders that count each call. That counts every
 * pipeline the GPU builds, three.js's own (output, copy and mipmap passes) included, and depends on no three.js
 * internals. `count(renderer)` adds how many pipelines three.js holds in its cache now, read from
 * `renderer._pipelines`.
 *
 * This is the one module that reads the renderer's internals (ESLint bans it elsewhere): the pipeline cache and the
 * node frame. Measured on r182 (WP 2.1): the cache shrinks when pipelines are released and grows again when they are
 * rebuilt, so `cached` is a live count, never a build count; that is why builds are counted at the device. And r182
 * starts a new node frame only in its own requestAnimationFrame loop, so a frame drawn off that loop (a warm frame, a
 * test's frame) would reuse the last picture of every node updated once per frame, a post pass's scene among them:
 * `advanceFrame(renderer)` starts one, and the renderer's `frame()` calls it first. `checkPinned(renderer)` lists what
 * no longer matches r182's internals: another revision, no `_pipelines` with its `caches` and `programs` maps, or no
 * `_nodes.nodeFrame.update`. When they do not match, `cached` is null, no frame is advanced, and advice
 * `GFX_PIPELINES_UNPINNED` says so once; the device counts still hold.
 *
 * Invariants: counts only grow; one counter per device (a second call returns the first), so everything that asks
 * reads the same numbers.
 *
 * @example
 * const counted = countPipelines({ createShaderModule: () => ({}) } as unknown as GPUDevice);
 * counted.count().built; // 0 until the device builds a pipeline
 * @see engine/gfx/pipelines.test.ts
 * @see tests/e2e/renderer.spec.ts
 */
/// <reference types="@webgpu/types" />
import { REVISION, type WebGPURenderer } from 'three/webgpu';
import { defineCodes, log as sharedLog, type Log } from '../core/log';

/** The codes this module raises, with their fixes. */
export const PIPELINES_CODES = defineCodes('gfx', {
  GFX_PIPELINES_UNPINNED: {
    template: "three.js r{revision}'s renderer internals differ from r182's: {problems}",
    fix: "re-pin engine/gfx/pipelines.ts to the new release's internals (its pin test names what changed); the device's pipeline counts stay exact meanwhile",
    doc: "Advice from the pipeline counter (engine/gfx/pipelines.ts) when `renderer._pipelines` no longer has r182's shape, usually after a three.js upgrade: the count of pipelines three.js keeps cached is then unknown (null). Builds are counted at the device and stay exact.",
  },
});

/** The three.js release whose internals this module reads. */
export const PINNED_REVISION = '182';

/** What the counter reports. */
export interface PipelineCount {
  /** Render and compute pipelines the device built since the counter started, sync and async: only grows. */
  built: number;
  /** Of `built`, the render pipelines. */
  render: number;
  /** Of `built`, the compute pipelines. */
  compute: number;
  /** Shader modules the device compiled. */
  shaders: number;
  /** Pipelines three.js holds in its cache now (fewer once materials are disposed); null when unreadable. */
  cached: number | null;
}

/** The counter of one device. */
export interface PipelineCounter {
  /** The counts so far; with `renderer`, also what three.js holds cached. */
  count(renderer?: WebGPURenderer): PipelineCount;
}

/** The internals read here, as r182 has them (`src/renderers/common/Pipelines.js`). */
interface PipelinesInternals {
  caches: Map<string, unknown>;
  programs: { vertex: Map<string, unknown>; fragment: Map<string, unknown>; compute: Map<string, unknown> };
}

/** The device methods counted, by which count they add to. */
const COUNTED = {
  createRenderPipeline: 'render',
  createRenderPipelineAsync: 'render',
  createComputePipeline: 'compute',
  createComputePipelineAsync: 'compute',
  createShaderModule: 'shaders',
} as const;

/** One counter per device. */
const COUNTERS = new WeakMap<GPUDevice, PipelineCounter>();

/** `renderer._pipelines` if it has r182's shape, else the problems found. */
function internals(renderer: WebGPURenderer): PipelinesInternals | string[] {
  const pipelines = (renderer as unknown as { _pipelines?: Partial<PipelinesInternals> | null })._pipelines;
  if (!pipelines) return ['renderer._pipelines is missing (call it after `await renderer.init()`)'];
  const problems: string[] = [];
  if (!(pipelines.caches instanceof Map)) problems.push('renderer._pipelines.caches is not a Map');
  for (const stage of ['vertex', 'fragment', 'compute'] as const) {
    if (!(pipelines.programs?.[stage] instanceof Map))
      problems.push(`renderer._pipelines.programs.${stage} is not a Map`);
  }
  return problems.length ? problems : (pipelines as PipelinesInternals);
}

/** `renderer._nodes.nodeFrame`, as r182 keeps it, or null. */
function nodeFrameOf(renderer: WebGPURenderer): { update(): void } | null {
  const frame = (renderer as unknown as { _nodes?: { nodeFrame?: { update?: unknown } } })._nodes?.nodeFrame;
  return typeof frame?.update === 'function' ? (frame as { update(): void }) : null;
}

/**
 * Starts a new frame for three.js's nodes, so a post pass and every other node updated once per frame draws afresh,
 * also off r182's own animation-frame loop. False when the internals are not r182's (`checkPinned` says why).
 */
export function advanceFrame(renderer: WebGPURenderer): boolean {
  const frame = nodeFrameOf(renderer);
  frame?.update();
  return frame !== null;
}

/**
 * What no longer matches the r182 internals this module reads: another three.js revision, `renderer._pipelines`
 * without its `caches` and `programs` maps, or no `renderer._nodes.nodeFrame.update`. `[]` when this module is pinned
 * to the running three.js. Call after `init()`.
 */
export function checkPinned(renderer: WebGPURenderer, revision: string = REVISION): string[] {
  const read = internals(renderer);
  const problems = Array.isArray(read) ? [...read] : [];
  if (!nodeFrameOf(renderer)) problems.push('renderer._nodes.nodeFrame.update is not a function');
  if (revision !== PINNED_REVISION)
    problems.unshift(`three.js is r${revision}, the counter reads r${PINNED_REVISION}'s internals`);
  return problems;
}

/**
 * The counter of `device`, made on first call: wraps the device's pipeline and shader-module methods with counting
 * forwarders. Call it before three.js gets the device, or the builds before are not counted.
 */
export function countPipelines(device: GPUDevice, options: { log?: Log } = {}): PipelineCounter {
  const known = COUNTERS.get(device);
  if (known) return known;
  const log = options.log ?? sharedLog;
  const counts = { render: 0, compute: 0, shaders: 0 };
  const methods = device as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const [name, kind] of Object.entries(COUNTED)) {
    const original = methods[name];
    if (typeof original !== 'function') continue;
    methods[name] = (...args: unknown[]) => {
      counts[kind]++;
      return original.apply(device, args);
    };
  }
  const counter: PipelineCounter = {
    count(renderer) {
      let cached: number | null = null;
      // Before `init()` there is no cache to read yet: null, without advice.
      if (renderer && (renderer as unknown as { _initialized?: boolean })._initialized !== false) {
        const read = internals(renderer);
        if (Array.isArray(read))
          log.warnOnce('GFX_PIPELINES_UNPINNED', { revision: REVISION, problems: read.join('; ') });
        else cached = read.caches.size;
      }
      return { built: counts.render + counts.compute, ...counts, cached };
    },
  };
  COUNTERS.set(device, counter);
  return counter;
}
