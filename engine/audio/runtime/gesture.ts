/**
 * @file The user gestures that let a page make sound (PLAN.md WP 9.3; doctrine: Common ground): a browser starts an
 * `AudioContext` only once the person at the page has acted, so the runtime (engine/audio/runtime/audio.ts) makes and
 * resumes its context from inside one of these events, never before.
 *
 * A gesture is a key (`keydown`, except Escape, which the HTML standard does not count), a click (`click`) or the end
 * of a touch, a pen or a mouse press (`pointerup`). A touch's `pointerdown` is not one: a touch that starts may turn
 * into a scroll, so browsers grant activation only when it ends. Only trusted events count: one a script dispatched
 * would make a context the browser keeps suspended, with a console warning.
 *
 * Invariants: listeners go on in the capture phase, so a game handler that stops propagation does not keep sound
 * off; the function `onGesture` returns removes every one of them.
 *
 * @example
 * const page = new EventTarget(); // window, in a page
 * const off = onGesture(page, () => console.log('resume the context'));
 * off(); // no longer listening
 * isGesture({ type: 'keydown', key: 'Escape', isTrusted: true }); // false
 * @see engine/audio/runtime/gesture.test.ts
 */

/** The events that may be gestures, as `addEventListener` names them. */
export const GESTURE_EVENTS = Object.freeze(['keydown', 'click', 'pointerup'] as const);

/** What `isGesture` reads of an event. */
export interface GestureEvent {
  readonly type: string;
  readonly isTrusted: boolean;
  /** `KeyboardEvent.key`, for `keydown`. */
  readonly key?: string;
}

/** Where gestures arrive: `window`, or any `EventTarget`. */
export type GestureTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/** Whether `event` lets a page start sound: a trusted key other than Escape, click or pointer release. */
export function isGesture(event: GestureEvent): boolean {
  if (!event.isTrusted) return false;
  if (event.type === 'keydown') return event.key !== 'Escape';
  return event.type === 'click' || event.type === 'pointerup';
}

/** Calls `listener` on every gesture at `target` (capture phase); returns the function that stops listening. */
export function onGesture(target: GestureTarget, listener: () => void): () => void {
  const handle = (event: Event) => {
    if (isGesture(event as unknown as GestureEvent)) listener();
  };
  for (const type of GESTURE_EVENTS) target.addEventListener(type, handle, { capture: true });
  return () => {
    for (const type of GESTURE_EVENTS) target.removeEventListener(type, handle, { capture: true });
  };
}
