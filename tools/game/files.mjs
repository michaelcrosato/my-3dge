/**
 * @file What a game made from the engine holds, and the lock that pins it (PLAN.md WP 10.7, ADR-0024): which of the
 * engine's files a game gets and as whose (`RULES`, `ownerOf`, `plan`), the engine's identity (`engineIdentity`), and
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
 * Invariants: lists use `/` and are sorted; the lock's `files` are the game's paths; a declared patch is a path in
 * backticks at the start of a list item under ENGINE-FEEDBACK.md's "## Local engine patches", outside comments.
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

/** The engine's own, at its root: its plan, records, CI, deployment, test suites and fixtures. */
const ENGINE_ONLY =
  /^(PLAN\.md|AGENTS\.md|CLAUDE\.md|README\.md|index\.html|package(-lock)?\.json|playwright\.config\.ts|vercel\.json|\.vercelignore|\.gitignore|\.gitattributes|\.github\/|\.claude\/|fixtures\/|tests\/|docs\/|scripts\/|labs\/hello\/)/;

/** Which source files a game gets, and as whose: the first rule whose `test` matches a path decides (`ownerOf`). */
export const RULES = Object.freeze([
  { owner: 'game', why: 'the starter game: the game’s own once copied', test: (p) => p.startsWith(STARTER) },
  { owner: 'skip', why: 'the engine’s tests stay in its repository', test: (p) => p.endsWith('.test.ts') },
  { owner: 'engine', why: 'the engine, its tools and data', test: (p) => /^(engine|tools|data)\//.test(p) },
  { owner: 'engine', why: 'the box: the engine’s worked example', test: (p) => p.startsWith('labs/box/') },
  { owner: 'engine', why: 'the advice trap’s allow list', test: (p) => p.startsWith('tests/baselines/advice/') },
  { owner: 'engine', why: 'a skill games use', test: (p) => p.startsWith('.claude/skills/determinism-debugging/') },
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

/** A file's SHA-256, as the lock writes it. */
export function hashFile(file) {
  return `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}`;
}

/** What a game gets from `source`: each file to copy, from its source path to its path in the game, and whose it is. */
export function plan(source = SOURCE) {
  return sourceFiles(source)
    .map((from) => ({ from, to: RENAMED[from] ?? from, owner: ownerOf(from) }))
    .filter((item) => item.owner === 'engine' || item.owner === 'game');
}

/** The lock for the engine files of `items` (hashed from the source), with the engine's identity and npm pins. */
export function lockFor(source, items, identity, game, engine) {
  const files = Object.fromEntries(items.map(({ from, to }) => [to, hashFile(join(source, from))]));
  const npm = { dependencies: engine.dependencies, devDependencies: engine.devDependencies };
  return { format: LOCK_FORMAT, game, engine: identity, npm, files };
}

/** The engine files ENGINE-FEEDBACK.md lists under "Local engine patches", outside comments. */
export function declaredPatches(target) {
  const file = join(target, FEEDBACK_FILE);
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const section = /^## Local engine patches\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text)?.[1] ?? '';
  return [...section.matchAll(/^\s*[-*]\s+`([^`]+)`/gm)].map((match) => match[1]);
}

/** Compares a game's engine files with its lock: those changed, those missing, and the patches it declares. */
export function verifyGame(target) {
  const lockFile = join(target, LOCK_FILE);
  if (!existsSync(lockFile)) {
    throw new Error(`${resolve(target)} has no ${LOCK_FILE}: it is no game made by tools/game/new-game.mjs`);
  }
  const lock = JSON.parse(readFileSync(lockFile, 'utf8'));
  if (lock.format !== LOCK_FORMAT) {
    throw new Error(`${LOCK_FILE} says "${lock.format}", not ${LOCK_FORMAT}: move the game to a newer engine`);
  }
  const [changed, missing] = [[], []];
  for (const [path, hash] of Object.entries(lock.files)) {
    const file = join(target, path);
    if (!existsSync(file)) missing.push(path);
    else if (hashFile(file) !== hash) changed.push(path);
  }
  const declared = declaredPatches(target);
  const undeclared = [...changed, ...missing].filter((path) => !declared.includes(path));
  return { lock, changed, missing, declared, undeclared };
}
