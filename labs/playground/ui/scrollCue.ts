/**
 * @file A cue that a panel scrolls (the final visual review, WP 13.40: lists cut at a panel's bottom edge, with
 * nothing to say more follow): `cueScroll(root)` marks each of the playground's scrolling panels under `root` (a
 * screen's panel, the feel panel: `SCROLLERS`) `data-more` while some of it lies below what shows, and the theme
 * (theme.ts) fades its bottom edge then, with "More below". labs/playground/main.ts runs it each drawn frame.
 *
 * Invariants: presentation only; it reads sizes, and writes the attribute only when it changes.
 *
 * Game code, a page's: it imports nothing.
 *
 * @example
 * hasMore({ scrollTop: 0, clientHeight: 400, scrollHeight: 900 }); // true: 500 px lie below
 * hasMore({ scrollTop: 500, clientHeight: 400, scrollHeight: 900 }); // false: scrolled to its end
 * @see labs/playground/ui/scrollCue.test.ts
 */

/** The playground's panels that scroll: a screen's panel (settings, the controls, Tune, the checks) and the feel panel. */
export const SCROLLERS = '.pg-screen .ui-panel, .feel-panel';

/** Whether `box` has more below what shows (2 CSS px of slack for rounding). */
export const hasMore = (box: Pick<HTMLElement, 'scrollTop' | 'clientHeight' | 'scrollHeight'>): boolean =>
  box.scrollTop + box.clientHeight < box.scrollHeight - 2;

/** Marks each panel under `root` that has more below what shows `data-more` (see the file comment). */
export function cueScroll(root: Pick<ParentNode, 'querySelectorAll'>): void {
  for (const box of root.querySelectorAll<HTMLElement>(SCROLLERS)) {
    const more = hasMore(box);
    if (more !== box.hasAttribute('data-more')) box.toggleAttribute('data-more', more);
  }
}
