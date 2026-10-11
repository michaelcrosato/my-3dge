/**
 * @file The engine without a page (PLAN.md §8.3, §6.9, WPs 1.6 and 2.7; doctrine: Verifiable): `createHeadless({
 * scene, seed, settings, view })` starts a scene as a recorded session (engine/sim/scene.ts) and returns its
 * inspector, the same object a page publishes as `window.__engine` minus a renderer: `render` and `shot` throw
 * `DEV_NO_RENDERER`. With `view: true` it also builds the scene's presentation graph in Node (engine/app/view.ts: the
 * stage and its camera, no GPU), so `scene.dump()` and `camera` work headless and view logic is tested in T1; the
 * scene's level must be registered first (`APP_NO_LEVEL`). `x sim` runs scenes through it, and tests drive the sim
 * with the same calls an agent makes in a page.
 *
 * Time: a headless engine has a frame clock over the run's settings, like a page, but no frames. `step(n, intents)`
 * runs n steps at once, inside the session, so the steps are recorded and `headlessHost(h).session.record()` is the
 * run as a replay. `pause`, `resume` and `timeScale` set the clock's settings as in a page (no real time passes
 * headless, so only `step` runs steps). `seed(n)` starts the scene again with seed n, a new session and clock, keeping
 * every setting that differs from what a fresh start gives; `replay(text)` starts the replay's run and plays it. The
 * run's stats meter (engine/dev/stats.ts, `__engine.stats()`) times every step it runs, and the world's systems through
 * the world's probe; a page times its frames through it and gives it the renderer's counts (`Drawing.counts`).
 *
 * `createAppHost` is the run behind both engines: engine/app/engine.ts adds a page's drawing to it. Invariants:
 * everything runs synchronously after the promise resolves (the fdlibm swap holds only through synchronous entry
 * points); runs share nothing but the registry; the inspector holds only its members, so the run behind it is reached
 * through `headlessHost(h)` (tools only), whose `session` is what members get: the recorded operations and the world
 * read-only (engine/dev/members.ts). Its `restore` and `act` move entities between steps, so they snap the view to the
 * world (no interpolation from stale places), as a restart does. A seed is a whole number from 0 (`SIM_BAD_SEED`).
 *
 * @example
 * import { createRegistry } from '../core/registry';
 * import { defineScene } from '../sim/scene';
 * const demo = defineScene('demo', { setup: (w) => void w.spawn() }, createRegistry());
 * const h = await createHeadless({ scene: demo, seed: 3 });
 * h.step(60); // 60: the tick after the steps
 * h.entities(); // [{ id: 1, components: [] }]
 * @see engine/app/headless.test.ts
 */
import type { EventMap } from '../core/events';
import { codeError, defineCodes, log as sharedLog, type Log } from '../core/log';
import { registry as sharedRegistry, sameValue, type Registry } from '../core/registry';
import { isPlainObject } from '../core/schema';
import { createSettings, defineSettings, type SettingValue } from '../core/settings';
import { createClock, TIME_SETTINGS, type Clock } from '../core/time';
import { createInspector, type Inspector } from '../dev/inspector';
import { recordedRun, type InspectorHost, type RecordedRun } from '../dev/members';
import { createStatsMeter, type RenderCounts, type StatsMeter } from '../dev/stats';
import { createMaterialLibrary, type MaterialLibrary } from '../gfx/materials/library';
import type { FrameReport } from '../gfx/renderer';
import type { ShotJson, ShotOptions } from '../gfx/shot';
import type { Replay } from '../sim/replay';
import { checkSeed, createSession, getScene, type Scene, type Session } from '../sim/scene';
import type { AnyComponents } from '../sim/state';
import { playInto, type PlayIntoOptions, type PlayResult } from './playback';
import { createRunView, type RunView } from './view';
import type { AppHost } from './viewMembers';
import './feelMember';
import './viewMembers';

/** The codes this module raises, with their fixes. */
export const HEADLESS_CODES = defineCodes('app', {
  APP_NOT_HEADLESS: {
    template: 'headlessHost was given {value}, not a headless engine',
    fix: 'pass the object createHeadless resolved to',
  },
  APP_OTHER_SCENE: {
    template: 'this engine draws {shown}, so it cannot start {scene}',
    fix: "play {scene} in its own page (labs/<name>/?scene=<name>), or headless: createHeadless({ scene: '{scene}' })",
  },
});

/** How a headless engine starts. */
export interface HeadlessOptions<C extends object = AnyComponents, E extends EventMap = EventMap> {
  /** The scene: an id on the registry, or the scene `defineScene` returned. */
  scene: string | Scene<C, E>;
  /** The seed every sim RNG stream derives from (1). */
  seed?: number;
  /** Setting values over the scene's, path → value (`x sim --set`). */
  settings?: Readonly<Record<string, unknown>>;
  /** Also build the scene's presentation graph (no GPU), for `scene.dump()` and `camera` (false). */
  view?: boolean;
  /** The camera code the view starts with (`cam=iso`). */
  cam?: string;
  /** Where scenes, components and settings are declared (the shared registry). */
  registry?: Registry;
  /** Where errors and advice are recorded (the shared log). */
  log?: Log;
}

/** A headless engine: `__engine`'s members, over a scene running in this process. */
export type Headless = Inspector;

/** What a page adds to the run's host (engine/app/engine.ts): its GPU and how it draws. */
export interface Drawing {
  /** Whether a renderer draws: false until it started, or when WebGPU refused (members that need one throw). */
  active(): boolean;
  readonly adapter: Readonly<Record<string, unknown>> | null;
  readonly features: readonly string[];
  readonly downgrades: readonly string[];
  /** Whether the page is up: its first frame drawn. */
  ready(): boolean;
  render(frames: number): Promise<FrameReport>;
  shot(options: ShotOptions): Promise<ShotJson>;
  /** Draws one frame of the run now, while a replay plays. */
  draw(): Promise<void>;
  /** Sets a view setting (it never changes play). */
  setView(path: string, value: SettingValue): void;
  /** The renderer's counts for `__engine.stats()`, null before it started. */
  counts(): RenderCounts | null;
}

/** The run behind an engine: the inspector, its host, and the live session (app code only, never members). */
export interface AppRun {
  readonly inspector: Inspector;
  readonly host: AppHost;
  /** The live session: what the page's loop steps. */
  readonly session: Session;
  /** The frame clock over the run's settings. */
  readonly clock: Clock;
  /** The view, or null. */
  readonly view: RunView | null;
  /** Runs one step with `intents` through the session, and lets the view read it. */
  stepOnce(intents: unknown): void;
  /** True while a replay plays: the page's loop steps nothing then. */
  readonly playing: boolean;
  /** Starts a replay's run (its scene, seed and settings), for playing it step by step; returns its session. */
  begin(replay: Replay): Session;
  /** The stats meter (engine/dev/stats.ts): it times every step and phase; a page times its frames through it. */
  readonly meter: StatsMeter;
}

/** How `createAppHost` makes a run: `createHeadless`'s options, plus a page's drawing and material library. */
export interface AppHostOptions<
  C extends object = AnyComponents,
  E extends EventMap = EventMap,
> extends HeadlessOptions<C, E> {
  drawing?: Drawing;
  materials?: MaterialLibrary;
}

/** The run behind each headless engine, for tools that need more than the members. */
const hosts = new WeakMap<object, InspectorHost>();

/** The settings of `session` that differ from a fresh start of its scene: what a restart keeps. */
function changedSettings(session: Session, registry: Registry): Record<string, SettingValue> {
  const fresh = createSettings({ registry });
  fresh.override(session.scene.settings, 'fresh');
  const now = session.settings.values();
  const changed = Object.keys(now).filter((path) => !sameValue(now[path], fresh.get(path)));
  return Object.fromEntries(changed.map((path) => [path, now[path]]));
}

/** Makes the run behind an engine (see the file comment). Throws as `createHeadless` does, and `APP_NO_LEVEL`. */
export function createAppHost<C extends object = AnyComponents, E extends EventMap = EventMap>(
  options: AppHostOptions<C, E>,
): AppRun {
  const firstSeed = checkSeed(options.seed, 'createHeadless({ seed })');
  const registry = options.registry ?? sharedRegistry;
  const firstScene =
    typeof options.scene === 'string' ? getScene(options.scene, registry) : (options.scene as unknown as Scene);
  const timed = registry.kinds().includes('setting') && registry.has('setting', 'time.hz');
  if (!timed) defineSettings(TIME_SETTINGS, registry); // the clock reads them: a test registry may lack them
  const { drawing } = options;
  const meter = createStatsMeter({ counts: () => drawing?.counts() ?? null });
  // Members get `recordedRun(session)`, except that a restore or a dev action moves entities between steps, so the
  // view then snaps to the world as it is (no interpolation from the places it had), as it does after a restart.
  const followed = (session: Session): RecordedRun => {
    const recorded = recordedRun(session);
    const snapping = <A extends unknown[]>(change: (...args: A) => void) => ({
      enumerable: true,
      value: (...args: A) => {
        change(...args);
        view?.restarted();
      },
    });
    return Object.freeze(
      Object.defineProperties(
        {},
        {
          ...Object.getOwnPropertyDescriptors(recorded),
          restore: snapping(recorded.restore),
          act: snapping(recorded.act),
        },
      ),
    ) as RecordedRun;
  };
  const start = (scene: Scene, seed: number, settings: Readonly<Record<string, unknown>> | undefined) => {
    const session = createSession(scene, { seed, settings, registry, log: options.log, probe: meter.probe });
    const clock = createClock({ settings: session.settings, log: options.log });
    return { session, recorded: followed(session), clock };
  };
  let run: { session: Session; recorded: RecordedRun; clock: Clock } = start(firstScene, firstSeed, options.settings);
  let playing = false;
  const wantView = options.view === true || drawing !== undefined;
  const view = wantView
    ? createRunView({
        run: () => run.session,
        registry,
        materials: options.materials ?? createMaterialLibrary({ registry }),
        cam: options.cam,
        log: options.log,
      })
    : null;
  const restart = (scene: Scene, seed: number, settings: Readonly<Record<string, unknown>> | undefined) => {
    if (view && scene.id !== run.session.scene.id) {
      throw codeError('APP_OTHER_SCENE', { shown: run.session.scene.id, scene: scene.id });
    }
    run = start(scene, seed, settings);
    view?.restarted();
  };
  const begin = (replay: Replay) => {
    restart(getScene(replay.scene, registry), replay.seed, replay.settings);
    return run.session;
  };
  const stepOnce = (intents: unknown) => {
    meter.time('sim', () => run.session.step(intents));
    view?.stepped();
  };
  const host: AppHost = {
    registry,
    members: sharedRegistry,
    log: options.log ?? sharedLog,
    get clock() {
      return run.clock;
    },
    get session() {
      return run.recorded;
    },
    runtime: typeof window === 'undefined' ? 'node' : 'browser',
    get renderer() {
      return drawing?.active() ?? false;
    },
    get adapter() {
      return drawing?.adapter ?? null;
    },
    get features() {
      return drawing?.features ?? [];
    },
    get downgrades() {
      return drawing?.downgrades ?? [];
    },
    get ready() {
      return drawing ? drawing.ready() : true;
    },
    view,
    meter,
    step(n, intents) {
      const script = Array.isArray(intents) ? intents : undefined;
      const later = isPlainObject(intents) ? { ...intents, p: undefined } : intents;
      for (let k = 0; k < n; k++) stepOnce(script ? (script[k] ?? {}) : k === 0 ? intents : later);
    },
    restart(next) {
      restart(run.session.scene, next, changedSettings(run.session, registry));
    },
    render: (frames) => drawing!.render(frames),
    shot: (shotOptions) => drawing!.shot(shotOptions),
    async replay(text: string, playOptions: PlayIntoOptions): Promise<PlayResult> {
      playing = true;
      try {
        return await playInto(
          {
            registry,
            begin,
            stepped: () => view?.stepped(),
            draw: drawing && (() => drawing.draw()),
            camera: view ? (code) => void view.setCamera(code) : undefined,
            setView: (path, value) => (drawing ? drawing.setView(path, value) : run.session.set(path, value)),
          },
          text,
          playOptions,
        );
      } finally {
        playing = false;
      }
    },
  };
  const inspector = createInspector(host);
  hosts.set(inspector, host);
  return {
    inspector,
    host,
    get session() {
      return run.session;
    },
    get clock() {
      return run.clock;
    },
    view,
    stepOnce,
    get playing() {
      return playing;
    },
    begin,
    meter,
  };
}

/**
 * Starts a scene headless, in this process, and returns its inspector: the members a page's `window.__engine` has
 * (`step`, `hash`, `state`, `set`…; `help()` lists them all), minus a renderer. With `view: true` it also builds the
 * scene's view, for `scene.dump()` and `camera`. Throws `CORE_NO_ENTRY` for an unknown scene id, `CORE_BAD_SETTING`
 * for a bad setting, `SIM_BAD_SEED` for a seed a replay cannot hold, and with a view `APP_NO_LEVEL` for a level not
 * registered.
 */
export async function createHeadless<C extends object = AnyComponents, E extends EventMap = EventMap>(
  options: HeadlessOptions<C, E>,
): Promise<Headless> {
  return createAppHost(options).inspector;
}

/** The run behind a headless engine: its session (world, settings, recording) and clock. Tools only. */
export function headlessHost(headless: Headless): InspectorHost {
  const host = hosts.get(headless);
  if (!host) throw codeError('APP_NOT_HEADLESS', { value: typeof headless });
  return host;
}
