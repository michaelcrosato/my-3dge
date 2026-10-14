/**
 * @file The lights page's module (tests/pages/lights.html, PLAN.md WP 7.1): the engine's renderer
 * (engine/gfx/renderer.ts) with the hall (engine/gfx/level/meshes.ts) under a sky (engine/gfx/sky.ts): the light
 * pool lit from the hall's 30 torch spots, the shadow budget, the atmosphere, the dome and the backdrop. It publishes
 * `window.__lightsPage`:
 * - `show(text, file)` compiles a level's text, draws it under the sky (`sky:hall` first, the `quality` setting's
 *   shadow budget), registers both with the warm-up and warms up through both cameras (r182 builds pipelines per
 *   projection, so the app warms both, engine/app/engine.ts);
 * - `look({ focus, camera, preset, quality, time })` switches the preset or tier when given (warming up again through
 *   both cameras when the shader key changed), follows `focus` with the camera code and the sky, draws a frame and
 *   reports what it cost (pipelines built, after the warm-up) and what the sky shows;
 * - `hashRun(text, options)` plays a replay's text step by step through the very session the player uses
 *   (engine/sim/scene.ts), its flicker drawn from the world's visual stream (`fxRng`), switching presets and drawing
 *   frames as it goes, and returns the hashes at the replay's checkpoints.
 * The spec passes the level's and replay's text, read in Node, so the page fetches nothing.
 *
 * Invariants: `ready` turns true once the renderer has drawn the empty scene, never after an error; a failure to start
 * is one record in `__engine.errors`, shown as page text; the three.js cameras are made once.
 *
 * @see tests/e2e/lights.spec.ts
 */
import * as THREE from 'three/webgpu';
import '../../fixtures/scenes/kernel';
import { createSettings } from '../../engine/core/settings';
import { Rng } from '../../engine/core/rng';
import { createCamera, createCameraPair } from '../../engine/gfx/cameras/place';
import type { Vec3 } from '../../engine/gfx/cameras/pose';
import { createLevelMeshes } from '../../engine/gfx/level/meshes';
import { createMaterialLibrary } from '../../engine/gfx/materials/library';
import { qualityBudget, type QualitySetting } from '../../engine/gfx/quality';
import { createRenderer, type FrameReport, type FrameView, type Gfx, type GfxError } from '../../engine/gfx/renderer';
import { enableShadows } from '../../engine/gfx/shadows';
import { createSky, type Sky, type SkyReport } from '../../engine/gfx/sky';
import { applyIntents, NO_INTENTS, type Intents } from '../../engine/input/intents';
import { checkReplay, checkpointsOf } from '../../engine/sim/replay';
import { createSession } from '../../engine/sim/session';
import { compileLevel } from '../../engine/world/level/compile';

/** One structured error record, as `window.__engine.errors` holds them (PLAN.md §8.3). */
interface ErrorRecord {
  code: string;
  message: string;
  fix: string;
}

/** What `look` takes: where the focus is, and optionally the camera, preset, tier and flicker time. */
export interface LookOptions {
  focus: Vec3;
  /** An engine camera code following the focus (`cam=iso` by default). */
  camera?: string;
  preset?: string;
  quality?: QualitySetting;
  /** Seconds, for the flicker (0 by default). */
  time?: number;
}

/** What `look` reports. */
export interface Looked {
  frame: FrameReport;
  pipelinesAfterWarmUp: number | null;
  warmUps: number;
  /** The scene's lights, as r182's lights node keys them: id, `s` when it casts. */
  lights: string[];
  sky: SkyReport;
}

/** How `hashRun` interleaves presentation with the steps. */
export interface HashRunOptions {
  /** The presets to cycle through, one every `every` steps. */
  presets: string[];
  every: number;
  /** Draw a frame every `draw` steps. */
  draw: number;
}

const message = document.querySelector<HTMLElement>('#msg');
const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
let info: Record<string, unknown> = { page: 'lights' };
const signals = { ready: false, errors: [] as ErrorRecord[], info: () => info };
Object.assign(window, { __engine: signals });

/** Records the page's one error and shows it. */
function fail(record: ErrorRecord): void {
  signals.errors.push(record);
  if (message) {
    message.textContent = `${record.code}: ${record.message}\nFix: ${record.fix}`;
    message.hidden = false;
  }
  console.error(`[${record.code}] ${record.message}. Fix: ${record.fix}`);
}

/** Draws until a frame is drawn, waiting out any warm-up; resolves once the GPU has finished it. */
async function settle(gfx: Gfx, view: FrameView): Promise<FrameReport> {
  for (let tries = 0; tries < 10; tries++) {
    const report = gfx.frame(view);
    if (report.drawn) {
      await gfx.device.queue.onSubmittedWorkDone();
      return report;
    }
    if (gfx.warmup.running) await gfx.warmup.run(view).catch(() => undefined);
  }
  throw new Error('lights page: no frame was drawn in 10 tries');
}

/** The scene's lights, as r182's lights node keys them. */
function lightKey(scene: THREE.Scene): string[] {
  const lights: string[] = [];
  scene.traverse(
    (o) => void ((o as { isLight?: boolean }).isLight && lights.push(`${o.id}${o.castShadow ? 's' : ''}`)),
  );
  return lights;
}

/** Starts the renderer and the empty scene, and publishes `__lightsPage`. */
async function start(): Promise<void> {
  const settings = createSettings();
  settings.fromUrl(location.search);
  let gfx: Gfx;
  try {
    gfx = await createRenderer(canvas, { settings });
  } catch (error) {
    const { code, message, fix } = error as GfxError;
    if (code && fix) return fail({ code, message, fix });
    throw error;
  }
  enableShadows(gfx.renderer);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#06050b');
  const cameras = createCameraPair();
  const aspect = () => canvas.clientWidth / Math.max(1, canvas.clientHeight);
  const view: FrameView = { scene, camera: cameras.perspective };
  const library = createMaterialLibrary();
  let sky: Sky | null = null;

  /** Warms up through both cameras when the shader key changed since the last warm-up. */
  const warmBoth = async () => {
    if (gfx.warmup.last?.key === gfx.warmup.key(scene)) return;
    for (const camera of [cameras.orthographic, cameras.perspective]) await gfx.warmup.run({ scene, camera });
  };

  /** Draws one frame following `focus`; see the file comment. */
  const look = async (options: LookOptions): Promise<Looked> => {
    if (!sky) throw new Error('lights page: show a level first');
    if (options.preset) sky.set(options.preset);
    if (options.quality) sky.budget(qualityBudget(options.quality, false));
    await warmBoth();
    view.camera = cameras.place(createCamera(options.camera ?? 'cam=iso').update({ follow: options.focus }), aspect());
    sky.update({ camera: view.camera, focus: options.focus, time: options.time ?? 0 });
    const frame = await settle(gfx, view);
    const stats = gfx.stats();
    return {
      frame,
      pipelinesAfterWarmUp: stats.pipelinesAfterWarmUp,
      warmUps: stats.warmUps,
      lights: lightKey(scene),
      sky: sky.report(),
    };
  };

  const page = {
    gfx,
    scene,
    view,
    get sky() {
      return sky;
    },
    look,
    /** Shows the level `text` (from `file`) under `sky:hall`, warmed up through both cameras. */
    async show(text: string, file: string): Promise<{ lights: string[]; sources: number }> {
      const level = compileLevel(text, { file });
      const meshes = createLevelMeshes(level, { materials: library });
      scene.add(meshes.root);
      meshes.register(gfx.warmup);
      sky = createSky(scene, { level, rng: new Rng(1) });
      sky.register(gfx.warmup);
      sky.set('sky:hall');
      sky.budget(qualityBudget(settings.get<QualitySetting>('quality'), false));
      await warmBoth();
      return { lights: lightKey(scene), sources: sky.pool.sources.length };
    },
    /** Plays a replay's text, switching presets and drawing as it goes; returns its checkpoints' hashes. */
    async hashRun(text: string, options: HashRunOptions): Promise<Record<string, string>> {
      if (!sky) throw new Error('lights page: show a level first');
      const replay = checkReplay(JSON.parse(text));
      const session = createSession(replay.scene, { seed: replay.seed, settings: replay.settings });
      sky.pool.setSources(sky.pool.sources, session.world.fxRng('lights'));
      const marks = new Set(checkpointsOf(replay));
      const hashes: Record<string, string> = {};
      let [at, intents]: [number, Intents] = [0, NO_INTENTS];
      for (let k = 0; k <= replay.steps; k++) {
        if (marks.has(k)) hashes[k] = session.world.hash();
        if (k === replay.steps) break;
        if (k % options.every === 0) sky.set(options.presets[(k / options.every) % options.presets.length]);
        if (k % options.draw === 0) await look({ focus: [4 + (56 * k) / replay.steps, 0.5, 22], time: k / 60 });
        let change = {};
        for (; at < replay.inputs.length && replay.inputs[at][0] === k; at++) {
          const { set, dev, args, ...keys } = replay.inputs[at][1];
          for (const [path, value] of Object.entries(set ?? {})) session.set(path, value);
          if (dev !== undefined) session.act(dev, args);
          change = { ...change, ...keys };
        }
        intents = applyIntents(intents, change);
        session.step(intents);
      }
      return hashes;
    },
  };
  await gfx.warmup.run(view);
  await settle(gfx, view);
  Object.assign(window, { __lightsPage: page });
  info = { page: 'lights', ...gfx.info };
  if (message) message.hidden = true;
  signals.ready = true;
}

start().catch((error: unknown) => {
  const code = (error as { code?: string }).code ?? 'LIGHTS_PAGE_START';
  const fix = (error as { fix?: string }).fix ?? 'the console names the cause';
  fail({ code, message: String((error as Error).message ?? error), fix });
});
