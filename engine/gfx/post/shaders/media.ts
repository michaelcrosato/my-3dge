/**
 * @file The composite's media filters (PLAN.md WP 13.31): watercolour, paper, sharpening and print misregistration,
 * as WGSL through TSL's `wgslFn`, after Style Lab's medium stage (michaelcrosato/my-ai-3d-demo@34c6fa1,
 * src/runtime/post/stage-medium.js), carried into the one composite pass:
 * - **watercolour** (`post_watercolor`): an eight-tap ring of the picture round the pixel bleeds into it, darkens it
 *   where colour changes (pigment pooling at a wash's edge) and granulates it in the paper's dips, most in dark
 *   washes; its hand wobble moves where the pixel looks (`post_wobble`), before the picture is read;
 * - **paper** (`post_paper`): newsprint fibres, cold-pressed bumps, canvas weave or kraft fibres in the paper's colour,
 *   multiplied in, so the paper tints and textures the light areas while dark ink stays dark;
 * - **sharpen** (`post_sharpen`): an unsharp mask, the picture minus four diagonal taps of itself;
 * - **misregistration** (`post_misregister`): the red and blue plates offset each way along an angle, as in a print.
 *
 * The neighbours read are the picture before the composite (`display`), while the pixel's own colour is the one the
 * filters before have made (`s`), so a watercolour over the cel look keeps its bands. Sizes are in pixels at 1080
 * lines, scaled to the picture's lines (`unit`); the noises are positioned in the picture's pixels at 1080 lines, so
 * a paper's grain is the same size at every resolution.
 *
 * Invariants: pure functions of their arguments (the textures included); colours are display colours in 0–1; the
 * paper kinds are `PAPER_KINDS`' order (engine/gfx/post/filters.ts).
 *
 * @example
 * // s = mix(s, post_paper(s, frag / unit, kind, scale, strength, colour), amount);
 * @see engine/gfx/post/composite.ts
 * @see tests/e2e/filters.spec.ts
 */
import { postLuma, postNoise, wgsl } from './common';
import { postAt } from './lens';

/** Where a hand wobble `wobble` px (at 1080 lines) moves the pixel at `p`, the noise at 1080-line `q`. */
export const postWobble = wgsl(
  `
fn post_wobble(p: vec2<f32>, q: vec2<f32>, wobble: f32, unit: f32) -> vec2<f32> {
  let w = vec2<f32>(post_vnoise(q * 0.012 + vec2<f32>(1.3, 0.0)), post_vnoise(q * 0.012 + vec2<f32>(7.1, 3.3))) - 0.5;
  return p + w * 2.0 * wobble * unit;
}`,
  [postNoise],
);

/** Watercolour over `s` at `p` (see the file comment): `wc` (bleed, edges, granulation), `q` the 1080-line position. */
export const postWatercolor = wgsl(
  `
fn post_watercolor(display: texture_2d<f32>, display_s: sampler, s: vec3<f32>, p: vec2<f32>, q: vec2<f32>, fd: vec2<f32>, unit: f32, bleed: f32, edges: f32, granulation: f32) -> vec3<f32> {
  let base = post_at(display, display_s, p, fd);
  var ring = vec3<f32>(0.0);
  let radius = (bleed * 4.0 + 2.0) * unit;
  for (var i = 0; i < 8; i++) {
    let a = f32(i) * 0.78539816;
    ring += post_at(display, display_s, p + vec2<f32>(cos(a), sin(a)) * radius, fd);
  }
  ring = ring / 8.0;
  let bled = mix(s, ring, bleed * 0.7);
  let edge = smoothstep(0.02, 0.16, length(base - ring));
  let pooled = bled * (1.0 - edge * edges * 0.55);
  let grain = post_vnoise(q * 0.35 + vec2<f32>(3.7, 1.1)) * 0.6 + post_vnoise(q * 0.07 + vec2<f32>(9.2, 4.4)) * 0.4;
  return pooled * (1.0 - grain * (1.0 - post_luma(pooled)) * granulation * 0.45);
}`,
  [postAt, postNoise, postLuma],
);

/** Paper of `kind` (0 newsprint, 1 cold-pressed, 2 canvas, 3 kraft) under `s`, `q` the 1080-line position. */
export const postPaper = wgsl(
  `
fn post_paper(s: vec3<f32>, q: vec2<f32>, kind: f32, scale: f32, color: vec3<f32>) -> vec3<f32> {
  let p = q / max(scale, 0.05);
  let fibres = post_vnoise(p * vec2<f32>(0.9, 0.12) + vec2<f32>(2.1, 0.0)) * 0.5 + post_vnoise(p * 0.45 + vec2<f32>(5.3, 1.7)) * 0.5;
  let bumps = (1.0 - abs(post_vnoise(p * 0.05) * 2.0 - 1.0)) * 0.7 + post_vnoise(p * 0.3 + vec2<f32>(1.1, 6.2)) * 0.3;
  let weave = (sin(p.x * 0.9) * sin(p.y * 0.9) * 0.5 + 0.5) * 0.6 + post_vnoise(p * 0.2 + vec2<f32>(8.4, 2.2)) * 0.4;
  let k = u32(kind + 0.5);
  var relief = fibres;
  if (k == 1u) {
    relief = bumps;
  } else if (k == 2u) {
    relief = weave;
  } else if (k == 3u) {
    relief = fibres * 0.7 + post_vnoise(p * 0.06 + vec2<f32>(4.0, 9.0)) * 0.3;
  }
  return s * color * (relief * 0.22 + 0.82);
}`,
  [postNoise],
);

/** `s` sharpened at `p`: plus `strength` times the picture minus its four diagonal taps `radius` px away. */
export const postSharpen = wgsl(
  `
fn post_sharpen(display: texture_2d<f32>, display_s: sampler, s: vec3<f32>, p: vec2<f32>, fd: vec2<f32>, strength: f32, radius: f32) -> vec3<f32> {
  let o = vec2<f32>(max(radius, 0.5));
  let blur = (post_at(display, display_s, p + o, fd) + post_at(display, display_s, p - o, fd)
    + post_at(display, display_s, p + vec2<f32>(o.x, -o.y), fd) + post_at(display, display_s, p - vec2<f32>(o.x, -o.y), fd)) * 0.25;
  return max(s + (post_at(display, display_s, p, fd) - blur) * strength, vec3<f32>(0.0));
}`,
  [postAt],
);

/** `s` with its red plate `offset` px one way along `angle` (degrees) and its blue plate the other. */
export const postMisregister = wgsl(
  `
fn post_misregister(display: texture_2d<f32>, display_s: sampler, s: vec3<f32>, p: vec2<f32>, fd: vec2<f32>, offset: f32, angle: f32) -> vec3<f32> {
  let a = radians(angle);
  let o = vec2<f32>(cos(a), sin(a)) * offset;
  return vec3<f32>(post_at(display, display_s, p + o, fd).r, s.g, post_at(display, display_s, p - o, fd).b);
}`,
  [postAt],
);
