/**
 * @file The filters Style Lab brought, as tests/e2e/filters.spec.ts tries them (PLAN.md WP 13.31): the scoped ones with
 * the share of their scope each must change, the camera and screen ones with the share of the picture each must
 * change, both with numbers that change what they touch plainly, and grade's and outline's new numbers. The shares are
 * about half those measured on the least covered part (WP 13.31's first run: sharpen 0.43 on the characters,
 * misregister 0.48, watercolor 0.67, paper 0.75, selective 0.28 and grade's hue 0.33 on the environment, outline's
 * wobble and boil 0.23 against about 0.04 without them; split, duotone and the rest of grade 1; lens 0.86, dof 0.74,
 * tiltshift 0.61, flare 0.97, streaks 0.96, crt 1, vhs 0.77, speedlines 0.44, vignette 0.15 and letterbox 0.36 of the
 * picture, its bars' share of a 480 × 270 frame cropped to 2.8). Data only.
 *
 * Invariants: every filter Style Lab brought has a case here; the scopes are tests/e2e/post-cases.ts's.
 */

/** The scoped filters (see the file comment). */
export const SCOPED_MORE: { name: string; filters: Record<string, unknown>; inside: number }[] = [
  { name: 'sharpen', filters: { strength: 2, radius: 2 }, inside: 0.2 },
  { name: 'misregister', filters: { offset: 6, angle: 30 }, inside: 0.2 },
  { name: 'watercolor', filters: { wobble: 6, bleed: 1, edges: 1, granulation: 1 }, inside: 0.3 },
  { name: 'paper', filters: { kind: 'canvas', strength: 1, color: '#ffe0a0' }, inside: 0.35 },
  { name: 'split', filters: { shadows: '#0000ff', highlights: '#ff8000', balance: 0 }, inside: 0.5 },
  { name: 'selective', filters: { hue: 120, range: 10 }, inside: 0.14 },
  { name: 'duotone', filters: { dark: '#000040', mid: '#ff0000', light: '#ffff00' }, inside: 0.5 },
  { name: 'grade', filters: { hue: 120 }, inside: 0.15 },
  { name: 'grade', filters: { sepia: 1, bleach: 1, lift: 0.2 }, inside: 0.5 },
  { name: 'outline', filters: { width: 2, darken: 0, wobble: 3, boil: 12 }, inside: 0.1 },
];

/** The camera and screen filters (see the file comment). */
export const SCREEN_MORE: { filters: Record<string, unknown>; changed: number }[] = [
  { filters: { lens: { scope: 'all', distortion: 0.4 } }, changed: 0.4 },
  { filters: { dof: { scope: 'all', range: 0.5, blur: 24 } }, changed: 0.35 },
  { filters: { tiltshift: { scope: 'all', center: 0.5, width: 0.05, blur: 24 } }, changed: 0.3 },
  { filters: { flare: { scope: 'all', intensity: 3, threshold: 0.2 } }, changed: 0.45 },
  { filters: { streaks: { scope: 'all', intensity: 3, threshold: 0.2, length: 160 } }, changed: 0.45 },
  { filters: { crt: { scope: 'all', mask: 1, glow: 1, flicker: 0 } }, changed: 0.5 },
  { filters: { vhs: { scope: 'all', jitter: 1, bleed: 1, noise: 1 } }, changed: 0.35 },
  { filters: { speedlines: { scope: 'all', density: 1, clear: 0.1 } }, changed: 0.2 },
  { filters: { vignette: { scope: 'all', strength: 1, softness: 0.3 } }, changed: 0.07 },
  { filters: { letterbox: { scope: 'all', aspect: 2.8 } }, changed: 0.18 },
];
