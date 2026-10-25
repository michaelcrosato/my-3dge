/**
 * @file T2 for the MCP bridge (PLAN.md §8.11, WP 7.6): the calls of T1's MCP client test (tools/mcp/server.test.ts),
 * made through `node x mcp` over stdio (the SDK's `StdioClientTransport`) against a page in the x inspect session on
 * WebGPU, where T1 has a stand-in renderer. The server starts the session, opens the box room from cam iso, steps it,
 * injects input, takes a shot whose PNG is the page's frame and whose ID pass lists the floor, the walls, the low wall,
 * the pillar and the three movers (as tests/e2e/box.spec.ts's shot does), runs a dev action and replays a file in the
 * page against its goldens; when the client goes, it stops the session it started.
 *
 * Invariants: the page is driven only through MCP, as an agent without a shell drives it. It shares
 * out/inspect/session.json with box.spec.ts's `x inspect` test, so it starts only when no session runs; T2 runs one
 * worker per 4 cores (tools/lib/tiers.ts `t2Workers`), so on this platform the two never overlap.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { expect, test } from './fixtures';

const ROOT = join(import.meta.dirname, '..', '..');
/** Variables a test runner sets for its own workers; the `x` children start without them. */
const RUNNER_VARIABLE = /^(VITEST|TEST_WORKER_INDEX$|TEST_PARALLEL_INDEX$|PW_TS_ESM|PW_TEST_SOURCE_TRANSFORM)/;
/** The box room's first replay, which the page plays against its goldens. */
const REPLAY = 'tests/replays/box-1-room.replay.json';
/** How long one call may wait: opening the room warms its pipelines on SwiftShader. */
const CALL_MS = 300_000;

/** Whether an x inspect session runs in this checkout (tools/cmd/inspect.ts `findSession`'s test, without clearing). */
function sessionRuns(): boolean {
  try {
    const { pid } = JSON.parse(readFileSync(join(ROOT, 'out/inspect/session.json'), 'utf8')) as { pid: number };
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A result's last text, parsed as JSON. */
const json = <T = Record<string, unknown>>(result: CallToolResult): T =>
  JSON.parse(result.content.filter((item) => item.type === 'text').at(-1)!.text) as T;

test('an MCP client drives the box room in a page: open, step, input, a shot with the ID pass, a dev action, a replay', async () => {
  test.setTimeout(900_000);
  expect(sessionRuns(), 'an x inspect session runs: this test starts its own (node x inspect --stop ends it)').toBe(false); // prettier-ignore
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !RUNNER_VARIABLE.test(key)));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['x', 'mcp'],
    cwd: ROOT,
    env: env as Record<string, string>,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'mcp-spec', version: '0.0.0' });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args }, undefined, { timeout: CALL_MS })) as CallToolResult; // prettier-ignore
    expect(result.isError, `${name}: ${JSON.stringify(result.content).slice(0, 400)}`).toBeFalsy();
    return result;
  };
  try {
    await client.connect(transport);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain('engine_shot');

    const opened = json(await call('engine_open', { page: 'labs/box', params: { scene: 'room', cam: 'iso' } }));
    expect(opened).toMatchObject({ page: 'labs/box/?scene=room&cam=iso', ready: true, errors: [], info: { scene: 'box:room', headless: false, tick: 0 } }); // prettier-ignore
    expect(sessionRuns()).toBe(true);
    expect(json(await call('engine_step', { n: 60 }))).toEqual({ tick: 60 });
    expect(json(await call('engine_input', { script: '30 move=0,1 tap=jump' }))).toEqual({ steps: 30, tick: 90 });

    const shot = await call('engine_shot', { ids: true });
    const [image] = shot.content as { type: string; data: string; mimeType: string }[];
    expect([image.type, image.mimeType]).toEqual(['image', 'image/png']);
    const seen = json<{ width: number; height: number; ids: { visible: { name: string }[]; unseen: Record<string, string[]> }; notes?: string[] }>(shot); // prettier-ignore
    const png = Buffer.from(image.data, 'base64'); // the drawing buffer's size, which the shot reports
    expect([png.subarray(1, 4).toString('latin1'), png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual(['PNG', seen.width, seen.height]); // prettier-ignore
    expect(seen.width * seen.height).toBeGreaterThan(0);
    const names = seen.ids.visible.map((entry) => entry.name);
    for (const name of ['level:room/floor', 'level:room/lowWall', 'level:room/pillar', 'pathMover#1']) {
      expect(names, name).toContain(name);
    }
    expect(names.filter((name) => name.startsWith('level:room/wall@'))).toHaveLength(4);
    const movers = [...names, ...Object.values(seen.ids.unseen).flat()].filter((name) => name.startsWith('pathMover#'));
    expect(movers.sort()).toEqual(['pathMover#1', 'pathMover#2', 'pathMover#3']); // each seen, or unseen with a reason
    expect(seen.notes).toBeUndefined(); // the look raises no note, as box.spec.ts's shot of the room

    expect(json<{ name: string }[]>(await call('engine_actions')).map((action) => action.name)).toContain('freeze');
    expect(json(await call('engine_actions', { name: 'freeze', args: { on: true } }))).toEqual({ name: 'freeze', tick: 90 }); // prettier-ignore

    const replayed = json<{ goldens: { match: boolean; checked: number }; frames: number; steps: number }>(await call('engine_replay', { file: REPLAY })); // prettier-ignore
    expect(replayed.goldens).toMatchObject({ match: true, checked: 11 });
    expect([replayed.steps, replayed.frames > 0]).toEqual([600, true]); // played in the page, drawing as it went
  } finally {
    await client.close();
  }
  await expect.poll(sessionRuns, { timeout: 30_000 }).toBe(false); // it stopped the session it started
});
