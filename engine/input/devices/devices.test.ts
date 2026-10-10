/**
 * @file Unit tests for the input devices (T1, WP 3.3) in Node, with events dispatched on plain `EventTarget`s: the
 * keyboard (physical codes, auto-repeat ignored, typing fields left alone, bound keys kept from the page), the mouse
 * (buttons over the element, wheel notches, look under pointer lock only), the gamepad (the radial deadzone's numbers,
 * any slot, takeover, analog triggers with hysteresis, release on disconnect) and the scripted gamepad (frames, taps,
 * aliases, bad lines named).
 * @see engine/input/devices/keyboard.ts
 * @see engine/input/devices/mouse.ts
 * @see engine/input/devices/gamepad.ts
 * @see engine/input/devices/padScript.ts
 */
import { describe, expect, it } from 'vitest';
import type { InputSink } from '../codes';
import { createGamepadDevice, radialDeadzone, type GamepadLike } from './gamepad';
import { attachKeyboard, isTyping } from './keyboard';
import { attachMouse, LOOK_SPEED } from './mouse';
import { createScriptedGamepad, parsePadScript } from './padScript';

/** A sink that logs what devices write. */
function recorder(bound = (code: string) => code !== 'KeyQ') {
  const log: string[] = [];
  const values = new Map<string, number>();
  const sink: InputSink = {
    press: (code, device) => void log.push(`+${code}@${device}`),
    release: (code) => void log.push(`-${code}`),
    analog: (code, value) => void (value > 0 ? values.set(code, value) : values.delete(code)),
    used: (device) => void log.push(`used@${device}`),
    bound,
  };
  return { log, values, sink };
}

/** An event of `type` with `fields`, cancelable so `defaultPrevented` tells. */
const event = (type: string, fields: Record<string, unknown> = {}) =>
  Object.assign(new Event(type, { cancelable: true }), fields);

describe('the keyboard', () => {
  it('reports physical codes once per press, and keeps bound keys from the page', () => {
    const target = new EventTarget();
    const { log, sink } = recorder();
    const detach = attachKeyboard(target, sink);
    const space = event('keydown', { code: 'Space', key: ' ' });
    target.dispatchEvent(space);
    target.dispatchEvent(event('keydown', { code: 'Space', repeat: true }));
    target.dispatchEvent(event('keyup', { code: 'Space' }));
    const free = event('keydown', { code: 'KeyQ' });
    target.dispatchEvent(free);
    target.dispatchEvent(event('keydown', { code: 'KeyW', key: 'z' })); // AZERTY's Z is the physical W
    expect(log).toEqual(['+Space@keyboard', '-Space', '+KeyQ@keyboard', '+KeyW@keyboard']);
    expect([space.defaultPrevented, free.defaultPrevented]).toEqual([true, false]);
    detach();
    target.dispatchEvent(event('keydown', { code: 'KeyE' }));
    expect(log).toHaveLength(4);
  });

  it('leaves keys typed into fields to the page', () => {
    expect(isTyping({ tagName: 'INPUT', type: 'text' } as unknown as EventTarget)).toBe(true);
    expect(isTyping({ tagName: 'INPUT', type: 'range' } as unknown as EventTarget)).toBe(false);
    expect(isTyping({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true);
    expect(isTyping({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isTyping({ tagName: 'CANVAS' } as unknown as EventTarget)).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});

describe('the mouse', () => {
  it('presses buttons over the element, releases anywhere, and turns wheel notches into taps and zoom', () => {
    const element = new EventTarget();
    const target = new EventTarget();
    const { log, sink } = recorder();
    const mouse = attachMouse({ element, target }, sink);
    element.dispatchEvent(event('pointerdown', { pointerType: 'mouse', button: 0, clientX: 10, clientY: 20 }));
    element.dispatchEvent(event('pointerdown', { pointerType: 'touch', button: 0 }));
    target.dispatchEvent(event('pointerup', { pointerType: 'mouse', button: 0 }));
    const wheel = event('wheel', { deltaY: 3, deltaMode: 1 }); // three lines down
    element.dispatchEvent(wheel);
    const menu = event('contextmenu');
    element.dispatchEvent(menu);
    expect(log).toEqual(['+MouseLeft@mouse', '-MouseLeft', '+WheelDown@mouse', '-WheelDown']);
    expect([wheel.defaultPrevented, menu.defaultPrevented]).toEqual([true, true]);
    expect(mouse.takeZoom()).toBeCloseTo(-1.2, 12);
    expect(mouse.takeZoom()).toBe(0);
    expect(mouse.pointer()).toEqual({ x: 10, y: 20, inside: true, locked: false });
    mouse.detach();
  });

  it('looks only under pointer lock, at LOOK_SPEED rad per pixel, up for a push away', () => {
    const element = Object.assign(new EventTarget(), { requestPointerLock: () => Promise.reject(new Error('no')) });
    const document = Object.assign(new EventTarget(), { pointerLockElement: null as unknown });
    const { log, sink } = recorder();
    const mouse = attachMouse({ element, target: new EventTarget(), document }, sink, {});
    const move = (dx: number, dy: number) =>
      element.dispatchEvent(event('pointermove', { pointerType: 'mouse', movementX: dx, movementY: dy }));
    move(100, 0);
    expect(mouse.takeLook()).toEqual([0, 0]);
    mouse.lock(); // refused here: nothing changes, nothing throws
    document.pointerLockElement = element;
    document.dispatchEvent(event('pointerlockchange'));
    move(100, -40);
    move(20, 0);
    expect(mouse.locked).toBe(true);
    const [right, up] = mouse.takeLook();
    expect(right).toBeCloseTo(120 * LOOK_SPEED, 12);
    expect(up).toBeCloseTo(40 * LOOK_SPEED, 12);
    expect(mouse.takeLook()).toEqual([0, 0]);
    expect(log.filter((line) => line === 'used@mouse')).toHaveLength(3);
  });
});

/** A pad in `index` with axes and the buttons pressed (index → value). */
function pad(
  index: number,
  axes: number[] = [0, 0, 0, 0],
  pressed: Record<number, number> = {},
  id = 'Xbox',
): GamepadLike {
  const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: (pressed[i] ?? 0) > 0.1, value: pressed[i] ?? 0 }));
  return { id, index, connected: true, mapping: 'standard', axes, buttons };
}

describe('the gamepad', () => {
  it('applies a radial deadzone rescaled to reach the edge', () => {
    expect(radialDeadzone(0.1, 0.1, 0.18)).toEqual([0, 0]);
    const [x] = radialDeadzone(0.59, 0, 0.18);
    expect(x).toBeCloseTo(0.5, 12);
    const [dx, dy] = radialDeadzone(0.6, 0.8, 0.18); // the edge, diagonally
    expect(Math.hypot(dx, dy)).toBeCloseTo(1, 12);
    expect(dy / dx).toBeCloseTo(0.8 / 0.6, 12); // the direction is kept
    expect(radialDeadzone(0, 0, 0.18)).toEqual([0, 0]);
  });

  it('reads any slot, writes stick directions as strengths, and holds them from 0.5', () => {
    const slots: (GamepadLike | null)[] = [null, null, pad(2, [0, -0.6, 0, 0])];
    const { log, values, sink } = recorder();
    const device = createGamepadDevice(sink, () => slots);
    device.poll();
    expect(device.index).toBe(2);
    expect(values.get('PadLeftStickUp')).toBeCloseTo(0.42 / 0.82, 12);
    expect(log).toContain('+PadLeftStickUp@gamepad');
    slots[2] = pad(2, [0, -0.5, 0, 0.9]); // 0.39 up: below the let-go point
    device.poll();
    expect(log.at(-1)).toBe('used@gamepad');
    expect(log).toContain('-PadLeftStickUp');
    expect(values.get('PadLeftStickUp')).toBeCloseTo(0.32 / 0.82, 12); // 0.39: still walks, no longer held
    expect(device.rightStick()[1]).toBeCloseTo((0.9 - 0.18) / 0.82, 12);
  });

  it('holds analog triggers from 0.5 and lets go below 0.4', () => {
    const slots = [pad(0)];
    const { log, values, sink } = recorder();
    const device = createGamepadDevice(sink, () => slots);
    const trigger = (value: number) => {
      slots[0] = pad(0, undefined, { 7: value });
      device.poll();
      return log.filter((line) => line.includes('PadRightTrigger')).length;
    };
    expect([trigger(0.3), trigger(0.5), trigger(0.45), trigger(0.39), trigger(0.45)]).toEqual([0, 1, 1, 2, 2]);
    expect(values.get('PadRightTrigger')).toBe(0.45);
  });

  it('lets go of everything when the pad leaves, and hands over to a pad in use in another slot', () => {
    const slots: (GamepadLike | null)[] = [pad(0, undefined, { 0: 1 }), pad(3)];
    const { log, sink } = recorder();
    const device = createGamepadDevice(sink, () => slots);
    device.poll();
    expect(log).toEqual(['+PadSouth@gamepad', 'used@gamepad']);
    slots[0] = null; // unplugged
    device.poll();
    expect(log.slice(2, 3)).toEqual(['-PadSouth']);
    expect(device.index).toBe(3);
    slots[0] = pad(0);
    slots[3] = pad(3); // the active one rests…
    slots[0] = pad(0, undefined, { 1: 1 }, 'DualSense Wireless Controller (Vendor: 054c)'); // …another is used
    device.poll();
    expect(device.index).toBe(0);
    expect(device.style).toBe('playstation');
    expect(log.at(-2)).toBe('+PadEast@gamepad');
    device.release();
    expect(log.at(-1)).toBe('-PadEast');
    expect(device.index).toBeNull();
  });

  it('survives a source that throws (gamepads blocked in a frame)', () => {
    const device = createGamepadDevice(recorder().sink, () => {
      throw new Error('blocked');
    });
    expect(() => device.poll()).not.toThrow();
    expect(device.index).toBeNull();
  });
});

describe('the scripted gamepad', () => {
  it('holds each line for its frames, taps on its first, then rests', () => {
    const scripted = createScriptedGamepad('# warm up\n2 left=0,-1 hold=A tap=Up\n1 rt=0.7 hold=RightShoulder', {
      index: 1,
    });
    const frames: string[] = [];
    while (scripted.next()) {
      const { axes, buttons } = scripted.gamepad;
      const down = buttons.flatMap((button, i) => (button.pressed ? [i] : []));
      frames.push(`${axes.join(',')} ${down.join(',')} ${buttons[7].value}`);
    }
    expect(frames).toEqual(['0,-1,0,0 0,12 0', '0,-1,0,0 0 0', '0,0,0,0 5,7 0.7']);
    expect(scripted.gamepad.buttons.every((button) => !button.pressed)).toBe(true);
    expect(scripted.gamepad.index).toBe(1);
    scripted.disconnect();
    expect(scripted.gamepad.connected).toBe(false);
  });

  it('names every bad line at once', () => {
    expect(() => parsePadScript('x left=0\n2 hold=Jump\n3 left=1,2 left=0,0\n0')).toThrow(
      /INPUT_BAD_SCRIPT.*line 1 starts with "x".*line 3: left is given twice.*line 4 starts with "0"/,
    );
    expect(() => parsePadScript('2 hold=Jump')).toThrow(/line 1: unknown button "Jump"/);
    expect(() => parsePadScript('2 lft=0,1')).toThrow(/unknown key "lft" \(did you mean "left" or "lt"\?\)/);
  });
});
