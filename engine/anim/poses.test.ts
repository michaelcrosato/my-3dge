/**
 * @file Unit tests for the humanoid's poses and effector layers (engine/anim/poses.ts, locomotion.ts; PLAN.md WP 3.6,
 * I-09): misspelt pose, stance and weapon names warn once with the closest name and are ignored; the layer tables
 * list every layer with its weight; the free hand waves; the gait at rest stands where my-3d2dge stood.
 */
import { describe, expect, it } from 'vitest';
import { createLog, type Log } from '../core/log';
import { Vector3 } from '../core/math';
import { fru } from './authoring';
import { getBuild } from './builds';
import { Humanoid, type HumanoidInput } from './humanoid';
import { gaitFoot, pelvisTarget, restContext, spineDirection } from './locomotion';
import { hashPose } from './pose';
import { FOOT_LAYERS, HAND_LAYERS, layerWeights, poseName, stanceName, weaponName } from './poses';

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
});
