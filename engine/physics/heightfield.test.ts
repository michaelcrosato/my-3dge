/**
 * @file Tests for heightfield colliders (engine/physics/heightfield.ts): Rapier stands the heights where the shape says
 * (row by row from the north, west to east, centred on the collider), each cell split from its north-east corner to
 * its south-west one; a bad shape is refused naming its field; a box sliding over a flat field's seams never bumps
 * (the internal edges fixed); a ball rolling down a field restores from a capture mid-run and goes on exactly as the
 * uninterrupted run.
 */
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../core/registry';
import { createSettings, defineSettings } from '../core/settings';
import { createWorld, type World } from '../sim/world';
import type { HeightfieldShape } from './heightfield';
import { PHYSICS_SETTINGS } from './params';
import { createPhysics, type Physics } from './world';

const settings = createSettings().sim;

/** A physics world holding one fixed heightfield at `position`, stepped once so queries see it. */
function field(shape: Omit<HeightfieldShape, 'type'>, position: [number, number, number] = [0, 0, 0]): Physics {
  const physics = createPhysics();
  physics.addBody({ type: 'fixed', colliders: [{ shape: { type: 'heightfield', ...shape }, position }] });
  physics.step({ dt: 1 / 60, settings });
  return physics;
}

describe('heightfield colliders', () => {
  it('stand each corner’s height where the shape puts it, row by row from the north, centred on the collider', () => {
    // 3 cells east by 2 south, 6 × 4 m, its corner (col, row) 10·row + col high, its middle at (5, 0, 7).
    const heights = [0, 1, 2, 3, 10, 11, 12, 13, 20, 21, 22, 23].map((h) => h / 10);
    const physics = field({ cols: 3, rows: 2, size: [6, 4], heights }, [5, 0, 7]);
    // Just south-east of each corner (a ray down a cell's edge may slip between its triangles).
    const at = (col: number, row: number) => physics.probe(2 + col * 2 + 1e-3, 5 + row * 2 + 1e-3, { from: 10 })?.y;
    expect([at(0, 0), at(1, 1), at(2, 1), at(1, 0)].map((y) => +y!.toFixed(2))).toEqual([0, 1.1, 1.2, 0.1]);
    expect(physics.probe(7.999, 8.999, { from: 10 })?.y).toBeCloseTo(2.3, 2);
    expect(physics.probe(1.9, 6, { from: 10 })).toBeNull(); // west of it
    physics.dispose();
  });

  it('splits each cell from its north-east corner to its south-west one', () => {
    // One 2 m cell, 0 at three corners and 4 at its south-east one.
    const physics = field({ cols: 1, rows: 1, size: [2, 2], heights: [0, 0, 0, 4] });
    expect(physics.probe(-0.5, -0.5)?.y).toBeCloseTo(0, 5); // the north-west triangle
    expect(physics.probe(0.5, 0.5)?.y).toBeCloseTo(2, 5); // the south-east one: 4 · (u + v − 1)
    expect(physics.probe(0.8, 0.2)?.y).toBeCloseTo(2, 5);
    expect(physics.probe(0.9, 0.9)?.y).toBeCloseTo(3.6, 3); // float32 heights
    physics.dispose();
  });

  it('refuses a bad shape, naming its field', () => {
    const physics = createPhysics();
    const add = (shape: Partial<HeightfieldShape>) =>
      physics.addBody({ type: 'fixed', colliders: [{ shape: { type: 'heightfield', cols: 1, rows: 1, size: [1, 1], heights: [0, 0, 0, 0], ...shape } as HeightfieldShape }] }); // prettier-ignore
    expect(() => add({ cols: 0 })).toThrow(/PHYSICS_BAD_ARGUMENT.*colliders\[0\] \}\)\.shape\.cols/);
    expect(() => add({ rows: 1.5 })).toThrow(/PHYSICS_BAD_ARGUMENT.*shape\.rows/);
    expect(() => add({ size: [1, 0] })).toThrow(/PHYSICS_BAD_ARGUMENT.*shape\.size/);
    expect(() => add({ heights: [0, 0, 0] })).toThrow(/PHYSICS_BAD_ARGUMENT.*shape\.heights.*4 heights/);
    expect(() => add({ heights: [0, 0, Number.NaN, 0] })).toThrow(/PHYSICS_BAD_ARGUMENT.*shape\.heights\[2\]/);
    expect(physics.count).toBe(0);
    physics.dispose();
  });

  it('lets a box slide over a flat field’s seams without a bump', () => {
    const physics = field({ cols: 20, rows: 4, size: [20, 4], heights: new Array(21 * 5).fill(0) });
    const box = physics.addBody({ position: [-8, 0.25, 0.3], velocity: [6, 0, 0], colliders: [{ shape: { type: 'box', size: [0.5, 0.5, 0.5] }, friction: 0.1 }] }); // prettier-ignore
    let [low, high] = [Infinity, -Infinity];
    for (let i = 0; i < 90; i++) {
      physics.step({ dt: 1 / 60, settings });
      const y = physics.readBody(box).position.y;
      [low, high] = [Math.min(low, y), Math.max(high, y)];
    }
    expect(physics.readBody(box).position.x).toBeGreaterThan(-5); // it slid over several seams
    expect(high - low).toBeLessThan(0.005);
    physics.dispose();
  });
});

describe('a heightfield in the sim’s state', () => {
  /** A sim world with a slope (rising 1 m a metre west to east... down to the south) and a ball rolling down it. */
  function rolling(): { w: World; physics: Physics } {
    const registry = createRegistry();
    defineSettings(PHYSICS_SETTINGS, registry);
    const physics = createPhysics();
    const w = createWorld({ seed: 1, registry, settings: createSettings({ registry }), physics });
    w.systems.add('physics', (world) => physics.step(world), { phase: 'physics' });
    const heights = Array.from({ length: 9 * 9 }, (_, i) => 4 - Math.floor(i / 9) * 0.5 + ((i % 9) % 2) * 0.05);
    w.run(() => {
      physics.addBody({ type: 'fixed', colliders: [{ shape: { type: 'heightfield', cols: 8, rows: 8, size: [8, 8], heights } }] }); // prettier-ignore
      physics.addBody({ position: [0.3, 5, -3], colliders: [{ shape: { type: 'ball', radius: 0.3 } }] });
    });
    return { w, physics };
  }

  it('restores from a capture mid-run and goes on exactly as the uninterrupted run', () => {
    const straight = rolling();
    const hashes: string[] = [];
    for (let i = 0; i < 120; i++) {
      straight.w.step({});
      hashes.push(straight.w.hash());
    }
    const interrupted = rolling();
    for (let i = 0; i < 60; i++) interrupted.w.step({});
    const capture = interrupted.w.capture();
    const fresh = rolling();
    fresh.w.restore(capture);
    for (let i = 60; i < 120; i++) {
      fresh.w.step({});
      expect(fresh.w.hash()).toBe(hashes[i]);
    }
    const ball = fresh.physics.bodies().at(-1)!;
    expect(fresh.physics.readBody(ball).position.z).toBeGreaterThan(-2); // it rolled down the slope, south
    for (const made of [straight, interrupted, fresh]) made.physics.dispose();
  });
});
