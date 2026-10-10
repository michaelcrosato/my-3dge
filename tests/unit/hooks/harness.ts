/**
 * @file Runs the Claude Code hook scripts in `.claude/hooks/` the way Claude Code runs them, for their unit tests
 * (WP 0.10): the input as JSON on stdin, `$CLAUDE_PROJECT_DIR` naming a fixture project in a temporary directory,
 * and the exit code, stdout and stderr handed back.
 *
 * Invariants: a run never reaches the real session. `CLAUDE_ENV_FILE` and Vitest's variables never pass to the hook,
 * unless a test sets its own; nothing reads or writes `~/.claude`. Temporary directories are real paths (macOS-style
 * `/tmp` links resolved), so the hooks' path comparisons see what the tests wrote.
 *
 * @see tests/unit/hooks/session-start.test.ts
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ROOT } from '../../../tools/x';

/** The hook scripts' directory. */
export const HOOKS = join(ROOT, '.claude', 'hooks');

/** What a hook run printed and returned. */
export interface HookRun {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** How to run a hook. */
export interface RunOptions {
  /** The fixture project, passed as `$CLAUDE_PROJECT_DIR`. */
  projectDir: string;
  /** Variables to set for the hook, on top of this process's (a value of undefined removes one). */
  env?: Record<string, string | undefined>;
  /** Start from an empty environment instead of this process's. */
  cleanEnv?: boolean;
  /** Milliseconds before the run is killed. */
  timeout?: number;
}

/** Runs `.claude/hooks/<script>` (`.ts` with this Node, `.sh` with bash), `input` as JSON on stdin. */
export function runHook(script: string, input: unknown, options: RunOptions): HookRun {
  const base: Record<string, string | undefined> = options.cleanEnv ? {} : { ...process.env };
  for (const name of Object.keys(base)) {
    if (name.startsWith('VITEST') || name === 'CLAUDE_ENV_FILE' || name === 'NODE_OPTIONS') delete base[name];
  }
  const env: Record<string, string | undefined> = { ...base, ...options.env, CLAUDE_PROJECT_DIR: options.projectDir };
  for (const [name, value] of Object.entries(env)) if (value === undefined) delete env[name];
  const path = join(HOOKS, script);
  const [command, args] = script.endsWith('.sh') ? ['bash', [path]] : [process.execPath, [path]];
  const result = spawnSync(command, args, {
    cwd: options.projectDir,
    env: env as NodeJS.ProcessEnv,
    input: JSON.stringify(input),
    encoding: 'utf8',
    timeout: options.timeout ?? 60_000,
  });
  return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** A new temporary directory, as a real path. */
export function tempDir(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), `${prefix}-`)));
}

/** Writes each file (path relative to `root` → content), creating directories; `mode` applies to all of them. */
export function writeFiles(root: string, files: Record<string, string>, mode?: number): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content, mode === undefined ? undefined : { mode });
  }
}
