/**
 * @file The engine in a page (PLAN.md §6.4, §6.9, §8.3, WP 2.7): `createEngine({ canvas, scenes, levels })` registers
 * the levels the page imported as text, reads the page's routes (engine/app/routes.ts: `?scene ?seed ?cam ?replay`
 * and settings by path), starts the scene as a recorded run with its view (engine/app/headless.ts,
 * engine/app/view.ts), publishes the run's inspector as `window.__engine`, starts the renderer (WebGPU or nothing,
 * engine/gfx/renderer.ts), warms up every pipeline the view needs through both cameras (perspective and
 * orthographic), draws the first frame, and then runs the frame loop (engine/app/loop.ts): the devices sampled into
 * intents (engine/input/input.ts; `__engine.input` drives the same session), fixed steps from the clock, the view
 * drawn at the clock's alpha.
 *
 * Ready or error (§8.3): `__engine.ready` turns true once the first frame is done on the GPU, and never after a
 * startup error; every failure is one record in `__engine.errors` (the log's) and shown as page text by the error
 * overlay (engine/dev/overlay.ts), so a startup crash is one line, never a hang. Without WebGPU (`GFX_NO_WEBGPU`) the
 * sim still runs, and `__engine` still steps it; only `render` and `shot` throw. A frame that throws stops the loop
 * and becomes an error record too.
 *
 * The rendering members (engine/app/viewMembers.ts) get their drawing here: `render(n)` draws frames now, `shot`
 * shoots the view (engine/gfx/shot.ts), and `replay(text)` plays a replay drawing a frame after every step (the
 * CPU-only contract's proof, §6.7: `x replay --browser page`, tests/e2e/parity.spec.ts). `?replay=<name>` plays one
 * of `options.replays` in real time instead, from step 0, then hands back to the devices; without `?scene`, the page
 * starts the replay's own scene (when it is one of the page's), since a page draws one scene and plays only its
 * replays.
 *
 * Invariants: rendering never writes the sim (doctrine: WebGPU only): the loop steps the session only with intents
 * and recorded settings; cameras and view settings never reach the hash. Nothing reads a wall clock: time comes from
 * the animation frames' timestamps.
 *
 * @example
 * // labs/box/main.ts
 * // import { createEngine } from '../../engine';
 * // const engine = await createEngine({ canvas: document.querySelector('canvas')!, scenes: ['box:room'] });
 * // engine.ready; // true once the first frame is drawn
 * @see tests/e2e/box.spec.ts
 */
import '../dev/members'; // declares the kind inspectorMember before input/devices/inspector registers its members
import {
  codeError,
  codeInfo,
  defineCodes,
  log as sharedLog,
  type CodeValues,
  type ErrorRecord,
  type Log,
} from '../core/log';
import { registry as sharedRegistry, type Registry } from '../core/registry';
import type { Settings, SettingValue } from '../core/settings';
import { createOverlay } from '../dev/overlay';
import { createMaterialLibrary } from '../gfx/materials/library';
import { createRenderer, type FrameReport, type Gfx } from '../gfx/renderer';
import { shot, shotForJson } from '../gfx/shot';
import { connectVirtualDevice } from '../input/devices/inspector';
import { createInput, type Input } from '../input/input';
import type { Inspector } from '../dev/inspector';
import { createAppHost, type AppRun, type Drawing } from './headless';
import { createLoop, type Loop } from './loop';
import { createPlayback, type Playback } from './playback';
import { defineLevel } from '../world/level/level';
import { parseRoutes, type Routes } from './routes';
import { HEADLESS_ASPECT } from './view';

/** The codes this module raises, with their fixes. */
export const ENGINE_CODES = defineCodes('app', {
  APP_START: {
    template: 'the page failed to start: {message}',
    fix: 'the console names the cause; node x shot <page> reports it headless',
  },
  APP_FRAME: {
    template: 'a frame threw, so the loop stopped: {message}',
    fix: 'the console names the cause; reload the page to start again, or read __engine.state() to see where the run stands',
  },
  APP_NO_REPLAY: {
    template: 'the page has no replay {name}',
    fix: 'use one of: {names}',
  },
  APP_NO_FRAME: {
    template: 'no frame was drawn in {tries} tries: the warm-up never finished',
    fix: 'read __engine.errors for GFX_WARMUP_FAILED; node x shot <page> reports it headless',
  },
});

/** How a page starts the engine. */
export interface EngineOptions {
  /** The canvas it draws into; the page sizes it with CSS. */
  canvas: HTMLCanvasElement;
  /** The page's scenes, by id (registered with defineScene); `?scene` picks one, the first by default. */
  scenes: readonly string[];
  /** The levels the page's scenes load, by id: their text (Vite's `?raw` import) and file; registered unless already. */
  levels?: Readonly<Record<string, { text: string; file?: string }>>;
  /** Replays the page offers by name (`?replay=<name>`): name → its text, loaded when asked for. */
  replays?: Readonly<Record<string, () => Promise<string>>>;
  /** The query to read (`location.search`). */
  search?: string;
  /** Where scenes, levels, components, settings and materials are declared (the shared registry). */
  registry?: Registry;
  /** Where errors and advice go (the shared log). */
  log?: Log;
}

/** A started engine. */
export interface Engine {
  /** The inspector, also `window.__engine`; null when the scene could not start. */
  readonly inspector: Inspector | null;
  /** True once the first frame is drawn; never after a startup error. */
  readonly ready: boolean;
  /** What the query asked for; null when it could not be read. */
  readonly routes: Routes | null;
  /** Stops the frame loop. */
  stop(): void;
}

/** GPU frames drawn while a replay plays before the queue is drained, so it never runs far ahead. */
const DRAIN_EVERY = 10;
/** Frames tried before a warm-up counts as stuck. */
const TRIES = 10;

/** What `?replay=<name>` asked for: the replay, ready to play, or why there is none (raised once the page is up). */
interface Asked {
  playback?: Playback;
  error?: unknown;
}

/** Reads the replay `name` of `replays` before the run starts, so its scene can start (see the file comment). */
async function readReplay(name: string, replays: EngineOptions['replays']): Promise<Asked> {
  const load = replays?.[name];
  if (!load) {
    const names = Object.keys(replays ?? {}).sort();
    return { error: codeError('APP_NO_REPLAY', { name, names: names.join(', ') || 'none' }) };
  }
  try {
    return { playback: createPlayback(JSON.parse(await load())) };
  } catch (error) {
    return { error };
  }
}

/** A store that reads and writes whichever run's settings are current, for the renderer made once. */
function currentSettings(run: () => AppRun): Settings {
  return new Proxy({} as Settings, {
    get(_, key: keyof Settings) {
      const store = run().session.settings;
      const value = store[key];
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(store) : value;
    },
  });
}

/**
 * The log record for a thrown value: its own code and values when it is a coded error (a `GfxError` carries only its
 * message, so the values are read back from it through the code's template), else `code` with the message.
 */
export function recordOf(error: unknown, code: string): [string, CodeValues] {
  const coded = error as { code?: unknown; values?: CodeValues; message?: unknown };
  const message = String(coded?.message ?? error);
  const info = typeof coded?.code === 'string' ? codeInfo(coded.code) : undefined;
  if (!info) return [code, { message }];
  if (coded.values) return [info.code, coded.values];
  const names: string[] = [];
  const pattern = info.template
    .split(/\{(\w+)\}/)
    .map((part, i) => (i % 2 ? (names.push(part), '(.*)') : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
  const found = new RegExp(`^${pattern}$`, 's').exec(message);
  return [info.code, Object.fromEntries(names.map((name, i) => [name, found?.[i + 1] ?? '?']))];
}

/** Starts the engine in a page (see the file comment); resolves once it is up or has failed. */
export async function createEngine(options: EngineOptions): Promise<Engine> {
  const log = options.log ?? sharedLog;
  const registry = options.registry ?? sharedRegistry;
  const overlay = createOverlay(document);
  overlay.status('Loading…');
  let ready = false;
  let routes: Routes | null = null;
  let run: AppRun | null = null;
  let gfx: Gfx | null = null;
  let loop: Loop | null = null;
  const fail = (error: unknown, code = 'APP_START'): ErrorRecord => {
    const record = log.error(...recordOf(error, code), error);
    overlay.error(record);
    return record;
  };
  const signals = {
    get ready() {
      return false;
    },
    get errors() {
      return log.errors.map((record) => ({ ...record }));
    },
    info: () => ({ page: location.pathname, headless: true }),
  };
  Object.assign(window, { __engine: signals });
  const engine: Engine = {
    get inspector() {
      return run?.inspector ?? null;
    },
    get ready() {
      return ready;
    },
    get routes() {
      return routes;
    },
    stop: () => loop?.stop(),
  };

  let input: Input | null = null;
  let playback: Playback | null = null;
  let draws = 0;
  const aspect = () => {
    const css = gfx?.resolution.current?.css;
    return css && css.width > 0 && css.height > 0 ? css.width / css.height : HEADLESS_ASPECT;
  };
  const viewNow = () => run!.view!;
  /** Warms up through both cameras, so switching projection later builds nothing. */
  const warmBoth = async () => {
    const view = viewNow();
    for (const camera of view.cameras) await gfx!.warmup.run({ scene: view.stage.scene, camera });
  };
  const frameNow = (alpha: number, dt: number): FrameReport => {
    gfx!.resolution.update();
    const cameraInput = input?.camera();
    return gfx!.frame(viewNow().frame({ alpha, dt, aspect: aspect(), input: cameraInput }));
  };
  const settle = async (alpha: number, dt: number): Promise<FrameReport> => {
    for (let tries = 0; tries < TRIES; tries++) {
      const report = frameNow(alpha, dt);
      if (report.drawn) {
        await gfx!.device.queue.onSubmittedWorkDone();
        return report;
      }
      await warmBoth().catch(() => undefined);
    }
    throw codeError('APP_NO_FRAME', { tries: TRIES });
  };
  let warming: Promise<void> | null = null;
  let asked: Asked | null = null;
  const drawing: Drawing = {
    active: () => gfx !== null,
    get adapter() {
      return gfx ? { ...gfx.info.adapter, backend: gfx.info.backend, three: gfx.info.three } : null;
    },
    get features() {
      return gfx?.info.enabled ?? [];
    },
    get downgrades() {
      return gfx?.info.downgrades ?? [];
    },
    ready: () => ready,
    async render(frames) {
      let report: FrameReport | null = null;
      for (let k = 0; k < frames; k++) report = await settle(1, 1 / 60);
      return report!;
    },
    async shot(shotOptions) {
      const view = viewNow().frame({ alpha: 1, dt: 0, aspect: aspect() });
      return shotForJson(await shot(gfx!, view, shotOptions));
    },
    async draw() {
      if (!gfx) return;
      if (!frameNow(1, 1 / 60).drawn) await settle(1, 1 / 60);
      if (++draws % DRAIN_EVERY === 0) await gfx.device.queue.onSubmittedWorkDone();
    },
    setView(path: string, value: SettingValue) {
      run!.session.set(path, value);
    },
  };

  try {
    for (const [id, level] of Object.entries(options.levels ?? {})) {
      if (!registry.has('level', id)) defineLevel(id, level, registry);
    }
    const search = options.search ?? location.search;
    routes = parseRoutes(search, { scenes: options.scenes, registry });
    if (routes.replay !== undefined) {
      asked = await readReplay(routes.replay, options.replays);
      const scene = asked.playback?.replay.scene;
      if (scene && !new URLSearchParams(search).has('scene') && options.scenes.includes(scene)) {
        routes = { ...routes, scene };
      }
    }
    const materials = createMaterialLibrary({ registry });
    const { scene, seed, settings, cam } = routes;
    run = createAppHost({ scene, seed, settings, cam, registry, log, drawing, materials });
  } catch (error) {
    fail(error);
    return engine;
  }
  const started = run;
  Object.assign(window, { __engine: started.inspector });
  input = createInput({ window, document, element: options.canvas, registry, log });
  connectVirtualDevice(started.host, input.virtual);
  try {
    gfx = await createRenderer(options.canvas, { settings: currentSettings(() => started), registry, log });
  } catch (error) {
    fail(error);
    return engine;
  }
  try {
    gfx.renderer.shadowMap.enabled = true;
    viewNow().stage.register(gfx.warmup);
    await warmBoth();
    await settle(1, 0);
  } catch (error) {
    fail(error);
    return engine;
  }
  const step = (intents: Record<string, unknown>) => {
    if (playback && !playback.done) {
      playback.step(started.session);
      started.view?.stepped();
    } else {
      playback = null;
      started.stepOnce(intents);
    }
  };
  loop = createLoop({
    clock: () => started.clock,
    sample: () => input!.sample({ yaw: () => viewNow().camera.yaw() }),
    step,
    draw: ({ alpha, dt }) => {
      if (warming) return;
      const report = frameNow(alpha, dt);
      if (!report.drawn && report.warming) warming = warmBoth().finally(() => (warming = null));
    },
    hold: () => started.playing,
    onError: (error) => fail(error, 'APP_FRAME'),
  });
  ready = true;
  overlay.hide();
  loop.start();
  const replay = asked?.playback;
  if (asked && !replay) fail(asked.error);
  else if (replay) {
    try {
      started.begin(replay.replay);
      playback = replay;
    } catch (error) {
      fail(error);
    }
  }
  return engine;
}
