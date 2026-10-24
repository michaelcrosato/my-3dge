/**
 * @file GPU timing (PLAN.md WP 11.2, §4.7; doctrine: Verifiable): how long the GPU spends on a drawn frame, from
 * WebGPU's timestamp queries, where the device has `timestamp-query` (`feature:timestamps`, engine/gfx/features.ts).
 * three.js r182 brackets every render and compute pass with a pair of queries when its renderer is made with
 * `trackTimestamp` (engine/gfx/renderer.ts asks for it when the feature is on). What r182 does, pinned by the tests:
 * each pass's queries carry its frame's id (`info.frame`: r182's loop sets it each animation frame, engine/gfx/
 * pipelines.ts `advanceFrame` before each frame the engine draws); `resolveTimestampsAsync(type)` reads every pass
 * queried since the last read and gives the milliseconds of the latest frame's, or, when none was queried, the last
 * read's again; it keeps each pass's time in its pools' `timestamps`, never pruned; a pool holds 2,048 queries and
 * warns past them; and a pass is queried only while its backend's `trackTimestamp` is true, which it reads as the pass
 * begins and as a read starts, the read emptying the pools before it returns.
 *
 * `createGpuTiming(renderer, on)` reads after each drawn frame (`afterFrame()`) when no read is in flight, a type only
 * when it ran since (its `info` calls grew), so each read gives one frame's time: its passes', render and compute. It
 * keeps the last `GPU_WINDOW` of them; `gpuMs()` is their mean: null before the first, undefined when the feature is
 * off (the stats leave `gpuMs` out; `GFX_NO_TIMESTAMPS` said why when the renderer started). While a read is in flight
 * the renderer queries nothing (`trackTimestamp` false), so frames drawn meanwhile never fill a pool, however many:
 * the virtual clock's `tick(n)` draws n frames in one task, before any read can come back. After each read it empties
 * the pools' `timestamps`, which would otherwise grow by every pass of every frame. Passes outside the frames (a
 * warm-up's, a shot's) must not count as a frame's: `taint()` discards the next read, and `drain()` starts one,
 * discarded, so a run of shots never fills a pool.
 *
 * Invariants: presentation only, never read by the sim; reads never overlap, and none is in flight while the renderer
 * queries; a page that draws with the renderer outside `frame()` calls `afterFrame()` itself (labs/hello does). The
 * platform's SwiftShader adapter has timestamp queries, but its times are a CPU's emulating a GPU (§4.7): a measure to
 * compare runs, not hardware.
 *
 * @example
 * // browser: it needs a page's renderer (tests/e2e/timing.spec.ts runs it)
 * // const timing = createGpuTiming(renderer, gfx.features.on.includes('feature:timestamps'));
 * // after each drawn frame: timing.afterFrame(); then timing.gpuMs(); // 0.84: the last frames' mean, ms
 * @see engine/gfx/enhanced/timing.test.ts
 * @see tests/e2e/timing.spec.ts
 */

/** How many frames the mean covers: as many as `stats()`'s other means. */
export const GPU_WINDOW = 60;

/** The query types three.js times: render passes and compute passes. */
const TYPES = ['render', 'compute'] as const;

/** A renderer's GPU timing (see the file comment). */
export interface GpuTiming {
  /** Whether it measures: the feature is on. */
  readonly on: boolean;
  /** After each drawn frame: starts a read when none is in flight. */
  afterFrame(): void;
  /** The passes since the last read include some outside the frames: the next read is discarded. */
  taint(): void;
  /** Starts a read now when none is in flight, discarded (after a shot): the pools stay small. */
  drain(): void;
  /** The mean GPU ms a frame over the last reads; null before the first, undefined when off. */
  gpuMs(): number | null | undefined;
}

/** What it reads of a renderer (three.js's `WebGPURenderer`): the timestamp read, the pass counts, the query pools. */
export interface TimedRenderer {
  resolveTimestampsAsync(type: (typeof TYPES)[number]): Promise<number | undefined>;
  readonly info: { readonly render: { readonly calls: number }; readonly compute: { readonly calls: number } };
  readonly backend: object;
}

/** Empties the pools' record of every pass's time, which r182 never prunes (see the file comment). */
function prune(renderer: TimedRenderer): void {
  type Pools = { timestampQueryPool?: Record<string, { timestamps?: unknown } | null> };
  for (const pool of Object.values((renderer.backend as Pools).timestampQueryPool ?? {}))
    if (pool?.timestamps instanceof Map) pool.timestamps.clear();
}

/** Turns r182's queries on or off for the passes that begin from now (see the file comment). */
function track(renderer: TimedRenderer, on: boolean): void {
  (renderer.backend as { trackTimestamp: boolean }).trackTimestamp = on;
}

/** Makes a renderer's GPU timing, measuring when `on` (see the file comment). */
export function createGpuTiming(renderer: TimedRenderer, on: boolean, window = GPU_WINDOW): GpuTiming {
  const samples: number[] = [];
  const seen = { render: 0, compute: 0 }; // each type's passes counted at the last read
  let [reading, discard] = [false, true]; // the first read holds the warm-up's passes
  const read = (keep: boolean) => {
    if (!on || reading) return void (discard ||= !keep);
    const ran = TYPES.filter((type) => renderer.info[type].calls !== seen[type]);
    if (!ran.length) return;
    for (const type of ran) seen[type] = renderer.info[type].calls;
    const drop = discard || !keep;
    [reading, discard] = [true, false];
    const reads = ran.map((type) => renderer.resolveTimestampsAsync(type)); // each has emptied its pool
    track(renderer, false); // till it is back: the frames drawn meanwhile query nothing
    void Promise.all(reads)
      .then((times) => {
        const ms = times.reduce<number>((sum, time) => sum + (time ?? 0), 0);
        if (!drop && Number.isFinite(ms) && samples.push(ms) > window) samples.shift();
      })
      .catch(() => undefined) // a lost device: the stats keep their last samples
      .finally(() => {
        prune(renderer);
        track(renderer, true);
        reading = false;
      });
  };
  return {
    on,
    afterFrame: () => read(true),
    taint() {
      discard = true;
    },
    drain: () => read(false),
    gpuMs() {
      if (!on) return undefined;
      return samples.length
        ? Math.round((samples.reduce((sum, ms) => sum + ms, 0) / samples.length) * 1e4) / 1e4
        : null;
    },
  };
}
