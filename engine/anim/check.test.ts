/**
 * @file Unit tests for `anim.check` (engine/anim/check.ts): each pose check passes a sound pose and catches a broken
 * one, once per point, with the frame, the count and the worst value; the state matrix holds each state at each facing
 * from rest and back; `animCheckBody` passes the humanoid and catches a body that is not reproducible or not
 * rate-proof, naming the state.
 */
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from '../core/math';
import { Animator } from './character';
import { animCheck, animCheckBody } from './check';
import { rateDrift, runPoints, SHEET_CAMERAS, STATE_MATRIX, stateMatrix } from './stateMatrix';
import { Pose } from './pose';
import { SHEET_VIEWS } from './sheet';
import { createSkeleton, jointIndex, JOINTS } from './skeleton';
import { SAMPLE_STATES } from './states';
import { Attack } from './attack';
import type { AnimLayer } from './weights';

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

/** A heroic hero with a sword at step `dt`, its breathing clock fixed. */
const hero = (dt: number) => new Animator({ build: 'build:heroic', weapon: 'sword', clock: 1, dt });

/** A layer that turns the head by `turn` each time it is applied: once per pose, whatever the step. */
function nodding(turn: () => number): AnimLayer {
  let angle = 0;
  return {
    name: 'nod',
    weight: 1,
    apply: (animator) => {
      angle += turn();
      const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.sin(angle) * 0.6);
      animator.body.pose.setRotation('head', q.multiply(animator.body.pose.getRotation('head')));
    },
  };
}

describe('stateMatrix', () => {
  it('holds each state at each facing, from rest and back to rest, one pose per step', () => {
    const runs = stateMatrix(hero, { states: { wave: SAMPLE_STATES.wave, hurt: SAMPLE_STATES.hurt } });
    expect(runs.map((run) => [run.state, run.facing])).toEqual([
      ['wave', 0],
      ['wave', 2.2],
      ['hurt', 0],
      ['hurt', 2.2],
    ]);
    const [wave] = runs;
    expect(wave.held).toEqual([18, 54]); // 0.3 s of rest, the wave's 0.6 s
    expect(wave.poses.length).toBe(54 + 30); // and 0.5 s of rest after
    expect(wave.skeleton.height).toBe(2);
    // the body turns to the facing: its root's yaw
    const yaw = new Vector3(0, 0, 1).applyQuaternion(runs[1].poses[0].rootRot);
    expect(Math.atan2(yaw.x, yaw.z)).toBeCloseTo(2.2, 6);
  });

  it('turns a velocity to the facing, moving the ground point under the body; running in place is a treadmill', () => {
    const [dodge] = stateMatrix(hero, { states: { dodge: SAMPLE_STATES.dodge }, facings: [Math.PI / 2] });
    const end = dodge.positions.at(-1) as Vector3;
    expect(end.x).toBeCloseTo(13.75 * 9 * (1 / 60), 9); // 9 steps of a 13.75 m/s dash, along +X
    expect(end.z).toBeCloseTo(0, 9);
    expect(dodge.treadmill.length()).toBe(0);
    const [jump] = stateMatrix(hero, { states: { jump: SAMPLE_STATES.jump }, facings: [0] });
    expect(jump.positions[jump.held[0]].y).toBe(0.625);
    expect(jump.positions.at(-1)?.y).toBe(0);
    const [run] = stateMatrix(hero, { states: { run: SAMPLE_STATES.run }, facings: [Math.PI] });
    expect(run.treadmill.z).toBeCloseTo(hero(1 / 60).body.build.speedRef, 9); // the belt runs back, toward +Z
  });

  it('plays a script from the hold to the end of the run, and reports each step', () => {
    let steps = 0;
    const slash = {
      seconds: 0.4,
      script: () => {
        const attack = new Attack('move:slash');
        attack.start();
        return (dt: number) => {
          attack.update(dt);
          return attack.body ? { body: attack.body } : {};
        };
      },
    };
    const [run] = stateMatrix(hero, { states: { slash }, facings: [0], onStep: () => steps++ });
    expect(steps).toBe(run.poses.length);
    const arm = run.poses.map((pose) => pose.getRotation('upperArmR').angleTo(run.poses[0].getRotation('upperArmR')));
    expect(Math.max(...arm.slice(run.held[0]))).toBeGreaterThan(0.5); // the arm swings
    expect(arm.slice(0, run.held[0]).every((angle) => angle < 1e-3)).toBe(true); // and rests before
  });
});

describe('rateDrift', () => {
  it('measures what strays beyond a step of its own motion, at the moments both runs reach', () => {
    const line = (n: number, speed: number, k = 1) => Array.from({ length: n }, (_, i) => [new Vector3((i + 1) * speed * k, 0, 0)]); // prettier-ignore
    // a point moving 1 cm a step: half steps lie on the same line, no drift
    expect(rateDrift(line(10, 0.01), line(20, 0.005)).worst).toBe(0);
    // half steps moving twice as fast (a change per step, not per second): 0.4 m apart by the end
    const drift = rateDrift(line(10, 0.01), line(20, 0.01));
    expect(drift.frame).toBe(9);
    expect(drift.worst).toBeCloseTo(0.1 - 0.01, 9);
  });
});

describe('animCheckBody', () => {
  it('passes the humanoid through the sample states: sound poses, the same hashes twice, rate-proof', () => {
    const states = { idle: SAMPLE_STATES.idle, guard: SAMPLE_STATES.guard, cheer: SAMPLE_STATES.cheer, jump: SAMPLE_STATES.jump }; // prettier-ignore
    const report = animCheckBody(hero, { states });
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.runs.length).toBe(8);
    expect(report.frames).toBe(report.runs.reduce((sum, run) => sum + run.poses.length, 0));
    expect(runPoints(report.runs[0])[0].length).toBe(JOINTS.length + 8); // and the sockets
  });

  it('names the state of each pose problem', () => {
    const report = animCheckBody(hero, { states: { wave: SAMPLE_STATES.wave }, floor: 0.05, hash: false, rate: false });
    expect(report.ok).toBe(false);
    expect(report.problems[0]).toMatchObject({ check: 'floor', state: 'wave' });
    expect(report.problems[0].message).toMatch(/^wave facing 0: frame 0: toeL is 0\.0245 m below the floor/);
  });

  it('catches a body that poses differently the second time (module state)', () => {
    let calls = 0;
    const leaky = (dt: number) =>
      hero(dt).use(
        'additive',
        nodding(() => ++calls * 1e-3),
      );
    const report = animCheckBody(leaky, { states: { idle: SAMPLE_STATES.idle }, facings: [0], rate: false });
    expect(report.problems.map((p) => [p.check, p.state, p.frame])).toEqual([['hash', 'idle', 0]]);
    expect(report.problems[0].message).toMatch(/running it again gave another pose/);
  });

  it('catches a body that changes by a step, not by time (1/60 s against 1/120 s)', () => {
    const perStep = (dt: number) =>
      hero(dt).use(
        'additive',
        nodding(() => 0.2),
      );
    const report = animCheckBody(perStep, { states: { idle: SAMPLE_STATES.idle }, facings: [0], hash: false });
    expect(report.problems.map((p) => [p.check, p.state])).toEqual([['rate', 'idle']]);
    expect(report.problems[0].worst).toBeGreaterThan(STATE_MATRIX.rate);
    expect(report.problems[0].message).toMatch(/from where half steps put it.*scale each step's change by dt/);
    const perSecond = (dt: number) =>
      hero(dt).use(
        'additive',
        nodding(() => 12 * dt),
      );
    expect(animCheckBody(perSecond, { states: { idle: SAMPLE_STATES.idle }, facings: [0], hash: false }).ok).toBe(true);
    expect(jointIndex('head')).toBeGreaterThan(0);
  });
});

describe('SHEET_CAMERAS', () => {
  it("names anim.sheet()'s views only", () => {
    for (const views of Object.values(SHEET_CAMERAS))
      for (const view of views) expect(SHEET_VIEWS).toHaveProperty(view);
  });
});
