/**
 * @file Tests for breakables (engine/sim/breakables.ts; WP 13.16) on a floor: a prop with health takes hit points and
 * breaks at 0, with the event its look names, its body gone and its pieces knocked away from the blow; a prop without
 * health takes none; a bolt's strike breaks a pane into glass, knocks a crate and breaks a door; a crate thrown at a
 * pane breaks it and flies on through, one only nudged at it stops against it; a level's window openings get a pane
 * every half metre, standing on the sill, turned with the wall.
 * @see engine/sim/breakables.ts
 */
import { describe, expect, it } from 'vitest';
import { physicsOf } from '../physics/binding';
import type { CompiledLevel } from '../world/level/types';
import { defineProp } from '../world/props/prop';
import { addBreakables, addLevelWindows, damageProp, strikeBody } from './breakables';
import { addDoor, type DoorComponent } from './doors';
import { spawnProp, type ScenePropComponents } from './props';
import { defineScene } from './scene';
import { createSession } from './session';
import type { World } from './world';

const box = (size: number) => ({ geometry: 'geometry:box', params: { width: size, height: size, depth: size }, material: 'material:crate' }); // prettier-ignore
defineProp('prop:breakables-test-urn', { parts: [box(0.4)], body: { type: 'dynamic', shape: 'box', size: [0.4, 0.4, 0.4] }, health: 2, breaks: { into: 'prop:breakables-test-chip', pieces: 3 } }); // prettier-ignore
defineProp('prop:breakables-test-chip', { parts: [box(0.1)], body: { type: 'dynamic', shape: 'box', size: [0.1, 0.1, 0.1] } }); // prettier-ignore

type Entity = ScenePropComponents & { door?: DoorComponent };

/** A floor, and what `setup` stands on it (in id order from 1). */
function yard(name: string, setup: (w: World) => void) {
  const scene = defineScene(`breakables-test:${name}`, {
    physics: true,
    setup(w) {
      physicsOf(w).addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [30, 1, 30] }, position: [0, -0.5, 0] }] }); // prettier-ignore
      setup(w);
    },
  });
  const session = createSession(scene, { seed: 1 });
  session.step({});
  const of = (id: number) => session.world.get(id) as unknown as Entity;
  return { session, world: session.world, physics: physicsOf(session.world), of };
}

describe('breakables', () => {
  it('takes hit points from a prop with health and breaks it at 0: its event, its body gone, its pieces knocked', () => {
    const { session, world, physics, of } = yard('urn', (w) => void spawnProp(w, { prop: 'prop:breakables-test-urn', at: [0, 0, 0], yaw: 0 })); // prettier-ignore
    const body = of(1).sceneProp.body;
    damageProp(world, 1, 1, [-2, 0.2, 0]);
    expect([of(1).propHealth!.hp, world.has(1)]).toEqual([1, true]);
    damageProp(world, 1, 1, [-2, 0.2, 0]);
    expect([world.has(1), physics.hasBody(body)]).toEqual([false, false]);
    const near = (v: number) => expect.closeTo(v, 3); // where it settled on the floor
    expect(world.events.trace().map((e) => [e.type, e.payload])).toEqual([['shatter', { id: 1, prop: 'prop:breakables-test-urn', position: [near(0), near(0.2), near(0)], ground: near(0) }]]); // prettier-ignore
    session.step({});
    const chips = [2, 3, 4].map((id) => physics.readBody(of(id).sceneProp.body).velocity);
    expect(chips.every((v) => v.x > 0)).toBe(true); // away from the blow, from the west
    const crate = spawnProp(world, { prop: 'prop:crate', at: [3, 0, 0], yaw: 0 });
    damageProp(world, crate, 5, [0, 0, 0]);
    expect(world.has(crate)).toBe(true); // no health: no damage
  });

  it('breaks a pane at a bolt’s strike into glass, knocks a crate and breaks a door', () => {
    const { session, world, physics, of } = yard('bolts', (w) => {
      spawnProp(w, { prop: 'prop:pane', at: [0, 0.9, 2], yaw: 0 }); // 1
      spawnProp(w, { prop: 'prop:crate', at: [3, 0, 0], yaw: 0 }); // 2
      addDoor(w, { hinge: [-3, 0, 0] }); // 3
    });
    strikeBody(world, of(1).sceneProp.body, [0, 1.5, 0]);
    expect([world.has(1), world.events.trace().at(-1)!.type]).toEqual([false, 'glass']);
    strikeBody(world, of(2).sceneProp.body, [2, 0.4, 0]);
    session.step({});
    expect(physics.readBody(of(2).sceneProp.body).velocity.x).toBeGreaterThan(1); // knocked east
    strikeBody(world, of(3).sceneProp.body, [-2.5, 1, -3]);
    expect(of(3).door!.broken).toBe(true); // a shot breaks a door at once
  });

  it('breaks a pane a thrown crate would strike, which flies on through; one nudged at it stops against it', () => {
    const throwAt = (name: string, speed: number) => {
      const run = yard(name, (w) => {
        spawnProp(w, { prop: 'prop:pane', at: [0, 0.5, 3], yaw: 0 }); // 1: across +Z, 0.5 to 1.7 m up
        spawnProp(w, { prop: 'prop:crate', at: [0, 0.6, 0], yaw: 0 }); // 2
        addBreakables(w);
      });
      run.physics.setBody(run.of(2).sceneProp.body, { velocity: [0, 1.5, speed] });
      for (let i = 0; i < 90; i++) run.session.step({});
      return [run.world.has(1), +(run.of(2).sceneProp.z > 3.4)];
    };
    expect(throwAt('thrown', 8)).toEqual([false, 1]); // broken, the crate beyond it
    expect(throwAt('nudged', 2.5)).toEqual([true, 0]);
  });

  it('stands a pane every half metre across a level’s window openings, on the sill, turned with the wall', () => {
    const window = (axis: 'x' | 'z', width: number, center: [number, number, number]) => ({ kind: 'window', axis, width, bottom: center[1], center }); // prettier-ignore
    const level = { openings: [window('x', 1, [2, 0.9, 3]), { kind: 'door', axis: 'x', width: 1, bottom: 0, center: [6, 0, 0] }, window('z', 1.5, [5, 1, 1])] } as unknown as CompiledLevel; // prettier-ignore
    const { world, of } = yard('windows', (w) => void addLevelWindows(w, level));
    const panes = [1, 2, 3, 4, 5].map((id) => of(id).sceneProp);
    expect(panes.map(({ prop, x, y, z }) => [prop, +x.toFixed(3), +y.toFixed(3), +z.toFixed(3)])).toEqual([
      ['prop:pane', 1.75, 1.5, 3],
      ['prop:pane', 2.25, 1.5, 3],
      ['prop:pane', 5, 1.6, 0.5],
      ['prop:pane', 5, 1.6, 1],
      ['prop:pane', 5, 1.6, 1.5],
    ]);
    expect(world.has(6)).toBe(false); // none in the door
    expect(Math.abs(panes[2].q[1])).toBeCloseTo(Math.SQRT1_2, 6); // a quarter turn: across the north-south wall
  });
});
