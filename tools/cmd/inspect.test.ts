/**
 * @file Unit tests for `x inspect`, `x eval`, `x dump` and the page helpers (tools/cmd/inspect.ts, tools/lib/page.ts,
 * PLAN.md §8.1, WP 2.7), without a browser: a scene module's page; a session whose process has gone is cleared; with
 * no session, `x eval` and `x dump` say how to start one (exit 2) and `x inspect --stop` has nothing to stop; against
 * a stand-in session (the same JSON over HTTP), `x eval` prints the value and `x dump` the tree, each saying first
 * that the page reloaded, and a page error is a failure. tests/e2e/box.spec.ts runs a real session.
 * @see tools/cmd/inspect.ts
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { labPageOf } from '../lib/page';
import { dispatch, loadCommand, ROOT } from '../x';
import { findSession, reloadLines, SESSION_FILE } from './inspect';

const temporary: string[] = [];
const servers: { close(): void }[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const server of servers.splice(0)) server.close();
});

/** A temporary repository root. */
function sandbox(): string {
  const root = mkdtempSync(join(tmpdir(), 'x-inspect-'));
  temporary.push(root);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.0.0' }));
  return root;
}

/** Runs `node x <args>` in `root`; returns the exit code and the printed lines. */
async function x(root: string, ...args: string[]) {
  const lines: string[] = [];
  const commands = Object.fromEntries(['eval', 'dump', 'inspect'].map((name) => [name, () => loadCommand(ROOT, name)]));
  const code = await dispatch(args, { root, print: (line) => lines.push(line), commands });
  return { code, lines };
}

/** A stand-in session in `root`: answers each op with `replies[op]` (or a 500 with `error`). */
async function standIn(root: string, replies: Record<string, object>) {
  const server = createServer((req, res) => {
    const reply = replies[(req.url ?? '').slice(1)];
    res.writeHead(reply ? 200 : 500, { 'content-type': 'application/json' });
    res.end(JSON.stringify(reply ?? { error: 'ReferenceError: nope is not defined' }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  mkdirSync(join(root, 'out', 'inspect'), { recursive: true });
  const info = { pid: process.pid, port, vite: 'http://127.0.0.1:1/', page: 'labs/box/', ready: true };
  writeFileSync(join(root, SESSION_FILE), JSON.stringify(info));
}

describe('the page helpers', () => {
  it("find a scene module's page, and say when the page reloaded", () => {
    expect(labPageOf(ROOT, 'labs/box/scenes/room.ts')).toBe('labs/box/');
    expect(() => labPageOf(ROOT, 'fixtures/scenes/kernel/index.ts')).toThrow(/has no page.*--browser sim/);
    expect(reloadLines({})).toEqual([]);
    expect(reloadLines({ reloaded: '12:00:01' })).toEqual([
      'the page reloaded after a change (12:00:01) since the last call',
    ]);
  });
});

describe('without a session', () => {
  it('clears a session whose process has gone; eval and dump say how to start one; --stop has nothing to stop', async () => {
    const root = sandbox();
    mkdirSync(join(root, 'out', 'inspect'), { recursive: true });
    writeFileSync(join(root, SESSION_FILE), JSON.stringify({ pid: 2 ** 22 + 12345, port: 1 }));
    expect(findSession(root)).toBeNull();
    expect(existsSync(join(root, SESSION_FILE))).toBe(false);
    const evaluated = await x(root, 'eval', '__engine.hash()');
    expect([evaluated.code, evaluated.lines[1]]).toEqual([2, expect.stringContaining('start one with node x inspect')]);
    expect((await x(root, 'dump')).code).toBe(2);
    expect((await x(root, 'eval', ' ')).code).toBe(2);
    const stopped = await x(root, 'inspect', '--stop');
    expect([stopped.code, stopped.lines[0]]).toEqual([0, 'x inspect: ok: no inspect session was running']);
    expect((await x(root, 'inspect', '--page', 'labs/nowhere')).code).toBe(2);
  });
});

describe('against a session', () => {
  it('x eval prints the value, after saying the page reloaded; a throw in the page is a failure', async () => {
    const root = sandbox();
    await standIn(root, { eval: { value: { tick: 3 }, reloaded: '12:00:01' } });
    const { code, lines } = await x(root, 'eval', '({ tick: __engine.info().tick })');
    expect(code).toBe(0);
    expect(lines.slice(0, 3)).toEqual([
      'x eval: ok: labs/box/: 3 lines',
      'the page reloaded after a change (12:00:01) since the last call',
      '{',
    ]);
    expect(JSON.parse(readFileSync(join(root, 'out', 'eval', 'all', 'result.json'), 'utf8'))).toEqual({ tick: 3 });
    const root2 = sandbox();
    await standIn(root2, {});
    const thrown = await x(root2, 'eval', 'nope');
    expect([thrown.code, thrown.lines[1]]).toEqual([1, expect.stringContaining('EVAL_THREW: nope threw')]);
  });

  it('x dump prints the tree and writes it with the state', async () => {
    const root = sandbox();
    const scene = ['stage:room Scene at 0,0,0', '  level:room Group at 0,0,0'].join('\n');
    await standIn(root, { dump: { scene, hash: 'abc', tick: 60, entities: [{ id: 1 }] } });
    const { code, lines } = await x(root, 'dump', '--step', '60');
    expect(code).toBe(0);
    expect(lines.slice(0, 3)).toEqual([
      'x dump: ok: labs/box/: tick 60, hash abc, 1 entities, 2 objects',
      'stage:room Scene at 0,0,0',
      '  level:room Group at 0,0,0',
    ]);
    expect(readFileSync(join(root, 'out', 'dump', 'labs-box', 'scene.txt'), 'utf8')).toBe(`${scene}\n`);
  });
});
