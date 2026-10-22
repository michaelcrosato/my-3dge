/**
 * @file The input (PLAN.md §6.4, WP 3.3, I-24; doctrine: Reproducible): the devices of a page (keyboard, mouse,
 * gamepads, touch, the virtual device) turned into one step's intents through bindings (engine/input/bindings.ts).
 * The frame loop calls `sample(camera, now)` once per rendered frame, before the clock hands out steps, and gives the
 * result to the frame's first step (its later steps get it without `p`, PLAN.md §6.4); the session records it, so
 * touch play replays like any other (WP 3.12, `sample`).
 *
 * What a sample holds: `b`, the map's actions held, sorted; `p`, those pressed since the last sample (a code that went
 * down, so a tap shorter than a frame still presses); `move`, the map's four move actions as `[right − left, forward −
 * back]` turned by `fromCamera(camera.yaw(), …)`, so W walks away from the camera; `cam`, the camera's heading; `look`
 * (its yaw and pitch) for maps with `look`; `aim`, the camera's point for the map's `aimWith` rule from the free
 * pointer and the right stick (engine/input/aim.ts); the map's `values` as custom intents. The move actions, the map's
 * `view` actions and the system layer (pause, menus) are never buttons in it: `held`, `pressed` and `strength` give
 * every action to the app and the UI, and `onView` hears a view action as it is pressed (a key at once, a pad button at
 * its poll, the virtual device's at the sample). `camera()` gives what the camera takes each frame (mouse look under
 * pointer lock and the right stick, scaled by the view settings `input.*`, engine/input/look.ts; the wheel; a map that
 * aims with the pointer keeps the stick for aiming). `prompt(action)` labels a binding on the device used last;
 * `use(map)` switches the map live (one per camera mode, WP 13.9), what is held read through it from the next sample.
 * A code a held binding waits on (WP 13.20) is held back as it goes down, until it is a tap or a hold (`sample`).
 *
 * Clearing: a page blur, the page going hidden and `clear()` let go of every held code and drop pending presses, so
 * nothing stays held after alt-tab; a gamepad that disconnects lets go of its own. `listen(device)` waits for the next
 * key or mouse button (`keyboard`) or pad button (`gamepad`) for rebinding, swallowing it; Escape cancels (null).
 *
 * Invariants: nothing here reads a clock; edges are counted per sample; a code is held only between its press and
 * release reports. Without `window` and `document` (Node), only the gamepad source given and the virtual device feed it.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:482-512, 542-555, 594-622` (the input object, blur, `move`, `tick`),
 * sampled per frame; shardfall's short taps and prompts (`shardfall:crates/pav_app/src/input.rs:590-610`).
 *
 * @example
 * const window = new EventTarget();
 * const input = createInput({ window, document: new EventTarget(), element: new EventTarget() });
 * const key = (type: string, code: string) => window.dispatchEvent(Object.assign(new Event(type), { code }));
 * ['KeyW', 'Space'].forEach((code) => key('keydown', code)), key('keyup', 'Space'); // a tap between two frames
 * input.sample({ yaw: () => Math.PI / 2 }); // { move: [1, 6.1e-17], cam: 1.5707963267948966, p: ['jump'] }
 * input.prompt('jump'); // 'Space'
 * input.sample({ yaw: () => 0 }).move; // [0, 1]: still held; the camera turned, so W walks +Z now
 * @see engine/input/input.test.ts
 */
import type { Log } from '../core/log';
import type { Registry } from '../core/registry';
import { SYSTEM_ACTIONS } from './actionMaps';
import { createBindings, pickLabel, type Bindings, type BindingsStorage } from './bindings';
import { deviceOf, heldBase, HOLD_TIME, holdCode, PAD_BUTTONS, touchCode, type DeviceKind, type InputSink } from './codes'; // prettier-ignore
import { createGamepadDevice, type GamepadDevice, type GamepadSource } from './devices/gamepad';
import { attachKeyboard } from './devices/keyboard';
import type { AimDevices, AimRule } from './aim';
import { attachMouse, type MouseDevice, type MouseTargets } from './devices/mouse';
import { attachTouch, type TouchDevice, type TouchSetting } from './devices/touch';
import { createVirtualDevice, type VirtualDevice } from './devices/virtual';
import { fromCamera } from './intents';
import { lookOptions, scaleLook, type LookOptions } from './look';

/** A camera as the input reads it (the app's, over its view): its heading, its pitch for the look, and the aim. */
export interface CameraLike {
  yaw(): number;
  pose?(): { readonly pitch: number };
  /** The point `rule` aims at this frame from the devices' pointer and stick (engine/input/aim.ts), or undefined. */
  aim?(rule: AimRule, devices: AimDevices): readonly [number, number, number] | undefined;
}

/** How an input is made; in a page every field has its default. */
export interface InputOptions {
  /** The action map's id (`actionMap:thirdPerson`) or ready bindings. */
  map?: string | Bindings;
  /** Where bindings made from an id are saved (the page's `localStorage`). */
  storage?: BindingsStorage;
  /** Where keys, releases, blur and gamepad events arrive (`window`). */
  window?: EventTarget;
  /** The document: visibility and pointer lock (`document`). */
  document?: MouseTargets['document'] & { visibilityState?: string };
  /** The game's element, the canvas: mouse presses, wheel and pointer lock (`document.body`). */
  element?: MouseTargets['element'];
  /** Where pads come from (`navigator.getGamepads`). */
  gamepads?: GamepadSource;
  /** The stick deadzone (0.18), clamped to [0.05, 0.5]. */
  deadzone?: number;
  /** A view action pressed (the map's `view`: a camera switch, a view's turn), as it happens (see the file comment). */
  onView?: (action: string) => void;
  /** The look settings now (`lookOptions` over the view settings `input.*`), read every frame; defaults when absent. */
  look?: () => LookOptions;
  /** The keyboard layout for prompts (`readKeyboardLayout()`). */
  layout?: ReadonlyMap<string, string>;
  /** The `touch` setting now (`auto`, `on`, `off`): touch mode follows the screen unless forced. */
  touchMode?: () => TouchSetting;
  /** A tap on a touch tap control (`data-tap`: `menu`) or on the open game (`game`), as it happens. */
  onTap?: (name: string) => void;
  /** Where the map is registered (the shared registry). */
  registry?: Registry;
  /** Where advice goes (the shared log). */
  log?: Log;
}

/** What the camera takes each frame: mouse look `[right, up]` rad, the right stick `[right, up]`, wheel notches. */
export interface CameraInputSample {
  look: [number, number];
  turn: [number, number];
  zoom: number;
}

/** A page's input. */
export interface Input {
  /** The bindings of the map in use: rebind, reset, labels. */
  readonly bindings: Bindings;
  /** Switches to the action map `map` (an id, its bindings made and saved as the first's, or bindings); returns them. */
  use(map: string | Bindings): Bindings;
  /** The virtual device, merged into every sample (`__engine.input` drives it). */
  readonly virtual: VirtualDevice;
  /** The mouse (pointer lock, pointer), when there is a page. */
  readonly mouse: MouseDevice | undefined;
  /** Fingers (touch mode, the stick, the buttons under them), when there is a page. */
  readonly touch: TouchDevice | undefined;
  /** The device used last: prompts follow it. */
  readonly lastDevice: DeviceKind;
  /**
   * One frame's intents (unnormalized) at the frame's timestamp `now` (ms): see the file comment. Every action also
   * binds `touch:<action>` (WP 3.12), and the touch stick adds to the move axes before `fromCamera` clamps them to
   * length 1. A code a held binding waits on (engine/input/codes.ts `Hold:<code>`, WP 13.20) is held back as it goes
   * down: let go before `HOLD_TIME`, it taps (its plain actions pressed at the next sample, never held); kept down, its
   * held binding's actions press and hold until it goes up, and its plain ones never see it. The time is `now`, or a
   * 60 Hz frame a sample without one; such a code is digital, its analog strength unread.
   */
  sample(camera?: CameraLike, now?: number): Record<string, unknown>;
  /** Whether `action` (either layer) was held at the last sample. */
  held(action: string): boolean;
  /** Whether `action` (either layer) was pressed at the last sample. */
  pressed(action: string): boolean;
  /** How far `action` was pushed at the last sample, 0 to 1. */
  strength(action: string): number;
  /** What the camera takes since the last call (mouse look, right stick, wheel); then zero. */
  camera(): CameraInputSample;
  /** The label of `action`'s binding on the device used last: `Space`, `A`, `LMB`. */
  prompt(action: string): string;
  /** The next code pressed on `device`'s family, swallowed; null when Escape cancels or another listen starts. */
  listen(device: 'keyboard' | 'gamepad'): Promise<string | null>;
  /** Lets go of everything held and drops pending presses. */
  clear(): void;
  /** Removes every listener. */
  dispose(): void;
}

/** The look settings' defaults: what `camera()` scales by without `options.look`. */
const DEFAULT_LOOK = lookOptions(() => undefined);

/** Makes the page's input. */
export function createInput(options: InputOptions = {}): Input {
  const made = (map: string | Bindings) => (typeof map === 'object' ? map : createBindings(map, options));
  let bindings = made(options.map ?? 'actionMap:thirdPerson');
  const known = new Map<string, Bindings>([[bindings.map.id, bindings]]);
  const scope = globalThis as { window?: EventTarget; document?: InputOptions['document'] & { body?: EventTarget } };
  const win = options.window ?? scope.window;
  const doc = options.document ?? scope.document;
  const element = options.element ?? scope.document?.body;
  const nav = (globalThis as { navigator?: { getGamepads?(): readonly unknown[] } }).navigator;
  const source = options.gamepads ?? (() => (nav?.getGamepads?.() ?? []) as ReturnType<GamepadSource>);
  const down = new Set<string>();
  const taps = new Set<string>();
  const values = new Map<string, number>();
  let last: DeviceKind = 'keyboard';
  let heldNow = new Set<string>();
  let pressedNow = new Set<string>();
  let strengths = new Map<string, number>();
  let listening: { family: 'keyboard' | 'gamepad'; resolve: (code: string | null) => void } | null = null;
  let table = { of: bindings, version: -1, codes: new Map<string, readonly string[]>(), bound: new Set<string>(), holds: new Set<string>() }; // prettier-ignore

  const codesOf = (action: string): readonly string[] => {
    if (table.of !== bindings || table.version !== bindings.version) {
      const codes = new Map<string, readonly string[]>();
      for (const [name, own] of Object.entries(SYSTEM_ACTIONS)) codes.set(name, [...own, touchCode(name)]);
      for (const name of bindings.actions()) codes.set(name, [...bindings.codes(name), touchCode(name)]);
      const holds = new Set([...codes.values()].flat().flatMap((code) => heldBase(code) ?? []));
      table = { of: bindings, version: bindings.version, codes, bound: new Set([...[...codes.values()].flat(), ...holds]), holds }; // prettier-ignore
    }
    return table.codes.get(action) ?? [];
  };
  /** The codes held back for a held binding (see the file comment): each, and when its wait began (NaN: next sample). */
  const waiting = new Map<string, number>();
  /** Samples taken: the held bindings' clock without `now`. */
  let samples = 0;
  /** Whether a held binding waits on `code`. */
  const gated = (code: string) => (codesOf(''), table.holds.has(code));
  /** The view actions told as their codes went down since the last sample, which tells only the others (virtual). */
  const told = new Set<string>();
  /** Tells `onView` of each view action of the map that `code` is bound to: every press (auto-repeat never comes). */
  const tell = (code: string) => {
    for (const action of bindings.map.view) {
      if (!codesOf(action).includes(code)) continue;
      told.add(action);
      options.onView?.(action);
    }
  };
  const hear = (code: string | null) => {
    const wait = listening;
    listening = null;
    wait?.resolve(code);
  };

  const sink: InputSink = {
    press(code, device) {
      last = device;
      if (listening && code === 'Escape') return hear(null);
      const kind = deviceOf(code);
      const family = kind === 'gamepad' ? 'gamepad' : kind === 'touch' ? 'touch' : 'keyboard';
      if (listening?.family === family && (family === 'keyboard' || PAD_BUTTONS.includes(code as never))) {
        return hear(code);
      }
      if (gated(code)) {
        if (!waiting.has(code) && !down.has(holdCode(code))) waiting.set(code, Number.NaN); // a tap or a hold: wait
        return;
      }
      down.add(code);
      taps.add(code);
      values.set(code, 1);
      tell(code);
    },
    release(code) {
      if (waiting.delete(code)) taps.add(code); // let go before the hold: a tap of its plain binding
      for (const each of [code, holdCode(code)]) {
        down.delete(each);
        values.delete(each);
      }
    },
    analog(code, value) {
      if (gated(code)) return; // digital while a held binding waits on it
      if (value > 0) values.set(code, value);
      else values.delete(code);
    },
    used(device) {
      last = device;
    },
    bound(code) {
      codesOf('');
      return table.bound.has(code);
    },
  };

  const pads: GamepadDevice = createGamepadDevice(sink, source, options.deadzone);
  const virtual = createVirtualDevice();
  const detachKeyboard = win ? attachKeyboard(win, sink) : () => {};
  const mouse =
    element && win ? attachMouse({ element, target: win, document: doc }, sink, { lookSpeed: 1 }) : undefined; // counts
  const touchOptions = { mode: options.touchMode, onTap: options.onTap };
  const touch = element && win ? attachTouch({ element, target: win }, sink, touchOptions) : undefined;
  const clear = () => {
    down.clear();
    taps.clear();
    values.clear();
    waiting.clear();
    heldNow = new Set();
    pressedNow = new Set();
    strengths = new Map();
    mouse?.clear();
    touch?.clear();
  };
  const hidden = () => void (doc?.visibilityState === 'hidden' && clear());
  const unplugged = (event: Event) => {
    const index = (event as Event & { gamepad?: { index: number } }).gamepad?.index;
    if (index === pads.index) pads.release();
  };
  win?.addEventListener('blur', clear);
  win?.addEventListener('gamepaddisconnected', unplugged);
  doc?.addEventListener('visibilitychange', hidden);
  /** What aiming reads of the devices: the pointer's place when it is free over the game, the right stick pushed. */
  const aimDevices = (): AimDevices => {
    const pointer = mouse?.pointer();
    const [x, y] = pads.rightStick();
    return {
      ...(pointer?.at && pointer.inside && !pointer.locked ? { pointer: pointer.at } : {}),
      ...(x !== 0 || y !== 0 ? { stick: [x, -y] as const } : {}),
    };
  };

  return {
    get bindings() {
      return bindings;
    },
    use(map) {
      bindings = typeof map === 'string' ? (known.get(map) ?? made(map)) : map;
      known.set(bindings.map.id, bindings);
      return bindings;
    },
    virtual,
    mouse,
    touch,
    get lastDevice() {
      return last;
    },
    sample(camera, now) {
      pads.poll();
      touch?.frame(now ?? Number.NaN);
      if (virtual.touched) last = 'virtual';
      samples++;
      const clock = now !== undefined && Number.isFinite(now) ? now / 1000 : samples / 60;
      for (const [code, since] of waiting) {
        const start = Number.isNaN(since) ? clock : since; // its wait starts at the first sample that sees it
        waiting.set(code, start);
        if (clock - start < HOLD_TIME - 1e-9) continue;
        waiting.delete(code); // kept down: its held binding presses, held until it goes up
        const hold = holdCode(code);
        down.add(hold);
        taps.add(hold);
        values.set(hold, 1);
        tell(hold);
      }
      const own = virtual.take();
      const nextHeld = new Set<string>();
      const nextPressed = new Set<string>();
      const nextStrength = new Map<string, number>();
      for (const action of [...Object.keys(SYSTEM_ACTIONS), ...bindings.actions()]) {
        const codes = codesOf(action);
        const isHeld = codes.some((code) => down.has(code)) || own.held.includes(action);
        const strength = Math.max(own.held.includes(action) ? 1 : 0, ...codes.map((code) => values.get(code) ?? 0));
        if (isHeld) nextHeld.add(action);
        if ((isHeld && !heldNow.has(action)) || codes.some((code) => taps.has(code)) || own.taps.includes(action)) {
          nextPressed.add(action);
        }
        if (strength > 0) nextStrength.set(action, strength);
      }
      [heldNow, pressedNow, strengths] = [nextHeld, nextPressed, nextStrength];
      taps.clear();
      for (const action of bindings.map.view) if (pressedNow.has(action) && !told.has(action)) options.onView?.(action);
      told.clear();
      const map = bindings.map;
      const level = (action: string) => strengths.get(action) ?? 0;
      const [forward, back, left, right] = map.move;
      const stick = Array.isArray(own.axes.move) ? (own.axes.move as number[]) : [0, 0];
      const axes: [number, number] = [level(right) - level(left) + stick[0], level(forward) - level(back) + stick[1]];
      const thumb = touch?.stick() ?? [0, 0];
      if (thumb[0] !== 0 || thumb[1] !== 0) [axes[0], axes[1]] = [axes[0] + thumb[0], axes[1] + thumb[1]];
      const yaw = typeof own.axes.cam === 'number' ? own.axes.cam : camera?.yaw();
      const out: Record<string, unknown> = {};
      if (axes[0] !== 0 || axes[1] !== 0) out.move = fromCamera(yaw ?? 0, axes);
      if (yaw !== undefined) out.cam = yaw;
      if (own.axes.look) out.look = own.axes.look;
      else if (map.look && camera && yaw !== undefined) out.look = [yaw, camera.pose?.().pitch ?? 0];
      if (own.axes.aim) out.aim = own.axes.aim;
      else if (map.aimWith !== 'none' && camera?.aim) {
        const at = camera.aim(map.aimWith, aimDevices());
        if (at?.every(Number.isFinite)) out.aim = [...at];
      }
      const buttons = bindings
        .actions()
        .filter((action) => !map.move.includes(action) && !map.view.includes(action))
        .sort();
      const b = buttons.filter((action) => heldNow.has(action));
      const p = buttons.filter((action) => pressedNow.has(action));
      if (b.length) out.b = b;
      if (p.length) out.p = p;
      for (const [key, action] of Object.entries(map.values)) if (level(action) > 0) out[key] = level(action);
      for (const [key, value] of Object.entries(own.axes)) if (key.includes(':')) out[key] = value;
      return out;
    },
    held: (action) => heldNow.has(action),
    pressed: (action) => pressedNow.has(action),
    strength: (action) => strengths.get(action) ?? 0,
    camera() {
      const twin = bindings.map.aimWith === 'pointer'; // the right stick aims (twin sticks), not the camera
      const stick: [number, number] = twin ? [0, 0] : pads.rightStick();
      const raw = { counts: mouse?.takeLook() ?? [0, 0], stick } as const;
      const { look, turn } = scaleLook(raw, options.look?.() ?? DEFAULT_LOOK, heldNow.has('aim'));
      return { look, turn, zoom: mouse?.takeZoom() ?? 0 };
    },
    prompt(action) {
      const device = last === 'gamepad' || last === 'mouse' ? last : 'keyboard';
      return pickLabel(codesOf(action), device, { layout: options.layout, pad: pads.style });
    },
    listen(device) {
      hear(null);
      return new Promise((resolve) => (listening = { family: device, resolve }));
    },
    clear,
    dispose() {
      hear(null);
      detachKeyboard();
      mouse?.detach();
      touch?.detach();
      win?.removeEventListener('blur', clear);
      win?.removeEventListener('gamepaddisconnected', unplugged);
      doc?.removeEventListener('visibilitychange', hidden);
    },
  };
}
