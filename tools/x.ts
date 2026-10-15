/**
 * @file The `node x <cmd>` dispatcher (PLAN.md §8.1): finds `tools/cmd/<cmd>.ts`, parses its arguments with
 * `node:util`'s `parseArgs` in strict mode, runs it, prints at most about 20 lines (the verdict first), writes
 * `out/<cmd>/<target>/report.json` plus `out/latest.json`, and returns the exit code. When it cuts the output, every
 * line is in `output.txt` beside the report: the line that says how many were cut names it, and so does the report.
 *
 * In a game made from the engine (tools/game/new-game.mjs: its root holds engine-lock.json, `isGame`), the engine
 * repository's own commands (`ENGINE_ONLY_COMMANDS`: its gate, pins, generated docs, escalation records, port
 * references and source checkouts) are not commands: `x help` leaves them out, `x check` runs none of their plugins,
 * and naming one says what a game runs instead (ADR-0024).
 *
 * Invariants: exit 0 when the command passes, 1 when it fails (a crash included, the import of its module too), 2 on
 * a usage error (unknown command, unknown flag, bad argument), each naming the closest valid choice. Every run writes
 * a report, a usage error and a crash included. A command's help is its file comment, so `x help` cannot go stale.
 *
 * @example
 * // node x help         → exit 0, lists every command
 * // node x help --nope  → exit 2: unknown flag
 * @see tools/x.test.ts
 */
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { makeReport, outputPath, writeReport, type Artifact, type Finding, type Report } from './lib/report';

/** The flags a command accepts, in `parseArgs`'s format. */
export type CommandOptions = Record<string, { type: 'string' | 'boolean'; short?: string; multiple?: boolean }>;

/** What a command receives: its parsed flags and positionals, and the repository root. */
export interface CommandContext {
  /** Flag values by long name, as `parseArgs` returns them. */
  values: Record<string, string | boolean | (string | boolean)[] | undefined>;
  /** Positional arguments, in order. */
  positionals: string[];
  /** The repository root (absolute). */
  root: string;
}

/** What a command returns; the dispatcher turns it into printed lines, a report and an exit code. */
export interface CommandResult {
  /** The verdict. */
  ok: boolean;
  /** The verdict line's text, printed first after `x <cmd>: ok|FAIL`. */
  summary: string;
  /** Further lines to print (findings are printed for you); the dispatcher keeps the output to about 20 lines. */
  lines?: string[];
  /** The report's directory under `out/<cmd>/`: a page, scene or file; `all` when omitted. */
  target?: string;
  /** The browser it ran, for the report's runtime (`chromium141`). */
  browser?: string;
  failures?: Finding[];
  warnings?: Finding[];
  metrics?: Report['metrics'];
  artifacts?: Artifact[];
}

/** The shape of a `tools/cmd/<name>.ts` module's default export. */
export interface Command {
  /** The synopsis printed by `x help <cmd>`, after `node x`: `src`, `help [cmd]`. */
  usage: string;
  /** The flags it accepts; anything else is a usage error. */
  options: CommandOptions;
  /** How many positional arguments it accepts. */
  maxPositionals: number;
  /** Runs the command. Throw `UsageError` for bad arguments (exit 2); anything else thrown is a crash (exit 1). */
  run(context: CommandContext): Promise<CommandResult>;
}

/** Thrown by a command for a bad argument: the dispatcher prints the message and exits 2. */
export class UsageError extends Error {
  override name = 'UsageError';
}

/**
 * A whole number from a flag, at least `min`, or `fallback` when the flag is absent. Here, beside `UsageError`, so a
 * module that parses one imports no command (tools/cmd/sim.ts pulls in the sim and the view).
 */
export function wholeFlag(value: unknown, name: string, fallback: number, min = 0): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min)
    throw new UsageError(`--${name} takes a whole number, ${min} or more, not ${String(value)}`);
  return n;
}

/** The repository root: the directory holding `x.js`. */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The most lines a command prints, the report path included (PLAN.md §8.1: "at most about 20"). */
export const MAX_LINES = 20;

/**
 * How long a test waits on a whole command it runs as a child process (`node x <cmd>`, Vitest, `npx`), in ms: the
 * test's timeout and the child's, killed then, so only a hang trips it. Such a run starts Node, compiles TypeScript
 * and does all its work, which a loaded machine stretches far more than Vitest's 30 s default allows for in-process
 * work (vite.config.ts): `node x check` took 4.3 s idle and over 30 s with six lanes testing at once (gate G3).
 */
export const CHILD_TIMEOUT_MS = 120_000;

/** The engine repository's own commands, which a game made from it does not have (see the file comment). */
export const ENGINE_ONLY_COMMANDS: readonly string[] = ['ci', 'deps', 'docs', 'esc', 'port', 'src'];

/** What naming one of the engine's own commands in a game says: what a game runs instead. */
export function engineOnly(name: string): string {
  return `x ${name} belongs to the engine's own repository, not a game: here npm run check and npm test are the gate, node x engine says which engine the game is on (AGENTS.md)`;
}

/** Whether `root` is a game made from the engine (it holds engine-lock.json), not the engine's own repository. */
export function isGame(root: string = ROOT): boolean {
  return existsSync(join(root, 'engine-lock.json'));
}

/** The command names in `tools/cmd/` (every `<name>.ts` that is not a test); in a game, without the engine's own. */
export function commandNames(root: string = ROOT): string[] {
  const game = isGame(root);
  return readdirSync(join(root, 'tools', 'cmd'))
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .map((file) => file.slice(0, -3))
    .filter((name) => !game || !ENGINE_ONLY_COMMANDS.includes(name))
    .sort();
}

/** Returns the text of a module's `@file` comment, without the comment markers and the `@file` tag. */
export function fileComment(source: string): string {
  const block = /\/\*\*([\s\S]*?)\*\//.exec(source)?.[1] ?? '';
  if (!block.includes('@file')) return '';
  return block
    .split('\n')
    .map((line) => line.replace(/^\s*\* ?/, ''))
    .join('\n')
    .replace(/@file\s*/, '')
    .trim();
}

/** The first sentence of a command's file comment: its one-line description in `x help`. */
export function firstSentence(comment: string): string {
  const flat = comment.split(/\n\s*\n/)[0].replace(/\s+/g, ' ');
  const end = flat.search(/\.(\s|$)/);
  return end < 0 ? flat : flat.slice(0, end + 1);
}

/** Levenshtein distance, for naming the closest valid flag or command. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

/** The candidate closest to `wanted`, or undefined when nothing is close (more than half the letters differ). */
export function closest(wanted: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const d = distance(wanted, candidate);
    if (d < bestDistance) [best, bestDistance] = [candidate, d];
  }
  return bestDistance <= Math.max(2, Math.ceil(wanted.length / 2)) ? best : undefined;
}

/** Loads a command module from `tools/cmd/<name>.ts`. */
export async function loadCommand(root: string, name: string): Promise<Command> {
  const module = (await import(pathToFileURL(join(root, 'tools', 'cmd', `${name}.ts`)).href)) as { default: Command };
  return module.default;
}

/** Where `dispatch` finds commands and sends output; tests replace the parts they need. */
export interface DispatchOptions {
  /** The repository root: where `tools/cmd/` and `out/` are. */
  root?: string;
  /** The available commands; by default every module in `tools/cmd/`. */
  commands?: Record<string, () => Promise<Command>>;
  /** Receives each printed line; by default `console.log`. */
  print?: (line: string) => void;
}

/** Names the usage problem in a `parseArgs` error, with the closest valid flag when one is close. */
function parseError(error: unknown, command: Command, name: string): Finding {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string }).code;
  if (code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
    const flag = /'(-{1,2}[^'\s]+)'/.exec(message)?.[1] ?? '?';
    const flags = Object.keys(command.options).map((option) => `--${option}`);
    const near = closest(flag.replace(/=.*$/, ''), flags);
    const hint = near
      ? `did you mean ${near}?`
      : flags.length
        ? `valid flags: ${flags.join(', ')}`
        : 'it takes no flags';
    return { id: 'X_UNKNOWN_FLAG', message: `x ${name} has no flag ${flag}: ${hint} (node x help ${name})` };
  }
  return { id: 'X_USAGE', message: `${message.split('\n')[0]} (usage: node x ${command.usage})` };
}

/** Where an unexpected error was thrown, as a file and line relative to this repository, when the stack names one. */
function crashSite(error: unknown): { file?: string; line?: number } {
  const stack = error instanceof Error ? (error.stack ?? '') : '';
  for (const match of stack.matchAll(/(?:file:\/\/)?(\/[^\s():]+\.ts):(\d+):\d+/g)) {
    const file = relative(ROOT, match[1]);
    if (!file.startsWith('..') && !file.includes('node_modules')) return { file, line: Number(match[2]) };
  }
  return {};
}

/**
 * Runs `node x <argv…>`: dispatches to the command, prints its verdict and findings (about 20 lines at most),
 * writes its report, and resolves to the exit code (0 pass, 1 fail, 2 usage error).
 */
export async function dispatch(argv: readonly string[], options: DispatchOptions = {}): Promise<number> {
  const root = options.root ?? ROOT;
  const print = options.print ?? ((line: string) => console.log(line));
  const commands =
    options.commands ??
    Object.fromEntries(commandNames(root).map((name) => [name, () => loadCommand(root, name)] as const));
  const started = performance.now();
  const [name = '', ...rest] = argv;

  const finish = (cmd: string, tool: string, args: Record<string, unknown>, result: CommandResult, code: number) => {
    const findings = [...(result.failures ?? []), ...(result.warnings ?? [])].map((f) => {
      const where = f.file ? ` (${f.file}${f.line ? `:${f.line}` : ''})` : '';
      return `${f.id}: ${f.message}${where}`;
    });
    const verdict = `${tool}: ${result.ok ? 'ok' : 'FAIL'}: ${result.summary}`;
    const body = [...(result.lines ?? []), ...findings];
    const room = MAX_LINES - 2;
    const cut = body.length > room ? body.length - room + 1 : 0;
    const output = outputPath(cmd, result.target ?? '');
    const kept: Artifact = { path: output, kind: 'text', describes: `every line of the output, ${cut} cut from it` };
    const artifacts = cut ? [...(result.artifacts ?? []), kept] : result.artifacts;
    const report = makeReport({ ...result, artifacts, tool, args, ms: performance.now() - started, root });
    const path = writeReport(root, cmd, result.target ?? '', report);
    // The whole output beside the report when it is cut; none left from an earlier run when it is not.
    if (cut) writeFileSync(join(root, output), `${[verdict, ...body].join('\n')}\n`);
    else rmSync(join(root, output), { force: true });
    print(verdict);
    for (const line of cut ? [...body.slice(0, room - 1), `… ${cut} more in ${output}`] : body) print(line);
    print(`report: ${path}`);
    return code;
  };
  /** A crash, of the command or of its module's import: exit 1 with X_CRASH, naming where it threw. */
  const crash = (error: unknown, args: Record<string, unknown>, target?: string, context = '') => {
    const message = error instanceof Error ? error.message : String(error);
    const failure: Finding = { id: 'X_CRASH', message: `x ${name} crashed: ${context}${message}`, ...crashSite(error) };
    return finish(
      name,
      `x ${name}`,
      args,
      { ok: false, summary: 'the command crashed', failures: [failure], target },
      1,
    );
  };
  const usage = (cmd: string, tool: string, finding: Finding, lines: string[] = []) =>
    finish(
      cmd,
      tool,
      { argv: [...argv] },
      { ok: false, summary: 'usage error', failures: [finding], lines, target: 'usage' },
      2,
    );

  if (!name || name.startsWith('-')) {
    const finding = { id: 'X_USAGE', message: 'name a command: node x <cmd> [args] (node x help lists them)' };
    return usage('x', 'x', finding, [`commands: ${Object.keys(commands).join(', ')}`]);
  }
  const load = commands[name];
  if (!load && isGame(root) && ENGINE_ONLY_COMMANDS.includes(name)) {
    return usage('x', 'x', { id: 'X_ENGINE_ONLY', message: engineOnly(name) });
  }
  if (!load) {
    const near = closest(name, Object.keys(commands));
    const hint = near ? `did you mean ${near}?` : `commands: ${Object.keys(commands).join(', ')}`;
    return usage('x', 'x', { id: 'X_UNKNOWN_COMMAND', message: `there is no command "${name}": ${hint}` });
  }
  const tool = `x ${name}`;
  let command: Command;
  try {
    command = await load();
  } catch (error) {
    return crash(error, { argv: [...argv] }, undefined, `tools/cmd/${name}.ts did not load: `);
  }
  if (typeof command?.run !== 'function') {
    const error = new Error(`tools/cmd/${name}.ts has no default export Command (with run, options, usage)`);
    return crash(error, { argv: [...argv] }, undefined);
  }
  const dashDash = rest.indexOf('--');
  const flagsPart = dashDash < 0 ? rest : rest.slice(0, dashDash);
  if (flagsPart.includes('--help') || flagsPart.includes('-h')) {
    return dispatch(['help', name], options);
  }

  let parsed: { values: CommandContext['values']; positionals: string[] };
  try {
    parsed = parseArgs({ args: [...rest], options: command.options, strict: true, allowPositionals: true });
  } catch (error) {
    return usage(name, tool, parseError(error, command, name));
  }
  const args = { ...parsed.values, positionals: parsed.positionals };
  if (parsed.positionals.length > command.maxPositionals) {
    const extra = parsed.positionals.slice(command.maxPositionals).join(' ');
    return usage(name, tool, {
      id: 'X_USAGE',
      message: `unexpected argument "${extra}" (usage: node x ${command.usage})`,
    });
  }

  let result: CommandResult;
  try {
    result = await command.run({ values: parsed.values, positionals: parsed.positionals, root });
  } catch (error) {
    if (error instanceof UsageError) {
      return usage(name, tool, { id: 'X_USAGE', message: `${error.message} (usage: node x ${command.usage})` });
    }
    return crash(error, args, parsed.positionals[0]);
  }
  return finish(name, tool, args, { target: parsed.positionals[0], ...result }, result.ok ? 0 : 1);
}

/** Reads one command's help text: its file comment. */
export function commandHelp(root: string, name: string): string {
  return fileComment(readFileSync(join(root, 'tools', 'cmd', `${name}.ts`), 'utf8'));
}
