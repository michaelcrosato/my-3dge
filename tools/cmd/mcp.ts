/**
 * @file Serves the engine to MCP clients (PLAN.md §8.11, WP 7.6): `node x mcp` speaks the Model Context Protocol on
 * stdin and stdout, so an agent that cannot run `node x` drives the engine as `x inspect`, `x eval` and `x shot` do.
 * A client starts it with a command line; for the playground, in a client's MCP config:
 * `{ "command": "node", "args": ["<repository>/x.js", "mcp", "--page", "labs/playground", "--scene", "site"] }`.
 *
 * By default its tools drive a page in the `x inspect` session (tools/mcp/session.ts: WebGPU, so `engine_shot`
 * answers with the frame and the ID pass), started when none runs; `--headless` drives `createHeadless` in Node
 * instead (tools/mcp/headless.ts: a scene opens in seconds, no renderer, so no `engine_shot`). `--page`, `--scene`,
 * `--cam` and `--set k=v` name what opens as soon as the server starts, as for `x inspect` (`labs/box` when only the
 * others are given); without them, `engine_open` opens it. The tools are generated from the inspector members'
 * argument schemas (tools/mcp/tools.ts); docs: PLAN.md §8.11.
 *
 * It restarts its backend, a process of its own (`--worker`, which only the server starts), when a file under
 * `--watch`'s directories changes (engine/, labs/, tools/, fixtures/ and data/ by default), so the tools always run the
 * code as it is: the next result says so first, the client keeps its connection, and a page reloads itself through
 * Vite (tools/mcp/server.ts). When the client goes (stdin ends), the server ends its backend, and the x inspect
 * session too when none ran before it started, then writes its report. Stdout is the MCP channel, so every line the
 * process prints goes to stderr. Run in a terminal, it says how a client starts it instead (exit 2).
 *
 * Usage: node x mcp [--headless] [--page p] [--scene s] [--cam code] [--set k=v…] [--watch dir…]. Exit 0 when the
 * client has gone, 2 on a usage error.
 *
 * @example
 * openArgs({ scene: 'room', set: ['box.room.speed=3'] }); // { page: 'labs/box', params: { scene: 'room', … } }
 * @see tools/cmd/mcp.test.ts
 * @see tests/e2e/mcp.spec.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { OpenArgs } from '../mcp/backend';
import { forkLink } from '../mcp/link';
import { createBridge, WATCHED } from '../mcp/server';
import { UsageError, type Command, type CommandResult } from '../x';

/** What the flags name to open first, or undefined when they name nothing. */
export function openArgs(values: Record<string, unknown>): OpenArgs | undefined {
  const sets = (values.set ?? []) as string[];
  if (values.page === undefined && values.scene === undefined && values.cam === undefined && !sets.length) return;
  const params: Record<string, string> = {};
  if (values.scene !== undefined) params.scene = String(values.scene);
  if (values.cam !== undefined) params.cam = String(values.cam);
  for (const pair of sets) {
    const at = pair.indexOf('=');
    if (at < 1) throw new UsageError(`--set takes key=value (a setting's path, then its value), not "${pair}"`);
    params[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return { page: (values.page as string | undefined) ?? 'labs/box', params };
}

/** Sends what `console.log`, `info` and `debug` print to stderr: in `x mcp`, stdout carries MCP's messages alone. */
function keepStdout(): void {
  const toStderr = (...args: unknown[]) => console.error(...args);
  Object.assign(console, { log: toStderr, info: toStderr, debug: toStderr });
}

export default {
  usage: 'mcp [--headless] [--page p] [--scene s] [--cam code] [--set k=v…] [--watch dir…]',
  options: {
    headless: { type: 'boolean' },
    page: { type: 'string' },
    scene: { type: 'string' },
    cam: { type: 'string' },
    set: { type: 'string', multiple: true },
    watch: { type: 'string', multiple: true },
    worker: { type: 'boolean' },
  },
  maxPositionals: 0,
  async run({ values, root }): Promise<CommandResult> {
    const backend = values.headless ? 'headless' : 'page';
    if (values.worker) {
      const { serveWorker } = await import('../mcp/worker');
      const made = values.headless
        ? (await import('../mcp/headless')).headlessBackend(root)
        : (await import('../mcp/session')).pageBackend(root);
      return serveWorker(root, made);
    }
    const open = openArgs(values);
    if (process.stdin.isTTY) {
      throw new UsageError(
        `x mcp speaks MCP on stdin and stdout: an MCP client starts it, { "command": "node", "args": ["${join(root, 'x.js')}", "mcp"] }`,
      );
    }
    keepStdout();
    const version = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }).version;
    const watch = (values.watch as string[] | undefined) ?? [...WATCHED];
    const bridge = createBridge({
      root,
      backend,
      open,
      watch,
      version,
      start: () => forkLink(root, values.headless ? ['--headless'] : []),
    });
    const transport = new StdioServerTransport();
    const end = () => void transport.close();
    process.stdin.once('end', end);
    process.once('SIGTERM', end);
    process.once('SIGINT', end);
    await bridge.serve(transport);
    await bridge.close();
    return {
      ok: true,
      target: 'stdio',
      summary: `served ${bridge.calls} tool call(s) over stdio, on ${backend === 'page' ? 'a page in the x inspect session' : 'createHeadless'}`, // prettier-ignore
      metrics: { calls: bridge.calls },
    };
  },
} satisfies Command;
