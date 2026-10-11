/**
 * @file The input page's module (tests/pages/input.html), the browser half of tests/e2e/input.spec.ts (PLAN.md WP
 * 3.3): the engine's input (engine/input/input.ts) over the page's real window, document and canvas, with its
 * bindings saved in `localStorage`, gamepads coming through a stubbed `navigator.getGamepads` whose slots the tests
 * fill with scripted pads (engine/input/devices/padScript.ts), and a headless engine whose `__engine.input` members
 * drive the page input's virtual device (`connectVirtualDevice`).
 *
 * Nothing runs on its own: there is no frame loop. A test calls `__input.frame(yaw)`, which moves every scripted pad
 * one frame and then samples the input as a frame loop would, so each frame is exactly where the test puts it.
 * `window.__engine` signals `ready` for the fixture; `__input.keys` logs each keydown with whether its default was
 * prevented (read after the input's own listener).
 */
import '../../engine/dev/members';
import { createHeadless, headlessHost } from '../../engine/app/headless';
import { createRegistry } from '../../engine/core/registry';
import { createInput } from '../../engine/input/input';
import { connectVirtualDevice } from '../../engine/input/devices/inspector';
import { createScriptedGamepad, type ScriptedGamepad } from '../../engine/input/devices/padScript';
import type { GamepadLike } from '../../engine/input/devices/gamepad';
import { defineScene } from '../../engine/sim/scene';

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;

/** The gamepad slots `navigator.getGamepads` hands out, and the scripts moving them. */
const slots: (GamepadLike | null)[] = [null, null, null, null];
const pads = new Map<number, ScriptedGamepad>();
Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => slots });

const input = createInput({ element: canvas, storage: localStorage });
const keys: [string, boolean][] = [];
window.addEventListener('keydown', (event) => keys.push([event.code, event.defaultPrevented]));

/** A gamepad event as the browser sends one, carrying the pad. */
function gamepadEvent(type: string, pad: GamepadLike): Event {
  return Object.assign(new Event(type), { gamepad: pad });
}

const engine = await createHeadless({ scene: defineScene('test:input', { setup: () => {} }, createRegistry()) });
connectVirtualDevice(headlessHost(engine), input.virtual);

/** What the input spec drives. */
const page = {
  input,
  engine,
  keys,
  heard: undefined as string | null | undefined,
  /** Moves the scripted pads one frame, then samples the input under a camera heading `yaw` (none: no camera). */
  frame(yaw?: number, pitch = 0) {
    for (const pad of pads.values()) pad.next();
    return input.sample(yaw === undefined ? undefined : { yaw: () => yaw, pose: () => ({ pitch }) });
  },
  /** Plugs a scripted pad into slot `index`, as connecting one does. */
  plug(script: string, index: number, id?: string) {
    const pad = createScriptedGamepad(script, { index, id });
    pads.set(index, pad);
    slots[index] = pad.gamepad;
    window.dispatchEvent(gamepadEvent('gamepadconnected', pad.gamepad));
  },
  /** Unplugs the pad in slot `index`. */
  unplug(index: number) {
    const pad = pads.get(index);
    if (!pad) return;
    pad.disconnect();
    slots[index] = null;
    pads.delete(index);
    window.dispatchEvent(gamepadEvent('gamepaddisconnected', pad.gamepad));
  },
  /** Held, pressed and strength of each action at the last sample, the device used last and each prompt. */
  state(actions: string[]) {
    return {
      held: actions.filter((action) => input.held(action)),
      pressed: actions.filter((action) => input.pressed(action)),
      strength: Object.fromEntries(actions.map((action) => [action, input.strength(action)])),
      lastDevice: input.lastDevice,
      prompts: Object.fromEntries(actions.map((action) => [action, input.prompt(action)])),
    };
  },
  /** Starts listening for a code to rebind; the answer lands in `heard`. */
  listen(device: 'keyboard' | 'gamepad') {
    page.heard = undefined;
    void input.listen(device).then((code) => (page.heard = code));
  },
};

Object.assign(window, { __input: page, __engine: { ready: true, errors: [] } });
