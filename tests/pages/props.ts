/**
 * @file The props page's module (tests/pages/props.html, PLAN.md WP 4.5): the engine's props in a walled yard on the
 * engine's renderer, standing in Rapier, drawn by engine/gfx/props.ts. The crate stands on a spawn point a glyph of
 * the page's marks (`c`, spawn `crate`) and the brazier's fire on the level's brazier stand (`t`, its light spot
 * `torch`), both placed by `levelProps`; the barrel, the pillar, the library's nine (WP 10.3, its chair WP 13.16's)
 * and the house's fittings (WP 13.16: the pane, the switch, the lamp and the garage door) come from the page's own
 * data (`SCENE`).
 * Every prop with a body gets `propBody`'s in the physics world, beside the level's (`addLevelBodies`), and each frame
 * draws every prop at its body's pose (`readBody`) or, for the fire, at `propPose`'s; one point light follows the
 * fire's light spot. A perspective camera looks down into the yard from over its south wall.
 *
 * `window.__propsPage`:
 * - `show()` lets the bodies settle (30 steps at 60 Hz), draws and shoots the ID pass: what each prop batch covers,
 *   the frame's pipelines and draw calls (beyond the empty scene's) against what the meshes count, the placements
 *   and the lights.
 * - `knock(ticks)` knocks the crate east from a metre west of it (engine/physics/bodies.ts's `knock`), then steps
 *   to each tick of `ticks`, drawing and shooting there: the crate's body pose, its batch's matrix and the matrix its
 *   pose gives, where its centre projects on the shot, and what the ID pass sees of it.
 *
 * Invariants: `ready` turns true once the warm-up has run and the empty yard has drawn, never after an error; frames
 * are drawn by calling the page, at presentation time tick / 60 s; the sim never sees the GPU.
 *
 * @see tests/e2e/props.spec.ts
 */
import * as THREE from 'three/webgpu';
import { createSettings } from '../../engine/core/settings';
import type { IdEntry } from '../../engine/gfx/idpass';
import { createLevelMeshes } from '../../engine/gfx/level/meshes';
import { createMaterialLibrary } from '../../engine/gfx/materials/library';
import { createPropMeshes, type PropLight } from '../../engine/gfx/props';
import { createRenderer, type FrameReport, type FrameView, type Gfx, type GfxError } from '../../engine/gfx/renderer';
import { shot } from '../../engine/gfx/shot';
import { knock } from '../../engine/physics/bodies';
import { createPhysics } from '../../engine/physics/world';
import { addLevelBodies } from '../../engine/sim/levelBodies';
import { compileLevel } from '../../engine/world/level/compile';
import { defineGlyph } from '../../engine/world/level/glyph';
import { levelProps, propBody, propPose, type PropPlacement } from '../../engine/world/props/place';
import { getProp, propCentre } from '../../engine/world/props/prop';

/** One structured error record, as `window.__engine.errors` holds them (PLAN.md §8.3). */
interface ErrorRecord {
  code: string;
  message: string;
  fix: string;
}

/** The yard: 12 × 7 m, walled; a crate's spawn point (`c`) and a brazier stand (`t`). */
export const YARD = [
  '############',
  '#..........#',
  '#..c.......#',
  '#..........#',
  '#.......t..#',
  '#..........#',
  '############',
].join('\n');

/**
 * The props the page places itself, beside the level's: the catalog's barrel and pillar, then the library's (WP 10.3),
 * the tall ones along the north wall, the sconce on its face, the others in front, then the fittings (WP 13.16): a
 * pane standing on the floor, the switch on the north wall's face, the lamp hanging over the middle and the garage
 * door along the east wall, facing the camera; all clear of the crate's slide east and of what the south wall hides
 * from the camera (a metre and more north of it).
 */
export const SCENE: PropPlacement[] = [
  { prop: 'prop:barrel', at: [2.5, 0, 4.5], yaw: 0 },
  { prop: 'prop:pillar', at: [10, 0, 1.5], yaw: 0.3 },
  { prop: 'prop:door', at: [2, 0, 1.3], yaw: 0 },
  { prop: 'prop:sconce', at: [4.6, 1.3, 1], yaw: 0 },
  { prop: 'prop:statue', at: [6.6, 0, 1.6], yaw: 0 },
  { prop: 'prop:banner', at: [8.4, 0, 1.3], yaw: 0 },
  { prop: 'prop:table', at: [6.4, 0, 3.9], yaw: 0 },
  { prop: 'prop:bench', at: [9, 0, 2.6], yaw: 0 },
  { prop: 'prop:chest', at: [10.2, 0, 3.6], yaw: -0.3 },
  { prop: 'prop:lantern', at: [4.6, 0, 3.6], yaw: 0 },
  { prop: 'prop:chair', at: [1.6, 0, 3.2], yaw: 0.4 },
  { prop: 'prop:pane', at: [7.6, 0, 2.4], yaw: 0 },
  { prop: 'prop:switch', at: [3.4, 1.2, 1], yaw: 0 },
  { prop: 'prop:lamp', at: [5.5, 2.4, 2.4], yaw: 0 },
  { prop: 'prop:garageDoor', at: [10.9, 0, 3.4], yaw: -Math.PI / 2 },
];

/** What the ID pass sees of one batch. */
export type Seen = Pick<IdEntry, 'name' | 'px' | 'centre' | 'bbox'>;

/** What `show` reports. */
export interface Shown {
  frame: FrameReport;
  pipelinesAfterWarmUp: number | null;
  /** The frame's draw calls beyond the empty scene's. */
  drawCalls: number;
  /** What the level meshes and the props count for themselves, with one shadow map. */
  counted: number;
  seen: Seen[];
  /** The objects it cannot see, each `<name> (<reason>)`. */
  unseen: string[];
  placements: PropPlacement[];
  lights: PropLight[];
}

/** What `knock` reports at one tick. */
export interface Knocked {
  tick: number;
  frame: FrameReport;
  /** The crate's body: its centre (m) and turn. */
  position: number[];
  quaternion: number[];
  /** The crate batch's matrix, and the one its body's pose gives (centre, turn, the base propCentre below). */
  matrix: number[];
  expected: number[];
  /** Where the body's centre projects on the shot (px from the top left). */
  projected: [number, number];
  crate: Seen | null;
}

const message = document.querySelector<HTMLElement>('#msg');
const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
let info: Record<string, unknown> = { page: 'props' };
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
  throw new Error('props page: no frame was drawn in 10 tries');
}

/** Starts the renderer, the yard, its bodies and props, and publishes `__propsPage`. */
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
  const sun = new THREE.DirectionalLight('#fff2dd', 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0005;
  sun.position.set(2, 14, 9);
  sun.target.position.set(6, 0, 3.5);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 40 });
  sun.shadow.camera.updateProjectionMatrix();
  const torch = new THREE.PointLight('#ffffff', 0, 0, 2);
  scene.add(sun, sun.target, torch);
  const camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / Math.max(1, canvas.clientHeight), 0.5, 100);
  camera.position.set(6, 8, 8.5);
  camera.lookAt(6, 0.3, 3.3);
  const view: FrameView = { scene, camera };

  defineGlyph('glyph:crateSpot', {
    char: 'c',
    description: 'Floor where a crate stands.',
    mesh: 'floor',
    spawn: 'crate',
  });
  const level = compileLevel(YARD, { file: 'props-yard.txt' });
  const library = createMaterialLibrary();
  const meshes = createLevelMeshes(level, { materials: library });
  const props = createPropMeshes({ materials: library });
  scene.add(meshes.root, props.root);
  meshes.register(gfx.warmup);
  props.register(gfx.warmup);

  const physics = createPhysics();
  const sim = createSettings().sim;
  addLevelBodies(physics, level);
  const placements = [...levelProps(level), ...SCENE];
  const placed = placements.map((place) => {
    const spec = propBody(place);
    return { place, body: spec ? physics.addBody(spec) : -1 };
  });
  const crate = placed.find((item) => item.place.prop === 'prop:crate')!;
  const crateCentre = propCentre(getProp('prop:crate'));
  let tick = 0;

  /** Steps the physics world once at 60 Hz. */
  const step = () => {
    physics.step({ dt: 1 / 60, settings: sim });
    tick++;
  };

  /** Puts every prop where its body (or its placement) is, at presentation time tick / 60, and draws. */
  const draw = async (): Promise<FrameReport> => {
    props.begin(tick / 60);
    placed.forEach(({ place, body }, key) => {
      props.add(place.prop, body >= 0 ? physics.readBody(body) : propPose(place), key);
    });
    props.end();
    const [light] = props.lights();
    torch.position.fromArray(light.position);
    Object.assign(torch, { intensity: light.intensity, distance: light.distance, decay: light.decay });
    torch.color.set(light.color);
    return settle(gfx, view);
  };

  /** Shoots the ID pass: what each prop batch covers. */
  const ids = async () => {
    const result = await shot(gfx, view, { metrics: false, thumbnail: false });
    const pass = result.ids!;
    const seen = pass.visible.map(({ name, px, centre, bbox }) => ({ name, px, centre, bbox }));
    return { seen, unseen: pass.unseen.map((entry) => `${entry.name} (${entry.reason})`) };
  };

  const page = {
    gfx,
    view,
    props,
    async show(): Promise<Shown> {
      while (tick < 30) step();
      const frame = await draw();
      const stats = gfx.stats();
      const { seen, unseen } = await ids();
      return {
        frame,
        pipelinesAfterWarmUp: stats.pipelinesAfterWarmUp,
        drawCalls: stats.drawCalls - empty,
        counted: meshes.drawCalls(1) + props.drawCalls(1),
        seen: seen.filter((entry) => entry.name.startsWith('prop:')),
        unseen,
        placements,
        lights: props.lights(),
      };
    },
    async knock(ticks: number[]): Promise<Knocked[]> {
      const { position: start } = physics.readBody(crate.body);
      knock(physics, crate.body, [start.x - 1, start.y, start.z]);
      const out: Knocked[] = [];
      for (const at of ticks) {
        while (tick < at) step();
        const frame = await draw();
        const body = physics.readBody(crate.body);
        const pose = new THREE.Matrix4().compose(body.position, body.rotation, new THREE.Vector3(1, 1, 1));
        const expected = pose.multiply(new THREE.Matrix4().makeTranslation(0, -crateCentre, 0)).elements;
        const batch = props.batches().find((item) => item.name === 'prop:crate/mesh')!;
        const size = gfx.renderer.getDrawingBufferSize(new THREE.Vector2());
        const ndc = body.position.clone().project(camera);
        const projected: [number, number] = [((ndc.x + 1) / 2) * size.x, ((1 - ndc.y) / 2) * size.y];
        const { seen } = await ids();
        out.push({
          tick,
          frame,
          position: body.position.toArray(),
          quaternion: body.rotation.toArray(),
          matrix: batch.getMatrixAt(0, new THREE.Matrix4()).elements,
          expected,
          projected,
          crate: seen.find((entry) => entry.name === 'prop:crate/mesh/page0') ?? null,
        });
      }
      return out;
    },
  };
  await gfx.warmup.run(view);
  await settle(gfx, view);
  const empty = gfx.stats().drawCalls - meshes.drawCalls(1) - props.drawCalls(1);
  Object.assign(window, { __propsPage: page });
  info = { page: 'props', ...gfx.info };
  if (message) message.hidden = true;
  signals.ready = true;
}

start().catch((error: unknown) => {
  const code = (error as { code?: string }).code ?? 'PROPS_PAGE_START';
  const fix = (error as { fix?: string }).fix ?? 'the console names the cause';
  fail({ code, message: String((error as Error).message ?? error), fix });
});
