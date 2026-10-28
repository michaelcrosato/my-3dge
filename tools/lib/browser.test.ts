/**
 * @file Unit tests for the Node half of `tools/lib/browser.ts`: the launch options, the init script (run in an
 * isolated `vm` context, as a page would run it); stacks are tools/lib/pageErrors.test.ts's. The browser half is
 * proven by `tests/e2e/harness.spec.ts`.
 */
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  browserRuntime,
  cachedChromium,
  chromiumPath,
  DEFAULT_CHROMIUM,
  initScript,
  launchOptions,
  WEBGPU_FLAGS,
  type GpuLog,
  type VirtualClock,
} from './browser';
import { fnv1a } from './hash';

/** mulberry32, written independently of the init script: the first `count` values for `seed`. */
function mulberry32(seed: number, count: number): number[] {
  let state = seed >>> 0;
  return Array.from({ length: count }, () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
}

describe('the launch options', () => {
  it("use shardfall's WebGPU flags and the platform's Chromium, which CHROMIUM_PATH overrides", () => {
    expect(WEBGPU_FLAGS).toEqual([
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan',
      '--use-vulkan=swiftshader',
      '--use-angle=swiftshader',
    ]);
    const none = (): boolean => false;
    const only = (path: string) => (p: string) => p === path;
    expect(chromiumPath({}, none)).toBe(DEFAULT_CHROMIUM);
    expect(chromiumPath({ CHROMIUM_PATH: '/x/chrome' }, none)).toBe('/x/chrome');
    expect(chromiumPath({ HOME: '/h' }, only(DEFAULT_CHROMIUM))).toBe(DEFAULT_CHROMIUM);
    const cached = '/h/.cache/my3dge/chrome-153.0.8010.12/chrome-linux64/chrome';
    expect(cachedChromium({ HOME: '/h' })).toBe(cached);
    expect(chromiumPath({ HOME: '/h' }, only(cached))).toBe(cached);
    expect(chromiumPath({ HOME: '/h', CHROMIUM_PATH: '/x/chrome' }, only(cached))).toBe('/x/chrome');
    expect(launchOptions({ CHROMIUM_PATH: '/x/chrome' })).toEqual({
      executablePath: '/x/chrome',
      args: [...WEBGPU_FLAGS],
    });
    expect(browserRuntime('153.0.8010.12')).toBe('chromium153');
  });
});

describe('the init script', () => {
  /** Runs the init script in a fresh context shaped like a page without WebGPU; returns that context. */
  function page(seed: number) {
    const context = createContext({ performance: {}, navigator: {}, TextEncoder });
    runInContext('globalThis.window = globalThis', context);
    runInContext(initScript(seed), context);
    // The context's own Math and Date are its intrinsics, so they are read from inside it.
    Object.assign(context, runInContext('({ Math, Date })', context));
    return context as {
      Math: Math;
      Date: DateConstructor;
      performance: Performance;
      navigator: { getGamepads(): unknown[] };
      requestAnimationFrame(callback: (time: number) => void): number;
      cancelAnimationFrame(id: number): void;
      __clock: VirtualClock;
      __gpu: GpuLog;
    };
  }

  it('seeds Math.random and the named streams', () => {
    const scope = page(7);
    expect([scope.Math.random(), scope.Math.random(), scope.Math.random()]).toEqual(mulberry32(7, 3));
    const spawn = scope.__clock.rng('spawn');
    expect([spawn(), spawn()]).toEqual(mulberry32(fnv1a('spawn') ^ 7, 2));
    expect(scope.__clock.rng('spawn')()).toBe(mulberry32(fnv1a('spawn') ^ 7, 3)[2]);
    expect(page(8).Math.random()).not.toBe(mulberry32(7, 1)[0]);
  });

  it('runs animation frames only on tick, 1/60 s apart, and fixes the clocks to virtual time', () => {
    const scope = page(1);
    const times: number[] = [];
    const loop = (time: number) => {
      times.push(time);
      scope.requestAnimationFrame(loop);
    };
    scope.requestAnimationFrame(loop);
    const cancelled = scope.requestAnimationFrame(() => times.push(-1));
    scope.cancelAnimationFrame(cancelled);
    expect(scope.performance.now()).toBe(1000);
    expect(times).toEqual([]);
    scope.__clock.tick(3);
    expect(times).toEqual([1000 + 1000 / 60, 1000 + 2000 / 60, 1000 + 3000 / 60]);
    expect(scope.performance.now()).toBe(1050);
    expect(scope.Date.now()).toBe(1.7e12 + 1050);
    expect(scope.__clock.frames).toBe(3);
    expect(scope.navigator.getGamepads()).toEqual([]);
  });

  it('installs an empty WebGPU log where the page has no WebGPU', () => {
    expect(page(1).__gpu).toEqual({ adapters: [], devices: 0, contexts: 0, submits: 0, lost: [] });
  });

  it('refuses a seed that is not a whole number', () => {
    expect(() => initScript(1.5)).toThrow('the seed must be a whole number');
  });
});
