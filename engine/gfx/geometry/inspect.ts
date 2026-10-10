/**
 * @file Geometry measured as numbers (PLAN.md WP 2.4, §8.6, I-29): `inspectGeometry(geometry)` counts what the `geo`
 * QA family (tools/qa/geo.ts) and the kit's tests check, in Node: vertices and triangles, missing attributes
 * (`position`, `normal`, `uv`), index entries out of range, NaN or infinite numbers, degenerate triangles (an area
 * below 1e-10 m²: a sliver no pixel shows, which breaks normals and physics hulls), normals that are not of length 1
 * (within 1e-3), triangles wound against their own normals (a corner's normal pointing away from the side the winding
 * faces: the face is culled where it should show, or lit from behind), and the bounds.
 *
 * Invariants: reads the geometry and changes nothing; a geometry without an index is read as one triangle per three
 * vertices; numbers are counts, so 0 means clean; a triangle with a bad index or a NaN corner is counted there only,
 * never as degenerate or flipped too.
 *
 * @example
 * import { boxGeometry } from './box';
 * const report = inspectGeometry(boxGeometry({ width: 2 }));
 * [report.vertices, report.triangles, report.degenerate, report.flipped]; // [24, 12, 0, 0]
 * report.max; // [1, 1, 0.5]
 * @see engine/gfx/geometry/kit.test.ts
 */
import type { BufferAttribute, BufferGeometry } from 'three/webgpu';

/** A triangle smaller than this (m²) is degenerate. */
export const DEGENERATE_AREA = 1e-10;

/** How far a normal's length may be from 1. */
const UNIT = 1e-3;

/** What `inspectGeometry` measured. */
export interface GeometryReport {
  vertices: number;
  triangles: number;
  /** Which of `position`, `normal` and `uv` it lacks. */
  missing: string[];
  /** Index entries that name no vertex. */
  badIndex: number;
  /** NaN or infinite numbers in its positions, normals and UVs. */
  nonFinite: number;
  /** Triangles with an area below `DEGENERATE_AREA`. */
  degenerate: number;
  /** Vertices whose normal is not of length 1. */
  badNormals: number;
  /** Triangles wound against a corner's normal. */
  flipped: number;
  /** The bounds of its positions (m); zeros when it has none. */
  min: [number, number, number];
  max: [number, number, number];
}

/** Measures `geometry` (see the file comment). */
export function inspectGeometry(geometry: BufferGeometry): GeometryReport {
  const p = geometry.getAttribute('position') as BufferAttribute | undefined;
  const n = geometry.getAttribute('normal') as BufferAttribute | undefined;
  const uv = geometry.getAttribute('uv') as BufferAttribute | undefined;
  const vertices = p?.count ?? 0;
  const index = geometry.getIndex();
  const indices = index ? Array.from(index.array as ArrayLike<number>) : Array.from({ length: vertices }, (_, i) => i);
  const report: GeometryReport = {
    vertices,
    triangles: Math.floor(indices.length / 3),
    missing: (['position', 'normal', 'uv'] as const).filter((name, i) => ![p, n, uv][i]),
    badIndex: indices.filter((i) => !(Number.isInteger(i) && i >= 0 && i < vertices)).length,
    nonFinite: [p, n, uv].reduce(
      (sum, attribute) =>
        sum +
        (attribute ? Array.from(attribute.array as ArrayLike<number>).filter((x) => !Number.isFinite(x)).length : 0),
      0,
    ),
    degenerate: 0,
    badNormals: 0,
    flipped: 0,
    min: [0, 0, 0],
    max: [0, 0, 0],
  };
  if (!p || vertices === 0) return report;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vertices; i++) {
    [p.getX(i), p.getY(i), p.getZ(i)].forEach((x, k) => {
      if (!Number.isFinite(x)) return;
      min[k] = Math.min(min[k], x);
      max[k] = Math.max(max[k], x);
    });
    if (n && Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1) > UNIT) report.badNormals++;
  }
  report.min = min.map((x) => (Number.isFinite(x) ? x : 0)) as [number, number, number];
  report.max = max.map((x) => (Number.isFinite(x) ? x : 0)) as [number, number, number];
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const corners = [indices[t], indices[t + 1], indices[t + 2]];
    if (!corners.every((i) => Number.isInteger(i) && i >= 0 && i < vertices)) continue;
    const [a, b, c] = corners.map((i) => [p.getX(i), p.getY(i), p.getZ(i)]);
    if (![...a, ...b, ...c].every(Number.isFinite)) continue;
    const [ux, uy, uz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const [vx, vy, vz] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const face = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const area = Math.hypot(face[0], face[1], face[2]) / 2;
    if (!(area >= DEGENERATE_AREA)) {
      report.degenerate++;
      continue;
    }
    if (n && corners.some((i) => face[0] * n.getX(i) + face[1] * n.getY(i) + face[2] * n.getZ(i) <= 0))
      report.flipped++;
  }
  return report;
}
