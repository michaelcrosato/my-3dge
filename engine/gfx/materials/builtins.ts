/**
 * @file The engine's built-in materials (PLAN.md WP 2.3): `material:default`, the neutral grey that stands in for a
 * missing id; one textured material per v1 generator (flagstone, brick, dressed stone, planks, a barrel's staves,
 * checker) with the prototype's palettes; and `material:glow`, an unlit colour for flames, markers and lit windows.
 * Every registry gets them with the kind `material` (engine/gfx/materials/material.ts). A game's own materials live
 * with the game (`defineMaterial` in labs/box/), never here.
 *
 * Invariants: plain data (the kind's fields only), ids `material:<name>`, every map naming a v1 texture.
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
};
