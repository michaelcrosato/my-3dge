/**
 * @file The hall page's module (tests/pages/hall.html, PLAN.md WP 4.4): the engine's renderer (engine/gfx/renderer.ts)
 * with a lit, shadowed scene, and `window.__hallPage.show(text, file)`, which compiles a level's text
 * (engine/world/level/compile.ts), draws it with the level meshes (engine/gfx/level/meshes.ts) and the material
 * library, gives it a cutaway (engine/gfx/cutaway.ts), registers both with the warm-up, warms up through both
 * cameras (r182 builds a pipeline per projection; the app does the same, engine/app/engine.ts) and draws. Then
 * `look(camera, focus)` draws a frame through a camera, cut away for it, and reports what it cost: the frame
 * (pipelines built), the renderer's draw calls beyond the empty scene's, the meshes' and twins' own count, and what
 * the cutaway cut. A camera is an engine camera code (`cam=iso,90,1`, `cam3=orbit,…`) following `focus`, or an
 * overview (`{ azimuth, elevation, projection }`, degrees) that frames the whole level from round its middle. The spec
 * passes the level's text, read in Node, so the page fetches nothing.
 *
 * Light: a hemisphere light and one shadow-casting directional light (one shadow map) whose shadow camera covers the
 * level, so nothing is culled from the shadow pass and every caster is drawn into it.
 *
 * Invariants: `ready` turns true once the renderer has drawn the empty scene, never after an error; a failure to start
 * is one record in `__engine.errors`, shown as page text; the three.js cameras are made once (one per projection,
 * engine/gfx/cameras/place.ts), so turning or switching the camera makes no new one.
 *
 * @see tests/e2e/hall.spec.ts
 */
import * as THREE from 'three/webgpu';
import { createSettings } from '../../engine/core/settings';
import { createCamera, createCameraPair } from '../../engine/gfx/cameras/place';
import { lookAt, makePose, orbitPoint, type CameraPose, type Vec3 } from '../../engine/gfx/cameras/pose';
import { createCutaway, type Cutaway, type CutawayReport } from '../../engine/gfx/cutaway';
import { createLevelMeshes, type LevelMeshes } from '../../engine/gfx/level/meshes';
import { createMaterialLibrary } from '../../engine/gfx/materials/library';
import { createRenderer, type FrameReport, type FrameView, type Gfx, type GfxError } from '../../engine/gfx/renderer';
import { compileLevel } from '../../engine/world/level/compile';

/** One structured error record, as `window.__engine.errors` holds them (PLAN.md §8.3). */
interface ErrorRecord {
  code: string;
  message: string;
  fix: string;
}

/** A view of the whole level from round its middle: degrees, and the projection. */
export interface Overview {
  azimuth: number;
  elevation: number;
  projection: 'orthographic' | 'perspective';
}

/** What `look` reports. */
export interface Looked {
  frame: FrameReport;
  /** The frame's draw calls beyond the empty scene's (the renderer's output pass): the level's and the twins'. */
  drawCalls: number;
  /** The level meshes' and the twins' own count, with one shadow map. */
  counted: number;
  pipelinesAfterWarmUp: number | null;
  cut: CutawayReport['parts'];
  /** The camera's code, or `overview`. */
  camera: string;
}

/** What `show` reports. */
export interface Shown extends Looked {
  names: string[];
  twins: string[];
  /** The empty scene's draw calls. */
  empty: number;
}

const message = document.querySelector<HTMLElement>('#msg');
const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
let info: Record<string, unknown> = { page: 'hall' };
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
  throw new Error('hall page: no frame was drawn in 10 tries');
}

/** Starts the renderer and the empty scene, and publishes `__hallPage`. */
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
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  const cameras = createCameraPair();
  const aspect = () => canvas.clientWidth / Math.max(1, canvas.clientHeight);
  const view: FrameView = { scene, camera: cameras.orthographic };
  const library = createMaterialLibrary();
  let shown: { meshes: LevelMeshes; cutaway: Cutaway; registrations: { dispose(): void }[] } | null = null;
  let middle: Vec3 = [0, 0, 0];
  let reach = 10;

  /** The pose of `camera` (a code following `focus`, or an overview). */
  const poseOf = (camera: string | Overview, focus: Vec3): CameraPose => {
    if (typeof camera === 'string') return createCamera(camera).update({ follow: focus });
    const deg = Math.PI / 180;
    const ortho = camera.projection === 'orthographic';
    const distance = ortho ? 120 : reach / Math.tan(25 * deg);
    const position = orbitPoint(middle, camera.azimuth * deg, camera.elevation * deg, distance);
    const { yaw, pitch } = lookAt(position, middle);
    return makePose({
      position,
      yaw,
      pitch,
      distance,
      projection: camera.projection,
      fov: 50,
      frustumSize: 2 * reach,
      near: 0.5,
      far: 400,
    });
  };

  /** Draws one frame through `camera`, cut away for it, and reports the cost. */
  const look = async (camera: string | Overview, focus: Vec3): Promise<Looked> => {
    if (!shown) throw new Error('hall page: show a level first');
    const pose = poseOf(camera, focus);
    view.camera = cameras.place(pose, aspect());
    const report = shown.cutaway.update(pose, focus);
    const frame = await settle(gfx, view);
    const stats = gfx.stats();
    return {
      frame,
      drawCalls: stats.drawCalls - empty,
      counted: shown.meshes.drawCalls(1) + shown.cutaway.drawCalls(1),
      pipelinesAfterWarmUp: stats.pipelinesAfterWarmUp,
      cut: report.parts,
      camera: typeof camera === 'string' ? camera : 'overview',
    };
  };

  const page = {
    gfx,
    scene,
    view,
    three: THREE,
    get meshes() {
      return shown?.meshes ?? null;
    },
    get cutaway() {
      return shown?.cutaway ?? null;
    },
    /** Draws a frame now; resolves once the GPU has finished it. */
    settle: () => settle(gfx, view),
    look,
    /**
     * Shows the level `text` (from `file`) in place of the last one with its cutaway, warms up and draws through the
     * overview from `first`; see the file comment.
     */
    async show(text: string, file: string, first: Overview, focus: Vec3): Promise<Shown> {
      if (shown) {
        for (const registration of shown.registrations) registration.dispose();
        shown.cutaway.dispose();
        shown.meshes.dispose();
      }
      const level = compileLevel(text, { file });
      const meshes = createLevelMeshes(level, { materials: library });
      const cutaway = createCutaway(meshes);
      scene.add(meshes.root);
      shown = { meshes, cutaway, registrations: [meshes.register(gfx.warmup), cutaway.register(gfx.warmup)] };
      const [w, d] = [level.cols * level.tile, level.rows * level.tile];
      middle = [w / 2, 0, d / 2];
      reach = Math.hypot(w, d) / 2 + 2;
      sun.position.set(w / 2 - w * 0.3, 30, d / 2 - d * 0.4);
      sun.target.position.set(w / 2, 0, d / 2);
      Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: 120 });
      sun.shadow.camera.updateProjectionMatrix();
      // Warm up through both cameras, as the app does (engine/app/engine.ts): r182 builds pipelines per projection.
      for (const camera of [cameras.perspective, cameras.orthographic]) await gfx.warmup.run({ scene, camera });
      view.camera = cameras.place(poseOf(first, focus), aspect());
      const looked = await look(first, focus);
      return {
        ...looked,
        names: meshes.parts.map((part) => part.name),
        twins: cutaway.twins.map((twin) => twin.name),
        empty,
      };
    },
  };
  await gfx.warmup.run(view);
  await settle(gfx, view);
  const empty = gfx.stats().drawCalls;
  Object.assign(window, { __hallPage: page });
  info = { page: 'hall', ...gfx.info };
  if (message) message.hidden = true;
  signals.ready = true;
}

start().catch((error: unknown) => {
  const code = (error as { code?: string }).code ?? 'HALL_PAGE_START';
  const fix = (error as { fix?: string }).fix ?? 'the console names the cause';
  fail({ code, message: String((error as Error).message ?? error), fix });
});
