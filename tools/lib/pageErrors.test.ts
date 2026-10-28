/**
 * @file Unit tests for tools/lib/pageErrors.ts: V8 frames parsed with and without a function name, repository paths
 * named for served URLs (`/@fs/` included), and a frame mapped to its `.ts` line through the module's inline source
 * map, each module fetched once. Split from tools/lib/browser.test.ts with the module.
 */
import { transformWithEsbuild } from 'vite';
import { describe, expect, it } from 'vitest';
import { mapStack, parseStack, servedPath } from './pageErrors';

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
