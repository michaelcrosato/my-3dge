# The starter game

Every game made with my-3dge starts as this one (`node tools/game/new-game.mjs`), then becomes its own: rewrite this
page as the game grows. It is the game's page for the owner and the next agent: what the game is, how it plays, how to
see it, and the calls made along the way.

## The game

Run round the arena collecting every gem before the clock runs out. WASD or the arrows run, Space jumps (over the low
walls), Shift dashes. All the gems: won. The clock at 0: lost. Enter starts a new round on the next seed.

## Files

| File                              | What it is                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------- |
| labs/game/scenes/play.ts          | The rules, sim-side: the arena's text, the settings, the gems, the round, the systems |
| labs/game/cast/player.ts          | The player: its character (run, jump, dash) and the body it is drawn as        |
| labs/game/bot.ts                  | The bot: plays through intents, down the flow field to the nearest gem         |
| labs/game/main.ts, index.html     | The page: the engine, the HUD, Enter to play again, the chase camera           |
| labs/game/scenes/play.test.ts     | The tests: the golden replay, capture and restore, the bot wins on 10 seeds, the clock |
| labs/game/replays/bot.replay.json | The bot's play from seed 1, with its golden hashes                             |

## Settings

`game.gems` (10), `game.seconds` (30) and `game.speed` (6 m/s), read when the round starts: `?game.gems=20` in the
page, `--set game.gems=20` for `node x sim` and `node x shot`.

## See it

```sh
npm run dev                                         # http://127.0.0.1:5173/labs/game/ (?replay=bot plays the bot's run)
npm test                                            # the tests
node x sim labs/game/scenes/play.ts --feel          # the rules in Node: hash, events, how the player handles
node x shot labs/game                               # the page on WebGPU, as numbers
node x replay labs/game/replays --browser sim       # the goldens, in Node and Chromium
```

## Decisions

<!-- The calls made without the owner, newest first: the date, what was decided, why. -->
