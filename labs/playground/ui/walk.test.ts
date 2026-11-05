/**
 * @file Unit tests for working a panel with the menus' keys (labs/playground/ui/walk.ts), over stand-in controls: on a
 * pad, the first press focuses the first control, then up and down walk round both ends past the disabled and the
 * hidden; the keyboard leaves the walking to Tab; accept presses the focused button, box or fold, never a slider or a
 * list; left and right step the focused slider by its step and the list by a choice it may take, firing what a hand's
 * change fires, and nothing at their ends.
 * @see labs/playground/ui/walk.ts
 */
import { describe, expect, it } from 'vitest';
import type { DeviceKind } from '../../../engine/input/codes';
import { walkPanel, type WalkInput } from './walk';

/** A stand-in control: what the walk reads and calls, and what it did (`events`, `clicks`). */
interface Control {
  tagName: string;
  type: string;
  disabled: boolean;
  shows: boolean;
  value: string;
  selectedIndex: number;
  options: { disabled: boolean }[];
  events: string[];
  clicks: number;
}

/** A panel of `specs`' controls in a stand-in page, and a way to press keys over it on `device`. */
function panelOf(specs: Partial<Control>[]) {
  const doc = { activeElement: null as unknown };
  const controls = specs.map((spec) => {
    const control = {
      ...{ tagName: 'BUTTON', type: '', disabled: false, shows: true, value: '', selectedIndex: -1, options: [] },
      ...spec,
      events: [] as string[],
      clicks: 0,
      getClientRects: () => (control.shows ? [{}] : []),
      focus: () => void (doc.activeElement = control),
      click: () => void control.clicks++,
      dispatchEvent: (event: Event) => (control.events.push(`${event.type}${event.bubbles ? '' : ' (stays)'}`), true),
      stepUp: () => void (control.value = String(Math.min(1, Math.round((Number(control.value) + 0.25) * 100) / 100))),
      stepDown: () =>
        void (control.value = String(Math.max(0, Math.round((Number(control.value) - 0.25) * 100) / 100))),
    };
    return control;
  });
  const panel = { ownerDocument: doc, querySelectorAll: () => controls } as unknown as HTMLElement;
  const press = (device: DeviceKind, ...actions: string[]) => {
    const input: WalkInput = { lastDevice: device, pressed: (action: string) => actions.includes(action) };
    walkPanel(panel, input);
  };
  const focused = () => controls.indexOf(doc.activeElement as (typeof controls)[number]);
  return { controls, press, focused };
}

describe('working a panel with the menus’ keys', () => {
  it('walks the focus on a pad round both ends, past the disabled and the hidden; the keyboard leaves it to Tab', () => {
    const { press, focused } = panelOf([{}, { disabled: true }, { shows: false }, { tagName: 'SELECT' }, {}]);
    press('keyboard', 'uiDown');
    expect(focused()).toBe(-1);
    press('gamepad', 'uiDown'); // the focus outside the panel: its first control
    expect(focused()).toBe(0);
    const walk = ['uiDown', 'uiDown', 'uiDown', 'uiUp', 'uiUp'].map((action) => (press('gamepad', action), focused()));
    expect(walk).toEqual([3, 4, 0, 4, 3]);
    press('keyboard', 'uiUp');
    expect(focused()).toBe(3);
  });

  it('presses the focused button, box or fold on either device, never a slider or a list', () => {
    const { controls, press } = panelOf([
      {},
      { tagName: 'INPUT', type: 'checkbox' },
      { tagName: 'SUMMARY' },
      { tagName: 'INPUT', type: 'range', value: '0.5' },
      { tagName: 'SELECT' },
    ]);
    press('gamepad', 'uiAccept'); // focuses the first: nothing pressed yet
    for (const device of ['gamepad', 'keyboard'] as const) {
      for (let i = 0; i < controls.length; i++) {
        if (i > 0) press('gamepad', 'uiDown');
        press(device, 'uiAccept');
      }
      press('gamepad', 'uiDown');
    }
    expect(controls.map((control) => control.clicks)).toEqual([2, 2, 2, 0, 0]);
  });

  it('steps the focused slider and list as a hand’s change does, and nothing at their ends', () => {
    const { controls, press } = panelOf([
      { tagName: 'INPUT', type: 'range', value: '0.5' },
      { tagName: 'SELECT', selectedIndex: 0, options: [{ disabled: false }, { disabled: true }, { disabled: false }] },
    ]);
    const [slider, list] = controls;
    press('gamepad', 'uiDown');
    press('keyboard', 'uiRight'); // the keyboard's arrows step a focused slider too
    press('gamepad', 'uiRight');
    press('gamepad', 'uiRight'); // at its end: nothing
    expect([slider.value, slider.events]).toEqual(['1', ['input', 'change', 'input', 'change']]);
    press('gamepad', 'uiDown');
    press('gamepad', 'uiRight'); // past the choice it may not take
    press('gamepad', 'uiRight');
    expect([list.selectedIndex, list.events]).toEqual([2, ['change']]);
    press('gamepad', 'uiLeft');
    press('gamepad', 'uiLeft');
    expect([list.selectedIndex, list.events]).toEqual([0, ['change', 'change']]);
  });
});
