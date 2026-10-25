/**
 * @file The gpu-crowds page's module (tests/pages/gpu-crowds.html, PLAN.md WP 11.4): the crowd-render page's scene
 * (tests/pages/crowdRenderScene.ts: the lit floor, one shadow-casting sun, the wanderers) drawn by two crowds of the
 * same bodies, `cpu` through the instancing service and `gpu` through a GPU crowd (engine/gfx/enhanced/crowds.ts, from
 * the renderer's features: `gpuCrowdsFor`), one shown at a time, both prepared and registered with the warm-up before
 * the first frame.
 *
 * `window.__gpuCrowdsPage`:
 * - `grow(n)` grows the scene (seed 5, a square 106 m wide) to n wanderers, steps it twice and places the camera high
 *   above its south side (`view: 'high'`, every wanderer in view) or low at one corner (`'low'`, some out of view);
 * - `frame(path)` draws the wanderers with that crowd and draws a frame: its report, the renderer's draw calls,
 *   triangles and compute calls beyond the empty scene's, the crowd's own count with one shadow map, the pipelines
 *   built, the crowd's stats and, for `gpu`, the GPU crowd's;
 * - `compare(threshold, style)` shoots the same frame through each crowd, its materials in `style` (engine/gfx/materials/
 *   styles.ts: `lambert` by default, `toon`, `flat`, `pbr`; the GPU crowd's copies re-pointed through their meshes'
 *   `userData.restyle`), and counts the pixels whose channels differ by more than `threshold` (of 255), and those that
 *   differ at all;
 * - `cull()` reads the GPU crowd's buffers back after its last frame and checks the cull against the CPU: each batch's
 *   instances kept (an instance whose sphere touches the view, three.js's `Frustum.intersectsSphere` on the matrices
 *   the CPU wrote) and their order; instances within 1 mm of a plane may go either way;
 * - `ids(path)` shoots the last frame with the ID pass: what it sees, by name, with its pixels.
 *
 * Invariants: `ready` turns true once the warm-up has run and the empty scene has drawn, never after an error; frames
 * are drawn by calling the page; the GPU's buffers are read back here, in a test page, never in the engine.
 *
 * @see tests/e2e/gpu-crowds.spec.ts
 */
import * as THREE from 'three/webgpu';
import { createSettings } from '../../engine/core/settings';
import { gpuCrowdsFor, type GpuCrowd } from '../../engine/gfx/features';
import { createMaterialLibrary } from '../../engine/gfx/materials/library';
import { createStyleSet, type MaterialStyle } from '../../engine/gfx/materials/styles';
import { FLOATER_BODY } from '../../engine/gfx/puppets/bodies/floater';
import { createCrowd, type Crowd } from '../../engine/gfx/puppets/crowd';
import { createRenderer, type FrameView, type Gfx, type GfxError } from '../../engine/gfx/renderer';
import { shot } from '../../engine/gfx/shot';
import { createCrowdScene, SLIME_LOOKS, WALKER_LOOKS } from './crowdRenderScene';

/** One structured error record, as `window.__engine.errors` holds them (PLAN.md §8.3). */
interface ErrorRecord {
  code: string;
  message: string;
  fix: string;
}

const message = document.querySelector<HTMLElement>('#msg');
const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
let info: Record<string, unknown> = { page: 'gpu-crowds' };
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
async function settle(gfx: Gfx, view: FrameView) {
  for (let tries = 0; tries < 10; tries++) {
    const report = gfx.frame(view);
    if (report.drawn) {
      await gfx.device.queue.onSubmittedWorkDone();
      return report;
    }
    if (gfx.warmup.running) await gfx.warmup.run(view).catch(() => undefined);
  }
  throw new Error('gpu-crowds page: no frame was drawn in 10 tries');
}

/** Whether the sphere (centre, radius) touches every plane's inside: 1, 0, or 0.5 within 1 mm of a plane. */
function touches(planes: readonly THREE.Vector4[], c: readonly number[], radius: number): number {
  let near = false;
  for (const p of planes) {
    const d = p.x * c[0] + p.y * c[1] + p.z * c[2] + p.w + radius;
    if (d < -1e-3) return 0;
    if (d < 1e-3) near = true;
  }
  return near ? 0.5 : 1;
}

/** Starts the renderer, the scene and both crowds, and publishes `__gpuCrowdsPage`. */
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
  const styles = createStyleSet({ library });
  const maker = gpuCrowdsFor(gfx.features);
  const half: GpuCrowd | null = maker ? maker.make({ capacity: maker.capacity(5000) }) : null;
  const crowds: Record<'cpu' | 'gpu', Crowd> = {
    cpu: createCrowd({ materials: library, name: 'cpu' }),
    gpu: createCrowd({ materials: library, name: 'gpu', ...(half ? { gpu: half } : {}) }),
  };
  for (const crowd of Object.values(crowds)) {
    crowd.prepare(...WALKER_LOOKS, ...SLIME_LOOKS, FLOATER_BODY);
    scene.add(crowd.root);
    crowd.register(gfx.warmup, crowd.root.name);
  }
  const big = createCrowdScene({ seed: 5, side: 106 });
  const show = (path: 'cpu' | 'gpu' | null) => {
    crowds.cpu.root.visible = path === 'cpu';
    crowds.gpu.root.visible = path === 'gpu';
  };

  const page = {
    gfx,
    view,
    crowds,
    half,
    three: THREE,
    grow(n: number, place: 'high' | 'low' = 'high') {
      big.grow(n);
      big.world.step();
      big.world.step();
      if (place === 'high') camera.position.set(0, 95, 95);
      else camera.position.set(-31, 3, 31);
      camera.lookAt(0, 0, 0);
      return { agents: big.world.count };
    },
    async frame(path: 'cpu' | 'gpu') {
      show(path);
      const crowd = crowds[path];
      const drawn = big.draw(crowd, camera);
      const frame = await settle(gfx, view);
      const stats = gfx.stats();
      return {
        drawn,
        frame,
        drawCalls: stats.drawCalls - empty.drawCalls,
        triangles: stats.triangles - empty.triangles,
        computeCalls: stats.computeCalls,
        counted: crowd.drawCalls(1),
        pipelinesAfterWarmUp: stats.pipelinesAfterWarmUp,
        crowd: crowd.stats(),
        gpu: path === 'gpu' && half ? half.stats() : null,
      };
    },
    async compare(threshold = 8, style: MaterialStyle = 'lambert') {
      const pixels = async (path: 'cpu' | 'gpu') => {
        show(path);
        big.draw(crowds[path], camera);
        styles.setStyle(style, crowds[path].root);
        return (await shot(gfx, view, { ids: false, metrics: false, thumbnail: false, pixels: true })).pixels!;
      };
      const [a, b] = [await pixels('cpu'), await pixels('gpu')];
      let [over, any] = [0, 0];
      for (let i = 0; i < a.length; i += 4) {
        const most = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
        if (most > 0) any++;
        if (most > threshold) over++;
      }
      return { pixels: a.length / 4, over, any };
    },
    async cull() {
      if (!half) return null;
      const { buffers } = half;
      const read = async (attribute: THREE.BufferAttribute) =>
        gfx.renderer.getArrayBufferAsync(attribute as unknown as THREE.StorageBufferAttribute);
      const value = (node: unknown) => (node as { value: THREE.BufferAttribute }).value;
      const drawnRows = new Float32Array(await read(value(buffers.drawn)));
      const args = new Uint32Array(await read(buffers.indirect));
      const source = value(buffers.source).array as Float32Array;
      const layout = value(buffers.layout).array as Uint32Array;
      const spheres = value(buffers.spheres).array as Float32Array;
      const report: { batch: number; shown: number; kept: number; got: number; maybe: number; order: boolean }[] = [];
      for (let batch = 0; batch < buffers.batches; batch++) {
        const [start, shown] = [layout[batch * 4], layout[batch * 4 + 1]];
        if (!shown) continue;
        const s = spheres.subarray(batch * 4, batch * 4 + 4);
        const expected: { slot: number; maybe: boolean }[] = [];
        for (let j = 0; j < shown; j++) {
          const f = (start + j) * 16;
          const r = (row: number) => source.subarray(f + row * 4, f + row * 4 + 4);
          const [r0, r1, r2] = [r(0), r(1), r(2)];
          const centre = [r0, r1, r2].map((row) => row[0] * s[0] + row[1] * s[1] + row[2] * s[2] + row[3]);
          const axis = (k: number) => Math.hypot(r0[k], r1[k], r2[k]);
          const seen = touches(buffers.planes, centre, s[3] * Math.max(axis(0), axis(1), axis(2)));
          if (seen > 0) expected.push({ slot: start + j, maybe: seen < 1 });
        }
        const got = args[batch * 5 + 1];
        let [at, order] = [0, true];
        for (let g = 0; g < got && order; g++) {
          const row = drawnRows.subarray((start + g) * 16, (start + g) * 16 + 16);
          while (at < expected.length && expected[at].maybe && !row.every((v, k) => v === source[expected[at].slot * 16 + k])) at++; // prettier-ignore
          order = at < expected.length && row.every((v, k) => v === source[expected[at].slot * 16 + k]);
          at++;
        }
        const maybe = expected.filter((e) => e.maybe).length;
        report.push({ batch, shown, kept: expected.length, got, maybe, order });
      }
      return report;
    },
    async ids(path: 'cpu' | 'gpu'): Promise<{ name: string; px: number }[]> {
      show(path);
      big.draw(crowds[path], camera);
      const result = await shot(gfx, view, { metrics: false, thumbnail: false });
      return result.ids!.visible.map(({ name, px }) => ({ name, px }));
    },
  };
  show(null);
  await gfx.warmup.run(view);
  await settle(gfx, view);
  const { drawCalls, triangles } = gfx.stats();
  const empty = { drawCalls, triangles };
  Object.assign(window, { __gpuCrowdsPage: page });
  info = { page: 'gpu-crowds', ...gfx.info };
  if (message) message.hidden = true;
  signals.ready = true;
}

start().catch((error: unknown) => {
  const code = (error as { code?: string }).code ?? 'GPU_CROWDS_PAGE_START';
  const fix = (error as { fix?: string }).fix ?? 'the console names the cause';
  fail({ code, message: String((error as Error).message ?? error), fix });
});
