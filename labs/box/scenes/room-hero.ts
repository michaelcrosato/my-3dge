/**
 * @file The room with a hero, Box 2 (PLAN.md §9.0, WP 3.10): the box room (labs/box/levels/room.txt: 16 × 12 m inside
 * walls 3 m high, a low wall 0.75 m high, a 2 × 2 m pillar) as a physics level, and the hero (labs/box/cast/hero.ts)
 * at its spawn `@`, facing south into the room. He is the player: the step's intents walk him (`move`), and `jump`
 * and `dash` make him jump and dash; the controller keeps him out of the walls and the pillar, lets him jump onto the
 * low wall, and his animator steps his body (footsteps as he walks). The page draws him as the neutral humanoid.
 *
 * The level's text is here as well as in labs/box/levels/room.txt, since sim-side code reads no files and Node has no
 * Vite `?raw` (as fixtures/scenes/nav-1000/hall.ts does): labs/box/scenes/room-hero.test.ts holds it to the file,
 * character for character, so change both together. The scene compiles it for its level bodies and names
 * `level:room`, which the page registers from the file, for the view.
 *
 * Settings (`box.roomHero.*`, read when the scene starts, so they change play and go in replays): the hero's walk,
 * take-off and dash speeds, the cast's numbers by default.
 *
 * Game code, sim-side: it imports only engine/sim-api.ts and the box's cast.
 *
 * Tests: labs/box/scenes/room-hero.test.ts, tests/replays/box-2-*.replay.json (`node x replay
 * tests/replays/box-2-*.replay.json --browser page`), tests/e2e/parity.spec.ts.
 *
 * @example
 * // node x sim labs/box/scenes/room-hero --steps 600 --feel
 * // node x sim labs/box/scenes/room-hero --set box.roomHero.speed=6
 * ROOM_HERO_LEVEL.spawns.find((spawn) => spawn.name === 'hero')?.position; // [3.5, 0, 2.5]
 */
import { addLevelBodies, compileLevel, defineScene, defineSettings, physicsOf } from '../../../engine/sim-api';
import { HERO, spawnHero } from '../cast/hero';
import { boxSounds } from '../sounds/events';

/** labs/box/levels/room.txt, as it is (see the file comment). */
export const ROOM_TEXT = `---
description: The box room, Box 1 (PLAN.md §9.0, WP 2.7). 16 × 12 m of flagstones inside brick walls 3 m high, one low wall (0.75 m) across the middle, a 2 × 2 m pillar 3.5 m high, the hero's spawn, and three numbered markers where the scripted movers of labs/box/scenes/room.ts start, all in view of the iso camera.
---
################
#..............#
#..@...........#
#..........PP..#
#..1.......PP..#
#.........3....#
#...wwwwww.....#
#.....2........#
#..............#
#..............#
#..............#
################
`;

/** The room, compiled for the sim (its colliders and spawns). */
export const ROOM_HERO_LEVEL = compileLevel(ROOM_TEXT, { file: 'labs/box/levels/room.txt', name: 'room' });

/** The scene's settings: the hero's speeds, m/s. */
export const ROOM_HERO_SETTINGS = defineSettings({
  'box.roomHero.speed': {
    type: 'number',
    default: HERO.speed,
    minimum: 0,
    maximum: 20,
    unit: 'm/s',
    when: 'scene',
    description: 'How fast the hero walks.',
  },
  'box.roomHero.jump': {
    type: 'number',
    default: HERO.jumpSpeed,
    minimum: 0,
    maximum: 30,
    unit: 'm/s',
    when: 'scene',
    description: 'The hero’s take-off speed: the apex is jump² / 60 m under his 30 m/s² gravity.',
  },
  'box.roomHero.dash': {
    type: 'number',
    default: HERO.feel.dash.speed,
    minimum: 0,
    maximum: 60,
    unit: 'm/s',
    when: 'scene',
    description: 'The hero’s dash speed, for its 0.2 s; 0 turns the dash off.',
  },
});

/** Where the hero starts: the level's spawn `@`. */
const START = ROOM_HERO_LEVEL.spawns.find((spawn) => spawn.name === 'hero')!.position;

/** The room with a hero. */
export const roomHero = defineScene('box:room-hero', {
  description: 'Box 2: the room as a physics level, and the hero, who walks, dashes and jumps onto the low wall.',
  level: 'level:room',
  sounds: boxSounds(ROOM_HERO_LEVEL),
  physics: true,
  setup(w) {
    addLevelBodies(physicsOf(w), ROOM_HERO_LEVEL);
    const tuning = {
      speed: w.settings.get<number>('box.roomHero.speed'),
      jumpSpeed: w.settings.get<number>('box.roomHero.jump'),
      dashSpeed: w.settings.get<number>('box.roomHero.dash'),
    };
    spawnHero(w, [START[0], START[1], START[2]], 0, tuning);
  },
});

export default roomHero;
