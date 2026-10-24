/**
 * @file The materials-v2 page's module (tests/pages/materials-v2.html, PLAN.md WP 7.2): the material styles
 * (engine/gfx/materials/styles.ts), the toon look (toon.ts) and the outline shells (outline.ts) in the engine's
 * renderer, on two scenes.
 *
 * The box scene: the Stress Box's room (labs/box/scenes/room.ts) as the app draws it (engine/app/view.ts: the stage,
 * the movers' stand-ins, the iso camera), stepped by a live session, plus six instanced box parts (an instanced batch
 * in `material:stone`, each part turned and stretched its own way, far from the batch's origin) with `centre`
 * outline shells, and a ball with a `normal` shell, floating above the room where `partsCamera` sees them alone. The
 * style set is attached to the warm-up, which runs through both of the view's cameras and the parts camera, and
 * every frame first applies the current style (`styles.apply`).
 * `window.__materialsPage`:
 * - `setStyle(style)` restyles the scene and draws a frame; `run(steps, every)` steps the session, drawing a frame
 *   after each step and switching to the next style every `every` steps, and returns the hashes every 60 steps and
 *   the pipelines each frame built;
 * - `part(i)` shows part `i` alone (the ball alone for -1) and shoots the parts camera's ID pass (400 × 300): the
 *   object's and its shell's entries. The ID pass leaves a look's shells out (engine/gfx/idpass.ts, WP 13.24), so for
 *   this shot, which measures them, the page lists its own shells as objects.
 *
 * The comparison scene (`compare(look)`): an orthographic camera looking down at 35°, a sphere on a floor, a
 * shadow-casting sun, a point light's pool and a hemisphere light, in `lambert`, the toon `bands` or the baseline
 * `gradient` (MeshToonMaterial with the carried gradient map), shot at 480 × 270 with its pixels, ID pass,
 * thumbnail and metrics, and the pool's centre in pixels.
 *
 * Invariants: `ready` turns true once the warm-up and the first frame are done, never after an error; frames are drawn
 * by calling the page; the parts are written before the warm-up, so their page is drawn (in every style) when it runs.
 *
 * @see tests/e2e/materials-v2.spec.ts
 */
import * as THREE from 'three/webgpu';
import roomText from '../../labs/box/levels/room.txt?raw';
import '../../labs/box/scenes/room';
import { createRunView } from '../../engine/app/view';
import { registry } from '../../engine/core/registry';
import { createSettings } from '../../engine/core/settings';
import type { IdEntry } from '../../engine/gfx/idpass';
import { createInstancedBatch } from '../../engine/gfx/instancing';
import { createMaterialLibrary } from '../../engine/gfx/materials/library';
import { defineMaterial, getMaterial } from '../../engine/gfx/materials/material';
import { createOutline } from '../../engine/gfx/materials/outline';
import { createStyleSet, MATERIAL_STYLES, type MaterialStyle } from '../../engine/gfx/materials/styles';
import { gradientToonMaterial, toonGradientMap } from '../../engine/gfx/materials/toon';
import { createRenderer, type FrameReport, type FrameView, type Gfx, type GfxError } from '../../engine/gfx/renderer';
import { shot, shotForJson, type ShotJson } from '../../engine/gfx/shot';
import { createSession } from '../../engine/sim/session';
import { defineLevel } from '../../engine/world/level/level';

/** One structured error record, as `window.__engine.errors` holds them (PLAN.md §8.3). */
interface ErrorRecord {
  code: string;
  message: string;
  fix: string;
}

/** The comparison's looks: v1's Lambert, the toon bands, the baseline's gradient map. */
export const LOOKS = ['lambert', 'bands', 'gradient'] as const;

/** A comparison look. */
export type Look = (typeof LOOKS)[number];

/** What `compare` returns. */
export interface Compared {
  shot: ShotJson;
  /** The point light's pool, its centre on the floor in shot pixels. */
  pool: [number, number];
}

/** The parts: place, turn (rad about x, y, z) and size, metres; far from the batch's origin, each its own way. */
export const PARTS: { at: [number, number, number]; turn: [number, number, number]; size: [number, number, number] }[] =
  [
    { at: [-2.6, 20, -1.8], turn: [0, 0.6, 0], size: [1.6, 0.5, 0.6] },
    { at: [0, 20, -1.8], turn: [0.4, 0.3, 0.2], size: [0.5, 1.4, 0.5] },
    { at: [2.6, 20, -1.8], turn: [0, -0.9, 0.5], size: [1.2, 0.4, 0.9] },
    { at: [-2.6, 20, 1.8], turn: [0.8, 0, 0], size: [0.7, 0.7, 1.6] },
    { at: [0, 20, 1.8], turn: [0, 0, 0], size: [1, 1, 1] },
    { at: [2.6, 20, 1.8], turn: [0.3, 1.2, -0.4], size: [1.5, 0.6, 0.4] },
  ];

/** The ID pass's size for `part`. */
export const PARTS_SHOT = { width: 400, height: 300 } as const;

/** The comparison's size. */
export const COMPARE_SHOT = { width: 480, height: 270 } as const;

const message = document.querySelector<HTMLElement>('#msg');
const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
let info: Record<string, unknown> = { page: 'materials-v2' };
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

/** The comparison scene (see the file comment), its sphere and floor, and the pool's centre. */
function comparisonScene(material: THREE.Material) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#20242c');
  const half = 5;
  const aspect = COMPARE_SHOT.width / COMPARE_SHOT.height;
  const camera = new THREE.OrthographicCamera(-half * aspect, half * aspect, half, -half, 0.1, 100);
  const elevation = (35 * Math.PI) / 180;
  const azimuth = (25 * Math.PI) / 180;
  camera.position.set(
    20 * Math.cos(elevation) * Math.sin(azimuth),
    20 * Math.sin(elevation),
    20 * Math.cos(elevation) * Math.cos(azimuth),
  );
  camera.lookAt(0.6, 0, 0);
  camera.updateMatrixWorld(true);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), material);
  floor.name = 'floor';
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1.1, 64, 32), material);
  sphere.name = 'sphere';
  sphere.position.set(-1.8, 1.1, 0);
  sphere.castShadow = sphere.receiveShadow = true;
  const sun = new THREE.DirectionalLight('#fff4e0', 2.6);
  sun.position.set(-5, 7, 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 0.5, far: 30 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  const pool = new THREE.PointLight('#ffb070', 10, 4.5, 2);
  pool.position.set(2.8, 0.8, 0.6);
  scene.add(floor, sphere, sun, sun.target, pool, new THREE.HemisphereLight('#c8d4ff', '#40352a', 0.8));
  const centre = new THREE.Vector3(pool.position.x, 0, pool.position.z).project(camera);
  const at: [number, number] = [
    Math.round(((centre.x + 1) / 2) * COMPARE_SHOT.width),
    Math.round(((1 - centre.y) / 2) * COMPARE_SHOT.height),
  ];
  return { scene, camera, meshes: [floor, sphere], pool: at };
}

/** Starts the renderer and both scenes, warms up, and publishes `__materialsPage`. */
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
  if (!registry.has('level', 'level:room')) defineLevel('level:room', { text: roomText }, registry);
  defineMaterial('material:test-clay', { description: 'A plain matte clay for the comparison.', color: '#c8b8a0' });
  const library = createMaterialLibrary();
  const styles = createStyleSet({ library });
  const session = createSession('box:room', { seed: 1 });
  const view = createRunView({ run: () => session, registry, materials: library });
  const scene = view.stage.scene;
  view.stage.register(gfx.warmup);

  // The parts: an instanced batch of boxes with centre-pushed shells, and a ball with a normal-pushed shell.
  const batch = createInstancedBatch({
    name: 'parts',
    geometry: new THREE.BoxGeometry(1, 1, 1),
    material: library.get('material:stone'),
    castShadow: true,
    receiveShadow: true,
  });
  const centre = createOutline({ width: 2, mode: 'centre' });
  const round = createOutline({ width: 2, mode: 'normal' });
  const shells = centre.batch(batch);
  const matrix = new THREE.Matrix4();
  const place = (only: number | null = null) => {
    batch.begin();
    PARTS.forEach((part, i) => {
      if (only !== null && i !== only) return;
      const turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(...part.turn));
      matrix.compose(new THREE.Vector3(...part.at), turn, new THREE.Vector3(...part.size));
      batch.add(matrix.elements, [0.9, 0.8 + i * 0.03, 0.7]);
    });
    batch.end();
    shells.sync();
  };
  place();
  scene.add(batch.root);
  batch.register(gfx.warmup);
  shells.register(gfx.warmup);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.6, 32, 16), library.get('material:brick'));
  ball.name = 'ball';
  ball.position.set(0, 20, 0);
  ball.castShadow = ball.receiveShadow = true;
  scene.add(ball);
  const ballShell = round.shell(ball);
  const partsCamera = new THREE.PerspectiveCamera(40, PARTS_SHOT.width / PARTS_SHOT.height, 0.5, 60);
  partsCamera.position.set(0, 27, 7);
  partsCamera.lookAt(0, 20, 0);
  partsCamera.updateMatrixWorld(true);

  const aspect = () => canvas.clientWidth / Math.max(1, canvas.clientHeight);
  let alpha = 1;
  const viewNow = (): FrameView => view.frame({ alpha, dt: 1 / 60, aspect: aspect() });
  styles.attach(gfx.warmup, scene);
  for (const camera of [...view.cameras, partsCamera]) await gfx.warmup.run({ scene, camera });

  /** Draws until a frame is drawn, waiting out any warm-up; resolves once the GPU has finished it. */
  const settle = async (): Promise<FrameReport> => {
    for (let tries = 0; tries < 10; tries++) {
      styles.apply(scene);
      const frameView = viewNow();
      const report = gfx.frame(frameView);
      if (report.drawn) {
        await gfx.device.queue.onSubmittedWorkDone();
        return report;
      }
      if (gfx.warmup.running) await gfx.warmup.run(frameView).catch(() => undefined);
    }
    throw new Error('materials-v2 page: no frame was drawn in 10 tries');
  };

  let compare: ReturnType<typeof comparisonScene> | null = null;
  let gradient: THREE.Material | null = null;
  const page = {
    gfx,
    scene,
    styles,
    three: THREE,
    names: MATERIAL_STYLES,
    /** Switches every material to `style`, draws a frame and reports it, with what the parts and level draw with. */
    async setStyle(style: MaterialStyle) {
      const changed = styles.setStyle(style, scene);
      const frame = await settle();
      const types = new Set<string>();
      scene.traverseVisible((object) => {
        const material = (object as THREE.Mesh).material as THREE.Material | undefined;
        if (material && !Array.isArray(material) && material.userData.material) types.add(material.type);
      });
      return { changed, frame, types: [...types].sort(), stats: gfx.stats() };
    },
    /** Steps the session (see the file comment). */
    async run(steps: number, every: number) {
      const hashes: Record<string, string> = { 0: session.world.hash() };
      const built: number[] = [];
      let turn = MATERIAL_STYLES.indexOf(styles.style);
      for (let k = 1; k <= steps; k++) {
        if (k % every === 0) styles.setStyle(MATERIAL_STYLES[++turn % MATERIAL_STYLES.length], scene);
        session.step();
        view.stepped();
        alpha = 1;
        built.push((await settle()).built);
        if (k % 60 === 0) hashes[k] = session.world.hash();
      }
      return { hashes, built, styles: turn };
    },
    /**
     * Shows part `i` alone (or, for -1, the ball alone), shoots the parts camera's ID pass, and shows everything
     * again; returns the object's entry and its shell's.
     */
    async part(i: number): Promise<{ part?: IdEntry; shell?: IdEntry; visible: IdEntry[] }> {
      place(i < 0 ? PARTS.length : i);
      ball.visible = i < 0;
      await settle();
      const size = PARTS_SHOT;
      const measured = [...shells.shells, ballShell];
      for (const shell of measured) shell.userData.outline = false;
      const result = await shot(
        gfx,
        { scene, camera: partsCamera },
        { size, metrics: false, thumbnail: false },
      ).finally(() => measured.forEach((shell) => (shell.userData.outline = true)));
      place();
      ball.visible = true;
      const visible = result.ids!.visible;
      const name = i < 0 ? 'ball' : 'parts/page0';
      return {
        part: visible.find((entry) => entry.name === name),
        shell: visible.find((entry) => entry.name === `${name}/outline`),
        visible,
      };
    },
    /** Shoots the comparison scene in `look` (see the file comment). */
    async compare(look: (typeof LOOKS)[number]): Promise<Compared> {
      const clay = getMaterial('material:test-clay');
      gradient ??= gradientToonMaterial({ color: clay.color }, toonGradientMap());
      const material =
        look === 'lambert' ? library.get(clay.id) : look === 'bands' ? styles.get(clay.id, 'toon') : gradient;
      compare ??= comparisonScene(material);
      for (const mesh of compare.meshes) mesh.material = material;
      const result = await shot(
        gfx,
        { scene: compare.scene, camera: compare.camera },
        { size: COMPARE_SHOT, pixels: true },
      );
      return { shot: shotForJson(result), pool: compare.pool };
    },
  };
  const first = await settle();
  if (first.built > 0) throw new Error(`materials-v2 page: the first frame built ${first.built} pipelines`);
  Object.assign(window, { __materialsPage: page });
  info = { page: 'materials-v2', ...gfx.info };
  if (message) message.hidden = true;
  signals.ready = true;
}

start().catch((error: unknown) => {
  const code = (error as { code?: string }).code ?? 'MATERIALS_V2_PAGE_START';
  const fix = (error as { fix?: string }).fix ?? 'the console names the cause';
  fail({ code, message: String((error as Error).message ?? error), fix });
});
