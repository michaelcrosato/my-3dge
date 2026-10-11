/**
 * @file Unit tests for the core of `anim.check` (engine/anim/check.ts): each check passes a sound pose and catches a
 * broken one, once per point, with the frame, the count and the worst value.
 */
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from '../core/math';
import { animCheck } from './check';
import { Pose } from './pose';
import { createSkeleton, JOINTS } from './skeleton';

/** A rotation of `angle` radians about `axis`. */
const turn = (x: number, y: number, z: number, angle: number) =>
  new Quaternion().setFromAxisAngle(new Vector3(x, y, z).normalize(), angle);

/** Arms down at the sides, slightly bent: a sound pose. */
const armsDown = () =>
  new Pose()
    .setRotation('upperArmL', turn(0, 0, 1, -1.3))
    .setRotation('upperArmR', turn(0, 0, 1, 1.3))
    .setRotation('forearmL', turn(0, 1, 0, -0.3))
    .setRotation('forearmR', turn(0, 1, 0, 0.3));

describe('animCheck', () => {
  it('passes sound poses on every build, turned and squashed', () => {
    for (const build of ['build:chibi', 'build:heroic', 'build:bulky', 'build:skeleton']) {
      const turned = armsDown();
      turned.rootRot.copy(turn(0, 1, 0, 2));
      turned.rootPos.set(4, 0, -3);
      const squashed = armsDown();
      squashed.rootScale.set(1.2, 0.7, 1.2);
      const report = animCheck({ poses: [new Pose(), armsDown(), turned, squashed], skeleton: build });
      expect(report, build).toEqual({ ok: true, frames: 4, problems: [] });
    }
  });

  it('reports values that are not finite, naming the channel', () => {
    const pose = new Pose();
    pose.local[JOINTS.indexOf('shinL') * 4 + 1] = NaN;
    const scaled = new Pose();
    scaled.rootScale.set(1, 0, 1);
    const report = animCheck({ poses: [new Pose(), pose, scaled] });
    expect(report.ok).toBe(false);
    expect(report.problems.map((p) => [p.check, p.point, p.frame])).toEqual([
      ['finite', 'shinL', 1],
      ['finite', 'rootScale', 2],
    ]);
    expect(report.problems[0].message).toBe('frame 1: shinL holds NaN; every value must be a finite number');
  });

  it('blames stretched bones on the rotation that is not a unit quaternion, once', () => {
    const pose = armsDown().setRotation('upperArmL', new Quaternion(0, 0, -0.9, 0.9));
    const report = animCheck({ poses: [pose, pose.clone()] });
    expect(report.problems.map((p) => [p.check, p.point])).toEqual([['length', 'upperArmL']]);
    const [problem] = report.problems;
    expect(problem.frames).toBe(2);
    expect(problem.message).toMatch(
      /the rotation of upperArmL has length 1\.2728, not 1; normalize it \(2 frames, worst/,
    );
    // a leaf's rotation stretches its tip and sockets
    const head = animCheck({ poses: [new Pose().setRotation('head', new Quaternion(0.3, 0, 0, 1))] });
    expect(head.problems.map((p) => [p.check, p.point])).toEqual([['length', 'head']]);
    // float32 storage of unit quaternions is within tolerance
    expect(animCheck({ poses: [new Pose().setRotation('head', turn(1, 2, 3, 0.7))] }).ok).toBe(true);
  });

  it('holds declared rigid pairs to their first distance, or the one given', () => {
    const grip = (angle: number) =>
      armsDown()
        .setRotation('forearmL', turn(0, 1, 0, angle))
        .setRotation('forearmR', turn(0, 1, 0, -angle));
    const together = animCheck({ poses: [grip(-1), grip(-1)], rigid: [['handL', 'handR']] });
    expect(together.ok).toBe(true);
    const apart = animCheck({ poses: [grip(-1), grip(-1.2), grip(-0.8)], rigid: [['weaponL', 'weaponR']] });
    expect(apart.problems.map((p) => [p.check, p.point, p.frame, p.frames])).toEqual([
      ['rigid', 'weaponL-weaponR', 1, 2],
    ]);
    const skeleton = createSkeleton();
    const given = animCheck({ poses: [new Pose()], rigid: [['root', 'pelvis', 0.75]], skeleton });
    expect(given.ok).toBe(true);
    const wrong = animCheck({ poses: [new Pose()], rigid: [['root', 'pelvis', 0.7]], skeleton });
    expect(wrong.problems[0].message).toBe(
      'frame 0: root and pelvis are 0.75 m apart, not 0.7; a rigid pair keeps its distance',
    );
    expect(() => animCheck({ poses: [], rigid: [['handL', 'hnadR' as never]] })).toThrow(
      /ANIM_UNKNOWN_POINT.*did you mean "handR"/,
    );
  });

  it('keeps the feet at or above the floor', () => {
    const sunk = new Pose();
    sunk.rootPos.y = -0.05;
    const report = animCheck({ poses: [sunk] });
    expect(report.problems.map((p) => p.point)).toEqual([
      'toeL',
      'toeR',
      'toeL tip',
      'toeR tip',
      'contactL',
      'contactR',
    ]);
    expect(report.problems.find((p) => p.point === 'contactL')?.worst).toBeCloseTo(0.05, 12);
    // a raised floor, and a kick: the foot well above the floor is fine
    expect(animCheck({ poses: [new Pose()], floor: 0.0005 }).ok).toBe(true);
    expect(animCheck({ poses: [new Pose()], floor: 0.01 }).ok).toBe(false);
    const kick = new Pose().setRotation('thighR', turn(1, 0, 0, -1.4));
    expect(animCheck({ poses: [kick] }).ok).toBe(true);
    // the toes dug in: the foot pitched down past the floor
    const pointed = new Pose().setRotation('footL', turn(1, 0, 0, 0.9));
    expect(animCheck({ poses: [pointed] }).problems.map((p) => p.point)).toContain('toeL tip');
  });

  it('keeps sockets in reach of the root', () => {
    const blown = new Pose();
    blown.setRotation('chest', new Quaternion(3, 0, 0, 0)); // not a unit quaternion: it stretches the neck 17-fold
    const report = animCheck({ poses: [blown] });
    expect(report.problems.some((p) => p.check === 'reach' && p.point === 'headTop')).toBe(true);
    const big = new Pose();
    big.rootScale.set(3, 3, 3);
    expect(animCheck({ poses: [big] }).ok).toBe(true);
  });
});
