/**
 * @file The view of a run (PLAN.md §6.4's `view.update`, §8.3, WP 2.7): what a running scene looks like, built
 * without a GPU, so a page draws it and `createHeadless({ view: true })` dumps it in Node. `createRunView` makes the
 * stage of the scene (engine/gfx/stage.ts: lights, the level's meshes, a stand-in per placed entity) and its camera
 * (engine/gfx/cameras: a camera code, `cam=iso` by default, following the level's middle), and keeps both in step
 * with the run: `stepped()` after every sim step reads where the entities are, `frame({ alpha, dt, aspect })` moves
 * the camera by a rendered frame and puts every stand-in `alpha` of the way between its last two steps, returning
 * what to draw (`{ scene, camera, alpha }`, engine/gfx/renderer.ts's `FrameView`). `restarted()` after the run
 * starts again (a new seed, a replay) reads the new run's entities afresh.
 *
 * The level comes from the scene's `level` id (engine/world/level/level.ts): its text must be registered before the
 * view starts (`APP_NO_LEVEL`), by the page (`import text from './levels/room.txt?raw'`) or a Node test (read the
 * file). Cameras are view state: switching one (`setCamera(code)`, `__engine.camera.set`) never reaches the sim.
 *
 * Invariants: presentation only (doctrine: WebGPU only): it reads the run and never writes it; one stage per view
 * and one three.js camera per projection (engine/gfx/cameras/place.ts), so switching cameras makes no new object.
 *
 * @example
 * // const view = createRunView({ run: () => session, registry, materials: createMaterialLibrary() });
 * // view.stepped(); // after each sim step
 * // gfx.frame(view.frame({ alpha, dt, aspect }));
 * // view.setCamera('cam=topdown').describe; // what the camera now shows, in words
 * @see engine/app/view.test.ts
 */
import { codeError, defineCodes, type Log } from '../core/log';
import type { Registry } from '../core/registry';
import type { BoostedOrthographicCamera, BoostedPerspectiveCamera } from '../gfx/cameras/boost';
import { createCamera, createCameraPair } from '../gfx/cameras/place';
import type { Camera, CameraInput, CameraPose } from '../gfx/cameras/pose';
import type { MaterialLibrary } from '../gfx/materials/library';
import type { FrameView } from '../gfx/renderer';
import { dumpScene, type DumpOptions } from '../gfx/sceneDump';
import { createStage, type Stage } from '../gfx/stage';
import type { Session } from '../sim/scene';
import type { EntityData } from '../sim/state';
import { getLevel } from '../world/level/level';

/** The codes this module raises, with their fixes. */
export const VIEW_CODES = defineCodes('app', {
  APP_NO_LEVEL: {
    template: 'the scene {scene} loads the level {level}, which is not registered, so its view cannot be built',
    fix: "register the level's text before the view starts: in a page, import text from './levels/<name>.txt?raw' and call defineLevel('{level}', { text, file }); in Node, read the file and do the same",
  },
  APP_NO_VIEW: {
    template: '{member} needs the scene drawn as a view, and this engine has none',
    fix: 'start it with createHeadless({ scene, view: true }) in Node; a page always has one',
  },
});

/** The camera code a view starts with when none is given. */
export const DEFAULT_CAMERA = 'cam=iso';

/** The aspect a view frames for when nothing draws it (headless): 16:9, the e2e viewport's. */
export const HEADLESS_ASPECT = 16 / 9;

/** What `camera.get()` and `camera.set(code)` return: the camera as a code, in words, and its pose. */
export interface CameraInfo {
  code: string;
  describe: string;
  type: string;
  /** The heading it looks along, rad: the intents' `cam`. */
  yaw: number;
  pose: CameraPose;
}

/** What a view is made from. */
export interface RunViewOptions {
  /** The run it shows: the live session, read again after every restart. */
  run: () => Session;
  /** Where the scene's level and the component kinds are declared. */
  registry: Registry;
  /** The page's material library. */
  materials: MaterialLibrary;
  /** The camera code to start with (`DEFAULT_CAMERA`). Throws `GFX_BAD_CAMERA_CODE` or `GFX_UNKNOWN_CAMERA`. */
  cam?: string;
  log?: Log;
}

/** One rendered frame's view inputs: the clock's alpha, real seconds since the last frame, the picture's aspect. */
export interface ViewFrame {
  alpha: number;
  dt: number;
  aspect: number;
  /** What the devices give the camera this frame (mouse look, wheel). */
  input?: CameraInput;
}

/** The view of a run (see the file comment). */
export interface RunView {
  readonly stage: Stage;
  /** The camera's state (what codes and the devices change). */
  readonly camera: Camera;
  /** Both three.js cameras, perspective then orthographic: what a warm-up compiles for. */
  readonly cameras: readonly [BoostedPerspectiveCamera, BoostedOrthographicCamera];
  /** The three.js camera the last frame placed. */
  readonly drawn: BoostedPerspectiveCamera | BoostedOrthographicCamera;
  /** Reads where the entities are after a sim step. */
  stepped(): void;
  /** The run started again: forget the old entities' places and read the new ones. */
  restarted(): void;
  /** Moves the camera by one rendered frame and the stand-ins to `alpha`; returns what to draw. */
  frame(frame: ViewFrame): FrameView;
  /** The camera now. */
  cameraInfo(): CameraInfo;
  /** Switches to the camera `code` names, from the current one; returns it. Throws for a bad code. */
  setCamera(code: string): CameraInfo;
  /** The stage as text (engine/gfx/sceneDump.ts). */
  dump(options?: DumpOptions): string;
  /** Frees the stage. */
  dispose(): void;
}

/** The entities that a stage can place, each once, in id order. */
function placed(session: Session, kinds: readonly string[]): EntityData[] {
  const byId = new Map<number, EntityData>();
  for (const kind of kinds) for (const entity of session.world.query(kind)) byId.set(entity.id, entity);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/** Builds the view of a run (see the file comment). */
export function createRunView(options: RunViewOptions): RunView {
  const { registry } = options;
  const scene = options.run().scene;
  const known = (id: string) => registry.kinds().includes('level') && registry.has('level', id);
  if (scene.level !== undefined && !known(scene.level)) {
    throw codeError('APP_NO_LEVEL', { scene: scene.id, level: scene.level });
  }
  const level = scene.level === undefined ? null : getLevel(scene.level, registry);
  const stage = createStage({ level, materials: options.materials, registry, log: options.log });
  const pair = createCameraPair();
  let camera = createCamera(options.cam ?? DEFAULT_CAMERA);
  let drawn: BoostedPerspectiveCamera | BoostedOrthographicCamera = pair.perspective;
  let aspect = HEADLESS_ASPECT;
  const follow = stage.centre;
  const info = (): CameraInfo => ({
    code: camera.code(),
    describe: camera.describe(),
    type: camera.type,
    yaw: camera.yaw(),
    pose: camera.pose(),
  });
  const view: RunView = {
    stage,
    get camera() {
      return camera;
    },
    cameras: [pair.perspective, pair.orthographic],
    get drawn() {
      return drawn;
    },
    stepped() {
      stage.capture(placed(options.run(), stage.kinds));
      stage.draw(1); // the latest state until a frame interpolates: what a headless dump shows
    },
    restarted() {
      stage.capture([]);
      stage.capture(placed(options.run(), stage.kinds));
      stage.draw(1);
    },
    frame(frame) {
      aspect = frame.aspect;
      const pose = camera.update({ follow, ...frame.input }, frame.dt);
      drawn = pair.place(pose, aspect);
      stage.draw(frame.alpha);
      return { scene: stage.scene, camera: drawn, alpha: frame.alpha };
    },
    cameraInfo: info,
    setCamera(code) {
      camera = createCamera(code, { from: camera.pose() });
      drawn = pair.place(camera.update({ follow }, 0), aspect);
      return info();
    },
    dump: (dumpOptions) => dumpScene(stage.scene, dumpOptions),
    dispose: () => stage.dispose(),
  };
  view.restarted();
  view.frame({ alpha: 1, dt: 0, aspect });
  return view;
}
