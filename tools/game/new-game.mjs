#!/usr/bin/env node
/**
 * @file Makes a game from the my-3dge engine, and moves a game to a newer engine (PLAN.md WP 10.7, ADR-0024): the
 * one command an agent runs to start a game. Plain JavaScript for any Node from 18 with nothing installed, since it
 * runs straight after `git clone`, before setup. What a game gets, and whose each file is, is tools/game/files.mjs.
 *
 * Create: `node <engine>/tools/game/new-game.mjs <dir> [--name <name>]` writes a game into <dir> (made if missing;
 * an empty folder, or a fresh repository's root): the engine's files, copied as they are and pinned by
 * engine-lock.json; the starter game, labs/game/; the game's root files from tools/game/template/ (`TEMPLATES`); and
 * package.json and package-lock.json with the engine's pins (`gamePackage`, `gameLockfile`). Then `git init` when
 * the folder is in no repository. It never overwrites: a README.md or LICENSE already there is kept, a .gitignore
 * gains the lines it lacks, an AGENTS.md, CLAUDE.md or GEMINI.md gets the game's after its own text, and any other file
 * in the way stops it before it writes anything.
 *
 * Update: `node <newer engine>/tools/game/new-game.mjs --update <dir>` (what `node x engine --update` runs) puts this
 * checkout's engine files in place of the game's, removes those it dropped, moves package.json to its pins and writes
 * the new lock; the game's own files are never touched. An engine file the game changed stops it, unless
 * ENGINE-FEEDBACK.md lists it under "Local engine patches" (then it is kept), or `--force` replaces it.
 *
 * `--verify <dir>` prints `verifyGame` (tools/game/files.mjs) as JSON. Exit codes: 0 done, 1 stopped (the message says
 * why and what to do), 2 a usage error.
 *
 * @example
 * // node /tmp/my-3dge/tools/game/new-game.mjs ../dragon-run → a game in ../dragon-run, named dragon-run
 * // node /tmp/my-3dge/tools/game/new-game.mjs . --name dragon-run → in the current folder (a fresh repository)
 * // node /tmp/my-3dge-new/tools/game/new-game.mjs --update . → the game in . on the newer engine
 * gameName('/tmp/Dragon Run!'); // 'dragon-run'
 * render('# {{name}}', { name: 'dragon-run' }); // '# dragon-run'
 * @see tools/game/new-game.test.ts
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  engineIdentity,
  FEEDBACK_FILE,
  gameScripts,
  hashFile,
  LOCK_FILE,
  lockFor,
  plan,
  SOURCE,
  verifyGame,
} from './files.mjs';

/** The game's root files: template (in tools/game/template/) → where it goes. */
export const TEMPLATES = Object.freeze([
  ['AGENTS.md.tmpl', 'AGENTS.md'],
  ['CLAUDE.md.tmpl', 'CLAUDE.md'],
  ['GEMINI.md.tmpl', 'GEMINI.md'],
  ['README.md.tmpl', 'README.md'],
  ['ENGINE-FEEDBACK.md.tmpl', FEEDBACK_FILE],
  ['gitignore.tmpl', '.gitignore'],
  ['index.html.tmpl', 'index.html'],
  ['claude-settings.json.tmpl', '.claude/settings.json'],
]);

/** Files a target may already hold: a README.md or LICENSE is kept; a .gitignore gains the template's lines it lacks. */
const KEPT = new Set(['README.md', 'LICENSE', '.gitignore', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md']);

/** Instruction files the agents read: one already there keeps its text, and the game's follows it (`appendOnce`). */
const APPENDED = new Set(['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']);

/** A game's name: an npm package name, from the folder's name by default (`Dragon Run!` → `dragon-run`). */
export function gameName(target, name) {
  const folder = basename(resolve(target)).toLowerCase();
  const chosen = name ?? folder.replace(/[^a-z0-9._-]+/g, '-').replace(/^[-._]+|[-._]+$/g, '');
  if (!/^[a-z0-9][a-z0-9._-]{0,213}$/.test(chosen)) {
    throw new Error(`"${chosen}" cannot name a game: give --name with lower-case letters, digits, '-', '.' or '_'`);
  }
  return chosen;
}

/** Fills a template's `{{name}}` and `{{engine.*}}`; any other placeholder is an error. */
export function render(text, values) {
  return text.replace(/\{\{([a-z.]+)\}\}/g, (whole, key) => {
    if (key in values) return values[key];
    throw new Error(`the template's ${whole} has no value: new-game.mjs fills ${Object.keys(values).join(', ')}`);
  });
}

/**
 * A game's package.json: the engine's pins and scripts. With `previous` (the game's) and `before` (the engine's that
 * the game had, its lock's `npm`), the game keeps its own fields, and the scripts and dependencies the engine it had
 * did not give it; the new engine's win over the rest, and those it dropped go.
 */
export function gamePackage(engine, name, previous, before = {}) {
  const scripts = gameScripts(engine);
  const { engines, dependencies, devDependencies, allowScripts } = engine;
  if (!previous) {
    const description = 'A game made with the my-3dge engine.';
    return { name, version: '0.0.0', private: true, description, type: 'module', engines, scripts, dependencies, devDependencies, allowScripts }; // prettier-ignore
  }
  const merged = (kind, next) => {
    const own = Object.entries(previous[kind] ?? {}).filter(([key]) => !(key in (before[kind] ?? {})));
    return { ...Object.fromEntries(own), ...next };
  };
  return {
    ...previous,
    engines,
    scripts: merged('scripts', scripts),
    dependencies: merged('dependencies', dependencies),
    devDependencies: merged('devDependencies', devDependencies),
    allowScripts,
  };
}

/** The engine's package-lock.json for a game named `name`: the same tree, the root renamed. */
export function gameLockfile(engineLock, name) {
  const lock = structuredClone(engineLock);
  lock.name = name;
  const { license: _license, ...root } = lock.packages[''];
  lock.packages[''] = { ...root, name, version: '0.0.0' };
  return lock;
}

/** Whether a game's dependencies are exactly the engine's, so the engine's lockfile fits it. */
function sameDependencies(pkg, engine) {
  const same = (a = {}, b = {}) =>
    JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
  return same(pkg.dependencies, engine.dependencies) && same(pkg.devDependencies, engine.devDependencies);
}

/** Reads a JSON file. */
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/** Writes JSON with two spaces and a final newline (what Prettier keeps). */
function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** Whether writing `to` under `root` meets something there: the file itself, or a file where a folder must go. */
function inTheWay(root, to) {
  const parts = to.split('/');
  return parts.some((_, i) => {
    const path = join(root, ...parts.slice(0, i + 1));
    return existsSync(path) && (i === parts.length - 1 || !statSync(path).isDirectory());
  });
}

/** Copies one file, making its folder. */
function copyInto(source, from, root, to) {
  mkdirSync(dirname(join(root, to)), { recursive: true });
  copyFileSync(join(source, from), join(root, to));
}

/** Makes a game in `target` from the engine at `source`; on a clash it throws, having written nothing. */
export function createGame({ target, name, source = SOURCE, git = true }) {
  const root = resolve(target);
  if (existsSync(root) && !statSync(root).isDirectory()) throw new Error(`${root} is a file: name a folder`);
  const game = gameName(root, name);
  const identity = engineIdentity(source);
  const items = plan(source);
  const writes = [
    ...items.map((item) => item.to),
    ...TEMPLATES.map(([, to]) => to),
    'package.json',
    'package-lock.json',
  ];
  const clashes = [...writes, LOCK_FILE].filter((to) => !KEPT.has(to) && inTheWay(root, to));
  if (clashes.length > 0) {
    const named = clashes.slice(0, 5).join(', ') + (clashes.length > 5 ? ` and ${clashes.length - 5} more` : '');
    throw new Error(
      `${root} already holds ${named}: make the game in an empty folder or a fresh repository's root (a README.md, ` +
        'LICENSE or .gitignore may be there), or move a game to a newer engine with --update',
    );
  }
  for (const { from, to } of items) copyInto(source, from, root, to);
  const values = {
    name: game,
    'engine.repository': identity.repository,
    'engine.commit': identity.commit,
    'engine.short': identity.commit.slice(0, 7),
    'engine.date': identity.date,
  };
  const kept = [];
  for (const [template, to] of TEMPLATES) {
    const text = render(readFileSync(join(source, 'tools/game/template', template), 'utf8'), values);
    const file = join(root, to);
    if (to === '.gitignore' && existsSync(file)) mergeLines(file, text);
    else if (APPENDED.has(to) && existsSync(file)) appendOnce(file, text);
    else if (existsSync(file)) kept.push(to);
    else {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
    }
  }
  const engine = readJson(join(source, 'package.json'));
  writeJson(join(root, 'package.json'), gamePackage(engine, game));
  writeJson(join(root, 'package-lock.json'), gameLockfile(readJson(join(source, 'package-lock.json')), game));
  const engineItems = items.filter((item) => item.owner === 'engine');
  writeJson(join(root, LOCK_FILE), lockFor(source, engineItems, identity, game, engine));
  const initialized = git && initRepository(root);
  const starterFiles = items.length - engineItems.length;
  return { root, name: game, identity, engineFiles: engineItems.length, starterFiles, kept, initialized };
}

/**
 * Moves the game in `target` to the engine at `source`; returns what changed. Throws, having written nothing, on an
 * engine file the game changed without declaring it, or on a file of the game's where the new engine adds one.
 */
export function updateGame({ target, source = SOURCE, force = false }) {
  const root = resolve(target);
  const before = verifyGame(root);
  if (before.undeclared.length > 0 && !force) {
    throw new Error(
      `the game changed engine files it does not declare: ${before.undeclared.join(', ')}. Undo each (git checkout ` +
        `-- <path>), list it under "Local engine patches" in ${FEEDBACK_FILE} to keep it, or pass --force to replace it`,
    );
  }
  const patched = [...before.changed, ...before.missing, ...before.added];
  const keep = new Set(force ? [] : before.declared.filter((path) => patched.includes(path)));
  const identity = engineIdentity(source);
  const items = plan(source).filter((item) => item.owner === 'engine');
  const old = before.lock.files;
  const fresh = items.filter((item) => !(item.to in old));
  const blocked = fresh.filter((item) => !keep.has(item.to) && inTheWay(root, item.to)).map((item) => item.to);
  if (blocked.length > 0 && !force) {
    throw new Error(
      `the newer engine adds ${blocked.join(', ')}, where the game has files of its own: move them (the game's files ` +
        "live in labs/game/ and at its root), or pass --force to let the engine's replace them",
    );
  }
  const next = new Set(items.map((item) => item.to));
  const removed = Object.keys(old).filter((path) => !next.has(path) && !keep.has(path));
  for (const path of removed) rmSync(join(root, path), { force: true });
  const added = fresh.map((item) => item.to);
  const replaced = items.filter((item) => item.to in old && old[item.to] !== hashFile(join(source, item.from)));
  for (const { from, to } of items) if (!keep.has(to)) copyInto(source, from, root, to);
  const engine = readJson(join(source, 'package.json'));
  const previous = readJson(join(root, 'package.json'));
  const pkg = gamePackage(engine, previous.name, previous, before.lock.npm);
  writeJson(join(root, 'package.json'), pkg);
  const lockfileFits = sameDependencies(pkg, engine);
  if (lockfileFits) {
    writeJson(join(root, 'package-lock.json'), gameLockfile(readJson(join(source, 'package-lock.json')), pkg.name));
  }
  writeJson(join(root, LOCK_FILE), lockFor(source, items, identity, before.lock.game, engine));
  const changed = replaced.map((item) => item.to);
  return { root, from: before.lock.engine, to: identity, added, removed, replaced: changed, kept: [...keep], lockfileFits }; // prettier-ignore
}

/** Appends `text` after a file's own, once: a repository's instructions stay first, and the game's follow them. */
function appendOnce(file, text) {
  const had = readFileSync(file, 'utf8');
  if (!had.includes(text.trim())) writeFileSync(file, `${had.replace(/\n*$/, '\n\n')}${text}`);
}

/** Appends the template's lines a file lacks. */
function mergeLines(file, text) {
  const had = readFileSync(file, 'utf8');
  const have = new Set(had.split('\n'));
  const lacking = text.split('\n').filter((line) => line.trim() && !line.startsWith('#') && !have.has(line));
  if (lacking.length > 0) writeFileSync(file, `${had.replace(/\n?$/, '\n')}${lacking.join('\n')}\n`);
}

/** Runs `git init` when `root` is in no repository and git is there; returns whether it did. */
function initRepository(root) {
  try {
    execFileSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' });
    return false;
  } catch {
    try {
      execFileSync('git', ['init', '--quiet', root], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
}

/** The command line; returns the exit code. */
export function main(argv = process.argv.slice(2), out = console.log, err = console.error) {
  const usage = 'usage: node tools/game/new-game.mjs <dir> [--name <name>] | --update <dir> [--force] | --verify <dir>';
  const named = argv.indexOf('--name');
  const flags = argv.filter((arg) => arg.startsWith('--'));
  const positional = argv.filter((arg, i) => !arg.startsWith('--') && (named < 0 || i !== named + 1));
  const unknown = flags.find((flag) => !['--name', '--update', '--force', '--verify', '--help'].includes(flag));
  if (flags.includes('--help')) return (out(usage), 0);
  if (unknown || positional.length !== 1 || (named >= 0 && !argv[named + 1])) {
    return (err(`new-game: ${unknown ? `unknown flag ${unknown}` : 'name one folder'}\n${usage}`), 2);
  }
  const [target] = positional;
  try {
    if (flags.includes('--verify')) return (out(JSON.stringify(verifyGame(target), null, 2)), 0);
    if (flags.includes('--update')) {
      const done = updateGame({ target, force: flags.includes('--force') });
      const patches = done.kept.length > 0 ? `, the local patches kept (${done.kept.join(', ')})` : '';
      const counts = `${done.replaced.length} engine files changed, ${done.added.length} added, ${done.removed.length} removed`; // prettier-ignore
      out(`new-game: moved from my-3dge@${done.from.commit.slice(0, 7)} to my-3dge@${done.to.commit.slice(0, 7)}: ${counts}${patches}`); // prettier-ignore
      out(`next: ${done.lockfileFits ? 'npm ci' : 'npm install (the game has dependencies of its own)'}, then npm run check && npm test`); // prettier-ignore
      return 0;
    }
    const done = createGame({ target, name: named >= 0 ? argv[named + 1] : undefined });
    const near = relative(process.cwd(), done.root);
    const where = near.startsWith('..') ? done.root : (near || '.').split(sep).join('/');
    const extra = `${done.kept.length > 0 ? `; kept your ${done.kept.join(', ')}` : ''}${done.initialized ? '; git init' : ''}`; // prettier-ignore
    out(`new-game: made the game "${done.name}" in ${where}: the engine at my-3dge@${done.identity.commit.slice(0, 7)} (${done.engineFiles} files, read-only, pinned by ${LOCK_FILE}) and the starter game in labs/game/${extra}`); // prettier-ignore
    out(`next: ${where === '.' ? '' : `cd ${where} && `}bash scripts/setup.sh && npm test`);
    out('then: read AGENTS.md and docs/GAME-GUIDE.md, make the game in labs/game/, and commit as you go');
    return 0;
  } catch (error) {
    err(`new-game: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
