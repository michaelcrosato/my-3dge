/**
 * @file The playground's page (labs/playground/index.html, docs/PLAYGROUND.md, PLAN.md WP 13.1): it imports every
 * module under `labs/playground/scenes/`, `looks/` and `bodies/`, so a scene added there opens at `?scene=<name>`, a
 * look at `?post.look=<id>` and a body draws, with no change here, registers the playground's levels as text, and
 * starts the engine (`createEngine`, engine/app/engine.ts) on the scene `?scene` names (`gym` by default), in the
 * shooter camera and the cel look unless the query names others, with the playground's replays
 * (tests/replays/playground-*) offered to `?replay=<name>`. Before the engine starts, the menu for humans
 * (labs/playground/menu.ts) lists the scenes, cameras, looks, replays and controls.
 *
 * Controls (labs/playground/controls.ts, WP 13.9): each camera mode reads its own action map (`playgroundMap`), and
 * the maps' view actions switch the views live (`onView`, labs/playground/views.ts): T cycles the five camera modes
 * (blending), X swaps the shooter's shoulder, Q and E turn isometric; P switches the two looks. A click on the game
 * takes the pointer for mouse look in the three perspective cameras (the engine's, by the map; Esc gives it back;
 * isometric and top-down keep the cursor to aim). They are view state, so no camera, look or switch changes the hash.
 * F shows and hides the feel panel (labs/playground/feel.ts, WP 13.4), whose sliders tune the run through recorded
 * settings.
 *
 * Each drawn frame (`onFrame`) it runs the front end (labs/playground/ui/frontEnd.ts, WP 13.25: the title screen,
 * pause on Escape, the spawn picker, settings kept by the store with the bindings, photo mode), shows the gym's signs
 * (labs/playground/levels/gym.ts) within `SIGN_RANGE` of the player and the HUD of the camera mode in use
 * (labs/playground/ui/hud.ts: the room on a site's scene, `whereLine`), plays the frame's sound
 * (labs/playground/sounds/page.ts, WP 13.22), silent until the first key, click or touch, and runs the weather
 * (labs/playground/weather.ts, WP 11.3: `playground.rain` and `playground.dust`). It reads the run and changes it only
 * through the front end's recorded picks (a spawn, a restart, the movement profile).
 *
 * The gym's text is computed from its features, so the page registers the text the scene compiles (`GYM_TEXT`), as the
 * starter game registers its arena's; a level written as a file would come in as `?raw` text, as the box's do. The
 * ground's materials (labs/playground/ground.ts) register when it loads: the hill's terrain draws in them.
 *
 * Game code: it imports only the engine's public API (engine/index.ts) and the playground's own files.
 *
 * Open it at http://127.0.0.1:5173/labs/playground/ (`npm run dev`): `?cam3=first&post.look=look:playground-pixel`
 * starts in first person in the pixel look, `?replay=playground-gym` plays the recorded run. Headless,
 * `node x shot labs/playground --scene gym --cam iso` reports what it draws.
 */
/// <reference types="vite/client" />
import { createEngine, createStore, getSite, siteStructureAt, type Engine, type EngineFrame, type Label, type Site } from '../../engine'; // prettier-ignore
import { playgroundMap } from './controls';
import { mountFeelPanel } from './feel';
import './ground';
import { GYM_FEATURES, GYM_TEXT } from './levels/gym';
import { SITE, SITE_STRUCTURES } from './levels/site';
import { createPlaygroundMenu, type MenuEntry } from './menu';
import { gym } from './scenes/gym';
import { LOOK_KEY, PLAYGROUND_LOOKS, cameraMode, nextCamera, nextLook, swapShoulder, turnView } from './views';
import { createPlaygroundSound } from './sounds/page';
import { runWeather } from './weather';
import { createFrontEnd, spawnOnOpen, titleOnOpen, type FrontEnd } from './ui/frontEnd';
import { showHud, type HudPlayer } from './ui/hud';
import { PREF_BUSES, PREFS_PREFIX, prefsQuery, readPrefs } from './ui/prefs';

/** How near the player a sign shows (m): the features around him, not the whole gym at once. */
const SIGN_RANGE = 24;

/** The playground's levels, by id, as text: the engine registers them for the view. */
const levels = { 'level:gym': { text: GYM_TEXT, file: 'labs/playground/levels/gym.ts' } };

/** The entries of `kind` that `modules` export (scenes), each once, in module order. */
function exported(modules: Record<string, Record<string, unknown>>, kind: string): MenuEntry[] {
  return Object.values(modules)
    .flatMap((module) => Object.values(module))
    .filter((value): value is MenuEntry & { kind: string } => (value as { kind?: unknown })?.kind === kind)
    .filter((entry, i, all) => all.findIndex((other) => other.id === entry.id) === i);
}

// every look and body module, imported now so each registers: ?post.look=look:playground-pixel opens a look, and the
// player is drawn as body:player (labs/playground/bodies/player.ts)
import.meta.glob(['./looks/*.ts', '!./looks/*.test.ts', './bodies/*.ts', '!./bodies/*.test.ts'], { eager: true });

/** Every playground scene module, imported now so each registers its scene; the gym first, the default, the rest by id. */
const modules = import.meta.glob<Record<string, unknown>>(['./scenes/*.ts', '!./scenes/*.test.ts'], { eager: true });
const [first, ...rest] = exported({ gym: { gym }, ...modules }, 'scene');
const sceneEntries = [first, ...rest.sort((a, b) => (a.id < b.id ? -1 : 1))];

/** The playground's replays, by name (`playground-gym`), as text loaded on demand. */
const replays = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../../tests/replays/playground-*.replay.json', { query: '?raw', import: 'default' }),
  ).map(([path, load]) => [path.replace(/^.*\/|\.replay\.json$/g, ''), load]),
);

/**
 * The page's query: the player's kept preferences where it names none (labs/playground/ui/prefs.ts; a replay's page
 * keeps nothing, its store in `demo`), then the shooter camera, the cel look and whole-number zooms where it names none.
 */
const search = new URLSearchParams(location.search);
const store = createStore({ prefix: PREFS_PREFIX, mode: search.has('replay') ? 'demo' : 'play' });
const prefs = readPrefs(store);
prefsQuery(
  prefs,
  search,
  sceneEntries.map((entry) => entry.id),
);
if (!search.has('cam') && !search.has('cam3')) search.set('cam3', 'shoulder');
if (!search.has('post.look')) search.set('post.look', PLAYGROUND_LOOKS[0]);
if (!search.has('cam.wholeZoom')) search.set('cam.wholeZoom', 'true');
createPlaygroundMenu(document, {
  scenes: sceneEntries,
  replays: Object.keys(replays),
  scene: search.get('scene') ?? '',
});

/** The camera member of the inspector (engine/app/viewMembers.ts). */
interface CameraMember {
  get(): { code: string };
  set(code: string, options?: { blend?: boolean }): { code: string };
}

/** The started engine; null until `createEngine` resolves (its first frames are drawn before that). */
let engine: Engine | null = null;

/** The gym's signs, made on the first frame the gym draws; empty in scenes without it. */
let signs: { label: Label; at: readonly number[] }[] = [];

/** Where the gym's level stands in `scene`: at the origin in its own, at its place on the site; null elsewhere. */
function gymAt(scene: EngineFrame['scene']): readonly number[] | null {
  return scene.id === gym.id ? [0, 0, 0] : scene.site === `site:${SITE.name}` ? SITE_STRUCTURES.gym.at : null;
}

/** The camera mode and look on screen, for the HUD. */
let showing = { camera: '', look: search.get('post.look') ?? '' };

/** The running scene's site, made once a scene (its id and the site, or null without one). */
let placed: { scene: string; site: Site | null } = { scene: '', site: null };

/** The structure and room the feet at `at` stand in on the scene's site; null outdoors, undefined without a site. */
function placeAt(scene: EngineFrame['scene'], at: { x: number; y: number; z: number }) {
  if (placed.scene !== scene.id) placed = { scene: scene.id, site: scene.site ? getSite(scene.site) : null };
  if (!placed.site) return undefined;
  return siteStructureAt(placed.site, at.x, at.y + 0.1, at.z); // 10 cm up: resting feet sink a hair into a floor
}

/** Where the player is on the scene's site, for the HUD: the room's name, indoors, or outdoors; null without a site. */
function whereLine(scene: EngineFrame['scene'], at: { x: number; y: number; z: number }): string | null {
  const found = placeAt(scene, at);
  if (found === undefined) return null;
  return found?.room ? `Room: ${found.room.name}` : found ? 'Indoors' : 'Outdoors';
}

/** The player's entity as the page reads it: where it is, how it moves and what it would use (labs/playground/ui/hud.ts). */
type PlayerEntity = HudPlayer & { actor: { player: boolean; x: number; y: number; z: number } };

/** The front end (labs/playground/ui/frontEnd.ts): null until the engine is up. */
let frontEnd: FrontEnd | null = null;

/** The inspector's camera member; null before the engine starts. */
const camera = () => (engine?.inspector?.camera as CameraMember | undefined) ?? null;

/** Shows the signs near the player and the HUD's lines (labs/playground/ui/hud.ts); none of it in photo mode. */
function showFrame({ world, scene, setting }: EngineFrame): void {
  const ui = engine?.ui;
  if (!ui) return;
  const origin = signs.length === 0 ? gymAt(scene) : null;
  if (origin) {
    signs = GYM_FEATURES.map((feature) => {
      const [x, y, z] = feature.sign;
      const at = [x + origin[0], y + origin[1], z + origin[2]] as const;
      return { label: ui.label(feature.label, { at, id: `sign:${feature.id}` }), at };
    });
  }
  const players = world.query('actor') as unknown as PlayerEntity[];
  const entity = players.find((one) => one.actor.player);
  const player = entity?.actor;
  const photo = frontEnd?.state().screens.at(-1) === 'photo';
  for (const sign of signs) {
    sign.label.visible = !photo && (!player || Math.hypot(sign.at[0] - player.x, sign.at[2] - player.z) <= SIGN_RANGE);
  }
  if (!showing.camera) showing = { ...showing, camera: cameraMode(camera()?.get().code ?? '')?.name ?? 'custom' };
  const where = player ? whereLine(scene, player) : null;
  const readout = String(setting('playground.readout'));
  showHud(
    ui,
    engine?.input ?? null,
    { mode: showing.camera, look: showing.look, where, player: entity, readout },
    photo,
  );
}

/** A view action of the map in use (labs/playground/controls.ts): the camera's switch, the shoulder, a view's turn. */
function onView(action: string): void {
  const member = camera();
  if (!member) return;
  const code = member.get().code;
  const next =
    action === 'camera'
      ? nextCamera(code)
      : action === 'shoulder'
        ? swapShoulder(code)
        : turnView(code, action === 'turnLeft' ? -1 : action === 'turnRight' ? 1 : 0);
  if (next === code) return;
  showing = { ...showing, camera: cameraMode(member.set(next, { blend: true }).code)?.name ?? 'custom' };
}

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const sound = createPlaygroundSound(); // published as window.__playgroundSound
for (const bus of PREF_BUSES) if (prefs.volumes[bus] !== undefined) sound.audio.volume(bus, prefs.volumes[bus]);
/** The frame drawn last: the front end reads its scene and settings. */
let last: EngineFrame | null = null;
/** Whether the query's spawn pick (`playground.spawn`) waits for the first frame with the front end up. */
let spawning = search.has('playground.spawn');
engine = await createEngine({
  canvas,
  actionMap: playgroundMap,
  onView,
  scenes: sceneEntries.map((entry) => entry.id),
  levels,
  replays,
  search: `?${search}`,
  store,
  modal: () => frontEnd?.modal() ?? false,
  cameraInput: () => frontEnd?.cameraInput(),
  onFrame: (frame) => {
    last = frame;
    if (spawning && frontEnd) [spawning] = [false, spawnOnOpen(engine!, search, frame.scene)];
    frontEnd?.frame(frame.dt);
    showFrame(frame);
    sound.frame(frame);
    runWeather(frame, (at) => !!placeAt(frame.scene, at)); // the rain and the dust (labs/playground/weather.ts)
  },
});
if (engine.inspector) mountFeelPanel(document, engine.inspector, search);
if (engine.inspector && engine.ui && engine.input) {
  frontEnd = createFrontEnd({
    engine,
    canvas,
    store,
    prefs,
    audio: sound.audio,
    scene: () => last?.scene ?? null,
    setting: (path) => last?.setting(path),
    onView: (change) => void (showing = { ...showing, ...change }),
  });
  if (titleOnOpen(search.get('playground.title') ?? 'auto', search, navigator.webdriver)) frontEnd.open('title');
}

addEventListener('keydown', (event) => {
  const inspector = engine?.inspector;
  if (!inspector || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.code === LOOK_KEY) {
    const look = nextLook(showing.look);
    inspector.set('post.look', look);
    showing = { ...showing, look };
  }
});
