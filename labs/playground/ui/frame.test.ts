/**
 * @file Unit tests for a screen's frame (labs/playground/ui/frame.ts): the footer names the menus' keys on the device
 * used last, the engine's labels of the system actions (Enter and Esc on the keyboard and the mouse, A and B on a pad),
 * cancelling plays on the start menu and goes back on every other screen, a panel names only that and a side panel
 * nothing; made (over tests/unit/ui/fakeDom.ts), the footer is a key hint (`data-keyboard`: a touch screen hides it)
 * that follows a change of device at the next `refresh()`, and a frame without one has none; the brand names the
 * engine's version.
 * @see labs/playground/ui/frame.ts
 */
import { describe, expect, it } from 'vitest';
import { SYSTEM_ACTIONS } from '../../../engine/input/actionMaps';
import { pickLabel } from '../../../engine/input/bindings';
import type { DeviceKind } from '../../../engine/input/codes';
import { fakePage, type FakeElement } from '../../../tests/unit/ui/fakeDom';
import { ENGINE_VERSION } from '../../../engine/core/version';
import { brand, createFrame, screenKeys } from './frame';

/** An input whose prompts are the engine's labels of the system actions on `device()`. */
const on = (device: () => DeviceKind) => ({
  prompt: (action: string) => pickLabel(SYSTEM_ACTIONS[action as keyof typeof SYSTEM_ACTIONS] ?? [], device()),
});

describe('a screen’s frame', () => {
  it('names the menus’ keys on the device used last, cancelling playing on the start menu', () => {
    const keys = (device: DeviceKind) => ['title', 'menu', 'list', 'panel', 'side'].map((kind) => screenKeys(on(() => device), kind)); // prettier-ignore
    expect(keys('keyboard')).toEqual([
      'Enter: select · Esc: play',
      'Enter: select · Esc: back',
      'Enter: select · Esc: back',
      'Esc: back',
      '',
    ]);
    expect(keys('mouse')).toEqual(keys('keyboard'));
    expect(keys('gamepad')).toEqual([
      'A: select · B: play',
      'A: select · B: back',
      'A: select · B: back',
      'B: back',
      '',
    ]);
  });

  it('heads the start menu and the splash with the engine and its version', () => {
    const { document } = fakePage({ left: 0, top: 0, width: 1280, height: 720 });
    const head = brand(document as unknown as Document, 'sub') as unknown as FakeElement;
    expect(head.querySelector('.pg-brand-kicker')?.textContent).toBe(`my-3dge ${ENGINE_VERSION}`);
    expect(head.querySelector('[data-ui=version]')?.textContent).toBe(ENGINE_VERSION);
  });

  it('marks its footer a key hint that follows the device at each refresh, and makes none when there is none', () => {
    const { document } = fakePage({ left: 0, top: 0, width: 1280, height: 720 });
    const root = document.createElement('div');
    document.body.append(root);
    let device: DeviceKind = 'keyboard';
    const input = on(() => device);
    const frame = createFrame(root as unknown as HTMLElement, 'title', null, () => screenKeys(input, 'title'));
    const foot = () => (frame.el as unknown as FakeElement).querySelector('.pg-footer');
    expect([foot()?.textContent, foot()?.hasAttribute('data-keyboard')]).toEqual(['Enter: select · Esc: play', true]);
    device = 'gamepad';
    frame.refresh();
    expect(foot()?.textContent).toBe('A: select · B: play');
    const bare = createFrame(root as unknown as HTMLElement, 'panel', '', '');
    expect((bare.el as unknown as FakeElement).querySelector('.pg-footer')).toBeNull();
  });
});
