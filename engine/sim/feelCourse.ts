/**
 * @file The feel course (PLAN.md WP 3.2, WP 13.3; doctrine: Agent-operable): `measureFeel(character)` drives a
 * character over a flat course in a world of its own through the feel meter (engine/physics/feel.ts) and adds the
 * reach (the highest ledge it jumps onto, WP 4.3's climb limit) and the dash's distance. For a character on the
 * shooter model (`character.movement`, engine/physics/movement/) it adds `motion`, what docs/PLAYGROUND.md §3.2
 * measures (`MotionFeel`). It runs under the sim's maths, so the numbers match in Node and Chromium.
 * `__engine.feel(id?)` (engine/app/feelMember.ts) reports it for an actor, the first player by default; `node x sim
 * <scene> --feel` prints it.
 *
 * The motion course, each number on a fresh course facing east (the view east too, so the sprint's 45° holds): a
 * gait's speed is its speed after 5 s of it; `accelerationTime` runs from rest to 90% of the run, `sprintTime` from the
 * first tick at the run to the full sprint, sprint held from rest, and `stopTime` from letting go of a
 * steady sprint to standing still; `fatigueApex` is the height of a jump pressed on the tick after a jump lands;
 * `strafeGain` is what a sprint jump gains air strafing, the move turned across the velocity every tick; `lurch` is
 * the change of velocity in the tick a side key is pressed 0.1 s into a sprint jump.
 *
 * Invariants: it never touches a scene's world; equal characters measure equal reports.
 * Moved out of engine/sim/actors.ts (WP 13.3, which keeps under its 400 lines).
 *
 * @example
 * import { createCharacter } from '../physics/character';
 * measureFeel(createCharacter({ movement: 'movement:apex' })).motion?.sprint; // 6.604
 * @see engine/physics/feel.test.ts
 * @see engine/sim/feelCourse.test.ts
 */
import { withSimMath } from '../core/simMath';
import {
  addCharacter,
  createCharacterState,
  feetOf,
  stepCharacter,
  type Character,
  type CharacterInput,
} from '../physics/character';
import { createFeelMeter, updateFeelMeter, type FeelReport, type MotionFeel } from '../physics/feel';
import { createMotionState } from '../physics/movement/model';
import { createPhysics } from '../physics/world';

/** How `measureFeel` runs: the sim's rate, and the gravity a character falls under unless its settings name one. */
export interface FeelOptions {
  hz?: number;
  gravity?: number;
}

/** A flat course: the character on a long floor, ticked with the meter reading every tick. */
function course(character: Character, dt: number, gravity: number, ledge?: number, holstered = false) {
  const physics = createPhysics();
  physics.addBody({
    type: 'fixed',
    colliders: [{ shape: { type: 'box', size: [400, 1, 40] }, position: [0, -0.5, 0] }],
  });
  const { radius } = character.capsule;
  if (ledge !== undefined && ledge > 0) {
    const face = radius + character.offset + 0.02;
    physics.addBody({
      type: 'fixed',
      colliders: [{ shape: { type: 'box', size: [4, ledge, 40] }, position: [face + 2, ledge / 2, 0] }],
    });
  }
  const body = addCharacter(physics, character, [0, 0, 0]);
  const state = createCharacterState();
  const motion = character.movement ? { ...createMotionState(), holstered } : undefined;
  const meter = createFeelMeter(dt);
  const settings = { get: (path: string) => (path === 'physics.gravity' ? 9.81 : undefined) };
  let tick = 0;
  const step = (input: CharacterInput) => {
    stepCharacter(physics, body, character, state, input, { dt, gravity }, motion);
    physics.step({ dt, settings });
    const feet = feetOf(physics, body, character);
    const sample = {
      tick: ++tick,
      wish: input.move ?? [0, 0],
      velocity: [state.vx, state.vy, state.vz],
      feet: [feet.x, feet.y, feet.z],
      grounded: state.grounded,
    } as const;
    updateFeelMeter(meter, sample);
    return sample;
  };
  /** Steps with `input` until `done` (or `most` ticks); returns the ticks it took. */
  const until = (input: CharacterInput, done: () => boolean, most = 600) => {
    let ticks = 0;
    for (; ticks < most && !done(); ticks++) step(input);
    return ticks;
  };
  const speed = () => Math.hypot(state.vx, state.vz);
  until({}, () => state.grounded && state.air === 0, 30);
  return { physics, state, meter, step, until, speed, feet: () => feetOf(physics, body, character) };
}

/** Measures a character's feel on the standard course (the file comment says what each number is). */
export function measureFeel(character: Character, options: FeelOptions = {}): FeelReport {
  return withSimMath(() => {
    const dt = 1 / (options.hz ?? 60);
    const gravity = character.characterGravity ?? options.gravity ?? 32;
    const east = { move: [1, 0] as const };
    const west = { move: [-1, 0] as const };
    const c = course(character, dt, gravity);
    const still = () => c.state.grounded && c.speed() < 0.01;
    const top = () => c.speed() >= c.meter.report.topSpeed * 0.999;
    c.until(east, () => c.meter.steady);
    c.until({}, still);
    c.until(east, top);
    c.until(west, () => c.meter.turn === null && c.meter.report.turnTime > 0, 300);
    c.until({}, still);
    c.step({ jump: true, jumpPressed: true });
    c.until({ jump: true }, () => c.state.grounded);
    const { apex, airTime } = c.meter.report;
    c.until({}, still);
    c.until(east, top);
    c.step({ ...east, jump: true, jumpPressed: true });
    c.until({ ...east, jump: true }, () => c.state.grounded);
    c.until({}, still);
    const before = c.feet();
    c.step({ dashPressed: true });
    c.until({}, () => c.state.dash === 0, 600);
    const after = c.feet();
    const dashDistance = character.feel.dash.speed > 0 ? Math.hypot(after.x - before.x, after.z - before.z) : 0;
    c.physics.dispose();
    const report = { ...c.meter.report, apex, airTime, reach: reachOf(character, dt, gravity, apex), dashDistance };
    return character.movement ? { ...report, motion: measureMotion(character, dt, gravity) } : report;
  });
}

/** The motion course (see the file comment). */
function measureMotion(character: Character, dt: number, gravity: number): MotionFeel {
  const ahead: CharacterInput = { move: [1, 0], view: Math.PI / 2 };
  const sprint = { ...ahead, sprint: true };
  const run = (input: CharacterInput, holstered = false) => {
    const c = course(character, dt, gravity, undefined, holstered);
    c.until(input, () => false, 300);
    c.physics.dispose();
    return c.speed();
  };
  const runSpeed = run(ahead);
  const sprintSpeed = run(sprint);
  const timed = course(character, dt, gravity);
  const accelerationTime = timed.until(ahead, () => timed.speed() >= 0.9 * runSpeed) * dt;
  timed.physics.dispose();
  const fast = course(character, dt, gravity);
  fast.until(sprint, () => fast.speed() >= runSpeed - 1e-9);
  const sprintTime = fast.until(sprint, () => fast.speed() >= sprintSpeed - 1e-9) * dt;
  fast.until(sprint, () => false, 120);
  const stopTime = fast.until({}, () => fast.speed() < 1e-6) * dt;
  fast.physics.dispose();
  const tired = course(character, dt, gravity);
  tired.step({ jump: true, jumpPressed: true });
  tired.until({ jump: true }, () => tired.state.grounded);
  const ground = tired.feet().y;
  tired.step({ jump: true, jumpPressed: true });
  let fatigueApex = 0;
  tired.until({ jump: true }, () => {
    fatigueApex = Math.max(fatigueApex, tired.feet().y - ground);
    return tired.state.grounded;
  });
  tired.physics.dispose();
  const strafe = course(character, dt, gravity);
  strafe.until(sprint, () => false, 300);
  const launch = strafe.speed();
  const across = (): [number, number] => [-strafe.state.vz / strafe.speed(), strafe.state.vx / strafe.speed()];
  strafe.step({ move: across(), jump: true, jumpPressed: true }); // the key with the jump: no lurch
  for (let i = 0; i < 600 && !strafe.state.grounded; i++) {
    strafe.step({ move: across() });
  }
  const strafeGain = strafe.speed() - launch;
  strafe.physics.dispose();
  const lurching = course(character, dt, gravity);
  lurching.until(sprint, () => false, 300);
  lurching.step({ ...sprint, jump: true, jumpPressed: true });
  for (let i = 0; i < 6; i++) lurching.step({ move: [1, 0] });
  const [vx, vz] = [lurching.state.vx, lurching.state.vz];
  lurching.step({ move: [0, 1] });
  const lurch = Math.hypot(lurching.state.vx - vx, lurching.state.vz - vz);
  lurching.physics.dispose();
  return {
    run: runSpeed,
    sprint: sprintSpeed,
    walk: run({ ...ahead, walk: true }),
    crouch: run({ ...ahead, crouch: true }),
    runHolstered: run(ahead, true),
    sprintHolstered: run(sprint, true),
    crouchHolstered: run({ ...ahead, crouch: true }, true),
    accelerationTime,
    sprintTime,
    stopTime,
    fatigueApex,
    strafeGain,
    lurch,
  };
}

/** The highest ledge the character jumps up onto from standing at its foot, to the millimetre. */
function reachOf(character: Character, dt: number, gravity: number, apex: number): number {
  const onto = (ledge: number) => {
    const c = course(character, dt, gravity, ledge);
    c.step({ move: [1, 0], jump: true, jumpPressed: true });
    c.until({ move: [1, 0], jump: true }, () => c.state.grounded, 600);
    c.until({ move: [1, 0] }, () => false, 20);
    const sample = c.step({});
    c.physics.dispose();
    return sample.grounded && sample.feet[1] > ledge - 0.01;
  };
  let [low, high] = [0, apex + character.capsule.radius + 0.5];
  while (high - low > 0.001) {
    const mid = (low + high) / 2;
    if (onto(mid)) low = mid;
    else high = mid;
  }
  return Math.round(low * 1000) / 1000;
}
