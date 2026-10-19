/**
 * @file Unit tests for the movement states of the state matrix (engine/anim/locomotion/matrix.ts, WP 13.10): every
 * way the player moves is there; each runs on the adult with its feet planted, moving as fast as it says; the slide
 * shows on the body and lets no foot lock; the turn turns the body a whole turn and back to its facing; the fall
 * lands hard, its feet on the floor through the dip; each ends at rest; every gait's swinging toes clear the floor, a
 * run and a sprint fly, a strafe keeps its pelvis up (the visual review's third round).
 */
import { describe, expect, it } from 'vitest';
import { Animator } from '../character';
import { FootPlant } from '../footPlant';
import { stateMatrix } from '../stateMatrix';
import { jointPosition, socketPosition, tipPosition } from '../fk';
import { PROPORTIONS } from '../skeleton';
import { createCharacter } from '../../physics/character';
import { MATRIX_MOVE, MOVEMENT_STATES } from './matrix';
import { footCycle, plantedDuty } from './planted';

/** The adult with its feet planted, as the anim QA makes it (tools/qa/anim.ts `makeHumanoid`). */
const adult = (dt: number) => {
  const animator = new Animator({ build: 'build:adult', weapon: 'none', clock: 1, dt });
  new FootPlant().attach(animator);
  return animator;
};

describe('the movement states', () => {
  it('cover every way the player moves', () => {
    expect(Object.keys(MOVEMENT_STATES)).toEqual(['motion:walk', 'motion:run', 'motion:sprint', 'motion:back', 'motion:strafe', 'motion:crouchWalk', 'motion:slide', 'motion:jump', 'motion:fall', 'motion:stop', 'motion:turn']); // prettier-ignore
  });

  it('move at movement:apex’s holstered gaits, gravity and jump', () => {
    const apex = createCharacter({ movement: 'movement:apex' });
    const [model, holstered] = [apex.movement!, apex.movement!.gaits.holstered];
    for (const gait of ['walk', 'run', 'sprint', 'crouch'] as const) expect(MATRIX_MOVE[gait]).toBeCloseTo(model.gaits[gait] * holstered, 2); // prettier-ignore
    expect(MATRIX_MOVE.gravity).toBeCloseTo(apex.characterGravity!, 2);
    expect(MATRIX_MOVE.jump).toBeCloseTo(apex.jumpSpeed, 2);
  });

  it('move the body as fast as they say, and end at rest where they stopped', () => {
    const [run] = stateMatrix(adult, { states: { run: MOVEMENT_STATES['motion:run'] }, facings: [0] });
    const [from, to] = run.held;
    expect((run.positions[to - 1].z - run.positions[from].z) / ((to - 1 - from) * run.dt)).toBeCloseTo(5.068, 6);
    expect(run.positions.at(-1)!.distanceTo(run.positions[to])).toBeLessThan(0.1);
  });

  it('slide with the slide shown and no foot locked; turn a whole turn; fall into a hard landing', () => {
    const seen = { slide: 0, locks: true, yaw: 0, hard: 0 };
    const states = { slide: MOVEMENT_STATES['motion:slide'], turn: MOVEMENT_STATES['motion:turn'], fall: MOVEMENT_STATES['motion:fall'] }; // prettier-ignore
    stateMatrix(adult, {
      states,
      facings: [0],
      onStep: (animator, run) => {
        const plant = animator.layer('footPlant') as FootPlant;
        if (run.state === 'slide' && animator.body.shown.slide > 0.9) [seen.slide, seen.locks] = [1, plant.locks];
        if (run.state === 'turn') seen.yaw = Math.max(seen.yaw, animator.body.yaw);
        if (run.state === 'fall') seen.hard = Math.max(seen.hard, animator.body.shown.hard * animator.body.shown.land);
      },
    });
    expect(seen).toMatchObject({ slide: 1, locks: false, hard: 1 });
    expect(seen.yaw).toBeCloseTo(2 * Math.PI, 6);
  });

  it('swing every gait’s toes clear of the floor, fly at a run and a sprint, and strafe without sinking', () => {
    const gaits = ['walk', 'run', 'sprint', 'back', 'strafe', 'crouchWalk'] as const;
    const states = Object.fromEntries(gaits.map((g) => [g, MOVEMENT_STATES[`motion:${g}`]]));
    const seen = Object.fromEntries(gaits.map((g) => [g, { toe: Infinity, flight: 0, held: 0, pelvis: Infinity, rest: NaN }])); // prettier-ignore
    stateMatrix(adult, {
      states,
      facings: [2.2],
      onStep: (animator, run) => {
        const { skeleton, world, state } = animator.body;
        const at = run.positions.at(-1)!;
        const g = seen[run.state];
        const pelvis = jointPosition(world, 'pelvis').y - at.y;
        if (Number.isNaN(g.rest)) g.rest = pelvis;
        if (state.weights.speed < 0.3) return;
        const d = plantedDuty(state.weights.speed, state.weights.crouch);
        const low = (['L', 'R'] as const).map((side, i) => {
          const tip = tipPosition(skeleton, world, `toe${side}`).y - at.y;
          const u = (footCycle(state.phase, i === 1) - d) / (1 - d);
          if (u > 0.1 && u < 0.8) g.toe = Math.min(g.toe, tip);
          return Math.min(tip, jointPosition(world, `toe${side}`).y - at.y, socketPosition(skeleton, world, `contact${side}`).y - at.y); // prettier-ignore
        });
        g.held++;
        if (Math.min(...low) > 0.01) g.flight++;
        if (state.weights.speed > 0.9) g.pelvis = Math.min(g.pelvis, pelvis - g.rest);
      },
    });
    for (const g of gaits) expect(seen[g].toe, g).toBeGreaterThan(0.008); // the swing's toes 8 mm over the floor or more
    expect(seen.run.flight / seen.run.held).toBeGreaterThan(0.35); // both feet off the floor
    expect(seen.sprint.flight / seen.sprint.held).toBeGreaterThan(0.45);
    expect(seen.strafe.pelvis).toBeGreaterThan(seen.run.pelvis - 0.01); // its legs spread no further than a run's sink it
  });

  it('stand the fall’s feet on the floor through the hard landing, on their balls as the dip lifts their heels', () => {
    let [up, landed, low] = [false, 0, 0];
    stateMatrix(adult, {
      states: { fall: MOVEMENT_STATES['motion:fall'] },
      facings: [2.2],
      onStep: (animator, run) => {
        const { skeleton, world, shown } = animator.body;
        const y = run.positions.at(-1)!.y;
        up ||= y > 1;
        if (!up || y > 1e-4 || shown.land < 0.99) return; // landed, deep in the dip
        landed++;
        for (const side of ['L', 'R'] as const) {
          const ball = jointPosition(world, `toe${side}`).y - y - PROPORTIONS.ballHeight * skeleton.build.ankleHeight;
          low = Math.max(low, Math.min(ball, tipPosition(skeleton, world, `toe${side}`).y - y));
        }
      },
    });
    expect(landed).toBeGreaterThan(10);
    expect(low).toBeLessThan(0.005); // each foot down on its ball or its toes, not hovering
  });
});
