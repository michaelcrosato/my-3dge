/**
 * @file The metal generator (`texture:metal`, PLAN.md WP 7.3): riveted iron plates, each with a seam along its bottom
 * and left, a lit bevel inside its top and left and a shaded one along its bottom and right, brushed streaks along x
 * in three tones, rivets along its top and bottom (a lit texel over a shaded one), and rust spreading from the seams in
 * patches. The relief sinks the seams and raises the rivets; the bare metal is smooth (roughness about 0.35), the
 * rust rough, so the styles that shade with roughness (WP 7.2's pbr) show the plates' sheen and the rust's dullness.
 *
 * New in my-3dge: doors, grates, armour and machinery (the prototype's iron was flat colour). Metalness is the
 * material's parameter, not the texture's.
 *
 * Invariants: tiles at whole plates (`tile`: [plate width, plate height]), shifted a quarter plate across and half a
 * plate up so the wrap edge runs through plates; rivets sit inside their plate.
 *
 * @example
 * METAL.size; // [64, 64]: two plates across, four up
 * @see engine/gfx/textures/generators/v2.test.ts
 */
import { cellHash, palette, tileNoise, wrapIndex } from '../tile';
import { textureSpec } from '../types';

/** The metal generator's spec. */
export const METAL = textureSpec({
  description:
    'Riveted iron plates: seams, bevels, brushed streaks along x, rivets along the plates’ edges and rust from the seams.',
  params: {
    plate: { type: 'string', default: '#7a7f86', description: 'The bare metal, hex.' },
    dark: { type: 'string', default: '#666a71', description: 'The darker streaks and the shaded bevel, hex.' },
    light: { type: 'string', default: '#8f949b', description: 'The lighter streaks and the lit bevel, hex.' },
    seam: { type: 'string', default: '#3b3e43', description: 'The seams between plates, hex.' },
    rivet: { type: 'string', default: '#b3b8bf', description: "A rivet's lit top, hex." },
    rust: { type: 'string', default: '#8a4f2a', description: 'The rust, hex.' },
    rustDark: { type: 'string', default: '#6b3a20', description: 'The rust in the seams and its pits, hex.' },
    width: {
      type: 'integer',
      default: 32,
      minimum: 8,
      maximum: 512,
      unit: 'texels',
      description: "A plate's width, its seam included.",
    },
    height: {
      type: 'integer',
      default: 16,
      minimum: 8,
      maximum: 512,
      unit: 'texels',
      description: "A plate's height, its seam included.",
    },
    rivets: {
      type: 'integer',
      default: 8,
      minimum: 0,
      maximum: 512,
      unit: 'texels',
      description: 'About how far apart the rivets are along the top and bottom of each plate; 0 for none.',
    },
    corrosion: {
      type: 'number',
      default: 0.12,
      minimum: 0,
      maximum: 1,
      description: 'The share of the metal rusted, more of it near the seams.',
    },
  },
  size: [64, 64],
  tile: (params) => [params.width, params.height],
  create({ params, seed, width: w, height: h }) {
    const [plate, dark, light, seam, rivet, rust, rustDark] = palette(
      [params.plate, params.dark, params.light, params.seam, params.rivet, params.rust, params.rustDark],
      'texture:metal',
    );
    const [pw, ph] = [params.width, params.height];
    const [cols, rows] = [w / pw, h / ph];
    const size = [w, h] as const;
    // Brushed streaks: long along x (a cell per plate), short up (four per plate).
    const streak = tileNoise(size, { cells: [cols, 4 * rows], seed, octaves: 2, salt: 1 });
    const pitting = tileNoise(size, { cells: [2 * cols, 2 * rows], seed, octaves: 2, salt: 2 });
    const phase = [Math.floor(pw / 4), Math.floor(ph / 2)];
    // Rivet heads (their left columns): two texels in from each side, evenly spaced about `rivets` apart between.
    const heads = new Set<number>();
    if (params.rivets > 0) {
      const count = Math.max(2, Math.round((pw - 6) / params.rivets) + 1);
      for (let i = 0; i < count; i++) heads.add(2 + Math.round((i * (pw - 6)) / (count - 1)));
    }
    // A share p of two octaves lies above 0.5 + 0.48 (0.5 − p) (see texture:dirt); the seams add up to 0.12.
    const rustAbove = 0.5 + 0.48 * (0.5 - params.corrosion) + 0.04;
    return (x, y, texel) => {
      const [px, py] = [wrapIndex(x + phase[0], w), wrapIndex(y + phase[1], h)];
      const [col, row] = [Math.floor(px / pw), Math.floor(py / ph)];
      const [lx, ly] = [px - col * pw, py - row * ph];
      const set = (color: readonly number[], relief: number, roughness: number) => {
        texel.color[0] = color[0];
        texel.color[1] = color[1];
        texel.color[2] = color[2];
        texel.height = relief;
        texel.roughness = roughness;
      };
      // How close to a seam (0 on it, 1 four texels or more inside): rust gathers there.
      const edge = Math.min(lx, ly, pw - 1 - lx, ph - 1 - ly, 4) / 4;
      // Rust, 0 to 1 across a narrow margin of the pitting noise: the patch takes its colour past the middle, its
      // roughness and pitting grow across the margin, so they do not jump at the patch's edge.
      const rustiness =
        params.corrosion > 0
          ? Math.min(1, Math.max(0, (pitting(px, py) + (1 - edge) * 0.12 - rustAbove) / 0.06 + 0.5))
          : 0;
      const rusted = rustiness >= 0.5;
      if (lx === 0 || ly === 0) return set(rusted ? rustDark : seam, 0.1, 0.6 + rustiness * 0.35);
      // Rivets: a 2 × 2 head two texels inside the top and bottom edges, lit above, shaded below.
      const rivetRow = ly === 2 || ly === 3 || ly === ph - 4 || ly === ph - 3;
      if (rivetRow && (heads.has(lx) || heads.has(lx - 1))) {
        const upper = ly === 3 || ly === ph - 3;
        return set(upper ? rivet : dark, upper ? 1 : 0.95, 0.3);
      }
      const rough = (bare: number) => bare + (0.92 - bare) * rustiness;
      if (rusted) return set(cellHash(px, py, seed, 3) < 0.25 ? rustDark : rust, 0.85 - rustiness * 0.05, rough(0.4));
      if (lx === 1 || ly === ph - 1) return set(light, 0.7, rough(0.35));
      if (lx === pw - 1 || ly === 1) return set(dark, 0.7, rough(0.4));
      const s = streak(px, py);
      set(s < 0.42 ? dark : s > 0.58 ? light : plate, 0.85 - rustiness * 0.05, rough(0.32 + s * 0.08));
    };
  },
});
