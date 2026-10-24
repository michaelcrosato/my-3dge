/**
 * @file Unit tests for the full run's split of T2 by minutes (tools/lib/ciShards.ts): longest first to the machine
 * with the fewest minutes, the first carrying the other steps, ties to the lower machine and equal minutes in name
 * order, every file dealt once; an unmeasured file's weight; the minutes summed from Playwright's reports, nested
 * suites included; the table `x ci --minutes` writes, keeping its steps. And the repository's own table: it names no
 * spec file that is gone, and its plan keeps each of the workflow's four machines well inside the job's 120 minutes.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  minutesFromReports,
  minutesOf,
  planShards,
  readT2Minutes,
  specFiles,
  T2_MINUTES,
  UNMEASURED_MINUTES,
  writeMinutes,
  type T2Minutes,
} from './ciShards';

const ROOT = join(import.meta.dirname, '..', '..');
const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A temporary root holding `files`. */
function sandbox(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'x-shards-'));
  temporary.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const table = (steps: number, minutes: Record<string, number>): T2Minutes => ({ measured: 'a test', steps, minutes });

describe('planShards', () => {
  it('deals the longest first to the machine with the fewest minutes, the first starting with the steps', () => {
    const minutes = { 'a.spec.ts': 30, 'b.spec.ts': 20, 'c.spec.ts': 12, 'd.spec.ts': 8, 'e.spec.ts': 6 };
    expect(planShards(Object.keys(minutes), table(10, minutes), 4)).toEqual([
      ['d.spec.ts'],
      ['a.spec.ts'],
      ['b.spec.ts'],
      ['c.spec.ts', 'e.spec.ts'],
    ]);
    expect(planShards(Object.keys(minutes), table(0, minutes), 1)).toEqual([Object.keys(minutes)]);
  });

  it('gives ties to the lower machine and equal minutes in name order, whatever order the files come in', () => {
    const minutes = { 'b.spec.ts': 3, 'a.spec.ts': 3, 'c.spec.ts': 3 };
    const plan = planShards(['c.spec.ts', 'b.spec.ts', 'a.spec.ts'], table(0, minutes), 2);
    expect(plan).toEqual([['a.spec.ts', 'c.spec.ts'], ['b.spec.ts']]);
    expect(planShards(['a.spec.ts', 'b.spec.ts', 'c.spec.ts'], table(0, minutes), 2)).toEqual(plan);
  });

  it('weighs a file the table does not list as unmeasured, and deals every file once', () => {
    expect(minutesOf(table(0, {}), 'new.spec.ts')).toBe(UNMEASURED_MINUTES);
    const specs = Array.from({ length: 23 }, (_, i) => `s${String(i).padStart(2, '0')}.spec.ts`);
    const plan = planShards(specs, table(14, { 's05.spec.ts': 40 }), 4);
    expect(plan.flat().sort()).toEqual(specs);
    expect(plan.find((bin) => bin.includes('s05.spec.ts'))).toEqual(['s05.spec.ts']);
  });
});

describe('the minutes', () => {
  /** A Playwright JSON report: one suite a file, `durations` its tests' results (ms). */
  const report = (file: string, ...durations: number[]) => ({
    config: { metadata: { gitCommit: { shortHash: 'abc1234' }, ci: { buildHref: 'https://example.test/runs/1' } } },
    suites: [{ file, specs: [{ tests: durations.map((duration) => ({ results: [{ duration }] })) }] }],
  });

  it('sums each file’s results over the reports, nested suites included, to a tenth of a minute', () => {
    const nested = { suites: [{ file: 'b.spec.ts', suites: [{ specs: [{ tests: [{ results: [{ duration: 60_000 }, { duration: 30_000 }] }] }] }] }] }; // prettier-ignore
    expect(minutesFromReports([report('a.spec.ts', 90_000, 3_000), nested, report('a.spec.ts', 6_000)])).toEqual({
      'a.spec.ts': 1.7,
      'b.spec.ts': 1.5,
    });
  });

  it('x ci --minutes rewrites the table from the reports, naming the run, and keeps its steps', () => {
    const root = sandbox({
      [T2_MINUTES]: JSON.stringify(table(14.5, { 'old.spec.ts': 9 })),
      'r1.json': JSON.stringify(report('a.spec.ts', 120_000)),
      'r2.json': JSON.stringify(report('b.spec.ts', 30_000)),
    });
    expect(writeMinutes(root, ['r1.json', 'r2.json'])).toEqual({
      ok: true,
      summary: '2 spec files, 3 min, measured on abc1234',
      lines: [`wrote ${T2_MINUTES}`],
    });
    expect(JSON.parse(readFileSync(join(root, T2_MINUTES), 'utf8'))).toEqual({
      measured: 'abc1234, the full run https://example.test/runs/1 (2 reports)',
      steps: 14.5,
      minutes: { 'a.spec.ts': 2, 'b.spec.ts': 0.5 },
    });
  });
});

describe('the repository’s table', () => {
  const own = readT2Minutes(ROOT);
  const specs = specFiles(ROOT);

  it('names no spec file that is gone (x ci --minutes rewrites it from the next full run)', () => {
    expect(Object.keys(own.minutes).filter((spec) => !specs.includes(spec))).toEqual([]);
  });

  it('keeps each of the workflow’s four machines under 100 of the job’s 120 minutes (add a shard when not)', () => {
    const plan = planShards(specs, own, 4);
    const loads = plan.map((bin, i) => bin.reduce((sum, spec) => sum + minutesOf(own, spec), i === 0 ? own.steps : 0));
    for (const [i, load] of loads.entries()) expect(load, `shard ${i + 1}: ${plan[i].join(' ')}`).toBeLessThan(100);
  });
});
