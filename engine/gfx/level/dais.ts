/**
 * @file Daises (PLAN.md WP 4.4): `daisGeometry(tile, daises, pieces, ground)` draws each dais (engine/world/level/
 * types.ts, `DaisDescriptor`) as its octagonal frustum, built on the very corners of its hull collider
 * (`frustumPoints`, engine/world/level/shapes.ts), so what is drawn is where feet stand: the sloped edge (and an
 * upright skirt below it when the dais stands above the ground) and the flat octagonal top. It also lays the ground
 * at `ground` over `pieces`, the dais glyph's tiles: an octagon leaves the corners of its outer tiles bare, and the
 * floor (another glyph) has no tiles there.
 *
 * UVs are in metres anchored to the world: the top and the ground run on from the floor's flagstones (u along X, v
 * along -Z); each face of the edge has u along it (left to right seen from the front) and v up its slope.
 *
 * Carried from the dais of `my-3d2dge:src/stress-world/10-hall.js:394-405` (an octagonal top wearing the floor's
 * texture, its sloped edge in dark dressed stone).
 *
 * Invariants: slot 0 the edge and skirt, slot 1 the top and the ground; pure in its inputs; every face looks out of
 * the dais, the top and the ground up.
 *
 * @example
 * // daisGeometry(1, level.daises, descriptor.pieces, 0): the hall's dais, 5.5 m to its base's faces, 0.5 m high
 * @see engine/gfx/level/shapes.test.ts
 */
import type { BufferGeometry } from 'three/webgpu';
import { frustumPoints } from '../../world/level/shapes';
import type { DaisDescriptor, Point3, TileRect } from '../../world/level/types';
import { normalize, type Vec3, type Writer } from '../geometry/writer';
import { polygon, slotted } from './faces';
import { surfaceGeometry } from './surface';

/** Corners per ring of the octagon. */
const SIDES = 8;

/** Writes the ring of quads from `lower` up to `upper` (two rings of 8 corners), facing away from (cx, cz). */
function band(writer: Writer, lower: readonly Point3[], upper: readonly Point3[], cx: number, cz: number): void {
  for (let j = 0; j < SIDES; j++) {
    const next = (j + 1) % SIDES;
    const quad: Vec3[] = [lower[j], lower[next], upper[next], upper[j]];
    const [mx, mz] = [(lower[j][0] + lower[next][0]) / 2 - cx, (lower[j][2] + lower[next][2]) / 2 - cz];
    const out = normalize([mx, 0, mz]);
    // u along the face, left to right seen from the front; v up the slope from the lower ring.
    const slope = Math.hypot(
      Math.hypot(upper[j][0] - cx, upper[j][2] - cz) - Math.hypot(lower[j][0] - cx, lower[j][2] - cz),
      upper[j][1] - lower[j][1],
    );
    const u = ([x, , z]: Vec3) => x * out[2] - z * out[0];
    polygon(
      writer,
      quad,
      quad.map((point, i) => [u(point), i < 2 ? lower[j][1] : lower[j][1] + slope] as const),
      out,
    );
  }
}

/** The daises `daises`, and the ground at `ground` over `pieces` (see the file comment). */
export function daisGeometry(
  tile: number,
  daises: readonly DaisDescriptor[],
  pieces: readonly TileRect[],
  ground: number,
): BufferGeometry {
  const writers = slotted();
  for (const dais of daises) {
    const points = frustumPoints(dais);
    const [cx, cz] = dais.center;
    const base = points.slice(0, SIDES);
    const top = points.slice(-SIDES);
    const rim = points.length > 2 * SIDES ? points.slice(SIDES, 2 * SIDES) : base;
    if (rim !== base) band(writers.slot(0), base, rim, cx, cz);
    band(writers.slot(0), rim, top, cx, cz);
    polygon(
      writers.slot(1),
      top,
      top.map(([x, , z]) => [x, -z] as const),
      [0, 1, 0],
    );
  }
  return writers.build(pieces.length ? [{ slot: 1, geometry: surfaceGeometry(tile, pieces, ground) }] : []);
}
