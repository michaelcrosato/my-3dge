/**
 * @file The starter game's scene `game:play`: every new game begins as this one (tools/game/new-game.mjs copies
 * labs/game/ into it), so it is small, plays, and shows the parts a game is made of. The player, a humanoid on the
 * character controller, runs round the arena (`ARENA_TEXT` below: walls, two pillars, two low walls to jump) collecting
 * the gems the seed scatters, before the clock runs out. All the gems: won; the clock at 0: lost.
 *
 * The parts: a level as text, compiled for its physics bodies; settings (`game.*`, read when the scene starts, so they
 * change play and go in replays); components (`gem`, drawn as a small glowing box because it declares `x` and `z` in
 * metres; `round`, the score and the clock); the player (labs/game/cast/player.ts, an actor that reads the step's
 * intents: `move`, `jump`, `dash`); systems in the phase `rules`, after the actors' feet are read back; a named random
 * stream (`gems`); events (`gem`, `won`, `lost`) that pages, sounds and tests hear. The page is labs/game/main.ts, the
 * bot labs/game/bot.ts.
 *
 * The level's text lives here, not in a .txt file, since sim-side code reads no files; the page registers the same
 * text for the view (labs/game/main.ts).
 *
 * Game code, sim-side: it imports only engine/sim-api.ts, so `node x sim labs/game/scenes/play.ts` runs it in Node.
 *
 * @example
 * // node x sim labs/game/scenes/play.ts --steps 600
 * // node x sim labs/game/scenes/play.ts --set game.gems=3 --seed 7
 * ARENA.spawns.find((spawn) => spawn.name === 'hero')?.position; // [3.5, 0, 2.5]
 * @see labs/game/scenes/play.test.ts
 */
import {
  addLevelBodies,
  compileLevel,
  defineComponent,
  defineScene,
  defineSettings,
  physicsOf,
  type ActorComponent,
  type World,
} from '../../../engine/sim-api';
import { spawnPlayer } from '../cast/player';

/** The arena: 18 × 14 m inside walls 3 m high, two 2 × 2 m pillars, two low walls (0.75 m) to jump, the spawn `@`. */
export const ARENA_TEXT = `---
description: The starter game's arena. 18 × 14 m inside walls 3 m high, two 2 × 2 m pillars, two low walls 0.75 m high that the player jumps, and the player's spawn.
---
##################
#................#
#..@.............#
#.......PP.......#
#.......PP.......#
#................#
#....w......w....#
#....w......w....#
#................#
#.......PP.......#
#.......PP.......#
#................#
#................#
##################
`;

/** The arena, compiled: its colliders for physics, its tiles for the gems and the bot's paths. */
export const ARENA = compileLevel(ARENA_TEXT, { file: 'labs/game/scenes/play.ts', name: 'arena' });

/** The game's settings: each is reachable through `x set`, URL parameters (`?game.gems=3`) and `__engine.set`. */
export const GAME_SETTINGS = defineSettings({
  'game.gems': {
    type: 'integer',
    default: 10,
    minimum: 1,
    maximum: 40,
    when: 'scene',
    description: 'How many gems the seed scatters.',
  },
  'game.seconds': {
    type: 'number',
    default: 30,
    minimum: 5,
    maximum: 600,
    unit: 's',
    when: 'scene',
    description: 'How long the player has to collect them all.',
  },
  'game.speed': {
    type: 'number',
    default: 6,
    minimum: 1,
    maximum: 20,
    unit: 'm/s',
    when: 'scene',
    description: 'How fast the player runs.',
  },
});

/** A gem: where it floats and how it looks (the page draws a component that declares x and z in metres). */
export const GEM = defineComponent('gem', {
  description: 'A gem to collect: where it floats, its spin and how it is drawn.',
  fields: {
    x: { type: 'number', default: 0, unit: 'm', description: 'East.' },
    y: { type: 'number', default: 0.5, unit: 'm', description: 'Up: the bottom of its box.' },
    z: { type: 'number', default: 0, unit: 'm', description: 'South.' },
    yaw: { type: 'number', default: 0, unit: 'rad', description: 'Its spin.' },
    size: { type: 'number', default: 0.4, unit: 'm', description: 'The side of its box.' },
    material: { type: 'string', default: 'material:glow', description: 'What it is drawn with.' },
  },
});

/** The round: the score, the clock and how it ended. One entity holds it. */
export const ROUND = defineComponent('round', {
  description:
    'The round: gems collected of the total, the steps left on the clock, and whether it is playing, won or lost.',
  fields: {
    gems: { type: 'integer', default: 0, description: 'How many gems the round scattered.' },
    collected: { type: 'integer', default: 0, description: 'How many the player has collected.' },
    left: { type: 'integer', default: 0, description: 'The sim steps left on the clock (60 a second).' },
    state: { type: 'string', default: 'playing', description: "'playing', 'won' or 'lost'." },
  },
});

/** The round, as the component holds it. */
export type Round = { gems: number; collected: number; left: number; state: 'playing' | 'won' | 'lost' };

/** The scene's components, typed. */
export type GameComponents = {
  gem: { x: number; y: number; z: number; yaw: number; size: number; material: string };
  round: Round;
  actor: ActorComponent;
};

/** How close the player's feet come to a gem to collect it, m (on the ground plane). */
export const REACH = 0.8;

/** How far from the spawn the gems keep, m, so the first one is never collected without moving. */
const CLEAR = 3;

/** Where the player starts: the level's spawn `@`. */
const START = ARENA.spawns.find((spawn) => spawn.name === 'hero')!.position;

/** The floor tiles a gem may float over: open floor (`.`), at least `CLEAR` metres from the spawn, in reading order. */
function gemTiles(): number[] {
  const tiles: number[] = [];
  ARENA.tiles.forEach((char, i) => {
    const x = ((i % ARENA.cols) + 0.5) * ARENA.tile;
    const z = (Math.floor(i / ARENA.cols) + 0.5) * ARENA.tile;
    if (char === '.' && Math.hypot(x - START[0], z - START[2]) >= CLEAR) tiles.push(i);
  });
  return tiles;
}

/** Scatters `count` gems over distinct floor tiles drawn from the stream `gems`: each seed lays them its own way. */
function scatterGems(w: World<GameComponents>, count: number): void {
  const tiles = gemTiles();
  const rng = w.rng('gems');
  for (let k = 0; k < count && tiles.length > 0; k++) {
    const [tile] = tiles.splice(rng.int(0, tiles.length - 1), 1);
    const x = ((tile % ARENA.cols) + 0.5) * ARENA.tile;
    const z = (Math.floor(tile / ARENA.cols) + 0.5) * ARENA.tile;
    w.spawn({ gem: { x, z, yaw: rng.range(0, Math.PI) } });
  }
}

/** Ends the round: the player stops reading intents (and so stands still), and the event says how it ended. */
function endRound(w: World<GameComponents>, round: Round, state: 'won' | 'lost'): void {
  round.state = state;
  for (const e of w.query('actor')) {
    e.actor.player = false;
    e.actor.intents = {};
  }
  w.emit(state, { collected: round.collected, gems: round.gems, left: round.left });
}

/**
 * Spins the gems, collects those an actor's feet reach, and ends the round when the last one goes. A despawn waits for
 * the end of the step, so a gem taken this step is remembered: two actors never count it twice.
 */
function collect(w: World<GameComponents>): void {
  const [{ round }] = w.query('round');
  for (const gem of w.query('gem')) gem.gem.yaw += 2 * w.dt;
  if (round.state !== 'playing') return;
  const taken = new Set<number>();
  for (const { actor } of w.query('actor')) {
    for (const gem of w.query('gem')) {
      if (taken.has(gem.id) || Math.hypot(gem.gem.x - actor.x, gem.gem.z - actor.z) > REACH) continue;
      taken.add(gem.id);
      w.despawn(gem.id);
      round.collected += 1;
      w.emit('gem', { id: gem.id, x: gem.gem.x, z: gem.gem.z, collected: round.collected });
    }
  }
  if (round.collected >= round.gems) endRound(w, round, 'won');
}

/** Runs the clock down a step at a time (game time is whole steps, never summed seconds); at 0 the round is lost. */
function clock(w: World<GameComponents>): void {
  const [{ round }] = w.query('round');
  if (round.state !== 'playing') return;
  round.left = Math.max(0, round.left - 1);
  if (round.left === 0) endRound(w, round, 'lost');
}

/** The starter game: collect every gem before the clock runs out. */
export const play = defineScene<GameComponents>('game:play', {
  description: 'The starter game: run round the arena collecting the gems before the clock runs out.',
  level: 'level:arena',
  physics: true,
  setup(w) {
    addLevelBodies(physicsOf(w), ARENA);
    const gems = w.settings.get<number>('game.gems');
    w.spawn({ round: { gems, left: Math.round(w.settings.get<number>('game.seconds') * w.hz) } });
    scatterGems(w, gems);
    spawnPlayer(w, [START[0], START[1], START[2]], w.settings.get<number>('game.speed'));
    w.systems.add('game.collect', collect, { phase: 'rules' });
    w.systems.add('game.clock', clock, { phase: 'rules' });
  },
});

export default play;
