/**
 * @file The one composite pass (PLAN.md WP 7.4, I-46): every filter over the finished picture in a single
 * full-screen pass, each gated by a uniform, in a fixed order, so switching any of them is a uniform write
 * (shardfall's design, `shardfall:crates/pav_render/src/shaders/post.wgsl:731-860`). It reads the picture after
 * bloom and edge smoothing (`display`, display colours) and the fixed MRT's normals with flags and depth
 * (engine/gfx/post/mrt.ts), and returns the display colour drawn to the screen.
 *
 * The order: the screen's shape first (CRT curvature, then low resolution: where each pixel looks up), pixel art's
 * blocks (the block's centre where it or this pixel is pixel art, plus the one-block rim), then the pixel's part,
 * read after the blocks so whole blocks agree, and its colour (with colour fringes where `chroma` applies). Then, by
 * scope: `cel`; `pixel` (the blocks' levels and rim) and `palette` (levels or a palette, Bayer dither stepping with
 * the blocks); `outline`; `stylize`; `grade`; and the screen effects: `scanlines`, the vignette (whole screen) and
 * `grain`. Engine/gfx/post/filters.ts says what each takes and how the uniforms pack it.
 *
 * `show` (the setting `post.show`) draws what the MRT holds instead of the picture: `parts` (characters red,
 * objects green, the environment blue, the background black), `normals`, or `groups` (a colour per outline group):
 * the parts as numbers for tests and agents (`x shot` reads them back), with no pipeline built, since it is a
 * uniform too.
 *
 * Invariants: one pass, one pipeline per target format, built once; a filter whose mask is 0 costs one comparison;
 * the output is clamped to 0–1.
 *
 * @example
 * // post.outputNode = createComposite({ display, normals, depth, invProj, uniforms: createFilterUniforms() });
 * @see engine/gfx/post/chain.ts
 * @see tests/e2e/post.spec.ts
 */
import { screenUV } from 'three/tsl';
import type { Node, TextureNode, UniformNode, Matrix4 } from 'three/webgpu';
import type { FilterUniforms } from './filters';
import { postAimed, postBayer, postFlags, postLuma, postPalette, postPart, wgsl } from './shaders/common';
import { postArtRim, postCel, postEdge } from './shaders/edges';
import { postStylize } from './shaders/stylize';

/** The views `show` picks, in the uniform's order. */
export const POST_SHOW = ['picture', 'parts', 'normals', 'groups'] as const;

/** What the composite draws. */
export type PostShow = (typeof POST_SHOW)[number];

/** Whether the pixel at `q` is drawn as pixel art: tagged so, or of a part the pixel filter's scope covers. */
const postIsArt = wgsl(
  `
fn post_is_art(normals: texture_2d<f32>, q: vec2<f32>, dims: vec2<i32>, mask: f32) -> bool {
  let n = post_flags(normals, q, dims);
  return n.w < 0.0 || post_aimed(mask, n.w);
}`,
  [postFlags, postAimed],
);

/** What the MRT holds at a pixel, as a colour: the parts, the normals or the groups (see the file comment). */
const postShow = wgsl(
  `
fn post_show(normals: texture_2d<f32>, p: vec2<f32>, dims: vec2<i32>, show: u32) -> vec4<f32> {
  let n = post_flags(normals, p, dims);
  if (dot(n.xyz, n.xyz) < 0.25) {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }
  if (show == 1u) {
    let part = post_part(n.w);
    return vec4<f32>(select(0.0, 1.0, part == 1u), select(0.0, 1.0, part == 2u), select(0.0, 1.0, part == 4u), 1.0);
  }
  if (show == 2u) {
    return vec4<f32>(n.xyz * 0.5 + 0.5, 1.0);
  }
  let g = abs(n.w);
  return vec4<f32>(fract(g * 0.618034), fract(g * 0.371), fract(g * 0.1373), 1.0);
}`,
  [postFlags, postPart],
);

/** The composite itself (see the file comment). */
const postComposite = wgsl(
  `
fn post_composite(uv_in: vec2<f32>, display: texture_2d<f32>, display_s: sampler, normals: texture_2d<f32>, depth: texture_depth_2d, inv_proj: mat4x4<f32>, frame: vec4<f32>, cel: vec4<f32>, cel2: vec4<f32>, pixel: vec4<f32>, palette: vec4<f32>, outline: vec4<f32>, outline2: vec4<f32>, outline3: vec4<f32>, stylize: vec4<f32>, stylize2: vec4<f32>, grade: vec4<f32>, grade2: vec4<f32>, scan: vec4<f32>, grain: vec4<f32>, screen: vec4<f32>) -> vec4<f32> {
  let dims = vec2<i32>(textureDimensions(display));
  let fd = vec2<f32>(dims);
  let frag = uv_in * fd;
  let show = u32(frame.x + 0.5);
  if (show > 0u) {
    return post_show(normals, frag, dims, show);
  }
  var uvn = uv_in;
  if (screen.x > 0.5 && screen.y > 0.0) {
    var c = uvn * 2.0 - 1.0;
    c = c * (1.0 + screen.y * c.yx * c.yx);
    uvn = c * 0.5 + 0.5;
    if (uvn.x < 0.0 || uvn.y < 0.0 || uvn.x > 1.0 || uvn.y > 1.0) {
      return vec4<f32>(0.0, 0.0, 0.0, 1.0);
    }
  }
  var p = uvn * fd;
  var block = 1.0;
  if (screen.x > 0.5 && screen.w > 1.0) {
    block = screen.w;
    p = (floor(p / block) + 0.5) * block;
  }
  var art = false;
  var art_edge = false;
  let art_px = max(pixel.y, 1.0);
  if (pixel.x > 0.5) {
    let c = (floor(p / art_px) + 0.5) * art_px;
    if (post_is_art(normals, c, dims, pixel.x) || post_is_art(normals, p, dims, pixel.x)) {
      p = c;
      art = true;
    }
    if (pixel.w > 0.5 && post_art_rim(normals, depth, c, dims, art_px, pixel.x, inv_proj)) {
      p = c;
      art = true;
      art_edge = true;
    }
  }
  let w = post_flags(normals, p, dims).w;
  var s = textureSampleLevel(display, display_s, p / fd, 0.0).rgb;
  if (grain.z > 0.5 && post_aimed(grain.z, w)) {
    let off = (p / fd - 0.5) * grain.w * 0.012;
    s.r = textureSampleLevel(display, display_s, p / fd + off, 0.0).r;
    s.b = textureSampleLevel(display, display_s, p / fd - off, 0.0).b;
  }
  if (cel.x > 0.5 && post_aimed(cel.x, w)) {
    s = post_cel(display, normals, p, s, dims, cel.y, cel.z, cel.w, cel2.x);
  }
  if (art) {
    if (pixel.z >= 2.0) {
      s = floor(clamp(s, vec3<f32>(0.0), vec3<f32>(1.0)) * (pixel.z - 1.0) + 0.5) / (pixel.z - 1.0);
    }
    if (art_edge) {
      s = s * 0.18;
    }
  }
  if (palette.x > 0.5 && post_aimed(palette.x, w)) {
    let th = mix(0.5, post_bayer4(floor(frag / select(block, art_px, art))), clamp(palette.w, 0.0, 1.0));
    let pal = u32(palette.y + 0.5);
    let c = clamp(s, vec3<f32>(0.0), vec3<f32>(1.0));
    if (pal > 0u) {
      s = post_palette(c, pal, th);
    } else if (palette.z >= 2.0) {
      let l = palette.z - 1.0;
      s = floor(c * l + th) / l;
    }
  }
  if (outline.x > 0.5 && post_aimed(outline.x, w)) {
    let e = post_edge(normals, depth, vec2<i32>(p), dims, max(i32(outline.y + 0.5), 1), inv_proj, outline.w, outline3.x);
    s = mix(s, select(s * outline.z, outline2.rgb, outline2.w > 0.5), e);
  }
  if (stylize.x > 0.5 && post_aimed(stylize.x, w)) {
    let styled = post_stylize(display, normals, u32(stylize.y + 0.5), p, s, dims, stylize.z, stylize2.x, stylize.x, frame.y);
    s = mix(s, clamp(styled, vec3<f32>(0.0), vec3<f32>(1.0)), clamp(stylize.w, 0.0, 1.0));
  }
  if (grade.x > 0.5 && post_aimed(grade.x, w)) {
    s = s * vec3<f32>(1.0 + 0.12 * grade.y, 1.0 + 0.08 * grade.z, 1.0 - 0.12 * grade.y);
    s = (s - 0.5) * grade.w + 0.5;
    s = s * grade2.x;
    s = mix(vec3<f32>(post_luma(s)), s, grade2.y);
  }
  if (scan.x > 0.5 && post_aimed(scan.x, w)) {
    let k = 0.5 - 0.5 * cos(uvn.y * fd.y / max(scan.z, 1.0) * 6.2831853);
    s = s * (1.0 - scan.y * 0.6 * k);
  }
  if (screen.x > 0.5 && screen.z > 0.0) {
    s = s * (1.0 - screen.z * smoothstep(0.35, 1.05, length(uv_in - 0.5) * 1.414));
  }
  if (grain.x > 0.5 && post_aimed(grain.x, w)) {
    let h = fract(sin(dot(frag + vec2<f32>(frame.y * 61.0, frame.y * 17.0), vec2<f32>(12.9898, 78.233))) * 43758.5453);
    s = s + (h - 0.5) * grain.y * 0.16;
  }
  return vec4<f32>(clamp(s, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}`,
  [
    postShow,
    postIsArt,
    postArtRim,
    postFlags,
    postAimed,
    postLuma,
    postBayer,
    postPalette,
    postCel,
    postEdge,
    postStylize,
  ],
);

/** What the composite reads. */
export interface CompositeInputs {
  /** The picture after bloom and edge smoothing, in display colours. */
  display: TextureNode;
  /** The MRT's normals with flags (engine/gfx/post/mrt.ts). */
  normals: TextureNode;
  /** The scene pass's depth. */
  depth: TextureNode;
  /** The scene camera's inverse projection, set each frame. */
  invProj: UniformNode<Matrix4>;
  uniforms: FilterUniforms;
}

/** The composite's output node: every filter over `display`, gated by `uniforms` (see the file comment). */
export function createComposite(inputs: CompositeInputs): Node {
  const { display, normals, depth, invProj, uniforms: u } = inputs;
  return postComposite({
    uv_in: screenUV,
    display,
    display_s: display,
    normals,
    depth,
    inv_proj: invProj,
    frame: u.frame,
    cel: u.cel,
    cel2: u.cel2,
    pixel: u.pixel,
    palette: u.palette,
    outline: u.outline,
    outline2: u.outline2,
    outline3: u.outline3,
    stylize: u.stylize,
    stylize2: u.stylize2,
    grade: u.grade,
    grade2: u.grade2,
    scan: u.scanlines,
    grain: u.grain,
    screen: u.screen,
  });
}
