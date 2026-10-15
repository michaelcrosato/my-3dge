/**
 * @file The hall with a hero, Box 3 (PLAN.md §9.0, WP 4.6): the hall (labs/box/levels/hall.txt: 64 × 44 m inside walls
 * 3 m high, a grid of pillars 3.5 m high, low walls to jump onto, 30 brazier stands, two galleries 1 m up along the
 * north wall with stairs rising to each, and the octagonal rune dais at the centre, 0.5 m up) as a physics level, and
 * the hero (labs/box/cast/hero.ts) at its spawn `@` on the dais, facing south. He is the player, as in the room: the
 * step's intents walk him (`move`), `jump` and `dash` make him jump and dash. The controller carries him up the
 * stairs' ramps to the galleries and over the dais's slopes, keeps him out of the walls, the pillars and the brazier
 * stands, and lets him jump onto the low walls; the page draws him as the neutral humanoid, and the walls and pillars
 * before him cut away.
 *
 * The level's text is here as well as in labs/box/levels/hall.txt, since sim-side code reads no files and Node has no
 * Vite `?raw` (as labs/box/scenes/room-hero.ts does): labs/box/scenes/hall.test.ts holds it to the file, character for
 * character, so change both together. The scene compiles it for its level bodies and names `level:hall`, which the
 * page registers from the file, for the view. `setupHall(w)` is the setup, for the scenes built on the hall
 * (labs/box/scenes/hall-props.ts).
 *
 * Settings (`box.hall.*`, read when the scene starts, so they change play and go in replays): the hero's walk,
 * take-off and dash speeds, his cast's numbers by default (labs/box/cast/hero.ts); a lower take-off shows the
 * galleries, 1 m up, reached by the stairs alone.
 *
 * Game code, sim-side: it imports only engine/sim-api.ts and the box's cast.
 *
 * Tests: labs/box/scenes/hall.test.ts, tests/replays/box-3-climb.replay.json and box-3-dais.replay.json (`node x
 * replay tests/replays/box-3-*.replay.json --browser page`), tests/e2e/box-hall.spec.ts, tests/e2e/parity.spec.ts.
 *
 * @example
 * // node x sim labs/box/scenes/hall --steps 600 --feel
 * // node x shot labs/box --scene hall --cam iso
 * HALL_START; // [32.5, 0.5, 24.5]: the spawn on the dais, 0.5 m up
 */
import {
  addLevelBodies,
  compileLevel,
  defineScene,
  defineSettings,
  physicsOf,
  type ActorSpec,
  type World,
} from '../../../engine/sim-api';
import { HERO, spawnHero } from '../cast/hero';
import { boxSounds } from '../sounds/events';

/** labs/box/levels/hall.txt, as it is (see the file comment). */
export const HALL_TEXT = `---
description: The prototype's hall, 64 × 44 m (my-3d2dge:src/stress-world/10-hall.js:22-67). Walls 3 m, a grid of 3.5 m pillars, low walls to jump onto, 30 braziers with torch spots, two galleries 1 m up along the north wall with stairs rising to each, and the rune dais at the centre, 0.5 m up. The hero starts on the dais, 2.5 m south of its centre.
---
################################################################
#..====================..................====================..#
#..====================..................====================..#
#..====================..................====================..#
#..====================..................====================t.#
#..........^^^.....t............t.......t.....t....^^^.........#
#..........^^^.....................................^^^.........#
#......PP..^^^...PP........PP........PP........PP..^^^...PP....#
#......PP..^^^...PP........PP........PPw.......PP..^^^...PP....#
#..........^^^.........................w...........^^^.........#
#..................t......t............w.......................#
#....t..........................t.....................t...www..#
#.........................................................www..#
#..............................................................#
#..................................w..............www..........#
#..................................w...........................#
#...t.....................t........w...........................#
#......PP........PP..........oooooo..PP........PP.....t..PP....#
#......PP........PP.........oooooooo.PP........PP........PP....#
#..........................oooooooooo......w...................#
#..........................oooooooooo......w...................#
#..........................oooooooooo......w........w..........#
#..........................oooooooooo...............w..........#
#...........t......t.......oooooooooo...t......t....w.......t..#
#..........................ooooo@oooo..........................#
#...........................oooooooo...........................#
#............................oooooo............................#
#......PP........PP........PP........PP........PP........PP....#
#......PP........PP........PP........PP........PP.....t..PP....#
#............................................www...............#
#........................................www...................#
#...www........w...............................................#
#..............w...............................................#
#..............w...............................................#
#..............w...............................t.....t......t..#
#..............w...www...t.....................................#
#..............w...............................................#
#......PP........PP........PP........PP........PP........PP....#
#......PP........PP........PP........PP........PP........PP....#
#..............................................................#
#...t..........................................t.............t.#
#..........t....................t.......t............t.........#
#..............................................................#
################################################################
`;

/** The hall, compiled for the sim (its colliders, spawns and light spots). */
export const HALL_LEVEL = compileLevel(HALL_TEXT, { file: 'labs/box/levels/hall.txt', name: 'hall' });

/** Where the hero starts: the level's spawn `@`, on the dais (m). */
export const HALL_START = HALL_LEVEL.spawns.find((spawn) => spawn.name === 'hero')!.position;

/** The scene's settings: the hero's speeds, m/s. */
export const HALL_SETTINGS = defineSettings({
  'box.hall.speed': {
    type: 'number',
    default: HERO.speed,
    minimum: 0,
    maximum: 20,
    unit: 'm/s',
    when: 'scene',
    description: 'How fast the hero walks in the hall.',
  },
  'box.hall.jump': {
    type: 'number',
    default: HERO.jumpSpeed,
    minimum: 0,
    maximum: 30,
    unit: 'm/s',
    when: 'scene',
    description: 'The hero’s take-off speed in the hall: the apex is jump² / 60 m under his 30 m/s² gravity.',
  },
  'box.hall.dash': {
    type: 'number',
    default: HERO.feel.dash.speed,
    minimum: 0,
    maximum: 60,
    unit: 'm/s',
    when: 'scene',
    description: 'The hero’s dash speed in the hall, for its 0.2 s; 0 turns the dash off.',
  },
});

/**
 * The hall's setup: its level bodies, and the hero at the spawn facing south, tuned by `box.hall.*`, with any further
 * `components` (the fight's); returns his id.
 */
export function setupHall<C extends object>(w: World<C>, components?: ActorSpec['components']): number {
  addLevelBodies(physicsOf(w), HALL_LEVEL);
  const tuning = {
    speed: w.settings.get<number>('box.hall.speed'),
    jumpSpeed: w.settings.get<number>('box.hall.jump'),
    dashSpeed: w.settings.get<number>('box.hall.dash'),
  };
  return spawnHero(w, [HALL_START[0], HALL_START[1], HALL_START[2]], 0, tuning, components);
}

/** The hall with a hero. */
export const hall = defineScene('box:hall', {
  description:
    'Box 3: the hall as a physics level, and the hero, who climbs the stairs to the galleries and walks the dais.',
  level: 'level:hall',
  sounds: boxSounds(HALL_LEVEL),
  physics: true,
  setup(w) {
    setupHall(w);
  },
});

export default hall;
