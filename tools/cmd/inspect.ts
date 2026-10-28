/**
 * @file Keeps one headless page open over the Vite dev server, for `x eval`, `x dump` and `x set`, which `x shot`
 * reuses while it runs (PLAN.md §8.1, WP 2.7; doctrine: Agent-operable).
 *
 * `node x inspect [--page p] [--scene s] [--cam code] [--set k=v…]` starts the session in the background (`--serve`
 * in a detached process, its log in out/inspect/serve.log), waits until the page signals ready or an error, and
 * returns: the page (labs/box by default) is open in the platform's Chromium on WebGPU, set up as `x shot` sets pages
 * up (tools/lib/browser.ts: the virtual clock, seed 1). `out/inspect/session.json` says where it listens. Run again
 * with another page, scene, camera or setting, it opens that in the same session; with none, it reports the session.
 * `--stop` ends it. When Vite reloads the page after a file changes, the next reply says so first.
 *
 * The session answers on 127.0.0.1 with JSON (`callSession`): `status`, `eval` (an expression, awaited, its value as
 * JSON), `dump` (`__engine.scene.dump` and the state), `set` (`__engine.set`), `goto` (which rewrites session.json)
 * and `shot` (`sessionShot`: `__engine.shot` on the open page when it shows the URL asked, else in a new tab of the
 * same browser; no shot when that page is not ready or has no `__engine.shot`, and `x shot` then takes its own), and
 * `stop`. Every reply names the page open now (`page`): `x eval`, `x set` and `x dump` report it, and `x inspect`
 * compares it with the page asked for. `shootInSession` and `pageFailures` are `x shot`'s; tools/lib/page.ts has the
 * page helpers.
 *
 * Usage: node x inspect [--page p] [--scene s] [--cam code] [--set k=v…] [--stop] [--serve]. Exit 0 when the session
 * is up (or stopped), 1 when the page failed to start, 2 on a usage error.
 *
 * @example
 * reloadLines({ reloaded: '12:00:01' }); // ['the page reloaded after a change (12:00:01) since the last call']
 * @see tools/cmd/inspect.test.ts
 * @see tests/e2e/box.spec.ts
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { join } from 'node:path';
import type { Browser, Page } from '@playwright/test';
import { launchBrowser, preparePage, VIEWPORT, type ConsoleRecord } from '../lib/browser';
import { describePageError, type PageError } from '../lib/pageErrors';
import type { Finding } from '../lib/report';
import type { ShotJson, ShotOptions } from '../../engine/gfx/shot';
import { readSignals, READY_MS, waitReady, type PageEngine, type Signals } from '../lib/page';
import { freePort, startVite } from '../lib/vite';
import { UsageError, type Command, type CommandResult } from '../x';
import { pageUrl, resolvePage } from './shot';

/** The page's engine, inside `evaluate`. */
declare const __engine: PageEngine;

/** Where a running session says where it listens. */
export const SESSION_FILE = join('out', 'inspect', 'session.json');
/** What `session.json` holds. */
export interface SessionInfo {
  pid: number;
  port: number;
  /** The Vite server's base URL. */
  vite: string;
  /** The page path open now: `labs/box/?scene=room`. */
  page: string;
  ready: boolean;
}

/** The running session's info, or null; a session whose process is gone is cleared. */
export function findSession(root: string): SessionInfo | null {
  const file = join(root, SESSION_FILE);
  if (!existsSync(file)) return null;
  const info = JSON.parse(readFileSync(file, 'utf8')) as SessionInfo;
  try {
    process.kill(info.pid, 0);
    return info;
  } catch {
    rmSync(file, { force: true });
    return null;
  }
}

/** Sends `op` with `body` to the session; resolves with its JSON reply, or rejects with its error's message. */
export function callSession<T = Record<string, unknown>>(
  session: SessionInfo,
  op: string,
  body: object = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: session.port, path: `/${op}`, method: 'POST' }, (res) => {
      let text = '';
      res.on('data', (chunk: Buffer) => (text += chunk));
      res.on('end', () => {
        const reply = JSON.parse(text || '{}') as { error?: string };
        if (res.statusCode === 200) resolve(reply as T);
        else reject(new Error(reply.error ?? `the inspect session answered ${res.statusCode}`));
      });
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

/** The line every reply starts with when Vite reloaded the page since the last one, else nothing. */
export const reloadLines = (reply: { reloaded?: string }) =>
  reply.reloaded ? [`the page reloaded after a change (${reply.reloaded}) since the last call`] : [];

/** A shot taken (for `x shot`), with what the page said: its signal, its failures so far and its console. */
export interface Opened {
  shot: ShotJson;
  noIds?: string;
  signals: Signals;
  failures: Finding[];
  console: ConsoleRecord[];
  runtime: string;
  /** A line saying the inspect session was reused. */
  reused?: string;
}

/** A page error as a failure. */
export const pageErrorFinding =
  (page: string) =>
  (error: PageError): Finding => ({
    id: 'SHOT_PAGE_ERROR',
    message: `${page} threw: ${describePageError(error)}`,
    ...(error.file ? { file: error.file, line: error.line } : {}),
  });

/** The failures of a page that should be ready within `ms`: its thrown errors, its error signals, no signal, another backend. */ // prettier-ignore
export function pageFailures(page: string, file: string, signals: Signals | undefined, thrown: Finding[], ms = READY_MS): Finding[] { // prettier-ignore
  const failures = [...thrown];
  for (const error of signals?.errors ?? [])
    failures.push({ id: 'SHOT_PAGE_SIGNAL', message: `${page} signalled ${error}` });
  if (!signals?.ready && failures.length === 0) {
    const message = `${page} signalled neither window.__engine.ready nor an error within ${ms} ms; publish __engine (PLAN.md §8.3), or give a page still warming up longer (--ready-ms)`; // prettier-ignore
    failures.push({ id: 'SHOT_NOT_READY', message, file });
  }
  const backend = signals?.info?.backend ?? (signals?.info?.adapter as { backend?: unknown } | undefined)?.backend;
  if (failures.length === 0 && backend !== undefined && backend !== 'WebGPU') {
    failures.push({
      id: 'SHOT_NOT_WEBGPU',
      message: `${page} reports backend ${String(backend)}, not WebGPU (PLAN.md §6.7)`,
    });
  }
  return failures;
}

/**
 * Shoots `path` through the running inspect session (tools/cmd/inspect.ts): its page when it shows `path`, else a new
 * tab of its browser; null when the page has no `__engine.shot` (then `x shot` screenshots it itself).
 */
export async function shootInSession(
  session: SessionInfo,
  path: string,
  options: ShotOptions,
  page: string,
): Promise<Opened | null> {
  const reply = await callSession<{
    shot: ShotJson | null;
    signals?: Signals;
    thrown?: string[];
    console?: ConsoleRecord[];
    reused: string;
  }>(session, 'shot', { path, options });
  if (!reply.shot || !reply.signals) return null;
  const thrown = (reply.thrown ?? []).map((message) => ({
    id: 'SHOT_PAGE_ERROR',
    message: `${page} threw: ${message}`,
  }));
  return {
    shot: reply.shot,
    signals: reply.signals,
    failures: pageFailures(page, resolvePage(page).file, reply.signals, thrown),
    console: reply.console ?? [],
    runtime: String((reply.signals.info?.runtime as string | undefined) ?? 'chromium (inspect session)'),
    reused: `reused the inspect session (pid ${session.pid}, its ${reply.reused})`,
  };
}

/** `__engine.shot(options)` in `tab` when its signal says ready and it has a `shot`, else null. */
async function shootIfAble(tab: Page, signals: Signals | undefined, options: unknown): Promise<ShotJson | null> {
  if (!signals?.ready || !signals.shoots) return null;
  return (await tab.evaluate((o) => __engine.shot(o), options)) as ShotJson;
}

/** What the session's `shot` op works with: its tab, the page open in it, its browser, Vite's URL and the root. */
export interface SessionTab {
  tab: Page;
  current: string;
  browser: Pick<Browser, 'newPage'>;
  url: string;
  root: string;
}

/**
 * The session's `shot` op: the open tab when it shows `path`, else a new tab of the browser opened on `path`. The
 * shot is null when that page is not ready or has no `__engine.shot` (labs/hello), never a throw, so `shootInSession`
 * gives null and `x shot` screenshots the page in its own browser.
 */
export async function sessionShot(session: SessionTab, path: string, options: unknown) {
  if (path === session.current) {
    const signals = await readSignals(session.tab);
    return { shot: await shootIfAble(session.tab, signals, options), signals, reused: 'page' };
  }
  const other = await session.browser.newPage({ viewport: VIEWPORT });
  try {
    const watch = await preparePage(other, { seed: 1, root: session.root });
    await other.goto(`${session.url}${path}`);
    const signals = await waitReady(other, watch);
    const thrown = (await watch.errors()).map(describePageError);
    const shot = await shootIfAble(other, signals, options);
    return { shot, signals, thrown, console: watch.console, reused: 'browser' };
  } finally {
    await other.close();
  }
}

/** Runs the session in this process until `stop` (see the file comment). */
async function serve(root: string, page: string): Promise<void> {
  const server = await startVite({ root });
  const browser = await launchBrowser();
  const tab = await browser.newPage({ viewport: VIEWPORT });
  const watch = await preparePage(tab, { seed: 1, root });
  let current = page;
  let loads = 0;
  let reloaded: string | undefined;
  tab.on('load', () => {
    if (++loads > 1) reloaded = new Date().toISOString().slice(11, 19);
  });
  const open = async (path: string) => {
    current = path;
    loads = 0;
    await tab.goto(`${server.url}${path}`);
    return waitReady(tab, watch);
  };
  const port = await freePort();
  const write = (ready: boolean) =>
    writeFileSync(
      join(root, SESSION_FILE),
      `${JSON.stringify({ pid: process.pid, port, vite: server.url, page: current, ready } satisfies SessionInfo)}\n`,
    );
  const stop = async () => {
    rmSync(join(root, SESSION_FILE), { force: true });
    await browser.close();
    await server.close();
    process.exit(0);
  };
  const ops: Record<string, (body: Record<string, unknown>) => Promise<Record<string, unknown>>> = {
    status: async () => ({ page: current, signals: await readSignals(tab) }),
    goto: async (body) => {
      const signals = await open(String(body.page));
      write(true); // session.json names the page open now, for x eval, x set and x dump
      return { signals };
    },
    eval: async (body) => ({
      value: await tab
        .evaluate(`(async () => (${String(body.js)}))()`)
        .then((v) => JSON.parse(JSON.stringify(v ?? null))),
    }),
    set: async (body) => ({
      change: await tab.evaluate(([path, value]) => __engine.set(path, value), [body.path, body.value] as const),
    }),
    dump: async (body) =>
      tab.evaluate(
        ([steps, options]) => {
          if (steps) __engine.step(steps);
          const { tick } = __engine.info() as { tick: number };
          return { scene: __engine.scene.dump(options), hash: __engine.hash(), tick, entities: __engine.entities() };
        },
        [Number(body.step ?? 0), { depth: body.depth, filter: body.filter }] as const,
      ),
    shot: (body) => sessionShot({ tab, current, browser, url: server.url, root }, String(body.path), body.options),
    stop: async () => (setTimeout(() => void stop(), 50), { stopped: true }),
  };
  createServer((req, res) => {
    let text = '';
    req.on('data', (chunk: Buffer) => (text += chunk));
    req.on('end', async () => {
      const op = ops[(req.url ?? '/').slice(1)];
      try {
        if (!op) throw new Error(`the inspect session has no ${req.url}: ${Object.keys(ops).join(', ')}`);
        const result = await op(JSON.parse(text || '{}'));
        const reply = { page: current, ...result, reloaded };
        reloaded = undefined;
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(reply));
      } catch (error) {
        const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
        res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: message }));
      }
    });
  }).listen(port, '127.0.0.1');
  mkdirSync(join(root, 'out', 'inspect'), { recursive: true });
  write(false);
  await open(page);
  write(true);
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());
}

/** Starts `x inspect --serve` detached and waits for its session file to say ready; returns it. */
async function startSession(root: string, page: string): Promise<SessionInfo> {
  mkdirSync(join(root, 'out', 'inspect'), { recursive: true });
  const log = openSync(join(root, 'out', 'inspect', 'serve.log'), 'w');
  const child = spawn(process.execPath, [join(root, 'x.js'), 'inspect', '--serve', '--page', page], {
    cwd: root,
    detached: true,
    stdio: ['ignore', log, log],
  });
  child.unref();
  const deadline = Date.now() + READY_MS + 30_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const session = findSession(root);
    if (session && session.pid === child.pid && session.ready) return session;
    if (child.exitCode !== null) break;
  }
  throw new Error(`the inspect session did not start: see out/inspect/serve.log`);
}

export default {
  usage: 'inspect [--page p] [--scene s] [--cam code] [--set k=v…] [--stop] [--serve]',
  options: {
    page: { type: 'string' },
    scene: { type: 'string' },
    cam: { type: 'string' },
    set: { type: 'string', multiple: true },
    stop: { type: 'boolean' },
    serve: { type: 'boolean' },
  },
  maxPositionals: 0,
  async run({ values, root }): Promise<CommandResult> {
    if (values.stop) {
      const running = findSession(root);
      if (!running) return { ok: true, summary: 'no inspect session was running' };
      await callSession(running, 'stop');
      return { ok: true, summary: `stopped the inspect session (pid ${running.pid})` };
    }
    const asked = values.page !== undefined || values.scene !== undefined || values.cam !== undefined || values.set;
    const page = pageUrl((values.page as string | undefined) ?? 'labs/box', {
      scene: values.scene as string | undefined,
      cam: values.cam as string | undefined,
      set: (values.set ?? []) as string[],
    });
    if (!existsSync(join(root, resolvePage(page).file))) {
      throw new UsageError(`there is no page ${page}: name labs/<name> or an .html file`);
    }
    if (values.serve) {
      await serve(root, page);
      await new Promise(() => undefined); // until stop exits the process
    }
    let session = findSession(root);
    const lines: string[] = [];
    if (!session) session = await startSession(root, page);
    else if (asked) {
      const open = await callSession<{ page: string; reloaded?: string }>(session, 'status');
      lines.push(...reloadLines(open));
      if (open.page !== page) await callSession(session, 'goto', { page });
    }
    const reply = await callSession<{
      page: string;
      reloaded?: string;
      signals?: { ready: boolean; errors: string[] };
    }>(session, 'status');
    lines.push(...reloadLines(reply));
    const errors = reply.signals?.errors ?? [];
    const failures = errors.map((message) => ({ id: 'INSPECT_PAGE_ERROR', message }));
    if (!reply.signals?.ready && !errors.length)
      failures.push({ id: 'INSPECT_NOT_READY', message: `${reply.page} is not ready: see out/inspect/serve.log` });
    lines.push(
      `page: ${session.vite}${reply.page}`,
      'talk to it: node x eval "<js>", node x dump [--step n], node x set <key> <value>; node x shot reuses it',
      'stop it: node x inspect --stop',
    );
    return {
      ok: failures.length === 0,
      summary: `inspect session (pid ${session.pid}) on ${reply.page}: ${failures.length ? 'not ready' : 'ready'}`,
      target: 'session',
      lines,
      failures,
      metrics: { pid: session.pid, port: session.port },
    };
  },
} satisfies Command;
