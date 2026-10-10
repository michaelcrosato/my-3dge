/**
 * @file Ramps and wedges (PLAN.md WP 2.4): `rampGeometry({ width, depth, low, high })`, a block standing on the ground
 * whose top slopes from `low` at its -Z end up to `high` at its +Z end, so walking forward (+Z, the way characters
 * face) climbs it. With `low` 0 it is a wedge. For ramps, the stairs' hull (WP 4.2), roofs and doorsteps.
 *
 * Faces, each flat with its own normals and UVs in metres: the slope (u across, v up the slope), the back (+Z, `high`
 * tall), the front (-Z, `low` tall; none for a wedge), two sides (trapezoids, or triangles for a wedge) and the
 * bottom.
 *
 * Invariants: bounds [-width/2, 0, -depth/2] to [width/2, high, depth/2]; 24 vertices and 12 triangles (a wedge: 18
 * and 8); `high` above 0 and at least `low`.
 *
 * @example
 * rampGeometry({ width: 2, depth: 4, low: 0, high: 1 }).getAttribute('position').count; // 18: a wedge
 * @see engine/gfx/geometry/kit.test.ts
 */
import type { BufferGeometry } from 'three/webgpu';
import { assertSizes, badGeometry } from './checks';
import { createWriter, normalize, type Vec3 } from './writer';

/** A ramp's sizes in metres. */
export interface RampOptions {
  /** Across (X). */
  width?: number;
  /** Along the slope's run (Z). */
  depth?: number;
  /** The top's height at the -Z end; 0 makes a wedge. */
  low?: number;
  /** The top's height at the +Z end. */
  high?: number;
}

/** A ramp or wedge standing on the ground, rising towards +Z (see the file comment). Throws `GFX_BAD_GEOMETRY`. */
export function rampGeometry(options: RampOptions = {}): BufferGeometry {
  const { width = 1, depth = 2, low = 0, high = 1 } = options;
  assertSizes('ramp', { width, depth, high });
  assertSizes('ramp', { low }, ['low']);
  if (low > high) badGeometry('ramp', `low ${low} is above high ${high}`, 'low at most high (turn the ramp round)');
  const [x, z] = [width / 2, depth / 2];
  const writer = createWriter();
  // Each face: its corners counter-clockwise seen from outside, and [u, v] with u × v its outward normal.
  const slope = normalize([0, high - low, depth]);
  writer.face(
    [
      [-x, low, -z],
      [-x, high, z],
      [x, high, z],
      [x, low, -z],
    ],
    [-1, 0, 0],
    slope,
  );
  writer.face(
    [
      [-x, 0, z],
      [x, 0, z],
      [x, high, z],
      [-x, high, z],
    ],
    [1, 0, 0],
    [0, 1, 0],
  );
  if (low > 0) {
    writer.face(
      [
        [x, 0, -z],
        [-x, 0, -z],
        [-x, low, -z],
        [x, low, -z],
      ],
      [-1, 0, 0],
      [0, 1, 0],
    );
  }
  const east: Vec3[] = [[x, 0, z], [x, 0, -z], ...(low > 0 ? [[x, low, -z] as Vec3] : []), [x, high, z]];
  writer.face(east, [0, 0, -1], [0, 1, 0]);
  const west: Vec3[] = [[-x, 0, -z], [-x, 0, z], [-x, high, z], ...(low > 0 ? [[-x, low, -z] as Vec3] : [])];
  writer.face(west, [0, 0, 1], [0, 1, 0]);
  writer.face(
    [
      [-x, 0, -z],
      [x, 0, -z],
      [x, 0, z],
      [-x, 0, z],
    ],
    [1, 0, 0],
    [0, 0, 1],
  );
  return writer.build();
}
