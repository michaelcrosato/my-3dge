/**
 * @file The starter game's bot: game code that plays `game:play` (labs/game/scenes/play.ts) through intents, the way
 * a player's keys do, so a test or an agent plays the game with nobody at the keys. Each step it reads what a player
 * would see (`viewOf`: the player's feet and the gems left) and answers with the step's intents (`botIntents`: run
 * down the arena's flow field to the nearest gem, round the pillars and the low walls).
 *
 * The bot never reaches into the sim: it reads the engine's inspector (`state`) and writes intents through `step`, so
 * what it plays is recorded like a person's play, and `input.record()` turns it into a replay
 * (labs/game/replays/bot.replay.json). A game keeps its bot as the game grows: the tests ask it to win
 * (labs/game/scenes/play.test.ts), which proves the game can be won, on every seed they try.
 *
 * Game code, page-side: it imports only engine/index.ts and the game's own modules.
 *
 * @example
 * // import { createHeadless } from '../../engine';
 * // const engine = await createHeadless({ scene: play, seed: 3 });
 * // const end = playBot(engine); // { state: 'won', steps: 1234 }
 * botIntents({ player: { x: 3.5, z: 2.5 }, gems: [{ x: 3.5, z: 9.5 }] }).move; // [0, 1]: south, toward the gem
 * @see labs/game/scenes/play.test.ts
 */
import { NavGrid, type Headless, type Intents } from '../../engine';
import { ARENA, type Round } from './scenes/play';

/** A point on the ground, m: x east, z south. */
export interface GroundSpot {
  x: number;
  z: number;
}

/** What the bot sees each step: the player's feet and the gems left. */
export interface BotView {
  player: GroundSpot;
  gems: readonly GroundSpot[];
}

/** The arena's walkable grid: the flow fields the bot follows go round its pillars and low walls. */
const GRID = new NavGrid(ARENA);

/** How many headings the bot steers by: few, so its intents change seldom and its replays stay short. */
export const HEADINGS = 16;

/** The intents for one step: run toward the nearest gem by walking distance; none when no gem is left. */
export function botIntents(view: BotView): Intents {
  if (view.gems.length === 0) return {};
  const goals = [...new Set(view.gems.map((gem) => GRID.nearestOpen(gem.x, gem.z)))].filter((tile) => tile >= 0);
  const way = goals.length > 0 ? GRID.flowField(goals).direction(view.player.x, view.player.z) : null;
  if (way) return { move: heading(way.x, way.z) };
  // On a gem's tile (or nowhere the field leads): straight at the nearest gem.
  const near = [...view.gems].sort((a, b) => distance(view.player, a) - distance(view.player, b))[0];
  const d = distance(view.player, near);
  return d < 1e-6 ? {} : { move: heading(near.x - view.player.x, near.z - view.player.z) };
}

/** The nearest of the `HEADINGS` directions to (x, z), as `move` takes it: two decimals cut toward 0, never past 1. */
function heading(x: number, z: number): [number, number] {
  const step = (2 * Math.PI) / HEADINGS;
  const angle = Math.round(Math.atan2(x, z) / step) * step;
  return [Math.trunc(Math.sin(angle) * 100) / 100 || 0, Math.trunc(Math.cos(angle) * 100) / 100 || 0];
}

/** The distance between two spots on the ground, m. */
function distance(a: GroundSpot, b: GroundSpot): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/** What the bot sees in a running engine: the player's feet and the gems left, read through the inspector. */
export function viewOf(engine: Headless): BotView {
  const [player] = engine.state('actor').entities as unknown as { actor: GroundSpot }[];
  const gems = (engine.state('gem').entities as unknown as { gem: GroundSpot }[]).map(({ gem }) => ({
    x: gem.x,
    z: gem.z,
  }));
  return { player: { x: player.actor.x, z: player.actor.z }, gems };
}

/** The round as it stands, read through the inspector. */
export function roundOf(engine: Headless): Round {
  const [entity] = engine.state('round').entities as unknown as { round: Round }[];
  return entity.round;
}

/** Plays the bot until the round ends or `limit` steps pass; returns how the round stands and the steps it took. */
export function playBot(engine: Headless, limit = 60 * 600): { state: Round['state']; steps: number } {
  let steps = 0;
  while (roundOf(engine).state === 'playing' && steps < limit) {
    engine.step(1, botIntents(viewOf(engine)));
    steps += 1;
  }
  return { state: roundOf(engine).state, steps };
}
