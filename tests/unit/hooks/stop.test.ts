/**
 * @file The Stop hook (.claude/hooks/stop.ts, WP 0.10), run on a fixture project whose `npm run check` a test turns
 * red or green: it runs the check, blocks a red one once and never twice in a row (`stop_hook_active`), and warns
 * about open escalations past their deadline with no call.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkEnv, tail } from '../../../.claude/hooks/stop';
import { DIR, serializeRecord, type Escalation } from '../../../tools/lib/escalations';
import { runHook, tempDir, writeFiles } from './harness';

let project = '';

/** A fixture `check` script: records each run, and fails while a file named `red` exists. */
const CHECK = `import { appendFileSync, existsSync } from 'node:fs';
appendFileSync('runs.log', 'check\\n');
if (existsSync('red')) {
  console.log('src/a.ts(1,7): error TS2322: Type "string" is not assignable to type "number".');
  console.error('x check: FAIL: 1 of 5 plugins failed');
  process.exit(1);
}
console.log('x check: ok');
`;

beforeEach(() => {
  project = tempDir('stop-hook');
  writeFiles(project, {
    'package.json': JSON.stringify({
      name: 'fixture',
      private: true,
      type: 'module',
      scripts: { check: 'node check.mjs' },
    }),
    'check.mjs': CHECK,
  });
});

afterEach(() => rmSync(project, { recursive: true, force: true }));

/** Writes an escalation record into the fixture. */
function record(id: string, raised: string, status: Escalation['status']) {
  const deadline = new Date(Date.parse(raised) + 15 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const fields: Escalation = {
    id,
    title: `Question ${id}?`,
    status,
    principle: 'Assets',
    raised,
    deadline,
    run: 'fixture',
    options: ['Generate it', 'Commit it'],
    recommendation: 1,
    answer: status === 'closed' ? 'Generate it' : null,
    call: null,
    commit: null,
    followUp: null,
  };
  mkdirSync(join(project, DIR), { recursive: true });
  writeFileSync(join(project, DIR, `${id}-question.md`), serializeRecord(fields, `# ${id}\n\nWhy it is asked.`));
}

const stop = (active: boolean) =>
  runHook('stop.ts', { hook_event_name: 'Stop', stop_hook_active: active }, { projectDir: project });
const runs = () => readFileSync(join(project, 'runs.log'), 'utf8').split('\n').filter(Boolean).length;

describe('the Stop hook', () => {
  it('runs npm run check and lets a green turn end silently', () => {
    expect(stop(false)).toEqual({ code: 0, stdout: '', stderr: '' });
    expect(runs()).toBe(1);
  });

  it('blocks a red check once with its last lines, then lets the retry end with a warning', () => {
    writeFileSync(join(project, 'red'), '');
    const first = stop(false);
    expect(first.code).toBe(2);
    expect(first.stderr).toContain('npm run check is red (exit 1)');
    expect(first.stderr).toContain('error TS2322');
    expect(first.stderr).toContain('x check: FAIL');
    const retry = stop(true);
    expect(retry.code).toBe(0);
    const { systemMessage } = JSON.parse(retry.stdout) as { systemMessage: string };
    expect(systemMessage).toContain('still red after one retry');
    expect(runs()).toBe(2);
  });

  it('warns about open escalations past their deadline with no call, and only those', () => {
    record('ESC-0001', '2026-01-01T00:00:00Z', 'open');
    record('ESC-0002', '2099-01-01T00:00:00Z', 'open');
    record('ESC-0003', '2026-01-01T00:00:00Z', 'closed');
    const green = stop(false);
    expect(green.code).toBe(0);
    const { systemMessage } = JSON.parse(green.stdout) as { systemMessage: string };
    expect(systemMessage).toContain('ESC-0001 (deadline 2026-01-01T00:15:00Z): Question ESC-0001?');
    expect(systemMessage).toContain('node x esc decide');
    expect(systemMessage).not.toMatch(/ESC-0002|ESC-0003/);
    writeFileSync(join(project, 'red'), '');
    const red = stop(false);
    expect(red.code).toBe(2);
    expect(red.stderr).toContain('ESC-0001');
  });

  it('puts the cached Node of .nvmrc first on PATH when the running Node is another', () => {
    const home = tempDir('stop-home');
    const bin = join(home, '.cache', 'my3dge', 'node-v22.0.0-linux-x64', 'bin');
    writeFiles(bin, { node: '#!/bin/sh\n' }, 0o755);
    writeFileSync(join(project, '.nvmrc'), '22.0.0\n');
    expect(checkEnv(project, { HOME: home, PATH: '/usr/bin' }).PATH).toBe(`${bin}:/usr/bin`);
    writeFileSync(join(project, '.nvmrc'), `${process.version}\n`);
    expect(checkEnv(project, { HOME: home, PATH: '/usr/bin' }).PATH).toBe('/usr/bin');
    rmSync(home, { recursive: true, force: true });
  });

  it('quotes the last non-empty lines of the output', () => {
    expect(tail('a\n\nb  \nc\n', 2)).toEqual(['b', 'c']);
  });
});
