/**
 * @file Tests for melee (engine/sim/melee.ts; WP 13.19) on a floor, the player at the origin facing +Z on the shooter
 * model: a punch lunges at what is in reach and lands 0.35 s after the press, once, with its hit-stop, the body told
 * the move; the reach is 1.52 m in a 30° cone and no wall lets it through; a door takes the door kick, its hit 0.83 s
 * in, bursting it open and then breaking it, and only when faced as the swing began; a person loses 30 points; the air
 * gives the kick, a slide the uppercut; the hands come back 0.75 s after a swing began; the same hashes every run, and
 * a capture mid-swing continues exactly.
 * @see engine/sim/melee.ts
 */
import { describe, expect, it } from 'vitest';
import type { Intents } from '../input/intents';
import { physicsOf } from '../physics/binding';
import { createCharacter } from '../physics/character';
import { getProp } from '../world/props/prop';
import { defineThing, type Thing } from '../world/things';
import { spawnActor, type ActorComponents } from './actors';
import { HEALTH_FIELDS, takeHitStop, type Health } from './damage';
import { addDoor, DOOR_SWING, type DoorComponent } from './doors';
import { addInteraction } from './interact';
import { addMelee, MELEE, meleeTargets, type MeleeState } from './melee';
import { defineScene } from './scene';
import type { ScenePropComponents } from './props';
import { createSession } from './session';
import { defineComponent } from './state';
import { spawnThing } from './things';
import type { World } from './world';

defineComponent('health', { description: 'Hit points (the test’s people).', fields: HEALTH_FIELDS });
defineThing('thing:melee-test', { prop: 'prop:crate', hp: 9, rise: 1 });

type Ring = ActorComponents &
  ScenePropComponents & {
    melee: MeleeState;
    door: DoorComponent;
    thing: Thing;
    health: Health;
    animator: { states: { body?: { move: string; phase: string } }; state: { arm: { kick: number; weight: number } } };
  };

/** A floor, the player at the origin facing +Z (entity 1, the adult's body), what `more` adds, use and melee. */
const makeRing = (name: string, more: (w: World) => void = () => {}) =>
  defineScene(`melee-test:${name}`, {
    physics: true,
    setup(w) {
      physicsOf(w).addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [40, 1, 40] }, position: [0, -0.5, 0] }] }); // prettier-ignore
      spawnActor(w, { at: [0, 0, 0], character: createCharacter({ movement: 'movement:apex' }), anim: { build: 'build:adult', weapon: 'none' } }); // prettier-ignore
      more(w);
      addInteraction(w);
      addMelee(w);
    },
  });

/** A crate-sized thing whose near face is `face` m ahead of the player, `off` rad to his right of +Z. */
const thingAhead =
  (face: number, off = 0) =>
  (w: World) => {
    const half = getProp('prop:crate').body.size[2] / 2;
    const d = face + half;
    spawnThing(w, 'thing:melee-test', [-Math.sin(off) * d, 0, Math.cos(off) * d], -off);
  };

const crateRing = makeRing('crate', thingAhead(0.95));
const doorRing = makeRing('door', (w) => void addDoor(w, { hinge: [-0.45, 0, 1.2] })); // 2: the leaf across x ±0.45
const of = (session: ReturnType<typeof createSession>, id: number) => session.world.get(id) as unknown as Ring;
const strikes = (w: World) =>
  w.events
    .trace()
    .filter((e) => e.type === 'strike')
    .map((e) => e.payload);
const steps = (session: ReturnType<typeof createSession>, n: number, intents: Intents = {}) => {
  for (let i = 0; i < n; i++) session.step(intents);
};

/** A session of `scene` stood still 10 steps, its player on his feet. */
const settled = (scene: Parameters<typeof createSession>[0]) => {
  const session = createSession(scene, { seed: 1 });
  steps(session, 10);
  return session;
};

describe('melee', () => {
  it('punches what is in reach, lunging at it so the hit lands 0.35 s after the press, once, with its hit-stop', () => {
    const session = settled(crateRing);
    session.step({ b: ['melee'] }); // the swing begins
    const { melee } = of(session, 1);
    expect([melee.move, melee.target, melee.lands - melee.began]).toEqual(['move:cross', 2, 20]);
    expect(of(session, 1).animator.states.body).toMatchObject({ move: 'move:cross', phase: 'wind' });
    steps(session, 19);
    expect([strikes(session.world), takeHitStop(session.world)]).toEqual([[], 0]);
    session.step({}); // 21 steps from the press: 0.35 s
    expect(strikes(session.world)).toEqual([{ id: 1, target: 2, move: 'move:cross' }]);
    expect([of(session, 2).thing.hits, of(session, 1).melee.hitAt - melee.began, takeHitStop(session.world)]).toEqual([1, 20, MELEE.stop]); // prettier-ignore
    const near = of(session, 2).thing.z0 - getProp('prop:crate').body.size[2] / 2 - of(session, 1).actor.z;
    expect(near).toBeCloseTo(of(session, 1).melee.close, 1); // lunged in to the punch's own reach
    expect(near).toBeLessThan(0.95 - 0.1);
    steps(session, 40);
    expect([strikes(session.world).length, of(session, 2).thing.hits, of(session, 1).animator.states.body]).toEqual([1, 1, undefined]); // prettier-ignore
  });

  it('reaches 1.52 m in a 30° cone, and never through a wall', () => {
    let n = 0;
    const reach = (more: (w: World) => void) => meleeTargets(settled(makeRing(`reach-${n++}`, more)).world, 1).map((r) => r.id); // prettier-ignore
    expect(reach(thingAhead(1.5))).toEqual([2]);
    expect(reach(thingAhead(1.56))).toEqual([]);
    expect(reach(thingAhead(1, 0.2))).toEqual([2]); // its middle 11° off: inside the cone's 15°
    expect(reach(thingAhead(1, 0.75))).toEqual([]); // 43° off: its near edge 22° off
    const walled = (w: World) => {
      physicsOf(w).addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [3, 3, 0.1] }, position: [0, 1.5, 0.6] }] }); // prettier-ignore
      thingAhead(1)(w);
    };
    expect(reach(walled)).toEqual([]);
  });

  it('kicks a door open at the first blow and off its hinges at the second, each hit 0.83 s after its press', () => {
    const session = settled(doorRing);
    session.step({ b: ['melee'] });
    const began = of(session, 1).melee.began;
    expect([of(session, 1).melee.move, of(session, 1).melee.lands - began]).toEqual(['move:breach', 49]);
    steps(session, 48);
    expect(of(session, 2).door.struck).toBe(0);
    steps(session, 1); // 50 steps from the press: 0.83 s, Kick_Breach's strike
    expect([of(session, 2).door.struck, of(session, 2).door.target]).toEqual([1, -DOOR_SWING]);
    expect(of(session, 1).animator.state.arm).toMatchObject({ kick: 1 }); // the leg first person shows
    steps(session, 60); // the kick over, the leaf burst open
    const look = { look: [-0.42, 0] as [number, number] }; // toward the leaf, now along +Z from its hinge
    steps(session, 10, look);
    session.step({ ...look, b: ['melee'] });
    steps(session, 60, look);
    expect([of(session, 2).door.broken, strikes(session.world).length]).toEqual([true, 2]);
    expect(physicsOf(session.world).readBody(of(session, 2).sceneProp.body).type).toBe('dynamic');
  });

  it('counts a door only when it was faced as the swing began', () => {
    const session = settled(doorRing);
    session.step({ look: [Math.PI / 2, 0], b: ['melee'] }); // facing east: nothing in reach
    expect([of(session, 1).melee.move, of(session, 1).melee.target]).toEqual(['move:cross', -1]);
    steps(session, 25, { look: [0, 0] }); // turned to the door before the punch lands
    expect(strikes(session.world)).toEqual([{ id: 1, target: 2, move: 'move:cross' }]);
    expect([of(session, 2).door.struck, of(session, 2).door.target]).toEqual([0, 0]); // not faced: it holds
  });

  it('takes 30 points from a person', () => {
    const health: Health = { hp: 100, hitAt: -1, hitBy: -1 };
    const ring = makeRing('person', (w) => void spawnActor(w, { at: [0, 0, 1.4], character: createCharacter(), player: false, components: { health } })); // prettier-ignore
    const session = settled(ring);
    session.step({ b: ['melee'] });
    steps(session, 20);
    const hurt = session.world.events.trace().filter((e) => e.type === 'damage').map((e) => e.payload); // prettier-ignore
    expect(hurt).toMatchObject([{ target: 2, source: 1, amount: MELEE.damage, hp: 70 }]);
    expect(of(session, 2).health.hitBy).toBe(1);
  });

  it('lunges at a person as at a thing, and stops lunging on the step its hit lands', () => {
    const ring = makeRing('lunge', (w) => void spawnActor(w, { at: [0, 0, 1.4], character: createCharacter(), player: false, components: { health: { hp: 100, hitAt: -1, hitBy: -1 } } })); // prettier-ignore
    const session = settled(ring);
    session.step({ b: ['melee'] });
    const { lands } = of(session, 1).melee;
    let most = 0;
    while (session.world.tick < lands) {
      session.step({});
      most = Math.max(most, of(session, 1).actor.vz);
    }
    expect(most).toBeGreaterThan(0.5); // toward him, +Z
    expect(of(session, 1).actor.vz).toBeCloseTo(0, 6); // the hit's own step: no more lunge
    const aside = makeRing('lunge-aside', (w) => void spawnActor(w, { at: [0.7, 0, 1.3], character: createCharacter(), player: false, components: { health: { hp: 100, hitAt: -1, hitBy: -1 } } })); // prettier-ignore
    const off = settled(aside);
    off.step({ look: [Math.atan2(0.7, 1.3), 0], b: ['melee'] });
    const swing = of(off, 1).melee;
    expect(swing.target).toBe(2);
    let toward = 0;
    while (off.world.tick < swing.lands - 1) {
      off.step({ look: [Math.atan2(0.7, 1.3), 0] });
      const [me, him] = [of(off, 1).actor, of(off, 2).actor];
      const [dx, dz] = [him.x + swing.aim[0] - me.x, him.z + swing.aim[2] - me.z];
      const along = (me.vx * dx + me.vz * dz) / Math.hypot(dx, dz);
      expect(Math.abs(me.vx * dz - me.vz * dx) / Math.hypot(dx, dz)).toBeLessThan(1e-6); // straight at his aim point
      toward = Math.max(toward, along);
    }
    expect(toward).toBeGreaterThan(0.5);
  });

  it('kicks from the air and uppercuts from a slide', () => {
    const session = settled(makeRing('air'));
    session.step({ b: ['jump'] });
    steps(session, 6, { b: ['jump'] });
    session.step({ b: ['jump', 'melee'] });
    expect(of(session, 1).melee.move).toBe('move:kick');
    const sliding = settled(makeRing('slide'));
    steps(sliding, 60, { move: [0, 1], b: ['sprint'] });
    steps(sliding, 3, { move: [0, 1], b: ['sprint', 'crouch'] });
    expect((sliding.world.get(1) as unknown as { motion: { sliding: boolean } }).motion.sliding).toBe(true);
    sliding.step({ move: [0, 1], b: ['sprint', 'crouch', 'melee'] });
    expect(of(sliding, 1).melee.move).toBe('move:uppercut');
  });

  it('brings the hands back 0.75 s after a swing began: no swing before', () => {
    const session = settled(makeRing('back'));
    session.step({ b: ['melee'] });
    const began = of(session, 1).melee.began;
    const presses: number[] = [];
    for (const after of [30, 40, 45]) {
      steps(session, began + after - session.world.tick - 1);
      session.step({ b: ['melee'] });
      presses.push(of(session, 1).melee.began - began);
    }
    expect(presses).toEqual([0, 0, 45]); // 45 steps on is 0.75 s
  });

  it('gives the same hashes on every run, and continues exactly from a capture mid-swing', () => {
    const intents = (i: number): Intents => (i === 10 || i === 100 ? { b: ['melee'] } : {});
    const run = () => {
      const session = createSession(doorRing, { seed: 1 });
      const hashes: string[] = [];
      for (let i = 0; i < 160; i++) hashes.push((session.step(intents(i)), session.world.hash()));
      return hashes;
    };
    const [a, b] = [run(), run()];
    expect(b).toEqual(a);
    const half = createSession(doorRing, { seed: 1 });
    for (let i = 0; i < 40; i++) half.step(intents(i));
    const fresh = createSession(doorRing, { seed: 1 });
    fresh.world.restore(half.world.capture());
    for (let i = 40; i < 160; i++) expect((fresh.step(intents(i)), fresh.world.hash())).toBe(a[i]);
  });
});
