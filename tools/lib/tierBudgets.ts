/**
 * @file The tiers' budget checks (PLAN.md §8.2, ADR-0022): each tier's wall-clock duration against its budget on the
 * machine's cores (tools/lib/tiers.ts `TIERS`; T2's goes by the cores, `t2Budget`), read from the JSON reports the tiers write (`reportMs`, `checkReports`) or measured by
 * the caller (T0 writes none), and the timing table `x ci --local` prints (`timingTable`). Split from tiers.ts to keep
 * each under 400 lines (ADR-0014 amendment 16).
 *
 * Invariants: a tier over its budget warns and never fails: wall-clock time on this shared machine is noise, not proof
 * (ADR-0022); the counts the pages measure are the checks that fail. A report that is missing or not a Vitest or
 * Playwright JSON report throws, naming the file.
 *
 * @example
 * import { TIERS } from './tiers';
 * checkBudget('T1', 75_000, 4).status; // 'warn': over its budget is a warning, never a failure
 * checkBudget('T2', 3_460_000, 4).status; // 'ok': 57 min 40 s, within 60 min on 1 worker
 * const checks = checkReports(process.cwd(), { T0: 4100 }, 4); // T1 and T2 from out/test/ and out/e2e/report.json
 * console.log(timingTable([{ name: 'npm test', ms: 8140, ok: true, budgetMs: TIERS.T1.budgetMs(4) }]).join('\n'));
 * @see tools/lib/tiers.test.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { duration, t2Budget, TIERS, type TierId } from './tiers';

/** A tier's duration against its budget. */
export interface BudgetCheck {
  tier: TierId;
  ms: number;
  budgetMs: number;
  status: 'ok' | 'warn';
  /** One sentence: the duration, the budget and, when over, where to look. */
  message: string;
}

/**
 * Checks one duration against its tier's budget on `cores` cores: over it warns (ADR-0022: time budgets never fail).
 * T2's message names its workers, and says when its budget is unmeasured on them.
 */
export function checkBudget(tier: TierId, ms: number, cores: number): BudgetCheck {
  const { fix } = TIERS[tier];
  const budgetMs = TIERS[tier].budgetMs(cores);
  const status = ms > budgetMs ? 'warn' : 'ok';
  const budget = `${duration(budgetMs)} budget${tier === 'T2' ? ` (${t2Budget(cores).note})` : ''}`;
  const took = `${tier} took ${duration(ms)}`;
  const message = status === 'ok' ? `${took}, within its ${budget}` : `${took}, over its ${budget}: ${fix}`;
  return { tier, ms, budgetMs, status, message };
}

/** The wall-clock duration a Vitest or Playwright JSON report records; throws on anything else. */
export function reportMs(file: string): number {
  const report = JSON.parse(readFileSync(file, 'utf8')) as {
    stats?: { duration?: unknown };
    startTime?: unknown;
    testResults?: { endTime?: number }[];
  };
  if (typeof report.stats?.duration === 'number') return report.stats.duration;
  if (typeof report.startTime === 'number' && Array.isArray(report.testResults)) {
    const ends = report.testResults.map((result) => result.endTime ?? report.startTime) as number[];
    return Math.max(report.startTime, ...ends) - report.startTime;
  }
  throw new Error(
    `${file} is neither a Vitest nor a Playwright JSON report: run npm test or npm run e2e to rewrite it`,
  );
}

/**
 * Checks each tier's duration on `cores` cores: `measured` first (T0 writes no report, so `x ci --local` times it),
 * else the tier's JSON report under `root`. A tier with neither is left out.
 */
export function checkReports(root: string, measured: Partial<Record<TierId, number>>, cores: number): BudgetCheck[] {
  const checks: BudgetCheck[] = [];
  for (const tier of Object.values(TIERS)) {
    const report = tier.report && join(root, tier.report);
    const ms = measured[tier.id] ?? (report && existsSync(report) ? reportMs(report) : undefined);
    if (ms !== undefined) checks.push(checkBudget(tier.id, ms, cores));
  }
  return checks;
}

/** One row of the timing table. */
export interface Timing {
  name: string;
  ms: number;
  ok: boolean;
  budgetMs?: number;
}

/** The timing table: one line per step (verdict, name, duration, budget), then the total. */
export function timingTable(rows: readonly Timing[]): string[] {
  const width = Math.max(4, ...rows.map((row) => row.name.length));
  const lines = rows.map(({ name, ms, ok, budgetMs }) => {
    const budget = budgetMs === undefined ? '' : ` / ${duration(budgetMs)}${ms > budgetMs ? ' (over budget)' : ''}`;
    return `${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(width)}  ${duration(ms)}${budget}`;
  });
  const failed = rows.filter((row) => !row.ok).map((row) => row.name);
  const total = duration(rows.reduce((sum, row) => sum + row.ms, 0));
  lines.push(failed.length ? `FAILED: ${failed.join(', ')} (${total} in all)` : `all passed in ${total}`);
  return lines;
}
