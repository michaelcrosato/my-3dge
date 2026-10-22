/**
 * @file Tests for firearms (engine/sim/weapons.ts; WP 13.20) on a floor, the player at the origin facing +Z, a target
 * 10 m ahead and a wall 30 m ahead: drawn and holstered, holstered running faster, the body carrying the gun; a
 * pistol fires once a press at its rate, a round a shot, hitting what its crosshair points at, and reloads (tactical,
 * and longer from empty, its last round bringing it on, an empty one clicking); a rifle fires on while held at its
 * rate, its burst climbing by its recoil and settling after; shots stray within their cone (narrow down the sights,
 * where he walks); without a look a shot goes level from the chest toward the pointer; a person loses the weapon's
 * damage and a door breaks; a melee swing holds the weapon; the same hashes every run, and a capture mid-burst goes on
 * exactly.
 * @see engine/sim/weapons.ts
 */
import { describe, expect, it } from 'vitest';
import type { Intents } from '../input/intents';
import { physicsOf } from '../physics/binding';
import { createCharacter } from '../physics/character';
import { defineThing } from '../world/things';
import { spawnActor } from './actors';
import { HEALTH_FIELDS, type Health } from './damage';
import { addDoor, type DoorComponent } from './doors';
import { addInteraction } from './interact';
import { addMelee } from './melee';
import { defineScene } from './scene';
import { createSession } from './session';
import { defineComponent } from './state';
import { spawnThing } from './things';
import { defineWeapon } from '../world/weapons';
import { addWeapons, weaponsFor, type WeaponsState } from './weapons';
import type { World } from './world';

defineComponent('health', { description: 'Hit points (the test’s people).', fields: HEALTH_FIELDS });
defineThing('thing:weapons-test', { prop: 'prop:crate', hp: 99, rise: 1 });
defineWeapon('weapon:test-pistol', { rate: 5, damage: 20, range: 60, magazine: 3, reload: { tactical: 1, empty: 1.5 }, spread: { hip: 0, move: 0, ads: 0 }, recoil: [[1, 0]], settle: 0.3, draw: 0.25 }); // prettier-ignore
defineWeapon('weapon:test-rifle', { rate: 10, auto: true, damage: 10, range: 60, magazine: 30, spread: { hip: 0, move: 0, ads: 0 }, recoil: [[0.5, 0.25], [0.75, -0.25]], settle: 0.3, draw: 0.5 }); // prettier-ignore
defineWeapon('weapon:test-spray', { rate: 30, auto: true, magazine: 500, spread: { hip: 3, move: 2, ads: 0.25 }, recoil: [[0, 0]], draw: 0 }); // prettier-ignore

type Shooter = { weapons: WeaponsState; motion: { holstered: boolean; gait: string }; animator: { weapon: string }; actor: { x: number; z: number; vx: number; vz: number } }; // prettier-ignore
type Gunshot = { from: number[]; to: number[]; target: number; hit: boolean; weapon: string };

/** The range: a floor, the player at the origin facing +Z (1), a target 10 m ahead (2), a wall 30 m ahead; `more` adds. */ // prettier-ignore
const makeRange = (name: string, slots: string[], more: (w: World) => void = () => {}) =>
  defineScene(`weapons-test:${name}`, {
    physics: true,
    setup(w) {
      physicsOf(w).addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [80, 1, 80] }, position: [0, -0.5, 0] }] }); // prettier-ignore
      physicsOf(w).addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [40, 20, 1] }, position: [0, 10, 30.5] }] }); // prettier-ignore
      const character = createCharacter({ movement: 'movement:apex' });
      spawnActor(w, { at: [0, 0, 0], character, anim: { build: 'build:adult' }, components: { weapons: weaponsFor(slots) } }); // prettier-ignore
      spawnThing(w, 'thing:weapons-test', [0, 0.95, 10]); // its middle at the eye's height, 1.52 m
      more(w);
      addInteraction(w);
      addMelee(w);
      addWeapons(w);
    },
  });

const ahead: Intents = { look: [0, 0] };
const steps = (session: ReturnType<typeof createSession>, n: number, intents: Intents = ahead) => {
  for (let i = 0; i < n; i++) session.step(intents);
};
const of = (session: ReturnType<typeof createSession>) => session.world.get(1) as unknown as Shooter;
const events = (w: World, type: string) => w.events.trace().filter((e) => e.type === type).map((e) => e.payload); // prettier-ignore
const shots = (w: World) => events(w, 'gunshot') as Gunshot[];

/** A session of `scene` stood 10 steps, then its first weapon drawn and ready. */
function armed(scene: Parameters<typeof createSession>[0], slot = 'weapon1') {
  const session = createSession(scene, { seed: 1 });
  steps(session, 10);
  session.step({ ...ahead, b: [slot] });
  steps(session, 40);
  return session;
}

describe('firearms', () => {
  const both = makeRange('both', ['weapon:test-pistol', 'weapon:test-rifle']);

  it('draw and holster, holstered running faster, the body carrying a gun while one is out', () => {
    const session = createSession(both, { seed: 1 });
    steps(session, 10);
    expect([of(session).weapons.slot, of(session).motion.holstered, of(session).animator.weapon]).toEqual([-1, true, 'none']); // prettier-ignore
    session.step({ ...ahead, b: ['weapon1'] });
    expect([of(session).weapons.slot, of(session).motion.holstered, of(session).animator.weapon]).toEqual([0, false, 'gun']); // prettier-ignore
    session.step({ ...ahead, b: ['weapon2'] });
    session.step({ ...ahead, b: ['holster'] });
    expect([of(session).weapons.slot, of(session).weapons.last, of(session).motion.holstered]).toEqual([-1, 1, true]);
    session.step(ahead); // let go
    session.step({ ...ahead, b: ['holster'] }); // again: the rifle back out
    expect(of(session).weapons.slot).toBe(1);
    session.step({ ...ahead, b: ['swap'] });
    expect(of(session).weapons.slot).toBe(0);
    expect(events(session.world, 'draw').map((e) => (e as { weapon: string }).weapon)).toEqual(['weapon:test-pistol', 'weapon:test-rifle', 'weapon:test-rifle', 'weapon:test-pistol']); // prettier-ignore
  });

  it('fire a pistol once a press at its rate, a round a shot, hitting what the crosshair points at', () => {
    const session = armed(both);
    session.step({ ...ahead, b: ['fire'] });
    expect(shots(session.world)).toMatchObject([{ target: 2, hit: true, weapon: 'weapon:test-pistol' }]);
    const [shot] = shots(session.world);
    expect(shot.from[1]).toBeCloseTo(1.52, 3); // from the eye
    expect(shot.to[2]).toBeCloseTo(10 - 0.375, 3); // on the target's face
    steps(session, 20, { ...ahead, b: ['fire'] }); // held: a pistol fires once a press
    session.step({ ...ahead, b: [] });
    session.step({ ...ahead, b: ['fire'] }); // 0.37 s on: past its 0.2 s
    const { weapons } = of(session);
    expect([shots(session.world).length, weapons.mags[0], weapons.shots, weapons.hits]).toEqual([2, 1, 2, 2]);
    const thing = session.world.get(2) as unknown as { thing: { hits: number } };
    expect(thing.thing.hits).toBe(2);
  });

  it('reload: the last round brings it on, longer from empty; an empty one clicks; a tactical one is shorter', () => {
    const session = armed(both);
    for (let k = 0; k < 3; k++) {
      session.step({ ...ahead, b: ['fire'] });
      steps(session, 14, { ...ahead, b: [] });
    }
    expect([shots(session.world).length, of(session).weapons.mags[0], events(session.world, 'reload').length]).toEqual([3, 0, 1]); // prettier-ignore
    session.step({ ...ahead, b: ['fire'] }); // reloading: no shot, no click
    expect([shots(session.world).length, events(session.world, 'dry').length]).toEqual([3, 0]);
    steps(session, 75, { ...ahead, b: [] }); // 1.5 s from the third shot
    expect(of(session).weapons.mags[0]).toBe(3);
    session.step({ ...ahead, b: ['fire'] });
    steps(session, 14, { ...ahead, b: [] });
    session.step({ ...ahead, b: ['reload'] });
    const started = session.world.time;
    steps(session, 59, { ...ahead, b: [] });
    expect(of(session).weapons.mags[0]).toBe(2); // a tactical reload takes 1 s
    steps(session, 2, { ...ahead, b: [] });
    expect([of(session).weapons.mags[0], session.world.time - started > 1]).toEqual([3, true]);
  });

  it('fire a rifle on while held at its rate, the burst climbing by its recoil, settled after', () => {
    const session = armed(both, 'weapon2');
    steps(session, 60, { ...ahead, b: ['fire'] }); // a second held
    const burst = shots(session.world);
    expect(burst.length).toBe(10); // 10 a second
    const heights = burst.map((s) => s.to[1]);
    for (let i = 1; i < heights.length; i++) expect(heights[i]).toBeGreaterThan(heights[i - 1]); // each a step higher
    const { kick } = of(session).weapons;
    expect(kick[0]).toBeCloseTo(0.5 + 0.75 * 9, 9); // the first step, then the last repeating
    expect(kick[1]).toBeCloseTo(0.25 - 0.25 * 9, 9);
    steps(session, 30, { ...ahead, b: [] });
    expect([of(session).weapons.kick, of(session).weapons.burst]).toEqual([[0, 0], 0]);
  });

  it('stray within their cone, by the stream: wide from the hip and on the move, narrow down the sights, where he walks', () => {
    const spray = makeRange('spray', ['weapon:test-spray']);
    const offs = (intents: Intents, n: number) => {
      const session = armed(spray);
      steps(session, n, intents);
      return shots(session.world).map((s) => {
        const [dx, dy, dz] = [0, 1, 2].map((i) => s.to[i] - s.from[i]);
        return Math.atan2(Math.hypot(dx, dy), dz) / (Math.PI / 180); // degrees off the crosshair
      });
    };
    const hip = offs({ ...ahead, b: ['fire'] }, 60);
    expect(Math.max(...hip)).toBeLessThanOrEqual(3 + 1e-6);
    expect(Math.max(...hip)).toBeGreaterThan(2);
    const sights = offs({ ...ahead, b: ['fire', 'aim'] }, 60).slice(10); // the sights up after 0.2 s
    expect(Math.max(...sights)).toBeLessThanOrEqual(0.25 + 1e-6);
    const session = armed(spray);
    steps(session, 60, { ...ahead, move: [0, 1], b: ['aim'] });
    expect([of(session).motion.gait, Math.hypot(of(session).actor.vx, of(session).actor.vz)]).toEqual(['walk', expect.closeTo(2.2035, 2)]); // prettier-ignore
    expect(offs({ ...ahead, b: ['fire'] }, 30)).toEqual(offs({ ...ahead, b: ['fire'] }, 30)); // the same stream, the same shots
  });

  it('go level from the chest toward the pointer without a look', () => {
    const session = armed(both);
    session.step({ aim: [3, 0, 10], b: ['fire'] }); // isometric's pointer on the floor
    const [shot] = shots(session.world);
    expect([shot.from[1], shot.to[1]]).toEqual([expect.closeTo(1.3, 3), expect.closeTo(1.3, 3)]);
    expect(Math.atan2(shot.to[0] - shot.from[0], shot.to[2] - shot.from[2])).toBeCloseTo(Math.atan2(3, 10), 6);
  });

  it('take their damage from a person and break a door at once', () => {
    const health: Health = { hp: 100, hitAt: -1, hitBy: -1 };
    const crowd = makeRange('person', ['weapon:test-pistol'], (w) => {
      spawnActor(w, { at: [2, 0, 6], character: createCharacter(), player: false, components: { health } }); // 3
      addDoor(w, { hinge: [-2.45, 0, 6] }); // 4: across x −2.45 to −1.55
    });
    const session = armed(crowd);
    session.step({ look: [Math.atan2(2, 6), 0], aim: [2, 1.2, 6], b: ['fire'] });
    steps(session, 20, { ...ahead, b: [] });
    session.step({ look: [Math.atan2(-2, 6), 0], aim: [-2, 1.2, 6], b: ['fire'] });
    expect(events(session.world, 'damage')).toMatchObject([{ target: 3, source: 1, amount: 20, hp: 80 }]);
    expect((session.world.get(4) as unknown as { door: DoorComponent }).door.broken).toBe(true);
  });

  it('wait out a melee swing until the hands are back', () => {
    const session = armed(both);
    session.step({ ...ahead, b: ['melee'] });
    steps(session, 20, { ...ahead, b: [] });
    session.step({ ...ahead, b: ['fire'] }); // 0.35 s into the swing
    expect(shots(session.world)).toEqual([]);
    steps(session, 30, { ...ahead, b: [] });
    session.step({ ...ahead, b: ['fire'] }); // 0.87 s on: the hands back
    expect(shots(session.world).length).toBe(1);
  });

  it('give the same hashes every run, and go on exactly from a capture mid-burst', () => {
    const spray = makeRange('hash', ['weapon:test-spray']);
    const intents = (i: number): Intents => (i === 10 ? { ...ahead, b: ['weapon1'] } : i >= 20 && i < 80 ? { ...ahead, b: ['fire'] } : ahead); // prettier-ignore
    const run = () => {
      const session = createSession(spray, { seed: 1 });
      const hashes: string[] = [];
      for (let i = 0; i < 100; i++) hashes.push((session.step(intents(i)), session.world.hash()));
      return hashes;
    };
    const [a, b] = [run(), run()];
    expect(b).toEqual(a);
    const half = createSession(spray, { seed: 1 });
    for (let i = 0; i < 45; i++) half.step(intents(i));
    const fresh = createSession(spray, { seed: 1 });
    fresh.world.restore(half.world.capture());
    for (let i = 45; i < 100; i++) expect((fresh.step(intents(i)), fresh.world.hash())).toBe(a[i]);
  });
});
