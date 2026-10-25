/**
 * @file The MCP client test of WP 7.6's Done when (PLAN.md §8.11), in T1: an MCP client (the SDK's `Client`, over an
 * in-memory transport) lists the tools the server generates from the inspector's members, opens the box room, steps
 * it, injects input, takes a shot with the ID pass, runs a dev action and replays a file, through the server
 * (tools/mcp/server.ts) and a worker in this process (tools/mcp/worker.ts) over the headless backend
 * (tools/mcp/headless.ts): the real engine and the real room, with no browser, as docs/TESTING.md has T1. The shot's
 * pixels and ID pass come from a stand-in renderer, since T1 drives no browser; tests/e2e/mcp.spec.ts makes the same
 * calls through `node x mcp` against a page in the x inspect session, its WebGPU ID pass included.
 *
 * Also: bad input, an unknown member and an engine error come back as `isError` results naming the fix; the server
 * restarts its worker after a code change, its next result saying so and the scene opened again, the client hearing
 * `notifications/tools/list_changed` when the new tools differ (a worker that died before taking up the run leaves the
 * next one the first); a call's progress reaches a client that asked for it.
 * @see tools/mcp/server.ts
 * @see tools/mcp/headless.ts
 * @see tools/mcp/worker.ts
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ToolListChangedNotificationSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';
import type { ShotJson } from '../../engine/gfx/shot';
import { PLATFORM } from '../cmd/replay';
import { ROOT } from '../x';
import type { Backend } from './backend';
import { headlessBackend } from './headless';
import { localLink, type WorkerHandler } from './link';
import { createBridge, type Bridge, type BridgeOptions } from './server';
import { createWorker } from './worker';

const open: { client: Client; bridge: Bridge; serving: Promise<void> }[] = [];
afterEach(async () => {
  for (const { client, bridge, serving } of open.splice(0)) {
    await client.close();
    await serving;
    await bridge.close();
  }
});

/** A bridge over workers `start` makes, and a client connected to it. */
async function connect(start: BridgeOptions['start'], backend: BridgeOptions['backend'] = 'headless') {
  const bridge = createBridge({ root: ROOT, backend, start });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const serving = bridge.serve(serverSide);
  const client = new Client({ name: 'mcp-test', version: '0.0.0' });
  await client.connect(clientSide);
  open.push({ client, bridge, serving });
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as CallToolResult;
  return { client, bridge, call };
}

/** A result's last text, parsed as JSON. */
const json = <T = Record<string, unknown>>(result: CallToolResult): T => {
  const texts = result.content.filter((item) => item.type === 'text');
  return JSON.parse(texts.at(-1)!.text) as T;
};
/** A result's texts, joined. */
const text = (result: CallToolResult) => result.content.map((item) => (item.type === 'text' ? item.text : '')).join('\n'); // prettier-ignore

/** The stand-in renderer's frame: 4 × 2 RGBA, the floor and the room's first mover, as a page's shot gives it. */
const STAND_IN: ShotJson = {
  width: 4,
  height: 2,
  readback: { bytesPerRow: 256, bytes: 512 },
  pixels: Buffer.from(Array.from({ length: 32 }, (_, i) => (i % 4 === 3 ? 255 : i * 8))).toString('base64'),
  ids: {
    width: 4,
    height: 2,
    objects: 3,
    visible: [
      { id: 1, name: 'level:room/floor', px: 5, share: 0.625, bbox: [0, 0, 3, 1], centre: [1, 1] },
      { id: 2, name: 'pathMover#1', px: 3, share: 0.375, bbox: [2, 0, 3, 1], centre: [3, 0], entity: 1 },
    ],
    unseen: [{ id: 3, name: 'pathMover#2', reason: 'outside', entity: 2 }],
    empty: 0,
    stray: 0,
    protagonist: null,
  },
  built: 0,
  ms: 1,
};

/** The headless backend with the stand-in renderer: its `shot` records the options and answers `STAND_IN`. */
function standInRenderer(backend: Backend, shots: unknown[]): Backend {
  return {
    ...backend,
    renders: true,
    async call(name, args, progress) {
      if (name !== 'shot') return backend.call(name, args, progress);
      shots.push(args[0]);
      return STAND_IN;
    },
  };
}

describe('an MCP client drives the box room (WP 7.6)', () => {
  it('opens the box room, steps it, injects input, shoots it with the ID pass, runs a dev action and replays a file', async () => {
    const shots: unknown[] = [];
    const { client, call } = await connect(() => localLink(createWorker(ROOT, standInRenderer(headlessBackend(ROOT), shots)))); // prettier-ignore
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(['engine_open', 'engine_step', 'engine_state', 'engine_dump', 'engine_shot', 'engine_input', 'engine_replay', 'engine_set', 'engine_actions', 'engine_help', 'docs_lookup', 'engine_call']); // prettier-ignore

    const opened = await call('engine_open', { page: 'labs/box', params: { scene: 'room' } });
    expect(json(opened)).toMatchObject({ page: 'box:room', ready: true, errors: [], info: { scene: 'box:room', seed: 1, tick: 0 } }); // prettier-ignore
    expect(json(await call('engine_step', { n: 60 }))).toEqual({ tick: 60 });
    expect(json(await call('engine_input', { script: '30 move=0,1 tap=jump' }))).toEqual({ steps: 30, tick: 90 });

    const shot = await call('engine_shot', { ids: true });
    expect(shots).toEqual([{ ids: true, pixels: true }]);
    const [image, numbers] = shot.content;
    expect(image).toMatchObject({ type: 'image', mimeType: 'image/png' });
    const png = Buffer.from((image as { data: string }).data, 'base64');
    expect([png.subarray(1, 4).toString('latin1'), png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual(['PNG', 4, 2]);
    const seen = JSON.parse((numbers as { text: string }).text) as { ids: { visible: { name: string; entity?: number }[]; unseen: object } }; // prettier-ignore
    expect(seen.ids.visible.map(({ name, entity }) => [name, entity])).toEqual([['level:room/floor', undefined], ['pathMover#1', 1]]); // prettier-ignore
    expect(seen.ids.unseen).toEqual({ outside: ['pathMover#2'] });

    const actions = json<{ name: string }[]>(await call('engine_actions')).map((action) => action.name);
    expect(actions).toEqual(['freeze', 'god', 'spawn', 'timeScale', 'travel']);
    expect(json(await call('engine_actions', { name: 'freeze', args: { on: true } }))).toEqual({ name: 'freeze', tick: 90 }); // prettier-ignore
    expect(json(await call('engine_step', { n: 1 }))).toEqual({ tick: 91 }); // a change-point goes with the step after it
    const record = json<{ inputs: unknown[] }>(await call('engine_call', { member: 'input.record' }));
    expect(record.inputs).toEqual([
      [60, { move: [0, 1], p: ['jump'] }],
      [90, { dev: 'freeze', args: { on: true }, move: null, set: { 'ai.frozen': true } }],
    ]);

    const replayed = json(await call('engine_replay', { file: 'tests/replays/box-1-room.replay.json' }));
    expect(replayed).toMatchObject({ file: 'tests/replays/box-1-room.replay.json', scene: 'box:room', steps: 600 });
    expect(replayed.goldens).toEqual({ platform: PLATFORM, checked: 11, match: true });
  });

  it('reads the run: state by component, the view as a tree, help and the docs', async () => {
    const { call } = await connect(() => localLink(createWorker(ROOT, headlessBackend(ROOT))));
    await call('engine_open', { page: 'box:room', params: { 'box.room.speed': 3 } });
    expect(json(await call('engine_set', { path: 'box.room.movers', value: '2' }))).toMatchObject({ path: 'box.room.movers', value: 2, previous: 3 }); // prettier-ignore
    await call('engine_step', { n: 60 });
    const state = json<{ entities: { id: number }[] }>(await call('engine_state', { query: 'pathMover' }));
    expect(state.entities.map((entity) => entity.id)).toEqual([1, 2, 3]);
    const dump = text(await call('engine_dump', { filter: 'pathMover' }));
    expect(dump.split('\n')[0]).toMatch(/^tick 60, hash [0-9a-f]{16}, 3 entities$/);
    expect(dump).toMatch(/pathMover#1 Mesh at 6\.5,0,4\.5/); // 3 m/s for 1 s along the line east, as x dump shows it
    expect(text(await call('engine_help'))).toMatch(/^engine_open: [\s\S]*__engine \(engine_call reaches each\):\n[\s\S]*step\(n = 1, intents\?\)/); // prettier-ignore
    expect(text(await call('docs_lookup', { symbol: 'DEV_BAD_ARGS' })).split('\n')[0]).toBe('### DEV_BAD_ARGS (docs/ERRORS.md)'); // prettier-ignore
  });

  it('answers bad input, an unknown member and an engine error as isError results naming the fix', async () => {
    const { client, call } = await connect(() => localLink(createWorker(ROOT, headlessBackend(ROOT))));
    expect((await client.listTools()).tools.map((tool) => tool.name)).not.toContain('engine_shot'); // no renderer headless
    const notOpen = await call('engine_step', { n: 1 });
    expect([notOpen.isError, text(notOpen)]).toEqual([true, expect.stringMatching(/^MCP_NOT_OPEN: .*call engine_open first/)]); // prettier-ignore
    await call('engine_open', { page: 'labs/box', params: { scene: 'room' } });
    expect(text(await call('engine_step', { m: 1 }))).toBe('MCP_BAD_INPUT: engine_step: unknown key "m" (did you mean "n"?)'); // prettier-ignore
    expect(text(await call('engine_call', { member: 'camra.set' }))).toMatch(
      /^MCP_NO_MEMBER: .*did you mean camera\.set\?/,
    );
    const thrown = await call('engine_call', { member: 'get', args: { id: 'one' } });
    expect([thrown.isError, text(thrown)]).toEqual([true, expect.stringMatching(/^\[DEV_BAD_ARGS\] __engine\.get: .*call it as get\(id\)/)]); // prettier-ignore
    const room = await call('engine_open', { page: 'labs/box', params: { scene: 'nope' } });
    expect(text(room)).toMatch(/^MCP_NO_SCENE: labs\/box has no scene nope headless: give params.scene, one of .*room/);
  });
});

describe('the server', () => {
  it('restarts its worker after a change: the next result says so, the scene opens again, the client hears list_changed', async () => {
    let starts = 0;
    const { client, bridge, call } = await connect(() => {
      starts++;
      const backend = headlessBackend(ROOT);
      return localLink(createWorker(ROOT, starts === 1 ? backend : standInRenderer(backend, [])));
    });
    let changed = 0;
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => void changed++);
    await call('engine_open', { page: 'labs/box', params: { scene: 'room' } });
    await call('engine_step', { n: 30 });
    bridge.changed(['engine/sim/world.ts', 'engine/sim/scene.ts']);
    const after = await call('engine_call', { member: 'info' });
    expect(text(after).split('\n')[0]).toBe('the backend restarted after a change to engine/sim/scene.ts and 1 more since the last call: labs/box started again from step 0'); // prettier-ignore
    expect([starts, json(after).tick, json(after).scene]).toEqual([2, 0, 'box:room']);
    await expect.poll(() => changed).toBe(1); // the second worker renders: engine_shot joined the tools
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain('engine_shot');
    expect(text(await call('engine_step', { n: 1 }))).toBe('{"tick":1}'); // said once
  });

  it('counts as the first start the first worker that takes up the run, even after one died before it did', async () => {
    const firsts: boolean[] = [];
    const { call } = await connect(() =>
      localLink(async (request) => {
        if (request.op === 'tools') return [];
        if (request.op !== 'resume') return { content: [{ type: 'text', text: 'done' }] };
        firsts.push(request.first);
        if (firsts.length === 1) throw new Error('MCP_BACKEND: the backend exited (code 1), saying X_CRASH: …');
        return { running: false };
      }),
    );
    expect(text(await call('engine_step'))).toMatch(/^MCP_BACKEND: the backend exited \(code 1\), saying X_CRASH/);
    expect(text(await call('engine_step'))).toBe('done'); // no restart line: nothing had run
    expect(firsts).toEqual([true, true]);
  });

  it("sends a call's progress to a client that gave a token, and fails a call whose worker has gone", async () => {
    let fail = false;
    const handler: WorkerHandler = async (request, progress) => {
      if (request.op === 'tools') return [];
      if (request.op !== 'call') return { running: false };
      if (fail) throw new Error('MCP_BACKEND: the backend exited (code 1): the next call starts it again');
      progress('opening labs/box/: 5 s');
      return { content: [{ type: 'text', text: 'done' }] };
    };
    const { client, call } = await connect(() => localLink(handler));
    const lines: string[] = [];
    const result = await client.callTool({ name: 'engine_step', arguments: {} }, undefined, {
      onprogress: (progress) => void lines.push(progress.message ?? ''),
    });
    expect([text(result as CallToolResult), lines]).toEqual(['done', ['opening labs/box/: 5 s']]);
    fail = true;
    const gone = await call('engine_step');
    expect([gone.isError, text(gone)]).toEqual([true, expect.stringMatching(/^MCP_BACKEND: the backend exited/)]);
    fail = false;
    expect(text(await call('engine_step')).split('\n')[0]).toBe('the backend restarted after the last one exited since the last call: nothing is open'); // prettier-ignore
  });
});
