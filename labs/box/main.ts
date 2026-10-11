/**
 * @file The Stress Box page (labs/box/index.html, PLAN.md §9.0): it imports every module under `labs/box/scenes/`, so
 * a scene added there opens at `?scene=<name>` with no change here, and the box's levels, then starts the engine
 * (`createEngine`, engine/app/engine.ts) on the scene `?scene` names (`room` by default), with the box's replays
 * offered to `?replay=<name>` and the box's touch layout (labs/box/touch.ts: jump, then dash) for every scene.
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
 * // node x shot labs/box --scene room --cam iso
 */
/// <reference types="vite/client" />
import { createEngine } from '../../engine';
import hallLevel from './levels/hall.txt?raw';
import roomLevel from './levels/room.txt?raw';
import { room } from './scenes/room';
import { BOX_TOUCH } from './touch';

/** The box's levels, by id, as text: the engine registers them. */
const levels = {
  'level:room': { text: roomLevel, file: 'labs/box/levels/room.txt' },
  'level:hall': { text: hallLevel, file: 'labs/box/levels/hall.txt' },
};

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

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
await createEngine({ canvas, scenes, levels, replays, touchLayout: BOX_TOUCH });
