/**
 * @file The Stop hook (PLAN.md §8.10, WP 0.10): before the agent ends a turn, runs `npm run check` (T0) and looks for
 * open escalations past their deadline with no recorded call (§8.14).
 *
 * - **Red check** → exit 2 with its last lines on stderr: the agent goes on and fixes them.
 * - **Red again while `stop_hook_active`** (the agent is already going on because of this hook) → exit 0 with a
 *   warning for the owner (`systemMessage`): one retry per stop, never a loop.
 * - **Overdue escalations** (tools/lib/escalations.ts's `isOverdue`) → named in that warning, or in the reason when
 *   the check is red. Outside a lane the check itself fails on them; in a lane (`X_LANE`) it only warns, and this
 *   warning is how the owner hears of them.
 * - Green, nothing overdue → exit 0, silent.
 *
 * The check runs with Node 24 (`.nvmrc`) first on PATH when the hook's own Node is another and scripts/setup.sh
 * has cached it, as later shells get it from the SessionStart hook. The records are read through tsx.
 *
 * Usage: node .claude/hooks/stop.ts < input.json. Exit 0, or 2 when the check is red.
 * @see tests/unit/hooks/stop.test.ts
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The part of Claude Code's Stop input the hook reads. */
export interface StopInput {
  /** True when the agent is already continuing because a Stop hook blocked. */
  stop_hook_active?: boolean;
  cwd?: string;
}

/** What the hook hands back to Claude Code. */
export interface StopOutcome {
  code: 0 | 2;
  stdout?: string;
  stderr?: string;
}

/** What the hook reads from outside; tests pass a fixed clock and environment. */
export interface StopOptions {
  projectDir: string;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}

/** How many lines of a red check the reason quotes. */
const TAIL = 15;

/** The environment for the check: Node 24 first on PATH when it is cached and the running Node is another. */
export function checkEnv(projectDir: string, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const want = existsSync(join(projectDir, '.nvmrc'))
    ? readFileSync(join(projectDir, '.nvmrc'), 'utf8').trim().replace(/^v/, '')
    : '';
  const bin = join(env.HOME || homedir(), '.cache', 'my3dge', `node-v${want}-linux-x64`, 'bin');
  if (!want || process.version === `v${want}` || !existsSync(join(bin, 'node'))) return env;
  return { ...env, PATH: `${bin}${delimiter}${env.PATH ?? ''}` };
}

/** The open records past their deadline with no call, one line each. Empty when they cannot be read. */
export async function overdueEscalations(projectDir: string, now: Date): Promise<string[]> {
  try {
    const { tsImport } = await import('tsx/esm/api');
    const esc = (await tsImport(
      '../../tools/lib/escalations.ts',
      import.meta.url,
    )) as typeof import('../../tools/lib/escalations');
    return esc
      .wellFormed(esc.readRecords(projectDir))
      .filter((record) => esc.isOverdue(record, now))
      .map((record) => `${record.id} (deadline ${record.deadline}): ${record.title}`);
  } catch {
    return [];
  }
}

/** The last `count` non-empty lines of some output. */
export function tail(output: string, count = TAIL): string[] {
  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-count);
}

/** Runs the check and the escalation scan, and decides whether the agent may stop. */
export async function runStop(input: StopInput, options: StopOptions): Promise<StopOutcome> {
  const { projectDir, now = new Date(), env = process.env } = options;
  const check = spawnSync('npm', ['run', '--silent', 'check'], {
    cwd: projectDir,
    env: checkEnv(projectDir, env),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 150_000,
  });
  const red = check.status !== 0;
  const overdue = await overdueEscalations(projectDir, now);
  const overdueText = overdue.length
    ? [
        `Escalations past their deadline with no recorded call (PLAN.md §8.14): decide each (node x esc decide ESC-NNNN --call "…" --commit <sha>) or record the owner's answer:`,
        ...overdue.map((line) => `  ${line}`),
      ]
    : [];
  if (red) {
    const output = `${check.stdout ?? ''}${check.stderr ?? ''}` || String(check.error ?? 'no output');
    const lines = [
      `npm run check is red (exit ${check.status ?? 'none'}); its last lines:`,
      ...tail(output).map((line) => `  ${line}`),
      ...overdueText,
    ];
    if (!input.stop_hook_active) return { code: 2, stderr: [...lines, 'Fix it before ending the turn.'].join('\n') };
    const warning = ['Stopped with npm run check still red after one retry.', ...lines].join('\n');
    return { code: 0, stdout: JSON.stringify({ systemMessage: warning }) };
  }
  if (overdueText.length) return { code: 0, stdout: JSON.stringify({ systemMessage: overdueText.join('\n') }) };
  return { code: 0 };
}

/** Reads the input from stdin, runs the hook and exits with the outcome. */
async function main(): Promise<void> {
  const text = readFileSync(0, 'utf8');
  const input = (text.trim() ? JSON.parse(text) : {}) as StopInput;
  const outcome = await runStop(input, { projectDir: process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd() });
  if (outcome.stdout) process.stdout.write(outcome.stdout + '\n');
  if (outcome.stderr) process.stderr.write(outcome.stderr + '\n');
  process.exitCode = outcome.code;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) await main();
