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
 *   sim, physics, anim and render ms, and the last frame's draw calls, triangles, compute calls, textures, geometries
 *   and pipelines (after warm-up). Section: `page: { steps, budgets: { simMs, …, pipelinesAfterWarmUp } }`.
 *
 * The budget file `tests/baselines/perf/<scene id>.json` (`box:room` → `box-room.json`) is `{ scene, steps?,
 * budgets?, page?, ladder?, tolerance?, reason }`, at least one section, no other key (named with the closest). A
 * value is within its budget up to budget × (1 + `tolerance`), 0 by default (0.15 allows 15%). `--budget` fails a
 * count over its budget or a missing section, and warns for a time (`…Ms`) over its budget: wall-clock time on this
 * shared machine is noise, not proof (ADR-0022); without it budgets are shown. A budget holds for the run it was measured
 * on (the file's scene, the section's steps, which a run takes unless `--steps` says otherwise, the scene's own
 * settings), so `--budget` refuses (exit 2, naming the fix) other steps, `--set`, another `--agents` or scene.
 * Trends (§8.7): each run appends its numbers to `out/perf/trend.json` (the last 20 per way, scene, steps and sets)
 * and warns `PERF_TREND` for each that grew over 15% since the run before.
 *
 * Usage: node x perf <scene|page> [--scene id] [--steps n] [--runs n] [--seed s] [--set k=v…] [--ladder [--agents
 * path]] [--budget]. Exit 0 when measured (and its counts within budget under `--budget`), 1 with a count over its budget, without the section
 * under `--budget`, or when a page fails or has no `stats()`, 2 on a usage error (a malformed budget file included).
 *
 * @example
 * withinBudget(11.4, 10, 0.15); // true: 15% over 10 is 11.5
 * budgetPath('box:room'); // 'tests/baselines/perf/box-room.json'
 * @see tools/cmd/perf.test.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { didYouMean } from '../../engine/core/log';
import { show, validate, type Field, type Schema } from '../../engine/core/schema';
import { createSettings, type SettingValue } from '../../engine/core/settings';
import { COUNT_KEYS, STATS_WINDOW, type EngineStats } from '../../engine/dev/stats';
import { createSession, type Scene } from '../../engine/sim/scene';
import { browserRuntime, launchBrowser, preparePage, VIEWPORT } from '../lib/browser';
import { READY_MS, waitReady } from '../lib/page';
import { targetSlug, type Finding } from '../lib/report';
import { startVite } from '../lib/vite';
import { UsageError, type Command, type CommandResult } from '../x';
import { pageErrorFinding, pageFailures } from './inspect';
import { pageUrl, resolvePage } from './shot';
import { loadScene, sceneModules, typedSets, wholeFlag } from './sim';

/** What a Node run and a ladder rung measure: milliseconds per step, per hash and per capture. */
export const BUDGET_KEYS = ['stepMs', 'hashMs', 'captureMs'] as const;
/** One quantity a Node run measures. */
export type PerfKey = (typeof BUDGET_KEYS)[number];
/** What a page measures: `__engine.stats()`'s means, then its counts. */
export const PAGE_KEYS = ['simMs', 'physicsMs', 'animMs', 'renderMs', ...COUNT_KEYS] as const;
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
type Budgets<K extends string = string> = Partial<Record<K, number>>;

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
type Section = { steps: number; budgets?: Budgets; setting?: string; rungs?: Record<string, Budgets> };

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
const SHAPE = `{ scene, steps, budgets: { ${BUDGET_KEYS.join(', ')} }, page: { steps, budgets }, ladder: { setting, steps, rungs }, tolerance, reason }`;

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
  if (problems.length) throw new UsageError(`${path}: ${problems.join('; ')}; a budget file is ${SHAPE}`);
  return budget as unknown as PerfBudget;
}

/** Rounds milliseconds for a report: 4 decimals. */
const ms = (value: number) => Math.round(value * 1e4) / 1e4;

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
    const message = `no ${way} budget for ${scene}: write it in ${file} (${SHAPE})`;
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

/** A page in Chromium (see the file comment). */
async function runPage(root: string, page: string, flags: Flags): Promise<CommandResult> {
  if (flags.runs !== undefined) throw new UsageError('--runs is for Node runs: a page reports its last 60 steps');
  const { file: html } = resolvePage(page);
  if (!existsSync(join(root, html))) throw new UsageError(`there is no ${html} for ${page}`);
  const seed = flags.seed === undefined ? [] : [`seed=${wholeFlag(flags.seed, 'seed', 1)}`];
  const path = pageUrl(page, { scene: flags.scene as string | undefined, set: [...setsOf(flags), ...seed] });
  const target = `${targetSlug(page)}${flags.scene ? `-${String(flags.scene)}` : ''}`;
  const [server, browser] = [await startVite({ root }), await launchBrowser()];
  try {
    const tab = await browser.newPage({ viewport: VIEWPORT });
    const watch = await preparePage(tab, { seed: 1, root });
    await tab.goto(`${server.url}${path}`);
    const signals = await waitReady(tab, watch, READY_MS);
    const runtime = browserRuntime(browser.version());
    const errors = async () => (await watch.errors()).map(pageErrorFinding(page));
    const failures = pageFailures(page, html, signals, await errors());
    if (failures.length || !signals) return { ok: false, summary: `${page} did not start`, target, failures };
    const scene = await tab.evaluate(() => (__engine.info() as { scene: string }).scene);
    let stats: EngineStats | null = null;
    const result = await judged(root, flags, 'page', scene, async (steps, section) => {
      stats = await tab.evaluate(
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
      const row = (name: string, keys: readonly PageKey[]): Row => {
        const values = Object.fromEntries(keys.map((key) => [key, stats?.[key] ?? null]));
        return { name, values, limits: section?.budgets };
      };
      return [row('ms', PAGE_KEYS.slice(0, 4)), row('last frame', COUNT_KEYS)];
    });
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
    'perf <scene|page> [--scene id] [--steps n] [--runs n] [--seed s] [--set k=v…] [--ladder [--agents path]] [--budget]',
  options: {
    scene: { type: 'string' },
    steps: { type: 'string' },
    runs: { type: 'string' },
    seed: { type: 'string' },
    set: { type: 'string', multiple: true },
    ladder: { type: 'boolean' },
    agents: { type: 'string' },
    budget: { type: 'boolean' },
  },
  maxPositionals: 1,
  async run({ values, positionals, root }): Promise<CommandResult> {
    const [target] = positionals;
    if (!target) throw new UsageError('name a scene module (fixtures/scenes/kernel), a scene id, or a page (labs/box)');
    if (values.agents !== undefined && !values.ladder)
      throw new UsageError("--agents names the ladder's setting: add --ladder");
    if (values.ladder) return runNode(root, target, values, 'ladder');
    const path = target.split('?')[0]; // a page: an .html file, or labs/<name> without a scene module of its own
    const page = path.endsWith('.html') || (/^labs\/[^/]+\/?$/.test(path) && !existsSync(join(root, path, 'index.ts')));
    return page ? runPage(root, target, values) : runNode(root, target, values, 'node');
  },
} satisfies Command;
