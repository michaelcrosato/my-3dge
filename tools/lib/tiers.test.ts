/**
 * @file Unit tests for the test tiers (tools/lib/tiers.ts). In a temporary git repository: the base (none, the last
 * green run, then the merge-base once origin/main holds a gate), the changes, a change to `engine/core/a.ts` selecting
 * every Vitest test that imports it directly or not (run for real), page code running T2 in full, and a version bump
 * selecting nothing. Then the budgets over JSON reports (over warns, 1.5× fails) and the timing table.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  changedFiles,
  checkBudget,
  checkReports,
  duration,
  findBase,
  isVersionOnly,
  plan,
  recordGreen,
  reportMs,
  selectT1,
  selectT2,
  timingTable,
  TIERS,
  vitestRerunTriggers,
} from './tiers';

const ROOT = join(import.meta.dirname, '..', '..');

/** The ledger rows a PLAN.md needs for the gate check, with G0's status. */
const ledger = (status: string) =>
  `# Plan\n\n| WP | Title | Lane | Status | Commit | Notes |\n|---|---|---|---|---|---|\n` +
  `| 0.1 | Repo | T | done | | |\n| **G0** | **Gate: foundation** | | ${status} | | |\n`;

/** The temporary repository: engine/core/{a,b}.ts, three tests, a page, a spec helper; `git` runs in it. */
let repo: string;
const git = (...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo, encoding: 'utf8' }).trim();
const write = (file: string, content: string) => {
  mkdirSync(dirname(join(repo, file)), { recursive: true });
  writeFileSync(join(repo, file), content);
};
const PACKAGE = (version: string, three = '0.182.0') =>
  JSON.stringify({ name: 'fixture', version, private: true, type: 'module', dependencies: { three } }, null, 2) + '\n';

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'x-tiers-'));
  symlinkSync(join(ROOT, 'node_modules'), join(repo, 'node_modules'));
  git('init', '--quiet', '-b', 'main');
  write('.gitignore', 'node_modules\nout/\n');
  write('package.json', PACKAGE('1.0.0'));
  write('PLAN.md', ledger('todo'));
  write('vitest.config.ts', "export default { test: { include: ['**/*.test.ts'], exclude: ['node_modules/**'] } };\n");
  write('engine/core/a.ts', 'export const a = 1;\n');
  write('engine/core/b.ts', "import { a } from './a';\nexport const b = a + 1;\n");
  const test = (name: string, body: string) =>
    `import { expect, test } from 'vitest';\n${body}\ntest('${name}', () => {\n  expect(1).toBe(1);\n});\n`;
  write('engine/core/a.test.ts', test('a', "import { a } from './a';\nvoid a;"));
  write('engine/core/b.test.ts', test('b', "import { b } from './b';\nvoid b;"));
  write('engine/core/c.test.ts', test('c', ''));
  write('tests/pages/demo.html', '<!doctype html><title>demo</title>\n');
  write('tests/e2e/helpers.ts', 'export const helper = 1;\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'one');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
});
afterAll(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

describe('the base, the changes and the selections, in a temporary repository', () => {
  it('has no base before a gate or a green run, and then runs every tier in full', () => {
    const { base, changes, t1, t2 } = plan(repo);
    expect(base.from).toBe('none');
    expect(base.sha).toBeUndefined();
    expect(base.reason).toBe(
      'no base: origin/main holds no gate yet and out/ci/last-green is missing, so every tier runs in full',
    );
    expect(changes).toBeUndefined();
    expect([t1.mode, t1.command, t2.mode, t2.command]).toEqual(['all', ['npm', 'test'], 'all', ['npm', 'run', 'e2e']]);
  });

  it('takes the last green x ci --local until origin/main holds a gate', () => {
    const head = git('rev-parse', 'HEAD');
    recordGreen(head, repo);
    expect(readFileSync(join(repo, 'out/ci/last-green'), 'utf8')).toBe(`${head}\n`);
    expect(findBase(repo)).toMatchObject({ sha: head, from: 'last-green' });
    writeFileSync(join(repo, 'out/ci/last-green'), 'deadbeef\n');
    expect(findBase(repo).reason).toContain('names an unknown commit (deadbeef)');
  });

  it('takes the merge-base with origin/main once its ledger marks a gate done', () => {
    write('PLAN.md', ledger('done'));
    git('commit', '--quiet', '-am', 'G0 done');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    const gate = git('rev-parse', 'HEAD');
    git('checkout', '--quiet', '-b', 'work');
    write('engine/core/c.test.ts', readFileSync(join(repo, 'engine/core/c.test.ts'), 'utf8') + '// later\n');
    git('commit', '--quiet', '-am', 'on the branch');
    const base = findBase(repo);
    expect(base).toMatchObject({ sha: gate, from: 'origin/main' });
    expect(base.reason).toBe(`the merge-base with origin/main (${gate.slice(0, 7)}), which holds G0`);
    git('reset', '--quiet', '--hard', gate);
  });

  it('selects every Vitest test that imports a changed engine/core/a.ts, directly or not, and runs T2 in full', () => {
    write('engine/core/a.ts', 'export const a = 2;\n');
    const { base, changes, t1, t2 } = plan(repo);
    expect(changes).toEqual({ base: base.sha, files: ['engine/core/a.ts'], versionOnly: [] });
    expect(t1).toMatchObject({
      mode: 'some',
      reason: "T1 runs the tests that import engine/core/a.ts, directly or not (Vite's module graph)",
    });
    expect(t1.command).toEqual(['npx', 'vitest', 'related', '--run', '--passWithNoTests', 'engine/core/a.ts']);
    const report = join(repo, 'out', 'related.json');
    const run = spawnSync(t1.command[0], [...t1.command.slice(1), '--reporter=json', `--outputFile=${report}`], {
      cwd: repo,
      encoding: 'utf8',
    });
    expect(run.status, run.stdout + run.stderr).toBe(0);
    const ran = (JSON.parse(readFileSync(report, 'utf8')) as { testResults: { name: string }[] }).testResults
      .map((result) => result.name.slice(repo.length + 1))
      .sort();
    expect(ran).toEqual(['engine/core/a.test.ts', 'engine/core/b.test.ts']);
    expect(t2).toMatchObject({ mode: 'all', command: ['npm', 'run', 'e2e'] });
    expect(t2.reason).toBe(
      "T2 runs in full: engine/core/a.ts changed (engine code, which pages load through the dev server, not through the specs' imports)",
    );
    git('checkout', '--quiet', '--', '.');
  });

  it('runs T2 in full for page code, and only the changed specs for a spec helper', () => {
    write('tests/pages/demo.html', '<!doctype html><title>changed</title>\n');
    expect(plan(repo).t2.reason).toMatch(/^T2 runs in full: tests\/pages\/demo\.html changed \(page code/);
    git('checkout', '--quiet', '--', '.');
    write('tests/e2e/helpers.ts', 'export const helper = 2;\n');
    write('tests/e2e/new.spec.ts', 'export {};\n');
    const { base, t2 } = plan(repo);
    expect(t2.mode).toBe('some');
    expect(t2.command).toEqual(['npm', 'run', 'e2e', '--', `--only-changed=${base.sha}`, '--pass-with-no-tests']);
    expect(t2.reason).toBe(
      "T2 runs the specs that import tests/e2e/helpers.ts, tests/e2e/new.spec.ts, directly or not (Playwright's --only-changed)",
    );
    git('checkout', '--quiet', '--', '.');
    rmSync(join(repo, 'tests/e2e/new.spec.ts'));
  });

  it('selects nothing for a commit that changes only the version, and everything for a new dependency', () => {
    write('package.json', PACKAGE('1.1.0'));
    git('commit', '--quiet', '-am', 'v1.1.0');
    const { changes, t1, t2 } = plan(repo);
    expect(changes).toMatchObject({ files: [], versionOnly: ['package.json'] });
    expect([t1.mode, t2.mode]).toEqual(['none', 'none']);
    expect(t1.reason).toMatch(
      /^T1 selects nothing: nothing changed since [0-9a-f]{7} but the version in package\.json$/,
    );
    write('package.json', PACKAGE('1.1.0', '0.183.0'));
    expect(plan(repo).t1.reason).toBe('T1 runs in full: package.json changed (the dependencies and scripts)');
    git('reset', '--quiet', '--hard', 'HEAD~1');
  });

  it('counts untracked, staged and deleted files as changed', () => {
    const base = git('rev-parse', 'HEAD');
    write('docs/new.md', 'new\n');
    write('engine/core/b.ts', 'export const b = 3;\n');
    git('add', 'engine/core/b.ts');
    rmSync(join(repo, 'engine/core/c.test.ts'));
    expect(changedFiles(base, repo).files).toEqual(['docs/new.md', 'engine/core/b.ts', 'engine/core/c.test.ts']);
    git('reset', '--quiet', '--hard', base);
    rmSync(join(repo, 'docs'), { recursive: true });
  });
});

describe('isVersionOnly', () => {
  const diff = (...lines: string[]) =>
    [
      'diff --git a/package.json b/package.json',
      '--- a/package.json',
      '+++ b/package.json',
      '@@ -3 +3 @@',
      ...lines,
    ].join('\n');

  it('is true when only "version" lines changed, as in package.json and package-lock.json after a bump', () => {
    expect(isVersionOnly(diff('-  "version": "0.1.0",', '+  "version": "0.2.0",'))).toBe(true);
    expect(
      isVersionOnly(
        diff(
          '-  "version": "0.1.0",',
          '+  "version": "0.2.0",',
          '@@ -9 +9 @@',
          '-      "version": "0.1.0",',
          '+      "version": "0.2.0",',
        ),
      ),
    ).toBe(true);
  });

  it('is false for any other change, an unbalanced one, or none', () => {
    expect(isVersionOnly(diff('-    "three": "0.182.0"', '+    "three": "0.183.0"'))).toBe(false);
    expect(isVersionOnly(diff('-  "version": "0.1.0",', '+  "version": "0.2.0",', '+  "x": 1,'))).toBe(false);
    expect(isVersionOnly(diff('+  "version": "0.2.0",'))).toBe(false);
    expect(isVersionOnly('')).toBe(false);
  });
});

describe('selections without git', () => {
  const changes = (...files: string[]) => ({ base: 'abcdef0123', files, versionOnly: [] });

  it("runs T1 in full on what every test depends on, in step with Vitest's forceRerunTriggers", () => {
    for (const file of [
      'vite.config.ts',
      'tests/setup/adviceTrap.ts',
      'tests/baselines/advice/gfx.json',
      'package-lock.json',
    ]) {
      expect(selectT1(changes('docs/x.md', file))).toMatchObject({ mode: 'all', command: ['npm', 'test'] });
    }
    expect(selectT1(changes('docs/x.md')).mode).toBe('some');
    expect(vitestRerunTriggers()).toContain('**/tests/setup/**');
    expect(vitestRerunTriggers()).toContain('**/vite.config.ts');
  });

  it('runs T2 in full on engine, lab, page and fixture code, and while the last full run is within budget', () => {
    for (const file of [
      'labs/box/main.ts',
      'index.html',
      'fixtures/scenes/a.ts',
      'data/x.json',
      'playwright.config.ts',
      'tests/setup/fixtures/advice.pw.ts',
      'tsconfig.base.json',
    ]) {
      expect(selectT2(changes(file)).mode).toBe('all');
    }
    expect(selectT2(changes('tools/cmd/qa.ts')).mode).toBe('some');
    expect(selectT2(changes('tools/cmd/qa.ts'), { lastFullMs: 200_000 })).toMatchObject({
      mode: 'all',
      reason: 'T2 runs in full: its full set last took 3 min 20 s, within its budget (§8.9)',
    });
    expect(selectT2(changes('tools/cmd/qa.ts'), { lastFullMs: 400_000 }).mode).toBe('some');
  });
});

describe('budgets', () => {
  it('warns over the budget and fails at 1.5× it', () => {
    expect(checkBudget('T1', 60_000)).toMatchObject({ status: 'ok', message: 'T1 took 60 s, within its 60 s budget' });
    expect(checkBudget('T1', 61_000).status).toBe('warn');
    expect(checkBudget('T1', 89_999).status).toBe('warn');
    expect(checkBudget('T1', 90_000).status).toBe('fail');
    expect(checkBudget('T0', 12_000).message).toBe(
      `T0 took 12 s, over its 10 s budget (it fails at 15 s): ${TIERS.T0.fix}`,
    );
    expect(checkBudget('T2', 540_000).message).toBe(`T2 took 9 min, at least 1.5× its 6 min budget: ${TIERS.T2.fix}`);
  });

  it('reads the durations of Vitest and Playwright JSON reports: over budget warns, at 1.5× fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'x-budget-'));
    try {
      mkdirSync(join(root, 'out/test'), { recursive: true });
      mkdirSync(join(root, 'out/e2e'), { recursive: true });
      const vitest = { startTime: 1_000, success: true, testResults: [{ endTime: 30_000 }, { endTime: 71_000 }] };
      writeFileSync(join(root, 'out/test/report.json'), JSON.stringify(vitest));
      writeFileSync(join(root, 'out/e2e/report.json'), JSON.stringify({ suites: [], stats: { duration: 540_000 } }));
      expect(reportMs(join(root, 'out/test/report.json'))).toBe(70_000);
      const checks = checkReports(root, { T0: 4_000 });
      expect(checks.map(({ tier, ms, status }) => [tier, ms, status])).toEqual([
        ['T0', 4_000, 'ok'],
        ['T1', 70_000, 'warn'],
        ['T2', 540_000, 'fail'],
      ]);
      expect(checkReports(root, { T1: 1_000 }).map((check) => check.status)).toEqual(['ok', 'fail']);
      writeFileSync(join(root, 'out/test/report.json'), '{"x":1}');
      expect(() => reportMs(join(root, 'out/test/report.json'))).toThrow(
        /neither a Vitest nor a Playwright JSON report/,
      );
      rmSync(join(root, 'out'), { recursive: true });
      expect(checkReports(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('the timing table', () => {
  it('lists each step with its verdict, duration and budget, then the total', () => {
    expect(
      timingTable([
        { name: 'npm run check', ms: 4_100, ok: true, budgetMs: 10_000 },
        { name: 'npm test', ms: 72_000, ok: false, budgetMs: 60_000 },
        { name: 'x src', ms: 300, ok: true },
      ]),
    ).toEqual([
      'ok    npm run check  4.1 s / 10 s',
      'FAIL  npm test       1 min 12 s / 60 s (over budget)',
      'ok    x src          0.3 s',
      'FAILED: npm test (1 min 16 s in all)',
    ]);
    expect(timingTable([{ name: 'a', ms: 1_000, ok: true }]).at(-1)).toBe('all passed in 1 s');
    expect([duration(59_950), duration(60_000), duration(120_000), duration(125_000)]).toEqual([
      '60.0 s',
      '60 s',
      '2 min',
      '2 min 5 s',
    ]);
  });
});
