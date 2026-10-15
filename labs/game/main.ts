/**
 * @file The starter game's page (labs/game/index.html): it starts the engine (`createEngine`, engine/app/engine.ts) on
 * the scene `game:play` (labs/game/scenes/play.ts) with the arena's text registered for the view, offers the bot's
 * replay to `?replay=bot`, and shows the round each drawn frame in the HTML/CSS overlay's HUD: the gems, the clock,
 * the controls and, when the round ends, how it ended. Enter then starts a new round on the next seed. The camera
 * is the chase camera unless the URL names one (`?cam=iso`, `?cam3=orbit`).
 *
 * Everything else a page does (routes, the renderer, the frame loop, the devices, `window.__engine`, the error
 * overlay, the touch controls) is the engine's, so this file is the game's own presentation only. It reads the run
 * and never changes it: the HUD cannot change the hash.
 *
 * Game code: it imports only the engine's public API (engine/index.ts) and the game's own files.
 *
 * Open it at http://127.0.0.1:5173/labs/game/ (`npm run dev`): `?seed=7&game.gems=20` plays another round,
 * `?replay=bot` the bot's, `?cam=iso` another camera. Headless, `node x shot labs/game` reports what it draws.
 */
/// <reference types="vite/client" />
import { createEngine, type Engine, type EngineFrame } from '../../engine';
import { ARENA_TEXT, play, type Round } from './scenes/play';

/** The page's query, with the chase camera when it names none: it follows the player round the arena. */
const search = new URLSearchParams(location.search);
if (!search.has('cam') && !search.has('cam3')) search.set('cam3', 'chase');

/** The game's replays, by name (`?replay=bot`), as text loaded on demand. */
const replays = { bot: () => import('./replays/bot.replay.json?raw').then((module) => module.default) };

/** The started engine; null until `createEngine` resolves (its first frames are drawn before that). */
let engine: Engine | null = null;

/** Whether the round on screen has ended, so Enter starts the next. */
let ended = false;

/** Shows the round in the HUD: the gems, the clock, the controls, and how the round ended. */
function showRound({ world }: EngineFrame): void {
  const ui = engine?.ui;
  const entity = world.query('round')[0] as unknown as { round: Round } | undefined;
  if (!ui || !entity) return;
  const { gems, collected, left, state } = entity.round;
  ui.hud('gems', `Gems ${collected} / ${gems}`, { at: 'top-left' });
  ui.hud('clock', `${Math.ceil(left / world.hz)} s`, { at: 'top-right', color: left < 10 * world.hz ? '#ff8f6b' : '' });
  ui.hud('keys', 'WASD: run · Space: jump · Shift: dash', { at: 'bottom', keys: true });
  ended = state !== 'playing';
  const end = state === 'won' ? 'Every gem! Enter: play again' : 'Time! Enter: play again';
  ui.hud('end', ended ? end : null, { at: 'top' });
}

engine = await createEngine({
  canvas: document.querySelector<HTMLCanvasElement>('#view')!,
  scenes: [play.id],
  levels: { 'level:arena': { text: ARENA_TEXT, file: 'labs/game/scenes/play.ts' } },
  replays,
  search: `?${search}`,
  onFrame: showRound,
});

addEventListener('keydown', (event) => {
  const inspector = engine?.inspector;
  if (event.code === 'Enter' && ended && inspector) inspector.seed(inspector.seed() + 1);
});
