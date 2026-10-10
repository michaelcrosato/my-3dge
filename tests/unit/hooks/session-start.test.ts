/**
 * @file The SessionStart hook (.claude/hooks/session-start.sh, WP 0.10), run on a fixture environment: a fixture
 * project holding the real scripts/setup.sh, a fresh $HOME, a fixture $CLAUDE_ENV_FILE, and `npm` and `curl` stubs
 * that record their calls. Its `x.js` runs the real dispatcher with the real `src` and `esc` commands on the fixture,
 * and a `deps` stub instead of the registry.
 *
 * Proves: with Node 24 active it installs nothing (no download, nothing in ~/.cache/my3dge), runs setup.sh (npm ci)
 * and keeps node_modules/.cache across it, writes the PATH, MY3D2DGE_SRC and SHARDFALL_SRC lines to $CLAUDE_ENV_FILE once each, lists the open escalations,
 * prints at most 20 lines, and exits 0 even when setup fails.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DIR, serializeRecord, type Escalation } from '../../../tools/lib/escalations';
import { ROOT } from '../../../tools/x';
import { runHook, tempDir, writeFiles } from './harness';

let base = '';
let project = '';

/** The fixture's x.js: the real dispatcher on the fixture root, the real src and esc commands, a deps stub. */
const X_JS = `import { register } from 'tsx/esm/api';
register();
const real = ${JSON.stringify(ROOT)};
const { dispatch } = await import(real + '/tools/x.ts');
const load = (name) => async () => (await import(real + '/tools/cmd/' + name + '.ts')).default;
const deps = async () => ({
  usage: 'deps', options: { update: { type: 'boolean' }, 'dry-run': { type: 'boolean' } }, maxPositionals: 0,
  run: async () => ({ ok: process.env.FIXTURE_DEPS !== 'fail', summary: 'fixture registry: nothing to adopt' }),
});
process.exitCode = await dispatch(process.argv.slice(2), {
  root: import.meta.dirname, commands: { src: load('src'), esc: load('esc'), deps },
});
`;

/** Records each call in $FAKE_LOG/<name>.log. `npm ci` empties node_modules/.cache, as the real one empties
 * node_modules, and exits $FAKE_NPM_CI (0 by default); curl always fails. */
const stub = (name: string, body: string) => `#!/bin/sh\necho "$*" >> "$FAKE_LOG/${name}.log"\n${body}\n`;

beforeEach(() => {
  base = tempDir('session-start');
  project = join(base, 'project');
  writeFiles(project, { 'x.js': X_JS });
  copyFileSync(join(ROOT, 'package.json'), join(project, 'package.json'));
  copyFileSync(join(ROOT, '.nvmrc'), join(project, '.nvmrc'));
  writeFiles(project, { 'scripts/setup.sh': readFileSync(join(ROOT, 'scripts/setup.sh'), 'utf8') }, 0o755);
  // x.js needs tsx alone; node_modules/.cache stands for the lint caches that npm ci would empty.
  mkdirSync(join(project, 'node_modules'));
  symlinkSync(join(ROOT, 'node_modules', 'tsx'), join(project, 'node_modules', 'tsx'));
  writeFiles(project, { 'node_modules/.cache/eslint/marker': 'warm' });
  writeFiles(
    join(base, 'bin'),
    {
      npm: stub(
        'npm',
        '[ "$1" = --version ] && echo 11.0.0\n[ "$1" = ci ] && rm -rf node_modules/.cache && exit "${FAKE_NPM_CI:-0}"\nexit 0',
      ),
      curl: stub('curl', 'exit 7'),
    },
    0o755,
  );
  writeFiles(base, { 'env.sh': 'export EARLIER=1\n', 'src-3d2dge/README': '', 'src-shardfall/README': '' });
  record('ESC-0001', '2026-01-01T00:00:00Z', 'open');
  record('ESC-0002', '2026-01-01T00:00:00Z', 'closed');
});

afterEach(() => rmSync(base, { recursive: true, force: true }));

/** Writes an escalation record into the fixture project. */
function record(id: string, raised: string, status: Escalation['status']) {
  const fields: Escalation = {
    id,
    title: `Question ${id}?`,
    status,
    principle: 'Assets',
    raised,
    deadline: raised.replace('T00:00', 'T00:15'),
    run: 'fixture',
    options: ['Generate it', 'Commit it'],
    recommendation: 1,
    answer: status === 'closed' ? 'Generate it' : null,
    call: null,
    commit: null,
    followUp: null,
  };
  writeFiles(project, { [`${DIR}/${id}-question.md`]: serializeRecord(fields, `# ${id}\n\nWhy it is asked.`) });
}

/** Node's own directory: the hook's PATH line must put it first. */
const nodeDir = dirname(realpathSync(process.execPath));

/** Runs the hook in the fixture environment, from an empty environment. */
function start(source: string, env: Record<string, string> = {}) {
  return runHook(
    'session-start.sh',
    { hook_event_name: 'SessionStart', source },
    {
      projectDir: project,
      cleanEnv: true,
      timeout: 120_000,
      env: {
        HOME: join(base, 'home'),
        PATH: `${join(base, 'bin')}:${nodeDir}:/usr/bin:/bin`,
        FAKE_LOG: base,
        CLAUDE_ENV_FILE: join(base, 'env.sh'),
        MY3D2DGE_SRC: join(base, 'src-3d2dge'),
        SHARDFALL_SRC: join(base, 'src-shardfall'),
        ...env,
      },
    },
  );
}

const log = (name: string) =>
  existsSync(join(base, `${name}.log`)) ? readFileSync(join(base, `${name}.log`), 'utf8') : '';
const envLines = () => readFileSync(join(base, 'env.sh'), 'utf8').split('\n').filter(Boolean);

describe('the SessionStart hook', () => {
  it('installs nothing with Node 24 active, writes the env lines once, and lists the open escalations', () => {
    expect(process.version).toBe(`v${readFileSync(join(ROOT, '.nvmrc'), 'utf8').trim()}`);
    const run = start('startup');
    expect(run.code).toBe(0);
    const lines = run.stdout.trimEnd().split('\n');
    expect(lines.length).toBeLessThanOrEqual(20);
    expect(run.stdout).toContain('session-start: scripts/setup.sh ok');
    expect(log('npm')).toContain('ci --no-audit --no-fund');
    expect(log('curl')).toBe('');
    expect(existsSync(join(base, 'home', '.cache', 'my3dge'))).toBe(false);
    expect(readFileSync(join(project, 'out/hooks/session-start.log'), 'utf8')).toContain('nothing to install');
    expect(readFileSync(join(project, 'node_modules/.cache/eslint/marker'), 'utf8')).toBe('warm');

    const expected = [
      'export EARLIER=1',
      `export MY3D2DGE_SRC="${join(base, 'src-3d2dge')}"`,
      `export SHARDFALL_SRC="${join(base, 'src-shardfall')}"`,
      `export PATH="${nodeDir}:$PATH"`,
    ];
    expect(envLines()).toEqual(expected);

    expect(run.stdout).toContain('x src: FAIL');
    expect(run.stdout).toContain('x esc: ok: 1 record still needing review');
    expect(run.stdout).toMatch(/ESC-0001 open .*OVERDUE/);
    expect(run.stdout).not.toContain('ESC-0002');
    expect(run.stdout).toContain('x deps: ok: fixture registry: nothing to adopt');

    expect(start('resume').code).toBe(0);
    expect(envLines()).toEqual(expected);
  });

  it('after a compaction, skips setup and x deps and lists the escalations again', () => {
    const run = start('compact');
    expect(run.code).toBe(0);
    expect(log('npm')).toBe('');
    expect(run.stdout).not.toContain('scripts/setup.sh');
    expect(run.stdout).not.toContain('x deps');
    expect(run.stdout).toContain('ESC-0001');
    expect(envLines()).toContain(`export PATH="${nodeDir}:$PATH"`);
  });

  it('never fails the session start: a failed setup and an unreachable registry are reported', () => {
    const run = start('startup', { FAKE_NPM_CI: '1', FIXTURE_DEPS: 'fail' });
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('session-start: scripts/setup.sh FAIL (exit 1)');
    expect(run.stdout).toContain('setup: error: npm ci failed');
    expect(run.stdout).toContain('x deps: FAIL');
    expect(run.stdout).toContain('ESC-0001');
  });
});
