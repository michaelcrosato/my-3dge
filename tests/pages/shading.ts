/**
 * @file The shading page's module (tests/pages/shading.html, PLAN.md WP 11.5): a small lit corner drawn through the post
 * chain (engine/gfx/post/chain.ts), for what its shading sections do where the box has nothing to show them on: a
 * steel ball and a steel plate on the floor (metalness 1: the box draws no metal; its iron is on props it never
 * places), before a red wall and a blue one meeting in a corner with a white block in it, a sun that casts, two
 * pillars cutting its light, and a lamp. Every material is three.js's standard one, the one that gives the scene
 * pass its metalness. The canvas is 480 × 270 CSS px; nothing moves, and frames are drawn only when called.
 *
 * The chain's settings are declared before the URL is read, so `?post.filters=…` and `?gfx.featuresOff=…` reach it.
 * `window.__engine` is the page's signal with the members the box's has that the specs use: `set(key, value)`,
 * `render(n)`, `stats()` (the renderer's, `pipelinesAfterWarmUp` among them), `shot(options)` (engine/gfx/shot.ts,
 * the frame as the chain draws it) and `camera.set('perspective' | 'orthographic')`; `metal()`, the boxes on screen
 * (px, the drawing buffer's) of the ball and the plate; and `shadow()`, a patch of floor in a pillar's shadow and the
 * same patch beside it in the sun, as screen polygons. So `node x shot tests/pages/shading.html --set
 * 'post.filters={"ssr":{"scope":"all"}}'` shoots any section.
 *
 * Invariants: `ready` turns true once the warm-up and the first frame are done, never after an error; presentation
 * only: there is no sim.
 *
 * @see tests/e2e/enhanced.spec.ts
 */
import * as THREE from 'three/webgpu';
import { registry } from '../../engine/core/registry';
import { createSettings } from '../../engine/core/settings';
import { createPost } from '../../engine/gfx/post/chain';
import { definePostSettings } from '../../engine/gfx/post/settings';
import { createRenderer, type FrameView, type Gfx, type GfxError } from '../../engine/gfx/renderer';
import { shot, shotForJson, type ShotJson, type ShotOptions } from '../../engine/gfx/shot';

/** One structured error record, as `window.__engine.errors` holds them (PLAN.md §8.3). */
interface ErrorRecord {
  code: string;
  message: string;
  fix: string;
}

/** A box on screen in the drawing buffer's pixels, `[x0, y0, x1, y1]`, y down. */
export type ScreenBox = [number, number, number, number];

const message = document.querySelector<HTMLElement>('#msg');
const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
let info: Record<string, unknown> = { page: 'shading' };
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

/** The corner (see the file comment), and its metal. */
function corner(): { scene: THREE.Scene; metal: THREE.Mesh[]; sun: THREE.DirectionalLight } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#8fb0d0');
  const add = (
    name: string,
    geometry: THREE.BufferGeometry,
    color: string,
    metalness: number,
    roughness: number,
    at: [number, number, number],
  ) => {
    // prettier-ignore
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardNodeMaterial({ color, metalness, roughness }));
    mesh.name = name;
    mesh.position.set(...at);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };
  add('floor', new THREE.BoxGeometry(16, 0.2, 16), '#d8d4cc', 0, 0.9, [0, -0.1, 0]);
  add('wall/red', new THREE.BoxGeometry(0.3, 4, 16), '#c03028', 0, 0.85, [-8, 2, 0]);
  add('wall/blue', new THREE.BoxGeometry(16, 4, 0.3), '#2850c0', 0, 0.85, [0, 2, -8]);
  add('block', new THREE.BoxGeometry(1.5, 1.5, 1.5), '#eeeeee', 0, 0.8, [-6.5, 0.75, -6.5]);
  add('pillar/west', new THREE.BoxGeometry(0.8, 6, 0.8), '#9a9488', 0, 0.9, [-2, 3, 1]);
  add('pillar/north', new THREE.BoxGeometry(0.8, 6, 0.8), '#9a9488', 0, 0.9, [1, 3, -2]);
  const plate = add('steel/plate', new THREE.BoxGeometry(5, 0.02, 5), '#c8ccd2', 1, 0.15, [3, 0.01, 3]);
  const ball = add('steel/ball', new THREE.SphereGeometry(1, 48, 24), '#d0d4da', 1, 0.1, [3, 1, 3]);
  const sun = new THREE.DirectionalLight('#fff2dc', 3);
  sun.name = 'sun';
  sun.position.set(6, 12, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 40 });
  sun.shadow.camera.updateProjectionMatrix();
  const lamp = new THREE.PointLight('#ffb060', 30, 8);
  lamp.name = 'lamp';
  lamp.position.set(-4, 1.5, 4);
  scene.add(sun, sun.target, lamp, new THREE.HemisphereLight('#bcd4ff', '#40382c', 0.8));
  return { scene, metal: [ball, plate], sun };
}

/** Pillar/north's foot and top: its shadow on the floor runs from the foot along the sunlight's way. */
const PILLAR = { foot: [1, 0, -2], height: 6 } as const;

/** The two cameras, each looking into the corner. */
function cameras(): Record<'perspective' | 'orthographic', THREE.Camera> {
  const perspective = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
  perspective.position.set(9, 7, 11);
  const orthographic = new THREE.OrthographicCamera(-9, 9, 5.0625, -5.0625, 0.1, 100);
  orthographic.position.set(14, 12, 14);
  for (const camera of [perspective, orthographic]) {
    camera.lookAt(-1, 0.5, -1);
    camera.updateMatrixWorld();
  }
  return { perspective, orthographic };
}

/** Starts the renderer and the chain over the corner; warms up and publishes the page's signal. */
async function start(): Promise<void> {
  definePostSettings(registry);
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
  const { scene, metal, sun } = corner();
  const lenses = cameras();
  let camera = lenses.perspective;
  const post = createPost(gfx, { settings });
  post.attach(gfx.warmup);
  const viewNow = (): FrameView => post.view({ scene, camera });
  // Through both cameras, as the engine's pages warm up (engine/app/drawing.ts): r182's standard materials compile
  // their view direction by the camera's kind.
  for (const lens of [lenses.orthographic, lenses.perspective])
    await gfx.warmup.run(post.view({ scene, camera: lens }));

  /** Draws until a frame is drawn, waiting out any warm-up; resolves once the GPU has finished it. */
  const settle = async () => {
    for (let tries = 0; tries < 10; tries++) {
      const frameView = viewNow();
      if (gfx.frame(frameView).drawn) return gfx.device.queue.onSubmittedWorkDone();
      if (gfx.warmup.running) await gfx.warmup.run(frameView).catch(() => undefined);
    }
    throw new Error('shading page: no frame was drawn in 10 tries');
  };
  /** The screen box of `mesh` through the camera, in the drawing buffer's pixels. */
  const boxOf = (mesh: THREE.Mesh): ScreenBox => {
    const size = gfx.renderer.getDrawingBufferSize(new THREE.Vector2());
    const { min, max } = new THREE.Box3().setFromObject(mesh);
    const [xs, ys]: number[][] = [[], []];
    for (let k = 0; k < 8; k++) {
      const p = new THREE.Vector3(k & 1 ? max.x : min.x, k & 2 ? max.y : min.y, k & 4 ? max.z : min.z).project(camera);
      xs.push(((p.x + 1) / 2) * size.x);
      ys.push(((1 - p.y) / 2) * size.y);
    }
    const [x0, y0] = [Math.floor(Math.min(...xs)), Math.floor(Math.min(...ys))];
    const [x1, y1] = [Math.ceil(Math.max(...xs)), Math.ceil(Math.max(...ys))];
    return [Math.max(0, x0), Math.max(0, y0), Math.min(size.x, x1), Math.min(size.y, y1)];
  };

  /** A world point on screen, in the drawing buffer's pixels. */
  const onScreen = (point: THREE.Vector3): [number, number] => {
    const size = gfx.renderer.getDrawingBufferSize(new THREE.Vector2());
    const p = point.clone().project(camera);
    return [((p.x + 1) / 2) * size.x, ((1 - p.y) / 2) * size.y];
  };
  /** The middle half of pillar/north's shadow on the floor, and the same patch of floor 1.5 m aside, in the sun. */
  const shadow = () => {
    const way = sun.target.position.clone().sub(sun.position).normalize(); // the way the sunlight travels
    const foot = new THREE.Vector3(...PILLAR.foot);
    const along = way
      .clone()
      .multiplyScalar(-PILLAR.height / way.y)
      .setY(0); // from the foot to the top's shade
    const across = new THREE.Vector3(-along.z, 0, along.x).normalize();
    const patch = (aside: number) =>
      [[0.25, -0.2], [0.75, -0.2], [0.75, 0.2], [0.25, 0.2]].map(([s, t]) => onScreen(foot.clone().addScaledVector(along, s).addScaledVector(across, t + aside))); // prettier-ignore
    return { shade: patch(0), sun: patch(-1.5) };
  };

  await settle();
  Object.assign(signals, {
    set: (key: string, value: unknown) => settings.set(key, value),
    render: async (frames = 1) => {
      for (let i = 0; i < frames; i++) await settle();
    },
    stats: () => gfx.stats(),
    camera: {
      set(kind: 'perspective' | 'orthographic') {
        if (!(kind in lenses)) throw new Error(`shading page: no camera '${kind}': give 'perspective' or 'orthographic'`); // prettier-ignore
        camera = lenses[kind];
        return kind;
      },
    },
    metal: () => metal.map(boxOf),
    shadow,
    /** `x shot`'s entry: the frame as the chain draws it now. */
    shot: async (options: ShotOptions = {}): Promise<ShotJson> => {
      await settle();
      return shotForJson(await shot(gfx, viewNow(), options));
    },
  });
  info = { page: 'shading', ...gfx.info };
  if (message) message.hidden = true;
  signals.ready = true;
}

start().catch((error: unknown) => {
  const code = (error as { code?: string }).code ?? 'SHADING_PAGE_START';
  const fix = (error as { fix?: string }).fix ?? 'the console names the cause';
  fail({ code, message: String((error as Error).message ?? error), fix });
});
