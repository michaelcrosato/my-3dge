/**
 * @file Tests for weapons as data (engine/world/weapons.ts): a weapon's defaults and its fields as given; its recoil
 * step by shot, the last repeating; its spread from the hip, on the move and down the sights; the fallback
 * `weapon:gun` with a warning; the refusals of a bad recoil or muzzle.
 */
import { describe, expect, it, vi } from 'vitest';
import { createRegistry } from '../core/registry';
import { defineWeapon, getWeapon, recoilStep, spreadOf } from './weapons';

describe('weapons as data', () => {
  it('take their defaults, and their fields as given', () => {
    const reg = createRegistry();
    const gun = getWeapon('weapon:gun', reg);
    expect([gun.rate, gun.auto, gun.magazine, gun.reload, gun.zoom, gun.prop]).toEqual([5, false, 12, { tactical: 1.25, empty: 1.5 }, 60, '']); // prettier-ignore
    const rifle = defineWeapon('weapon:rifle', { rate: 13.5, auto: true, magazine: 18, reload: { tactical: 2.4 }, prop: 'prop:rifle' }, reg); // prettier-ignore
    expect([rifle.rate, rifle.auto, rifle.reload, rifle.prop]).toEqual([13.5, true, { tactical: 2.4, empty: 1.5 }, 'prop:rifle']); // prettier-ignore
  });

  it('kick by each shot’s recoil step, the last repeating, and stray by the hip, the move and the sights', () => {
    const reg = createRegistry();
    const kind = defineWeapon('weapon:test', { recoil: [[1, 0.5], [2, -0.5]], spread: { hip: 3, move: 2, ads: 0.5 } }, reg); // prettier-ignore
    expect([0, 1, 2, 9].map((n) => recoilStep(kind, n))).toEqual([
      [1, 0.5],
      [2, -0.5],
      [2, -0.5],
      [2, -0.5],
    ]);
    expect([spreadOf(kind, 0, false), spreadOf(kind, 0, true), spreadOf(kind, 1, true), spreadOf(kind, 0.5, false)]).toEqual([3, 5, 0.5, 1.75]); // prettier-ignore
  });

  it('fall back to weapon:gun with a warning, and refuse a bad recoil or muzzle', () => {
    const reg = createRegistry();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(getWeapon('weapon:gn', reg).id).toBe('weapon:gun');
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([expect.stringMatching(/^\[CORE_UNKNOWN_ID\].*weapon:gn.*defineWeapon/)]); // prettier-ignore
    warn.mockRestore();
    expect(() => defineWeapon('weapon:bent', { recoil: [[1]] as never }, reg)).toThrow(/CORE_BAD_SPEC.*recoil/);
    expect(() => defineWeapon('weapon:lost', { muzzle: [0, 0] as never }, reg)).toThrow(/CORE_BAD_SPEC.*muzzle/);
  });
});
