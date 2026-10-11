/**
 * @file Unit tests for builds (engine/anim/builds.ts): the carried numbers in metres (my-3d2dge's / 16), the new
 * fields, the whole-entry checks, and the fallback for a missing id.
 */
import { describe, expect, it } from 'vitest';
import { createLog } from '../core/log';
import { createRegistry } from '../core/registry';
import { BUILD_FIELDS, buildKind, defineBuild, getBuild } from './builds';

/** my-3d2dge's `BUILDS` and `Humanoid` defaults (`engine/my-3d2dge.js:1755-1773`), in its units (16 to the metre). */
const SOURCE = {
  chibi: {
    legUpper: 6,
    legLower: 6,
    hipZ: 11.6,
    hipHalf: 1.9,
    footSpread: 1.9,
    torso: 8,
    shoulderHalf: 3.3,
    neck: 1.2,
    headR: 3.4,
    armUpper: 4.6,
    armLower: 4.6,
    stride: 6.5,
    lift: 3.4,
    swing: 4,
    speedRef: 70,
  },
  heroic: {
    legUpper: 7.4,
    legLower: 7.4,
    hipZ: 14.3,
    torso: 9.6,
    shoulderHalf: 3.5,
    headR: 3.05,
    neck: 1.5,
    armUpper: 5.5,
    armLower: 5.4,
    hipHalf: 1.8,
    stride: 7.8,
    speedRef: 80,
  },
  bulky: {
    legUpper: 6.4,
    legLower: 6.2,
    hipZ: 12.2,
    torso: 9.4,
    shoulderHalf: 4.6,
    headR: 3.2,
    neck: 0.9,
    armUpper: 5.2,
    armLower: 5.2,
    hipHalf: 2.4,
    footSpread: 2.4,
    stride: 6.6,
    speedRef: 60,
  },
  skeleton: {
    legUpper: 7,
    legLower: 7,
    hipZ: 13.4,
    torso: 9,
    shoulderHalf: 3.2,
    headR: 3.1,
    neck: 1.6,
    armUpper: 5.3,
    armLower: 5.2,
    hipHalf: 1.5,
    stride: 7,
    hunch: 0.2,
  },
} as const;
/** Renamed fields: Z is no longer up. */
const RENAMED: Record<string, string> = { hipZ: 'hipHeight', headR: 'headRadius' };

describe('the engine builds', () => {
  for (const [name, fields] of Object.entries(SOURCE)) {
    it(`build:${name} carries the source's numbers in metres`, () => {
      const build = getBuild(`build:${name}`);
      const defaults = { ...SOURCE.chibi, ...fields };
      for (const [key, value] of Object.entries(defaults)) {
        const expected = key === 'hunch' ? value : value / 16;
        expect(build[(RENAMED[key] ?? key) as keyof typeof build], key).toBe(expected);
      }
      expect(build.size).toBe(1);
      expect(build.hipHeight).toBeLessThanOrEqual(build.legUpper + build.legLower);
    });
  }

  it('chibi is the defaults, and the fallback', () => {
    const chibi = getBuild('build:chibi');
    for (const [key, field] of Object.entries(BUILD_FIELDS))
      expect(chibi[key as keyof typeof chibi]).toBe(field.default);
    const printed: string[] = [];
    const reg = createRegistry({
      log: createLog({ console: { warn: (line) => printed.push(line), error: () => {} } }),
    });
    buildKind(reg);
    expect(getBuild('build:herioc', reg).id).toBe('build:chibi');
    expect(printed[0]).toMatch(/CORE_UNKNOWN_ID.*build:heroic/);
  });
});

describe('defineBuild', () => {
  it('fills absent fields from chibi', () => {
    const reg = createRegistry();
    const imp = defineBuild('build:imp', { size: 0.6, headRadius: 0.25 }, reg);
    expect(imp.legUpper).toBe(0.375);
    expect(imp.headRadius).toBe(0.25);
    expect(reg.list('build').map((entry) => entry.id)).toEqual([
      'build:bulky',
      'build:chibi',
      'build:heroic',
      'build:imp',
      'build:skeleton',
    ]);
  });

  it('refuses a stance above straight legs, an ankle above the knee, a negative length', () => {
    const reg = createRegistry();
    expect(() => defineBuild('build:a', { hipHeight: 0.9 }, reg)).toThrow(/CORE_BAD_SPEC.*hipHeight 0.9 is above/);
    expect(() => defineBuild('build:b', { ankleHeight: 0.4 }, reg)).toThrow(/CORE_BAD_SPEC.*ankleHeight/);
    expect(() => defineBuild('build:c', { torso: -1 }, reg)).toThrow(/CORE_BAD_SPEC.*torso/);
    expect(() => defineBuild('build:d', { legUpper: 0, hipHeight: 0.3 }, reg)).toThrow(/must be above 0/);
  });
});
