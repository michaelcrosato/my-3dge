/**
 * @file Unit tests for labs/box/menuControls.ts: the box's action map as the menu's rows, moving first with the keys
 * of each way and the pad and the stick named once, then each other action in the map's order, in the box's words,
 * clicks and arrows in words; in a keyboard layout, its letters. The page's rows are tests/e2e/box-menu.spec.ts's.
 * @see labs/box/menuControls.ts
 */
import { describe, expect, it } from 'vitest';
import { getActionMap } from '../../engine';
import { BOX_ACTION_MAP } from './menu';
import { controlRows } from './menuControls';

describe('the box menu’s controls', () => {
  it('lists moving first, then every other action of the map in its order, in the box’s words', () => {
    expect(controlRows(getActionMap(BOX_ACTION_MAP))).toEqual([
      { action: 'move', words: 'Move', keys: 'W A S D / ↑ ← ↓ →', pad: 'D-pad / L Stick' },
      { action: 'jump', words: 'Jump', keys: 'Space', pad: 'A' },
      { action: 'dash', words: 'Dash', keys: 'Shift / K', pad: 'B / LT' },
      { action: 'attack', words: 'Attack (shove)', keys: 'Left click / J', pad: 'X / RT' },
      { action: 'skill', words: 'Bolt', keys: 'Right click / L', pad: 'Y / RB' },
      { action: 'interact', words: 'Interact (unused)', keys: 'E', pad: 'LB' },
    ]);
  });

  it('labels the keys in the reader’s layout', () => {
    const azerty = new Map([['KeyW', 'z'], ['KeyA', 'q']]); // prettier-ignore
    expect(controlRows(getActionMap(BOX_ACTION_MAP), azerty)[0].keys).toBe('Z Q S D / ↑ ← ↓ →');
  });
});
