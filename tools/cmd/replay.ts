/**
 * @file Replays against their golden hashes (PLAN.md §8.4, §6.5 items 8–9, WP 1.5). Usage: node x replay <file|dir…>
 * [--update] [--browser sim] [--bisect] [--runs n] [--swap names]. Exit 0 when every replay gives its goldens in every
 * run (or, recorded elsewhere, agrees with itself; or was recorded), 1 otherwise, 2 on a usage error. The verdict
 * never says "match" unless this platform's goldens were compared. WP 2.7 adds `--browser page` (the scene's page).
 *
 * Each `*.replay.json` (a directory means every one under it) plays from step 0 in Node, `--runs` times (3), and with
 * `--browser sim` as often again in Chromium, in tests/pages/replay.html: the sim in a page, no renderer, through the
 * same player (engine/sim/replay.ts). Every run must give the goldens of this platform (`linux-x64`): one set, valid
 * in Node and in Chromium alike (`judgeRuns`). A replay recorded on another platform only runs at least twice and
 * compares the runs ("golden: other platform"). Its scene module is found from its `scene` id, as `x sim` finds it.
 *
 * `--update` (with `--browser sim`, never `--swap`) records this platform's goldens (0, the replay's checkpoints, else
 * every 60 steps, and the last) and the engine, three.js and Rapier versions. It judges every file and reads the
 * page's errors first, and writes (through Prettier, readable text) only when every run of every file agreed and the
 * page threw nothing. `--bisect` hashes every step of a Node run, a second Node run and, with `--browser sim`, a
 * Chromium run, finds the first step where any two part, and replays both to it: the parts, entities and first field
 * that differ go into the replay's failure (or its line); when one replay fails, every field that differs
 * (`diffStates`) and the inputs applied just before follow. When every run agrees but the goldens differ, the code
 * changed what the sim does: it names the checkpoints between which. `--swap` narrows Chromium's fdlibm swap (`none`,
 * or `sin,pow`): a replay that depends on the swap then fails, and `--bisect` shows where Node and Chromium part.
 *
 * @example
 * parseSwap('sin,pow'); // ['sin', 'pow']: Chromium leaves cos native
 * @see tools/cmd/replay.test.ts
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { SIM_MATH_NAMES, type SimMathName } from '../../engine/core/simMath';
import { checkReplay, firstDifference, judgeRuns, partingOf, type Parting, type Replay } from '../../engine/sim/replay';
import { componentTable, hashState } from '../../engine/sim/state';
import { browserRuntime, describePageError, launchBrowser, preparePage } from '../lib/browser';
import { walk } from '../lib/docs';
import type { Finding } from '../lib/report';
import { startVite } from '../lib/vite';
import { UsageError, type Command, type CommandResult } from '../x';
import { nodeRuntime, resolveSceneModule, wholeFlag, writeReplay, type Runtime } from './sim';

/** This platform's golden key: `linux-x64`. */
export const PLATFORM = `${process.platform}-${process.arch}`;

/** Chromium in tests/pages/replay.html, with its own Vite server, under the swap `swap` names (all by default). */
async function chromium(root: string, swap?: SimMathName[]) {
  const server = await startVite({ root });
  const browser = await launchBrowser();
  const close = async () => {
    await browser.close();
    await server.close();
  };
  try {
    const page = await browser.newPage();
    const watch = await preparePage(page, { seed: 1, root });
    await page.goto(`${server.url}tests/pages/replay.html`);
    const ready = () => (window as { __engine?: { ready?: boolean } }).__engine?.ready === true;
    await page.waitForFunction(ready, undefined, { timeout: 30_000 });
    const runtime: Runtime = {
      name: 'Chromium',
      load: (file) => page.evaluate((path) => window.__replay.load(path), file),
      play: (text, every) =>
        page.evaluate(([t, e, s]) => window.__replay.play(t, { every: e, swap: s }), [text, every, swap] as const),
      stateAt: (text, step) =>
        page.evaluate(([t, k, s]) => window.__replay.stateAt(t, k, { swap: s }), [text, step, swap] as const),
    };
    return { runtime, watch, version: browserRuntime(browser.version()), close };
  } catch (error) {
    await close();
    throw error;
  }
}

/** A run of a replay: which runtime, and the hashes it took. */
export interface Run {
  label: string;
  runtime: Runtime;
  hashes: Record<string, string>;
}

/** Where two runs part: the step, the runs, and what differs there (engine/sim/replay.ts `partingOf`). */
export interface RunParting extends Parting {
  step: number;
  a: string;
  b: string;
  /** True when a view's state does not hash to the hash its runtime gave (it changed in transit). */
  garbled: boolean;
}

/** The first step where any run parts from the first, compared there (`table` reads the components' registry). */
export async function findParting(
  text: string,
  runs: readonly Run[],
  table = componentTable(),
): Promise<RunParting | undefined> {
  let first: { step: number; other: Run } | undefined;
  for (const other of runs.slice(1)) {
    const step = firstDifference(runs[0].hashes, other.hashes);
    if (step !== undefined && (!first || step < first.step)) first = { step, other };
  }
  if (!first) return undefined;
  const a = await runs[0].runtime.stateAt(text, first.step);
  const b = await first.other.runtime.stateAt(text, first.step);
  // Stored states (sent from the page, key order not guaranteed): hash them as stored, not live.
  const garbled = [a, b].some((view) => hashState(view.state, table, false) !== view.hash);
  return { step: first.step, a: runs[0].label, b: first.other.label, ...partingOf(a, b), garbled };
}

/** A value for a line: numbers in full (shortest round trip, `-0` kept), the rest as JSON. */
const exact = (value: unknown) =>
  typeof value === 'number' ? (Object.is(value, -0) ? '-0' : String(value)) : (JSON.stringify(value) ?? 'absent');

/** The lines that tell a parting: the step, parts, entities and first field, then every field and the inputs. */
export function partingLines(name: string, parting: RunParting, replay: Replay): string[] {
  const { step, a, b } = parting;
  const just = replay.inputs.filter(([at]) => at === step - 1).map(([, change]) => JSON.stringify(change));
  const when = step ? `after step ${step}` : 'at step 0 (after setup)';
  const [field] = parting.fields;
  const first = field ? `; first field ${field.path} (${a} ${exact(field.a)}, ${b} ${exact(field.b)})` : '';
  return [
    `${name}: ${a} and ${b} part ${when}: parts ${parting.parts.join(', ') || 'none'}; entities ${parting.entities.join(', ') || 'none'}${first}`,
    ...parting.fields.map((field) => `  ${field.path}: ${a} ${exact(field.a)}, ${b} ${exact(field.b)}`),
    ...(step ? [`  inputs just before (at ${step - 1}): ${just.join(' ') || 'none'}`] : []),
    ...(parting.garbled ? ['  (a state changed in transit from the page: compare the hashes, not the values)'] : []),
  ];
}

/** The replay files a target names: the file, or every `*.replay.json` under the directory. */
export function replayFiles(root: string, target: string): string[] {
  const path = resolve(root, target);
  if (!existsSync(path)) throw new UsageError(`there is no ${target}: name a .replay.json file or a directory of them`);
  if (!statSync(path).isDirectory()) return [path];
  const files = walk(path, '').flatMap((file) => (file.endsWith('.replay.json') ? [join(path, file)] : []));
  if (!files.length) throw new UsageError(`${target} holds no .replay.json file`);
  return files;
}

/** The versions a replay records, from package.json. */
function versions(root: string): Pick<Replay, 'engine' | 'three' | 'rapier'> {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const deps = { ...pkg.dependencies } as Record<string, string>;
  return { engine: pkg.version, three: deps.three, rapier: `simd-compat ${deps['@dimforge/rapier3d-simd-compat']}` };
}

/** How replays are checked. */
export interface ReplayOptions {
  root: string;
  runtimes: Runtime[];
  runs: number;
  update?: boolean;
  bisect?: boolean;
  /** The golden key to check against (`PLATFORM`). */
  platform?: string;
}

/** What one replay came to: its verdict, lines, bisect details, findings, metrics, and goldens to write. */
export interface Outcome {
  verdict?: 'match' | 'other platform' | 'recorded';
  lines: string[];
  /** The bisect's field and input lines, printed when this is the one replay that fails. */
  details: string[];
  failures: Finding[];
  warnings: Finding[];
  metrics: Record<string, number | string>;
  /** `--update`: the replay to write, with the line that tells it (`{state}`: written or unchanged). */
  goldens?: { path: string; replay: Replay; line: string };
}

/** Plays one replay file in every runtime and judges it (see the file comment); writes nothing. */
export async function checkFile(path: string, options: ReplayOptions): Promise<Outcome> {
  const { root, runtimes, platform = PLATFORM } = options;
  const file = relative(root, path);
  const name = basename(path).replace(/\.replay\.json$/, '');
  const out: Outcome = { lines: [], details: [], failures: [], warnings: [], metrics: {} };
  const fail = (id: string, message: string) => (out.failures.push({ id, message, file }), out);
  const text = readFileSync(path, 'utf8');
  let replay: Replay;
  try {
    replay = checkReplay(JSON.parse(text), file);
  } catch (error) {
    return fail('REPLAY_BAD', error instanceof Error ? error.message : String(error));
  }
  const goldens = replay.hashes[platform];
  const elsewhere = Object.keys(replay.hashes).filter((key) => key !== platform);
  const count = !goldens && !options.update && elsewhere.length ? Math.max(2, options.runs) : options.runs;
  const runs: Run[] = [];
  try {
    const module = resolveSceneModule(root, replay.scene);
    for (const runtime of runtimes) {
      await runtime.load(module);
      for (let i = 1; i <= count; i++)
        runs.push({ label: `${runtime.name} run ${i}`, runtime, hashes: await runtime.play(text) });
    }
  } catch (error) {
    return fail('REPLAY_CRASH', `${name} did not play: ${error instanceof Error ? error.message : String(error)}`);
  }
  const tally = runtimes.map((runtime) => `${runtime.name} ×${count}`).join(', ');
  const final = runs[0]?.hashes[replay.steps];
  out.metrics[`${name}.steps`] = replay.steps;
  if (final) out.metrics[`${name}.final`] = final;
  const hashes = runs.map((run) => run.hashes);
  const verdict = judgeRuns(options.update ? { hashes: {} } : replay, hashes, platform);
  const other = 'run' in verdict ? runs[verdict.run] : undefined;
  const step = 'step' in verdict ? verdict.step : 0;
  const update = `node x replay ${file} --browser sim --update`;
  if (options.update && other) {
    fail(
      'REPLAY_UNSTABLE',
      `${name}: ${runs[0].label} and ${other.label} part at step ${step}, so no goldens were written; find where with --bisect`,
    );
  } else if (options.update) {
    out.verdict = 'recorded';
    const line = `${name}: goldens for ${platform} {state} (${Object.keys(hashes[0]).length} checkpoints; ${tally} agree)`;
    const recorded = { ...replay, ...versions(root), hashes: { ...replay.hashes, [platform]: hashes[0] } };
    out.goldens = { path, replay: recorded, line };
  } else if (verdict.golden === 'match') {
    out.verdict = 'match';
    out.lines.push(
      `${name}: ${replay.steps} steps, ${Object.keys(goldens).length} golden hashes, final ${final}: ${tally}, all match`,
    );
  } else if (verdict.golden === 'mismatch' && other) {
    const hint = options.bisect ? '' : `; run --bisect to see where, or ${update} if the change is intended`;
    fail(
      'REPLAY_MISMATCH',
      `${name}: ${other.label} parts from the golden at step ${step} (golden ${goldens[step]}, got ${other.hashes[step] ?? 'no hash'})${hint}`,
    );
  } else if (verdict.golden === 'unstable' && other) {
    fail(
      'REPLAY_UNSTABLE',
      `${name}: golden: other platform (${elsewhere.join(', ')}), and the runs disagree: ${runs[0].label} and ${other.label} part at step ${step}`,
    );
  } else if (verdict.golden === 'other platform') {
    out.verdict = 'other platform';
    const message = `${name}: golden: other platform: recorded on ${elsewhere.join(', ')}, this is ${platform}; ${runs.length} runs agree with each other`;
    out.warnings.push({ id: 'REPLAY_OTHER_PLATFORM', message, file });
    out.lines.push(`${name}: golden: other platform (${elsewhere.join(', ')}); ${runs.length} runs agree`);
  } else fail('REPLAY_NO_GOLDEN', `${name} has no golden hashes: record them with ${update}`);
  const now = versions(root);
  for (const key of ['three', 'rapier'] as const) {
    if (options.update || !replay[key] || replay[key] === now[key]) continue;
    const message = `${name} was recorded with ${key} ${replay[key]}; this is ${now[key]}`;
    out.warnings.push({ id: 'REPLAY_VERSION', message, file });
  }
  if (options.bisect) {
    const [first, ...details] = await bisect(text, replay, name, runtimes, out, goldens);
    for (const failure of out.failures) failure.message += `; bisect: ${first.slice(name.length + 2)}`;
    if (out.failures.length) out.details.push(...details);
    else out.lines.push(first, ...details);
  }
  return out;
}

/** `--bisect`: hashes every step of each runtime (Node twice); the lines that tell where runs part, or the goldens do. */
async function bisect(
  text: string,
  replay: Replay,
  name: string,
  runtimes: Runtime[],
  out: Outcome,
  goldens?: Record<string, string>,
): Promise<string[]> {
  const runs: Run[] = [];
  for (const runtime of runtimes) runs.push({ label: runtime.name, runtime, hashes: await runtime.play(text, true) });
  const again = await runtimes[0].play(text, true);
  runs.splice(1, 0, { label: `${runtimes[0].name} again`, runtime: runtimes[0], hashes: again });
  const parting = await findParting(text, runs);
  if (parting) {
    out.metrics[`${name}.bisect.step`] = parting.step;
    if (parting.entities.length) out.metrics[`${name}.bisect.entity`] = parting.entities[0];
    if (parting.fields.length) out.metrics[`${name}.bisect.field`] = parting.fields[0].path;
    return partingLines(name, parting, replay);
  }
  const off = goldens && firstDifference(goldens, runs[0].hashes);
  if (goldens && off !== undefined) {
    const before = Math.max(
      ...Object.keys(goldens)
        .map(Number)
        .filter((step) => step < off),
    );
    out.metrics[`${name}.bisect.golden`] = off;
    return [
      `${name}: every run agrees step by step, but they part from the goldens between step ${Number.isFinite(before) ? before : 'start'} (matches) and ${off}: the sim's behaviour changed (code, data or a dependency), not a drift; --update if intended, else compare with the commit that recorded them (git log -1 -- <file>)`,
    ];
  }
  return [`${name}: no divergence: ${runs.map((run) => run.label).join(', ')} agree at every step`];
}

/** What `checkFiles` came to: the outcomes' lines, findings and metrics, and each file's verdict. */
export interface Checked extends Omit<Outcome, 'details' | 'goldens' | 'verdict'> {
  verdicts: Outcome['verdict'][];
}

/**
 * Checks every file, then reads `pageErrors` (Chromium's), and only when nothing failed writes the goldens `--update`
 * recorded. Lines: each replay's when all pass; when one fails, its bisect details; when several fail, none (each
 * failure carries its own first bisect line), so the verdict and every failure fit the screen.
 */
export async function checkFiles(
  files: readonly string[],
  options: ReplayOptions & { pageErrors?: () => Promise<Finding[]> },
): Promise<Checked> {
  const outcomes: Outcome[] = [];
  for (const file of files) outcomes.push(await checkFile(file, options));
  const failures = [...outcomes.flatMap((outcome) => outcome.failures), ...((await options.pageErrors?.()) ?? [])];
  const failed = outcomes.filter((outcome) => outcome.failures.length);
  const lines = failures.length ? (failed.length === 1 ? failed[0].details : []) : outcomes.flatMap((o) => o.lines);
  if (failures.length && options.update) lines.unshift('no goldens were written: every file must pass first');
  for (const { goldens } of failures.length ? [] : outcomes) {
    if (!goldens) continue;
    const changed = await writeReplay(options.root, goldens.path, goldens.replay);
    lines.push(goldens.line.replace('{state}', changed ? 'written' : 'unchanged'));
  }
  const warnings = outcomes.flatMap((outcome) => outcome.warnings);
  const metrics = Object.assign({}, ...outcomes.map((outcome) => outcome.metrics));
  return { verdicts: outcomes.map((outcome) => outcome.verdict), lines, failures, warnings, metrics };
}

/** Parses `--swap`: `none`, or names from the swap (`sin,pow`). */
export function parseSwap(value: string | undefined): SimMathName[] | undefined {
  if (value === undefined) return undefined;
  if (value === 'none') return [];
  const names = value.split(',').map((name) => name.trim());
  const bad = names.find((name) => !(SIM_MATH_NAMES as string[]).includes(name));
  if (bad) throw new UsageError(`--swap takes none or names from ${SIM_MATH_NAMES.join(', ')}, not ${bad}`);
  return names as SimMathName[];
}

export default {
  usage: 'replay <file|dir…> [--update] [--browser sim] [--bisect] [--runs n] [--swap names]',
  options: {
    update: { type: 'boolean' },
    browser: { type: 'string' },
    bisect: { type: 'boolean' },
    runs: { type: 'string' },
    swap: { type: 'string' },
  },
  maxPositionals: 100,
  async run({ values, positionals, root }): Promise<CommandResult> {
    if (!positionals.length) throw new UsageError('name replay files or a directory of them (tests/replays)');
    const browserMode = values.browser as string | undefined;
    if (browserMode !== undefined && browserMode !== 'sim') {
      throw new UsageError(`--browser takes sim (the sim-only page; WP 2.7 adds page), not ${browserMode}`);
    }
    const swap = parseSwap(values.swap as string | undefined);
    if (swap && !browserMode) throw new UsageError('--swap narrows the swap in Chromium: use it with --browser sim');
    const update = values.update === true;
    if (update && !browserMode) {
      throw new UsageError('--update records goldens that hold in Node and Chromium alike: add --browser sim');
    }
    if (update && swap) throw new UsageError('--update never records under a narrowed swap: drop --swap or --update');
    const runs = wholeFlag(values.runs, 'runs', 3, 1);
    const files = positionals.flatMap((target) => replayFiles(root, target));
    const runtimes: Runtime[] = [nodeRuntime(root)];
    const page = browserMode ? await chromium(root, swap) : undefined;
    if (page) runtimes.push(page.runtime);
    let all: Checked;
    try {
      const pageErrors = async () =>
        (await page!.watch.errors()).map((error) => ({
          id: 'REPLAY_PAGE_ERROR',
          message: `tests/pages/replay.html threw: ${describePageError(error)}`,
          ...(error.file ? { file: error.file, line: error.line } : {}),
        }));
      const bisect = values.bisect === true;
      all = await checkFiles(files, { root, runtimes, runs, update, bisect, pageErrors: page && pageErrors });
      if (page) {
        const { describeUnlisted, findUnlisted, loadAllowList } = await import('../../tests/setup/adviceTrap');
        for (const warning of findUnlisted(page.watch.console, loadAllowList())) {
          all.warnings.push({
            id: 'REPLAY_CONSOLE',
            message: describeUnlisted([warning], ' in tests/pages/replay.html'),
          });
        }
      }
    } finally {
      await page?.close();
    }
    const where = runtimes.map((runtime) => `${runtime.name} ×${runs}`).join(', ');
    const count = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'}`;
    const match = (n: number) => `${n === 1 ? 'matches its' : 'match their'} golden hashes`;
    const [matched, elsewhere] = ['match', 'other platform'].map((v) => all.verdicts.filter((w) => w === v).length);
    const other = `golden: other platform (${PLATFORM} has no goldens; the runs agree)`;
    const replays = count(files.length, 'replay');
    const verdict = update
      ? `${replays} recorded (${PLATFORM})`
      : !elsewhere
        ? `${replays} ${match(files.length)} (${PLATFORM})`
        : `${replays}${matched ? ` pass: ${matched} ${match(matched)}, ${elsewhere} ` : ': '}${other}`;
    return {
      ok: all.failures.length === 0,
      summary: all.failures.length
        ? `${count(all.failures.length, 'problem')} in ${replays} (${PLATFORM}; ${where})`
        : `${verdict}: ${where}`,
      lines: all.lines,
      browser: page?.version,
      failures: all.failures,
      warnings: all.warnings,
      metrics: { replays: files.length, runs, ...all.metrics },
    };
  },
} satisfies Command;
