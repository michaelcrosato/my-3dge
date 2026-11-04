/**
 * @file Unit tests for the front end's opening (labs/playground/ui/frontEnd.ts): the start menu shows unless a replay
 * plays or automation drives the browser, or the page asks.
 * @see labs/playground/ui/frontEnd.ts
 */
import { describe, expect, it } from 'vitest';
import { titleOnOpen } from './frontEnd';

describe('the front end’s opening', () => {
  it('opens on the start menu for a person, never under a replay or automation unless asked', () => {
    const none = new URLSearchParams();
    const replay = new URLSearchParams('replay=playground-gym');
    expect([titleOnOpen('auto', none, false), titleOnOpen('auto', replay, false), titleOnOpen('auto', none, true)]).toEqual([true, false, false]); // prettier-ignore
    expect([titleOnOpen('on', replay, true), titleOnOpen('off', none, false)]).toEqual([true, false]);
  });
});
