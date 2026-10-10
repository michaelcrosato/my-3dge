/**
 * @file The Stress Box page (labs/box/index.html, PLAN.md §9.0): it registers the box's levels and scenes, then
 * starts the engine (`createEngine`, engine/app/engine.ts) on the scene `?scene` names (`room` by default), with the
 * box's replays offered to `?replay=<name>`. Everything else a page does (routes, the renderer, the warm-up, the
 * frame loop, `window.__engine`, the error overlay) is the engine's, so this file stays a list of the box's content.
 *
 * Game code: it imports only the engine's public API (engine/index.ts) and the box's own files. Levels come in as
 * text through Vite's `?raw` (never a fetch, PLAN.md §6.3), and the scenes register themselves when imported.
 *
 * @example
 * // http://127.0.0.1:5173/labs/box/?scene=room&cam=topdown&box.room.speed=3
 * // node x shot labs/box --scene room --cam iso
 */
/// <reference types="vite/client" />
import { createEngine, defineLevel } from '../../engine';
import roomLevel from './levels/room.txt?raw';
import { room } from './scenes/room';

defineLevel('level:room', { text: roomLevel, file: 'labs/box/levels/room.txt' });

/** The box's replays, by name (`box-1-room`), as text loaded on demand. */
const replays = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../../tests/replays/box-*.replay.json', { query: '?raw', import: 'default' }),
  ).map(([path, load]) => [path.replace(/^.*\/|\.replay\.json$/g, ''), load]),
);

await createEngine({ canvas: document.querySelector<HTMLCanvasElement>('#view')!, scenes: [room.id], replays });
