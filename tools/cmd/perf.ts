/**
 * @file Performance as counters against budgets, never frames per second (PLAN.md §8.1, §8.7, WPs 1.5 and 5.5).
 * Three ways, each with its section of one budget file per scene:
 *
 * - **node**: a scene module (`fixtures/scenes/kernel`) or id, found as `x sim` finds it (tools/cmd/sim.ts), run
 *   `--runs` times (5) for `--steps` steps (600) with no intents after a warm-up run: the median ms per step, per
 *   `hash()` and per `capture()`, with their spread. Section: `steps` and `budgets: { stepMs, hashMs, captureMs }`.
 * - **ladder** (`--ladder`, Node): the same at 100, 1,000 and 5,000 agents (`--steps` 300; warm-up at 100), counted by
 *   the integer setting `--agents` names (`crowd1000.agents`), else the budget's `ladder.setting`. `labs/<name>
 *   --scene <id>` names the lab's scene `<name>:<id>`. Section: `ladder: { setting, steps, rungs: { "100": {…} } }`.
 * - **page**: `labs/<name>` (with `--scene`) or an `.html` file, opened in Chromium as `x shot` opens it, its clock
 *   real again (the virtual clock's `performance.now` taken away, so the meter times real work), paused, stepped
 *   `--steps` times (120), 60 frames drawn, then `__engine.stats()` read (engine/dev/stats.ts): the means of
 *   sim, physics, anim and render ms, the GPU's (`gpuMs`, WP 11.2: with timestamp queries; else a line says why), and
 *   the last frame's draw calls, triangles, compute calls, textures, geometries and pipelines (after warm-up).
 *   Section: `page: { steps, budgets: { simMs, …, pipelinesAfterWarmUp } }`. With `--feature <id>` (WP 11.1) it
 *   measures the page again with that feature off (`gfx.featuresOff`), its rows `off.…`, and prints what the feature
 *   costs, on less off: a technique's price, compared, never budgeted (no `--budget`).
 *
 * The budget file `tests/baselines/perf/<scene id>.json` and its trend are tools/lib/perfBudget.ts's. A value is
 * within its budget up to budget × (1 + `tolerance`), 0 by default (0.15 allows 15%). `--budget` fails a
 * count over its budget or a missing section, and warns for a time (`…Ms`) over its budget: wall-clock time on this
 * shared machine is noise, not proof (ADR-0022); without it budgets are shown. A budget holds for the run it was measured
 * on (the file's scene, the section's steps, which a run takes unless `--steps` says otherwise, the scene's own
 * settings), so `--budget` refuses (exit 2, naming the fix) other steps, `--set`, another `--agents` or scene.
 * Each run appends its numbers to the trend (`out/perf/trend.json`, keyed by way, scene, steps and sets), which warns
 * `PERF_TREND` for each that grew over 15% since the run before.
 *
 * Usage: node x perf <scene|page> [--scene id] [--steps n] [--runs n] [--seed s] [--set k=v…] [--ladder [--agents
 * path]] [--feature id] [--budget]. Exit 0 when measured (and its counts within budget under `--budget`), 1 with a
 * count over its budget, without the section under `--budget`, or when a page fails or has no `stats()`, 2 on a usage
 * error (a malformed budget file included).
 *
 * @example
 * // node x perf fixtures/scenes/kernel --budget
 * // node x perf labs/box --scene crowd-1000 --ladder --budget
 * @see tools/cmd/perf.test.ts
 */
import { existsSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { join } from 'node:path';
import { didYouMean } from '../../engine/core/log';
import { show } from '../../engine/core/schema';
import { createSettings, type SettingValue } from '../../engine/core/settings';
import { COUNT_KEYS, STATS_WINDOW, type EngineStats } from '../../engine/dev/stats';
import { type Scene } from '../../engine/sim/scene';
import { createSession } from '../../engine/sim/session';
import { browserRuntime, launchBrowser, preparePage, VIEWPORT } from '../lib/browser';
import { READY_MS, waitReady } from '../lib/page';
import { targetSlug, type Finding } from '../lib/report';
import { startVite } from '../lib/vite';
import { UsageError, wholeFlag, type Command, type CommandResult } from '../x';
import { pageErrorFinding, pageFailures } from './inspect';
import { pageUrl, resolvePage } from './shot';
import { typedSets } from './sim';
import { loadScene, sceneModules } from '../lib/scenes';
import {
  BUDGET_KEYS,
  BUDGET_SHAPE,
  budgetPath,
  DEFAULT_STEPS,
  LADDER,
  median,
  PAGE_TIMES,
  readBudget,
  recordTrend,
  withinBudget,
  type Budgets,
  type PageKey,
  type PerfKey,
  type Section,
  type Way,
} from '../lib/perfBudget';

/** One run's timings: ms per step, then per hash and per capture of the state it reached (10 of each). */
export function measure(
  scene: Scene,
  options: { steps: number; seed: number; settings: Record<string, SettingValue> },
): Record<PerfKey, number> {
  const session = createSession(scene, { seed: options.seed, settings: options.settings });
  const each = (times: number, run: () => unknown) => {
    const started = performance.now();
    for (let k = 0; k < times; k++) run();
    return (performance.now() - started) / Math.max(1, times);
  };
  const stepMs = each(options.steps, () => session.step());
  return { stepMs, hashMs: each(10, () => session.world.hash()), captureMs: each(10, () => session.world.capture()) };
}

/** Rounds milliseconds for a report: 4 decimals. */
const ms = (value: number) => Math.round(value * 1e4) / 1e4;

/** The flags as `run` reads them. */
type Flags = Record<string, string | boolean | (string | boolean)[] | undefined>;
/** The `--set` pairs. */
const setsOf = (flags: Flags) => (flags.set as string[] | undefined) ?? [];

/** One line of a report: values by key (null: not measured), their spread over runs, the budgets they are held to. */
interface Row {
  name: string;
  values: Record<string, number | null>;
  spread?: (key: string) => string;
  limits?: Budgets;
  /** The metrics' prefix (a ladder rung's agents). */
  prefix?: string;
}

/**
 * Measures `scene` one way and judges it (see the file comment): the budget file's section, the refusals under
 * `--budget`, `rows(steps, section)`, each value against its budget, and the trend. Without a row name, a row
 * prints a line per key.
 */
async function judged(
  root: string,
  flags: Flags,
  way: Way,
  scene: string,
  rows: (steps: number, section?: Section) => Row[] | Promise<Row[]>,
) {
  const file = budgetPath(scene);
  const budget = existsSync(join(root, file)) ? readBudget(join(root, file)) : undefined;
  const top = budget?.budgets && { steps: budget.steps!, budgets: budget.budgets };
  const section: Section | undefined = way === 'node' ? top : budget?.[way];
  const steps = wholeFlag(flags.steps, 'steps', section?.steps ?? DEFAULT_STEPS[way], 1);
  if (flags.budget && budget) {
    const fix = `the budgets in ${file} were measured`;
    if (budget.scene !== scene)
      throw new UsageError(`${fix} for the scene ${show(budget.scene)}, not ${scene}: correct its scene`);
    if (section && steps !== section.steps)
      throw new UsageError(`${fix} over ${section.steps} steps: drop --steps, or record a budget for that run`);
    if (setsOf(flags).length) throw new UsageError(`${fix} with the scene's own settings: drop --set under --budget`);
  }
  const measured = await rows(steps, section);
  const compared = section !== undefined && section.steps === steps;
  const tolerance = budget?.tolerance ?? 0;
  const plus = tolerance ? ` +${Math.round(tolerance * 100)}%` : '';
  const failures: Finding[] = [];
  const over: Finding[] = [];
  if (flags.budget && !section) {
    const message = `no ${way} budget for ${scene}: write it in ${file} (${BUDGET_SHAPE})`;
    failures.push({ id: 'PERF_NO_BUDGET', message, file });
  }
  const metrics: Record<string, number> = {};
  const lines = measured.flatMap((row) => {
    const items = Object.entries(row.values).map(([key, value]) => {
      if (value !== null) metrics[row.prefix ? `${row.prefix}.${key}` : key] = ms(value);
      const limit = compared ? row.limits?.[key] : undefined;
      const within = limit === undefined || value === null || withinBudget(value, limit, tolerance);
      if (!within && flags.budget) {
        const message = `${scene}${row.name ? ` (${row.name})` : ''}: ${key} ${ms(value!)} is over its budget ${limit}${plus} (${budget?.reason})`;
        (key.endsWith('Ms') ? over : failures).push({ id: 'PERF_OVER_BUDGET', message, file });
      }
      const verdict = limit === undefined || value === null ? '' : `, ${within ? 'within' : 'OVER'} ${limit}${plus}`;
      const spread = row.spread ? ` (${row.spread(key)})` : '';
      return `${key}${row.name ? ' ' : ': '}${value === null ? '–' : ms(value)}${spread}${verdict}`;
    });
    return row.name ? [`${row.name}: ${items.join(', ')}`] : items;
  });
  lines.push(
    !budget
      ? `no budget file (${file})`
      : !section
        ? `budgets: ${file} has no ${way} budgets`
        : !compared
          ? `budgets: ${file}, measured over ${section.steps} steps; this run took ${steps}, so they are not compared`
          : `budgets: ${file}${plus ? ` (${plus.trim()})` : ''}${flags.budget ? '' : ' (shown; --budget enforces them)'}`,
  );
  const warnings = [...over, ...recordTrend(root, [way, scene, `${steps} steps`, ...setsOf(flags)].join(' '), metrics)];
  return { ok: failures.length === 0, steps, lines, failures, warnings, metrics };
}

/** The scene a Node run measures: a module or id, or `labs/<name>` with `--scene` (the lab's `<name>:<id>`). */
async function nodeScene(root: string, target: string, id: string | undefined): Promise<Scene> {
  const lab = /^labs\/([^/]+)\/?$/.exec(target)?.[1];
  if (!lab || existsSync(join(root, target, 'index.ts'))) return (await loadScene(root, target, id)).scene;
  if (!id) throw new UsageError(`name the scene of ${target} with --scene <id>`);
  const ids = [...sceneModules(root)].filter(([, file]) => file.startsWith(`labs/${lab}/`)).map(([scene]) => scene);
  const found = [id, `${lab}:${id}`].find((candidate) => ids.includes(candidate));
  if (!found) throw new UsageError(`${target} has no scene ${id} (its scenes: ${ids.sort().join(', ') || 'none'})`);
  return (await loadScene(root, found, found)).scene;
}

/** The setting `asked` (`--agents`, else the budget's): an integer setting that allows the top rung's agents. */
export function agentsSetting(asked: string | undefined): string {
  const top = LADDER[LADDER.length - 1];
  const need = `the ladder needs the integer setting that sets how many agents start, allowing ${top}`;
  if (!asked) throw new UsageError(`${need}: name it with --agents <path>, or in the budget's ladder.setting`);
  const rows = createSettings().describe();
  const row = rows.find((candidate) => candidate.path === asked);
  const paths = rows.map((candidate) => candidate.path);
  if (!row) throw new UsageError(`--agents ${asked} is no setting${didYouMean(asked, paths)}`);
  if (row.type !== 'integer' || (row.maximum ?? Infinity) < top) throw new UsageError(`${asked}: ${need}`);
  return asked;
}

/** `runs` runs of `once` as a row: the medians, with each key's spread. */
function sampled(runs: number, once: () => Record<PerfKey, number>): Pick<Row, 'values' | 'spread'> {
  const samples = Array.from({ length: runs }, once);
  const values = Object.fromEntries(BUDGET_KEYS.map((key) => [key, median(samples.map((s) => s[key]))]));
  const spread = (key: string) => {
    const each = samples.map((s) => s[key as PerfKey]);
    return `${ms(Math.min(...each))}–${ms(Math.max(...each))}`;
  };
  return { values, spread };
}

/** A scene in Node, or the ladder (see the file comment). */
async function runNode(root: string, target: string, flags: Flags, way: 'node' | 'ladder'): Promise<CommandResult> {
  const scene = await nodeScene(root, target, flags.scene as string | undefined);
  const [seed, runs] = [wholeFlag(flags.seed, 'seed', 1), wholeFlag(flags.runs, 'runs', 5, 1)];
  const settings = typedSets(setsOf(flags));
  let setting = '';
  const result = await judged(root, flags, way, scene.id, (steps, section) => {
    if (way === 'ladder') setting = agentsSetting((flags.agents as string | undefined) ?? section?.setting);
    if (flags.budget && section?.setting && setting !== section.setting)
      throw new UsageError(`the ladder's budgets count agents with ${section.setting}: drop --agents under --budget`);
    const at = (agents?: number) => ({ steps, seed, settings: agents ? { ...settings, [setting]: agents } : settings });
    measure(scene, at(way === 'ladder' ? LADDER[0] : undefined)); // the untimed warm-up run
    const rung = (agents?: number): Row => ({
      name: agents ? `${agents} agents` : '',
      prefix: agents ? String(agents) : undefined,
      limits: agents ? section?.rungs?.[agents] : section?.budgets,
      ...sampled(runs, () => measure(scene, at(agents))),
    });
    return way === 'node' ? [rung()] : LADDER.map((agents) => rung(agents));
  });
  const sets = Object.entries(settings).map(([path, value]) => [`set.${path}`, JSON.stringify(value)]);
  const each = way === 'node' ? `${result.metrics.stepMs} ms per step` : `${setting} at ${LADDER.join(', ')}`;
  return {
    ...result,
    target: way === 'node' ? scene.id : `${scene.id}-ladder`,
    summary: `${scene.id}: ${result.steps} steps × ${runs} runs${way === 'node' ? '' : ' a rung'}, ${each} (median, Node)`,
    metrics: { steps: result.steps, runs, ...result.metrics, ...Object.fromEntries(sets) },
  };
}

/** The page's engine, inside `evaluate`. */
declare const __engine: Record<string, (...args: unknown[]) => unknown>;

/** A page's stats after `steps` steps and `STATS_WINDOW` frames, timed on the real clock; null without `stats()`. */
const statsOf = (tab: Page, steps: number) =>
  tab.evaluate(
    async ({ steps, frames }) => {
      if (typeof __engine.stats !== 'function') return null;
      Reflect.deleteProperty(performance, 'now'); // the virtual clock's (tools/lib/browser.ts): time the real one
      __engine.pause();
      __engine.step(steps);
      await __engine.render(frames);
      return __engine.stats() as EngineStats;
    },
    { steps, frames: STATS_WINDOW },
  );

/** A page in Chromium (see the file comment). */
async function runPage(root: string, page: string, flags: Flags): Promise<CommandResult> {
  if (flags.runs !== undefined) throw new UsageError('--runs is for Node runs: a page reports its last 60 steps');
  const feature = flags.feature as string | undefined;
  if (feature !== undefined && flags.budget) throw new UsageError('--feature compares a page with a feature off, which no budget holds: drop --budget'); // prettier-ignore
  const { file: html } = resolvePage(page);
  if (!existsSync(join(root, html))) throw new UsageError(`there is no ${html} for ${page}`);
  const seed = flags.seed === undefined ? [] : [`seed=${wholeFlag(flags.seed, 'seed', 1)}`];
  const urlOf = (off: string[] = []) => pageUrl(page, { scene: flags.scene as string | undefined, set: [...setsOf(flags), ...seed, ...off] }); // prettier-ignore
  const target = `${targetSlug(page)}${flags.scene ? `-${String(flags.scene)}` : ''}`;
  const [server, browser] = [await startVite({ root }), await launchBrowser()];
  const open = async (path: string) => {
    const tab = await browser.newPage({ viewport: VIEWPORT });
    const watch = await preparePage(tab, { seed: 1, root });
    await tab.goto(`${server.url}${path}`);
    const signals = await waitReady(tab, watch, READY_MS);
    const errors = async () => (await watch.errors()).map(pageErrorFinding(page));
    return { tab, errors, failures: pageFailures(page, html, signals, await errors()), signals };
  };
  try {
    const { tab, errors, failures, signals } = await open(urlOf());
    const runtime = browserRuntime(browser.version());
    if (failures.length || !signals) return { ok: false, summary: `${page} did not start`, target, failures };
    const scene = await tab.evaluate(() => (__engine.info() as { scene: string }).scene);
    const ids = feature === undefined ? [] : (await tab.evaluate(() => __engine.describe('feature') as { ids: string[] })).ids; // prettier-ignore
    if (feature !== undefined && !ids.includes(feature)) throw new UsageError(`${feature} is not a feature of ${page}${didYouMean(feature, ids)}`); // prettier-ignore
    let [stats, off]: (EngineStats | null)[] = [null, null];
    const result = await judged(root, flags, 'page', scene, async (steps, section) => {
      stats = await statsOf(tab, steps);
      const row = (name: string, keys: readonly PageKey[], from: EngineStats | null, prefix?: string): Row => {
        const values = Object.fromEntries(keys.map((key) => [key, from?.[key] ?? null]));
        return { name, values, limits: prefix ? undefined : section?.budgets, prefix };
      };
      const rows = [row('ms', PAGE_TIMES, stats), row('last frame', COUNT_KEYS, stats)];
      if (feature === undefined) return rows;
      const quiet = await open(urlOf([`gfx.featuresOff=${JSON.stringify([feature])}`]));
      failures.push(...quiet.failures);
      off = quiet.signals && !quiet.failures.length ? await statsOf(quiet.tab, steps) : null;
      return [...rows, row(`${feature} off: ms`, PAGE_TIMES, off, 'off'), row(`${feature} off: last frame`, COUNT_KEYS, off, 'off')]; // prettier-ignore
    });
    const on = stats as EngineStats | null;
    const offStats = off as EngineStats | null;
    const costs = [...PAGE_TIMES, ...COUNT_KEYS].flatMap((key) => (on?.[key] != null && offStats?.[key] != null ? [`${key} ${ms(on[key] - offStats[key])}`] : [])); // prettier-ignore
    if (feature !== undefined) result.lines.push(`${feature} costs, on less off: ${costs.join(', ') || 'nothing measured'}`); // prettier-ignore
    if (on && on.gpuMs === undefined)
      result.lines.push('gpuMs: not measured, no timestamp queries (GFX_NO_TIMESTAMPS)');
    failures.push(...(await errors()));
    if (!stats) {
      const message = `${page}'s __engine has no stats(): engine/dev/stats.ts registers it, so the engine must load it (engine/app)`;
      failures.push({ id: 'PERF_NO_STATS', message });
    }
    failures.push(...result.failures);
    const n = result.metrics;
    return {
      ...result,
      ok: failures.length === 0,
      target,
      browser: runtime,
      summary: `${scene}: ${result.steps} steps and ${STATS_WINDOW} frames in ${page}, ${n.drawCalls ?? '–'} draw calls, ${n.pipelinesAfterWarmUp ?? '–'} pipelines after warm-up`,
      failures,
      metrics: { steps: result.steps, frames: STATS_WINDOW, ...n },
    };
  } finally {
    await browser.close();
    await server.close();
  }
}

export default {
  usage:
    'perf <scene|page> [--scene id] [--steps n] [--runs n] [--seed s] [--set k=v…] [--ladder [--agents path]] [--feature id] [--budget]',
  options: {
    scene: { type: 'string' },
    steps: { type: 'string' },
    runs: { type: 'string' },
    seed: { type: 'string' },
    set: { type: 'string', multiple: true },
    ladder: { type: 'boolean' },
    agents: { type: 'string' },
    feature: { type: 'string' },
    budget: { type: 'boolean' },
  },
  maxPositionals: 1,
  async run({ values, positionals, root }): Promise<CommandResult> {
    const [target] = positionals;
    if (!target) throw new UsageError('name a scene module (fixtures/scenes/kernel), a scene id, or a page (labs/box)');
    if (values.agents !== undefined && !values.ladder)
      throw new UsageError("--agents names the ladder's setting: add --ladder");
    if (values.feature !== undefined && values.ladder) throw new UsageError('--feature measures a page: drop --ladder');
    if (values.ladder) return runNode(root, target, values, 'ladder');
    const path = target.split('?')[0]; // a page: an .html file, or labs/<name> without a scene module of its own
    const page = path.endsWith('.html') || (/^labs\/[^/]+\/?$/.test(path) && !existsSync(join(root, path, 'index.ts')));
    if (!page && values.feature !== undefined) throw new UsageError(`--feature measures a page (labs/box), not the scene ${target}`); // prettier-ignore
    return page ? runPage(root, target, values) : runNode(root, target, values, 'node');
  },
} satisfies Command;
