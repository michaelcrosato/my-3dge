/**
 * @file A sky's backdrop strip (PLAN.md WP 7.1; engine/gfx/sky.ts draws it): silhouette layers round the horizon,
 * baked on the CPU into one strip (`bakeBackdrop`, RGBA bytes, row 0 at the bottom), its layers drawn far to near:
 * ridged `mountains`, smooth `hills` and a `forest` tree line, each a sum of sines with whole cycles across the strip,
 * so it tiles, shaded darker toward its foot and hazed toward the preset's haze colour. Split from engine/gfx/sky.ts
 * to keep each under 400 lines (WP 11.5).
 *
 * Invariants: equal specs bake equal strips; above the skylines the strip is clear (alpha 0).
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:3859-3958` (§21b, the backdrop generators: `ridge`, `smooth`, `range`
 * and the tones).
 *
 * @example
 * bakeBackdrop({ haze: '#c8e4f8', layers: [{ kind: 'hills', color: '#5aa060', height: 0.5, haze: 0, seed: 1 }] }, 64, 16).length; // 4096
 * @see engine/gfx/sky.test.ts
 */
import { hex, mix, tones } from '../core/color';
import { derive, Rng } from '../core/rng';

/** The kinds of backdrop layer. */
export const BACKDROP_KINDS = ['mountains', 'hills', 'forest'] as const;

/** A backdrop as a `sky` entry gives it (engine/gfx/sky.ts `BackdropSpec`): the haze colour and the layers. */
export interface BackdropLayers {
  haze: string;
  layers: readonly {
    kind: (typeof BACKDROP_KINDS)[number];
    color: string;
    height: number;
    haze: number;
    seed: number;
  }[];
}

/** The backdrop strip's size in texels, and its band round the camera (m): radius, height, foot below the eye. */
export const BACKDROP = { width: 1024, height: 128, repeat: 3, radius: 100, band: 30, foot: 4 } as const;

const TAU = Math.PI * 2;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const range = (v: number, lo: number, hi: number) => clamp01((v - lo) / (hi - lo));
const ridge = (u: number, p: number[]) =>
  0.52 * (1 - Math.abs(Math.sin(u * 1.5 + p[0]))) +
  0.3 * (1 - Math.abs(Math.sin(u * 3.5 + p[1]))) +
  0.18 * (1 - Math.abs(Math.sin(u * 8.5 + p[2])));
const smooth = (u: number, p: number[]) =>
  0.55 + 0.25 * Math.sin(u * 2 + p[3]) + 0.14 * Math.sin(u * 5 + p[4]) + 0.06 * Math.sin(u * 11 + p[5]);

/** Each layer kind's skyline, 0 to 1, at `u` (rad round the strip), with phases `p`. */
const PROFILES: Record<(typeof BACKDROP_KINDS)[number], (u: number, p: number[]) => number> = {
  mountains: (u, p) => range(ridge(u, p), 0.12, 0.95),
  hills: (u, p) => range(smooth(u, p), 0.15, 1),
  forest: (u, p) => 0.6 * range(smooth(u, p), 0.2, 1) + 0.4 * (1 - Math.abs(Math.sin(u * 61 + p[0]))) ** 3,
};

/** Bakes a backdrop into RGBA bytes, `width` × `height`, row 0 at the bottom; above the skylines is clear. */
export function bakeBackdrop(spec: BackdropLayers, width: number = BACKDROP.width, height: number = BACKDROP.height) {
  const data = new Uint8Array(width * height * 4);
  for (const layer of spec.layers) {
    const rng = new Rng(derive(layer.seed, 'backdrop', layer.kind));
    const phases = Array.from({ length: 6 }, () => rng.range(0, TAU));
    const tone = tones(layer.color);
    const shades = Array.from({ length: 16 }, (_, k) =>
      hex(mix(mix(tone.base, tone.sh, k / 15), spec.haze, layer.haze)),
    );
    const rim = hex(mix(tone.lt, spec.haze, layer.haze));
    for (let x = 0; x < width; x++) {
      const top = Math.round(PROFILES[layer.kind]((x / width) * TAU, phases) * layer.height * (height - 1));
      for (let y = 0; y <= top; y++) {
        const rgb = y === top && top > 0 ? rim : shades[Math.round((1 - y / Math.max(1, top)) * 15)];
        data.set([rgb[0], rgb[1], rgb[2], 255], (y * width + x) * 4);
      }
    }
  }
  return data;
}
