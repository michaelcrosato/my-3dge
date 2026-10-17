/**
 * @file Unit tests for the playground's controls (labs/playground/controls.ts): `actionMap:playground` binds Apex's
 * default movement keys (Shift sprints, Left Alt walks, Left Ctrl crouches, Space jumps), the menu lists each with its
 * key and pad button, and nothing binds a key the page keeps for itself (T, P, M).
 * @see labs/playground/controls.ts
 */
import { describe, expect, it } from 'vitest';
import { getActionMap } from '../../engine';
import { PLAYGROUND_ACTION_MAP, PLAYGROUND_ACTIONS } from './controls';
import { controlRows, MENU_KEY } from './menu';
import { CAMERA_KEY, LOOK_KEY } from './views';

describe('actionMap:playground', () => {
  it('binds Apex’s movement keys, which the shooter model reads as buttons', () => {
    const { actions, move } = getActionMap(PLAYGROUND_ACTION_MAP);
    expect(move).toEqual(['forward', 'back', 'left', 'right']);
    expect(actions).toMatchObject({
      jump: ['Space', 'PadSouth'],
      sprint: ['ShiftLeft', 'PadLeftStick'],
      walk: ['AltLeft'],
      crouch: ['ControlLeft', 'PadEast'],
    });
    expect(Object.keys(PLAYGROUND_ACTIONS)).toEqual(['jump', 'sprint', 'walk', 'crouch']);
  });

  it('is what the menu lists, and leaves the page’s own keys alone', () => {
    const rows = controlRows();
    expect(rows.find((row) => row[0].startsWith('Sprint'))?.slice(1)).toEqual(['Shift', 'LS']); // a click of the left stick
    expect(rows.find((row) => row[0] === 'Walk')?.[1]).toMatch(/Alt/);
    expect(rows.find((row) => row[0].startsWith('Crouch'))?.[1]).toMatch(/Ctrl/);
    const bound = Object.values(getActionMap(PLAYGROUND_ACTION_MAP).actions).flat();
    for (const key of [CAMERA_KEY, LOOK_KEY, MENU_KEY]) expect(bound).not.toContain(key);
  });
});
