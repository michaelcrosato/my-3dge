/**
 * @file Unit tests for labs/playground/ui/splash.ts (WP 13.38): a person sees the splash on every load, the start
 * menu's and every page that opens on play (a recorded run, the tour, an owner's check), but it waits for a key only
 * over the start menu; under automation it shows only where the start menu is asked for, and never waits, so the tests'
 * and the x commands' pages open as before.
 * @see labs/playground/ui/splash.ts
 */
import { describe, expect, it } from 'vitest';
import { splashOnOpen } from './splash';

describe('the splash screen as the page opens', () => {
  it('shows for a person on every load, waiting for a key only over the start menu', () => {
    expect(splashOnOpen(true, false)).toEqual({ show: true, wait: true }); // the start menu
    expect(splashOnOpen(false, false)).toEqual({ show: true, wait: false }); // a replay, the tour, a check: into play
  });

  it('keeps automation’s pages as they were: only with the start menu asked for, never waiting', () => {
    expect(splashOnOpen(true, true)).toEqual({ show: true, wait: false });
    expect(splashOnOpen(false, true)).toEqual({ show: false, wait: false });
  });
});
