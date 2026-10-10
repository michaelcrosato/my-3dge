/**
 * @file The input (PLAN.md §6.4, WP 3.3, I-24; doctrine: Reproducible): the devices of a page (keyboard, mouse,
 * gamepads, the virtual device) turned into one step's intents through bindings (engine/input/bindings.ts). The
 * frame loop calls `sample(camera)` once per rendered frame, before the clock hands out steps, and gives the result
 * to the frame's first step (its later steps get it without `p`, PLAN.md §6.4); the session records it.
 *
 * What a sample holds: `b`, the map's actions held, sorted; `p`, those pressed since the last sample (an action whose code went
 * down, so a tap shorter than a frame still presses); `move`, the strengths of the map's four move actions as
 * `[right − left, forward − back]` turned by `fromCamera(camera.yaw(), …)`, so W walks away from the camera; `cam`, the
 * camera's heading; `look` for first-person maps; the map's `values` as custom intents. The move actions and the
 * system layer (pause, menus) are never buttons in it: `held`, `pressed` and `strength` give every action, both
 * layers, to the app and the UI. `camera()` gives what the camera itself takes each frame (mouse look under pointer
 * lock, the right stick, the wheel), and `prompt(action)` the label of its binding on the device used last.
 *
 * Clearing: a page blur, the page going hidden and `clear()` let go of every held code and drop pending presses, so
 * nothing stays held after alt-tab; a gamepad that disconnects lets go of its own. `listen(device)` waits for the next
 * key or mouse button (`keyboard`) or pad button (`gamepad`) for rebinding, swallowing it; Escape cancels (null).
 *
 * Invariants: nothing here reads a clock; edges are counted per sample; a code is held only between its press and
 * release reports. Without `window` and `document` (Node), only the gamepad source given and the virtual device feed it.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:482-512, 542-555, 594-622` (the input object, press and release, blur
 * and visibility, `move`, `tick`), now sampled per frame into recorded intents; shardfall's taps shorter than a frame
 * and prompts that follow the last device (`shardfall:crates/pav_app/src/input.rs:590-610`).
 *
 * @example
 * const window = new EventTarget();
 * const input = createInput({ window, document: new EventTarget(), element: new EventTarget() });
 * const key = (type: string, code: string) => window.dispatchEvent(Object.assign(new Event(type), { code }));
 * key('keydown', 'KeyW');
 * key('keydown', 'Space');
 * key('keyup', 'Space'); // a tap between two frames
 * input.sample({ yaw: () => Math.PI / 2 }); // { move: [1, 6.1e-17], cam: 1.5707963267948966, p: ['jump'] }
 * input.prompt('jump'); // 'Space'
 * input.sample({ yaw: () => 0 }).move; // [0, 1]: still held; the camera turned, so W walks +Z now
 * @see engine/input/input.test.ts
 */
import type { Log } from '../core/log';
import type { Registry } from '../core/registry';
import { SYSTEM_ACTIONS } from './actionMaps';
import { createBindings, pickLabel, type Bindings, type BindingsStorage } from './bindings';
import { deviceOf, PAD_BUTTONS, type DeviceKind, type InputSink } from './codes';
import { createGamepadDevice, type GamepadDevice, type GamepadSource } from './devices/gamepad';
import { attachKeyboard } from './devices/keyboard';
import { attachMouse, type MouseDevice, type MouseTargets } from './devices/mouse';
import { createVirtualDevice, type VirtualDevice } from './devices/virtual';
import { fromCamera } from './intents';

/** A camera as the input reads it (engine/gfx/cameras/pose.ts `Camera`): its heading, and its pitch for first person. */
export interface CameraLike {
  yaw(): number;
  pose?(): { readonly pitch: number };
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
  /** Mouse look, rad per pixel (0.0025). */
  lookSpeed?: number;
  /** Mouse and right-stick look upside down (flight style). */
  invertY?: boolean;
  /** The keyboard layout for prompts (`readKeyboardLayout()`). */
  layout?: ReadonlyMap<string, string>;
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
  /** The bindings: rebind, reset, labels. */
  readonly bindings: Bindings;
  /** The virtual device, merged into every sample (`__engine.input` drives it). */
  readonly virtual: VirtualDevice;
  /** The mouse (pointer lock, pointer), when there is a page. */
  readonly mouse: MouseDevice | undefined;
  /** The device used last: prompts follow it. */
  readonly lastDevice: DeviceKind;
  /** One frame's intents (unnormalized): see the file comment. */
  sample(camera?: CameraLike): Record<string, unknown>;
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

/** Makes the page's input. */
export function createInput(options: InputOptions = {}): Input {
  const bindings =
    typeof options.map === 'object' ? options.map : createBindings(options.map ?? 'actionMap:thirdPerson', options);
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
  let table = { version: -1, codes: new Map<string, readonly string[]>(), bound: new Set<string>() };

  const codesOf = (action: string): readonly string[] => {
    if (table.version !== bindings.version) {
      const codes = new Map<string, readonly string[]>(Object.entries(SYSTEM_ACTIONS));
      for (const name of bindings.actions()) codes.set(name, bindings.codes(name));
      table = { version: bindings.version, codes, bound: new Set([...codes.values()].flat()) };
    }
    return table.codes.get(action) ?? [];
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
      const family = deviceOf(code) === 'gamepad' ? 'gamepad' : 'keyboard';
      if (listening?.family === family && (family === 'keyboard' || PAD_BUTTONS.includes(code as never))) {
        return hear(code);
      }
      down.add(code);
      taps.add(code);
      values.set(code, 1);
    },
    release(code) {
      down.delete(code);
      values.delete(code);
    },
    analog(code, value) {
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
  const mouse = element && win ? attachMouse({ element, target: win, document: doc }, sink, options) : undefined;
  const clear = () => {
    down.clear();
    taps.clear();
    values.clear();
    heldNow = new Set();
    pressedNow = new Set();
    strengths = new Map();
    mouse?.clear();
  };
  const hidden = () => void (doc?.visibilityState === 'hidden' && clear());
  const unplugged = (event: Event) => {
    const index = (event as Event & { gamepad?: { index: number } }).gamepad?.index;
    if (index === pads.index) pads.release();
  };
  win?.addEventListener('blur', clear);
  win?.addEventListener('gamepaddisconnected', unplugged);
  doc?.addEventListener('visibilitychange', hidden);

  return {
    bindings,
    virtual,
    mouse,
    get lastDevice() {
      return last;
    },
    sample(camera) {
      pads.poll();
      if (virtual.touched) last = 'virtual';
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
      const map = bindings.map;
      const level = (action: string) => strengths.get(action) ?? 0;
      const [forward, back, left, right] = map.move;
      const stick = Array.isArray(own.axes.move) ? (own.axes.move as number[]) : [0, 0];
      const axes: [number, number] = [level(right) - level(left) + stick[0], level(forward) - level(back) + stick[1]];
      const yaw = typeof own.axes.cam === 'number' ? own.axes.cam : camera?.yaw();
      const out: Record<string, unknown> = {};
      if (axes[0] !== 0 || axes[1] !== 0) out.move = fromCamera(yaw ?? 0, axes);
      if (yaw !== undefined) out.cam = yaw;
      if (own.axes.look) out.look = own.axes.look;
      else if (map.look && camera && yaw !== undefined) out.look = [yaw, camera.pose?.().pitch ?? 0];
      if (own.axes.aim) out.aim = own.axes.aim;
      const buttons = bindings
        .actions()
        .filter((action) => !map.move.includes(action))
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
      const [x, y] = pads.rightStick();
      return { look: mouse?.takeLook() ?? [0, 0], turn: [x, options.invertY ? y : -y], zoom: mouse?.takeZoom() ?? 0 };
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
      win?.removeEventListener('blur', clear);
      win?.removeEventListener('gamepaddisconnected', unplugged);
      doc?.removeEventListener('visibilitychange', hidden);
    },
  };
}
