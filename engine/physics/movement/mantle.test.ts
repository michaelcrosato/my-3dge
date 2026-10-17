/**
 * @file Unit tests for the mantle and the superglide (engine/physics/movement/mantle.ts) through the controller,
 * `movement:apex` holstered at 60 Hz, running or sprinting east at blocks whose near face stands at x = 8: holding
 * jump it mantles a 1.5 m block from the ground, the grab 27 ticks (0.45 s) and the pull 18 (0.3 s), landing on the
 * top at its run; a 0.9 m one only pulled, sprinting in and out; a 2.1 m one refused from the ground and taken from a
 * jump; letting go of forward in the grab hangs from a 3 m wall, forward going on and back letting go, and no hang
 * where the lip stands lower than 1.52 m over the ground; a top under a low roof mantled crouched; a jump hops out at
 * full height with no fatigue; the superglide (a jump in the pull's last 9 ticks, then crouch the next tick) leaves at
 * 1.8 × the holstered sprint, a crouch on the same tick or two ticks late none, within the slide boost's cooldown less
 * the boost; the mantle boost (its setting on) glides on a crouch press alone; no mantle within 0.25 s of the last; a
 * hop from the wall with forward held flies, neither climb nor mantle catching it; the hands go on the lip.
 * @see engine/physics/movement/mantle.ts
 */
import { describe, expect, it } from 'vitest';
import { addCharacter, createCharacter, createCharacterState, feetOf, stepCharacter, type Character, type CharacterInput } from '../character'; // prettier-ignore
import { createPhysics } from '../world';
import { handsOf } from './mantle';
import { createMotionState } from './model';
import { tuneCharacter } from './settings';

const DT = 1 / 60;
const SETTINGS = { get: (path: string) => (path === 'physics.gravity' ? 9.81 : undefined) };
const APEX = createCharacter({ movement: 'movement:apex' });
const [RUN, SPRINT] = [4.4069 * 1.15, 6.604 * 1.15];
/** The blocks' near face (m). */
const FACE = 8;

/** A box, `size` big, its centre at `at`. */
const box = (size: [number, number, number], at: [number, number, number]) => ({ type: 'fixed' as const, colliders: [{ shape: { type: 'box' as const, size }, position: at }] }); // prettier-ignore

/** A block `height` high and 2 m deep, its near face at x = FACE. */
const block = (height: number) => box([2, height, 4], [FACE + 1, height / 2, 0]);

/** `character`, holstered, at the origin on a floor beside `extra` boxes, settled; `tick` steps it and the world. */
function rig(extra: ReturnType<typeof box>[], character: Character = APEX) {
  const physics = createPhysics();
  physics.addBody(box([200, 1, 200], [0, -0.5, 0]));
  for (const body of extra) physics.addBody(body);
  physics.step({ dt: DT, settings: SETTINGS });
  const body = addCharacter(physics, character, [0, 0, 0]);
  const [state, motion] = [createCharacterState(), createMotionState()];
  const tick = (input: CharacterInput = {}) => {
    stepCharacter(physics, body, character, state, input, { dt: DT, gravity: 32 }, motion);
    physics.step({ dt: DT, settings: SETTINGS });
    return feetOf(physics, body, character);
  };
  for (let i = 0; i < 30 && !(state.grounded && state.air === 0); i++) tick();
  /** Ticks `input` (a function of the tick's count) until `done` holds or `most` ticks pass; returns the count. */
  const until = (input: (k: number) => CharacterInput, done: () => boolean, most = 400) => {
    for (let k = 0; k < most; k++) {
      tick(input(k));
      if (done()) return k + 1;
    }
    throw new Error(`not done in ${most} ticks: ${motion.mode}/${motion.mantle}`);
  };
  return { physics, body, state, motion, tick, until };
}

const EAST = { move: [1, 0], view: Math.PI / 2 } as const;

describe('the mantle', () => {
  it('takes a 1.5 m block from the ground holding jump: the grab 0.45 s, the pull 0.3 s, onto its top at the run', () => {
    const r = rig([block(1.5)]);
    r.until(
      () => ({ ...EAST, jump: true }),
      () => r.motion.mode === 'mantle',
    );
    expect(r.motion.mantle).toBe('grab');
    const grab = r.until(
      () => ({ ...EAST, jump: true }),
      () => r.motion.mantle === 'pull',
    );
    const pull = r.until(
      () => ({ ...EAST, jump: true }),
      () => r.motion.mode !== 'mantle',
    );
    expect([grab, pull]).toEqual([27, 18]); // the grab's first tick began it, the pull's first ended `grab`, the exit `pull`
    expect(r.motion.mode).toBe('ground');
    expect(feetOf(r.physics, r.body, APEX).y).toBeCloseTo(1.5, 2);
    expect(Math.hypot(r.state.vx, r.state.vz)).toBeCloseTo(RUN, 6);
    expect(r.motion.fatigued).toBe(false);
  });

  it('pulls a 0.9 m block over with no grab, sprinting in and sprinting out', () => {
    const r = rig([block(0.9)]);
    r.until(
      () => ({ ...EAST, jump: true, sprint: true }),
      () => r.motion.mode === 'mantle',
    );
    expect(r.motion.mantle).toBe('pull');
    expect(
      r.until(
        () => ({ ...EAST, jump: true, sprint: true }),
        () => r.motion.mode !== 'mantle',
      ),
    ).toBe(18); // the pull's 17 ticks after its first, then the exit
    expect(Math.hypot(r.state.vx, r.state.vz)).toBeCloseTo(SPRINT, 6);
    expect(r.motion.gait).toBe('sprint');
  });

  it('refuses a 2.1 m block from the ground, past the auto mantle’s 2.03 m, and takes it from a jump', () => {
    const r = rig([block(2.1)]);
    for (let k = 0; k < 120; k++) r.tick({ ...EAST, jump: true });
    expect([r.motion.mode, r.state.grounded]).toEqual(['ground', true]); // at the wall, holding jump
    r.tick({ ...EAST, jump: true, jumpPressed: true });
    expect(r.motion.mode).toBe('air');
    r.until(
      () => EAST,
      () => r.motion.mode === 'mantle',
      5,
    );
    r.until(
      () => EAST,
      () => r.motion.mode === 'ground',
    );
    expect(feetOf(r.physics, r.body, APEX).y).toBeCloseTo(2.1, 2);
  });

  it('hangs from a 3 m wall letting go of forward in the grab, goes on with forward, and lets go with back', () => {
    const jumpAt = (r: ReturnType<typeof rig>) => (k: number) => ({ ...EAST, sprint: true, jumpPressed: r.physics.readBody(r.body).position.x >= FACE - 2.6 && r.state.grounded && k > 0 }); // prettier-ignore
    const r = rig([block(3)]);
    r.until(jumpAt(r), () => r.motion.mantle === 'grab');
    for (let k = 0; k < 4; k++) r.tick(EAST);
    r.tick({ view: EAST.view });
    expect(r.motion.mantle).toBe('hang');
    const held = feetOf(r.physics, r.body, APEX).y;
    for (let k = 0; k < 60; k++) r.tick({ view: EAST.view });
    expect([r.motion.mantle, feetOf(r.physics, r.body, APEX).y]).toEqual(['hang', held]);
    r.until(
      () => EAST,
      () => r.motion.mode === 'ground',
    );
    expect(feetOf(r.physics, r.body, APEX).y).toBeCloseTo(3, 2);
    const back = rig([block(3)]);
    back.until(jumpAt(back), () => back.motion.mantle === 'grab');
    back.tick({ view: EAST.view });
    back.tick({ move: [-1, 0], view: EAST.view });
    expect(back.motion.mode).toBe('air');
    back.until(
      () => ({}),
      () => back.state.grounded,
    );
    expect(feetOf(back.physics, back.body, APEX).y).toBeCloseTo(0, 2);
  });

  it('never hangs where the lip stands lower than 1.52 m over the ground below: the grab goes on', () => {
    const r = rig([block(1.5)]);
    r.until(
      () => ({ ...EAST, jump: true }),
      () => r.motion.mode === 'mantle',
    );
    expect(r.motion.hangRoom).toBe(false);
    r.until(
      () => ({ view: EAST.view }),
      () => r.motion.mode === 'ground',
    );
    expect(feetOf(r.physics, r.body, APEX).y).toBeCloseTo(1.5, 2);
  });

  it('mantles crouched onto a top only the crouched hull fits on, under a low roof', () => {
    const r = rig([block(1), box([2, 0.2, 4], [FACE + 1, 2.5, 0])]); // 1.4 m clear over the top
    r.until(
      () => ({ ...EAST, jump: true }),
      () => r.motion.mode === 'mantle',
    );
    expect(r.motion.landCrouch).toBe(true);
    r.until(
      () => ({ ...EAST, jump: true }),
      () => r.motion.mode !== 'mantle',
    );
    expect([r.motion.stance, r.motion.gait]).toEqual(['crouch', 'crouch']);
    expect(feetOf(r.physics, r.body, APEX).y).toBeCloseTo(1, 2);
  });

  it('hops out at full height from the wall with forward held, in the grab and in the pull, caught by nothing', () => {
    for (const [phase, left] of [
      ['grab', 14],
      ['pull', 12],
    ] as const) {
      const r = rig([block(2)]);
      r.until(
        () => ({ ...EAST, jump: true }),
        () => r.motion.mantle === phase && r.motion.mantleLeft <= left,
      );
      r.tick({ ...EAST, jump: true, jumpPressed: true });
      expect([r.motion.mode, r.motion.mantle], phase).toEqual(['air', 'none']);
      expect(r.state.vy, phase).toBeCloseTo(APEX.jumpSpeed - APEX.characterGravity! * DT, 6);
      for (let k = 0; k < 10; k++) r.tick(EAST); // forward held at the wall: no climb, no mantle within the cooldown
      expect(r.motion.mode, phase).toBe('air');
      expect(r.state.vy, phase).toBeCloseTo(APEX.jumpSpeed - 11 * APEX.characterGravity! * DT, 6);
    }
  });

  it('puts the hands on the lip, a shoulder width apart along the edge', () => {
    const r = rig([block(1.5)]);
    r.until(
      () => ({ ...EAST, jump: true }),
      () => r.motion.mode === 'mantle',
    );
    const [left, right] = handsOf(r.motion, 0.4);
    expect([left[0], right[0]]).toEqual([r.motion.lipX, r.motion.lipX]); // the wall faces west: the edge runs north-south
    expect(right[2] - left[2]).toBeCloseTo(0.4, 9); // facing east, its left is north (−z), its right south
    expect([left[1], right[1]]).toEqual([r.motion.lipY, r.motion.lipY]);
  });

  it('hops out with a jump at full height, arming no fatigue, and waits 0.25 s before the next mantle', () => {
    const r = rig([block(1.5)]);
    r.until(
      () => ({ ...EAST, jump: true }),
      () => r.motion.mantle === 'grab',
    );
    r.tick({ ...EAST, jump: true, jumpPressed: true });
    expect([r.motion.mode, r.motion.fatigued, r.motion.mantleCool]).toEqual(['air', false, 15]);
    expect(r.state.vy).toBeCloseTo(APEX.jumpSpeed - APEX.characterGravity! * DT, 6);
  });
});

describe('the superglide', () => {
  /**
   * A sprint at the 1.5 m block holding jump, a jump `left` ticks before the pull ends and crouch `late` ticks after
   * (or crouch alone), its last slide begun `slid` ticks before the jump (none: −1).
   */
  function glideRun(late: number, left = 5, character: Character = APEX, crouchOnly = false, slid = -1) {
    const r = rig([block(1.5)], character);
    r.until(() => ({ ...EAST, jump: true, sprint: true }), () => r.motion.mantle === 'pull' && r.motion.mantleLeft <= left); // prettier-ignore
    r.motion.slideAge = slid;
    let k = 0;
    r.until(() => ({ ...EAST, jump: !crouchOnly, sprint: true, jumpPressed: !crouchOnly && k === 0, crouch: k++ >= (crouchOnly ? 0 : late) }), () => k > late + 2); // prettier-ignore
    if (r.motion.mode === 'mantle')
      r.until(
        () => ({ ...EAST, sprint: true }),
        () => r.motion.mode !== 'mantle',
      );
    return { r, speed: Math.hypot(r.state.vx, r.state.vz) };
  }

  it('leaves at 1.8 × the holstered sprint from a jump in the pull’s last 0.15 s and a crouch the next tick', () => {
    const { r, speed } = glideRun(1);
    expect(speed).toBeCloseTo(1.8 * SPRINT, 6); // 13.67 m/s: Apex's 540 u/s within 0.3%
    expect(r.motion.slideAge).toBeGreaterThanOrEqual(0); // the slide boost's cooldown started
    expect(glideRun(1, 5, APEX, false, 60).speed).toBeCloseTo(1.8 * SPRINT - 3.81 * 1.15, 6); // 1 s after a slide
  });

  it('is none with the crouch on the jump’s tick or two ticks after it, or with the jump before the window', () => {
    expect(glideRun(0).speed).toBeCloseTo(SPRINT, 6);
    expect(glideRun(2).speed).toBeCloseTo(SPRINT, 6);
    expect(glideRun(1, 12).speed).toBeCloseTo(SPRINT, 6); // the pull's last 9 ticks are the window
  });

  it('glides on a crouch press alone in the window with the mantle boost on, rising a full jump', () => {
    const boost = tuneCharacter(APEX, [['mantle', 'boost', true]]);
    const { r, speed } = glideRun(1, 5, boost, true);
    expect(speed).toBeCloseTo(1.8 * SPRINT, 6);
    expect(r.state.vy).toBeGreaterThan(APEX.jumpSpeed - 4 * APEX.characterGravity! * DT - 1e-6);
    expect(glideRun(1, 5, APEX, true).speed).toBeCloseTo(SPRINT, 6); // off by default
  });
});
