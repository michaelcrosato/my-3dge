/**
 * @file Unit tests for the playground's views (labs/playground/views.ts): every mode's code is a camera code the page's
 * cameras read, the five modes are the five of docs/PLAYGROUND.md §4, every look is registered, P is bound by no action
 * map and kept from the page's own (the camera keys are their view actions, labs/playground/controls.test.ts), T and P
 * step round in order from any camera code or look id, X swaps the shooter's shoulder and Q and E turn isometric.
 * @see labs/playground/views.ts
 */
import { describe, expect, it } from 'vitest';
import { getActionMap, listActionMaps, RESERVED_CODES, SYSTEM_ACTIONS } from '../../engine/input/actionMaps';
import { PLAYGROUND_MAPS } from './controls';
import { registry } from '../../engine/core/registry';
import { readCameraCode } from '../../engine/gfx/cameras/place';
import './looks/cel';
import './looks/pixel';
import { LOOK_KEY, PLAYGROUND_CAMERAS, PLAYGROUND_LOOKS, cameraMode, nextCamera, nextLook, swapShoulder, turnView } from './views'; // prettier-ignore

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

  it('switches the looks with a key no action map, system action or reserved code takes, and the page’s maps keep', () => {
    const taken = new Set([
      ...RESERVED_CODES,
      ...Object.values(SYSTEM_ACTIONS).flat(),
      ...listActionMaps().flatMap((map) => Object.values(map.actions).flat()),
    ]);
    expect(taken.has(LOOK_KEY)).toBe(false);
    for (const id of Object.values(PLAYGROUND_MAPS)) expect(getActionMap(id).reserved, id).toContain(LOOK_KEY);
  });

  it('turns a classic view by quarters round its target, its zoom and target kept, and leaves another code', () => {
    expect(turnView('cam=iso', 1)).toBe('cam=iso,90,1');
    expect(turnView('cam=iso,270,2', 1)).toBe('cam=iso,0,2');
    expect(turnView('cam=iso,0,2,1,0,3', -1)).toBe('cam=iso,270,2,1,0,3');
    expect(readCameraCode(turnView('cam=iso,0,2', 1))).toMatchObject({ type: 'view', view: 'iso', zoom: 2 });
    expect(turnView('cam3=first,0,0,74', 1)).toBe('cam3=first,0,0,74');
  });

  it('swaps the shooter’s shoulder by its code, and leaves another camera’s code', () => {
    expect(swapShoulder('cam3=shoulder,10,-5,3.8')).toBe('cam3=shoulder,10,-5,3.8,-1');
    expect(swapShoulder('cam3=shoulder,10,-5,3.8,-1')).toBe('cam3=shoulder,10,-5,3.8');
    expect(readCameraCode(swapShoulder('cam3=shoulder,10,-5,3.8'))).toMatchObject({ type: 'shoulder', side: -1 });
    expect(swapShoulder('cam3=first,0,0,74')).toBe('cam3=first,0,0,74');
  });

  it('steps round in order: a code with its numbers opens its mode, an unknown one starts the cycle', () => {
    const codes = PLAYGROUND_CAMERAS.map((mode) => mode.code);
    expect(codes.map(nextCamera)).toEqual([...codes.slice(1), codes[0]]);
    expect(cameraMode('cam3=shoulder,0,0,3.8')?.name).toBe('shooter');
    expect(nextCamera('cam3=first,90,-10,70')).toBe('cam3=follow');
    expect(nextCamera('cam3=fly')).toBe(codes[0]);
    expect(nextLook(PLAYGROUND_LOOKS[0])).toBe(PLAYGROUND_LOOKS[1]);
    expect(nextLook(PLAYGROUND_LOOKS[1])).toBe(PLAYGROUND_LOOKS[0]);
    expect(nextLook('look:clean')).toBe(PLAYGROUND_LOOKS[0]);
  });
});
