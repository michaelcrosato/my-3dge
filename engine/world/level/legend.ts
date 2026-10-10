/**
 * @file The engine's v1 legend (PLAN.md WP 2.2, I-22): the glyphs every level can use without defining any, as plain
 * specs of the kind `glyph` (engine/world/level/glyph.ts declares the kind and registers these with it). Floor `.`,
 * wall `#`, low wall `w`, pillar `P` (2 × 2 tiles), the hero's spawn `@` and the numbered spawn markers `1`–`9`.
 * WP 4.2 adds the gallery `=`, stairs `^`, the dais `o` and the brazier `t`.
 *
 * Heights are the prototype hall's, converted to metres (PLAN.md Appendix C): a wall 3 m, a pillar 3.5 m, a low wall
 * 0.75 m (the hero jumps onto it), one character per metre. They are starting values (§9.0); a game that wants other
 * numbers defines its own glyphs with other characters.
 *
 * Carried from `my-3d2dge:src/stress-world/10-hall.js:2-4, 80-89` (the glyphs `# P w .`, `WALL_H`, `PILLAR_H`,
 * `LOW_H`) and `my-3d2dge:src/lab3d/20-world.js:3-5` (spawn spots written in the map).
 *
 * @example
 * V1_GLYPHS['glyph:wall'].char; // '#'
 * V1_GLYPHS['glyph:pillar'].footprint; // 2: a pillar is PP over PP
 * @see engine/world/level/glyph.test.ts
 */

/** A wall's height (m): 48 prototype units. */
const WALL = 3;
/** A pillar's height (m): 56 units. */
const PILLAR = 3.5;
/** A low wall's height (m): 12 units, low enough to jump onto. */
const LOW_WALL = 0.75;

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
