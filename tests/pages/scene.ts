/**
 * @file The scene page's module (tests/pages/scene.html): the fixture scene (tests/pages/sceneFixture.ts) drawn by
 * the engine's renderer (engine/gfx/renderer.ts) for the render tests, which drive it through `window.__scene` and
 * import the modules they test into the page (`await import('/engine/gfx/pipelines.ts')`): the same module instances
 * the page runs. It publishes `window.__engine` (`ready`, `errors`, `info()`), registers both pools with the warm-up,
 * warms up with progress, draws the first frame, then draws one frame per animation frame through `gfx.frame`.
 *
 * URL parameters: settings by path, as `x set` and `__engine.set` take them (`?gfx.resolution=full`,
 * `?gfx.featuresOff=["feature:timestamps"]`), and `post=1`, which draws through one `PostProcessing` pass: the warm-up
 * then compiles for that pass's render target.
 *
 * Invariants: `ready` turns true once the startup warm-up and the first frame are done on the GPU, and never after an
 * error; a failure to start is one record in `__engine.errors` (`{ code, message, fix }`), shown as page text.
 *
 * @see tests/e2e/renderer.spec.ts
 */
import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { log } from '../../engine/core/log';
import { createSettings } from '../../engine/core/settings';
import { createRenderer, type FrameReport, type FrameView, type GfxError } from '../../engine/gfx/renderer';
import type { WarmupProgress } from '../../engine/gfx/warmup';
import { buildScene, FIXTURE } from './sceneFixture';

/** One structured error record, as `window.__engine.errors` holds them (PLAN.md §8.3). */
interface ErrorRecord {
  code: string;
  message: string;
  fix: string;
}

const post = new URLSearchParams(location.search).get('post') === '1';
const message = document.querySelector<HTMLElement>('#msg');
const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
let info: Record<string, unknown> = { page: 'scene', post };
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

/** Starts the renderer, builds and warms the fixture, draws the first frame and publishes `__scene`. */
async function start(): Promise<void> {
  const settings = createSettings();
  settings.fromUrl(location.search, { reserved: ['post'] });
  let gfx;
  try {
    gfx = await createRenderer(canvas, { settings });
  } catch (error) {
    const { code, message, fix } = error as GfxError;
    if (code && fix) return fail({ code, message, fix });
    throw error;
  }
  gfx.renderer.shadowMap.enabled = true;
  const built = buildScene(FIXTURE);
  const { scene, camera, pools } = built;
  for (const [name, pool] of Object.entries(pools)) gfx.warmup.register(`pool:${name}`, { objects: () => [pool.mesh] });
  const view: FrameView = { scene, camera };
  if (post) {
    const pipeline = new THREE.PostProcessing(gfx.renderer);
    const scenePass = pass(scene, camera);
    pipeline.outputNode = scenePass;
    view.draw = () => pipeline.render();
    view.target = scenePass.renderTarget;
  }
  const progress: WarmupProgress[] = [];
  const startup = await gfx.warmup.run(view, { onProgress: (step) => progress.push(step) });

  const ring = new THREE.Matrix4();
  const page = {
    gfx,
    scene,
    camera,
    view,
    settings,
    log,
    pools,
    meshes: built.meshes,
    startup,
    progress,
    /** three.js as the page loaded it, for tests that add objects (another import would load a second copy). */
    three: THREE,
    /** Draws one frame now, as the page's loop does. */
    draw: (alpha = 1): FrameReport => gfx.frame({ ...view, alpha }),
    /** Draws until a frame is drawn, waiting out any warm-up; resolves once the GPU has finished it. */
    async settle(alpha = 1): Promise<FrameReport> {
      for (let tries = 0; tries < 10; tries++) {
        const report = page.draw(alpha);
        if (report.drawn) {
          await gfx.device.queue.onSubmittedWorkDone();
          return report;
        }
        if (gfx.warmup.running) await gfx.warmup.run(view).catch(() => undefined);
      }
      throw new Error('scene page: no frame was drawn in 10 tries');
    },
    /** Shows a pool: `count` sparks on a ring above the floor, or the flags. */
    show(name: string, count = 1): void {
      const { mesh, root } = pools[name];
      root.visible = true;
      const instanced = mesh as THREE.InstancedMesh;
      if (!instanced.isInstancedMesh) return;
      for (let i = 0; i < count; i++) {
        const turn = (i / count) * Math.PI * 2;
        instanced.setMatrixAt(i, ring.makeTranslation(Math.cos(turn) * 2.2, 0, Math.sin(turn) * 2.2));
      }
      instanced.count = count;
      instanced.instanceMatrix.clearUpdateRanges();
      instanced.instanceMatrix.needsUpdate = true;
    },
  };
  const first = await page.settle();
  if (first.built > 0) throw new Error(`scene page: the first frame built ${first.built} pipelines after the warm-up`);
  Object.assign(window, { __scene: page });
  info = { page: 'scene', post, ...gfx.info };
  const loop = () => {
    page.draw();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  if (message) message.hidden = true;
  signals.ready = true;
}

start().catch((error: unknown) => {
  const code = (error as { code?: string }).code ?? 'SCENE_START';
  const fix = (error as { fix?: string }).fix ?? 'the console names the cause';
  fail({ code, message: String((error as Error).message ?? error), fix });
});
