/**
 * @file The composite's edge filters (PLAN.md WP 7.4), as WGSL through TSL's `wgslFn`:
 * - `post_edge`, the outline: a pixel is on an edge where, within the line's width, the depth jumps by more than a
 *   share of the distance (more at grazing angles), the surface creases (neighbouring normals part) or another
 *   outline group begins; only the nearer side is marked, so a line is one width thick, and the background is never
 *   outlined from inside (`shardfall:crates/pav_render/src/shaders/post.wgsl:72-101`, one sample, view-space normals);
 * - `post_cel`, the prototype's comic cel: brightness in flat bands keeping each colour's hue (the darkest band above
 *   black), colour pushed, and ink on the darker side of sharp brightness changes and round every character's and
 *   object's silhouette (`my-3d2dge:src/stress-world/45-filters.js:47-60`);
 * - `post_art_rim`, pixel art's one-block rim: a block whose neighbour block is another pixel-art object in front of
 *   it turns dark (`post.wgsl:761-804`).
 *
 * Invariants: pure functions of their arguments; a pixel with a zero normal (the cleared background) has no edge.
 *
 * @see engine/gfx/post/composite.ts
 * @see tests/e2e/post.spec.ts
 */
import { postAimed, postBase, postFlags, postLuma, postPart, postViewDepth, wgsl } from './common';

/** 1 where pixel `px` is on an outline `t` px wide (see the file comment), else 0. */
export const postEdge = wgsl(
  `
fn post_edge(normals: texture_2d<f32>, depth: texture_depth_2d, px: vec2<i32>, dims: vec2<i32>, t: i32, inv_proj: mat4x4<f32>, depth_th: f32, crease: f32) -> f32 {
  let n0 = textureLoad(normals, clamp(px, vec2<i32>(0), dims - vec2<i32>(1)), 0);
  if (dot(n0.xyz, n0.xyz) < 0.25) {
    return 0.0;
  }
  let d0 = post_view_depth(depth, px, dims, inv_proj);
  var offs = array<vec2<i32>, 4>(vec2<i32>(t, 0), vec2<i32>(-t, 0), vec2<i32>(0, t), vec2<i32>(0, -t));
  let ndv = abs(n0.z);
  let rel = depth_th * max(d0, 0.001) * (1.0 + 3.0 * (1.0 - ndv));
  for (var i = 0; i < 4; i++) {
    let q = clamp(px + offs[i], vec2<i32>(0), dims - vec2<i32>(1));
    let d = post_view_depth(depth, q, dims, inv_proj);
    let n = textureLoad(normals, q, 0);
    if (d0 > d + 1e-4) {
      continue;
    }
    if (d - d0 > rel) {
      return 1.0;
    }
    if (n.w != n0.w) {
      return 1.0;
    }
    if (dot(n.xyz, n0.xyz) < crease) {
      return 1.0;
    }
  }
  return 0.0;
}`,
  [postViewDepth],
);

/** Comic cel over the picture `s` at `p`: `bands`, colour `punch`, `ink` strength and `ink_w` (px); see above. */
export const postCel = wgsl(
  `
fn post_cel(display: texture_2d<f32>, normals: texture_2d<f32>, p: vec2<f32>, s: vec3<f32>, dims: vec2<i32>, bands: f32, punch: f32, ink: f32, ink_w: f32) -> vec3<f32> {
  let l = post_luma(s);
  let q = max(floor(l * bands + 0.5), 0.5) / bands;
  let banded = s * (q / max(l, 0.002));
  let punched = mix(vec3<f32>(post_luma(banded)), banded, punch);
  let m = select(0.0, 1.0, post_part(post_flags(normals, p, dims).w) != 4u);
  var offs = array<vec2<f32>, 4>(vec2<f32>(1.0, 0.0), vec2<f32>(-1.0, 0.0), vec2<f32>(0.0, 1.0), vec2<f32>(0.0, -1.0));
  var edge = 0.0;
  var rim = 0.0;
  for (var i = 0; i < 4; i++) {
    let o = p + offs[i] * ink_w;
    edge = max(edge, post_luma(post_base(display, vec2<i32>(o), dims)) - l);
    let mo = select(0.0, 1.0, post_part(post_flags(normals, o, dims).w) != 4u);
    rim = max(rim, m - mo);
  }
  let inked = mix(punched, vec3<f32>(0.047, 0.031, 0.094), max(smoothstep(0.16, 0.36, edge), rim) * ink);
  return clamp(inked, vec3<f32>(0.0), vec3<f32>(1.0));
}`,
  [postLuma, postBase, postFlags, postPart],
);

/** Whether the block centred on `c` (block size `art`) gets pixel art's dark rim; `mask` is the pixel filter's scope. */
export const postArtRim = wgsl(
  `
fn post_art_rim(normals: texture_2d<f32>, depth: texture_depth_2d, c: vec2<f32>, dims: vec2<i32>, art: f32, mask: f32, inv_proj: mat4x4<f32>) -> bool {
  let wc = post_flags(normals, c, dims).w;
  let dc = post_view_depth(depth, vec2<i32>(c), dims, inv_proj);
  var offs = array<vec2<f32>, 4>(vec2<f32>(1.0, 0.0), vec2<f32>(-1.0, 0.0), vec2<f32>(0.0, 1.0), vec2<f32>(0.0, -1.0));
  for (var i = 0; i < 4; i++) {
    let q = c + offs[i] * art;
    let nq = post_flags(normals, q, dims);
    let marked = nq.w < 0.0 || (dot(nq.xyz, nq.xyz) > 0.25 && post_aimed(mask, nq.w));
    if (marked && nq.w != wc && post_view_depth(depth, vec2<i32>(q), dims, inv_proj) < dc - 0.05) {
      return true;
    }
  }
  return false;
}`,
  [postFlags, postAimed, postViewDepth],
);
