# my-3dge, lean

The my-3dge game engine as a library, the way three.js or Rapier ship: one ES module, nothing to install, build or
test. It makes 3D games for the browser: three.js r182 draws on WebGPU, Rapier simulates the physics, a fixed 60 Hz
sim runs the rules, and HTML/CSS draws the UI. This file is all you need, in a chat with no sandbox too: a game is
one HTML file.

## Start

1. Take `game.html` (in full below): a small game that already plays. You run round an arena and collect the gems
   before the clock runs out.
2. Change it into the game you are asked for. Keep its head: it loads the engine, three.js and Rapier from jsDelivr.
3. Open it in a browser with WebGPU (current Chrome, Edge or Safari; Firefox where it has WebGPU): double-click it, or
   serve its folder (`npx serve`, `python3 -m http.server`). There is no WebGL fallback.

A bigger game can split its code into module files that each import `my3dge`; serve the folder then, since browsers
load module files over http, not from a double-clicked page.

## How a game is made

**Two halves.** The _sim_ is the rules: entities holding components (plain data), systems that change them every
step, and events. The _page_ calls `createEngine`, which starts the sim, turns the keyboard, mouse, pads and touch into
intents, draws every frame on WebGPU, and calls your `onFrame` for the game's own presentation (the HUD, sound). The
page reads the sim and never writes it.

**A scene** is a game mode: `defineScene('game:play', { level, physics, settings, setup(w), step(w, intents) })`.
`setup` spawns entities and adds systems; `step` runs first in every step. A page offers its scenes with
`createEngine({ scenes })`, and `?scene=<id>` picks one.

**The world, `w`,** is what systems get:

- `defineComponent('gem', { description, fields })` declares a component: typed fields (`number`, `integer`,
  `string`, `boolean`) with defaults. `w.spawn({ gem: { x, z } })` returns an id; `w.query('gem')` returns the
  entities holding it, in id order; `w.get(id)` the entity (`.gem`), `w.add(id, 'gem', values)`, `w.remove(id,
  'gem')` and `w.despawn(id)` do the rest. A component with `x` and `z` in metres is drawn as a stand-in box, which
  also reads `y` (its bottom), `yaw`, `size` (its side, 0.5 m) and `material` (an id): name a place you only keep
  otherwise.
- Systems run in phases, in order: `intents`, `ai`, `anim`, `physics`, `readback`, `rules`:
  `w.systems.add('game.collect', collect, { phase: 'rules' })` runs after the physics moved the bodies.
- `w.emit('gem', payload)` delivers at the end of the step to `w.events.on('gem', …)`; a page reads
  `frame.world.events.trace()`.
- Time is steps: `w.tick`, `w.dt` (1/60 s), `w.hz`. Count a duration in whole steps (30 s is 1,800).
- Randomness comes from named streams: `w.rng('gems').int(0, 9)`, `.range(a, b)`, `.chance(p)`.
- Settings are the game's tunable numbers: `defineSettings({ 'game.gems': { type, default, minimum, maximum, when:
  'scene', description } })`, read with `w.settings.get('game.gems')`, set from the URL (`?game.gems=20`).

**Intents** are everything the sim reads from outside, once a step: `move` (a direction `[x, z]`), buttons held and
pressed, and the game's own keys. A player actor (`spawnActor(w, { player: true, … })`) reads them itself; systems
get them as their second argument (`held(intents, 'jump')`, `pressed(intents, 'attack')`). WASD or the arrows run,
Space jumps, Shift dashes.

**The HUD** is the page's: `engine.ui.hud(id, text, { at })` sets a line at one of six places (`top-left`, `top`,
`top-right`, `bottom-left`, `bottom`, `bottom-right`), and `null` as its text removes it.

**Particles, sound and lights.** The sim says what happened with events; the page turns them into particles and
sound, so play stays reproducible:

- A sim event bursts every emitter whose `events` names its type, where its payload says (`position`, or `x`, `y`,
  `z`): `w.emit('hit', { x, y: 1, z })` throws sparks. To burst others on your own event, lay them into an emitter:
  `defineEmitter('emitter:lit', { events: ['lit'], layers: [{ emitter: 'emitter:fireflies', count: 24 }] })`, then
  `w.emit('lit', { x, y: 1.2, z })`.
- Sound plays in the page: `const audio = createAudio();` once (it starts at the player's first key or click), then
  `audio.play('sfx:coin')`, or in `onFrame` each new event whose payload names one, `w.emit('lit', { sfx:
  'sfx:powerup', x, z })` in the sim: `for (const e of frame.world.events.trace()) if (e.seq > heard) { heard =
  e.seq; audio.event(e.type, e.payload); }`.
- A prop with a light (`prop:lantern`, `prop:lamp`, …) is switchable when spawned with `{ on }` or `{ group }`:
  `const id = spawnProp(w, { prop: 'prop:lantern', at: [x, 0, z], yaw: 0 }, { on: false })`, then
  `w.get(id).propLight.on = true` lights it, and `switchGroup(w, group, true)` a group.

**Characters, physics and the rest** are in the API below, area by area, and every built-in id under [Built-in ids
and the level legend](#built-in-ids-and-the-level-legend): levels as text (`compileLevel`: a tile at column c and
row r is at x = (c + 0.5) × tile, z = (r + 0.5) × tile; `level.spawns` are `{ name, position }`, `'hero'` and `'1'`
to `'9'`) and sites of buildings on a terrain (`defineSite`),
characters (`createCharacter`, Apex Legends' movement with `{ movement: 'movement:apex' }`: sprint, slide, mantle,
climb; `spawnActor`), physics (`physicsOf(w)` and its `.raycast`, `.overlap`), props, ladders, ziplines, doors,
windows and switches, crowds and steering, combat, melee and firearms (`addMelee`, `defineWeapon`), materials and
textures as data, looks and post-processing, particle emitters, sound as data, cameras (`?cam=iso`, `?cam3=chase`,
the shooter's `?cam3=shoulder`), the HUD (`engine.ui.hud`), menus and a store for saves and settings (`createMenu`,
`createStore`, `createEngine({ store, modal })`) and touch controls.

## Rules that keep play reproducible

The engine runs the same seed and the same intents to the same state, bit for bit, on every machine. Keep these in
the sim (a scene's `setup`, `step` and systems) and replays, `__engine.hash()` and capture and restore keep working:

- No `Date`, timers, `Math.random`, DOM, network or storage in the sim. Randomness from `w.rng`, time in steps.
- Write the standard `Math` (the sim swaps in portable versions while it steps), but never keep a `Math` function in a
  variable, and write `Math.pow`, not `**`.
- Keep the sim's state in components, not in variables beside it; loop over entities in `w.query`'s order.
- Presentation never writes the sim: the camera, looks, particles, sound and the HUD change nothing a hash sees.
- Units: metres, seconds, radians; +Y up, x east, z south; characters face +Z.

## Make it look different

How a game looks is data, apart from how it plays: a _look_ is a material style, a chain of filters and a sky. The
same game can be a storybook, a film or pixel art with nothing else changed, and no look changes a replay or a hash.

- **Pick a look:** `?post.look=look:storybook` in the URL. To make it the game's own, set it where game.html sets its
  camera: `if (!search.has('post.look')) search.set('post.look', 'look:storybook');`. Live, from the console:
  `__engine.set('post.look', 'look:cinematic')`.
- **Lay looks on and tune them:** `post.combine` lays looks over the one drawn, each `{ look, amount, only, filters }`
  (`amount` 0 to 1, `only` some of its filters, `filters` changes to them); `post.filters` changes filters field by
  field; `post.strength` (0 to 1) fades the whole result. In a URL their values are JSON:
  `?post.combine=[{"look":"look:vignette/soft","amount":0.6}]&post.filters={"grade":{"scope":"all","saturation":1.3}}`.
- **Where a filter applies:** its `scope`: `'all'`, `'characters'` (the actors' and crowds' bodies), `'objects'`
  (props), `'environment'` (the rest: the level, the terrain, stand-in boxes, the sky), two joined by `+`
  (`'characters+objects'`), or `'off'`. Every filter has an `amount`, 0 (as if it were off) to 1.
- **Make your own:** `defineLook` before `createEngine`, then pick it like any look:

  ```js
  defineLook('look:warm-tale', {
    description: 'A storybook with soft corners and inked heroes.',
    combine: [{ look: 'look:storybook' }, { look: 'look:vignette/soft', amount: 0.6 }],
    filters: { outline: { scope: 'characters', width: 2 }, grade: { scope: 'all', temperature: 0.2 } },
  });
  ```

- **Read it back:** `__engine.look()` gives the look drawn now: its id, the looks laid on, the strength, and every
  filter that is on with its scope, amount and numbers; its `filters` pasted into a `defineLook` keeps the picture.

How they combine: a look's `combine` goes on first, layer by layer, then its own `filters`, each of which replaces a
layer's filter of its name whole, its unwritten fields at their defaults (so `look:warm-tale` inks only the
characters, though `look:storybook` inks everything). A layer at an `amount` below 1 fades in a filter the chain lacks
(its `amount` scaled) and moves one the chain has that far: numbers move, colours mix, and choices (a scope, a kind)
switch from 0.5. A filter stays off
until something gives it a scope: `grade: { temperature: 0.2 }` alone does nothing. A layer never turns a filter off,
nor does `scope: 'off'` in a look's own `filters`: leave a layer's filter out with `only`, or set its scope to `'off'`
in that layer's `filters`; `post.filters`, applied last, turns one off outright. Only filters are laid on: the style,
the sky and the rest come from the look `post.look` names. Changing a filter's numbers, scope or amount, or the looks
laid on, builds no shader. Every look, what it draws, and every filter are under [Looks and
filters](#looks-and-filters), below game.html.

## Look inside a running game

The browser console has `__engine`: `__engine.help()` lists it all; `step(n)`, `hash()`, `state('round')`,
`set('game.gems', 20)`, `seed(7)`, `camera.set('cam=iso')`, `look()`, and `describe('material')`, a kind's fields and
ids. The URL takes the same: `?seed=7&game.gems=20&cam=iso`.
Errors name their fix, and docs/ERRORS.md in the engine's repository lists every code.

## Versions

The head's URLs pin three.js and Rapier, and take the engine at `@main`, its latest: jsDelivr serves a new commit
within 12 hours, and a browser may keep the copy it loaded for up to 7 days (jsDelivr's cache header). To freeze a
game on one engine, replace `main` with a commit of https://github.com/michaelcrosato/my-3dge in its two engine URLs
(`my3dge.js`, `my3dge.css`).

More: the engine's repository has the full guide (docs/GAME-GUIDE.md), every export (docs/API.md) and the source. An
agent that can run commands and wants the engine's checks too can start from the repository's README instead.
License: MIT; `my3dge.js` carries @stdlib functions (Apache-2.0): see LICENSE beside this file.

## game.html

<!-- lean:game:start -->
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <title>Gem run: a my-3dge game</title>
    <!--
      A whole game in one page: run round an arena collecting the gems before the clock runs out. Make your game by
      changing this file (lean/README.md says how). Open it in a browser with WebGPU: double-click it, or serve its
      folder. The block below loads the engine, three.js and Rapier from jsDelivr; keep it as it is.
    -->
    <!-- lean:head:start -->
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/michaelcrosato/my-3dge@main/lean/my3dge.css" />
    <script type="importmap">
      {
        "imports": {
          "my3dge": "https://cdn.jsdelivr.net/gh/michaelcrosato/my-3dge@main/lean/my3dge.js",
          "three": "https://cdn.jsdelivr.net/npm/three@0.182.0/build/three.webgpu.js",
          "three/webgpu": "https://cdn.jsdelivr.net/npm/three@0.182.0/build/three.webgpu.js",
          "three/tsl": "https://cdn.jsdelivr.net/npm/three@0.182.0/build/three.tsl.js",
          "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.182.0/examples/jsm/",
          "@dimforge/rapier3d-simd-compat": "https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-simd-compat@0.21.0/dist/rapier.mjs"
        }
      }
    </script>
    <!-- lean:head:end -->
    <style>
      html,
      body {
        margin: 0;
        height: 100%;
        overflow: hidden;
        background: #15171c;
      }
      canvas {
        display: block;
        width: 100vw;
        height: 100dvh;
        outline: none;
        touch-action: none;
      }
      #msg {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        font:
          18px system-ui,
          sans-serif;
        color: #c9ccd4;
        text-align: center;
        white-space: pre-line;
        pointer-events: none;
      }
    </style>
    <script>
      // Until the engine starts, a script that fails shows here in one line, never as a blank page.
      window.__engine = { ready: false, errors: [] };
      function failed(message) {
        if (typeof window.__engine.help === 'function') return; // the engine shows its own errors
        window.__engine.errors.push({
          code: 'APP_START',
          message: message,
          fix: 'the browser console names the cause',
        });
        document.getElementById('msg').textContent = 'The game failed to start: ' + message;
      }
      addEventListener('error', (event) => failed(event.message || 'a script failed to load'));
      addEventListener('unhandledrejection', (event) => failed(String(event.reason?.message ?? event.reason)));
    </script>
  </head>
  <body>
    <canvas id="view"></canvas>
    <div id="msg" role="status">Loading…</div>
    <script type="module">
      import {
        addLevelBodies,
        compileLevel,
        createCharacter,
        createEngine,
        defineComponent,
        defineScene,
        defineSettings,
        physicsOf,
        spawnActor,
      } from 'my3dge';

      // ---- The sim: everything that decides play. It runs 60 steps a second, the same on every machine. ----

      // The arena as text: # wall, . floor, P pillar, w low wall (jump it), @ the player's spawn. 1 m a character.
      const ARENA_TEXT = `---
description: The arena. 18 × 14 m inside walls, two pillars, two low walls to jump, the player's spawn.
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
      const ARENA = compileLevel(ARENA_TEXT, { file: 'game.html', name: 'arena' });

      // Settings: change them from the URL (?game.gems=20) or the console (__engine.set('game.gems', 20)).
      defineSettings({
        'game.gems': {
          type: 'integer', default: 10, minimum: 1, maximum: 40, when: 'scene', description: 'How many gems.',
        },
        'game.seconds': {
          type: 'number', default: 30, minimum: 5, maximum: 600, unit: 's', when: 'scene', description: 'The clock.',
        },
        'game.speed': {
          type: 'number', default: 6, minimum: 1, maximum: 20, unit: 'm/s', when: 'scene', description: 'Run speed.',
        },
      });

      // Components: data on entities. A component with x and z in metres and a material is drawn by the page.
      defineComponent('gem', {
        description: 'A gem to collect.',
        fields: {
          x: { type: 'number', default: 0, unit: 'm', description: 'East.' },
          y: { type: 'number', default: 0.5, unit: 'm', description: 'Up.' },
          z: { type: 'number', default: 0, unit: 'm', description: 'South.' },
          yaw: { type: 'number', default: 0, unit: 'rad', description: 'Its spin.' },
          size: { type: 'number', default: 0.4, unit: 'm', description: 'Its size.' },
          material: { type: 'string', default: 'material:glow', description: 'How it is drawn.' },
        },
      });
      defineComponent('round', {
        description: 'The round: gems collected, steps left on the clock, and whether it is playing, won or lost.',
        fields: {
          gems: { type: 'integer', default: 0, description: 'How many gems.' },
          collected: { type: 'integer', default: 0, description: 'How many are collected.' },
          left: { type: 'integer', default: 0, description: 'Steps left on the clock (60 a second).' },
          state: { type: 'string', default: 'playing', description: "'playing', 'won' or 'lost'." },
        },
      });

      const REACH = 0.8; // how close the player's feet come to a gem to collect it, m
      const START = ARENA.spawns.find((spawn) => spawn.name === 'hero').position;

      // Scatters the gems over floor tiles at least 3 m from the spawn, drawn from the named random stream 'gems'.
      function scatterGems(w, count) {
        const tiles = [];
        ARENA.tiles.forEach((char, i) => {
          const [x, z] = [((i % ARENA.cols) + 0.5) * ARENA.tile, (Math.floor(i / ARENA.cols) + 0.5) * ARENA.tile];
          if (char === '.' && Math.hypot(x - START[0], z - START[2]) >= 3) tiles.push([x, z]);
        });
        const rng = w.rng('gems');
        for (let k = 0; k < count && tiles.length > 0; k++) {
          const [[x, z]] = tiles.splice(rng.int(0, tiles.length - 1), 1);
          w.spawn({ gem: { x, z, yaw: rng.range(0, Math.PI) } });
        }
      }

      // Ends the round: the player stops, and the event says how it ended.
      function endRound(w, round, state) {
        round.state = state;
        for (const e of w.query('actor')) {
          e.actor.player = false;
          e.actor.intents = {};
        }
        w.emit(state, { collected: round.collected, gems: round.gems });
      }

      // A system: spins the gems and collects those an actor reaches (a despawn waits for the step's end).
      function collect(w) {
        const [{ round }] = w.query('round');
        for (const gem of w.query('gem')) gem.gem.yaw += 2 * w.dt;
        if (round.state !== 'playing') return;
        const taken = new Set();
        for (const { actor } of w.query('actor')) {
          for (const gem of w.query('gem')) {
            if (taken.has(gem.id) || Math.hypot(gem.gem.x - actor.x, gem.gem.z - actor.z) > REACH) continue;
            taken.add(gem.id);
            w.despawn(gem.id);
            round.collected += 1;
            w.emit('gem', { id: gem.id, collected: round.collected });
          }
        }
        if (round.collected >= round.gems) endRound(w, round, 'won');
      }

      // A system: the clock counts whole steps, never summed seconds; at 0 the round is lost.
      function clock(w) {
        const [{ round }] = w.query('round');
        if (round.state !== 'playing') return;
        round.left = Math.max(0, round.left - 1);
        if (round.left === 0) endRound(w, round, 'lost');
      }

      // The scene: the level, its physics, and what happens when it starts.
      const play = defineScene('game:play', {
        description: 'Run round the arena collecting the gems before the clock runs out.',
        level: 'level:arena',
        physics: true,
        setup(w) {
          addLevelBodies(physicsOf(w), ARENA);
          const gems = w.settings.get('game.gems');
          w.spawn({ round: { gems, left: Math.round(w.settings.get('game.seconds') * w.hz) } });
          scatterGems(w, gems);
          const character = createCharacter({ speed: w.settings.get('game.speed'), jumpSpeed: 9 });
          const anim = { build: 'build:chibi', weapon: 'none' }; // a humanoid that animates itself
          spawnActor(w, { at: [START[0], START[1], START[2]], character, player: true, anim });
          w.systems.add('game.collect', collect, { phase: 'rules' });
          w.systems.add('game.clock', clock, { phase: 'rules' });
        },
      });

      // ---- The page: draws the run and shows the HUD. It only reads the sim, never changes it. ----

      const search = new URLSearchParams(location.search);
      if (!search.has('cam') && !search.has('cam3')) search.set('cam3', 'chase'); // the camera follows the player
      let engine = null;
      let ended = false;

      // Each drawn frame: the gems, the clock, the keys, and how the round ended.
      function showRound({ world }) {
        const entity = world.query('round')[0];
        if (!engine || !entity) return;
        const { gems, collected, left, state } = entity.round;
        engine.ui.hud('gems', `Gems ${collected} / ${gems}`, { at: 'top-left' });
        const color = left < 10 * world.hz ? '#ff8f6b' : '';
        engine.ui.hud('clock', `${Math.ceil(left / world.hz)} s`, { at: 'top-right', color });
        engine.ui.hud('keys', 'WASD: run · Space: jump · Shift: dash', { at: 'bottom', keys: true });
        ended = state !== 'playing';
        engine.ui.hud('end', ended ? `${state === 'won' ? 'Every gem!' : 'Time!'} Enter: play again` : null, {
          at: 'top',
        });
      }

      engine = await createEngine({
        canvas: document.querySelector('#view'),
        scenes: [play.id],
        levels: { 'level:arena': { text: ARENA_TEXT, file: 'game.html' } },
        search: `?${search}`,
        onFrame: showRound,
      });
      document.getElementById('msg').hidden = true;

      // Enter after a round: the next round, on the next seed.
      addEventListener('keydown', (event) => {
        if (event.code === 'Enter' && ended) engine.inspector.seed(engine.inspector.seed() + 1);
      });
    </script>
  </body>
</html>
```
<!-- lean:game:end -->

## Looks and filters

<!-- lean:looks:start -->
**Whole looks**, each with what it draws (its style and sky where it names them, its filters and their scopes):

- `look:16-bit`: The whole scene as 16-bit pixel art with a slightly vivid grade. _filters pixel, grade._
- `look:anime-action`: An action frame: comic cel bands, bold lines and speed lines. _filters cel, outline, speedlines._
- `look:arcade-cabinet`: An arcade cabinet: a curved tube's grille, glow and lines. _filters bloom, scanlines, crt, screen._
- `look:arcade-crt`: Low resolution on a curved tube with scanlines, glow and colour fringes. _filters bloom, scanlines, chroma, screen._
- `look:cartoon`: Toon shading everywhere, bold ink outlines and vivid colour. _style toon; filters outline, grade._
- `look:cinematic`: A film: teal and orange, anamorphic streaks, soft corners and widescreen bars. _filters streaks, grade, split, vignette, letterbox._
- `look:clean`: No filter: the picture as the scene draws it, in its own style. _nothing._
- `look:comic-book`: Printed dots on the world, inked heroes, punchy colour. _filters outline, stylize (environment), grade (characters+objects)._
- `look:comic-noir`: A black-and-white world; the characters and objects keep their colour, inked. _filters outline, grade (environment), screen._
- `look:flat-paper`: Flat colours, thin outlines and a faded grade, like a printed page. _style flat; filters outline, grade, grain._
- `look:game-boy`: Everything in four greens, pixelated and dithered. _filters pixel, palette._
- `look:game-boy-world`: The environment in four Game Boy greens; the characters and objects in full colour with ink outlines. _filters palette (environment), outline (characters+objects)._
- `look:hacker-terminal`: The game as green characters on a curved, scanlined screen. _filters stylize, scanlines, screen._
- `look:hd-2d`: Pixel-art characters and objects in a soft, glowing 3D world with dark corners. _filters bloom, pixel (characters+objects), grade (environment), screen._
- `look:hologram-heroes`: Characters and objects flicker like holograms: cool, scanlined and fringed. The world stays clean. _filters bloom, grade (characters+objects), scanlines (characters+objects), grain (characters+objects), chroma (characters+objects)._
- `look:lamplit-fog`: A foggy night where every lamp glows in the air. _filters air, grade._
- `look:miniature`: A model railway: tilt-shift blur, crisp and bright colours. _filters tiltshift, sharpen, grade._
- `look:newspaper`: Black dots on cream paper, everything. _filters stylize._
- `look:oil-painting`: The whole scene in oil paint: flat strokes, brush streaks, canvas. _filters stylize, grade._
- `look:painted-world`: A painted backdrop; the characters and objects stay sharp and inked on top of it. _filters outline (characters+objects), stylize (environment)._
- `look:pixel-heroes`: A clean, sharp world; the characters and objects are outlined pixel art. _filters pixel (characters+objects)._
- `look:pixel-world`: The environment is pixel art; the characters and objects stay sharp and inked. _filters pixel (environment), outline (characters+objects)._
- `look:posterized-world`: The environment in a few flat shades; the characters and objects in full colour. _filters palette (environment)._
- `look:red-coat`: A grey film where only red keeps its colour, grainy and dark at the edges. _filters grade, selective, vignette, grain._
- `look:riso-print`: A risograph print: ember duotone, plates out of register, newsprint. _filters misregister, paper, duotone._
- `look:sketchbook`: Pencil hatching and contours on paper. _filters stylize._
- `look:sketched-world`: A coloured-pencil world; the characters and objects inked on top of it. _filters outline (characters+objects), stylize (environment)._
- `look:storybook`: A storybook: watercolour on cold-pressed paper with a thin ink line. _filters watercolor, outline, paper._
- `look:sunbeams`: Dusty air, sunlight streaming through the gaps, a soft glow. _filters air, bloom._
- `look:vhs-tape`: A home video: worn tape, soft scanlines, noise and dark corners. _filters scanlines, vhs, vignette, grain, chroma._

**One-filter presets**, `look:<group>/<name>`: each turns its one filter on over everything, to draw alone or lay
on with `combine` (the `shading` group sets the material style instead, and `screen` the screen's own glass):

- `aa`: smooth
- `air`: clear-air, dusty-sunbeams, lamplight, light-haze, morning-mist, pea-soup, smoky-hall
- `ao`: corners
- `bloom`: dreamy, neon, no-glow, soft
- `cel`: comic
- `crt`: arcade-tube
- `dof`: portrait
- `duotone`: dusk, ember, ocean
- `flare`: sun
- `gi`: bounce-light
- `grade`: bleach-bypass, cool, faded, lifted, neutral, night, noir, sepia, vivid, warm
- `grain`: clean, film, glitch, vhs
- `lens`: barrel, fisheye
- `letterbox`: film, widescreen
- `misregister`: risograph
- `outline`: bold, hand-drawn, heavy-ink, ink, none, thin
- `palette`: 1-bit, 512-colours, amber, cga, full-colour, game-boy, pico-8, posterize
- `paper`: canvas, kraft, newsprint, watercolour-paper
- `pixel`: 16-bit, 8-bit, bold, chunky, classic, dithered, fine, giant
- `scanlines`: arcade, fine, heavy, soft
- `screen`: crt, flat-screen, low-res, old-tv, soft-vignette
- `selective`: green, red
- `shading`: as-authored, cartoon, flat-2d, smooth-lit, toon-3-band
- `sharpen`: crisp
- `speedlines`: action
- `split`: moonlight, teal-orange
- `ssr`: metal
- `streaks`: anamorphic
- `stylize`: colour-ascii, coloured-pencil, comic-print, fine-print, gouache, loose-sketch, newsprint, off, oil-paint, pencil, terminal, thick-impasto, underpainting
- `tiltshift`: miniature
- `vhs`: worn-tape
- `vignette`: heavy, soft
- `watercolor`: wash, wet

**The filters**, in the order the chain draws them, each `{ scope, amount, … }` in a look's `filters` or in
`post.filters`, with each field's default and range; colours are `'#rrggbb'`. A filter marked (the whole picture)
takes only `'all'` or `'off'`; the rest also take `'characters'`, `'objects'`, `'environment'` or two joined by
`+`.

- `ao` (the whole picture): Ambient occlusion (GTAO, engine/gfx/post/shading.ts): creases and corners darken; never scoped. `strength` 1 (0–2), `radius` 0.6 (0.05–4 m).
- `gi` (the whole picture): Bounce light (12 taps a pixel): lit surfaces colour their neighbours, with soft occlusion; never scoped. `strength` 1 (0–4), `radius` 1.6 (0.1–6 m).
- `ssr` (the whole picture): Screen-space reflections on metal surfaces (SSRNode), blurred on rough ones; never scoped. `strength` 1 (0–1), `distance` 6 (0.5–50 m), `thickness` 0.15 (0.01–2 m).
- `air` (the whole picture): Hazy air with light shafts where the sun breaks through, and halos round lamps; never scoped. `haze` 0.35 (0–3), `height` 4 (0.2–20 m), `shafts` 1 (0–3), `forward` 0.4 (-0.9–0.95), `halos` 0.3 (0–3).
- `bloom` (the whole picture): Bright parts glow (three.js's BloomNode), before the composite, never scoped. `strength` 0.6 (0–3), `threshold` 0.9 (0–4), `radius` 0.4 (0–1).
- `aa` (the whole picture): Edge smoothing over the picture before the filters (engine/gfx/post/aa.ts).
- `lens` (the whole picture): Lens distortion: barrel (above 0) or pincushion (below), zoomed so the corners stay filled. `distortion` 0.12 (-0.5–0.5).
- `dof` (the whole picture): Depth of field: sharp round the focus, blurred nearer and farther, as a camera lens draws it. `focus` 0 (0–500 m), `range` 8 (0.5–60 m), `blur` 6 (0–24 px).
- `tiltshift` (the whole picture): Tilt-shift: a sharp horizontal band, the rest blurred, so the scene looks like a miniature. `center` 0.55 (0–1), `width` 0.18 (0.02–0.8), `blur` 8 (0–24 px).
- `flare` (the whole picture): Lens flare: ghosts of the brightest parts mirrored through the centre of the screen. `intensity` 0.6 (0–3), `threshold` 0.8 (0–1), `spacing` 0.25 (0.05–0.6).
- `streaks` (the whole picture): Anamorphic streaks: bright parts drawn out sideways in a tinted line. `intensity` 0.6 (0–3), `threshold` 0.75 (0–1), `length` 48 (4–160 px), `tint` '#5f8dff'.
- `sharpen`: Sharpen: an unsharp mask that crisps edges and texture. `strength` 0.5 (0–2), `radius` 1 (0.5–4 px).
- `misregister`: Print misregistration: the red and blue plates offset, as on a cheap print. `offset` 1.2 (0–8 px), `angle` 30 (-180–180 °).
- `cel`: Comic cel: light in flat bands keeping each colour hue, pushed colour, ink at sharp changes. `bands` 4 (2–8), `punch` 1.3 (0–3), `ink` 0.9 (0–1), `inkWidth` 1.5 (0.5–4 px).
- `pixel`: Pixel art: whole blocks on the scoped parts and on objects tagged pixel art. `size` 4 (0–32 px), `levels` 0 (0–64), `outline` true, `snap` true, `smooth` false.
- `palette`: Colour reduction: levels per channel or a fixed palette, with ordered (Bayer) dithering. `palette` 'none' (none|gameboy|pico8|cga|1bit|amber), `levels` 8 (0–64), `dither` 0 (0–1).
- `watercolor`: Watercolour: colour bleeds, darkens where washes meet, granulates in the paper and wobbles. `wobble` 2.5 (0–8 px), `bleed` 0.3 (0–1), `edges` 0.45 (0–1), `granulation` 0.35 (0–1).
- `outline`: Outlines where depth jumps, surfaces crease or outline groups meet. `width` 1 (1–4 px), `lines` 0 (0–2160), `darken` 0.35 (0–1), `color` '', `depth` 0.02 (0.001–1), `crease` 0.6 (-1–1), `fade` 0 (0–1), `fadeStart` 25 (0–500 m), `fadeEnd` 120 (1–2000 m), `wobble` 0 (0–4 px), `boil` 0 (0–24).
- `stylize`: Painterly and print styles: oil paint, CMYK halftone, ASCII and pencil. `style` 'paint' (paint|halftone|ascii|sketch), `size` 4 (1–24 px), `mix` 1 (0–1), `color` 1 (0–1).
- `paper`: Paper or canvas under the picture: it tints and textures the light areas, ink stays dark. `kind` 'newsprint' (newsprint|coldpress|canvas|kraft), `scale` 1 (0.25–4 ×), `strength` 0.4 (0–1), `color` '#f3ead3'.
- `grade`: Colour grading. `temperature` 0 (-1–1), `tint` 0 (-1–1), `contrast` 1 (0–3), `brightness` 1 (0–3), `saturation` 1 (0–3), `lift` 0 (-0.3–0.3), `gamma` 1 (0.5–2), `vibrance` 0 (-1–1), `hue` 0 (-180–180 °), `sepia` 0 (0–1), `bleach` 0 (0–1).
- `split`: Split toning: the shadows toward one colour and the highlights toward another. `shadows` '#2e5f8a', `highlights` '#ffb46b', `balance` 0 (-1–1).
- `selective`: Selective colour: every colour but one turned grey (a red coat in a grey film). `hue` 0 (0–360 °), `range` 35 (5–120 °).
- `duotone`: Gradient map: brightness mapped onto a dark, a middle and a light colour (duotone, tritone). `dark` '#1b1442', `mid` '#b04a6f', `light` '#fff1c9'.
- `scanlines`: Dark lines across the screen, as on a tube. `strength` 0.5 (0–1), `period` 3 (1–16 px).
- `crt` (the whole picture): A CRT's glass: phosphor glow, an aperture grille and a flicker (curvature: screen; lines: scanlines). `mask` 0.25 (0–1), `glow` 0.25 (0–1), `flicker` 0.1 (0–1).
- `vhs` (the whole picture): VHS tape: rows slipping sideways, colour bleeding to the right, snow in a rolling band. `jitter` 0.5 (0–1), `bleed` 0.5 (0–1), `noise` 0.3 (0–1).
- `speedlines` (the whole picture): Speed lines: comic-book streaks round a clear centre, redrawn 12 times a second. `density` 0.6 (0–1), `clear` 0.35 (0–0.9), `x` 0.5 (0–1), `y` 0.5 (0–1), `color` '#ffffff'.
- `vignette` (the whole picture): A vignette: the corners toward a colour, round or following the screen, soft or hard. `strength` 0.45 (0–1), `softness` 0.5 (0.05–1), `roundness` 1 (0–1), `color` '#000000'.
- `grain`: Film grain that changes every frame. `amount` 0.35 (0–1).
- `chroma`: Colour fringes: red and blue pulled apart toward the screen edges. `amount` 0.5 (0–1).
- `letterbox` (the whole picture): Letterbox bars that crop the picture to a film aspect ratio. `aspect` 2.39 (1.2–2.8), `color` '#000000'.
- `screen` (the whole picture): The screen itself: CRT curvature, a vignette, low resolution. `curvature` 0 (0–0.5), `vignette` 0 (0–1), `pixelate` 1 (1–16 px).

**A look's other fields** (`defineLook(id, { description, filters, combine, … })`):

- `style`: The material style everything is drawn in (lambert, toon, flat, pbr); '' keeps the scene's own.
- `sky`: The sky preset that lights the scene (a 'sky' id: sky:hall, the torch-lit hall); '' keeps the scene's own lights.
- `skyGradient`: How much of the sky's dome is a clean gradient, horizon haze to zenith, instead of daylight's model.
- `toon`: The toon style's bands, rim, shade and dither, used when the style is 'toon'.
- `shells`: Outline shells round the props and bodies (engine/gfx/stageShells.ts), drawn in front of the sky.
- `resolution`: The resolution mode it is drawn at while gfx.resolution is 'auto' (pixels, balanced or full); '' keeps the engine's pixels.
- `textures`: How every material's textures are filtered: 'smooth' blends their texels, 'pixel' keeps them crisp; '' keeps each texture's own.
- `perspective`: The look drawn instead while the camera is a perspective one (its variant: same style, sky, resolution and textures); '' keeps this.
- `strength`: How much of the whole look shows, 0 to 1: every filter's amount is scaled by it, so 0 draws the scene clean.
<!-- lean:looks:end -->

## Built-in ids and the level legend

<!-- lean:ids:start -->
**Built-in ids**, by kind, as a scene names them (`material: 'material:glow'`, `spawnProp(w, { prop: 'prop:bench',
at: [x, 0, z], yaw: 0 })`); `__engine.describe('<kind>')` in a running page lists a kind's fields, and
`define<Kind>` adds your own.

- `sky:` dawn, daylight, dusk, hall, night, noon. Sky presets.
- `material:` asphalt, barrel, barrelLid, barrelStaves, blobShadow, brick, carpet, checker, cloth, concrete, crate, default, flagstone, flame, glass, glow, iron, paint, planks, puppet, puppetGlow, puppetHalo, shingles, siding, stone, tiles, wallpaper, wood. Materials as data with three.js's classic parameters.
- `texture:` asphalt, brick, carpet, checker, concrete, crate, dirt, flagstone, glass, grass, metal, moss, planks, plaster, runes, shingles, siding, staves, stone, tiles, wallpaper, water, wood. Seeded, periodic texture generators.
- `geometry:` box, frustum, limb, pillar, ramp, ring, roundedBox. Shapes props, levels and bodies name by id.
- `prop:` banner, barrel, bench, brazier, chair, chest, crate, door, garageDoor, lamp, lantern, pane, pillar, sconce, statue, switch, table. Props: things that stand in a level, as data: meshes (geometry and material by id), a body, an optional light spot, where a level places them, and interaction hooks.
- `light:` torch. What a level's light spot shines with.
- `emitter:` bits, block, bubbles, confetti, destroyed, dust, embers, explosion, fire, fireflies, fountain, glass, glints, hit, impact, land, magic, rain, shatter, shot, slain, slam, smoke, snow, sparks, splinters, steam. Emitters. Burst by a sim event of the type: block, destroyed, explosion, glass, hit, land, shatter, shot, slain, slam, splinters. Running at a rate (lay them into your own): bubbles, confetti, dust, embers, fire, fireflies, fountain, magic, rain, smoke, snow, sparks, steam.
- `telegraph:` arc, cone, line, ring. Telegraphs.
- `sfx:` blip, bodyFall, boom, bump, cancel, charge, climbGrip, coin, confirm, crouchCloth, die, door, doorBreak, doorClose, doorLocked, doorOpen, drawGun, drumCrash, drumHat, drumKick, drumOpenHat, drumSnare, drumTom, dryFire, explode, glassBreak, grab, heal, hit, holsterGun, hurt, impactBody, impactConcrete, impactDirt, impactGlass, impactMetal, impactWood, jump, jump2, key, kick, kickHit, ladderRung, land, landBody, laser, launch, mantle, oneup, pause, pickup, pistolShot, powerup, punch, punchHit, reload, rifleShot, secret, select, shoot, slide, step, stepCarpet, stepConcrete, stepGrass, stepGravel, stepMetal, stepTile, stepWood, stomp, swing, swish, switchClick, text, warp, whoosh, wind, windowSlide, zipAttach, zipRun. A sound effect.
- `song:` adventure, boss, dungeon, title, victory. A looping tune in tracker notation.
- `body:` humanoid. Puppet bodies.
- `build:` adult, bulky, chibi, heroic, skeleton. Body proportions for the humanoid skeleton, in metres before size.
- `movement:` apex, platformer. How a character moves.
- `move:` axekick, backslash, bash, breach, cast, claw, cross, elbow, flyingkick, haymaker, hook, jab, kick, knee, overhead, plunge, rising, roundhouse, slash, spin, sweep, throw, thrust, twohand, uppercut. A named strike.
- `weapon:` gun. Firearms.
- `thing:` target. Things that can be hit.
- `actionMap:` firstPerson, platformer, shmup, thirdPerson. Named actions and the physical codes bound to each.

**The level legend**, a character a tile (`compileLevel`; `defineGlyph` adds one):

- `t`: A brazier: an iron bowl on a stone foot, 0.75 m high (a cylinder collider, 0.3125 m in radius), with a torch spot 1 m up.
- `o`: The dais: an octagonal platform 0.5 m up (a hull frustum), its edge a 1.5 m slope all round.
- `+`: A doorway in a wall, 2.1 m high: walk through; the wall stands over its head.
- `<`: A flight of stairs up to the storey above: a ramp (a hull wedge) from this floor to that one, rising toward the one side that floor meets.
- `.`: Open floor at ground level: walkable.
- `=`: A gallery: a walkway 1 m up, a block from the ground (a box collider).
- `@`: Floor with the hero's spawn point (spawn:hero).
- `|`: A ladder: open floor with a ladder against the neighbouring tile that stands highest (a wall, a tower), up to its top.
- `_`: Floor under a low ceiling 1.4 m up (a crawlspace): crouch or slide under it.
- `w`: A low wall (0.75 m): solid at ground level, but a body may jump onto it and stand on its top.
- `P`: A pillar (3.5 m), 2 × 2 tiles: write it PP over PP.
- `!`: A railing 1 m high round a landing, a deck or a stairwell: solid at ground level, a box collider.
- `^`: Stairs: a ramp from the ground up to 1 m (a hull wedge), rising toward the one side that meets a gallery.
- `~`: Void: no floor on this storey (a stairwell, a double height, the air beside a building).
- `#`: A full-height wall (3 m): solid, a box collider, nobody walks or stands on it.
- `:`: A window in a wall: solid to its sill 0.9 m up, open to its head 2.1 m up, the wall over it.
- `1` to `9`: Floor with the spawn marker n (spawn:n): where a scene places what it numbers n, such as a mover's start.
<!-- lean:ids:end -->

## The API by area

<!-- lean:api:start -->
Every name below is an export of `my3dge` (`import { createEngine, defineScene } from 'my3dge'`). Each has the
first sentence of its doc comment in docs/API.md, and its whole manual where engine/ declares it.

**Scenes**: defined as data with a setup and a step, run by x sim, x replay and createHeadless.
`defineScene`, `defineDevAction`; types `Scene`, `SceneSpec`, `SceneAction`, `SceneSound`, `DevActionSpec`.

**The world**: entities, components, systems, timers, events.
`defineComponent`, `PHASES`; types `World`, `SimRng`, `WorldTimers`, `WorldEvents`, `Entity`, `With`, `SpawnSpec`, `ComponentOf`, `Phase`, `SystemFn`.

**Registries and settings**: content as data, one schema for every setting.
`defineKind`, `def`, `defineSettings`; types `Entry`, `Kind`, `KindSpec`, `Field`, `Schema`, `SimSettings`, `SettingValue`.

**Intents**: what the sim reads from outside each step.
`held`, `pressed`, `fromCamera`, `INTENT_KEYS`, `createInputBuffer`, `updateInputBuffer`, `released`, `buffered`, `consume`, `consumeAll`, `repeated`, `BUFFER_STEPS`, `REPEAT_DELAY`, `REPEAT_RATE`; types `Intents`, `IntentValue`, `CustomIntentKey`, `InputBuffer`.

**Math**: three.js's math classes and the engine's helpers (MathUtils covers clamp, lerp, damp, smoothstep).
`Vector3`, `Quaternion`, `Matrix4`, `Euler`, `Box3`, `Sphere`, `Ray`, `Plane`, `Color`, `MathUtils`, `approach`, `angDiff`, `lerpAng`, `approachAng`, `smoothDamp`, `ease`, `swingTwist`.

**Randomness**: seeded streams (the world's are w.rng('<stream>')).
`Rng`.

**Events**: emitted with w.emit, heard with w.events.on.
types `EventMap`, `Listener`, `TraceRecord`.

**Levels**: a legend of glyphs, level text compiled to plain data (heights, solid grid, colliders, meshes, spawns).
`compileLevel`, `validateLevel`, `defineGlyph`, `defineLevel`, `getLevel`, `floorHeight`, `topHeight`, `solidAt`, `tileAt`, `LEVEL_FORMAT`; types `CompileOptions`, `LevelSource`, `LevelProblem`, `Glyph`, `GlyphSpec`, `LevelEntry`, `CompiledLevel`, `LevelGlyph`, `BoxCollider`, `ColliderDescriptor`, `GroundDescriptor`, `MeshDescriptor`, `SpawnPoint`, `LightSpot`, `TileRect`, `Point3`.

**Animation (WP 3.4)**: the humanoid skeleton (a root plus 23 joints) and its builds, poses with three.js quaternions, blending under bone masks, additive layers, forward kinematics, SVG contact sheets and the pose checks.
`JOINTS`, `SOCKETS`, `MASKS`, `createSkeleton`, `boneMask`, `defineBuild`, `getBuild`, `Pose`, `blendPoses`, `makeAdditive`, `addPose`, `hashPose`, `forwardKinematics`, `createWorldPose`, `jointPosition`, `jointRotation`, `jointMatrix`, `jointToWorld`, `socketPosition`, `tipPosition`, `animSheet`, `animCheck`, `twoBone`, `twoBoneRot`, `LIMBS`, `aim`, `AIM_CHAIN`, `footPlant`, `createFootPlantState`, `FOOT_LOCK`, `FOOT_PLANT`, `FootPlant`, `queryGround`, `handTo`; types `JointName`, `SocketName`, `MaskName`, `Skeleton`, `BoneMask`, `Build`, `BuildSpec`, `JointRef`, `BlendOptions`, `WorldPose`, `Sheet`, `SheetFrame`, `SheetOptions`, `SheetView`, `AnimCheckSpec`, `AnimCheckReport`, `AnimProblem`, `RigidPair`, `PointName`, `TwoBoneOptions`, `LimbEnd`, `Limb`, `AimOptions`, `AimLink`, `FootPlantOptions`, `FootPlantState`, `FootLock`, `FootPlantLayerOptions`, `GroundQueries`, `GroundProbe`, `GroundHit`.

**The procedural humanoid (WP 3.6)**: my-3d2dge's gait, idle, lean, arm swing, held poses and stances as effector targets written with B(forward, right, up), solved onto the skeleton; a fixed step and a seeded stream.
`Humanoid`, `POSES`, `STANCES`, `WEAPONS`, `B`, `turnRight`; types `HumanoidOptions`, `HumanoidInput`, `HumanoidState`, `HumanoidWeights`, `BodyMotion`, `PoseName`, `StanceName`, `Weapon`, `Effectors`, `FRU`, `LimbSide`, `Sided`.

**The character animator (WP 3.7)**: a body driven through an explicit layer stack (weights, base, override, solve, then layers in clips, additive, post, physics and secondary), told its body states each step (unknown words warn with the closest), with footsteps, sockets, a trail and detail levels; step runs in the sim, pose in the view.
`Animator`, `BODY_STATES`, `checkBodyStates`, `TRAILS`, `SAMPLE_STATES`, `SLOTS`, `LAYER_SLOTS`, `LOD`, `easeWeight`, `HUMANOID_WEIGHTS`; types `AnimatorOptions`, `PoseOptions`, `AnimatorReport`, `AnimEvent`, `TrailSample`, `BodyStateName`, `AnimatorInput`, `TrailName`, `SampleState`, `SlotName`, `LayerSlot`, `AnimLayer`, `WeightRates`, `WeightInfo`.

**Blob and floater rigs (WP 5.3)**: my-3d2dge's squash-and-stretch blob on a minimal skeleton (a volume-preserving squash spring, a smoothed look, wings, its moves as data: bite, leap, pounce, spit) and a floater that hovers over the floor, banks into turns and carries orbiting motes; step runs in the sim, pose in the view.
`Blob`, `BLOB`, `BLOB_JOINTS`, `BLOB_LEAP`, `BLOB_MOVES`, `blobMove`, `blobMoveTimes`, `Floater`, `FLOATER`; types `BlobOptions`, `BlobInput`, `BlobState`, `BlobJoint`, `BlobPose`, `BlobLeap`, `BlobMove`, `BlobMoveName`, `BlobMoveFrame`, `FloaterOptions`, `FloaterInput`, `FloaterState`, `FloaterPose`.

**The animation library (WP 8.4)**: readable key-pose clips (format 1 and 2: parse, print, check, the normalized lens, mirroring, the decode to 36 body points), loaded per set; baked to 30 fps rotation tracks on the skeleton, retargeted onto any build (rotation copy aligned at rest, the hip-height ratio, contact IK) or given to three.js as AnimationClip JSON; played by the clip layer in the animator's clip slot, loops at the ground speed, with shardfall's walk-run switch and strike time.
`parseClip`, `parseClipSet`, `validateClip`, `poseError`, `poseMeanError`, `clipText`, `normalizedLens`, `mirrorClip`, `decodePose`, `samplePose`, `POSE_POINTS`, `POINT_INDEX`, `bakeClip`, `sampleBaked`, `travelAt`, `BAKE_FPS`, `retargetPose`, `clipJSON`, `hipRatio`, `standingHipHeight`, `restSkeleton`, `restPoints`, `restBuild`, `RETARGET`, `loadClipLibrary`, `clipPace`, `walkRate`, `runOverWalk`, `strikeTime`, `GROUND_SPEED`, `STRIKE`, `ClipLayer`, `CLIP_LAYER`; types `ClipSet`, `ClipSource`, `RestBody`, `ClipWarning`, `Clip`, `ClipKey`, `KeyPose`, `LimbPose`, `ClipEvent`, `ClipContact`, `BakedClip`, `RetargetOptions`, `AnimationClipJSON`, `ClipLibrary`, `ClipOrigin`, `ClipLayerOptions`, `ClipPlay`, `ClipSlot`, `ClipLayerState`, `ClipLayerEvent`, `ClipStepInput`.

**Moves (WP 6.1)**: moves as data in metres (the kind move: my-3d2dge's 24, converted by Appendix C's table), timelines whose events carry leftover time, attacks and combos with hit windows, sweeps and root motion, moves played on a humanoid through its body state (the arm path), moves at a moment for previews, measured hit shapes, the cone helpers and a hit's knockback velocity.
`defineMove`, `getMove`, `resolveMove`, `MOVE_PHASES`, `LEGACY_FIELDS`, `fromLegacy`, `Timeline`, `Attack`, `Combo`, `moveAt`, `measureMove`, `strikePart`, `strikeSegment`, `inArc`, `inHitShape`, `knockbackVelocity`; types `Move`, `MoveSpec`, `MoveInput`, `MovePhase`, `LegacyMove`, `TimelinePhase`, `TimelineMark`, `TimelineEvent`, `TimelineState`, `AttackState`, `ComboState`, `Sweep`, `HitShape`, `StrikeBody`, `StrikeAnimator`, `ArmState`.

**Reactions and secondary motion (WP 6.2)**: a directional flinch, knockdown, death and the get-up chosen by how the body lies (face up or face down), stepped in the sim; verlet chains (hair, tails) with bone-capsule colliders, a floor probe and a rest shape, a cape of two chains, and the squash spring as a volume-preserving root scale, drawn by an animator layer in the view.
`Reactions`, `REACTION`, `REACTIONS`, `lyingOf`, `Chain`, `CHAIN`, `Cape`, `Secondary`, `HAIR`, `CAPE`, `TAIL`, `SQUASH`, `squashScale`, `BODY_CAPSULES`, `bodyCapsules`; types `ReactionOptions`, `ReactionState`, `ReactionBody`, `ReactionName`, `Lying`, `ChainOptions`, `ChainTuning`, `BoneCapsule`, `CapeOptions`, `SecondaryOptions`.

**Animation checks (WP 6.6)**: the state matrix (each body state held at each facing, from rest and back to rest) and animCheckBody, which checks a whole body over it: every pose, the same hashes twice, 1/60 s against 1/120 s; and the camera presets sheets of it are drawn from.
`stateMatrix`, `STATE_MATRIX`, `animCheckBody`, `SHEET_CAMERAS`; types `MatrixState`, `MatrixRun`, `StateMatrixOptions`, `BodyCheckOptions`, `BodyCheckReport`, `AnimCheckName`.

**Actions (WP 8.7)**: multi-beat sequences a body plays, beats of body states, clips, IK targets, flips and squashes with held contact frames, events, flags and cancel windows; the engine's set is data/anim/actions/, which loadActions defines.
`Actions`, `defineAction`, `getAction`, `loadActions`, `actionCheck`, `ACTION`, `FLIP_AXES`, `EFFECTORS`, `CHANNELS`; types `ActionsOptions`, `ActionsState`, `Action`, `Beat`, `ActionSpec`.

**Clip sets in the registry (WP 8.9)**: the kind clipset, one entry per set of readable clips, which a page or tool registers from data/anim/sets/ (defineClipSet), and the clip layer of an entity kept as plain data, loaded from it at every use (ClipLayerPool), as an actor's component clips holds it.
`defineClipSet`, `clipSetFromFiles`, `getClipSet`, `clipSetId`, `clipSetIds`, `defineSetBuild`, `CLIPSET_FIELDS`, `CLIPS_FIELDS`, `emptyClipState`, `ClipLayerPool`; types `ClipSetEntry`, `ClipsData`.

**The quadruped rig (WP 13.21)**: a dog on the planted gait for a crowd body (the rig `quadruped`), its state plain data, its pose the joints its body is drawn on, and its rig contract for the anim QA.
`Quadruped`, `QUADRUPED`, `QUADRUPED_LEGS`, `QUADRUPED_RIG`; types `QuadrupedOptions`, `QuadrupedInput`, `QuadrupedState`, `QuadrupedPose`, `QuadrupedBone`.

**Physics (WP 3.1)**: Rapier behind plain terms. A scene with `physics: true` has a physics world: bodies by id, raycasts, shape casts, overlaps and ground probes, collision groups by name, a level's bodies; presentation reads it through the read-only QueryView.
`physicsOf`, `COLLISION_GROUPS`, `PHYSICS_SETTINGS`, `addLevelBodies`, `queryViewOf`; types `Physics`, `BodySpec`, `ColliderSpec`, `BodyState`, `BodyChange`, `BodyType`, `Shape`, `Vec3Like`, `QuatLike`, `Hit`, `Ground`, `QueryOptions`, `RayOptions`, `ShapeCastOptions`, `OverlapOptions`, `ProbeOptions`, `GroupName`, `QueryView`.

**Characters (WP 3.2)**: actors moved by the character controller (Rapier's, moved across then down), with an action game's feel: acceleration and skid, coyote time, a jump buffer, a variable jump, a wall jump, a dash, pushing props; the feel meter measures how one handles. A body's reactions and an actor's secondary motion as components (WP 7.8), and its actions (`actOn`, WP 13.11).
`createCharacter`, `CHARACTER_FIELDS`, `CHARACTER_STATE_FIELDS`, `spawnActor`, `removeActor`, `measureFeel`, `reactTo`, `stepReactions`, `REACTION_FIELDS`, `SECONDARY_FIELDS`, `actOn`, `ACTIONS_FIELDS`; types `Character`, `CharacterState`, `ActorSpec`, `ActorComponent`, `ActorComponents`, `FeelReport`, `FeelOptions`, `AnimatorComponent`, `SecondaryComponent`, `ReactionComponents`, `ActionComponents`.

**Levels v2 (WP 4.2)**: the hall's glyphs (gallery =, stairs ^, dais o, brazier t), ramps and daises, hull and cylinder colliders, and the surface tag underfoot.
`surfaceAt`; types `HullCollider`, `CylinderCollider`, `RampDescriptor`, `DaisDescriptor`, `Side`.

**Navigation and spatial queries (WP 4.3)**: a level's walkable grid under a climb limit (the crowd's, or a hero's jump reach from measureFeel), A* paths smoothed by line of sight, cached flow fields with reach and a look-ahead direction, and a spatial hash on typed arrays for neighbours.
`NavGrid`, `FlowField`, `NAV_GRID_FIELDS`, `NAV_DIRECTIONS`, `LOOK_AHEAD`, `NEAREST_RINGS`, `NAV_CLIMB`, `SpatialHash`, `SPATIAL_HASH_FIELDS`; types `NavGridOptions`, `FlowOptions`, `GroundPoint`, `SpatialHashOptions`.

**Bodies and props (WP 4.1)**: props of one shape in the prototype's material, torque impulses and the knock; movers, kinematic bodies whose pose is a function of time, carrying riders; sensors and triggers; the lost-body rescue.
`PROP_MATERIAL`, `addProp`, `addBox`, `addBall`, `addCapsule`, `addCylinder`, `applyTorqueImpulse`, `knock`, `MOVER_FIELDS`, `MOVER`, `moverPose`, `driveBody`, `driveMover`, `addSensor`, `sensorHits`, `TRIGGER_FIELDS`, `updateTrigger`, `rescueLost`; types `PropSpec`, `KnockOptions`, `Mover`, `SensorSpec`, `Trigger`, `RescueLevel`.

**Props as data (WP 4.5)**: the registry kind `prop` (meshes by geometry and material id, a body, a light spot, where a level places it, the hit and use hooks), the engine's crate, barrel, brazier fire and pillar, the library's sconce, banner, chest, door, table, bench, statue and lantern (WP 10.3), and their placement.
`defineProp`, `getProp`, `propCentre`, `levelProps`, `propBody`, `propPose`; types `Prop`, `PropDefinition`, `PropPart`, `PropTouch`, `PropKnock`, `PropPlacement`, `PropBody`, `PropPose`.

**Props in a scene (WP 4.6)**: spawnProp stands a prop in a running scene (its body, and an entity with the component sceneProp whose pose is read back after each step, which the view draws as the prop); hitProp calls its hit hook with the means to knock it; removeProp.
`spawnProp`, `removeProp`, `hitProp`, `SCENE_PROP_FIELDS`; types `ScenePropComponent`, `ScenePropComponents`.

**Crowd bodies (WP 5.1)**: agents as dynamic capsules and balls driven by the velocities their AI wants (approach limits, only on their feet), knockback and launches, the corpse group and its timers, spawn and despawn queues.
`CROWD_AGENT_FIELDS`, `CROWD_AGENT`, `CROWD_MATERIAL`, `CROWD_LIMITS`, `CROWD_GROUNDED`, `addAgent`, `removeAgent`, `setVelocity`, `knockback`, `launch`, `killAgent`, `updateCrowd`; types `CrowdAgent`, `AgentState`, `VelocityOptions`, `CrowdOptions`, `CrowdChanges`, `CrowdStepper`.

**Steering kit (WP 5.2)**: the velocity a crowd agent wants (seek and arrive, flow-field following, approach rings, a flyer's hover, a jumper's hop), attack tokens that cap the attackers at once, and awareness by distance and sight.
`seek`, `followFlow`, `approachRing`, `hover`, `airTime`, `hop`, `FOLLOW`, `APPROACH_RING`, `HOVER`, `HOP`, `ATTACK_TOKENS_FIELDS`, `ATTACK_TOKENS`, `takeToken`, `releaseToken`, `holdsToken`, `keepTokens`, `canSee`, `clearSight`, `SIGHT`; types `SteerPoint`, `FollowOptions`, `ApproachRingOptions`, `HoverOptions`, `AttackTokens`, `SightOptions`.

**Crowd bodies (WP 5.7)**: a crowd member's look and rig (a humanoid in a build, a blob, a floater) in the component crowdBody, its rig stepped in the sim by stepCrowdBody; the stage draws them through a crowd with its level of detail.
`CROWD_BODY_FIELDS`, `CROWD_BODY`, `stepCrowdBody`; types `CrowdBody`, `CrowdRig`, `CrowdBodyInput`.

**Telegraphs (WP 6.4)**: an attack's warning shape on the floor as data (an arc, a ring, a line or a cone, in metres), and the geometry sim code tests it with as it goes off: a body inside it is hit, one just outside it a near miss.
`TELEGRAPH_SHAPES`, `defineTelegraph`, `getTelegraph`, `telegraphGap`, `inTelegraph`, `nearMiss`, `telegraphFill`, `coneOf`; types `Telegraph`, `TelegraphSpec`, `TelegraphPlace`, `PointLike`.

**Combat helpers (WP 6.3)**: hit queries against hurt capsules found through a spatial hash (cones with height windows, weapon sweeps), damage on health and crowd bodies (knockback as momentum, launches, death into the corpse group, the event damage), hit-stop handed to the frame clock's budget, and projectiles with swept tests.
`PROJECTILE_FIELDS`, `PROJECTILE`, `stepProjectiles`, `capsuleCast`, `inCone`, `coneHits`, `sweepTouches`, `sweepHits`, `physicsWalls`, `HEALTH_FIELDS`, `HEALTH`, `damage`, `requestHitStop`; types `Projectile`, `ProjectileState`, `ProjectileStep`, `ProjectileHit`, `HurtCapsule`, `HurtSet`, `WallTest`, `WallContact`, `Health`, `DamageTarget`, `HitSpec`, `DamageEvent`, `DamageEvents`.

**Melee (WP 13.19)**: Apex's punch, kicks and the door kick, a lunge to the target in reach, one hit a swing landing at its moment with its damage and hit-stop; the fan of rays that finds what a strike reaches.
`MELEE`, `MELEE_MOVES`, `MELEE_FIELDS`, `addMelee`, `meleeTargets`, `fanHits`; types `MeleeState`, `MeleeReach`, `Fan`, `FanHit`.

**Firearms (WP 13.20)**: the kind `weapon`, a player's weapons drawn and holstered, hip fire and the sights, hitscan shots with spread and a climbing recoil, reloads.
`WEAPON_FIELDS`, `defineWeapon`, `getWeapon`, `recoilStep`, `spreadOf`, `WEAPONS_FIELDS`, `weaponsFor`, `addWeapons`; types `WeaponKind`, `WeaponSpec`, `WeaponsState`.

**Ragdolls (WP 10.2)**: joints as data, a humanoid's body handed off to physics on a hard hit or a death, lying still and getting up the way it lies.
`addJoint`, `removeJoint`, `hasJoint`, `jointBodies`, `RAGDOLL_SIM`, `RAGDOLL_FIELDS`, `addRagdolls`, `handOff`, `removeRagdollOf`, `standUp`; types `JointKind`, `JointSpec`, `RagdollState`, `RagdollHit`.

**A town's daily round (WP 13.21)**: routes walked on a schedule, and stepping aside for someone in the way.
`ROUTE_FIELDS`, `followRoute`, `ASIDE`, `stepAside`; types `RouteStop`, `RouteState`, `RouteLeg`.

**A crowd body's ground (WP 13.21)**: the physics world's, for a gait's feet (a quadruped's).
`crowdGround`.

**Clips on actors (WP 8.9)**: the clip layer in an actor's animator as sim data, the component clips, stepped at the actor's ground speed and drawn over its body by the view; its events come as `clip`. spawnActor's `body` names the body it is drawn as (body:mannequin).
`addClips`, `playClip`, `stopClip`, `seekClip`, `locomoteClips`, `clipLayerOf`; types `ClipsSpec`, `PuppetComponent`.

**Movement profiles (WP 13.3)**: the registry kind `movement`, and the shooter model (Apex's) a profile gives a character.
`defineMovement`, `getMovement`, `listMovements`, `MODEL_FIELDS`, `MOTION_FIELDS`; types `MovementProfile`, `MovementSpec`, `MovementModel`, `MovementModelSpec`, `MotionState`, `MotionFeel`.

**The feel kit, sim-side (WP 13.4)**: the shooter model's live tuning, `movement.<group>.<field>` (a setting off its default replaces that number in every model character's model, from the next step), and an actor placed at rest (a scene's dev action: a feel course's start).
`MOVEMENT_SETTINGS`, `movementOverrides`, `tuneCharacter`, `placeActor`; types `MovementOverride`.

**Rides (WP 13.7)**: ziplines, ladders and launchers as world data (engine/world/traverse.ts), placed in a scene (engine/sim/rides.ts) and ridden by the shooter model (engine/physics/movement/ride.ts, ladder.ts): a zipline and the poles under its anchors, the redeploy balloon's line and its skydive, a ladder (or every ladder a level's ladder glyph `|` stands), a jump pad or a trampoline. Use is the button `interact`; the look's pitch picks a vertical zipline's way and a skydive's dive.
`addZipline`, `addLadder`, `addLauncher`, `addLevelLadders`, `ridesOf`, `levelLadders`; types `ZiplineSpec`, `LadderSpec`, `LauncherSpec`, `Rides`, `RideCable`, `RideLadder`, `RideLauncher`.

**Storeys (WP 13.13)**: format 2, levels written as storeys, read a storey at a time or in 3D: the highest surface at or under a point, its storey (by height, or by that surface) and its room.
`LEVEL_FORMAT_2`, `storeyView`, `floorBelow`, `surfaceBelow`, `storeyAt`, `storeyBelow`, `roomAt`; types `StoreyDescriptor`, `RoomDescriptor`, `OpeningDescriptor`, `RoofDescriptor`.

**Terrain (WP 10.5)**: the registry kind `terrain`, a seeded heightfield, its queries, its body and its navigation.
`defineTerrain`, `getTerrain`, `makeTerrain`, `terrainProblems`, `TERRAIN_FIELDS`, `terrainHeight`, `terrainGradient`, `terrainNormal`, `terrainGrade`, `terrainSurface`, `scatterTerrain`, `addTerrainBody`, `terrainNavGrid`, `terrainNavSurface`; types `Terrain`, `TerrainSpec`, `TerrainEntry`, `TerrainHill`, `TerrainFlat`, `ScatterRule`, `TerrainPlace`, `TerrainNavOptions`, `NavSurface`, `NavSource`.

**Sites (WP 13.15)**: levels standing on a terrain, each placed and turned in quarter turns, the terrain cut under them; the queries over all of it, the bodies, the ladders and the navigation over every storey and the terrain.
`defineSite`, `getSite`, `makeSite`, `SITE_FIELDS`, `toWorld`, `toLocal`, `siteFloorBelow`, `siteSurfaceBelow`, `siteStructureAt`, `siteSolidAt`, `siteClearSight`, `siteRescueGrid`, `createSiteNav`, `addSiteBodies`, `addSiteLadders`; types `Site`, `SiteSpec`, `SiteStructure`, `StructureSpec`, `SiteRescueGrid`, `SiteNav`, `SiteNavOptions`.

**The scene's props as navigation blocks (WP 13.21)**: what a site's walkers go round.
`propObstacles`; types `NavBlock`.

**Use (WP 13.16)**: the system `interact` (a player's use of the thing in reach and in view, with its prompt; carrying and throwing a light prop), the kinds `usable` and `strikable`, and the body-to-entity lookup.
`addInteraction`, `defineUsable`, `defineStrikable`, `strikeEntity`, `USE_REACH`, `CARRY_MASS`, `THROW_SPEED`, `propOfBody`; types `UsableSpec`, `InteractorComponent`, `StrikeForce`, `SpawnPropOptions`, `PropHealthComponent`, `PropLightComponent`.

**Doors (WP 13.16)**: hung on a hinge or sliding, opened away from the user, locked, blocked, burst open and broken.
`addDoor`, `addLevelDoors`, `useDoor`, `strikeDoor`, `breakDoor`, `DOOR_SWING`; types `DoorSpec`, `DoorComponent`.

**Windows and breakables (WP 13.16)**: props with health and their breaking, a level's window panes, a bolt's strike.
`addLevelWindows`, `addBreakables`, `damageProp`, `breakProp`, `strikeBody`, `BREAK_SPEED`.

**Switches (WP 13.16)**: a room's lights and the garage door, as sim state the view reads.
`addSwitch`, `switchGroup`, `flipSwitch`; types `SwitchSpec`, `SwitchComponent`.

**Strikes (WP 13.19)**: a strikable entry by entity (the move a melee plays on it: a door's kick), what takes one, and whose a body is (a prop's or an actor's, WP 13.20).
`strikeEntry`, `takesStrike`, `entityOfBody`; types `StrikeEntry`.

**Light and time (WP 13.23)**: the world's clock, and the light groups it switches at dusk and dawn.
`setDaytime`, `daytimeOf`, `lightsAtDusk`, `litAt`, `DUSK`, `DAWN`; types `DaytimeComponent`, `DuskComponent`.

**Things (WP 10.4)**: what can be hit, as a range's targets and a ring's dummies: the kind `thing` (its prop, hit points, rise, track and hooks), a thing's state (hits, down and up, its place on its track), and things in a scene (spawned as their prop, struck as hits, stood back up and driven along their tracks by the system `things`).
`defineThing`, `getThing`, `thingState`, `hitThing`, `stepThing`, `thingAt`, `THING_FIELDS`, `THING_KIND_FIELDS`, `spawnThing`, `strikeThing`; types `Thing`, `ThingKind`, `ThingSpec`, `ThingTouch`, `ThingHit`, `ThingOutcome`, `ThingStanding`.

**Projectile patterns (WP 10.4)**: a shot emitter's volleys (aimed, forward, ring, spiral, random) and timing (delay, interval, bursts and their pause, range), and the shots it looses over WP 6.3's projectiles.
`SHOT_EMITTER`, `SHOT_EMITTER_FIELDS`, `PATTERNS`, `MOST_VOLLEYS`, `volley`, `stepVolleys`, `loose`, `direction`, `headingTo`; types `ShotEmitter`, `Pattern`, `VolleyAim`, `LooseOptions`.

**Awareness (WP 10.4)**: beyond WP 5.2's sight, the noises an agent hears and its memory of where it last saw or heard.
`AWARENESS`, `AWARENESS_FIELDS`, `AWARENESS_STATES`, `sense`, `hears`, `earshot`; types `Awareness`, `AwarenessState`, `Noise`, `SenseInput`, `Sensed`.

**Springs and blends (WP 10.1)**: numbers, vectors and turns on exact damped springs with kicks; named weights eased up and down; the pose stack, angles averaged round the circle, a pitch and a yaw as a direction.
`Spring1`, `Spring3`, `SpringQuat`, `StateWeights`, `layerPose`, `blendAngles`, `aimDirection`; types `SpringOptions`, `BlendRates`, `PoseLayer`.

**Legs and bodies (WP 10.1)**: the digitigrade leg's reverse knee; sway chains and lagging parts; the planted gait for N legs in groups, its feet on raycast ground or gripping walls; path chains following their head.
`digitigrade`, `SwayChain`, `LagPart`, `LegGait`, `PathChain`; types `DigitigradeLeg`, `DigitigradeFrame`, `DigitigradeSolve`, `SwayOptions`, `LagOptions`, `GaitLeg`, `GaitOptions`, `GaitFoot`, `GaitProbe`, `GaitBody`, `PathOptions`.

**Faces and floating parts (WP 10.1)**: looking within bounds and blinking from a named stream; hovering, banking, leaning and folding; orbiters and detached parts; pose history played back late; extras on sockets; tip trails.
`LookAt`, `Blink`, `Hover`, `Orbiters`, `DetachedPart`, `PoseHistory`, `socketMatrix`, `placeExtras`, `along`, `alongDirection`, `TipTrail`; types `LookAtOptions`, `BlinkOptions`, `HoveringOptions`, `OrbitOptions`, `DetachedOptions`, `HistoryOptions`, `Socket`, `SocketJoints`, `TrailOptions`, `TipSample`.

**Reach and the rig contract (WP 10.1)**: an attack's reach measured off its animation; what a procedural rig names (its points, bones, feet and states) and the check it passes, as anim.check holds the humanoid.
`measureReach`, `driveRig`, `rigCheck`, `rigClosed`; types `ReachPose`, `ReachOptions`, `Reach`, `ProcRig`, `ProcRigBody`, `RigRun`.

**Footsteps (WP 13.22)**: which step a surface tag plays at a gait, sound data a scene's sound map reads sim-side.
`footstepSound`, `stepGait`, `SURFACE_STEPS`, `STEP_GAITS`; types `StepGait`.

For the page (the browser side), not for code that runs in the sim:

**Headless**: the engine without a page, and its inspector (window.__engine in a page).
`createHeadless`; types `Headless`, `HeadlessOptions`, `Inspector`, `EngineInfo`, `EntitySummary`.

**Materials and procedural textures (WP 2.3)**: materials as data with three.js's classic parameters, seeded tiling texture generators and their helpers, the CPU bake, and the page's material library.
`defineMaterial`, `getMaterial`, `createMaterialLibrary`, `defineTexture`, `bakeTexture`, `cellHash`, `wrapIndex`, `palette`, `pickTone`, `runningBond`, `tileNoise`; types `MaterialEntry`, `MaterialSpec`, `MaterialLibrary`, `TextureEntry`, `Texel`, `TextureContext`, `TextureSpec`, `TextureLook`, `TextureBake`, `TextureRef`.

**Input (WP 3.3)**: the devices of a page sampled into intents (keys by physical code, mouse with pointer lock and the wheel, gamepads in any slot), action maps and their presets, bindings players change and keep, prompts per device, the virtual device that __engine.input drives, and the scripted gamepad for tests.
`createInput`, `defineActionMap`, `getActionMap`, `listActionMaps`, `SYSTEM_ACTIONS`, `RESERVED_CODES`, `createBindings`, `codeLabel`, `readKeyboardLayout`, `isCode`, `createVirtualDevice`, `connectVirtualDevice`, `createScriptedGamepad`; types `Input`, `InputOptions`, `CameraLike`, `CameraInputSample`, `ActionMap`, `ActionMapSpec`, `Bindings`, `BindingsOptions`, `BindingsStorage`, `BindingsFile`, `RebindResult`, `DeviceKind`, `VirtualDevice`, `ScriptedGamepad`, `GamepadLike`.

**Aiming and look (WP 13.9)**: the point the intents' aim carries by a map's rule, and the look settings input.*.
`aimPoint`, `screenRay`, `onFloor`, `AIM_RULES`, `AIM_RANGE`, `STICK_REACH`, `lookOptions`, `scaleLook`, `LOOK_SETTING_FIELDS`, `LOOK_SETTINGS`, `DEGREES_PER_COUNT`; types `AimRule`, `AimPose`, `AimView`, `AimDevices`, `AimRay`, `LookOptions`, `RawLook`, `ScaledLook`.

**Held bindings (WP 13.20)**: a key or a button kept down for an action of its own (Apex's pad reload on X held), and the device a code is of.
`holdCode`, `heldBase`, `HOLD_PREFIX`, `HOLD_TIME`, `deviceOf`.

**Geometry kit and level meshes (WP 2.4)**: shapes standing on the ground with UVs in metres, the geometry registry (props and levels name geometry by id), their QA measures, and a compiled level drawn as meshes.
`boxGeometry`, `roundedBoxGeometry`, `limbGeometry`, `rampGeometry`, `frustumGeometry`, `pillarGeometry`, `pillarParts`, `ringGeometry`, `sidesThenTops`, `mergeGeometries`, `defineGeometry`, `getGeometry`, `buildGeometry`, `inspectGeometry`, `createLevelMeshes`, `LEVEL_RECIPES`, `createTerrainMeshes`; types `BoxOptions`, `RoundedBoxOptions`, `LimbOptions`, `RampOptions`, `FrustumOptions`, `PillarOptions`, `PillarPart`, `RingOptions`, `GeometryEntry`, `GeometrySpec`, `GeometryRef`, `GeometryReport`, `LevelMeshes`, `LevelMeshesOptions`, `LevelMeshPart`, `LevelCell`, `LevelRecipe`, `LevelShape`, `TerrainMeshes`, `TerrainMeshesOptions`.

**Sound data (WP 9.2)**: effects and songs as registry entries (voices, layers, variants; tracker-notation tracks), rendered offline by the DSP core into reproducible samples.
`defineSfx`, `getSfx`, `renderSfx`, `sfxVoices`, `defineSong`, `getSong`, `renderSong`, `songVoices`, `songTiming`; types `Sfx`, `SfxSpec`, `SfxLayer`, `SfxBus`, `SfxRenderOptions`, `Song`, `SongSpec`, `SongTrack`, `SongTiming`, `SongRenderOptions`, `Voice`, `SoundDef`.

**The audio runtime (WP 9.3)**: a page's sound through Web Audio, started by the first gesture: buses with ducking and voice limits, sounds placed in 3D and occluded through the QueryView, room reverb, and music in intensity layers that change on the beat and the bar line.
`createAudio`, `BUS_VOLUMES`, `ROOMS`, `roomReverb`, `VOICE_LIMITS`; types `Audio`, `AudioOptions`, `AudioState`, `AudioInfo`, `PlayOptions`, `Sound`, `ListenerPose`, `GestureTarget`, `AudioBus`, `MixerInfo`, `MusicChange`, `MusicPosition`, `Quantize`, `RoomName`, `RoomSpec`, `VoiceLimits`.

**Sound for places (WP 13.22)**: a room's reverb out of its size and what it is made of (Sabine's RT60), the walls between a sound and the listener counted, each muffling it more.
`roomAcoustics`, `ABSORPTION`, `CONTENTS`, `wallsBetween`, `muffling`, `OCCLUSION`; types `RoomMake`.

**The engine in a page (WP 2.7)**: createEngine reads the routes, starts the scene with its view, publishes window.__engine, warms up and runs the frame loop; createHeadless({ view: true }) builds the same view in Node.
`createEngine`, `parseRoutes`, `routeQuery`; types `Engine`, `EngineOptions`, `Routes`, `CameraInfo`, `PlayResult`, `PlayIntoOptions`, `ViewChange`.

**A page's own presentation (WP 9.5)**: createEngine's onFrame, once per drawn frame, with the run to read and the camera.
types `EngineFrame`, `FrameWorld`, `CameraPose`.

**Touch controls (WP 3.12; built, not tested, ADR-0021)**: a page's touch layout (the corner fan's buttons and the menu button) for createEngine's touchLayout and onMenu, the touch device on input.touch, and the touch codes it writes.
`defineTouchLayout`, `getTouchLayout`, `touchCode`; types `TouchLayout`, `TouchLayoutSpec`, `TouchButtonSpec`, `TouchDevice`, `StickView`, `TouchSetting`.

**Level meshes v2 and the cutaway (WP 4.4)**: galleries, stairs, the dais, pillars with plinths and capitals and brazier stands as recipe shapes; walls facing an outside camera cut low and pillars before the hero as stumps.
`createCutaway`, `planCutaway`; types `Cutaway`, `CutawayReport`, `CutTarget`, `LevelCut`, `CutWhen`, `PartCut`.

**Instancing and puppets (WP 3.8)**: batches of instanced copies in pages above r182's 1,000-slot uniform path; puppet bodies as data (one line per part on the humanoid skeleton's bones, mirrored parts, material slots), compiled per build and drawn as one rigid-skinned mesh per character or as instanced parts for crowds; blob shadows.
`createInstancedBatch`, `defineBody`, `getBody`, `compileBody`, `recolor`, `createPuppet`, `createPuppetBatches`, `createBlobShadows`, `blobScale`; types `InstancedBatch`, `InstancedBatchOptions`, `InstancedBatchStats`, `InstanceColor`, `Body`, `BodySpec`, `BodyPart`, `BodyPoint`, `BodyLength`, `PartOptions`, `CompiledBody`, `BodyPiece`, `PieceShape`, `Puppet`, `PuppetMaterials`, `PuppetBatches`, `BlobShadows`.

**The HTML/CSS overlay (WP 6.5)**: world-anchored labels and damage numbers placed from projected coordinates each frame (three.js's CSS2DRenderer pattern), HUD lines and a crosshair over the canvas; ui.state() for tests.
`createOverlay`, `DAMAGE_NUMBERS`, `uiState`; types `Overlay`, `OverlayOptions`, `HudOptions`, `HudPlace`, `Label`, `LabelOptions`, `DamageOptions`, `WorldPoint`, `Anchor`, `OverlayCamera`, `UiState`, `UiElementState`.

**The widgets (WP 10.6)**: bars, hearts and boxes, the dialog box and the menu as HTML/CSS over the overlay, reading the page's input (its system layer) and asking the page for sound cues; a gamepad's cursor over any panel. A menu sends the picks that change play as input (`send`), so replays hold them.
`createBar`, `createHearts`, `createBox`, `createPadCursor`, `createDialog`, `createMenu`.

**The store (WP 10.9)**: what a game keeps across sessions (high scores, progress, its settings) in the page's localStorage under the game's prefix, versioned and checked on load; memory in Node and in the isolated modes.
`createStore`, `memoryBackend`.

**Lights, shadows, atmosphere and sky (WP 7.1)**: light kinds for a level's light spots, a fixed pool of point lights near the focus with a shadow budget by quality tier, and sky presets (background, dome, backdrop, sun, ambient light, fog) that a sky puts on a scene.
`defineLight`, `defineSky`, `createSky`; types `LightEntry`, `LightSource`, `SkyEntry`, `SkySpec`, `Sky`.

**Materials v2 (WP 7.2)**: the same material data drawn in four styles (lambert, toon, flat, pbr), switched at run time with every style warmed; the toon look (bands and rim) as uniforms; outline shells for meshes and instanced batches.
`createStyleSet`, `MATERIAL_STYLES`, `TOON_LOOK`, `createOutline`, `OUTLINE_MODES`; types `MaterialStyle`, `StyleSet`, `StyleSetOptions`, `ToonLook`, `ToonUniforms`, `Outline`, `OutlineMode`, `OutlineOptions`, `OutlineShells`.

**Post-processing (WP 7.4, 13.32)**: one chain every frame draws through, every filter a uniform with an amount, scoped by part; looks as data (a material style, a filter chain, the sky, WP 7.8) that combine looks; objects tagged by part.
`createPost`, `POST_SETTINGS`, `definePostSettings`, `setPart`, `PARTS`, `defineLook`, `FILTER_FIELDS`, `FILTER_NAMES`, `SCOPES`, `PALETTES`, `STYLIZE_KINDS`; types `Post`, `PostOptions`, `Part`, `PostTag`, `LookEntry`, `LookSpec`, `FilterName`, `Scope`, `FilterChain`, `FilterSpec`, `CombineLayer`, `PostShow`.

**Props drawn (WP 4.5)**: every prop part a batch of the instancing service, posed by its body, the flames dancing on the visual streams, the light spots flickering, for the light pool; a part's geometry and where it stands (its matrix in the prop's frame), for a prop's tests.
`createPropMeshes`, `FLICKER`, `buildPropPart`, `partMatrix`; types `PropMeshes`, `PropMeshesOptions`, `PropMeshPose`, `PropLight`.

**Crowd rendering and pose LOD (WP 5.4)**: thousands of humanoids, blobs and floaters in a few dozen draw calls over the instancing service, each body seen through bands of detail by its distance (the animator's pose level, capes), culled by the view; the blob and floater bodies as data.
`createCrowd`, `createCrowdLod`, `CROWD_LOD`, `BLOB_BODY`, `blobBody`, `FLOATER_BODY`, `QUADRUPED_BODY`; types `Crowd`, `CrowdDraw`, `CrowdRigDraw`, `CrowdStats`, `RigBody`, `RigPart`, `RigJoints`, `RigShape`, `CrowdLod`, `CrowdLodOptions`, `CrowdLodCounts`, `CrowdBand`, `CrowdBandSpec`, `BlobFeatures`.

**Performance counters (WP 5.5)**: what `__engine.stats()` returns, means in ms and the renderer's counts, never fps.
types `EngineStats`.

**The texture library (v2, WP 7.3)**: a level's whole floor as a texture generator (define it under a game's id), with moss at the walls' feet, a rune circle on each dais and contact shadows along every block's foot.
`levelFloorTexture`; types `LevelFloorOptions`, `ContactShadowOptions`, `FloorMossOptions`, `FloorRuneOptions`.

**Clips in pages (WP 8.4)**: three.js's AnimationClip and AnimationMixer, for presentation only (a page plays a baked clip on a puppet with clipJSON and AnimationClip.parse); the sim samples the same tracks through the clip layer. The mannequin: the Quaternius figure the library was measured on, as a body and a build.
`AnimationClip`, `AnimationMixer`, `defineMannequin`, `mannequinBody`, `MANNEQUIN_SLOTS`; types `MannequinData`.

**Effects (WP 6.4)**: particles as data (emitters: shardfall's presets, the 2D engine's kinds, event effects), drawn with telegraphs on the floor, socket trails, bolts and camera shake by a view's effects; never part of the hash.
`createEffects`, `FX_BUDGET`, `BOLT`, `defineEmitter`, `getEmitter`, `TRAIL_TINTS`, `ScreenShake`, `SHAKE`; types `Effects`, `EffectsOptions`, `FxEventPayload`, `FxStats`, `Emitter`, `EmitterSpec`, `EmitterLayer`, `ParticleFields`, `FxLight`, `BurstOptions`, `ParticleStats`, `TrailSampleLike`.

**The feel kit (WP 13.4)**: courses, scripted runs of a scene and the numbers measured on them (`node x feel`); the runner and its verdicts; the owner's feel panel and copy as profile.
`defineCourse`, `getCourse`, `listCourses`, `METRICS`, `runCourse`, `createFeelPanel`, `tunedSpec`, `profileText`; types `Course`, `Measure`, `Metric`, `CourseResult`, `CourseSample`, `MeasureResult`, `FeelPanel`, `FeelRow`, `FeelInspector`.

**Camera modes (WP 2.5, WP 3.9, WP 13.8)**: a code to a camera, each mode's factory, and a game's own.
`readCameraCode`, `createCamera`, `createShoulderCamera`, `SHOULDER`, `createFollowCamera`, `FOLLOW_RIG`, `createFirstCamera`, `createChaseCamera`, `createViewCamera`, `followCamera`, `defineCamera`, `makePose`, `poseForward`, `poseRight`, `poseUp`, `poseTarget`; types `AnyCamera`, `AnyCameraSpec`, `ShoulderInput`, `ShoulderSpec`, `FollowInput`, `FollowSpec`, `FollowCamera`, `FollowSteps`, `CameraKindSpec`, `Camera`, `CameraInput`.

**The rig a view steps (WP 13.8)**: blends on live switches, the view effects, the view settings cam.*.
`createCameraRig`, `rigOptions`, `CAMERA_SETTINGS`, `blendCameras`, `BLEND_TIME`, `createCameraEffects`, `applyEffects`, `cameraPlayer`, `apexFov`, `EFFECTS`; types `CameraRig`, `RigOptions`, `RigInput`, `CameraPlayer`, `EffectWeights`, `EffectsFrame`.
<!-- lean:api:end -->
