/**
 * @file Unit tests for the humanoid's poses and effector layers (engine/anim/poses.ts, locomotion.ts; PLAN.md WP 3.6,
 * I-09): misspelt pose, stance and weapon names warn once with the closest name and are ignored; the layer tables
 * list every layer with its weight; the free hand waves; the gait at rest stands where my-3d2dge stood; a
 * `plantedStride` build's gait (build:adult) drops the pelvis so its planted soles are in reach at full stride and
 * stay on the floor through the solve, while the source's builds keep their gait, whose soles hang.
 */
import { describe, expect, it } from 'vitest';
import { createLog, type Log } from '../core/log';
import { Vector3 } from '../core/math';
import { fru } from './authoring';
import { getBuild } from './builds';
import { Humanoid, type HumanoidInput } from './humanoid';
import { jointPosition, jointToWorld, tipPosition } from './fk';
import { gaitFoot, pelvisTarget, restContext, spineDirection } from './locomotion';
import { plantedHeight } from './locomotion/planted';
import { hashPose } from './pose';
import { FOOT_LAYERS, HAND_LAYERS, layerWeights, poseName, stanceName, weaponName } from './poses';
import { jointIndex, PROPORTIONS } from './skeleton';

/** Steps `hero` `steps` times with `input`. */
function run(hero: Humanoid, input: HumanoidInput, steps: number): Humanoid {
  for (let i = 0; i < steps; i++) hero.update(input);
  return hero;
}

/** A log that keeps what it prints. */
function quietLog(): { log: Log; printed: string[] } {
  const printed: string[] = [];
  return { log: createLog({ console: { warn: (line) => printed.push(line), error: () => {} } }), printed };
}

describe('names', () => {
  it('warns once for a misspelt pose, stance or weapon, suggesting the closest, and ignores it', () => {
    const { log, printed } = quietLog();
    expect(poseName('cheer', log)).toBe('cheer');
    expect(poseName('cheeer', log)).toBeUndefined();
    expect(poseName('cheeer', log)).toBeUndefined();
    expect(stanceName('redy', log)).toBeUndefined();
    expect(weaponName('sward', log)).toBeUndefined();
    expect(printed).toEqual([
      '[ANIM_UNKNOWN_POSE] "cheeer" is not a humanoid pose (did you mean "cheer"?); it is ignored: use one of: cheer, cast, guard, kneel, crouch, wave, hips, block, die, down',
      '[ANIM_UNKNOWN_POSE] "redy" is not a humanoid stance (did you mean "ready"?); it is ignored: use one of: guard, ready',
      '[ANIM_UNKNOWN_POSE] "sward" is not a humanoid weapon (did you mean "sword"?); it is ignored: use one of: none, sword, gun, staff',
    ]);
  });

  it('a humanoid told a misspelt pose warns and stands as if told none', () => {
    const { log, printed } = quietLog();
    const typo = run(new Humanoid({ log, clock: 0, weapon: 'sward' as 'sword' }), { pose: 'kneal' as 'kneel' }, 30);
    const plain = run(new Humanoid({ clock: 0 }), {}, 30);
    expect(typo.weapon).toBe('none');
    expect(hashPose(typo.pose)).toBe(hashPose(plain.pose));
    expect(printed.map((line) => line.split(';')[0])).toEqual([
      '[ANIM_UNKNOWN_POSE] "sward" is not a humanoid weapon (did you mean "sword"?)',
      '[ANIM_UNKNOWN_POSE] "kneal" is not a humanoid pose (did you mean "kneel"?)',
    ]);
  });
});

describe('the layer tables', () => {
  it('lists every layer with its weight: none at rest, the held pose once eased in', () => {
    const ctx = restContext(getBuild('build:chibi'));
    expect(layerWeights(HAND_LAYERS, ctx).every((layer) => layer.weight === 0)).toBe(true);
    expect(layerWeights(FOOT_LAYERS, ctx).map((layer) => layer.name)).toEqual([
      'dash',
      'air',
      'kneel',
      'guard',
      'crouch',
      'slide',
      'rise',
      'fall',
      'lunge',
      'hop',
      'climb',
    ]);
    const hero = run(new Humanoid({ clock: 0 }), { pose: 'cheer' }, 30);
    expect(hero.state.weights.cheer).toBe(1);
  });

  it('waves the free hand: the right when empty, the left when the right holds a weapon', () => {
    const wave = (weapon: 'none' | 'sword') => run(new Humanoid({ weapon, clock: 0 }), { pose: 'wave' }, 40);
    const up = (hero: Humanoid, side: 'L' | 'R') => hero.effectors.hands[side].y - hero.effectors.shoulders[side].y;
    expect(up(wave('none'), 'R')).toBeGreaterThan(0.3);
    expect(up(wave('none'), 'L')).toBeLessThan(0);
    expect(up(wave('sword'), 'L')).toBeGreaterThan(0.3);
    expect(up(wave('sword'), 'R')).toBeLessThan(0);
  });
});

describe('the gait (locomotion.ts)', () => {
  it('stands at rest where my-3d2dge stood: the stance height, the feet spread, upright', () => {
    const ctx = restContext(getBuild('build:heroic'));
    expect(pelvisTarget(ctx, new Vector3()).y).toBe(0.89375);
    expect(fru(gaitFoot(ctx, 'R', new Vector3()))).toEqual([0.05, 0.11875, 0]);
    expect(spineDirection(ctx, new Vector3()).toArray()).toEqual([-0, 1, 0]);
  });

  /** For each phase over a cycle at full stride: the farthest a planted sole lies from its hip (a source build's). */
  function spread(build: string): { reach: number; worst: number } {
    const b = getBuild(build);
    let worst = 0;
    for (let k = 0; k < 64; k++) {
      const ctx = { ...restContext(b), sp: 1, phase: (k / 64) * 2 * Math.PI };
      const pelvis = pelvisTarget(ctx, new Vector3());
      for (const [side, s] of [
        ['L', -1],
        ['R', 1],
      ] as const) {
        const sole = gaitFoot(ctx, side, new Vector3());
        if (sole.y > 0) continue; // lifted
        const hip = new Vector3(pelvis.x - s * b.hipHalf, pelvis.y, pelvis.z);
        worst = Math.max(worst, hip.distanceTo(sole));
      }
    }
    return { reach: b.legUpper + b.legLower, worst };
  }

  /** A body running at full stride, solved: the highest its planted feet's lowest point (heel or toe tip) rises, its
   * legs' stretch and its lowest pelvis. */
  function stride(build: string): { tip: number; stretch: number; low: number } {
    const hero = new Humanoid({ build, clock: 0 });
    const velocity = new Vector3(0, 0, getBuild(build).speedRef);
    const [at, w] = [new Vector3(), hero.world];
    let [tip, stretch, low] = [0, 0, Infinity];
    for (let step = 0; step < 240; step++) {
      hero.update({ velocity });
      if (step < 60) continue; // up to speed
      low = Math.min(low, jointPosition(w, 'pelvis', at).y);
      for (const side of ['L', 'R'] as const) {
        if (hero.effectors.feet[side].y > 0) continue; // the gait lifts it
        const b = hero.build;
        const heel = jointToWorld(w, `foot${side}`, at.set(0, -b.ankleHeight * b.size, -PROPORTIONS.heel * b.footLength * b.size), at).y; // prettier-ignore
        tip = Math.max(tip, Math.min(heel, tipPosition(hero.skeleton, w, `toe${side}`, at).y));
        const leg = jointPosition(w, `thigh${side}`, at).distanceTo(jointPosition(w, `foot${side}`, new Vector3()));
        const { lengths } = hero.skeleton;
        stretch = Math.max(stretch, leg / (lengths[jointIndex(`shin${side}`)] + lengths[jointIndex(`foot${side}`)]));
      }
    }
    return { tip, stretch, low };
  }

  it("plants a plantedStride build's soles in reach at full stride; the source's builds keep their gait", () => {
    const adult = stride('build:adult');
    expect(adult.stretch).toBeLessThan(0.99); // the knee never locks, the trailing heel lifting off the ball
    expect(adult.low).toBeLessThan(getBuild('build:adult').hipHeight - 0.05); // the pelvis drops as the feet spread
    const heroic = spread('build:heroic');
    expect(heroic.worst).toBeGreaterThan(heroic.reach + 0.05); // ADR-0009 amendment 4: its soles hang
    const b = getBuild('build:adult');
    const rest = { ...restContext(b), sp: 0 };
    const soles = [gaitFoot(rest, 'L', new Vector3()), gaitFoot(rest, 'R', new Vector3())] as const;
    expect(plantedHeight(b, 0, 0, soles, 2)).toBeGreaterThan(0.93); // at rest, nothing else holding it down
  });

  it("puts the adult's planted feet on the floor through the solve, running at full stride", () => {
    expect(stride('build:adult').tip).toBeLessThan(0.005); // planted: a heel down, or the toes as it lifts off the ball
    expect(stride('build:heroic').tip).toBeGreaterThan(0.05); // the soles hang above their targets
  });
});
