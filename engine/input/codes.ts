/**
 * @file The physical input codes (PLAN.md WP 3.3, I-24; doctrine: Common ground): what a binding names, and the label
 * a prompt shows for it. Keys are `KeyboardEvent.code` values (`KeyW`, `Space`, `ArrowUp`), the physical key whatever
 * the layout, so WASD stays under the left hand on AZERTY; mouse buttons and the wheel are `MouseLeft`, `MouseRight`,
 * `MouseMiddle`, `MouseBack`, `MouseForward`, `WheelUp` and `WheelDown`; gamepad buttons follow the W3C standard
 * mapping by position (`PadSouth` is index 0: A on Xbox, Cross on PlayStation), and each stick has four direction codes
 * (`PadLeftStickUp`), so a stick binds like keys and still walks at half speed when half pushed.
 *
 * Labels per device: keys show the character the layout puts there when a layout map is given (`navigator.keyboard.
 * getLayoutMap()`, read by `readKeyboardLayout`), else a name from the code; pad buttons show the family's names
 * (`padStyle` reads it from `Gamepad.id`: Xbox by default, PlayStation, Nintendo).
 *
 * Touch buttons (WP 3.12) write `touch:<action>` (`touchCode`): every action binds its own implicitly, so no map
 * lists one and no player rebinds one; a button names its action with `data-action` (engine/input/devices/touch.ts).
 *
 * Held bindings (WP 13.20, Apex's pad: X held reloads, Y held holsters): `Hold:<code>` (`holdCode`) is a key, mouse
 * button or pad button kept down `HOLD_TIME`; let go sooner, the code is a tap of its plain binding (engine/input/
 * input.ts holds the plain one back until it knows which). It labels as `Hold X` and belongs to its code's device.
 *
 * Invariants: `isCode` accepts exactly the codes above, touch codes aside; `deviceOf` is `gamepad` for `Pad…`, `mouse`
 * for `Mouse…` and `Wheel…`, `touch` for `touch:…`, `keyboard` otherwise (a held binding its code's); `PAD_BUTTONS[i]`
 * is standard button i.
 *
 * Carried from `my-3d2dge:src/emberdeep/61-controls.js:28-116` (`bindingCode`, `PAD_LABELS`, `codeLabel`), with
 * position names for the pad and labels per pad family.
 *
 * @example
 * deviceOf('PadSouth'); // 'gamepad'
 * codeLabel('KeyW'); // 'W'
 * codeLabel('KeyW', { layout: new Map([['KeyW', 'z']]) }); // 'Z': the key AZERTY puts there
 * codeLabel('PadSouth', { pad: padStyle('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c)') }); // 'Cross'
 * isCode('KeyW') && !isCode('w'); // true: bindings name physical keys
 * codeLabel(holdCode('PadWest')); // 'Hold X': Apex's reload on a pad
 * @see engine/input/bindings.test.ts
 */

/** The devices input comes from; `virtual` is the inspector's (engine/input/devices/virtual.ts). */
export type DeviceKind = 'keyboard' | 'mouse' | 'gamepad' | 'touch' | 'virtual';

/** Where the devices write (engine/input/input.ts keeps it): codes going down and up, analog strengths, use. */
export interface InputSink {
  /** A digital code went down (a key, a mouse button, a wheel notch): pressed at the next sample, even if up by then. */
  press(code: string, device: DeviceKind): void;
  /** A digital code went up. */
  release(code: string): void;
  /** An analog code's strength now, 0 to 1 (a trigger, a stick direction); `press` and `release` say when it is held. */
  analog(code: string, value: number): void;
  /** The device was used without a press (a stick pushed, the mouse moved): prompts follow it. */
  used(device: DeviceKind): void;
  /** Whether an action binds `code`: a bound key's default (Space scrolling the page) is prevented. */
  bound(code: string): boolean;
}

/** A gamepad family, for labels. */
export type PadStyle = 'xbox' | 'playstation' | 'nintendo';

/** The W3C standard gamepad buttons by index, named by position. */
export const PAD_BUTTONS = [
  'PadSouth',
  'PadEast',
  'PadWest',
  'PadNorth',
  'PadLeftShoulder',
  'PadRightShoulder',
  'PadLeftTrigger',
  'PadRightTrigger',
  'PadSelect',
  'PadStart',
  'PadLeftStick',
  'PadRightStick',
  'PadUp',
  'PadDown',
  'PadLeft',
  'PadRight',
  'PadHome',
] as const;

/** The stick directions, each a code whose strength is how far the stick leans that way (after the deadzone). */
export const PAD_STICKS = [
  'PadLeftStickUp',
  'PadLeftStickDown',
  'PadLeftStickLeft',
  'PadLeftStickRight',
  'PadRightStickUp',
  'PadRightStickDown',
  'PadRightStickLeft',
  'PadRightStickRight',
] as const;

/** Mouse buttons by `MouseEvent.button` (0 left, 1 middle, 2 right, 3 back, 4 forward). */
export const MOUSE_BUTTONS = ['MouseLeft', 'MouseMiddle', 'MouseRight', 'MouseBack', 'MouseForward'] as const;

/** The wheel's codes: a notch is a tap, never held. */
export const WHEEL_CODES = ['WheelUp', 'WheelDown'] as const;

/** `KeyboardEvent.code` values a binding may name. */
const KEY =
  /^(Key[A-Z]|Digit[0-9]|Numpad([0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter)|F([1-9]|1[0-9]|2[0-4])|Arrow(Up|Down|Left|Right)|(Shift|Control|Alt|Meta)(Left|Right)|Space|Enter|Tab|Escape|Backspace|Backquote|Minus|Equal|Bracket(Left|Right)|Backslash|Semicolon|Quote|Comma|Period|Slash|CapsLock|Insert|Delete|Home|End|PageUp|PageDown|ContextMenu|IntlBackslash)$/;

/** Every non-keyboard code. */
const OTHER: ReadonlySet<string> = new Set([...PAD_BUTTONS, ...PAD_STICKS, ...MOUSE_BUTTONS, ...WHEEL_CODES]);

/** The prefix of a held binding: `Hold:PadWest` is X kept down `HOLD_TIME` (see the file comment). */
export const HOLD_PREFIX = 'Hold:';

/** How long a held binding's code stays down before its action presses, s (ours); let go sooner, it is a tap. */
export const HOLD_TIME = 0.3;

/** The held binding of `code`: `holdCode('PadWest')` is `Hold:PadWest`. */
export function holdCode(code: string): string {
  return `${HOLD_PREFIX}${code}`;
}

/** The code a held binding waits on (`Hold:PadWest` → `PadWest`), or null for any other code. */
export function heldBase(code: string): string | null {
  return code.startsWith(HOLD_PREFIX) ? code.slice(HOLD_PREFIX.length) : null;
}

/** The digital codes a held binding may wait on: keys, mouse buttons and pad buttons, never a notch or a stick. */
const HOLDABLE: ReadonlySet<string> = new Set<string>([...PAD_BUTTONS, ...MOUSE_BUTTONS]);

/** Whether `code` is one a binding may name. */
export function isCode(code: unknown): code is string {
  if (typeof code !== 'string') return false;
  const base = heldBase(code);
  if (base !== null) return HOLDABLE.has(base) || KEY.test(base);
  return OTHER.has(code) || KEY.test(code);
}

/** The prefix of the codes touch buttons write: `touch:jump` is the jump button (`touchCode`). */
export const TOUCH_PREFIX = 'touch:';

/** The code a touch button for `action` writes; every action binds its own (engine/input/input.ts). */
export function touchCode(action: string): string {
  return `${TOUCH_PREFIX}${action}`;
}

/** The device a code belongs to. */
export function deviceOf(code: string): Exclude<DeviceKind, 'virtual'> {
  const base = heldBase(code);
  if (base !== null) return deviceOf(base);
  if (code.startsWith(TOUCH_PREFIX)) return 'touch';
  if (code.startsWith('Pad')) return 'gamepad';
  return code.startsWith('Mouse') || code.startsWith('Wheel') ? 'mouse' : 'keyboard';
}

/** Pad button labels per family, in `PAD_BUTTONS` order. */
const PAD_LABELS: Record<PadStyle, readonly string[]> = {
  xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', 'D-pad Up', 'D-pad Down', 'D-pad Left', 'D-pad Right', 'Guide'], // prettier-ignore
  playstation: ['Cross', 'Circle', 'Square', 'Triangle', 'L1', 'R1', 'L2', 'R2', 'Create', 'Options', 'L3', 'R3', 'D-pad Up', 'D-pad Down', 'D-pad Left', 'D-pad Right', 'PS'], // prettier-ignore
  nintendo: ['B', 'A', 'Y', 'X', 'L', 'R', 'ZL', 'ZR', '−', '+', 'L Stick', 'R Stick', 'D-pad Up', 'D-pad Down', 'D-pad Left', 'D-pad Right', 'Home'], // prettier-ignore
};

/** Labels of codes whose name says too little or too much. */
const NAMED: Readonly<Record<string, string>> = {
  MouseLeft: 'LMB',
  MouseMiddle: 'MMB',
  MouseRight: 'RMB',
  MouseBack: 'Mouse 4',
  MouseForward: 'Mouse 5',
  WheelUp: 'Wheel Up',
  WheelDown: 'Wheel Down',
  Escape: 'Esc',
  Backquote: '`',
  ShiftLeft: 'L Shift',
  ShiftRight: 'R Shift',
  ControlLeft: 'L Ctrl',
  ControlRight: 'R Ctrl',
  AltLeft: 'L Alt',
  AltRight: 'R Alt',
};

/** The family of a gamepad, from its `Gamepad.id` (vendor 054c is Sony, 057e Nintendo). */
export function padStyle(id: string): PadStyle {
  if (/054c|playstation|dualsense|dualshock|sony/i.test(id)) return 'playstation';
  if (/057e|nintendo|switch|joy-con/i.test(id)) return 'nintendo';
  return 'xbox';
}

/** How labels are made: the keyboard layout's characters by code, and the pad family. */
export interface LabelOptions {
  /** `KeyboardEvent.code` → the character the layout puts there (`readKeyboardLayout`). */
  layout?: ReadonlyMap<string, string>;
  /** The pad family (Xbox by default). */
  pad?: PadStyle;
}

/** What a prompt shows for `code`: `W`, `Space`, `LMB`, `A` / `Cross`, `L Stick Up`, `Hold X`. */
export function codeLabel(code: string, options: LabelOptions = {}): string {
  const base = heldBase(code);
  if (base !== null) return `Hold ${codeLabel(base, options)}`;
  const button = PAD_BUTTONS.indexOf(code as (typeof PAD_BUTTONS)[number]);
  if (button >= 0) return PAD_LABELS[options.pad ?? 'xbox'][button];
  const stick = /^Pad(Left|Right)Stick(Up|Down|Left|Right)$/.exec(code);
  if (stick) return `${stick[1][0]} Stick ${stick[2]}`;
  const typed = options.layout?.get(code);
  if (typed && typed.trim()) return typed.length === 1 ? typed.toUpperCase() : typed;
  return NAMED[code] ?? code.replace(/^(Key|Digit|Arrow)/, '').replace(/^Numpad/, 'Num ');
}

/** The page's keyboard layout (`navigator.keyboard.getLayoutMap()`, Chromium), or undefined where it is missing. */
export async function readKeyboardLayout(): Promise<ReadonlyMap<string, string> | undefined> {
  const keyboard = (globalThis.navigator as { keyboard?: { getLayoutMap?(): Promise<Map<string, string>> } })?.keyboard;
  try {
    return await keyboard?.getLayoutMap?.();
  } catch {
    return undefined; // a page in a frame may not read it: names from the code
  }
}
