/**
 * @file Sim timings against budgets, in Node (PLAN.md §8.1, §8.7, WP 1.5): `node x perf <scene> [--scene id] [--steps
 * n] [--runs n] [--seed s] [--set k=v…] [--budget]`.
 *
 * It starts the scene (found as `x sim` finds it, tools/cmd/sim.ts) `--runs` times (5) after one untimed warm-up run,
 * steps each run `--steps` times (600) with no intents, and reports the median milliseconds per step, per `hash()`
 * and per `capture()`, with the spread over the runs. Wall-clock numbers, so only ever medians on this machine; never
 * frames per second. `--budget` compares them with `tests/baselines/perf/<scene id>.json` (`{ scene, steps, budgets: {
 * stepMs, hashMs, captureMs }, reason }`, every budget optional) and fails when a median is over its budget; without
 * the flag, the budgets are shown, not enforced. WP 5.5 adds the browser's counters and the crowd ladder.
 *
 * Usage: node x perf <scene> [--scene id] [--steps n] [--runs n] [--seed s] [--set k=v…] [--budget]. Exit 0 when
 * measured (and within budget with `--budget`), 1 when over budget or without a budget file under `--budget`, 2 on a
 * usage error.
 *
 * @example
 * median([3, 1, 2]); // 2
 * @see tools/cmd/perf.test.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSession, type Scene } from '../../engine/sim/scene';
import type { SettingValue } from '../../engine/core/settings';
import type { Finding } from '../lib/report';
import { UsageError, type Command, type CommandResult } from '../x';
import { loadScene, typedSets, wholeFlag } from './sim';

/** What a budget file may hold: milliseconds per step, per hash and per capture. */
export const BUDGET_KEYS = ['stepMs', 'hashMs', 'captureMs'] as const;
/** One measured quantity. */
export type PerfKey = (typeof BUDGET_KEYS)[number];

/** A budget file, `tests/baselines/perf/<scene id>.json`. */
export interface PerfBudget {
  scene: string;
  steps?: number;
  budgets: Partial<Record<PerfKey, number>>;
  reason: string;
}

/** The middle value (the mean of the two middle ones for an even count). */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** One run's timings: ms per step, per hash and per capture. */
export function measure(
  scene: Scene,
  options: { steps: number; seed: number; settings: Record<string, SettingValue> },
): Record<PerfKey, number> {
  const session = createSession(scene, { seed: options.seed, settings: options.settings });
  const { world } = session;
  let started = performance.now();
  for (let k = 0; k < options.steps; k++) session.step();
  const stepMs = (performance.now() - started) / Math.max(1, options.steps);
  const repeat = 10;
  started = performance.now();
  for (let i = 0; i < repeat; i++) world.hash();
  const hashMs = (performance.now() - started) / repeat;
  started = performance.now();
  for (let i = 0; i < repeat; i++) world.capture();
  return { stepMs, hashMs, captureMs: (performance.now() - started) / repeat };
}

/** Reads and checks a budget file; throws with the problem named. */
export function readBudget(path: string): PerfBudget {
  const budget = JSON.parse(readFileSync(path, 'utf8')) as PerfBudget;
  const bad = Object.keys(budget.budgets ?? {}).find((key) => !(BUDGET_KEYS as readonly string[]).includes(key));
  if (typeof budget.reason !== 'string' || !budget.reason || bad || typeof budget.budgets !== 'object') {
    throw new Error(`${path}: a budget file is { scene, steps?, budgets: { ${BUDGET_KEYS.join(', ')} }, reason }`);
  }
  return budget;
}

/** Rounds milliseconds for a report: 4 significant decimals. */
const ms = (value: number) => Math.round(value * 1e4) / 1e4;

export default {
  usage: 'perf <scene> [--scene id] [--steps n] [--runs n] [--seed s] [--set k=v…] [--budget]',
  options: {
    scene: { type: 'string' },
    steps: { type: 'string' },
    runs: { type: 'string' },
    seed: { type: 'string' },
    set: { type: 'string', multiple: true },
    budget: { type: 'boolean' },
  },
  maxPositionals: 1,
  async run({ values, positionals, root }): Promise<CommandResult> {
    const [target] = positionals;
    if (!target) throw new UsageError('name a scene module (fixtures/scenes/kernel) or a scene id');
    const { scene } = await loadScene(root, target, values.scene as string | undefined);
    const options = {
      steps: wholeFlag(values.steps, 'steps', 600, 1),
      seed: wholeFlag(values.seed, 'seed', 1),
      settings: typedSets((values.set as string[] | undefined) ?? []),
    };
    const runs = wholeFlag(values.runs, 'runs', 5, 1);
    measure(scene, options);
    const samples = Array.from({ length: runs }, () => measure(scene, options));
    const medians = Object.fromEntries(BUDGET_KEYS.map((key) => [key, median(samples.map((s) => s[key]))])) as Record<
      PerfKey,
      number
    >;
    const file = join('tests', 'baselines', 'perf', `${scene.id}.json`);
    const budget = existsSync(join(root, file)) ? readBudget(join(root, file)) : undefined;
    const failures: Finding[] = [];
    if (values.budget && !budget) {
      failures.push({
        id: 'PERF_NO_BUDGET',
        message: `no budget for ${scene.id}: write ${file} ({ scene, steps, budgets, reason })`,
        file,
      });
    }
    const lines = BUDGET_KEYS.map((key) => {
      const spread = samples.map((s) => s[key]);
      const limit = budget?.budgets[key];
      const verdict = limit === undefined ? '' : medians[key] <= limit ? `, within ${limit}` : `, OVER ${limit}`;
      if (values.budget && limit !== undefined && medians[key] > limit) {
        failures.push({
          id: 'PERF_OVER_BUDGET',
          message: `${scene.id}: ${key} median ${ms(medians[key])} ms is over its budget ${limit} ms (${budget?.reason})`,
          file,
        });
      }
      return `${key}: ${ms(medians[key])} (${ms(Math.min(...spread))}–${ms(Math.max(...spread))})${verdict}`;
    });
    return {
      ok: failures.length === 0,
      target: scene.id,
      summary: `${scene.id}: ${options.steps} steps × ${runs} runs, ${ms(medians.stepMs)} ms per step (median, Node)`,
      lines: [
        ...lines,
        budget
          ? `budgets: ${file}${values.budget ? '' : ' (shown; --budget enforces them)'}`
          : `no budget file (${file})`,
      ],
      failures,
      metrics: {
        steps: options.steps,
        runs,
        ...Object.fromEntries(BUDGET_KEYS.map((key) => [key, ms(medians[key])])),
        ...Object.fromEntries(
          Object.entries(options.settings).map(([path, value]) => [`set.${path}`, JSON.stringify(value)]),
        ),
      },
    };
  },
} satisfies Command;
