/**
 * @file The controls sheet (labs/playground/ui/help.ts): every action it names is one the shooter's map binds (the
 * map every other mode's shares its actions with) or the system layer's (pause), and every touch button's; every group
 * has lines; and the keys follow the map in use and the device used last: the move keys or the left stick, the
 * mouse's or the right stick's look, or their aim where the map aims with the pointer, the shoulder only in the
 * shooter, the turn only in isometric and only its halves the device has, the page's keys on a keyboard alone (the
 * area card's I among them), and on
 * touch the stick, the touch buttons and the menu button.
 */
import { describe, expect, it } from 'vitest';
import { registry } from '../../../engine/core/registry';
import { SYSTEM_ACTIONS } from '../../../engine/input/actionMaps';
import { PLAYGROUND_MAPS } from '../controls';
import { PLAYGROUND_TOUCH_BUTTONS } from '../touch';
import { HELP_GROUPS, keyOf, UNBOUND, type HelpInput } from './help';

/** The map an entry names, as the input's bindings hold it. */
const mapOf = (id: string) => registry.get('actionMap', id) as unknown as HelpInput['bindings']['map'] & { actions: object }; // prettier-ignore

/** An input on `map`, on `device`, its prompts the action's name or as `prompts` gives them. */
const inputOn = (map: string, device: HelpInput['lastDevice'], prompts: Record<string, string> = {}, touch = false) => ({ prompt: (action: string) => prompts[action] ?? action, bindings: { map: mapOf(map) }, lastDevice: device, touch: { active: touch } }) as unknown as HelpInput; // prettier-ignore

/** What the sheet shows on `input`, by line id: [what it does, its key], the lines left out missing. */
const sheet = (input: HelpInput) =>
  Object.fromEntries(HELP_GROUPS.flatMap((group) => group.lines.flatMap((line) => {
    const key = keyOf(line, input);
    return key === null || key === UNBOUND ? [] : [[line.action ?? line.page ?? line.label, [line.says?.(input) ?? line.label, key]]];
  }))); // prettier-ignore

describe('the controls sheet', () => {
  it('names only actions the playground binds, in groups that each have lines', () => {
    const bound = [...Object.keys(mapOf(PLAYGROUND_MAPS.shooter).actions), ...Object.keys(SYSTEM_ACTIONS)];
    const actions = HELP_GROUPS.flatMap((group) => group.lines.flatMap((line) => (line.action ? [line.action] : [])));
    for (const action of [...actions, ...PLAYGROUND_TOUCH_BUTTONS.map((button) => button.action)]) expect(bound, action).toContain(action); // prettier-ignore
    for (const group of HELP_GROUPS) expect(group.lines.length, group.title).toBeGreaterThan(0);
  });

  it('works out the move, the look and the view keys from the map in use and the device', () => {
    const keys = sheet(inputOn(PLAYGROUND_MAPS.shooter, 'keyboard'));
    expect(keys).toMatchObject({ Move: ['Move', 'forward left back right'], 'Look around': ['Look around', 'Click, then mouse'], 'Swap shoulder': ['Swap shoulder', 'shoulder'], P: ['Next look', 'P'], I: ['This area’s card again', 'I'] }); // prettier-ignore
    expect(keys['Turn the view']).toBeUndefined();
    const iso = sheet(inputOn(PLAYGROUND_MAPS.isometric, 'mouse'));
    expect([iso['Look around'], iso['Swap shoulder'], iso['Turn the view']]).toEqual([['Aim', 'Mouse'], undefined, ['Turn the view', 'turnLeft turnRight']]); // prettier-ignore
    const pad = sheet(inputOn(PLAYGROUND_MAPS.isometric, 'gamepad', { turnLeft: UNBOUND, turnRight: 'D-pad Right' }));
    expect([pad.Move, pad['Look around'], pad['Turn the view'], pad.P, pad.M]).toEqual([['Move', 'L Stick'], ['Aim', 'R Stick'], ['Turn the view', 'D-pad Right'], undefined, undefined]); // prettier-ignore
    expect(sheet(inputOn(PLAYGROUND_MAPS.shooter, 'gamepad'))['Look around']).toEqual(['Look around', 'R Stick']);
  });

  it('names the stick, the touch buttons and the menu button on touch, and leaves out the rest', () => {
    const keys = (input: HelpInput) =>
      Object.fromEntries(Object.entries(sheet(input)).map(([id, [, key]]) => [id, key]));
    const touch = { Move: 'Stick: touch and drag', jump: 'Jump', crouch: 'Crouch', interact: 'Use', melee: 'Strike', pause: 'Menu button, top right' }; // prettier-ignore
    expect(keys(inputOn(PLAYGROUND_MAPS.shooter, 'touch'))).toEqual(touch);
    expect(keys(inputOn(PLAYGROUND_MAPS.shooter, 'keyboard', {}, true))).toEqual(touch); // touch mode, before a finger lands on the game
    expect(keys(inputOn(PLAYGROUND_MAPS.shooter, 'gamepad', {}, true)).Move).toBe('L Stick'); // a pad used last on a touch screen
  });
});
