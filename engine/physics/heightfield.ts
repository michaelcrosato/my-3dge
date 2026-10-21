/**
 * @file Heightfield colliders (PLAN.md WP 10.5, §4.7): a collider shape for bodies (engine/physics/world.ts),
 * `{ type: 'heightfield', cols, rows, size, heights }`, a grid of `cols` × `rows` cells `size` metres across in all,
 * centred on the collider's position, its heights given at the cells' corners row by row from its north (−z) edge,
 * west to east, as the world's terrain keeps them (engine/world/terrain.ts). `heightfieldDesc` makes it Rapier's
 * heightfield, which wants the heights column by column (`nrows` along z, `ncols` along x) and splits each cell along
 * the diagonal from its north-east corner to its south-west one (measured on 0.21). Internal edges are fixed
 * (`FIX_INTERNAL_EDGES`: a contact's normal on a flat run never takes a neighbouring triangle's edge), so a body
 * sliding over the seams between cells never catches on one.
 *
 * Invariants: the heights are checked (finite, as many as the corners) and copied into float32 in Rapier's order;
 * the shape is the collider's, so the body's snapshot holds it and a restore brings it back.
 *
 * @example
 * import { createSettings } from '../core/settings';
 * import { createPhysics } from './world';
 * const physics = createPhysics();
 * physics.addBody({ type: 'fixed', colliders: [{ shape: { type: 'heightfield', cols: 1, rows: 1, size: [2, 2], heights: [0, 0, 0, 2] } }] });
 * physics.step({ dt: 1 / 60, settings: createSettings().sim });
 * [physics.probe(0.5, 0.5)?.y, physics.probe(-0.5, -0.5)?.y]; // [1, 0]: the south-east triangle rises to its corner
 * @see engine/physics/heightfield.test.ts
 */
import RAPIER from '@dimforge/rapier3d-simd-compat';
import { check } from './queries';

/** A heightfield, for bodies only (see the file comment). */
export interface HeightfieldShape {
  readonly type: 'heightfield';
  /** Cells along x and along z. */
  readonly cols: number;
  readonly rows: number;
  /** Its extent along x and along z (m). */
  readonly size: readonly [number, number];
  /** The heights (m) at its (rows + 1) × (cols + 1) corners, row by row from the north edge, west to east. */
  readonly heights: ArrayLike<number>;
}

/** Rapier's collider description of `shape`, checked (see the file comment); `where` names it in errors. */
export function heightfieldDesc(shape: HeightfieldShape, where: string): RAPIER.ColliderDesc {
  const { cols, rows, size, heights } = shape;
  const whole = (n: number) => Number.isInteger(n) && n >= 1;
  check(whole(cols), `${where}.cols`, cols, 'a whole number of cells, 1 or more');
  check(whole(rows), `${where}.rows`, rows, 'a whole number of cells, 1 or more');
  const extent = Array.isArray(size) && size.length === 2 && size.every((n) => Number.isFinite(n) && n > 0);
  check(extent, `${where}.size`, size, '[x, z], two positive numbers of metres');
  const count = (rows + 1) * (cols + 1);
  check(heights?.length === count, `${where}.heights`, heights?.length, `${count} heights, one at each corner`);
  const columns = new Float32Array(count);
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= cols; col++) {
      const h = heights[row * (cols + 1) + col];
      check(Number.isFinite(h), `${where}.heights[${row * (cols + 1) + col}]`, h, 'a finite height');
      columns[col * (rows + 1) + row] = h;
    }
  }
  const scale = { x: size[0], y: 1, z: size[1] };
  return RAPIER.ColliderDesc.heightfield(rows, cols, columns, scale, RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES);
}
