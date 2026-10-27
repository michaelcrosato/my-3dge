/**
 * @file The Stress Box page (labs/box/index.html, PLAN.md §9.0): it imports every module under `labs/box/scenes/`, so
 * a scene added there opens at `?scene=<name>` with no change here, and the box's levels, then starts the engine
 * (`createEngine`, engine/app/engine.ts) on the scene `?scene` names (`room` by default), with the box's replays
 * offered to `?replay=<name>` and the box's touch layout (labs/box/touch.ts: attack, then jump, dash and the bolt) for
 * every scene. It also imports every module under `labs/box/looks/`, so each of the box's looks (`look:torch-lit`…)
 * opens at `?post.look=<id>`, and registers the hall with its material swap, so the hall's floor is its bake, its
 * runes glowing on the dais (labs/box/looks/hall-floor.ts). Its sound (labs/box/sounds/page.ts, `window.__boxSound`)
 * runs each drawn frame through `onFrame`: silent until the first key, click or end of a touch, then the sim's events
 * as sounds, the demo song and the torches. Clip mode (`?scene=clips`, or `?replay=` one of its replays,
 * labs/box/scenes/clips.ts) loads the animation library first: every set under data/anim/sets/, as text in one chunk
 * (labs/box/clipFiles.ts, never a fetch), registered by labs/box/library.ts; no other scene loads it.
 * Before the engine starts, the menu for humans (labs/box/menu.ts) lists those scenes, replays and looks, cameras and
 * the controls, so a person sees what the box offers while it loads, or after a bad route; automation never gets it.
 * Everything else a page does (routes, the renderer, the warm-up, the frame loop, `window.__engine`, the error overlay,
 * the touch layer) is the engine's, so this file stays a list of the box's content.
 *
 * A new scene comes from `node x new scene labs/box/scenes/<name>` (labs/box/README.md). Levels come in as text
 * through Vite's `?raw` (never a fetch, PLAN.md §6.3); the engine registers them.
 *
 * Game code: it imports only the engine's public API (engine/index.ts) and the box's own files.
 *
 * @example
 * // http://127.0.0.1:5173/labs/box/?scene=room&cam=topdown&box.room.speed=3
 * // http://127.0.0.1:5173/labs/box/?scene=room-hero&cam3=chase
 * // http://127.0.0.1:5173/labs/box/?scene=hall&cam3=chase
 * // http://127.0.0.1:5173/labs/box/?scene=fight&cam3=chase
 * // http://127.0.0.1:5173/labs/box/?scene=fight&cam3=chase&post.look=look:torch-toon
 * // http://127.0.0.1:5173/labs/box/?scene=clips&box.clips.clip=cmu/Cartwheel
 * // node x shot labs/box --scene room --cam iso
 */
/// <reference types="vite/client" />
import { createEngine } from '../../engine';
import hallLevel from './levels/hall.txt?raw';
import roomLevel from './levels/room.txt?raw';
import { loadLibrary } from './library';
import { HALL_MATERIALS } from './looks/hall-floor';
import { createBoxMenu, type MenuEntry } from './menu';
import { room } from './scenes/room';
import { createBoxSound } from './sounds/page';
import { BOX_TOUCH } from './touch';

/** The box's levels, by id, as text: the engine registers them; the hall with its floor bake (HALL_MATERIALS). */
const levels = {
  'level:room': { text: roomLevel, file: 'labs/box/levels/room.txt' },
  'level:hall': { text: hallLevel, file: 'labs/box/levels/hall.txt', materials: HALL_MATERIALS },
};

/** The entries of `kind` that `modules` export (scenes, looks), each once, in module order. */
function exported(modules: Record<string, Record<string, unknown>>, kind: string): (MenuEntry & { kind: string })[] {
  return Object.values(modules)
    .flatMap((module) => Object.values(module))
    .filter((value): value is MenuEntry & { kind: string } => (value as { kind?: unknown })?.kind === kind)
    .filter((entry, i, all) => all.findIndex((other) => other.id === entry.id) === i);
}

/** The box's looks, each module imported now so its look registers: `?post.look=look:torch-lit` opens it. */
const lookModules = import.meta.glob<Record<string, unknown>>(['./looks/*.ts', '!./looks/*.test.ts'], { eager: true });
const looks = exported(lookModules, 'look');

/** Every box scene module, imported now so each registers its scene; the room comes first, the default. */
const modules = import.meta.glob<Record<string, unknown>>(['./scenes/*.ts', '!./scenes/*.test.ts'], { eager: true });
const sceneEntries = exported({ room: { room }, ...modules }, 'scene');
const scenes = sceneEntries.map((entry) => entry.id);

/** The box's replays, by name (`box-1-room`, `ragdoll-falls`), as text loaded on demand. */
const replays = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>(['../../tests/replays/box-*.replay.json', '../../tests/replays/ragdoll-*.replay.json'], { query: '?raw', import: 'default' }), // prettier-ignore
  ).map(([path, load]) => [path.replace(/^.*\/|\.replay\.json$/g, ''), load]),
);

// clip mode (labs/box/scenes/clips.ts) needs the library registered before it starts; the other scenes never load it
const params = new URLSearchParams(location.search);
const named = params.get('replay') ?? '';
const replayScene = async () => (JSON.parse(await replays[named]()) as { scene: string }).scene; // ?replay alone
const scene = params.get('scene') ?? (Object.hasOwn(replays, named) ? await replayScene() : '');
createBoxMenu(document, { scenes: sceneEntries, looks, replays: Object.keys(replays), scene });
if (/^(box:)?clips$/.test(scene)) await loadLibrary((await import('./clipFiles')).CLIP_FILES); // the library's one chunk

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const sound = createBoxSound();
await createEngine({ canvas, scenes, levels, replays, touchLayout: BOX_TOUCH, onFrame: sound.frame });
