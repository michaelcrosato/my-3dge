/**
 * @file What the UI widgets' unit tests share (engine/ui/{widgets,dialog,menu}.test.ts): an overlay over a canvas in a
 * fresh stand-in page (tests/unit/ui/fakeDom.ts), and a page input a test drives a frame at a time.
 *
 * Invariants: `press` holds and presses an action until the next `frame()`; `release` lets go; strengths are 1 held,
 * else 0; the device used last is the one given (a keyboard by default).
 *
 * @example
 * const input = fakeInput();
 * input.press('uiAccept');
 * [input.pressed('uiAccept'), input.held('uiAccept')]; // [true, true]
 * input.frame();
 * input.pressed('uiAccept'); // false: a press lasts one frame
 * @see engine/ui/widgets.test.ts
 */
import { createOverlay, type Overlay } from '../../../engine/ui/overlay';
import type { UiInput } from '../../../engine/ui/widgets';
import { asDom, fakePage } from './fakeDom';

/** An overlay over a 640 × 360 canvas in a fresh fake page. */
export function overlay(): Overlay {
  const page = fakePage({ left: 0, top: 0, width: 640, height: 360 });
  page.document.body.append(page.canvas);
  return createOverlay({ canvas: asDom(page).canvas });
}

/** A test's page input (see the file comment). */
export interface FakeInput extends UiInput {
  press(action: string): void;
  release(action: string): void;
  frame(): void;
}

/** A page input on `device` (see the file comment). */
export function fakeInput(device = 'keyboard'): FakeInput {
  const held = new Set<string>();
  let pressed = new Set<string>();
  return {
    held: (action) => held.has(action),
    pressed: (action) => pressed.has(action),
    strength: (action) => (held.has(action) ? 1 : 0),
    lastDevice: device,
    press(action) {
      pressed.add(action);
      held.add(action);
    },
    release: (action) => void held.delete(action),
    frame() {
      pressed = new Set();
    },
  };
}
