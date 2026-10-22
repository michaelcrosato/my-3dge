/**
 * @file Tests for use (engine/sim/interact.ts; WP 13.16) in a yard: a player on the shooter model before a door, a
 * switch and its lamp, a crate and a window's pane. The thing in reach and in view is the player's target, with its
 * prompt: what the crosshair's ray strikes when the step aims (beside a leaf, nothing), else the nearest in front, of
 * the things that can be used now (a sliding door hides no switch); using a door opens it away from the player and
 * closes it, a crate is carried and thrown along the view, through a pane it breaks, even held against it; a use takes
 * its press from the rides; a lamp takes no strike (melee's own: engine/sim/melee.test.ts); `freeze` stops no door; the
 * run gives the same hashes every time, and a capture mid-swing continues exactly.
 * @see engine/sim/interact.ts
 */
import { describe, expect, it } from 'vitest';
import type { Intents } from '../input/intents';
import { physicsOf } from '../physics/binding';
import { createCharacter } from '../physics/character';
import { spawnActor, type ActorComponents } from './actors';
import { addBreakables } from './breakables';
import { addDoor, DOOR_SWING, type DoorComponent } from './doors';
import { addInteraction, takesStrike, THROW_SPEED, type InteractorComponent } from './interact';
import { spawnProp, type ScenePropComponents } from './props';
import { defineScene } from './scene';
import { addLadder } from './rides';
import { createSession } from './session';
import { addSwitch } from './switches';
import type { World } from './world';

type Yard = ActorComponents & ScenePropComponents & { interactor: InteractorComponent; door: DoorComponent };

/** The yard: a floor, the player at (0, 0, 0) facing +Z, a door hung 1.2 m ahead across its way, a lamp and its switch to the west, a crate to the east and a pane past it; `more` adds to it, and `use` adds the system interact. */ // prettier-ignore
const makeYard = (name: string, more: (w: World) => void = () => {}, use = true) => defineScene(`interact-test:${name}`, {
  physics: true,
  setup(w) {
    physicsOf(w).addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [40, 1, 40] }, position: [0, -0.5, 0] }] }); // prettier-ignore
    spawnActor(w, { at: [0, 0, 0], character: createCharacter({ movement: 'movement:apex' }) }); // 1
    addDoor(w, { hinge: [-0.45, 0, 1.2] }); // 2: its leaf across x −0.45 to 0.45, its faces ±Z
    spawnProp(w, { prop: 'prop:lamp', at: [-2, 2.6, 0], yaw: 0 }, { group: 'room:yard' }); // 3
    addSwitch(w, { at: [-1.6, 1.2, 0.6], yaw: Math.PI / 2, group: 'room:yard' }); // 4
    spawnProp(w, { prop: 'prop:crate', at: [1.4, 0, 0.2], yaw: 0 }); // 5
    spawnProp(w, { prop: 'prop:pane', at: [3.4, 0.9, 0], yaw: Math.PI / 2 }); // 6: facing the player, west
    addBreakables(w);
    more(w);
    if (use) addInteraction(w);
  },
});
const yard = makeYard('yard');

const ofType = (session: ReturnType<typeof createSession>, id: number) => session.world.get(id) as unknown as Yard;
/** The intents of a step looking along `yaw`, `pitch` and aiming at `aim`, pressing `p`. */
const looking = (yaw: number, pitch = 0, aim?: [number, number, number], p: string[] = []): Intents => ({ look: [yaw, pitch], ...(aim ? { aim } : {}), ...(p.length ? { b: p } : {}) }); // prettier-ignore

describe('use', () => {
  it('targets the thing in reach and in view with its prompt: along the crosshair, else the nearest in front', () => {
    const session = createSession(yard, { seed: 1 });
    session.step({}); // the queries see the bodies from the first step on
    session.step({});
    expect([ofType(session, 1).interactor.target, ofType(session, 1).interactor.prompt]).toEqual([2, 'Open']); // the door ahead
    session.step(looking(-Math.PI / 2, 0, [-1.6, 1.25, 0.6])); // the crosshair on the switch, west
    expect([ofType(session, 1).interactor.target, ofType(session, 1).interactor.prompt]).toEqual([4, 'Lights off']);
    session.step(looking(Math.PI / 2, -0.5, [1.4, 0.375, 0.2])); // on the crate, east and down
    expect([ofType(session, 1).interactor.target, ofType(session, 1).interactor.prompt]).toEqual([5, 'Pick up']);
    session.step(looking(0, -0.2, [0.35, 1, 1.2])); // on the leaf, near its east edge
    expect(ofType(session, 1).interactor.target).toBe(2);
    session.step(looking(0, -0.2, [0.6, 1, 1.2])); // beside it: once the door's sphere, now nothing
    expect(ofType(session, 1).interactor.target).toBe(-1);
  });

  it('counts only what can be used now: a sliding door hides no switch; a lamp takes no strike', () => {
    const room = (name: string, more: (w: World) => void) => defineScene(`interact-test:${name}`, { physics: true, setup(w) { physicsOf(w).addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [20, 1, 20] }, position: [0, -0.5, 0] }] }); spawnActor(w, { at: [0, 0, 0], character: createCharacter({ movement: 'movement:apex' }) }); more(w); addInteraction(w); } }); // prettier-ignore
    const garage = createSession(room('garage', (w) => {
      const door = addDoor(w, { prop: 'prop:garageDoor', hinge: [-1.3, 0, 1.5], slide: [0, 2.2, 0] }); // 2: 1.5 m ahead
      addSwitch(w, { at: [1.5, 1.2, 1], yaw: -Math.PI / 2, door }); // 3: on the wall beside it
    }), { seed: 1 }); // prettier-ignore
    garage.step({});
    garage.step({});
    expect([ofType(garage, 1).interactor.target, ofType(garage, 1).interactor.prompt]).toEqual([3, 'Switch']);
    const hall = createSession(room('lamp', (w) => {
      spawnProp(w, { prop: 'prop:lamp', at: [0, 2.5, 0.8], yaw: 0 }); // 2: hanging nearer than the door
      addDoor(w, { hinge: [-0.45, 0, 1.3] }); // 3
    }), { seed: 1 }); // prettier-ignore
    hall.step({});
    expect([takesStrike(hall.world, 2), takesStrike(hall.world, 3)]).toEqual([false, true]);
  });

  it('opens a door away from the user and closes it (a body in its way: engine/sim/doors.test.ts)', () => {
    const session = createSession(yard, { seed: 1 });
    session.step({});
    session.step({ b: ['interact'] });
    session.step({});
    for (let i = 0; i < 60; i++) session.step({});
    const { door } = ofType(session, 2);
    expect([door.target, door.angle]).toEqual([-DOOR_SWING, -DOOR_SWING]); // the user on its −Z side: it swings to +Z
    expect(ofType(session, 2).sceneProp.z).toBeGreaterThan(1.5); // the leaf's middle now beyond the hinge
    session.step({ b: ['interact'] });
    for (let i = 0; i < 60; i++) session.step({});
    expect([ofType(session, 2).door.target, ofType(session, 2).door.angle]).toEqual([0, 0]);
  });

  it('carries a crate in front of the eye and throws it along the view, through a pane it breaks', () => {
    const session = createSession(yard, { seed: 1 });
    session.step({});
    const east = looking(Math.PI / 2, -0.5, [1.4, 0.375, 0.2]);
    session.step({ ...east, b: ['interact'] });
    for (let i = 0; i < 40; i++) session.step(looking(Math.PI / 2, 0.1));
    expect(ofType(session, 1).interactor.holding).toBe(5);
    const { x, y, z } = ofType(session, 5).sceneProp;
    expect(Math.hypot(x - 0.8, y - 1.6, z)).toBeLessThan(0.3); // lifted off the floor to 0.8 m before the eye
    const { world } = session;
    session.step({ ...looking(Math.PI / 2, 0.1), b: ['interact'] }); // at the pane
    expect(Math.hypot(...physicsOf(world).readBody(ofType(session, 5).sceneProp.body).velocity.toArray())).toBeCloseTo(THROW_SPEED, 0); // prettier-ignore
    for (let i = 0; i < 60; i++) session.step({});
    const events = world.events.trace().map((record) => `${record.type} ${(record.payload as { prop?: string }).prop ?? ''}`.trim()); // prettier-ignore
    expect([events.filter((e) => /^(pickup|throw|glass)/.test(e)), world.has(6)]).toEqual([['pickup', 'throw', 'glass prop:pane'], false]); // prettier-ignore
  });

  it('takes the press from the rides: the door before the player opens, the ladder between them is not taken', () => {
    const ladder = (w: World) => void addLadder(w, { foot: [0, 0, 0.55], top: 3, normal: [0, -1], width: 0.5 });
    const press = (use: boolean) => {
      const session = createSession(makeYard(`ladder-${use}`, ladder, use), { seed: 1 });
      session.step({});
      session.step({ b: ['interact'] });
      const { motion } = session.world.get(1) as unknown as { motion: { mode: string } };
      return [motion.mode, ofType(session, 2).door.target];
    };
    expect(press(true)).toEqual(['ground', -DOOR_SWING]); // the use took it
    expect(press(false)).toEqual(['ladder', 0]); // with nothing to use, the press takes the ladder
  });

  it('throws a crate held against a pane through it: the throw’s own step breaks it', () => {
    const near = makeYard(
      'pane-near',
      (w) => void spawnProp(w, { prop: 'prop:pane', at: [1.2, 0.9, 0], yaw: Math.PI / 2 }),
    ); // 7: 0.4 m past the hold // prettier-ignore
    const session = createSession(near, { seed: 1 });
    session.step({});
    session.step({ ...looking(Math.PI / 2, -0.5, [1.4, 0.375, 0.2]), b: ['interact'] });
    for (let i = 0; i < 30; i++) session.step(looking(Math.PI / 2, 0.1)); // pressed against it
    session.step({ ...looking(Math.PI / 2, 0.1), b: ['interact'] });
    session.step({});
    expect([session.world.has(7), session.world.events.trace().some((e) => e.type === 'glass')]).toEqual([false, true]); // prettier-ignore
  });

  it('keeps the doors swinging while the AI is frozen: no leaf spins past its stop', () => {
    const session = createSession(yard, { seed: 1 });
    session.step({});
    session.step({ b: ['interact'] });
    session.act('freeze', { on: true });
    for (let i = 0; i < 60; i++) session.step({});
    const { door, sceneProp } = ofType(session, 2);
    const { rotation } = physicsOf(session.world).readBody(sceneProp.body);
    const yaw = 2 * Math.atan2(rotation.y, rotation.w); // the leaf's turn about +Y
    expect([door.angle, yaw]).toEqual([-DOOR_SWING, expect.closeTo(-DOOR_SWING, 3)]);
  });

  it('gives the same hashes on every run, and continues exactly from a capture mid-swing', () => {
    const run = () => {
      const session = createSession(yard, { seed: 1 });
      const hashes: string[] = [];
      for (let i = 0; i < 80; i++)
        hashes.push((session.step(i === 1 ? { b: ['interact'] } : {}), session.world.hash()));
      return { session, hashes };
    };
    const [a, b] = [run(), run()];
    expect(b.hashes).toEqual(a.hashes);
    const half = createSession(yard, { seed: 1 });
    for (let i = 0; i < 20; i++) half.step(i === 1 ? { b: ['interact'] } : {});
    const fresh = createSession(yard, { seed: 1 });
    fresh.world.restore(half.world.capture());
    for (let i = 20; i < 80; i++) expect((fresh.step({}), fresh.world.hash())).toBe(a.hashes[i]);
  });
});
