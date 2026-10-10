/**
 * @file Frustums, prisms and cylinders (PLAN.md WP 2.4): `frustumGeometry({ radiusBottom, radiusTop, height,
 * radialSegments, smooth })`, three.js's `CylinderGeometry` standing on the ground, with UVs in metres: an octagonal
 * dais, a brazier's bowl, a barrel, a cone (`radiusTop` 0), a well. Faceted by default (flat sides with their own
 * normals: a dais or a plinth), or `smooth` (normals around the axis: a barrel or a column). The radii are those of
 * the corners; a flat side faces +Z, so an octagon sits square on a tile grid.
 *
 * UVs: the sides run u around (metres along the bottom edge, smooth or not) and v up the slant; the caps are planar
 * (u along X, v along -Z, in metres from the axis).
 *
 * Invariants: bounds within [-r, 0, -r] to [r, height, r] for r the bigger radius, y spanning exactly 0 to height; a
 * bottom cap always, a top cap when `radiusTop` is above 0; no degenerate triangles (a cone's sides are triangles).
 *
 * @example
 * frustumGeometry({ radiusBottom: 2, radiusTop: 1.6, height: 0.5, radialSegments: 8 }).getAttribute('position').count; // 50
 * @see engine/gfx/geometry/kit.test.ts
 */
import type { BufferGeometry } from 'three/webgpu';
import { assertSegments, assertSizes } from './checks';
import { createWriter, normalize, type Vec3 } from './writer';

/** A frustum's sizes in metres and its tessellation. */
export interface FrustumOptions {
  radiusBottom?: number;
  /** 0 for a cone. */
  radiusTop?: number;
  height?: number;
  /** Sides around: 8 for an octagon. */
  radialSegments?: number;
  /** Smooth normals around the axis instead of flat sides. */
  smooth?: boolean;
}

/** A frustum standing on the ground (see the file comment). Throws `GFX_BAD_GEOMETRY`. */
export function frustumGeometry(options: FrustumOptions = {}): BufferGeometry {
  const { radiusBottom = 1, radiusTop = 1, height = 1, radialSegments = 8, smooth = false } = options;
  assertSizes('frustum', { radiusBottom, height });
  assertSizes('frustum', { radiusTop }, ['radiusTop']);
  assertSegments('frustum', 'radialSegments', radialSegments, 3);
  const n = radialSegments;
  const angle0 = Math.PI / n;
  const writer = createWriter();
  const slant = Math.hypot(height, radiusBottom - radiusTop);
  if (smooth) {
    const [nr, ny] = [height / slant, (radiusBottom - radiusTop) / slant];
    writer.lathe(
      [
        { r: radiusBottom, y: 0, nr, ny, v: 0 },
        { r: radiusTop, y: height, nr, ny, v: slant },
      ],
      n,
      { angle0 },
    );
  } else {
    const corner = (radius: number, y: number, j: number): Vec3 => {
      const angle = angle0 + (2 * Math.PI * j) / n;
      return [radius * Math.sin(angle), y, radius * Math.cos(angle)];
    };
    const edge = 2 * radiusBottom * Math.sin(Math.PI / n);
    for (let j = 0; j < n; j++) {
      const [a, b] = [corner(radiusBottom, 0, j), corner(radiusBottom, 0, j + 1)];
      const [c, d] = [corner(radiusTop, height, j + 1), corner(radiusTop, height, j)];
      const across = normalize([b[0] - a[0], 0, b[2] - a[2]]);
      const up = normalize([(c[0] + d[0] - a[0] - b[0]) / 2, height, (c[2] + d[2] - a[2] - b[2]) / 2]);
      const first = writer.count;
      const top = radiusTop > 0 ? [c, d] : [c];
      [a, b, ...top].forEach((point) => {
        const u = j * edge + (point[0] - a[0]) * across[0] + (point[2] - a[2]) * across[2];
        const v = (point[0] - (a[0] + b[0]) / 2) * up[0] + point[1] * up[1] + (point[2] - (a[2] + b[2]) / 2) * up[2];
        const normal = normalize([
          across[1] * up[2] - across[2] * up[1],
          across[2] * up[0] - across[0] * up[2],
          across[0] * up[1] - across[1] * up[0],
        ]);
        writer.vertex(point, normal, [u, v]);
      });
      writer.triangle(first, first + 1, first + 2);
      if (radiusTop > 0) writer.triangle(first, first + 2, first + 3);
    }
  }
  writer.disc(radiusBottom, 0, n, -1, angle0);
  if (radiusTop > 0) writer.disc(radiusTop, height, n, 1, angle0);
  return writer.build();
}
