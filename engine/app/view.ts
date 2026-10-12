/**
 * @file The view of a run (PLAN.md §6.4's `view.update`, §8.3, WP 2.7): what a running scene looks like, built
 * without a GPU, so a page draws it and `createHeadless({ view: true })` dumps it in Node. `createRunView` makes the
 * stage of the scene (engine/gfx/stage.ts: lights, the level's meshes, actors as puppets, a stand-in per other placed
 * entity) and its camera (engine/gfx/cameras: a camera code, `cam=iso` by default), and keeps both in step with the
 * run: `stepped()` after every sim step reads where the entities are, `frame({ alpha, dt, aspect })` puts every
 * puppet and stand-in `alpha` of the way between its last two steps and moves the camera by a rendered frame, then
 * draws the crowd bodies as that camera sees them (engine/gfx/stageCrowd.ts: its level of detail and culling; after
 * steps with no frame, `dump` draws them first), then moves the stage's effects on by the frame (engine/gfx/stageFx.ts:
 * the world's new events burst, its bolts, telegraphs and trails drawn, unless the view setting `gfx.effects` is off;
 * the page shakes its camera by them while it draws), returning what to draw (`{ scene, camera, alpha }`,
 * engine/gfx/renderer.ts's `FrameView`). A frame that finds `gfx.effects` switched since the last read reads the
 * entities again first, so a flying bolt is the effects' or its stand-in from that frame, with or without a step.
 *
 * The camera follows the player (WP 3.10): the first player actor's feet as the frame draws them, else the level's
 * middle. The chase camera also gets the sim's read-only `QueryView` (engine/sim/queryView.ts) in a physics scene,
 * so it stays in front of the walls; first person gets the player's eye, and hides his body but the hands from
 * itself (near-body culling, `cameraInfo().culled`). While it follows a player the level's cutaway runs
 * (engine/gfx/cutaway.ts): walls facing the camera and pillars before him cut away, so every view sees him. `restarted()` after the run
 * starts again (a new seed, a replay) or its world changes between steps (a restore, a dev action) reads the entities
 * afresh: the stand-ins and bolts snap to them, so no dump, shot or frame shows the places they had before. The
 * effects forget what ran only for a new world, read from its first event; the same world keeps its trace read (the
 * trace is history, never restored), so a restore or a dev action never plays an event twice.
 *
 * The level comes from the scene's `level` id (engine/world/level/level.ts): its text must be registered before the
 * view starts (`APP_NO_LEVEL`), by the page (`import text from './levels/room.txt?raw'`) or a Node test (read the
 * file). Cameras are view state: switching one (`setCamera(code)`, `__engine.camera.set`) never reaches the sim.
 *
 * Invariants: presentation only (doctrine: WebGPU only): it reads the run and never writes it (the `QueryView` has
 * no way in); one stage per view and one three.js camera per projection (engine/gfx/cameras/place.ts), so switching
 * cameras makes no new object.
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
import { createCamera, createCameraPair, type AnyCamera } from '../gfx/cameras/place';
import type { CameraInput, CameraPose, Vec3 } from '../gfx/cameras/pose';
import type { MaterialLibrary } from '../gfx/materials/library';
import type { FrameView } from '../gfx/renderer';
import { dumpScene, type DumpOptions } from '../gfx/sceneDump';
import { createStage, type Stage } from '../gfx/stage';
import { queryViewOf, type QueryView } from '../sim/queryView';
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
  /** First person: the player's joints whose body parts it hides from itself (near-body culling). */
  culled?: string[];
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
  readonly camera: AnyCamera;
  /** Both three.js cameras, perspective then orthographic: what a warm-up compiles for. */
  readonly cameras: readonly [BoostedPerspectiveCamera, BoostedOrthographicCamera];
  /** The three.js camera the last frame placed. */
  readonly drawn: BoostedPerspectiveCamera | BoostedOrthographicCamera;
  /** Reads where the entities are after a sim step. */
  stepped(): void;
  /** The run started again, or its world changed between steps: forget the old places and snap to the new ones. */
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
  const fxRng = (...keys: readonly (string | number)[]) => options.run().world.fxRng(...keys);
  const stage = createStage({ level, materials: options.materials, registry, log: options.log, fxRng });
  /**
   * Turns the effects on or off by the view setting `gfx.effects` (a registry without it: on), before they read;
   * returns whether that changed them.
   */
  const syncEffects = (): boolean => {
    const run = options.run();
    const declared = registry.kinds().includes('setting') && registry.has('setting', 'gfx.effects');
    const enabled = !declared || run.settings.get<boolean>('gfx.effects') !== false;
    const changed = stage.fx.effects.enabled !== enabled;
    stage.fx.effects.enabled = enabled;
    return changed;
  };
  /** Reads the entities afresh from the run's last step: every stand-in, puppet and bolt snaps to it. */
  const reread = () => {
    const run = options.run();
    stage.capture([]);
    stage.capture(placed(run, stage.kinds), run.world.dt);
  };
  /** The world whose trace the effects read: only a new one is read from its first event. */
  let fxWorld: object | null = null;
  const pair = createCameraPair();
  let camera: AnyCamera = createCamera(options.cam ?? DEFAULT_CAMERA);
  let drawn: BoostedPerspectiveCamera | BoostedOrthographicCamera = pair.perspective;
  let aspect = HEADLESS_ASPECT;
  let culled: string[] = [];
  let alpha = 1;
  let crowdStale = false;
  /** Poses and draws the crowd bodies as the camera now placed sees them. */
  const drawCrowd = () => {
    stage.crowd.draw(alpha, drawn);
    crowdStale = false;
  };
  const views = new WeakMap<object, QueryView>();
  /** The sim's read-only queries, for the chase camera's walls; none without physics. */
  const queries = (): QueryView | undefined => {
    const run = options.run();
    if (!run.scene.physics) return undefined;
    const world = run.world;
    if (!views.has(world)) views.set(world, queryViewOf(world));
    return views.get(world);
  };
  /** What the camera takes from the run this frame: whom it follows, his eye, the walls. */
  const follow = (): { follow: Vec3; eye?: Vec3; queries?: QueryView } => {
    const player = stage.actors.player();
    return { follow: player?.feet ?? stage.centre, eye: player?.posed?.eye, queries: queries() };
  };
  /** Steps the camera by `dt` with `input`, then hides the player's body from a first-person camera. */
  const move = (input: CameraInput | undefined, dt: number): CameraPose => {
    const pose = camera.update({ ...follow(), ...input }, dt);
    culled = stage.actors.cull(camera.type === 'first' ? pose.position : null);
    const player = stage.actors.player();
    if (player) stage.cutaway?.update(pose, player.feet);
    return pose;
  };
  const info = (): CameraInfo => ({
    code: camera.code(),
    describe: camera.describe(),
    type: camera.type,
    yaw: camera.yaw(),
    pose: camera.pose(),
    ...(camera.type === 'first' ? { culled: [...culled] } : {}),
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
      const run = options.run();
      syncEffects(); // off, the bolts this step reads draw as stand-ins at once
      stage.capture(placed(run, stage.kinds), run.world.dt);
      stage.draw((alpha = 1)); // the latest state until a frame interpolates: what a headless dump shows
      crowdStale = true; // posed by the next frame or dump, not every step
    },
    restarted() {
      const run = options.run();
      // A new world is read from its first event. The same one (a restore, a dev action) keeps its trace read: the
      // trace is history, never restored, so reading it again would play its events twice. Bolts snap either way.
      if (run.world !== fxWorld) {
        stage.fx.reset();
        fxWorld = run.world;
      }
      syncEffects();
      reread();
      stage.draw((alpha = 1));
      crowdStale = true;
    },
    frame(frame) {
      aspect = frame.aspect;
      // Turned on or off since the last read (a paused page, a hit-stop, a shot): read the world again first, so a
      // flying bolt changes hands at once between the effects and its stand-in, and no frame draws it by neither.
      if (syncEffects()) reread();
      stage.draw((alpha = frame.alpha));
      drawn = pair.place(move(frame.input, frame.dt), aspect);
      drawCrowd();
      stage.fx.frame(frame.dt, drawn, options.run().world.events.trace());
      return { scene: stage.scene, camera: drawn, alpha: frame.alpha };
    },
    cameraInfo: info,
    setCamera(code) {
      camera = createCamera(code, { from: camera.pose() });
      drawn = pair.place(move(undefined, 0), aspect);
      drawCrowd();
      return info();
    },
    dump: (dumpOptions) => {
      if (crowdStale) drawCrowd();
      return dumpScene(stage.scene, dumpOptions);
    },
    dispose: () => stage.dispose(),
  };
  view.restarted();
  view.frame({ alpha: 1, dt: 0, aspect });
  return view;
}
