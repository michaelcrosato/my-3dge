/**
 * @file Unit tests for the gestures (engine/audio/runtime/gesture.ts): a key other than Escape, a click and a pointer
 * release count, trusted only; a touch's pointerdown does not; `onGesture` listens in the capture phase and stops.
 */
import { describe, expect, it } from 'vitest';
import { GESTURE_EVENTS, isGesture, onGesture, type GestureTarget } from './gesture';

/** A target that records its listeners and dispatches plain event objects to them. */
function fakeTarget() {
  const listeners = new Map<string, { listener: (event: unknown) => void; capture: boolean }>();
  const target: GestureTarget = {
    addEventListener(type, listener, options) {
      const capture = typeof options === 'object' && options !== null && options.capture === true;
      listeners.set(type, { listener: listener as (event: unknown) => void, capture });
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
  };
  const fire = (event: { type: string; isTrusted: boolean; key?: string; pointerType?: string }) =>
    listeners.get(event.type)?.listener(event);
  return { target, listeners, fire };
}

describe('isGesture', () => {
  it('counts a trusted key other than Escape, a click and the end of any press', () => {
    expect(isGesture({ type: 'keydown', key: 'a', isTrusted: true })).toBe(true);
    expect(isGesture({ type: 'keydown', key: 'Escape', isTrusted: true })).toBe(false);
    expect(isGesture({ type: 'click', isTrusted: true })).toBe(true);
    expect(isGesture({ type: 'pointerup', isTrusted: true })).toBe(true);
  });

  it('never counts a pointerdown (a touch may become a scroll), a key release or an event a script made', () => {
    expect(isGesture({ type: 'pointerdown', isTrusted: true })).toBe(false);
    expect(isGesture({ type: 'keyup', key: 'a', isTrusted: true })).toBe(false);
    expect(isGesture({ type: 'click', isTrusted: false })).toBe(false);
    expect(isGesture({ type: 'keydown', key: 'a', isTrusted: false })).toBe(false);
  });
});

describe('onGesture', () => {
  it('listens to the three events in the capture phase, calls back on gestures only, and stops', () => {
    const { target, listeners, fire } = fakeTarget();
    let calls = 0;
    const off = onGesture(target, () => calls++);
    expect([...listeners.keys()]).toEqual([...GESTURE_EVENTS]);
    expect([...listeners.values()].every((entry) => entry.capture)).toBe(true);
    fire({ type: 'pointerup', pointerType: 'touch', isTrusted: false });
    fire({ type: 'keydown', key: 'Escape', isTrusted: true });
    expect(calls).toBe(0);
    fire({ type: 'pointerup', pointerType: 'touch', isTrusted: true });
    fire({ type: 'click', isTrusted: true });
    fire({ type: 'keydown', key: 'Enter', isTrusted: true });
    expect(calls).toBe(3);
    off();
    expect(listeners.size).toBe(0);
  });
});
