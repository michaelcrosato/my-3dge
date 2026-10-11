/**
 * @file The geometry writer (PLAN.md WP 2.4): the one place the kit's builders (engine/gfx/geometry/) turn vertices
 * and triangles into a three.js `BufferGeometry` with `position`, `normal` and `uv` and an index. `face` writes a flat
 * convex polygon with its UVs in metres along two axes, `lathe` a surface of revolution with smooth normals around
 * the Y axis, and `disc` a flat fan.
 *
 * Conventions every builder keeps: metres, +Y up; a triangle is counter-clockwise seen from the side its normal
 * points to; UVs are in metres (u along the face's horizontal, v up it), so a texture's density (texels per metre,
 * engine/gfx/textures/texture.ts) holds on every face; a lathe's angle 0 faces +Z and grows towards +X, as three.js's
 * `LatheGeometry` does.
 *
 * Invariants: a lathe never writes a triangle with two corners on a pole (a ring of radius 0), so it writes no
 * degenerate triangles; the index is 16-bit while it fits.
 *
 * @example
 * const writer = createWriter();
 * writer.face([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], [1, 0, 0], [0, 1, 0]); // a 1 m square facing +Z
 * writer.build().getAttribute('position').count; // 4
 * @see engine/gfx/geometry/kit.test.ts
 */
import { BufferGeometry, Float32BufferAttribute } from 'three/webgpu';

/** A point or direction in metres: `[x, y, z]`. */
export type Vec3 = readonly [x: number, y: number, z: number];

/** One ring of a lathe's profile: its radius and height, its normal in the (radial, y) plane, and its v (m). */
export interface ProfilePoint {
  r: number;
  y: number;
  nr: number;
  ny: number;
  v: number;
}

/** What the builders write with. */
export interface Writer {
  /** Adds a vertex; returns its index. */
  vertex(position: Vec3, normal: Vec3, uv: readonly [number, number]): number;
  /** Adds a triangle by vertex indices, counter-clockwise seen from its front. */
  triangle(a: number, b: number, c: number): void;
  /**
   * Adds a flat convex polygon whose `points` run counter-clockwise seen from the front; its normal is `u × v`, and
   * each point's UV is its distance in metres along the unit axes `u` and `v` from the polygon's lowest corner.
   */
  face(points: readonly Vec3[], u: Vec3, v: Vec3): void;
  /** Adds a surface of revolution about +Y through `profile` (bottom to top), `segments` around; `inward` flips it. */
  lathe(profile: readonly ProfilePoint[], segments: number, options?: { inward?: boolean; angle0?: number }): void;
  /** Adds a flat disc (or polygon) at height `y` facing up (`facing` 1) or down (-1), centred on the Y axis. */
  disc(radius: number, y: number, segments: number, facing: 1 | -1, angle0?: number): void;
  /** The vertices written so far: the index the next vertex gets. */
  readonly count: number;
  /** The geometry written so far. */
  build(): BufferGeometry;
}

/** `a × b`. */
export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** `a · b`. */
export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** `a` scaled to length 1 (the zero vector stays zero). */
export function normalize(a: Vec3): Vec3 {
  const length = Math.hypot(a[0], a[1], a[2]);
  return length > 0 ? [a[0] / length, a[1] / length, a[2] / length] : [0, 0, 0];
}

/** Makes an empty writer. */
export function createWriter(): Writer {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const writer: Writer = {
    vertex(position, normal, uv) {
      positions.push(...position);
      normals.push(...normal);
      uvs.push(...uv);
      return writer.count - 1;
    },
    triangle(a, b, c) {
      indices.push(a, b, c);
    },
    face(points, u, v) {
      const normal = cross(u, v);
      const us = points.map((p) => dot(p, u));
      const vs = points.map((p) => dot(p, v));
      const [u0, v0] = [Math.min(...us), Math.min(...vs)];
      const first = writer.count;
      points.forEach((point, i) => writer.vertex(point, normal, [us[i] - u0, vs[i] - v0]));
      for (let i = 1; i + 1 < points.length; i++) writer.triangle(first, first + i, first + i + 1);
    },
    lathe(profile, segments, { inward = false, angle0 = 0 } = {}) {
      const around = 2 * Math.PI * Math.max(...profile.map((point) => point.r));
      const sign = inward ? -1 : 1;
      const first = writer.count;
      for (const { r, y, nr, ny, v } of profile) {
        for (let j = 0; j <= segments; j++) {
          const angle = angle0 + (2 * Math.PI * j) / segments;
          const [s, c] = [Math.sin(angle), Math.cos(angle)];
          writer.vertex([r * s, y, r * c], [sign * nr * s, sign * ny, sign * nr * c], [(around * j) / segments, v]);
        }
      }
      const at = (k: number, j: number) => first + k * (segments + 1) + j;
      for (let k = 0; k + 1 < profile.length; k++) {
        const [pole0, pole1] = [profile[k].r === 0, profile[k + 1].r === 0];
        for (let j = 0; j < segments; j++) {
          const [a, b, c, d] = [at(k, j), at(k, j + 1), at(k + 1, j + 1), at(k + 1, j)];
          const triangles: [number, number, number][] = [];
          if (!pole0) triangles.push([a, b, c]);
          if (!pole1) triangles.push([a, c, d]);
          for (const [x, y2, z] of triangles) {
            if (inward) writer.triangle(x, z, y2);
            else writer.triangle(x, y2, z);
          }
        }
      }
    },
    disc(radius, y, segments, facing, angle0 = 0) {
      const centre = writer.vertex([0, y, 0], [0, facing, 0], [0, 0]);
      const ring: number[] = [];
      for (let j = 0; j < segments; j++) {
        const angle = angle0 + (2 * Math.PI * j) / segments;
        const [x, z] = [radius * Math.sin(angle), radius * Math.cos(angle)];
        ring.push(writer.vertex([x, y, z], [0, facing, 0], [x, -z]));
      }
      for (let j = 0; j < segments; j++) {
        const [a, b] = [ring[j], ring[(j + 1) % segments]];
        if (facing > 0) writer.triangle(centre, a, b);
        else writer.triangle(centre, b, a);
      }
    },
    get count() {
      return positions.length / 3;
    },
    build() {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
      geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
      geometry.setIndex(indices);
      return geometry;
    },
  };
  return writer;
}
