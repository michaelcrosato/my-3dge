/**
 * @file Tests for the queries (engine/physics/queries.ts) on a physics world: raycasts report the body, distance in
 * metres, point and normal, and honour groups, `exclude`, `maxDistance` and sensors; shape casts stop where the shape
 * touches; overlaps list body ids in order; `probe(x, z)` finds the ground's height and slope; queries see bodies from
 * the first step after they are added, and never change the hashed state.
 */
import { describe, expect, it } from 'vitest';
import { hashNumbers } from '../core/hash';
import { createRegistry } from '../core/registry';
import { createSettings, defineSettings } from '../core/settings';
import { PHYSICS_SETTINGS } from './params';
import { createPhysics } from './world';

/** A sim stand-in for `step`, with no gravity so nothing moves. */
function still() {
  const registry = createRegistry();
  defineSettings(PHYSICS_SETTINGS, registry);
  const settings = createSettings({ registry });
  settings.set('physics.gravity', 0);
  return { dt: 1 / 60, settings: settings.sim };
}

/** A floor (top y 0), a 1 m step at x 3 (top y 1), a 30° ramp at x −4, a crate (prop) at x 0, z 3, and a sensor. */
function scene() {
  const p = createPhysics();
  const floor = p.addBody({
    type: 'fixed',
    colliders: [{ shape: { type: 'box', size: [20, 1, 20] }, position: [0, -0.5, 0] }],
  });
  const step = p.addBody({
    type: 'fixed',
    position: [3, 0.5, 0],
    colliders: [{ shape: { type: 'box', size: [1, 1, 1] } }],
  });
  const half = Math.PI / 12; // a 30° turn about z, as a quaternion
  const ramp = p.addBody({
    type: 'fixed',
    position: [-4, 0, 0],
    rotation: [0, 0, Math.sin(half), Math.cos(half)],
    colliders: [{ shape: { type: 'box', size: [4, 0.2, 2] } }],
  });
  const crate = p.addBody({ position: [0, 0.5, 3], colliders: [{ shape: { type: 'box', size: [1, 1, 1] } }] });
  const sensor = p.addBody({
    type: 'fixed',
    position: [0, 3, 0],
    colliders: [{ shape: { type: 'box', size: [2, 0.2, 2] }, sensor: true }],
  });
  p.step(still());
  return { p, floor, step, ramp, crate, sensor };
}

describe('raycasts', () => {
  it('report the body, distance in metres, point and normal', () => {
    const { p, floor, step } = scene();
    const down = p.raycast([0, 5, 0], [0, -2, 0]); // not a unit direction: distance stays in metres
    expect(down?.body).toBe(floor);
    expect(down?.distance).toBeCloseTo(5, 5);
    expect(down?.point.toArray().map((n) => Number(n.toFixed(5)))).toEqual([0, 0, 0]);
    expect(down?.normal.toArray()).toEqual([0, 1, 0]);
    const side = p.raycast([0, 0.5, 0], [1, 0, 0]);
    expect([side?.body, side?.distance, side?.normal.x]).toEqual([step, 2.5, -1]);
    p.dispose();
  });

  it('honour groups, exclude, maxDistance, and pass through sensors', () => {
    const { p, floor, crate } = scene();
    expect(p.raycast([0, 5, 3], [0, -1, 0])?.body).toBe(crate);
    expect(p.raycast([0, 5, 3], [0, -1, 0], { groups: 'world' })?.body).toBe(floor);
    expect(p.raycast([0, 5, 3], [0, -1, 0], { exclude: crate })?.body).toBe(floor);
    expect(p.raycast([0, 5, 3], [0, -1, 0], { maxDistance: 2 })).toBeNull();
    expect(p.raycast([0, 10, 0], [0, -1, 0])?.distance).toBeCloseTo(10, 5); // the sensor at y 3 is not struck
    expect(p.raycast([0, 5, 0], [0, 1, 0])).toBeNull();
    expect(() => p.raycast([0, 5, 0], [0, 0, 0])).toThrow(/PHYSICS_BAD_ARGUMENT.*raycast\(direction\)/);
    expect(() => p.raycast([0, 5, 0], [0, -1, 0], { exclude: 99 })).toThrow(/exclude/);
    p.dispose();
  });
});

describe('shape casts and overlaps', () => {
  it('stop a cast shape where it first touches', () => {
    const { p, floor, step } = scene();
    const ball = p.shapeCast({ type: 'ball', radius: 0.5 }, [0, 5, 0], [0, -1, 0]);
    expect([ball?.body, Number(ball?.distance.toFixed(4)), ball?.normal.y]).toEqual([floor, 4.5, 1]);
    expect(ball?.point.y).toBeCloseTo(0, 4);
    const box = p.shapeCast({ type: 'box', size: [0.5, 0.5, 0.5] }, [0, 0.5, 0], [1, 0, 0], { margin: 0.1 });
    expect(box?.body).toBe(step);
    expect(box?.distance).toBeCloseTo(2.15, 3); // 2.5 − 0.25 − the 0.1 margin
    expect(p.shapeCast({ type: 'capsule', radius: 0.2, height: 1 }, [0, 5, 0], [0, 1, 0])).toBeNull();
    p.dispose();
  });

  it('list the bodies a shape overlaps, by id in order, each once', () => {
    const { p, floor, step, ramp, crate } = scene();
    expect(p.overlap({ type: 'box', size: [10, 1, 10] }, [0, 0, 0])).toEqual(
      [floor, step, ramp, crate].sort((a, b) => a - b),
    );
    expect(p.overlap({ type: 'ball', radius: 0.3 }, [0, 0.5, 3], { groups: ['prop'] })).toEqual([crate]);
    expect(p.overlap({ type: 'cylinder', radius: 0.3, height: 0.5 }, [0, 0.2, -3])).toEqual([floor]);
    expect(p.overlap({ type: 'ball', radius: 0.3 }, [0, 8, 0])).toEqual([]);
    p.dispose();
  });
});

describe('probe', () => {
  it('finds the ground’s height, normal and body under a point', () => {
    const { p, floor, step, ramp } = scene();
    expect(p.probe(0, 0)).toMatchObject({ y: 0, body: floor });
    expect(p.probe(3, 0)?.y).toBeCloseTo(1, 5);
    expect(p.probe(3, 0)?.body).toBe(step);
    const slope = p.probe(-4, 0);
    expect(slope?.body).toBe(ramp);
    expect(Math.acos(slope!.normal.y)).toBeCloseTo(Math.PI / 6, 4); // a 30° slope
    expect(p.probe(0, 3)?.y).toBeCloseTo(1, 5); // a crate is ground too
    expect(p.probe(0, 3, { groups: 'world' })?.y).toBeCloseTo(0, 5);
    expect(p.probe(3, 0, { from: 0.5 })?.y).toBe(0.5); // a ray that starts inside a solid strikes it at once
    expect(p.probe(0, 0, { from: 2, depth: 0.1 })?.y).toBeCloseTo(0, 5);
    expect(p.probe(0, 0, { from: -0.5, depth: 1 })?.y).toBe(-0.5); // inside the floor slab
    expect(() => p.probe(0, 0, { from: -0.5, depth: 0.2 })).toThrow(/PHYSICS_BAD_ARGUMENT.*from > −depth/);
    expect(p.probe(50, 50)).toBeNull();
    p.dispose();
  });
});

describe('what queries see and change', () => {
  it('see a body from the first step after it is added (Rapier updates its broad phase in the step)', () => {
    const p = createPhysics();
    p.addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [4, 1, 4] }, position: [0, -0.5, 0] }] });
    expect(p.probe(0, 0)).toBeNull();
    p.step(still());
    expect(p.probe(0, 0)?.y).toBeCloseTo(0, 5);
    p.dispose();
  });

  it('never change the hashed state', () => {
    const { p } = scene();
    const before = hashNumbers(p.state());
    p.raycast([0, 5, 0], [0, -1, 0]);
    p.shapeCast({ type: 'ball', radius: 0.5 }, [0, 5, 0], [0, -1, 0]);
    p.overlap({ type: 'box', size: [10, 1, 10] }, [0, 0, 0]);
    p.probe(1, 1);
    expect(hashNumbers(p.state())).toBe(before);
    p.dispose();
  });
});
