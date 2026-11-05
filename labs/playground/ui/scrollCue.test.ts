/**
 * @file Unit tests for labs/playground/ui/scrollCue.ts (WP 13.40): a panel with more below what shows is marked
 * `data-more`, and unmarked once scrolled to its end or when all of it shows; the mark is written only when it changes.
 * @see labs/playground/ui/scrollCue.ts
 */
import { describe, expect, it } from 'vitest';
import { cueScroll, hasMore, SCROLLERS } from './scrollCue';

/** A stand-in panel of `height` px, `shows` of it showing, scrolled `top`; it counts its attribute's writes. */
function panel(height: number, shows: number, top = 0) {
  const attributes = new Set<string>();
  return {
    scrollTop: top,
    clientHeight: shows,
    scrollHeight: height,
    writes: 0,
    hasAttribute: (name: string) => attributes.has(name),
    toggleAttribute(name: string, on: boolean) {
      this.writes++;
      if (on) attributes.add(name);
      else attributes.delete(name);
      return on;
    },
  };
}

describe('the scroll cue', () => {
  it('marks a panel with more below, and clears the mark at its end, writing only on a change', () => {
    const [tall, short] = [panel(900, 400), panel(300, 400)];
    const root = { querySelectorAll: (selector: string) => (selector === SCROLLERS ? [tall, short] : []) };
    cueScroll(root as never);
    cueScroll(root as never);
    expect([tall.hasAttribute('data-more'), short.hasAttribute('data-more'), tall.writes, short.writes]).toEqual([true, false, 1, 0]); // prettier-ignore
    tall.scrollTop = 500; // scrolled to its end
    cueScroll(root as never);
    expect([tall.hasAttribute('data-more'), tall.writes]).toEqual([false, 2]);
  });

  it('allows two pixels of rounding at the end', () => {
    expect([hasMore({ scrollTop: 498, clientHeight: 400, scrollHeight: 900 }), hasMore({ scrollTop: 497, clientHeight: 400, scrollHeight: 900 })]).toEqual([false, true]); // prettier-ignore
  });
});
