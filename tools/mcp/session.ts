/**
 * @file The MCP bridge's page backend (PLAN.md §8.11, WP 7.6): a page open in the `x inspect` session
 * (tools/cmd/inspect.ts), on WebGPU in the platform's Chromium, the backend `x mcp` serves by default. It talks to the
 * session as `x eval` does (`callSession`: `status`, `goto`, `eval`, `stop`), so an agent with a shell and one
 * without drive the same page, and `x shot`, `x eval` and `x dump` see what the MCP client changed.
 *
 * - `open` builds the page's path from its parameters as `x inspect --scene --cam --set` would (tools/mcp/backend.ts
 *   `openPath`) and navigates the session there, starting the session when none runs (`x inspect`'s own `run`, which
 *   starts it detached); it waits until the page signals ready or an error (tools/lib/page.ts `READY_MS`), sending
 *   progress every few seconds meanwhile, since the playground's site warms its pipelines for minutes here.
 * - `call` evaluates `__engine.<member>(…args)` (a value member is read) in the open page, after making sure the page
 *   is ready: when Vite reloaded it after a change (the session's `reloaded`), it waits for the new page and says so
 *   first, since the reload started its run again.
 * - `forReplay` opens the page that draws a replay's scene when another shows (tools/lib/page.ts `labPageOf`,
 *   `scenePath`), as `x replay --browser page` does; a fixture scene has no page.
 * - `resume` takes up the running session as it is; only the first start opens the page `x mcp`'s flags name, when
 *   the session shows another or none runs. `close(stop)` ends the session only when asked: the server asks when no
 *   session ran before it, so a session an agent started by hand outlives the server, as does one across a restart.
 *
 * Invariants: arguments reach the page as JSON (an absent one stays absent); a page that signals errors or never
 * signals ready fails the call naming its errors and out/inspect/serve.log.
 *
 * @example
 * memberExpression('camera.set', ['cam=iso']); // "__engine.camera.set(\"cam=iso\")"
 * memberExpression('step', [60, undefined]); // '__engine.step(60)'
 * @see tools/mcp/session.test.ts
 * @see tests/e2e/mcp.spec.ts
 */
import '../../engine/app/headless'; // registers every inspector member: which are read, not called
import { registry } from '../../engine/core/registry';
import type { Member } from '../../engine/dev/members';
import inspect, { callSession, findSession, reloadLines, type SessionInfo } from '../cmd/inspect';
import { labPageOf, READY_MS, scenePath, type Signals } from '../lib/page';
import { sceneModules } from '../lib/scenes';
import { openPath, type Backend, type OpenArgs, type Opened, type Progress } from './backend';

/** How often a wait for the page sends progress, ms. */
export const PROGRESS_MS = 5_000;

/** The session's `status` reply. */
interface Status {
  page: string;
  signals?: Signals;
  reloaded?: string;
}

/** The JavaScript that calls (or reads) member `name` with `args` in a page: an absent argument stays absent. */
export function memberExpression(name: string, args: readonly unknown[], value = false): string {
  if (value) return `__engine.${name}`;
  const given = [...args];
  while (given.length && given.at(-1) === undefined) given.pop();
  const text = given.map((arg) => (arg === undefined ? 'undefined' : JSON.stringify(arg))).join(', ');
  return `__engine.${name}(${text})`;
}

/** Runs `task`, sending `progress` every `PROGRESS_MS` while it waits. */
async function withProgress<T>(what: string, progress: Progress, task: () => Promise<T>): Promise<T> {
  const started = Date.now();
  const timer = setInterval(() => progress(`${what}: ${Math.round((Date.now() - started) / 1000)} s`), PROGRESS_MS);
  try {
    return await task();
  } finally {
    clearInterval(timer);
  }
}

/** What opened, from the session's status; a page still warming up says that the next call waits for it. */
function openedOf(status: Status): Opened {
  const signals = status.signals;
  const opened: Opened = { page: status.page, ready: signals?.ready === true, errors: signals?.errors ?? [], ...(signals?.info ? { info: signals.info } : {}) }; // prettier-ignore
  if (opened.ready || opened.errors.length) return opened;
  const note = `it signalled neither ready nor an error within ${READY_MS} ms, still warming its pipelines (the playground's site takes minutes on SwiftShader under load): the next call waits for it as long again; out/inspect/serve.log has its log`; // prettier-ignore
  return { ...opened, note };
}

/** The page backend over the repository at `root` (see the file comment). */
export function pageBackend(root: string): Backend {
  const pending: string[] = [];
  const running = (): SessionInfo => {
    const session = findSession(root);
    if (!session) throw new Error("MCP_NOT_OPEN: no x inspect session runs: call engine_open first ({ page: 'labs/box', params: { scene: 'room' } })"); // prettier-ignore
    return session;
  };
  const status = async (session: SessionInfo) => {
    const reply = await callSession<Status>(session, 'status');
    pending.push(...reloadLines(reply).map((line) => `${line}: its run started again`));
    return reply;
  };
  /** Waits until the open page signals ready; throws naming its errors, or when it never does. */
  const settle = async (session: SessionInfo, progress: Progress): Promise<Status> => {
    const deadline = Date.now() + READY_MS;
    return withProgress('waiting for the page to signal ready', progress, async () => {
      for (;;) {
        const reply = await status(session).catch(() => undefined); // a reloading page answers nothing for a moment
        if (reply?.signals?.ready) return reply;
        if (reply?.signals?.errors.length) throw new Error(`MCP_PAGE_ERROR: ${reply.page} signalled ${reply.signals.errors.join('; ')}`); // prettier-ignore
        if (Date.now() > deadline) throw new Error(`MCP_NOT_READY: ${reply?.page ?? 'the page'} signalled neither ready nor an error within ${READY_MS} ms: see out/inspect/serve.log`); // prettier-ignore
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    });
  };
  const goto = async (path: string, progress: Progress): Promise<Opened> => {
    const session = findSession(root);
    await withProgress(`opening ${path}`, progress, async () => {
      if (session) return void (await callSession(session, 'goto', { page: path }));
      const result = await inspect.run({ values: { page: path }, positionals: [], root });
      const failed = (result.failures ?? []).filter((failure) => failure.id !== 'INSPECT_NOT_READY'); // a slow page: below
      if (failed.length) throw new Error(`MCP_PAGE_ERROR: ${failed.map((failure) => failure.message).join('; ')}`);
    });
    return openedOf(await status(running()));
  };
  return {
    kind: 'page',
    renders: true,
    open: (page, params, progress) => goto(openPath(page, params), progress),
    async resume(open: OpenArgs | undefined, first, progress) {
      const session = findSession(root);
      const path = open && first ? openPath(open.page, open.params) : undefined;
      if (path !== undefined && session?.page !== path) return goto(path, progress);
      return session ? openedOf(await status(session)) : null;
    },
    async call(name, args, progress) {
      const session = running();
      await settle(session, progress);
      const member = registry.get('inspectorMember', name) as Member; // CORE_NO_ENTRY names the closest
      const reply = await callSession<{ value: unknown; reloaded?: string }>(session, 'eval', { js: memberExpression(name, args, member.value) }); // prettier-ignore
      pending.push(...reloadLines(reply).map((line) => `${line}: its run started again`));
      return reply.value;
    },
    async forReplay(scene, progress) {
      const file = sceneModules(root).get(scene);
      if (!file)
        throw new Error(`MCP_NO_SCENE: no module under labs/ or fixtures/ defines the replay's scene ${scene}`);
      const path = scenePath(labPageOf(root, file), scene);
      if (findSession(root)?.page !== path) await goto(path, progress);
    },
    notices: () => pending.splice(0),
    async close(stop) {
      const session = findSession(root);
      if (stop && session) await callSession(session, 'stop').catch(() => undefined);
    },
  };
}
