/**
 * @file The shot page's module (tests/pages/shot.html): a fixture scene made for the ID pass and the look metrics,
 * drawn by the engine's renderer (engine/gfx/renderer.ts), and `window.__engine` with `ready`, `errors`, `info()` and
 * `shot(options)`: engine/gfx/shot.ts's `shot`, returned as JSON through `shotForJson`, the member `x shot` calls
 * (WP 2.7 registers the engine's own, §8.3). `window.__shotPage` holds the renderer, the scene and the view for tests.
 *
 * URL parameters, as `x shot --scene --cam --set` pass them: `scene` (`objects` by default, or `empty`: nothing but
 * the background), `cam` (`front` by default, `iso` or `top`), and settings by path (`?gfx.resolution=full`).
 *
 * The `objects` scene: a floor, a crate, a ball, a pillar and the hero (a group carrying `userData.protagonist` and
 * entity 1, its body and head two meshes), plus one object for each reason an object is unseen: `ghost` (hidden),
 * `behind` (behind every camera) and `buried` (inside the pillar). Sizes in metres, +Y up (ADR-0004).
 *
 * Invariants: `ready` turns true once the warm-up and the first frame are done on the GPU, never after an error; an
 * unknown scene, camera or setting is one record in `__engine.errors` (`{ code, message, fix }`), shown as page text.
 *
 * @see tests/e2e/shot.spec.ts
 */
import * as THREE from 'three/webgpu';
import { createSettings } from '../../engine/core/settings';
import { createRenderer, type FrameView, type GfxError } from '../../engine/gfx/renderer';
import { shot, shotForJson, type ShotOptions } from '../../engine/gfx/shot';

/** One structured error record, as `window.__engine.errors` holds them (PLAN.md §8.3). */
interface ErrorRecord {
  code: string;
  message: string;
  fix: string;
}

/** The cameras: position and target. */
const CAMERAS: Record<string, { position: [number, number, number]; target: [number, number, number] }> = {
  front: { position: [0, 3.5, 9], target: [0, 0.6, 0] },
  iso: { position: [7, 6, 7], target: [0, 0.5, 0] },
  top: { position: [0, 14, 0.01], target: [0, 0, 0] },
};

/** The scenes: what each adds to the empty scene. */
const SCENES: Record<string, (scene: THREE.Scene) => void> = {
  empty: () => undefined,
  objects: (scene) => {
    const add = (name: string, geometry: THREE.BufferGeometry, color: number, at: [number, number, number]) => {
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
      mesh.name = name;
      mesh.position.set(...at);
      // The floor receives shadows and casts none; the rest cast and receive none: no shadow acne.
      mesh.castShadow = name !== 'floor';
      mesh.receiveShadow = name === 'floor';
      scene.add(mesh);
      return mesh;
    };
    add('floor', new THREE.PlaneGeometry(12, 12).rotateX(-Math.PI / 2), 0x59606e, [0, 0, 0]);
    add('crate', new THREE.BoxGeometry(1.2, 1.2, 1.2), 0xb07a3c, [-2, 0.6, 0.5]);
    add('ball', new THREE.SphereGeometry(0.7, 24, 16), 0x3c8fd9, [1.2, 0.7, 1]);
    add('pillar', new THREE.CylinderGeometry(0.4, 0.4, 2.4, 20), 0xd8d2c4, [2.6, 1.2, -1.4]);
    add('buried', new THREE.BoxGeometry(0.2, 0.2, 0.2), 0xff00ff, [2.6, 1.2, -1.4]);
    add('behind', new THREE.BoxGeometry(0.5, 0.5, 0.5), 0x00ff00, [0, 1, 30]);
    add('ghost', new THREE.BoxGeometry(0.5, 0.5, 0.5), 0xffffff, [0, 0.25, -2]).visible = false;
    const hero = new THREE.Group();
    hero.name = 'hero';
    hero.userData = { protagonist: true, entity: 1 };
    hero.position.set(-0.2, 0, 1.8);
    scene.add(hero);
    const body = add('hero-body', new THREE.CapsuleGeometry(0.3, 0.9, 4, 12), 0xd9534f, [0, 0.75, 0]);
    const head = add('hero-head', new THREE.SphereGeometry(0.22, 16, 12), 0xf2c6a0, [0, 1.55, 0]);
    hero.add(body, head);
  },
};

const params = new URLSearchParams(location.search);
const sceneName = params.get('scene') ?? 'objects';
const camName = params.get('cam') ?? 'front';
const message = document.querySelector<HTMLElement>('#msg');
const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
let info: Record<string, unknown> = { page: 'shot', scene: sceneName, cam: camName };
let view: FrameView | null = null;
let gfx: Awaited<ReturnType<typeof createRenderer>> | null = null;
const signals = {
  ready: false,
  errors: [] as ErrorRecord[],
  info: () => info,
  /** Shoots the view (engine/gfx/shot.ts) and returns the result as JSON. */
  shot: async (options: ShotOptions = {}) => {
    if (!gfx || !view) throw new Error('the shot page is not ready');
    return shotForJson(await shot(gfx, view, options));
  },
};
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

/** Starts the renderer, builds the scene, warms up, draws the first frame and signals ready. */
async function start(): Promise<void> {
  const bad = (what: string, name: string, known: object): ErrorRecord => {
    const fix = `use one of: ${Object.keys(known).join(', ')}`;
    return { code: 'PAGE_BAD_PARAM', message: `the shot page has no ${what} ${name}`, fix };
  };
  if (!Object.hasOwn(SCENES, sceneName)) return fail(bad('scene', sceneName, SCENES));
  if (!Object.hasOwn(CAMERAS, camName)) return fail(bad('camera', camName, CAMERAS));
  const [build, cam] = [SCENES[sceneName], CAMERAS[camName]];
  const settings = createSettings();
  settings.fromUrl(location.search, { reserved: ['scene', 'cam'] });
  try {
    gfx = await createRenderer(canvas, { settings });
  } catch (error) {
    const { code, message, fix } = error as GfxError;
    if (code && fix) return fail({ code, message, fix });
    throw error;
  }
  gfx.renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x26303f);
  scene.add(new THREE.HemisphereLight(0xbcd2ff, 0x2a2018, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(4, 7, 3);
  key.castShadow = true;
  scene.add(key);
  build(scene);
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
  camera.position.set(...cam.position);
  camera.lookAt(...cam.target);
  view = { scene, camera };
  await gfx.warmup.run(view);
  const current = gfx;
  const frame = view;
  for (let tries = 0; tries < 10 && !current.frame(frame).drawn; tries++) {
    if (current.warmup.running) await current.warmup.run(frame);
  }
  await current.device.queue.onSubmittedWorkDone();
  Object.assign(window, { __shotPage: { gfx: current, scene, camera, view: frame, settings, three: THREE } });
  info = { ...info, ...current.info };
  const loop = () => {
    current.frame(frame);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  if (message) message.hidden = true;
  signals.ready = true;
}

start().catch((error: unknown) => {
  const code = (error as { code?: string }).code ?? 'SHOT_PAGE_START';
  const fix = (error as { fix?: string }).fix ?? 'the console names the cause';
  fail({ code, message: String((error as Error).message ?? error), fix });
});
