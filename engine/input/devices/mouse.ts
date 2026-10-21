/**
 * @file The mouse device (PLAN.md WP 3.3, I-24): buttons over the game's element as codes (`MouseLeft`…), the wheel as
 * taps (`WheelUp`, `WheelDown`) and zoom steps, the pointer's position for aiming, and pointer lock for mouse look:
 * while the element holds the lock, movement turns the view by `lookSpeed` radians per pixel.
 *
 * `lock()` asks for pointer lock (browsers grant it only inside a click or key handler, and let Escape out of it);
 * `locked` follows the document's `pointerlockchange`. `takeLook()` and `takeZoom()` return what gathered since the
 * last call and start again from zero, once per rendered frame: look is `[right, up]` radians (screen y is down, so up
 * is −y unless `invertY`; the page's input takes counts, `lookSpeed` 1, and scales them by the view settings
 * `input.*`, engine/input/look.ts), zoom is wheel notches (+ towards the screen, as a wheel pushed forward zooms in).
 * `pointer()` says where the pointer is, and with an element that has a box (a canvas) where on it as `at`, from −1
 * to 1 with +y up, as three.js's normalized device coordinates: where the pointer aims (engine/input/aim.ts).
 *
 * Invariants: a button is pressed only over the element, and released wherever it is let go; the context menu never
 * opens over the element, so the right button binds; wheel deltas in lines and pages are converted to pixels (40 and
 * 800 a unit) and one notch is 100 px, as Chromium scrolls. `attachMouse` returns the device; `detach()` removes its
 * listeners.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:501-507` (mouse buttons over the canvas, the context menu), with pointer
 * lock and the wheel added.
 *
 * @example
 * const element = new EventTarget();
 * const presses: string[] = [];
 * const sink = { press: (code: string) => presses.push(code), release() {}, analog() {}, used() {}, bound: () => true };
 * const mouse = attachMouse({ element, target: new EventTarget() }, sink);
 * element.dispatchEvent(Object.assign(new Event('pointerdown'), { pointerType: 'mouse', button: 2, clientX: 5, clientY: 6 }));
 * element.dispatchEvent(Object.assign(new Event('wheel'), { deltaY: -200, deltaMode: 0 }));
 * presses; // ['MouseRight', 'WheelUp']
 * mouse.takeZoom(); // 2: two notches towards the screen
 * mouse.pointer(); // { x: 5, y: 6, inside: true, locked: false }
 * @see engine/input/devices/devices.test.ts
 */
import { MOUSE_BUTTONS, type InputSink } from '../codes';

/** Mouse look speed by default, radians per pixel (about 0.14° a pixel). */
export const LOOK_SPEED = 0.0025;

/** Pixels per wheel notch, as Chromium scrolls. */
const NOTCH = 100;

/** The fields of pointer and wheel events the device reads. */
interface MouseEventLike extends Event {
  readonly pointerType?: string;
  readonly button?: number;
  readonly clientX?: number;
  readonly clientY?: number;
  readonly movementX?: number;
  readonly movementY?: number;
  readonly deltaY?: number;
  readonly deltaMode?: number;
}

/** Where the mouse device listens. */
export interface MouseTargets {
  /** The game's element (the canvas): presses, wheel and pointer lock happen over it; its box places the pointer. */
  element: EventTarget & {
    requestPointerLock?(): unknown;
    getBoundingClientRect?(): { left: number; top: number; width: number; height: number };
  };
  /** Where releases arrive wherever the pointer is (the window). */
  target: EventTarget;
  /** The document: pointer lock changes (`pointerLockElement`). */
  document?: EventTarget & { pointerLockElement?: unknown; exitPointerLock?(): void };
}

/** Where the pointer is: client pixels, over the element or not, locked or not; `at` on the element (see the file comment). */ // prettier-ignore
export interface MousePointer {
  x: number;
  y: number;
  inside: boolean;
  locked: boolean;
  /** Where on the element, `[x, y]` from −1 to 1 with +y up; absent when the element has no box. */
  at?: [number, number];
}

/** The mouse device. */
export interface MouseDevice {
  /** Whether the element holds pointer lock. */
  readonly locked: boolean;
  /** Asks for pointer lock on the element (call it from a click or key handler). */
  lock(): void;
  /** Leaves pointer lock. */
  unlock(): void;
  /** The look gathered since the last call, `[right, up]` rad; then zero. */
  takeLook(): [number, number];
  /** The wheel notches gathered since the last call (+ zooms in); then zero. */
  takeZoom(): number;
  /** The pointer: client pixels, whether it is over the element, whether it is locked, and where on the element. */
  pointer(): MousePointer;
  /** Forgets gathered look and zoom (a blur). */
  clear(): void;
  /** Removes the listeners. */
  detach(): void;
}

/** Listens to the mouse over `targets.element`; `lookSpeed` rad/px, `invertY` for flight-style look. */
export function attachMouse(
  targets: MouseTargets,
  sink: InputSink,
  options: { lookSpeed?: number; invertY?: boolean } = {},
): MouseDevice {
  const { element, target, document } = targets;
  const speed = options.lookSpeed ?? LOOK_SPEED;
  let look: [number, number] = [0, 0];
  let zoom = 0;
  let at = { x: 0, y: 0, inside: false };
  let locked = false;
  const listeners: [EventTarget, string, (event: Event) => void, AddEventListenerOptions?][] = [
    [element, 'pointerdown', (event) => {
      const e = event as MouseEventLike;
      if (e.pointerType !== 'mouse') return;
      at = { x: e.clientX ?? 0, y: e.clientY ?? 0, inside: true };
      const code = MOUSE_BUTTONS[e.button ?? 0];
      if (code) sink.press(code, 'mouse');
    }],
    [target, 'pointerup', (event) => {
      const e = event as MouseEventLike;
      const code = e.pointerType === 'mouse' ? MOUSE_BUTTONS[e.button ?? 0] : undefined;
      if (code) sink.release(code);
    }],
    [element, 'pointermove', (event) => {
      const e = event as MouseEventLike;
      if (e.pointerType !== 'mouse') return;
      at = { x: e.clientX ?? at.x, y: e.clientY ?? at.y, inside: true };
      const dx = e.movementX ?? 0;
      const dy = e.movementY ?? 0;
      if (locked) look = [look[0] + dx * speed, look[1] + (options.invertY ? dy : -dy) * speed];
      if (Math.abs(dx) + Math.abs(dy) >= 2) sink.used('mouse');
    }],
    [element, 'pointerleave', () => void (at = { ...at, inside: false })],
    [element, 'wheel', (event) => {
      const e = event as MouseEventLike;
      event.preventDefault();
      const pixels = (e.deltaY ?? 0) * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1);
      if (!pixels) return;
      zoom -= pixels / NOTCH;
      const code = pixels < 0 ? 'WheelUp' : 'WheelDown';
      sink.press(code, 'mouse');
      sink.release(code);
    }, { passive: false }],
    [element, 'contextmenu', (event) => event.preventDefault()],
  ]; // prettier-ignore
  if (document) {
    listeners.push([document, 'pointerlockchange', () => void (locked = document.pointerLockElement === element)]);
  }
  for (const [where, type, listener, how] of listeners) where.addEventListener(type, listener, how);
  return {
    get locked() {
      return locked;
    },
    lock() {
      const asked = element.requestPointerLock?.();
      if (asked instanceof Promise) asked.catch(() => {}); // refused outside a gesture: the page tries again on a click
    },
    unlock: () => document?.exitPointerLock?.(),
    takeLook() {
      const out = look;
      look = [0, 0];
      return out;
    },
    takeZoom() {
      const out = zoom;
      zoom = 0;
      return out;
    },
    pointer() {
      const box = element.getBoundingClientRect?.();
      if (!box || !(box.width > 0 && box.height > 0)) return { ...at, locked };
      const place: [number, number] = [
        ((at.x - box.left) / box.width) * 2 - 1,
        1 - ((at.y - box.top) / box.height) * 2,
      ];
      return { ...at, locked, at: place };
    },
    clear() {
      look = [0, 0];
      zoom = 0;
    },
    detach() {
      for (const [where, type, listener, how] of listeners) where.removeEventListener(type, listener, how);
    },
  };
}
