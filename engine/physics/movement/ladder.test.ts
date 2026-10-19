/**
 * @file Unit tests for the shooter model's ladders (engine/physics/movement/ladder.ts) through the controller,
 * `movement:apex` holstered at 60 Hz: a 4 m block with a ladder up its west face. Running east into it takes hold,
 * the hull a gap off its face; forward climbs at 2.20 m/s and mantles over the top with the pull alone; use on the
 * top takes hold of it, the feet 1 m down, and back climbs down at 2.20 m/s to its foot, where it steps off; a jump
 * pushes it away at 3.05 m/s rising 0.5 m and a crouch lets go, neither taking hold again within the cooldown; a
 * crouched character takes no hold; one pushing past it, beside it, neither.
 * @see engine/physics/movement/ladder.ts
 */
import { describe, expect, it } from 'vitest';
import { addCharacter, createCharacter, createCharacterState, feetOf, stepCharacter, type CharacterInput } from '../character'; // prettier-ignore
import { createPhysics } from '../world';
import { createMotionState } from './model';
import type { RideLadder, Rides } from './ride';

const DT = 1 / 60;
const SETTINGS = { get: (path: string) => (path === 'physics.gravity' ? 9.81 : undefined) };
const APEX = createCharacter({ movement: 'movement:apex' });
const LADDER = { speed: 2.2035, top: 1, away: 3.048, jump: 0.5, gap: 0.1016 } as const;

/** The block's west face (m), its top, and the ladder on it, 0.1 m off the face, 1 m wide. */
const [FACE, TOP] = [5, 4];
const RUNGS: RideLadder = { id: 4, foot: [FACE - 0.1, 0, 0], top: TOP, normal: [-1, 0], width: 1 };
const RIDES: Rides = { cables: [], ladders: [RUNGS], launchers: [] };

/** The character at `at` by the block, settled; `tick` steps it and the world, `until` ticks until `done`. */
function rig(at: [number, number, number]) {
  const physics = createPhysics();
  const box = (size: [number, number, number], centre: [number, number, number]) => physics.addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size }, position: centre }] }); // prettier-ignore
  box([200, 1, 200], [0, -0.5, 0]);
  box([4, TOP, 6], [FACE + 2, TOP / 2, 0]);
  physics.step({ dt: DT, settings: SETTINGS });
  const body = addCharacter(physics, APEX, at);
  const [state, motion] = [createCharacterState(), createMotionState()];
  const tick = (input: CharacterInput = {}) => {
    stepCharacter(physics, body, APEX, state, input, { dt: DT, gravity: 32, rides: RIDES }, motion);
    physics.step({ dt: DT, settings: SETTINGS });
    return feetOf(physics, body, APEX);
  };
  for (let i = 0; i < 30 && !(state.grounded && state.air === 0); i++) tick();
  const until = (input: CharacterInput, done: () => boolean, most = 600) => {
    for (let k = 0; k < most; k++) {
      tick(input);
      if (done()) return k + 1;
    }
    throw new Error(`not done in ${most} ticks: ${motion.mode}/${motion.mantle}`);
  };
  return { physics, body, state, motion, tick, until, feet: () => feetOf(physics, body, APEX) };
}

const EAST: CharacterInput = { move: [1, 0], view: Math.PI / 2 };
const WEST: CharacterInput = { move: [-1, 0], view: Math.PI / 2 };

describe('ladders', () => {
  it('take hold of one run into, climb it at 2.20 m/s and pull over its top', () => {
    const run = rig([2, 0, 0]);
    run.until(EAST, () => run.motion.mode === 'ladder');
    const off = FACE - 0.1 - APEX.capsule.radius - LADDER.gap;
    run.tick(EAST);
    expect(run.feet().x).toBeCloseTo(off, 4);
    let top = 0;
    run.until(EAST, () => {
      top = Math.max(top, run.state.vy);
      return run.motion.mode !== 'ladder';
    });
    expect(top).toBeCloseTo(LADDER.speed, 9);
    expect([run.motion.mode, run.motion.mantle]).toEqual(['mantle', 'pull']); // the lip within the pull's reach
    run.until(EAST, () => run.state.grounded);
    expect(run.feet().y).toBeCloseTo(TOP, 2);
  });

  it('take hold of its top with use, climb down at 2.20 m/s and step off at its foot', () => {
    const run = rig([FACE + 0.6, TOP + 0.05, 0]);
    run.tick({ view: -Math.PI / 2 });
    expect(run.motion.mode).toBe('ground');
    run.tick({ view: -Math.PI / 2, usePressed: true });
    expect([run.motion.mode, run.motion.rideAt]).toEqual(['ladder', TOP - LADDER.top]);
    expect(run.feet().y).toBeCloseTo(TOP - LADDER.top, 4);
    let fall = 0;
    const ticks = run.until(WEST, () => {
      fall = Math.max(fall, -run.state.vy);
      return run.motion.mode !== 'ladder';
    });
    expect(fall).toBeCloseTo(LADDER.speed, 9);
    expect(ticks).toBe(Math.ceil((TOP - LADDER.top) / (LADDER.speed * DT)));
    run.until({}, () => run.state.grounded);
    expect(run.feet().y).toBeCloseTo(0, 2);
  });

  it('jumped off push away at 3.05 m/s rising 0.5 m; let go with a crouch; neither held again within the cooldown', () => {
    const jump = rig([2, 0, 0]);
    jump.until(EAST, () => jump.motion.mode === 'ladder');
    for (let k = 0; k < 40; k++) jump.tick(EAST);
    const from = jump.feet().y;
    jump.tick({ jumpPressed: true, jump: true });
    expect([jump.motion.mode, jump.state.vx]).toEqual(['air', expect.closeTo(-LADDER.away, 9)]);
    let top = from;
    jump.until({}, () => {
      top = Math.max(top, jump.feet().y);
      return jump.state.vy < 0;
    });
    expect(top - from).toBeCloseTo(LADDER.jump, 2);
    const drop = rig([2, 0, 0]);
    drop.until(EAST, () => drop.motion.mode === 'ladder');
    for (let k = 0; k < 10; k++) drop.tick(EAST); // low: the top's lip past the mantle's reach from the air
    drop.tick({ ...EAST, crouch: true });
    expect([drop.motion.mode, drop.motion.rideCool]).toEqual(['air', Math.round(0.25 / DT)]);
    drop.tick(EAST);
    expect(drop.motion.mode).toBe('air'); // pushing into it still: no hold within the cooldown
  });

  it('take no hold crouched, nor pushing past it beside it', () => {
    const crouched = rig([2, 0, 0]);
    for (let k = 0; k < 40; k++) crouched.tick({ crouch: true });
    expect(crouched.motion.stance).toBe('crouch');
    crouched.until({ ...EAST, crouch: true }, () => crouched.state.vx < 0.1 && crouched.feet().x > 4, 200);
    expect(crouched.motion.mode).toBe('ground');
    const beside = rig([2, 0, 2]);
    beside.until(EAST, () => beside.state.vx < 0.1 && beside.feet().x > 4, 200);
    expect(beside.motion.mode).toBe('ground');
  });
});
