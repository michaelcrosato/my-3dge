/**
 * @file Unit tests for a tick of the shooter model through the character controller (engine/physics/movement/steer.ts
 * in engine/physics/character.ts's `stepCharacter`), on a flat floor with a 2 m ledge at 60 Hz: a standing jump peaks
 * at 1.42 m; a jump on the tick a jump lands goes 0.3 as high, walking off the ledge clears that, and so does waiting
 * 0.75 s; a high fall lands to a stop and keeps the sprint off until it has recovered to 0.7, a low one keeps its
 * speed; a bunny hop costs 2.54 m/s down to the sprint's speed; coyote time lets a jump off the ledge's edge but not a
 * second jump; a new key lurches, a view turning alone never does; it turns toward where it faces at 720°/s; and a
 * character with a model stepped without its motion state is refused, naming the fix.
 * @see engine/physics/movement/steer.ts
 */
import { describe, expect, it } from 'vitest';
import { addCharacter, createCharacter, createCharacterState, feetOf, stepCharacter, type CharacterInput } from '../character'; // prettier-ignore
import { createPhysics } from '../world';
import { createMotionState } from './model';

const DT = 1 / 60;
const SETTINGS = { get: (path: string) => (path === 'physics.gravity' ? 9.81 : undefined) };
const apex = createCharacter({ movement: 'movement:apex' });

/** A `movement:apex` character at `at` on a floor 200 m wide with a 2 m ledge from x = 10 on, settled. */
function rig(at: readonly [number, number, number] = [0, 0, 0]) {
  const physics = createPhysics();
  physics.addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [200, 1, 200] }, position: [0, -0.5, 0] }] }); // prettier-ignore
  physics.addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [20, 2, 20] }, position: [20, 1, 0] }] });
  physics.step({ dt: DT, settings: SETTINGS });
  const body = addCharacter(physics, apex, at);
  const [state, motion] = [createCharacterState(), createMotionState()];
  motion.holstered = false;
  const tick = (input: CharacterInput = {}) => {
    const step = stepCharacter(physics, body, apex, state, input, { dt: DT, gravity: 32 }, motion);
    physics.step({ dt: DT, settings: SETTINGS });
    return { ...step, feet: feetOf(physics, body, apex) };
  };
  /** Ticks `input` until `done` holds (at most `most` ticks); returns the highest feet reached. */
  const until = (input: CharacterInput, done: () => boolean, most = 600) => {
    let top = -Infinity;
    for (let i = 0; i < most && !done(); i++) top = Math.max(top, tick(input).feet.y);
    return top;
  };
  until({}, () => state.grounded && state.air === 0, 30);
  return { physics, body, state, motion, tick, until };
}

describe('the shooter model through the controller', () => {
  it('jumps 1.42 m from standing (56 u, ±2 cm)', () => {
    const r = rig();
    r.tick({ jump: true, jumpPressed: true });
    const top = r.until({ jump: true }, () => r.state.grounded);
    expect(Math.abs(top - 1.4224)).toBeLessThanOrEqual(0.02);
  });

  it('jumps 0.3 as high just after a jump lands, and fully again 0.75 s after', () => {
    const r = rig();
    r.tick({ jump: true, jumpPressed: true });
    r.until({ jump: true }, () => r.state.grounded);
    r.tick({ jump: true, jumpPressed: true });
    const low = r.until({ jump: true }, () => r.state.grounded);
    expect(Math.abs(low - 0.3 * 1.4224)).toBeLessThanOrEqual(0.02);
    r.until({}, () => r.motion.landAge * DT >= 0.75);
    r.tick({ jump: true, jumpPressed: true });
    expect(Math.abs(r.until({ jump: true }, () => r.state.grounded) - 1.4224)).toBeLessThanOrEqual(0.02);
  });

  it('jumps fully after walking off a ledge, and lets a jump off the edge within the 0.2 s grace, not a second one', () => {
    const r = rig([12, 2, 0]);
    r.tick({ jump: true, jumpPressed: true });
    r.until({}, () => r.state.grounded);
    r.until({ move: [1, 0] }, () => !r.state.grounded, 600); // off the ledge's far edge at x = 30
    for (let i = 0; i < 6; i++) r.tick({ move: [1, 0] }); // 0.1 s into the fall: within the grace
    const jumped = r.tick({ move: [1, 0], jump: true, jumpPressed: true }).jumped;
    expect(jumped).toBe(true);
    for (let i = 0; i < 4; i++) r.tick({ move: [1, 0] });
    expect(r.tick({ move: [1, 0], jump: true, jumpPressed: true }).jumped).toBe(false); // no coyote jump after a jump
    r.until({ move: [1, 0] }, () => r.state.grounded);
    expect(r.motion.fatigued).toBe(true);
    const flat = rig([25, 2, 0]);
    flat.until({ move: [1, 0] }, () => !flat.state.grounded, 600);
    flat.until({}, () => flat.state.grounded);
    expect(flat.motion.fatigued).toBe(false); // walked off: the next jump is full
  });

  it('lands a 25 m fall to a stop, with no sprint until it has recovered to 0.7, and keeps its speed from 5 m', () => {
    const high = rig([0, 25, 0]);
    Object.assign(high.state, { vx: 5 });
    high.until({}, () => high.state.grounded);
    expect(Math.hypot(high.state.vx, high.state.vz)).toBeLessThan(1e-6);
    const sprint = { move: [1, 0] as const, view: Math.PI / 2, sprint: true };
    let blocked = 0;
    while (!high.motion.sprinting && blocked < 120) [blocked] = [blocked + 1, high.tick(sprint)];
    expect(blocked * DT).toBeGreaterThan(0.8); // (t / 1 s)² reaches 0.7 at 0.84 s
    const low = rig([0, 5, 0]);
    Object.assign(low.state, { vx: 5 });
    low.until({}, () => low.state.grounded);
    expect(low.state.vx).toBeGreaterThan(4.9);
  });

  it('costs a bunny hop 2.54 m/s, never below the sprint speed', () => {
    const r = rig([0, 0.3, 0]);
    Object.assign(r.state, { vx: 9, grounded: false });
    r.until({ move: [1, 0] }, () => r.state.grounded);
    const landed = r.state.vx;
    r.tick({ move: [1, 0], jump: true, jumpPressed: true });
    expect(r.state.vx).toBeCloseTo(Math.max(6.604, landed - 2.54), 1);
  });

  it('lurches on a new key in its keys’ frame (the camera’s), never for the view turning alone', () => {
    const turn = (frames: boolean) => {
      const r = rig([-60, 0, 0]); // 70 m of floor before the ledge
      const ahead = (yaw: number): CharacterInput => ({ move: [Math.sin(yaw), Math.cos(yaw)], view: yaw, ...(frames ? { frame: yaw } : {}) }); // prettier-ignore
      r.until({ ...ahead(Math.PI / 2), sprint: true }, () => false, 120);
      r.tick({ ...ahead(Math.PI / 2), jump: true, jumpPressed: true });
      r.tick(ahead(Math.PI / 2));
      const before = Math.atan2(r.state.vx, r.state.vz);
      r.tick(ahead(Math.PI / 2 - Math.PI / 6)); // W held as the camera turns 30° in one tick
      return Math.abs(Math.atan2(r.state.vx, r.state.vz) - before);
    };
    expect(turn(true)).toBeLessThan(0.01); // the keys stayed W: air control alone, a hair
    expect(turn(false)).toBeGreaterThan(0.3); // no frame: the move turned 30° in the world, a new key
  });

  it('refuses a character with a model stepped without its motion state, naming the fix', () => {
    const r = rig();
    expect(() => stepCharacter(r.physics, r.body, apex, r.state, {}, { dt: DT, gravity: 32 })).toThrow(/PHYSICS_BAD_ARGUMENT[\s\S]*MotionState/); // prettier-ignore
  });

  it('turns toward where it faces at 720°/s', () => {
    const r = rig();
    r.tick({ face: Math.PI });
    expect(r.state.yaw).toBeCloseTo((720 * Math.PI) / 180 / 60, 9);
    for (let i = 0; i < 20; i++) r.tick({ face: Math.PI });
    expect(Math.abs(r.state.yaw)).toBeCloseTo(Math.PI, 9);
  });
});
