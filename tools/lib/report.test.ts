/**
 * @file Unit tests for the `report.json` schema (PLAN.md §8.1): what `validateReport` accepts and rejects, and where
 * `writeReport` puts the report and `out/latest.json`.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeReport, reportPath, runtime, targetSlug, validateReport, writeReport, type Report } from './report';

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A temporary repository root holding only a package.json. */
function sandbox(): string {
  const root = mkdtempSync(join(tmpdir(), 'x-report-'));
  temporary.push(root);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }));
  return root;
}

const good = (root: string): Report =>
  makeReport({
    tool: 'x shot',
    args: { positionals: ['labs/box'] },
    ms: 812.4,
    ok: false,
    root,
    browser: 'chromium141',
    failures: [
      { id: 'A031', message: 'hero covers 0 px from cam iso', file: 'labs/box/scenes/room.ts', line: 40, entity: 12 },
    ],
    metrics: { drawCalls: 214 },
    artifacts: [{ path: 'out/shot/box-room/iso.png', kind: 'image', describes: 'iso view, WebGPU' }],
  });

describe('the report schema', () => {
  it('accepts the example of §8.1, filled in by makeReport', () => {
    const report = good(sandbox());
    expect(validateReport(report)).toEqual([]);
    expect(report.version).toBe('1.2.3');
    expect(report.ms).toBe(812);
    expect(report.runtime).toBe(`${process.platform}-${process.arch} node${process.versions.node} chromium141`);
    expect(Object.keys(report)).toEqual([
      'tool',
      'version',
      'args',
      'ms',
      'ok',
      'runtime',
      'failures',
      'warnings',
      'metrics',
      'artifacts',
    ]);
  });

  it('records the runtime of every report', () => {
    expect(runtime()).toMatch(/^[a-z0-9]+-[a-z0-9]+ node\d+\.\d+\.\d+$/);
    expect(runtime('chromium141')).toMatch(/ chromium141$/);
  });

  it('rejects unknown keys, missing keys and wrong types, naming each', () => {
    const report = good(sandbox()) as unknown as Record<string, unknown>;
    expect(validateReport({ ...report, extra: 1 })).toEqual([
      'report: unknown key "extra" (allowed: ' +
        'tool, version, args, ms, ok, runtime, failures, warnings, metrics, artifacts)',
    ]);
    const { runtime: _dropped, ...withoutRuntime } = report;
    expect(validateReport(withoutRuntime)).toEqual(['report: missing key "runtime"']);
    expect(validateReport({ ...report, ok: 'no' })).toEqual(['ok: expected a boolean']);
    expect(validateReport({ ...report, ms: -1 })).toEqual(['ms: expected a number ≥ 0']);
    expect(validateReport({ ...report, metrics: { drawCalls: [1] } })).toEqual([
      'metrics.drawCalls: expected a number, string or boolean',
    ]);
    expect(validateReport({ ...report, failures: [{ id: 'A1', message: 'm', why: 'x' }] })).toEqual([
      'failures[0]: unknown key "why" (allowed: id, message, file, line, entity)',
    ]);
    expect(validateReport({ ...report, warnings: [{ id: '', message: 'm', line: 1.5 }] })).toEqual([
      'warnings[0].id: expected a non-empty string',
      'warnings[0].line: expected an integer',
    ]);
    expect(validateReport({ ...report, artifacts: [{ path: 'out/a.png', kind: 'image' }] })).toEqual([
      'artifacts[0].describes: expected a non-empty string',
    ]);
    expect(validateReport([])).toEqual(['report: expected an object']);
  });

  it('rejects an ok report that lists failures', () => {
    expect(validateReport({ ...good(sandbox()), ok: true })).toEqual(['ok: a report with failures cannot be ok']);
  });
});

describe('writeReport', () => {
  it('writes out/<cmd>/<target>/report.json and out/latest.json', () => {
    const root = sandbox();
    const report = good(root);
    const path = writeReport(root, 'shot', 'labs/box', report);
    expect(path).toBe('out/shot/labs-box/report.json');
    expect(JSON.parse(readFileSync(join(root, path), 'utf8'))).toEqual(report);
    expect(JSON.parse(readFileSync(join(root, 'out', 'latest.json'), 'utf8'))).toEqual({ report: path, ...report });
  });

  it('refuses an invalid report, naming the problem', () => {
    const root = sandbox();
    const report = { ...good(root), ok: true };
    expect(() => writeReport(root, 'shot', '', report)).toThrow(
      'invalid report for x shot: ok: a report with failures',
    );
  });

  it('turns any target into one directory name', () => {
    expect(targetSlug(undefined)).toBe('all');
    expect(targetSlug('')).toBe('all');
    expect(targetSlug('labs/hello')).toBe('labs-hello');
    expect(targetSlug('tests/pages/harness.html')).toBe('tests-pages-harness');
    expect(targetSlug('../../etc')).toBe('etc');
    expect(reportPath('help', 'src')).toBe('out/help/src/report.json');
  });
});
