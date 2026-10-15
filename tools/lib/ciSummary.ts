/**
 * @file The gate's report (PLAN.md §8.9, WP 0.9): where `x ci --local` (tools/cmd/ci.ts) writes (`CI_OUT`), its run as
 * Markdown for `out/ci/summary.md` and the GitHub workflow's step summary (`renderSummary`: the commit, the steps with
 * their times, the quick gate against its budget, a failed step's last lines), and as the dispatcher's result
 * (`toResult`: the timing table and one finding per problem). Split from tools/cmd/ci.ts to keep each under 400 lines
 * (ADR-0014 amendment 16).
 *
 * Invariants: a budget over is a warning, never a failure (ADR-0022); only a failed step fails the run.
 *
 * @example
 * CI_OUT.summary; // 'out/ci/summary.md'
 * @see tools/cmd/ci.test.ts
 */
import type { CommandResult } from '../x';
import type { CiRun } from '../cmd/ci';
import type { Artifact, Finding } from './report';
import { timingTable } from './tierBudgets';
import { duration, LAST_GREEN } from './tiers';

/** Where `x ci --local` writes, relative to the root. */
export const CI_OUT = {
  summary: 'out/ci/summary.md',
  logs: 'out/ci/logs',
  /** Where `node_modules/.cache/` waits while `npm ci` runs. */
  keptCache: 'out/ci/kept-cache',
} as const;
/** The run as Markdown, for `out/ci/summary.md` (and the GitHub workflow's step summary). */
export function renderSummary(run: CiRun): string {
  const { head } = run;
  const dirty = head.dirty.length ? ` with ${head.dirty.length} uncommitted changes` : '';
  const out = [
    `# x ci --local${run.full ? ' --full' : ''}: ${run.ok ? 'ok' : 'FAIL'}`,
    '',
    `- Commit: ${head.sha.slice(0, 7)} on ${head.branch}${dirty}${run.ok ? `, recorded in ${LAST_GREEN}` : ''}`,
    `- Started: ${run.started} on ${run.runtime}, ${run.cores} cores`,
    `- Budget: ${run.budget.message}`,
    '',
    '| Step | Result | Time | Log | Note |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const step of run.steps) {
    const result = step.status === 'fail' ? `FAIL (exit ${step.code})` : step.status;
    const time = step.status === 'skipped' ? '' : duration(step.ms);
    out.push(`| \`${step.name}\` | ${result} | ${time} | ${step.log ?? ''} | ${step.note ?? ''} |`);
  }
  const failed = run.steps.filter((step) => step.status === 'fail');
  if (failed.length) out.push('', '## Failures');
  for (const step of failed) {
    out.push('', `### \`${step.command.join(' ')}\` exited ${step.code}`, '', `The last lines of ${step.log}:`);
    out.push('', '```text', ...(step.tail ?? []), '```');
  }
  return `${out.join('\n')}\n`;
}

/** The run as the dispatcher's result: the timing table, the T2 note and one finding per problem. */
export function toResult(run: CiRun): CommandResult {
  const failed = run.steps.filter((step) => step.status === 'fail');
  const total = run.steps.reduce((sum, step) => sum + step.ms, 0);
  const t2 = run.steps.find((step) => step.tier === 'T2');
  const passed = run.steps.filter((step) => step.status === 'ok').length;
  const failures: Finding[] = failed.map((step) => ({
    id: 'CI_STEP_FAILED',
    message: `${step.command.join(' ')} exited ${step.code} after ${duration(step.ms)}: read ${step.log} (its last lines are in ${CI_OUT.summary})`,
  }));
  const warnings: Finding[] = [];
  if (run.budget.status !== 'ok') warnings.push({ id: 'CI_BUDGET', message: run.budget.message });
  if (run.head.dirty.length) {
    const message = `${run.head.dirty.length} uncommitted changes (${run.head.dirty[0].trim()}…): this run covers them, not ${run.head.sha.slice(0, 7)} alone; commit and run it again before merging`;
    warnings.push({ id: 'CI_DIRTY', message });
  }
  const artifacts: Artifact[] = [
    {
      path: CI_OUT.summary,
      kind: 'text',
      describes: 'the steps and their times, the quick gate against its budget, and the failed steps’ last lines',
    },
    ...run.steps.flatMap((step) =>
      step.log ? [{ path: step.log, kind: 'text', describes: `the output of ${step.name}` }] : [],
    ),
  ];
  if (run.ok) artifacts.push({ path: LAST_GREEN, kind: 'text', describes: 'the commit of this green run' });
  const rows = run.steps.map((step) => ({
    name: step.status === 'skipped' ? `${step.name} (skipped)` : step.name,
    ms: step.ms,
    ok: step.status !== 'fail',
  }));
  return {
    ok: run.ok,
    summary: run.ok
      ? `${passed} steps passed in ${duration(total)}; ${run.head.sha.slice(0, 7)} recorded in ${LAST_GREEN}`
      : `${failures.length} problem${failures.length === 1 ? '' : 's'}: ${failed.map((step) => step.name).join(', ')}`,
    lines: [...timingTable(rows), ...(t2?.note ? [`npm run e2e: ${t2.note}`] : []), `summary: ${CI_OUT.summary}`],
    target: 'local',
    failures,
    warnings,
    metrics: {
      commit: run.head.sha,
      dirty: run.head.dirty.length,
      ...Object.fromEntries(
        run.steps.map((step) => [step.name, step.status === 'skipped' ? 'skipped' : Math.round(step.ms)]),
      ),
    },
    artifacts,
  };
}
