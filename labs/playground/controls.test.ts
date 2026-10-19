/**
 * @file Unit tests for the playground's controls (labs/playground/controls.ts, WP 13.9): every camera mode's map passes
 * the bindings tests (no code on two actions, no reserved or system code, nothing on Ctrl, which with W closes the tab,
 * the page's P, F and M refused by rebinding, view actions rebound like the others), each binds Apex's default keys
 * where the browser allows, and each mode's own rules: the view sent and the centre aimed in first person and the
 * shooter, the platformer facing its move, isometric and top-down aiming with the pointer, Q and E turning isometric
 * (so G uses there). `playgroundMap` picks a camera's map, the HUD's line and the menu's rows follow the map in use.
 * @see labs/playground/controls.ts
 */
import { describe, expect, it } from 'vitest';
import { createBindings, createInput, getActionMap, RESERVED_CODES } from '../../engine';
import { keysLine, PLAYGROUND_ACTIONS, PLAYGROUND_MAPS, playgroundMap } from './controls';
import { FEEL_KEY } from './feel';
import { controlRows, MENU_KEY } from './menu';
import { LOOK_KEY, PLAYGROUND_CAMERAS } from './views';

/** Every mode's map, by mode. */
const MAPS = Object.entries(PLAYGROUND_MAPS).map(([mode, id]) => ({ mode, id, map: getActionMap(id) }));

describe('the playground’s action maps', () => {
  it('pass the bindings tests, one map per camera mode', () => {
    expect(MAPS.map(({ mode }) => mode)).toEqual(PLAYGROUND_CAMERAS.map((mode) => mode.name));
    for (const { id, map } of MAPS) {
      const all = Object.values(map.actions).flat();
      expect(new Set(all).size, `${id} binds a code twice`).toBe(all.length);
      expect(
        all.filter((code) => RESERVED_CODES.includes(code) || code.startsWith('Control')),
        id,
      ).toEqual([]);
      expect(map.reserved, id).toEqual([LOOK_KEY, FEEL_KEY, MENU_KEY]); // the page's own keys
      expect(Object.keys(map.actions), id).toEqual(expect.arrayContaining([...map.move, ...map.view]));
      const bindings = createBindings(id);
      expect(bindings.rebind('jump', LOOK_KEY), id).toMatchObject({ ok: false, reason: 'reserved' });
      expect(bindings.rebind('camera', 'KeyY'), id).toMatchObject({ ok: true, codes: ['PadSelect', 'KeyY'] });
      expect(bindings.rebind('jump', 'KeyY'), id).toMatchObject({ ok: false, reason: 'conflict', action: 'camera' });
    }
  });

  it('bind Apex’s keys where the browser allows, the buttons the shooter model reads', () => {
    for (const { id, map } of MAPS) {
      expect(map.move, id).toEqual(['forward', 'back', 'left', 'right']);
      expect(map.actions, id).toMatchObject({
        jump: ['Space', 'PadSouth'],
        sprint: ['ShiftLeft', 'PadLeftStick'],
        walk: ['AltLeft'],
        crouch: ['KeyC', 'PadEast'],
        melee: ['KeyV', 'PadRightStick'],
        fire: ['MouseLeft', 'PadRightTrigger'],
        aim: ['MouseRight', 'PadLeftTrigger'],
        camera: ['KeyT', 'PadSelect'],
      });
    }
    expect(Object.keys(PLAYGROUND_ACTIONS)).toEqual(['jump', 'sprint', 'walk', 'crouch', 'interact', 'aim']);
  });

  it('give each mode its rule: the view and the centre where the eyes aim, the pointer where the views look down', () => {
    const rules = Object.fromEntries(MAPS.map(({ mode, map }) => [mode, [map.look, map.aimWith, map.lock]]));
    expect(rules).toEqual({
      shooter: [true, 'centre', true],
      first: [true, 'centre', true],
      platformer: [false, 'none', true],
      isometric: [false, 'pointer', false],
      'top-down': [false, 'pointer', false],
    });
    const views = Object.fromEntries(MAPS.map(({ mode, map }) => [mode, map.view]));
    expect(views).toMatchObject({ shooter: ['camera', 'shoulder'], isometric: ['camera', 'turnLeft', 'turnRight'] });
    expect(getActionMap(PLAYGROUND_MAPS.shooter).actions).toMatchObject({ interact: ['KeyE', 'PadWest'], shoulder: ['KeyX', 'PadLeft'] }); // prettier-ignore
    expect(getActionMap(PLAYGROUND_MAPS.isometric).actions).toMatchObject({ interact: ['KeyG', 'PadWest'], turnLeft: ['KeyQ'], turnRight: ['KeyE', 'PadRight'] }); // prettier-ignore
  });

  it('pick the map of the camera in use, the shooter’s for a camera no mode opens', () => {
    for (const mode of PLAYGROUND_CAMERAS) expect(playgroundMap(mode.code)).toBe(PLAYGROUND_MAPS[mode.name as keyof typeof PLAYGROUND_MAPS]); // prettier-ignore
    expect(playgroundMap('cam3=first,90,-10,70')).toBe(PLAYGROUND_MAPS.first);
    expect(playgroundMap('cam=iso,90,2')).toBe(PLAYGROUND_MAPS.isometric);
    expect(playgroundMap('cam3=fly')).toBe(PLAYGROUND_MAPS.shooter);
  });

  it('show the map in use on the HUD and in the menu, as rebound and on a pad', () => {
    const shooter = createInput({ map: PLAYGROUND_MAPS.shooter });
    expect(keysLine(shooter)).toMatch(/^WASD: move · Space: jump · .*Shift: sprint · .*: use · Click: mouse look · T: camera · X: shoulder · P: look · F: feel · M: menu$/); // prettier-ignore
    shooter.bindings.rebind('camera', 'KeyY');
    expect(keysLine(shooter)).toContain('Y: camera');
    const iso = createInput({ map: PLAYGROUND_MAPS.isometric });
    expect(keysLine(iso)).toContain('G: use · Mouse: aim · T: camera · Q E: turn');
    const pad = { prompt: () => 'A', bindings: iso.bindings, lastDevice: 'gamepad' as const };
    expect(keysLine(pad)).toMatch(/^L Stick: move · .*R Stick: look/);
    const rows = (id: string) => Object.fromEntries(controlRows(undefined, id).map(([what, keys]) => [what, keys]));
    expect(rows(PLAYGROUND_MAPS.shooter)).toMatchObject({ 'Swap the shoulder': 'X', 'Camera mode': 'T' });
    expect(rows(PLAYGROUND_MAPS.isometric)).toMatchObject({ 'Use: a zipline or a ladder': 'G', Aim: 'The pointer, onto the floor', 'Turn the view left': 'Q', 'Turn the view right': 'E' }); // prettier-ignore
    expect(rows(PLAYGROUND_MAPS.first)['Swap the shoulder']).toBeUndefined();
  });
});
