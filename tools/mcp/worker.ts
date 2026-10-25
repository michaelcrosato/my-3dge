/**
 * @file The MCP bridge's backend worker (PLAN.md §8.11, WP 7.6): the process that holds the engine's code and a
 * backend, answering the server's requests (tools/mcp/link.ts). `node x mcp --worker [--headless]` runs it
 * (`serveWorker`, over the IPC channel its server forked it with); tests run `createWorker` in their own process.
 *
 * - `tools`: the tool list, generated from the members registered here (tools/mcp/tools.ts `toolList`).
 * - `resume`: hands the backend what to open (tools/mcp/backend.ts `resume`), in the background, so the tool list is
 *   answered while a page warms up; every call waits for that open first, sending progress, and the first after a
 *   failed one says why first. It answers the backend's kind and whether an x inspect session ran before.
 * - `call`: runs one tool (tools/mcp/tools.ts `runTool`), its result led by what the backend says happened since
 *   the last call (the page reloaded after a change).
 * - `shutdown`: closes the backend, `stop` ending an x inspect session too.
 *
 * Invariants: a call never throws across the link (a failure is an `isError` result); the worker exits when its
 * server disconnects, leaving any x inspect session up for the next worker (only `shutdown` with `stop` ends one).
 *
 * @example
 * // in node x mcp --worker: await serveWorker(process.cwd(), pageBackend(process.cwd()));
 * @see tools/mcp/server.test.ts
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { registry } from '../../engine/core/registry';
import { findSession } from '../cmd/inspect';
import type { Backend, Opened, Progress } from './backend';
import type { WorkerHandler, WorkerReply, WorkerRequest } from './link';
import { errorLine } from './results';
import { PROGRESS_MS } from './session';
import { runTool, toolList } from './tools';

/** A worker over `backend`, for the repository at `root`: the handler a link calls. */
export function createWorker(root: string, backend: Backend): WorkerHandler {
  let opening: Promise<Opened | null> | null = null;
  const waitOpen = async (progress: Progress): Promise<string[]> => {
    if (!opening) return [];
    const timer = setInterval(() => progress('waiting for the page x mcp opens to signal ready'), PROGRESS_MS);
    try {
      const opened = await opening;
      return opened && (!opened.ready || opened.errors.length) ? [`${opened.page} did not start: ${opened.errors.join('; ') || 'not ready'}`] : []; // prettier-ignore
    } catch (error) {
      return [`the page x mcp opens did not open: ${errorLine(error)}`];
    } finally {
      clearInterval(timer);
      opening = null;
    }
  };
  return async (request: WorkerRequest, progress: Progress) => {
    switch (request.op) {
      case 'tools':
        return toolList(registry, backend.renders);
      case 'resume': {
        const running = backend.kind === 'page' && findSession(root) !== null;
        opening = backend.resume(request.open, request.first, progress);
        opening.catch(() => undefined); // its failure is the next call's first line
        return { kind: backend.kind, running };
      }
      case 'call': {
        const said = await waitOpen(progress);
        const result = await runTool(request.name, request.input, { root, backend, registry, progress });
        const notices = [...said, ...backend.notices()];
        if (!notices.length) return result;
        return { ...result, content: [{ type: 'text', text: notices.join('\n') }, ...result.content] } satisfies CallToolResult; // prettier-ignore
      }
      case 'shutdown':
        await backend.close(request.stop);
        return { closed: true };
    }
  };
}

/** Answers the server that forked this process (tools/mcp/link.ts `forkLink`) until it disconnects. */
export function serveWorker(root: string, backend: Backend): Promise<never> {
  const handle = createWorker(root, backend);
  const send = (reply: WorkerReply) => void process.send?.(reply);
  process.on('message', (message: { id: number; request: WorkerRequest }) => {
    const progress = (line: string) => send({ id: message.id, progress: line });
    handle(message.request, progress).then(
      (value) => send({ id: message.id, value }),
      (error: unknown) => send({ id: message.id, error: errorLine(error) }),
    );
  });
  process.once('disconnect', () => process.exit(0));
  return new Promise<never>(() => undefined);
}
