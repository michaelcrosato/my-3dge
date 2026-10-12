/**
 * @file The Stress Box page (labs/box/index.html, PLAN.md §9.0): it imports every module under `labs/box/scenes/`, so
 * a scene added there opens at `?scene=<name>` with no change here, and the box's levels, then starts the engine
 * (`createEngine`, engine/app/engine.ts) on the scene `?scene` names (`room` by default), with the box's replays
 * offered to `?replay=<name>` and the box's touch layout (labs/box/touch.ts: attack, then jump, dash and the bolt) for
 * every scene. It also imports every module under `labs/box/looks/`, so each of the box's looks (`look:torch-lit`…)
 * opens at `?post.look=<id>`, and registers the hall with its material swap, so the hall's floor is its bake, its
 * runes glowing on the dais (labs/box/looks/hall-floor.ts). Its sound (labs/box/sounds/page.ts, `window.__boxSound`)
 * runs each drawn frame through `onFrame`: silent until the first key, click or end of a touch, then the sim's events
 * as sounds, the demo song and the torches. Clip mode (`?scene=clips`, labs/box/scenes/clips.ts) loads the animation
 * library first: every set under data/anim/sets/, as text (`import.meta.glob`, never a fetch), registered by
 * labs/box/library.ts; no other scene loads it.
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
import { room } from './scenes/room';
import { createBoxSound } from './sounds/page';
import { BOX_TOUCH } from './touch';

/** The box's levels, by id, as text: the engine registers them; the hall with its floor bake (HALL_MATERIALS). */
const levels = {
  'level:room': { text: roomLevel, file: 'labs/box/levels/room.txt' },
  'level:hall': { text: hallLevel, file: 'labs/box/levels/hall.txt', materials: HALL_MATERIALS },
};

/** The box's looks, each module imported now so its look registers: `?post.look=look:torch-lit` opens it. */
import.meta.glob(['./looks/*.ts', '!./looks/*.test.ts'], { eager: true });

/** Every box scene module, imported now so each registers its scene; the room comes first, the default. */
const modules = import.meta.glob<Record<string, unknown>>(['./scenes/*.ts', '!./scenes/*.test.ts'], { eager: true });
const scenes = [
  room.id,
  ...Object.values(modules)
    .flatMap((module) => Object.values(module))
    .filter((value): value is { kind: 'scene'; id: string } => (value as { kind?: unknown })?.kind === 'scene')
    .map((scene) => scene.id),
].filter((id, i, all) => all.indexOf(id) === i);

/** The box's replays, by name (`box-1-room`), as text loaded on demand. */
const replays = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../../tests/replays/box-*.replay.json', { query: '?raw', import: 'default' }),
  ).map(([path, load]) => [path.replace(/^.*\/|\.replay\.json$/g, ''), load]),
);

/** The animation library's files (data/anim/sets/<set>/*.json), as text loaded on demand: clip mode plays them. */
const libraryFiles = import.meta.glob<string>('../../data/anim/sets/*/*.json', { query: '?raw', import: 'default' });

// clip mode (labs/box/scenes/clips.ts) needs the library registered before it starts; the other scenes never load it
if (/^(box:)?clips$/.test(new URLSearchParams(location.search).get('scene') ?? '')) await loadLibrary(libraryFiles);

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const sound = createBoxSound();
await createEngine({ canvas, scenes, levels, replays, touchLayout: BOX_TOUCH, onFrame: sound.frame });
