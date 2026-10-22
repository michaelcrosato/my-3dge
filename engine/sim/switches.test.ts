/**
 * @file Tests for switches (engine/sim/switches.ts; WP 13.16): a switch turns its group's lamps off and on, and its
 * prompt with them, leaving another room's; one made off starts its lamps off; a rule sets a group; two switches on one
 * group turn together; a switch for the garage door opens and closes it.
 * @see engine/sim/switches.ts
 */
import { describe, expect, it } from 'vitest';
import { registry } from '../core/registry';
import { physicsOf } from '../physics/binding';
import { addDoor, type DoorComponent } from './doors';
import type { UsableSpec } from './interact';
import { spawnProp, type ScenePropComponents } from './props';
import { defineScene } from './scene';
import { createSession } from './session';
import { addSwitch, flipSwitch, switchGroup } from './switches';

type Entity = ScenePropComponents & { door?: DoorComponent };

/** Two lamps in the kitchen (1, 2) and one in the hall (3), the kitchen's switch (4), made on or off. */
function house(on: boolean) {
  const scene = defineScene(`switches-test:house-${on}`, {
    physics: true,
    setup(w) {
      spawnProp(w, { prop: 'prop:lamp', at: [0, 2.6, 0], yaw: 0 }, { group: 'room:kitchen' });
      spawnProp(w, { prop: 'prop:lamp', at: [2, 2.6, 0], yaw: 0 }, { group: 'room:kitchen' });
      spawnProp(w, { prop: 'prop:lamp', at: [6, 2.6, 0], yaw: 0 }, { group: 'room:hall' });
      addSwitch(w, { at: [1, 1.2, -1], group: 'room:kitchen', on });
    },
  });
  const session = createSession(scene, { seed: 1 });
  session.step({});
  const lit = () => [1, 2, 3].map((id) => (session.world.get(id) as unknown as Entity).propLight!.on);
  return { world: session.world, lit };
}

const usable = () => registry.get('usable', 'switch') as unknown as UsableSpec;

describe('switches', () => {
  it('turns its group’s lamps off and on, and its prompt with them, leaving another room’s', () => {
    const { world, lit } = house(true);
    expect([lit(), usable().prompt(world, 4, -1)]).toEqual([[true, true, true], 'Lights off']);
    flipSwitch(world, 4);
    expect([lit(), usable().prompt(world, 4, -1)]).toEqual([[false, false, true], 'Lights on']);
    usable().use(world, 4, -1);
    expect(lit()).toEqual([true, true, true]);
    expect(world.events.trace().map((e) => e.payload)).toEqual([
      { id: 4, on: false, group: 'room:kitchen', door: -1 },
      { id: 4, on: true, group: 'room:kitchen', door: -1 },
    ]);
  });

  it('starts its lamps as it is made; a rule sets a group', () => {
    const { world, lit } = house(false);
    expect(lit()).toEqual([false, false, true]);
    switchGroup(world, 'room:hall', false); // the streetlights' rule at dawn, say
    expect(lit()).toEqual([false, false, false]);
  });

  it('turns a group’s other switches with it: two on one stair’s lights read the same', () => {
    const scene = defineScene('switches-test:stairs', {
      physics: true,
      setup(w) {
        spawnProp(w, { prop: 'prop:lamp', at: [0, 5, 0], yaw: 0 }, { group: 'room:stairs' }); // 1
        addSwitch(w, { at: [1, 1.2, 0], group: 'room:stairs' }); // 2: at the foot
        addSwitch(w, { at: [1, 4.2, 0], group: 'room:stairs' }); // 3: at the top
      },
    });
    const session = createSession(scene, { seed: 1 });
    session.step({});
    flipSwitch(session.world, 2);
    for (let i = 0; i < 3; i++) session.step({});
    const lit = (session.world.get(1) as unknown as Entity).propLight!.on;
    expect([lit, usable().prompt(session.world, 2, -1), usable().prompt(session.world, 3, -1)]).toEqual([false, 'Lights on', 'Lights on']); // prettier-ignore
  });

  it('opens and closes the garage door it is wired to', () => {
    const scene = defineScene('switches-test:garage', {
      physics: true,
      setup(w) {
        const door = addDoor(w, { prop: 'prop:garageDoor', hinge: [0, 0, 0], slide: [0, 2.2, 0] }); // 1
        addSwitch(w, { at: [3, 1.2, 0.2], door }); // 2
      },
    });
    const session = createSession(scene, { seed: 1 });
    session.step({});
    expect(usable().prompt(session.world, 2, -1)).toBe('Switch');
    flipSwitch(session.world, 2);
    for (let i = 0; i < 120; i++) session.step({});
    const garage = () => session.world.get(1) as unknown as Entity;
    expect([garage().door!.angle, physicsOf(session.world).readBody(garage().sceneProp.body).position.y]).toEqual([1, expect.closeTo(3.3, 3)]); // prettier-ignore
    flipSwitch(session.world, 2);
    for (let i = 0; i < 120; i++) session.step({});
    expect(garage().door!.angle).toBe(0);
  });
});
