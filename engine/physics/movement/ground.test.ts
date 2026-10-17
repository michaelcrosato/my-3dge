/**
 * @file Unit tests for the shooter model on the ground (engine/physics/movement/ground.ts) and its tick
 * (steer.ts), on flat ground at 60 Hz with no physics world: R5Reloaded's measured acceleration from rest with the
 * sprint held (er-apex's trial A: 2,500 u/s² to 120 u/s, 450 to the run, 100 to the sprint, the sprint from the second
 * tick), the run, the walk, the crouch-walk and the holstered bonus at their speeds, the stop from a sprint at
 * 1,250 u/s², the deceleration of only the part of the velocity the input does not push for, the sprint only within
 * 45° of the view (dipping to 4.80 m/s at 45°) and kept by a press while the move goes on, the stick curve, and the
 * gaits' side and back scales (1 in Apex, so it backpedals and strafes at the run).
 * @see engine/physics/movement/ground.ts
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from '../../core/math';
import { parse } from '../../core/schema';
import { createCharacter, createCharacterState, type CharacterInput } from '../character';
import { accelerate, decelerate, directionShare, gaitSpeed, groundAccel, walkMove } from './ground';
import { createMotionState, MODEL_FIELDS } from './model';
import { settleMotion, steerMotion } from './steer';

const DT = 1 / 60;
const model = parse(MODEL_FIELDS, {});
const apex = createCharacter({ movement: 'movement:apex' });

/** A character of `movement:apex` standing on flat ground, armed unless `holstered`. */
function standing(holstered = false) {
  const state = createCharacterState();
  state.grounded = true;
  const motion = createMotionState();
  motion.holstered = holstered;
  return { state, motion };
}

/** One tick on flat ground that never ends (no physics: the move is made in full and stays grounded). */
function tick(run: ReturnType<typeof standing>, input: CharacterInput) {
  const plan = steerMotion(apex, run.state, run.motion, input, DT, 19.05);
  const moved = plan.desired.clone().setY(0);
  const ground = { body: 0, point: new Vector3(), normal: new Vector3(0, 1, 0) };
  settleMotion(apex, run.state, run.motion, input, plan, { moved, grounded: true, across: [], vertical: [ground] }, 19.05, DT); // prettier-ignore
  return Math.hypot(run.state.vx, run.state.vz);
}

/** The speed after `n` ticks of `input` from `run`. */
function after(run: ReturnType<typeof standing>, input: CharacterInput, n: number) {
  let speed = 0;
  for (let i = 0; i < n; i++) speed = tick(run, input);
  return speed;
}

/** Forward along +X, the view along +X (yaw π/2). */
const forward: CharacterInput = { move: [1, 0], view: Math.PI / 2 };

describe('the ground model', () => {
  it('accelerates from rest as R5Reloaded measured, sprinting from the second tick (er-apex trial A)', () => {
    const run = standing();
    const v = [0];
    let sprintTick = 0;
    for (let t = 1; t <= 80; t++) {
      v.push(tick(run, { ...forward, sprint: true, sprintPressed: t === 1 }));
      if (run.motion.sprinting && !sprintTick) sprintTick = t;
    }
    expect(sprintTick).toBe(2);
    expect(v[1]).toBeCloseTo(41.667 * 0.0254, 4);
    expect(v[2]).toBeCloseTo(83.333 * 0.0254, 4);
    expect(v[3]).toBeCloseTo(125 * 0.0254, 4);
    expect(v[4]).toBeCloseTo(132.5 * 0.0254, 4);
    expect(v[10]).toBeCloseTo(177.5 * 0.0254, 4);
    expect(v[11] - v[10]).toBeCloseTo((100 / 60) * 0.0254, 5);
    expect(v[80]).toBeCloseTo(6.604, 3);
  });

  it('runs at 4.41 m/s, walks at 2.20, crouch-walks at 2.03, and holstered goes 1.15 times faster', () => {
    expect(after(standing(), forward, 120)).toBeCloseTo(4.4069, 3);
    expect(after(standing(), { ...forward, walk: true }, 120)).toBeCloseTo(2.2035, 3);
    expect(after(standing(), { ...forward, crouch: true }, 120)).toBeCloseTo(2.032, 3);
    expect(after(standing(true), forward, 120)).toBeCloseTo(4.4069 * 1.15, 3);
    expect(after(standing(true), { ...forward, sprint: true }, 200)).toBeCloseTo(6.604 * 1.15, 3);
  });

  it('stops from a sprint at 31.75 m/s² (1,250 u/s²): 13 ticks, about 0.21 s', () => {
    const run = standing();
    after(run, { ...forward, sprint: true }, 200);
    let ticks = 0;
    while (tick(run, {}) > 0) ticks++;
    expect(ticks + 1).toBe(Math.ceil(6.604 / 31.75 / DT));
  });

  it('brakes only the part of the velocity the input does not push for', () => {
    const h: [number, number] = [3, 2]; // pushed along +X at the run, drifting along +Z
    decelerate(model, h, [1, 0], 4.4069, 'stand', 1, DT);
    expect(h[0]).toBe(3); // kept: the input pushes for it
    expect(h[1]).toBeCloseTo(2 - 31.75 * DT, 9); // the drift brakes at 1,250 u/s²
    const back: [number, number] = [5, 0];
    decelerate(model, back, [-1, 0], 4.4069, 'stand', 1, DT); // pushing against it: all of it brakes
    expect(back[0]).toBeCloseTo(5 - 31.75 * DT, 6);
    const fast: [number, number] = [6, 0];
    accelerate(fast, [1, 0], 4.4069, 11.43, DT); // never past the larger of the old speed and the wished
    expect(fast[0]).toBe(6);
  });

  it('sprints only within 45° of the view, dipping to 4.80 m/s there, and never toward the view’s back', () => {
    const at = (degrees: number) => {
      const a = (degrees * Math.PI) / 180;
      const run = standing();
      const speed = after(run, { move: [Math.cos(a), Math.sin(a)], view: Math.PI / 2, sprint: true }, 300);
      return { speed, sprinting: run.motion.sprinting };
    };
    expect(at(0)).toEqual({ speed: expect.closeTo(6.604, 3), sprinting: true });
    expect(at(45)).toEqual({ speed: expect.closeTo(4.8, 3), sprinting: true });
    expect(at(50)).toEqual({ speed: expect.closeTo(4.4069, 3), sprinting: false });
    expect(at(180).sprinting).toBe(false);
  });

  it('keeps sprinting after a press while it moves on, until the move turns past 135° from the view', () => {
    const run = standing();
    tick(run, { ...forward, sprint: true, sprintPressed: true });
    expect(after(run, forward, 240)).toBeCloseTo(6.604, 3);
    expect(run.motion.sticky).toBe(true);
    after(run, { move: [-1, 0], view: Math.PI / 2 }, 2);
    expect(run.motion.sticky).toBe(false);
    expect(after(run, forward, 240)).toBeCloseTo(4.4069, 3);
  });

  it('sprints toward any direction when nothing gives a view (the screen-relative cameras)', () => {
    expect(after(standing(), { move: [-1, 0], sprint: true }, 300)).toBeCloseTo(6.604, 3);
  });

  it('goes at `gaits.side` of its speed across the view and `gaits.back` back from it (both 1 in Apex)', () => {
    const tuned = parse(MODEL_FIELDS, { gaits: { side: 0.8, back: 0.5 } });
    const east = [1, 0] as const; // the view
    const share = (wish: readonly [number, number], m = tuned) => directionShare(m, wish, east);
    expect([share([1, 0]), share([0, 1]), share([0, -1]), share([-1, 0])]).toEqual([1, expect.closeTo(0.8, 12), expect.closeTo(0.8, 12), expect.closeTo(0.5, 12)]); // prettier-ignore
    expect(share([-Math.SQRT1_2, Math.SQRT1_2])).toBeCloseTo(0.65, 12); // half across, half back
    expect(directionShare(tuned, [0, 1], null)).toBe(1); // no view: the screen-relative cameras
    const ways = [[1, 0], [0, 1], [-1, 0], [-0.6, 0.8]] as const; // prettier-ignore
    for (const wish of ways) expect(share(wish, model)).toBe(1);
    expect(gaitSpeed(tuned, createMotionState(), false, [-1, 0], east)).toBeCloseTo(4.4069 * 0.5, 12);
    expect(after(standing(), { move: [-1, 0], view: Math.PI / 2 }, 120)).toBeCloseTo(4.4069, 3); // Apex backpedals at the run
  });

  it('reads a half-pushed stick as three quarters (the stick curve) and picks the acceleration by speed', () => {
    expect(after(standing(), { move: [0.5, 0], view: Math.PI / 2 }, 120)).toBeCloseTo(4.4069 * 0.75, 3);
    expect(groundAccel(model, 0, 'stand', 1)).toBe(63.5);
    expect(groundAccel(model, 3.1, 'stand', 1)).toBe(11.43);
    expect(groundAccel(model, 4.4, 'stand', 1)).toBe(2.54);
    expect(groundAccel(model, 4.4, 'crouch', 1)).toBe(63.5);
    const h: [number, number] = [0, 0];
    walkMove(model, h, [1, 0], 4.4069, 'stand', 1, DT);
    expect(h[0]).toBeCloseTo(63.5 * DT, 9);
  });
});
