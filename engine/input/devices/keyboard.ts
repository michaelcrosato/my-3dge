/**
 * @file The keyboard device (PLAN.md WP 3.3, I-24): key events → codes by `KeyboardEvent.code`, the physical key, so
 * bindings hold on every layout (engine/input/codes.ts). A key held down presses once (auto-repeat events are
 * ignored), a key pressed and let go between two samples still counts as pressed (the sink keeps it), and a bound
 * key's default is prevented, so Space does not scroll the page under the game.
 *
 * Invariants: keys typed into a text field, a text area, a select or editable content are the page's, not the game's;
 * a key-up always releases, wherever it lands. `attachKeyboard` returns the function that removes its listeners.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:491-499` (the typing filter, `preventDefault` on bound keys, `repeat`).
 *
 * @example
 * const target = new EventTarget();
 * const presses: string[] = [];
 * const sink = { press: (code: string) => presses.push(code), release() {}, analog() {}, used() {}, bound: () => true };
 * const detach = attachKeyboard(target, sink);
 * target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyW', repeat: false }));
 * target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyW', repeat: true })); // auto-repeat: ignored
 * presses; // ['KeyW']
 * detach();
 * @see engine/input/devices/devices.test.ts
 */
import { deviceOf, type InputSink } from '../codes';

/** The fields of a key event the device reads. */
interface KeyEventLike extends Event {
  readonly code: string;
  readonly repeat?: boolean;
}

/** Input types whose element still lets keys through to the game (no text goes into them). */
const NOT_TYPING = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image']);

/** Whether a key event's target is somewhere the player types. */
export function isTyping(target: EventTarget | null): boolean {
  const element = target as { tagName?: string; type?: string; isContentEditable?: boolean } | null;
  if (!element?.tagName) return false;
  const tag = element.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable) return true;
  return tag === 'INPUT' && !NOT_TYPING.has((element.type ?? 'text').toLowerCase());
}

/** Listens for keys on `target` (the window) and writes them to `sink`; returns the detach function. */
export function attachKeyboard(target: EventTarget, sink: InputSink): () => void {
  const down = (event: Event) => {
    const { code, repeat } = event as KeyEventLike;
    if (!code || deviceOf(code) !== 'keyboard' || isTyping(event.target)) return;
    if (sink.bound(code)) event.preventDefault();
    if (!repeat) sink.press(code, 'keyboard');
  };
  const up = (event: Event) => {
    const { code } = event as KeyEventLike;
    if (code) sink.release(code);
  };
  target.addEventListener('keydown', down);
  target.addEventListener('keyup', up);
  return () => {
    target.removeEventListener('keydown', down);
    target.removeEventListener('keyup', up);
  };
}
