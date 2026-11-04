/**
 * @file Unit tests for the front end's links (labs/playground/ui/frontEnd.ts, WP 13.33): a recorded run or a Go to
 * picked on a page that names a scene, a replay, a check or a spawn opens its page with the view kept and none of
 * those (a kept `?scene` beat the replay's own and failed with APP_OTHER_SCENE; a kept check teleported the replay's
 * player); the start menu shows unless a replay plays or automation drives the browser.
 * @see labs/playground/ui/frontEnd.ts
 */
import { describe, expect, it } from 'vitest';
import { pageLink, titleOnOpen, VIEW_KEYS } from './frontEnd';

const at = { pathname: '/labs/playground/', search: '?scene=site-house&cam3=shoulder&playground.title=off&playground.check=shooter-house&post.look=look:playground-cel' }; // prettier-ignore

describe('the front end’s links', () => {
  it('keeps the view and drops the scene, the replay, the check and the spawn', () => {
    const replay = new URLSearchParams(pageLink(at, { replay: 'playground-gym' }, VIEW_KEYS).split('?')[1]);
    expect(Object.fromEntries(replay)).toEqual({ cam3: 'shoulder', 'post.look': 'look:playground-cel', replay: 'playground-gym' }); // prettier-ignore
    const onReplay = { pathname: at.pathname, search: '?replay=playground-gym&cam=iso&playground.spawn=area:gym' };
    const goTo = pageLink(onReplay, { scene: 'site', 'playground.spawn': 'area:range' }, [...VIEW_KEYS, 'playground.title']); // prettier-ignore
    expect(goTo).toBe('/labs/playground/?cam=iso&scene=site&playground.spawn=area%3Arange');
  });

  it('opens on the start menu for a person, never under a replay or automation unless asked', () => {
    const none = new URLSearchParams();
    const replay = new URLSearchParams('replay=playground-gym');
    expect([titleOnOpen('auto', none, false), titleOnOpen('auto', replay, false), titleOnOpen('auto', none, true)]).toEqual([true, false, false]); // prettier-ignore
    expect([titleOnOpen('on', replay, true), titleOnOpen('off', none, false)]).toEqual([true, false]);
  });
});
