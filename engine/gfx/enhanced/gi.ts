/**
 * @file Bounce light (PLAN.md WP 11.5): screen-space global illumination, shardfall's 12-tap spiral (its "Bounce
 * light" preset), for the look's `gi` section. Around each pixel it reads 12 neighbours on a golden-angle spiral,
 * turned per pixel by interleaved gradient noise so the pattern does not show: light from a lit neighbour facing the
 * pixel bounces onto it (colour bleed), and nearby geometry above its surface occludes it softly. engine/gfx/post/
 * shading.ts lays it on the scene's light inside the display pass, behind a uniform: no pass of its own, and with the
 * section off it costs one comparison a pixel. With `feature:gi` off, a look's `gi` draws nothing.
 *
 * The spiral's radius is metres at the pixel's depth: `gi.z` is the picture's pixels a metre one metre away
 * (height × the projection's y scale ÷ 2); a perspective camera divides by the depth, an orthographic one (the iso and
 * top-down cameras) does not (shardfall drew through perspective cameras only). r182's `SSGINode`, the plan's tier
 * above this one, reads a perspective camera's field of view; it arrives when a look needs it (PLAN.md WP 11.5's
 * Build line).
 *
 * Carried from `shardfall:crates/pav_render/src/shaders/post.wgsl:103-151` (`view_pos`, `screen_gi`) and
 * `post.wgsl:296-299` (how it is laid on), as WGSL; the normals are the MRT's, view-space already
 * (engine/gfx/post/mrt.ts), where shardfall's were world-space.
 *
 * Invariants: presentation only, never in the hash; a pure function of the scene pass's textures and its arguments.
 *
 * @example
 * // engine/gfx/post/shading.ts: col = col * (1 - min(gi.a * strength * 1.5, 0.7)) + gi.rgb * strength * 1.6
 * GI.taps; // 12
 * @see engine/gfx/enhanced/gi.test.ts
 * @see tests/e2e/enhanced.spec.ts
 */
import { defineCodes } from '../../core/log';
import { wgsl } from '../post/shaders/common';

/** Its advice code, raised by the feature registry when it is off. */
export const GI_CODES = defineCodes('gfx', {
  GFX_NO_GI: {
    template: '{feature} is off: {reason}; {downgrade}',
    fix: 'nothing to do for play; take the feature out of gfx.featuresOff if it is listed there',
    doc: "Advice from the feature registry (engine/gfx/features.ts) when bounce light is off: a look's `gi` section draws nothing.",
  },
});

/** Its feature entry (engine/gfx/features.ts registers it). */
export const GI_FEATURE = {
  id: 'feature:gi',
  description:
    "Bounce light: shardfall's 12-tap screen-space GI, colour bleed and soft occlusion where a look's gi section asks (engine/gfx/enhanced/gi.ts).",
  advice: 'GFX_NO_GI',
  downgrade: 'no bounce light: surfaces take no colour from their neighbours',
} as const;

/** The spiral: taps a pixel, and the least and most radius on screen (px), shardfall's. */
export const GI = { taps: 12, minPx: 3, maxPx: 90 } as const;

/** A pixel's view-space position from the depth buffer (shardfall's `view_pos`, WebGPU's 0–1 depth). */
export const shadeViewPos = wgsl(`
fn shade_view_pos(depth: texture_depth_2d, px: vec2<i32>, dims: vec2<i32>, inv_proj: mat4x4<f32>) -> vec3<f32> {
  let d = textureLoad(depth, px, 0);
  let ndc = vec2<f32>((f32(px.x) + 0.5) / f32(dims.x) * 2.0 - 1.0, 1.0 - (f32(px.y) + 0.5) / f32(dims.y) * 2.0);
  let v = inv_proj * vec4<f32>(ndc, d, 1.0);
  return v.xyz / v.w;
}`);

/**
 * The bounce light and occlusion at `px` (rgb, a), shardfall's spiral: `gi` = (strength, radius m, px a metre at 1 m,
 * frame), `lens.x` 1 for an orthographic camera.
 */
export const shadeGi = wgsl(
  `
fn shade_gi(colour: texture_2d<f32>, depth: texture_depth_2d, normals: texture_2d<f32>, px: vec2<i32>, dims: vec2<i32>, inv_proj: mat4x4<f32>, gi: vec4<f32>, lens: vec4<f32>) -> vec4<f32> {
  if (textureLoad(depth, px, 0) >= 1.0) {
    return vec4<f32>(0.0);
  }
  let n4 = textureLoad(normals, px, 0);
  if (dot(n4.xyz, n4.xyz) < 0.25) {
    return vec4<f32>(0.0);
  }
  let n = normalize(n4.xyz);
  let p = shade_view_pos(depth, px, dims, inv_proj);
  let rad = gi.y;
  let reach = select(max(-p.z, 0.1), 1.0, lens.x > 0.5);
  let rad_px = clamp(rad * gi.z / reach, ${GI.minPx}.0, ${GI.maxPx}.0);
  let ign = fract(52.9829189 * fract(0.06711056 * f32(px.x) + 0.00583715 * f32(px.y) + gi.w * 0.618));
  var bounce = vec3<f32>(0.0);
  var occ = 0.0;
  for (var i = 0; i < ${GI.taps}; i++) {
    let fi = f32(i);
    let a = fi * 2.39996 + ign * 6.2831;
    let r = sqrt((fi + 0.5) / ${GI.taps}.0) * rad_px;
    let q = clamp(px + vec2<i32>(vec2<f32>(cos(a), sin(a)) * r), vec2<i32>(0), dims - vec2<i32>(1));
    if (textureLoad(depth, q, 0) >= 1.0) {
      continue;
    }
    let v = shade_view_pos(depth, q, dims, inv_proj) - p;
    let dist = length(v);
    if (dist < 1e-3 || dist > rad * 2.0) {
      continue;
    }
    let dir = v / dist;
    let ndl = max(dot(n, dir) - 0.05, 0.0);
    let fall = 1.0 / (1.0 + dist * dist / (rad * rad));
    occ += ndl * fall;
    let qn = textureLoad(normals, q, 0).xyz;
    let emit = max(dot(normalize(qn + vec3<f32>(1e-6)), -dir), 0.0);
    bounce += textureLoad(colour, q, 0).rgb * ndl * emit * fall;
  }
  return vec4<f32>(bounce / ${GI.taps}.0, occ / ${GI.taps}.0);
}`,
  [shadeViewPos],
);

/** The pixels a metre one metre away, for a `height` px picture and a projection whose y scale is `yScale`. */
export const giScale = (height: number, yScale: number): number => height * yScale * 0.5;
