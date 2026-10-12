/**
 * @file The composite's small WGSL helpers (PLAN.md WP 7.4): brightness, noise, what the MRT's flags say about a
 * pixel, linear depth, the Bayer threshold and the fixed palettes, each a TSL `wgslFn` that later functions include.
 * They are shardfall's, carried as WGSL (`shardfall:crates/pav_render/src/shaders/post.wgsl:55-101, 332-409`), with
 * the parts read the way engine/gfx/post/mrt.ts packs them: the absolute flags value is 1536 or more on characters,
 * 1024 or more on objects, less on the environment; the cleared background has a zero normal and counts as the
 * environment. Every name starts with `post_`, so none meets a name three.js generates.
 *
 * Invariants: pure functions of their arguments (the textures included); colours are display colours (sRGB) in 0–1.
 *
 * @example
 * // const luma = postLuma({ c: vec3(1, 1, 1) }); // 1
 * @see engine/gfx/post/composite.ts
 * @see tests/e2e/post.spec.ts
 */
import { wgslFn } from 'three/tsl';

/** A WGSL function as TSL calls it: with its arguments by name, `fn({ c: colour })`. */
export type WgslFunction = ReturnType<typeof wgslFn>;

/**
 * A WGSL function for TSL (`wgslFn`); `includes` are the functions it calls. r182 takes `wgslFn` functions as
 * includes (`three/src/nodes/code/FunctionNode.js:158-168`), which its type declarations leave out.
 */
export function wgsl(code: string, includes: WgslFunction[] = []): WgslFunction {
  return wgslFn(code, includes as unknown as Parameters<typeof wgslFn>[1]);
}

/** Rec. 709 luma of a display colour. */
export const postLuma = wgsl(`
fn post_luma(c: vec3<f32>) -> f32 {
  return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}`);

/** A hash of a position, 0 to 1. */
export const postHash = wgsl(`
fn post_hash2(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}`);

/** Smooth value noise, 0 to 1. */
export const postNoise = wgsl(
  `
fn post_vnoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = post_hash2(i);
  let b = post_hash2(i + vec2<f32>(1.0, 0.0));
  let c = post_hash2(i + vec2<f32>(0.0, 1.0));
  let d = post_hash2(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}`,
  [postHash],
);

/** A pixel's part as a scope bit: 1 a character, 2 an object, 4 the environment. */
export const postPart = wgsl(`
fn post_part(w: f32) -> u32 {
  let a = abs(w);
  if (a > 1535.5) {
    return 1u;
  }
  if (a > 1023.5) {
    return 2u;
  }
  return 4u;
}`);

/** Whether a filter with scope mask `mask` applies to a pixel whose flags are `w`. */
export const postAimed = wgsl(
  `
fn post_aimed(mask: f32, w: f32) -> bool {
  return (u32(mask + 0.5) & post_part(w)) != 0u;
}`,
  [postPart],
);

/** The MRT's normal and flags at a pixel, clamped to the target. */
export const postFlags = wgsl(`
fn post_flags(normals: texture_2d<f32>, p: vec2<f32>, dims: vec2<i32>) -> vec4<f32> {
  return textureLoad(normals, clamp(vec2<i32>(p), vec2<i32>(0), dims - vec2<i32>(1)), 0);
}`);

/** The display colour at a pixel, clamped to the target (shardfall's \`base_color\`). */
export const postBase = wgsl(`
fn post_base(display: texture_2d<f32>, q: vec2<i32>, dims: vec2<i32>) -> vec3<f32> {
  return textureLoad(display, clamp(q, vec2<i32>(0), dims - vec2<i32>(1)), 0).rgb;
}`);

/** The distance in front of the camera at a pixel, from the depth target and the inverse projection. */
export const postViewDepth = wgsl(`
fn post_view_depth(depth: texture_depth_2d, q: vec2<i32>, dims: vec2<i32>, inv_proj: mat4x4<f32>) -> f32 {
  let d = textureLoad(depth, clamp(q, vec2<i32>(0), dims - vec2<i32>(1)), 0);
  let v = inv_proj * vec4<f32>(0.0, 0.0, d, 1.0);
  return -v.z / v.w;
}`);

/** The 4 × 4 Bayer threshold of a cell, 0 to 1. */
export const postBayer = wgsl(`
fn post_bayer4(p: vec2<f32>) -> f32 {
  var m = array<f32, 16>(0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  let x = u32(abs(p.x)) % 4u;
  let y = u32(abs(p.y)) % 4u;
  return (m[y * 4u + x] + 0.5) / 16.0;
}`);

/** A 0xRRGGBB colour as 0–1 channels. */
export const postHex = wgsl(`
fn post_hex3(v: u32) -> vec3<f32> {
  return vec3<f32>(f32((v >> 16u) & 255u), f32((v >> 8u) & 255u), f32(v & 255u)) / 255.0;
}`);

/**
 * The nearest colour of a fixed palette (1 Game Boy, 2 PICO-8, 3 CGA, 4 1-bit, 5 amber) at dither threshold `th`
 * (0.5 is none): the monochrome ones spread the brightness range over their shades, the others pick the nearest.
 */
export const postPalette = wgsl(
  `
fn post_palette(c0: vec3<f32>, pal: u32, th: f32) -> vec3<f32> {
  if (pal == 1u || pal == 4u || pal == 5u) {
    var gbm = array<u32, 4>(0x0f380fu, 0x306230u, 0x8bac0fu, 0x9bbc0fu);
    var ambm = array<u32, 4>(0x140800u, 0x5a2a00u, 0xb86400u, 0xffb000u);
    let n = select(4.0, 2.0, pal == 4u);
    let l = dot(c0, vec3<f32>(0.299, 0.587, 0.114));
    let i = u32(clamp(floor(l * (n - 1.0) + th), 0.0, n - 1.0));
    if (pal == 4u) {
      return vec3<f32>(f32(i));
    }
    if (pal == 1u) {
      return post_hex3(gbm[i]);
    }
    return post_hex3(ambm[i]);
  }
  let c = clamp(c0 + (th - 0.5) * 0.18, vec3<f32>(0.0), vec3<f32>(1.0));
  var p8 = array<u32, 16>(0x000000u, 0x1d2b53u, 0x7e2553u, 0x008751u, 0xab5236u, 0x5f574fu, 0xc2c3c7u, 0xfff1e8u,
                          0xff004du, 0xffa300u, 0xffec27u, 0x00e436u, 0x29adffu, 0x83769cu, 0xff77a8u, 0xffccaau);
  var cga = array<u32, 4>(0x000000u, 0x55ffffu, 0xff55ffu, 0xffffffu);
  var best = c;
  var bd = 1e9;
  let n = select(4u, 16u, pal == 2u);
  for (var i = 0u; i < n; i++) {
    var q = post_hex3(cga[i % 4u]);
    if (pal == 2u) {
      q = post_hex3(p8[i]);
    }
    let e = c - q;
    let d = dot(e, e * vec3<f32>(0.3, 0.59, 0.11));
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  return best;
}`,
  [postHex],
);
