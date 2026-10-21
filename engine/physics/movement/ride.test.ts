/**
 * @file Unit tests for the shooter model's rides (engine/physics/movement/ride.ts) through the controller,
 * `movement:apex` holstered at 60 Hz on a floor: a cable's points and its ride span; use catches a sloped cable in
 * reach and in view (none out of reach, behind the view, or on the ground without use), rides it the way the view
 * looks at 10.16 m/s² to 15.24 m/s, its feet hanging 2.03 m under it, and lets go short of the far anchor keeping
 * half its speed; a cable in the hands' way in the air catches it unasked at 25.4 m/s², at most three times between
 * two touches of the ground, never within the cooldown; a jump off keeps the ride's speed across or leaves at 11.3 m/s
 * with a full jump, a crouch drops it at the ride's velocity; a body in the hull's way ends the ride short of it; a
 * vertical line goes up, and a balloon's launches the skydive: 20 m/s gliding, 35 diving, the landing pose 30 m up,
 * a landing with no stun; launchers set off a character on a model or not, from rest or a fall (the bounce), never
 * while it rises.
 * @see engine/physics/movement/ride.ts
 */
import { describe, expect, it } from 'vitest';
import { addCharacter, createCharacter, createCharacterState, feetOf, stepCharacter, type Character, type CharacterInput } from '../character'; // prettier-ignore
import { createPhysics } from '../world';
import { createMotionState } from './model';
import { cablePoint, nearestOnCable, type RideCable, type Rides } from './ride';

const DT = 1 / 60;
const G = 19.05;
const SETTINGS = { get: (path: string) => (path === 'physics.gravity' ? 9.81 : undefined) };
const APEX = createCharacter({ movement: 'movement:apex' });
const ZIP = { speed: 15.24, vertical: 12.192, accel: 10.16, jumpOn: 25.4, hang: 2.032, end: 0.6096 } as const;

/** A box, `size` big, its centre at `at`. */
const box = (size: [number, number, number], at: [number, number, number]) => ({ type: 'fixed' as const, colliders: [{ shape: { type: 'box' as const, size }, position: at }] }); // prettier-ignore

/** A cable from 3.5 m up north of the origin, south down to 2.5 m up 30 m on: the feet hang 1.47 m up, then 0.47. */
const SLOPED: RideCable = { id: 7, from: [0, 3.5, 1], to: [0, 2.5, 31], balloon: false };

/** The cable's length, and its share across the ground. */
const [LENGTH, ACROSS] = [Math.hypot(1, 30), 30 / Math.hypot(1, 30)];

/** `character`, holstered, standing at `at` on a floor beside `extra` boxes, the world's `rides`; `tick` steps it. */
function rig(
  rides: Rides,
  at: [number, number, number] = [0, 0, 0],
  extra: ReturnType<typeof box>[] = [],
  character: Character = APEX,
) {
  // prettier-ignore
  const physics = createPhysics();
  physics.addBody(box([400, 1, 400], [0, -0.5, 0]));
  for (const body of extra) physics.addBody(body);
  physics.step({ dt: DT, settings: SETTINGS });
  const body = addCharacter(physics, character, at);
  const [state, motion] = [createCharacterState(), createMotionState()];
  let launched = 0;
  const tick = (input: CharacterInput = {}) => {
    const step = stepCharacter(physics, body, character, state, input, { dt: DT, gravity: 32, rides }, character.movement ? motion : undefined); // prettier-ignore
    launched += step.launched ? 1 : 0;
    physics.step({ dt: DT, settings: SETTINGS });
    return feetOf(physics, body, character);
  };
  for (let i = 0; i < 30 && !(state.grounded && state.air === 0); i++) tick();
  /** Ticks `input` (a function of the tick's count) until `done` holds or `most` ticks pass; returns the count. */
  const until = (input: (k: number) => CharacterInput, done: () => boolean, most = 600) => {
    for (let k = 0; k < most; k++) {
      tick(input(k));
      if (done()) return k + 1;
    }
    throw new Error(`not done in ${most} ticks: ${motion.mode}`);
  };
  return { physics, body, state, motion, tick, until, launched: () => launched };
}

const NO: Rides = { cables: [], ladders: [], launchers: [] };
const SOUTH = { view: 0, pitch: 0 } as const;

describe('a cable', () => {
  it('has its points along it, and a ride span `end` short of each anchor', () => {
    expect(cablePoint(SLOPED, 0)).toEqual([0, 3.5, 1]);
    const [x, y, z] = cablePoint(SLOPED, LENGTH);
    expect([x, y, z].map((v) => +v.toFixed(9))).toEqual([0, 2.5, 31]);
    expect(nearestOnCable(SLOPED, [0, 0, -5], ZIP.end)?.at).toBeCloseTo(ZIP.end, 12); // clamped to the span
    expect(nearestOnCable({ ...SLOPED, to: [0, 3.5, 2] }, [0, 0, 0], ZIP.end)).toBeNull(); // 1 m: too short to ride
  });
});

describe('ziplines', () => {
  it('are caught by use in reach and in view, ridden down at 10.16 m/s² to 15.24 m/s, let go short of the far anchor', () => {
    const rides = { ...NO, cables: [SLOPED] };
    const run = rig(rides, [0.5, 0, 3]); // the cable 0.5 m west and 1.4 m over the hands: in reach
    run.tick({ ...SOUTH, view: -Math.PI / 2 });
    expect(run.motion.mode).toBe('ground'); // on the ground nothing catches without use
    run.tick({ ...SOUTH, view: Math.PI / 2, usePressed: true });
    expect(run.motion.mode).toBe('ground'); // the cable is behind the view
    run.tick({ ...SOUTH, usePressed: true });
    expect(run.motion.mode).toBe('ground'); // 90° off the view: past use's 35°
    const feet = run.tick({ ...SOUTH, view: -Math.PI / 2, usePressed: true }); // the view across the cable: it rides down
    expect([run.motion.mode, run.motion.ride, run.motion.rideDir, run.motion.rideAccel]).toEqual(['zipline', 7, 1, ZIP.accel]); // prettier-ignore
    const under = cablePoint(SLOPED, run.motion.rideAt);
    expect(feet.y).toBeCloseTo(under[1] - ZIP.hang, 4); // hanging from it
    for (let k = 0; k < 30; k++) run.tick(SOUTH);
    expect(run.motion.rideSpeed).toBeCloseTo((31 * ZIP.accel) / 60, 9);
    run.until(
      () => SOUTH,
      () => run.motion.rideSpeed >= ZIP.speed,
    );
    expect(run.motion.rideSpeed).toBe(ZIP.speed);
    const along = Math.hypot(run.state.vx, run.state.vy, run.state.vz);
    expect(along).toBeCloseTo(ZIP.speed, 9);
    run.until(
      () => SOUTH,
      () => run.motion.mode !== 'zipline',
    );
    expect(run.motion.rideAt).toBeGreaterThan(LENGTH - ZIP.end - (ZIP.speed / 60) * 1.01);
    expect(Math.hypot(run.state.vx, run.state.vz)).toBeCloseTo(ZIP.speed * 0.5 * ACROSS, 6); // half its speed
    expect(run.motion.rideCool).toBeGreaterThan(0);
  });

  it('out of reach: no catch', () => {
    const run = rig({ ...NO, cables: [SLOPED] }, [3, 0, 3]);
    run.tick({ ...SOUTH, view: -Math.PI / 2, usePressed: true });
    expect(run.motion.mode).toBe('ground');
  });

  it('catch one in the hands’ way in the air at 25.4 m/s², three times between two touches of the ground', () => {
    const vertical: RideCable = { id: 3, from: [0, 0, 0], to: [0, 40, 0], balloon: false };
    const run = rig({ ...NO, cables: [vertical] }, [0, 0, -0.75]); // out of the grab's 0.61 m standing
    expect(run.motion.mode).toBe('ground');
    run.tick({ move: [0, 1], jumpPressed: true, jump: true });
    run.until(
      () => ({ move: [0, 1] }),
      () => run.motion.mode === 'zipline',
      40,
    );
    expect([run.motion.rideAccel, run.motion.catches, run.motion.rideDir]).toEqual([ZIP.jumpOn, 1, 1]); // up, rising
    for (let k = 0; k < 30; k++) run.tick({});
    for (const catches of [2, 3]) {
      run.tick({ crouch: true });
      run.tick({});
      expect(run.motion.mode).toBe('air');
      const back = run.until(
        () => ({}),
        () => run.motion.mode === 'zipline',
        40,
      );
      expect(back).toBe(Math.round(0.25 / DT) - 1); // the cooldown, from the drop's tick
      expect(run.motion.catches).toBe(catches);
      run.tick({});
    }
    run.tick({ crouch: true });
    run.tick({});
    run.until(
      () => ({}),
      () => run.state.grounded,
    );
    expect(run.motion.catches).toBe(0); // the fourth refused: down to the ground, which starts the count again
  });

  it('jumped off keep their speed across, or leave a slow ride at 11.3 m/s, a full jump up; a crouch drops at the ride’s velocity', () => {
    const rides = { ...NO, cables: [SLOPED] };
    const fast = rig(rides, [0, 0, 3]);
    fast.tick({ ...SOUTH, usePressed: true });
    fast.until(
      () => SOUTH,
      () => fast.motion.rideSpeed >= ZIP.speed,
    );
    const across = ZIP.speed * ACROSS;
    fast.tick({ ...SOUTH, view: Math.PI / 2, jumpPressed: true, jump: true }); // looking across the cable
    expect([fast.motion.mode, Math.hypot(fast.state.vx, fast.state.vz)]).toEqual(['air', expect.closeTo(across, 9)]);
    expect(fast.state.vy).toBeCloseTo(APEX.jumpSpeed - G * DT, 9);
    const slow = rig(rides, [0, 0, 3]);
    slow.tick({ ...SOUTH, usePressed: true });
    for (let k = 0; k < 10; k++) slow.tick(SOUTH);
    slow.tick({ ...SOUTH, jumpPressed: true, jump: true });
    expect(Math.hypot(slow.state.vx, slow.state.vz)).toBeCloseTo(11.303, 9);
    const drop = rig(rides, [0, 0, 3]);
    drop.tick({ ...SOUTH, usePressed: true });
    for (let k = 0; k < 20; k++) drop.tick(SOUTH);
    const ride = drop.motion.rideSpeed;
    drop.tick({ ...SOUTH, crouch: true });
    expect(drop.state.vz).toBeCloseTo(ride * ACROSS, 9);
  });

  it('end short of a body in the hull’s way', () => {
    const wall = box([4, 4, 0.5], [0, 2, 12]); // across the line 11 m on
    const run = rig({ ...NO, cables: [SLOPED] }, [0, 0, 3], [wall]);
    run.tick({ ...SOUTH, usePressed: true });
    run.until(
      () => SOUTH,
      () => run.motion.mode !== 'zipline',
    );
    const feet = feetOf(run.physics, run.body, APEX);
    expect(feet.z).toBeLessThan(12 - 0.25 - APEX.capsule.radius + 0.01);
  });
});

describe('the redeploy balloon', () => {
  const balloon: RideCable = { id: 9, from: [0, 0, 0], to: [0, 70, 0], balloon: true };

  it('rides up its line at 12.19 m/s, launches the skydive: 20 m/s gliding, 35 diving, the landing pose 30 m up, no stun', () => {
    const run = rig({ ...NO, cables: [balloon] }, [0, 0, -0.8]);
    run.tick({ ...SOUTH, usePressed: true });
    expect([run.motion.mode, run.motion.rideDir]).toEqual(['zipline', 1]);
    run.until(
      () => SOUTH,
      () => run.motion.rideSpeed >= ZIP.vertical,
    );
    expect(run.state.vy).toBeCloseTo(ZIP.vertical, 9);
    run.until(
      () => SOUTH,
      () => run.motion.mode === 'skydive',
    );
    expect(run.state.vy).toBeCloseTo(15.24 - G * DT, 9);
    run.until(
      () => SOUTH,
      () => run.state.vy <= -20 + 1e-9,
    );
    for (let k = 0; k < 20; k++) run.tick(SOUTH);
    expect(run.state.vy).toBeCloseTo(-20, 9);
    let feet = feetOf(run.physics, run.body, APEX);
    run.until(
      () => ({ ...SOUTH, pitch: -Math.PI / 2 }),
      () => {
        feet = feetOf(run.physics, run.body, APEX);
        return run.motion.landing;
      },
    );
    expect(run.state.vy).toBeCloseTo(-35, 9);
    expect(feet.y).toBeLessThanOrEqual(30);
    expect(feet.y).toBeGreaterThan(30 - 35 * DT);
    run.until(
      () => SOUTH,
      () => run.state.grounded,
    );
    expect([run.motion.mode, run.motion.fall, run.motion.landing]).toEqual(['ground', 0, false]);
  });
});

describe('launchers', () => {
  const pad = { id: 2, top: 0, min: [-1, -0.05, 4] as const, max: [1, 0.3, 6] as const, velocity: [0, Math.sqrt(2 * G * 3), 0] as const, bounce: 0, keep: true }; // prettier-ignore

  it('set off a character on the model running onto them, keeping its speed across, to their height', () => {
    const run = rig({ ...NO, launchers: [pad] });
    let top = 0;
    run.until(
      () => ({ move: [0, 1] }),
      () => run.launched() > 0,
    );
    const across = Math.hypot(run.state.vx, run.state.vz);
    run.until(
      () => ({}),
      () => {
        top = Math.max(top, feetOf(run.physics, run.body, APEX).y);
        return run.state.vy < 0;
      },
    );
    expect(top).toBeCloseTo(3, 2);
    expect(across).toBeCloseTo(4.4069 * 1.15, 6);
  });

  it('set off a character without a model too, and bounce back a share of a fall onto them, never while it rises', () => {
    const platformer = createCharacter({ characterGravity: G });
    const trampoline = { ...pad, top: 0, min: [-1, -0.05, -1] as const, max: [1, 0.6, 1] as const, velocity: [0, Math.sqrt(2 * G * 1), 0] as const, bounce: 0.9 }; // prettier-ignore
    const run = rig({ ...NO, launchers: [trampoline] }, [0, 0, 0], [], platformer);
    expect(run.launched()).toBe(1); // from rest, as it stood there
    run.until(
      () => ({}),
      () => run.launched() === 2,
    ); // falling back onto it: bounced from a 1 m fall, its own speed wins
    let top = 0;
    run.until(
      () => ({}),
      () => {
        top = Math.max(top, feetOf(run.physics, run.body, platformer).y);
        return run.state.vy < 0;
      },
    );
    expect(top).toBeCloseTo(1, 2);
    expect(run.launched()).toBe(2); // never while it rose
  });
});
