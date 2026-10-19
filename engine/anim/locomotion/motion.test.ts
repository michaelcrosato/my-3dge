/**
 * @file Unit tests for what the movement tells the view's animation (engine/anim/locomotion/motion.ts, WP 13.10): the
 * foot plant locks only on the ground and never in a slide; the `MovementPose` eases the crouch and the slide at their
 * rates, shows the rise and the fall by the vertical speed, leans into an acceleration and banks into a turn, tilts a
 * slide toward the slope it is on, dips a landing, soft or hard by the speed it lands at, unwinds the dip as the body
 * leaves the ground again, and shows it all on a body.
 */
import { describe, expect, it } from 'vitest';
import { Animator } from '../character';
import { MOVEMENT_POSE, MovementPose, plantsFeet, type BodyView, type MotionView } from './motion';

const DT = 1 / 60;
/** `pose` stepped `ticks` times with the same motion and body. */
function hold(pose: MovementPose, ticks: number, motion: MotionView, body: BodyView) {
  for (let i = 0; i < ticks; i++) pose.update(motion, DT, body);
  return pose.shown;
}
const STILL: BodyView = { vx: 0, vy: 0, vz: 0, yaw: 0 };

describe('the movement the view shows', () => {
  it('lets the feet lock only on the ground and not sliding', () => {
    expect([plantsFeet(undefined), plantsFeet({ mode: 'ground' }), plantsFeet({})]).toEqual([true, true, true]);
    expect([plantsFeet({ mode: 'air' }), plantsFeet({ mode: 'ground', sliding: true })]).toEqual([false, false]);
  });

  it('eases the crouch and the slide at their rates', () => {
    const pose = new MovementPose();
    expect(pose.update({ duck: 'ducked' }, DT).shown.crouch).toBeCloseTo(MOVEMENT_POSE.crouch * DT, 12);
    expect(hold(pose, 60, { duck: 'ducking', sliding: true }, STILL)).toMatchObject({ crouch: 1, slide: 1 });
    expect(hold(pose, 60, { duck: 'standing' }, STILL)).toMatchObject({ crouch: 0, slide: 0 });
  });

  it('shows the rise and the fall by the vertical speed, in the air only', () => {
    expect(hold(new MovementPose(), 30, { mode: 'air' }, { ...STILL, vy: 16 }).fall).toBe(-1);
    expect(hold(new MovementPose(), 30, { mode: 'air' }, { ...STILL, vy: -4 }).fall).toBeCloseTo(0.5, 12);
    expect(hold(new MovementPose(), 30, { mode: 'ground' }, { ...STILL, vy: -4 }).fall).toBe(0);
  });

  it('leans forward into an acceleration, back as it brakes, and banks toward a turn', () => {
    const pose = new MovementPose();
    for (let i = 0; i < 30; i++) pose.update({ mode: 'ground' }, DT, { ...STILL, vz: i * 0.5 }); // 30 m/s² ahead
    expect(pose.shown.lean).toBe(MOVEMENT_POSE.leanMax);
    for (let i = 0; i < 30; i++) pose.update({ mode: 'ground' }, DT, { ...STILL, vz: 15 - i * 0.05 }); // 3 m/s² back
    expect(pose.shown.lean).toBeCloseTo(-Math.atan(3 / 9.81) / 2, 3);
    const turn = new MovementPose();
    for (let i = 0; i < 60; i++) {
      const heading = i * 0.05; // turning left at 3 rad/s, 5 m/s: 15 m/s² toward the left
      turn.update({ mode: 'ground' }, DT, {
        vx: 5 * Math.sin(heading),
        vz: 5 * Math.cos(heading),
        vy: 0,
        yaw: heading,
      });
    }
    expect(turn.shown.bank).toBeLessThan(-0.2);
  });

  it('tilts a slide toward the slope it slides on', () => {
    const down = Math.sin(0.5); // the ground's normal leaning 0.5 rad toward the way it faces: downhill ahead
    const slope = { mode: 'ground', sliding: true, floorX: 0, floorY: Math.cos(0.5), floorZ: down };
    expect(hold(new MovementPose(), 90, slope, STILL).pitch).toBeCloseTo(MOVEMENT_POSE.pitchShare * 0.5, 9);
    expect(hold(new MovementPose(), 90, { ...slope, sliding: false }, STILL).pitch).toBe(0);
  });

  it('dips a landing: none below the soft speed, a soft one after a jump, a hard one after a long fall', () => {
    const land = (speed: number) => {
      const pose = new MovementPose();
      pose.update({ mode: 'air' }, DT, { ...STILL, vy: -speed });
      const dips: number[] = [];
      for (let i = 0; i < 60; i++) dips.push(pose.update({ mode: 'ground' }, DT, STILL).shown.land);
      return { deepest: Math.max(...dips), last: dips.at(-1), hard: pose.shown.hard };
    };
    expect(land(MOVEMENT_POSE.softSpeed - 1).deepest).toBe(0);
    const soft = land(7.4); // a jump's 1.42 m under the playground's gravity: most of a dip, none of it hard
    const P = MOVEMENT_POSE;
    expect(soft.deepest).toBeCloseTo((7.4 - P.softSpeed) / (P.fullSpeed - P.softSpeed), 9);
    expect([soft.hard, soft.last]).toEqual([0, 0]);
    const hard = land(14);
    expect([hard.deepest, hard.hard]).toEqual([1, 1]);
  });

  it('unwinds a dip at once the body leaves the ground again, over MOVEMENT_POSE.landIn', () => {
    const pose = new MovementPose();
    pose.update({ mode: 'air' }, DT, { ...STILL, vy: -14 });
    expect(hold(pose, 12, { mode: 'ground' }, STILL).land).toBe(1); // deep in a hard dip…
    const air = { mode: 'air' };
    expect(hold(pose, 3, air, { ...STILL, vy: 7 }).land).toBeLessThan(1); // …jumping again, it rises at once
    expect(hold(pose, Math.ceil(MOVEMENT_POSE.landIn / DT) - 2, air, { ...STILL, vy: 7 }).land).toBe(0);
  });

  it('shows what it eased on a body, for its next pose', () => {
    const hero = new Animator({ build: 'build:adult' });
    const pose = new MovementPose();
    hold(pose, 30, { duck: 'ducked', sliding: true }, STILL);
    pose.apply(hero);
    expect(hero.body.shown).toEqual(pose.shown);
    expect(hero.body.shown).not.toBe(pose.shown);
  });
});
