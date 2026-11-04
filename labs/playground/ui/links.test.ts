/**
 * @file Unit tests for the front end's links (labs/playground/ui/links.ts, WP 13.33): the links the recorded runs and
 * Go to open from a page that names a scene, a replay, a check and a spawn keep the view (and, for Go to, the start
 * menu's setting) and none of those.
 * @see labs/playground/ui/links.ts
 */
import { describe, expect, it } from 'vitest';
import { goToLink, replayLink } from './links';

const at = { pathname: '/labs/playground/', search: '?scene=site-house&cam3=shoulder&playground.title=off&playground.check=shooter-house&post.look=look:playground-cel&playground.spawn=area:gym' }; // prettier-ignore
const query = (link: string) => Object.fromEntries(new URLSearchParams(link.split('?')[1]));

describe('the front end’s links', () => {
  it('opens a recorded run with the view kept, never the scene, the check, the spawn or the start menu’s setting', () => {
    expect(query(replayLink(at, 'playground-gym'))).toEqual({ cam3: 'shoulder', 'post.look': 'look:playground-cel', replay: 'playground-gym' }); // prettier-ignore
  });

  it('opens Go to on the block with the view and the start menu’s setting kept, never the replay or the check', () => {
    const onReplay = { pathname: at.pathname, search: `${at.search}&replay=playground-gym&cam=iso` };
    expect(goToLink(onReplay, 'area:range')).toBe('/labs/playground/?post.look=look%3Aplayground-cel&cam=iso&cam3=shoulder&playground.title=off&scene=site&playground.spawn=area%3Arange'); // prettier-ignore
  });
});
