/**
 * @file Agent-usability evals (PLAN.md WP 12.2, ADR-0025 decision 5): small tasks a fresh agent does in a copy of this
 * repository with only its docs to go on, each judged by an acceptance check that runs headless. `node x evals` lists
 * the tasks under evals/ and the baseline; `--dry-run` proves every task well-formed and its acceptance real, with no
 * model call: in a copy, it fails on the task's start and passes with the reference solution kept beside the task;
 * `--run --agent "<command>"` has an agent attempt each (the command reads the prompt on its standard input, in the
 * copy, for at most the task's minutes) and reports the pass rate, which `--record` writes to evals/baseline.json.
 * Model access for a live run is the owner's (PLAN.md §11.5): baseline.json names the escalation, and the dry run
 * stands until they grant it. `--keep` keeps each copy and names it. Task ids narrow any of them to those tasks.
 *
 * How a task is written, the copy and the judgement: tools/lib/evals.ts. Each run writes
 * `out/evals/<list|dry-run|run>/report.json`; a live attempt's output and diff go to out/evals/<id>/. `x check` checks
 * every task's files (this module's `check`).
 *
 * Usage: node x evals [--dry-run | --run --agent "<command>" [--record]] [--keep] [<task>…]. Exit 0 when the listing,
 * every dry run or the live run completes; 1 on a malformed task or a dry run that fails; 2 on a usage error (a live
 * run without --agent names the escalation).
 *
 * @example
 * // node x evals --dry-run box-prop
 * // node x evals --run --agent "claude -p --permission-mode acceptEdits" --record
 * @see tools/cmd/evals.test.ts
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { attemptTask, BASELINE_FILE, dryRunTask, readBaseline, readTasks, type Baseline } from '../lib/evals';
import type { Finding } from '../lib/report';
import { closest, UsageError, type Command, type CommandResult } from '../x';
import type { CheckPlugin } from './check';

/** `x check`'s evals plugin: every task under evals/ is well-formed (cheap: no copy, no run). */
export const check: CheckPlugin = {
  name: 'evals',
  run({ root }) {
    const { tasks, problems } = readTasks(root);
    return { failures: problems, summary: `${tasks.length} tasks`, metrics: { tasks: tasks.length } };
  },
};

/** The usage error a live run without an agent gets: model access is the owner's, through its escalation. */
export function noAgent(baseline: Baseline | undefined): UsageError {
  const asked = baseline?.escalation ? `, ${baseline.escalation}` : '';
  return new UsageError(`a live run needs model access, which is the owner's (PLAN.md §11.5${asked}): once they grant it, pass --agent "<command>", which reads the prompt on its standard input; until then node x evals --dry-run checks every task`); // prettier-ignore
}

export default {
  usage: 'evals [--dry-run | --run --agent "<command>" [--record]] [--keep] [<task>…]',
  options: { 'dry-run': { type: 'boolean' }, run: { type: 'boolean' }, agent: { type: 'string' }, record: { type: 'boolean' }, keep: { type: 'boolean' } }, // prettier-ignore
  maxPositionals: 64,
  async run({ values, positionals, root }): Promise<CommandResult> {
    const { tasks: all, problems } = readTasks(root);
    const ids = all.map((task) => task.id);
    for (const id of positionals) {
      const near = closest(id, ids);
      if (!ids.includes(id)) throw new UsageError(`there is no task ${id} under evals/${near ? `: did you mean ${near}?` : ''}`); // prettier-ignore
    }
    const tasks = positionals.length ? all.filter((task) => positionals.includes(task.id)) : all;
    const baseline = readBaseline(root);
    const keep = values.keep === true;
    if (values['dry-run'] && values.run) throw new UsageError('--dry-run and --run are two runs: pick one');
    if (values.record && !values.run) throw new UsageError('--record writes a live run: add --run --agent "<command>"');
    if (values.agent !== undefined && !values.run) throw new UsageError("--agent is the live run's: add --run");
    if (values.run && typeof values.agent !== 'string') throw noAgent(baseline);
    if (problems.length) return { ok: false, summary: `${problems.length} problem(s) with the tasks`, failures: problems, target: 'tasks' }; // prettier-ignore
    if (values['dry-run']) {
      const lines: string[] = [];
      const failures: Finding[] = [];
      for (const task of tasks) {
        const result = await dryRunTask(root, task, keep);
        lines.push(result.line);
        if (result.failure) failures.push(result.failure);
      }
      const real = tasks.length - failures.length;
      return { ok: failures.length === 0, summary: `${real} of ${tasks.length} tasks well-formed, their acceptance real (fails on the start, passes solved)`, lines, failures, target: 'dry-run', metrics: { tasks: tasks.length, real } }; // prettier-ignore
    }
    if (values.run) {
      const results: Baseline['tasks'] = {};
      for (const task of tasks) {
        const { pass, why, minutes } = await attemptTask(root, task, values.agent as string, keep);
        results[task.id] = { pass, minutes: Math.round(minutes * 10) / 10, ...(why ? { why } : {}) };
      }
      const passed = Object.values(results).filter((result) => result.pass).length;
      if (values.record) {
        const record: Baseline = { ...(baseline ?? { escalation: '', tasks: {} }), status: 'recorded', recorded: new Date().toISOString().slice(0, 10), agent: (values.agent as string).split(/\s+/)[0], passed, total: tasks.length, tasks: results }; // prettier-ignore
        writeFileSync(join(root, BASELINE_FILE), `${JSON.stringify(record, null, 2)}\n`);
      }
      const lines = Object.entries(results).map(([id, result]) => `${id}: ${result.pass ? 'pass' : `FAIL: ${result.why}`} (${result.minutes} min)`); // prettier-ignore
      return { ok: true, summary: `${passed} of ${tasks.length} tasks passed${values.record ? `: recorded in ${BASELINE_FILE}` : ''}`, lines, target: 'run', metrics: { tasks: tasks.length, passed, rate: tasks.length ? passed / tasks.length : 0 } }; // prettier-ignore
    }
    const lines = tasks.map((task) => `${task.id} (${task.area}): ${task.title}`);
    const status = baseline?.status === 'recorded' ? `baseline: ${baseline.passed} of ${baseline.total} passed (${baseline.recorded}, ${baseline.agent})` : `baseline: deferred until the owner grants model access (${baseline?.escalation || 'no escalation named'})`; // prettier-ignore
    return {
      ok: true,
      summary: `${tasks.length} tasks; ${status}`,
      lines,
      target: 'list',
      metrics: { tasks: tasks.length },
    };
  },
} satisfies Command;
