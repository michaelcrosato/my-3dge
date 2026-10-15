/**
 * @file Unit tests for effector-space authoring (engine/anim/authoring.ts, PLAN.md WP 3.6): `B`, `fru` and
 * `turnRight` against my-3d2dge's frame and `rz`; the spine solver beyond the reference vectors (a move's twist and
 * lean, a strafe's side lean: the hips turned, the shoulders on the old level line); and the leg solver's feet on the
 * floor in every standing state of four builds, the known dips listed with their reasons.
 */
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from '../core/math';
import { B, fromFRU, fru, turnRight } from './authoring';
import { animCheck } from './check';
import { jointPosition } from './fk';
import { Humanoid, type HumanoidInput } from './humanoid';

describe('authoring', () => {
  it('B writes forward, right and up in the model frame, and fru reads them back', () => {
    expect(B(1, 0, 0).toArray()).toEqual([-0, 0, 1]);
    expect(B(0, 1, 0).toArray()).toEqual([-1, 0, 0]);
    expect(B(0, 0, 1).toArray()).toEqual([-0, 1, 0]);
    expect(fru(B(0.25, 0.1375, 0.09375))).toEqual([0.25, 0.1375, 0.09375]);
    expect(fromFRU([0.25, -0.1375, 0.01875]).equals(B(0.25, -0.1375, 0.01875))).toBe(true);
  });

  it("turnRight is my-3d2dge's rz: a turn toward the right hand", () => {
    for (const a of [0.3, -1.1, 2.5]) {
      const [c, s] = [Math.cos(a), Math.sin(a)];
      const [f, r] = [0.3, -0.2];
      const old = [f * c - r * s, f * s + r * c]; // rz([f, r, 0], a)
      const turned = fru(B(f, r, 0).applyQuaternion(turnRight(a)));
      expect(turned[0]).toBeCloseTo(old[0], 12);
      expect(turned[1]).toBeCloseTo(old[1], 12);
    }
  });
});

/** Steps `hero` `steps` times with `input`. */
function run(hero: Humanoid, input: HumanoidInput, steps: number): Humanoid {
  for (let i = 0; i < steps; i++) hero.update(input);
  return hero;
}

/** The effector `p` (rig-local, before size) in world space, for a humanoid standing (not knocked down). */
const placed = (hero: Humanoid, p: Vector3) =>
  p
    .clone()
    .multiplyScalar(hero.build.size)
    .applyQuaternion(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), hero.yaw))
    .add(hero.position);

describe('the spine, beyond the vectors: a move twisting and leaning, a strafe leaning sideways', () => {
  const cases: [string, HumanoidInput][] = [
    ['a twist and a lean', { body: { twist: 0.6, lean: 0.3, lunge: 0.1 }, yaw: 1 }],
    ['a strafe', { velocity: new Vector3(4, 0, 0), yaw: 0 }],
    ['both, hunched', { velocity: new Vector3(-3, 0, 1), body: { twist: -0.5, lean: 0.2 }, yaw: 2 }],
  ];
  for (const [name, input] of cases) {
    it(`${name}: the hips turned, the shoulders on the old level line, the neck on the spine, the hands placed`, () => {
      const hero = run(
        new Humanoid({ build: name.includes('hunched') ? 'build:skeleton' : 'build:heroic' }),
        input,
        60,
      );
      const E = hero.effectors;
      for (const side of ['L', 'R'] as const) {
        expect(jointPosition(hero.world, `thigh${side}`).distanceTo(placed(hero, E.hips[side]))).toBeLessThan(1e-6);
        // the clavicles lift each shoulder onto the old level line, as near as their length allows (measured 3.5–7.7 mm)
        const shoulder = jointPosition(hero.world, `upperArm${side}`);
        expect(shoulder.distanceTo(placed(hero, E.shoulders[side]))).toBeLessThan(0.01);
        expect(jointPosition(hero.world, `hand${side}`).distanceTo(placed(hero, E.hands[side]))).toBeLessThan(1e-5);
      }
      expect(jointPosition(hero.world, 'neck').distanceTo(placed(hero, E.chest))).toBeLessThan(1e-6);
      expect(hero.state.body.twist === 0 || Math.abs(hero.state.body.twist) > 0.4).toBe(true);
    });
  }
});

describe('the feet on the floor', () => {
  /** The states whose feet stand on the floor, with what they are told. */
  const STANDING: Record<string, HumanoidInput> = {
    idle: {},
    walk: { velocity: new Vector3(0, 0, 2.5) },
    run: { velocity: new Vector3(0, 0, 5) },
    climb: { climb: true, velocity: new Vector3(0, 2, 0) },
    ...Object.fromEntries(['cheer', 'cast', 'wave', 'hips', 'block'].map((pose) => [pose, { pose }])),
    stanceGuard: { velocity: new Vector3(0, 0, 2.5), stance: 'guard' },
    stanceReady: { velocity: new Vector3(0, 0, 2.5), stance: 'ready' },
  };
  /**
   * Feet allowed below the floor, with the worst depth measured on the four builds and why. my-3d2dge stood its
   * foot point on the floor under a steep shin; a foot with a length then has its ball below it. The humanoid alone
   * keeps them; through an animator the foot plant (engine/anim/footPlant.ts's `FootPlant`, after G9) stands every one
   * on the floor (engine/anim/footPlant.test.ts).
   */
  const KNOWN: Record<string, [HumanoidInput, number]> = {
    kneel: [{ pose: 'kneel' }, 0.115], // the back foot's ball, its shin almost flat on the floor
    crouch: [{ pose: 'crouch' }, 0.05], // the back foot's ball, the heel lifted past the ankle's bend
    dash: [{ velocity: new Vector3(0, 0, 16), dash: true }, 0.07], // the trailing foot dragging its toes
    guard: [{ pose: 'guard' }, 0.008], // the back foot's ball, a few millimetres
  };
  const sink = (build: string, input: HumanoidInput) => {
    const hero = new Humanoid({ build, weapon: 'sword', clock: 1 });
    const poses = Array.from({ length: 120 }, () => hero.update({ position: new Vector3(), ...input }).pose.clone());
    const report = animCheck({ poses: poses.slice(30), skeleton: hero.skeleton });
    return Math.max(0, ...report.problems.filter((p) => p.check === 'floor').map((p) => p.worst));
  };

  for (const build of ['build:chibi', 'build:heroic', 'build:bulky', 'build:skeleton']) {
    it(`${build}: soles, balls and toe tips stay on or above the floor in every standing state`, () => {
      for (const [name, input] of Object.entries(STANDING)) expect(sink(build, input), name).toBe(0);
      for (const [name, [input, worst]] of Object.entries(KNOWN)) expect(sink(build, input), name).toBeLessThan(worst);
    });
  }
});
