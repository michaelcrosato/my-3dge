/**
 * @file The composite's display filters (PLAN.md WP 13.31): a CRT's shadow mask, glow and flicker, VHS tape, speed
 * lines, a shaped vignette and letterbox bars, as WGSL through TSL's `wgslFn`, after Style Lab's display stage
 * (michaelcrosato/my-ai-3d-demo@34c6fa1, src/runtime/post/stage-display.js), carried into the one composite pass:
 * - **CRT** (`post_crt`): phosphor glow from four neighbours, an aperture grille of red, green and blue columns and a
 *   flicker at 59 Hz; the tube's curvature and scanlines are the `screen` and `scanlines` filters';
 * - **VHS**: rows slipping sideways, most in a tear near the bottom (`post_vhs_slip`, where the pixel looks), colour
 *   smeared to the right while brightness stays sharp (`post_vhs_bleed`) and snow, strongest in a band rolling up the
 *   picture (`post_vhs_snow`);
 * - **speed lines** (`post_speedlines`): wedges in 140 angular cells round a centre, each cell's width, reach and
 *   whether it is drawn changing 12 times a second, like redrawn animation;
 * - **vignette** (`post_vignette`): the corners toward a colour, round or following the screen's shape, hard or soft;
 * - **letterbox** (`post_letterbox`): bars that crop the picture to an aspect ratio.
 *
 * Time is the chain's clock (`frame.y`, the view's seconds, never the sim's), so a paused picture holds still. Sizes
 * are in pixels at 1080 lines, scaled to the picture's lines (`unit`).
 *
 * Invariants: pure functions of their arguments (the textures included); colours are display colours in 0–1.
 *
 * @example
 * // s = mix(s, post_vignette(s, uv_in, aspect, strength, softness, roundness, colour), amount);
 * @see engine/gfx/post/composite.ts
 * @see tests/e2e/filters.spec.ts
 */
import { postHash, postLuma, wgsl } from './common';
import { postAt } from './lens';

/** A CRT over `s` at `p` (see the file comment): `crt` (on, mask, glow, flicker), at time `t`. */
export const postCrt = wgsl(
  `
fn post_crt(display: texture_2d<f32>, display_s: sampler, s: vec3<f32>, p: vec2<f32>, fd: vec2<f32>, unit: f32, mask: f32, glow: f32, flicker: f32, t: f32) -> vec3<f32> {
  let o = 2.0 * unit;
  let near = (post_at(display, display_s, p + vec2<f32>(o, 0.0), fd) + post_at(display, display_s, p - vec2<f32>(o, 0.0), fd)
    + post_at(display, display_s, p + vec2<f32>(0.0, o), fd) + post_at(display, display_s, p - vec2<f32>(0.0, o), fd)) * 0.25;
  var c = mix(s, max(s, near), glow) + near * glow * 0.2;
  let triad = u32(floor(p.x / max(unit, 1.0))) % 3u;
  let grille = vec3<f32>(select(0.8, 1.25, triad == 0u), select(0.8, 1.25, triad == 1u), select(0.8, 1.25, triad == 2u));
  c = c * mix(vec3<f32>(1.0), grille, mask);
  return c * (1.0 + sin(t * 59.0) * flicker * 0.1);
}`,
  [postAt],
);

/** Where VHS tracking moves the pixel at `uv`: rows slip by `jitter`, most in a tear near the bottom, at time `t`. */
export const postVhsSlip = wgsl(
  `
fn post_vhs_slip(uv: vec2<f32>, jitter: f32, t: f32) -> vec2<f32> {
  let row = floor(uv.y * 240.0);
  let wobble = (post_hash2(vec2<f32>(row, floor(t * 30.0))) - 0.5) * 0.004;
  let tear_at = 0.9 + sin(t * 0.7) * 0.03;
  let tear = smoothstep(0.05, 0.0, abs(uv.y - tear_at)) * (sin(uv.y * 160.0 + t * 23.0) * 0.5 + 0.5) * 0.025;
  return vec2<f32>(uv.x + (wobble + tear) * jitter, uv.y);
}`,
  [postHash],
);

/** `s` with VHS colour bleed `bleed` at `p`: brightness kept, colour smeared to the right over about 10 px. */
export const postVhsBleed = wgsl(
  `
fn post_vhs_bleed(display: texture_2d<f32>, display_s: sampler, s: vec3<f32>, p: vec2<f32>, fd: vec2<f32>, unit: f32, bleed: f32) -> vec3<f32> {
  let px = unit * (bleed * 3.0 + 0.5);
  let smear = (s + post_at(display, display_s, p - vec2<f32>(px, 0.0), fd) + post_at(display, display_s, p - vec2<f32>(px * 2.0, 0.0), fd)
    + post_at(display, display_s, p - vec2<f32>(px * 3.0, 0.0), fd)) * 0.25;
  let y = post_luma(s);
  return vec3<f32>(y) + mix(s - vec3<f32>(y), smear - vec3<f32>(post_luma(smear)), bleed) * 0.92;
}`,
  [postAt, postLuma],
);

/** VHS snow at pixel `frag` and height `y` (0 the top), `noise` strong, at time `t`. */
export const postVhsSnow = wgsl(
  `
fn post_vhs_snow(frag: vec2<f32>, y: f32, noise: f32, t: f32) -> f32 {
  let snow = post_hash2(frag * vec2<f32>(0.137, 1.731) + vec2<f32>(fract(t * 7.3) * 91.7, 0.0)) - 0.5;
  let band = smoothstep(0.06, 0.0, abs(fract(1.0 - y + t * 0.12) - 0.5));
  return snow * noise * (band * 0.6 + 0.25);
}`,
  [postHash],
);

/** How much of a speed line covers `uv` (see the file comment): `density`, a `clear` middle round `centre`, time `t`. */
export const postSpeedlines = wgsl(
  `
fn post_speedlines(uv: vec2<f32>, aspect: f32, density: f32, clear: f32, centre: vec2<f32>, t: f32) -> f32 {
  let p = (vec2<f32>(uv.x, 1.0 - uv.y) - centre) * vec2<f32>(aspect, 1.0);
  let r = length(p) / (length(vec2<f32>(aspect, 1.0)) * 0.5);
  let a = (atan2(p.y, p.x) / 6.2831853 + 0.5) * 140.0;
  let cell = floor(a);
  let f = fract(a);
  let frame = floor(t * 12.0);
  let h1 = post_hash2(vec2<f32>(cell, frame * 17.31));
  let h2 = post_hash2(vec2<f32>(cell * 3.17, frame * 5.7 + 1.3));
  let h3 = post_hash2(vec2<f32>(cell * 7.9, frame + 4.1));
  let drawn = step(1.0 - density, h1);
  let width = h2 * 0.35 + 0.08;
  let wedge = smoothstep(width, width * 0.4, abs(f - 0.5));
  let start = clear + h3 * 0.5 * (1.0 - density + 0.3);
  return wedge * drawn * smoothstep(start, start + 0.18, r);
}`,
  [postHash],
);

/** `s` vignetted at `uv`: toward `color` by `strength`, `softness` 0 hard to 1 soft, `roundness` 1 round. */
export const postVignette = wgsl(`
fn post_vignette(s: vec3<f32>, uv: vec2<f32>, aspect: f32, strength: f32, softness: f32, roundness: f32, color: vec3<f32>) -> vec3<f32> {
  let sx = mix(1.0, aspect, roundness);
  let p = (uv - 0.5) * 2.0 * vec2<f32>(sx, 1.0);
  let r = length(p) / length(vec2<f32>(sx, 1.0));
  return mix(s, color, smoothstep(1.0 - softness, 1.0 + softness * 0.2, r) * strength);
}`);

/** 1 on the letterbox bars that crop a picture `screen_aspect` wide to `aspect` at `uv`, else 0. */
export const postLetterbox = wgsl(`
fn post_letterbox(uv: vec2<f32>, screen_aspect: f32, aspect: f32) -> f32 {
  let bar_y = max(1.0 - screen_aspect / aspect, 0.0) * 0.5;
  let bar_x = max(1.0 - aspect / screen_aspect, 0.0) * 0.5;
  let on_y = select(0.0, 1.0, bar_y > 1e-4 && (uv.y < bar_y || uv.y > 1.0 - bar_y));
  let on_x = select(0.0, 1.0, bar_x > 1e-4 && (uv.x < bar_x || uv.x > 1.0 - bar_x));
  return max(on_x, on_y);
}`);
