/**
 * @file The hello page's scene (labs/hello/): a lit procedural cube with a `MeshStandardMaterial`, drawn on WebGPU
 * through engine/gfx/renderer.ts, either directly or through one `PostProcessing` pass whose output is a TSL colour
 * grade (no MRT). It proves three.js r182's post path on WebGPU, headless (PLAN.md §4.7).
 *
 * Invariants: every frame clears to the opaque `BACKGROUND` and is a function of the time it is drawn at alone (the
 * cube turns at `SPIN`), so under the e2e fixture's virtual clock a frame repeats exactly; the first frame is drawn
 * and done on the GPU before `startHello` resolves. The post pass changes colours only: the grade saturates and warms
 * them, so the two ways of drawing differ in colour, never in what covers the frame.
 *
 * @see labs/hello/boot.ts
 * @see tests/e2e/hello.spec.ts
 */
import {
  BoxGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PointLight,
  PostProcessing,
  Scene,
} from 'three/webgpu';
import { pass, saturation, uniform, vec3, vec4 } from 'three/tsl';
import { createRenderer, type GfxInfo } from '../../engine/gfx/renderer';

/** The clear colour, opaque. */
const BACKGROUND = 0x1d2430;

/** The cube's base colour. */
const CUBE = 0xd9772b;

/** How fast the cube turns about +Y, in radians per second. */
const SPIN = 0.5;

/** The grade: saturation (1 leaves colours as they are) and a warm tint, multiplied in linear light. */
const GRADE = { saturation: 1.4, tint: [1.12, 1.0, 0.86] } as const;

/** A started hello scene. */
export interface HelloView {
  /** What the renderer reports (backend, adapter, features, three.js's revision). */
  info: GfxInfo;
  /** Whether frames go through the post pass. */
  post: boolean;
  /** Draws the frame at `seconds` since startup. */
  draw(seconds: number): void;
  /** Fits the drawing buffer and camera to a new CSS size, in pixels. */
  resize(width: number, height: number): void;
}

/**
 * Starts the renderer on `canvas` (rejecting with `GfxError` `GFX_NO_WEBGPU` without WebGPU), builds the scene, and
 * draws the first frame, directly or through the post pass; resolves once the GPU has finished it.
 */
export async function startHello(canvas: HTMLCanvasElement, options: { post: boolean }): Promise<HelloView> {
  const gfx = await createRenderer(canvas);
  const { renderer } = gfx;

  const scene = new Scene();
  scene.background = new Color(BACKGROUND);
  const cube = new Mesh(
    new BoxGeometry(1.3, 1.3, 1.3),
    new MeshStandardMaterial({ color: CUBE, roughness: 0.45, metalness: 0.1 }),
  );
  cube.rotation.x = 0.45;
  const key = new DirectionalLight(0xffffff, 1.6);
  key.position.set(3, 4, 5);
  // A point light close by shades each face with a gradient, so the frame shows per-pixel lighting.
  const lamp = new PointLight(0xfff1e0, 9, 0, 2);
  lamp.position.set(-1.4, 1.5, 1.8);
  scene.add(cube, key, lamp, new HemisphereLight(0xbcd2ff, 0x2a2018, 0.8));

  const camera = new PerspectiveCamera(40, 1, 0.1, 50);
  camera.position.set(0, 0.5, 4.5);
  camera.lookAt(0, 0, 0);

  const post = new PostProcessing(renderer);
  const frame = pass(scene, camera);
  const tint = vec3(...GRADE.tint);
  post.outputNode = vec4(saturation(frame.rgb, uniform(GRADE.saturation)).mul(tint), frame.a);

  const view: HelloView = {
    info: gfx.info,
    post: options.post,
    draw(seconds) {
      cube.rotation.y = 0.6 + seconds * SPIN;
      if (options.post) post.render();
      else renderer.render(scene, camera);
    },
    resize(width, height) {
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
  };
  view.resize(canvas.clientWidth, canvas.clientHeight);
  view.draw(0);
  await gfx.device.queue.onSubmittedWorkDone();
  return view;
}
