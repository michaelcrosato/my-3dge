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
 * it climbs to (a gallery at the ramp's top: the slide ramps, the gaps' approach and the two slope tests), and the gap
 * platforms. Heights are metres; a ramp's height is its length times the tangent of its slope.
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
import { defineGlyph } from '../../../engine/sim-api';

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
export type GymKind = 'strip' | 'mantle' | 'fence' | 'climb' | 'slide' | 'steps' | 'slope' | 'tower' | 'gap';

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

for (const [height, char] of MANTLES)
  block(char, `mantle${height * 10}`, height, `A mantle wall ${height} m high, 2 m wide and deep.`);
for (const [height, char] of FENCES)
  block(char, `fence${height * 10}`, height, `A fence ${height} m high and half a metre thick.`);
for (const [height, char] of CLIMBS)
  block(char, `climb${Math.round(height * 10)}`, height, `A climb wall ${height} m high, 2 m wide, 3 m deep.`);
for (const [height, char] of STEPS)
  block(char, `step${height * 100}`, height, `A step ${height} m high: the stairs' risers are 0.25 m.`);
block('T', 'tower', TOWER_TOP, `The tower: a block ${TOWER_TOP} m high, 4 m square.`);
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
  feature('tower', TOWER_TOP, `Tower ${TOWER_TOP} m`, TOWER_TOP, [{ char: 'T', x: 27, z: 60, w: 4, d: 4 }]),
  ...gapLane(),
];

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

/** Paints the features onto the floor inside the perimeter and returns the level's text. */
function gymText(): string {
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
  const description =
    'The gym (docs/PLAYGROUND.md §2.3): 40 × 100 m of calibrated features at 0.5 m tiles, inside a 3 m wall: mantle ' +
    'walls, fences, climb walls, slide ramps, steps, slope tests, a tower and a lane of gaps, each with its sign.';
  return `---\ndescription: ${description}\ntile: ${GYM_TILE}\n---\n${map.map((row) => row.join('')).join('\n')}\n`;
}

/** The gym's level text (format 1), drawn from `GYM_FEATURES`. */
export const GYM_TEXT = gymText();
