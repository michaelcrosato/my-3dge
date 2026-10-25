/**
 * @file The MCP server `x mcp` runs (PLAN.md §8.11, WP 7.6), on the official SDK's `Server`: the low-level one, since
 * its tools are generated at run time as JSON Schema from the inspector's member table, which the SDK's `McpServer`
 * takes only as zod schemas (a dependency of ours, which the bridge does without). It answers the client's requests
 * for the tool list and its tool calls by asking its backend worker (tools/mcp/link.ts), which generates and runs the
 * tools (tools/mcp/worker.ts), and holds nothing of the engine itself.
 *
 * Restarts: a running process keeps serving the code it loaded, so when a watched directory changes (`watch`, by
 * default engine/, labs/, tools/, fixtures/ and data/: what the worker loads) the next request first ends the worker
 * and starts another, which loads the code as it is now. The client keeps its connection: the next result starts
 * with a line saying the backend restarted and what that did (headless, the last opened scene started again from
 * step 0; in a page, Vite reloads the page itself, the x inspect session living on), and when the new tool list
 * differs the client gets `notifications/tools/list_changed`. A worker that exits fails its call and the next starts
 * a new one. A change to this file or tools/cmd/mcp.ts takes a reconnect.
 *
 * Calls run one at a time, in the order they came, so a step, a shot and a set land as sent; a call's progress lines
 * reach a client that gave a progress token (a page warming up for minutes keeps a client's timeout from firing).
 * `engine_open`'s arguments, once it succeeds, are what a restarted headless worker opens again.
 *
 * Invariants: every request is answered (a backend failure is an `isError` result, never a dropped request); at
 * `close` the worker ends, and with it the x inspect session when none ran before the server started.
 *
 * @example
 * // const bridge = createBridge({ root, backend: 'headless', start: () => forkLink(root, ['--headless']) });
 * // await bridge.serve(new StdioServerTransport()); // until the client goes
 * @see tools/mcp/server.test.ts
 * @see tools/cmd/mcp.test.ts
 */
import { existsSync, watch, type FSWatcher } from 'node:fs';
import { resolve } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import type { OpenArgs } from './backend';
import type { WorkerLink } from './link';

/** The directories whose changes restart the worker: what it loads. */
export const WATCHED = ['engine', 'labs', 'tools', 'fixtures', 'data'] as const;

/** How `createBridge` is set up. */
export interface BridgeOptions {
  /** The repository root. */
  root: string;
  /** What the worker drives, for the client's instructions. */
  backend: 'page' | 'headless';
  /** Starts a worker: `forkLink` in `x mcp`, `localLink` in tests. */
  start(): WorkerLink;
  /** What the first worker opens (`x mcp`'s flags). */
  open?: OpenArgs;
  /** Directories to watch for changes, from `root` or absolute (none by default). */
  watch?: readonly string[];
  /** The server's version, for the client. */
  version?: string;
}

/** A running bridge. */
export interface Bridge {
  readonly server: Server;
  /** Tool calls answered so far. */
  readonly calls: number;
  /** Marks the worker stale after `paths` changed: the next request starts a new one first. */
  changed(paths: readonly string[]): void;
  /** Connects `transport`; resolves when it closes. */
  serve(transport: Transport): Promise<void>;
  /** Ends the worker (and the session it should end) and the watchers. */
  close(): Promise<void>;
}

/** What the client is told the server is for. */
function instructions(backend: BridgeOptions['backend']): string {
  const on = backend === 'page' ? "a page in the x inspect session, on WebGPU" : 'createHeadless in Node: the sim and its view, no renderer'; // prettier-ignore
  return [
    `my-3dge's engine through its inspector (window.__engine), on ${on}.`,
    "Open with engine_open (labs/box with params { scene: 'room' }; labs/playground with { scene: 'site' }), step with engine_step,",
    'drive the player with engine_input and engine_actions, read with engine_state and engine_dump, look with engine_shot',
    '(a PNG and the ID pass), set settings with engine_set, play replay files with engine_replay. Any other member',
    '(camera.set, bot, feel, stats…) through engine_call; engine_help lists them, docs_lookup reads the manual.',
    'A result led by a notice says the backend restarted or the page reloaded after a code change: its run started again.',
  ].join(' ');
}

/** The line a restart leads the next result with: after `paths` changed, or after the worker exited. */
function restartLine(paths: readonly string[], backend: BridgeOptions['backend'], open?: OpenArgs): string {
  const why = paths.length
    ? `after a change to ${paths[0]}${paths.length > 1 ? ` and ${paths.length - 1} more` : ''}`
    : 'after the last one exited';
  const what =
    backend === 'page'
      ? 'the tools follow the code as it is now, and Vite reloads the page itself'
      : open
        ? `${open.page} started again from step 0`
        : 'nothing is open';
  return `the backend restarted ${why} since the last call: ${what}`;
}

/** Makes the bridge (see the file comment). */
export function createBridge(options: BridgeOptions): Bridge {
  const server = new Server(
    { name: 'my-3dge', version: options.version ?? '0.0.0' },
    { capabilities: { tools: { listChanged: true } }, instructions: instructions(options.backend) },
  );
  let link: WorkerLink | null = null;
  let lastOpen = options.open;
  let ranBefore = true;
  let tools: Tool[] = [];
  let exited = false;
  let notice: string | undefined;
  let calls = 0;
  let tail: Promise<unknown> = Promise.resolve();
  const stale = new Set<string>();
  const queue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
  let closed = false;
  let resumed = false; // a worker took up the run: every later start is a restart
  /** The worker, started first when there is none, the code changed or the last one exited. */
  const ready = async (): Promise<WorkerLink> => {
    if (closed) throw new Error('MCP_CLOSED: the server is closing');
    if (link && !stale.size && !exited) return link;
    const first = !resumed; // a first worker that died before taking up the run leaves the next one first
    const paths = [...stale].sort();
    stale.clear();
    exited = false;
    await link?.close();
    link = options.start();
    const reply = await link.request<{ running: boolean }>({ op: 'resume', open: lastOpen, first });
    if (first) ranBefore = reply.running;
    const listed = await link.request<Tool[]>({ op: 'tools' });
    if (!first) notice = restartLine(paths, options.backend, lastOpen);
    if (!first && JSON.stringify(listed) !== JSON.stringify(tools)) void server.sendToolListChanged().catch(() => undefined); // prettier-ignore
    resumed = true;
    tools = listed;
    return link;
  };

  server.setRequestHandler(ListToolsRequestSchema, () => queue(async () => (await ready(), { tools })));
  server.setRequestHandler(CallToolRequestSchema, (request, extra) => {
    const token = extra._meta?.progressToken;
    let n = 0;
    const progress = (message: string) =>
      void extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token!, progress: ++n, message } }).catch(() => undefined); // prettier-ignore
    const { name, arguments: input = {} } = request.params;
    return queue(async (): Promise<CallToolResult> => {
      let result: CallToolResult;
      try {
        result = await (await ready()).request<CallToolResult>({ op: 'call', name, input }, token === undefined ? undefined : progress); // prettier-ignore
      } catch (error) {
        exited = true;
        result = { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true }; // prettier-ignore
      }
      calls++;
      if (name === 'engine_open' && !result.isError) lastOpen = input as unknown as OpenArgs;
      const said = notice;
      notice = undefined;
      return said ? { ...result, content: [{ type: 'text', text: said }, ...result.content] } : result;
    });
  });

  const watchers: FSWatcher[] = [];
  for (const dir of options.watch ?? []) {
    if (!existsSync(resolve(options.root, dir))) continue;
    const watcher = watch(resolve(options.root, dir), { recursive: true }, (_event, file) => {
      if (file && !/(^|\/)(node_modules|\.cache|out)\//.test(String(file))) stale.add(`${dir}/${String(file)}`);
    });
    watchers.push(watcher);
  }
  const bridge: Bridge = {
    server,
    get calls() {
      return calls;
    },
    changed: (paths) => paths.forEach((path) => stale.add(path)),
    async serve(transport) {
      const ended = new Promise<void>((done) => (server.onclose = done));
      await server.connect(transport);
      await ended;
    },
    async close() {
      closed = true;
      for (const watcher of watchers.splice(0)) watcher.close();
      const last = link;
      link = null;
      if (!last) return;
      await last.request({ op: 'shutdown', stop: !ranBefore }).catch(() => undefined); // a call still waiting fails
      await last.close();
    },
  };
  return bridge;
}
