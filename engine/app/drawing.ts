/**
 * @file The page's drawing (PLAN.md §6.4, §6.7, WP 2.7): what engine/app/engine.ts `createEngine` draws with once its
 * renderer is up. `createPageDrawing(parts, options)` gives the page's frame (`frame`: touch mode and the quality
 * tier's pixel caps, the resolution, the view at the clock's alpha drawn through the post chain in the page's look,
 * the camera shake, the damage numbers, the overlay, then the page's own `onFrame`), `settle` (a frame drawn and done
 * on the GPU, warming up again until one is), `warmBoth` (both cameras warmed up through the chain, so switching
 * projection later builds nothing) and the rendering members' `Drawing` (engine/app/headless.ts): `render(n)` draws
 * frames now, `shot` shoots the view (engine/gfx/shot.ts), `draw` draws a frame after each step of a replay (the
 * CPU-only contract's proof, §6.7: `x replay --browser page`), and `counts` reads the renderer's.
 *
 * Invariants: rendering never writes the sim (doctrine: WebGPU only): the view reads the run, and `setView` changes
 * view settings, which never reach the hash. A replay drawn a frame a step waits for the GPU's queue every
 * `DRAWING.drain` frames, so it never runs far ahead; `settle` gives up after `DRAWING.tries` frames with
 * `APP_NO_FRAME`. `parts` is read at each call, so what the engine starts later (the renderer, the chain, the look,
 * the input) is drawn with as soon as it is there. Split from engine.ts to keep each under 400 lines (ADR-0014
 * amendment 16).
 *
 * @example
 * // engine/app/engine.ts
 * // const parts: PageParts = { run: null, gfx: null, post: null, look: null, input: null, layer: null, ui: null, numbers: null, governor: null, ready: false };
 * // const { drawing, frame, settle, warmBoth } = createPageDrawing(parts, { chrome, settings, onFrame });
 * @see tests/e2e/box.spec.ts
 */
import { codeError } from '../core/log';
import type { Settings, SettingValue } from '../core/settings';
import { qualityBudget, type QualitySetting } from '../gfx/quality';
import { keepWidth } from '../gfx/resolution';
import type { Post } from '../gfx/post/chain';
import type { FrameReport, FrameView, Gfx } from '../gfx/renderer';
import { shot, shotForJson } from '../gfx/shot';
import type { Input } from '../input/input';
import type { Chrome } from '../ui/chrome';
import type { Overlay } from '../ui/overlay';
import type { TouchLayer } from '../ui/touch';
import { queryViewOf } from '../sim/queryView';
import type { CameraPose } from '../gfx/cameras/pose';
import type { QueryView } from '../sim/queryView';
import type { Scene } from '../sim/scene';
import type { World, WorldEvents } from '../sim/world';
import type { DamageNumbers } from './damageNumbers';
import type { AppRun, Drawing } from './headless';
import type { PageLook } from './look';
import { HEADLESS_ASPECT } from './view';
import type { Governor } from '../dev/governor';

/** GPU frames drawn while a replay plays before the queue is drained (`drain`); frames tried before a warm-up counts as stuck (`tries`). */
export const DRAWING = { drain: 10, tries: 10 } as const;

/** What the page has started so far, read at each call: each part is null until the engine starts it. */
export interface PageParts {
  run: AppRun | null;
  gfx: Gfx | null;
  post: Post | null;
  look: PageLook | null;
  input: Input | null;
  layer: TouchLayer | null;
  ui: Overlay | null;
  numbers: DamageNumbers | null;
  /** The performance governor (engine/dev/governor.ts): `auto`'s tier as the frame rate asks. */
  governor: Governor | null;
  /** Whether the first frame is drawn. */
  ready: boolean;
}

/** The read side of the run's world a page gets each frame: its step, rate, entities and the trace of its events. */
export type FrameWorld = Pick<World, 'tick' | 'hz' | 'get' | 'query'> & { readonly events: Pick<WorldEvents, 'trace'> };

/**
 * What `onFrame` gets once per drawn frame: the run to read, never to change (presentation only: nothing reaches the
 * hash), the camera the frame was drawn from, and the emitters to run.
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
  /** The value setting `key` has now, view settings among them (`x set`, `__engine.set`, the URL). */
  setting(key: string): unknown;
  /**
   * Runs emitter `id` at its rate times `scale` (1) at `at` (m) for the next frame, `key` naming it so its fractions
   * and light carry over: rain over the player, a fire in a hearth (engine/gfx/fx/effects.ts `emit`). An emitter that
   * says `gpu` has its particles on the GPU's ring where `feature:gpuParticles` is on (WP 11.3). Presentation only.
   */
  emit(id: string, at: readonly [number, number, number], key: string, scale?: number): void;
}

/** What `createPageDrawing` draws with besides the parts. */
export interface PageDrawingOptions {
  /** The page's chrome: its touch class and top panel. */
  chrome: Chrome;
  /** The current run's settings (`quality`). */
  settings: Settings;
  /** The page's own presentation, after each drawn frame. */
  onFrame?: (frame: EngineFrame) => void;
}

/** The page's drawing (see the file comment). */
export interface PageDrawing {
  /** The rendering members' drawing. */
  readonly drawing: Drawing;
  /** Draws the view at `alpha`, `dt` real seconds after the last frame. */
  frame(alpha: number, dt: number): FrameReport;
  /** Draws until a frame is drawn and done on the GPU; throws `APP_NO_FRAME` after `DRAWING.tries`. */
  settle(alpha: number, dt: number): Promise<FrameReport>;
  /** Warms up through both cameras. */
  warmBoth(): Promise<void>;
}

/** The page's drawing over `parts` (see the file comment). */
export function createPageDrawing(parts: PageParts, options: PageDrawingOptions): PageDrawing {
  const { chrome, settings } = options;
  let draws = 0;
  const viewNow = () => parts.run!.view!;
  const aspect = () => {
    const css = parts.gfx?.resolution.current?.css;
    return css && css.width > 0 && css.height > 0 ? css.width / css.height : HEADLESS_ASPECT;
  };
  /** Touch mode this frame: the page's class and layer, and the quality tier's pixel caps. */
  const touchFrame = () => {
    const touch = parts.input?.touch;
    const on = touch?.active ?? false;
    chrome.setTouch(on);
    const covered = on && chrome.topPanel() !== null;
    const { innerWidth: width, innerHeight: height } = window;
    parts.layer?.update({ on, stick: touch?.stickView() ?? null, down: touch?.down() ?? [], covered, width, height });
    const quality = settings.get<QualitySetting>('quality');
    parts.gfx!.resolution.cap(parts.governor ? parts.governor.budget(quality, on) : qualityBudget(quality, on));
  };
  /** `view` drawn through the post chain in the page's look (engine/app/look.ts), once there is one. */
  const through = (view: FrameView): FrameView =>
    parts.post ? parts.post.view(parts.look!.sync(viewNow().stage, view)) : view;
  const warmBoth = async () => {
    const view = viewNow();
    const particles = view.stage.fx.gpuParticles; // the GPU's, so the warm frame builds what draws them (WP 11.3)
    for (const camera of view.cameras)
      await parts.gfx!.warmup.run(through({ scene: view.stage.scene, camera, ...(particles ? { particles } : {}) }));
  };
  const frame = (alpha: number, dt: number): FrameReport =>
    parts.run!.meter.time('render', () => {
      const gfx = parts.gfx!;
      parts.governor?.frame(dt * 1000);
      touchFrame();
      gfx.resolution.update();
      const cameraInput = parts.input?.camera();
      const view = viewNow().frame({ alpha, dt, aspect: aspect(), input: cameraInput });
      keepWidth(view.camera, aspect());
      const { shake } = viewNow().stage.fx.effects;
      shake.apply(view.camera);
      const report = gfx.frame(through(view));
      shake.restore(view.camera);
      parts.numbers?.frame(parts.run!.session.world);
      parts.ui?.update(view.camera, dt);
      if (options.onFrame) {
        const { world, scene } = parts.run!.session;
        const queries = scene.physics ? queryViewOf(world) : null;
        const emit = (id: string, at: readonly [number, number, number], key: string, scale?: number) =>
          viewNow().stage.fx.effects.emit(id, at, key, scale);
        const setting = (key: string) => parts.run!.session.settings.get(key);
        options.onFrame({ world, scene, camera: viewNow().camera.pose(), queries, dt, emit, setting });
      }
      return report;
    });
  const settle = async (alpha: number, dt: number): Promise<FrameReport> => {
    for (let tries = 0; tries < DRAWING.tries; tries++) {
      const report = frame(alpha, dt);
      if (report.drawn) {
        await parts.gfx!.device.queue.onSubmittedWorkDone();
        return report;
      }
      await warmBoth().catch(() => undefined);
    }
    throw codeError('APP_NO_FRAME', { tries: DRAWING.tries });
  };
  const drawing: Drawing = {
    active: () => parts.gfx !== null,
    get adapter() {
      const gfx = parts.gfx;
      return gfx ? { ...gfx.info.adapter, backend: gfx.info.backend, three: gfx.info.three } : null;
    },
    get features() {
      return parts.gfx?.info.enabled ?? [];
    },
    get downgrades() {
      return parts.gfx?.info.downgrades ?? [];
    },
    ready: () => parts.ready,
    async render(frames) {
      let report: FrameReport | null = null;
      for (let k = 0; k < frames; k++) report = await settle(1, 1 / 60);
      return report!;
    },
    async shot(shotOptions) {
      const view = viewNow().frame({ alpha: 1, dt: 0, aspect: aspect() });
      keepWidth(view.camera, aspect());
      return shotForJson(await shot(parts.gfx!, through(view), shotOptions));
    },
    async draw() {
      const gfx = parts.gfx;
      if (!gfx) return;
      if (!frame(1, 1 / 60).drawn) await settle(1, 1 / 60);
      if (++draws % DRAWING.drain === 0) await gfx.device.queue.onSubmittedWorkDone();
    },
    setView(path: string, value: SettingValue) {
      parts.run!.session.set(path, value);
    },
    counts: () => parts.gfx?.stats() ?? null,
  };
  return { drawing, frame, settle, warmBoth };
}
