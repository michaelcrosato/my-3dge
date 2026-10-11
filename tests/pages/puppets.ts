/**
 * @file The puppets page's module (tests/pages/puppets.html, PLAN.md WP 3.8): the engine's renderer with a lit scene
 * (a hemisphere light and one shadow-casting sun: one shadow map) and three things to show, one at a time, each
 * registered with the warm-up before the first frame:
 * - the neutral humanoid (`body:humanoid`, build:chibi) as one rigid-skinned puppet (engine/gfx/puppets/draw.ts), in
 *   the page's test pose (`testPose`: every joint turned up to 0.5 rad about a seeded axis, the root turned 0.6 rad);
 * - the socket marks (fixtures/bodies/socketMarks.ts) in the same build and pose, as a puppet of their own;
 * - a crowd of instanced humanoids (`createPuppetBatches`) with blob shadows, on a grid 1.5 m apart, each in a seeded
 *   pose of its own.
 *
 * `window.__puppetsPage`:
 * - `humanoid()` shows the humanoid, draws a frame and shoots it: the frame's draw calls, those of the empty scene
 *   (the renderer's own), the puppet's own count with one shadow map, the ID pass's view of it, where FK's sockets and
 *   joints land on the screen, and how far the puppet's bones put each socket from FK (m).
 * - `sockets(side)` shows the marks and, for each socket, shoots a 6 cm square around FK's socket, seen from the
 *   front (`front`, along −Z) or the side (`side`, along −X) by an orthographic camera at 0.25 mm per pixel: the
 *   mark's white pixels' centroid is where the GPU drew the socket, so its distance from the shot's centre is the
 *   error (m), and their area says nothing else fell in the square.
 * - `crowd(n)` shows n humanoids and their shadows, draws a frame and reports its draw calls against the batches' own
 *   count, the pipelines it built, the batches' pages and what the ID pass sees.
 *
 * Invariants: `ready` turns true once the warm-up has run and the empty scene has drawn, never after an error; frames
 * are drawn by calling the page; nothing is compiled or registered after the first warm-up.
 *
 * @see tests/e2e/puppets.spec.ts
 */
import * as THREE from 'three/webgpu';
import { defineSocketMarks, SOCKET_MARK_RADIUS, SOCKET_MARKS_ID } from '../../fixtures/bodies/socketMarks';
import { forwardKinematics, jointPosition, socketPosition } from '../../engine/anim/fk';
import { Pose } from '../../engine/anim/pose';
import { JOINTS, SOCKETS } from '../../engine/anim/skeleton';
import { registry } from '../../engine/core/registry';
import { createSettings } from '../../engine/core/settings';
import type { IdEntry } from '../../engine/gfx/idpass';
import { createMaterialLibrary } from '../../engine/gfx/materials/library';
import { createBlobShadows } from '../../engine/gfx/puppets/blobShadow';
import { compileBody } from '../../engine/gfx/puppets/compile';
import { createPuppet, createPuppetBatches } from '../../engine/gfx/puppets/draw';
import { createRenderer, type FrameReport, type FrameView, type Gfx, type GfxError } from '../../engine/gfx/renderer';
import { shot } from '../../engine/gfx/shot';

/** One structured error record, as `window.__engine.errors` holds them (PLAN.md §8.3). */
interface ErrorRecord {
  code: string;
  message: string;
  fix: string;
}

/** The socket shots: their side in metres and in pixels. */
export const MARK_SHOT = { metres: 0.06, pixels: 240 } as const;

/** What `humanoid` reports. */
export interface HumanoidShown {
  frame: FrameReport;
  drawCalls: number;
  empty: number;
  counted: number;
  pipelinesAfterWarmUp: number | null;
  seen: IdEntry[];
  /** FK's sockets and leaf joints on the screen, in the shot's pixels (x, y from the top left). */
  projected: { name: string; at: [number, number] }[];
  /** The largest distance between a socket of the puppet's bones and FK's (m). */
  boneError: number;
}

/** What `sockets` reports for one socket. */
export interface SocketShot {
  socket: string;
  /** How far the mark's centre is drawn from FK's socket, across the view (m). */
  error: number;
  /** The mark's area in the shot and a whole ball's (m²). */
  area: number;
  disc: number;
}

/** What `crowd` reports. */
export interface CrowdShown {
  frame: FrameReport;
  drawCalls: number;
  empty: number;
  counted: number;
  instances: number;
  pages: Record<string, number>;
  pipelinesAfterWarmUp: number | null;
  seen: string[];
}

const message = document.querySelector<HTMLElement>('#msg');
const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
let info: Record<string, unknown> = { page: 'puppets' };
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
  throw new Error('puppets page: no frame was drawn in 10 tries');
}

/** A seeded pose: every joint turned up to `spread` radians about a seeded axis, the root turned `turn` about +Y. */
export function testPose(seed = 1, spread = 0.5, turn = 0.6): Pose {
  let state = seed * 7919 + 17;
  const next = () => ((state = (state * 48271) % 2147483647) / 2147483647) * 2 - 1;
  const pose = new Pose();
  const q = new THREE.Quaternion();
  for (let j = 0; j < JOINTS.length; j++) {
    const axis = new THREE.Vector3(next(), next(), next()).normalize();
    pose.setRotation(j, q.setFromAxisAngle(axis, next() * spread));
  }
  pose.rootRot.setFromAxisAngle(new THREE.Vector3(0, 1, 0), turn);
  return pose;
}

/** Starts the renderer, the scene and what it shows, and publishes `__puppetsPage`. */
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
  scene.background = new THREE.Color('#000000');
  scene.add(new THREE.HemisphereLight('#c8d4ff', '#3a3226', 1.2));
  const sun = new THREE.DirectionalLight('#fff2dd', 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.position.set(-6, 14, 8);
  Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 0.5, far: 40 });
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun, sun.target);
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);
  const view: FrameView = { scene, camera };
  const library = createMaterialLibrary();

  const humanoid = compileBody('body:humanoid', 'build:chibi');
  const pose = testPose();
  const world = forwardKinematics(humanoid.skeleton, pose);
  const puppet = createPuppet(humanoid, { materials: library }).setPose(pose);
  defineSocketMarks(registry);
  const marks = createPuppet(compileBody(SOCKET_MARKS_ID, humanoid.skeleton), { materials: library }).setPose(pose);
  const crowdPuppets = createPuppetBatches({ materials: library, name: 'crowd' });
  crowdPuppets.prepare(humanoid);
  const shadows = createBlobShadows({ materials: library, name: 'crowd/shadows' });
  const shown = { humanoid: puppet.mesh, marks: marks.mesh, crowd: new THREE.Group() };
  shown.crowd.add(crowdPuppets.root, shadows.root);
  for (const object of Object.values(shown)) scene.add(object);
  puppet.register(gfx.warmup);
  marks.register(gfx.warmup);
  crowdPuppets.register(gfx.warmup);
  shadows.register(gfx.warmup);

  /** Shows only `which` (nothing when null). */
  const show = (which: keyof typeof shown | null) => {
    for (const [name, object] of Object.entries(shown)) object.visible = name === which;
  };

  const page = {
    gfx,
    view,
    three: THREE,
    async humanoid(): Promise<HumanoidShown> {
      show('humanoid');
      camera.position.set(1.6, 1.4, 3.4);
      camera.lookAt(0, 0.85, 0);
      const frame = await settle(gfx, view);
      const stats = gfx.stats();
      const result = await shot(gfx, view, { metrics: false, thumbnail: false });
      const width = result.width;
      const height = result.height;
      const toScreen = (p: THREE.Vector3): [number, number] => {
        const ndc = p.clone().project(camera);
        return [((ndc.x + 1) / 2) * width, ((1 - ndc.y) / 2) * height];
      };
      const projected = [
        ...SOCKETS.map((name) => ({ name, at: toScreen(socketPosition(humanoid.skeleton, world, name)) })),
        ...(['head', 'handL', 'handR', 'toeL', 'toeR'] as const).map((name) => ({
          name,
          at: toScreen(jointPosition(world, name)),
        })),
      ];
      const boneError = Math.max(
        ...SOCKETS.map((name) =>
          puppet.socketPosition(name).distanceTo(socketPosition(humanoid.skeleton, world, name)),
        ),
      );
      return {
        frame,
        drawCalls: stats.drawCalls,
        empty,
        counted: puppet.drawCalls(1),
        pipelinesAfterWarmUp: stats.pipelinesAfterWarmUp,
        seen: result.ids!.visible,
        projected,
        boneError,
      };
    },
    async sockets(side: 'front' | 'side'): Promise<SocketShot[]> {
      show('marks');
      const half = MARK_SHOT.metres / 2;
      const ortho = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 20);
      const metresPerPixel = MARK_SHOT.metres / MARK_SHOT.pixels;
      const size = { width: MARK_SHOT.pixels, height: MARK_SHOT.pixels };
      const radius = SOCKET_MARK_RADIUS * humanoid.skeleton.build.size;
      const out: SocketShot[] = [];
      for (const socket of SOCKETS) {
        const at = socketPosition(humanoid.skeleton, world, socket);
        ortho.position.copy(at).add(side === 'front' ? new THREE.Vector3(0, 0, 5) : new THREE.Vector3(5, 0, 0));
        ortho.up.set(0, 1, 0);
        ortho.lookAt(at);
        ortho.updateMatrixWorld(true);
        const options = { size, pixels: true, ids: false, metrics: false, thumbnail: false };
        const { pixels } = (await shot(gfx, { scene, camera: ortho }, options)) as { pixels: Uint8Array };
        let [sx, sy, count] = [0, 0, 0];
        for (let y = 0; y < size.height; y++) {
          for (let x = 0; x < size.width; x++) {
            if (pixels[(y * size.width + x) * 4] < 128) continue;
            [sx, sy, count] = [sx + x + 0.5, sy + y + 0.5, count + 1];
          }
        }
        const dx = (sx / count - size.width / 2) * metresPerPixel;
        const dy = (sy / count - size.height / 2) * metresPerPixel;
        const area = count * metresPerPixel ** 2;
        out.push({ socket, error: count ? Math.hypot(dx, dy) : Infinity, area, disc: Math.PI * radius ** 2 });
      }
      return out;
    },
    async crowd(n: number): Promise<CrowdShown> {
      show('crowd');
      const side = Math.ceil(Math.sqrt(n));
      crowdPuppets.begin();
      shadows.begin();
      for (let i = 0; i < n; i++) {
        const body = testPose(i + 2, 0.6, i * 0.7);
        body.rootPos.set(((i % side) - (side - 1) / 2) * 1.5, 0, (Math.floor(i / side) - (side - 1) / 2) * 1.5);
        crowdPuppets.draw(humanoid, body);
        shadows.add(body.rootPos.x, 0, body.rootPos.z, 0.35);
      }
      crowdPuppets.end();
      shadows.end();
      camera.position.set(0, side * 1.6, side * 1.5);
      camera.lookAt(0, 0, 0);
      const frame = await settle(gfx, view);
      const stats = gfx.stats();
      const result = await shot(gfx, view, { metrics: false, thumbnail: false });
      const pages: Record<string, number> = {};
      let instances = 0;
      for (const [key, batch] of crowdPuppets.batches) {
        pages[key] = batch.pages.filter((mesh) => mesh.count > 0).length;
        instances += batch.count;
      }
      return {
        frame,
        drawCalls: stats.drawCalls,
        empty,
        counted: crowdPuppets.drawCalls(1) + shadows.batch.drawCalls(1),
        instances,
        pages,
        pipelinesAfterWarmUp: stats.pipelinesAfterWarmUp,
        seen: result.ids!.visible.map((entry) => entry.name),
      };
    },
  };
  show(null);
  await gfx.warmup.run(view);
  await settle(gfx, view);
  const empty = gfx.stats().drawCalls;
  Object.assign(window, { __puppetsPage: page });
  info = { page: 'puppets', ...gfx.info };
  if (message) message.hidden = true;
  signals.ready = true;
}

start().catch((error: unknown) => {
  const code = (error as { code?: string }).code ?? 'PUPPETS_PAGE_START';
  const fix = (error as { fix?: string }).fix ?? 'the console names the cause';
  fail({ code, message: String((error as Error).message ?? error), fix });
});
