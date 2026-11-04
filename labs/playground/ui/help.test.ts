/**
 * @file The controls sheet (labs/playground/ui/help.ts): every action it names is one the shooter's map binds (the
 * map every other mode's shares its actions with) or the system layer's (pause), every group has lines, and the lines
 * worked out from the input follow the map in use and the device used last: the move keys or the left stick, the
 * mouse's look or aim or the right stick, the shoulder only in the shooter, the turn only in isometric.
 */
import { describe, expect, it } from 'vitest';
import { registry } from '../../../engine/core/registry';
import { SYSTEM_ACTIONS } from '../../../engine/input/actionMaps';
import { PLAYGROUND_MAPS } from '../controls';
import { HELP_GROUPS, type HelpInput } from './help';

/** The map an entry names, as the input's bindings hold it. */
const mapOf = (id: string) => registry.get('actionMap', id) as unknown as HelpInput['bindings']['map'] & { actions: object }; // prettier-ignore

/** An input on `map`, its prompts the action's name, on `device`. */
const inputOn = (map: string, device: HelpInput['lastDevice']) => ({ prompt: (action: string) => action, bindings: { map: mapOf(map) }, lastDevice: device }) as unknown as HelpInput; // prettier-ignore

/** The keys the sheet shows for its worked-out lines on `input`, by label. */
const worked = (input: HelpInput) => Object.fromEntries(HELP_GROUPS.flatMap((group) => group.lines.flatMap((line) => (line.keys ? [[line.label, line.keys(input)]] : [])))); // prettier-ignore

describe('the controls sheet', () => {
  it('names only actions the playground binds, in groups that each have lines', () => {
    const bound = [...Object.keys(mapOf(PLAYGROUND_MAPS.shooter).actions), ...Object.keys(SYSTEM_ACTIONS)];
    const actions = HELP_GROUPS.flatMap((group) => group.lines.flatMap((line) => (line.action ? [line.action] : [])));
    for (const action of actions) expect(bound, action).toContain(action);
    for (const group of HELP_GROUPS) expect(group.lines.length, group.title).toBeGreaterThan(0);
  });

  it('works out the move, the look and the view keys from the map in use and the device', () => {
    expect(worked(inputOn(PLAYGROUND_MAPS.shooter, 'keyboard'))).toEqual({
      Move: 'forward left back right',
      'Look around': 'Click, then mouse',
      'Swap shoulder': 'shoulder',
      'Turn the view': null,
    });
    expect(worked(inputOn(PLAYGROUND_MAPS.isometric, 'mouse'))).toMatchObject({ 'Look around': 'Mouse: it aims', 'Swap shoulder': null, 'Turn the view': 'turnLeft turnRight' }); // prettier-ignore
    expect(worked(inputOn(PLAYGROUND_MAPS.shooter, 'gamepad'))).toMatchObject({ Move: 'L Stick', 'Look around': 'R Stick' }); // prettier-ignore
  });
});
