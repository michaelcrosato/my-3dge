/**
 * @file The controls sheet (labs/playground/ui/help.ts): every action it names is one the shooter's map binds (the
 * map every other mode's shares its actions with), and every group has lines.
 */
import { describe, expect, it } from 'vitest';
import { registry } from '../../../engine/core/registry';
import '../controls';
import { HELP_GROUPS } from './help';

describe('the controls sheet', () => {
  it('names only actions the playground binds, in groups that each have lines', () => {
    const bound = Object.keys((registry.get('actionMap', 'actionMap:playground-shooter') as unknown as { actions: object }).actions); // prettier-ignore
    const actions = HELP_GROUPS.flatMap((group) => group.lines.flatMap((line) => (line.action ? [line.action] : [])));
    for (const action of actions) expect(bound, action).toContain(action);
    for (const group of HELP_GROUPS) expect(group.lines.length, group.title).toBeGreaterThan(0);
  });
});
