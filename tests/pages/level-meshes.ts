/**
 * @file The level-meshes page's module (tests/pages/level-meshes.html, PLAN.md WP 2.4): the engine's renderer
 * (engine/gfx/renderer.ts) with a lit, shadowed, empty scene, and `window.__levelPage.show(text, file)`, which
 * compiles a level's text (engine/world/level/compile.ts), draws it with the level meshes (engine/gfx/level/meshes.ts)
 * and the material library (engine/gfx/materials/library.ts), registers them with the warm-up, warms up, draws a frame
 * and reports what it cost: the frame (pipelines built), the renderer's draw calls and triangles, those of the empty
 * scene (the renderer's own output pass), the meshes' own count of their draw calls, and their names. The spec passes the level's text, read in Node, so the page fetches
 * nothing. The scene holds nothing else, so every draw call of a frame beyond the empty scene's is the level's.
 *
 * Light and view: a hemisphere light and one shadow-casting directional light (one shadow map), and a camera above
 * the level's south edge looking at its middle, so the whole of a 16 × 12 m room is in view.
 *
 * Storeys (WP 13.14): the page defines the storey fixtures' room markers (fixtures/levels/storeys/glyphs.ts) on its
 * registry, so `show` draws fixtures/levels/storeys/*.txt too; `style(name)` restyles what it shows (a style set over
 * the page's library, attached to the warm-up on first use, engine/gfx/materials/styles.ts) and draws a frame.
 *
 * Invariants: `ready` turns true once the renderer has drawn the empty scene, never after an error; a failure to start
 * is one record in `__engine.errors`, shown as page text; `show` replaces the level shown before.
 *
 * @see tests/e2e/level-meshes.spec.ts
 */
import * as THREE from 'three/webgpu';
import { createSettings } from '../../engine/core/settings';
import { createLevelMeshes, type LevelMeshes } from '../../engine/gfx/level/meshes';
import { createMaterialLibrary } from '../../engine/gfx/materials/library';
import { createStyleSet, type MaterialStyle, type StyleSet } from '../../engine/gfx/materials/styles';
import { createRenderer, type FrameReport, type FrameView, type Gfx, type GfxError } from '../../engine/gfx/renderer';
import { compileLevel } from '../../engine/world/level/compile';
import { defineStoreyFixtureGlyphs } from '../../fixtures/levels/storeys/glyphs';

defineStoreyFixtureGlyphs();

/** One structured error record, as `window.__engine.errors` holds them (PLAN.md §8.3). */
interface ErrorRecord {
  code: string;
  message: string;
  fix: string;
}

/** What `show` reports. */
export interface Shown {
  frame: FrameReport;
  /** The frame's draw calls and triangles, as the renderer counted them. */
  drawCalls: number;
  triangles: number;
  /** The draw calls of the same frame without a level: the renderer's own (its output pass). */
  empty: number;
  /** The level meshes' own count, with one shadow map. */
  counted: number;
  names: string[];
  pipelinesAfterWarmUp: number | null;
}

const message = document.querySelector<HTMLElement>('#msg');
const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
let info: Record<string, unknown> = { page: 'level-meshes' };
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
  throw new Error('level-meshes page: no frame was drawn in 10 tries');
}

/** Starts the renderer and the empty scene, and publishes `__levelPage`. */
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
  scene.background = new THREE.Color('#1b1d24');
  scene.add(new THREE.HemisphereLight('#c8d4ff', '#3a3226', 1.2));
  const sun = new THREE.DirectionalLight('#fff2dd', 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200);
  const view: FrameView = { scene, camera };
  const library = createMaterialLibrary();
  let shown: LevelMeshes | null = null;
  let registration: { dispose(): void } | null = null;
  let styles: StyleSet | null = null;

  const page = {
    gfx,
    scene,
    camera,
    view,
    three: THREE,
    get meshes() {
      return shown;
    },
    /** Draws a frame now; resolves once the GPU has finished it. */
    settle: () => settle(gfx, view),
    /** Draws what is shown in `style`, warming every style up first the first time; reports the frame. */
    async style(style: MaterialStyle): Promise<FrameReport> {
      if (!styles) {
        styles = createStyleSet({ library });
        styles.attach(gfx.warmup, scene);
        await gfx.warmup.run(view);
      }
      styles.setStyle(style, scene);
      return settle(gfx, view);
    },
    /** Shows the level `text` (from `file`) in place of the last one, warms up and draws; see the file comment. */
    async show(text: string, file: string): Promise<Shown> {
      registration?.dispose();
      shown?.dispose();
      const level = compileLevel(text, { file });
      shown = createLevelMeshes(level, { materials: library });
      scene.add(shown.root);
      registration = shown.register(gfx.warmup);
      const [w, d] = [level.cols * level.tile, level.rows * level.tile];
      camera.position.set(w / 2, Math.max(w, d) * 0.95, d + Math.max(w, d) * 0.5);
      camera.lookAt(w / 2, 0, d / 2);
      sun.position.set(w / 2 - w * 0.4, 14, d / 2 - d * 0.6);
      sun.target.position.set(w / 2, 0, d / 2);
      const half = Math.hypot(w, d) / 2 + 2;
      Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 0.5, far: 60 });
      sun.shadow.camera.updateProjectionMatrix();
      await gfx.warmup.run(view);
      const frame = await settle(gfx, view);
      const stats = gfx.stats();
      return {
        frame,
        drawCalls: stats.drawCalls,
        triangles: stats.triangles,
        empty,
        counted: shown.drawCalls(1),
        names: shown.parts.map((part) => part.name),
        pipelinesAfterWarmUp: stats.pipelinesAfterWarmUp,
      };
    },
  };
  await gfx.warmup.run(view);
  await settle(gfx, view);
  const empty = gfx.stats().drawCalls;
  Object.assign(window, { __levelPage: page });
  info = { page: 'level-meshes', ...gfx.info };
  if (message) message.hidden = true;
  signals.ready = true;
}

start().catch((error: unknown) => {
  const code = (error as { code?: string }).code ?? 'LEVEL_PAGE_START';
  const fix = (error as { fix?: string }).fix ?? 'the console names the cause';
  fail({ code, message: String((error as Error).message ?? error), fix });
});
