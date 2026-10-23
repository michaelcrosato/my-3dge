/**
 * @file Performance budgets and their trend (PLAN.md §8.1, §8.7, WPs 1.5 and 5.5), for `x perf` (tools/cmd/perf.ts,
 * whose file comment says how each way measures). A budget file, `tests/baselines/perf/<scene id>.json` (`box:room`
 * → `box-room.json`, `budgetPath`), is `{ scene, steps?, budgets?, page?, ladder?, tolerance?, reason }`: at least
 * one section, no other key (`readBudget` names each problem, an unknown key with the closest). What each way
 * measures: `BUDGET_KEYS` in Node and on each rung of the `LADDER`, `PAGE_KEYS` in a page, over `DEFAULT_STEPS` unless
 * the section says otherwise. A value is within its budget up to budget × (1 + `tolerance`) (`withinBudget`).
 * Trends (§8.7): each run appends its numbers to `TREND_FILE` (the last 20 per key) and warns `PERF_TREND` for each
 * that grew over `TREND_LIMIT` since the run before (`recordTrend`). Split from tools/cmd/perf.ts to keep each under
 * 400 lines (ADR-0014 amendment 16).
 *
 * @example
 * withinBudget(11.4, 10, 0.15); // true: 15% over 10 is 11.5
 * budgetPath('box:room'); // 'tests/baselines/perf/box-room.json'
 * median([3, 1, 2, 10]); // 2.5
 * @see tools/cmd/perf.test.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { show, validate, type Field, type Schema } from '../../engine/core/schema';
import { COUNT_KEYS } from '../../engine/dev/stats';
import type { Finding } from './report';
import { UsageError } from '../x';

/** What a Node run and a ladder rung measure: milliseconds per step, per hash and per capture. */
export const BUDGET_KEYS = ['stepMs', 'hashMs', 'captureMs'] as const;
/** One quantity a Node run measures. */
export type PerfKey = (typeof BUDGET_KEYS)[number];
/** A page's times: `__engine.stats()`'s means, the GPU's where the device has timestamp queries (WP 11.2). */
export const PAGE_TIMES = ['simMs', 'physicsMs', 'animMs', 'renderMs', 'gpuMs'] as const;
/** What a page measures: its times, then its counts. */
export const PAGE_KEYS = [...PAGE_TIMES, ...COUNT_KEYS] as const;
/** One quantity a page measures. */
export type PageKey = (typeof PAGE_KEYS)[number];
/** The crowd ladder's rungs, in agents. */
export const LADDER = [100, 1000, 5000] as const;
/** The steps each way takes unless its budget section or `--steps` says otherwise. */
export const DEFAULT_STEPS = { node: 600, ladder: 300, page: 120 } as const;
/** A way of measuring (see the file comment). */
export type Way = keyof typeof DEFAULT_STEPS;
/** Growth since the run before that `PERF_TREND` warns about: 15%. */
export const TREND_LIMIT = 0.15;
/** The trend file, under the repository. */
export const TREND_FILE = join('out', 'perf', 'trend.json');

/** Budgets by key, each optional. */
export type Budgets<K extends string = string> = Partial<Record<K, number>>;

/** A budget file, `tests/baselines/perf/<scene id>.json` (see the file comment). */
export interface PerfBudget {
  scene: string;
  steps?: number;
  budgets?: Budgets<PerfKey>;
  page?: { steps: number; budgets: Budgets<PageKey> };
  ladder?: { setting: string; steps: number; rungs: Record<string, Budgets<PerfKey>> };
  tolerance?: number;
  reason: string;
}

/** A section of a budget file, as a way of measuring is held to it. */
export type Section = { steps: number; budgets?: Budgets; setting?: string; rungs?: Record<string, Budgets> };

/** A field of the budget file's schema (engine/core/schema.ts): `validate` names the problems, unknown keys included. */
const field = (type: Field['type'], more: Partial<Field> = {}): Field => ({ type, description: type, ...more });
/** An object of `keys`, each `each` (a budget: a number from 0). */
const budgetsOf = (keys: readonly (string | number)[], required = false, each = field('number', { minimum: 0 })) =>
  field('object', { required, properties: Object.fromEntries(keys.map((key) => [key, each])) });
const STEPS = field('integer', { minimum: 1, required: true });
/** The budget file's schema; `readBudget` adds what it cannot say (steps with budgets, a section, no empty text). */
const FILE: Schema = {
  scene: field('string', { required: true }),
  steps: field('integer', { minimum: 1 }),
  budgets: budgetsOf(BUDGET_KEYS),
  page: field('object', { properties: { steps: STEPS, budgets: budgetsOf(PAGE_KEYS, true) } }),
  ladder: field('object', {
    properties: {
      setting: field('string', { required: true }),
      steps: STEPS,
      rungs: budgetsOf(LADDER, true, budgetsOf(BUDGET_KEYS)),
    },
  }),
  tolerance: field('number', { minimum: 0, maximum: 1 }),
  reason: field('string', { required: true }),
};
/** A budget file's shape, for messages. */
export const BUDGET_SHAPE = `{ scene, steps, budgets: { ${BUDGET_KEYS.join(', ')} }, page: { steps, budgets }, ladder: { setting, steps, rungs }, tolerance, reason }`;

/** The middle value (the mean of the two middle ones for an even count). */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Whether `value` is within `limit`, `tolerance` (a fraction) over it allowed. */
export function withinBudget(value: number, limit: number, tolerance = 0): boolean {
  return value <= limit * (1 + tolerance);
}

/** A scene's budget file, repository-relative: `:` in the id becomes `-`. */
export function budgetPath(scene: string): string {
  return join('tests', 'baselines', 'perf', `${scene.replace(/:/g, '-')}.json`);
}
/** Reads and checks a budget file; throws `UsageError` naming each problem (an unknown key with the closest). */
export function readBudget(path: string): PerfBudget {
  const budget = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const problems = validate(FILE, budget).problems.map((problem) => problem.message);
  const steps = budget.steps === undefined ? 'absent' : show(budget.steps);
  if ((budget.steps === undefined) !== (budget.budgets === undefined))
    problems.push(`steps is ${steps}; the steps it was measured over come with its budgets, and only with them`);
  if (!['budgets', 'page', 'ladder'].some((key) => budget[key] !== undefined))
    problems.push('it has no budgets: give budgets, page or ladder');
  if (budget.scene === '') problems.push('scene is ""; the scene id');
  if (budget.reason === '') problems.push('reason is empty; say how it was measured');
  if (problems.length) throw new UsageError(`${path}: ${problems.join('; ')}; a budget file is ${BUDGET_SHAPE}`);
  return budget as unknown as PerfBudget;
}
/** The metrics that grew over `limit` (a fraction) from `before` to `after`, as text. */
export function regressions(before: Record<string, number>, after: Record<string, number>, limit = TREND_LIMIT) {
  return Object.entries(after)
    .filter(([key, value]) => typeof before[key] === 'number' && value > 0 && value > before[key] * (1 + limit))
    .map(([key, value]) => `${key} ${before[key]} → ${value}`);
}

/** Appends `measured` under `key` to the trend file (the last 20 kept); warns for each regression since the last. */
export function recordTrend(root: string, key: string, measured: Record<string, number>): Finding[] {
  const path = join(root, TREND_FILE);
  type Trend = Record<string, { at: string; metrics: Record<string, number> }[]>;
  const trend = (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}) as Trend;
  const history = trend[key] ?? [];
  const grew = history.length ? regressions(history[history.length - 1].metrics, measured) : [];
  trend[key] = [...history, { at: new Date().toISOString(), metrics: measured }].slice(-20);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(trend, null, 2)}\n`);
  return grew.map((text) => {
    const message = `${key}: ${text}, over ${TREND_LIMIT * 100}% since the run before (${TREND_FILE})`;
    return { id: 'PERF_TREND', message, file: TREND_FILE };
  });
}
