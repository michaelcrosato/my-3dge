/**
 * @file The page in touch mode (PLAN.md WP 3.12, ADR-0021: built, not tested): `setTouch(on)` puts the `touch` class
 * on the page, which engine/ui/touch.css styles (no scrolling, overscroll, text selection or tap highlight; panels
 * that start below the menu button and scroll; key hints, the keyboard guide and the dev stats hidden; HUD text scaled
 * by `--touch-k`; touch targets at least 44 × 34 px). The page links that stylesheet and engine/ui/manifest.webmanifest
 * with `<link>` tags, as labs/box/index.html does: no engine module imports a `.css` file, since tsx, which runs every
 * `x` command, cannot load one.
 *
 * In touch mode the first `pointerup` (once, in the capture phase) asks for full screen and a landscape lock, and
 * ignores a refusal (an iPhone keeps its bars); held upright, a "turn sideways" hint fades after 5 s. A tap on the
 * open game closes the top panel (`closeTopPanel`). The page's conventions: a panel is an element marked
 * `data-panel`, open while it has no `hidden` attribute; key hints and the keyboard guide are marked `data-keyboard`,
 * the dev stats `data-stats`, HUD text `data-hud`.
 *
 * Invariants: presentation only; the class follows `setTouch` and nothing else. No `@example` runs here: it would be
 * a touch test, which the owner ruled out (ADR-0021).
 *
 * Carried from `shardfall:web/index.html:5-58` (the viewport, the page's style, full screen on the first tap, the turn
 * hint) and `shardfall:crates/pav_app/src/app.rs:307-331` (`close_on_tap`, one thing at a time).
 *
 * @example
 * // const chrome = createChrome(document);
 * // chrome.setTouch(input.touch.active);
 * // chrome.closeTopPanel(); // after a tap on the open game
 */

/** The hint shown to a phone held upright. */
export const TURN_HINT = 'Turn your phone sideways for the best view';

/** The page's touch-mode chrome. */
export interface Chrome {
  /** Whether the page is in touch mode now. */
  readonly touch: boolean;
  /** Turns touch mode's page on or off (see the file comment). */
  setTouch(on: boolean): void;
  /** The top open panel (the last open `[data-panel]` in the page), or null. */
  topPanel(): HTMLElement | null;
  /** Closes the top open panel (sets `hidden`, then dispatches `close` on it); false when none is open. */
  closeTopPanel(): boolean;
  /** Removes the hint and the listener, and leaves touch mode. */
  dispose(): void;
}

/** Asks for full screen and a landscape lock, ignoring a refusal. */
function fullScreen(document: Document): void {
  const page = document.documentElement;
  if (document.fullscreenElement || typeof page.requestFullscreen !== 'function') return;
  const orientation = globalThis.screen?.orientation as { lock?: (to: string) => Promise<void> } | undefined;
  page
    .requestFullscreen({ navigationUI: 'hide' })
    .then(() => orientation?.lock?.('landscape'))
    .catch(() => {}); // refused or unsupported: the page plays in the browser's frame
}

/** Makes the touch-mode chrome of `document` (off until `setTouch(true)`). */
export function createChrome(document: Document): Chrome {
  const hint = document.createElement('div');
  hint.className = 'touch-turn';
  hint.setAttribute('role', 'status');
  hint.textContent = TURN_HINT;
  hint.hidden = true;
  document.body.append(hint);
  let touch = false;
  let asked = false;
  const ask = () => fullScreen(document);
  const panels = () => [...document.querySelectorAll<HTMLElement>('[data-panel]')].filter((panel) => !panel.hidden);
  return {
    get touch() {
      return touch;
    },
    setTouch(on) {
      if (on === touch) return;
      touch = on;
      hint.hidden = !on;
      document.documentElement.classList.toggle('touch', on);
      if (on && !asked) {
        asked = true;
        document.addEventListener('pointerup', ask, { once: true, capture: true });
      }
    },
    topPanel: () => panels().at(-1) ?? null,
    closeTopPanel() {
      const panel = panels().at(-1);
      if (!panel) return false;
      panel.hidden = true;
      panel.dispatchEvent(new Event('close'));
      return true;
    },
    dispose() {
      hint.remove();
      document.removeEventListener('pointerup', ask, { capture: true });
      document.documentElement.classList.remove('touch');
    },
  };
}
