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
 * Each drawn frame (`onFrame`) it shows the gym's signs (labs/playground/levels/gym.ts) as labels over their features,
 * in the gym's own scene and where the gym stands on the site (labs/playground/levels/site.ts), those within
 * `SIGN_RANGE` of the player, and the HUD: the camera mode and the look in use, the room the player is in
 * on a scene's site (`whereLine`, a room's data: PLAN.md WP 13.15), what using the thing in reach does, with the key
 * that uses it on the device used last (its `interactor`'s prompt, WP 13.16), the player's weapon, its rounds, his
 * hits and his accuracy, and the crosshair while the screen's centre aims one (labs/playground/weapons/hud.ts, WP
 * 13.20), and the keys of the map in use as its prompts give them (`keysLine`); and it plays the frame's sound
 * (labs/playground/sounds/page.ts, WP 13.22: the run's events, the room's reverb, the ambience, the wind), silent until
 * the first key, click or touch. It reads the run and never changes it.
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
import { createEngine, getSite, siteStructureAt, type Engine, type EngineFrame, type Label, type Site } from '../../engine'; // prettier-ignore
import { keysLine, playgroundMap } from './controls';
import { mountFeelPanel } from './feel';
import './ground';
import { GYM_FEATURES, GYM_TEXT } from './levels/gym';
import { SITE, SITE_STRUCTURES } from './levels/site';
import { createPlaygroundMenu, type MenuEntry } from './menu';
import { gym } from './scenes/gym';
import { LOOK_KEY, PLAYGROUND_LOOKS, cameraMode, nextCamera, nextLook, swapShoulder, turnView } from './views';
import { createPlaygroundSound } from './sounds/page';
import { showsCrosshair, weaponLine, type WeaponsView } from './weapons/hud';

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

/** The page's query, with the shooter camera, the cel look and whole-number zooms when it names none of them. */
const search = new URLSearchParams(location.search);
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

/** Where the player is on the scene's site, for the HUD: the room's name, indoors, or outdoors; null without a site. */
function whereLine(scene: EngineFrame['scene'], at: { x: number; y: number; z: number }): string | null {
  if (placed.scene !== scene.id) placed = { scene: scene.id, site: scene.site ? getSite(scene.site) : null };
  if (!placed.site) return null;
  const found = siteStructureAt(placed.site, at.x, at.y + 0.1, at.z); // 10 cm up: resting feet sink a hair into a floor
  return found?.room ? `Room: ${found.room.name}` : found ? 'Indoors' : 'Outdoors';
}

/** The player's entity as the HUD reads it: where it is, and what it would use (engine/sim/interact.ts). */
type PlayerEntity = { actor: { player: boolean; x: number; y: number; z: number }; interactor?: { prompt: string }; weapons?: WeaponsView }; // prettier-ignore

/** The inspector's camera member; null before the engine starts. */
const camera = () => (engine?.inspector?.camera as CameraMember | undefined) ?? null;

/** Shows the signs near the player and the HUD's lines. */
function showFrame({ world, scene }: EngineFrame): void {
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
  for (const sign of signs) {
    sign.label.visible = !player || Math.hypot(sign.at[0] - player.x, sign.at[2] - player.z) <= SIGN_RANGE;
  }
  if (!showing.camera) showing = { ...showing, camera: cameraMode(camera()?.get().code ?? '')?.name ?? 'custom' };
  const look = showing.look.replace(/^look:playground-/, '');
  ui.hud('mode', `Camera: ${showing.camera} · Look: ${look}`, { at: 'top-right' });
  ui.hud('room', player ? whereLine(scene, player) : null, { at: 'top-left' });
  if (!engine?.input) return;
  const use = entity?.interactor?.prompt;
  ui.hud('use', use ? `${engine.input.prompt('interact')}: ${use}` : null, { at: 'bottom', keys: true });
  const draw = `${engine.input.prompt('weapon1')} ${engine.input.prompt('weapon2')}`;
  ui.hud('weapon', entity?.weapons ? weaponLine(entity.weapons, draw) : null, { at: 'bottom-right' });
  ui.crosshair(showsCrosshair(entity?.weapons, engine.input.bindings.map.aimWith === 'centre'));
  ui.hud('keys', keysLine(engine.input), { at: 'bottom', keys: true });
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
engine = await createEngine({
  canvas,
  actionMap: playgroundMap,
  onView,
  scenes: sceneEntries.map((entry) => entry.id),
  levels,
  replays,
  search: `?${search}`,
  onFrame: (frame) => {
    showFrame(frame);
    sound.frame(frame);
  },
});
if (engine.inspector) mountFeelPanel(document, engine.inspector, search);

addEventListener('keydown', (event) => {
  const inspector = engine?.inspector;
  if (!inspector || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.code === LOOK_KEY) {
    const look = nextLook(showing.look);
    inspector.set('post.look', look);
    showing = { ...showing, look };
  }
});
