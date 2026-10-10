/**
 * @file Replays (PLAN.md §8.4, §6.5 items 3 and 6–9, WP 1.5; doctrine: Reproducible): the readable replay format and
 * its checks, the player that `x replay` and tests/pages/replay.html run, and the comparison of runs that `x replay`
 * judges and bisects with. A replay is text: a scene, its settings and seed, the step rate, the step count, the
 * inputs as change-points, and golden hashes keyed by platform (`linux-x64`), one set valid in Node and in Chromium
 * alike. tests/replays/README.md shows one; a session records one (engine/sim/scene.ts `createSession`).
 *
 * Change-points: `[k, change]` applies after k steps, before step k + 1: its `set` values first (settings, never
 * `view` ones), then its dev action (`dev`, with plain-data `args`, the scene's `actions`), then its intent keys
 * (engine/input/intents.ts: held keys repeat until changed, `null` clears one, `p` belongs to its step). Several
 * points may share a step; they apply in file order. A hash keyed `"k"` is the state after k steps, before the inputs
 * at k, as a live session hashes at its checkpoints (0, every 60 steps by default, and the last).
 *
 * `playReplay` drives a session from the change-points, so a played replay records itself again, point for point.
 * Every value is checked first (`SIM_BAD_REPLAY` naming the path and the closest key), unknown keys included.
 * `judgeRuns` gives the verdict on runs (golden match or mismatch; on another platform, the runs against each other)
 * and `firstDifference` plus `partingOf` say where two runs part: the step, then the parts, entities and fields.
 *
 * @example
 * import { createRegistry } from '../core/registry';
 * import { createSession, defineScene } from './scene';
 * const reg = createRegistry();
 * defineScene('walk', { setup: (w) => w.spawn(), step: (w, i) => void w.rng('walk').next() }, reg);
 * const live = createSession('walk', { seed: 2, registry: reg });
 * live.step({ move: [0, 1] });
 * const replay = { ...live.record(), hashes: { here: { 1: live.world.hash() } } };
 * const runs = [0, 1, 2].map(() => playReplay(replay, { registry: reg }).hashes);
 * judgeRuns(replay, runs, 'here'); // { golden: 'match' }
 * judgeRuns(replay, runs, 'there'); // { golden: 'other platform', platforms: ['here'] }
 * @see engine/sim/replay.test.ts
 */
import { serialize, type Canonical } from '../core/hash';
import { codeError, defineCodes, didYouMean } from '../core/log';
import { registry as sharedRegistry } from '../core/registry';
import { isPlainObject, show } from '../core/schema';
import type { SettingValue } from '../core/settings';
import {
  applyIntents,
  INTENT_KEYS,
  NO_INTENTS,
  normalizeIntents,
  type IntentChanges,
  type Intents,
} from '../input/intents';
import { createSession, type SceneOptions, type Session } from './scene';
import { diffStates, type StateDifference, type WorldState, type WorldTrace } from './state';

/** The codes this module raises, with their fixes. */
export const REPLAY_CODES = defineCodes('sim', {
  SIM_BAD_REPLAY: {
    template: '{where}: {problem}',
    fix: 'write the replay as tests/replays/README.md shows ({ format, scene, settings, seed, hz, steps, inputs: [[step, change]…], hashes: { platform: { step: hash } } }), or record it from a session; settings marked view never go in a replay',
    doc: "Raised by `checkReplay` and `playReplay` (engine/sim/replay.ts) before a step runs: an unknown key (named with the closest), a wrong format tag, a change-point out of order or at or past `steps`, a bad intent, setting or dev action, a hash that is not 16 hex digits, a step rate other than the world's, or a view setting.",
  },
});

/** The replay format tag; a change to what replays hold changes it. */
export const REPLAY_FORMAT = 'my3dge-replay/1';
/** Steps between checkpoint hashes when a replay names none (§6.5 item 6). */
export const CHECKPOINT_STEPS = 60;

/** One change-point's content: intent keys, setting values and a dev action. */
export type InputChange = IntentChanges & {
  set?: Record<string, SettingValue>;
  dev?: string;
  args?: Canonical;
};

/** A change-point: after `step` steps, before the next. */
export type InputEntry = [step: number, change: InputChange];

/** A replay, as its file holds it (PLAN.md §8.4). */
export interface Replay {
  format: typeof REPLAY_FORMAT;
  /** What it shows or tests. */
  description?: string;
  /** The engine's, three.js's and Rapier's versions it was recorded with. */
  engine?: string;
  three?: string;
  rapier?: string;
  /** The scene id (engine/sim/scene.ts). */
  scene: string;
  /** Setting values over the scene's at step 0, path → value. */
  settings: Record<string, SettingValue>;
  seed: number;
  /** Sim steps per second it was recorded at. */
  hz: number;
  /** How many steps it runs. */
  steps: number;
  inputs: InputEntry[];
  /** Golden hashes: platform → step → 16 hex digits. */
  hashes: Record<string, Record<string, string>>;
}

/** The keys a replay has, in file order. */
export const REPLAY_KEYS = 'format description engine three rapier scene settings seed hz steps inputs hashes'.split(
  ' ',
) as (keyof Replay)[];
/** The keys of a change-point besides the intents. */
const CHANGE_KEYS = ['set', 'dev', 'args'];
const HEX16 = /^[0-9a-f]{16}$/;

/** The problems of plain data that a text replay cannot hold, as `serialize` reports them. */
function textProblem(value: unknown, path: string): string | undefined {
  try {
    serialize(value as Canonical);
    return undefined;
  } catch (error) {
    return `${path} cannot be written as text (${error instanceof Error ? error.message.split(':')[0] : String(error)})`;
  }
}

/** The problems of one change-point. */
function changeProblems(change: unknown, path: string, out: string[]): void {
  if (!isPlainObject(change)) return void out.push(`${path} is ${show(change)}; a change-point holds an object`);
  const intents: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(change)) {
    if (Object.hasOwn(INTENT_KEYS, key) || key.includes(':')) intents[key] = value;
    else if (!CHANGE_KEYS.includes(key)) {
      out.push(`${path}: unknown key ${show(key)}${didYouMean(key, [...Object.keys(INTENT_KEYS), ...CHANGE_KEYS])}`);
    }
  }
  try {
    normalizeIntents(intents);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    out.push(`${path}: ${message.replace(/^\[\w+\] intents: /, '').replace(/: give intents as[\s\S]*$/, '')}`);
  }
  if (change.set !== undefined && (!isPlainObject(change.set) || !Object.keys(change.set).length)) {
    out.push(`${path}.set is ${show(change.set)}; it holds setting values, path → value`);
  }
  if (change.dev !== undefined && (typeof change.dev !== 'string' || !change.dev)) {
    out.push(`${path}.dev is ${show(change.dev)}; it names one of the scene's actions`);
  }
  if (change.args !== undefined && change.dev === undefined) out.push(`${path}.args has no dev action to go with`);
  const text = textProblem(change, path);
  if (text) out.push(text);
}

/** Checks a replay's whole shape and returns it typed; throws `SIM_BAD_REPLAY` listing the first problems. */
export function checkReplay(value: unknown, where = 'the replay'): Replay {
  const problems: string[] = [];
  const fail = (problem: string) => problems.push(problem);
  if (!isPlainObject(value))
    throw codeError('SIM_BAD_REPLAY', { where, problem: `it is ${show(value)}, not an object` });
  for (const key of Object.keys(value)) {
    if (!(REPLAY_KEYS as string[]).includes(key)) fail(`unknown key ${show(key)}${didYouMean(key, REPLAY_KEYS)}`);
  }
  if (value.format !== REPLAY_FORMAT) fail(`its format is ${show(value.format)}, not ${show(REPLAY_FORMAT)}`);
  for (const key of ['description', 'engine', 'three', 'rapier'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'string') fail(`${key} is ${show(value[key])}; it is text`);
  }
  if (typeof value.scene !== 'string' || !value.scene) fail(`scene is ${show(value.scene)}; it names a scene id`);
  if (!isPlainObject(value.settings))
    fail(`settings is ${show(value.settings)}; it holds setting values, path → value`);
  else fail(textProblem(value.settings, 'settings') ?? '');
  if (typeof value.seed !== 'number' || !Number.isFinite(value.seed)) fail(`seed is ${show(value.seed)}`);
  if (!Number.isInteger(value.hz) || (value.hz as number) < 1)
    fail(`hz is ${show(value.hz)}; steps per second, 1 or more`);
  const steps = value.steps as number;
  if (!Number.isInteger(steps) || steps < 0) fail(`steps is ${show(steps)}; a whole number of steps`);
  if (!Array.isArray(value.inputs)) fail(`inputs is ${show(value.inputs)}; a list of [step, change] points`);
  else {
    let last = 0;
    value.inputs.forEach((entry: unknown, i) => {
      const path = `inputs[${i}]`;
      if (!Array.isArray(entry) || entry.length !== 2)
        return void fail(`${path} is ${show(entry)}; each is [step, change]`);
      const [step, change] = entry as [unknown, unknown];
      if (!Number.isInteger(step) || (step as number) < last || (step as number) >= steps) {
        fail(
          steps > 0
            ? `${path}'s step ${show(step)} must be a whole number from ${last} (the one before) to ${steps - 1}`
            : `${path}: a replay of ${show(steps)} steps has no step for a change-point`,
        );
      } else last = step as number;
      changeProblems(change, `${path}[1]`, problems);
    });
  }
  if (!isPlainObject(value.hashes)) fail(`hashes is ${show(value.hashes)}; platform → { step: hash }`);
  else {
    for (const [platform, marks] of Object.entries(value.hashes)) {
      if (!isPlainObject(marks)) {
        fail(`hashes.${platform} is ${show(marks)}; step → hash`);
        continue;
      }
      for (const [step, hash] of Object.entries(marks)) {
        if (!/^\d+$/.test(step) || Number(step) > steps)
          fail(`hashes.${platform} has the step ${show(step)}; 0 to ${steps}`);
        if (typeof hash !== 'string' || !HEX16.test(hash))
          fail(`hashes.${platform}.${step} is ${show(hash)}; 16 hex digits`);
      }
    }
  }
  const real = problems.filter(Boolean);
  if (real.length) {
    const shown = real.slice(0, 4).join('; ') + (real.length > 4 ? `; and ${real.length - 4} more` : '');
    throw codeError('SIM_BAD_REPLAY', { where, problem: shown });
  }
  return value as unknown as Replay;
}

/** The steps a replay hashes: those its goldens name (every platform's), else 0, every 60 and the last. */
export function checkpointsOf(replay: Pick<Replay, 'steps' | 'hashes'>): number[] {
  const named = new Set(Object.values(replay.hashes).flatMap((marks) => Object.keys(marks).map(Number)));
  if (!named.size) {
    for (let k = 0; k < replay.steps; k += CHECKPOINT_STEPS) named.add(k);
    named.add(replay.steps);
  }
  return [...named].sort((a, b) => a - b);
}

/** How a replay plays: where its scene is, which steps to hash, and where to stop. */
export interface PlayOptions extends Omit<SceneOptions, 'seed' | 'settings'> {
  /** The steps to hash: `'every'`, a list, or by default `checkpointsOf(replay)`. */
  checkpoints?: readonly number[] | 'every';
  /** Stop after this many steps (the replay's `steps` by default). */
  until?: number;
}

/** A played replay: its session (at the step it stopped) and the hashes it took, by step. */
export interface Playback {
  session: Session;
  hashes: Record<string, string>;
}

/** Plays a replay (checked first) from step 0 and hashes its checkpoints. Throws `SIM_BAD_REPLAY`. */
export function playReplay(value: unknown, options: PlayOptions = {}): Playback {
  const replay = checkReplay(value);
  const registry = options.registry ?? sharedRegistry;
  const views = [
    ...Object.keys(replay.settings),
    ...replay.inputs.flatMap(([, change]) => Object.keys(change.set ?? {})),
  ].filter((path) => registry.has('setting', path) && registry.get('setting', path).view === true);
  if (views.length) {
    const problem = `${views.map(show).join(', ')} ${views.length > 1 ? 'are' : 'is'} marked view, which never changes play`;
    throw codeError('SIM_BAD_REPLAY', { where: `the replay of ${replay.scene}`, problem });
  }
  const { checkpoints, until = replay.steps, ...rest } = options;
  const session = createSession(replay.scene, { ...rest, seed: replay.seed, settings: replay.settings });
  if (session.world.hz !== replay.hz) {
    const problem = `it was recorded at ${replay.hz} Hz; the world steps at ${session.world.hz} Hz (time.hz)`;
    throw codeError('SIM_BAD_REPLAY', { where: `the replay of ${replay.scene}`, problem });
  }
  const marks = checkpoints === 'every' ? undefined : new Set(checkpoints ?? checkpointsOf(replay));
  const hashes: Record<string, string> = {};
  let at = 0;
  let intents: Intents = NO_INTENTS;
  for (let k = 0; k <= until; k++) {
    if (!marks || marks.has(k)) hashes[k] = session.world.hash();
    if (k === until) break;
    let change: IntentChanges = {};
    for (; at < replay.inputs.length && replay.inputs[at][0] === k; at++) {
      const { set, dev, args, ...keys } = replay.inputs[at][1];
      for (const [path, setting] of Object.entries(set ?? {})) session.set(path, setting);
      if (dev !== undefined) session.act(dev, args);
      change = { ...change, ...keys };
    }
    intents = applyIntents(intents, change, `the replay's inputs at step ${k}`);
    session.step(intents);
  }
  return { session, hashes };
}

/** The first step at which two runs' hashes differ, over the steps both took; undefined when they agree. */
export function firstDifference(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>) {
  const steps = Object.keys(a).filter((step) => step in b);
  return steps
    .map(Number)
    .sort((x, y) => x - y)
    .find((step) => a[step] !== b[step]);
}

/** One run's view of a step, as `x replay --bisect` compares two. */
export interface StepView {
  state: WorldState;
  trace: WorldTrace;
}

/** Where two runs part at one step: the parts and entities whose trace digests differ, and the first fields. */
export interface Parting {
  parts: string[];
  entities: number[];
  fields: StateDifference[];
}

/** Compares two runs' views of the same step: `trace()` digests by part and entity, then `diffStates`. */
export function partingOf(a: StepView, b: StepView, limit = 6): Parting {
  const differ = (x: Record<string, string>, y: Record<string, string>) =>
    [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((key) => x[key] !== y[key]);
  return {
    parts: differ(a.trace.parts, b.trace.parts).sort(),
    entities: differ(a.trace.entities, b.trace.entities)
      .map(Number)
      .sort((x, y) => x - y),
    fields: diffStates(a.state, b.state, limit),
  };
}

/**
 * The verdict on runs of a replay (§6.5 item 8): against this platform's goldens when it has them (`mismatch` names
 * the first run and step that miss), else, when another platform recorded it, the runs against each other
 * (`other platform`, or `unstable` naming the first run that parts from run 0), else `none`.
 */
export type Verdict =
  | { golden: 'match' | 'none' }
  | { golden: 'mismatch' | 'unstable'; run: number; step: number }
  | { golden: 'other platform'; platforms: string[] };

/** Judges runs (their hashes) of `replay` on `platform` (see `Verdict`). */
export function judgeRuns(replay: Pick<Replay, 'hashes'>, runs: readonly Record<string, string>[], platform: string) {
  const goldens = replay.hashes[platform];
  const against = goldens ?? runs[0];
  for (const [run, hashes] of runs.entries()) {
    const step =
      firstDifference(against, hashes) ??
      Object.keys(against)
        .map(Number)
        .find((k) => !(k in hashes));
    if (step !== undefined) return { golden: goldens ? 'mismatch' : 'unstable', run, step } as Verdict;
  }
  const platforms = Object.keys(replay.hashes).filter((key) => key !== platform);
  return (
    goldens ? { golden: 'match' } : platforms.length ? { golden: 'other platform', platforms } : { golden: 'none' }
  ) as Verdict;
}
