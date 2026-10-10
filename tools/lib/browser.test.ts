/**
 * @file Unit tests for the Node half of `tools/lib/browser.ts`: the launch options, the init script (run in an
 * isolated `vm` context, as a page would run it), and stacks mapped through inline source maps. The browser half
 * is proven by `tests/e2e/harness.spec.ts`.
 */
import { createContext, runInContext } from 'node:vm';
import { transformWithEsbuild } from 'vite';
import { describe, expect, it } from 'vitest';
import {
  browserRuntime,
  chromiumPath,
  DEFAULT_CHROMIUM,
  initScript,
  launchOptions,
  mapStack,
  parseStack,
  servedPath,
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
    expect(chromiumPath({})).toBe(DEFAULT_CHROMIUM);
    expect(chromiumPath({ CHROMIUM_PATH: '/x/chrome' })).toBe('/x/chrome');
    expect(launchOptions({})).toEqual({ executablePath: '/opt/pw-browsers/chromium', args: [...WEBGPU_FLAGS] });
    expect(browserRuntime('141.0.7390.37')).toBe('chromium141');
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

describe('stack mapping', () => {
  const STACK = [
    'Error: harness: thrown on purpose',
    '    at explode (http://127.0.0.1:5173/tests/pages/demo.ts?t=17:LINE:COL)',
    '    at http://127.0.0.1:5173/@vite/client:10:5',
    '    at <anonymous>:1:1',
  ].join('\n');

  it('parses V8 frames, with and without a function name', () => {
    expect(parseStack(STACK.replace('LINE', '2').replace('COL', '9'))).toEqual([
      { fn: 'explode', url: 'http://127.0.0.1:5173/tests/pages/demo.ts?t=17', line: 2, column: 9 },
      { fn: undefined, url: 'http://127.0.0.1:5173/@vite/client', line: 10, column: 5 },
      { fn: undefined, url: '<anonymous>', line: 1, column: 1 },
    ]);
  });

  it('names repository paths for served URLs, /@fs/ included', () => {
    expect(servedPath('http://127.0.0.1:5173/tests/pages/harness.ts?t=1', '/repo')).toBe('tests/pages/harness.ts');
    expect(servedPath('http://127.0.0.1:5173/@fs/repo/engine/a.ts', '/repo')).toBe('engine/a.ts');
    expect(servedPath('http://127.0.0.1:5173/@fs/elsewhere/b.ts', '/repo')).toBe('/elsewhere/b.ts');
    expect(servedPath('not a url', '/repo')).toBe('not a url');
  });

  it('maps a frame to its .ts line through the inline source map', async () => {
    const source = [
      'interface Shape {',
      '  a: number;',
      '}',
      'type T = Shape | undefined;',
      'function explode(x: T): never {',
      "  throw new Error('boom ' + String(x));",
      '}',
      'explode(undefined);',
    ].join('\n');
    const { code, map } = await transformWithEsbuild(source, 'demo.ts', { sourcemap: true });
    const inline = Buffer.from(JSON.stringify(map)).toString('base64');
    const served = `${code}\n//# sourceMappingURL=data:application/json;base64,${inline}\n`;
    const lines = code.split('\n');
    const line = lines.findIndex((text) => text.includes('throw')) + 1;
    const column = lines[line - 1].indexOf('throw') + 1;
    expect(line).not.toBe(6);
    const fetched: string[] = [];
    const frames = await mapStack(STACK.replace('LINE', String(line)).replace('COL', String(column)), {
      root: '/repo',
      fetchText: async (url) => {
        fetched.push(url);
        if (url.includes('demo.ts')) return served;
        throw new Error('not served');
      },
    });
    expect(frames[0]).toMatchObject({ fn: 'explode', file: 'tests/pages/demo.ts', line: 6, column: 3, mapped: true });
    expect(frames[1]).toMatchObject({ file: '@vite/client', line: 10, column: 5, mapped: false });
    expect(frames[2]).toMatchObject({ file: '<anonymous>', mapped: false });
    expect(fetched).toEqual(['http://127.0.0.1:5173/tests/pages/demo.ts?t=17', 'http://127.0.0.1:5173/@vite/client']);
  });
});
