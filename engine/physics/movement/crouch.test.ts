/**
 * @file Unit tests for the shooter model's crouch and slide (engine/physics/movement/crouch.ts, in steer.ts's tick and
 * ground.ts's walk), on flat ground at 60 Hz with no physics world, holstered: the hull goes down 25 ticks after a
 * press (400 ms in whole 16 ms ticks) and up at once on letting go, back to standing 200 ms later; crouch spam never
 * shrinks it; getting up waits for headroom; a toggle crouches until pressed again, and a jump or a sprint press stands
 * it up. A crouch from a sprint slides: the hull crouches at once, the speed is boosted to 10.16 × 1.15 m/s, then slows
 * by 2.54 m/s² and × 0.7 a second, steered only sideways, and ends below 3.18 m/s into a crouch; never from a run, off
 * the view or within 2 s of the last slide's start. Let go above 8.89 m/s it slides on, braking at 10.16 m/s², and
 * stands below. Down a slope it gains g · n_y along the floor. Its jump goes 1.27 m, takes back a boost not yet
 * crouched into (a dead slide) and jumps a slide slowing through 7.56 to 8.89 m/s at 8.89 (the long jump); a landing
 * ducked at speed slides.
 * @see engine/physics/movement/crouch.ts
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from '../../core/math';
import { parse } from '../../core/schema';
import { createCharacter, createCharacterState, type CharacterInput } from '../character';
import { tryStartSlide } from './crouch';
import { createMotionState, MODEL_FIELDS } from './model';
import { settleMotion, steerMotion, type Room } from './steer';

const DT = 1 / 60;
const G = 19.05;
const model = parse(MODEL_FIELDS, {});
const apex = createCharacter({ movement: 'movement:apex' });
const HOLSTERED = 1.15;

/** A holstered `movement:apex` character standing on flat ground. */
function standing() {
  const state = createCharacterState();
  state.grounded = true;
  return { state, motion: createMotionState() };
}

/**
 * One tick on ground of normal `floor` that never ends (no physics: the move is made in full, and the floor holds it
 * up the moment it stops rising).
 */
function tick(run: ReturnType<typeof standing>, input: CharacterInput, room?: Room, floor = [0, 1, 0]) {
  const plan = steerMotion(apex, run.state, run.motion, input, DT, G, room);
  const grounded = plan.desired.y <= 0;
  const moved = plan.desired.clone().setY(Math.max(plan.desired.y, 0));
  const ground = { body: 0, point: new Vector3(), normal: new Vector3(floor[0], floor[1], floor[2]) };
  settleMotion(apex, run.state, run.motion, input, plan, { moved, grounded, climbed: 0, across: [], vertical: grounded ? [ground] : [] }, G, DT); // prettier-ignore
  return Math.hypot(run.state.vx, run.state.vz);
}

/** `n` ticks of `input`; the speed after the last. */
function after(run: ReturnType<typeof standing>, input: CharacterInput, n: number, room?: Room) {
  let speed = 0;
  for (let i = 0; i < n; i++) speed = tick(run, input, room);
  return speed;
}

/** East, the view east too (yaw π/2). */
const EAST: CharacterInput = { move: [1, 0], view: Math.PI / 2 };
const SPRINT: CharacterInput = { ...EAST, sprint: true };
const SLIDE: CharacterInput = { ...EAST, crouch: true };

/** A holstered sprint at full speed, east. */
function sprinting() {
  const run = standing();
  after(run, SPRINT, 200);
  return run;
}

/** The slide's speed one tick on, on flat ground with crouch held (2.54 m/s², then × 0.7 a second). */
const slowed = (v: number, decel = model.slide.decel) => Math.max(v - decel * DT, 0) * Math.pow(0.7, DT);

describe('the crouch', () => {
  it('goes down 25 ticks after a press and up at once on letting go, standing 200 ms later', () => {
    const run = standing();
    let down = 0;
    while (run.motion.stance === 'stand' && down < 60) [down] = [down + 1, tick(run, { crouch: true })];
    expect([down - 1, run.motion.duck]).toEqual([25, 'ducked']); // 400 ms in whole 16 ms ticks
    tick(run, {});
    expect([run.motion.stance, run.motion.duck]).toEqual(['stand', 'unducking']);
    let up = 0;
    while (run.motion.duck !== 'standing' && up < 60) [up] = [up + 1, tick(run, {})];
    expect(up).toBe(13); // 200 ms
  });

  it('never shrinks the hull when spammed, each press starting from where the last left off', () => {
    const run = standing();
    for (let k = 0; k < 20; k++) {
      after(run, { crouch: true }, 15);
      after(run, {}, 3);
      expect(run.motion.stance).toBe('stand');
    }
  });

  it('waits for headroom to get up, then gets up', () => {
    const run = standing();
    const room = { open: false, stand: () => room.open };
    after(run, { crouch: true }, 40, room);
    after(run, {}, 30, room);
    expect([run.motion.stance, run.motion.duck]).toEqual(['crouch', 'ducked']);
    room.open = true;
    tick(run, {}, room);
    expect(run.motion.stance).toBe('stand');
  });

  it('toggles on a press until the next, and stands up for a jump or a sprint press instead', () => {
    const run = standing();
    tick(run, { crouchToggle: true });
    after(run, {}, 30);
    expect(run.motion.stance).toBe('crouch');
    tick(run, { crouchToggle: true });
    expect(run.motion.stance).toBe('stand');
    after(run, {}, 20);
    tick(run, { crouchToggle: true });
    after(run, {}, 30);
    tick(run, { jump: true, jumpPressed: true });
    expect([run.motion.crouchToggle, run.state.vy]).toEqual([false, 0]); // stood up, no jump
    tick(run, {});
    expect(run.motion.stance).toBe('stand');
    tick(run, { crouchToggle: true });
    after(run, {}, 30);
    tick(run, { ...EAST, sprint: true, sprintPressed: true });
    tick(run, EAST);
    expect(run.motion.stance).toBe('stand');
  });
});

describe('the slide', () => {
  it('starts from a holstered sprint, crouched at once, boosted to 10.16 × 1.15 m/s', () => {
    const run = sprinting();
    expect(Math.hypot(run.state.vx, run.state.vz)).toBeCloseTo(6.604 * HOLSTERED, 3);
    const speed = tick(run, SLIDE);
    expect([run.motion.sliding, run.motion.stance, run.motion.gait]).toEqual([true, 'crouch', 'slide']);
    expect(run.motion.slideBoost).toBeCloseTo(10.16 * HOLSTERED - 6.604 * HOLSTERED, 3);
    expect(speed).toBeCloseTo(slowed(10.16 * HOLSTERED), 3);
  });

  it('never starts from a run (5.07 m/s holstered, under 5.08), nor with the move 60° off the view', () => {
    const run = standing();
    after(run, EAST, 120);
    tick(run, SLIDE);
    expect(run.motion.sliding).toBe(false);
    const off = sprinting();
    tick(off, { move: [Math.cos(Math.PI / 3), Math.sin(Math.PI / 3)], view: Math.PI / 2, crouch: true });
    expect(off.motion.sliding).toBe(false);
  });

  it('slows by 2.54 m/s² and × 0.7 a second, steered only sideways, ending below 3.18 m/s into a crouch', () => {
    const run = sprinting();
    let v = tick(run, SLIDE);
    let ticks = 1;
    while (run.motion.sliding) {
      const expected = slowed(v);
      v = tick(run, SLIDE);
      if (run.motion.sliding) expect(v).toBeCloseTo(expected, 9);
      ticks++;
    }
    expect(v).toBeLessThan(3.175);
    expect(ticks * DT).toBeCloseTo(1.7, 1); // from 11.68 m/s: 2.54 m/s² and the decay, about 1.7 s
    expect([run.motion.stance, run.motion.gait]).toEqual(['crouch', 'crouch']);
    expect(after(run, SLIDE, 60)).toBeCloseTo(2.032 * HOLSTERED, 3); // then the crouch-walk
    const steered = sprinting();
    tick(steered, SLIDE);
    const before = Math.hypot(steered.state.vx, steered.state.vz);
    tick(steered, { move: [Math.SQRT1_2, Math.SQRT1_2], view: Math.PI / 2, crouch: true });
    expect(Math.hypot(steered.state.vx, steered.state.vz)).toBeLessThan(before); // forward never pushes it on
    expect(steered.state.vz).toBeCloseTo(1.27 * HOLSTERED * DT, 6); // the side key steers at 1.27 m/s²
  });

  it('slides on with crouch let go above 8.89 m/s, braking at 10.16 m/s², and stands up below it', () => {
    const run = sprinting();
    let v = tick(run, SLIDE);
    while (v > 8.89) {
      const expected = slowed(v, model.slide.brake);
      v = tick(run, EAST);
      expect(v).toBeCloseTo(expected, 9);
      expect(run.motion.stance).toBe('crouch');
    }
    tick(run, EAST);
    expect([run.motion.sliding, run.motion.stance]).toEqual([false, 'stand']);
  });

  it('boosts only 2 s after the last slide began', () => {
    const run = sprinting();
    tick(run, SLIDE);
    after(run, SLIDE, 30);
    after(run, SPRINT, 60); // up, and back to the sprint: 91 ticks since the slide
    const v = Math.hypot(run.state.vx, run.state.vz);
    tick(run, SLIDE);
    expect(run.motion.sliding).toBe(true);
    expect(run.motion.slideBoost).toBe(0);
    expect(Math.hypot(run.state.vx, run.state.vz)).toBeCloseTo(slowed(v), 9);
    after(run, SLIDE, 20);
    after(run, SPRINT, 120 - 21);
    tick(run, SLIDE);
    expect(run.motion.slideBoost).toBeGreaterThan(0); // 120 ticks after the last: boosted again
  });

  it('gains g · n_y along the floor downhill, half before the walk and half after', () => {
    const run = sprinting();
    tick(run, SLIDE);
    const slope = (30 * Math.PI) / 180;
    const floor = [Math.sin(slope), Math.cos(slope), 0]; // falling away to the east
    tick(run, SLIDE, undefined, floor); // the floor is kept for the next tick
    const v = Math.hypot(run.state.vx, run.state.vz);
    const pull = 0.5 * G * DT * Math.cos(slope) * Math.sin(slope);
    expect(tick(run, SLIDE, undefined, floor)).toBeCloseTo(slowed(v + pull) + pull, 9);
  });

  it('jumps 1.27 m, a dead slide taking its fresh boost back and a slowing one jumping at 8.89 m/s', () => {
    const dead = sprinting();
    const v = tick(dead, SLIDE);
    tick(dead, { ...SLIDE, jump: true, jumpPressed: true });
    expect(dead.state.vy).toBeCloseTo(Math.sqrt(2 * G * 1.27) - G * DT, 9); // a tick of gravity after the take-off
    expect(dead.motion.sliding).toBe(false);
    expect(Math.hypot(dead.state.vx, dead.state.vz)).toBeCloseTo(v - dead.motion.slideBoost, 1);
    const kept = sprinting();
    let w = tick(kept, SLIDE);
    for (let i = 0; i < 14; i++) w = tick(kept, SLIDE); // its duck is done
    tick(kept, { ...SLIDE, jump: true, jumpPressed: true });
    expect(Math.hypot(kept.state.vx, kept.state.vz)).toBeCloseTo(w, 1);
    const long = sprinting();
    let u = tick(long, SLIDE);
    while (u > 8.6) u = tick(long, SLIDE);
    tick(long, { ...SLIDE, jump: true, jumpPressed: true });
    expect(Math.hypot(long.state.vx, long.state.vz)).toBeCloseTo(8.89, 6);
  });

  it('slides on a landing ducked at speed, and at 2.29 m/s across when falling at least 5.08 m/s', () => {
    const fast = createMotionState();
    Object.assign(fast, { duck: 'ducked', stance: 'crouch' });
    const h: [number, number] = [6, 0];
    tryStartSlide(model, fast, { h, normal: [0, 1, 0], air: true, vertical: -3, wish: [0, 0], view: null, scale: HOLSTERED, dt: DT }); // prettier-ignore
    expect([fast.sliding, h[0]]).toEqual([true, 6 + 3.81 * HOLSTERED]);
    const slow = createMotionState();
    const s: [number, number] = [3, 0];
    tryStartSlide(model, slow, { h: s, normal: [0, 1, 0], air: true, vertical: -6, wish: [0, 0], view: null, scale: 1, dt: DT }); // prettier-ignore
    expect(slow.sliding).toBe(true);
    const steep = createMotionState();
    tryStartSlide(model, steep, { h: [8, 0], normal: [0.8, 0.6, 0], air: true, vertical: -6, wish: [0, 0], view: null, scale: 1, dt: DT }); // prettier-ignore
    expect(steep.sliding).toBe(false); // too steep to stand on
  });
});
