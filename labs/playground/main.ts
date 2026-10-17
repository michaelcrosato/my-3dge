/**
 * @file The playground's page (labs/playground/index.html, docs/PLAYGROUND.md, PLAN.md WP 13.1): it imports every
 * module under `labs/playground/scenes/`, `looks/` and `bodies/`, so a scene added there opens at `?scene=<name>`, a
 * look at `?post.look=<id>` and a body draws, with no change here, registers the playground's levels as text, and
 * starts the engine (`createEngine`, engine/app/engine.ts) on the scene `?scene` names (`gym` by default), in the
 * shooter camera and the cel look unless the query names others, with the playground's replays
 * (tests/replays/playground-*) offered to `?replay=<name>`. Before the engine starts, the menu for humans
 * (labs/playground/menu.ts) lists the scenes, cameras, looks, replays and controls.
 *
 * Live switches (labs/playground/views.ts): T cycles the five camera modes, P switches the two looks, and a click on
 * the game takes the pointer for mouse look in the three perspective cameras (Esc gives it back; isometric and
 * top-down keep the cursor). They are view state, so no camera, look or switch changes the hash.
 *
 * Each drawn frame (`onFrame`) it shows the gym's signs (labs/playground/levels/gym.ts) as labels over their features,
 * those within `SIGN_RANGE` of the player, and the HUD: the camera mode and the look in use, and the keys. It reads the
 * run and never changes it.
 *
 * The gym's text is computed from its features, so the page registers the text the scene compiles (`GYM_TEXT`), as the
 * starter game registers its arena's; a level written as a file would come in as `?raw` text, as the box's do.
 *
 * Game code: it imports only the engine's public API (engine/index.ts) and the playground's own files.
 *
 * Open it at http://127.0.0.1:5173/labs/playground/ (`npm run dev`): `?cam3=first&post.look=look:playground-pixel`
 * starts in first person in the pixel look, `?replay=playground-gym` plays the recorded run. Headless,
 * `node x shot labs/playground --scene gym --cam iso` reports what it draws.
 */
/// <reference types="vite/client" />
import { createEngine, type Engine, type EngineFrame, type Label } from '../../engine';
import { PLAYGROUND_ACTION_MAP } from './controls';
import { GYM_FEATURES, GYM_TEXT } from './levels/gym';
import { createPlaygroundMenu, type MenuEntry } from './menu';
import { gym } from './scenes/gym';
import { CAMERA_KEY, LOOK_KEY, PLAYGROUND_LOOKS, cameraMode, nextCamera, nextLook } from './views';

/** How near the player a sign shows (m): the features around him, not the whole gym at once. */
const SIGN_RANGE = 24;

/** The modes that take the pointer for mouse look: the perspective cameras. */
const LOOKING = new Set(['shooter', 'first', 'platformer']);

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

/** Every playground scene module, imported now so each registers its scene; the gym comes first, the default. */
const modules = import.meta.glob<Record<string, unknown>>(['./scenes/*.ts', '!./scenes/*.test.ts'], { eager: true });
const sceneEntries = exported({ gym: { gym }, ...modules }, 'scene');

/** The playground's replays, by name (`playground-gym`), as text loaded on demand. */
const replays = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../../tests/replays/playground-*.replay.json', { query: '?raw', import: 'default' }),
  ).map(([path, load]) => [path.replace(/^.*\/|\.replay\.json$/g, ''), load]),
);

/** The page's query, with the shooter camera and the cel look when it names neither. */
const search = new URLSearchParams(location.search);
if (!search.has('cam') && !search.has('cam3')) search.set('cam3', 'chase');
if (!search.has('post.look')) search.set('post.look', PLAYGROUND_LOOKS[0]);
createPlaygroundMenu(document, {
  scenes: sceneEntries,
  replays: Object.keys(replays),
  scene: search.get('scene') ?? '',
});

/** The camera member of the inspector (engine/app/viewMembers.ts). */
interface CameraMember {
  get(): { code: string };
  set(code: string): { code: string };
}

/** The started engine; null until `createEngine` resolves (its first frames are drawn before that). */
let engine: Engine | null = null;

/** The gym's signs, made on the first frame the gym draws; empty in other scenes. */
let signs: { label: Label; at: readonly number[] }[] = [];

/** The camera mode and look on screen, for the HUD. */
let showing = { camera: '', look: search.get('post.look') ?? '' };

/** The inspector's camera member; null before the engine starts. */
const camera = () => (engine?.inspector?.camera as CameraMember | undefined) ?? null;

/** Shows the signs near the player and the HUD's lines. */
function showFrame({ world, scene }: EngineFrame): void {
  const ui = engine?.ui;
  if (!ui) return;
  if (scene.id === gym.id && signs.length === 0) {
    signs = GYM_FEATURES.map((feature) => ({
      label: ui.label(feature.label, { at: feature.sign, id: `sign:${feature.id}` }),
      at: feature.sign,
    }));
  }
  const players = world.query('actor') as unknown as { actor: { player: boolean; x: number; z: number } }[];
  const player = players.find((entity) => entity.actor.player)?.actor;
  for (const sign of signs) {
    sign.label.visible = !player || Math.hypot(sign.at[0] - player.x, sign.at[2] - player.z) <= SIGN_RANGE;
  }
  if (!showing.camera) showing = { ...showing, camera: cameraMode(camera()?.get().code ?? '')?.name ?? 'custom' };
  const look = showing.look.replace(/^look:playground-/, '');
  ui.hud('mode', `Camera: ${showing.camera} · Look: ${look}`, { at: 'top-right' });
  const keys = 'WASD: move · Space: jump · Shift: sprint · Alt: walk · C: crouch · Click: mouse look · T: camera · P: look · M: menu'; // prettier-ignore
  ui.hud('keys', keys, { at: 'bottom', keys: true });
}

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
engine = await createEngine({
  canvas,
  actionMap: PLAYGROUND_ACTION_MAP,
  scenes: sceneEntries.map((entry) => entry.id),
  levels,
  replays,
  search: `?${search}`,
  onFrame: showFrame,
});

addEventListener('keydown', (event) => {
  const inspector = engine?.inspector;
  if (!inspector || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.code === CAMERA_KEY && camera()) {
    const code = camera()!.set(nextCamera(camera()!.get().code)).code;
    showing = { ...showing, camera: cameraMode(code)?.name ?? 'custom' };
    if (!LOOKING.has(showing.camera) && document.pointerLockElement) document.exitPointerLock();
  } else if (event.code === LOOK_KEY) {
    const look = nextLook(showing.look);
    inspector.set('post.look', look);
    showing = { ...showing, look };
  }
});

canvas.addEventListener('click', () => {
  if (LOOKING.has(showing.camera) && document.pointerLockElement !== canvas) {
    void Promise.resolve(canvas.requestPointerLock()).catch(() => undefined); // refused: the cursor stays
  }
});
