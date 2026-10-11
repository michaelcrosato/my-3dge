/**
 * @file The `anim` QA family in T1 (tools/qa/anim.ts, PLAN.md §8.6, WP 6.6, WP 8.7): every move, pose and action, the
 * humanoid, the blob and the floater pass against tests/baselines/qa-anim.json with no slack; the matrix holds every
 * state and action the engine names; and each motion metric catches a seeded fault and passes the sound case.
 * @see tools/qa/anim.ts
 */
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from '../../engine/core/math';
import type { MatrixRun } from '../../engine/anim/check';
import { ENGINE_MOVES } from '../../engine/anim/moves-data';
import { Pose } from '../../engine/anim/pose';
import { POSES, STANCES } from '../../engine/anim/poses';
import { createSkeleton } from '../../engine/anim/skeleton';
import { SAMPLE_STATES } from '../../engine/anim/states';
import { readBaselines, runQa } from '../cmd/qa';
import { ROOT } from '../x';
import family, {
  actionStates,
  animViolations,
  closure,
  footSlide,
  humanoidStates,
  limbs,
  motionTrack,
  pops,
} from './anim';

/** A track of one point, at `ys` heights and `xs` along X, the body standing at the origin. */
const line = (xs: number[], ys: number[] = xs.map(() => 0)) =>
  motionTrack({
    where: 'test',
    names: ['p'],
    world: xs.map((x, i) => [new Vector3(x, ys[i], 0)]),
    positions: xs.map(() => new Vector3()),
    feet: [0],
  });

/** A run of `poses` on the chibi skeleton, standing at the origin. */
const runOf = (poses: Pose[]): MatrixRun => ({
  state: 'test',
  facing: 0,
  dt: 1 / 60,
  skeleton: createSkeleton(),
  poses,
  positions: poses.map(() => new Vector3()),
  held: [0, poses.length],
  treadmill: new Vector3(),
});
const turn = (x: number, y: number, z: number, angle: number) =>
  new Quaternion().setFromAxisAngle(new Vector3(x, y, z).normalize(), angle);

describe('the anim QA family', () => {
  it('passes every move and pose, the humanoid, the blob and the floater against their baseline', async () => {
    const result = await runQa(ROOT, 'anim');
    expect(result.failures).toEqual([]);
    expect(result.warnings).toEqual([]);
    const { entries, failures } = readBaselines(ROOT, 'anim');
    expect(failures).toEqual([]);
    expect(result.accepted).toBe(entries.length);
  });

  it('holds every sample state, pose, stance, move, reaction and action the engine names', () => {
    const ids = Object.keys(humanoidStates());
    expect(ids.filter((id) => id.startsWith('action:'))).toEqual(Object.keys(actionStates())); // data/anim/actions/
    expect(ids).toEqual(expect.arrayContaining(['action:jump', 'action:grab', 'action:deathSink']));
    const poses = Object.keys(POSES).map((pose) => `pose:${pose}`);
    expect(ids).toEqual(expect.arrayContaining([...Object.keys(ENGINE_MOVES), ...poses, 'reaction:die']));
    expect(ids).toEqual(expect.arrayContaining(Object.keys(STANCES).map((stance) => `stance:${stance}`)));
    // a sample state that only holds a pose is that pose's id
    expect(ids).toContain('state:knockedDown');
    expect(ids).not.toContain('state:cheer');
    expect(Object.keys(SAMPLE_STATES).length).toBe(ids.filter((id) => id.startsWith('state:')).length + 4);
  });

  it('keeps the ids --only names, the blob and the floater included', async () => {
    const violations = await family.run({ root: ROOT, only: ['floater:', 'blob:'] });
    expect(violations).toEqual([]);
    expect(animViolations((id) => id === 'move:jab').map((v) => v.id)).toEqual(['move:jab']);
  });
});

describe('the motion metrics', () => {
  it('pops: a point that jumps in one step, not a fast steady sweep', () => {
    const jump = pops(line([0, 0, 0, 1, 1, 1]));
    expect(jump?.value).toBe(1);
    expect(jump?.message).toBe('test: p jumps 1 m in one step at frame 3 (0 and 0 m either side); ease into the pose');
    expect(pops(line([0, 0.7, 1.4, 2.1, 2.8, 3.5]))).toBeUndefined();
  });

  it('footSlide: a sole moving on the floor in one contact, not a lifted one, nor one riding a treadmill', () => {
    const sliding = Array.from({ length: 12 }, (_, i) => i * 0.01);
    expect(footSlide(line(sliding))?.value).toBeCloseTo(0.11, 12);
    expect(
      footSlide(
        line(
          sliding,
          sliding.map(() => 0.1),
        ),
      ),
    ).toBeUndefined();
    const belt = { ...line(sliding), treadmill: new Vector3(0.6, 0, 0), held: [0, 12] as const };
    expect(footSlide(belt)).toBeUndefined();
  });

  it('loopClosure: the last step against a resting body', () => {
    expect(closure(line([0, 0.3, 0.05]), line([0, 0, 0]))?.value).toBeCloseTo(0.05, 12);
    expect(closure(line([0, 0.3, 0.01]), line([0, 0, 0]))).toBeUndefined();
  });

  it('jointLimit: a knee bent the wrong way or off its hinge; twistJump: a folded arm rolling about itself', () => {
    const sound = new Pose().setRotation('shinL', turn(1, 0, 0, 1.2)).setRotation('forearmR', turn(0, 1, 0, 2.6));
    expect(limbs(runOf([sound, sound.clone()]), 'test')).toEqual({ limit: undefined, twist: undefined });
    const back = new Pose().setRotation('shinL', turn(1, 0, 0, -0.3));
    expect(limbs(runOf([back]), 'test').limit?.value).toBeCloseTo(0.3, 6);
    const twisted = new Pose().setRotation('shinL', turn(1, 0, 1, 0.5));
    expect(limbs(runOf([twisted]), 'test').limit?.message).toMatch(/^test: at frame 0, shinL turns 0\.\d+ rad off/);
    // the elbow folded 150°, then the upper arm rolls 170° about itself in one step
    const folded = new Pose().setRotation('forearmR', turn(0, 1, 0, 2.6));
    const rolled = folded.clone().setRotation('upperArmR', turn(1, 0, 0, 3));
    const { twist } = limbs(runOf([folded, rolled]), 'test');
    expect(twist?.value).toBeCloseTo(3, 6);
    expect(twist?.message).toMatch(
      /^test: at frame 1, upperArmR rolls 3 rad about itself in one step, folded 2\.6 rad/,
    );
  });
});
