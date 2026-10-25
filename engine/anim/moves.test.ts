/**
 * @file Unit tests for moves on a body (engine/anim/moves.ts), PLAN.md WP 6.1's Done when: all 24 moves pass the
 * differential tests against my-3d2dge's reference vectors (tests/baselines/port/moves.json, converted to SI), the
 * hands' and the blade tip's paths over u within 1 cm on average and 3 cm at worst, each exception listed with its
 * reason. Also: a humanoid and an animator playing moves (bone lengths, a solve from the state alone, a spin's turn,
 * the body's lunge only with root motion `'visual'`, the sim's state the same whether or not it was posed, a precise
 * trail), `moveAt`, `measureMove` and its cache,
 * `inArc`, `inHitShape`, `knockbackVelocity` and the strike's span, read from an animator only with `preciseHits`.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { Vector3 } from '../core/math';
import { TRAIL } from './character';
import { animCheck } from './check';
import { jointPosition, jointRotation, jointToWorld } from './fk';
import { ENGINE_MOVES, getMove, MOVE_PHASES, resolveMove, rootTravel, type MovePhase } from './moves-data';
import { inArc, inHitShape, knockbackVelocity, measureMove, moveAt, strikePart, strikeSegment } from './moves';
import { Animator } from './character';
import { Humanoid } from './humanoid';
import { hashPose, type Pose } from './pose';
import { Attack, Combo } from './attack';

/** One reference record (tools/cmd/port.ts `moveRecord`): a move in a phase on a build, 21 samples over u. */
interface MoveRecord {
  build: string;
  move: string;
  phase: MovePhase;
  samples: number[][];
}
const REF = JSON.parse(readFileSync('tests/baselines/port/moves.json', 'utf8')) as {
  points: string[];
  specs: Record<string, object>;
  records: MoveRecord[];
};

/** A my-3d2dge position in metres (Appendix C): (x, y, z) / 16 → (x, z, y). */
const point = (x: number, y: number, z: number, out = new Vector3()) => out.set(x / 16, z / 16, y / 16);
/** my-3d2dge's sword: `tip()` is the wrist plus the blade's direction times 11 units. */
const BLADE = 11 / 16;
/** Facing φ = 0 is yaw π/2 (Appendix C): forward +X, right +Z, as the old (f, r) → (x, y). */
const AT_ORIGIN = { position: new Vector3(), yaw: Math.PI / 2 };

/**
 * Half a breathing cycle (breathing is sin(2.3 t)): the step a sample takes. The reference rig sat at rest at t = 0,
 * then was set back to t = −1 and stepped 1 s into the move, so both poses breathe at t = 0 (the README). Here a
 * swing's start comes from the state before the step, which a clock set back would make breathe; stepping from t = 0
 * by this much breathes at both ends just the same (not at all), and every easing still saturates.
 */
const STEP = Math.PI / 2.3;

/** A reference rig's sample: rest at t = 0, then the move at (phase, u), every easing saturated (the README). */
function sampleRig(build: string, move: string, phase: MovePhase, u: number): Humanoid {
  const rig = new Humanoid({ build: `build:${build}`, weapon: 'sword', clock: -STEP, dt: STEP });
  rig.update(AT_ORIGIN);
  return rig.update({ ...AT_ORIGIN, body: { move: `move:${move}`, phase, u } });
}

/** Where an old sample point is on the new rig: the wrists, the sword's tip, the sole under the right ankle. */
function newPoint(rig: Humanoid, name: string, out: Vector3): Vector3 {
  const { world, build } = rig;
  if (name === 'handR' || name === 'handL') return jointPosition(world, name, out);
  if (name === 'footR') return jointToWorld(world, 'footR', new Vector3(0, -build.ankleHeight * build.size, 0), out);
  const blade = new Vector3(0, 0, 1).applyQuaternion(jointRotation(world, 'handR'));
  return jointPosition(world, 'handR', out).addScaledVector(blade, BLADE * build.size);
}

/** Every sampled point's error (metres), by `move/phase/point`. */
function differential(): Map<string, number[]> {
  const errors = new Map<string, number[]>();
  const [want, got] = [new Vector3(), new Vector3()];
  for (const record of REF.records) {
    for (const sample of record.samples) {
      const rig = sampleRig(record.build, record.move, record.phase, sample[0]);
      REF.points.forEach((name, i) => {
        point(sample[1 + i * 3], sample[2 + i * 3], sample[3 + i * 3], want);
        const key = `${record.move}/${record.phase}/${name}`;
        if (!errors.has(key)) errors.set(key, []);
        errors.get(key)!.push(newPoint(rig, name, got).distanceTo(want));
      });
    }
  }
  return errors;
}

/**
 * Points allowed past 3 cm, each with its reason. Empty: the vectors were recorded with no view hack, and the arm
 * path, the spine and the limbs land on the old points (the twisted shoulders within a few millimetres).
 */
const EXCEPTIONS: Readonly<Record<string, string>> = {};

describe('rootTravel', () => {
  it('travels only an applied move, from its strike on: none before it starts and through its wind', () => {
    const [applied, visual] = [resolveMove('move:thrust', { rootMotion: 'apply' }), resolveMove('move:thrust')];
    const lunge = applied.body.lunge;
    expect([undefined, 'wind'].map((phase) => rootTravel(applied, phase as MovePhase | undefined, 0.5))).toEqual([0, 0]); // prettier-ignore
    expect(rootTravel(applied, 'active', 0.5)).toBeCloseTo(lunge * (1 - 0.5 ** 3), 12);
    expect([rootTravel(applied, 'recover', 0.2), rootTravel(visual, 'active', 0.5), rootTravel(visual, 'recover', 1)]).toEqual([lunge, 0, 0]); // prettier-ignore
    expect(lunge).toBeGreaterThan(0);
  });
});

describe('the differential tests against my-3d2dge (WP 6.1 Done when)', () => {
  let errors: Map<string, number[]>;
  beforeAll(() => {
    errors = differential();
  });

  it('covers all 24 moves, each phase, 21 samples over u, on 3 builds', () => {
    expect(Object.keys(REF.specs)).toHaveLength(24);
    expect(REF.records).toHaveLength(24 * 3 * 3);
    for (const name of Object.keys(REF.specs)) expect(getMove(`move:${name}`).id).toBe(`move:${name}`);
    expect([...errors.values()].flat()).toHaveLength(24 * 3 * 3 * 21 * 4);
  });

  it('puts the hands, the blade tip and the kicking foot within 1 cm on average and 3 cm at worst, every move', () => {
    const worst = [...errors].map(([key, list]) => [key, Math.max(...list)] as const).sort((a, b) => b[1] - a[1]);
    const report = worst.slice(0, 8).map(([k, e]) => `${k} ${(e * 100).toFixed(2)} cm`);
    for (const name of Object.keys(REF.specs)) {
      const all = [...errors].filter(([key]) => key.startsWith(`${name}/`)).flatMap(([, list]) => list);
      const mean = all.reduce((a, b) => a + b, 0) / all.length;
      expect(mean, `${name}: mean ${mean}`).toBeLessThan(0.01);
      expect(mean, `${name}: mean ${mean}`).toBeLessThan(0.002); // measured 0.2 mm over all moves
    }
    const over = worst.filter(([key, e]) => e > 0.03 && !EXCEPTIONS[key]);
    expect(over, report.join('\n')).toEqual([]);
    expect(worst[0][1], report[0]).toBeLessThan(0.01); // measured 7.4 mm: a slash's recover, the shoulders twisted
  });

  it('lands the left hand exactly: no move bends it past the old one', () => {
    for (const [key, list] of errors) if (key.endsWith('/handL')) expect(Math.max(...list), key).toBeLessThan(1e-4);
  });
});

describe('moveAt', () => {
  it('names a move at a moment, by id or bare name, at mid-strike by default', () => {
    expect(moveAt('uppercut')).toEqual({ move: getMove('move:uppercut'), phase: 'active', u: 0.5 });
    expect(moveAt('move:kick', 0.2, 'wind').phase).toBe('wind');
  });
});

describe('a humanoid and an animator playing moves', () => {
  it('keep every bone its length and every value finite, in every phase of every move', () => {
    for (const build of ['build:chibi', 'build:skeleton']) {
      const poses: Pose[] = [];
      for (const id of Object.keys(ENGINE_MOVES)) {
        const rig = new Humanoid({ build, weapon: 'sword', clock: 1 });
        for (const phase of MOVE_PHASES) {
          for (let i = 0; i <= 10; i++) poses.push(rig.update({ body: moveAt(id, i / 10, phase) }).pose.clone());
        }
        for (let i = 0; i < 20; i++) poses.push(rig.update().pose.clone());
      }
      expect(animCheck({ poses, skeleton: build, floor: -10 }).problems).toEqual([]);
    }
  });

  it('solve from the state alone: the same state gives the same pose, and solving again changes nothing', () => {
    const rig = new Humanoid({ build: 'build:heroic', weapon: 'sword', clock: 2 });
    const combo = new Combo(['slash', 'backslash', 'spin']);
    for (let i = 0; i < 40; i++) {
      if (i % 12 === 0) combo.press();
      combo.update(rig.dt);
      rig.update({ body: combo.body, velocity: new Vector3(0, 0, 1) });
    }
    const hash = hashPose(rig.pose);
    expect(hashPose(rig.solve().pose)).toBe(hash);
    const copy = new Humanoid({ build: 'build:heroic', weapon: 'sword' });
    Object.assign(copy.state, structuredClone(rig.state));
    copy.position.copy(rig.position);
    copy.yaw = rig.yaw;
    expect(hashPose(copy.solve().pose)).toBe(hash);
  });

  it('turn the whole body through a spin, about where it stands', () => {
    const rig = new Humanoid({ weapon: 'sword', clock: 0, dt: 1 });
    rig.update({ position: new Vector3(2, 0, 3), body: moveAt('spin', 0, 'active') });
    const facing = new Vector3(0, 0, 1).applyQuaternion(rig.pose.rootRot);
    rig.update({ body: moveAt('spin', 0.5, 'active') }); // outCubic(0.5) = 0.875 of a turn
    const turned = new Vector3(0, 0, 1).applyQuaternion(rig.pose.rootRot);
    const angle = Math.atan2(turned.x, turned.z) - Math.atan2(facing.x, facing.z);
    expect(angle).toBeCloseTo(0.875 * 2 * Math.PI - 2 * Math.PI, 9);
    expect(rig.pose.rootPos.distanceTo(new Vector3(2, rig.pose.rootPos.y, 3))).toBeLessThan(0.1);
  });

  it('lunge the body with rootMotion visual, and leave the lunge to the root with apply (never both)', () => {
    /** The body's largest lunge, metres either way, through one swing of `attack`. */
    const peakLunge = (attack: Attack) => {
      const rig = new Humanoid({ build: 'build:heroic', weapon: 'sword', clock: 0 });
      let peak = 0;
      attack.start();
      while (attack.busy) {
        attack.update(rig.dt);
        peak = Math.max(peak, Math.abs(rig.step({ body: attack.body }).state.body.lunge));
      }
      return peak;
    };
    expect(peakLunge(new Attack('thrust', { rootMotion: 'apply' }))).toBe(0);
    expect(peakLunge(new Attack('thrust'))).toBeGreaterThan(0.1);
  });

  it('leave the sim state as it is whether or not the animator was posed (WP 3.7, with moves)', () => {
    const play = (posed: boolean) => {
      const hero = new Animator({ build: 'build:heroic', weapon: 'sword', clock: 0 });
      const combo = new Combo(['slash', 'thrust', 'roundhouse', 'spin']);
      const saved: string[] = [];
      for (let i = 0; i < 120; i++) {
        if (i % 13 === 0) combo.press();
        combo.update(hero.body.dt);
        hero.step({ body: combo.body, velocity: new Vector3(0, 0, i % 40 < 20 ? 0 : 2) });
        if (posed && i % 3 !== 1) hero.pose();
        saved.push(JSON.stringify(hero.body.state));
      }
      return saved;
    };
    expect(play(true)).toEqual(play(false));
  });

  it('sample the blade into a precise trail while a strike plays: weapon sweeps as sim data', () => {
    const hero = new Animator({ build: 'build:heroic', weapon: 'sword', clock: 0, preciseHits: true });
    const slash = new Attack('slash');
    slash.start();
    const tips: Vector3[] = [];
    while (slash.busy) {
      slash.update(hero.body.dt);
      hero.update({ body: slash.body, trail: slash.trail(true) });
      if (slash.hitOpen) tips.push(hero.trail.at(-1)!.tip.clone());
    }
    expect(tips.length).toBeGreaterThan(2);
    const travel = tips.slice(1).reduce((sum, tip, i) => sum + tip.distanceTo(tips[i]), 0);
    expect(travel).toBeGreaterThan(0.5); // the tip sweeps across the front
  });
});

describe('measureMove, the hit helpers and the strike', () => {
  it('measures a hit shape once per move, build and weapon, and again when one changes', () => {
    const a = measureMove('slash', { build: 'build:heroic' });
    expect(measureMove('move:slash', { build: 'build:heroic', weapon: 'sword' })).toBe(a);
    expect(measureMove('slash', { build: 'build:bulky' })).not.toBe(a);
    const longer = measureMove(resolveMove('slash', { reach: [0.6, 0.6] }), { build: 'build:heroic' });
    expect(longer.range).toBeGreaterThan(a.range);
  });

  it('gives each strike its own shape: a wide slash, a narrow long thrust, a low sweep', () => {
    const at = (name: string) => measureMove(name, { build: 'build:heroic' });
    expect(at('slash').halfAngle).toBeGreaterThan(1.2);
    expect(at('thrust').halfAngle).toBeLessThan(0.1);
    expect(at('thrust').range).toBeGreaterThan(at('slash').range);
    expect(at('sweep').yMax).toBeLessThan(0.3);
    expect(at('uppercut').yMax).toBeGreaterThan(at('jab').yMax);
    for (const id of Object.keys(ENGINE_MOVES)) {
      const shape = at(id);
      expect(shape.range, id).toBeGreaterThan(0.1);
      expect(shape.yMin, id).toBeLessThanOrEqual(shape.yMax);
      expect(shape.halfAngle, id).toBeLessThanOrEqual(Math.PI);
    }
  });

  it('tests targets in a cone on the ground, and in its height window', () => {
    const o = new Vector3(1, 0, 1);
    expect(inArc(o, 0, new Vector3(1, 0, 2.4), 1.5, 0.3)).toBe(true);
    expect(inArc(o, 0, new Vector3(1, 0, 2.6), 1.5, 0.3)).toBe(false);
    expect(inArc(o, 0, new Vector3(1, 0, 2.6), 1.5, 0.3, 0.2)).toBe(true);
    expect(inArc(o, Math.PI / 2, new Vector3(2, 0, 1), 1.5, 0.3)).toBe(true);
    expect(inArc(o, 0, new Vector3(2, 0, 1), 1.5, 0.3)).toBe(false);
    const shape = { range: 1, halfAngle: 0.5, yMin: 0.8, yMax: 1.2 };
    expect(inHitShape(o, 0, shape, new Vector3(1, 1, 1.9))).toBe(true);
    expect(inHitShape(o, 0, shape, new Vector3(1, 0.5, 1.9))).toBe(false);
    expect(inHitShape(o, 0, shape, new Vector3(1, 0.5, 1.9), 0.3)).toBe(true);
    expect(inHitShape(o, 0, shape, new Vector3(1, 2, 2.8), 0, 2)).toBe(true);
  });

  it('knocks a target away along the ground, and up', () => {
    expect(knockbackVelocity(new Vector3(0, 5, 0), new Vector3(3, 0, 4), 10, 2).toArray()).toEqual([6, 2, 8]);
    expect(knockbackVelocity(new Vector3(), new Vector3(), 10, 2).toArray()).toEqual([0, 2, 0]);
  });

  it('spans the striking part: a sword from near its grip to its tip, a forearm, a shin to its sole', () => {
    const rig = new Humanoid({ build: 'build:heroic', weapon: 'sword', clock: 0 }).update({ body: moveAt('slash') });
    const [base, tip] = [new Vector3(), new Vector3()];
    expect(strikePart(getMove('move:slash'), true)).toBe('blade');
    strikeSegment(rig, 'blade', base, tip);
    expect(base.distanceTo(tip)).toBeCloseTo(TRAIL.bladeTip - TRAIL.bladeBase, 6);
    strikeSegment(rig, 'fistL', base, tip);
    expect(base.distanceTo(tip)).toBeCloseTo(rig.build.armLower, 6);
    strikeSegment(rig, 'kick', base, tip);
    expect(tip.y).toBeLessThan(base.y);
  });

  it('spans a strike on an animator only with preciseHits: else its pose is the view’s (ANIM_NOT_PRECISE)', () => {
    const make = (preciseHits: boolean) =>
      new Animator({ build: 'build:heroic', weapon: 'sword', clock: 0, preciseHits }).update({ body: moveAt('slash') });
    const [base, tip, bodyBase, bodyTip] = Array.from({ length: 4 }, () => new Vector3());
    const precise = make(true);
    strikeSegment(precise, 'blade', base, tip);
    strikeSegment(precise.body, 'blade', bodyBase, bodyTip);
    expect([base, tip]).toEqual([bodyBase, bodyTip]);
    expect(() => strikeSegment(make(false), 'blade', base, tip)).toThrow(
      /^\[ANIM_NOT_PRECISE\] strikeSegment was given an animator without preciseHits: .*: make the animator/,
    );
  });
});
