/**
 * @file The PreToolUse hook (PLAN.md §8.10, WP 0.10): guards what agents never change on their own. Claude Code pipes
 * the tool call in as JSON on stdin; the hook prints a permission decision, or nothing to let the call through.
 *
 * - **`DOCTRINE.md`** edited (Edit, Write, MultiEdit, NotebookEdit, or a Bash command that writes it) → `ask`: the
 *   doctrine changes only on the owner's word (ADR-0002). Reading it, `git diff`, `git add` and `git commit` pass.
 * - **A hand edit under `out/` or `node_modules/`** (the edit tools) → `deny`: tools write them (`node x …`, `npm ci`).
 * - **A force-push to `main`** (`-f`, `--force`, `--force-with-lease`, `--mirror` or a `+` refspec; with no refspec,
 *   while on `main`), or deleting `main` → `deny`. Other pushes are pre-approved (ADR-0021).
 *
 * Bash commands are split the way a shell splits them (quotes, `;`, `&&`, `|`, redirections), so a commit message
 * that mentions the doctrine is not an edit. Runs on Node's built-in type stripping with no dependency, so it guards
 * before `npm ci` too.
 *
 * Usage: node .claude/hooks/pre-tool-use.ts < input.json. Exit 0 (a crash is a non-blocking hook error).
 * @see tests/unit/hooks/pre-tool-use.test.ts
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The part of Claude Code's PreToolUse input the hook reads. */
export interface PreToolUseInput {
  tool_name?: string;
  tool_input?: { file_path?: string; notebook_path?: string; command?: string };
  /** The session's working directory; relative paths resolve from it. */
  cwd?: string;
}

/** A permission decision, as Claude Code reads it from `hookSpecificOutput`. */
export interface Decision {
  permissionDecision: 'ask' | 'deny';
  permissionDecisionReason: string;
}

/** Where the project is, and how to read the current branch (tests pass a fixed one). */
export interface GuardOptions {
  projectDir: string;
  currentBranch?: () => string | undefined;
}

/** The tools that write one file, and the input field naming it. */
const EDIT_TOOLS: Record<string, 'file_path' | 'notebook_path'> = {
  Edit: 'file_path',
  Write: 'file_path',
  MultiEdit: 'file_path',
  NotebookEdit: 'notebook_path',
};
/** Commands that only read the files they name. */
const READERS = words(
  'cat head tail less more grep egrep fgrep rg wc diff cmp ls stat file sha256sum md5sum nl sort uniq cut echo printf test [',
);
/** git subcommands that leave the working tree as it is. */
const GIT_READERS = words('diff log show blame status grep ls-files rev-parse add commit');
/** Words that run the command after them. */
const WRAPPERS = words('sudo env command time nice nohup');

/** A set of space-separated words. */
function words(list: string): Set<string> {
  return new Set(list.split(' '));
}

const ASK_DOCTRINE: Decision = {
  permissionDecision: 'ask',
  permissionDecisionReason:
    'DOCTRINE.md changes only when the owner asks (ADR-0002, AGENTS.md): the owner must confirm this edit.',
};

/** Splits a shell command into simple commands, each a list of words with quotes removed; redirections are words. */
export function shellWords(command: string): string[][] {
  const commands: string[][] = [[]];
  let word = '';
  let inWord = false;
  let quote = '';
  const end = () => {
    if (inWord) commands[commands.length - 1].push(word);
    word = '';
    inWord = false;
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = '';
      else if (c === '\\' && quote === '"' && i + 1 < command.length) word += command[++i];
      else word += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      inWord = true;
    } else if (c === '\\' && i + 1 < command.length) {
      word += command[++i];
      inWord = true;
    } else if (c === ' ' || c === '\t') {
      end();
    } else if ('\n;&|()'.includes(c)) {
      end();
      if (commands[commands.length - 1].length) commands.push([]);
    } else if (c === '>' || c === '<') {
      const digits = inWord && /^\d+$/.test(word) ? word : '';
      if (!digits) end();
      let op = digits + c;
      while (command[i + 1] === '>' || command[i + 1] === '&') op += command[++i];
      commands[commands.length - 1].push(op);
      word = '';
      inWord = false;
    } else {
      word += c;
      inWord = true;
    }
  }
  end();
  return commands.filter((words) => words.length > 0);
}

/** Whether a word names the doctrine file. */
const isDoctrine = (word: string) => word === 'DOCTRINE.md' || word.endsWith('/DOCTRINE.md');

/** The words of a simple command from the command itself: leading `VAR=value` and wrappers dropped. */
function commandOf(words: string[]): string[] {
  let i = 0;
  while (i < words.length && (/^\w+=/.test(words[i]) || WRAPPERS.has(words[i]))) i++;
  return words.slice(i);
}

/** The subcommand of a `git …` command line: its first word that is neither an option nor an option's value. */
function gitSubcommand(args: string[]): string | undefined {
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '-C' || args[i] === '-c') i++;
    else if (!args[i].startsWith('-')) return args[i];
  }
  return undefined;
}

/** Whether a Bash command may write `DOCTRINE.md`: a redirection into it, or a command other than a reader naming it. */
export function writesDoctrine(command: string): boolean {
  return shellWords(command).some((words) => {
    if (words.some((word, i) => /^\d*>/.test(word) && isDoctrine(words[i + 1] ?? ''))) return true;
    const args = commandOf(words);
    if (!args.some(isDoctrine)) return false;
    const name = basename(args[0]);
    if (READERS.has(name)) return false;
    if (name === 'git') return !GIT_READERS.has(gitSubcommand(args) ?? '');
    if (['sed', 'perl', 'awk'].includes(name))
      return args.some((arg) => /^-[a-zA-Z]*i/.test(arg) || arg === '--in-place');
    return true;
  });
}

/** Whether a Bash command force-pushes to `main` or deletes it; `branch` is asked only when no refspec is given. */
export function forcePushesMain(command: string, branch: () => string | undefined): boolean {
  return shellWords(command).some((words) => {
    const args = commandOf(words);
    if (basename(args[0] ?? '') !== 'git' || gitSubcommand(args) !== 'push') return false;
    const push = args.indexOf('push');
    const rest = args.slice(push + 1).filter((arg) => !/^\d*[<>]/.test(arg));
    const flags = rest.filter((arg) => arg.startsWith('-'));
    const positionals = rest.filter((arg, i) => !arg.startsWith('-') && !['-o', '--push-option'].includes(rest[i - 1]));
    const refspecs = positionals.slice(1);
    const force =
      refspecs.some((spec) => spec.startsWith('+')) ||
      flags.some((flag) => /^--(force|force-with-lease|mirror)(=|$)/.test(flag) || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(flag));
    const removes =
      flags.some((flag) => flag === '--delete' || flag === '-d') ||
      refspecs.some((spec) => spec.replace(/^\+/, '').startsWith(':'));
    if (!force && !removes) return false;
    if (refspecs.length === 0) return flags.includes('--mirror') || flags.includes('--all') || branch() === 'main';
    return refspecs.some((spec) => {
      const target = spec.replace(/^\+/, '').split(':').pop() ?? '';
      return target === 'main' || target === 'refs/heads/main' || (target === 'HEAD' && branch() === 'main');
    });
  });
}

/** The current branch of the project, or undefined outside a repository. */
function gitBranch(projectDir: string): string | undefined {
  try {
    return execFileSync('git', ['-C', projectDir, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

/** A path with symlinks resolved as far as it exists (a new file's directory may be a link). */
function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(real(parent), basename(path));
  }
}

/** Decides one tool call: `ask`, `deny`, or undefined to let it through. */
export function decide(input: PreToolUseInput, options: GuardOptions): Decision | undefined {
  const tool = input.tool_name ?? '';
  const field = EDIT_TOOLS[tool];
  if (field) {
    const named = input.tool_input?.[field];
    if (!named) return undefined;
    const path = real(resolve(input.cwd ?? options.projectDir, named));
    if (basename(path) === 'DOCTRINE.md') return ASK_DOCTRINE;
    const inside = relative(real(options.projectDir), path);
    if (inside.startsWith('..') || isAbsolute(inside)) return undefined;
    const parts = inside.split(sep);
    if (parts[0] === 'out' || parts.includes('node_modules')) {
      return {
        permissionDecision: 'deny',
        permissionDecisionReason: `${inside} is written by tools, never by hand (AGENTS.md): run the tool that writes it (node x …, npm ci).`,
      };
    }
    return undefined;
  }
  if (tool === 'Bash') {
    const command = input.tool_input?.command ?? '';
    if (writesDoctrine(command)) return ASK_DOCTRINE;
    const branch = options.currentBranch ?? (() => gitBranch(options.projectDir));
    if (forcePushesMain(command, branch)) {
      return {
        permissionDecision: 'deny',
        permissionDecisionReason:
          'Force-pushing or deleting main rewrites published history, which only the owner approves (PLAN.md §8.14): push a branch and open a PR, or escalate with node x esc open.',
      };
    }
  }
  return undefined;
}

/** Reads the input from stdin and prints the decision, if any. */
function main(): void {
  const text = readFileSync(0, 'utf8');
  const input = (text.trim() ? JSON.parse(text) : {}) as PreToolUseInput;
  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const decision = decide(input, { projectDir });
  if (decision) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...decision } }) + '\n');
  }
}

if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) main();
