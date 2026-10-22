/**
 * @file Tests for doors (engine/sim/doors.ts; WP 13.16) on a floor: a door opens away from whoever uses it, from
 * either side, and closes; a locked one says so and stays shut; a crate in the leaf's way holds it until it goes; a
 * faced strike bursts it open three times as fast and unlocks it, an unfaced one does nothing, the second breaks it
 * into a falling slab with splinters, and a shot breaks it at once; a garage door slides up its way and down, never
 * struck open; a level's door openings each get a door, hung in their middle.
 * @see engine/sim/doors.ts
 */
import { describe, expect, it } from 'vitest';
import { registry } from '../core/registry';
import { physicsOf } from '../physics/binding';
import type { CompiledLevel } from '../world/level/types';
import { addDoor, addLevelDoors, DOOR_SWING, strikeDoor, useDoor, type DoorComponent, type DoorSpec } from './doors';
import type { UsableSpec } from './interact';
import { removeProp, spawnProp, type ScenePropComponents } from './props';
import { defineScene } from './scene';
import { createSession } from './session';

type Door = ScenePropComponents & { door: DoorComponent };

/** A floor and a door (`spec`: hung at the origin, its leaf along +X, by default), and maybe a crate at `crate`. */
function doorScene(name: string, spec: Partial<DoorSpec> = {}, crate?: [number, number, number]) {
  const scene = defineScene(`doors-test:${name}`, {
    physics: true,
    setup(w) {
      physicsOf(w).addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [20, 1, 20] }, position: [0, -0.5, 0] }] }); // prettier-ignore
      addDoor(w, { hinge: [0, 0, 0], ...spec }); // 1
      if (crate) spawnProp(w, { prop: 'prop:crate', at: crate, yaw: 0 }); // 2
    },
  });
  const session = createSession(scene, { seed: 1 });
  session.step({}); // the bodies in the queries
  return { session, world: session.world, door: () => session.world.get(1) as unknown as Door };
}

const steps = (session: { step(intents: object): unknown }, n: number) => {
  for (let i = 0; i < n; i++) session.step({});
};

describe('doors', () => {
  it('opens away from whoever uses it, from either side, and closes', () => {
    const { session, world, door } = doorScene('swing');
    expect(useDoor(world, 1, [0.45, 0, -1])).toBe(true); // from its −Z side
    steps(session, 60);
    expect([door().door.angle, door().sceneProp.z]).toEqual([-DOOR_SWING, expect.closeTo(0.449, 2)]); // the leaf now +Z
    useDoor(world, 1, [0.45, 0, -1]);
    steps(session, 60);
    expect([door().door.angle, door().sceneProp.z]).toEqual([0, expect.closeTo(0, 3)]);
    useDoor(world, 1, [0.45, 0, 1]); // from its +Z side
    steps(session, 60);
    expect([door().door.angle, door().sceneProp.z]).toEqual([DOOR_SWING, expect.closeTo(-0.449, 2)]);
    expect(world.events.trace().filter((e) => e.type === 'door').map((e) => (e.payload as { open: boolean }).open)).toEqual([true, false, true]); // prettier-ignore
  });

  it('says it is locked and stays shut while it is', () => {
    const { session, world, door } = doorScene('locked', { locked: true });
    const usable = registry.get('usable', 'door') as unknown as UsableSpec;
    expect([useDoor(world, 1, [0.45, 0, -1]), usable.prompt(world, 1, -1)]).toEqual([false, 'Locked']);
    steps(session, 30);
    expect(door().door.angle).toBe(0);
    expect(world.events.trace().map((e) => [e.type, e.payload])).toEqual([['door', { id: 1, open: false, locked: true }]]); // prettier-ignore
  });

  it('waits while a crate stands in its leaf’s way, and swings on once it is gone', () => {
    const { session, world, door } = doorScene('blocked', {}, [0.6, 0, 0.8]);
    const crate = world.get(2) as unknown as ScenePropComponents;
    useDoor(world, 1, [0.45, 0, -1]); // toward the crate, on its +Z side
    steps(session, 60);
    expect(door().door.angle).toBeGreaterThan(-DOOR_SWING / 2); // held short of open
    expect(Math.hypot(crate.sceneProp.x - 0.6, crate.sceneProp.z - 0.8)).toBeLessThan(0.1); // not shoved away
    removeProp(world, 2);
    steps(session, 60);
    expect(door().door.angle).toBe(-DOOR_SWING);
  });

  it('bursts open at a faced strike, unlocked, three times as fast; breaks at the second, and at a shot at once', () => {
    const { session, world, door } = doorScene('struck', { locked: true });
    strikeDoor(world, 1, [0.45, 1, -1], false); // the striker not facing it: nothing
    expect(door().door.struck).toBe(0);
    strikeDoor(world, 1, [0.45, 1, -1]);
    expect([door().door.struck, door().door.locked, door().door.target]).toEqual([1, false, -DOOR_SWING]);
    steps(session, 13); // 1.65 rad at 7.8 rad/s: 0.21 s
    expect(door().door.angle).toBe(-DOOR_SWING);
    strikeDoor(world, 1, [0.45, 1, -1]);
    const physics = physicsOf(world);
    expect([door().door.broken, physics.readBody(door().sceneProp.body).type]).toEqual([true, 'dynamic']);
    expect(world.events.trace().at(-1)).toMatchObject({ type: 'splinters', payload: { id: 1, prop: 'prop:door', ground: 0 } }); // prettier-ignore
    steps(session, 90);
    expect(door().sceneProp.y).toBeLessThan(0.6); // a slab fallen on the floor
    const shot = doorScene('shot');
    strikeDoor(shot.world, 1, [0.45, 1, -5], true, 'shot');
    expect(shot.door().door.broken).toBe(true);
  });

  it('slides a garage door up its way and down, never struck open', () => {
    const { session, world, door } = doorScene('garage', { prop: 'prop:garageDoor', hinge: [0, 0, 3], slide: [0, 2.2, 0] }); // prettier-ignore
    strikeDoor(world, 1, [1.3, 1, 2]);
    expect(door().door.struck).toBe(0);
    useDoor(world, 1, [1.3, 0, 2]);
    steps(session, 120); // its way at 0.6 a second
    expect([door().door.angle, door().sceneProp.y]).toEqual([1, expect.closeTo(3.3, 3)]);
    useDoor(world, 1, [1.3, 0, 2]);
    steps(session, 120);
    expect([door().door.angle, door().sceneProp.y]).toEqual([0, expect.closeTo(1.1, 3)]);
  });

  it('hangs a door in the middle of each door opening of a level, from its west or north end', () => {
    const opening = (axis: 'x' | 'z', center: [number, number, number]) => ({ kind: 'door', axis, width: 1, bottom: center[1], center }); // prettier-ignore
    const level = { openings: [opening('x', [2, 0, 3]), { kind: 'window', axis: 'x', width: 1, bottom: 0.9, center: [4, 0.9, 0] }, opening('z', [5, 0.5, 1])] } as unknown as CompiledLevel; // prettier-ignore
    const scene = defineScene('doors-test:level', {
      physics: true,
      setup: (w) => void addLevelDoors(w, level, { at: [10, 0, 20], turn: 0 }),
    });
    const session = createSession(scene, { seed: 1 });
    session.step({});
    const doors = [1, 2].map((id) => (session.world.get(id) as unknown as Door).door);
    expect(doors.map(({ hinge, yaw }) => [hinge.map((v) => +v.toFixed(6)), +yaw.toFixed(6)])).toEqual([
      [[11.55, 0, 23], 0], // 5 cm in from the west end: a 0.9 m leaf in a 1 m opening
      [[15, 0.5, 20.55], +(-Math.PI / 2).toFixed(6)],
    ]);
  });
});
