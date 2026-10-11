/**
 * @file The crowd-render page's module (tests/pages/crowd-render.html, PLAN.md WP 5.4): the engine's renderer with a
 * lit floor (a hemisphere light and one shadow-casting sun: one shadow map) and a crowd (engine/gfx/puppets/crowd.ts)
 * drawing the crowd scene (tests/pages/crowdRenderScene.ts): every body it wears is prepared, and the crowd registered
 * with the warm-up, before the first frame.
 *
 * `window.__crowdPage`:
 * - `grow(n)` grows the big scene (seed 5, a square 106 m wide: 5,000 wanderers 1.5 m apart) to n wanderers, steps
 *   it twice, draws it with LOD on from high above its south side (every wanderer in view and within 200 m) and draws
 *   a frame: the frame's draw calls, the empty scene's, the crowd's own count with one shadow map, the pipelines built,
 *   and the crowd's stats (bodies per band, culled, instances and shown pages by batch).
 * - `ids()` shoots the last frame with the ID pass: what it sees, by name, with its pixels.
 * - `run(mode, ticks, every)` makes a new scene (seed 7, 300 wanderers in a 60 m square), steps it `ticks` times and,
 *   after each step, has the view draw it with LOD `on` or `off`, or not at all (`none`), drawing a frame every
 *   `every` steps from a low camera at one corner, so every band occurs and some wanderers are out of view: the
 *   world's hash, the bodies drawn per band and culled over the run, the instances written, the pipelines built, and
 *   the crowd's stats for the last step (whose frame `ids()` then shoots).
 *
 * Invariants: `ready` turns true once the warm-up has run and the empty scene has drawn, never after an error; frames
 * are drawn by calling the page; nothing is compiled or registered after the warm-up.
 *
 * @see tests/e2e/crowd-render.spec.ts
 */
import * as THREE from 'three/webgpu';
import { createSettings } from '../../engine/core/settings';
import { createMaterialLibrary } from '../../engine/gfx/materials/library';
import { FLOATER_BODY } from '../../engine/gfx/puppets/bodies/floater';
import { createCrowd, type CrowdStats } from '../../engine/gfx/puppets/crowd';
import { createRenderer, type FrameReport, type FrameView, type Gfx, type GfxError } from '../../engine/gfx/renderer';
import { shot } from '../../engine/gfx/shot';
import { createCrowdScene, SLIME_LOOKS, WALKER_LOOKS } from './crowdRenderScene';

/** One structured error record, as `window.__engine.errors` holds them (PLAN.md §8.3). */
interface ErrorRecord {
  code: string;
  message: string;
  fix: string;
}

/** What `grow` reports. */
export interface Grown {
  agents: number;
  drawn: number;
  frame: FrameReport;
  drawCalls: number;
  empty: number;
  counted: number;
  triangles: number;
  pipelinesAfterWarmUp: number | null;
  crowd: CrowdStats;
}

/** What `run` reports. */
export interface Ran {
  hash: string;
  /** Bodies drawn in each band, summed over the run's steps. */
  bands: number[];
  culled: number;
  instances: number;
  frames: number;
  built: number;
  /** The crowd's stats for the last step drawn. */
  last: CrowdStats | null;
}

const message = document.querySelector<HTMLElement>('#msg');
const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
let info: Record<string, unknown> = { page: 'crowd-render' };
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
  throw new Error('crowd-render page: no frame was drawn in 10 tries');
}

/** Starts the renderer, the scene and the crowd, and publishes `__crowdPage`. */
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
  gfx.renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#15171c');
  scene.add(new THREE.HemisphereLight('#c8d4ff', '#3a3226', 1.2));
  const sun = new THREE.DirectionalLight('#fff2dd', 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.position.set(-30, 80, 40);
  Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 200 });
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun, sun.target);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(130, 130).rotateX(-Math.PI / 2));
  floor.material = new THREE.MeshLambertMaterial({ color: '#3a3f48' });
  floor.receiveShadow = true;
  floor.name = 'floor';
  scene.add(floor);
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 400);
  const view: FrameView = { scene, camera };
  const library = createMaterialLibrary();

  const crowd = createCrowd({ materials: library });
  crowd.prepare(...WALKER_LOOKS, ...SLIME_LOOKS, FLOATER_BODY);
  scene.add(crowd.root);
  crowd.register(gfx.warmup);
  const big = createCrowdScene({ seed: 5, side: 106 });

  const page = {
    gfx,
    view,
    crowd,
    three: THREE,
    async grow(n: number): Promise<Grown> {
      big.grow(n);
      big.world.step();
      big.world.step();
      crowd.lod.enabled = true;
      camera.position.set(0, 95, 95);
      camera.lookAt(0, 0, 0);
      const drawn = big.draw(crowd, camera);
      const frame = await settle(gfx, view);
      const stats = gfx.stats();
      return {
        agents: big.world.count,
        drawn,
        frame,
        drawCalls: stats.drawCalls,
        empty,
        counted: crowd.drawCalls(1),
        triangles: stats.triangles,
        pipelinesAfterWarmUp: stats.pipelinesAfterWarmUp,
        crowd: crowd.stats(),
      };
    },
    async ids(): Promise<{ name: string; px: number }[]> {
      const result = await shot(gfx, view, { metrics: false, thumbnail: false });
      return result.ids!.visible.map(({ name, px }) => ({ name, px }));
    },
    async run(mode: 'on' | 'off' | 'none', ticks = 60, every = 6): Promise<Ran> {
      const small = createCrowdScene({ seed: 7, side: 60 });
      small.grow(300);
      crowd.lod.enabled = mode === 'on';
      camera.position.set(-31, 3, 31);
      camera.lookAt(0, 0, 0);
      const bands = crowd.lod.bands.map(() => 0);
      const ran: Ran = { hash: '', bands, culled: 0, instances: 0, frames: 0, built: 0, last: null };
      for (let tick = 1; tick <= ticks; tick++) {
        small.world.step();
        if (mode === 'none') continue;
        small.draw(crowd, camera);
        const { lod, instances } = (ran.last = crowd.stats());
        lod.bands.forEach((count, band) => (ran.bands[band] += count));
        ran.culled += lod.outside + lod.far + lod.near;
        ran.instances += Object.values(instances).reduce((sum, count) => sum + count, 0);
        if (tick % every) continue;
        ran.built += (await settle(gfx, view)).built;
        ran.frames++;
      }
      ran.hash = small.world.hash();
      return ran;
    },
  };
  crowd.root.visible = false;
  await gfx.warmup.run(view);
  await settle(gfx, view);
  const empty = gfx.stats().drawCalls;
  crowd.root.visible = true;
  Object.assign(window, { __crowdPage: page });
  info = { page: 'crowd-render', ...gfx.info };
  if (message) message.hidden = true;
  signals.ready = true;
}

start().catch((error: unknown) => {
  const code = (error as { code?: string }).code ?? 'CROWD_PAGE_START';
  const fix = (error as { fix?: string }).fix ?? 'the console names the cause';
  fail({ code, message: String((error as Error).message ?? error), fix });
});
