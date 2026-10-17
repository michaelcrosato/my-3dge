/**
 * @file Unit tests for a character's hull (engine/physics/hull.ts) through the controller, `movement:apex` holstered at
 * 60 Hz: a crouch on the ground shrinks the hull from the top, the feet where they were; one begun in the air shrinks
 * it about its centre, the feet tucked up by half the difference (0.3175 m); under a 1.5 m ceiling the crouched hull
 * walks and stays down with crouch let go, standing up once out from under it; a slide steps up a 0.3 m step without
 * stopping, losing 10 m/s a metre climbed beside its friction; a restored capture has the hull it had; and a standing
 * character's feet read back exactly as before WP 13.5.
 * @see engine/physics/hull.ts
 */
import { describe, expect, it } from 'vitest';
import { addCharacter, createCharacter, createCharacterState, feetOf, stepCharacter, type CharacterInput } from './character'; // prettier-ignore
import { hullFits, hullHeight, setHull } from './hull';
import { createMotionState } from './movement/model';
import { createPhysics } from './world';

const DT = 1 / 60;
const SETTINGS = { get: (path: string) => (path === 'physics.gravity' ? 9.81 : undefined) };
const apex = createCharacter({ movement: 'movement:apex' });
const { radius, height } = apex.capsule;
/** The crouched hull's straight middle: 47 u, less the two ends. */
const CROUCHED = 1.1938 - 2 * radius;

/** A box, `size` big, its centre at `at`. */
const box = (size: [number, number, number], at: [number, number, number]) => ({ type: 'fixed' as const, colliders: [{ shape: { type: 'box' as const, size }, position: at }] }); // prettier-ignore

/** A holstered `movement:apex` character at `at` on a floor 200 m wide, beside `extra` fixed boxes, settled. */
function rig(at: [number, number, number], extra: ReturnType<typeof box>[] = []) {
  const physics = createPhysics();
  physics.addBody(box([200, 1, 200], [0, -0.5, 0]));
  for (const body of extra) physics.addBody(body);
  physics.step({ dt: DT, settings: SETTINGS });
  const body = addCharacter(physics, apex, at);
  const [state, motion] = [createCharacterState(), createMotionState()];
  const tick = (input: CharacterInput = {}) => {
    const step = stepCharacter(physics, body, apex, state, input, { dt: DT, gravity: 32 }, motion);
    physics.step({ dt: DT, settings: SETTINGS });
    return { ...step, feet: feetOf(physics, body, apex), centre: physics.readBody(body).position.y };
  };
  for (let i = 0; i < 30 && !(state.grounded && state.air === 0); i++) tick();
  return { physics, body, state, motion, tick };
}

const EAST: CharacterInput = { move: [1, 0], view: Math.PI / 2 };

describe('a character’s hull', () => {
  it('shrinks from the top on the ground, the feet where they were, and stands back up', () => {
    const r = rig([0, 0, 0]);
    const before = r.tick();
    let now = before;
    for (let i = 0; i < 26; i++) now = r.tick({ crouch: true });
    expect(r.motion.stance).toBe('crouch');
    expect(hullHeight(r.physics, r.body, apex)).toBeCloseTo(CROUCHED, 6);
    expect(now.feet.y).toBeCloseTo(before.feet.y, 6);
    expect(before.centre - now.centre).toBeCloseTo((height - CROUCHED) / 2, 6);
    now = r.tick();
    expect(hullHeight(r.physics, r.body, apex)).toBe(height); // up at once, exactly the standing hull
    expect(now.feet.y).toBeCloseTo(before.feet.y, 6);
  });

  it('shrinks about its centre when the crouch began in the air, the feet tucked up 0.3175 m', () => {
    const r = rig([0, 0, 0]);
    r.tick({ jump: true, jumpPressed: true });
    let [last, now] = [r.tick({ crouch: true }), r.tick({ crouch: true })];
    while (r.motion.stance === 'stand') [last, now] = [now, r.tick({ crouch: true })];
    expect(r.state.grounded).toBe(false);
    const fall = now.centre - last.centre; // the flight's own step
    expect(now.feet.y - last.feet.y - fall).toBeCloseTo((height - CROUCHED) / 2, 3);
  });

  it('stays crouched under a 1.5 m ceiling with crouch let go, and stands up once out from under it', () => {
    const ceiling = box([10, 0.5, 10], [10, 1.75, 0]); // from x 5 to 15, its underside 1.5 m up
    const r = rig([0, 0, 0], [ceiling]);
    for (let i = 0; i < 30; i++) r.tick({ crouch: true });
    while (r.tick({ ...EAST, crouch: true }).feet.x < 8);
    expect(hullFits(r.physics, r.body, apex, height, 'feet')).toBe(false);
    r.tick(EAST);
    expect([r.motion.stance, r.motion.duck]).toEqual(['crouch', 'ducked']);
    let x = 8;
    while (r.motion.stance === 'crouch' && x < 30) x = r.tick(EAST).feet.x;
    expect(x).toBeGreaterThan(15 + radius); // its hull clear of the ceiling's edge
    expect(x).toBeLessThan(15 + radius + 0.2);
  });

  it('slides up a step without stopping, losing 10 m/s a metre climbed beside its friction', () => {
    const step = box([20, 0.3, 20], [20, 0.15, 0]); // a 0.3 m step from x = 10
    const r = rig([-50, 0, 0], [step]);
    const sprint = { ...EAST, sprint: true };
    while (r.tick(sprint).feet.x < 4);
    let feet = r.tick({ ...EAST, crouch: true }).feet.y;
    let [rise, before, after] = [0, 0, 0];
    while (rise < 0.05 && r.state.vx > 1) {
      before = r.state.vx;
      const now = r.tick({ ...EAST, crouch: true }).feet.y;
      [rise, feet, after] = [now - feet, now, r.state.vx];
    }
    expect(r.motion.sliding).toBe(true);
    expect(after).toBeGreaterThan(5); // stepped, never stopped dead
    const friction = before - (before - 2.54 * DT) * Math.pow(0.7, DT);
    expect(before - after - friction).toBeCloseTo(rise * 10, 2);
  });

  it('comes back from a capture with the hull it had', () => {
    const r = rig([0, 0, 0]);
    setHull(r.physics, r.body, apex, CROUCHED, 'feet');
    r.physics.step({ dt: DT, settings: SETTINGS });
    const saved = r.physics.capture();
    setHull(r.physics, r.body, apex, height, 'feet');
    r.physics.restore(saved);
    expect(hullHeight(r.physics, r.body, apex)).toBeCloseTo(CROUCHED, 6);
  });

  it('reads a standing character’s feet back exactly, as before WP 13.5', () => {
    const physics = createPhysics();
    const hero = createCharacter();
    const body = addCharacter(physics, hero, [1, 0, 2]);
    const centre = physics.readBody(body).position.y;
    expect(feetOf(physics, body, hero).y).toBe(centre - hero.capsule.height / 2 - hero.capsule.radius - hero.offset);
  });
});
