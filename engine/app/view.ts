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
 * The camera is a rig (engine/gfx/cameras/rig.ts: a code's camera, blends, the view effects, the settings `cam.*`) that
 * follows the player (WP 3.10): the first player actor's feet as the frame draws them, else the level's middle; so does
 * the stage's sky (engine/gfx/stageSky.ts, flickering at the frames' time, WP 7.8), and the level entry's material
 * swaps (`materials`) reach the stage. The rig also gets the sim's read-only `QueryView` in a physics scene (the follow
 * cameras keep out of the walls), the player's eye (the shooter model's height, else his head socket) and what he does
 * each step (`cameraPlayer`); first person draws his arms by their own lens and hides his body, its shadow kept
 * (engine/gfx/viewmodel/, WP 13.12; `cameraInfo().culled`, `.arms`); hard landings shake the screen. Following a
 * player, the cutaways run (the stage's `frame`); `aim(rule, devices)` is his aim from the camera drawn last (WP 13.9,
 * engine/input/aim.ts: the centre's ray through the sim's queries, his body skipped, or the pointer's onto his floor),
 * which the page's input records. `restarted()` after the run starts again (a new seed, a replay) or its world changes
 * between steps (a restore, a dev action) reads the entities afresh: the stand-ins and bolts snap to them, so no dump,
 * shot or frame shows the places they had before. The effects forget what ran only for a new world, read from its first
 * event; the same world keeps its trace read (history, never restored), so no event plays twice.
 *
 * The level comes from the scene's `level` id (engine/world/level/level.ts), registered before the view starts
 * (`APP_NO_LEVEL`), the terrain from its `terrain` id (WP 10.5), the site from its `site` id (WP 13.15). Cameras are
 * view state: switching one (`setCamera(code)`, `__engine.camera.set`; with `{ blend: true }`, the page's live switch,
 * it blends) never reaches the sim. Invariants: presentation only (the doctrine's WebGPU only): it reads the run, never
 * writes it (the `QueryView` has no way in); one stage per view, one three.js camera per projection, none per switch.
 *
 * @example
 * // const view = createRunView({ run: () => session, registry, materials: createMaterialLibrary() });
 * // view.stepped(); // after each sim step; then gfx.frame(view.frame({ alpha, dt, aspect }))
 * // view.setCamera('cam=topdown').describe; // what the camera now shows, in words
 * @see engine/app/view.test.ts
 */
import { codeError, defineCodes, type Log } from '../core/log';
import type { Registry } from '../core/registry';
import type { BoostedOrthographicCamera, BoostedPerspectiveCamera } from '../gfx/cameras/boost';
import { cameraPlayer, type CameraPlayer } from '../gfx/cameras/effects';
import { createCameraPair, type AnyCamera } from '../gfx/cameras/place';
import type { CameraInput, CameraPose, Vec3 } from '../gfx/cameras/pose';
import { createCameraRig, rigOptions } from '../gfx/cameras/rig';
import type { MaterialLibrary } from '../gfx/materials/library';
import type { FrameView } from '../gfx/renderer';
import { aimPoint, type AimDevices, type AimRule } from '../input/aim';
import { dumpScene, type DumpOptions } from '../gfx/sceneDump';
import { createStage, type Stage } from '../gfx/stage';
import type { FirstPersonParts } from '../gfx/viewmodel/body';
import { armsLens } from '../gfx/viewmodel/lens';
import { queryViewOf, type QueryView } from '../sim/queryView';
import type { Session } from '../sim/session';
import type { EntityData } from '../sim/state';
import { getLevel, type LevelEntry } from '../world/level/level';
import { getSite } from '../world/site';
import { getTerrain } from '../world/terrain';

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
  /** First person: the player's joints whose body parts it hides from itself, and the ones his arms show. */
  culled?: string[];
  arms?: string[];
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
  /** The point `rule` aims at from the camera drawn last (see the file comment); undefined without a player. */
  aim(rule: AimRule, devices?: AimDevices): Vec3 | undefined;
  /** Switches to the camera `code` names, from the current one (blending with `blend`); returns it. Throws for a bad code. */
  setCamera(code: string, options?: { blend?: boolean }): CameraInfo;
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
  const entry = scene.level === undefined ? null : (registry.get('level', scene.level) as LevelEntry);
  const levelMaterials = (entry?.materials ?? {}) as Readonly<Record<string, string>>; // strings: the kind checks
  const levelRooms = (entry?.rooms ?? {}) as Readonly<Record<string, string>>;
  const terrain = scene.terrain === undefined ? null : getTerrain(scene.terrain, registry);
  const site = scene.site === undefined ? null : getSite(scene.site, registry);
  const fxRng = (...keys: readonly (string | number)[]) => options.run().world.fxRng(...keys);
  const stage = createStage({ level, terrain, site, materials: options.materials, registry, log: options.log, fxRng, levelMaterials, levelRooms }); // prettier-ignore
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
    stage.capture(placed(run, stage.kinds), run.world.dt, queries());
  };
  /** The world whose trace the effects read: only a new one is read from its first event. */
  let fxWorld: object | null = null;
  const pair = createCameraPair();
  const rig = createCameraRig(options.cam ?? DEFAULT_CAMERA);
  let drawn: BoostedPerspectiveCamera | BoostedOrthographicCamera = pair.perspective;
  let aspect = HEADLESS_ASPECT;
  let parts: FirstPersonParts = { hidden: [], arms: [] };
  let alpha = 1;
  let crowdStale = false;
  /** Seconds of frames drawn: the lights' flicker clock (presentation only). */
  let time = 0;
  /** Poses and draws the crowd bodies as the camera now placed sees them. */
  const drawCrowd = () => {
    stage.crowd.draw(alpha, drawn);
    crowdStale = false;
  };
  const views = new WeakMap<object, QueryView>();
  /** The sim's read-only queries, for the follow cameras' walls and the puppets' ground; none without physics. */
  const queries = (): QueryView | undefined => {
    const run = options.run();
    if (!run.scene.physics) return undefined;
    const world = run.world;
    if (!views.has(world)) views.set(world, queryViewOf(world));
    return views.get(world);
  };
  /** What the player did last step, for the rig (`cameraPlayer`); null without one. */
  let doing: CameraPlayer | null = null;
  /** The player's body, which his aim's ray skips; -1 without one. */
  let body = -1;
  /** Reads the player after a step (`fresh`: after a restart, so nothing he did before counts as a landing). */
  const readPlayer = (fresh = false) => {
    const run = options.run();
    if (fresh) rig.step(null);
    const entity = run.world.query('actor').find((e) => (e.actor as { player?: boolean }).player === true);
    const aiming = (run.intents.b ?? []).includes('aim');
    doing = entity ? cameraPlayer(entity, aiming) : null;
    body = entity ? Number((entity.actor as { body?: number }).body ?? -1) : -1;
    const look = run.intents.look; // his head, and his gun, along it (WP 13.11)
    if (entity) stage.actors.look(entity.id, look ? { yaw: look[0], pitch: look[1], aiming } : null);
    rig.step(doing);
  };
  /** Whether the run's registry declares the view setting `path`. */
  const declared = (path: string) => registry.kinds().includes('setting') && registry.has('setting', path);
  /** What the camera takes from the run this frame: whom it follows, his eye and what he does, the walls. */
  const follow = (): { follow: Vec3; eye?: Vec3; queries?: QueryView; player: CameraPlayer | null } => {
    const player = stage.actors.player();
    const feet = player?.feet ?? stage.centre;
    const eye: Vec3 | undefined = doing?.eye !== undefined ? [feet[0], feet[1] + doing.eye, feet[2]] : player?.posed?.eye; // prettier-ignore
    return { follow: feet, eye, queries: queries(), player: doing };
  };
  /** Steps the camera by `dt` with `input`, then draws the player for a first-person camera: his arms, his body hidden. */
  const move = (input: CameraInput | undefined, dt: number): CameraPose => {
    const run = options.run();
    const setting = (path: string) => (declared(path) ? run.settings.get(path) : undefined);
    rig.configure(rigOptions(setting));
    const pose = rig.update({ ...follow(), ...input }, dt);
    stage.fx.effects.shake.add(rig.shake());
    const lens = { fov: armsLens(setting('cam.armsFov')), fullBody: setting('cam.fullBody') === true };
    const first = rig.firstShare() > 0.5 ? { pose, dt, aspect, player: doing, effects: rig.effects(), ...lens } : null;
    parts = stage.actors.firstPerson(first);
    const player = stage.actors.player();
    const fade = (rig.camera as { fade?: boolean }).fade === true; // a camera that may stand behind a wall
    if (player) stage.frame(pose, player.feet, { fade, view: rig.camera.type === 'view' });
    return pose;
  };
  const info = (): CameraInfo => ({
    code: rig.camera.code(),
    describe: rig.camera.describe(),
    type: rig.camera.type,
    yaw: rig.camera.yaw(),
    pose: rig.pose(),
    ...(rig.camera.type === 'first' ? { culled: [...parts.hidden], arms: [...parts.arms] } : {}),
  });
  const view: RunView = {
    stage,
    get camera() {
      return rig.camera;
    },
    cameras: [pair.perspective, pair.orthographic],
    get drawn() {
      return drawn;
    },
    stepped() {
      const run = options.run();
      syncEffects(); // off, the bolts this step reads draw as stand-ins at once
      stage.capture(placed(run, stage.kinds), run.world.dt, queries());
      stage.draw((alpha = 1)); // the latest state until a frame interpolates: what a headless dump shows
      crowdStale = true; // posed by the next frame or dump, not every step
      readPlayer();
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
      readPlayer(true);
    },
    frame(frame) {
      aspect = frame.aspect;
      // Turned on or off since the last read (a paused page, a hit-stop, a shot): read the world again first, so a
      // flying bolt changes hands at once between the effects and its stand-in, and no frame draws it by neither.
      if (syncEffects()) reread();
      stage.draw((alpha = frame.alpha));
      drawn = pair.place(move(frame.input, frame.dt), aspect);
      time += frame.dt;
      stage.sky.update({ camera: drawn, focus: stage.actors.player()?.feet ?? stage.centre, time });
      drawCrowd();
      stage.fx.frame(frame.dt, drawn, options.run().world.events.trace());
      return { scene: stage.scene, camera: drawn, alpha: frame.alpha };
    },
    cameraInfo: info,
    aim(rule, devices = {}) {
      if (!stage.actors.player()) return undefined;
      const { follow: feet, eye, queries: walls } = follow();
      const lens = 'isPerspectiveCamera' in drawn && drawn.isPerspectiveCamera ? { fov: drawn.fov } : {}; // as the page widened it
      const skip = body >= 0 ? { exclude: body } : {};
      const cast = (origin: Vec3, direction: Vec3, max: number) =>
        walls?.raycast(origin, direction, { maxDistance: max, ...skip })?.distance ?? null;
      return aimPoint(rule, { pose: { ...rig.pose(), ...lens }, aspect, feet, eye, ...devices, cast });
    },
    setCamera(code, setOptions = {}) {
      rig.set(code, { blend: setOptions.blend === true });
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
