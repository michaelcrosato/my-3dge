/**
 * @file The composite's colour and tone filters (PLAN.md WP 13.31): the grade's further steps, split toning, selective
 * colour and the gradient map, as WGSL through TSL's `wgslFn`. Ported from Style Lab's grade stage
 * (michaelcrosato/my-ai-3d-demo@34c6fa1, src/runtime/post/stage-grade.js), whose maths are three.js r182's own
 * (`three/src/nodes/display/ColorAdjustment.js`: `cdl`, `vibrance`, `hue`; `three/examples/jsm/tsl/display/Sepia.js`
 * and `BleachBypass.js`), carried into the one composite pass so a switch stays a uniform write.
 *
 * - **the grade's further steps** (`post_grade_more`): lift (an offset on every channel, ASC CDL's), gamma (its power:
 *   above 1 darkens the midtones), vibrance (three's: the duller colours pushed most), a hue rotation about the grey
 *   axis, sepia (glfx.js's matrix) and bleach bypass (the picture overlaid with its own grey); each step is skipped
 *   at its neutral value, so a grade without them draws as before;
 * - **split toning** (`post_split`): the shadows soft-lit toward one colour and the highlights toward another, the
 *   balance moving where they meet;
 * - **selective colour** (`post_selective`): every hue but one turned grey, the kept hue measured in OKLab so it reads
 *   evenly across colours, near-greys left alone;
 * - **gradient map** (`post_duotone`): brightness mapped onto dark, mid and light colours.
 *
 * Invariants: pure functions of their arguments; colours are display colours (sRGB) in 0–1, the results clamped by
 * the composite; how much of each shows is the composite's (`amount`, mixed with what came in).
 *
 * @example
 * // s = mix(s, post_split(s, balance, shadows, highlights), amount);
 * @see engine/gfx/post/composite.ts
 * @see tests/e2e/filters.spec.ts
 */
import { postLuma, wgsl } from './common';

/** The grade's further steps on `c`: `g3` (lift, gamma, vibrance, hue in degrees), `g4` (sepia, bleach, 0, 0). */
export const postGradeMore = wgsl(
  `
fn post_grade_more(c0: vec3<f32>, g3: vec4<f32>, g4: vec4<f32>) -> vec3<f32> {
  var c = c0;
  if (g3.x != 0.0 || g3.y != 1.0) {
    let v = max(c + vec3<f32>(g3.x), vec3<f32>(0.0));
    let pv = pow(v, vec3<f32>(max(g3.y, 0.01)));
    c = select(v, pv, v > vec3<f32>(0.0));
  }
  if (g3.z != 0.0) {
    let average = (c.r + c.g + c.b) / 3.0;
    let mx = max(c.r, max(c.g, c.b));
    c = mix(c, vec3<f32>(mx), (mx - average) * g3.z * -3.0);
  }
  if (g3.w != 0.0) {
    let a = radians(g3.w);
    let k = vec3<f32>(0.57735, 0.57735, 0.57735);
    let ca = cos(a);
    c = c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
  }
  if (g4.x > 0.0) {
    let sepia = vec3<f32>(dot(c, vec3<f32>(0.393, 0.769, 0.189)), dot(c, vec3<f32>(0.349, 0.686, 0.168)), dot(c, vec3<f32>(0.272, 0.534, 0.131)));
    c = mix(c, min(sepia, vec3<f32>(1.0)), g4.x);
  }
  if (g4.y > 0.0) {
    let l = post_luma(c);
    let blend = vec3<f32>(l);
    let k = clamp(10.0 * (l - 0.45), 0.0, 1.0);
    let bleached = mix(blend * c * 2.0, vec3<f32>(1.0) - 2.0 * (vec3<f32>(1.0) - blend) * (vec3<f32>(1.0) - c), vec3<f32>(k));
    c = mix(c, bleached, g4.y);
  }
  return c;
}`,
  [postLuma],
);

/** Split toning of `c`: the shadows toward `shadows`, the highlights toward `highlights` (soft light). */
export const postSplit = wgsl(
  `
fn post_split(c: vec3<f32>, balance: f32, shadows: vec3<f32>, highlights: vec3<f32>) -> vec3<f32> {
  let h = smoothstep(0.05, 0.95, post_luma(c) - balance * 0.25);
  let tone = mix(shadows, highlights, h);
  return c * c * (vec3<f32>(1.0) - 2.0 * tone) + 2.0 * c * tone;
}`,
  [postLuma],
);

/** `c` in OKLab (L, a, b), from display colours. */
export const postOklab = wgsl(`
fn post_oklab(c: vec3<f32>) -> vec3<f32> {
  let lin = select(c / 12.92, pow((c + 0.055) / 1.055, vec3<f32>(2.4)), c > vec3<f32>(0.04045));
  let l = 0.4122214708 * lin.r + 0.5363325363 * lin.g + 0.0514459929 * lin.b;
  let m = 0.2119034982 * lin.r + 0.6806995451 * lin.g + 0.1073969566 * lin.b;
  let s = 0.0883024619 * lin.r + 0.2817188376 * lin.g + 0.6299787005 * lin.b;
  let lms = pow(max(vec3<f32>(l, m, s), vec3<f32>(0.0)), vec3<f32>(1.0 / 3.0));
  return vec3<f32>(
    0.2104542553 * lms.x + 0.7936177850 * lms.y - 0.0040720468 * lms.z,
    1.9779984951 * lms.x - 2.4285922050 * lms.y + 0.4505937099 * lms.z,
    0.0259040371 * lms.x + 0.7827717662 * lms.y - 0.8086757660 * lms.z,
  );
}`);

/** `c` with every hue but `hue` (degrees, ± `range`) turned grey; near-greys stay as they are. */
export const postSelective = wgsl(
  `
fn post_selective(c: vec3<f32>, hue: f32, range: f32) -> vec3<f32> {
  let lab = post_oklab(c);
  let h = degrees(atan2(lab.z, lab.y));
  let d = abs(fract((h - hue) / 360.0 + 0.5) - 0.5) * 360.0;
  let keep = (1.0 - smoothstep(range * 0.6, range, d)) * smoothstep(0.02, 0.06, length(lab.yz));
  return mix(c, vec3<f32>(post_luma(c)), 1.0 - keep);
}`,
  [postOklab, postLuma],
);

/** `c`'s brightness mapped onto `dark`, `mid` and `light` (a gradient map). */
export const postDuotone = wgsl(
  `
fn post_duotone(c: vec3<f32>, dark: vec3<f32>, mid: vec3<f32>, light: vec3<f32>) -> vec3<f32> {
  let t = clamp(post_luma(c), 0.0, 1.0);
  return select(mix(mid, light, t * 2.0 - 1.0), mix(dark, mid, t * 2.0), t < 0.5);
}`,
  [postLuma],
);
