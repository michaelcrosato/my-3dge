/**
 * @file Unit tests for photo mode's hint (labs/playground/ui/photo.ts), over tests/unit/ui/fakeDom.ts: it names the
 * keys of the device used last, the one that leaves too (Esc on the keyboard, B on a pad), the mouse's and P only off a
 * pad, marked a key hint for touch, and goes with photo mode. Flying it is checked in the page
 * (tests/e2e/playground.spec.ts).
 * @see labs/playground/ui/photo.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SYSTEM_ACTIONS } from '../../../engine/input/actionMaps';
import { pickLabel } from '../../../engine/input/bindings';
import type { DeviceKind } from '../../../engine/input/codes';
import { fakePage, type FakeElement } from '../../../tests/unit/ui/fakeDom';
import { createPhoto } from './photo';

afterEach(() => void vi.unstubAllGlobals());

/** Photo mode's hint on entering it, the prompts on `device` (the system actions' labels; the map's keys by name). */
function hintOn(device: DeviceKind): string | undefined {
  vi.stubGlobal('addEventListener', () => undefined); // the drag's window listeners
  const { document, canvas } = fakePage({ left: 0, top: 0, width: 1280, height: 720 });
  const parent = document.createElement('div');
  const input = {
    lastDevice: device,
    held: () => false,
    prompt: (action: string) => pickLabel(SYSTEM_ACTIONS[action as keyof typeof SYSTEM_ACTIONS] ?? [`Key${action[0].toUpperCase()}`], device), // prettier-ignore
  };
  let code = 'cam3=shoulder';
  const camera = { get: () => ({ code }), set: (next: string) => ({ code: (code = next) }) };
  const photo = createPhoto(parent as unknown as HTMLElement, canvas as unknown as HTMLElement, input, () => camera);
  photo.enter();
  const hint = parent.querySelector('[data-ui=photo]') as FakeElement;
  const text = hint.hidden ? undefined : hint.textContent;
  expect(hint.dataset.keyboard).toBe(''); // a key hint: the overlay hides it on a touch screen
  photo.leave();
  expect([hint.hidden, code]).toEqual([true, 'cam3=shoulder']);
  return text;
}

describe('photo mode’s hint', () => {
  it('names the key that leaves on the device used last', () => {
    expect(hintOn('keyboard')).toMatch(/^Photo mode · .* · Esc: leave$/);
    expect(hintOn('gamepad')).toMatch(/^Photo mode · .* · B: leave$/);
  });

  it('names the mouse’s drag and wheel and the look’s P off a pad only', () => {
    expect(hintOn('keyboard')).toMatch(/ · drag: look · wheel: zoom · P: look · /);
    expect(hintOn('gamepad')).not.toMatch(/drag|wheel|P: look/);
  });
});
