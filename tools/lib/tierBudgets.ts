/**
 * @file The quick gate's time budget (PLAN.md §8.2, ADR-0023): the steps `x ci --local` runs before every merge,
 * together, against `GATE_BUDGET_MS`, the owner's five minutes (`checkGate`), and the timing table `x ci --local`
 * prints (`timingTable`). T2 and the long runs have no budget: they run where nobody waits on them, on GitHub after
 * each merge (tools/cmd/ci.ts).
 *
 * Invariants: over the budget warns and never fails: wall-clock time on a shared machine is noise, not proof
 * (ADR-0022); the counts the pages measure are the checks that fail.
 *
 * @example
 * checkGate(298_000).status; // 'ok': 4 min 58 s, within 5 min
 * checkGate(330_000).status; // 'warn': over the budget is a warning, never a failure
 * console.log(timingTable([{ name: 'npm test', ms: 8140, ok: true }]).join('\n'));
 * @see tools/lib/tiers.test.ts
 */
import { duration } from './tiers';

/** The quick gate's budget in ms: its steps together, before every merge (the owner's call, ADR-0023). */
export const GATE_BUDGET_MS = 300_000;

/** The quick gate's time against its budget. */
export interface BudgetCheck {
  ms: number;
  budgetMs: number;
  status: 'ok' | 'warn';
  /** One sentence: the time, the budget and, when over, where to look. */
  message: string;
}

/** Where to look when the quick gate is slow. */
const FIX =
  'find the slowest step in out/ci/summary.md and speed it up; a test that drives a browser belongs in T2 (tests/e2e/), one that is long in the long runs';

/** Checks the quick gate's time: over `GATE_BUDGET_MS` warns (ADR-0022: time budgets never fail). */
export function checkGate(ms: number): BudgetCheck {
  const status = ms > GATE_BUDGET_MS ? 'warn' : 'ok';
  const took = `the quick gate took ${duration(ms)}`;
  const budget = `${duration(GATE_BUDGET_MS)} budget`;
  const message = status === 'ok' ? `${took}, within its ${budget}` : `${took}, over its ${budget}: ${FIX}`;
  return { ms, budgetMs: GATE_BUDGET_MS, status, message };
}

/** One row of the timing table. */
export interface Timing {
  name: string;
  ms: number;
  ok: boolean;
}

/** The timing table: one line per step (verdict, name, duration), then the total. */
export function timingTable(rows: readonly Timing[]): string[] {
  const width = Math.max(4, ...rows.map((row) => row.name.length));
  const lines = rows.map(({ name, ms, ok }) => `${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(width)}  ${duration(ms)}`);
  const failed = rows.filter((row) => !row.ok).map((row) => row.name);
  const total = duration(rows.reduce((sum, row) => sum + row.ms, 0));
  lines.push(failed.length ? `FAILED: ${failed.join(', ')} (${total} in all)` : `all passed in ${total}`);
  return lines;
}
