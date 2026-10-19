/**
 * @file Unit tests for engine/ui/widgets.ts (T1, PLAN.md WP 10.6's Done-when: "`ui.state()` snapshot tests pass"),
 * over the stand-in DOM (tests/unit/ui/fakeDom.ts): every widget in the overlay's state (a snapshot, with a dialog and
 * a menu); a bar's fill and text follow its value, clamped; hearts count halves; a box's body changes; a held
 * direction repeats after 0.35 s and every 0.1 s; `overlay.attach` puts a widget in a HUD place. Layout and the pad's
 * cursor are tests/e2e/ui.spec.ts's.
 * @see engine/ui/widgets.ts
 */
import { describe, expect, it } from 'vitest';
import type { FakeElement } from '../../tests/unit/ui/fakeDom';
import { fakeInput, overlay } from '../../tests/unit/ui/uiKit';
import { createDialog } from './dialog';
import { createMenu } from './menu';
import { createBar, createBox, createHearts, createRepeat } from './widgets';

describe('the widgets', () => {
  it('all show in ui.state(): kinds, ids, values and text (snapshot)', () => {
    const ui = overlay();
    const input = fakeInput();
    ui.attach(createBar(ui.root, { id: 'hp', value: 30, max: 40, label: 'HP' }).el, 'top-left');
    ui.attach(createHearts(ui.root, { id: 'life', hp: 2.5, max: 3 }).el, 'top-left');
    ui.attach(createBox(ui.root, { id: 'quest', title: 'Quest', text: 'Find the key' }).el, 'top-right');
    createDialog(ui.root, { input }).say('Hello, traveler!', { name: 'OLD MAN' }).update(0.1);
    createMenu(ui.root, ['Start', { label: 'Continue', disabled: true }, { label: 'Quit', id: 'quit' }], { input, title: 'Menu', id: 'title' }); // prettier-ignore
    const elements = ui.state().elements.map(({ box, ...rest }) => rest);
    expect(elements).toMatchInlineSnapshot(`
      [
        {
          "id": "hp",
          "kind": "bar",
          "text": "HP 30/40",
          "value": "0.75",
          "visible": true,
        },
        {
          "id": "life",
          "kind": "hearts",
          "text": "♥♥♥",
          "value": "2.5/3",
          "visible": true,
        },
        {
          "id": "quest",
          "kind": "box",
          "text": "QuestFind the key",
          "visible": true,
        },
        {
          "kind": "dialog",
          "text": "OLD MANHello",
          "value": "typing",
          "visible": true,
        },
        {
          "kind": "dialog-name",
          "text": "OLD MAN",
          "visible": true,
        },
        {
          "kind": "dialog-text",
          "text": "Hello",
          "visible": true,
        },
        {
          "id": "title",
          "kind": "menu",
          "text": "MenuStartContinueQuit",
          "value": "0",
          "visible": true,
        },
        {
          "kind": "menu-title",
          "text": "Menu",
          "visible": true,
        },
        {
          "id": "0",
          "kind": "item",
          "text": "Start",
          "value": "selected",
          "visible": true,
        },
        {
          "id": "1",
          "kind": "item",
          "text": "Continue",
          "value": "disabled",
          "visible": true,
        },
        {
          "id": "quit",
          "kind": "item",
          "text": "Quit",
          "value": "",
          "visible": true,
        },
      ]
    `);
  });

  it('a bar fills to its value over its max, clamped, and says so', () => {
    const ui = overlay();
    const bar = createBar(ui.root, { id: 'boss', value: 5, max: 20, label: 'Boss', color: '#8a5cff' });
    expect([bar.el.dataset.value, bar.el.textContent, bar.el.style.getPropertyValue('--ui-color')]).toEqual(['0.25', 'Boss 5/20', '#8a5cff']); // prettier-ignore
    bar.set(30);
    expect([bar.el.dataset.value, bar.el.textContent]).toEqual(['1', 'Boss 30/20']);
    bar.set(-1);
    expect(bar.el.style.getPropertyValue('--ui-fill')).toBe('0');
    expect(createBar(ui.root, { id: 'mp', value: 0.5 }).el.textContent).toBe(''); // no label: no text
    bar.remove();
    expect(ui.root.querySelector('[data-id=boss]')).toBeNull();
  });

  it('hearts count halves and follow a new max', () => {
    const ui = overlay();
    const hearts = createHearts(ui.root, { id: 'life', hp: 1.5, max: 3 });
    const fills = () => (hearts.el as unknown as FakeElement).children.map((heart) => heart.dataset.fill);
    expect([hearts.el.dataset.value, fills()]).toEqual(['1.5/3', ['full', 'half', 'empty']]);
    hearts.set([4, 4.5]);
    expect([hearts.el.dataset.value, fills()]).toEqual(['4/4.5', ['full', 'full', 'full', 'full', 'empty']]);
    hearts.set([0.4, 2]);
    expect(fills()).toEqual(['empty', 'empty']);
  });

  it('a box has a title and a body that changes', () => {
    const ui = overlay();
    const box = createBox(ui.root, { id: 'tip', title: 'Tip' });
    box.set('Hold Shift to sprint');
    expect(box.el.textContent).toBe('TipHold Shift to sprint');
    expect(box.body.textContent).toBe('Hold Shift to sprint');
  });

  it('a held direction repeats after 0.35 s, then every 0.1 s', () => {
    const repeat = createRepeat();
    const input = fakeInput();
    const fired: number[] = [];
    input.press('uiDown');
    for (let frame = 0; frame < 40; frame++) {
      if (repeat(input, 'uiDown', 1 / 60)) fired.push(frame);
      input.frame();
    }
    expect(fired).toEqual([0, 21, 27, 33, 39]); // 0.35 s after the press, then every 0.1 s
    input.release('uiDown');
    expect(repeat(input, 'uiDown', 1 / 60)).toBe(false);
  });

  it('go in a HUD place with overlay.attach, which refuses an unknown one', () => {
    const ui = overlay();
    const bar = createBar(ui.root, { id: 'hp', value: 1 });
    ui.attach(bar.el, 'bottom');
    expect((bar.el as unknown as FakeElement).parentElement?.dataset.at).toBe('bottom');
    expect(() => ui.attach(bar.el, 'middle' as never)).toThrow(/UI_BAD_PLACE/);
  });
});
