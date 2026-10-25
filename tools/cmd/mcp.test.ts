/**
 * @file Unit tests for `x mcp` (tools/cmd/mcp.ts, PLAN.md §8.11, WP 7.6): its flags name what opens first and a bad
 * one is a usage error (exit 2); the server's side imports no engine module, so only its worker holds engine code
 * and a restart loads the code as it is; with stdin closed at once it serves nothing and ends, its lines on stderr and
 * none on stdout (the MCP channel); and a real client over stdio (the SDK's `StdioClientTransport`) lists the tools of
 * `node x mcp --headless --scene room`, steps the room its flags opened, and after a file under `--watch` changes is
 * told that the forked worker restarted, the room started again.
 * @see tools/cmd/mcp.ts
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { CHILD_TIMEOUT_MS, dispatch, ROOT } from '../x';
import { openArgs } from './mcp';

/** The environment a child `node x` gets: this one without Vitest's variables. */
const childEnv = () =>
  Object.fromEntries(Object.entries(process.env).filter(([key, value]) => !key.startsWith('VITEST') && value !== undefined)) as Record<string, string>; // prettier-ignore

/** Runs `node x <args>` in this process; returns the exit code and the printed lines. */
async function x(...args: string[]) {
  const lines: string[] = [];
  const code = await dispatch(args, { print: (line) => lines.push(line) });
  return { code, lines };
}

/** The relative modules a module imports at run time (not `import type`, not a dynamic `import()`). */
function runtimeImports(file: string): string[] {
  const source = readFileSync(join(ROOT, file), 'utf8');
  const found = [...source.matchAll(/^import (?!type )(?:[^'";]*? from )?'(\.[^']+)'/gm)].map((match) => match[1]);
  return found.map((specifier) => relative(ROOT, join(ROOT, dirname(file), `${specifier}.ts`)));
}

describe('x mcp', () => {
  it('names what its flags open first, and refuses a bad flag (exit 2)', async () => {
    expect(openArgs({})).toBeUndefined();
    expect(openArgs({ scene: 'room', set: ['box.room.speed=3'] })).toEqual({ page: 'labs/box', params: { scene: 'room', 'box.room.speed': '3' } }); // prettier-ignore
    expect(openArgs({ page: 'labs/playground', scene: 'site', cam: 'iso' })).toEqual({ page: 'labs/playground', params: { scene: 'site', cam: 'iso' } }); // prettier-ignore
    const bad = await x('mcp', '--set', 'nope');
    expect([bad.code, bad.lines[1]]).toEqual([2, expect.stringContaining('--set takes key=value')]);
    expect((await x('mcp', '--sene', 'room')).lines[1]).toContain('did you mean --scene?');
  });

  it("imports no engine module on the server's side: only its worker holds engine code", () => {
    const seen = new Set<string>();
    const queue = ['tools/cmd/mcp.ts'];
    while (queue.length) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      queue.push(...runtimeImports(file));
    }
    expect([...seen].sort()).toEqual(['tools/cmd/mcp.ts', 'tools/lib/report.ts', 'tools/mcp/link.ts', 'tools/mcp/server.ts', 'tools/x.ts']); // prettier-ignore
  });

  it('ends when stdin ends, its lines on stderr and none on stdout', { timeout: CHILD_TIMEOUT_MS }, () => {
    const run = spawnSync(process.execPath, ['x', 'mcp', '--headless'], {
      cwd: ROOT,
      env: childEnv(),
      input: '',
      encoding: 'utf8',
      timeout: CHILD_TIMEOUT_MS,
    });
    expect([run.status, run.stdout]).toEqual([0, '']);
    expect(run.stderr).toContain('x mcp: ok: served 0 tool call(s) over stdio, on createHeadless');
  });

  it(
    'serves a client over stdio, and restarts its worker after a watched file changes',
    { timeout: CHILD_TIMEOUT_MS },
    async () => {
      const watched = mkdtempSync(join(tmpdir(), 'mcp-watch-'));
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: ['x', 'mcp', '--headless', '--scene', 'room', '--watch', watched],
        cwd: ROOT,
        env: childEnv(),
        stderr: 'pipe',
      });
      const client = new Client({ name: 'x-mcp-test', version: '0.0.0' });
      const call = async (name: string, args: Record<string, unknown>) => {
        const result = (await client.callTool({ name, arguments: args }, undefined, { timeout: CHILD_TIMEOUT_MS })) as CallToolResult; // prettier-ignore
        return result.content.map((item) => (item.type === 'text' ? item.text : '')).join('\n');
      };
      try {
        await client.connect(transport);
        const names = (await client.listTools()).tools.map((tool) => tool.name);
        expect(names).toEqual(expect.arrayContaining(['engine_open', 'engine_step', 'engine_call']));
        expect(names).not.toContain('engine_shot');
        expect(await call('engine_step', { n: 30 })).toBe('{"tick":30}'); // the room --scene opened
        writeFileSync(join(watched, 'changed.ts'), '// a change\n');
        let said = '';
        await expect.poll(async () => (said = await call('engine_call', { member: 'info' })).split('\n')[0], { timeout: 60_000 }).toMatch(/^the backend restarted after a change to .*changed\.ts since the last call: labs\/box started again from step 0$/); // prettier-ignore
        expect(JSON.parse(said.split('\n')[1])).toMatchObject({ scene: 'box:room', tick: 0 });
      } finally {
        await client.close();
        rmSync(watched, { recursive: true, force: true });
      }
    },
  );
});
