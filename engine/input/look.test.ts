/**
 * @file Unit tests for engine/input/look.ts (T1, WP 13.9): the look settings are view settings in Apex Legends' units,
 * read as their defaults where a registry lacks them, and `scaleLook` turns a frame's mouse counts into 0.022° a count
 * times the sensitivity (the sights' share while aiming) and the right stick into a turn rate, each inverted when asked.
 * @see engine/input/look.ts
 */
import { describe, expect, it } from 'vitest';
import { registry } from '../core/registry';
import { DEGREES_PER_COUNT, LOOK_SETTING_FIELDS, lookOptions, scaleLook } from './look';

/** One degree in radians. */
const DEG = Math.PI / 180;

describe('the look settings', () => {
  it('are view settings in Apex’s units, never hashed, read as their defaults when a registry lacks them', () => {
    expect(DEGREES_PER_COUNT).toBe(0.022);
    for (const [path, field] of Object.entries(LOOK_SETTING_FIELDS)) {
      expect(field.view, path).toBe(true);
      expect(registry.has('setting', path), path).toBe(true);
    }
    expect(lookOptions(() => undefined)).toEqual({
      sensitivity: 5,
      ads: 1,
      invert: false,
      stick: 1,
      stickAds: 1,
      stickInvert: false,
    });
    expect(lookOptions((path) => (path === 'input.sensitivity' ? 2 : undefined)).sensitivity).toBe(2);
  });

  it('scale a frame: 0.11° a count at Apex’s 5, the sights’ share aiming, the stick’s rate, each inverted when asked', () => {
    const options = lookOptions(() => undefined);
    const still = [0, 0] as const;
    expect(scaleLook({ counts: [100, 0], stick: still }, options, false).look[0]).toBeCloseTo(11 * DEG, 12);
    expect(scaleLook({ counts: [0, 10], stick: still }, { ...options, ads: 0.5 }, true).look[1]).toBeCloseTo(0.55 * DEG, 12); // prettier-ignore
    expect(scaleLook({ counts: [0, 10], stick: still }, { ...options, ads: 0.5 }, false).look[1]).toBeCloseTo(1.1 * DEG, 12); // prettier-ignore
    expect(scaleLook({ counts: [0, 10], stick: still }, { ...options, invert: true }, false).look[1]).toBeCloseTo(-1.1 * DEG, 12); // prettier-ignore
    expect(scaleLook({ counts: [0, 0], stick: [0.5, -1] }, { ...options, stick: 2 }, false).turn).toEqual([1, 2]); // forward: up
    const flight = { ...options, stickInvert: true, stickAds: 0.5 };
    expect(scaleLook({ counts: [0, 0], stick: [0, -1] }, flight, true).turn).toEqual([0, -0.5]);
    expect(scaleLook({ counts: [0, 0], stick: still }, { ...options, invert: true }, false)).toEqual({ look: [0, 0], turn: [0, 0] }); // prettier-ignore
  });
});
