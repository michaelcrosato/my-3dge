/**
 * @file The filters the post-processing T2 tries (tests/e2e/post.spec.ts, PLAN.md WP 7.4): the scoped filters with
 * the share of their scope each must change, the scopes with the parts they cover, and the whole-screen filters with
 * the share of the picture each must change. Data only.
 *
 * Invariants: parts are 0 a character, 1 an object, 2 the environment, as tests/e2e/post-pixels.ts reads them.
 */

/**
 * The scoped filters, each with numbers that change what they touch plainly, the share each must change and, for some,
 * the colour every changed pixel takes (`to`, sRGB): every palette, the levels alone (palette `none`), every style, and
 * the outline's own colour (with `darken: 1` only the colour can change a pixel). The shares are about half those
 * measured on the least covered part (WP 7.4's review).
 */
export const SCOPED: {
  name: string;
  filters: Record<string, unknown>;
  inside: number;
  to?: [number, number, number];
}[] = [
  { name: 'cel', filters: { bands: 3, punch: 1.8, ink: 1 }, inside: 0.25 },
  { name: 'pixel', filters: { size: 6, levels: 8, outline: false, snap: false }, inside: 0.2 },
  { name: 'palette', filters: { palette: 'gameboy', dither: 0.6 }, inside: 0.6 },
  { name: 'palette', filters: { palette: 'pico8', dither: 0.6 }, inside: 0.5 },
  { name: 'palette', filters: { palette: 'cga', dither: 0.6 }, inside: 0.5 },
  { name: 'palette', filters: { palette: '1bit', dither: 0.6 }, inside: 0.5 },
  { name: 'palette', filters: { palette: 'amber', dither: 0.6 }, inside: 0.5 },
  { name: 'palette', filters: { palette: 'none', levels: 8, dither: 0 }, inside: 0.4 },
  { name: 'outline', filters: { width: 2, darken: 0 }, inside: 0.02 },
  { name: 'outline', filters: { width: 2, darken: 1, color: '#ff0000' }, inside: 0.02, to: [255, 0, 0] },
  { name: 'stylize', filters: { style: 'paint', size: 4, color: 1 }, inside: 0.15 },
  { name: 'stylize', filters: { style: 'halftone', size: 4, color: 1 }, inside: 0.5 },
  { name: 'stylize', filters: { style: 'ascii', size: 6, color: 1 }, inside: 0.5 },
  { name: 'stylize', filters: { style: 'sketch', size: 4, color: 1 }, inside: 0.4 },
  { name: 'grade', filters: { temperature: 1, brightness: 1.6, saturation: 0 }, inside: 0.5 },
  { name: 'scanlines', filters: { strength: 1, period: 2 }, inside: 0.25 },
  { name: 'grain', filters: { amount: 1 }, inside: 0.3 },
  { name: 'chroma', filters: { amount: 1 }, inside: 0.01 },
];

/** The scopes tried, each with the parts (0 characters, 1 objects, 2 environment) it covers. */
export const SCOPES: [string, number[]][] = [
  ['all', [0, 1, 2]],
  ['characters', [0]],
  ['objects', [1]],
  ['environment', [2]],
];

/** The whole-screen filters, each with the share of the picture it must change. */
export const SCREEN: { filters: Record<string, unknown>; changed: number }[] = [
  { filters: { bloom: { scope: 'all', strength: 1.5, threshold: 0.1 } }, changed: 0.05 },
  { filters: { aa: { scope: 'all' } }, changed: 0.01 },
  { filters: { screen: { scope: 'all', curvature: 0.2 } }, changed: 0.3 },
  { filters: { screen: { scope: 'all', vignette: 1 } }, changed: 0.2 },
  { filters: { screen: { scope: 'all', pixelate: 4 } }, changed: 0.3 },
];
