/**
 * @file The gym (docs/PLAYGROUND.md §2.3, PLAN.md WP 13.1): the playground's calibrated features, as data, and the
 * level they make. `GYM_FEATURES` lists each feature with what it measures, its number (a height, a gap, a slope), the
 * sign that shows that number and the rectangles of tiles it stands on; `GYM_TEXT` is the format-1 level the features
 * paint onto a 40 × 100 m floor inside a perimeter wall, at 0.5 m tiles, so a fence can be half a metre thick. The
 * features are written once, as data, and the map is drawn from them (doctrine: procedural first), so a change of
 * number moves the block, the sign and the course that measures it together.
 *
 * The gym's own glyphs, registered here on import (a game's glyphs live with the game, engine/world/level/glyph.ts):
 * a block per calibrated height (solid at ground level, a body may stand on its top: the mantle walls, fences, climb
 * walls, steps and the tower), a smooth ramp per slope (the `ramp` recipe, engine/gfx/level/ramp.ts) with the deck
 * it climbs to (a gallery at the ramp's top: the slide ramps, the gaps' approach and the two slope tests), the gap
 * platforms, and the crawl's walls and posts (WP 13.5), whose roof slab and bar are fixed props (`GYM_PROPS`) since a
 * format-1 level has no overhangs. Heights are metres; a ramp's height is its length times the tangent of its slope.
 *
 * Invariants: every rectangle lies inside the perimeter and on whole tiles; no two features overlap; each ramp has
 * exactly one deck at its top, on the side it rises to (engine/world/level/shapes.ts); the spawn `@` stands at the
 * north end, facing the features to the south (+Z), as every character faces at yaw 0. Pure data and one pure
 * function of it: equal on every import, in Node and in the page.
 *
 * Game code (labs/playground/): it imports only engine/sim-api.ts.
 *
 * @example
 * GYM_FEATURES.find((f) => f.id === 'mantle-2.0')?.value; // 2: the 2 m mantle wall
 * GYM_SPAWN; // [20.25, 0, 3.25]: the tile the spawn marks, its centre
 * @see labs/playground/scenes/gym.test.ts
 */
import { defineGlyph, defineProp } from '../../../engine/sim-api';

/** The gym's tile (m): half a metre, so a fence is half a metre thick. */
export const GYM_TILE = 0.5;

/** The gym's floor (m): west to east and north to south, inside its perimeter wall. */
export const GYM_SIZE = { width: 40, length: 100 } as const;

/** A rectangle of a feature in level metres (0, 0 is the perimeter's north-west corner), on whole tiles, of `char`. */
export interface GymRect {
  readonly char: string;
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
}

/** What a feature measures (docs/PLAYGROUND.md §2.3). */
export type GymKind = 'strip' | 'mantle' | 'fence' | 'climb' | 'slide' | 'steps' | 'slope' | 'tower' | 'gap' | 'crawl' | 'zipline' | 'balloon' | 'launcher'; // prettier-ignore

/** A calibrated feature of the gym. */
export interface GymFeature {
  /** Its id, `<kind>-<number>`: what a course names (WP 13.4). */
  readonly id: string;
  readonly kind: GymKind;
  /** Its number: a height (m), a gap (m), a slope (°) or a distance along the strip (m). */
  readonly value: number;
  /** The sign's text. */
  readonly label: string;
  /** Where the sign floats (m): above the feature. */
  readonly sign: readonly [x: number, y: number, z: number];
  readonly rects: readonly GymRect[];
}

/** A block's glyph: solid at ground level, a body may jump or climb onto its top and stand there. */
function block(char: string, name: string, top: number, description: string): void {
  defineGlyph(`glyph:gym-${name}`, {
    char,
    description,
    top,
    solid: true,
    collider: 'box',
    mesh: 'lowWall',
    nav: { walkable: false, standable: true },
  });
}

/** A deck's glyph: a walk `top` metres up, a block from the ground, reached by its ramp. */
function deck(char: string, name: string, top: number, description: string): void {
  defineGlyph(`glyph:gym-${name}`, { char, description, floor: top, top, collider: 'box', mesh: 'gallery' });
}

/** A smooth ramp's glyph: from the ground up to `top`, rising toward the deck at its top. */
function ramp(char: string, name: string, top: number, description: string): void {
  defineGlyph(`glyph:gym-${name}`, { char, description, top, floorShape: 'ramp', collider: 'hull', mesh: 'ramp' });
}

/** Metres rounded to millimetres, so a slope's height is written as the map's data will hold it. */
const mm = (metres: number) => Math.round(metres * 1000) / 1000;

/** A slope's height over `length` metres at `degrees`, to the millimetre. */
const rise = (length: number, degrees: number) => mm(length * Math.tan((degrees * Math.PI) / 180));

/** The slide ramps: 12 m long, at these slopes (°), each with its deck (glyph pairs: ramp, deck). */
const SLIDES = [
  [5, 'r', 'R'],
  [10, 's', 'S'],
  [20, 'u', 'U'],
  [30, 'v', 'V'],
] as const;

/** The slope tests: 4 m long, one just inside the walkable limit and one past it (docs/PLAYGROUND.md §3.2). */
const SLOPES = [
  [45, 'A', 'B'],
  [51, 'C', 'D'],
] as const;

/** The mantle walls' heights (m): up to Apex's reach of 2.03 m, and one just past it. */
const MANTLES = [
  [0.5, 'a'],
  [1.0, 'b'],
  [1.5, 'c'],
  [2.0, 'd'],
  [2.1, 'e'],
] as const;

/** The fences' heights (m), each half a metre thick. */
const FENCES = [
  [0.6, 'f'],
  [0.9, 'g'],
  [1.2, 'h'],
] as const;

/** The climb walls' heights (m): up to Apex's highest ledge, 6.93 m, and one just past it. */
const CLIMBS = [
  [3.0, 'i'],
  [4.0, 'j'],
  [5.0, 'k'],
  [6.0, 'l'],
  [6.9, 'm'],
  [7.2, 'n'],
] as const;

/** The steps' risers (m), each step 1 m deep, rising south. */
const STEPS = [
  [0.25, 'x'],
  [0.5, 'y'],
  [0.75, 'z'],
  [1.0, 'Z'],
] as const;

/** The gaps between the gap lane's platforms (m). */
const GAPS = [2, 3, 4, 5, 6, 7, 8, 9] as const;

/** The gap lane's platforms' height (m), and the tower's. */
const [GAP_TOP, TOWER_TOP] = [1.5, 6];

/** Apex's gravity (m/s²), which the launchers' heights are reached under. */
const G = 19.05;

/**
 * The tower's zipline (m): from a pulley 2.5 m up a pole on the tower's top, `long` metres down to one 2.5 m up a pole
 * near the south wall, at `toZ`, falling `fall` metres on the way (docs/PLAYGROUND.md §2.3: 40 m).
 */
const ZIP = { from: [29, TOWER_TOP + 2.5, 63.2], long: 40, fall: 6, toZ: 98.6 } as const;

/** The tower's zipline, from its top's pulley to the south one (engine/world/traverse.ts's spec). */
export const GYM_ZIPLINE = {
  feet: [TOWER_TOP, 0], // its first pole stands on the tower
  from: ZIP.from,
  to: [mm(ZIP.from[0] - Math.sqrt(ZIP.long ** 2 - ZIP.fall ** 2 - (ZIP.toZ - ZIP.from[2]) ** 2)), ZIP.from[1] - ZIP.fall, ZIP.toZ], // prettier-ignore
} as const;

/**
 * The redeploy balloon: a vertical line from the floor up to the balloon (docs/PLAYGROUND.md §2.2's stands 60 m up on
 * the hill; the gym's 90 m, so a course glides, then dives to 35 m/s, before the landing pose takes over at 30 m).
 */
export const GYM_BALLOON = { from: [16, 0, 52], to: [16, 90, 52], balloon: true } as const;

/**
 * The launchers and the heights they throw to (m): a jump pad flush with the floor, and a trampoline whose mat stands
 * 0.5 m up against the tower's west face, so a walk off the tower's top drops onto it from 5.5 m.
 */
export const GYM_LAUNCHERS = [
  { at: [23.25, 0, 88.25], size: [1.5, 1.5], velocity: [0, Math.sqrt(2 * G * 6.5), 0], mesh: 'pad', height: 6.5 },
  { at: [25.5, 0.5, 62], size: [3, 3], reach: 0.6, velocity: [0, Math.sqrt(2 * G * 2), 0], bounce: 0.9, mesh: 'trampoline', solid: true, height: 2 }, // prettier-ignore
] as const;

/**
 * The crawl (m): a tunnel `clear` high inside, `long` and `wide`, its walls `wall` high with the roof slab (`slab`
 * thick) laid on them, and a bar whose underside is `bar` up, on two posts `post` high. Apex's crouched hull is 1.19 m
 * and its standing one 1.83 m, so only the crouched one fits under either.
 */
export const GYM_CRAWL = { clear: 1.4, slab: 0.2, long: 8, wide: 2, bar: 1.3, thick: 0.15, post: 2 } as const;

for (const [height, char] of MANTLES)
  block(char, `mantle${height * 10}`, height, `A mantle wall ${height} m high, 2 m wide and deep.`);
for (const [height, char] of FENCES)
  block(char, `fence${height * 10}`, height, `A fence ${height} m high and half a metre thick.`);
for (const [height, char] of CLIMBS)
  block(char, `climb${Math.round(height * 10)}`, height, `A climb wall ${height} m high, 2 m wide, 3 m deep.`);
for (const [height, char] of STEPS)
  block(char, `step${height * 100}`, height, `A step ${height} m high: the stairs' risers are 0.25 m.`);
block('T', 'tower', TOWER_TOP, `The tower: a block ${TOWER_TOP} m high, 4 m square.`);
block('W', 'tunnelWall', GYM_CRAWL.clear + GYM_CRAWL.slab, 'A wall of the crawl tunnel, its roof slab laid on top.');
block('H', 'barPost', GYM_CRAWL.post, `A post of the bar to slide under, ${GYM_CRAWL.post} m high.`);
for (const [degrees, rampChar, deckChar] of [...SLIDES, ...SLOPES]) {
  const length = degrees <= 30 ? 12 : 4;
  const top = rise(length, degrees);
  ramp(rampChar, `ramp${degrees}`, top, `A smooth ramp at ${degrees}°: ${length} m long, rising ${top} m to its deck.`);
  deck(deckChar, `deck${degrees}`, top, `The deck at the top of the ${degrees}° ramp, ${top} m up.`);
}
ramp('q', 'gapRamp', GAP_TOP, `The ramp up to the gap lane's first platform, ${GAP_TOP} m up.`);
deck('p', 'gapPlatform', GAP_TOP, `A platform of the gap lane, ${GAP_TOP} m up.`);

/** One feature (see `GymFeature`). */
function feature(kind: GymKind, value: number, label: string, top: number, rects: GymRect[]): GymFeature {
  const first = rects[0];
  const sign = [first.x + first.w / 2, top + 0.6, first.z + first.d / 2] as const;
  return { id: `${kind}-${value}`, kind, value, label, sign, rects };
}

/** The features, north to south (see the file comment and docs/PLAYGROUND.md §2.3). */
export const GYM_FEATURES: readonly GymFeature[] = [
  ...Array.from({ length: 12 }, (_, k) => {
    const metres = 5 * (k + 1);
    return feature('strip', metres, `${metres} m`, 0, [{ char: '', x: 1, z: 6 + metres, w: 2, d: 0 }]);
  }),
  ...MANTLES.map(([h, c], k) =>
    feature('mantle', h, `Mantle ${h} m`, h, [{ char: c, x: 6 + 4 * k, z: 10, w: 2, d: 2 }]),
  ),
  ...FENCES.map(([h, c], k) =>
    feature('fence', h, `Fence ${h} m`, h, [{ char: c, x: 6 + 6 * k, z: 16, w: 3, d: 0.5 }]),
  ),
  ...CLIMBS.map(([h, c], k) => feature('climb', h, `Climb ${h} m`, h, [{ char: c, x: 6 + 4 * k, z: 22, w: 2, d: 3 }])),
  ...SLIDES.map(([deg, r, d], k) =>
    feature('slide', deg, `Slide ${deg}°`, rise(12, deg), [
      { char: d, x: 6 + 7 * k, z: 30, w: 4, d: 2 },
      { char: r, x: 6 + 7 * k, z: 32, w: 4, d: 12 },
    ]),
  ),
  feature(
    'steps',
    0.25,
    'Steps 0.25 m',
    1,
    STEPS.map(([, c], k) => ({ char: c, x: 6, z: 60 + k, w: 3, d: 1 })),
  ),
  ...SLOPES.map(([deg, r, d], k) =>
    feature('slope', deg, `Slope ${deg}°`, rise(4, deg), [
      { char: d, x: 13 + 7 * k, z: 64, w: 3, d: 2 },
      { char: r, x: 13 + 7 * k, z: 60, w: 3, d: 4 },
    ]),
  ),
  feature('tower', TOWER_TOP, `Tower ${TOWER_TOP} m`, TOWER_TOP, [
    { char: 'T', x: 27, z: 60, w: 4, d: 4 },
    { char: '|', x: 28.5, z: 59.5, w: 1, d: 0.5 }, // the ladder up its north face (the engine's ladder glyph)
  ]),
  feature('zipline', ZIP.long, `Zipline ${ZIP.long} m`, GYM_ZIPLINE.to[1], [{ char: '', x: Math.floor(GYM_ZIPLINE.to[0] * 2) / 2, z: 98, w: 1, d: 0.5 }]), // prettier-ignore
  feature('balloon', GYM_BALLOON.to[1], `Balloon ${GYM_BALLOON.to[1]} m`, 2, [{ char: '', x: 15.5, z: 51.5, w: 1, d: 1 }]), // prettier-ignore
  ...GYM_LAUNCHERS.map(
    ({ at, size, mesh, height }) =>
    feature('launcher', height, `${mesh === 'pad' ? 'Jump pad' : 'Trampoline'} ${height} m`, at[1] + 1, [{ char: '', x: at[0] - size[0] / 2, z: at[2] - size[1] / 2, w: size[0], d: size[1] }]), // prettier-ignore
  ),
  ...gapLane(),
  feature('crawl', GYM_CRAWL.clear, `Crawl ${GYM_CRAWL.clear} m`, GYM_CRAWL.clear + GYM_CRAWL.slab, [
    { char: 'W', x: 6, z: 70, w: 0.5, d: GYM_CRAWL.long },
    { char: 'W', x: 6.5 + GYM_CRAWL.wide, z: 70, w: 0.5, d: GYM_CRAWL.long },
  ]),
  feature('crawl', GYM_CRAWL.bar, `Bar ${GYM_CRAWL.bar} m`, GYM_CRAWL.post, [
    { char: 'H', x: 13, z: 72, w: 0.5, d: 0.5 },
    { char: 'H', x: 15.5, z: 72, w: 0.5, d: 0.5 },
  ]),
];

/** The crawl's slab and bar: fixed boxes the gym stands on its walls and posts (the level's blocks start at the floor). */
export const GYM_PROPS = [
  { prop: 'prop:gym-slab', at: [7.5, GYM_CRAWL.clear, 70 + GYM_CRAWL.long / 2], yaw: 0 },
  { prop: 'prop:gym-bar', at: [14.5, GYM_CRAWL.bar, 72.25], yaw: 0 },
] as const;

for (const [id, [width, height, depth], description] of [
  ['prop:gym-slab', [GYM_CRAWL.wide + 1, GYM_CRAWL.slab, GYM_CRAWL.long], 'The crawl tunnel’s roof: a stone slab on its walls.'], // prettier-ignore
  ['prop:gym-bar', [GYM_CRAWL.wide + 1, GYM_CRAWL.thick, GYM_CRAWL.thick], 'The bar to slide under: a stone beam on its posts.'], // prettier-ignore
] as const) {
  const box = { width, height, depth };
  const part = { geometry: 'geometry:box', params: box, material: 'material:stone' };
  defineProp(id, { description, parts: [part], body: { type: 'fixed', shape: 'box', size: [width, height, depth] } });
}

/** The gap lane along the east side: a ramp up to the first platform, then platforms 3 m long across each gap. */
function gapLane(): GymFeature[] {
  const lane = { x: 34, w: 4 };
  const features = [
    feature('gap', 0, 'Gaps', GAP_TOP, [
      { char: 'p', ...lane, z: 14, d: 4 },
      { char: 'q', ...lane, z: 8, d: 6 },
    ]),
  ];
  let z = 18;
  for (const gap of GAPS) {
    z += gap;
    features.push(feature('gap', gap, `Gap ${gap} m`, GAP_TOP, [{ char: 'p', ...lane, z, d: 3 }]));
    z += 3;
  }
  return features;
}

/** The spawn: the tile `@` marks, at the north end of the gym, its centre (m). */
export const GYM_SPAWN = [20.25, 0, 3.25] as const;

/**
 * The gym's gates on the site (labs/playground/levels/site.ts), each a gap in its perimeter wall in level metres: north
 * to the range, east to the backyard and to the street; each clear of every course's runs. The gym's own scene keeps
 * its wall whole (`GYM_TEXT`), so nothing runs out of it into the void.
 */
export const GYM_GATES: readonly GymRect[] = [
  { char: '.', x: 30, z: 0, w: 3, d: 0.5 },
  { char: '.', x: 40.5, z: 20, w: 0.5, d: 3 },
  { char: '.', x: 40.5, z: 76, w: 0.5, d: 3 },
];

/** Paints the features onto the floor inside the perimeter, and its gates when asked, and returns the level's text. */
function gymText(gates = false): string {
  const [cols, rows] = [GYM_SIZE.width / GYM_TILE + 2, GYM_SIZE.length / GYM_TILE + 2];
  const map = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c): string =>
      r === 0 || c === 0 || r === rows - 1 || c === cols - 1 ? '#' : '.',
    ),
  );
  for (const { rects } of GYM_FEATURES) {
    for (const { char, x, z, w, d } of rects) {
      for (let r = z / GYM_TILE; r < (z + d) / GYM_TILE; r++) {
        for (let c = x / GYM_TILE; c < (x + w) / GYM_TILE; c++) if (char) map[r][c] = char;
      }
    }
  }
  map[GYM_SPAWN[2] / GYM_TILE - 0.5][GYM_SPAWN[0] / GYM_TILE - 0.5] = '@';
  for (const { char, x, z, w, d } of gates ? GYM_GATES : []) {
    for (let r = z / GYM_TILE; r < (z + d) / GYM_TILE; r++) for (let c = x / GYM_TILE; c < (x + w) / GYM_TILE; c++) map[r][c] = char; // prettier-ignore
  }
  const description =
    'The gym (docs/PLAYGROUND.md §2.3): 40 × 100 m of calibrated features at 0.5 m tiles, inside a 3 m wall' +
    `${gates ? ' with three gates' : ''}: mantle walls, fences, climb walls, slide ramps, steps, slope tests, a tower ` +
    'and a lane of gaps, each with its sign.';
  return `---\ndescription: ${description}\ntile: ${GYM_TILE}\n---\n${map.map((row) => row.join('')).join('\n')}\n`;
}

/** The gym's level text (format 1), drawn from `GYM_FEATURES`. */
export const GYM_TEXT = gymText();

/** The same with its gates open (`GYM_GATES`): the gym as it stands on the site. */
export const GYM_SITE_TEXT = gymText(true);
