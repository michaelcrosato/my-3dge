/**
 * @file How the full run splits T2 over its machines (ADR-0023 amendment 3): by minutes, not by count. Playwright's
 * `--shard` balances test counts, so the playground's three heaviest spec files, next to each other by name, all fell
 * to the fourth machine: 90 of its minutes against the second's 7, on d1d707b. `planShards` deals the spec files out
 * by their minutes on the workflow's runner (`T2_MINUTES`), longest first, each to the machine with the fewest
 * minutes so far, the first starting with the other steps' (it alone runs them); a tie goes to the lower machine and
 * equal minutes go in name order, so every machine computes the same plan. A spec file the table does not list
 * weighs `UNMEASURED_MINUTES` until a full run measures it: `node x ci --minutes <report.json…>` rewrites the table
 * from the shards' `e2e/report.json` (the workflow's `out-<i>` artifacts), keeping its `steps`.
 *
 * Invariants: each spec file goes to exactly one machine; the plan depends only on the file names, the table and n.
 *
 * @example
 * planShards(['a.spec.ts', 'b.spec.ts', 'c.spec.ts'], { measured: '', steps: 0, minutes: { 'a.spec.ts': 5, 'b.spec.ts': 3, 'c.spec.ts': 3 } }, 2); // [['a.spec.ts'], ['b.spec.ts', 'c.spec.ts']]
 * minutesFromReports([{ suites: [{ file: 'a.spec.ts', specs: [{ tests: [{ results: [{ duration: 90_000 }] }] }] }] }]); // { 'a.spec.ts': 1.5 }
 * @see tools/lib/ciShards.test.ts
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The table of T2's minutes a spec file on the workflow's runner, under the root (a baseline: tests/baselines/). */
export const T2_MINUTES = 'tests/baselines/t2-minutes.json';

/** Where the spec files are (playwright.config.ts's `testDir`). */
export const SPEC_DIR = 'tests/e2e';

/** What a spec file the table does not list weighs, until a full run measures it. */
export const UNMEASURED_MINUTES = 5;

/** The table: which run measured it, the first machine's other steps, and each spec file's minutes. */
export interface T2Minutes {
  measured: string;
  steps: number;
  minutes: Record<string, number>;
}

/** The table under `root`; empty when there is none. */
export function readT2Minutes(root: string): T2Minutes {
  const path = join(root, T2_MINUTES);
  if (!existsSync(path)) return { measured: 'never', steps: 0, minutes: {} };
  return JSON.parse(readFileSync(path, 'utf8')) as T2Minutes;
}

/** The spec files under `root`, by name. */
export function specFiles(root: string): string[] {
  const dir = join(root, SPEC_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.spec.ts'))
    .sort();
}

/** What `spec` weighs in `table`. */
export const minutesOf = (table: T2Minutes, spec: string): number => table.minutes[spec] ?? UNMEASURED_MINUTES;

/** Deals `specs` out to `total` machines by their minutes (see the file comment); each machine's files by name. */
export function planShards(specs: readonly string[], table: T2Minutes, total: number): string[][] {
  const load = Array.from({ length: total }, (_, i) => (i === 0 ? table.steps : 0));
  const bins: string[][] = Array.from({ length: total }, () => []);
  const order = [...specs].sort((a, b) => minutesOf(table, b) - minutesOf(table, a) || a.localeCompare(b));
  for (const spec of order) {
    const least = load.indexOf(Math.min(...load));
    load[least] += minutesOf(table, spec);
    bins[least].push(spec);
  }
  return bins.map((bin) => bin.sort());
}

/** The parts of Playwright's JSON report it reads: each suite's file and its tests' results' durations (ms). */
export interface E2eReport {
  suites: E2eSuite[];
}

/** A suite of a Playwright JSON report, as far as `minutesFromReports` reads it. */
export interface E2eSuite {
  file?: string;
  specs?: { tests: { results: { duration: number }[] }[] }[];
  suites?: E2eSuite[];
}

/** Each spec file's minutes over `reports` (the shards'), to a tenth, by name. */
export function minutesFromReports(reports: readonly E2eReport[]): Record<string, number> {
  const ms = new Map<string, number>();
  const walk = (suite: E2eSuite, file: string) => {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests)
        for (const result of test.results) ms.set(file, (ms.get(file) ?? 0) + result.duration);
    for (const inner of suite.suites ?? []) walk(inner, inner.file ?? file);
  };
  for (const report of reports) for (const suite of report.suites) walk(suite, suite.file ?? '');
  return Object.fromEntries(
    [...ms].sort(([a], [b]) => a.localeCompare(b)).map(([file, total]) => [file, Math.round(total / 6000) / 10]),
  );
}

/** Rewrites the T2 minutes table under `root` from full-run reports (`paths`, Playwright's JSON), keeping its steps. */
export function writeMinutes(
  root: string,
  paths: readonly string[],
): { ok: boolean; summary: string; lines: string[] } {
  const reports = paths.map((path) => JSON.parse(readFileSync(join(root, path), 'utf8')) as E2eReport & Measured);
  const meta = reports[0]?.config?.metadata;
  const at = meta?.gitCommit?.shortHash ?? 'an unknown commit';
  const measured = `${at}, the full run ${meta?.ci?.buildHref ?? 'by hand'} (${paths.length} reports)`;
  const table = { ...readT2Minutes(root), measured, minutes: minutesFromReports(reports) };
  writeFileSync(join(root, T2_MINUTES), JSON.stringify(table, null, 2) + '\n');
  const total = Object.values(table.minutes).reduce((sum, value) => sum + value, 0);
  const files = Object.keys(table.minutes).length;
  return {
    ok: true,
    summary: `${files} spec files, ${Math.round(total)} min, measured on ${at}`,
    lines: [`wrote ${T2_MINUTES}`],
  };
}

/** What `writeMinutes` reads of a report's metadata: the commit and the run (Playwright fills both on GitHub). */
interface Measured {
  config?: { metadata?: { gitCommit?: { shortHash?: string }; ci?: { buildHref?: string } } };
}
