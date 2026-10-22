/**
 * @file The house (docs/PLAYGROUND.md §2.1, PLAN.md WP 13.18): a level written as storeys (format 2) on 0.25 m tiles,
 * painted from rectangles (labs/playground/levels/plan.ts), its map 22 × 19 m from the site's (44, 44): the patio
 * along its back (north, the backyard's side), the house 16 × 12 m (x 0 to 16, z 4 to 16 of the map), the garage
 * 6 × 8 m on its east side, its apron, and the porch along its front (south, the street's side).
 * - **Basement** (−3 m): the workshop, the laundry and boiler room, storage, the stairwell up to the hall, and a
 *   crawlspace 1.4 m high under the patio (crouch or slide), through a low door, to the bulkhead's flight up to it.
 * - **Ground floor**: the hall (the front door onto the porch, the back door onto the patio, the stairs up and down),
 *   the kitchen and its island to vault (0.9 m), a bathroom, the dining room (a door into the garage), the living room
 *   (the fireplace); the garage, its up-and-over door and a side door; windows on every side.
 * - **Upper floor** (3 m): the landing round the stairwell's railing, two bedrooms, the study (a door onto the garage's
 *   roof deck, railed), a bathroom (`washroom`), a door onto the porch's roof, the attic's ladder against the landing's
 *   east wall.
 * - **Attic** (6 m), under a gable (35°, the ridge east to west at 10.2 m, the eaves 0.5 m out): crouch near the
 *   eaves, stand in the middle; its hatch over the ladder; the chimney through the ridge (11 m, to mantle onto); a
 *   window in its east gable over the garage's deck (the roof window out).
 * Walls are 0.25 m: the outer ones (`#`) in siding, the inner ones partitions (`/`, the house's glyph) in wallpaper;
 * doors 1 m, windows 1 m (two panes), flights 4 m long (3 m up: 37°). Its looks are its entry's, presentation only:
 * each room's floor (`HOUSE_ROOMS`), and its recipes (siding, wallpaper, shingles, a brick chimney).
 *
 * Game code, sim-side: it imports only engine/sim-api.ts and the playground's own files.
 *
 * @example
 * HOUSE_MARKERS.K; // 'kitchen'
 * @see labs/playground/levels/house.test.ts
 */
import { defineGlyph, defineLevel } from '../../../engine/sim-api';
import { levelText, Plan, type Rect } from './plan';

/** The house's tile (m). */
export const HOUSE_TILE = 0.25;
/** Its map's size (m): the patio, the house and the garage, and the porch. */
export const HOUSE_MAP = { width: 22, depth: 19 } as const;
/** The house itself, the garage, the porch and the patio, in the map's metres. */
export const HOUSE_RECTS = {
  house: [0, 4, 16, 16],
  garage: [15.75, 6, 22, 14],
  porch: [0, 16, 16, 19],
  patio: [0, 0, 22, 4],
} as const satisfies Record<string, Rect>;

/** The house's rooms by marker character. */
export const HOUSE_MARKERS = {
  F: 'workshop',
  $: 'laundry',
  '%': 'storage',
  '&': 'crawlspace',
  '?': 'stairwell',
  K: 'kitchen',
  E: 'hall',
  M: 'bathroom',
  I: 'dining',
  N: 'living',
  G: 'garage',
  J: 'bedroom',
  O: 'master',
  Q: 'study',
  X: 'landing',
  Y: 'washroom',
  L: 'attic',
} as const;

/** The house's own glyphs: an inner wall, the counters, the garage's and the crawlspace's openings, the chimney. */
const GLYPHS = { partition: '/', counter: '[', garage: '{', low: '}', chimney: ')' } as const;

defineGlyph('glyph:playground-partition', { char: GLYPHS.partition, description: 'An inner wall of the house, 0.25 m: up to the storey above, drawn in wallpaper.', top: 3, solid: true, collider: 'box', mesh: 'partition', full: true, nav: { walkable: false } }); // prettier-ignore
defineGlyph('glyph:playground-counter', { char: GLYPHS.counter, description: 'A kitchen counter or the island, 0.9 m high: vault it, stand on it.', top: 0.9, solid: true, collider: 'box', mesh: 'lowWall', nav: { walkable: false, standable: true } }); // prettier-ignore
defineGlyph('glyph:playground-garageOpening', { char: GLYPHS.garage, description: "The garage door's opening, 2.75 m wide and 2.3 m high: its up-and-over door is the scene's.", mesh: 'floor', opening: 'door', head: 2.3 }); // prettier-ignore
defineGlyph('glyph:playground-lowDoor', { char: GLYPHS.low, description: 'A low doorway, 1.4 m high, into the crawlspace: crouch through it.', mesh: 'floor', opening: 'door', head: 1.4 }); // prettier-ignore
defineGlyph('glyph:playground-chimney', { char: GLYPHS.chimney, description: 'The chimney in the attic, up through the ridge to 11 m: mantle onto it from the roof.', top: 5, solid: true, collider: 'box', mesh: 'chimney', nav: { walkable: false } }); // prettier-ignore
for (const [char, room] of Object.entries(HOUSE_MARKERS)) {
  const head = room === 'crawlspace' ? { head: 1.4 } : {}; // its marker under the crawlspace's low ceiling too
  defineGlyph(`glyph:playground-${room}`, { char, description: `Floor marking the house's ${room}.`, mesh: 'floor', room, ...head }); // prettier-ignore
}

/** A door's 1 m along a wall from (a, b): across x at z = b (`'x'`), or across z at x = a. */
const door = (a: number, b: number, along: 'x' | 'z'): Rect => (along === 'x' ? [a, b, a + 1, b + HOUSE_TILE] : [a, b, a + HOUSE_TILE, b + 1]); // prettier-ignore

/** The house's walls: the outer ring (`#`) round inner walls (`/`) the rooms are carved from. */
function shell(plan: Plan): Plan {
  return plan.fill(HOUSE_RECTS.house, GLYPHS.partition).box(HOUSE_RECTS.house, '#');
}

/** The four rooms of a floor, and the hall or landing between them, L-shaped round the stairs (ground and upper). */
function floor(plan: Plan, [nw, sw, ne, se, middle]: readonly string[]): Plan {
  plan.fill([0.25, 4.25, 5.5, 10], nw).fill([0.25, 10.25, 3, 15.75], sw);
  plan.fill([10.5, 4.25, 15.75, 10], ne).fill([10.5, 10.25, 15.75, 15.75], se);
  return plan.fill([5.75, 4.25, 10.25, 15.75], middle).fill([3.25, 10.25, 5.75, 15.75], middle);
}

/** The doors of a floor between its rooms and the middle (see `floor`). */
function innerDoors(plan: Plan): Plan {
  for (const rect of [door(5.5, 7, 'z'), door(3, 12, 'z'), door(10.25, 7, 'z'), door(10.25, 14, 'z')]) plan.line(rect, '+'); // prettier-ignore
  return plan;
}

/** Windows, each 1 m, on the walls named by their tiles' west or north end. */
function windows(plan: Plan, at: readonly (readonly [number, number, 'x' | 'z'])[]): Plan {
  for (const [a, b, along] of at) plan.line(door(a, b, along), ':');
  return plan;
}

/** The basement (see the file comment). */
function basement(): Plan {
  const plan = new Plan(HOUSE_MAP.width, HOUSE_MAP.depth, HOUSE_TILE);
  plan.fill([0, 0, 16, 16], GLYPHS.partition).box(HOUSE_RECTS.house, '#').box([0, 0, 16, 4.25], '#');
  plan.fill([0.25, 4.25, 8.75, 15.75], '.').fill([9, 4.25, 10.25, 13], '.'); // the workshop, the stairwell
  plan.fill([10.5, 4.25, 15.75, 10], '.').fill([10.5, 10.25, 15.75, 15.75], '.'); // the laundry, storage
  plan.fill([9, 9, 10.25, 13], '<'); // up to the hall, rising south
  plan.fill([4.75, 0.25, 15.75, 4], '_').fill([0.75, 0.75, 4.75, 2], '<'); // the crawlspace; the bulkhead, rising west
  plan
    .line(door(8.75, 5.5, 'z'), '+')
    .line(door(10.25, 5.5, 'z'), '+')
    .line(door(13, 10, 'x'), '+');
  plan.line(door(9, 4, 'x'), GLYPHS.low); // from the stairwell, north into the crawlspace
  for (const [char, x, z] of [['F', 0.5, 15.25], ['?', 9.25, 4.5], ['$', 13, 8], ['%', 15.25, 15.25], ['&', 15.25, 0.5]] as const) plan.fill([x, z, x + HOUSE_TILE, z + HOUSE_TILE], char); // prettier-ignore
  return plan;
}

/** The ground floor (see the file comment). */
function ground(): Plan {
  const plan = shell(new Plan(HOUSE_MAP.width, HOUSE_MAP.depth, HOUSE_TILE, '.')); // patio, porch, apron: concrete
  floor(plan, ['.', '.', '.', '.', '.']).box(HOUSE_RECTS.garage, '#').fill([16, 6.25, 21.75, 13.75], '.');
  innerDoors(plan)
    .line(door(7, 15.75, 'x'), '+')
    .line(door(7.5, 4, 'x'), '+'); // the front door and the back
  plan
    .line(door(15.75, 7, 'z'), '+')
    .line(door(19, 6, 'x'), '+')
    .line([17.5, 13.75, 20.25, 14], GLYPHS.garage);
  windows(plan, [[1.5, 4, 'x'], [3.5, 4, 'x'], [0, 6, 'z'], [0, 8, 'z'], [0, 12.5, 'z'], [1, 15.75, 'x'], [4.5, 15.75, 'x'], [9, 4, 'x'], [11.5, 4, 'x'], [13.5, 4, 'x'], [11.5, 15.75, 'x'], [13.5, 15.75, 'x'], [15.75, 14.5, 'z'], [21.75, 9.5, 'z']]); // prettier-ignore
  plan.fill([0.25, 4.25, 5.5, 4.75], GLYPHS.counter).fill([2, 6.5, 4, 7.5], GLYPHS.counter); // the counter, the island
  plan.fill([5.75, 9, 7.25, 13], '<'); // the stairs up, rising north to the landing
  plan.fill([9, 9, 10.25, 13], '~').line([8.75, 8.75, 9, 13], '!').line([8.75, 8.75, 10.25, 9], '!'); // the stairs down
  plan.fill([12, 9.75, 13.5, 10.5], '#'); // the chimney's breast, the fireplace before it
  plan
    .fill([0.75, 0.75, 4.75, 2], '~')
    .line([0.5, 0.5, 5, 0.75], '!')
    .line([0.5, 2, 5, 2.25], '!')
    .line([4.75, 0.75, 5, 2], '!'); // the bulkhead's stairwell // prettier-ignore
  for (const x of [0, 5.25, 10.25, 15.5]) plan.fill([x, 18.5, x + 0.5, 19], 'P'); // the porch's posts
  for (const [char, x, z] of [['K', 2.5, 9], ['M', 2, 12], ['E', 8, 5], ['I', 15.25, 9.5], ['N', 15.25, 15.25], ['G', 21.25, 6.5]] as const) plan.fill([x, z, x + HOUSE_TILE, z + HOUSE_TILE], char); // prettier-ignore
  return plan;
}

/** The upper floor (see the file comment). */
function upper(): Plan {
  const plan = shell(new Plan(HOUSE_MAP.width, HOUSE_MAP.depth, HOUSE_TILE));
  floor(plan, ['.', '.', '.', '.', '.']);
  plan
    .fill([16, 6, 22, 14], '.')
    .line([16, 6, 22, 6.25], '!')
    .line([21.75, 6, 22, 14], '!')
    .line([16, 13.75, 22, 14], '!'); // the garage's deck // prettier-ignore
  plan.fill(HOUSE_RECTS.porch, '.'); // the porch's roof
  innerDoors(plan)
    .line(door(15.75, 7, 'z'), '+')
    .line(door(7, 15.75, 'x'), '+'); // onto the deck, the porch's roof
  windows(plan, [[1.5, 4, 'x'], [3.5, 4, 'x'], [0, 6.5, 'z'], [0, 12.5, 'z'], [1, 15.75, 'x'], [7.5, 4, 'x'], [4.5, 15.75, 'x'], [11.5, 4, 'x'], [13.5, 4, 'x'], [11.5, 15.75, 'x'], [13.5, 15.75, 'x'], [15.75, 14.5, 'z']]); // prettier-ignore
  // The stairwell, a tile wider than the stairs each side, so a body's head on them passes clear of its railings.
  plan.fill([5.75, 9, 7.5, 13], '~').fill([5.5, 10.25, 5.75, 13], '~');
  plan.line([7.5, 9, 7.75, 13.25], '!').line([5.25, 13, 7.75, 13.25], '!').line([5.25, 10.25, 5.5, 13], '!');
  plan.fill([12, 9.75, 13.5, 10.5], '#').fill([10, 9.5, 10.25, 9.75], '|'); // the chimney; the attic's ladder
  for (const [char, x, z] of [['J', 3, 6], ['Y', 2, 12], ['X', 9.75, 4.5], ['Q', 15.25, 9.5], ['O', 15.25, 15.25]] as const) plan.fill([x, z, x + HOUSE_TILE, z + HOUSE_TILE], char); // prettier-ignore
  return plan;
}

/** The attic (see the file comment). */
function attic(): Plan {
  const plan = new Plan(HOUSE_MAP.width, HOUSE_MAP.depth, HOUSE_TILE).fill(HOUSE_RECTS.house, '#');
  plan.fill([0.25, 6.25, 15.75, 13.75], '.').fill([8.75, 9, 10.25, 10.5], '~').fill([12, 9.75, 13.5, 10.5], GLYPHS.chimney); // prettier-ignore
  return plan.line(door(15.75, 9.5, 'z'), ':').fill([1, 9.5, 1 + HOUSE_TILE, 9.75], 'L');
}

/** The house's level text (see the file comment). */
export const HOUSE_TEXT = levelText(
  {
    description: "The playground's house (docs/PLAYGROUND.md §2.1) on 0.25 m tiles: a basement, a ground floor, an upper floor and an attic under a gable; the garage, the patio and the porch.", // prettier-ignore
    tile: HOUSE_TILE,
  },
  [
    { keys: { storey: 'basement', base: -3, height: 2.7 }, plan: basement() },
    { keys: { storey: 'ground', base: 0, height: 2.7 }, plan: ground() },
    { keys: { storey: 'upper', base: 3, height: 2.7 }, plan: upper() },
    { keys: { storey: 'attic', base: 6, roof: 'gable', pitch: 35, eaves: 0.5 }, plan: attic() },
  ],
);

/** A recipe of blocks in `sides` and `tops`, cut facing the camera as the engine's walls are. */
const block = (sides: string, tops: string) => ({ shape: 'block', materials: [sides, tops], castShadow: true, receiveShadow: true, cut: { height: 0.4375, when: 'facing' } }) as const; // prettier-ignore
/** A one-slot recipe of `shape` in `material`. */
const one = (shape: string, ...materials: string[]) => ({ shape, materials, castShadow: true, receiveShadow: true });

/** Each room's floor (presentation only): tiles where it is wet, carpet where it is soft, wood, else concrete. */
export const HOUSE_ROOMS = {
  kitchen: 'material:tiles',
  bathroom: 'material:tiles',
  washroom: 'material:tiles',
  hall: 'material:wood',
  landing: 'material:wood',
  dining: 'material:wood',
  study: 'material:wood',
  attic: 'material:wood',
  living: 'material:carpet',
  bedroom: 'material:carpet',
  master: 'material:carpet',
} as const;

defineLevel('level:house', {
  text: HOUSE_TEXT,
  file: 'labs/playground/levels/house.ts',
  rooms: HOUSE_ROOMS,
  recipes: {
    floor: { ...one('surface', 'material:concrete'), castShadow: false },
    wall: block('material:siding', 'material:paint'),
    partition: block('material:wallpaper', 'material:paint'),
    lowWall: block('material:wood', 'material:tiles'),
    chimney: block('material:brick', 'material:stone'),
    pillar: one('pillar', 'material:paint', 'material:paint'),
    heads: one('heads', 'material:paint'),
    frames: one('frames', 'material:wood'),
    railing: one('railing', 'material:wood'),
    flight: one('flight', 'material:paint', 'material:wood'),
    ceiling: one('ceiling', 'material:paint'),
    roof: one('roof', 'material:shingles', 'material:wood'),
  },
});
