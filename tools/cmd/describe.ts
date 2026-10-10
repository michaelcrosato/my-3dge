/**
 * @file Lists the registries from their schemas (PLAN.md §8.1, §6.6): `x describe` names every kind with its entry
 * count, `x describe <kind>` gives its fields (type, default, range, unit, docs) and ids, and `x describe <kind> <id>`
 * one entry's values, `*` marking those that differ from the default. Settings are the kind `setting`. In a page,
 * `__engine.describe(kind?, id?)` returns the same data (WP 1.6).
 *
 * Kinds plug in by themselves, as `x check` plugins do: nothing here names one. The modules under `engine/`, `labs/`
 * and `fixtures/` (tests aside) that register content are found from their syntax, comments and strings aside: a
 * call of `def(…)` or of a `define…(…)` function other than those that register nothing (`defineCodes`,
 * `defineSchema`, `defineProperty`, `defineProperties`, `defineConfig`), or of the registry members `.def(…)` and
 * `.defineKind(…)`. A child Node process imports them and lists the shared registry of engine/core/registry.ts,
 * then exits (ADR-0012 amendment 2): a module's side effects never touch the command, a timer it starts cannot keep
 * the command running, and one that never finishes loading is stopped after a minute and named. A module that
 * cannot load in Node is a warning naming it, and the listing goes on without it.
 *
 * Output: at most about 20 lines; the whole description is in `describe.json` beside the report. An unknown kind
 * or id is a usage error (exit 2) naming the closest.
 *
 * Usage: node x describe [kind [id]]. Exit 0 when the listing is complete or only warned about modules, 1 when the
 * child process hung or crashed.
 * @see tools/cmd/describe.test.ts
 */
import { fork } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { EngineError } from '../../engine/core/log';
import { registry, type EntryDescription, type KindDescription } from '../../engine/core/registry';
import type { FieldRow } from '../../engine/core/schema';
import { walk } from '../lib/docs';
import { targetSlug, type Finding } from '../lib/report';
import { UsageError, type Command, type CommandResult } from '../x';

/** Where modules that register content live. */
export const REGISTRATION_ROOTS = ['engine', 'labs', 'fixtures'];

/** `define…` functions called by name that register nothing: the log's, the schema's, the platform's, the tools'. */
const NOT_REGISTERING = new Set(['defineCodes', 'defineSchema', 'defineProperty', 'defineProperties', 'defineConfig']);
/** The registry members that register: `registry.def(…)`, a kind handle's `.def(…)`, `registry.defineKind(…)`. */
const REGISTERING_MEMBERS = new Set(['def', 'defineKind']);

/** Whether a parsed module calls something that registers content (comments, strings and declarations aside). */
export function registersContent(source: ts.SourceFile): boolean {
  const visit = (node: ts.Node): boolean => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee)) {
        const name = callee.text;
        if (name === 'def' || (/^define[A-Z]\w*$/.test(name) && !NOT_REGISTERING.has(name))) return true;
      } else if (ts.isPropertyAccessExpression(callee) && REGISTERING_MEMBERS.has(callee.name.text)) return true;
    }
    return ts.forEachChild(node, visit) ?? false;
  };
  return visit(source);
}

/** The modules under `root` that register content, repository-relative and sorted. */
export function registrationModules(root: string): string[] {
  return REGISTRATION_ROOTS.flatMap((dir) => walk(root, dir))
    .sort()
    .filter((file) => {
      if (!/\.(ts|js|mjs)$/.test(file) || /\.(test|spec)\.ts$|\.d\.ts$/.test(file)) return false;
      const text = readFileSync(join(root, file), 'utf8');
      return registersContent(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false));
    });
}

/** Imports each module that registers content, telling `loading` first; a module that fails becomes a warning. */
export async function loadRegistrations(
  root: string,
  loading: (file: string) => void | Promise<void> = () => {},
): Promise<{ loaded: string[]; warnings: Finding[] }> {
  const loaded: string[] = [];
  const warnings: Finding[] = [];
  for (const file of registrationModules(root)) {
    await loading(file);
    try {
      await import(pathToFileURL(join(root, file)).href);
      loaded.push(file);
    } catch (error) {
      const why = (error instanceof Error ? error.message : String(error)).split('\n')[0];
      const message = `${file} did not load in Node (${why}): its kinds and entries are missing from this listing; keep page-only work out of the top level of a module that registers content`;
      warnings.push({ id: 'DESCRIBE_LOAD', message, file });
    }
  }
  return { loaded, warnings };
}

/** One value, short, for a line. */
function brief(value: unknown, room = 40): string {
  const text = typeof value === 'string' ? JSON.stringify(value) : (JSON.stringify(value) ?? String(value));
  return text.length > room ? `${text.slice(0, room - 3)}...` : text;
}

/** One line for a field: name, type, default, range, unit, values, flags, then its description. */
export function fieldLine(field: FieldRow): string {
  const parts: string[] = [field.type];
  if (field.default !== undefined) parts.push(`= ${field.default === 'function' ? 'function' : brief(field.default)}`);
  if (field.minimum !== undefined || field.maximum !== undefined) {
    parts.push(`${field.minimum ?? '-inf'}..${field.maximum ?? 'inf'}`);
  }
  if (field.unit) parts.push(field.unit);
  if (field.enum) parts.push(`one of ${field.enum.map((value) => brief(value, 20)).join('|')}`);
  if (field.required) parts.push('required');
  if (field.view) parts.push('view');
  if (field.when && field.when !== 'now') parts.push(`when ${field.when}`);
  const line = `  ${field.key}: ${parts.join(', ')}${field.description ? `: ${field.description}` : ''}`;
  return line.length > 140 ? `${line.slice(0, 137)}...` : line;
}

/** What one listing prints, besides the verdict, and the data `describe.json` holds. */
export interface Listing {
  summary: string;
  lines: string[];
  data: unknown;
}

/** What one listing prints, from the shared registry; throws the registry's error for an unknown kind or id. */
export function listing(kind: string | undefined, id: string | undefined): Listing {
  if (kind === undefined) {
    const data = registry.describe();
    const entries = data.kinds.reduce((sum, row) => sum + row.count, 0);
    const lines = data.kinds.map((row) => {
      const line = `${row.kind} (${row.count}): ${row.description}`;
      return line.length > 140 ? `${line.slice(0, 137)}...` : line;
    });
    return { summary: `${data.kinds.length} kinds, ${entries} entries`, lines, data };
  }
  if (id === undefined) {
    const data: KindDescription = registry.describe(kind);
    const ids = data.ids.length ? `ids: ${data.ids.join(', ')}` : 'ids: none yet';
    const lines = [
      data.description,
      ...(data.fallback ? [`fallback: ${data.fallback}`] : []),
      ...data.fields.map(fieldLine),
      ids.length > 400 ? `${ids.slice(0, 397)}...` : ids,
    ];
    return { summary: `${kind}: ${data.fields.length} fields, ${data.ids.length} entries`, lines, data };
  }
  const data: EntryDescription = registry.describe(kind, id);
  const changed = data.fields.filter((field) => field.differs).length;
  const lines = data.fields.map((field) => `${field.differs ? '*' : ' '} ${field.key} = ${brief(field.value, 100)}`);
  return {
    summary: `${kind} ${JSON.stringify(id)}: ${changed} of ${data.fields.length} fields differ from the default`,
    lines,
    data,
  };
}

/** What the child process reports when it is done: what loaded, and the listing or the usage problem. */
export interface WorkerDone {
  loaded: string[];
  warnings: Finding[];
  kinds: number;
  listing?: Listing;
  /** An unknown kind or id, as a usage error's message. */
  usage?: string;
  /** Anything else the listing threw. */
  crash?: string;
}

/** One message from the child process: the module it starts loading, or the end. */
export type WorkerMessage = { loading: string } | { done: WorkerDone };

/** How long the child process may take before it is stopped and the module it was loading named (ms). */
export const WORKER_TIMEOUT_MS = 60_000;

/** The argument that makes this module, run as a script with an IPC channel, the child process. */
const WORKER_FLAG = '--describe-worker';

/** The child process: loads the registrations of `root`, sends the listing over IPC, and exits. */
async function workerMain([root, kind, id]: string[]): Promise<void> {
  const send = (message: WorkerMessage) => new Promise<void>((sent) => process.send?.(message, () => sent()));
  const { loaded, warnings } = await loadRegistrations(root, (file) => send({ loading: file }));
  const done: WorkerDone = { loaded, warnings, kinds: registry.kinds().length };
  try {
    done.listing = listing(kind, id);
  } catch (error) {
    if (error instanceof EngineError && (error.code === 'CORE_UNKNOWN_KIND' || error.code === 'CORE_NO_ENTRY')) {
      done.usage = error.message.replace(/^\[\w+\] /, '');
    } else done.crash = error instanceof Error ? (error.stack ?? error.message) : String(error);
  }
  await send({ done });
  process.exit(0);
}

/**
 * Runs the listing in a child Node process over `root`'s registrations; resolves to what it sent, or to the failure
 * when it hung (stopped after `timeoutMs`) or ended without a listing, naming the module it was loading.
 */
export function describeInWorker(
  root: string,
  positionals: readonly string[],
  timeoutMs = WORKER_TIMEOUT_MS,
): Promise<{ done: WorkerDone } | { failure: Finding }> {
  const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
  const child = fork(fileURLToPath(import.meta.url), [WORKER_FLAG, root, ...positionals], {
    execArgv: ['--import', tsx],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let loading: string | undefined;
  let done: WorkerDone | undefined;
  let output = '';
  let hung = false;
  const keep = (chunk: Buffer) => (output = `${output}${chunk}`.slice(-2000));
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);
  child.on('message', (message: WorkerMessage) => {
    if ('loading' in message) loading = message.loading;
    else done = message.done;
  });
  const timer = setTimeout(() => {
    hung = true;
    child.kill('SIGKILL');
  }, timeoutMs);
  return new Promise((resolve) => {
    const finish = (code: number | null, error?: Error) => {
      clearTimeout(timer);
      if (done) return resolve({ done });
      const file = loading;
      const where = file ? ` while loading ${file}` : '';
      const last = (error?.message ?? output).trim().split('\n').filter(Boolean).slice(-1)[0] ?? 'no output';
      const failure: Finding = hung
        ? {
            id: 'DESCRIBE_HUNG',
            message: `${file ? `${file} did not finish loading` : 'the listing did not finish'} within ${timeoutMs / 1000} s (a top-level await that never settles, or a loop): keep page-only work out of the top level of a module that registers content`,
          }
        : {
            id: 'DESCRIBE_WORKER',
            message: `the listing process ended (code ${code})${where} without a listing: ${last}`,
          };
      resolve({ failure: file ? { ...failure, file } : failure });
    };
    child.on('error', (error) => finish(null, error));
    child.on('close', (code) => finish(code));
  });
}

/** Builds the command; tests shorten the child process's time limit. */
export function createDescribeCommand(options: { timeoutMs?: number } = {}): Command {
  return {
    usage: 'describe [kind [id]]',
    options: {},
    maxPositionals: 2,
    async run({ root, positionals }): Promise<CommandResult> {
      const [kind, id] = positionals;
      const target = [kind, id].filter(Boolean).join(' ') || undefined;
      const outcome = await describeInWorker(root, positionals, options.timeoutMs);
      if ('failure' in outcome) {
        return {
          ok: false,
          summary: 'no listing: the child process did not finish',
          target,
          failures: [outcome.failure],
        };
      }
      const { loaded, warnings, kinds, listing: result, usage, crash } = outcome.done;
      if (usage) throw new UsageError(usage);
      if (!result) throw new Error(crash ?? 'the listing process sent no listing');
      const dir = join('out', 'describe', targetSlug(target));
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, 'describe.json'), `${JSON.stringify(result.data, null, 2)}\n`);
      return {
        ok: true,
        summary: result.summary,
        lines: result.lines,
        target,
        warnings,
        metrics: { modules: loaded.length, kinds },
        artifacts: [
          {
            path: `${dir}/describe.json`,
            kind: 'json',
            describes: 'the whole description, as registry.describe returns it',
          },
        ],
      };
    },
  };
}

export default createDescribeCommand();

// Run as the child process (forked with WORKER_FLAG and an IPC channel), list, send and exit; imported, run nothing.
const isWorker = process.send !== undefined && process.argv[2] === WORKER_FLAG;
if (isWorker && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url))
  await workerMain(process.argv.slice(3));
