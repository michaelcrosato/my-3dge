/**
 * @file How the MCP server reaches its backend worker (PLAN.md §8.11, WP 7.6): requests and replies over a
 * `WorkerLink`. `forkLink` starts the worker as a process of its own, `node x mcp --worker` (tools/mcp/worker.ts),
 * and talks to it over Node's IPC channel; `localLink` calls a worker in this process (the tests). The server holds
 * the client's stdio connection for as long as the client stays, and starts a new worker when the code changes
 * (tools/mcp/server.ts), since a process keeps serving the modules it loaded: the worker loads the engine, the
 * server never does (this module imports Node's alone).
 *
 * The requests: `tools` (the tool list, generated in the worker), `call` (one tool), `resume` (take up what runs,
 * opening what `x mcp`'s flags or the last `engine_open` named; answers whether an x inspect session ran before) and
 * `shutdown` (`stop`: also end the x inspect session). While a request runs the worker may send progress lines.
 *
 * Invariants: replies come back by request id, in any order; a worker that exits fails every request it holds,
 * naming its exit and its last error line (an engine module that no longer loads: its `X_CRASH`); the worker's stdout
 * and stderr go to this process's stderr, never its stdout, which in `x mcp` is the MCP channel.
 *
 * @example
 * const link = localLink(async (request) => (request.op === 'tools' ? [] : null));
 * await link.request({ op: 'tools' }); // []
 * @see tools/mcp/link.test.ts
 * @see tools/cmd/mcp.test.ts
 */
import { fork } from 'node:child_process';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import type { OpenArgs, Progress } from './backend';

/** What the server asks its worker (see the file comment). */
export type WorkerRequest =
  | { op: 'tools' }
  | { op: 'call'; name: string; input: unknown }
  | { op: 'resume'; open?: OpenArgs; first: boolean }
  | { op: 'shutdown'; stop: boolean };

/** What a worker answers: a value, an error's first line, or (before either) a progress line. */
export type WorkerReply = { id: number } & ({ value: unknown } | { error: string } | { progress: string });

/** A worker answers requests (tools/mcp/worker.ts `createWorker`). */
export type WorkerHandler = (request: WorkerRequest, progress: Progress) => Promise<unknown>;

/** The server's side of a worker. */
export interface WorkerLink {
  /** Sends `request`; resolves with the reply's value, or rejects with its error. */
  request<T = unknown>(request: WorkerRequest, progress?: Progress): Promise<T>;
  /** Ends the worker. */
  close(): Promise<void>;
}

/** A worker in this process. */
export function localLink(handler: WorkerHandler): WorkerLink {
  return {
    request: async <T>(request: WorkerRequest, progress?: Progress) =>
      (await handler(request, progress ?? (() => undefined))) as T,
    close: async () => undefined,
  };
}

/** Starts `node x mcp --worker <args…>` under `root` and links to it over IPC; its output goes to `output`. */
export function forkLink(root: string, args: readonly string[], output: Writable = process.stderr): WorkerLink {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST')));
  const child = fork(join(root, 'x.js'), ['mcp', '--worker', ...args], {
    cwd: root,
    env,
    execArgv: [],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  child.stdout?.pipe(output);
  child.stderr?.pipe(output);
  const said: string[] = []; // its last lines: why it exited, for a client that never sees stderr
  const keep = (chunk: Buffer) => {
    said.push(
      ...String(chunk)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    );
    said.splice(0, Math.max(0, said.length - 8));
  };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);
  const waiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; progress?: Progress }>(); // prettier-ignore
  let next = 0;
  let gone: string | undefined;
  /** Fails every request held, and every one after, naming `why` (the first reason given stands). */
  const fail = (why: string) => {
    gone ??= why;
    for (const entry of waiting.values()) entry.reject(new Error(`MCP_BACKEND: ${gone}: the next call starts it again`)); // prettier-ignore
    waiting.clear();
  };
  child.on('message', (reply: WorkerReply) => {
    const entry = waiting.get(reply.id);
    if (!entry) return;
    if ('progress' in reply) return entry.progress?.(reply.progress);
    waiting.delete(reply.id);
    if ('error' in reply) entry.reject(new Error(reply.error));
    else entry.resolve(reply.value);
  });
  child.on('error', (error) => fail(`the backend (x mcp --worker) failed: ${error.message}`));
  /** Resolves when `stream` has ended. */
  const ended = (stream: Readable | null) =>
    new Promise<void>((resolve) => (!stream || stream.readableEnded ? resolve() : stream.once('end', resolve)));
  // `exit`, not `close`: a grandchild holding the worker's stderr (tsx's esbuild service) can keep `close` from coming.
  // The last lines are read first, the drain capped at a second for such a grandchild.
  const exited = new Promise<void>((resolve) =>
    child.once('exit', (code, signal) => {
      const cap = new Promise<void>((done) => setTimeout(done, 1_000).unref());
      void Promise.race([Promise.all([ended(child.stdout), ended(child.stderr)]), cap]).then(() => {
        const why = [...said].reverse().find((line) => /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b|Error\b/.test(line)) ?? said.at(-1); // prettier-ignore
        fail(`the backend (x mcp --worker, pid ${child.pid}) exited (${signal ?? `code ${code}`})${why ? `, saying ${why}` : ''}`); // prettier-ignore
        resolve();
      });
    }),
  );
  return {
    request<T>(request: WorkerRequest, progress?: Progress) {
      if (gone) return Promise.reject(new Error(`MCP_BACKEND: ${gone}: the next call starts it again`));
      const id = ++next;
      return new Promise<T>((resolve, reject) => {
        waiting.set(id, { resolve: resolve as (value: unknown) => void, reject, progress });
        child.send({ id, request }, (error) => error && fail(`the backend (x mcp --worker) took no request: ${error.message}`)); // prettier-ignore
      });
    },
    async close() {
      if (!gone && child.connected) child.disconnect();
      const killed = setTimeout(() => child.kill('SIGKILL'), 5_000);
      await exited;
      clearTimeout(killed);
    },
  };
}
