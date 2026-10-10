/**
 * @file Unit tests for the `node x` dispatcher (PLAN.md §8.1): exit codes 0, 1 and 2, the closest-name hints, the
 * 20-line output cap, a report for every run, and the generated help listing every command in `tools/cmd/`.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  closest,
  commandHelp,
  commandNames,
  dispatch,
  firstSentence,
  loadCommand,
  MAX_LINES,
  ROOT,
  UsageError,
} from './x';
import type { Command } from './x';

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A temporary repository root (a package.json is all the reports need). */
function sandbox(): string {
  const root = mkdtempSync(join(tmpdir(), 'x-dispatch-'));
  temporary.push(root);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.0.0' }));
  return root;
}

/** A command whose `run` is given. */
const command = (run: Command['run'], options: Command['options'] = {}): Command => ({
  usage: 'demo [target]',
  options,
  maxPositionals: 1,
  run,
});

const commands: Record<string, () => Promise<Command>> = {
  pass: async () => command(async () => ({ ok: true, summary: 'all good', lines: ['one line'] })),
  fail: async () =>
    command(async () => ({
      ok: false,
      summary: 'one failure',
      failures: [{ id: 'T1', message: 'it broke', file: 'a.ts', line: 3 }],
    })),
  crash: async () => command(async () => Promise.reject(new Error('unexpected'))),
  usage: async () => command(async () => Promise.reject(new UsageError('the target must be a page'))),
  flags: async () =>
    command(async ({ values }) => ({ ok: true, summary: `check=${String(values.check)}` }), {
      check: { type: 'boolean' },
    }),
  chatty: async () =>
    command(async () => ({
      ok: true,
      summary: 'many lines',
      lines: Array.from({ length: 50 }, (_, i) => `line ${i}`),
    })),
};

/** Runs the dispatcher on in-memory commands; returns the exit code, the printed lines and the report. */
async function run(argv: string[]) {
  const root = sandbox();
  const printed: string[] = [];
  const code = await dispatch(argv, { root, commands, print: (line) => printed.push(line) });
  const latest = JSON.parse(readFileSync(join(root, 'out', 'latest.json'), 'utf8')) as Record<string, unknown>;
  return { code, printed, latest, root };
}

describe('the dispatcher', () => {
  it('exits 0 when the command passes, printing the verdict first and the report path last', async () => {
    const { code, printed, latest, root } = await run(['pass', 'labs/box']);
    expect(code).toBe(0);
    expect(printed).toEqual(['x pass: ok: all good', 'one line', 'report: out/pass/labs-box/report.json']);
    expect(latest).toMatchObject({ report: 'out/pass/labs-box/report.json', tool: 'x pass', ok: true });
    expect(existsSync(join(root, 'out/pass/labs-box/report.json'))).toBe(true);
  });

  it('exits 1 when the command fails, printing each failure with its place', async () => {
    const { code, printed, latest } = await run(['fail']);
    expect(code).toBe(1);
    expect(printed).toEqual(['x fail: FAIL: one failure', 'T1: it broke (a.ts:3)', 'report: out/fail/all/report.json']);
    expect(latest).toMatchObject({ ok: false, failures: [{ id: 'T1', message: 'it broke', file: 'a.ts', line: 3 }] });
  });

  it('exits 1 when the command crashes, naming the file and line it threw from', async () => {
    const { code, latest } = await run(['crash']);
    expect(code).toBe(1);
    const [failure] = latest.failures as { id: string; message: string; file?: string; line?: number }[];
    expect(failure).toMatchObject({ id: 'X_CRASH', message: 'x crash crashed: unexpected', file: 'tools/x.test.ts' });
    expect(failure.line).toBeGreaterThan(0);
  });

  it('exits 2 on a usage error, with a report', async () => {
    const { code, printed, latest } = await run(['usage']);
    expect(code).toBe(2);
    expect(printed[1]).toBe('X_USAGE: the target must be a page (usage: node x demo [target])');
    expect(latest).toMatchObject({ report: 'out/usage/usage/report.json', ok: false });
  });

  it('exits 2 on an unknown flag, naming the closest valid one', async () => {
    const { code, printed } = await run(['flags', '--chekc']);
    expect(code).toBe(2);
    expect(printed[1]).toBe('X_UNKNOWN_FLAG: x flags has no flag --chekc: did you mean --check? (node x help flags)');
    expect((await run(['flags', '--check'])).printed[0]).toBe('x flags: ok: check=true');
  });

  it('exits 2 on an unknown command, naming the closest one', async () => {
    const { code, printed, latest } = await run(['pas']);
    expect(code).toBe(2);
    expect(printed[1]).toBe('X_UNKNOWN_COMMAND: there is no command "pas": did you mean pass?');
    expect(latest).toMatchObject({ report: 'out/x/usage/report.json', tool: 'x' });
    expect((await run([])).code).toBe(2);
  });

  it('exits 2 on too many arguments', async () => {
    const { code, printed } = await run(['pass', 'a', 'b']);
    expect(code).toBe(2);
    expect(printed[1]).toBe('X_USAGE: unexpected argument "b" (usage: node x demo [target])');
  });

  it(`prints at most ${MAX_LINES} lines and says where the rest is`, async () => {
    const { printed } = await run(['chatty']);
    expect(printed).toHaveLength(MAX_LINES);
    expect(printed[MAX_LINES - 2]).toBe('… 33 more in out/chatty/all/report.json');
  });

  it('names the closest candidate only when it is close', () => {
    expect(closest('hlep', ['help', 'src'])).toBe('help');
    expect(closest('zzzzzz', ['help', 'src'])).toBeUndefined();
  });
});

describe('the commands in tools/cmd/', () => {
  it('each has a file comment, a usage line and strict flags', async () => {
    const names = commandNames();
    expect(names).toEqual(expect.arrayContaining(['help', 'src']));
    for (const name of names) {
      expect(firstSentence(commandHelp(ROOT, name)), `tools/cmd/${name}.ts needs a @file comment`).toMatch(/\.$/);
      const module = await loadCommand(ROOT, name);
      expect(typeof module.run).toBe('function');
      expect(module.usage.split(' ')[0]).toBe(name);
    }
  });

  it('node x help exits 0 and lists every command', () => {
    const output = execFileSync(process.execPath, ['x', 'help'], { cwd: ROOT, encoding: 'utf8' });
    const lines = output.trimEnd().split('\n');
    expect(lines[0]).toMatch(/^x help: ok: /);
    for (const name of commandNames()) expect(lines.some((line) => line.trim().startsWith(`${name} `))).toBe(true);
    expect(lines.length).toBeLessThanOrEqual(MAX_LINES);
  });

  it('node x exits 2 for an unknown command and an unknown flag', () => {
    const unknown = spawnSync(process.execPath, ['x', 'nosuch'], { cwd: ROOT, encoding: 'utf8' });
    expect(unknown.status).toBe(2);
    const flag = spawnSync(process.execPath, ['x', 'help', '--verbose'], { cwd: ROOT, encoding: 'utf8' });
    expect(flag.status).toBe(2);
    expect(flag.stdout).toContain('X_UNKNOWN_FLAG: x help has no flag --verbose');
  });

  it("node x <cmd> --help prints that command's help", () => {
    const output = execFileSync(process.execPath, ['x', 'src', '--help'], { cwd: ROOT, encoding: 'utf8' });
    expect(output.split('\n')[0]).toBe('x help: ok: node x src');
    expect(output).toContain(firstSentence(commandHelp(ROOT, 'src')).split(' ').slice(0, 4).join(' '));
  });
});
