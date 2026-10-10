/**
 * @file Runs a scene headless in Node and prints its hash and events (PLAN.md §8.1, WP 1.5): `node x sim <scene>
 * [--scene id] [--steps n] [--seed s] [--set key=value…]`.
 *
 * `<scene>` is a scene module (a `.ts` file, or a directory with `index.ts`, such as `fixtures/scenes/kernel`) or a
 * scene id (`kernel`), found among the modules under `fixtures/scenes/` and `labs/<name>/scenes/` that call
 * `defineScene('<id>', …)` with a literal id. A module that defines several scenes needs `--scene <id>`. `--set`
 * changes a setting for the run (validated against the settings schema; an unknown path names the closest), and the
 * values are recorded in the report's `args` and `metrics`. The run steps with no intents, through a recorded session
 * (engine/sim/replay.ts), so `run.replay.json` beside the report replays it, golden hashes for this platform included
 * (`node x replay out/sim/<id>/run.replay.json`; copy it to tests/replays/ to keep it).
 *
 * Output, at most about 20 lines: the hash; the entities, systems and events (by type, counted from the trace after
 * every step); the settings changed; the trace's per-part digests; the files written. `state.json` holds the final
 * state and trace.
 *
 * Usage: node x sim <scene> [--scene id] [--steps n] [--seed s] [--set k=v…]. Exit 0 when the scene ran, 1 when it
 * threw, 2 on a usage error (no such module or scene, a bad flag or setting).
 *
 * @example
 * parseSets(['kernel.speed=2', 'kernel.movers=3']); // { 'kernel.speed': '2', 'kernel.movers': '3' }
 * @see tools/cmd/sim.test.ts
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { pathToFileURL } from 'node:url';
import { serialize, type Canonical } from '../../engine/core/hash';
import { EngineError } from '../../engine/core/log';
import { createSettings, type SettingValue } from '../../engine/core/settings';
import type { Registry } from '../../engine/core/registry';
import { checkpointsOf, playReplay, REPLAY_KEYS, type Replay, type StepView } from '../../engine/sim/replay';
import { createSession, getScene, isScene, type Scene } from '../../engine/sim/scene';
import { walk } from '../lib/docs';
import { UsageError, type Command, type CommandResult } from '../x';

/** Where scene modules live: `fixtures/scenes/` and every `labs/<name>/scenes/` (tests/pages/replay.ts globs the same). */
export function sceneRoots(root: string): string[] {
  const labs = existsSync(join(root, 'labs')) ? walk(root, 'labs') : [];
  const dirs = new Set(labs.map((file) => /^labs\/[^/]+\/scenes\//.exec(file)?.[0]).filter((dir) => dir !== undefined));
  return ['fixtures/scenes/', ...[...dirs].sort()];
}

/** `defineScene('<id>'` (type arguments allowed), the literal id captured. */
const DEFINES = /\bdefineScene\s*(?:<[^(]*?>)?\s*\(\s*(['"`])([^'"`]+)\1/g;

/** Scene id → the module that defines it, from the modules' text (tests aside). */
export function sceneModules(root: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const dir of sceneRoots(root)) {
    for (const file of walk(root, dir.replace(/\/$/, ''))) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
      for (const match of readFileSync(join(root, file), 'utf8').matchAll(DEFINES)) found.set(match[2], file);
    }
  }
  return found;
}

/** The module a target names: a `.ts` file, a directory's `index.ts`, or the module that defines a scene id. */
export function resolveSceneModule(root: string, target: string): string {
  const path = resolve(root, target);
  if (existsSync(path) && statSync(path).isDirectory() && existsSync(join(path, 'index.ts'))) {
    return relative(root, join(path, 'index.ts'));
  }
  if (existsSync(path) && path.endsWith('.ts')) return relative(root, path);
  const modules = sceneModules(root);
  const file = modules.get(target);
  if (file) return file;
  const known = [...modules.keys()].sort().join(', ') || 'none';
  throw new UsageError(
    `${target} is neither a scene module (a .ts file or a directory with index.ts) nor a scene id (scenes: ${known})`,
  );
}

/** Imports a scene module and picks its scene: `id`, else the one scene it exports. */
export async function loadScene(root: string, target: string, id?: string): Promise<{ file: string; scene: Scene }> {
  const file = resolveSceneModule(root, target);
  const module = (await import(pathToFileURL(join(root, file)).href)) as Record<string, unknown>;
  const exported = [...new Set(Object.values(module).filter(isScene))];
  if (id !== undefined) {
    try {
      return { file, scene: getScene(id) };
    } catch (error) {
      if (error instanceof EngineError) throw new UsageError(error.message);
      throw error;
    }
  }
  if (exported.length === 1) return { file, scene: exported[0] };
  const ids = exported.map((scene) => scene.id).join(', ');
  throw new UsageError(
    exported.length
      ? `${file} defines ${ids}: name one with --scene <id>`
      : `${file} exports no scene (export default defineScene(…))`,
  );
}

/** `key=value` pairs as path → text; throws `UsageError` for a pair without `=`. */
export function parseSets(pairs: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of pairs) {
    const at = pair.indexOf('=');
    if (at <= 0) throw new UsageError(`--set takes key=value, not ${JSON.stringify(pair)}`);
    out[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return out;
}

/** `--set` values typed and checked against the settings schema (after the scene module declared its settings). */
export function typedSets(pairs: readonly string[]): Record<string, SettingValue> {
  const store = createSettings();
  const out: Record<string, SettingValue> = {};
  for (const [path, text] of Object.entries(parseSets(pairs))) {
    try {
      out[path] = store.setText(path, text).value;
    } catch (error) {
      if (error instanceof EngineError) throw new UsageError(`--set ${path}=${text}: ${error.message}`);
      throw error;
    }
  }
  return out;
}

/** A whole number from a flag, at least `min`, or `fallback` when the flag is absent. */
export function wholeFlag(value: unknown, name: string, fallback: number, min = 0): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min)
    throw new UsageError(`--${name} takes a whole number, ${min} or more, not ${String(value)}`);
  return n;
}

/** One run's view of a step, with the hash its runtime gave. */
export interface HashedView extends StepView {
  hash: string;
}

/** Where replays play: Node in this process, or Chromium in tests/pages/replay.html. */
export interface Runtime {
  name: string;
  /** Imports a scene module by repository path. */
  load(file: string): Promise<void>;
  /** Plays a replay's text: the hashes of its checkpoints, or of every step. */
  play(text: string, every?: boolean): Promise<Record<string, string>>;
  /** Plays a replay's text to `step` and returns its view there. */
  stateAt(text: string, step: number): Promise<HashedView>;
}

/** Replays in Node, in this process, on `registry` (the shared one by default): `x replay`'s first runtime. */
export function nodeRuntime(root: string, registry?: Registry, name = 'Node'): Runtime {
  return {
    name,
    load: async (file) => void (await import(pathToFileURL(join(root, file)).href)),
    play: async (text, every) =>
      playReplay(JSON.parse(text), { registry, checkpoints: every ? 'every' : undefined }).hashes,
    async stateAt(text, step) {
      const { world } = playReplay(JSON.parse(text), { registry, until: step, checkpoints: [] }).session;
      return { state: world.state(), trace: world.trace(), hash: world.hash() };
    },
  };
}

/**
 * A replay as readable text: its keys in file order, one change-point per line, each platform's hashes one step per
 * line, numbers exact (`-0` kept, engine/core/hash.ts `serialize`). Prettier leaves the layout as it is.
 */
export function replayText(replay: Replay): string {
  const block = (lines: string[], indent: string) =>
    lines.length ? `\n${lines.map((line) => indent + line).join(',\n')}\n${indent.slice(2)}` : '';
  const hashes = Object.keys(replay.hashes)
    .sort()
    .map((platform) => {
      const marks = replay.hashes[platform];
      const steps = Object.keys(marks).sort((a, b) => Number(a) - Number(b));
      return `${JSON.stringify(platform)}: {${block(
        steps.map((step) => `"${step}": "${marks[step]}"`),
        '      ',
      )}}`;
    });
  const fields = REPLAY_KEYS.filter((key) => replay[key] !== undefined).map((key) => {
    if (key === 'inputs') {
      const points = replay.inputs.map(([step, change]) => `[${step}, ${serialize(change as Canonical)}]`);
      return `"inputs": [${block(points, '    ')}]`;
    }
    if (key === 'hashes') return `"hashes": {${block(hashes, '    ')}}`;
    return `${JSON.stringify(key)}: ${serialize(replay[key] as Canonical)}`;
  });
  return `{${block(fields, '  ')}}\n`;
}

/** Writes a replay through Prettier with the repository's settings (wherever the file is); true when it changed. */
export async function writeReplay(root: string, path: string, replay: Replay): Promise<boolean> {
  const config = await resolveConfig(join(root, 'package.json'));
  const text = await format(replayText(replay), { ...config, parser: 'json' });
  if (existsSync(path) && readFileSync(path, 'utf8') === text) return false;
  writeFileSync(path, text);
  return true;
}

export default {
  usage: 'sim <scene> [--scene id] [--steps n] [--seed s] [--set k=v…]',
  options: {
    scene: { type: 'string' },
    steps: { type: 'string' },
    seed: { type: 'string' },
    set: { type: 'string', multiple: true },
  },
  maxPositionals: 1,
  async run({ values, positionals, root }): Promise<CommandResult> {
    const [target] = positionals;
    if (!target) throw new UsageError('name a scene module (fixtures/scenes/kernel) or a scene id');
    const { file, scene } = await loadScene(root, target, values.scene as string | undefined);
    const steps = wholeFlag(values.steps, 'steps', 600);
    const seed = wholeFlag(values.seed, 'seed', 1);
    const sets = typedSets((values.set as string[] | undefined) ?? []);
    const session = createSession(scene, { seed, settings: sets });
    const { world } = session;
    const events: Record<string, number> = {};
    let seen = world.events.trace().at(-1)?.seq ?? 0;
    const checkpoints = new Set(checkpointsOf({ steps, hashes: {} }));
    const hashes: Record<string, string> = { 0: world.hash() };
    const started = performance.now();
    for (let k = 1; k <= steps; k++) {
      session.step({});
      for (const record of world.events.trace()) {
        if (record.seq > seen) events[record.type] = (events[record.type] ?? 0) + 1;
      }
      seen = world.events.trace().at(-1)?.seq ?? seen;
      if (checkpoints.has(k)) hashes[k] = world.hash();
    }
    const stepMs = steps ? (performance.now() - started) / steps : 0;
    const hash = world.hash();
    const trace = world.trace();
    const out = join('out', 'sim', scene.id);
    mkdirSync(join(root, out), { recursive: true });
    const platform = `${process.platform}-${process.arch}`;
    const replay = { ...session.record(), description: `x sim ${target}`, hashes: { [platform]: hashes } };
    writeFileSync(join(root, out, 'run.replay.json'), replayText(replay));
    writeFileSync(
      join(root, out, 'state.json'),
      `${serialize({ state: world.state(), trace } as unknown as Canonical)}\n`,
    );
    const eventLine = Object.entries(events).sort(([a], [b]) => (a < b ? -1 : 1));
    const setLine = Object.entries(sets).map(([path, value]) => `${path}=${JSON.stringify(value)}`);
    return {
      ok: true,
      target: scene.id,
      summary: `${scene.id}: ${steps} steps, seed ${seed}, hash ${hash}`,
      lines: [
        `module: ${file}`,
        `entities: ${world.count}; systems: ${world.systems
          .list()
          .map((system) => system.name)
          .join(', ')}`,
        `events: ${eventLine.map(([type, n]) => `${type} ${n}`).join(', ') || 'none'}`,
        `settings: ${setLine.join(', ') || "the scene's"}`,
        `step: ${stepMs.toFixed(4)} ms on average (Node, this run; x perf measures properly)`,
        `trace: ${Object.entries(trace.parts)
          .map(([part, digest]) => `${part} ${digest}`)
          .join(', ')}`,
        `files: ${out}/state.json, ${out}/run.replay.json`,
      ],
      metrics: {
        hash,
        steps,
        seed,
        entities: world.count,
        stepMs: Math.round(stepMs * 1e4) / 1e4,
        ...Object.fromEntries(eventLine.map(([type, n]) => [`events.${type}`, n])),
        ...Object.fromEntries(
          Object.entries(sets).map(([path, value]) => [`set.${path}`, serialize(value as Canonical)]),
        ),
      },
      artifacts: [
        {
          path: `${out}/state.json`,
          kind: 'json',
          describes: `the final state and trace of ${scene.id} after ${steps} steps`,
        },
        {
          path: `${out}/run.replay.json`,
          kind: 'json',
          describes: `this run as a replay, with this platform's hashes`,
        },
      ],
    };
  },
} satisfies Command;
