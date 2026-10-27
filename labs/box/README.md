# The Stress Box

The engine's integration target (PLAN.md §9.0): a test scene, benchmark and sample that grows through six stages,
each proved by commands that need no display. Stage 1 (Box 1, gate G2): the box renders on WebGPU, steps headless
with golden hashes that hold in Node and in Chromium, and is inspected and set from `node x` and `window.__engine`.
Stage 2 (Box 2, gate G3): a hero walks, dashes and jumps through the character controller, his body stepped by the
animator, in replays whose hashes hold while the page renders and whatever the camera. Stage 3 (Box 3, gate G4): the
hero climbs the hall's stairs to a gallery, walks its dais, and pushes and shoves its crates and barrels in replays
that hold in Node and in the page. Stage 4 (Box 4, gate G5): the hall fills with a crowd of walkers, slimes and wisps,
100 to 5,000, that chase the hero round the pillars and up the stairs. Stage 5 (Box 5, gate G6): the hero fights the
crowd with a sword and a bolt; it swings, pounces and shoots back, telegraphed, taking turns; blows kill, throw and
launch bodies, burst effects and show damage numbers, in replays that hold in Node and in the page. Stage 6 (Box 6,
gate G7): the box's looks on the hall with its props, the torch-lit hall with its flickering torches and fog, toon
shading with ink outlines, and the prototype's cel, pixel, bloom and FXAA over it, on the hall's rune floor, with no
pipeline built after a warm-up and the knock replay's goldens unchanged; the fight's blows through the bodies'
reactions (walkers flinch, are knocked down and get up, the slain fall; the hero flinches) and the hero's cape, swung
by the view; and the benchmark, the fight and the crowd at 100, 1,000 and 5,000 within their budgets. Clip mode
(Phase 8): the hero and the mannequin play any clip of the animation library through the clip layer, the clip
`node x anim show` prints, frame for frame. Every claim below is checked by `tests/unit/box-readme.test.ts`: a
setting, file or command named here that does not exist fails it.

## The demo index

Every scene, what it proves, and the command that shows it; each scene opens in the page at `labs/box/?scene=<name>`.
A test (`tests/unit/box-readme.test.ts`) fails when a scene of `labs/box/scenes/` is missing here, or a `box.*`
setting from the settings below.

| Scene | What it proves | The command that shows it |
|---|---|---|
| `labs/box/scenes/room.ts` | Box 1: the box renders on WebGPU and steps headless, its goldens the same in Node and in Chromium; it is inspected and set from `node x` and `window.__engine`. | `node x replay tests/replays/box-1-room.replay.json --browser page` |
| `labs/box/scenes/room-hero.ts` | Box 2: the hero walks, dashes and jumps through the character controller, his body stepped by the animator; his goldens hold while the page renders, whatever the camera. | `node x replay tests/replays/box-2-jump.replay.json --browser page` |
| `labs/box/scenes/hall.ts` | Box 3: a physics level, its stairs, galleries and the dais's slopes walked and climbed, the cutaway showing the hero; the floor its rune bake (Box 6). | `node x replay tests/replays/box-3-climb.replay.json --browser page` |
| `labs/box/scenes/hall-props.ts` | Box 3: 10 to 300 props standing in Rapier, pushed and shoved, drawn as instanced batches; Box 6: its replay's goldens hold through every box look and a look of each material style. | `node x replay tests/replays/box-3-knock.replay.json --browser page` |
| `labs/box/scenes/crowd-100.ts` | Box 4: a crowd chasing the hero by flow field up the stairs, drawn through its level of detail; its goldens hold in the page. | `node x replay tests/replays/box-4-chase.replay.json --browser page` |
| `labs/box/scenes/crowd-1000.ts` | Box 4: the crowd's cost at 100, 1,000 and 5,000 agents, within budget. | `node x perf labs/box --scene crowd-1000 --ladder --budget` |
| `labs/box/scenes/crowd-5000.ts` | Box 4: 5,000 bodies entering with no pipeline built; Box 6: the benchmark's crowd, within budget; its page within budget, drawn through a GPU crowd (WP 11.4), and against the instancing service. | `node x perf labs/box --scene crowd-5000 --ladder --budget`, `node x perf labs/box --scene crowd-5000 --budget`, `node x perf labs/box --scene crowd-5000 --feature feature:gpuCrowds` |
| `labs/box/scenes/fight.ts` | Box 5: combat, its deaths, launches, telegraphs, effects and damage numbers drawn from the sim, its goldens the same with effects on and off; Box 6: its blows through the bodies' reactions (flinch, knockdown, get-up, death) and the hero's cape, which the ID pass sees. | `node x replay tests/replays/box-5-fight.replay.json --browser page` |
| `labs/box/scenes/fight-1000.ts` | Box 6: the benchmark, the fight at 100, 1,000 and 5,000, within budget. | `node x perf labs/box --scene fight-1000 --ladder --budget` |
| `labs/box/scenes/hall-props.ts`, every look | Box 6: every box look, and one of the engine's looks in each material style, renders on the hall with its props with no pipeline built after a warm-up, across every toggle, the knock replay's goldens unchanged (Looks, below); the engine's 98 looks each build nothing and keep the hash on the room (`tests/e2e/post.spec.ts`). Each test lists the scene and the looks it covered as its annotations (`looks`) in out/e2e/report.json. | `npm run e2e -- tests/e2e/box-look.spec.ts tests/e2e/parity.spec.ts` |
| `labs/box/sounds/page.ts` | Phase 9: the box plays its sim events as sounds, spatialized and ducked, with torch ambience and a demo song; the fight replay's sound timeline hashes the same in Node and in Chromium. | `npm run e2e -- tests/e2e/box-audio.spec.ts` |
| `labs/box/scenes/clips.ts` | Clip mode (Phase 8): the hero and the mannequin play any clip of the library's 1,218 through the clip layer, over the hero's own rig; the clip a setting names is the one `x anim show` prints, frame for frame; its replay's goldens are the same in Node and in Chromium, drawn or not (`node x replay tests/replays/box-8-clips.replay.json --browser page`). | `npm run e2e -- tests/e2e/box-clips.spec.ts` |
| `labs/box/scenes/ragdoll.ts` | Ragdolls (WP 10.2): a blow from the front, from behind, a launch and a death hand four partners off to their ragdolls, joints as data on Rapier, and each gets up the way it lies (the dead one when the cycle stands it), its goldens the same in Node and in Chromium; `box.ragdoll.handOff` off, they fall through their reactions' timelines instead. | `node x replay tests/replays/ragdoll-falls.replay.json tests/replays/ragdoll-strike.replay.json --browser sim` |

The benchmark's budgets and the numbers they were measured from are in `tests/baselines/perf/box-fight-1000.json`
and `tests/baselines/perf/box-crowd-5000.json`.

## Scenes

| Scene | What it shows | Covered by |
|---|---|---|
| `box:room` (`labs/box/scenes/room.ts`) | The room, `labs/box/levels/room.txt`: 16 × 12 m of flagstones in brick walls 3 m high, one low wall (0.75 m), a 2 × 2 m pillar, the hero's spawn and three numbered markers. Three crates move on fixed paths from the markers, no physics yet: along the low wall, round a circle, round the pillar. | `tests/e2e/box.spec.ts`, `tests/e2e/parity.spec.ts`, `tests/replays/box-1-room.replay.json`, `tests/replays/box-1-tuned.replay.json`, `labs/box/scenes/room.test.ts`, `tests/baselines/thumbs/box-room-iso.json` |
| `box:room-hero` (`labs/box/scenes/room-hero.ts`) | The same room as a physics level, and the hero (`labs/box/cast/hero.ts`: the stress test's speeds and timings, 5 m/s, a 1.46 m jump, a 3.25 m dash) at the spawn, the player: he walks (WASD, a stick), jumps (Space) onto the low wall but not the walls, and dashes (Shift); his animator steps his body with the sim, drawn as the neutral humanoid. Every camera follows him, and the walls and the pillar before him cut away; first person hides his body but his hands. | `tests/e2e/box-hero.spec.ts`, `tests/e2e/parity.spec.ts`, `tests/replays/box-2-walk.replay.json`, `tests/replays/box-2-dash.replay.json`, `tests/replays/box-2-jump.replay.json`, `labs/box/scenes/room-hero.test.ts`, `labs/box/cast/hero.test.ts` |
| `box:hall` (`labs/box/scenes/hall.ts`) | The hall, `labs/box/levels/hall.txt`, as a physics level: 64 × 44 m inside walls 3 m high, a grid of pillars, low walls, 30 brazier stands, two galleries 1 m up along the north wall with stairs rising to each, and the octagonal rune dais at the centre, 0.5 m up. The hero starts on the dais: he walks down its slopes and up them, climbs the stairs to the galleries, jumps onto the low walls; the walls and pillars before him cut away. Its floor is its bake (`labs/box/looks/hall-floor.ts`): flagstones, moss creeping from the walls' feet, contact shadows along them, and the rune circle glowing on the dais. | `tests/e2e/box-hall.spec.ts`, `tests/e2e/parity.spec.ts`, `tests/replays/box-3-climb.replay.json`, `tests/replays/box-3-dais.replay.json`, `labs/box/scenes/hall.test.ts`, `tests/baselines/thumbs/box-hall-iso.json` |
| `box:hall-props` (`labs/box/scenes/hall-props.ts`) | The hall with the hero and its props, standing in Rapier and drawn through one instanced batch per prop part: a brazier's fire on each of the 30 stands, and 100 crates and barrels (10 to 300) on the prototype's seeded spots, every fifth crate stacked on the one before where both are crates. He pushes them by walking into them, and shoves (J, the left mouse button) every prop within 1.9 m in his arc, knocking it away, both hands thrust forward. | `tests/e2e/box-hall.spec.ts`, `tests/e2e/parity.spec.ts`, `tests/replays/box-3-knock.replay.json`, `labs/box/scenes/hall-props.test.ts` |
| `box:crowd-1000` (`labs/box/scenes/crowd-1000.ts`) | The hall with its hero and a crowd of 1,000 (its presets for 100 and 5,000 are `labs/box/scenes/crowd-100.ts` and `labs/box/scenes/crowd-5000.ts`, at `?scene=crowd-100` and `?scene=crowd-5000`): walkers (`labs/box/cast/walker.ts`, capsules walking at 1.75 to 2.5 m/s), slimes (`labs/box/cast/slime.ts`, balls hopping up to 2.75 m) and wisps (`labs/box/cast/wisp.ts`, flyers hovering 1.25 m up), half, three in ten and two in ten, queued at the start on the hall's floor and entering 25 a step. They chase the hero along a flow field toward his tile, round the pillars and up the stairs when he climbs to a gallery; level with him the walkers wait on a ring 1.5 m round him and the slimes on one 2.1 m round him, and the wisps circle him 4.4 to 6.3 m out. Their bodies push each other apart in Rapier, and the hero's capsule shoves them aside (his `shoves: ['crowd']`): with 1,000 pressing round him at the stairs' foot he still climbs to the gallery (box-4-stairs). The page draws them through a crowd (instanced batches; while `feature:gpuCrowds` is on, a GPU crowd's: a draw call a batch, its instances culled against the view on the GPU, `gfx.featuresOff` turning it off), each posed at the detail its distance from the camera allows: walkers as the neutral humanoid in four builds, slimes as blobs with horns, ears or wings, wisps as floaters with their motes. | `tests/e2e/box-crowd.spec.ts`, `tests/e2e/parity.spec.ts`, `tests/replays/box-4-chase.replay.json`, `tests/replays/box-4-hop.replay.json`, `tests/replays/box-4-stairs.replay.json`, `labs/box/scenes/crowd-1000.test.ts`, `labs/box/cast/crowd.test.ts`, `tests/baselines/perf/box-crowd-1000.json` |
| `box:fight` (`labs/box/scenes/fight.ts`) | Box 5: the hall, its hero with a sword (`HERO_FIGHT`, `labs/box/cast/hero.ts`) and a crowd of 36, mixed (its preset for 1,000 is `labs/box/scenes/fight-1000.ts`, at `?scene=fight-1000`), fighting. Attack (J, the left mouse button) runs his combo, a slash, a backslash and a spin, and out of a dash the thrust; skill (L, the right mouse button) fires a bolt (`labs/box/scenes/fight-hero.ts`). The walkers swing their fists, the slimes pounce and the wisps shoot (`WALKER_ATTACK`, `SLIME_ATTACK`, `WISP_ATTACK` in the cast's files; `labs/box/scenes/fight-foes.ts`), each telegraphing on the floor while it winds up, the walkers and slimes three at a time through his attack tokens. Blows land through the engine's `damage` (`labs/box/scenes/fight-rules.ts`): hit points, pushes, big hits throwing bodies up a little and killing ones throwing them high, corpses the crowd walks through, hit-stop, and the events the page draws effects and damage numbers from. Each blow goes through the body's reactions (the component `reactions`, Box 6): a walker flinches, a big blow knocks it down and it gets up the way it lies, acting on nothing meanwhile, and a killing one fells it; a foe's blow flinches the hero. He wears a cape (the component `secondary`), which the view swings and the ID pass names as his (actor#1/cape). | `tests/e2e/box-fight.spec.ts`, `tests/e2e/parity.spec.ts`, `tests/replays/box-5-fight.replay.json`, `tests/replays/box-5-precise.replay.json`, `labs/box/scenes/fight.test.ts` |
| `box:clips` (`labs/box/scenes/clips.ts`) | Clip mode, the Mocap Lab's: the room, the hero at its spawn and the mannequin 1.5 m east of him (`body:mannequin` on `build:mannequin`, the figure the Quaternius clips were measured on), both playing the clip `box.clips.clip` names through the clip layer in their animators, the hero's retargeted to his build. He stays the player and walks under it; masked to his upper body (`box.clips.mask`), his legs keep their own walk. A new clip crossfades in from the pose on screen; a one-shot holds its end 0.8 s, then plays again; clips that travel play in place. The page loads the library first: every set under `data/anim/sets`, registered as a `clipset` (`__engine.describe('clipset')`); `node x sim`, `node x replay` and the sim-only page register it too. | `tests/e2e/box-clips.spec.ts`, `tests/e2e/parity.spec.ts`, `tests/replays/box-8-clips.replay.json`, `labs/box/scenes/clips.test.ts` |
| `box:ragdoll` (`labs/box/scenes/ragdoll.ts`) | Ragdolls (WP 10.2): the room as a physics level, the hero at its spawn and four sparring partners on `build:adult` across its south half, each where it falls on open floor in view, facing him. Every 8 s a blow lands on each in turn: the first from the front (it falls onto its back), the second from behind (onto its face), the third a launch, up and to the south-east, the fourth a killing one; each falls as a ragdoll (engine/sim/ragdolls.ts: eleven capsules held by balls with a body's limits and hinges at the elbows and knees, faded onto the puppet) and gets up the way it lies once its trunk lies still, the dead one when the cycle stands it up at 6 s; at each cycle's start a partner standing is put back on its spot. His attack (J) knocks down the partner nearest in front of him, within 2.5 m. | `labs/box/scenes/ragdoll.test.ts`, `tests/replays/ragdoll-falls.replay.json`, `tests/replays/ragdoll-strike.replay.json`, `engine/sim/ragdolls.test.ts` |

The page draws each mover as a crate: an entity is drawn as a stand-in box when one of its components declares `x`
and `z` in metres (engine/gfx/stage.ts), until it draws itself: actors with an animator are puppets from Box 2
(engine/gfx/puppets/actors.ts), props a scene stands with `spawnProp` (engine/sim/props.ts) are drawn as their
props from Box 3 (engine/gfx/stageProps.ts), and crowd bodies (`crowdBody`, engine/sim/crowdBodies.ts) through a crowd
with its level of detail from Box 4 (engine/gfx/stageCrowd.ts).

## Looks

A look is how the page draws a scene, as data (`node x describe look`): the sky that lights it, a material style and a
filter chain; a look never changes play, so any scene can show any look. The box's own (`labs/box/looks/`) are the
torch-lit hall and the prototype's looks over it; the engine's 98 (`look:cartoon`, `look:game-boy`, the one-filter
presets…) show in the box too. What is proved, on the hall with its props: every box look, and one engine look of each
material style, builds nothing after its warm-up and keeps the knock replay's goldens (`tests/e2e/box-look.spec.ts`,
`tests/e2e/parity.spec.ts`); each of the engine's 98 does the same on the room (`tests/e2e/post.spec.ts`).

| Look | What it draws |
|---|---|
| `look:torch-lit` (`labs/box/looks/torch-lit.ts`) | The torch-lit hall: the sky `sky:hall`, dark but for the torches (all 30 with tiled lighting, else the 12 nearest the hero), each flickering on its own, the nearest casting shadows, and fog from 12 m past him. |
| `look:torch-toon` (`labs/box/looks/torch-toon.ts`) | Toon shading in it: three bands of light with a rim, the characters and objects inked. |
| `look:torch-cel` (`labs/box/looks/torch-cel.ts`) | The prototype's comic cel in it: four flat bands, pushed colour, ink lines. |
| `look:torch-pixel` (`labs/box/looks/torch-pixel.ts`) | The prototype's pixel look in it: 4 px blocks, 8 shades a channel, dithered. |
| `look:torch-bloom` (`labs/box/looks/torch-bloom.ts`) | Bloom in it: the flames, coals, runes and sparks glow (off at the `low` tier). |
| `look:torch-fxaa` (`labs/box/looks/torch-fxaa.ts`) | FXAA in it: every edge smoothed. |
| `look:daylight` (`labs/box/looks/daylight.ts`) | A plain day: the sky `sky:daylight`, its sun casting through three cascades on a renderer with cascaded shadows; `tests/e2e/enhanced.spec.ts` draws it on the crowd arena. |

Switch with `?post.look=look:torch-toon` (`labs/box/?scene=fight&cam3=chase&post.look=look:torch-toon`), with
`node x set post.look look:torch-toon` in an inspect session, or with `__engine.set('post.look', 'look:torch-toon')`;
`look:clean` is the scene's own. The first switch to the torch-lit sky, or to a material style, warms up first (on
SwiftShader, about a minute for the hall in a style under the sky; a GPU takes a moment); from then on a switch builds
nothing. `quality` sets how many torches cast shadows: 2 at `high`, 1 at `medium`, none at `low`. A new look comes
from `node x new look labs/box/looks/<name>`; the page imports every module under `labs/box/looks/`.

The chain's shading (WP 11.5: `ao`, `gi`, `air` and `ssr`, laid on any look with `post.filters`, as in
`labs/box/?scene=room&post.filters={"air":{"scope":"all"}}`, or by the looks `look:sunbeams`, `look:lamplit-fog` and
the engine's air presets) is measured on the room by `tests/e2e/enhanced.spec.ts`. The box draws no metal, so its
reflections show on `tests/pages/shading.html` instead.

## Sound

The box sounds through its page (`labs/box/sounds/page.ts`, `window.__boxSound`): silent until the first key, click or
end of a touch. It then plays the sim's events as sounds (`labs/box/sounds/events.ts`: footsteps by the surface
underfoot, landings, jumps and dashes, hits, bolts launched, pounces, and deaths that duck the music), placed where they
happen and muffled behind walls. The level sets the room's reverb, and the two torches nearest the camera crackle
(`sfx:boxTorch`). The demo song is `song:boxHall` (`labs/box/sounds/boxHall.ts`); its drums and lead join while blows
land. The effects are `labs/box/sounds/effects.ts`: `node x qa audio` checks them, and
`node x audio sfx:boxHit --spectrogram` shows one. The fight replay's sound timeline hashes the same in Node and in
Chromium (`tests/e2e/box-audio.spec.ts`).

## Settings

| Setting | What it tunes |
|---|---|
| `box.room.speed` | How fast the movers go along their paths, m/s (1.5). Changes play: recorded in replays. |
| `box.room.movers` | How many of the three movers run (3), when the scene starts. |
| `box.roomHero.speed` | How fast the hero walks, m/s (5), when the scene starts. Changes play: recorded in replays. |
| `box.roomHero.jump` | The hero's take-off speed, m/s (9.375: a 1.46 m apex under his 30 m/s² gravity), when the scene starts. |
| `box.roomHero.dash` | The hero's dash speed, m/s (16.25, for 0.2 s; 0 turns it off), when the scene starts. |
| `box.hall.speed` | How fast the hero walks in the hall, m/s (5), when the scene starts. Changes play: recorded in replays. |
| `box.hall.jump` | The hero's take-off speed in the hall, m/s (9.375), when the scene starts: below about 7.75 m/s he no longer jumps onto the galleries, 1 m up, and climbs to them by the stairs alone. |
| `box.hall.dash` | The hero's dash speed in the hall, m/s (16.25, for 0.2 s; 0 turns it off), when the scene starts. |
| `box.hallProps.count` | How many crates and barrels stand in the hall with its props (100, 10 to 300), when the scene starts. Changes play: recorded in replays. |
| `box.crowd.count` | How many walkers, slimes and wisps fill the hall with the crowd (1,000 in `box:crowd-1000`, 100 and 5,000 in its presets; 0 to 5,000), when the scene starts. Changes play: recorded in replays. |
| `box.crowd.mix` | Who fills it: `mixed` (half walkers, three in ten slimes, two in ten wisps), `walkers`, `slimes` or `wisps`, when the scene starts. |
| `box.fight.god` | Whether foes' blows only flinch and push the hero in the fight (true, as the prototype's proof ran) or also take his hit points (false: at none he rallies at once), when the scene starts. |
| `box.fight.precise` | Whether the fight's hero is posed in the sim every step (his animator's precise hits), so his sword's trail is sim data in the hash (false by default; `tests/replays/box-5-precise.replay.json` plays it on), when the scene starts. |
| `box.clips.clip` | The clip the figures play in clip mode, `<set>/<clip>` as `node x anim find cartwheel` lists them (the Quaternius set's Dance_Loop by default), or a name only one set has. Changes play: recorded in replays. |
| `box.clips.speed` | The rate it plays at (1; 0 holds it). |
| `box.clips.frame` | Frame stepping: the frame of its bake held, from 0, 30 a second (-1 plays). |
| `box.clips.mirror` | Whether it plays mirrored (false). |
| `box.clips.mask` | The joints it plays: `full`, or `upper` over the legs' own walk. |
| `box.clips.cast` | Who plays it: `both`, `mannequin` or `hero`, when the scene starts. |
| `box.clips.ik` | Whether the figures plant their feet and lift over the floor (true), when the scene starts. |
| `box.ragdoll.handOff` | Whether a hard blow or a death hands a partner of `box:ragdoll` off to its ragdoll (true) or lets it fall through its reactions' timelines (false), when the scene starts. Changes play: recorded in replays. |
| `box.ragdoll.push` | How hard `box:ragdoll`'s blows land, m/s along the blow (3.5), when the scene starts. |
| `post.look` | The look drawn (`look:clean`, the scene's own; the box's looks above). A view setting: never in the hash. |
| `quality` | The quality tier: `auto` (`high` on a desktop), `high`, `medium` or `low`: shadow casters, bloom, pixel caps. A view setting. |
| `gfx.effects` | Whether the fight's effects draw (true): bolts, telegraphs, trails, bursts. A view setting. |
| `gfx.resolution` | The resolution mode: `pixels`, `balanced` or `full`. A view setting: never in the hash. |
| `time.scale` | Sim seconds per real second (1). A view setting. |
| `touch` | The touch controls: `auto`, `on` or `off`. A view setting (below). |
| `box.menu` | The page's menu for humans (below): `auto` shows it unless automation drives the browser, `on` and `off` force it, when the page opens. A view setting. |

Set one with `node x set box.room.speed 3`, as a URL parameter (`labs/box/?box.room.speed=3`), or with
`__engine.set('box.room.speed', 3)`; `node x describe setting` lists them all.

## The page

`labs/box/` opens the room (the site's landing page, `index.html`, opens the playground, whose menu links here). Its
routes: `?scene=room`, `?seed=4`,
`?cam=iso` (a camera code: `cam=topdown`, `cam=iso,45,2,persp`, `cam3=orbit`, `cam3=fly`; with the hero also
`cam3=chase`, `cam3=first` and `cam3=rail`, which follow him), any setting by its path,
and `?replay=box-1-room` (a replay played in real time; `?replay=box-2-jump` opens the hero's room, `?replay=box-3-climb`
the hall, `?replay=box-3-knock` the hall with its props, `?replay=box-4-chase` the hall with a crowd of 100, `?replay=box-5-fight` the fight, `?replay=box-8-clips` clip mode)
and `?post.look=look:torch-lit` (a look, above). In the page,
`window.__engine.help()` lists every member.

The page opens with its menu for humans (`labs/box/menu.ts`) in the top-left corner: every scene above as a link with
a one-line label, the replays, cameras (`cam3=chase`, `cam3=first`, `cam3=orbit`, `cam=iso`, `cam=topdown`) and looks
(the box's, then `look:cartoon`, `look:game-boy` and a few more of the engine's) that keep the scene, and the
controls, read from the action map the page's input binds (`actionMap:thirdPerson`: WASD or the arrows move, Space
jumps, Shift dashes, the left button or J attacks, the right button or L fires the bolt, E interacts), with the
wheel's zoom and the first click or key that starts the sound. Its button or M shows and hides it; no action map binds
M (`tests/e2e/box-menu.spec.ts`). The page remembers the last toggle in the browser: closed, the menu stays closed
across reloads and its own links, its button still in the corner, until it is opened again. A browser that automation drives (navigator.webdriver: every e2e spec and every `x`
command that opens the page) gets none of it, so no test's screenshot holds it, and `__engine.shot` reads the GPU,
never the page; `?box.menu=on` shows it there.

`?scene=clips` opens clip mode (`labs/box/?scene=clips&box.clips.clip=cmu/Cartwheel&cam=threequarter`); the page loads
the animation library for it and its replays alone. The page ships the clips, so it always shows 100STYLE's credit (CC BY 4.0,
`data/anim/SOURCES.md`) in its corner.

On a phone or tablet the page shows the touch controls (`labs/box/touch.ts`, for every scene): a floating stick
wherever the thumb lands, attack as the main button, and jump, dash and the bolt beside it. The menu is a page panel
there: it starts below its button and scrolls, the touch buttons hide while it is open, and a tap on the game closes
it. Like the rest of the touch layer they are not tested (ADR-0021); `labs/box/?touch=on` shows them on a desktop.

## The quick loop

1. Change a setting or the scene, then run it headless: `node x sim labs/box/scenes/room --steps 600 --set box.room.speed=3`;
   for the hero, `node x sim labs/box/scenes/room-hero --feel --set box.roomHero.speed=6` also prints how he handles.
   `x sim` steps with no intents: its replay (`out/sim/box-<name>/run.replay.json`) has empty `inputs`, which you edit to
   drive the hero (`[0, { "move": [0, 1] }]` walks him south, +Z; tests/replays/README.md, "Coordinates and inputs").
2. See it as numbers: `node x shot labs/box --scene room --cam iso` (the ID pass and the look metrics; `--png` for
   a picture, `--thumb box-room-iso` against the baseline); for the hall,
   `node x shot labs/box --scene hall --cam iso --thumb box-hall-iso`; for the crowd,
   `node x sim labs/box/scenes/crowd-100 --steps 600 --set box.crowd.mix=slimes`, and its cost at 100, 1,000 and
   5,000, `node x perf labs/box --scene crowd-1000 --ladder`; for the fight,
   `node x sim labs/box/scenes/fight --steps 600 --set box.fight.god=false`; in a look,
   `node x shot labs/box --scene hall --cam iso --set post.look=look:torch-cel`; in clip mode,
   `node x anim show Cartwheel` (the clip as text) and
   `node x shot labs/box --scene clips --cam threequarter,0,5 --set box.clips.clip=cmu/Cartwheel --set box.clips.frame=30`.
3. Prove play: `node x replay tests/replays/box-1-room.replay.json --browser page` (the goldens, in Node and in the
   page while it renders); `node x replay tests/replays/box-2-jump.replay.json --browser page` for the hero,
   `node x replay tests/replays/box-3-climb.replay.json --browser page` in the hall,
   `node x replay tests/replays/box-4-chase.replay.json --browser page` with the crowd,
   `node x replay tests/replays/box-5-fight.replay.json --browser page` in the fight,
   `node x replay tests/replays/box-8-clips.replay.json --browser page` in clip mode, and with `--state` (or
   `--until 300`) the state a run reaches, in out/replay/<name>/state.json: where the hero, the props and the
   bodies ended, every component; the crowd's budgets,
   `node x perf labs/box --scene crowd-1000 --ladder --budget`, and the benchmark's,
   `node x perf labs/box --scene fight-1000 --ladder --budget` and
   `node x perf labs/box --scene crowd-5000 --ladder --budget`.
4. Keep a page open while iterating: `node x inspect --scene room`, then `node x eval "__engine.hash()"`,
   `node x set box.room.speed 3`, `node x dump --step 60 --filter pathMover` and `node x shot labs/box --scene room`
   (it reuses the session); `node x inspect --stop` ends it.
5. Commit with the suites green: `npm run e2e -- tests/e2e/box.spec.ts tests/e2e/parity.spec.ts`, and for the hall
   `npm run e2e -- tests/e2e/box-hall.spec.ts`, for the crowd `npm run e2e -- tests/e2e/box-crowd.spec.ts`, for the
   fight `npm run e2e -- tests/e2e/box-fight.spec.ts`, for the looks `npm run e2e -- tests/e2e/box-look.spec.ts`, for
   clip mode `npm run e2e -- tests/e2e/box-clips.spec.ts`.

## Adding a scene or a variant

A variant is a new scene file or a settings preset, never a change of meaning in a passing scene (PLAN.md §9.0).
`node x new scene labs/box/scenes/<name>` writes a box scene with its replay test, which passes its checks; the page
imports every module under `labs/box/scenes/`, so it opens at `labs/box/?scene=<name>`. Then keep a replay of it, the
sequence `tests/e2e/parity.spec.ts` runs on a new scene:

1. `node x sim labs/box/scenes/<name> --steps 600` writes the run's replay beside its report, with no intents.
2. Copy `out/sim/box-<name>/run.replay.json` to `tests/replays/box-<stage>-<name>.replay.json`. `<stage>` is the
   stage the scene proves; a variant outside every stage's claims takes the newest stage's number (the highest
   `box-<n>-` among tests/replays/) and stays out of `STAGES`. Edit its `inputs` to drive it before you record (tests/replays/README.md,
   "Coordinates and inputs": `move` is world [x, z], +X east, +Z south); `node x replay <file> --state` then shows
   where the run ends.
3. `node x replay <file> --browser sim --update` records its goldens, which hold in Node and in Chromium.
4. `node x replay <file> --browser page` checks them while the page renders.
5. List the scene and the replay here, with what it shows, what covers it and the settings that tune it (the demo
   index and the settings table: `tests/unit/box-readme.test.ts` fails a scene or a `box.*` setting left out).
6. When it belongs to a stage, add it to `STAGES` in `tests/e2e/parity-stages.ts`: T2's rendering-page check plays
   only the replays named there.

## Adding a prop

`labs/box/scenes/hall-props.ts` is the worked example. A prop is data (engine/world/props: its parts, its body, where
a level places it):

1. `node x new prop labs/box/props/<name>` writes `prop:<name>` and its test (its parts build clean and stand as tall
   as its body), which pass their checks; `node x qa geo tex --only prop:<name>` checks its parts and textures and
   counts what it checked (a prefix that keeps nothing is a usage error naming the closest ids).
2. Import it from the scene that shows it (`import '../props/<name>';`): the page reaches labs/box/props/ only
   through the scenes it imports, and QA through its own import of every module there.
3. The scene needs a physics world and floors to stand on: `physics: true`, then in `setup`
   `addLevelBodies(physicsOf(w), <compiled level>)` (the template's `level: 'level:room'` has none: the page draws
   the room, but nothing in it is solid; `labs/box/scenes/room-hero.ts` exports the room compiled as
   `ROOM_HERO_LEVEL`, `labs/box/scenes/hall.ts` the hall as `HALL_LEVEL`).
4. Stand it: `spawnProp(w, { prop: 'prop:<name>', at: [x, y, z], yaw })`, its base at `at` (m), turned `yaw` (rad)
   about +Y; it returns the entity, whose `sceneProp` component the sim hashes and the view draws as the prop.
5. Or let the level place it: give the prop `place: { spawn: '<spot>' }` and the level a glyph with that spawn
   (`defineGlyph('glyph:<spot>', { char, description, mesh: 'floor', spawn: '<spot>' })` in the scene module, before
   the level compiles), then `for (const placement of levelProps(<compiled level>)) spawnProp(w, placement);`. The
   digits are the engine's own spawns (`3` places at `spawn:3`).

Tile (col, row) of a level has its centre at x = (col + 0.5) × tile, z = (row + 0.5) × tile (1 m tiles in the box),
rows running +Z (south), as tests/replays/README.md says.

The `stress-box` skill (`.claude/skills/stress-box/SKILL.md`) says the rest.
