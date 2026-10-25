/**
 * @file The starter game's page (labs/game/index.html): it starts the engine (`createEngine`, engine/app/engine.ts) on
 * the scene `game:play` (labs/game/scenes/play.ts) with the arena's text registered for the view, offers the bot's
 * replay to `?replay=bot`, and shows the round each drawn frame in the HTML/CSS overlay's HUD: the gems, the clock,
 * the controls, the best round kept across sessions (labs/game/best.ts, through the engine's store) and, when the
 * round ends, how it ended. Enter then starts a new round on the next seed. Escape (or the pad's Start) pauses the
 * round under a menu (`createMenu`: Resume, New round), which keeps its keys out of play while it is open
 * (`createEngine({ modal })`); the store keeps the best round and any keys rebound (`createEngine({ store })`). The
 * camera is the chase camera unless the URL names one (`?cam=iso`, `?cam3=orbit`).
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
import { createEngine, createMenu, createStore, type Engine, type EngineFrame, type Menu } from '../../engine';
import { bestOf, recordBest } from './best';
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

/** The game's store: its best round across sessions; a replay's page plays in its demo mode, so it sets none. */
const store = createStore({ prefix: 'my3dge-game:', mode: search.has('replay') ? 'demo' : 'play' });

/** The fastest won round kept (s), and the run whose clock the page saw running, with the steps it started with. */
let best = bestOf(store);
let seen: { world: object; steps: number } | null = null;

/** The pause menu while it is open; null while the round plays. */
let paused: Menu | null = null;

/** Opens the pause menu over the paused round, or reads it a frame: Resume (or Escape again), New round. */
function pauseMenu(dt: number): void {
  const [inspector, ui, input] = [engine?.inspector, engine?.ui, engine?.input];
  if (!inspector || !ui || !input) return;
  const close = () => {
    paused?.remove();
    paused = null;
    inspector.resume();
  };
  if (paused) return void paused.update(dt);
  if (!input.pressed('pause')) return;
  inspector.pause();
  const items = [
    { label: 'Resume', id: 'resume' },
    { label: 'New round', id: 'new' },
  ];
  paused = createMenu(ui.root, items, { input, id: 'pause', title: 'Paused', onCancel: close, onPick: (_i, item) => {
    if (typeof item === 'object' && item.id === 'new') inspector.seed(inspector.seed() + 1);
    close();
  } }); // prettier-ignore
}

/** Shows the round in the HUD: the gems, the clock, the controls, and how the round ended. */
function showRound({ world }: EngineFrame): void {
  const ui = engine?.ui;
  const entity = world.query('round')[0] as unknown as { round: Round } | undefined;
  if (!ui || !entity) return;
  const { gems, collected, left, state } = entity.round;
  if (seen?.world !== world) seen = state === 'playing' ? { world, steps: left + world.tick } : null;
  const was = ended;
  ui.hud('gems', `Gems ${collected} / ${gems}`, { at: 'top-left' });
  ui.hud('clock', `${Math.ceil(left / world.hz)} s`, { at: 'top-right', color: left < 10 * world.hz ? '#ff8f6b' : '' });
  ui.hud('keys', 'WASD: run · Space: jump · Shift: dash · Esc: pause', { at: 'bottom', keys: true });
  ended = state !== 'playing';
  if (ended && !was && state === 'won' && seen) best = recordBest(store, (seen.steps - left) / world.hz);
  ui.hud('best', best === null ? null : `Best ${best.toFixed(1)} s`, { at: 'top-left' });
  const end = state === 'won' ? 'Every gem! Enter: play again' : 'Time! Enter: play again';
  ui.hud('end', ended ? end : null, { at: 'top' });
}

engine = await createEngine({
  canvas: document.querySelector<HTMLCanvasElement>('#view')!,
  scenes: [play.id],
  levels: { 'level:arena': { text: ARENA_TEXT, file: 'labs/game/scenes/play.ts' } },
  replays,
  search: `?${search}`,
  store,
  modal: () => paused !== null,
  onFrame: (frame) => {
    pauseMenu(frame.dt);
    showRound(frame);
  },
});

addEventListener('keydown', (event) => {
  const inspector = engine?.inspector;
  if (event.code === 'Enter' && ended && inspector) inspector.seed(inspector.seed() + 1);
});
