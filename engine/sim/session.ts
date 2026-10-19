/**
 * @file Sessions (PLAN.md §8.4, WP 1.5; doctrines: Reproducible, Agent-operable): `createSession(scene, options)`
 * starts a scene (engine/sim/scene.ts `startScene`) that records its inputs from step 0, the recorder of PLAN.md §8.4.
 * The kernel fixture, the box's scenes and `createHeadless` (WP 1.6) all record through it; engine/sim/replay.ts plays
 * what it records.
 *
 * A session logs, each at the step it happens (merged in play order: set, then dev, then intents), what its intents
 * change (a step the world does not count logs nothing), every non-view setting change (through `set` or its own store,
 * `session.settings`), and its dev actions (`act`: the scene's own, else the engine's, engine/sim/devActions.ts; all or
 * nothing: one that throws is rolled back; an unknown one is `SIM_NO_ACTION`). `record()` returns the replay from step
 * 0; change-points no step has followed yet wait for it.
 * Step, capture and restore through the session, never the world (`SIM_OFF_RECORD`): `session.restore` takes the
 * recording back to the capture's step with the sim, so `record()` replays the run as it stands; it refuses a capture
 * it did not take (`SIM_FOREIGN_CAPTURE`) or one changed since (`SIM_EDITED_CAPTURE`). `Session` says the rest.
 *
 * Invariants: the recording is plain data, from step 0, and replays to the same hashes (engine/sim/replay.ts); view
 * settings are never recorded. Split from scene.ts to keep each under 400 lines (ADR-0014 amendment 16).
 *
 * @example
 * import { createRegistry } from '../core/registry';
 * import { defineScene } from './scene';
 * const reg = createRegistry();
 * defineScene('demo', { description: 'Spawns one.', setup: (w) => w.spawn() }, reg);
 * const live = createSession('demo', { registry: reg });
 * live.step({ move: [0, 1] });
 * live.step({ move: [0, 1], b: ['jump'] });
 * live.record().inputs; // [[0, { move: [0, 1] }], [1, { b: ['jump'] }]]
 * @see engine/sim/scene.test.ts
 */
import type { EventMap } from '../core/events';
import { deserialize, hashValue, serialize, type Canonical } from '../core/hash';
import { codeError, defineCodes, didYouMean } from '../core/log';
import { registry as sharedRegistry, sameValue } from '../core/registry';
import { show } from '../core/schema';
import type { SettingChange, SettingValue } from '../core/settings';
import { diffIntents, INTENT_KEYS, NO_INTENTS, normalizeIntents, type Intents } from '../input/intents';
import type { WorldCapture } from './capture';
import type { InputChange, InputEntry, Replay } from './replay';
import { changesSim, devArgs, findDevAction, listDevActions } from './devActions';
import { checkSeed, startScene, type SceneOptions, type SceneRun } from './scene';
import type { AnyComponents } from './state';

/** The codes this module raises, with their fixes. */
export const SESSION_CODES = defineCodes('sim', {
  SIM_NO_ACTION: {
    template: 'the scene {scene} has no dev action {name} ({suggestion})',
    fix: "add it to the scene, defineScene('{scene}', { actions: { {name}(w, args) { … } } }), or to the engine's, defineDevAction('{name}', { help, run }) (engine/sim/devActions.ts); or call one there is",
  },
  SIM_OFF_RECORD: {
    template: 'the world took {count} steps outside its session, so the recording misses their intents',
    fix: 'step a recorded scene through session.step(intents), never world.step(); capture and restore it through session.capture() and session.restore(capture), never the world',
  },
  SIM_FOREIGN_CAPTURE: {
    template: 'restore() was given a capture the session of {scene} did not take',
    fix: "restore what this session's capture() (__engine.capture()) returned, the object itself: the session knows where its recording stood then; the world's own captures, another session's and copies have no place in it, so reach other state by starting the scene again (__engine.seed(n)) or playing a replay",
  },
  SIM_EDITED_CAPTURE: {
    template: 'the capture the session of {scene} took at step {step} was changed since (it hashes {now}, not {then})',
    fix: 'restore it unchanged, then make the change through the session so record() replays it: session.set(path, value) (__engine.set) for a setting, a dev action (session.act(name, args)) for components',
  },
});

/**
 * A started scene that records its inputs from step 0, so `record()` returns it as a replay. `step(intents)`
 * normalizes the intents against the step before and logs what changed. Setting changes through the store
 * (`settings`: set, setText, load, fromUrl, reset, override) are logged as `set` points: before each `set`, `act` and
 * `step`, the session compares the store's non-view values with the last ones it saw. `act` captures the world, runs
 * the action inside `w.run` and, if it throws, restores the capture and logs nothing; else it logs it with its args.
 */
export interface Session<C extends object = AnyComponents, E extends EventMap = EventMap> extends SceneRun<C, E> {
  /** Steps taken through the session. */
  readonly steps: number;
  /** The intents the last step got. */
  readonly intents: Intents;
  /** The change-points so far. */
  readonly inputs: readonly InputEntry[];
  /** One step with these intents, normalized; recorded once the world counts it. Throws `INPUT_BAD_INTENTS`. */
  step(intents?: unknown): Intents;
  /** Sets a setting between steps; a non-view change is recorded at this step (as is any change through `settings`). */
  set(path: string, value: unknown): SettingChange;
  /**
   * Runs the dev action `name` between steps, the scene's own or else the engine's (engine/sim/devActions.ts: its args
   * checked, its settings set, then its run), all or nothing, then records it. Throws `SIM_NO_ACTION`, or
   * `CORE_BAD_SPEC` for args its schema refuses.
   */
  act(name: string, args?: unknown): void;
  /** The whole sim, copied (`world.capture()`), with where the recording stands: what `restore` takes. */
  capture(): WorldCapture;
  /**
   * Puts back a capture this session took, unchanged, with its recording (change-points, steps, intents) as it stood
   * then. Throws `SIM_FOREIGN_CAPTURE` or `SIM_EDITED_CAPTURE` (or the world's `SIM_BAD_CAPTURE`), changing nothing.
   */
  restore(capture: WorldCapture): void;
  /** The replay of every step so far, from step 0, without hashes. Throws `SIM_OFF_RECORD`. */
  record(): Replay;
}

/** Where a session's recording stood at a capture (change-points as text: the last may change since) and its digest. */
type Mark = { steps: number; inputs: string; last: Intents; seen: Record<string, SettingValue>; hash: string };

/** The digest of a capture's data, or a note when it no longer is plain data. */
function digest(capture: WorldCapture): string {
  try {
    return hashValue(capture as unknown as Canonical);
  } catch {
    return 'no hash (no longer plain data)';
  }
}

/** Starts a scene as a recorded session: `startScene`, plus the recording. */
export function createSession<C extends object = AnyComponents, E extends EventMap = EventMap>(
  scene: Parameters<typeof startScene<C, E>>[0],
  options: SceneOptions = {},
): Session<C, E> {
  const run = startScene<C, E>(scene, { ...options, seed: checkSeed(options.seed, 'createSession(scene, { seed })') });
  const { world, settings } = run;
  const registry = options.registry ?? sharedRegistry;
  const viewOf = (path: string) => registry.get('setting', path).view === true;
  const start = Object.fromEntries(Object.entries(options.settings ?? {}).filter(([path]) => !viewOf(path)));
  const inputs: InputEntry[] = [];
  let last: Intents = NO_INTENTS;
  let steps = 0;
  let seen = settings.sim.values();
  const marks = new WeakMap<WorldCapture, Mark>();
  /** The change-point to write a `what` into at step `at`: the last one when the play order allows, else a new one. */
  const pointFor = (what: 'set' | 'dev' | 'intents', at = world.tick): InputChange => {
    const tail = inputs[inputs.length - 1];
    if (tail && tail[0] === at) {
      const change = tail[1];
      const intents = Object.keys(change).some((key) => Object.hasOwn(INTENT_KEYS, key) || key.includes(':'));
      if (!intents && (what === 'intents' || change.dev === undefined)) return change;
    }
    const change: InputChange = {};
    inputs.push([at, change]);
    return change;
  };
  /** Logs every non-view value the store holds that differs from the last ones seen, as a `set` at this step. */
  const sync = () => {
    const now = settings.sim.values();
    for (const [path, value] of Object.entries(now)) {
      const before = Object.hasOwn(seen, path) ? seen[path] : registry.get('setting', path).default;
      if (sameValue(before, value)) continue;
      const point = pointFor('set');
      point.set = { ...point.set, [path]: deserialize(serialize(value as Canonical)) as SettingValue };
    }
    seen = now;
  };
  const session: Session<C, E> = {
    ...run,
    get steps() {
      return steps;
    },
    get intents() {
      return last;
    },
    inputs,
    step(raw = {}) {
      const next = normalizeIntents(raw, last);
      sync();
      const at = world.tick;
      try {
        world.step(next);
      } finally {
        if (world.tick !== at) {
          const change = diffIntents(last, next);
          if (Object.keys(change).length) Object.assign(pointFor('intents', at), change);
          [last, steps] = [next, steps + 1];
        }
      }
      return next;
    },
    set(path, value) {
      sync();
      const change = settings.set(path, value);
      sync();
      return change;
    },
    act(name, args) {
      const actions = run.scene.actions as Record<string, (w: unknown, a: unknown) => void>;
      const own = Object.hasOwn(actions, name) && typeof actions[name] === 'function' ? actions[name] : undefined;
      const engine = own ? undefined : findDevAction(registry, name);
      if (!own && !engine) {
        const names = [...new Set([...Object.keys(actions), ...listDevActions(registry).map((a) => a.id)])].sort();
        const near = didYouMean(name, names).trim().slice(1, -1);
        const suggestion = near || (names.length ? `its actions: ${names.map(show).join(', ')}` : 'it has none');
        throw codeError('SIM_NO_ACTION', { scene: run.scene.id, name: show(name), suggestion });
      }
      const text = args === undefined ? undefined : serialize(args as Canonical);
      const given = () => (text === undefined ? undefined : deserialize(text));
      const checked = engine ? devArgs(engine, given(), name) : {}; // before anything changes
      sync();
      const before = world.capture(); // the sim and its recorded settings: a throw puts both back
      try {
        for (const [path, value] of Object.entries(engine?.settings(checked) ?? {})) settings.set(path, value);
        if (own) world.run((w) => own(w, given()));
        else if (engine && changesSim(engine)) world.run((w) => engine.run(w as never, checked));
      } catch (error) {
        world.restore(before);
        throw error;
      }
      sync();
      if (!own && !changesSim(engine!)) return; // settings alone: recorded as set (view ones never)
      Object.assign(pointFor('dev'), { dev: name }, text === undefined ? {} : { args: deserialize(text) });
    },
    capture() {
      sync();
      const capture = world.capture();
      const text = serialize(inputs as unknown as Canonical);
      marks.set(capture, { steps, inputs: text, last, seen, hash: digest(capture) });
      return capture;
    },
    restore(capture) {
      const mark = marks.get(capture);
      if (!mark) throw codeError('SIM_FOREIGN_CAPTURE', { scene: run.scene.id });
      const now = digest(capture);
      if (now !== mark.hash) {
        throw codeError('SIM_EDITED_CAPTURE', { scene: run.scene.id, step: mark.steps, now, then: mark.hash });
      }
      world.restore(capture);
      inputs.length = 0;
      for (const entry of deserialize(mark.inputs) as unknown as InputEntry[]) inputs.push(entry);
      ({ steps, last, seen } = mark);
    },
    record() {
      if (world.tick !== steps) throw codeError('SIM_OFF_RECORD', { count: world.tick - steps });
      const taken = inputs.filter(([at]) => at < steps);
      return {
        format: 'my3dge-replay/1', // REPLAY_FORMAT, checked by its type (importing it would make the modules circular)
        scene: run.scene.id,
        settings: deserialize(serialize(start as Canonical)) as Record<string, SettingValue>,
        seed: world.seed,
        hz: world.hz,
        steps,
        inputs: deserialize(serialize(taken as unknown as Canonical)) as unknown as InputEntry[],
        hashes: {},
      };
    },
  };
  return session;
}
