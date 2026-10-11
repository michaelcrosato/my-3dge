/**
 * @file Unit tests for the layer stack and its weights (engine/anim/weights.ts), PLAN.md WP 3.7: the carried weight
 * rates (dash 24/8, hurt 14, attack 30/7, air 10/18, poses 9, stances 10), each `HUMANOID_WEIGHTS` row proved
 * against the humanoid's own easing bit for bit, `activeWeights` by slot, and the stack's slots and detail levels.
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from '../core/math';
import { Rng } from '../core/rng';
import { SIM_DT } from '../core/time';
import { Humanoid, type HumanoidInput } from './humanoid';
import { POSES } from './poses';
import {
  activeWeights,
  easeWeight,
  HUMANOID_WEIGHTS,
  LAYER_SLOTS,
  LOD,
  SLOTS,
  type WeightInfo,
  type WeightName,
} from './weights';

/** The body states that turn each weight on (the speed weight's target is the speed share, 0.5 here). */
const ON: Record<WeightName, HumanoidInput> = {
  speed: { velocity: new Vector3(0, 0, 2.5) },
  dash: { dash: true },
  air: { air: true },
  climb: { climb: true },
  hurt: { hurt: true },
  attack: { body: {} },
  point: { point: true },
  down: { down: 1 },
  stanceGuard: { stance: 'guard' },
  stanceReady: { stance: 'ready' },
  ...Object.fromEntries(
    ['cheer', 'cast', 'guard', 'kneel', 'crouch', 'wave', 'hips', 'block'].map((p) => [p, { pose: p }]),
  ),
} as Record<WeightName, HumanoidInput>;

describe('the weights', () => {
  it('carry my-3d2dge’s rates', () => {
    const rates = (name: WeightName) => HUMANOID_WEIGHTS[name].rates;
    expect([rates('dash'), rates('hurt'), rates('attack'), rates('air')]).toEqual([
      [24, 8],
      [14, 14],
      [30, 7],
      [10, 18],
    ]);
    expect(Object.keys(POSES).filter((p) => !(p in HUMANOID_WEIGHTS))).toEqual(['die']); // a timeline
    for (const pose of ['cheer', 'cast', 'guard', 'kneel', 'crouch', 'wave', 'hips', 'block'] as const) {
      expect(rates(pose)).toEqual([9, 9]);
    }
    expect([rates('stanceGuard'), rates('stanceReady'), rates('climb'), rates('point')]).toEqual([
      [10, 10],
      [10, 10],
      [12, 12],
      [30, 8],
    ]);
    expect(HUMANOID_WEIGHTS.down).toEqual({ word: 'down', slot: 'override', rates: [2.5, 3.2], gain: 10 });
  });

  it('ease as the humanoid eases them, bit for bit: each row, on for 20 ticks, then off for 40', () => {
    for (const [name, info] of Object.entries(HUMANOID_WEIGHTS) as [WeightName, WeightInfo][]) {
      const humanoid = new Humanoid({ build: 'build:heroic', rng: new Rng(3) });
      const target = name === 'speed' ? 2.5 / humanoid.build.speedRef : 1;
      let expected = 0;
      for (let tick = 0; tick < 60; tick++) {
        const on = tick < 20;
        humanoid.step(on ? ON[name] : {});
        expected = easeWeight(expected, on ? target : 0, info.rates, SIM_DT, info.gain);
        expect(humanoid.state.weights[name], `${name} at tick ${tick}`).toBe(expected);
      }
      expect(expected, name).toBe(0);
    }
  });

  it('are read by slot, above zero only', () => {
    const humanoid = new Humanoid({ build: 'build:heroic', rng: new Rng(3) });
    for (let tick = 0; tick < 6; tick++) humanoid.step({ velocity: new Vector3(0, 0, 5), pose: 'cheer', dash: true });
    const round = (x: number) => Math.round(x * 100) / 100;
    expect(activeWeights(humanoid.state.weights, 'base', round)).toEqual({ speed: 0.7, dash: 1 });
    expect(activeWeights(humanoid.state.weights, 'override', round)).toEqual({ cheer: 0.9 });
    expect(Object.keys(activeWeights(humanoid.state.weights))).toEqual(['speed', 'dash', 'cheer']);
  });
});

describe('the stack', () => {
  it('runs its slots in the plan’s order; the ones after the solve take layers', () => {
    const order = ['weights', 'base', 'override', 'solve', 'clips', 'additive', 'post', 'physics', 'secondary'];
    expect(Object.keys(SLOTS)).toEqual(order);
    expect(LAYER_SLOTS).toEqual(order.slice(4));
  });

  it('has detail levels that do less and less: full detail runs every slot, every tick', () => {
    expect(LOD[0]).toEqual({ every: 1, slots: LAYER_SLOTS, trail: true });
    for (let level = 1; level < LOD.length; level++) {
      expect(LOD[level].every).toBeGreaterThanOrEqual(LOD[level - 1].every);
      expect(LOD[level].slots.every((slot) => LOD[level - 1].slots.includes(slot))).toBe(true);
      expect(LOD[level].slots.filter((slot) => !LAYER_SLOTS.includes(slot))).toEqual([]);
    }
  });
});
