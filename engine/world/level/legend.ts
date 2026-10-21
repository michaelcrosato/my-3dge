/**
 * @file The engine's legend (PLAN.md WP 2.2, WP 4.2, I-22): the glyphs every level can use without defining any, as
 * plain specs of the kind `glyph` (engine/world/level/glyph.ts declares the kind and registers these with it). v1:
 * floor `.`, wall `#`, low wall `w`, pillar `P` (2 × 2 tiles), the hero's spawn `@` and the numbered spawn markers
 * `1`–`9`. v2, the hall's: the gallery `=` (a walkway 1 m up), stairs `^` (a ramp up to a gallery, rising toward
 * whichever side the gallery is on), the dais `o` (an octagonal platform half a metre up, its edge a slope) and the
 * brazier `t` (an iron bowl on a stone foot: a cylinder, and a torch spot). v3 (WP 13.7): the ladder `|`, open floor with a
 * ladder against the neighbouring tile that stands highest, up to its top. v4 (WP 13.13), for levels written as
 * storeys (format 2): void `~`, the door `+`, the window `:`, the railing `!`, the flight of stairs `<` up to the
 * storey above and the low ceiling `_`; the wall and the pillar are `full`, so in a storey they rise to the storey
 * above whatever their top.
 *
 * Heights are the prototype hall's, converted to metres (PLAN.md Appendix C): a wall 3 m, a pillar 3.5 m, a low wall
 * 0.75 m (the hero jumps onto it), a gallery 1 m, the dais 0.5 m, one character per metre. They are starting values
 * (§9.0); a game that wants other numbers defines its own glyphs with other characters.
 *
 * v4's numbers are docs/PLAYGROUND.md §2.1's: doors 2.1 m high, windows from 0.9 m to 2.1 m, railings 1 m, a low
 * ceiling 1.4 m up (the shooter model's crouched hull, 1.19 m, fits under it; its standing one, 1.83 m, does not).
 *
 * Carried from `my-3d2dge:src/stress-world/10-hall.js:2-6, 69, 80-89` (the glyphs `# P w . = ^ o t`, `WALL_H`,
 * `PILLAR_H`, `LOW_H`, `GALLERY_H`, `DAIS_H`), `:94-99` (the dais's edge, 24 units) and `:200` (a brazier's cylinder,
 * 5 units across and 12 high, its torch 16 units up), and `my-3d2dge:src/lab3d/20-world.js:3-5` (spawn spots written
 * in the map).
 *
 * @example
 * V1_GLYPHS['glyph:wall'].char; // '#'
 * V1_GLYPHS['glyph:pillar'].footprint; // 2: a pillar is PP over PP
 * V2_GLYPHS['glyph:stairs'].floorShape; // 'ramp'
 * V3_GLYPHS['glyph:ladder'].char; // '|'
 * [V4_GLYPHS['glyph:door'].char, V4_GLYPHS['glyph:door'].head]; // ['+', 2.1]
 * @see engine/world/level/glyph.test.ts
 */

/** A wall's height (m): 48 prototype units. */
const WALL = 3;
/** A pillar's height (m): 56 units. */
const PILLAR = 3.5;
/** A low wall's height (m): 12 units, low enough to jump onto. */
const LOW_WALL = 0.75;
/** A gallery's floor (m): 16 units. */
const GALLERY = 1;
/** The dais's top (m): 8 units. */
const DAIS = 0.5;

/** A numbered spawn marker: floor with a spawn point named by its digit (`3` → `spawn:3`). */
const marker = (digit: number) => ({
  char: String(digit),
  description: `Floor with the spawn marker ${digit} (spawn:${digit}): where a scene places what it numbers ${digit}, such as a mover's start.`,
  mesh: 'floor',
  spawn: String(digit),
});

/** The v1 glyphs by id, as `defineGlyph` specs (the kind's defaults fill the rest). */
export const V1_GLYPHS = {
  'glyph:floor': {
    char: '.',
    description: 'Open floor at ground level: walkable.',
    mesh: 'floor',
  },
  'glyph:wall': {
    char: '#',
    description: 'A full-height wall (3 m): solid, a box collider, nobody walks or stands on it.',
    top: WALL,
    solid: true,
    collider: 'box',
    mesh: 'wall',
    nav: { walkable: false },
    full: true,
  },
  'glyph:lowWall': {
    char: 'w',
    description: 'A low wall (0.75 m): solid at ground level, but a body may jump onto it and stand on its top.',
    top: LOW_WALL,
    solid: true,
    collider: 'box',
    mesh: 'lowWall',
    nav: { walkable: false, standable: true },
  },
  'glyph:pillar': {
    char: 'P',
    description: 'A pillar (3.5 m), 2 × 2 tiles: write it PP over PP. Solid, a box collider.',
    top: PILLAR,
    solid: true,
    collider: 'box',
    mesh: 'pillar',
    nav: { walkable: false },
    footprint: 2,
    full: true,
  },
  'glyph:hero': {
    char: '@',
    description: "Floor with the hero's spawn point (spawn:hero).",
    mesh: 'floor',
    spawn: 'hero',
  },
  'glyph:marker1': marker(1),
  'glyph:marker2': marker(2),
  'glyph:marker3': marker(3),
  'glyph:marker4': marker(4),
  'glyph:marker5': marker(5),
  'glyph:marker6': marker(6),
  'glyph:marker7': marker(7),
  'glyph:marker8': marker(8),
  'glyph:marker9': marker(9),
} as const;

/** The v2 glyphs by id (WP 4.2): the hall's gallery, stairs, dais and brazier. */
export const V2_GLYPHS = {
  'glyph:gallery': {
    char: '=',
    description: `A gallery: a walkway ${GALLERY} m up, a block from the ground (a box collider). Bodies drop off it anywhere and climb onto it by stairs.`,
    floor: GALLERY,
    top: GALLERY,
    collider: 'box',
    mesh: 'gallery',
  },
  'glyph:stairs': {
    char: '^',
    description: `Stairs: a ramp from the ground up to ${GALLERY} m (a hull wedge), rising toward the one side that meets a gallery. Draw a filled rectangle against the gallery.`,
    top: GALLERY,
    floorShape: 'ramp',
    collider: 'hull',
    mesh: 'stairs',
  },
  'glyph:dais': {
    char: 'o',
    description: `The dais: an octagonal platform ${DAIS} m up (a hull frustum), its edge a 1.5 m slope all round. Draw it as an octagon in a square; its base reaches half a tile past the drawn tiles.`,
    top: DAIS,
    floorShape: 'dais',
    edge: 1.5,
    collider: 'hull',
    mesh: 'dais',
  },
  'glyph:brazier': {
    char: 't',
    description:
      'A brazier: an iron bowl on a stone foot, 0.75 m high (a cylinder collider, 0.3125 m in radius), with a torch spot 1 m up. Solid: nobody walks there.',
    top: 0.75,
    solid: true,
    collider: 'cylinder',
    radius: 0.3125,
    mesh: 'brazier',
    nav: { walkable: false },
    light: 'torch',
    lightHeight: 0.25,
    surface: 'iron',
  },
} as const;

/** The v3 glyphs by id (WP 13.7): the ladder, which engine/world/traverse.ts's `levelLadders` stands. */
export const V3_GLYPHS = {
  'glyph:ladder': {
    char: '|',
    description:
      'A ladder: open floor with a ladder against the neighbouring tile that stands highest (a wall, a tower), up to its top. Draw it along the face it climbs.',
    mesh: 'floor',
    ladder: true,
  },
} as const;

/** A door's and a window's head (m), over the floor. */
const HEAD = 2.1;
/** A window's sill (m). */
const SILL = 0.9;

/** The v4 glyphs by id (WP 13.13): what levels written as storeys (format 2) add. */
export const V4_GLYPHS = {
  'glyph:void': {
    char: '~',
    description:
      'Void: no floor on this storey (a stairwell, a double height, the air beside a building). Nobody stands here; what is below shows.',
    mesh: 'none',
    nav: { walkable: false },
    void: true,
  },
  'glyph:door': {
    char: '+',
    description: `A doorway in a wall, ${HEAD} m high: walk through; the wall stands over its head. Draw it a wall thick, with wall at both ends.`,
    mesh: 'floor',
    opening: 'door',
    head: HEAD,
  },
  'glyph:window': {
    char: ':',
    description: `A window in a wall: solid to its sill ${SILL} m up, open to its head ${HEAD} m up, the wall over it. Draw it a wall thick, with wall at both ends.`,
    top: SILL,
    solid: true,
    collider: 'box',
    mesh: 'wall',
    nav: { walkable: false },
    opening: 'window',
    head: HEAD,
  },
  'glyph:railing': {
    char: '!',
    description: 'A railing 1 m high round a landing, a deck or a stairwell: solid at ground level, a box collider.',
    top: 1,
    solid: true,
    collider: 'box',
    mesh: 'lowWall',
    nav: { walkable: false },
  },
  'glyph:flight': {
    char: '<',
    description:
      'A flight of stairs up to the storey above: a ramp (a hull wedge) from this floor to that one, rising toward the one side that floor meets. Draw a filled rectangle, with void over it on the storey above.',
    floorShape: 'flight',
    collider: 'hull',
    mesh: 'stairs',
  },
  'glyph:lowCeiling': {
    char: '_',
    description:
      'Floor under a low ceiling 1.4 m up (a crawlspace): crouch or slide under it. The solid stands from 1.4 m to the storey above.',
    mesh: 'floor',
    head: 1.4,
  },
} as const;
