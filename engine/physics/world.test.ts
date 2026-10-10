/**
 * @file Tests for the physics world (engine/physics/world.ts) and its parameters (engine/physics/params.ts): bodies
 * fall under the `physics.gravity` setting and rest on a floor, ids come from handles in insertion order, a removed
 * slot comes back under a new id, impulses and changes act as the units say, the pinned integration parameters are the
 * world's, collision groups decide who touches, bad arguments are named, and `physicsOf` finds a bound world.
 */
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../core/registry';
import { createSettings, defineSettings } from '../core/settings';
import { createWorld } from '../sim/world';
import { restorePhysics } from './capture';
import { INTEGRATION_PARAMETERS, PHYSICS_SETTINGS } from './params';
import { attachPhysics, bindPhysics, createPhysics, physicsOf, scenePhysics, type Physics } from './world';

/** A sim stand-in for `step`: 60 Hz under `gravity`. */
function sim(gravity = 9.81) {
  const registry = createRegistry();
  defineSettings(PHYSICS_SETTINGS, registry);
  const settings = createSettings({ registry });
  settings.set('physics.gravity', gravity);
  return { dt: 1 / 60, settings: settings.sim };
}

/** A physics world with a 20 × 20 m floor whose top is y 0. */
function withFloor(): Physics {
  const p = createPhysics();
  p.addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [20, 1, 20] }, position: [0, -0.5, 0] }] });
  return p;
}

/** A 1 m crate at `y`. */
const crate = (y: number, x = 0) => ({
  position: [x, y, 0] as const,
  colliders: [{ shape: { type: 'box' as const, size: [1, 1, 1] as const } }],
});

describe('the physics world', () => {
  it('drops a crate under the gravity setting and rests it on the floor', () => {
    const p = withFloor();
    const id = p.addBody(crate(3));
    const s = sim();
    p.step(s);
    expect(p.readBody(id).velocity.y).toBeCloseTo(-9.81 / 60, 5);
    for (let i = 0; i < 240; i++) p.step(s);
    const rest = p.readBody(id);
    expect(rest.position.y).toBeCloseTo(0.5, 2);
    expect(rest.velocity.length()).toBeLessThan(1e-3);
    expect(rest.mass).toBeCloseTo(1000, 3); // 1 m³ at water's density
    p.dispose();
  });

  it('reads physics.gravity before every step, so a scene or x set changes it', () => {
    const p = createPhysics();
    const id = p.addBody(crate(10));
    p.step(sim(30));
    expect(p.readBody(id).velocity.y).toBeCloseTo(-0.5, 5);
    p.step(sim(0));
    expect(p.readBody(id).velocity.y).toBeCloseTo(-0.5, 5);
    expect(PHYSICS_SETTINGS['physics.gravity'].default).toBe(9.81);
    expect(() => p.step({ dt: 1 / 60, settings: createSettings({ registry: createRegistry() }).sim })).toThrow(
      /CORE_UNKNOWN_SETTING.*physics\.gravity/,
    );
    p.dispose();
  });

  it('pins the integration parameters in the world (and so in its snapshots)', () => {
    const p = createPhysics();
    const world = restorePhysics(p.capture());
    const params = world.integrationParameters;
    const table = INTEGRATION_PARAMETERS;
    expect([
      params.numSolverIterations,
      params.numInternalPgsIterations,
      params.maxCcdSubsteps,
      params.lengthUnit,
    ]).toEqual([table.numSolverIterations, table.numInternalPgsIterations, table.maxCcdSubsteps, table.lengthUnit]);
    expect(params.normalizedAllowedLinearError).toBeCloseTo(table.normalizedAllowedLinearError, 6);
    expect(params.normalizedPredictionDistance).toBeCloseTo(table.normalizedPredictionDistance, 6);
    world.free();
    p.dispose();
  });

  it('names bodies by whole-number ids in insertion order, and a reused slot by a new id', () => {
    const p = createPhysics();
    const ids = [0, 1, 2].map((i) => p.addBody(crate(i * 2)));
    expect(ids).toEqual([0, 1, 2]);
    p.removeBody(1);
    expect([p.hasBody(1), p.count, p.bodies()]).toEqual([false, 2, [0, 2]]);
    expect(() => p.readBody(1)).toThrow(/PHYSICS_NO_BODY.*1: it was removed/);
    expect(() => p.readBody(-1)).toThrow(/PHYSICS_NO_BODY.*whole numbers/);
    const again = p.addBody(crate(9));
    expect(again).toBe(1 + 4294967296); // slot 1, generation 1
    expect(p.bodies()).toEqual([0, 2, again]);
    p.dispose();
  });

  it('hands out copies, and changes bodies by impulses (N·s) and setBody', () => {
    const p = createPhysics();
    const id = p.addBody({ ...crate(0), colliders: [{ shape: { type: 'box', size: [0.1, 0.1, 0.1] } }] }); // 1 kg
    const state = p.readBody(id);
    state.position.set(5, 5, 5);
    expect(p.readBody(id).position.toArray()).toEqual([0, 0, 0]);
    p.applyImpulse(id, [2, 0, 0]);
    expect(p.readBody(id).velocity.x).toBeCloseTo(2, 4);
    p.setBody(id, {
      position: { x: 1, y: 2, z: 3 },
      velocity: [0, 0, 0],
      angularVelocity: [0, 1, 0],
      rotation: [0, 0, 0, 2],
    });
    const set = p.readBody(id);
    expect([set.position.toArray(), set.velocity.toArray(), set.angularVelocity.y, set.rotation.w]).toEqual([
      [1, 2, 3],
      [0, 0, 0],
      1,
      1,
    ]);
    expect([set.type, set.sleeping]).toEqual(['dynamic', false]);
    p.dispose();
  });

  it('lets the collision groups decide: a flyer falls through a crowd body onto the world', () => {
    const p = withFloor();
    p.addBody({
      type: 'fixed',
      group: 'crowd',
      position: [0, 2, 0],
      colliders: [{ shape: { type: 'box', size: [4, 0.2, 4] } }],
    });
    const prop = p.addBody({ ...crate(4), group: 'prop' });
    const flyer = p.addBody({ ...crate(4, 0.0), group: 'flyer', position: [3, 4, 3] });
    p.addBody({
      type: 'fixed',
      group: 'crowd',
      position: [3, 2, 3],
      colliders: [{ shape: { type: 'box', size: [2, 0.2, 2] } }],
    });
    const s = sim();
    for (let i = 0; i < 180; i++) p.step(s);
    expect(p.readBody(prop).position.y).toBeCloseTo(2.6, 1); // on the crowd slab
    expect(p.readBody(flyer).position.y).toBeCloseTo(0.5, 1); // through it, on the floor
    p.dispose();
  });

  it('names a bad argument', () => {
    const p = createPhysics();
    expect(() => p.addBody({ type: 'static' as 'fixed' })).toThrow(/PHYSICS_BAD_ARGUMENT.*addBody\(\{ type \}\)/);
    expect(() => p.addBody({ colliders: [{ shape: { type: 'box', size: [1, 0, 1] } }] })).toThrow(/size\.y.*above 0/);
    expect(() => p.addBody({ colliders: [{ shape: { type: 'cone' } as never }] })).toThrow(/shape\.type/);
    expect(() => p.addBody({ position: [0, Number.NaN, 0] })).toThrow(/position/);
    expect(() => p.addBody({ group: 'mob' as 'crowd' })).toThrow(/PHYSICS_UNKNOWN_GROUP/);
    expect(() => p.addBody({ colliders: [{ shape: { type: 'ball', radius: 1 }, restitution: 2 }] })).toThrow(
      /restitution/,
    );
    expect(p.count).toBe(0); // nothing half-made
    expect(() => p.applyImpulse(0, [1, 0, 0])).toThrow(/PHYSICS_NO_BODY/);
    p.dispose();
  });

  it('makes a scene its physics world, declaring the gravity setting, and steps it as the system physics', () => {
    const registry = createRegistry();
    expect(scenePhysics(false, registry)).toBeUndefined();
    const physics = scenePhysics(true, registry)!;
    expect(registry.has('setting', 'physics.gravity')).toBe(true);
    expect(scenePhysics(true, registry)).not.toBe(physics); // a new world each time, the setting declared once
    const w = createWorld({ registry, physics });
    const id = physics.addBody(crate(5));
    attachPhysics(w, physics);
    expect([w.systems.list().map((system) => `${system.phase}:${system.name}`), physicsOf(w)]).toEqual([
      ['physics:physics'],
      physics,
    ]);
    w.step({});
    expect(physics.readBody(id).velocity.y).toBeCloseTo(-9.81 / 60, 5); // the system stepped it once
    physics.dispose();
  });

  it('finds the physics bound to a sim world, and names the fix when there is none', () => {
    const owner = {};
    const p = createPhysics();
    expect(() => physicsOf(owner)).toThrow(/PHYSICS_NONE.*physics: true/);
    bindPhysics(owner, p);
    expect(physicsOf(owner)).toBe(p);
    p.dispose();
  });
});
