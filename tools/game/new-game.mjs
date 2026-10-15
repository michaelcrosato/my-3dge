#!/usr/bin/env node
/**
 * @file Makes a game from the my-3dge engine, and moves a game to a newer engine (PLAN.md WP 10.7, ADR-0024): the
 * one command an agent runs to start a game. Plain JavaScript for any Node from 18 with nothing installed, since it
 * runs straight after `git clone`, before setup. What a game gets, and whose each file is, is tools/game/files.mjs.
 *
 * Create: `node <engine>/tools/game/new-game.mjs <dir> [--name <name>]` writes a game into <dir> (made if missing;
 * an empty folder, or a fresh repository's root): the engine's files, copied as they are and pinned by
 * engine-lock.json; the starter game, labs/game/; the game's root files from tools/game/template/ (`TEMPLATES`); and
 * package.json and package-lock.json with the engine's pins (`gamePackage`, `gameLockfile`, from tools/game/files.mjs).
 * Then `git init` when the folder is in no repository. It never overwrites: a README.md or LICENSE already there is
 * kept, a .gitignore gains the lines it lacks, an AGENTS.md, CLAUDE.md or GEMINI.md gets the game's after its own
 * text, and any other file in the way stops it before it writes anything.
 *
 * Update: `node <newer engine>/tools/game/new-game.mjs --update <dir>` (what `node x engine --update` runs) puts this
 * checkout's engine files in place of the game's, removes those it dropped, moves package.json to its pins, brings
 * the root files the game never edited to its templates (`refreshTemplates`) and writes the new lock. Nothing of the
 * game's is replaced or removed: it stops, having written nothing, on an engine file the game changed without
 * declaring it under "Local engine patches" in ENGINE-FEEDBACK.md (a declared one is kept), on a file of the game's
 * where the newer engine adds one, and on a package.json entry of the game's that the newer engine sets otherwise
 * (`npmClashes`); `--force` lets the engine's replace them. It names the package.json entries it drops, or sets back
 * where the game had edited the engine's (`npmLost`): the engine's pins win, as its files do.
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
  gameLockfile,
  gamePackage,
  hashFile,
  hashText,
  LOCK_FILE,
  lockFor,
  npmClashes,
  npmLost,
  plan,
  sameDependencies,
  SOURCE,
  verifyGame,
} from './files.mjs';

export { gameLockfile, gamePackage, npmClashes };

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

/** Files a target may hold: a README.md or LICENSE is kept; a .gitignore gains the template's lines it lacks. */
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

/** The values of the templates' placeholders for the game `game` on the engine `identity`. */
function templateValues(game, identity) {
  return {
    name: game,
    'engine.repository': identity.repository,
    'engine.commit': identity.commit,
    'engine.short': identity.commit.slice(0, 7),
    'engine.date': identity.date,
  };
}

/** A template's text in the engine at `source`. */
const templateText = (source, template) => readFileSync(join(source, 'tools/game/template', template), 'utf8');

/** Reads a JSON file. */
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/** Writes JSON with two spaces and a final newline (what Prettier keeps). */
function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** What writing `to` under `root` meets, if anything: the file itself, or a file where one of its folders goes. */
function inTheWay(root, to) {
  const parts = to.split('/');
  for (let i = 1; i <= parts.length; i++) {
    const path = join(root, ...parts.slice(0, i));
    if (existsSync(path) && (i === parts.length || !statSync(path).isDirectory())) return path;
  }
  return undefined;
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
  const values = templateValues(game, identity);
  const kept = [];
  const templates = {};
  for (const [template, to] of TEMPLATES) {
    const text = render(templateText(source, template), values);
    const file = join(root, to);
    templates[to] = existsSync(file) ? null : hashText(text);
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
  writeJson(join(root, LOCK_FILE), lockFor(source, engineItems, identity, game, engine, templates));
  const initialized = git && initRepository(root);
  const starterFiles = items.length - engineItems.length;
  return { root, name: game, identity, engineFiles: engineItems.length, starterFiles, kept, initialized };
}

/**
 * Moves the game in `target` to the engine at `source`; returns what changed. Throws, having written nothing, on
 * anything of the game's the update would replace (the file comment says what), unless `force`.
 */
export function updateGame({ target, source = SOURCE, force = false }) {
  const root = resolve(target);
  const before = verifyGame(root);
  if (before.undeclared.length > 0 && !force) throw new Error(undeclaredMessage(before));
  const patched = [...before.changed, ...before.missing, ...before.added];
  const keep = new Set(force ? [] : before.declared.filter((path) => patched.includes(path)));
  const identity = engineIdentity(source);
  const items = plan(source).filter((item) => item.owner === 'engine');
  const old = before.lock.files;
  const added = items.filter((item) => !(item.to in old)).map((item) => item.to);
  const blocked = added.filter((path) => !keep.has(path) && inTheWay(root, path));
  const engine = readJson(join(source, 'package.json'));
  const previous = readJson(join(root, 'package.json'));
  const clashes = npmClashes(previous, engine, before.lock.npm);
  if (blocked.length + clashes.length > 0 && !force) throw new Error(clashMessage(blocked, clashes));
  const next = new Set(items.map((item) => item.to));
  const removed = Object.keys(old).filter((path) => !next.has(path) && !keep.has(path));
  for (const path of removed) rmSync(join(root, path), { force: true });
  for (const way of blocked.map((path) => inTheWay(root, path))) if (way) rmSync(way, { recursive: true, force: true });
  const replaced = items
    .filter((item) => item.to in old && !keep.has(item.to) && old[item.to] !== hashFile(join(source, item.from)))
    .map((item) => item.to);
  for (const { from, to } of items) if (!keep.has(to)) copyInto(source, from, root, to);
  const pkg = gamePackage(engine, previous.name, previous, before.lock.npm);
  writeJson(join(root, 'package.json'), pkg);
  const npm = npmLost(previous, pkg, before.lock.npm);
  const lockfileFits = sameDependencies(pkg, engine);
  if (lockfileFits) {
    writeJson(join(root, 'package-lock.json'), gameLockfile(readJson(join(source, 'package-lock.json')), pkg.name));
  }
  const { templates, refreshed, diverged } = refreshTemplates(root, source, before.lock, identity);
  writeJson(join(root, LOCK_FILE), lockFor(source, items, identity, before.lock.game, engine, templates));
  const forced = [...blocked, ...clashes];
  return { root, from: before.lock.engine, to: identity, added, removed, replaced, kept: [...keep], forced, npm, refreshed, diverged, lockfileFits }; // prettier-ignore
}

/** Why an update stops on engine files the game changed or added without declaring them, with the fixes. */
function undeclaredMessage({ undeclared, added }) {
  const declare = `list it under "Local engine patches" in ${FEEDBACK_FILE} to keep it`;
  const edited = undeclared.filter((path) => !added.includes(path));
  const own = undeclared.filter((path) => added.includes(path));
  return [
    edited.length > 0 &&
      `the game changed engine files it does not declare: ${edited.join(', ')}. Undo each (git checkout -- <path>), ${declare}, or pass --force to replace it`, // prettier-ignore
    own.length > 0 &&
      `the game added files in the engine's folders: ${own.join(', ')}. Move each into labs/game/ (or delete it), or ${declare}`, // prettier-ignore
  ]
    .filter(Boolean)
    .join('; ');
}

/** Why an update stops on the game's own files and package.json entries where the newer engine has its own. */
function clashMessage(blocked, clashes) {
  const parts = [
    blocked.length > 0 &&
      `the newer engine adds ${blocked.join(', ')}, where the game has files of its own: move or rename them`,
    clashes.length > 0 &&
      `the newer engine sets ${clashes.join(', ')} in package.json, where the game has its own: rename the game's (a script), or drop it (a dependency: the engine's pin then serves)`, // prettier-ignore
  ];
  return `${parts.filter(Boolean).join('; ')}; or pass --force to let the engine's replace them`;
}

/**
 * Brings the game's root files to the templates of the engine at `source` (`lock` is the game's, `identity` the new
 * engine's). A file the game never edited (its hash is the lock's) gets the new template; one it edited is named when
 * its template changed, to compare by hand; one it removed, or had before new-game.mjs, stays as it is; a template new
 * to the game is written where no file is. Returns the lock's new `templates` and the paths refreshed and named.
 */
function refreshTemplates(root, source, lock, identity) {
  const was = lock.templates ?? {};
  const [then, now] = [templateValues(lock.game, lock.engine), templateValues(lock.game, identity)];
  const templates = {};
  const refreshed = [];
  const diverged = [];
  for (const [template, to] of TEMPLATES) {
    const file = join(root, to);
    const text = templateText(source, template);
    const fresh = render(text, now);
    templates[to] = hashText(fresh);
    if (!(to in was) && !existsSync(file)) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, fresh);
      refreshed.push(to);
    } else if (!(to in was) || was[to] === null || !existsSync(file)) templates[to] = null;
    else if (hashFile(file) !== was[to]) {
      if (hashText(render(text, then)) !== was[to]) diverged.push(to);
    } else if (templates[to] !== was[to]) {
      writeFileSync(file, fresh);
      refreshed.push(to);
    }
  }
  return { templates, refreshed, diverged };
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
      if (done.forced.length > 0) out(`replaced the game's own (--force): ${done.forced.join(', ')}`);
      if (done.npm.length > 0) out(`package.json: the engine's entries win, so these went or are the engine's again: ${done.npm.join(', ')}; put back what the game needs under a name of its own`); // prettier-ignore
      if (done.refreshed.length > 0) out(`root files brought to the engine's templates: ${done.refreshed.join(', ')}`);
      const template = (to) => `${to} (tools/game/template/${TEMPLATES.find(([, path]) => path === to)[0]})`;
      if (done.diverged.length > 0) out(`the engine's templates changed for root files the game edited: compare ${done.diverged.map(template).join(', ')} and take what applies`); // prettier-ignore
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
