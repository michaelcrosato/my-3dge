/**
 * @file The gamepad device (PLAN.md WP 3.3, I-24): polls the Gamepad API once per sample and writes its buttons and
 * sticks as codes (engine/input/codes.ts). Any slot works: the active pad stays while it is connected, a pad in
 * another slot takes over when it is used while the active one rests, and a pad that leaves (disconnected or
 * replaced) releases everything it held at once.
 *
 * Sticks get a radial deadzone, rescaled so the stick still reaches 1: a lean of l ≤ d gives 0, otherwise the
 * direction times min(1, (l − d) / (1 − d)), so there is no jump at the edge and no drift. The four direction codes of
 * each stick carry how far it leans that way, so a half-pushed stick walks at half speed; they count as held from 0.5
 * and let go below 0.4, as the triggers do (analog, `value` 0 to 1). Other buttons are held as the browser reports.
 *
 * Invariants: buttons are read by the standard mapping's index (`PAD_BUTTONS`); a pad with another `mapping` is read
 * the same way, as browsers expose it. `deadzone` is clamped to [0.05, 0.5]. Nothing here reads a clock.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:595-619` (`tick`: any slot, the radial deadzone, release on
 * disconnect) and `my-3d2dge:docs/CONTROLS-AUDIT.md` (slot 0 only, drift and stuck buttons were its bugs).
 *
 * @example
 * radialDeadzone(0.1, 0, 0.18); // [0, 0]: inside the deadzone
 * radialDeadzone(0.59, 0, 0.18); // [0.5, 0]: rescaled, so half the travel past the deadzone is 0.5
 * radialDeadzone(0, -1, 0.18); // [0, -1]: still reaches the edge
 * @see engine/input/devices/devices.test.ts
 */
import { MathUtils } from '../../core/math';
import { PAD_BUTTONS, padStyle, type InputSink, type PadStyle } from '../codes';

/** The Gamepad API's `Gamepad`, as far as the device reads it (a test stub gives just this). */
export interface GamepadLike {
  readonly id: string;
  readonly index: number;
  readonly connected: boolean;
  readonly mapping?: string;
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[];
}

/** Where pads come from: `navigator.getGamepads`, or a test's slots. */
export type GamepadSource = () => readonly (GamepadLike | null)[];

/** The stick deadzone by default (the prototype's). */
export const DEADZONE = 0.18;

/** An analog code is held from this strength… */
const PRESS = 0.5;
/** …until it falls below this one. */
const LET_GO = 0.4;

/** A stick reading with a radial deadzone `d`, rescaled so the edge still reaches 1. */
export function radialDeadzone(x: number, y: number, d: number): [number, number] {
  const length = Math.hypot(x, y);
  if (length <= d || length === 0) return [0, 0];
  const k = Math.min(1, (length - d) / (1 - d)) / length;
  return [x * k, y * k];
}

/** The gamepad device: `poll()` once per sample; the right stick and the family for the camera and prompts. */
export interface GamepadDevice {
  /** Reads the pads and writes the active one's codes. */
  poll(): void;
  /** The active pad's right stick after the deadzone, `[x, y]` with y down as the API gives it; `[0, 0]` without one. */
  rightStick(): [number, number];
  /** The active pad's slot, or null. */
  readonly index: number | null;
  /** The active pad's family, for labels. */
  readonly style: PadStyle;
  /** Lets go of the active pad (a `gamepaddisconnected`, or a page blur). */
  release(): void;
}

/** Makes the gamepad device over `source`, writing to `sink`. */
export function createGamepadDevice(sink: InputSink, source: GamepadSource, deadzone = DEADZONE): GamepadDevice {
  const d = MathUtils.clamp(deadzone, 0.05, 0.5);
  let active: { index: number; id: string } | null = null;
  let right: [number, number] = [0, 0];
  let style: PadStyle = 'xbox';
  const held = new Set<string>();
  const set = (code: string, value: number, down: boolean) => {
    if (down && !held.has(code)) {
      held.add(code);
      sink.press(code, 'gamepad');
    } else if (!down && held.delete(code)) sink.release(code);
    sink.analog(code, value);
  };
  const busy = (pad: GamepadLike) =>
    pad.buttons.some((button) => button.pressed) ||
    Math.hypot(pad.axes[0] ?? 0, pad.axes[1] ?? 0) > d ||
    Math.hypot(pad.axes[2] ?? 0, pad.axes[3] ?? 0) > d;
  const device: GamepadDevice = {
    get index() {
      return active?.index ?? null;
    },
    get style() {
      return style;
    },
    rightStick: () => [...right],
    release() {
      for (const code of held) sink.release(code);
      held.clear();
      right = [0, 0];
      active = null;
    },
    poll() {
      let pads: GamepadLike[] = [];
      try {
        pads = [...source()].filter((pad): pad is GamepadLike => !!pad && pad.connected !== false);
      } catch {
        pads = []; // a page in a frame may not read gamepads
      }
      let pad = pads.find((p) => active && p.index === active.index && p.id === active.id);
      const other = pads.find((p) => p !== pad && busy(p));
      if (!pad || (other && !busy(pad))) {
        if (active) device.release();
        pad = other ?? pads[0];
        if (!pad) return;
        active = { index: pad.index, id: pad.id };
        style = padStyle(pad.id);
      }
      read(pad);
    },
  };
  const read = (pad: GamepadLike) => {
    PAD_BUTTONS.forEach((code, i) => {
      const button = pad.buttons[i];
      const value = button ? (Number.isFinite(button.value) ? button.value : button.pressed ? 1 : 0) : 0;
      const analog = code === 'PadLeftTrigger' || code === 'PadRightTrigger';
      const down = analog ? value >= (held.has(code) ? LET_GO : PRESS) : !!button?.pressed;
      set(code, analog ? value : down ? 1 : 0, down);
    });
    for (const [side, at] of [
      ['Left', 0],
      ['Right', 2],
    ] as const) {
      const [x, y] = radialDeadzone(pad.axes[at] ?? 0, pad.axes[at + 1] ?? 0, d);
      if (side === 'Right') right = [x, y];
      const lean: [string, number][] = [
        ['Up', -y],
        ['Down', y],
        ['Left', -x],
        ['Right', x],
      ];
      for (const [way, amount] of lean) {
        const code = `Pad${side}Stick${way}`;
        const value = Math.max(0, amount);
        set(code, value, value >= (held.has(code) ? LET_GO : PRESS));
      }
    }
    if (busy(pad)) sink.used('gamepad');
  };
  return device;
}
