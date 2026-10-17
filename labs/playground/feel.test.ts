/**
 * @file Unit tests for the playground's feel panel wiring (labs/playground/feel.ts): the query opens it only when it
 * says `playground.feel=on`, the setting is a view setting (never in the hash), and F is the playground's own key, left
 * unbound by its action map. The panel's DOM is checked in the page (tests/e2e/playground.spec.ts).
 * @see labs/playground/feel.ts
 */
import { describe, expect, it } from 'vitest';
import { getActionMap } from '../../engine';
import { PLAYGROUND_ACTION_MAP } from './controls';
import { FEEL_KEY, feelOpens, PLAYGROUND_FEEL_SETTINGS } from './feel';

describe('the playground’s feel panel', () => {
  it('opens from the query only when asked, a view setting, on its own key', () => {
    expect(feelOpens(new URLSearchParams('?playground.feel=on'))).toBe(true);
    expect(feelOpens(new URLSearchParams('?playground.feel=off'))).toBe(false);
    expect(feelOpens(new URLSearchParams(''))).toBe(false);
    expect(PLAYGROUND_FEEL_SETTINGS[0]).toMatchObject({ id: 'playground.feel', view: true, default: 'off' });
    expect(Object.values(getActionMap(PLAYGROUND_ACTION_MAP).actions).flat()).not.toContain(FEEL_KEY);
  });
});
