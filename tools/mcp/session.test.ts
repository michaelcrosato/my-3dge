/**
 * @file Unit tests for the MCP bridge's page backend (tools/mcp/session.ts, PLAN.md §8.11, WP 7.6), without a
 * browser: against a stand-in x inspect session (the same JSON over HTTP, as tools/cmd/inspect.test.ts has it) in a
 * sandbox root, a member is called in the open page once it signals ready, the reply led by Vite's reload once; the
 * call waits while the page reloads and fails naming the errors it signals; pages open through `goto`, a replay's
 * scene's page when another shows (a fixture scene has none), a page still warming up answering not ready with a
 * note; `resume` takes up the session as it is, opening the flags' page only on the first start; `close` stops the
 * session only when asked. tests/e2e/mcp.spec.ts drives a real session.
 * @see tools/mcp/session.ts
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SESSION_FILE } from '../cmd/inspect';
import { memberExpression, pageBackend } from './session';

const temporary: string[] = [];
const servers: Server[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const server of servers.splice(0)) server.close();
});

/** A request's JSON body. */
async function bodyOf(req: IncomingMessage): Promise<Record<string, unknown>> {
  let text = '';
  for await (const chunk of req) text += String(chunk);
  return JSON.parse(text || '{}') as Record<string, unknown>;
}

/** A reply of the stand-in: JSON with status 200, or with `error` and 500. */
type Reply = Record<string, unknown> | { status: 500; error: string };

/**
 * A sandbox root with the box's page and room scene and the kernel fixture (their text only), and a stand-in session
 * whose session.json names `page`: each op answers its handler's reply for the request's body. Returns the root, the
 * requests by op, and a way to rewrite session.json's page, as the real session does after `goto`.
 */
async function standIn(page: string, handlers: Record<string, (body: Record<string, unknown>) => Reply>) {
  const root = mkdtempSync(join(tmpdir(), 'mcp-session-'));
  temporary.push(root);
  const files = {
    'labs/box/index.html': '',
    'labs/box/scenes/room.ts': "defineScene('box:room', {});\n",
    'fixtures/scenes/kernel/index.ts': "defineScene('kernel', {});\n",
  };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(root, dirname(file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  const requests: Record<string, Record<string, unknown>[]> = {};
  const server = createServer((req, res) => {
    void bodyOf(req).then((body) => {
      const op = (req.url ?? '/').slice(1);
      (requests[op] ??= []).push(body);
      const reply = handlers[op]?.(body) ?? { status: 500, error: `the stand-in has no ${op}` };
      res.writeHead('status' in reply && reply.status === 500 ? 500 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const showing = (now: string) => {
    mkdirSync(join(root, 'out', 'inspect'), { recursive: true });
    const info = { pid: process.pid, port, vite: 'http://127.0.0.1:1/', page: now, ready: true };
    writeFileSync(join(root, SESSION_FILE), JSON.stringify(info));
  };
  showing(page);
  return { root, requests, showing };
}

/** A ready page's status reply. */
const ready = (page: string, more: Record<string, unknown> = {}) => ({
  page,
  signals: { ready: true, errors: [], info: { scene: 'box:room', tick: 0 }, shoots: true },
  ...more,
});
const nothing = () => undefined;

describe('the page backend', () => {
  it('calls a member in the open page once it signals ready, saying once that Vite reloaded it', async () => {
    let statuses = 0;
    const { root, requests } = await standIn('labs/box/?scene=room', {
      status: () => ready('labs/box/?scene=room', ++statuses === 1 ? { reloaded: '12:00:01' } : {}),
      eval: (body) => ({ value: body.js === '__engine.errors' ? [] : 60 }),
    });
    const backend = pageBackend(root);
    expect(await backend.call('step', [60, undefined], nothing)).toBe(60);
    expect(await backend.call('errors', [], nothing)).toEqual([]);
    expect(requests.eval.map((body) => body.js)).toEqual(['__engine.step(60)', '__engine.errors']);
    expect(backend.notices()).toEqual(['the page reloaded after a change (12:00:01) since the last call: its run started again']); // prettier-ignore
    expect(backend.notices()).toEqual([]);
  });

  it('waits while the page reloads, and fails naming the errors it signals', async () => {
    const answers: Reply[] = [{ status: 500, error: 'Execution context was destroyed' }, { page: 'labs/box/', signals: { ready: false, errors: [] } }, ready('labs/box/')]; // prettier-ignore
    const { root, requests } = await standIn('labs/box/', {
      status: () => answers.shift() ?? { page: 'labs/box/', signals: { ready: false, errors: ['GFX_NO_WEBGPU: no adapter (fix: …)'] } }, // prettier-ignore
      eval: () => ({ value: 'a1b2' }),
    });
    const backend = pageBackend(root);
    expect(await backend.call('hash', [], nothing)).toBe('a1b2');
    expect(requests.status).toHaveLength(3);
    await expect(backend.call('hash', [], nothing)).rejects.toThrow(/^MCP_PAGE_ERROR: labs\/box\/ signalled GFX_NO_WEBGPU: no adapter/); // prettier-ignore
  });

  it("opens pages through goto, and the page of a replay's scene when another shows", async () => {
    const { root, requests, showing } = await standIn('labs/hello/', {
      status: () => ready('labs/box/?scene=room&cam=iso'),
      goto: () => ({ signals: { ready: true, errors: [] } }),
    });
    const backend = pageBackend(root);
    const opened = await backend.open('labs/box', { scene: 'room', cam: 'iso' }, nothing);
    expect(opened).toEqual({ page: 'labs/box/?scene=room&cam=iso', ready: true, errors: [], info: { scene: 'box:room', tick: 0 } }); // prettier-ignore
    await backend.forReplay('box:room', nothing);
    expect(requests.goto.map((body) => body.page)).toEqual(['labs/box/?scene=room&cam=iso', 'labs/box/?scene=room']);
    showing('labs/box/?scene=room');
    await backend.forReplay('box:room', nothing);
    expect(requests.goto).toHaveLength(2); // it shows the room already
    await expect(backend.forReplay('kernel', nothing)).rejects.toThrow(/has no page/);
  });

  it('takes up the session as it is, opening the flags’ page on the first start only; stops it only when asked', async () => {
    const { root, requests } = await standIn('labs/hello/', {
      status: () => ready('labs/hello/'),
      goto: () => ({ signals: { ready: true, errors: [] } }),
      stop: () => ({ stopped: true }),
    });
    const backend = pageBackend(root);
    const flags = { page: 'labs/box', params: { scene: 'room' } };
    expect(await backend.resume(flags, false, nothing)).toMatchObject({ page: 'labs/hello/', ready: true });
    expect(requests.goto).toBeUndefined();
    await backend.resume(flags, true, nothing);
    expect(requests.goto.map((body) => body.page)).toEqual(['labs/box/?scene=room']);
    await backend.close(false);
    expect(requests.stop).toBeUndefined();
    await backend.close(true);
    expect(requests.stop).toHaveLength(1);
  });

  it('answers a page still warming up as not ready, saying that the next call waits for it', async () => {
    const { root } = await standIn('labs/hello/', {
      status: () => ({ page: 'labs/playground/?scene=site', signals: { ready: false, errors: [] } }),
      goto: () => ({ signals: { ready: false, errors: [] } }),
    });
    const opened = await pageBackend(root).open('labs/playground', { scene: 'site' }, nothing);
    expect(opened).toMatchObject({ page: 'labs/playground/?scene=site', ready: false, errors: [] });
    expect(opened.note).toMatch(/^it signalled neither ready nor an error within \d+ ms, .*the next call waits for it/);
  });

  it('says how to open a page when no session runs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-session-'));
    temporary.push(root);
    const backend = pageBackend(root);
    await expect(backend.call('hash', [], nothing)).rejects.toThrow(/^MCP_NOT_OPEN: no x inspect session runs: call engine_open first/); // prettier-ignore
    expect(await backend.resume(undefined, true, nothing)).toBeNull();
    expect(memberExpression('camera.set', ['cam=iso', { blend: true }])).toBe('__engine.camera.set("cam=iso", {"blend":true})'); // prettier-ignore
    expect(memberExpression('step', [undefined, { jump: true }])).toBe('__engine.step(undefined, {"jump":true})');
  });
});
