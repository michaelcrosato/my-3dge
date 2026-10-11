/**
 * @file The instancing page's module (tests/pages/instancing.html, PLAN.md WP 3.8): the engine's renderer with one
 * instanced batch (engine/gfx/instancing.ts) of unit boxes seen straight from above by an orthographic camera that
 * maps one world unit to one pixel of a 400 × 320 shot, so each instance's top face covers exactly 6 × 6 pixels on
 * an 8-pixel grid of 50 × 40 cells, and the ID pass counts instances by their pixels. The batch has a per-instance
 * attribute, `tint`, which its node material multiplies with the instance colour.
 *
 * `window.__instancingPage`:
 * - `place({ count, away })` writes `count` instances: slot `i` in cell `i % 2000` of the grid, stacked one unit
 *   higher per 2,000 (so slots from 2,000 on lie on top, drawn red: a yellow instance colour times a red tint), and
 *   the slots in `away` (`[start, end)`) moved 10 km south, out of view; then draws a frame and reports it.
 * - `ids()` shoots 400 × 320 and returns the ID pass's visible entries and the pixels' colours at given points.
 * - `control(slots)` draws a plain `InstancedMesh` of `slots` slots, outside the batch and the warm-up, for one
 *   frame, and reports the pipelines that frame built: r182 compiles a shader for each one of 1,000 slots or fewer.
 *
 * Invariants: `ready` turns true once the warm-up has run and the empty batch has drawn, never after an error;
 * frames are drawn by calling the page; the batch is registered with the warm-up before its first page shows.
 *
 * @see tests/e2e/instancing.spec.ts
 */
import { attribute } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { createSettings } from '../../engine/core/settings';
import { createInstancedBatch } from '../../engine/gfx/instancing';
import { createRenderer, type FrameReport, type FrameView, type Gfx, type GfxError } from '../../engine/gfx/renderer';
import { shot } from '../../engine/gfx/shot';
import type { IdEntry } from '../../engine/gfx/idpass';

/** One structured error record, as `window.__engine.errors` holds them (PLAN.md §8.3). */
interface ErrorRecord {
  code: string;
  message: string;
  fix: string;
}

/** The shot's size, the grid's pitch and cell count, and each instance's side, in pixels (= metres here). */
export const GRID = { width: 400, height: 320, pitch: 8, side: 6, cols: 50, cells: 2000 } as const;

/** What `place` reports. */
export interface Placed {
  frame: FrameReport;
  pages: { name: string; count: number }[];
  uploadedPages: number;
  /** The device's pipeline builds so far, and those after the warm-up. */
  built: number;
  pipelinesAfterWarmUp: number | null;
  drawCalls: number;
  counted: number;
}

const message = document.querySelector<HTMLElement>('#msg');
const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
let info: Record<string, unknown> = { page: 'instancing' };
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
  throw new Error('instancing page: no frame was drawn in 10 tries');
}

/** Starts the renderer, the scene and the batch, and publishes `__instancingPage`. */
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
  scene.background = new THREE.Color('#000000');
  // One world unit is one pixel of the shot: x runs right, z runs down the picture.
  const camera = new THREE.OrthographicCamera(0, GRID.width, 0, -GRID.height, 1, 100);
  camera.position.set(0, 50, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  const view: FrameView = { scene, camera };
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicNodeMaterial({ colorNode: attribute('tint', 'vec3') });
  const batch = createInstancedBatch({ name: 'crowd', geometry, material, attributes: { tint: 3 } });
  scene.add(batch.root);
  batch.register(gfx.warmup);
  const plain = new THREE.MeshBasicNodeMaterial();
  const m = new THREE.Matrix4();

  const page = {
    gfx,
    view,
    batch,
    three: THREE,
    /** Writes the instances (see the file comment), draws a frame and reports it. */
    async place(spec: { count: number; away?: [number, number] }): Promise<Placed> {
      const [start, end] = spec.away ?? [0, 0];
      batch.begin();
      for (let i = 0; i < spec.count; i++) {
        const cell = i % GRID.cells;
        const layer = Math.floor(i / GRID.cells);
        const x = (cell % GRID.cols) * GRID.pitch + GRID.pitch / 2;
        const z = Math.floor(cell / GRID.cols) * GRID.pitch + GRID.pitch / 2 + (i >= start && i < end ? 10_000 : 0);
        m.makeScale(GRID.side, 1, GRID.side).setPosition(x, layer, z);
        const slot = batch.add(m.elements, layer ? [1, 1, 0] : [1, 1, 1]);
        batch.setAttributeAt('tint', slot, layer ? [1, 0, 0] : [1, 1, 1]);
      }
      batch.end();
      const frame = await settle(gfx, view);
      const stats = gfx.stats();
      return {
        frame,
        pages: batch.pages.map((mesh) => ({ name: mesh.name, count: mesh.count })),
        uploadedPages: batch.stats().uploadedPages,
        built: gfx.pipelines.count().built,
        pipelinesAfterWarmUp: stats.pipelinesAfterWarmUp,
        drawCalls: stats.drawCalls,
        counted: batch.drawCalls(),
      };
    },
    /** Shoots 400 × 320: the ID pass's visible entries, and the colour at each of `points` (x, y from the top left). */
    async ids(points: [number, number][] = []): Promise<{ visible: IdEntry[]; colours: number[][] }> {
      const size = { width: GRID.width, height: GRID.height };
      const result = await shot(gfx, view, { size, pixels: true, metrics: false, thumbnail: false });
      const colours = points.map(([x, y]) =>
        Array.from(result.pixels!.slice((y * GRID.width + x) * 4, (y * GRID.width + x) * 4 + 3)),
      );
      return { visible: result.ids!.visible, colours };
    },
    /** Draws a plain instanced mesh of `slots` slots for one frame; returns the pipelines that frame built. */
    async control(slots: number): Promise<number> {
      const mesh = new THREE.InstancedMesh(geometry, plain, slots);
      mesh.count = 1;
      mesh.frustumCulled = false;
      mesh.setMatrixAt(0, m.makeTranslation(0, 0, 10_000));
      scene.add(mesh);
      const frame = await settle(gfx, view);
      scene.remove(mesh);
      return frame.built;
    },
  };
  await gfx.warmup.run(view);
  await settle(gfx, view);
  Object.assign(window, { __instancingPage: page });
  info = { page: 'instancing', ...gfx.info };
  if (message) message.hidden = true;
  signals.ready = true;
}

start().catch((error: unknown) => {
  const code = (error as { code?: string }).code ?? 'INSTANCING_PAGE_START';
  const fix = (error as { fix?: string }).fix ?? 'the console names the cause';
  fail({ code, message: String((error as Error).message ?? error), fix });
});
