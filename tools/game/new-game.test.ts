/**
 * @file Unit tests for making and updating games (tools/game/new-game.mjs, tools/game/files.mjs; PLAN.md WP 10.7):
 * every file of this repository has an owner, a game gets the engine without its tests, plan or records, a new game is
 * pinned by its lock and nothing in its way is overwritten, the lock catches an edited engine file unless the game
 * declares the patch, and an update replaces the engine's files while it keeps the game's. Most cases make games from
 * small fake engines in temporary folders; one makes a real game from this checkout. That the real game passes its own
 * gate (npm ci, check, test, x sim, x replay, x shot) is `node x engine --test`, in the full run.
 * @see tools/game/new-game.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { declaredPatches, engineIdentity, ownerOf, plan, SOURCE, sourceFiles, verifyGame } from './files.mjs';
import { createGame, gameLockfile, gameName, gamePackage, main, render, TEMPLATES, updateGame } from './new-game.mjs';

const folders: string[] = [];
afterAll(() => folders.forEach((folder) => rmSync(folder, { recursive: true, force: true })));

/** A fresh temporary folder, removed after the tests. */
function folder(): string {
  const made = mkdtempSync(join(tmpdir(), 'new-game-test-'));
  folders.push(made);
  return made;
}

/** Writes `files` (path → text) under `root`. */
function write(root: string, files: Record<string, string>): string {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

/** The templates, as this checkout has them, keyed by their path in an engine. */
const templates = Object.fromEntries(
  TEMPLATES.map(([template]) => [
    `tools/game/template/${template}`,
    readFileSync(join(SOURCE, 'tools/game/template', template), 'utf8'),
  ]),
);

/** A small engine, no git checkout: what new-game.mjs reads of one, `files` over it. */
function fakeEngine(files: Record<string, string> = {}, commit = 'a'.repeat(40)): string {
  const dependencies = { three: '0.182.0' };
  const pkg = { name: 'my-3dge', version: '0.0.0', scripts: { test: 'vitest run', e2e: 'playwright test' }, dependencies }; // prettier-ignore
  const lock = { name: 'my-3dge', lockfileVersion: 3, packages: { '': { name: 'my-3dge', license: 'MIT', dependencies } } }; // prettier-ignore
  return write(folder(), {
    ...templates,
    'tools/game/engine-version.txt': `${commit} 2026-10-15T00:00:00Z\n`,
    'package.json': JSON.stringify(pkg),
    'package-lock.json': JSON.stringify(lock),
    LICENSE: 'MIT\n',
    'PLAN.md': '# The plan\n',
    'engine/a.ts': 'export const a = 1;\n',
    'engine/b.ts': 'export const b = 1;\n',
    'engine/a.test.ts': 'test\n',
    'labs/game/scenes/play.ts': 'export const play = 1;\n',
    ...files,
  });
}

/** Reads a game's file. */
const read = (root: string, path: string) => readFileSync(join(root, path), 'utf8');

describe('what a game gets from this repository', () => {
  it('names an owner for every file, so a new one at the root is a decision', () => {
    const unnamed = sourceFiles(SOURCE).filter((path) => ownerOf(path) === null);
    expect(unnamed, 'add each to RULES in tools/game/files.mjs').toEqual([]);
  });

  it('is the engine, its tools, data, the box and the docs a game reads; never its tests, plan or records', () => {
    const items = plan(SOURCE);
    const to = new Set(items.map((item) => item.to));
    for (const path of [
      'engine/index.ts',
      'engine/sim-api.ts',
      'tools/x.ts',
      'x.js',
      'labs/box/main.ts',
      'scripts/setup.sh',
      'docs/GAME-GUIDE.md',
      'docs/API.md',
      'docs/ERRORS.md',
      'tests/setup/adviceTrap.ts',
      'tests/pages/replay.ts',
      'engine/LICENSE',
      'DOCTRINE.md',
    ]) {
      // prettier-ignore
      expect(to.has(path), path).toBe(true);
    }
    for (const path of items.filter((item) => item.owner === 'engine').map((item) => item.to)) {
      expect(path, path).not.toMatch(/\.test\.ts$|^(PLAN\.md|AGENTS\.md|CLAUDE\.md|README\.md|fixtures\/|\.github\/|labs\/hello\/|docs\/(PROGRESS|HANDOFF|decisions|research))/); // prettier-ignore
    }
    expect(items.filter((item) => item.owner === 'game').every((item) => item.from.startsWith('labs/game/'))).toBe(
      true,
    );
  });
});

describe('createGame', () => {
  it('makes a game from this checkout: the engine pinned by its lock, the starter, the game’s files rendered', () => {
    const target = join(folder(), 'Dragon Run');
    const made = createGame({ target, git: false });
    expect(made).toMatchObject({ name: 'dragon-run', starterFiles: expect.any(Number), kept: [], initialized: false });
    expect(made.engineFiles).toBeGreaterThan(1000);
    expect(verifyGame(target)).toMatchObject({ changed: [], missing: [], undeclared: [] });
    for (const [, to] of TEMPLATES) expect(read(target, to), to).not.toMatch(/\{\{/);
    expect(read(target, 'AGENTS.md')).toContain('# AGENTS.md: dragon-run');
    expect(read(target, 'CLAUDE.md')).toMatch(/^@AGENTS\.md/);
    expect(existsSync(join(target, 'labs/game/scenes/play.test.ts'))).toBe(true);
    expect(existsSync(join(target, 'PLAN.md'))).toBe(false);
    const pkg = JSON.parse(read(target, 'package.json'));
    const engine = JSON.parse(read(SOURCE, 'package.json'));
    expect(pkg).toMatchObject({ name: 'dragon-run', private: true, dependencies: engine.dependencies });
    expect(pkg.devDependencies).toEqual(engine.devDependencies);
    expect(pkg.scripts.e2e).toBeUndefined();
    const lockfile = JSON.parse(read(target, 'package-lock.json'));
    expect([lockfile.name, lockfile.packages[''].name, lockfile.packages[''].license]).toEqual(['dragon-run', 'dragon-run', undefined]); // prettier-ignore
  });

  it('keeps a README, LICENSE and .gitignore already there, adds what they lack, puts its AGENTS.md after theirs', () => {
    const target = write(folder(), {
      'README.md': '# Mine\n',
      LICENSE: 'Mine\n',
      '.gitignore': 'secrets/\nout/\n',
      'AGENTS.md': '# The owner’s rules\n',
    });
    const made = createGame({ target, name: 'mine', source: fakeEngine() });
    expect(made.kept).toEqual(['README.md']);
    expect([read(target, 'README.md'), read(target, 'LICENSE')]).toEqual(['# Mine\n', 'Mine\n']);
    expect(read(target, '.gitignore')).toMatch(/^secrets\/\nout\/\ndist\//);
    expect(read(target, '.gitignore').match(/^out\/$/gm)).toHaveLength(1);
    expect(read(target, 'engine/LICENSE')).toBe('MIT\n');
    expect(read(target, 'AGENTS.md')).toMatch(/^# The owner’s rules\n\n# AGENTS\.md: mine\n/);
    expect(made.initialized).toBe(existsSync(join(target, '.git')));
  });

  it('stops before writing anything when a file it would write is in the way', () => {
    const target = write(folder(), { 'package.json': '{}', 'engine/a.ts': 'mine' });
    expect(() => createGame({ target, source: fakeEngine() })).toThrow(/already holds engine\/a\.ts, package\.json/);
    expect([existsSync(join(target, 'AGENTS.md')), read(target, 'engine/a.ts')]).toEqual([false, 'mine']);
  });

  it('names games as npm names them, and refuses a name it cannot use', () => {
    expect(gameName('/tmp/Dragon Run!')).toBe('dragon-run');
    expect(gameName('/tmp/x', 'my.game_2')).toBe('my.game_2');
    expect(() => gameName('/tmp/x', 'Bad Name')).toThrow(/cannot name a game/);
    expect(() => gameName('/tmp/!!!')).toThrow(/give --name/);
  });

  it('fills the templates’ placeholders and refuses one it has no value for', () => {
    expect(render('# {{name}} at {{engine.short}}', { name: 'g', 'engine.short': 'abc1234' })).toBe('# g at abc1234');
    expect(() => render('{{nope}}', { name: 'g' })).toThrow(/\{\{nope\}\} has no value/);
  });
});

describe('the lock', () => {
  it('finds a changed or missing engine file, and lets a declared patch pass', () => {
    const target = folder();
    createGame({ target, name: 'g', source: fakeEngine(), git: false });
    writeFileSync(join(target, 'engine/a.ts'), 'export const a = 2;\n');
    rmSync(join(target, 'engine/b.ts'));
    expect(verifyGame(target)).toMatchObject({ changed: ['engine/a.ts'], missing: ['engine/b.ts'], undeclared: ['engine/a.ts', 'engine/b.ts'] }); // prettier-ignore
    const feedback = read(target, 'ENGINE-FEEDBACK.md');
    writeFileSync(join(target, 'ENGINE-FEEDBACK.md'), `${feedback}\n- \`engine/a.ts\`: the fix the engine needs.\n`);
    expect(verifyGame(target)).toMatchObject({ declared: ['engine/a.ts'], undeclared: ['engine/b.ts'] });
  });

  it('reads declared patches only from their section, outside comments', () => {
    const target = write(folder(), {
      'ENGINE-FEEDBACK.md': '## Requests\n- `engine/x.ts`: not a patch\n## Local engine patches\n<!-- - `engine/y.ts` -->\n- `engine/z.ts`: why\n', // prettier-ignore
    });
    expect(declaredPatches(target)).toEqual(['engine/z.ts']);
  });

  it('records the engine’s commit from git, or from an archive’s stamp', () => {
    expect(engineIdentity(fakeEngine({}, 'b'.repeat(40)))).toMatchObject({ commit: 'b'.repeat(40), date: '2026-10-15T00:00:00Z' }); // prettier-ignore
    const head = execFileSync('git', ['-C', SOURCE, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    expect(engineIdentity(SOURCE).commit).toBe(head);
  });
});

describe('updateGame', () => {
  it('replaces, adds and removes the engine’s files, keeps the game’s and its declared patches', () => {
    const target = folder();
    createGame({ target, name: 'g', source: fakeEngine({ 'engine/c.ts': 'c\n' }), git: false });
    writeFileSync(join(target, 'labs/game/scenes/play.ts'), 'the game’s own\n');
    writeFileSync(join(target, 'engine/c.ts'), 'patched\n');
    writeFileSync(join(target, 'ENGINE-FEEDBACK.md'), '## Local engine patches\n- `engine/c.ts`: why\n');
    const pkg = JSON.parse(read(target, 'package.json'));
    writeFileSync(join(target, 'package.json'), JSON.stringify({ ...pkg, dependencies: { ...pkg.dependencies, howler: '2.2.4' } })); // prettier-ignore
    const next = fakeEngine({ 'engine/a.ts': 'export const a = 3;\n', 'engine/b.ts': '', 'engine/d.ts': 'd\n' }, 'c'.repeat(40)); // prettier-ignore
    rmSync(join(next, 'engine/b.ts'));
    const done = updateGame({ target, source: next });
    expect(done).toMatchObject({ added: ['engine/d.ts'], removed: ['engine/b.ts'], replaced: ['engine/a.ts', 'tools/game/engine-version.txt'], kept: ['engine/c.ts'], lockfileFits: false }); // prettier-ignore
    expect([read(target, 'engine/a.ts'), read(target, 'engine/c.ts'), read(target, 'labs/game/scenes/play.ts')]).toEqual(['export const a = 3;\n', 'patched\n', 'the game’s own\n']); // prettier-ignore
    expect(existsSync(join(target, 'engine/b.ts'))).toBe(false);
    expect(JSON.parse(read(target, 'package.json')).dependencies).toEqual({ howler: '2.2.4', three: '0.182.0' });
    expect(verifyGame(target)).toMatchObject({ lock: { engine: { commit: 'c'.repeat(40) } }, undeclared: [] });
  });

  it('stops on an engine file the game changed without declaring it, unless forced', () => {
    const target = folder();
    createGame({ target, name: 'g', source: fakeEngine(), git: false });
    writeFileSync(join(target, 'engine/a.ts'), 'mine\n');
    expect(() => updateGame({ target, source: fakeEngine() })).toThrow(/does not declare: engine\/a\.ts/);
    expect(updateGame({ target, source: fakeEngine(), force: true }).kept).toEqual([]);
    expect(read(target, 'engine/a.ts')).toBe('export const a = 1;\n');
  });

  it('moves package.json to the engine’s pins and keeps the game’s own scripts and dependencies', () => {
    const engine = { name: 'my-3dge', scripts: { test: 'vitest run', e2e: 'x' }, dependencies: { three: '2' } };
    const previous = { name: 'g', scripts: { test: 'old', play: 'vite' }, dependencies: { three: '1', howler: '2' } };
    expect(gamePackage(engine, 'g', previous, { dependencies: { three: '1' } })).toMatchObject({
      name: 'g',
      scripts: { play: 'vite', test: 'vitest run' },
      dependencies: { howler: '2', three: '2' },
    });
    expect(gameLockfile({ name: 'my-3dge', packages: { '': { name: 'my-3dge', license: 'MIT' } } }, 'g')).toEqual({ name: 'g', packages: { '': { name: 'g', version: '0.0.0' } } }); // prettier-ignore
  });
});

describe('the command line', () => {
  it('exits 2 on a usage error, 0 with --help, 1 when it stops', () => {
    const lines: string[] = [];
    const say = (line: string) => lines.push(line);
    expect(main([], say, say)).toBe(2);
    expect(main(['a', 'b'], say, say)).toBe(2);
    expect(main(['a', '--nope'], say, say)).toBe(2);
    expect(main(['--help'], say, say)).toBe(0);
    expect(main(['--update', folder()], say, say)).toBe(1);
    expect(lines.at(-1)).toMatch(/has no engine-lock\.json/);
  });
});
