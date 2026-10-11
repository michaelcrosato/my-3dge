/**
 * @file The touch device (PLAN.md WP 3.12, ADR-0021: built, not tested): fingers on a phone or tablet, read from
 * pointer events whose `pointerType` is not `mouse`, written into the input sink like any device. Fingers are routed
 * by the DOM: what a finger first lands on keeps it (pointer capture). A `[data-action]` element is a button writing
 * the code `touch:<action>` (engine/input/codes.ts); a `[data-tap]` element (the menu button) is tapped by name; on
 * the game's element (the canvas) the first finger is the stick and the others can only tap; anything else (open
 * panels, swipeable notices) is the page's.
 *
 * The stick floats where the thumb lands: v = (dx, −dy) / `STICK_RADIUS`, so pushing up the screen is forward, then
 * a dead zone and full speed at 0.82 (`stickAxis`); a thumb that runs past the rim drags the centre along. Buttons act
 * the moment they go down and stay held while the finger stays; one marked `data-hold` acts as shardfall's skills do:
 * a tap presses it once on release, a hold (0.32 s and two frames) holds it from then on, and its release taps
 * nothing. A tap control fires on a release within 28 px however long it was down; a tap on the game is shorter than
 * 0.30 s or seen by a single frame, and moves less than 14 px. `pointercancel` never taps, and `clear()` (a blur)
 * forgets every finger.
 *
 * Touch mode starts when `(pointer: coarse)` matches or at the first touch, and ends when the mouse moves more than
 * 2 px from the last pointer (the mouse events a tap emulates land where it was). The setting `touch` (`auto`, `on`,
 * `off`; a view setting) forces it either way: an agent opens the touch layer headlessly with `x set touch on`.
 *
 * Invariants: nothing here reads a clock: `frame(now)` gives the frame's timestamp once per sample (engine/input/
 * input.ts), so ages are measured to the frame and the tools' virtual clock drives them. No `@example` runs here: it
 * would be a touch test, which the owner ruled out (ADR-0021).
 *
 * Carried from `shardfall:crates/pav_app/src/touch.rs:48-114, 165-272` (finger routing, the floating stick, taps and
 * holds) and `shardfall:crates/pav_app/src/app.rs:275-305, 1650-1653, 1724-1726` (touch mode, clear on blur, back to
 * the mouse).
 *
 * @example
 * // const touch = attachTouch({ element: canvas, target: window }, sink, { mode: () => 'auto', onTap });
 * // touch.frame(now); // once per sample
 * // fromCamera(camera.yaw(), touch.stick()); // the stick, as the move intent
 */
import type { Field } from '../../core/schema';
import { defineSettings } from '../../core/settings';
import { touchCode, type InputSink } from '../codes';

/** The stick's reach in CSS px: full speed at its rim. */
export const STICK_RADIUS = 56;
/** The stick's dead zone, as a fraction of its reach. */
export const STICK_DEAD = 0.12;
/** Where the stick reaches full speed, as a fraction of its reach. */
export const STICK_FULL = 0.82;
/** A tap on the game is shorter than this (s), or seen by a single frame. */
export const TAP_TIME = 0.3;
/** A tap on the game moves less than this (CSS px). */
export const TAP_SLOP = 14;
/** A release on a button or tap control that moved less than this (CSS px) is a tap, however long it was down. */
export const BUTTON_SLOP = 2 * TAP_SLOP;
/** A hold lasts at least this long (s) … */
export const HOLD_TIME = 0.32;
/** … and is seen by at least this many frames, so a slow frame never turns a tap into a hold. */
export const HOLD_FRAMES = 2;
/** The mouse ends touch mode once it moves more than this (CSS px) from the last pointer. */
export const MOUSE_SLOP = 2;

/** The `touch` setting: touch mode as detected (`auto`), or forced `on` or `off`. */
export type TouchSetting = 'auto' | 'on' | 'off';

/** The touch settings: view settings, never in the hash. */
export const TOUCH_SETTINGS = {
  touch: {
    type: 'string',
    enum: ['auto', 'on', 'off'],
    default: 'auto',
    view: true,
    description:
      "Touch mode, which shows the touch controls and the phone defaults: 'auto' follows the screen (a coarse pointer or a first touch on, the mouse off), 'on' and 'off' force it.",
  },
} as const satisfies Record<string, Field>;
defineSettings(TOUCH_SETTINGS);

/** Where the touch device listens. */
export interface TouchTargets {
  /** The game's element (the canvas): the stick and taps on the game. */
  element: EventTarget;
  /** Where pointer events arrive, wherever they land (the window). */
  target: EventTarget;
}

/** How the device behaves beyond its targets. */
export interface TouchOptions {
  /** The `touch` setting now; `auto` when absent. */
  mode?: () => TouchSetting;
  /** A tap on a `[data-tap]` control (its value: `menu`), or on the open game (`game`), as it happens. */
  onTap?: (name: string) => void;
  /** Whether the screen's main pointer is coarse (`matchMedia('(pointer: coarse)')`, read once by default). */
  coarse?: boolean;
}

/** Where the stick is drawn, in client CSS px: its centre and its knob. */
export interface StickView {
  anchor: [number, number];
  knob: [number, number];
}

/** The touch device. */
export interface TouchDevice {
  /** Whether touch mode is on: detected (unless the setting is `off`) or forced `on`. */
  readonly active: boolean;
  /** Counts a frame at timestamp `now` (ms): holds start here. Call once per sample. */
  frame(now: number): void;
  /** The stick as `[right, forward]`, length at most 1; `[0, 0]` without a thumb on it. */
  stick(): [number, number];
  /** Where the stick is drawn, or null without a thumb on it. */
  stickView(): StickView | null;
  /** The controls under a finger now, by name (`data-action` or `data-tap`), for the pressed look. */
  down(): string[];
  /** Forgets every finger (a blur); the input lets go of their codes. */
  clear(): void;
  /** Removes the listeners. */
  detach(): void;
}

/** The fields of pointer events the device reads. */
interface FingerEvent extends Event {
  readonly pointerId?: number;
  readonly pointerType?: string;
  readonly clientX?: number;
  readonly clientY?: number;
}

/** What a finger landed on. */
type Owner = 'stick' | 'game' | 'button' | 'tap';

/** A finger on the screen. */
interface Finger {
  owner: Owner;
  /** The action (a button) or the tap name (a tap control). */
  name: string;
  /** A button that acts while held (`data-hold`). */
  hold: boolean;
  /** Became a hold: its code is down until it lifts. */
  holding: boolean;
  start: [number, number];
  pos: [number, number];
  /** The stick's centre: where the thumb landed, dragged along past the rim. */
  anchor: [number, number];
  /** The frame time when it landed (ms) and the frames that have seen it. */
  t0: number;
  frames: number;
  /** The furthest it has been from where it landed. */
  travel: number;
}

/** The stick's `[right, forward]` for a thumb `dx`, `dy` CSS px from the centre (`touch.rs:266-272`). */
export function stickAxis(dx: number, dy: number): [number, number] {
  const x = dx / STICK_RADIUS;
  const y = (0 - dy) / STICK_RADIUS; // up the screen is forward; 0 − dy keeps a still thumb at +0, never −0
  const length = Math.hypot(x, y);
  if (length < STICK_DEAD) return [0, 0];
  const k = Math.min((length - STICK_DEAD) / (STICK_FULL - STICK_DEAD), 1) / length;
  return [x * k, y * k];
}

/** Whether `(pointer: coarse)` matches on this screen (false without `matchMedia`, as in Node). */
function coarsePointer(): boolean {
  const scope = globalThis as { matchMedia?: (query: string) => { matches: boolean } };
  return scope.matchMedia?.('(pointer: coarse)').matches ?? false;
}

/** The closest element to `target` (itself included) that matches `selector`, or null. */
function closest(target: EventTarget | null, selector: string): HTMLElement | null {
  const element = target as { closest?: (selector: string) => HTMLElement | null } | null;
  return typeof element?.closest === 'function' ? element.closest(selector) : null;
}

/** Listens to fingers over the page (see the file comment). */
export function attachTouch(targets: TouchTargets, sink: InputSink, options: TouchOptions = {}): TouchDevice {
  const { element, target } = targets;
  const fingers = new Map<number, Finger>();
  let detected = options.coarse ?? coarsePointer();
  let now = 0;
  let last: [number, number] | null = null; // the last pointer, any type
  const mode = () => options.mode?.() ?? 'auto';
  const active = () => mode() === 'on' || (mode() === 'auto' && detected);
  const age = (finger: Finger) => (now - finger.t0) / 1000;
  const tapped = (finger: Finger) => (age(finger) < TAP_TIME || finger.frames <= 1) && finger.travel < TAP_SLOP;
  const at = (e: FingerEvent): [number, number] => [e.clientX ?? 0, e.clientY ?? 0];
  const clear = () => {
    for (const finger of fingers.values()) if (finger.owner === 'button') sink.release(touchCode(finger.name));
    fingers.clear();
  };
  const track = (finger: Finger, pos: [number, number]) => {
    finger.pos = pos;
    finger.travel = Math.max(finger.travel, Math.hypot(pos[0] - finger.start[0], pos[1] - finger.start[1]));
  };

  const down = (event: Event) => {
    const e = event as FingerEvent;
    const pos = at(e);
    if (e.pointerType === 'mouse') return void (last = pos);
    last = pos;
    detected = true;
    if (!active() || e.pointerId === undefined) return;
    const control = closest(e.target, '[data-action], [data-tap]');
    const name = control?.dataset.action ?? control?.dataset.tap;
    let owner: Owner;
    if (control && name) owner = control.dataset.action ? 'button' : 'tap';
    else if (e.target === element) owner = [...fingers.values()].some((f) => f.owner === 'stick') ? 'game' : 'stick';
    else return; // a panel, a notice: the page's
    const captor = (control ?? element) as { setPointerCapture?: (id: number) => void };
    try {
      captor.setPointerCapture?.(e.pointerId);
    } catch {
      // the pointer is already gone: its up event follows
    }
    const hold = owner === 'button' && control?.dataset.hold !== undefined;
    const finger: Finger = { owner, name: name ?? '', hold, holding: false, start: pos, pos, anchor: pos, t0: now, frames: 0, travel: 0 }; // prettier-ignore
    fingers.set(e.pointerId, finger);
    if (owner === 'button' && !hold) sink.press(touchCode(finger.name), 'touch');
    else sink.used('touch');
  };

  const move = (event: Event) => {
    const e = event as FingerEvent;
    const pos = at(e);
    if (e.pointerType === 'mouse') {
      if (last && Math.hypot(pos[0] - last[0], pos[1] - last[1]) > MOUSE_SLOP && detected) {
        detected = false;
        if (!active()) clear();
      }
      last = pos;
      return;
    }
    last = pos;
    const finger = e.pointerId === undefined ? undefined : fingers.get(e.pointerId);
    if (!finger) return;
    track(finger, pos);
    if (finger.owner !== 'stick') return;
    const dx = pos[0] - finger.anchor[0];
    const dy = pos[1] - finger.anchor[1];
    const length = Math.hypot(dx, dy);
    if (length > STICK_RADIUS) {
      const k = STICK_RADIUS / length;
      finger.anchor = [pos[0] - dx * k, pos[1] - dy * k];
    }
    sink.used('touch');
  };

  const up = (event: Event) => {
    const e = event as FingerEvent;
    if (e.pointerType === 'mouse' || e.pointerId === undefined) return;
    const finger = fingers.get(e.pointerId);
    if (!finger) return;
    fingers.delete(e.pointerId);
    last = at(e);
    track(finger, last);
    const cancelled = e.type === 'pointercancel';
    const code = touchCode(finger.name);
    const tap = !cancelled && finger.travel < BUTTON_SLOP;
    if (finger.owner === 'button') {
      if (!finger.hold || finger.holding) sink.release(code);
      else if (tap) {
        sink.press(code, 'touch');
        sink.release(code);
      }
    } else if (finger.owner === 'tap') {
      if (tap) options.onTap?.(finger.name);
    } else if (!cancelled && tapped(finger)) options.onTap?.('game');
  };

  const listeners: [string, (event: Event) => void][] = [
    ['pointerdown', down],
    ['pointermove', move],
    ['pointerup', up],
    ['pointercancel', up],
  ];
  for (const [type, listener] of listeners) target.addEventListener(type, listener);
  return {
    get active() {
      return active();
    },
    frame(time) {
      if (Number.isFinite(time)) now = time;
      for (const finger of fingers.values()) {
        finger.frames++;
        const holds = finger.hold && !finger.holding && finger.travel < BUTTON_SLOP;
        if (holds && age(finger) >= HOLD_TIME && finger.frames >= HOLD_FRAMES) {
          finger.holding = true;
          sink.press(touchCode(finger.name), 'touch');
        }
      }
    },
    stick() {
      const finger = [...fingers.values()].find((f) => f.owner === 'stick');
      return finger ? stickAxis(finger.pos[0] - finger.anchor[0], finger.pos[1] - finger.anchor[1]) : [0, 0];
    },
    stickView() {
      const finger = [...fingers.values()].find((f) => f.owner === 'stick');
      return finger ? { anchor: [...finger.anchor], knob: [...finger.pos] } : null;
    },
    down: () => [...fingers.values()].filter((f) => f.owner === 'button' || f.owner === 'tap').map((f) => f.name),
    clear,
    detach() {
      for (const [type, listener] of listeners) target.removeEventListener(type, listener);
    },
  };
}
