/**
 * @file A game's engine (PLAN.md WP 10.7, ADR-0024): in a game made by tools/game/new-game.mjs, which engine it is on
 * and whether its engine files are as shipped; in the engine's own repository, the proof that a new game works.
 *
 * In a game (its root holds engine-lock.json):
 * - `node x engine` prints the engine's commit and date (the lock's), and the engine files the game changed;
 * - `--check` fails when an engine file changed, or went missing, and ENGINE-FEEDBACK.md does not list it under
 *   "Local engine patches" (`x check` runs the same as its plugin `engine`, so `npm run check` does);
 * - `--update` moves the game to a newer engine: it clones the lock's repository at `--ref` (default main) into a
 *   temporary folder, or takes the checkout `--from` names, and runs that engine's `new-game.mjs --update`, which
 *   replaces the engine's files and leaves the game's alone (`--force` replaces declared patches too). Only when the
 *   owner asks: an engine update can change play, and the game's replays then need their goldens recorded again.
 *
 * In the engine's own repository: `node x engine` says how to make a game, and `--test` makes one in a temporary
 * folder from this checkout, installs it (`npm ci --prefer-offline`) and runs its gate as a game agent would:
 * `npm run check`, `npm test`, `x sim` of the starter, `x replay` of its replay in Node and Chromium, `x shot` of its
 * page, `x qa` of every family against the baselines a game gets, and `x help`, which must leave the engine's own
 * commands out. Each step's time is a metric (`install.ms`, …). `x ci --local --full` runs it (`--keep` keeps the
 * folder to look into).
 *
 * @example
 * // node x engine                → my-3dge@d2435e0 (2026-10-15): 1834 engine files, as shipped
 * // node x engine --update       → the game on the engine's latest main; then npm ci, npm run check, npm test
 * // node x engine --test         → (in the engine) a new game passes its own gate
 * @see tools/cmd/engine.test.ts
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FEEDBACK_FILE, verifyGame, type GameCheck } from '../game/files.mjs';
import { createGame } from '../game/new-game.mjs';
import type { CheckPlugin } from './check';
import type { Finding } from '../lib/report';
import { ENGINE_ONLY_COMMANDS, isGame, UsageError, type Command, type CommandResult } from '../x';

/** How long one step of `--test` may take, ms: `npm ci` on a cold cache, or a check on a loaded machine. */
const STEP_MS = 600_000;

/** A game's engine check: each engine file changed or missing that ENGINE-FEEDBACK.md does not declare. */
export function engineFindings(found: GameCheck): Finding[] {
  const short = found.lock.engine.commit.slice(0, 7);
  const patch = `write what you needed in ${FEEDBACK_FILE}; only when no workaround exists, keep the patch and list it there under "Local engine patches"`; // prettier-ignore
  return found.undeclared.map((path) =>
    found.added.includes(path)
      ? {
          id: 'ENGINE_ADDED',
          message: `${path} is in the engine's folders (my-3dge@${short}), read-only in a game: move it into labs/game/, where the game's files live, or ${patch}`,
          file: path,
        }
      : {
          id: found.missing.includes(path) ? 'ENGINE_MISSING' : 'ENGINE_EDITED',
          message: `${path} is not the engine's (my-3dge@${short}): the engine is read-only in a game. Undo it (git checkout -- ${path}) and ${patch}`,
          file: path,
        },
  );
}

/** What `x engine` says about the game in `root`. */
function status(root: string, check: boolean): CommandResult {
  const found = verifyGame(root);
  const { engine } = found.lock;
  const failures = engineFindings(found);
  const files = Object.keys(found.lock.files).length;
  const patched = [...found.changed, ...found.missing, ...found.added];
  const patches = found.declared.filter((path) => patched.includes(path));
  const state =
    failures.length > 0
      ? `${failures.length} changed and not declared`
      : patches.length > 0
        ? `as shipped but for ${patches.length} declared local patches`
        : 'as shipped';
  return {
    ok: failures.length === 0,
    summary: `my-3dge@${engine.commit.slice(0, 7)} (${engine.date.slice(0, 10)}): ${files} engine files, ${state}`,
    target: check ? 'check' : 'all',
    lines: [
      `engine: ${engine.repository} at ${engine.commit}${engine.dirty ? ' (with uncommitted changes)' : ''}`,
      ...patches.map((path) => `local patch (declared in ${FEEDBACK_FILE}): ${path}`),
      ...(check ? [] : ['update it only when the owner asks: node x engine --update']),
    ],
    failures,
    metrics: {
      files,
      changed: found.changed.length,
      missing: found.missing.length,
      added: found.added.length,
      declared: patches.length,
    },
  };
}

/** Runs a command in `cwd`, returning whether it passed, its time, its output and the output's tail. */
function step(cwd: string, command: string, args: string[]): { ok: boolean; ms: number; output: string; tail: string } {
  const started = performance.now();
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST')));
  const run = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: STEP_MS, maxBuffer: 64 << 20 });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}${run.error ? String(run.error) : ''}`;
  const tail = output.trim().split('\n').slice(-6).join(' | ');
  return { ok: run.status === 0, ms: performance.now() - started, output, tail };
}

/**
 * The engine's own commands that a game's `x help` listed: none, when game mode works. Up to 18 commands, help prints
 * them one a line, name first; past that, out/help/all/commands.txt holds the same lines (tools/cmd/help.ts).
 */
export function engineOnlyListed(game: string, output: string): string[] {
  const file = join(game, 'out', 'help', 'all', 'commands.txt');
  const listed = existsSync(file) ? readFileSync(file, 'utf8') : output;
  return ENGINE_ONLY_COMMANDS.filter((name) => new RegExp(`^\\s*${name}\\s{2,}`, 'm').test(listed));
}

/** Makes a game from the checkout at `root` in a temporary folder and runs its gate (see the file comment). */
function testGame(root: string, keep: boolean): CommandResult {
  const folder = mkdtempSync(join(tmpdir(), 'my3dge-game-'));
  const target = join(folder, 'game-test');
  const lines: string[] = [];
  const failures: Finding[] = [];
  const metrics: Record<string, number> = {};
  try {
    const made = createGame({ target, name: 'game-test', source: root });
    lines.push(`made: ${made.engineFiles} engine files and ${made.starterFiles} starter files in ${target}`);
    Object.assign(metrics, { engineFiles: made.engineFiles, starterFiles: made.starterFiles });
    const steps: [string, string, string[]][] = [
      ['install', 'npm', ['ci', '--prefer-offline', '--no-audit', '--no-fund']],
      ['check', 'npm', ['run', 'check']],
      ['test', 'npm', ['test']],
      ['sim', process.execPath, ['x', 'sim', 'labs/game/scenes/play.ts', '--steps', '600']],
      ['replay', process.execPath, ['x', 'replay', 'labs/game/replays', '--browser', 'sim']],
      ['shot', process.execPath, ['x', 'shot', 'labs/game']],
      ['qa', process.execPath, ['x', 'qa', 'anim', 'geo', 'tex', 'audio', 'level']],
      ['help', process.execPath, ['x', 'help']],
    ];
    for (const [name, command, args] of steps) {
      const done = step(target, command, args);
      const leaked = name === 'help' ? engineOnlyListed(target, done.output) : [];
      metrics[`${name}.ms`] = Math.round(done.ms);
      lines.push(`${name}: ${done.ok && leaked.length === 0 ? 'ok' : 'FAIL'} (${(done.ms / 1000).toFixed(1)} s)`);
      if (leaked.length > 0) failures.push({ id: 'ENGINE_TEST_HELP', message: `a game's x help lists the engine's own commands: ${leaked.join(', ')}` }); // prettier-ignore
      if (!done.ok) failures.push({ id: `ENGINE_TEST_${name.toUpperCase()}`, message: `${command} ${args.join(' ')} failed in the new game: ${done.tail}` }); // prettier-ignore
      if (!done.ok && name === 'install') break;
    }
  } finally {
    if (keep) lines.push(`kept: ${target}`);
    else rmSync(folder, { recursive: true, force: true });
  }
  return {
    ok: failures.length === 0,
    summary: failures.length === 0 ? 'a new game passes its own gate' : `a new game fails ${failures.length} step(s)`,
    target: 'test',
    lines,
    failures,
    metrics,
  };
}

/** Clones `repository` at `ref` (a branch, a tag or a commit) into `into`, shallow. */
function cloneEngine(repository: string, ref: string, into: string): void {
  const git = (...args: string[]) => {
    const run = spawnSync('git', args, { encoding: 'utf8', timeout: STEP_MS });
    if (run.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(run.stderr || String(run.error)).trim()}`);
  };
  if (/^[0-9a-f]{7,40}$/.test(ref)) {
    git('init', '--quiet', into);
    git('-C', into, 'fetch', '--quiet', '--depth', '1', repository, ref);
    git('-C', into, 'checkout', '--quiet', '--detach', 'FETCH_HEAD');
  } else git('clone', '--quiet', '--depth', '1', '--branch', ref, repository, into);
}

/** Moves the game at `root` to the engine at `--from`, or cloned at `--ref`. */
function update(root: string, ref: string, from: string | undefined, force: boolean): CommandResult {
  const { lock } = verifyGame(root);
  const folder = from ? undefined : mkdtempSync(join(tmpdir(), 'my3dge-engine-'));
  try {
    const source = from ?? join(folder!, 'my-3dge');
    if (!from) cloneEngine(lock.engine.repository, ref, source);
    const args = [join(source, 'tools', 'game', 'new-game.mjs'), '--update', root, ...(force ? ['--force'] : [])];
    const run = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: STEP_MS });
    const lines = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim().split('\n').filter(Boolean);
    const ok = run.status === 0;
    const failures = ok ? [] : [{ id: 'ENGINE_UPDATE', message: lines.join(' ') || String(run.error) }];
    return { ok, summary: ok ? 'the game is on the new engine' : 'the update stopped', lines: ok ? lines : [], failures, target: 'update' }; // prettier-ignore
  } finally {
    if (folder) rmSync(folder, { recursive: true, force: true });
  }
}

/** `x check`'s plugin `engine`: in a game, its engine files as shipped or declared; in the engine, nothing to do. */
export const check: CheckPlugin = {
  name: 'engine',
  run({ root }) {
    if (!isGame(root)) return { failures: [], summary: 'the engine’s own repository' };
    const found = verifyGame(root);
    const files = Object.keys(found.lock.files).length;
    return {
      failures: engineFindings(found),
      summary: `my-3dge@${found.lock.engine.commit.slice(0, 7)}, ${files} files`,
    };
  },
};

export default {
  usage: 'engine [--check] [--update [--ref r] [--from dir] [--force]] [--test [--keep]]',
  options: {
    check: { type: 'boolean' },
    update: { type: 'boolean' },
    ref: { type: 'string' },
    from: { type: 'string' },
    force: { type: 'boolean' },
    test: { type: 'boolean' },
    keep: { type: 'boolean' },
  },
  maxPositionals: 0,
  async run({ root, values }): Promise<CommandResult> {
    const game = isGame(root);
    if (values.test) {
      if (game) throw new UsageError('--test runs in the engine’s own repository, which makes the game it tests');
      return testGame(root, values.keep === true);
    }
    if (!game) {
      if (values.update || values.check) throw new UsageError('this is the engine’s own repository, not a game: --check and --update run in a game made by node tools/game/new-game.mjs <dir>'); // prettier-ignore
      return { ok: true, summary: 'the engine’s own repository: node tools/game/new-game.mjs <dir> makes a game', target: 'all' }; // prettier-ignore
    }
    if (values.update) return update(root, (values.ref as string | undefined) ?? 'main', values.from as string | undefined, values.force === true); // prettier-ignore
    return status(root, values.check === true);
  },
} satisfies Command;
