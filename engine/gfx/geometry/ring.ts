/**
 * @file Rings (PLAN.md WP 2.4): `ringGeometry({ innerRadius, outerRadius, height, radialSegments })`, a ring lying on
 * the ground around the Y axis. With `height` 0 it is three.js's `RingGeometry` laid flat and facing up (a rune
 * circle, a target marker, a shadow blob); with a height it is a solid band, the outer wall facing out, the inner
 * wall facing the axis, a top and a bottom (a well's rim, a brazier's lip, a bracelet). Smooth round its walls.
 *
 * UVs: the flat faces are planar (u along X, v along -Z, in metres from the axis); the walls run u around (metres at
 * their own radius) and v up.
 *
 * Invariants: bounds within [-outerRadius, 0, -outerRadius] to [outerRadius, height, outerRadius], y spanning 0 to
 * height; the inner radius at least 0 and below the outer; no degenerate triangles (an inner radius of 0 makes the
 * flat ring a disc).
 *
 * @example
 * ringGeometry({ innerRadius: 0.8, outerRadius: 1, radialSegments: 16 }).getAttribute('position').count; // 34: 2 rings of 17
 * @see engine/gfx/geometry/kit.test.ts
 */
import type { BufferGeometry } from 'three/webgpu';
import { assertSegments, assertSizes, badGeometry } from './checks';
import { createWriter } from './writer';

/** A ring's radii and height in metres, and its tessellation. */
export interface RingOptions {
  innerRadius?: number;
  outerRadius?: number;
  /** 0 for a flat ring facing up. */
  height?: number;
  /** Steps around. */
  radialSegments?: number;
}

/** A ring lying on the ground (see the file comment). Throws `GFX_BAD_GEOMETRY`. */
export function ringGeometry(options: RingOptions = {}): BufferGeometry {
  const { innerRadius = 0.8, outerRadius = 1, height = 0, radialSegments = 32 } = options;
  assertSizes('ring', { outerRadius });
  assertSizes('ring', { innerRadius, height }, ['innerRadius', 'height']);
  assertSegments('ring', 'radialSegments', radialSegments, 3);
  if (innerRadius >= outerRadius) {
    badGeometry(
      'ring',
      `innerRadius ${innerRadius} is not below outerRadius ${outerRadius}`,
      'an inner radius below the outer',
    );
  }
  const n = radialSegments;
  const writer = createWriter();
  // The vertex ranges of the flat faces, whose UVs become planar: u along X, v along -Z.
  const planar: [number, number][] = [];
  // A flat annulus as a lathe: running inwards faces up, outwards faces down (the lathe's front is left of its run).
  const flat = (y: number, up: boolean) => {
    const [from, to] = up ? [outerRadius, innerRadius] : [innerRadius, outerRadius];
    const ny = up ? 1 : -1;
    const first = writer.count;
    writer.lathe(
      [
        { r: from, y, nr: 0, ny, v: 0 },
        { r: to, y, nr: 0, ny, v: Math.abs(to - from) },
      ],
      n,
    );
    planar.push([first, writer.count]);
  };
  flat(height, true);
  if (height > 0) {
    writer.lathe(
      [
        { r: outerRadius, y: 0, nr: 1, ny: 0, v: 0 },
        { r: outerRadius, y: height, nr: 1, ny: 0, v: height },
      ],
      n,
    );
    if (innerRadius > 0) {
      writer.lathe(
        [
          { r: innerRadius, y: 0, nr: 1, ny: 0, v: 0 },
          { r: innerRadius, y: height, nr: 1, ny: 0, v: height },
        ],
        n,
        { inward: true },
      );
    }
    flat(0, false);
  }
  const geometry = writer.build();
  const p = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  for (const [first, end] of planar) for (let i = first; i < end; i++) uv.setXY(i, p.getX(i), -p.getZ(i));
  return geometry;
}
