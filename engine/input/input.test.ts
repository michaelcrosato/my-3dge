/**
 * @file Unit tests for engine/input/input.ts (T1, WP 3.3) in Node, with the page faked by plain `EventTarget`s and a
 * scripted gamepad: intents are camera-relative (W walks away from the camera at every heading), a tap shorter than a
 * frame presses without holding, a hold presses once, sticks walk at their strength with the deadzone applied, keys and
 * pads are bound by code, the move actions and the system layer stay out of the buttons, blur and a hidden page let go,
 * prompts follow the last device used, `listen` captures a code for rebinding, and the virtual device merges in.
 * @see engine/input/input.ts
 */
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../core/registry';
import { defineActionMap, PRESETS } from './actionMaps';
import { createBindings } from './bindings';
import type { GamepadLike } from './devices/gamepad';
import { createScriptedGamepad } from './devices/padScript';
import { createInput, type InputOptions } from './input';
import { fromCamera, normalizeIntents, NO_INTENTS, type Intents } from './intents';

/** A fake page: window, document and canvas as event targets, gamepad slots, and helpers to press keys. */
function page(options: InputOptions = {}) {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const element = new EventTarget();
  const slots: (GamepadLike | null)[] = [null, null, null, null];
  const input = createInput({ window, document, element, gamepads: () => slots, ...options });
  const fire = (target: EventTarget, type: string, fields: Record<string, unknown>) =>
    target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), fields));
  const down = (code: string) => fire(window, 'keydown', { code });
  const up = (code: string) => fire(window, 'keyup', { code });
  return { input, window, document, element, slots, fire, down, up };
}

/** The heading a camera turned to `yaw` reports. */
const camera = (yaw: number, pitch = 0) => ({ yaw: () => yaw, pose: () => ({ pitch }) });

describe('createInput', () => {
  it('walks away from the camera at every heading, at length 1 on the diagonal', () => {
    const { input, down } = page();
    down('KeyW');
    for (let i = 0; i < 16; i++) {
      const yaw = -Math.PI + (i * Math.PI) / 8;
      const { move, cam } = input.sample(camera(yaw)) as { move: number[]; cam: number };
      expect(cam).toBe(yaw);
      expect(move[0]).toBeCloseTo(Math.sin(yaw), 12);
      expect(move[1]).toBeCloseTo(Math.cos(yaw), 12);
    }
    down('KeyD');
    const { move } = input.sample(camera(0)) as { move: number[] };
    expect(Math.hypot(move[0], move[1])).toBeCloseTo(1, 12);
    expect(move).toEqual(fromCamera(0, [1, 1]));
  });

  it('presses a tap shorter than a frame, and a hold once', () => {
    const { input, down, up } = page();
    down('Space');
    up('Space');
    expect(input.sample()).toEqual({ p: ['jump'] });
    expect(input.sample()).toEqual({});
    down('KeyJ');
    expect(input.sample()).toEqual({ b: ['attack'], p: ['attack'] });
    down('MouseLeft'); // not a key: ignored by the keyboard
    expect(input.sample()).toEqual({ b: ['attack'] });
    up('KeyJ');
    down('KeyJ');
    up('KeyJ');
    down('KeyJ'); // let go and pressed again between two frames: pressed again
    expect(input.sample()).toEqual({ b: ['attack'], p: ['attack'] });
    expect([input.held('attack'), input.pressed('attack'), input.strength('attack')]).toEqual([true, true, 1]);
  });

  it('gives a frame loop intents that replay: the sim sees one press per tap and per hold', () => {
    const { input, down, up } = page();
    const frames: (() => void)[] = [() => down('Space'), () => {}, () => up('Space'), () => (down('KeyE'), up('KeyE'))];
    let previous: Intents = NO_INTENTS;
    const presses: string[][] = [];
    for (const act of frames) {
      act();
      const raw = input.sample();
      for (let step = 0; step < 2; step++) {
        previous = normalizeIntents(step === 0 ? raw : { ...raw, p: undefined }, previous);
        presses.push([...(previous.p ?? [])]);
      }
    }
    expect(presses).toEqual([['jump'], [], [], [], [], [], ['interact'], []]);
  });

  it('walks at a stick’s strength after the deadzone, and binds pads by position in any slot', () => {
    const { input, slots } = page();
    const pad = createScriptedGamepad('1 left=0.1,0\n1 left=0,-0.6\n1 tap=South rt=0.3', { index: 3 });
    slots[3] = pad.gamepad as GamepadLike;
    pad.next();
    expect(input.sample(camera(0))).toEqual({ cam: 0 }); // inside the deadzone
    pad.next();
    const { move } = input.sample(camera(0)) as { move: number[] };
    expect(move[0]).toBe(0);
    expect(move[1]).toBeCloseTo(0.42 / 0.82, 12);
    pad.next();
    expect(input.sample()).toEqual({ b: ['jump'], p: ['jump'] });
    expect(input.strength('attack')).toBe(0.3); // the right trigger, below its press point
    expect(input.held('uiAccept') && input.pressed('uiAccept')).toBe(true); // the system layer: not in the intents
    expect(input.prompt('jump')).toBe('A');
  });

  it('writes analog values and first-person look from the map', () => {
    const registry = createRegistry();
    const actions = { ...PRESETS['actionMap:thirdPerson'].actions, throttle: ['PadRightTrigger', 'KeyT'] };
    delete (actions as Record<string, unknown>).attack;
    defineActionMap('actionMap:drive', { actions, values: { 'game:throttle': 'throttle' }, look: true }, registry);
    const { input, slots } = page({ map: createBindings('actionMap:drive', { registry }) });
    const pad = createScriptedGamepad('1 rt=0.25');
    slots[0] = pad.gamepad as GamepadLike;
    pad.next();
    expect(input.sample(camera(1, -0.5))).toEqual({ cam: 1, look: [1, -0.5], 'game:throttle': 0.25 });
  });

  it('lets go of everything on blur and when the page is hidden', () => {
    const { input, window, document, fire, down } = page();
    down('KeyW');
    down('KeyJ');
    expect(Object.keys(input.sample(camera(0)))).toEqual(['move', 'cam', 'b', 'p']);
    fire(window, 'blur', {});
    expect(input.sample()).toEqual({});
    down('KeyJ');
    document.visibilityState = 'hidden';
    fire(document, 'visibilitychange', {});
    expect(input.sample()).toEqual({});
  });

  it('lets go of a pad when it disconnects', () => {
    const { input, window, slots, fire } = page();
    const pad = createScriptedGamepad('9 hold=South', { index: 1 });
    slots[1] = pad.gamepad as GamepadLike;
    pad.next();
    expect(input.sample()).toEqual({ b: ['jump'], p: ['jump'] });
    fire(window, 'gamepaddisconnected', { gamepad: { index: 1 } });
    slots[1] = null;
    expect(input.sample()).toEqual({});
  });

  it('keeps bound keys from the page and leaves the others', () => {
    const { window } = page();
    const space = Object.assign(new Event('keydown', { cancelable: true }), { code: 'Space' });
    const arrow = Object.assign(new Event('keydown', { cancelable: true }), { code: 'ArrowDown' });
    const free = Object.assign(new Event('keydown', { cancelable: true }), { code: 'KeyP' });
    [space, arrow, free].forEach((event) => window.dispatchEvent(event));
    expect([space.defaultPrevented, arrow.defaultPrevented, free.defaultPrevented]).toEqual([true, true, false]);
  });

  it('shows prompts for the device used last', () => {
    const { input, slots, fire, element, down } = page({ layout: new Map([['KeyJ', 'j']]) });
    expect(input.prompt('attack')).toBe('J');
    fire(element, 'pointerdown', { pointerType: 'mouse', button: 0 });
    expect([input.lastDevice, input.prompt('attack'), input.prompt('jump')]).toEqual(['mouse', 'LMB', 'Space']);
    const pad = createScriptedGamepad('1 hold=X', { id: 'DualSense (Vendor: 054c)' });
    slots[0] = pad.gamepad as GamepadLike;
    pad.next();
    input.sample();
    expect([input.lastDevice, input.prompt('attack'), input.prompt('pause')]).toEqual(['gamepad', 'Square', 'Options']);
    down('KeyW');
    expect(input.prompt('forward')).toBe('W');
  });

  it('listens for the next key or pad button to rebind, swallowing it; Escape cancels', async () => {
    const { input, slots, down } = page();
    const key = input.listen('keyboard');
    down('KeyK');
    expect(await key).toBe('KeyK');
    expect(input.sample()).toEqual({}); // swallowed: K is dash, and it did not dash
    const cancelled = input.listen('gamepad');
    down('Escape');
    expect(await cancelled).toBeNull();
    expect(input.pressed('pause')).toBe(false);
    const button = input.listen('gamepad');
    const pad = createScriptedGamepad('1 left=0,-1\n1 hold=North');
    slots[0] = pad.gamepad as GamepadLike;
    pad.next();
    input.sample(); // a stick is not a binding
    pad.next();
    input.sample();
    expect(await button).toBe('PadNorth');
    expect(input.bindings.rebind('jump', 'PadNorth')).toMatchObject({ ok: false, reason: 'conflict', action: 'skill' });
  });

  it('merges the virtual device: taps once, holds and axes until changed', () => {
    const { input, down } = page();
    input.virtual.press('jump');
    input.virtual.hold('dash');
    input.virtual.axis('move', [1, 0]);
    down('KeyW');
    const first = input.sample(camera(0)) as { move: number[]; b: string[]; p: string[] };
    expect(first.move).toEqual(fromCamera(0, [1, 1]));
    expect([first.b, first.p, input.lastDevice]).toEqual([['dash'], ['dash', 'jump'], 'virtual']);
    input.virtual.axis('cam', 0.25);
    input.virtual.axis('game:charge', 3);
    expect(input.sample(camera(2))).toMatchObject({ cam: 0.25, b: ['dash'], 'game:charge': 3 });
    expect(input.sample(camera(2)).p).toBeUndefined();
  });

  it('gives the camera mouse look, the right stick and the wheel once', () => {
    const { input, slots, element, fire } = page({ invertY: true });
    const pad = createScriptedGamepad('1 right=1,0.5');
    slots[0] = pad.gamepad as GamepadLike;
    pad.next();
    input.sample();
    fire(element, 'wheel', { deltaY: -100, deltaMode: 0 });
    const { look, turn, zoom } = input.camera();
    expect(look).toEqual([0, 0]);
    expect(turn[1]).toBeGreaterThan(0); // inverted: a stick pulled back looks up
    expect(zoom).toBe(1);
    expect(input.camera().zoom).toBe(0);
    input.dispose();
  });
});
