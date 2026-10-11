/**
 * @file The fx page's module (tests/pages/fx.html, PLAN.md WP 6.4): the fx scene's fight (tests/pages/fxScene.ts) in
 * a yard on the engine's renderer, its effects (engine/gfx/fx/effects.ts) drawn over a lit floor and registered with
 * the warm-up before the first frame, as a view seeing the yard from over its south side.
 *
 * `window.__fxPage`:
 * - `run(steps, effects)` starts the fight again (seed 7) and steps it `steps` times, drawing a frame after each
 *   (effects drawn from the world's visual streams, `w.fxRng`, with the camera shaking, or turned off): the hash
 *   after each step, the pipelines its frames built, and the most the effects drew in a frame.
 * - `flood()` asks for more than every budget in one frame (40 explosions, 1,100 telegraphs, 40 trails, 1,200 bolts):
 *   what the effects drew and dropped, the frame's pipelines, and its draw calls and triangles beyond the empty yard's.
 * - `show()` draws each kind of effect in view (the four telegraphs, an explosion, a hit, a trail, bolts, a brazier)
 *   and shoots the ID pass: what each effect's object covers.
 *
 * Invariants: `ready` turns true once the warm-up has run and the empty yard has drawn, never after an error; frames
 * are drawn by calling the page; the sim never sees the GPU, and the effects never write it.
 *
 * @see tests/e2e/fx.spec.ts
 */
import * as THREE from 'three/webgpu';
import { createSettings } from '../../engine/core/settings';
import { createEffects, type FxStats } from '../../engine/gfx/fx/effects';
import type { IdEntry } from '../../engine/gfx/idpass';
import { createMaterialLibrary } from '../../engine/gfx/materials/library';
import { createRenderer, type FrameReport, type FrameView, type Gfx, type GfxError } from '../../engine/gfx/renderer';
import { shot } from '../../engine/gfx/shot';
import { createFxScene, FX_SCENE, type FxScene } from './fxScene';

/** One structured error record, as `window.__engine.errors` holds them (PLAN.md §8.3). */
interface ErrorRecord {
  code: string;
  message: string;
  fix: string;
}

/** The fight's seed. */
export const SEED = 7;

/** What `run` reports. */
export interface Ran {
  hashes: string[];
  /** Pipelines built while drawing its frames, summed; frames that did not draw. */
  built: number;
  undrawn: number;
  pipelinesAfterWarmUp: number | null;
  most: { sprites: number; decals: number; ribbons: number; drawCalls: number; live: number };
  events: number;
}

/** What `flood` reports. */
export interface Flooded {
  frame: FrameReport;
  stats: FxStats;
  /** The frame's draw calls and triangles beyond the empty yard's. */
  drawCalls: number;
  triangles: number;
  pipelinesAfterWarmUp: number | null;
}

/** What the ID pass sees of one object. */
export type Seen = Pick<IdEntry, 'name' | 'px'>;

/** What `show` reports. */
export interface Shown {
  frame: FrameReport;
  stats: FxStats;
  seen: Seen[];
}

const message = document.querySelector<HTMLElement>('#msg');
const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
let info: Record<string, unknown> = { page: 'fx' };
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
  throw new Error('fx page: no frame was drawn in 10 tries');
}

/** Starts the renderer, the yard and the effects, and publishes `__fxPage`. */
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
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1b1d24');
  scene.add(new THREE.HemisphereLight('#c8d4ff', '#3a3226', 1.4));
  const sun = new THREE.DirectionalLight('#fff2dd', 1.5);
  sun.position.set(2, 14, 9);
  scene.add(sun);
  const library = createMaterialLibrary();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), library.get('material:default'));
  floor.name = 'yard/floor';
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(FX_SCENE.middle[0], 0, FX_SCENE.middle[2]);
  scene.add(floor);
  const camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / Math.max(1, canvas.clientHeight), 0.1, 100);
  camera.position.set(6, 7, 12);
  camera.lookAt(6, 0, 4);
  camera.updateMatrixWorld();
  const view: FrameView = { scene, camera };

  let fight: FxScene = createFxScene({ seed: SEED });
  const fx = createEffects({ fxRng: (...keys) => fight.world.fxRng(...keys) });
  scene.add(fx.root);
  fx.register(gfx.warmup);

  /** Moves the effects a frame on and draws it, the camera shaking. */
  const draw = (dt = 1 / 60): FrameReport => {
    fx.frame(dt, camera);
    fx.shake.apply(camera);
    const report = gfx.frame(view);
    fx.shake.restore(camera);
    return report;
  };

  await gfx.warmup.run(view);
  await settle(gfx, view);
  const empty = { drawCalls: gfx.stats().drawCalls, triangles: gfx.stats().triangles };

  const page = {
    gfx,
    view,
    fx,
    async run(steps: number, effects: boolean): Promise<Ran> {
      fight = createFxScene({ seed: SEED });
      fx.reset();
      fx.enabled = effects;
      const hashes: string[] = [];
      const most = { sprites: 0, decals: 0, ribbons: 0, drawCalls: 0, live: 0 };
      let [built, undrawn] = [0, 0];
      for (let i = 0; i < steps; i++) {
        fight.world.step();
        hashes.push(fight.world.hash());
        fight.draw(fx);
        const report = draw();
        built += report.built;
        if (!report.drawn) undrawn++;
        const stats = fx.stats();
        most.sprites = Math.max(most.sprites, stats.sprites);
        most.decals = Math.max(most.decals, stats.decals);
        most.ribbons = Math.max(most.ribbons, stats.ribbons);
        most.drawCalls = Math.max(most.drawCalls, stats.drawCalls);
        most.live = Math.max(most.live, stats.particles.live);
        if (i % 30 === 29) await gfx.device.queue.onSubmittedWorkDone();
      }
      await gfx.device.queue.onSubmittedWorkDone();
      const { pipelinesAfterWarmUp } = gfx.stats();
      return { hashes, built, undrawn, pipelinesAfterWarmUp, most, events: fx.stats().events };
    },
    async flood(): Promise<Flooded> {
      fx.reset();
      fx.enabled = true;
      for (let i = 0; i < 40; i++) fx.event('explosion', { position: [2 + (i % 8), 1, 2 + (i % 5)], size: 1 });
      for (let i = 0; i < 1100; i++) {
        fx.telegraph({ telegraph: 'telegraph:ring', position: [i % 12, 0, (i * 0.37) % 8], yaw: 0, u: 0.5 });
      }
      for (let i = 0; i < 40; i++) {
        const [x, z] = [1 + (i % 10), 1 + (i % 7)];
        const trail = [0, 1, 2].map((k) => ({ base: [x + k * 0.2, 1, z], tip: [x + k * 0.2, 1.6, z + 0.3] }) as const);
        fx.trail(trail, '#ff7a5a');
      }
      for (let i = 0; i < 1200; i++) fx.bolt([(i % 12) + 0.5, 1, (i * 0.13) % 8]);
      const frame = draw();
      await gfx.device.queue.onSubmittedWorkDone();
      const stats = gfx.stats();
      return {
        frame,
        stats: fx.stats(),
        drawCalls: stats.drawCalls - empty.drawCalls,
        triangles: stats.triangles - empty.triangles,
        pipelinesAfterWarmUp: stats.pipelinesAfterWarmUp,
      };
    },
    async show(): Promise<Shown> {
      fx.reset();
      fx.enabled = true;
      const shapes = ['telegraph:arc', 'telegraph:ring', 'telegraph:line', 'telegraph:cone'];
      const places = [
        [3, 0, 2.5],
        [9, 0, 2.5],
        [3, 0, 5.5],
        [9, 0, 5.5],
      ] as const;
      fx.event('explosion', { position: [6, 0.5, 4], ground: 0 });
      fx.event('hit', { position: [4.5, 1, 4] });
      for (let i = 0; i < 3; i++) draw(1 / 120);
      shapes.forEach((telegraph, i) => fx.telegraph({ telegraph, position: places[i], yaw: 0.3, u: 0.6 }));
      const trail = [0, 1, 2, 3, 4, 5].map((k) => {
        const a = k * 0.4;
        const at = (r: number, y: number) => [7.5 + Math.sin(a) * r, y, 5 + Math.cos(a) * r] as const;
        return { base: at(0.3, 1), tip: at(1.2, 1.3) };
      });
      fx.trail(trail, '#d8f2ff');
      for (const x of [5, 6, 7]) fx.bolt([x, 1.2, 2]);
      fx.emit('emitter:fire', FX_SCENE.brazier, 'brazier');
      const frame = draw(1 / 120);
      const stats = fx.stats();
      await gfx.device.queue.onSubmittedWorkDone();
      const result = await shot(gfx, view, { metrics: false, thumbnail: false });
      const seen = result.ids!.visible.map(({ name, px }) => ({ name, px }));
      return { frame, stats, seen };
    },
  };
  Object.assign(window, { __fxPage: page });
  info = { page: 'fx', ...gfx.info };
  if (message) message.hidden = true;
  signals.ready = true;
}

start().catch((error: unknown) => {
  const code = (error as { code?: string }).code ?? 'FX_PAGE_START';
  const fix = (error as { fix?: string }).fix ?? 'the console names the cause';
  fail({ code, message: String((error as Error).message ?? error), fix });
});
