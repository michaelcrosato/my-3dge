/**
 * @file The one composite pass (PLAN.md WP 7.4, I-46, WP 13.31): every filter over the finished picture in a single
 * full-screen pass, each gated by a uniform, in a fixed order, so switching any of them is a uniform write
 * (shardfall's design, `shardfall:crates/pav_render/src/shaders/post.wgsl:731-860`). It reads the picture after
 * bloom and edge smoothing (`display`, display colours) and the fixed MRT's normals with flags and depth
 * (engine/gfx/post/mrt.ts), and returns the display colour drawn to the screen.
 *
 * The order (engine/gfx/post/filters.ts names each filter): first where each pixel looks, the screen's shape (CRT
 * curvature, lens distortion, VHS's slipping rows, then low resolution), watercolour's wobble and pixel art's blocks
 * (the block's centre where it or this pixel is pixel art, plus the one-block rim); then the pixel's part, read after
 * the blocks so whole blocks agree, and its colour through the lens (depth of field or tilt-shift, misregistration,
 * colour fringes, VHS's bleed, sharpening, then lens flare and streaks added). Then, by scope, the media: `cel`;
 * `pixel` (the blocks' levels and rim) and `palette` (levels or a palette, Bayer dither stepping with the blocks, its
 * cells counted from where the chain snapped the camera, `frame.zw`, so the pattern stays on the world); watercolour;
 * `outline` (its lines wobbling, boiling and fading with distance as asked); `stylize`; paper. Then the tone: `grade`
 * with its further steps, split toning, selective colour, the gradient map. Last the display: `scanlines`, the CRT's
 * mask and glow, speed lines, the vignettes (whole screen), `grain`, VHS's snow and the letterbox bars. Each filter's
 * result is mixed with what came in by its amount (engine/gfx/post/filterUniforms.ts `AMOUNT_SLOTS`). Sizes the new
 * filters give "at 1080 lines" are scaled by `unit`, the picture's lines over 1080. The filters' WGSL is under
 * engine/gfx/post/shaders/.
 *
 * `show` (the setting `post.show`) draws what the MRT holds instead of the picture: `parts` (characters red,
 * objects green, the environment blue, the background black), `normals`, or `groups` (a colour per outline group):
 * the parts as numbers for tests and agents (a shot reads them back), with no pipeline built, since it is a
 * uniform too.
 *
 * Invariants: one pass, one pipeline per target format, built once; a filter whose mask is 0 costs one comparison;
 * an amount of 1 changes nothing; the output is clamped to 0–1.
 *
 * @example
 * // post.outputNode = createComposite({ display, normals, depth, invProj, uniforms: createFilterUniforms() });
 * @see engine/gfx/post/chain.ts
 * @see tests/e2e/post.spec.ts
 * @see tests/e2e/filters.spec.ts
 */
import { screenUV } from 'three/tsl';
import type { Node, TextureNode, UniformNode, Matrix4 } from 'three/webgpu';
import { FILTER_UNIFORMS, type FilterUniforms } from './filterUniforms';
import { postAimed, postBayer, postFlags, postLuma, postNoise, postPalette, postPart, postViewDepth, wgsl } from './shaders/common'; // prettier-ignore
import { postCrt, postLetterbox, postSpeedlines, postVhsBleed, postVhsSlip, postVhsSnow, postVignette } from './shaders/display'; // prettier-ignore
import { postArtRim, postCel, postEdge } from './shaders/edges';
import { postDistort, postDof, postFlare, postStreaks, postTilt } from './shaders/lens';
import { postMisregister, postPaper, postSharpen, postWatercolor, postWobble } from './shaders/media';
import { postStylize } from './shaders/stylize';
import { postDuotone, postGradeMore, postSelective, postSplit } from './shaders/tone';

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

/** The WGSL parameters of the uniforms, in `FILTER_UNIFORMS`' order. */
const UNIFORM_PARAMS = FILTER_UNIFORMS.map((name) => `${name}: vec4<f32>`).join(', ');

/** The composite itself (see the file comment). */
const postComposite = wgsl(
  `
fn post_composite(uv_in: vec2<f32>, display: texture_2d<f32>, display_s: sampler, normals: texture_2d<f32>, depth: texture_depth_2d, inv_proj: mat4x4<f32>, ${UNIFORM_PARAMS}) -> vec4<f32> {
  let dims = vec2<i32>(textureDimensions(display));
  let fd = vec2<f32>(dims);
  let frag = uv_in * fd;
  let unit = fd.y / 1080.0;
  let aspect = fd.x / fd.y;
  let t = frame.y;
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
  if (lens.x > 0.5 && lens.y != 0.0) {
    uvn = post_distort(uvn, aspect, lens.y);
  }
  if (vhs.x > 0.5 && vhs.y > 0.0) {
    uvn = post_vhs_slip(uvn, vhs.y, t);
  }
  var p = uvn * fd;
  var block = 1.0;
  if (screen.x > 0.5 && screen.w > 1.0) {
    block = screen.w;
    p = (floor(p / block) + 0.5) * block;
  }
  if (water.x > 0.5 && water.y > 0.0 && post_aimed(water.x, post_flags(normals, p, dims).w)) {
    p = post_wobble(p, frag / unit, water.y, unit);
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
  if (dof.x > 0.5) {
    s = mix(s, post_dof(display, display_s, depth, p, fd, dims, inv_proj, dof.y, dof.z, dof.w * unit), am2.z);
  }
  if (tilt.x > 0.5) {
    s = mix(s, post_tilt(display, display_s, p, fd, tilt.y, tilt.z, tilt.w * unit), am2.w);
  }
  if (misregister.x > 0.5 && post_aimed(misregister.x, w)) {
    s = mix(s, post_misregister(display, display_s, s, p, fd, misregister.y * unit, misregister.z), am3.w);
  }
  if (grain.z > 0.5 && post_aimed(grain.z, w)) {
    let off = (p / fd - 0.5) * grain.w * 0.012;
    s.r = textureSampleLevel(display, display_s, p / fd + off, 0.0).r;
    s.b = textureSampleLevel(display, display_s, p / fd - off, 0.0).b;
  }
  if (vhs.x > 0.5 && vhs.z > 0.0) {
    s = mix(s, post_vhs_bleed(display, display_s, s, p, fd, unit, vhs.z), am5.z);
  }
  if (sharpen.x > 0.5 && post_aimed(sharpen.x, w)) {
    s = mix(s, post_sharpen(display, display_s, s, p, fd, sharpen.y, sharpen.z * unit), am3.z);
  }
  if (flare.x > 0.5) {
    s = s + post_flare(display, display_s, p / fd, fd, flare.z, flare.w, unit) * flare.y * am3.x;
  }
  if (streaks.x > 0.5) {
    s = s + post_streaks(display, display_s, p, fd, streaks.z, streaks.w * unit, streaks2.rgb) * streaks.y * am3.y;
  }
  if (cel.x > 0.5 && post_aimed(cel.x, w)) {
    s = mix(s, post_cel(display, normals, p, s, dims, cel.y, cel.z, cel.w, cel2.x), am0.x);
  }
  if (art) {
    let a0 = s;
    if (pixel.z >= 2.0) {
      s = floor(clamp(s, vec3<f32>(0.0), vec3<f32>(1.0)) * (pixel.z - 1.0) + 0.5) / (pixel.z - 1.0);
    }
    if (art_edge) {
      s = s * 0.18;
    }
    s = mix(a0, s, am0.y);
  }
  if (palette.x > 0.5 && post_aimed(palette.x, w)) {
    let th = mix(0.5, post_bayer4(floor(frag / select(block, art_px, art)) + frame.zw), clamp(palette.w, 0.0, 1.0));
    let pal = u32(palette.y + 0.5);
    let c = clamp(s, vec3<f32>(0.0), vec3<f32>(1.0));
    var q = s;
    if (pal > 0u) {
      q = post_palette(c, pal, th);
    } else if (palette.z >= 2.0) {
      let l = palette.z - 1.0;
      q = floor(c * l + th) / l;
    }
    s = mix(s, q, am0.z);
  }
  if (water.x > 0.5 && post_aimed(water.x, w)) {
    s = mix(s, post_watercolor(display, display_s, s, p, frag / unit, fd, unit, water.z, water.w, water2.x), am4.x);
  }
  if (outline.x > 0.5 && post_aimed(outline.x, w)) {
    var pe = p;
    if (outline4.x > 0.0) {
      let boil = select(0.0, floor(t * outline4.y), outline4.y > 0.0);
      let q = frag / unit * 0.05 + vec2<f32>(boil * 1.7, boil * 3.1);
      pe = p + (vec2<f32>(post_vnoise(q), post_vnoise(q + vec2<f32>(5.2, 1.3))) - 0.5) * 2.0 * outline4.x * unit;
    }
    var e = post_edge(normals, depth, vec2<i32>(pe), dims, max(i32(outline.y + 0.5), 1), inv_proj, outline.w, outline3.x);
    if (outline3.y > 0.0) {
      e = e * (1.0 - outline3.y * smoothstep(outline3.z, outline3.w, post_view_depth(depth, vec2<i32>(p), dims, inv_proj)));
    }
    s = mix(s, select(s * outline.z, outline2.rgb, outline2.w > 0.5), e * am0.w);
  }
  if (stylize.x > 0.5 && post_aimed(stylize.x, w)) {
    let styled = post_stylize(display, normals, u32(stylize.y + 0.5), p, s, dims, stylize.z, stylize2.x, stylize.x, t);
    s = mix(s, clamp(styled, vec3<f32>(0.0), vec3<f32>(1.0)), clamp(stylize.w, 0.0, 1.0) * am1.x);
  }
  if (paper.x > 0.5 && post_aimed(paper.x, w)) {
    s = mix(s, post_paper(s, frag / unit, paper.y, paper.z, paper2.rgb), paper.w * am4.y);
  }
  if (grade.x > 0.5 && post_aimed(grade.x, w)) {
    let g0 = s;
    s = s * vec3<f32>(1.0 + 0.12 * grade.y, 1.0 + 0.08 * grade.z, 1.0 - 0.12 * grade.y);
    s = (s - 0.5) * grade.w + 0.5;
    s = s * grade2.x;
    s = mix(vec3<f32>(post_luma(s)), s, grade2.y);
    s = post_grade_more(s, grade3, grade4);
    s = mix(g0, s, am1.y);
  }
  if (split.x > 0.5 && post_aimed(split.x, w)) {
    s = mix(s, post_split(clamp(s, vec3<f32>(0.0), vec3<f32>(1.0)), split.y, split2.rgb, split3.rgb), am4.z);
  }
  if (selective.x > 0.5 && post_aimed(selective.x, w)) {
    s = mix(s, post_selective(clamp(s, vec3<f32>(0.0), vec3<f32>(1.0)), selective.y, selective.z), am4.w);
  }
  if (duo1.w > 0.5 && post_aimed(duo1.w, w)) {
    s = mix(s, post_duotone(s, duo1.rgb, duo2.rgb, duo3.rgb), am5.x);
  }
  if (scanlines.x > 0.5 && post_aimed(scanlines.x, w)) {
    let k = 0.5 - 0.5 * cos(uvn.y * fd.y / max(scanlines.z, 1.0) * 6.2831853);
    s = s * (1.0 - scanlines.y * 0.6 * k * am1.z);
  }
  if (crt.x > 0.5) {
    s = mix(s, post_crt(display, display_s, s, p, fd, unit, crt.y, crt.z, crt.w, t), am5.y);
  }
  if (speed.x > 0.5) {
    let line = post_speedlines(uv_in, aspect, speed.y, speed.z, vec2<f32>(speed.w, speed2.x), t);
    s = mix(s, speed2.yzw, line * am5.w);
  }
  if (screen.x > 0.5 && screen.z > 0.0) {
    s = s * (1.0 - screen.z * am2.y * smoothstep(0.35, 1.05, length(uv_in - 0.5) * 1.414));
  }
  if (vig.x > 0.5) {
    s = mix(s, post_vignette(s, uv_in, aspect, vig.y, vig.z, vig.w, vig2.rgb), am6.x);
  }
  if (grain.x > 0.5 && post_aimed(grain.x, w)) {
    let h = fract(sin(dot(frag + vec2<f32>(t * 61.0, t * 17.0), vec2<f32>(12.9898, 78.233))) * 43758.5453);
    s = s + (h - 0.5) * grain.y * 0.16;
  }
  if (vhs.x > 0.5 && vhs.w > 0.0) {
    s = s + vec3<f32>(post_vhs_snow(frag, uv_in.y, vhs.w, t)) * am5.z;
  }
  if (letterbox.x > 0.0) {
    s = mix(s, letterbox.yzw, post_letterbox(uv_in, aspect, letterbox.x) * am6.y);
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
    postNoise,
    postViewDepth,
    postBayer,
    postPalette,
    postCel,
    postEdge,
    postStylize,
    postDistort,
    postVhsSlip,
    postWobble,
    postDof,
    postTilt,
    postMisregister,
    postVhsBleed,
    postSharpen,
    postFlare,
    postStreaks,
    postWatercolor,
    postPaper,
    postGradeMore,
    postSplit,
    postSelective,
    postDuotone,
    postCrt,
    postSpeedlines,
    postVignette,
    postVhsSnow,
    postLetterbox,
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
  const { display, normals, depth, invProj, uniforms } = inputs;
  return postComposite({
    uv_in: screenUV,
    display,
    display_s: display,
    normals,
    depth,
    inv_proj: invProj,
    ...Object.fromEntries(FILTER_UNIFORMS.map((name) => [name, uniforms[name]])),
  });
}
