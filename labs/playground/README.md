# The Playground

my-3dge's game and second integration target (PLAN.md Phase 13, ADR-0025), designed in `docs/PLAYGROUND.md`: one
block where everything a player can do in the engine is laid out to walk into and try, and where the character, the
cameras and the looks are made to move, feel and look right. The block (`playground:site`, WP 13.18) is the game: the
house of four storeys with its garage and yards, the street with its neighbours and the dog, the gym (calibrated
features: mantle walls, climbs, slides, gaps, a ladder, a zipline, the balloon and the launchers), the hill and its
lookout, the range with the pistol and the rifle (WP 13.20) and the ring's dummies to strike (WP 13.19), furnished and
lit, its doors, windows, switches and chairs to use (WP 13.16). The player moves by Apex Legends' numbers (the run and
sprint, air strafing, the crouch and the slide, the mantle, the wall-climb, the superglide), seen through five camera
modes and three looks, clean, cel-shaded and pixel art. Every claim below is checked by
`tests/unit/playground-readme.test.ts`: a setting, file or command named here that does not exist fails it.

## Play it

1. Open `playground.html` (the whole playground in one file: double-click it), or run `npm run dev` (on Node 24,
   which `scripts/setup.sh` installs) and open http://127.0.0.1:5173/labs/playground/ (`PORT=5174 npm run dev` when
   5173 is taken).
2. The splash screen shows while the block loads (`labs/playground/ui/splash.ts`); press any key for the start menu
   (`labs/playground/ui/frontEnd.ts`): Play, Go to (any area of the block or room of the house), Settings, Controls,
   Photo mode, Watch the tour, Owner checks and Tools (the Tune panel for the look's filters, the recorded runs, the
   feel panel). Esc pauses, with the same screens, Restart and Main menu.
3. Play: click the game to look around with the mouse. As you walk into an area, a card names it and what to try
   there (`labs/playground/ui/areas.ts`); the top-left names where you are. H shows every control with its key
   (`labs/playground/ui/help.ts`) and M is Go to. The essentials: WASD moves, Space jumps (and mantles and climbs),
   Shift sprints, C crouches (a slide at a sprint), E uses what the HUD names (a door, a switch, a zipline, a ladder,
   a chair to throw), V strikes, 1 and 2 draw the pistol and the rifle, the left button fires and the right aims; T
   steps through the cameras and P through the looks. Settings rebinds any key in every camera at once; the settings
   and keys are kept for the next visit.
4. Owner checks (`labs/playground/ui/checks.ts`, WP 13.28) list what only the owner can judge: the playtest of
   `docs/PLAYGROUND.md` §9.3, and the calls agents made in the owner's absence. Each says in plain words what to try
   and what to judge; Go there opens it at its spot (`playground.check`); Esc, then Answer this check, takes a verdict
   and a note; Copy my answers gives the text to paste back to an agent.

A link can open any of them: `labs/playground/?cam3=first&post.look=look:playground-pixel` is first person in the
pixel look, `labs/playground/?playground.spawn=area:range` starts at the range, and
`labs/playground/?replay=playground-gym` plays a recorded run (`?replay=playground-moves` the moves,
`?replay=playground-rides` the rides, `?replay=playground-site` the house's doors, lights, windows and garage,
`?replay=playground-melee` the shed's door kicked in and the ring's dummies punched and kicked, `?replay=playground-range`
the range's targets shot down with the pistol and the rifle), then hands you the controls; Tools, then Recorded runs,
lists them. `labs/playground/?replay=playground-tour&playground.attract=on` is the tour (`labs/playground/tour.ts`):
those runs in turn on the block, with the view stepping through the five cameras and the looks; the start menu's Watch
the tour opens it, and an idle start menu does after a minute.

## The demo index

The block is the game; the scenes below are what the tests, the replays and the x commands open, each at
`labs/playground/?scene=<name>`: the gym and the hill alone, as calibrated courses, and the block started at each of its
areas. Every scene, what it proves, and the command that shows it. A test (`tests/unit/playground-readme.test.ts`) fails when a scene of `labs/playground/scenes/` is missing here, or a
`playground.*` setting from the settings below.

| Scene | What it proves | The command that shows it |
|---|---|---|
| `labs/playground/scenes/gym.ts` | The gym (`playground:gym`): every feature at the height, slope or gap its sign shows, the player moving by Apex's model (`node x sim labs/playground/scenes/gym --feel` prints its numbers), its golden replays the same in Node and in the page while it renders, in either look, with no pipeline built after the warm-up: the gym's run over its features, its moves (`tests/replays/playground-moves.replay.json`: the sprint held and kept by a press, a tired hop, the walk, the crouch-walk, a lurch, an air strafe, the bunny hop's cost, a slide and a slide-jump), its climbs (`tests/replays/playground-climb.replay.json`) and its rides (`tests/replays/playground-rides.replay.json`: up the tower's ladder and over its top, down its zipline, the jump pad, the balloon's line up 90 m, the glide, the dive and the landing). | `node x replay tests/replays/playground-gym.replay.json tests/replays/playground-moves.replay.json tests/replays/playground-rides.replay.json --browser page` |
| `labs/playground/scenes/hill.ts` | The hill (`playground:hill`): the block's ground as terrain (`terrain:block`, 96 × 96 m, rolling 0.6 m), the hill rising to 10 m in its east quarter in slopes up to 29°, turf over rock where it is steepest (`labs/playground/ground.ts`); the player runs, slides and falls on its slopes with his feet planted (`labs/playground/courses/hill.ts`), and its replay (`tests/replays/terrain-hill.replay.json`: up the flank, across it, down it in a slide gaining speed, back up) gives its goldens in Node and in the page while it renders. | `node x replay tests/replays/terrain-hill.replay.json --browser page` |
| `labs/playground/scenes/site.ts` | The block (`playground:site`, the player in the front yard, and a scene per area: `playground:site-house`, `playground:site-backyard`, `playground:site-street`, `playground:site-gym`, `playground:site-hill`, `playground:site-range` and `playground:site-ring`; `docs/PLAYGROUND.md` §2): one site (`site:block`, `labs/playground/levels/site.ts`), 96 × 113 m of terrain rising to the hill on its east edge, and on it the house of four storeys (`labs/playground/levels/house.ts`: a basement with its crawlspace, a ground floor with the garage and its deck, an upper floor, an attic under a gable up a ladder through a hatch), the yards with the shed and the tree house, the street, the gym as built, the lookout on the hill, the range and the ring, furnished and lit (`labs/playground/furnish.ts`). The bot reaches every room and area from the front yard and back, and over its tour of the house no camera stands in a wall; isometric and top-down hide what stands above the player's storey and the roof indoors, and the HUD names the room; its replay (`tests/replays/playground-site.replay.json`: the front door used, a light turned off and on, a chair thrown through a window, the garage door on its switch, a door kicked open and off its hinges) gives its goldens in Node and in the page while it renders. At the ring, melee (WP 13.19): its three sparring dummies (`labs/playground/cast/dummies.ts`) rock away from each blow and spring back, its two sparring partners (`labs/playground/cast/partners.ts`, WP 10.2) flinch at a punch and fall as ragdolls at a kick or the uppercut, getting up the way they lie, and its replay (`tests/replays/playground-melee.replay.json`: the shed's door kicked open and off its hinges, the dummies punched, kicked from a jump and uppercut from a slide) gives its goldens too. At the range, firearms (WP 13.20): the player draws the pistol and the rifle (`labs/playground/weapons/guns.ts`), its pop-up and moving targets (`labs/playground/weapons/range.ts`) fall at a hit and stand again, the HUD counts the hits and the accuracy, and its replay (`tests/replays/playground-range.replay.json`: each lane's targets shot down the sights and from the hip, a burst climbing, a reload) gives its goldens while the page renders it in every camera; the range's course (`node x feel labs/playground --course range`) keeps the muzzle within 2° of the aim. | `node x replay tests/replays/playground-site.replay.json --browser page`, `node x replay tests/replays/playground-melee.replay.json --browser page`, `node x replay tests/replays/playground-range.replay.json --browser page` and `npm run e2e -- tests/e2e/playground-cameras.spec.ts` |

## The gym

`labs/playground/levels/gym.ts` holds the features as data and writes the level from them, 40 × 100 m at 0.5 m tiles
inside a 3 m wall, so a feature's number, its block and its sign never disagree (`docs/PLAYGROUND.md` §2.3 says why each
is there). From the north end, where the player starts: a strip down the west side marked every 5 m; mantle walls from
0.5 to 2.1 m; fences from 0.6 to 1.2 m; climb walls from 3 to 7.2 m; slide ramps of 5°, 10°, 20° and 30°, 12 m long,
each with a deck at its top; steps of 0.25 m; slope tests of 45° and 51°; a 6 m tower with a ladder up its north face
(the engine's ladder glyph, `|`), a zipline 40 m long from a pole on its top down to the south wall, and a trampoline
against its west face (2 m, and 0.9 of a fall's speed back); a jump pad (6.5 m) in the open south of it; the redeploy
balloon's line, 90 m up; down the east side, a lane of 1.5 m platforms across gaps from 2 to 9 m; and at the south end
the crawl, a tunnel 1.4 m clear and 8 m long and a bar 1.3 m up to slide under, whose roof slab and bar are fixed props
(`prop:gym-slab`, `prop:gym-bar`) on their walls and posts. The rides are the scene's (engine/sim/rides.ts: a zipline's
poles stand on what their spec names). A sign floats over each feature, shown when the player is near.

## The player

`labs/playground/cast/player.ts` stands the player in a scene on the movement profile `movement:apex`: Apex's hull (a
capsule 1.83 m tall, 0.41 m in radius), gravity (19.05 m/s²), jump (1.42 m) and its shooter model, a run of 4.41 m/s
and a sprint of 6.60 m/s with a weapon out, 1.15 times faster empty-handed, as the player is; drawn as
`body:player` (`labs/playground/bodies/player.ts`) on `build:adult`: 1.80 m standing, an adult's proportions, its
gait planting each sole at full stride. The body is a teal jacket with dark upper sleeves and collar, charcoal cargo
trousers with knee pads and a belt, boots, gloves, short hair, a face and an olive pack, every garment in two tones, so
every look reads it, and one orange accent (the yoke and its shoulder caps, the pack's top flap, the cuffs) that marks
the player from every camera, top-down too. Its slots are what the neighbours will vary.

## Cameras and looks

| Mode | Code | What it is now |
|---|---|---|
| Third-person shooter (the default) | `cam3=shoulder` | over the right shoulder, 3.8 m back, looking along the aim; X swaps the shoulder |
| First person | `cam3=first` | at the eye (1.52 m standing, 0.81 m crouched), the body hidden but the hands; Apex's view effects |
| Third-person platformer | `cam3=follow` | orbit and follow: 5.5 m back, 20° down, recentring, look-ahead, a dead zone for jumps |
| Isometric | `cam=iso` | orthographic, 45° round and 30° down, whole zoom steps |
| Top-down | `cam=overhead` | straight down, north up, whole zoom steps on the pixel grid |

T steps through them in this order, each switch blended over 0.35 s; `labs/playground/views.ts` lists them and
`__engine.camera.set('cam=iso')` sets one (`{ blend: true }` blends). The shooter and the platformer move at a pace
and never stand in a wall, and what stands between them and the player fades (WP 13.8, docs/PLAYGROUND.md §4); the field of view
is the view setting `cam.fov` (Apex's degrees, 90).

The looks (`labs/playground/looks/`): `look:playground-clean` (the default since the owner's direction of 2026-11-03,
ADR-0025 amendment 46: the scene's own lit materials under the hour's sky, edges smoothed, nothing else),
`look:playground-cel` (WP 13.24: each material a ramp of three bands and a rim, its shadows shifted in hue, ink and
outline shells round the props and bodies scaled to the picture, a gradient sky) and `look:playground-pixel` (WP 13.24:
a picture of 240 to 360 lines, 1-pixel ink, each material a ramp of four shades dithered on the world, isometric and
top-down snapped to the pixels and gliding, so a pan never shimmers; the perspective cameras draw its variant,
`look:playground-pixel-perspective`). P steps through them in that order; `?post.look=look:playground-pixel` opens one. Looks and cameras are view settings: they never change play or a hash.

## Controls

| Action | Keys and mouse | Pad |
|---|---|---|
| Move | W A S D, or the arrows | left stick |
| Jump | Space | A (south) |
| Sprint (press once to keep it, or hold: `input.sprint`) | Left Shift | a click of the left stick |
| Walk | Left Alt | |
| Crouch (hold, or toggle: `input.crouch`) | C | B (east) |
| Use: a zipline or a ladder | E (G in isometric) | X (west) |
| Melee, fire, aim down sights | V, the left and right buttons | a click of the right stick, RT, LT |
| Reload, holster | R, 3 | |
| Look around (first person, shooter, platformer) | click the game, then the mouse; Esc lets go | right stick |
| Aim (isometric, top-down) | the pointer, onto the player's floor | right stick |
| Camera mode | T | view button |
| Swap the shoulder (shooter) | X | d-pad left |
| Turn the view (isometric) | Q, E | d-pad right |
| The look: clean, cel or pixel | P | |
| Zoom | the wheel | |
| The feel panel | F | |
| The controls sheet | H | |
| Go to another area or room | M | |
| Pause (Go to, settings, controls, photo mode, tools, restart) | Esc | Start |

Each camera mode has its own action map (`labs/playground/controls.ts`, WP 13.9), which the page swaps as the camera
changes: first person and the shooter send the view and aim at what the screen's middle points at, the platformer
faces where it moves, and isometric and top-down aim with the pointer. The controls sheet (H) shows the keys of the
map in use, rebound or on a pad. The site's landing page (`index.html`) opens this page (ADR-0021 amendment 3).

## Settings

| Setting | What it tunes |
|---|---|
| `playground.gym.speed` | The player's run speed in the gym with a weapon out, m/s (4.41, Apex's; empty-handed, the player runs 1.15 times as fast), when the scene starts. Changes play: recorded in replays. |
| `playground.gym.jump` | How high the player jumps in the gym, m (1.42, Apex's), when the scene starts. Changes play: recorded in replays. |
| `playground.hour` | The hour the block's scenes start at, 0 to 24 (12, noon; 18.5 dusk, when the street's lamps and the porch's come on; 22 night), when the scene starts: the sky, the sun or the moon and the fog follow it. Changes play: recorded in replays. |
| `playground.day` | How many minutes of play a day on the block takes (0, the default, holds the hour), when the scene starts. Changes play: recorded in replays. |
| `playground.feel` | The feel panel: `on` shows it when the page opens (F shows and hides it). A view setting. |
| `playground.title` | The start menu (after the splash screen): `auto` shows it as the page opens unless a replay plays or automation drives the browser, `on` and `off` force it. A view setting. |
| `playground.spawn` | Where the page puts the player once a scene of the block is up: a Go to place, area:range or room:house/kitchen, run as the dev action `place`, so the run records it. A view setting. |
| `playground.check` | The owner's check under way (`labs/playground/ui/checks.ts`): its id, which the HUD names and pause offers to answer; the page puts the player at the check's spot as the scene comes up, through the dev action `place`, so the run records it. Empty: none. A view setting. |
| `playground.movement` | The profile the player moves by: `movement:apex` (the default) or `movement:platformer`, the Stress Box hero's feel, when the scene starts. Changes play: recorded in replays. |
| `playground.attract` | The attract mode, the tour playing behind a banner with the view stepping through the cameras and the looks: `on` is the tour's page itself, `auto` opens it after a minute on the start menu with nothing pressed unless automation drives the browser, `off` never; a key gives the page back. A view setting. |
| `playground.readout` | The HUD's feel readout, the player's speed and how he moves: `auto` shows it in the platformer, isometric and top-down cameras, `on` in every camera, `off` in none. A view setting. |
| `playground.rain` | How hard it rains on the block, 0 (dry, the default) to 1 (a downpour, about 29,000 drops falling round the player as GPU particles, WP 11.3); none falls while he is indoors. A view setting, live. |
| `playground.dust` | How thick the dust motes hang about the player indoors, 0 (none, the default) to 1. A view setting, live. |
| `movement.gaits.run` | One of the shooter model's numbers, live: every number and switch of the model has its setting, `movement.<group>.<field>` (`node x describe setting` lists them; `movement.mantle.boost` turns on the mantle boost), Apex's by default; off its default it replaces that number for every character on the model from the next step. Changes play: recorded in replays. |
| `input.sprint` | The sprint button: `toggle` (Apex's: a press keeps the sprint while the player moves on) or `hold`. Changes play: recorded in replays. |
| `input.crouch` | The crouch button: `hold` or `toggle` (a press crouches until pressed again). Changes play: recorded in replays. |
| `input.sensitivity` | Mouse look in Apex's units (5: 0.11° a count); `input.adsSensitivity`, `input.invert` and the stick's `input.stickSensitivity`, `input.stickAdsSensitivity` and `input.stickInvert` beside it. View settings. |
| `post.look` | The look drawn (`look:playground-clean` by default). A view setting: never in the hash. |
| `quality` | The quality tier: `auto`, `high`, `medium` or `low`. A view setting. |
| `time.scale` | Sim seconds per real second (1). A view setting. |

Set one with `node x set playground.gym.speed 6`, as a URL parameter (`labs/playground/?playground.gym.speed=6`), or
with `__engine.set('playground.gym.speed', 6)`. On the block, the dev actions `daytime` (`{ hour, rate }`, the rate in
hours a sim second) and `lights` (`{ group, on }`: `room:kitchen`, `room:porch`, `street`…) set the clock and switch a
light group at once, with no restart: `__engine.actions.run('daytime', { hour: 22 })`.

## Feel courses and the feel panel

A feel course (`labs/playground/courses/`) is a scripted run of the gym and the numbers measured on it, each against
docs/PLAYGROUND.md §3.2's reference and tolerance: `labs/playground/courses/strip.ts` (the run, the sprint on a press
and the stop), `labs/playground/courses/jumps.ts` (a jump, a tired one off its landing, a rested one, the walk and the
crouch-walk), `labs/playground/courses/air.ts` (a lurch, an air strafe and the bunny hop's cost),
`labs/playground/courses/slideFlat.ts` (the slide's boost and its cooldown, letting go fast, a slide held into the
crouch-walk), `labs/playground/courses/slideRamps.ts` (down each slide ramp and up the 30° one),
`labs/playground/courses/slideJump.ts` (the slide-jump, a dead slide, the long jump),
`labs/playground/courses/crawl.ts` (crouched through the tunnel and up out of it, a slide under the bar),
`labs/playground/courses/mantle.ts` (the auto mantle at each mantle wall: a step, a pull, the grab and the pull, the
2.1 m wall refused from the ground), `labs/playground/courses/fences.ts` (each fence mantled over at a sprint,
sprinting out), `labs/playground/courses/climb.ts` (each climb wall climbed and topped out, the 6.9 m one by the end
boost, the 7.2 m one refused; a wall-bounce from each zone), `labs/playground/courses/hang.ts` (the mantle hang, none
where the lip is too low, letting go), `labs/playground/courses/superglide.ts` (the superglide and three near misses;
the mantle boost, its setting `movement.mantle.boost` on), `labs/playground/courses/zipline.ts` (use from the tower,
the speed-ups to the top speed, jumping on, jumping off keeping the speed or at 11.3 m/s, a crouch's drop, three
catches a jump), `labs/playground/courses/ladder.ts` (run into it and up it, over its top; down it from the top; a jump
off; a crouch letting go), `labs/playground/courses/launcher.ts` (the pad's 6.5 m, the trampoline's 2 m and its bounce
from a fall), `labs/playground/courses/skydive.ts` (up the balloon's line, the glide, the dive, the landing pose at
30 m, no stun), `labs/playground/courses/gaps.ts` (the lane of gaps: running across 3 m, sprinting across 5 m,
slide-jumping across 7 m, a superglide over a platform and the 5 m gap), `labs/playground/courses/steps.ts` (up the
stairs at the run's speed, up the 45° slope, refused by the 51° one), `labs/playground/courses/crouch.ts` (the duck
down, up at once, crouch spam never down), `labs/playground/courses/landing.ts` (falls of 6, 14 and 25 m: the stun by
the impact) and `labs/playground/courses/climbAgain.ts` (a climb caught again only 3.25 m lower); on the hill,
`labs/playground/courses/hill.ts` (up its flank, down it sprinting and sliding). Each starts with the gym's dev action
`place`
(`{ at, yaw, speed }`) and checks the bounds of `labs/playground/courses/bounds.ts` too, each run's: the body's and
every camera's. `node x feel labs/playground` runs them all headless, `--course slide-flat` one, each into
`out/feel/<lab>-<name>/report.json`. A bound its WP has yet to meet is watched, reported and never failing a course
(none on the gym's courses: the feet's slide was, until WP 13.10 planted them; the house's soak,
`labs/playground/scenes/site-soak.test.ts`, the bot's tour of every room run again as a course, watches the shooter's
and the platformer's for WP 13.27, judging only that no camera stands in a wall). Every camera keeps §4's bounds on every course, and
`labs/playground/courses/cameras.ts` blends through the five modes while the player runs a square by the north wall.

The feel panel (F, or `?playground.feel=on`) puts a slider on every `movement.*` setting, live; Copy as profile shows
the tuning as a `defineMovement` call to paste into a game, and Save the replay downloads the run so far for
`tests/replays/`.

## The quick loop

1. Run the gym headless: `node x sim labs/playground/scenes/gym --steps 600 --feel` (how the player handles), with
   `--set playground.gym.speed=6` to try a number. Its replay, `out/sim/playground-gym/run.replay.json`, has empty
   inputs to edit (tests/replays/README.md, "Coordinates and inputs").
2. See it as numbers: `node x shot labs/playground --scene gym --cam iso` (the ID pass and the look metrics; `--png`
   for a picture).
3. Check the numbers: `node x feel labs/playground` (every course; `--course air` for one).
4. Prove play: `node x replay tests/replays/playground-gym.replay.json --browser page`.
5. Keep a page open: `node x inspect --page labs/playground --scene gym`, then `node x eval "__engine.hash()"`.
6. Commit with the page's suite green: `npm run e2e -- tests/e2e/playground.spec.ts`.
