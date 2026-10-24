/**
 * @file Tests for things in a scene (engine/sim/things.ts; WP 10.4) on a floor: a thing stands as its kind's prop,
 * slides along its track and back, its body carried by the physics step; a strike is a hit of a point (a blast's all
 * it has), calling its kind's hooks with the world and the entity and sending `thingHit` and `thingDown`; it stops
 * where it fell and takes no strike while down, then stands back up after its rise (`up`, `thingUp`) and slides on.
 * @see engine/sim/things.ts
 */
import { describe, expect, it } from 'vitest';
import { physicsOf } from '../physics/binding';
import { getProp, propCentre } from '../world/props/prop';
import { defineThing, type Thing, type ThingTouch } from '../world/things';
import { strikeEntity } from './interact';
import type { ScenePropComponents } from './props';
import { defineScene } from './scene';
import { createSession } from './session';
import { spawnThing, strikeThing } from './things';

type ThingEntity = ScenePropComponents & { thing: Thing };

/** What the hooks were told, in order: the hook, the outcome and the entity. */
const told: string[] = [];
const record = (hook: string) => (touch: ThingTouch) => void told.push(`${hook} ${touch.outcome} ${touch.entity}`);
defineThing('thing:test-mover', { prop: 'prop:crate', hp: 2, rise: 1, track: [3, 0, 0], speed: 1.5, hit: record('hit'), down: record('down'), up: record('up') }); // prettier-ignore

/** A floor and a mover standing on it at (0, 0, 2). */
function moverScene(name: string) {
  const scene = defineScene(`things-test:${name}`, {
    physics: true,
    setup(w) {
      physicsOf(w).addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [20, 1, 20] }, position: [0, -0.5, 0] }] }); // prettier-ignore
      spawnThing(w, 'thing:test-mover', [0, 0, 2]); // 1
    },
  });
  const session = createSession(scene, { seed: 1 });
  session.step({}); // the bodies in the queries
  return { session, world: session.world, mover: () => session.world.get(1) as unknown as ThingEntity };
}

const steps = (session: { step(intents: object): unknown }, n: number) => {
  for (let i = 0; i < n; i++) session.step({});
};

describe('things in a scene', () => {
  it('stand as their prop and slide along their track and back, the body carried by the physics step', () => {
    const { session, mover } = moverScene('slide');
    expect([mover().sceneProp.prop, mover().thing.thing, mover().thing.y0]).toEqual(['prop:crate', 'thing:test-mover', propCentre(getProp('prop:crate'))]); // prettier-ignore
    steps(session, 59); // a second in all: 1.5 m along
    expect(mover().sceneProp.x).toBeCloseTo(1.5, 3);
    steps(session, 60);
    expect(mover().sceneProp.x).toBeCloseTo(3, 3); // at the far end
    steps(session, 60);
    expect([mover().sceneProp.x, mover().thing.way]).toEqual([expect.closeTo(1.5, 3), -1]); // on its way back
    expect(mover().sceneProp.z).toBeCloseTo(2, 6);
  });

  it('takes a strike as a hit, calls its hooks, stops where it fell, and stands again after its rise', () => {
    told.length = 0;
    const { session, world, mover } = moverScene('hit');
    steps(session, 30);
    strikeEntity(world, 1, [0, 1, 0], true, 'shot');
    expect([mover().thing.hits, mover().thing.hp, told]).toEqual([1, 1, ['hit hit 1']]);
    strikeEntity(world, 1, [0, 1, 0]);
    expect([mover().thing.state, told]).toEqual(['down', ['hit hit 1', 'hit down 1', 'down down 1']]);
    const fell = mover().sceneProp.x;
    steps(session, 30);
    expect(mover().sceneProp.x).toBeCloseTo(fell, 6); // down: it stays
    expect(strikeThing(world, 1, 1, [0, 1, 0])).toBeNull(); // no hit while down
    steps(session, 30); // its rise, 1 s, is over
    expect([mover().thing.state, mover().thing.hp, told.at(-1)]).toEqual(['up', 2, 'up up 1']);
    steps(session, 10);
    expect(mover().sceneProp.x).toBeGreaterThan(fell + 0.1); // sliding on
    const events = world.events
      .trace()
      .map((e) => e.type)
      .filter((type) => type.startsWith('thing'));
    expect(events).toEqual(['thingHit', 'thingHit', 'thingDown', 'thingUp']);
  });

  it('takes all it has from a blast', () => {
    const { world, mover } = moverScene('blast');
    strikeEntity(world, 1, [0, 1, 0], true, 'blast');
    expect([mover().thing.state, mover().thing.hits, mover().thing.hp]).toEqual(['down', 1, 0]);
    expect(strikeThing(world, 99, 1, [0, 0, 0])).toBeNull(); // no thing there
  });
});
