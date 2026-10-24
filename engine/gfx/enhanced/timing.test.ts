/**
 * @file Unit tests for the GPU timing (engine/gfx/enhanced/timing.ts), against a stand-in renderer whose timestamp
 * reads resolve when the test says: off, it never reads and reports nothing; on, the first read (the warm-up's) is
 * discarded, then each read is a frame's time, render and compute, a type read only when it ran; reads never overlap,
 * and while one is in flight the renderer queries nothing; a taint or a drain discards a read; the mean covers the
 * last reads; three's record of every pass is emptied after each read; a failed read keeps the samples. And the pin:
 * r182's sources still behave as the module expects.
 * The real renderer is tests/e2e/timing.spec.ts's.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createGpuTiming, type TimedRenderer } from './timing';

/** A stand-in renderer: `draw` counts passes; each read waits for `settle(ms)` (or `fail()`) in the order asked. */
function standIn() {
  const pending: { type: string; resolve(ms: number): void; reject(error: Error): void }[] = [];
  const timestamps = new Map([['r:0:1:f1', 1]]);
  const renderer = {
    info: { render: { calls: 0 }, compute: { calls: 0 } },
    backend: { trackTimestamp: true, timestampQueryPool: { render: { timestamps }, compute: null } },
    resolveTimestampsAsync: (type: string) =>
      new Promise<number | undefined>((resolve, reject) => pending.push({ type, resolve, reject })),
  };
  /** Settles the oldest read's types with `ms` each, then lets its callbacks run. */
  const settle = async (...ms: number[]) => {
    for (const value of ms) pending.shift()!.resolve(value);
    await new Promise((done) => setTimeout(done, 0));
  };
  const fail = async () => {
    pending.shift()!.reject(new Error('device lost'));
    await new Promise((done) => setTimeout(done, 0));
  };
  const draw = (compute = 0) => {
    renderer.info.render.calls += 2; // a scene pass and the output pass
    renderer.info.compute.calls += compute;
  };
  const tracking = () => renderer.backend.trackTimestamp;
  return { renderer: renderer as TimedRenderer, pending, timestamps, settle, fail, draw, tracking };
}

describe('GPU timing', () => {
  it('off, never reads and reports nothing', () => {
    const { renderer, pending, draw } = standIn();
    const timing = createGpuTiming(renderer, false);
    draw();
    timing.afterFrame();
    timing.drain();
    expect(pending).toEqual([]);
    expect(timing.gpuMs()).toBeUndefined();
  });

  it('discards the first read (the warm-up’s), then takes each read as a frame’s time, render and compute', async () => {
    const { renderer, pending, settle, draw } = standIn();
    const timing = createGpuTiming(renderer, true);
    draw();
    timing.afterFrame();
    await settle(9);
    expect(timing.gpuMs()).toBeNull();
    draw();
    timing.afterFrame();
    expect(pending.map((read) => read.type)).toEqual(['render']); // compute did not run: r182 would repeat its last
    await settle(2);
    draw(1);
    timing.afterFrame();
    expect(pending.map((read) => read.type)).toEqual(['render', 'compute']);
    await settle(3, 1);
    expect(timing.gpuMs()).toBe(3); // (2 + 4) / 2
  });

  it('never overlaps reads, and queries nothing while one is in flight: the frames drawn meanwhile fill no pool', async () => {
    const { renderer, pending, settle, draw, tracking } = standIn();
    const timing = createGpuTiming(renderer, true);
    draw();
    timing.afterFrame();
    expect(tracking()).toBe(false);
    await settle(9);
    expect(tracking()).toBe(true);
    draw();
    timing.afterFrame();
    for (let k = 0; k < 2000; k++) {
      draw(); // the virtual clock's tick(2000): every frame in one task, the read still out
      timing.afterFrame();
      expect(tracking()).toBe(false);
    }
    expect(pending).toHaveLength(1);
    await settle(1.5);
    expect(tracking()).toBe(true);
    draw();
    timing.afterFrame();
    expect(pending).toHaveLength(1);
    await settle(2.5);
    expect(timing.gpuMs()).toBe(2);
  });

  it('discards the read after a taint, and a drain’s: the passes outside the frames never count', async () => {
    const { renderer, pending, settle, draw } = standIn();
    const timing = createGpuTiming(renderer, true);
    draw();
    timing.afterFrame();
    await settle(9);
    draw(); // a shot's passes
    timing.taint();
    timing.drain();
    expect(pending).toHaveLength(1);
    await settle(50);
    draw();
    timing.afterFrame();
    await settle(2);
    expect(timing.gpuMs()).toBe(2);
    draw();
    timing.afterFrame();
    draw(); // a shot while that read is in flight: its passes go to the next read, which is discarded
    timing.taint();
    timing.drain();
    await settle(4);
    draw();
    timing.afterFrame();
    await settle(70);
    expect(timing.gpuMs()).toBe(3);
    timing.drain(); // nothing drawn since: nothing to read
    expect(pending).toEqual([]);
  });

  it('keeps the last `window` reads, rounds the mean, and empties three’s record of every pass after each read', async () => {
    const { renderer, timestamps, settle, draw } = standIn();
    const timing = createGpuTiming(renderer, true, 3);
    draw();
    timing.afterFrame();
    await settle(9);
    expect(timestamps.size).toBe(0);
    for (const ms of [1, 2, 3, 4.123456]) {
      draw();
      timing.afterFrame();
      timestamps.set(`r:0:1:f${ms}`, ms);
      await settle(ms);
    }
    expect(timing.gpuMs()).toBe(3.0412); // (2 + 3 + 4.123456) / 3
    expect(timestamps.size).toBe(0);
  });

  it('keeps its samples when a read fails (a lost device), and reads again after', async () => {
    const { renderer, pending, settle, fail, draw, tracking } = standIn();
    const timing = createGpuTiming(renderer, true);
    draw();
    timing.afterFrame();
    await settle(9);
    draw();
    timing.afterFrame();
    await settle(2);
    draw();
    timing.afterFrame();
    await fail();
    expect(timing.gpuMs()).toBe(2);
    expect(tracking()).toBe(true);
    draw();
    timing.afterFrame();
    expect(pending).toHaveLength(1);
  });
});

describe('the pin to r182', () => {
  /** A three.js source file as installed. */
  const source = (path: string) => readFileSync(`node_modules/three/src/${path}`, 'utf8');

  it('reads the latest frame’s passes, repeats its last value with none, and never prunes its record', () => {
    const pool = source('renderers/webgpu/utils/WebGPUTimestampQueryPool.js');
    expect(pool).toMatch(/currentQueryIndex === 0 \|\| this\.isDisposed \) \{\s+return this\.lastValue;/);
    expect(pool).toContain('const totalDuration = framesDuration[ frames[ frames.length - 1 ] ];');
    expect(pool).toContain('this.timestamps.set( uid, duration );');
    expect(pool).toMatch(/if \( this\.currentQueryIndex \+ 2 > this\.maxQueries \) \{\s+warnOnce\(/);
    expect(source('renderers/common/TimestampQueryPool.js')).toContain('this.timestamps = new Map();');
    const backend = source('renderers/common/Backend.js');
    expect(backend).toContain("contextData.timestampUID = prefix + ':' + abstractRenderContext.id + ':f' + frame;");
    expect(backend).toMatch(/this\.timestampQueryPool = \{\s+\[ TimestampQuery\.RENDER \]: null,/);
    const renderer = source('renderers/common/Renderer.js');
    expect(renderer).toContain('this.info.render.calls ++;');
    expect(renderer).toContain('this.info.compute.calls ++;');
  });

  it('queries a pass only while trackTimestamp is on, and a read empties its pool before it returns', () => {
    const webgpu = source('renderers/webgpu/WebGPUBackend.js');
    expect(webgpu).toMatch(
      /initTimestampQuery\( type, uid, descriptor \) \{\s+if \( ! this\.trackTimestamp \) return;/,
    );
    const backend = source('renderers/common/Backend.js');
    expect(backend).toMatch(
      /async resolveTimestampsAsync\( type = 'render' \) \{\s+if \( ! this\.trackTimestamp \) \{[^}]+\}\s+const queryPool = this\.timestampQueryPool\[ type \];\s+if \( ! queryPool \) \{\s+return;\s+\}\s+const duration = await queryPool\.resolveQueriesAsync\(\);/,
    );
    const renderer = source('renderers/common/Renderer.js');
    expect(renderer).toMatch(
      /async resolveTimestampsAsync\( type = 'render' \) \{\s+if \( this\._initialized === false \) await this\.init\(\);\s+return this\.backend\.resolveTimestampsAsync\( type \);/,
    );
    const pool = source('renderers/webgpu/utils/WebGPUTimestampQueryPool.js');
    const start = pool.indexOf('async _resolveQueries()');
    const reset = pool.indexOf('this.currentQueryIndex = 0;', start);
    expect(reset).toBeGreaterThan(start);
    expect(reset).toBeLessThan(pool.indexOf('await this.resultBuffer.mapAsync(', start));
    expect(pool.slice(start, reset)).not.toContain('await ');
    const resolve = pool.slice(pool.indexOf('async resolveQueriesAsync()'), start);
    expect(resolve.indexOf('this.pendingResolve = this._resolveQueries();')).toBeLessThan(resolve.indexOf('await '));
  });
});
