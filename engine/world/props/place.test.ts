/**
 * @file Unit tests for placing props (engine/world/props/place.ts), in Node with Rapier: a level places props on the
 * spawn points and under the light spots their entries name, in the level's order; `propBody` gives the body
 * `physics.addBody` takes, the same as engine/physics/bodies.ts's `addBox` for the crate (its 24 kg and damping),
 * standing on its base and coming to rest there, turned by its yaw; a fixed prop never moves; a prop without a body
 * has none, and `propPose` puts it at its base.
 * @see engine/world/props/place.ts
 */
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../core/registry';
import { createSettings } from '../../core/settings';
import { addBox } from '../../physics/bodies';
import { createPhysics, type Physics } from '../../physics/world';
import { addLevelBodies } from '../../sim/levelBodies';
import { compileLevel } from '../level/compile';
import { defineGlyph } from '../level/glyph';
import { levelProps, propBody, propPose } from './place';
import { defineProp } from './prop';

/** A room with spawn points for a crate (`c`, a game's glyph), a barrel and two braziers. */
const ROOM = ['#######', '#c.t.b#', '#..c..#', '#t....#', '#######'].join('\n');

/** Steps `physics` `n` times at 60 Hz. */
function steps(physics: Physics, n: number): void {
  const settings = createSettings().sim;
  for (let i = 0; i < n; i++) physics.step({ dt: 1 / 60, settings });
}

describe('placing props', () => {
  it('places props on the spawn points and under the light spots their entries name, in the level’s order', () => {
    const registry = createRegistry();
    defineGlyph('glyph:crateSpot', { char: 'c', description: 'A crate.', mesh: 'floor', spawn: 'crate' }, registry);
    defineGlyph('glyph:barrelSpot', { char: 'b', description: 'A barrel.', mesh: 'floor', spawn: 'barrel' }, registry);
    defineProp('prop:keg', { parts: [{}], place: { spawn: 'barrel' } }, registry);
    const level = compileLevel(ROOM, { file: 'room.txt', registry });
    expect(levelProps(level, registry)).toEqual([
      { prop: 'prop:crate', at: [1.5, 0, 1.5], yaw: 0 },
      { prop: 'prop:barrel', at: [5.5, 0, 1.5], yaw: 0 },
      { prop: 'prop:keg', at: [5.5, 0, 1.5], yaw: 0 },
      { prop: 'prop:crate', at: [3.5, 0, 2.5], yaw: 0 },
      { prop: 'prop:brazier', at: [3.5, 0.75, 1.5], yaw: 0 },
      { prop: 'prop:brazier', at: [1.5, 0.75, 3.5], yaw: 0 },
    ]);
    // The brazier's fire stands on the stand's top, its light where the level's light spot is.
    expect(level.lights[0].position).toEqual([3.5, 1, 1.5]);
  });

  it('gives the crate the body addBox gives, standing on its base and resting there', () => {
    const physics = createPhysics();
    physics.addBody({
      type: 'fixed',
      colliders: [{ shape: { type: 'box', size: [20, 1, 20] }, position: [0, -0.5, 0] }],
    });
    const spec = propBody({ prop: 'prop:crate', at: [1, 0, 2], yaw: 0 })!;
    expect(spec).toMatchObject({ type: 'dynamic', position: [1, 0.375, 2], rotation: [0, 0, 0, 1] });
    const crate = physics.addBody(spec);
    const twin = addBox(physics, [0.75, 0.75, 0.75], { position: [4, 0.375, 2] });
    expect(physics.readBody(crate).mass).toBeCloseTo(physics.readBody(twin).mass, 9);
    expect(physics.readBody(crate).mass).toBeCloseTo(24.05, 2);
    steps(physics, 60);
    const rest = physics.readBody(crate);
    // At rest on the floor, within Rapier's contact allowance (a tenth of a millimetre).
    rest.position.toArray().forEach((v, k) => expect(v).toBeCloseTo([1, 0.375, 2][k], 3));
    expect(rest.position.y).toBeCloseTo(physics.readBody(twin).position.y, 9);
  });

  it('turns a body by its yaw, keeps a fixed prop where it stands, and has no body for the fire', () => {
    const physics = createPhysics();
    addLevelBodies(physics, compileLevel(['#####', '#...#', '#####'].join('\n'), { file: 'strip.txt' }));
    const yaw = Math.PI / 2;
    const barrel = propBody({ prop: 'prop:barrel', at: [1.5, 0, 1.5], yaw })!;
    expect(barrel.rotation.map((v) => +v.toFixed(6))).toEqual([0, 0.707107, 0, 0.707107]);
    expect(barrel.colliders[0].shape).toEqual({ type: 'cylinder', radius: 0.375, height: 0.875 });
    const pillar = physics.addBody(propBody({ prop: 'prop:pillar', at: [3.5, 0, 1.5], yaw: 0 })!);
    physics.addBody(barrel);
    steps(physics, 30);
    expect(physics.readBody(pillar)).toMatchObject({ type: 'fixed' });
    expect(physics.readBody(pillar).position.toArray()).toEqual([3.5, 1.5, 1.5]);
    expect(propBody({ prop: 'prop:brazier', at: [2.5, 0.75, 1.5], yaw: 0 })).toBeNull();
    expect(propPose({ prop: 'prop:brazier', at: [2.5, 0.75, 1.5], yaw: 0 })).toEqual({
      position: [2.5, 0.75, 1.5],
      rotation: [0, 0, 0, 1],
    });
    expect(propPose({ prop: 'prop:crate', at: [2.5, 0, 1.5], yaw: 0 }).position).toEqual([2.5, 0.375, 1.5]);
  });
});
