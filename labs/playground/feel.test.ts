/**
 * @file Unit tests for the playground's feel panel wiring (labs/playground/feel.ts): the query opens it only when it
 * says `playground.feel=on`, the setting is a view setting (never in the hash), and F is the playground's own key, left
 * unbound by its action map; mounted (over tests/unit/ui/fakeDom.ts), the panel is headed, says what it is for and has
 * a Close button after the engine's, which stay, and redrawing its rows keeps them. The panel's DOM is checked in the
 * page too (tests/e2e/playground.spec.ts).
 * @see labs/playground/feel.ts
 */
import { describe, expect, it } from 'vitest';
import { getActionMap } from '../../engine';
import { fakePage, type FakeElement } from '../../tests/unit/ui/fakeDom';
import { PLAYGROUND_MAPS } from './controls';
import { FEEL_HEADING, FEEL_KEY, feelOpens, mountFeelPanel, PLAYGROUND_FEEL_SETTINGS } from './feel';

describe('the playground’s feel panel', () => {
  it('opens from the query only when asked, a view setting, on its own key', () => {
    expect(feelOpens(new URLSearchParams('?playground.feel=on'))).toBe(true);
    expect(feelOpens(new URLSearchParams('?playground.feel=off'))).toBe(false);
    expect(feelOpens(new URLSearchParams(''))).toBe(false);
    expect(PLAYGROUND_FEEL_SETTINGS[0]).toMatchObject({ id: 'playground.feel', view: true, default: 'off' });
    for (const id of Object.values(PLAYGROUND_MAPS)) expect(Object.values(getActionMap(id).actions).flat()).not.toContain(FEEL_KEY); // prettier-ignore
  });

  it('heads the panel, says what it is for and closes it with a button, the engine’s rows and buttons kept', () => {
    const { document } = fakePage({ left: 0, top: 0, width: 1280, height: 720 });
    document.defaultView = null; // no window: F's listener is checked in the page
    const inspector = {
      set: () => undefined,
      tune: { settings: () => [{ path: 'movement.gaits.run', value: 4.4, default: 4.4 }], profile: () => '' },
      input: { record: () => ({}) },
      info: () => ({ scene: 'playground:gym', tick: 0 }),
    };
    const panel = mountFeelPanel(document as unknown as Document, inspector, new URLSearchParams('playground.feel=on'));
    const root = panel.root as unknown as FakeElement;
    const parts = () => root.children.map((el) => `${el.tagName} ${el.tagName === 'h2' ? el.textContent : ''}`.trim());
    expect(parts()).toEqual([`h2 ${FEEL_HEADING.title}`, 'p', 'header', 'div', 'textarea']);
    expect(root.children[1].textContent).toBe(FEEL_HEADING.text);
    expect(root.querySelectorAll('[data-feel]').map((el) => el.dataset.feel)).toEqual(['copy', 'save', 'reset', 'close', 'profile']); // prettier-ignore
    expect([root.hidden, root.querySelectorAll('[data-path]').length]).toEqual([false, 1]); // open, as the query asked
    root.querySelector('[data-feel=close]')!.click();
    expect(root.hidden).toBe(true);
    panel.show(); // its rows read and drawn again: the heading stays
    expect([root.hidden, parts()[0], root.querySelectorAll('[data-path]').length]).toEqual([false, `h2 ${FEEL_HEADING.title}`, 1]); // prettier-ignore
  });
});
