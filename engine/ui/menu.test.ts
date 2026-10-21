/**
 * @file Unit tests for engine/ui/menu.ts (T1, PLAN.md WP 10.6) over the stand-in DOM: the cursor moves round the ends
 * and past disabled items, held directions repeat; accept picks, sending an item's id (the input a replay records)
 * and telling `onPick`; cancel calls `onCancel`; a pointer moves the cursor and a click picks; an inactive menu reads
 * nothing; new items keep the cursor; bad items and times are coded errors.
 * @see engine/ui/menu.ts
 */
import { describe, expect, it } from 'vitest';
import type { FakeElement } from '../../tests/unit/ui/fakeDom';
import { fakeInput, overlay } from '../../tests/unit/ui/uiKit';
import { createMenu, type MenuItem, type MenuOptions } from './menu';
import type { UiCue } from './widgets';

const ITEMS: MenuItem[] = ['Resume', { label: 'Load', disabled: true }, { label: 'Restart', id: 'restart' }, 'Quit'];

/** A menu of `items` in a fresh overlay, with its input, what it sent and picked, its cues and a frame. */
function setup(items = ITEMS, more: Partial<MenuOptions> = {}) {
  const input = fakeInput();
  const [sent, picked, cues] = [[] as string[], [] as number[], [] as UiCue[]];
  const menu = createMenu(overlay().root, items, {
    input,
    sound: (cue) => cues.push(cue),
    send: (id) => sent.push(id),
    onPick: (i) => picked.push(i),
    ...more,
  });
  const frame = (action?: string, dt = 1 / 60) => {
    if (action) input.press(action);
    const done = menu.update(dt);
    input.frame();
    if (action) input.release(action);
    return done;
  };
  const rows = () => (menu.el as unknown as FakeElement).querySelectorAll('[data-ui=item]');
  return { menu, input, sent, picked, cues, frame, rows };
}

describe('the menu', () => {
  it('moves its cursor round the ends and past disabled items, held directions repeating', () => {
    const { menu, input, frame, rows } = setup();
    frame('uiDown');
    expect(menu.index).toBe(2); // past the disabled Load
    frame('uiDown');
    frame('uiDown');
    expect(menu.index).toBe(0); // round the end
    frame('uiUp');
    expect(menu.index).toBe(3);
    input.press('uiUp');
    for (let i = 0; i < 25; i++) frame(); // held past 0.35 s: 3 → 2 → 0
    input.release('uiUp');
    expect(menu.index).toBe(0);
    expect(rows().map((row) => row.dataset.value)).toEqual(['selected', 'disabled', '', '']);
    expect(menu.el.dataset.value).toBe('0');
  });

  it('picks with accept, sending an item’s id as input, and cancels with onCancel', () => {
    let cancelled = 0;
    const { menu, sent, picked, cues, frame } = setup(ITEMS, { onCancel: () => cancelled++ });
    expect(frame('uiAccept')).toBe(true); // Resume: no id, nothing sent
    menu.select(2);
    expect(frame('uiAccept')).toBe(true);
    expect([picked, sent]).toEqual([[0, 2], ['restart']]);
    expect(frame('uiCancel')).toBe(true);
    expect(cancelled).toBe(1);
    expect(cues).toEqual(['pick', 'move', 'pick', 'cancel']);
  });

  it('follows the pointer and picks what is clicked, never a disabled item', () => {
    const { menu, picked, rows } = setup();
    rows()[3].dispatch('pointerenter');
    expect(menu.index).toBe(3);
    rows()[1].dispatch('pointerenter');
    rows()[1].click();
    expect([menu.index, picked]).toEqual([3, []]);
    rows()[2].click();
    expect([menu.index, picked]).toEqual([2, [2]]);
  });

  it('reads nothing while inactive, keeps its cursor through new items, and refuses bad ones', () => {
    const { menu, frame } = setup();
    menu.active = false;
    expect(frame('uiAccept')).toBe(false);
    menu.select(3);
    menu.setItems(['A', 'B']);
    expect([menu.index, menu.selected]).toEqual([1, 'B']);
    expect(() => menu.setItems([{ name: 'x' }] as never)).toThrow(/UI_BAD_MENU/);
    expect(() => menu.update(Number.NaN)).toThrow(/dt NaN/);
    const none = setup([{ label: 'Off', disabled: true }]);
    expect([none.frame('uiAccept'), none.menu.pick()]).toEqual([false, false]);
  });
});
