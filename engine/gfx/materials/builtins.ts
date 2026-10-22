/**
 * @file The engine's built-in materials (PLAN.md WP 2.3): `material:default`, the neutral grey that stands in for a
 * missing id; one textured material per v1 generator (flagstone, brick, dressed stone, planks, a barrel's staves,
 * checker) with the prototype's palettes; `material:glow`, an unlit colour for flames, markers and lit windows; and
 * the building materials (WP 13.17), one per v3 generator: wood, tiles, carpet, wallpaper, shingles, asphalt,
 * concrete, siding and glass, in their generators' palettes, tuned for the toon bands and the pixel look. Glass is
 * opaque, its reflections painted: a game makes a see-through one with `transparent` and `opacity`. Every registry
 * gets them with the kind `material` (engine/gfx/materials/material.ts). A game's own materials live with the game
 * (`defineMaterial` in labs/box/), never here.
 *
 * Invariants: plain data (the kind's fields only), ids `material:<name>`, every map naming a v1 or v3 texture.
 *
 * @example
 * BUILT_IN_MATERIALS['material:brick'].map; // 'texture:brick'
 * @see engine/gfx/materials/material.test.ts
 */

/** The built-in materials, by id. */
export const BUILT_IN_MATERIALS: Readonly<Record<string, Record<string, unknown>>> = {
  'material:default': {
    description: 'Neutral matte grey, lit: what a mesh without a material, or with a missing material id, shows.',
    color: '#9a9aa4',
    roughness: 0.9,
  },
  'material:flagstone': {
    description: 'Flagstone floor: square stones in running-bond rows (texture:flagstone).',
    map: 'texture:flagstone',
    roughness: 0.85,
  },
  'material:brick': {
    description: 'Brick wall: courses in running bond with sunk joints (texture:brick).',
    map: 'texture:brick',
    roughness: 0.85,
  },
  'material:stone': {
    description: 'Dressed stone: big bevelled blocks, for pillars, stairs and plinths (texture:stone).',
    map: 'texture:stone',
    roughness: 0.75,
  },
  'material:planks': {
    description: 'Wooden floor boards (texture:planks).',
    map: 'texture:planks',
    roughness: 0.7,
  },
  'material:barrel': {
    description: "A barrel's side: staves and iron hoops (texture:staves), for a cylinder's side, x round, y up.",
    map: 'texture:staves',
    roughness: 0.75,
  },
  'material:checker': {
    description:
      'Checker tiles: castle floors, bonus rooms, and a test pattern showing how a surface is mapped (texture:checker).',
    map: 'texture:checker',
    roughness: 0.6,
  },
  'material:glow': {
    description: 'A warm glow, unlit: flames, markers and lit windows show their colour whatever the lights.',
    color: '#ffc46b',
    unlit: true,
  },
  'material:wood': {
    description: 'Plain wood, its grain running up: doors, furniture and trim (texture:wood).',
    map: 'texture:wood',
    roughness: 0.65,
  },
  'material:tiles': {
    description: 'Glazed tiles: a kitchen’s or a bathroom’s floor and walls (texture:tiles; its checker for a floor).',
    map: 'texture:tiles',
    roughness: 0.3,
  },
  'material:carpet': {
    description: 'A close carpet pile in a deep red: a bedroom’s or a study’s floor (texture:carpet).',
    map: 'texture:carpet',
    roughness: 1,
  },
  'material:wallpaper': {
    description: 'Striped wallpaper with a small diamond: a room’s walls (texture:wallpaper).',
    map: 'texture:wallpaper',
    roughness: 0.85,
  },
  'material:shingles': {
    description: 'Roof shingles in overlapping courses: a pitched roof (texture:shingles), its courses running up v.',
    map: 'texture:shingles',
    roughness: 0.9,
  },
  'material:asphalt': {
    description: 'Asphalt: a street and a drive (texture:asphalt).',
    map: 'texture:asphalt',
    roughness: 0.95,
  },
  'material:concrete': {
    description: 'Concrete: a path, a step, a foundation, a garage floor (texture:concrete).',
    map: 'texture:concrete',
    roughness: 0.9,
  },
  'material:siding': {
    description: 'Painted clapboard siding: a house’s outside walls (texture:siding), its boards running along u.',
    map: 'texture:siding',
    roughness: 0.75,
  },
  'material:glass': {
    description: 'Window glass, its reflections painted, opaque (texture:glass): a window’s panes, the fittings’ pane.',
    map: 'texture:glass',
    roughness: 0.05,
  },
};
