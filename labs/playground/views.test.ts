/**
 * @file Unit tests for the playground's views (labs/playground/views.ts): every mode's code is a camera code the page's
 * cameras read, the five modes are the five of docs/PLAYGROUND.md §4, every look is registered, the keys are bound by
 * no action map, and T and P step round in order from any camera code or look id.
 * @see labs/playground/views.ts
 */
import { describe, expect, it } from 'vitest';
import { listActionMaps, RESERVED_CODES, SYSTEM_ACTIONS } from '../../engine/input/actionMaps';
import { registry } from '../../engine/core/registry';
import { readCameraCode } from '../../engine/gfx/cameras/place';
import './looks/cel';
import './looks/pixel';
import { CAMERA_KEY, LOOK_KEY, PLAYGROUND_CAMERAS, PLAYGROUND_LOOKS, cameraMode, nextCamera, nextLook } from './views';

describe('the playground views', () => {
  it('opens each of the five modes with a camera code, and every look is registered', () => {
    expect(PLAYGROUND_CAMERAS.map((mode) => mode.name)).toEqual([
      'shooter',
      'first',
      'platformer',
      'isometric',
      'top-down',
    ]);
    for (const mode of PLAYGROUND_CAMERAS) expect(() => readCameraCode(mode.code), mode.code).not.toThrow();
    for (const id of PLAYGROUND_LOOKS) expect(registry.has('look', id), id).toBe(true);
  });

  it('switches with keys no action map, system action or reserved code takes', () => {
    const taken = new Set([
      ...RESERVED_CODES,
      ...Object.values(SYSTEM_ACTIONS).flat(),
      ...listActionMaps().flatMap((map) => Object.values(map.actions).flat()),
    ]);
    expect(taken.has(CAMERA_KEY)).toBe(false);
    expect(taken.has(LOOK_KEY)).toBe(false);
  });

  it('steps round in order: a code with its numbers opens its mode, an unknown one starts the cycle', () => {
    const codes = PLAYGROUND_CAMERAS.map((mode) => mode.code);
    expect(codes.map(nextCamera)).toEqual([...codes.slice(1), codes[0]]);
    expect(cameraMode('cam3=chase,0,-20.63,5.5')?.name).toBe('shooter');
    expect(nextCamera('cam3=first,90,-10,70')).toBe('cam3=orbit');
    expect(nextCamera('cam3=fly')).toBe(codes[0]);
    expect(nextLook(PLAYGROUND_LOOKS[0])).toBe(PLAYGROUND_LOOKS[1]);
    expect(nextLook(PLAYGROUND_LOOKS[1])).toBe(PLAYGROUND_LOOKS[0]);
    expect(nextLook('look:clean')).toBe(PLAYGROUND_LOOKS[0]);
  });
});
