/**
 * @file The starter game's tests (labs/game/scenes/play.ts): what every game made from it starts with, and keeps as it
 * grows. They run headless in Node (`npm test`), in a few seconds:
 * - its golden replay (labs/game/replays/bot.replay.json, the bot's play) gives its golden hashes, as `x replay`
 *   checks it: on another platform than the one that recorded them, two runs agree instead;
 * - a run continues exactly after a capture and a restore;
 * - the bot (labs/game/bot.ts) wins on 10 seeds, so the game can be won, however the gems fall;
 * - the clock runs out on a player who stands still, and the settings change play;
 * - two actors that reach a gem in the same step take it once.
 *
 * When the game's play changes on purpose, record the goldens again: `node x replay labs/game/replays/bot.replay.json
 * --browser sim --update` (in Node and Chromium), and say why in the commit.
 * @see labs/game/scenes/play.ts
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createHeadless } from '../../../engine';
import { defineScene, type World } from '../../../engine/sim-api';
import { botIntents, playBot, roundOf, viewOf } from '../bot';
import { spawnPlayer } from '../cast/player';
import { play, type GameComponents } from './play';

/** The golden replay: the bot's play from seed 1, with the goldens `x replay --update` recorded. */
const REPLAY = readFileSync(new URL('../replays/bot.replay.json', import.meta.url), 'utf8');

/** This platform's golden key, as replays write it. */
const PLATFORM = `${process.platform}-${process.arch}`;

/** Plays `text` from step 0 in a fresh engine and returns its hashes at the replay's checkpoints. */
async function replayed(text: string): Promise<Record<string, string>> {
  const engine = await createHeadless({ scene: play });
  const result = await (engine.replay as (text: string) => Promise<{ hashes: Record<string, string> }>)(text);
  return result.hashes;
}

describe('game:play', () => {
  it('replays the bot’s play to its golden hashes', async () => {
    const goldens = (JSON.parse(REPLAY) as { hashes: Record<string, Record<string, string>> }).hashes;
    const first = await replayed(REPLAY);
    if (goldens[PLATFORM]) expect(first).toEqual(goldens[PLATFORM]);
    else expect(await replayed(REPLAY)).toEqual(first); // recorded elsewhere: the runs agree, as x replay judges it
  });

  it('continues exactly after a capture and a restore', async () => {
    const engine = await createHeadless({ scene: play, seed: 4 });
    for (let k = 0; k < 120; k++) engine.step(1, botIntents(viewOf(engine)));
    const capture = engine.capture();
    for (let k = 0; k < 120; k++) engine.step(1, botIntents(viewOf(engine)));
    const straight = engine.hash();
    engine.restore(capture);
    for (let k = 0; k < 120; k++) engine.step(1, botIntents(viewOf(engine)));
    expect(engine.hash()).toBe(straight);
  });

  it('is won by the bot on 10 seeds', async () => {
    for (let seed = 1; seed <= 10; seed++) {
      const engine = await createHeadless({ scene: play, seed });
      expect({ seed, ...playBot(engine) }).toMatchObject({ seed, state: 'won' });
      expect(roundOf(engine).collected).toBe(roundOf(engine).gems);
    }
  });

  it('is lost when the clock runs out, and its settings change play', async () => {
    const engine = await createHeadless({ scene: play, settings: { 'game.seconds': 5, 'game.gems': 3 } });
    engine.step(5 * 60);
    expect(roundOf(engine)).toMatchObject({ gems: 3, collected: 0, left: 0, state: 'lost' });
    expect(viewOf(engine).gems).toHaveLength(3);
  });

  it('counts a gem once when two actors reach it in the same step', async () => {
    const twin = defineScene<GameComponents>('game:twin', {
      description: 'The starter, and two more players put on its gem in the first step: both reach it in the next.',
      level: 'level:arena',
      physics: true,
      setup(w) {
        play.setup(w);
        const twins = (world: World<GameComponents>) => {
          if ([...world.query('actor')].length > 1) return;
          const [{ gem }] = world.query('gem');
          for (const dx of [-0.3, 0.3]) spawnPlayer(world, [gem.x + dx, 0, gem.z], 6);
        };
        w.systems.add('test.twins', twins, { phase: 'rules' });
      },
    });
    const engine = await createHeadless({ scene: twin, settings: { 'game.gems': 1 } }); // no neighbour within reach
    engine.step(2);
    expect([roundOf(engine).collected, roundOf(engine).state, engine.state('gem').entities.length]).toEqual([1, 'won', 0]); // prettier-ignore
  });
});
