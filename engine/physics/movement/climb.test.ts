/**
 * @file Unit tests for the wall-climb and the wall-bounce (engine/physics/movement/climb.ts): through the controller,
 * `movement:apex` holstered sprinting east at walls whose face stands at x = 8 and jumping 2.6 m short of them, it
 * climbs a 5 m wall at up to 5.72 m/s and tops out into the grab, onto the top; the climb space's cutoff ends a climb
 * of the 6.9 m wall with the end boost, 0.71 m higher, from which it mantles; a 7.2 m wall is past it; a late jump
 * catches low and ends 2.54 m above that; letting go of forward lets go. A jump off bounces by its zone over the climb
 * space's foot: from the mini zone 0.72 m up and 4.78 m/s away, from the green zone a lift falling with the height and
 * 6.55 m/s away, higher a push of 6.55 m/s keeping the rise, landing fatigued. With a world of plain data: the space's
 * foot follows the ground and a fall, letting go lowers it 3.25 m, a bounce from above the mini zone 6.5 m; a new
 * climb catches only below the last catch, unless the wall turned 25.84° or more.
 * @see engine/physics/movement/climb.ts
 */
import { describe, expect, it } from 'vitest';
import { addCharacter, createCharacter, createCharacterState, feetOf, stepCharacter, type CharacterInput } from '../character'; // prettier-ignore
import type { Wall } from '../ledge';
import { createPhysics } from '../world';
import { keepSpace, tryClimb, wallBounce } from './climb';
import { createMotionState } from './model';
import type { Room } from './steer';

const DT = 1 / 60;
const SETTINGS = { get: (path: string) => (path === 'physics.gravity' ? 9.81 : undefined) };
const APEX = createCharacter({ movement: 'movement:apex' });
const G = APEX.characterGravity!;
const FACE = 8;

/** A box, `size` big, its centre at `at`. */
const box = (size: [number, number, number], at: [number, number, number]) => ({ type: 'fixed' as const, colliders: [{ shape: { type: 'box' as const, size }, position: at }] }); // prettier-ignore

/** A sprint east at a wall `height` high, jumping once the body is `short` metres short of its face; the run's log. */
function climbRun(height: number, short = 2.6, input: (k: number, r: Rig) => CharacterInput = () => EAST) {
  const r = rig(height);
  let jumped = false;
  for (let k = 0; k < 400; k++) {
    const press = !jumped && r.physics.readBody(r.body).position.x >= FACE - short;
    if (press) jumped = true;
    const own = input(k, r);
    const feet = r.tick({ ...own, sprint: true, jumpPressed: press || own.jumpPressed });
    r.log.push({ mode: r.motion.mode, mantle: r.motion.mantle, y: feet.y, vy: r.state.vy, across: Math.hypot(r.state.vx, r.state.vz) }); // prettier-ignore
  }
  return r;
}

type Rig = ReturnType<typeof rig>;

/** The character at the origin on a floor before a wall `height` high, settled. */
function rig(height: number) {
  const physics = createPhysics();
  physics.addBody(box([200, 1, 200], [0, -0.5, 0]));
  physics.addBody(box([2, height, 4], [FACE + 1, height / 2, 0]));
  physics.step({ dt: DT, settings: SETTINGS });
  const body = addCharacter(physics, APEX, [0, 0, 0]);
  const [state, motion] = [createCharacterState(), createMotionState()];
  const log: { mode: string; mantle: string; y: number; vy: number; across: number }[] = [];
  const tick = (input: CharacterInput = {}) => {
    stepCharacter(physics, body, APEX, state, input, { dt: DT, gravity: 32 }, motion);
    physics.step({ dt: DT, settings: SETTINGS });
    return feetOf(physics, body, APEX);
  };
  for (let i = 0; i < 30 && !(state.grounded && state.air === 0); i++) tick();
  return { physics, body, state, motion, tick, log };
}

const EAST: CharacterInput = { move: [1, 0], view: Math.PI / 2 };

/** The first sample of `r`'s log meeting `test`, and its index. */
const first = (r: Rig, test: (s: Rig['log'][number]) => boolean) => {
  const k = r.log.findIndex(test);
  return { k, ...r.log[k] };
};

describe('the wall-climb', () => {
  it('climbs a 5 m wall at up to 5.72 m/s and tops out into the grab, onto the top', () => {
    const r = climbRun(5);
    const caught = first(r, (s) => s.mode === 'climb');
    expect(caught.k).toBeGreaterThan(0);
    expect(Math.max(...r.log.filter((s) => s.mode === 'climb').map((s) => s.vy))).toBeCloseTo(5.715, 6);
    const grab = first(r, (s) => s.mantle === 'grab');
    expect(r.log[grab.k - 1].mode).toBe('climb'); // straight out of the climb
    expect(first(r, (s) => s.mode === 'ground' && s.y > 4).y).toBeCloseTo(5, 2);
  });

  it('ends at the climb space’s cutoff with the end boost, 0.71 m higher, mantling the 6.9 m wall but not 7.2 m', () => {
    const r = climbRun(6.9);
    const caught = first(r, (s) => s.mode === 'climb');
    expect(caught.y).toBeGreaterThan(1.1938 - 2.54 + 2.54); // caught high: the cutoff, not the catch, ends it
    const end = first(r, (s) => s.mode === 'air' && r.log.indexOf(s) > caught.k);
    expect(r.log[end.k - 1].y).toBeCloseTo(3.7338, 3); // the climb stops at it, the end boost the tick after
    expect(end.vy).toBeCloseTo(Math.sqrt(2 * G * 0.7112) - G * DT, 6);
    expect(first(r, (s) => s.mode === 'ground' && s.y > 6).y).toBeCloseTo(6.9, 2);
    const high = climbRun(7.2);
    expect(Math.max(...high.log.map((s) => s.y))).toBeCloseTo(3.7338 + 0.7112, 2); // no ledge within reach of it
    expect(high.log.at(-1)?.y).toBeCloseTo(0, 2);
  });

  it('ends 2.54 m above a low catch, and lets go when forward lets go', () => {
    const late = climbRun(6.9, 1);
    const caught = first(late, (s) => s.mode === 'climb');
    const end = first(late, (s) => s.mode === 'air' && late.log.indexOf(s) > caught.k);
    expect(late.log[end.k - 1].y).toBeLessThan(late.log[caught.k - 1].y + 2.54 + 0.1);
    expect(late.log[end.k - 1].y + 0.1).toBeGreaterThan(late.log[caught.k - 1].y + 2.54);
    expect(Math.max(...late.log.map((s) => s.y))).toBeLessThan(4);
    const off = climbRun(6, 2.6, (k, r) => (r.motion.mode === 'climb' && r.motion.climbAge >= 5 ? { view: Math.PI / 2 } : EAST)); // prettier-ignore
    const climbed = off.log.filter((s) => s.mode === 'climb').length;
    expect(climbed).toBeLessThan(10);
  });
});

describe('the wall-bounce', () => {
  /** A climb of the 6 m wall from a jump `short` m short of it, bouncing off once the feet are `at` m up. */
  function bounce(at: number, short = 2.6) {
    let done = false;
    return climbRun(6, short, (k, r) => {
      const y = feetOf(r.physics, r.body, APEX).y;
      const now = !done && r.motion.mode === 'climb' && y >= at;
      if (now) done = true;
      return done ? { view: Math.PI / 2, jumpPressed: now } : EAST;
    });
  }

  it('bounces by its zone: green a lift falling with the height and 6.55 m/s away, higher a push keeping the rise', () => {
    const low = bounce(0.6, 1.2); // a jump 1.2 m short catches at 0.64 m, low in the green zone
    const lowOff = first(low, (s) => s.mode === 'air' && low.log.indexOf(s) > first(low, (q) => q.mode === 'climb').k); // prettier-ignore
    const high = bounce(1, 1.2);
    const highOff = first(high, (s) => s.mode === 'air' && high.log.indexOf(s) > first(high, (q) => q.mode === 'climb').k); // prettier-ignore
    expect(lowOff.across).toBeCloseTo(6.5532, 3);
    expect(lowOff.vy).toBeGreaterThan(highOff.vy); // lower in the green zone, more lift
    const push = bounce(2);
    const pushOff = first(push, (s) => s.mode === 'air' && push.log.indexOf(s) > first(push, (q) => q.mode === 'climb').k); // prettier-ignore
    expect(pushOff.across).toBeCloseTo(6.5532, 3);
    expect(pushOff.vy).toBeCloseTo(5.715 - G * DT, 3); // the climb's rise kept
  });

  it('bounces from the mini zone 0.72 m up and 4.78 m/s away, lowering the climb space only 3.25 m', () => {
    const motion = createMotionState();
    Object.assign(motion, { mode: 'climb', climbAge: 3, wallX: -1, wallZ: 0, spaceY: 0 });
    const state = createCharacterState();
    wallBounce(APEX, state, motion, 0.3, { wish: [0, 0], view: null, scale: 1.15, dt: DT, g: G });
    expect([state.vx, state.vz]).toEqual([-4.7752, 0]);
    expect(state.vy).toBeCloseTo(Math.sqrt(2 * G * 0.716534), 9);
    expect([motion.mode, motion.spaceY, motion.fatigued]).toEqual(['air', -3.2512, true]);
    wallBounce(APEX, state, Object.assign(motion, { mode: 'climb', spaceY: 0 }), 0.6, { wish: [0, 0], view: null, scale: 1.15, dt: DT, g: G }); // prettier-ignore
    expect(motion.spaceY).toBe(-6.5024);
  });
});

describe('the climb space', () => {
  /** A world of plain data: the feet at `feet`, a sheer wall east (or turned by `turn` rad). */
  const room = (feet: number, turn = 0): Room => {
    const wall: Wall = { point: [1, feet, 0], normal: [-Math.cos(turn), Math.sin(turn)], up: 0 };
    return { stand: () => true, feet: () => [0, feet, 0], wall: () => wall, ledge: () => null };
  };
  const tick = { wish: [1, 0] as const, view: [1, 0] as const, scale: 1.15, dt: DT, g: G };

  it('follows the ground, drags down with a fall below its foot, and keeps a climb to its cutoff', () => {
    const motion = createMotionState();
    keepSpace(motion, 2, true);
    keepSpace(motion, 3, false);
    expect(motion.spaceY).toBe(2);
    keepSpace(motion, 1.5, false);
    expect(motion.spaceY).toBe(1.5);
    const state = createCharacterState();
    expect(tryClimb(APEX, state, Object.assign(createMotionState(), { mode: 'air', spaceY: 0 }), {}, room(3.8), tick)).toBe(false); // prettier-ignore
    expect(tryClimb(APEX, state, Object.assign(createMotionState(), { mode: 'air', spaceY: 0 }), {}, room(3.7), tick)).toBe(true); // prettier-ignore
  });

  it('catches again only below the last catch, unless the wall turned 25.84° or more', () => {
    const state = createCharacterState();
    const again = (feet: number, turn: number) => tryClimb(APEX, state, Object.assign(createMotionState(), { mode: 'air', spaceY: -1, reattach: true, attachY: 1, wallX: -1, wallZ: 0 }), {}, room(feet, turn), tick); // prettier-ignore
    expect(again(1.2, 0)).toBe(false);
    expect(again(0.8, 0)).toBe(true);
    expect(again(1.2, (20 * Math.PI) / 180)).toBe(false);
    expect(again(1.2, (26 * Math.PI) / 180)).toBe(true);
  });
});
