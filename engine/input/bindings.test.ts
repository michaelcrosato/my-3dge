/**
 * @file Unit tests for the codes, action maps and bindings of engine/input/ (T1, WP 3.3): codes and their labels per
 * device and pad family; the presets are valid, conflict-free and keep the system layer's reserved codes; a bad map
 * names every problem; rebinding refuses reserved codes and conflicts (naming the holder), replaces one device family
 * or one code, and survives a reload through storage; a bad saved file loads what it can, with advice.
 * @see engine/input/codes.ts
 * @see engine/input/actionMaps.ts
 * @see engine/input/bindings.ts
 */
import { describe, expect, it } from 'vitest';
import { createLog } from '../core/log';
import { createRegistry } from '../core/registry';
import { defineActionMap, getActionMap, listActionMaps, RESERVED_CODES, SYSTEM_ACTIONS } from './actionMaps';
import { BINDINGS_FORMAT, createBindings, pickLabel } from './bindings';
import { codeLabel, deviceOf, isCode, PAD_BUTTONS, padStyle } from './codes';

/** An in-memory `localStorage`. */
function memory(seed: Record<string, string> = {}) {
  const items = new Map(Object.entries(seed));
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
  };
}

describe('codes', () => {
  it('accepts physical codes only, and names their device', () => {
    for (const code of ['KeyW', 'Digit0', 'F12', 'ShiftLeft', 'NumpadEnter', 'MouseRight', 'WheelUp', 'PadSouth', 'PadRightStickLeft']) {
      expect(isCode(code), code).toBe(true);
    } // prettier-ignore
    for (const code of ['w', 'Key', 'Mouse0', 'Pad0', 'KeyWW', '', 7]) expect(isCode(code), String(code)).toBe(false);
    expect(['KeyW', 'MouseLeft', 'WheelDown', 'PadEast'].map(deviceOf)).toEqual([
      'keyboard',
      'mouse',
      'mouse',
      'gamepad',
    ]);
    expect(PAD_BUTTONS.length).toBe(17);
  });

  it('labels keys by layout when known, and pad buttons by family', () => {
    expect(['KeyW', 'Digit1', 'ArrowUp', 'Space', 'ShiftLeft', 'Escape', 'NumpadEnter', 'MouseLeft'].map((c) => codeLabel(c))).toEqual([
      'W', '1', 'Up', 'Space', 'L Shift', 'Esc', 'Num Enter', 'LMB',
    ]); // prettier-ignore
    expect(codeLabel('KeyQ', { layout: new Map([['KeyQ', 'a']]) })).toBe('A');
    expect(codeLabel('PadLeftStickUp')).toBe('L Stick Up');
    const south = (id: string) => codeLabel('PadSouth', { pad: padStyle(id) });
    expect([south('Xbox 360 Controller'), south('Wireless Controller (Vendor: 054c)'), south('Pro Controller (057e)')]).toEqual(
      ['A', 'Cross', 'B'],
    ); // prettier-ignore
    expect(pickLabel(['MouseLeft', 'KeyJ', 'PadWest'], 'keyboard')).toBe('J');
    expect(pickLabel(['MouseLeft', 'KeyJ', 'PadWest'], 'mouse')).toBe('LMB');
    expect(pickLabel(['KeyJ'], 'gamepad')).toBe('—');
  });
});

describe('action maps', () => {
  it('registers valid presets with no code on two actions and no reserved code', () => {
    const maps = listActionMaps();
    expect(maps.map((map) => map.id)).toEqual(
      expect.arrayContaining(['actionMap:firstPerson', 'actionMap:platformer', 'actionMap:shmup', 'actionMap:thirdPerson']),
    ); // prettier-ignore
    for (const map of maps) {
      const all = Object.values(map.actions).flat();
      expect(new Set(all).size, `${map.id} binds a code twice`).toBe(all.length);
      expect(all.filter((code) => RESERVED_CODES.includes(code))).toEqual([]);
      expect(Object.keys(map.actions)).toEqual(expect.arrayContaining([...map.move]));
    }
    expect(Object.values(SYSTEM_ACTIONS).flat().every(isCode)).toBe(true);
    expect(getActionMap('actionMap:firstPerson').look).toBe(true);
  });

  it('names every problem of a bad map', () => {
    const registry = createRegistry();
    const bad = () =>
      defineActionMap(
        'actionMap:bad',
        { actions: { Jump: ['w'], pause: ['KeyP'], fire: ['Escape'] }, move: ['up', 'down', 'left', 'right'], values: { charge: 'fire' } },
        registry,
      ); // prettier-ignore
    expect(bad).toThrow(/CORE_BAD_SPEC/);
    let message = '';
    try {
      bad();
    } catch (error) {
      message = String(error);
    }
    for (const part of [
      'the action "Jump" must be a lower-case word',
      'actions.Jump holds "w", not a code',
      'pause is a system action',
      'actions.fire binds the reserved code Escape',
      'move names "up", which actions lacks',
      'values key "charge" must be "game:name"',
    ]) {
      expect(message).toContain(part);
    }
  });
});

describe('bindings', () => {
  it('rebinds one device family, keeping the other, and refuses reserved codes and conflicts', () => {
    const bindings = createBindings('actionMap:thirdPerson');
    expect(bindings.rebind('jump', 'KeyK')).toMatchObject({ ok: false, reason: 'conflict', action: 'dash' });
    expect(bindings.rebind('jump', 'KeyG')).toEqual({ ok: true, codes: ['PadSouth', 'KeyG'] });
    expect(bindings.rebind('jump', 'PadNorth')).toMatchObject({ reason: 'conflict', action: 'skill' });
    expect(bindings.rebind('jump', 'Escape')).toMatchObject({ ok: false, reason: 'reserved' });
    expect(bindings.rebind('jump', 'PadStart').ok).toBe(false);
    expect(bindings.rebind('jupm', 'KeyG')).toMatchObject({ reason: 'unknown-action' });
    expect((bindings.rebind('jupm', 'KeyG') as { message: string }).message).toContain('did you mean "jump"');
    expect(bindings.rebind('jump', 'g')).toMatchObject({ reason: 'bad-code' });
    expect(bindings.rebind('forward', 'KeyI', { replace: 'KeyW' })).toEqual({
      ok: true,
      codes: ['KeyI', 'ArrowUp', 'PadUp', 'PadLeftStickUp'],
    });
    expect(bindings.rebind('back', 'KeyW').ok).toBe(true); // W is free again
    expect(bindings.label('jump', 'keyboard')).toBe('G');
    expect(bindings.version).toBe(3);
  });

  it('unbinds and resets', () => {
    const bindings = createBindings('actionMap:thirdPerson');
    bindings.unbind('attack', 'gamepad');
    expect(bindings.codes('attack')).toEqual(['MouseLeft', 'KeyJ']);
    bindings.unbind('attack', 'KeyJ');
    expect(bindings.codes('attack')).toEqual(['MouseLeft']);
    expect(bindings.rebind('dash', 'KeyJ').ok).toBe(true);
    bindings.reset('attack');
    expect(bindings.codes('attack')).toContain('KeyJ'); // now on dash too: reset is the map's word
    bindings.reset();
    expect(bindings.toJSON()).toEqual({ format: BINDINGS_FORMAT, map: 'actionMap:thirdPerson', actions: {} });
  });

  it('saves every change and loads it on the next start', () => {
    const storage = memory();
    const first = createBindings('actionMap:thirdPerson', { storage });
    first.rebind('interact', 'KeyF');
    first.rebind('jump', 'PadRightStick');
    expect(JSON.parse(storage.items.get('my3dge:bindings:actionMap:thirdPerson') as string)).toEqual({
      format: BINDINGS_FORMAT,
      map: 'actionMap:thirdPerson',
      actions: { jump: ['Space', 'PadRightStick'], interact: ['PadLeftShoulder', 'KeyF'] },
    });
    const second = createBindings('actionMap:thirdPerson', { storage });
    expect([second.codes('interact'), second.codes('jump')]).toEqual([
      ['PadLeftShoulder', 'KeyF'],
      ['Space', 'PadRightStick'],
    ]);
  });

  it('loads what it can of a bad saved file, with advice naming each problem', () => {
    const printed: string[] = [];
    const log = createLog({ console: { warn: (line) => printed.push(line), error: () => {} } });
    const actions = {
      jupm: ['KeyG'],
      dash: ['Escape'],
      attack: 'KeyJ',
      skill: ['KeyW'],
      forward: ['KeyI'],
      interact: ['KeyJ', 'KeyJ'],
      jump: ['KeyE'],
    };
    const storage = memory({ key: JSON.stringify({ format: BINDINGS_FORMAT, actions }) });
    const bindings = createBindings('actionMap:thirdPerson', { storage, key: 'key', log });
    expect(bindings.codes('forward')).toEqual(['KeyI']); // W moved off forward…
    expect(bindings.codes('skill')).toEqual(['KeyW']); // …so skill may take it
    expect(bindings.codes('interact')).toEqual(['KeyE', 'PadLeftShoulder']); // J is still attack's: back to the map…
    expect(bindings.codes('jump')).toEqual(['Space', 'PadSouth']); // …so E is interact's, and jump's change goes too
    expect(printed).toHaveLength(1);
    for (const part of ['INPUT_BAD_BINDINGS', '"jupm" is no action', 'dash: Escape is reserved', 'attack: "KeyJ" is not a list', 'interact: KeyJ is bound to attack', 'jump: KeyE is bound to interact']) {
      expect(printed[0]).toContain(part);
    } // prettier-ignore
    const junk = createBindings('actionMap:thirdPerson', { storage: memory({ junk: '{' }), key: 'junk', log });
    expect(junk.codes('jump')).toEqual(['Space', 'PadSouth']);
    expect(printed[1]).toContain('not JSON');
  });
});
