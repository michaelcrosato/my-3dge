/**
 * @file What a game made from the engine holds, and the lock that pins it (PLAN.md WP 10.7, ADR-0024): which of the
 * engine's files a game gets and as whose (`RULES`, `ownerOf`, `plan`), the engine's identity (`engineIdentity`), its
 * package.json and package-lock.json from the engine's (`gamePackage`, `gameLockfile`, `npmClashes`, `npmLost`), and
 * engine-lock.json, the game's record of the engine commit and every engine file's SHA-256 (`lockFor`, `verifyGame`).
 * tools/game/new-game.mjs makes and updates games with it; `node x engine` and `x check`'s `engine` plugin read it in
 * a game. Plain JavaScript for any Node from 18, as new-game.mjs runs before anything is installed.
 *
 * Whose a file is: 'engine' files are copied into every game byte for byte and never edited there (engine/, tools/,
 * data/, the box as the worked example, the configs, scripts/setup.sh, DOCTRINE.md and the docs a game reads); the
 * starter game (labs/game/) is copied once and is the game's own from then on; 'skip' stays in the engine's
 * repository (its plan, records, CI, deployment, test suites and fixtures). A path no rule names is never copied, and
 * tools/game/new-game.test.ts fails on one, so each new file at the engine's root is a decision.
 *
 * Invariants: lists use `/` and are sorted; the lock's `files` are the game's paths; its `npm` holds the package.json
 * entries the engine gave the game (`engineNpm`), so an update tells them from the game's own; its `templates` holds
 * each root file new-game.mjs wrote from tools/game/template/, with the SHA-256 of what it wrote (null for a file the
 * game already had); a declared patch is a path in backticks at the start of a list item under ENGINE-FEEDBACK.md's
 * "## Local engine patches", outside comments.
 *
 * @example
 * ownerOf('engine/sim/world.ts'); // 'engine'
 * ownerOf('labs/game/scenes/play.ts'); // 'game'
 * ownerOf('PLAN.md'); // 'skip'
 * plan().find((item) => item.from === 'LICENSE')?.to; // 'engine/LICENSE'
 * @see tools/game/new-game.test.ts
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where the engine lives on GitHub: what a game's lock names and `x engine --update` clones. */
export const ENGINE_REPOSITORY = 'https://github.com/michaelcrosato/my-3dge';
/** The lock a game keeps at its root: the engine's commit and every engine file's hash. */
export const LOCK_FILE = 'engine-lock.json';
/** The lock's format. */
export const LOCK_FORMAT = 'my3dge-engine-lock/1';
/** Where a game writes what it needed from the engine, and declares the engine files it patched. */
export const FEEDBACK_FILE = 'ENGINE-FEEDBACK.md';
/** The starter game: copied into a new game, then the game's own. */
export const STARTER = 'labs/game/';

/** This checkout's root: two levels above this file. */
export const SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Single files a game gets as the engine's: configs, setup, the hook, the pages and docs its tools and agents read. */
const ENGINE_FILES = new Set([
  'x.js',
  'vite.config.ts',
  'eslint.config.js',
  'tsconfig.json',
  'tsconfig.base.json',
  'tsconfig.check.json',
  'tsconfig.engine.json',
  'tsconfig.apps.json',
  'tsconfig.tests.json',
  '.prettierrc.json',
  '.prettierignore',
  '.editorconfig',
  '.nvmrc',
  'DOCTRINE.md',
  'scripts/setup.sh',
  'docs/GAME-GUIDE.md',
  'docs/API.md',
  'docs/ERRORS.md',
  'tests/setup/adviceTrap.ts',
  'tests/pages/replay.html',
  'tests/pages/replay.ts',
  '.claude/hooks/post-tool-use.ts',
]);

/** Engine files a game gets under another path: the engine's license travels with its code. */
export const RENAMED = Object.freeze({ LICENSE: 'engine/LICENSE' });

/** The engine's own, at its root: its plan, records, CI, deployment, test suites, fixtures and the lean package. */
const ENGINE_ONLY =
  /^(PLAN\.md|AGENTS\.md|CLAUDE\.md|README\.md|index\.html|package(-lock)?\.json|playwright\.config\.ts|vercel\.json|\.vercelignore|\.gitignore|\.gitattributes|\.github\/|\.claude\/|fixtures\/|tests\/|docs\/|scripts\/|labs\/hello\/|lean\/)/;

/** Which source files a game gets, and as whose: the first rule whose `test` matches a path decides (`ownerOf`). */
export const RULES = Object.freeze([
  { owner: 'game', why: 'the starter game: the game’s own once copied', test: (p) => p.startsWith(STARTER) },
  { owner: 'skip', why: 'the engine’s tests stay in its repository', test: (p) => p.endsWith('.test.ts') },
  { owner: 'engine', why: 'the engine, its tools and data', test: (p) => /^(engine|tools|data)\//.test(p) },
  { owner: 'engine', why: 'the box: the engine’s worked example', test: (p) => p.startsWith('labs/box/') },
  { owner: 'skip', why: 'the port’s reference vectors: x port is the engine’s', test: (p) => p.startsWith('tests/baselines/port/') }, // prettier-ignore
  { owner: 'engine', why: 'the baselines its tools read (QA, advice, perf, thumbnails)', test: (p) => p.startsWith('tests/baselines/') }, // prettier-ignore
  { owner: 'engine', why: 'configs, setup and docs a game reads', test: (p) => ENGINE_FILES.has(p) || p in RENAMED },
  { owner: 'skip', why: 'the engine’s own: plan, records, CI, suites', test: (p) => ENGINE_ONLY.test(p) },
]);

/** Never walked when the source is no git checkout (an archive): what git would ignore. */
const UNTRACKED = new Set(['.git', 'node_modules', 'out', 'dist', '.cache', 'test-results']);

/** Whose a source path is: 'engine', 'game' (the starter) or 'skip'; null when no rule names it. */
export function ownerOf(path) {
  return RULES.find((rule) => rule.test(path))?.owner ?? null;
}

/** The source's files, as git tracks or would track them (or, in an archive, every file), sorted, with `/`. */
export function sourceFiles(source = SOURCE) {
  if (existsSync(join(source, '.git'))) {
    try {
      const args = ['-C', source, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'];
      const listed = execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 << 20 });
      return [...new Set(listed.split('\0'))].filter((p) => p && existsSync(join(source, p))).sort();
    } catch {
      // no git on PATH: walk instead
    }
  }
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(source, dir), { withFileTypes: true })) {
      if (UNTRACKED.has(entry.name)) continue;
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  walk('');
  return files.sort();
}

/** The engine's identity: its repository, commit and commit date, and whether the checkout had changes. */
export function engineIdentity(source = SOURCE) {
  const stamp = readFileSync(join(source, 'tools/game/engine-version.txt'), 'utf8').trim();
  if (!stamp.startsWith('$Format')) {
    const [commit = 'unknown', date = 'unknown'] = stamp.split(/\s+/);
    return { repository: ENGINE_REPOSITORY, commit, date, dirty: false };
  }
  try {
    const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
    const dirty = git('status', '--porcelain', '--untracked-files=no') !== '';
    return {
      repository: ENGINE_REPOSITORY,
      commit: git('rev-parse', 'HEAD'),
      date: git('log', '-1', '--format=%cI'),
      dirty,
    };
  } catch {
    return { repository: ENGINE_REPOSITORY, commit: 'unknown', date: 'unknown', dirty: false };
  }
}

/** A text's or a buffer's SHA-256, as the lock writes it. */
export function hashText(text) {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

/** A file's SHA-256, as the lock writes it. */
export function hashFile(file) {
  return hashText(readFileSync(file));
}

/** What a game gets from `source`: each file to copy, from its source path to its path in the game, and whose it is. */
export function plan(source = SOURCE) {
  return sourceFiles(source)
    .map((from) => ({ from, to: RENAMED[from] ?? from, owner: ownerOf(from) }))
    .filter((item) => item.owner === 'engine' || item.owner === 'game');
}

/** The package.json fields a game shares with the engine: the engine's entries in each, the game's own beside them. */
export const NPM_FIELDS = Object.freeze(['scripts', 'dependencies', 'devDependencies', 'allowScripts']);

/**
 * The entries of each of `NPM_FIELDS` a game gets from the engine's package.json: all its scripts but `e2e`, since no
 * browser specs ship, and all its dependencies, devDependencies and allowScripts.
 */
export function engineNpm(engine) {
  const { e2e: _e2e, ...scripts } = engine.scripts ?? {};
  const { dependencies = {}, devDependencies = {}, allowScripts = {} } = engine;
  return { scripts, dependencies, devDependencies, allowScripts };
}

/** The entries of `previous` (a game's package.json) in `field` that `before` (its lock's `npm`) does not name. */
function ownEntries(previous, before, field) {
  return Object.entries(previous[field] ?? {}).filter(([key]) => !(key in (before[field] ?? {})));
}

/**
 * A game's package.json: the engine's pins and scripts. With `previous` (the game's) and `before` (the engine's
 * entries the game had, its lock's `npm`), the game keeps its own fields and the entries the engine it had did not
 * give it, the new engine's entries replace the rest, and those it dropped go. Where an entry of the game's own has
 * the new engine's key, the engine's wins: `updateGame` stops on one first (`npmClashes`), unless forced.
 */
export function gamePackage(engine, name, previous, before = {}) {
  const npm = engineNpm(engine);
  const { scripts, dependencies, devDependencies, allowScripts } = npm;
  if (!previous) {
    const description = 'A game made with the my-3dge engine.';
    return { name, version: '0.0.0', private: true, description, type: 'module', engines: engine.engines, scripts, dependencies, devDependencies, allowScripts }; // prettier-ignore
  }
  const merged = Object.fromEntries(
    NPM_FIELDS.map((field) => [field, { ...Object.fromEntries(ownEntries(previous, before, field)), ...npm[field] }]),
  );
  return { ...previous, engines: engine.engines, ...merged };
}

/**
 * The game's own package.json entries (in `previous`, not named by `before`, its lock's `npm`) that the engine's
 * package.json sets otherwise, as `field.key`: what an update would replace.
 */
export function npmClashes(previous, engine, before = {}) {
  const npm = engineNpm(engine);
  return NPM_FIELDS.flatMap((field) =>
    ownEntries(previous, before, field)
      .filter(([key, value]) => key in npm[field] && JSON.stringify(npm[field][key]) !== JSON.stringify(value))
      .map(([key]) => `${field}.${key}`),
  );
}

/**
 * The entries of `previous` (a game's package.json) that `next` (what an update writes) drops, or sets back to the
 * engine's where the game had edited one the engine gave (`before`, its lock's `npm`), as `field.key`: what an update
 * names, since the engine's entries win.
 */
export function npmLost(previous, next, before = {}) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  return NPM_FIELDS.flatMap((field) =>
    Object.entries(previous[field] ?? {})
      .filter(([key, value]) => {
        const [now, given] = [next[field]?.[key], before[field]?.[key]];
        return now === undefined || (given !== undefined && !same(given, value) && !same(now, value));
      })
      .map(([key]) => `${field}.${key}`),
  );
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
export function sameDependencies(pkg, engine) {
  const same = (a = {}, b = {}) =>
    JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
  return same(pkg.dependencies, engine.dependencies) && same(pkg.devDependencies, engine.devDependencies);
}

/**
 * The lock for the engine files of `items` (hashed from the source), with the engine's identity, the package.json
 * entries the game got from it, and the root files written from its templates (`templates`: path → hash or null).
 */
export function lockFor(source, items, identity, game, engine, templates = {}) {
  const files = Object.fromEntries(items.map(({ from, to }) => [to, hashFile(join(source, from))]));
  return { format: LOCK_FORMAT, game, engine: identity, npm: engineNpm(engine), templates, files };
}

/** The engine's folders in a game: a file there that the lock does not name was added by the game. */
export const ENGINE_DIRS = Object.freeze(['engine/', 'tools/', 'data/', 'labs/box/']);

/** The files under the engine's folders in a game (`ENGINE_DIRS`), with `/`. */
function engineDirFiles(target) {
  const files = [];
  const walk = (dir) => {
    if (!existsSync(join(target, dir))) return;
    for (const entry of readdirSync(join(target, dir), { withFileTypes: true })) {
      const path = `${dir}${entry.name}`;
      if (entry.isDirectory()) walk(`${path}/`);
      else if (entry.isFile() && entry.name !== '.DS_Store') files.push(path);
    }
  };
  ENGINE_DIRS.forEach(walk);
  return files;
}

/** The engine files ENGINE-FEEDBACK.md lists under "Local engine patches", outside comments. */
export function declaredPatches(target) {
  const file = join(target, FEEDBACK_FILE);
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const section = /^## Local engine patches\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text)?.[1] ?? '';
  return [...section.matchAll(/^\s*[-*]\s+`([^`]+)`/gm)].map((match) => match[1]);
}

/**
 * Compares a game's engine files with its lock: those changed, those missing, files the game added in the engine's
 * folders, and the patches it declares; `undeclared` is every one of the first three that the game does not declare.
 */
export function verifyGame(target) {
  const lockFile = join(target, LOCK_FILE);
  if (!existsSync(lockFile)) {
    throw new Error(`${resolve(target)} has no ${LOCK_FILE}: it is no game made by tools/game/new-game.mjs`);
  }
  const restore = `restore it from git (git checkout -- ${LOCK_FILE}; in a merge, take one side whole): only new-game.mjs writes it`; // prettier-ignore
  let lock;
  try {
    lock = JSON.parse(readFileSync(lockFile, 'utf8'));
  } catch (error) {
    throw new Error(`${LOCK_FILE} is not JSON (${error.message}): ${restore}`);
  }
  if (typeof lock?.format !== 'string') throw new Error(`${LOCK_FILE} has no "format": ${restore}`);
  if (lock.format !== LOCK_FORMAT) {
    throw new Error(`${LOCK_FILE} says "${lock.format}", not ${LOCK_FORMAT}: move the game to a newer engine`);
  }
  if (
    typeof lock.files !== 'object' ||
    lock.files === null ||
    Array.isArray(lock.files) ||
    typeof lock.engine?.commit !== 'string'
  ) {
    throw new Error(`${LOCK_FILE} lacks its engine or its files: ${restore}`);
  }
  const [changed, missing] = [[], []];
  for (const [path, hash] of Object.entries(lock.files)) {
    const file = join(target, path);
    if (!existsSync(file)) missing.push(path);
    else if (hashFile(file) !== hash) changed.push(path);
  }
  const added = engineDirFiles(target).filter((path) => !(path in lock.files));
  const declared = declaredPatches(target);
  const undeclared = [...changed, ...missing, ...added].filter((path) => !declared.includes(path));
  return { lock, changed, missing, added, declared, undeclared };
}
