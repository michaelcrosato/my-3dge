/**
 * @file The composite's lens filters (PLAN.md WP 13.31): depth of field, tilt-shift, lens flare, anamorphic streaks
 * and lens distortion, as WGSL through TSL's `wgslFn`, after Style Lab's camera and display stages
 * (michaelcrosato/my-ai-3d-demo@34c6fa1, src/runtime/post/stage-camera.js, stage-display.js). Style Lab builds the
 * first four from three.js's add-on passes (`dof`, `gaussianBlur`, `lensflare`, `anamorphic`), each a render target
 * of its own; here each is a few taps of the picture inside the one composite pass, so turning one on builds nothing
 * and a filter that is off costs one comparison:
 * - **depth of field** (`post_dof`): 16 taps on a golden-angle disc whose radius grows with the distance from the
 *   focus (the depth at the screen's centre when `focus` is 0) beyond half the in-focus `range`; a tap nearer than the
 *   pixel and itself in focus counts a quarter, so sharp things do not smear onto the blur behind them;
 * - **tilt-shift** (`post_tilt`): 12 taps on a disc whose radius grows away from a sharp horizontal band;
 * - **lens flare** (`post_flare`): ghosts of the brightest parts mirrored through the centre, four of them, each a
 *   soft four-tap read, fading toward the screen's edge (three.js's `lensflare` ghost rule);
 * - **anamorphic streaks** (`post_streaks`): 16 taps along the row, the bright parts drawn out sideways;
 * - **lens distortion** (`post_distort`): barrel (above 0) or pincushion (below), zoomed in so the corners stay
 *   filled (Style Lab's rule).
 *
 * Sizes are in pixels at 1080 lines, scaled to the picture's lines (`unit`), so a look keeps its feel at every
 * resolution. The composite works in display colours, so the thresholds are in 0–1 brightness.
 *
 * Invariants: pure functions of their arguments (the textures included); every read stays on the picture; the tap
 * counts are fixed, so the cost of a filter that is on is bounded.
 *
 * @example
 * // s = mix(s, post_dof(display, display_s, depth, p, fd, dims, inv_proj, focus, range, blur * unit), amount);
 * @see engine/gfx/post/composite.ts
 * @see tests/e2e/filters.spec.ts
 */
import { postLuma, postViewDepth, wgsl } from './common';

/** The picture at `p` (pixels), read between texels. */
export const postAt = wgsl(`
fn post_at(display: texture_2d<f32>, display_s: sampler, p: vec2<f32>, fd: vec2<f32>) -> vec3<f32> {
  return textureSampleLevel(display, display_s, clamp(p / fd, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0).rgb;
}`);

/** How far out of focus a point `d` metres away is, in pixels up to `blur`. */
export const postCoc = wgsl(`
fn post_coc(d: f32, focus: f32, range: f32, blur: f32) -> f32 {
  return clamp((abs(d - focus) - range * 0.5) / max(range, 0.01), 0.0, 1.0) * blur;
}`);

/** Depth of field at `p`: see the file comment. */
export const postDof = wgsl(
  `
fn post_dof(display: texture_2d<f32>, display_s: sampler, depth: texture_depth_2d, p: vec2<f32>, fd: vec2<f32>, dims: vec2<i32>, inv_proj: mat4x4<f32>, focus0: f32, range: f32, blur: f32) -> vec3<f32> {
  let d = post_view_depth(depth, vec2<i32>(p), dims, inv_proj);
  var focus = focus0;
  if (focus <= 0.0) {
    focus = post_view_depth(depth, dims / 2, dims, inv_proj);
  }
  let coc = post_coc(d, focus, range, blur);
  if (coc < 0.5) {
    return post_at(display, display_s, p, fd);
  }
  var sum = vec3<f32>(0.0);
  var weights = 0.0;
  for (var i = 0; i < 16; i++) {
    let fi = f32(i) + 0.5;
    let r = sqrt(fi / 16.0) * coc;
    let a = fi * 2.39996323;
    let q = p + vec2<f32>(cos(a), sin(a)) * r;
    let dq = post_view_depth(depth, vec2<i32>(q), dims, inv_proj);
    let w = select(1.0, 0.25, dq < d && post_coc(dq, focus, range, blur) < r * 0.5);
    sum += post_at(display, display_s, q, fd) * w;
    weights += w;
  }
  return sum / max(weights, 0.0001);
}`,
  [postViewDepth, postCoc, postAt],
);

/** Tilt-shift at `p`: sharp in a band `width` high round `center` (0 the bottom, 1 the top), blurred away from it. */
export const postTilt = wgsl(
  `
fn post_tilt(display: texture_2d<f32>, display_s: sampler, p: vec2<f32>, fd: vec2<f32>, center: f32, width: f32, blur: f32) -> vec3<f32> {
  let y = 1.0 - p.y / fd.y;
  let half = width * 0.5;
  let r0 = smoothstep(half, half + 0.22, abs(y - center)) * blur;
  if (r0 < 0.5) {
    return post_at(display, display_s, p, fd);
  }
  var sum = vec3<f32>(0.0);
  for (var i = 0; i < 12; i++) {
    let fi = f32(i) + 0.5;
    let r = sqrt(fi / 12.0) * r0;
    let a = fi * 2.39996323;
    sum += post_at(display, display_s, p + vec2<f32>(cos(a), sin(a)) * r, fd);
  }
  return sum / 12.0;
}`,
  [postAt],
);

/** Lens-flare ghosts at `uv`: the parts brighter than `threshold`, mirrored through the centre, `spacing` apart. */
export const postFlare = wgsl(
  `
fn post_flare(display: texture_2d<f32>, display_s: sampler, uv: vec2<f32>, fd: vec2<f32>, threshold: f32, spacing: f32, unit: f32) -> vec3<f32> {
  let fu = vec2<f32>(1.0) - uv;
  let ghost = (vec2<f32>(0.5) - fu) * spacing;
  let o = vec2<f32>(6.0 * unit) / fd;
  var sum = vec3<f32>(0.0);
  for (var i = 0; i < 4; i++) {
    let q = fract(fu + ghost * f32(i));
    let w = pow(max(1.0 - length(vec2<f32>(0.5) - q) / 0.70710678, 0.0), 3.0);
    let c = (textureSampleLevel(display, display_s, q + o, 0.0).rgb + textureSampleLevel(display, display_s, q - o, 0.0).rgb
      + textureSampleLevel(display, display_s, q + vec2<f32>(o.x, -o.y), 0.0).rgb + textureSampleLevel(display, display_s, q - vec2<f32>(o.x, -o.y), 0.0).rgb) * 0.25;
    sum += max(c - vec3<f32>(threshold), vec3<f32>(0.0)) * w;
  }
  return sum * vec3<f32>(1.0, 0.85, 0.7);
}`,
);

/** Anamorphic streaks at `p`: the parts brighter than `threshold` drawn out `reach` px each side, tinted. */
export const postStreaks = wgsl(
  `
fn post_streaks(display: texture_2d<f32>, display_s: sampler, p: vec2<f32>, fd: vec2<f32>, threshold: f32, reach: f32, tint: vec3<f32>) -> vec3<f32> {
  var sum = 0.0;
  for (var i = -8; i <= 8; i++) {
    let c = post_at(display, display_s, p + vec2<f32>(f32(i) * reach / 8.0, 0.0), fd);
    sum += max(post_luma(c) - threshold, 0.0) * (1.0 - abs(f32(i)) / 9.0);
  }
  return tint * sum / 6.0;
}`,
  [postAt, postLuma],
);

/** Where lens distortion `k` (barrel above 0) looks for the pixel at `uv`, on a picture `aspect` wide. */
export const postDistort = wgsl(`
fn post_distort(uv: vec2<f32>, aspect: f32, k0: f32) -> vec2<f32> {
  let k = k0 * 1.6;
  let p = (uv - 0.5) * vec2<f32>(aspect, 1.0);
  let corner = (aspect * aspect + 1.0) * 0.25;
  let zoom = 1.0 / (1.0 + max(k, 0.0) * corner);
  let q = p * (1.0 + k * dot(p, p)) * zoom / vec2<f32>(aspect, 1.0) + 0.5;
  return clamp(q, vec2<f32>(0.0), vec2<f32>(1.0));
}`);
