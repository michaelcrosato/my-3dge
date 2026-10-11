/**
 * @file Rounded boxes (PLAN.md WP 2.4): `roundedBoxGeometry({ width, height, depth, radius, segments })`, a box whose
 * edges and corners are rounded with `radius`, as three.js's `RoundedBoxGeometry` addon draws one, standing on the
 * ground like every shape of the kit (its bottom at y 0, centred in X and Z), with UVs in metres and smooth normals.
 * For crates, chests, a puppet's head or hands.
 *
 * How it is built: each face is a grid whose lines sit at the inner box's faces (the box shrunk by the radius) and,
 * in the band beyond, at angles equally spaced over the 45° of the rounding that face owns (its neighbour owns the
 * other 45°). Each grid point is pushed out from the inner box by the radius, along the direction from its nearest
 * inner-box point, which is also its normal. Faces meet on shared seams with equal positions and normals, so the
 * surface is smooth; the corners are spheres' octants. A radius of 0 gives `boxGeometry`'s box; a radius of half the
 * smallest side rounds that side completely.
 *
 * Invariants: bounds [-width/2, 0, -depth/2] to [width/2, height, depth/2]; normals of length 1; no degenerate
 * triangles; `segments` counts the steps of each 45° band, so a rounded edge has 2 × segments.
 *
 * @example
 * roundedBoxGeometry({ width: 1, height: 1, depth: 1, radius: 0.1, segments: 2 }).getAttribute('position').count; // 216: 6 faces of 6 × 6
 * @see engine/gfx/geometry/kit.test.ts
 */
import type { BufferGeometry } from 'three/webgpu';
import { boxGeometry } from './box';
import { assertSegments, assertSizes, badGeometry } from './checks';
import { createWriter, normalize, type Vec3 } from './writer';

/** A rounded box's size and rounding, in metres. */
export interface RoundedBoxOptions {
  width?: number;
  height?: number;
  depth?: number;
  /** The rounding's radius: at most half the smallest side. */
  radius?: number;
  /** Steps over each 45° band of the rounding. */
  segments?: number;
}

/** The grid lines along one axis of half-size `half`: the band's angles, then the inner box's faces, deduplicated. */
function lines(half: number, radius: number, segments: number): number[] {
  const band = Array.from(
    { length: segments + 1 },
    (_, i) => half - radius + radius * Math.tan((Math.PI / 4) * (i / segments)),
  );
  band[segments] = half;
  const all = [...band.map((x) => -x).reverse(), ...band];
  return all.filter((x, i) => i === 0 || x - all[i - 1] > 1e-9);
}

/** A rounded box standing on the ground (see the file comment). Throws `GFX_BAD_GEOMETRY`. */
export function roundedBoxGeometry(options: RoundedBoxOptions = {}): BufferGeometry {
  const { width = 1, height = 1, depth = 1, radius = 0.1, segments = 2 } = options;
  assertSizes('rounded box', { width, height, depth });
  assertSizes('rounded box', { radius }, ['radius']);
  assertSegments('rounded box', 'segments', segments, 1);
  const half: Vec3 = [width / 2, height / 2, depth / 2];
  if (radius > Math.min(...half) + 1e-12) {
    badGeometry(
      'rounded box',
      `radius ${radius} is above half its smallest side`,
      `a radius of at most ${Math.min(...half)}`,
    );
  }
  if (radius === 0) return boxGeometry({ width, height, depth });
  const inner = half.map((h) => h - radius);
  const writer = createWriter();
  // [normal axis, its sign, u axis, its sign, v axis, its sign], in BoxGeometry's face order.
  const faces: [number, number, number, number, number, number][] = [
    [0, 1, 2, -1, 1, 1],
    [0, -1, 2, 1, 1, 1],
    [1, 1, 0, 1, 2, -1],
    [1, -1, 0, 1, 2, 1],
    [2, 1, 0, 1, 1, 1],
    [2, -1, 0, -1, 1, 1],
  ];
  for (const [n, sn, u, su, v, sv] of faces) {
    const us = lines(half[u], radius, segments);
    const vs = lines(half[v], radius, segments);
    const first = writer.count;
    for (const b of vs) {
      for (const a of us) {
        const flat = [0, 0, 0];
        flat[n] = sn * half[n];
        flat[u] = su * a;
        flat[v] = sv * b;
        const core = flat.map((x, k) => Math.max(-inner[k], Math.min(inner[k], x)));
        const normal = normalize([flat[0] - core[0], flat[1] - core[1], flat[2] - core[2]]);
        const position: Vec3 = [
          core[0] + radius * normal[0],
          core[1] + radius * normal[1] + half[1],
          core[2] + radius * normal[2],
        ];
        writer.vertex(position, normal, [a + half[u], b + half[v]]);
      }
    }
    const at = (i: number, j: number) => first + j * us.length + i;
    for (let j = 0; j + 1 < vs.length; j++) {
      for (let i = 0; i + 1 < us.length; i++) {
        writer.triangle(at(i, j), at(i + 1, j), at(i + 1, j + 1));
        writer.triangle(at(i, j), at(i + 1, j + 1), at(i, j + 1));
      }
    }
  }
  return writer.build();
}
