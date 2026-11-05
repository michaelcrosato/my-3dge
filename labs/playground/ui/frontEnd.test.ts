/**
 * @file Unit tests for the front end (labs/playground/ui/frontEnd.ts): the start menu shows unless a replay plays or
 * automation drives the browser, or the page asks; Tools (tools.ts) names the engine's own pages, the Stress Box and
 * the labs, and `ABOUT` says what each of its items does.
 * @see labs/playground/ui/frontEnd.ts
 * @see labs/playground/ui/tools.ts
 */
import { describe, expect, it } from 'vitest';
import { ABOUT } from './frame';
import { titleOnOpen } from './frontEnd';
import { toolsItems } from './tools';

describe('the front end’s opening', () => {
  it('opens on the start menu for a person, never under a replay or automation unless asked', () => {
    const none = new URLSearchParams();
    const replay = new URLSearchParams('replay=playground-gym');
    expect([titleOnOpen('auto', none, false), titleOnOpen('auto', replay, false), titleOnOpen('auto', none, true)]).toEqual([true, false, false]); // prettier-ignore
    expect([titleOnOpen('on', replay, true), titleOnOpen('off', none, false)]).toEqual([true, false]);
  });
});

describe('the front end’s Tools', () => {
  it('names the Stress Box and the labs plainly, and says what each item does', () => {
    const items = toolsItems({ replays: true, feel: true });
    const pages = items.find((item) => item.id === 'pages');
    expect(pages?.label).toMatch(/^The Stress Box and the labs/);
    expect(pages?.disabled).toBeFalsy();
    for (const { id } of items.filter((item) => item.id !== 'back')) expect(ABOUT[id!], id).toBeTruthy();
    expect(ABOUT.tools).toMatch(/Stress Box/);
    expect(toolsItems({ replays: false, feel: false }).filter((item) => item.disabled).map((item) => item.id)).toEqual(['replays', 'feel']); // prettier-ignore
  });
});
