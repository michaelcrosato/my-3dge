/**
 * @file Boxes (PLAN.md WP 2.4): `boxGeometry({ width, height, depth })`, three.js's `BoxGeometry` with two changes
 * the level meshes and props need: it stands on the ground (its bottom at y 0, centred in X and Z), and its UVs are
 * in metres, so a texture keeps its density (16 texels per metre for the v1 textures) on every face whatever the
 * box's size, instead of being stretched over each face. Each face keeps `BoxGeometry`'s orientation (u to the right
 * and v up, seen from outside; the top's v towards -Z) and its order (+X, -X, +Y, -Y, +Z, -Z), with its UVs starting
 * at 0 in its lower-left corner.
 *
 * `sidesThenTops` (engine/gfx/geometry/groups.ts) turns the six faces into two draw groups.
 *
 * Carried from `boxGeo`, `my-3d2dge:src/stress-world/10-hall.js:253-257` (faces keeping 16 texels per metre).
 *
 * Invariants: 24 vertices, 12 triangles, flat normals; bounds [-width/2, 0, -depth/2] to [width/2, height, depth/2].
 *
 * @example
 * const box = boxGeometry({ width: 2, height: 3, depth: 1 });
 * box.getAttribute('position').count; // 24
 * box.boundingBox; // null until computed; computeBoundingBox() gives min (-1, 0, -0.5), max (1, 3, 0.5)
 * @see engine/gfx/geometry/kit.test.ts
 */
import type { BufferGeometry } from 'three/webgpu';
import { assertSizes } from './checks';
import { createWriter, type Vec3 } from './writer';

/** A box's size in metres. */
export interface BoxOptions {
  width?: number;
  height?: number;
  depth?: number;
}

/** The six faces as [outward normal, u axis, v axis], in `BoxGeometry`'s order. */
const FACES: readonly [Vec3, Vec3, Vec3][] = [
  [
    [1, 0, 0],
    [0, 0, -1],
    [0, 1, 0],
  ],
  [
    [-1, 0, 0],
    [0, 0, 1],
    [0, 1, 0],
  ],
  [
    [0, 1, 0],
    [1, 0, 0],
    [0, 0, -1],
  ],
  [
    [0, -1, 0],
    [1, 0, 0],
    [0, 0, 1],
  ],
  [
    [0, 0, 1],
    [1, 0, 0],
    [0, 1, 0],
  ],
  [
    [0, 0, -1],
    [-1, 0, 0],
    [0, 1, 0],
  ],
];

/** A box standing on the ground, UVs in metres (see the file comment). Throws `GFX_BAD_GEOMETRY` for a size ≤ 0. */
export function boxGeometry({ width = 1, height = 1, depth = 1 }: BoxOptions = {}): BufferGeometry {
  assertSizes('box', { width, height, depth });
  const half: Vec3 = [width / 2, height / 2, depth / 2];
  const writer = createWriter();
  for (const [n, u, v] of FACES) {
    const at = (su: number, sv: number): Vec3 => {
      const p = [0, 1, 2].map((k) => (n[k] + su * u[k] + sv * v[k]) * half[k]);
      return [p[0], p[1] + half[1], p[2]];
    };
    writer.face([at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)], u, v);
  }
  const geometry = writer.build();
  geometry.groups.length = 0;
  for (let face = 0; face < 6; face++) geometry.addGroup(face * 6, 6, face);
  return geometry;
}
