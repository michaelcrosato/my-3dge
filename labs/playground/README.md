# The Playground

my-3dge's second integration target (PLAN.md Phase 13, ADR-0025), designed in `docs/PLAYGROUND.md`: the place where
the character, the cameras and the looks are made to move, feel and look right, and where everything a player can do
in the engine is shown. It grows in four stages, each ending at a gate: the gym (G10), the house (G11), a living site
(G12) and the tech demo (G13). Today it holds the gym: calibrated features as a physics level, the player at its
north end with Apex Legends' gravity, jump height and run speed, five camera modes and two looks, cel-shaded and pixel
art. Every claim below is checked by `tests/unit/playground-readme.test.ts`: a setting, file or command named here
that does not exist fails it.

## Play it

1. Run `npm run dev` (on Node 24, which `scripts/setup.sh` installs), then open
   http://127.0.0.1:5173/labs/playground/. If another program holds port 5173, `PORT=5174 npm run dev` serves it on
   5174 instead.
2. Click the game to look around with the mouse (Esc lets go of it). WASD or the arrows move, Space jumps, Shift
   dashes.
3. T steps through the five cameras, P switches between the cel and the pixel look, M shows and hides the menu.

A link can open any of them: `labs/playground/?cam3=first&post.look=look:playground-pixel` is first person in the
pixel look, and `labs/playground/?replay=playground-gym` plays the recorded run, then hands you the controls.

## The demo index

Every scene, what it proves, and the command that shows it; each scene opens at `labs/playground/?scene=<name>`. A
test (`tests/unit/playground-readme.test.ts`) fails when a scene of `labs/playground/scenes/` is missing here, or a
`playground.*` setting from the settings below.

| Scene | What it proves | The command that shows it |
|---|---|---|
| `labs/playground/scenes/gym.ts` | The gym (`playground:gym`): every feature at the height, slope or gap its sign shows, the player running and jumping by Apex's numbers, its golden replay the same in Node and in the page while it renders, in either look, with no pipeline built after the warm-up. | `node x replay tests/replays/playground-gym.replay.json --browser page` |

## The gym

`labs/playground/levels/gym.ts` holds the features as data and writes the level from them, 40 × 100 m at 0.5 m tiles
inside a 3 m wall, so a feature's number, its block and its sign never disagree (`docs/PLAYGROUND.md` §2.3 says why each
is there). From the north end, where the player starts: a strip down the west side marked every 5 m; mantle walls from
0.5 to 2.1 m; fences from 0.6 to 1.2 m; climb walls from 3 to 7.2 m; slide ramps of 5°, 10°, 20° and 30°, 12 m long,
each with a deck at its top; steps of 0.25 m; slope tests of 45° and 51°; a 6 m tower; and, down the east side, a
lane of 1.5 m platforms across gaps from 2 to 9 m. A sign floats over each feature, shown when the player is near.

## Cameras and looks

| Mode | Code | What it is now |
|---|---|---|
| Third-person shooter (the default) | `cam3=chase` | behind the player on a spring arm that stays in front of the walls |
| First person | `cam3=first` | through the player's eyes; the body hidden but the hands |
| Third-person platformer | `cam3=orbit` | round the player |
| Isometric | `cam=iso` | orthographic, 45° round and 30° down |
| Top-down | `cam=topdown` | looking down, the classic top-down view |

T steps through them in this order; `labs/playground/views.ts` lists them and `__engine.camera.set('cam=iso')` sets
one. WP 13.8 gives each mode its own rig (docs/PLAYGROUND.md §4).

The looks (`labs/playground/looks/`): `look:playground-cel` (the default: three bands of daylight with a rim, every
edge inked) and `look:playground-pixel` (the same light cut into 3-pixel blocks with a dark rim, 24 shades a channel,
lightly dithered). P switches them; `?post.look=look:playground-pixel` opens one. Looks and cameras are view
settings: they never change play or a hash.

## Controls

| Action | Keys and mouse | Pad |
|---|---|---|
| Move | W A S D, or the arrows | left stick, d-pad |
| Jump | Space | A (south) |
| Dash | Shift, or K | B (east), left trigger |
| Look around | click the game, then the mouse; Esc lets go | right stick |
| Camera mode | T | |
| Cel or pixel look | P | |
| Zoom | the wheel | |
| The menu | M | |

The menu for humans (`labs/playground/menu.ts`) lists the scenes, cameras, looks, replays and these controls, read
from the action map the page binds (`actionMap:thirdPerson`, until WP 13.9 gives the playground Apex's). A browser
that automation drives (the tests, every `x` command that opens the page) gets no menu, so no test's screenshot holds
it; `?playground.menu=on` shows it there.

## Settings

| Setting | What it tunes |
|---|---|
| `playground.gym.speed` | The player's run speed in the gym, m/s (4.41, Apex's run with a weapon out), when the scene starts. Changes play: recorded in replays. |
| `playground.gym.jump` | How high the player jumps in the gym, m (1.42, Apex's), when the scene starts. Changes play: recorded in replays. |
| `playground.menu` | The page's menu for humans: `auto` shows it unless automation drives the browser, `on` and `off` force it, when the page opens. A view setting. |
| `post.look` | The look drawn (`look:playground-cel` by default). A view setting: never in the hash. |
| `quality` | The quality tier: `auto`, `high`, `medium` or `low`. A view setting. |
| `time.scale` | Sim seconds per real second (1). A view setting. |

Set one with `node x set playground.gym.speed 6`, as a URL parameter (`labs/playground/?playground.gym.speed=6`), or
with `__engine.set('playground.gym.speed', 6)`.

## The quick loop

1. Run the gym headless: `node x sim labs/playground/scenes/gym --steps 600 --feel` (how the player handles), with
   `--set playground.gym.speed=6` to try a number. Its replay, `out/sim/playground-gym/run.replay.json`, has empty
   inputs to edit (tests/replays/README.md, "Coordinates and inputs").
2. See it as numbers: `node x shot labs/playground --scene gym --cam iso` (the ID pass and the look metrics; `--png`
   for a picture).
3. Prove play: `node x replay tests/replays/playground-gym.replay.json --browser page`.
4. Keep a page open: `node x inspect --page labs/playground --scene gym`, then `node x eval "__engine.hash()"`.
5. Commit with the page's suite green: `npm run e2e -- tests/e2e/playground.spec.ts`.
