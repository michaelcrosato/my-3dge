/**
 * @file Tests for the read-only `QueryView` (engine/sim/queryView.ts): it offers the four queries and nothing else,
 * is frozen, leads to no physics world or Rapier object, answers like the world it views (restores included), hands
 * out copies, and changes nothing the hash covers.
 */
import { describe, expect, it } from 'vitest';
import { hashNumbers } from '../core/hash';
import { createSettings } from '../core/settings';
import { bindPhysics, createPhysics, type Physics } from '../physics/world';
import { queryView, queryViewOf, type QueryView } from './queryView';

/** A physics world with a floor and a falling crate, stepped 30 times. */
function world(): Physics {
  const physics = createPhysics();
  physics.addBody({
    type: 'fixed',
    colliders: [{ shape: { type: 'box', size: [10, 1, 10] }, position: [0, -0.5, 0] }],
  });
  physics.addBody({ position: [0, 3, 0], colliders: [{ shape: { type: 'box', size: [1, 1, 1] } }] });
  const settings = createSettings().sim;
  for (let i = 0; i < 30; i++) physics.step({ dt: 1 / 60, settings });
  return physics;
}

/** Every value reachable from `root` (own properties, prototypes, function properties), depth-first. */
function reachable(root: unknown, seen = new Set<unknown>()): Set<unknown> {
  if ((typeof root !== 'object' && typeof root !== 'function') || root === null || seen.has(root)) return seen;
  seen.add(root);
  reachable(Object.getPrototypeOf(root), seen);
  for (const key of Reflect.ownKeys(root)) {
    const descriptor = Object.getOwnPropertyDescriptor(root, key);
    if (descriptor && 'value' in descriptor) reachable(descriptor.value, seen);
  }
  return seen;
}

describe('the QueryView', () => {
  it('offers the four queries and nothing else, frozen', () => {
    const view = queryView(world());
    expect(Object.keys(view)).toEqual(['raycast', 'shapeCast', 'overlap', 'probe']);
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.getPrototypeOf(view)).toBe(Object.prototype);
    expect(() => Object.assign(view, { addBody: () => 0 })).toThrow(TypeError);
    // @ts-expect-error: the type offers no way to change the world
    expect(view.addBody).toBeUndefined();
    const mutators: (keyof Physics)[] = ['addBody', 'removeBody', 'setBody', 'applyImpulse', 'step', 'restore'];
    for (const name of mutators) expect(name in view, name).toBe(false);
  });

  it('leads to no physics world or Rapier object', () => {
    const physics = world();
    const view = queryView(physics);
    const seen = reachable(view);
    expect(seen.has(physics)).toBe(false);
    for (const value of seen) {
      const name = (value as { constructor?: { name?: string } }).constructor?.name ?? '';
      expect(['World', 'RigidBody', 'Collider'].includes(name), name).toBe(false);
    }
  });

  it('answers like the world it views, restores included, with copies', () => {
    const physics = world();
    const view: QueryView = queryView(physics);
    const before = view.raycast([0, 5, 0], [0, -1, 0]);
    expect(before).toEqual(physics.raycast([0, 5, 0], [0, -1, 0]));
    before!.point.set(9, 9, 9);
    expect(view.raycast([0, 5, 0], [0, -1, 0])?.point.y).not.toBe(9);
    const capture = physics.capture();
    const settings = createSettings().sim;
    for (let i = 0; i < 120; i++) physics.step({ dt: 1 / 60, settings });
    expect(view.probe(0, 0)?.y).toBeCloseTo(1, 2); // the crate has landed
    physics.restore(capture);
    expect(view.raycast([0, 5, 0], [0, -1, 0])?.distance).toBe(before?.distance);
  });

  it('changes nothing the hash covers', () => {
    const physics = world();
    const view = queryView(physics);
    const state = hashNumbers(physics.state());
    view.raycast([0, 5, 0], [0, -1, 0]);
    view.shapeCast({ type: 'ball', radius: 0.2 }, [0, 5, 0], [0, -1, 0]);
    view.overlap({ type: 'box', size: [10, 10, 10] }, [0, 0, 0]);
    view.probe(0, 0);
    expect(hashNumbers(physics.state())).toBe(state);
  });

  it('is found from a sim world bound to its physics', () => {
    const owner = {};
    expect(() => queryViewOf(owner)).toThrow(/PHYSICS_NONE/);
    bindPhysics(owner, world());
    expect(Object.keys(queryViewOf(owner))).toEqual(['raycast', 'shapeCast', 'overlap', 'probe']);
  });
});
