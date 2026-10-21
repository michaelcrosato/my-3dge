/**
 * @file Tests for triangle-mesh colliders (engine/physics/trimesh.ts; WP 13.15): Rapier stands the triangles where the
 * vertices put them; a bad mesh is refused naming its field; a box sliding over a flat mesh's seams never bumps (the
 * internal edges fixed); a ball rolling down a mesh restores from a capture mid-run and goes on exactly as the
 * uninterrupted run.
 * @see engine/physics/trimesh.ts
 */
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../core/registry';
import { createSettings, defineSettings } from '../core/settings';
import { createWorld } from '../sim/world';
import { PHYSICS_SETTINGS } from './params';
import type { TrimeshShape } from './trimesh';
import { createPhysics } from './world';

const settings = createSettings().sim;

/** A grid of `cols` × `rows` 1 m squares from (0, 0), each corner at `height(col, row)`, two triangles a square. */
function grid(cols: number, rows: number, height: (c: number, r: number) => number): TrimeshShape {
  const vertices: number[] = [];
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) vertices.push(c, height(c, r), r);
  const at = (c: number, r: number) => r * (cols + 1) + c;
  const indices: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) indices.push(at(c, r), at(c, r + 1), at(c + 1, r), at(c + 1, r), at(c, r + 1), at(c + 1, r + 1)); // prettier-ignore
  }
  return { type: 'trimesh', vertices, indices };
}

describe('trimesh colliders', () => {
  it('stand each triangle where its vertices put it', () => {
    const physics = createPhysics();
    physics.addBody({ type: 'fixed', colliders: [{ shape: grid(4, 2, (c, r) => c * 0.5 + r * 0.25) }] });
    physics.step({ dt: 1 / 60, settings });
    expect(physics.probe(1.5, 0.5, { from: 10 })?.y).toBeCloseTo(0.875, 5);
    expect(physics.probe(3.25, 1.75, { from: 10 })?.y).toBeCloseTo(2.0625, 5);
    expect(physics.probe(5, 1, { from: 10 })).toBeNull(); // east of it
    physics.dispose();
  });

  it('refuses a bad mesh, naming its field', () => {
    const physics = createPhysics();
    const add = (shape: Partial<TrimeshShape>) =>
      physics.addBody({ type: 'fixed', colliders: [{ shape: { type: 'trimesh', vertices: [0, 0, 0, 1, 0, 0, 0, 0, 1], indices: [0, 2, 1], ...shape } as TrimeshShape }] }); // prettier-ignore
    expect(() => add({ vertices: [0, 0, 0, 1, 0, 0] })).toThrow(/PHYSICS_BAD_ARGUMENT.*shape\.vertices/);
    expect(() => add({ indices: [0, 2] })).toThrow(/PHYSICS_BAD_ARGUMENT.*shape\.indices/);
    expect(() => add({ indices: [0, 2, 3] })).toThrow(/PHYSICS_BAD_ARGUMENT.*shape\.indices\[2\].*0 to 2/);
    expect(() => add({ vertices: [0, 0, 0, 1, Number.NaN, 0, 0, 0, 1] })).toThrow(/shape\.vertices\[4\]/);
    expect(physics.count).toBe(0);
    physics.dispose();
  });

  it('lets a box slide over a flat mesh’s seams without a bump', () => {
    const physics = createPhysics();
    physics.addBody({ type: 'fixed', colliders: [{ shape: grid(20, 4, () => 0) }] });
    const box = physics.addBody({ position: [2, 0.25, 2.3], velocity: [6, 0, 0], colliders: [{ shape: { type: 'box', size: [0.5, 0.5, 0.5] }, friction: 0.1 }] }); // prettier-ignore
    let [low, high] = [Infinity, -Infinity];
    for (let i = 0; i < 90; i++) {
      physics.step({ dt: 1 / 60, settings });
      const y = physics.readBody(box).position.y;
      [low, high] = [Math.min(low, y), Math.max(high, y)];
    }
    expect(physics.readBody(box).position.x).toBeGreaterThan(5); // it slid over several seams
    expect(high - low).toBeLessThan(0.005);
    physics.dispose();
  });

  it('restores from a capture mid-run with a ball rolling down it, and goes on exactly', () => {
    const rolling = () => {
      const registry = createRegistry();
      defineSettings(PHYSICS_SETTINGS, registry);
      const physics = createPhysics();
      const w = createWorld({ seed: 1, registry, settings: createSettings({ registry }), physics });
      w.systems.add('physics', (world) => physics.step(world), { phase: 'physics' });
      w.run(() => {
        physics.addBody({ type: 'fixed', colliders: [{ shape: grid(8, 8, (c, r) => 4 - r * 0.5 + (c % 2) * 0.05) }] });
        physics.addBody({ position: [3.3, 5, 1], colliders: [{ shape: { type: 'ball', radius: 0.3 } }] });
      });
      return { w, physics };
    };
    const straight = rolling();
    const hashes: string[] = [];
    for (let i = 0; i < 120; i++) hashes.push((straight.w.step({}), straight.w.hash()));
    const interrupted = rolling();
    for (let i = 0; i < 60; i++) interrupted.w.step({});
    const fresh = rolling();
    fresh.w.restore(interrupted.w.capture());
    for (let i = 60; i < 120; i++) expect((fresh.w.step({}), fresh.w.hash())).toBe(hashes[i]);
    expect(fresh.physics.readBody(fresh.physics.bodies().at(-1)!).position.z).toBeGreaterThan(2); // it rolled south
    for (const made of [straight, interrupted, fresh]) made.physics.dispose();
  });
});
