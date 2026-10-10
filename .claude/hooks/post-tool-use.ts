/**
 * @file The PostToolUse hook on Edit, Write and MultiEdit (PLAN.md §8.10, WP 0.10): formats the edited file with
 * Prettier, then lints it with ESLint under eslint.config.js, so a banned API (PLAN.md Appendix B) or any other broken
 * rule shows at once, its message naming the fix.
 *
 * - **Errors** (ESLint errors, or a file Prettier cannot parse) → exit 2 with them on stderr, which Claude Code shows
 *   the agent. **Warnings** (a file over 400 lines) → exit 0 with them as `additionalContext`. Clean → silent.
 * - **Skipped:** files outside the project or deleted, and `out/`, `node_modules/`, `.cache/`, `dist/`. Prettier
 *   skips what `.prettierignore` and `.gitignore` name and the formats it does not know (hand-written Markdown stays
 *   as written); ESLint reads only code files.
 * - **The same settings as `npm run check`:** both tools run from the project's `node_modules/.bin` with its config
 *   files, ESLint with its cache in `node_modules/.cache/eslint/`, which the hook therefore warms for the next check.
 *   Without `node_modules` it says so and passes.
 *
 * Usage: node .claude/hooks/post-tool-use.ts < input.json. Exit 0, or 2 on errors.
 * @see tests/unit/hooks/post-tool-use.test.ts
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The part of Claude Code's PostToolUse input the hook reads. */
export interface PostToolUseInput {
  tool_name?: string;
  tool_input?: { file_path?: string };
  cwd?: string;
}

/** One message of ESLint's JSON format. */
export interface LintMessage {
  line?: number;
  column?: number;
  /** 1 warning, 2 error. */
  severity: number;
  ruleId?: string | null;
  message: string;
}

/** One file of ESLint's JSON format. */
export interface LintResult {
  filePath: string;
  messages: LintMessage[];
}

/** What the hook hands back to Claude Code. */
export interface HookOutcome {
  code: 0 | 2;
  stdout?: string;
  stderr?: string;
}

/** Top-level directories no edit is formatted or linted in. */
const SKIPPED = new Set(['out', 'node_modules', '.cache', 'dist', 'test-results', '.git']);
/** The files ESLint lints. */
const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
/** The most lines of findings the hook prints. */
const MAX_LINES = 20;

/** The edited file as a path relative to the project, or undefined when the hook leaves it alone. */
export function editedFile(input: PostToolUseInput, projectDir: string): string | undefined {
  const named = input.tool_input?.file_path;
  if (!named) return undefined;
  const path = resolve(input.cwd ?? projectDir, named);
  if (!existsSync(path) || !statSync(path).isFile()) return undefined;
  const inside = relative(realpathSync(projectDir), realpathSync(path));
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) return undefined;
  const parts = inside.split(sep);
  if (SKIPPED.has(parts[0]) || parts.includes('node_modules')) return undefined;
  return parts.join('/');
}

/** ESLint's messages as `file:line:col  rule  message` lines, errors and warnings apart, each line once. */
export function lintLines(results: readonly LintResult[], file: string): { errors: string[]; warnings: string[] } {
  const errors = new Set<string>();
  const warnings = new Set<string>();
  for (const result of results) {
    for (const m of result.messages) {
      const line = `${file}:${m.line ?? 0}:${m.column ?? 0}  ${m.ruleId ?? 'parse'}  ${m.message}`;
      (m.severity >= 2 ? errors : warnings).add(line);
    }
  }
  return { errors: [...errors], warnings: [...warnings] };
}

/** At most `MAX_LINES` lines, the last saying how many more there were. */
function capped(lines: string[]): string[] {
  return lines.length <= MAX_LINES
    ? lines
    : [...lines.slice(0, MAX_LINES - 1), `… and ${lines.length - MAX_LINES + 1} more`];
}

/** Formats and lints the file an edit named. */
export function runPostEdit(input: PostToolUseInput, projectDir: string): HookOutcome {
  const file = editedFile(input, projectDir);
  if (!file) return { code: 0 };
  const bin = (name: string) => join(projectDir, 'node_modules', '.bin', name);
  if (!existsSync(bin('prettier')) || !existsSync(bin('eslint'))) {
    return {
      code: 0,
      stdout: 'post-edit: node_modules is missing, so nothing was formatted or linted: bash scripts/setup.sh',
    };
  }
  const run = (name: string, args: string[]) =>
    spawnSync(bin(name), args, { cwd: projectDir, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 50_000 });

  const prettier = run('prettier', ['--write', '--ignore-unknown', '--log-level', 'warn', file]);
  if (prettier.status !== 0) {
    const text = `${prettier.stderr ?? ''}${prettier.stdout ?? ''}`.trim() || String(prettier.error ?? 'no output');
    const lines = [`${file}: Prettier cannot format it (exit ${prettier.status}): fix the syntax`, ...text.split('\n')];
    return { code: 2, stderr: capped(lines).join('\n') };
  }
  if (!CODE.test(file)) return { code: 0 };

  const eslint = run('eslint', [
    '--cache',
    '--cache-location',
    'node_modules/.cache/eslint/',
    '--no-warn-ignored',
    '--format',
    'json',
    file,
  ]);
  if (eslint.status !== 0 && eslint.status !== 1) {
    const text = `${eslint.stderr ?? ''}`.trim() || String(eslint.error ?? 'no output');
    return {
      code: 2,
      stderr: capped([`${file}: ESLint failed (exit ${eslint.status})`, ...text.split('\n')]).join('\n'),
    };
  }
  const { errors, warnings } = lintLines(JSON.parse(eslint.stdout || '[]') as LintResult[], file);
  if (errors.length) {
    const head = `${file}: ${errors.length} ESLint error${errors.length === 1 ? '' : 's'}; fix now (each message names the fix):`;
    return { code: 2, stderr: capped([head, ...errors, ...warnings]).join('\n') };
  }
  if (warnings.length) {
    const context = capped([`${file}: ESLint warnings:`, ...warnings]).join('\n');
    return {
      code: 0,
      stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context } }),
    };
  }
  return { code: 0 };
}

/** Reads the input from stdin, runs the tools and exits with the outcome. */
function main(): void {
  const text = readFileSync(0, 'utf8');
  const input = (text.trim() ? JSON.parse(text) : {}) as PostToolUseInput;
  const outcome = runPostEdit(input, process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
  if (outcome.stdout) process.stdout.write(outcome.stdout + '\n');
  if (outcome.stderr) process.stderr.write(outcome.stderr + '\n');
  process.exitCode = outcome.code;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main();
