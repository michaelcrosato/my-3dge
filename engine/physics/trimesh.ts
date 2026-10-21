/**
 * @file Triangle-mesh colliders (PLAN.md WP 13.15; docs/PLAYGROUND.md §6.3): a collider shape for bodies
 * (engine/physics/world.ts), `{ type: 'trimesh', vertices, indices }`: vertices as x, y, z triples (m, in the body's
 * frame) and triangles as triples of their indices, each counter-clockwise seen from the side it faces. It is Rapier's
 * trimesh with its internal edges fixed (`FIX_INTERNAL_EDGES`, which also merges duplicate vertices), so a body
 * sliding across the seams between triangles never catches on one. A terrain cut under a structure stands as one
 * (engine/sim/levelBodies.ts): Rapier 0.21's heightfield has no holes, and chunks of separate colliders would catch
 * bodies at their seams, where no collider knows its neighbour's edges.
 *
 * Invariants: checked (finite vertices, whole triangles, indices in range) and copied into float32 and uint32 in their
 * order, so the same mesh gives the same Rapier state.
 *
 * @example
 * import { createSettings } from '../core/settings';
 * import { createPhysics } from './world';
 * const physics = createPhysics();
 * const square = { type: 'trimesh', vertices: [0, 0, 0, 0, 0, 2, 2, 1, 0, 2, 1, 2], indices: [0, 1, 2, 2, 1, 3] } as const;
 * physics.addBody({ type: 'fixed', colliders: [{ shape: square }] });
 * physics.step({ dt: 1 / 60, settings: createSettings().sim });
 * physics.probe(1, 1)?.y; // 0.5: halfway up the slope
 * @see engine/physics/trimesh.test.ts
 */
import RAPIER from '@dimforge/rapier3d-simd-compat';
import { check } from './queries';

/** A triangle mesh, for bodies only (see the file comment). */
export interface TrimeshShape {
  readonly type: 'trimesh';
  /** x, y, z of each vertex (m, in the body's frame). */
  readonly vertices: ArrayLike<number>;
  /** Each triangle's three vertex indices, counter-clockwise seen from the side it faces. */
  readonly indices: ArrayLike<number>;
}

/** Rapier's collider description of `shape`, checked (see the file comment); `where` names it in errors. */
export function trimeshDesc(shape: TrimeshShape, where: string): RAPIER.ColliderDesc {
  const { vertices, indices } = shape;
  const count = vertices?.length ?? 0;
  check(count >= 9 && count % 3 === 0, `${where}.vertices`, count, 'x, y, z triples: three vertices or more');
  check((indices?.length ?? 0) >= 3 && indices.length % 3 === 0, `${where}.indices`, indices?.length, 'whole triangles: three indices each'); // prettier-ignore
  const points = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    check(Number.isFinite(vertices[i]), `${where}.vertices[${i}]`, vertices[i], 'a finite coordinate');
    points[i] = vertices[i];
  }
  const triangles = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i];
    check(Number.isInteger(v) && v >= 0 && v < count / 3, `${where}.indices[${i}]`, v, `a vertex index from 0 to ${count / 3 - 1}`); // prettier-ignore
    triangles[i] = v;
  }
  return RAPIER.ColliderDesc.trimesh(points, triangles, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES);
}
