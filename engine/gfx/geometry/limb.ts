/**
 * @file Tapered limbs (PLAN.md WP 2.4): `limbGeometry({ length, radiusStart, radiusEnd })`, the smooth hull of two
 * spheres, one of `radiusStart` at the origin (the joint) and one of `radiusEnd` at `length` up +Y (the next joint):
 * an upper arm, a thigh, a finger, a tail segment. A capsule (three.js's `CapsuleGeometry`) is the case of equal
 * radii.
 *
 * The cone between the spheres touches each one along the latitude φ where sin φ = (radiusStart − radiusEnd) /
 * length, so the bigger sphere shows more than a hemisphere and the surface turns smoothly from sphere to cone to
 * sphere: every normal is the sphere's (or the cone's, which is the same along the seams). Built as a lathe
 * (engine/gfx/geometry/writer.ts): `radialSegments` around, `capSegments` rings on each cap.
 *
 * Invariants: bounds from (−r, −radiusStart, −r) to (r, length + radiusEnd, r) with r the bigger radius; normals of
 * length 1; no degenerate triangles; length must exceed the difference of the radii (else one sphere swallows the
 * other: `GFX_BAD_GEOMETRY`).
 *
 * @example
 * const limb = limbGeometry({ length: 0.4, radiusStart: 0.06, radiusEnd: 0.04, radialSegments: 8, capSegments: 3 });
 * limb.getAttribute('position').count; // 72: 8 rings of 9
 * @see engine/gfx/geometry/kit.test.ts
 */
import type { BufferGeometry } from 'three/webgpu';
import { assertSegments, assertSizes, badGeometry } from './checks';
import { createWriter, type ProfilePoint } from './writer';

/** A tapered limb's sizes in metres and its tessellation. */
export interface LimbOptions {
  /** From joint to joint, along +Y. */
  length?: number;
  /** The radius at the origin. */
  radiusStart?: number;
  /** The radius at the far joint. */
  radiusEnd?: number;
  /** Steps around. */
  radialSegments?: number;
  /** Rings over each cap. */
  capSegments?: number;
}

/** A tapered limb from the origin up +Y (see the file comment). Throws `GFX_BAD_GEOMETRY`. */
export function limbGeometry(options: LimbOptions = {}): BufferGeometry {
  const { length = 0.5, radiusStart = 0.08, radiusEnd = 0.06, radialSegments = 12, capSegments = 4 } = options;
  assertSizes('limb', { length, radiusStart, radiusEnd });
  assertSegments('limb', 'radialSegments', radialSegments, 3);
  assertSegments('limb', 'capSegments', capSegments, 1);
  if (length <= Math.abs(radiusStart - radiusEnd)) {
    badGeometry(
      'limb',
      `its length ${length} is not above the difference of its radii, ${Math.abs(radiusStart - radiusEnd)}`,
      'a length above |radiusStart − radiusEnd|',
    );
  }
  const phi = Math.asin((radiusStart - radiusEnd) / length);
  const profile: ProfilePoint[] = [];
  let v = 0;
  const ring = (radius: number, centre: number, latitude: number) => {
    const point = { r: radius * Math.cos(latitude), y: centre + radius * Math.sin(latitude) };
    const last = profile[profile.length - 1];
    if (last) v += Math.hypot(point.r - last.r, point.y - last.y);
    profile.push({ ...point, nr: Math.cos(latitude), ny: Math.sin(latitude), v });
  };
  for (let k = 0; k <= capSegments; k++) ring(radiusStart, 0, -Math.PI / 2 + ((phi + Math.PI / 2) * k) / capSegments);
  for (let k = 0; k <= capSegments; k++) ring(radiusEnd, length, phi + ((Math.PI / 2 - phi) * k) / capSegments);
  profile[0].r = 0;
  profile[profile.length - 1].r = 0;
  const writer = createWriter();
  writer.lathe(profile, radialSegments);
  return writer.build();
}
