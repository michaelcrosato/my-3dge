/**
 * @file The engine in a page (PLAN.md §6.4, §6.9, §8.3, WP 2.7): `createEngine({ canvas, scenes, levels })` registers
 * the levels the page imported as text, reads the page's routes (engine/app/routes.ts: `?scene ?seed ?cam ?replay` and
 * settings by path), starts the scene as a recorded run with its view (engine/app/headless.ts, engine/app/view.ts),
 * publishes the run's inspector as `window.__engine`, starts the renderer (WebGPU or nothing, engine/gfx/renderer.ts)
 * and the post-processing chain every frame and shot is drawn through (engine/gfx/post/chain.ts: the view settings
 * `post.look`, `post.filters` and `post.show`; the look's sky and style, engine/app/look.ts), warms up every pipeline
 * the view needs through both cameras (perspective and orthographic), draws the first frame, then runs the frame loop
 * (engine/app/loop.ts): the devices sampled into intents (engine/input/input.ts; `__engine.input` drives the same
 * session), fixed steps from the clock, the view drawn at the clock's alpha.
 *
 * Ready or error (§8.3): `__engine.ready` turns true once the first frame is done on the GPU, never after a startup
 * error; every failure is one record in `__engine.errors` (the log's), shown as page text by the error overlay
 * (engine/dev/overlay.ts), so a startup crash is one line, never a hang. Without WebGPU (`GFX_NO_WEBGPU`) the sim still
 * runs, and `__engine` still steps it; only `render` and `shot` throw. A frame that throws stops the loop and becomes
 * an error record too.
 *
 * Every frame drawn is timed by the run's stats meter, which reads the renderer's counts (`__engine.stats()`,
 * engine/dev/stats.ts). The rendering members (engine/app/viewMembers.ts) draw through the page's drawing
 * (engine/app/drawing.ts: `render(n)`, `shot`, and `replay(text)` drawing a frame after every step, §6.7).
 * `?replay=<name>` plays one of `options.replays` in real time from step 0 (without `?scene`, in its own scene if the
 * page has it), then hands back to the devices. The overlay (engine/ui/overlay.ts, `engine.ui`, WP 6.7) shows the
 * sim's hits as damage numbers (engine/app/damageNumbers.ts); `onFrame` runs a page's own presentation (`EngineFrame`).
 *
 * Touch (WP 3.12, ADR-0021: built, not tested): the app wires the touch device (engine/input/devices/touch.ts), the
 * page's chrome, the touch layer from `touchLayout` and swiping (engine/ui/), the quality budget's pixel caps
 * (engine/gfx/quality.ts) and, in touch mode, the loop's 60 fps cap; the menu button pauses, then calls `onMenu`.
 *
 * Invariants: rendering never writes the sim (doctrine: WebGPU only): the loop steps the session only with intents and
 * recorded settings; cameras and view settings never reach the hash. Nothing reads a wall clock: time comes from the
 * animation frames' timestamps.
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
import type { Settings } from '../core/settings';
import { createOverlay } from '../dev/overlay';
import { createMaterialLibrary } from '../gfx/materials/library';
import { createStyleSet } from '../gfx/materials/styles';
import { qualityBudget, type QualitySetting } from '../gfx/quality';
import { createPost } from '../gfx/post/chain';
import { definePostSettings } from '../gfx/post/settings';
import { createRenderer } from '../gfx/renderer';
import { connectVirtualDevice } from '../input/devices/inspector';
import { createInput } from '../input/input';
import type { TouchSetting } from '../input/devices/touch';
import { createChrome } from '../ui/chrome';
import { attachSwipes } from '../ui/swipe';
import { createTouchLayer, getTouchLayout, type TouchLayout } from '../ui/touch';
import type { Inspector } from '../dev/inspector';
import { createOverlay as createUi, type Overlay } from '../ui/overlay';
import type { CameraPose } from '../gfx/cameras/pose';
import type { QueryView } from '../sim/queryView';
import type { Scene } from '../sim/scene';
import type { World, WorldEvents } from '../sim/world';
import { createDamageNumbers } from './damageNumbers';
import { createPageDrawing, type PageParts } from './drawing';
import { createPageLook } from './look';
import { createAppHost, type AppRun } from './headless';
import { createLoop, type Loop } from './loop';
import { createPlayback, type Playback } from './playback';
import { defineLevel } from '../world/level/level';
import { parseRoutes, type Routes } from './routes';

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
  /**
   * The levels the page's scenes load, by id: their text (Vite's `?raw` import), file and material swaps (the level
   * entry's `materials`); registered unless already.
   */
  levels?: Readonly<Record<string, { text: string; file?: string; materials?: Readonly<Record<string, string>> }>>;
  /** Replays the page offers by name (`?replay=<name>`): name → its text, loaded when asked for. */
  replays?: Readonly<Record<string, () => Promise<string>>>;
  /** The query to read (`location.search`). */
  search?: string;
  /** Where scenes, levels, components, settings and materials are declared (the shared registry). */
  registry?: Registry;
  /** Where errors and advice go (the shared log). */
  log?: Log;
  /** The page's touch buttons, a `touchlayout` id (engine/ui/touch.ts); without it, only the touch stick shows. */
  touchLayout?: string;
  /** Opens the page's menu, called after the touch menu button has paused the game. */
  onMenu?: () => void;
  /** The page's own presentation (its sound): called once per drawn frame, after the draw, with the run to read. */
  onFrame?: (frame: EngineFrame) => void;
}

/** The read side of the run's world a page gets each frame: its step, rate, entities and the trace of its events. */
export type FrameWorld = Pick<World, 'tick' | 'hz' | 'get' | 'query'> & { readonly events: Pick<WorldEvents, 'trace'> };

/**
 * What `onFrame` gets once per drawn frame: the run to read, never to change (presentation only: nothing reaches the
 * hash), and the camera the frame was drawn from.
 */
export interface EngineFrame {
  /** The run's world: the same object until the run starts again (a new seed, a replay), so a reader compares it. */
  readonly world: FrameWorld;
  /** The running scene: its id, its level and whether it has physics. */
  readonly scene: Scene;
  /** The camera's pose this frame: where a listener goes. */
  readonly camera: CameraPose;
  /** The sim's physics queries, read-only, in a physics scene; null without physics. */
  readonly queries: QueryView | null;
  /** Real seconds since the last frame. */
  readonly dt: number;
}

/** A started engine. */
export interface Engine {
  /** The inspector, also `window.__engine`; null when the scene could not start. */
  readonly inspector: Inspector | null;
  /** True once the first frame is drawn; never after a startup error. */
  readonly ready: boolean;
  /** What the query asked for; null when it could not be read. */
  readonly routes: Routes | null;
  /** The game's HTML/CSS overlay over the canvas (engine/ui/overlay.ts); null until the renderer started. */
  readonly ui: Overlay | null;
  /** Stops the frame loop. */
  stop(): void;
}

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
  let routes: Routes | null = null;
  let loop: Loop | null = null;
  const parts: PageParts = { run: null, gfx: null, post: null, look: null, input: null, layer: null, ui: null, numbers: null, ready: false }; // prettier-ignore
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
      return parts.run?.inspector ?? null;
    },
    get ready() {
      return parts.ready;
    },
    get routes() {
      return routes;
    },
    get ui() {
      return parts.ui;
    },
    stop: () => loop?.stop(),
  };

  let layout: TouchLayout | null = null;
  let playback: Playback | null = null;
  const viewNow = () => parts.run!.view!;
  const settingsNow = currentSettings(() => parts.run!);
  const chrome = createChrome(document);
  const { drawing, frame, settle, warmBoth } = createPageDrawing(parts, { chrome, settings: settingsNow, onFrame: options.onFrame }); // prettier-ignore
  let warming: Promise<void> | null = null;
  let asked: Asked | null = null;
  let materials: ReturnType<typeof createMaterialLibrary> | null = null;

  try {
    definePostSettings(registry);
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
    if (options.touchLayout !== undefined) layout = getTouchLayout(options.touchLayout, registry);
    materials = createMaterialLibrary({ registry });
    const { scene, seed, settings, cam } = routes;
    parts.run = createAppHost({ scene, seed, settings, cam, registry, log, drawing, materials });
  } catch (error) {
    fail(error);
    return engine;
  }
  const started = parts.run;
  Object.assign(window, { __engine: started.inspector });
  const onTap = (name: string) => {
    if (name === 'game') chrome.closeTopPanel();
    if (name !== 'menu') return;
    started.clock.pause();
    options.onMenu?.();
  };
  const touchMode = () => settingsNow.get<TouchSetting>('touch');
  const input = (parts.input = createInput({ window, document, element: options.canvas, registry, log, touchMode, onTap })); // prettier-ignore
  parts.layer = createTouchLayer(document, layout);
  attachSwipes(document);
  connectVirtualDevice(started.host, input.virtual);
  try {
    parts.gfx = await createRenderer(options.canvas, { settings: currentSettings(() => started), registry, log });
  } catch (error) {
    fail(error);
    return engine;
  }
  const gfx = parts.gfx;
  parts.numbers = createDamageNumbers((parts.ui = createUi({ canvas: options.canvas })));
  try {
    gfx.renderer.shadowMap.enabled = true;
    const styles = createStyleSet({ library: materials!, registry });
    const post = (parts.post = createPost(gfx, { settings: currentSettings(() => started), registry, log, styles }));
    const budget = () => qualityBudget(settingsNow.get<QualitySetting>('quality'), input.touch?.active ?? false);
    parts.look = createPageLook({ post, styles, warmup: gfx.warmup, quality: budget });
    post.attach(gfx.warmup);
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
      started.stepped(); // its hit-stops reach the clock as in live play
    } else {
      playback = null;
      started.stepOnce(intents);
    }
  };
  loop = createLoop({
    clock: () => started.clock,
    sample: (now) => input.sample({ yaw: () => viewNow().camera.yaw() }, now),
    step,
    draw: ({ alpha, dt }) => {
      if (warming) return;
      const report = frame(alpha, dt);
      if (!report.drawn && report.warming) warming = warmBoth().finally(() => (warming = null));
    },
    hold: () => started.playing,
    cap: () => input.touch?.active ?? false,
    onError: (error) => fail(error, 'APP_FRAME'),
  });
  parts.ready = true;
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
