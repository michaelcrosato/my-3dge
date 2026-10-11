/**
 * @file The Stress Box page (labs/box/index.html, PLAN.md §9.0): it imports the box's scenes and levels, then starts
 * the engine (`createEngine`, engine/app/engine.ts) on the scene `?scene` names (`room` by default), with the box's
 * replays offered to `?replay=<name>`. Everything else a page does (routes, the renderer, the warm-up, the frame
 * loop, `window.__engine`, the error overlay) is the engine's, so this file stays a list of the box's content.
 *
 * Every module under `labs/box/scenes/` is imported, so a scene added there (`node x new scene
 * labs/box/scenes/<name>`) opens at `?scene=<name>` with no change here. Levels come in as text through Vite's `?raw`
 * (never a fetch, PLAN.md §6.3); the engine registers them.
 *
 * Game code: it imports only the engine's public API (engine/index.ts) and the box's own files.
 *
 * @example
 * // http://127.0.0.1:5173/labs/box/?scene=room&cam=topdown&box.room.speed=3
 * // node x shot labs/box --scene room --cam iso
 */
/// <reference types="vite/client" />
import { createEngine } from '../../engine';
import roomLevel from './levels/room.txt?raw';
import { room } from './scenes/room';

/** The box's levels, by id, as text: the engine registers them. */
const levels = { 'level:room': { text: roomLevel, file: 'labs/box/levels/room.txt' } };

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

await createEngine({ canvas: document.querySelector<HTMLCanvasElement>('#view')!, scenes, levels, replays });
