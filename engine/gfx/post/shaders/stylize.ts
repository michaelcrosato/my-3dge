/**
 * @file The painterly and print styles of the composite (PLAN.md WP 7.4), as WGSL through TSL's `wgslFn`, carried
 * from shardfall (`shardfall:crates/pav_render/src/shaders/post.wgsl:431-697`), which 12 of its 73 presets and 7 of
 * its 21 looks use:
 * - **oil paint**: a generalized Kuwahara filter (Papari et al., with Kyprianidis et al.'s polynomial sector
 *   weights): eight overlapping sectors round the pixel each average their colours, and the calmest gets the weight,
 *   so areas turn into flat strokes while edges stay sharp; with a scope, samples from other parts are skipped, so no
 *   paint bleeds across; then brush strokes (noise drawn out along the picture's edges, lit from the top left) and
 *   canvas;
 * - **halftone**: cyan, magenta, yellow and black dot screens at their classic angles on cream paper, each dot
 *   growing with the ink at its centre; with no colour kept, black dots only (newsprint);
 * - **ASCII**: character cells whose brightness picks one of 12 glyphs (5 × 7 bitmaps packed into integers);
 * - **pencil**: hatching families that appear as the picture darkens, contours where brightness changes fast, lines
 *   that wobble and redraw six times a second, and paper tinted by the colour kept.
 *
 * `display` is the picture before the composite (display colours, after bloom and edge smoothing): shardfall's
 * `base_color`. Sizes are in the picture's pixels.
 *
 * Invariants: every style returns a display colour in 0–1 for any input; the paint's radius is clamped to 2–8 px,
 * so its cost is bounded.
 *
 * @see engine/gfx/post/composite.ts
 * @see tests/e2e/post.spec.ts
 */
import { postAimed, postBase, postFlags, postLuma, postNoise, wgsl } from './common';

/** Oil paint at pixel `c` (see the file comment); `mask` is the filter's scope mask (7 lets every sample in). */
export const postPaint = wgsl(
  `
fn post_paint(display: texture_2d<f32>, normals: texture_2d<f32>, c: vec2<f32>, dims: vec2<i32>, radius: f32, mask: f32) -> vec3<f32> {
  let r = i32(clamp(radius, 2.0, 8.0));
  let rf = f32(r);
  let zeta = 2.0 / rf;
  let zc = 0.58;
  let eta = (zeta + cos(zc)) / (sin(zc) * sin(zc));
  var m: array<vec4<f32>, 8>;
  var s: array<vec3<f32>, 8>;
  var w: array<f32, 8>;
  let ci = vec2<i32>(c);
  let scoped = u32(mask + 0.5) != 7u;
  for (var j = -r; j <= r; j++) {
    for (var i = -r; i <= r; i++) {
      var v = vec2<f32>(f32(i), f32(j)) * 0.5 / rf;
      if (dot(v, v) > 0.25) {
        continue;
      }
      let q = clamp(ci + vec2<i32>(i, j), vec2<i32>(0), dims - vec2<i32>(1));
      if (scoped && !post_aimed(mask, post_flags(normals, vec2<f32>(q), dims).w)) {
        continue;
      }
      let col = post_base(display, q, dims);
      var sum = 0.0;
      var vxx = zeta - eta * v.x * v.x;
      var vyy = zeta - eta * v.y * v.y;
      var z = max(0.0, v.y + vxx);
      w[0] = z * z;
      z = max(0.0, -v.x + vyy);
      w[2] = z * z;
      z = max(0.0, -v.y + vxx);
      w[4] = z * z;
      z = max(0.0, v.x + vyy);
      w[6] = z * z;
      v = 0.70710678 * vec2<f32>(v.x - v.y, v.x + v.y);
      vxx = zeta - eta * v.x * v.x;
      vyy = zeta - eta * v.y * v.y;
      z = max(0.0, v.y + vxx);
      w[1] = z * z;
      z = max(0.0, -v.x + vyy);
      w[3] = z * z;
      z = max(0.0, -v.y + vxx);
      w[5] = z * z;
      z = max(0.0, v.x + vyy);
      w[7] = z * z;
      for (var k = 0; k < 8; k++) {
        sum += w[k];
      }
      let gw = exp(-3.125 * dot(v, v)) / max(sum, 1e-6);
      for (var k = 0; k < 8; k++) {
        let wk = w[k] * gw;
        m[k] += vec4<f32>(col * wk, wk);
        s[k] += col * col * wk;
      }
    }
  }
  var acc = vec4<f32>(0.0);
  for (var k = 0; k < 8; k++) {
    if (m[k].w <= 0.0) {
      continue;
    }
    let mean = m[k].rgb / m[k].w;
    let v3 = abs(s[k] / m[k].w - mean * mean);
    let wk = 1.0 / (1.0 + pow(8000.0 * (v3.r + v3.g + v3.b), 4.0));
    acc += vec4<f32>(mean * wk, wk);
  }
  if (acc.w <= 0.0) {
    return post_base(display, ci, dims);
  }
  return acc.rgb / acc.w;
}`,
  [postAimed, postFlags, postBase],
);

/** Brush strokes: a brightness factor round 1 (see the file comment). */
export const postBrush = wgsl(
  `
fn post_brush(display: texture_2d<f32>, p: vec2<f32>, dims: vec2<i32>, size: f32) -> f32 {
  let o = i32(max(size, 2.0));
  let q = vec2<i32>(p);
  let gx = post_luma(post_base(display, q + vec2<i32>(o, 0), dims)) - post_luma(post_base(display, q - vec2<i32>(o, 0), dims));
  let gy = post_luma(post_base(display, q + vec2<i32>(0, o), dims)) - post_luma(post_base(display, q - vec2<i32>(0, o), dims));
  let swirl = post_vnoise(p / 160.0) * 3.1415927 + 0.6;
  var dir = vec2<f32>(cos(swirl), sin(swirl));
  let g = length(vec2<f32>(gx, gy));
  if (g > 0.02) {
    dir = normalize(mix(dir, vec2<f32>(-gy, gx) / g, smoothstep(0.02, 0.08, g)));
  }
  let across = vec2<f32>(-dir.y, dir.x);
  let len = max(size, 2.0) * 3.5;
  let wid = max(size, 2.0) * 0.6;
  let uv = vec2<f32>(dot(p, dir) / len, dot(p, across) / wid);
  let h = post_vnoise(uv) * 0.6 + post_vnoise(uv * 2.3 + 17.0) * 0.4;
  let h2 = post_vnoise(uv + vec2<f32>(0.0, 0.35)) * 0.6 + post_vnoise((uv + vec2<f32>(0.0, 0.35)) * 2.3 + 17.0) * 0.4;
  let bristle = post_vnoise(vec2<f32>(uv.x * 0.8, uv.y * 7.0) + 31.0) - 0.5;
  let ridge = (h - h2) * dot(across, normalize(vec2<f32>(-1.0, -1.0)));
  return 0.88 + 0.22 * h + 0.12 * bristle + ridge * 0.45;
}`,
  [postLuma, postBase, postNoise],
);

/** Coverage of one dot screen turned by `angle`, `cell` px apart; ink 0–3 is C, M, Y, K, below 0 brightness alone. */
export const postDots = wgsl(
  `
fn post_dots(display: texture_2d<f32>, p: vec2<f32>, dims: vec2<i32>, angle: f32, cell: f32, ink: i32) -> f32 {
  let cs = cos(angle);
  let sn = sin(angle);
  let q = vec2<f32>(cs * p.x + sn * p.y, -sn * p.x + cs * p.y) / cell;
  let cq = floor(q) + 0.5;
  let centre = vec2<f32>(cs * cq.x - sn * cq.y, sn * cq.x + cs * cq.y) * cell;
  let col = pow(post_base(display, vec2<i32>(centre), dims), vec3<f32>(0.75));
  var amount = 1.0 - post_luma(col);
  if (ink >= 0) {
    let k = 1.0 - max(col.r, max(col.g, col.b));
    if (ink == 3) {
      amount = smoothstep(0.25, 1.0, k);
    } else {
      amount = clamp((1.0 - col[ink] - k) / max(1.0 - k, 1e-3), 0.0, 1.0);
    }
  }
  let radius = sqrt(amount) * 0.66;
  let aa = 0.8 / cell;
  return clamp((radius - length(q - cq)) / (2.0 * aa) + 0.5, 0.0, 1.0) * clamp(radius / aa, 0.0, 1.0);
}`,
  [postLuma, postBase],
);

/** Print: process-colour dot screens on cream paper, or black dots alone as `keep` falls to 0. */
export const postHalftone = wgsl(
  `
fn post_halftone(display: texture_2d<f32>, p: vec2<f32>, dims: vec2<i32>, size: f32, keep: f32) -> vec3<f32> {
  let cell = clamp(size, 3.0, 24.0);
  let paper = vec3<f32>(0.96, 0.93, 0.85);
  var color = paper;
  if (keep > 0.0) {
    color *= mix(vec3<f32>(1.0), vec3<f32>(0.12, 0.72, 0.94), post_dots(display, p, dims, 0.2618, cell, 0));
    color *= mix(vec3<f32>(1.0), vec3<f32>(0.94, 0.2, 0.58), post_dots(display, p, dims, 1.309, cell, 1));
    color *= mix(vec3<f32>(1.0), vec3<f32>(1.0, 0.93, 0.12), post_dots(display, p, dims, 0.0, cell, 2));
    color *= mix(vec3<f32>(1.0), vec3<f32>(0.12, 0.11, 0.13), post_dots(display, p, dims, 0.7854, cell, 3));
  }
  var mono = paper;
  if (keep < 1.0) {
    mono *= mix(vec3<f32>(1.0), vec3<f32>(0.1, 0.1, 0.12), post_dots(display, p, dims, 0.7854, cell, -1));
  }
  return mix(mono, color, keep);
}`,
  [postDots],
);

/** Text mode: a grid of character cells, each cell's brightness picking a glyph of " .-:+=o&*8#@". */
export const postAscii = wgsl(
  `
fn post_ascii(display: texture_2d<f32>, p: vec2<f32>, dims: vec2<i32>, size: f32, keep: f32) -> vec3<f32> {
  let cw = clamp(size, 4.0, 24.0);
  let csz = vec2<f32>(cw, round(cw * 1.4));
  let cell = floor(p / csz);
  let centre = (cell + 0.5) * csz;
  var col = vec3<f32>(0.0);
  col += post_base(display, vec2<i32>(centre + csz * vec2<f32>(-0.25, -0.25)), dims);
  col += post_base(display, vec2<i32>(centre + csz * vec2<f32>(0.25, -0.25)), dims);
  col += post_base(display, vec2<i32>(centre + csz * vec2<f32>(-0.25, 0.25)), dims);
  col += post_base(display, vec2<i32>(centre + csz * vec2<f32>(0.25, 0.25)), dims);
  col *= 0.25;
  let l = post_luma(col);
  let idx = u32(clamp(floor(pow(l, 0.8) * 12.0), 0.0, 11.0));
  let f = (p - cell * csz) / csz;
  let gx = i32(floor(f.x * 7.0)) - 1;
  let gy = i32(floor(f.y * 9.0)) - 1;
  var on = false;
  if (gx >= 0 && gx < 5 && gy >= 0 && gy < 7) {
    var top = array<u32, 12>(0u, 0u, 491520u, 6336u, 1020032u, 31744u, 571392u, 206118u, 1030816u, 476718u, 359754u, 718382u);
    var bottom = array<u32, 12>(0u, 6336u, 0u, 198u, 132u, 31u, 14897u, 22837u, 686u, 14897u, 10591u, 30781u);
    var bits = 0u;
    if (gy < 4) {
      bits = top[idx] >> u32(gx + 5 * gy);
    } else {
      bits = bottom[idx] >> u32(gx + 5 * (gy - 4));
    }
    on = (bits & 1u) == 1u;
  }
  let phosphor = vec3<f32>(0.3, 1.0, 0.45) * (0.45 + 0.75 * l);
  let vivid = col / max(max(col.r, max(col.g, col.b)), 0.2) * (0.55 + 0.45 * l);
  let ink = mix(phosphor, vivid, keep);
  let ground = mix(vec3<f32>(0.01, 0.035, 0.018), col * 0.14, keep);
  return select(ground, ink, on);
}`,
  [postLuma, postBase],
);

/** One family of parallel pencil lines across `dir`, `spacing` px apart: 1 on a line, 0 between. */
export const postHatch = wgsl(`
fn post_hatch(p: vec2<f32>, dir: vec2<f32>, spacing: f32, wob: f32) -> f32 {
  let d = abs(fract(dot(p, dir) / spacing + wob) - 0.5) * spacing;
  return 1.0 - smoothstep(0.3, 1.1, d);
}`);

/** Pencil on paper over the picture `s` at `p`; `bp` is the picture there before the outline; `time` in seconds. */
export const postSketch = wgsl(
  `
fn post_sketch(display: texture_2d<f32>, p: vec2<f32>, s: vec3<f32>, bp: vec3<f32>, dims: vec2<i32>, size: f32, keep: f32, time: f32) -> vec3<f32> {
  let sp = clamp(size, 2.0, 16.0);
  let boil = floor(time * 6.0);
  let wob = (post_vnoise(p * 0.03 + vec2<f32>(boil * 7.31, boil * 3.17)) - 0.5) * 0.9;
  let dark = 1.0 - pow(post_luma(s), 0.6);
  var ink = post_hatch(p, vec2<f32>(0.70710678, 0.70710678), sp, wob) * smoothstep(0.30, 0.42, dark);
  ink = max(ink, post_hatch(p, vec2<f32>(0.70710678, -0.70710678), sp, wob) * smoothstep(0.50, 0.62, dark));
  ink = max(ink, post_hatch(p, vec2<f32>(0.0, 1.0), sp * 0.75, wob) * smoothstep(0.68, 0.8, dark));
  let o = max(i32(sp * 0.3), 1);
  let q = vec2<i32>(p);
  let tl = post_luma(post_base(display, q + vec2<i32>(-o, -o), dims));
  let tt = post_luma(post_base(display, q + vec2<i32>(0, -o), dims));
  let tr = post_luma(post_base(display, q + vec2<i32>(o, -o), dims));
  let ml = post_luma(post_base(display, q + vec2<i32>(-o, 0), dims));
  let mr = post_luma(post_base(display, q + vec2<i32>(o, 0), dims));
  let bl = post_luma(post_base(display, q + vec2<i32>(-o, o), dims));
  let bb = post_luma(post_base(display, q + vec2<i32>(0, o), dims));
  let br = post_luma(post_base(display, q + vec2<i32>(o, o), dims));
  let gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
  let gy = (bl + 2.0 * bb + br) - (tl + 2.0 * tt + tr);
  ink = max(ink, smoothstep(0.2, 0.5, length(vec2<f32>(gx, gy))));
  ink = max(ink, smoothstep(0.08, 0.25, post_luma(bp) - post_luma(s)));
  let paper = vec3<f32>(0.95, 0.93, 0.87) * (0.95 + 0.05 * post_vnoise(p * 0.8));
  let hue = s / max(max(s.r, max(s.g, s.b)), 0.05);
  let wash = paper * mix(vec3<f32>(1.0), mix(hue, vec3<f32>(1.0), 0.45), keep);
  let lead = mix(vec3<f32>(0.2, 0.2, 0.24), s * 0.45, keep * 0.6);
  return mix(wash, lead, ink * 0.85);
}`,
  [postLuma, postBase, postNoise, postHatch],
);

/**
 * A style (1 paint, 2 halftone, 3 ASCII, 4 pencil) over the picture `s` at `p`; `size` in px, `keep` the colour
 * kept, `mask` the scope mask, `time` in seconds.
 */
export const postStylize = wgsl(
  `
fn post_stylize(display: texture_2d<f32>, normals: texture_2d<f32>, kind: u32, p: vec2<f32>, s: vec3<f32>, dims: vec2<i32>, size: f32, keep: f32, mask: f32, time: f32) -> vec3<f32> {
  let bp = post_base(display, vec2<i32>(p), dims);
  let shade = clamp((post_luma(s) + 0.03) / (post_luma(bp) + 0.03), 0.0, 1.0);
  if (kind == 1u) {
    var c = post_paint(display, normals, p, dims, size, mask) + (s - bp);
    c *= post_brush(display, p, dims, size);
    c *= 1.0 + 0.03 * sin(p.x * 1.9) * sin(p.y * 1.9);
    let under = vec3<f32>(0.42, 0.3, 0.2) * (0.3 + 1.4 * post_luma(c));
    return mix(under, c, keep);
  }
  if (kind == 2u) {
    return post_halftone(display, p, dims, size, keep) * shade;
  }
  if (kind == 3u) {
    return post_ascii(display, p, dims, size, keep);
  }
  return post_sketch(display, p, s, bp, dims, size, keep, time);
}`,
  [postLuma, postBase, postPaint, postBrush, postHalftone, postAscii, postSketch],
);
