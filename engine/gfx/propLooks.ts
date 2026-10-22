/**
 * @file The props' looks (PLAN.md WP 4.5, WP 10.3, WP 13.16): the crate's face generator (`CRATE_TEXTURE`, my-3d2dge's
 * `crateTex`) and the props' materials (`PROP_MATERIALS`), defined on the shared registry when the module loads and on
 * another when a prop mesh set is made over it (`propLooks`, engine/gfx/props.ts). The barrel's staves are the
 * texture library's `texture:staves`, the library's iron its `texture:metal`.
 *
 * Carried from `my-3d2dge:src/stress-world/30-crowd.js:293-329` (`crateTex`; `barrelTex`'s lids).
 *
 * Invariants: data and pure generators; defining twice changes nothing (the crate's texture marks them defined).
 *
 * @example
 * import { createRegistry } from '../core/registry';
 * const reg = createRegistry();
 * propLooks(reg);
 * reg.has('material', 'material:paint'); // true: the fittings' plates and shades
 * @see engine/gfx/props.test.ts
 */
import { registry as sharedRegistry, type Registry } from '../core/registry';
import { defineMaterial } from './materials/material';
import { defineTexture, textureKind } from './textures/texture';
import { palette, wrapIndex } from './textures/tile';
import { textureSpec } from './textures/types';

/** The crate's face generator: a dark edge, a frame with a nail in each corner, planks across and a brace. */
export const CRATE_TEXTURE = textureSpec({
  description:
    "A crate's face: a dark edge, a frame with a nail in each corner, planks across between, and a diagonal brace.",
  params: {
    side: { type: 'integer', default: 12, minimum: 8, maximum: 256, unit: 'texels', description: 'One face.' },
    planks: {
      type: 'array',
      items: { type: 'string' },
      default: ['#9d6a3f', '#8f5f37', '#a87547'],
      description: 'The plank tones, hex, bottom up.',
    },
    frame: { type: 'string', default: '#6e4528', description: 'The frame, hex.' },
    line: { type: 'string', default: '#4a2e1c', description: 'The edge and the gaps between planks, hex.' },
    brace: { type: 'string', default: '#c08a55', description: 'The brace, hex.' },
    nail: { type: 'string', default: '#2e2420', description: 'The nails, hex.' },
  },
  size: [12, 12],
  tile: ({ side }) => [side, side],
  create({ params }) {
    const planks = palette(params.planks, 'texture:crate planks');
    const [frame, line, brace, nail] = palette([params.frame, params.line, params.brace, params.nail], 'texture:crate');
    const n = params.side;
    return (tx, ty, texel) => {
      const [x, y] = [wrapIndex(tx, n), wrapIndex(ty, n)];
      const edge = (v: number, d: number) => v === d || v === n - 1 - d;
      let [color, height, roughness] = [planks[Math.floor((y - 2) / 3) % planks.length], 0.7, 0.8];
      if (edge(x, 0) || edge(y, 0)) [color, height, roughness] = [line, 0.2, 0.9];
      else if (edge(x, 1) && edge(y, 1)) [color, height, roughness] = [nail, 0.9, 0.4];
      else if (edge(x, 1) || edge(y, 1)) [color, height] = [frame, 1];
      else if (x === y) [color, height] = [brace, 1];
      else if (x === y + 1) [color, height] = [frame, 1];
      else if ((y - 2) % 3 === 2) [color, height, roughness] = [line, 0.2, 0.9];
      texel.color[0] = color[0];
      texel.color[1] = color[1];
      texel.color[2] = color[2];
      texel.height = height;
      texel.roughness = roughness;
    };
  },
});

/** Round the barrel's twelve sides (m): `geometry:frustum` measures its side's u along them. */
const BARREL_ROUND = 24 * 0.375 * Math.sin(Math.PI / 12);

/**
 * The props' materials, by id: `material:crate` (texture:crate, my-3d2dge's `crateTex`, a 0.75 m face per tile),
 * `material:barrelStaves` (texture:staves wrapped exactly once round the twelve-sided barrel, a stave per side),
 * `material:barrelLid`, `material:flame` (unlit white, so tints show), the library's (WP 10.3) `material:iron`
 * and `material:cloth`, and the fittings' (WP 13.16) `material:paint`; their pane is the built-in `material:glass`.
 */
export const PROP_MATERIALS: Readonly<Record<string, Record<string, unknown>>> = {
  'material:crate': {
    description: "A crate's faces: framed planks, a brace and nails (texture:crate), one face every 0.75 m.",
    map: 'texture:crate',
    roughness: 0.8,
  },
  'material:barrelStaves': {
    description: "A barrel's side: texture:staves wrapped once round prop:barrel's 12 sides, a stave per side.",
    map: { texture: 'texture:staves', repeat: [1 / BARREL_ROUND, 1 / 0.875] },
    roughness: 0.75,
  },
  'material:barrelLid': { description: "A barrel's lids: plain dark oak.", color: '#7a5030', roughness: 0.8 },
  'material:flame': {
    description: 'Flames, unlit white, so each tongue shows its tint: what prop parts with flame tongues use.',
    unlit: true,
  },
  'material:iron': {
    description: 'Dark wrought iron (texture:metal): the library props’ straps, bands, brackets and lanterns.',
    map: 'texture:metal',
    color: '#5a5e66',
    roughness: 0.55,
    metalness: 0.6,
  },
  'material:cloth': {
    description: 'Woven cloth, white so a part’s tint is its dye: banners and hems.',
    roughness: 0.95,
  },
  'material:paint': {
    description:
      'Painted metal or wood, white so a part’s tint is its colour: switch plates, a lamp’s shade, a garage door.',
    roughness: 0.6,
  },
};

/** Defines the props' texture and materials on `registry`, unless it has them. */
export function propLooks(registry: Registry): void {
  textureKind(registry);
  if (registry.has('texture', 'texture:crate')) return;
  defineTexture('texture:crate', CRATE_TEXTURE, registry);
  for (const [id, spec] of Object.entries(PROP_MATERIALS)) defineMaterial(id, spec, registry);
}
propLooks(sharedRegistry);
