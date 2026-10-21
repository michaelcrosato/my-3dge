/**
 * @file Tests for the lost-body rescue (engine/physics/rescue.ts): it puts a body that fell through, or left the level,
 * on the nearest walkable tile, still and turned as it was, its lowest point just above the floor, and leaves the
 * rest; it reads a grid from its origin (a site's); it refuses a level whose grids do not fit.
 */
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from '../core/math';
import { addBall, addBox, addCapsule, addProp } from './bodies';
import { rescueLost, type RescueLevel } from './rescue';
import { createPhysics, type Physics } from './world';

const DT = 1 / 60;
/** The sim stand-in `step` reads: the world's gravity. */
const SIM = { dt: DT, settings: { get: (path: string) => (path === 'physics.gravity' ? 9.81 : undefined) } };
const steps = (p: Physics, n: number) => Array.from({ length: n }, () => p.step(SIM));

/** A physics world with a 40 × 40 m floor whose top is y 0 (x and z from −20 to 20). */
function withFloor(): Physics {
  const p = createPhysics();
  p.addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [40, 1, 40] }, position: [0, -0.5, 0] }] });
  return p;
}

describe('the lost-body rescue', () => {
  /** A 4 × 3 level of 2 m tiles, floor 0 except one raised tile, one wall tile, the rest walkable. */
  const LEVEL: RescueLevel = {
    tile: 2,
    cols: 4,
    rows: 3,
    walkable: [true, true, true, true, true, false, true, true, true, true, true, true],
    floor: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
  };

  it('puts a body that fell through, or left the level, on the nearest walkable tile, still; leaves the rest', () => {
    const p = withFloor();
    const sunk = addBox(p, [0.75, 0.75, 0.75], { position: [3, -4, 3], velocity: [1, -9, 0] }); // under the wall tile (1, 1)
    const out = addBall(p, 0.25, { position: [9, 0.25, 5.5] }); // east of the level, by row 2
    const fine = addBall(p, 0.25, { position: [1, -3, 1] }); // under the floor, but not 3.75 m under
    const deep = addBall(p, 0.25, { position: [5, -6, 3] }); // under the raised tile (2, 1)
    const eighth = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 4);
    const tilted = addBox(p, [0.75, 0.75, 0.75], { position: [1, -5, 5], rotation: eighth }); // on an edge
    const lying = addCapsule(p, 0.3, 0.5, { position: [-2, 0, 1], rotation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2] });
    const rock = addProp(
      p,
      {
        type: 'hull',
        points: [
          [0, -0.2, 0],
          [0.5, 0.3, 0],
          [-0.5, 0.3, 0.4],
          [0, 0.3, -0.5],
        ],
      },
      {
        position: [7, -5, 1],
      },
    );
    expect(rescueLost(p, LEVEL)).toEqual([sunk, out, deep, tilted, lying, rock]);
    const at = (id: number) =>
      p
        .readBody(id)
        .position.toArray()
        .map((v) => +v.toFixed(3));
    // Each lowest point 5 cm above its tile's floor, turned as it was:
    expect(at(sunk)).toEqual([3, 0.425, 1]); // 4 tiles nearest: (1, 0) first
    expect(at(out)).toEqual([7, 0.3, 5]);
    expect(at(deep)).toEqual([5, 1.3, 3]); // on the raised tile, above its floor
    expect(at(tilted)).toEqual([1, +(0.375 * Math.SQRT2 + 0.05).toFixed(3), 5]);
    expect(at(lying)).toEqual([1, 0.35, 1]);
    expect(at(rock)).toEqual([7, 0.25, 1]);
    expect(Math.abs(p.readBody(tilted).rotation.dot(eighth))).toBeCloseTo(1, 6); // still turned as it fell
    expect(at(fine)).toEqual([1, -3, 1]);
    expect(p.readBody(sunk).velocity.length()).toBe(0);
    steps(p, 60);
    expect(p.readBody(sunk).position.y).toBeCloseTo(0.375, 2); // resting on the tile's floor
    expect(rescueLost(p, LEVEL, { depth: 2 })).toEqual([fine]);
    expect(rescueLost(p, { ...LEVEL, walkable: LEVEL.walkable.map(() => false) })).toEqual([]);
    expect(() => rescueLost(p, { ...LEVEL, floor: [] })).toThrow(/rescueLost\(level\)/);
    p.dispose();
  });

  it('reads a grid from its origin, as a site’s runs (WP 13.15)', () => {
    const p = withFloor();
    const sunk = addBall(p, 0.25, { position: [-9, -6, 5] }); // under its tile (0, 0), which runs from (−10, 4)
    const out = addBall(p, 0.25, { position: [0, 0.25, 9] }); // east of it, by row 2
    expect(rescueLost(p, { ...LEVEL, origin: [-10, 4] })).toEqual([sunk, out]);
    expect([sunk, out].map((id) => p.readBody(id).position.toArray().map((v) => +v.toFixed(3)))).toEqual([[-9, 0.3, 5], [-3, 0.3, 9]]); // prettier-ignore
    p.dispose();
  });
});
