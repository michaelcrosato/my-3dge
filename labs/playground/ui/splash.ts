/**
 * @file The splash screen (the owner's call of 2026-11-03: "a proper splash screen, start menu, etc."): shown the
 * moment the page's script runs, over everything, while the engine loads and warms up; the playground's name, a bar
 * that moves while it loads, and then "Press any key to start". A person sees it on every load (`splashOnOpen`): the
 * start menu's, and a page that opens on play (a recorded run, the tour, an owner's check), which it fades into at
 * once; automation sees it only where the start menu is asked for. `createSplash(doc)` shows it; `ready(waitForPlayer)`
 * says the engine is up: with `waitForPlayer` (a person at the start menu) it waits for a key, a click or a touch,
 * which it keeps from the game (the key that starts never reaches a menu or the run), or for the page to call `start()`
 * (a pad's A or Start, which fire no event: labs/playground/main.ts polls them while `waiting()`, the start menu under
 * it reading nothing until then), then fades away; without (automation: the tests and the x commands; a page that opens
 * on play), it fades away at once. A failed start removes it (`remove`), so the page's error shows. The start menu
 * opens under it first, so the fade shows it. The first key also wakes the page's sound, which waits for one
 * (labs/playground/sounds/page.ts).
 *
 * Elements: `[data-ui=splash]`, `data-value` `loading`, `ready` or `gone`. Invariants: presentation only; `ready`
 * resolves once, `remove` is safe at any time.
 *
 * Game code, a page's: it imports only the engine's public API (engine/index.ts) and the playground's own files.
 *
 * @example
 * // const splash = createSplash(document);
 * // …the engine starts…
 * // await splash.ready(splashOnOpen(showsTitle, navigator.webdriver).wait); // the first key, click or touch
 * splashOnOpen(false, false); // { show: true, wait: false }: a person at a replay's page, faded into play
 * @see tests/e2e/playground-ui.spec.ts
 */
import { brand, textDiv } from './frame';
import { installTheme } from './theme';

/** How long the splash takes to fade (ms), as the theme's transition. */
const FADE_MS = 420;

/** The splash (see the file comment). */
export interface Splash {
  /** The engine is up: waits for a player when asked, then fades the splash away. */
  ready(waitForPlayer: boolean): Promise<void>;
  /** Whether it waits for a player (`ready(true)` called, nothing pressed yet). */
  waiting(): boolean;
  /** Starts as a key would (a pad's press); nothing unless it waits. */
  start(): void;
  remove(): void;
}

/**
 * Whether the page shows the splash as it opens, and whether it then waits for a player (see the file comment), from
 * whether the page opens on its start menu (`title`, frontEnd.ts `titleOnOpen`) and whether automation drives it.
 */
export const splashOnOpen = (title: boolean, webdriver: boolean): { show: boolean; wait: boolean } => ({
  show: title || !webdriver,
  wait: title && !webdriver,
});

/** Shows the splash in `doc` (see the file comment). */
export function createSplash(doc: Document): Splash {
  installTheme(doc);
  const el = Object.assign(doc.createElement('div'), { className: 'pg-splash' });
  el.dataset.ui = 'splash';
  el.dataset.value = 'loading';
  const text = (className: string, textContent: string) => textDiv(doc, className, textContent);
  const status = text('pg-splash-status', 'Loading the block…');
  el.append(brand(doc, 'A block of everything the engine does: walk in, try it, tune it.'), text('pg-splash-bar', ''), status, text('pg-splash-foot', 'WebGPU · three.js · Rapier')); // prettier-ignore
  doc.body.append(el);
  let done: Promise<void> | null = null;
  let start = () => {};
  const fade = () =>
    new Promise<void>((resolve) => {
      el.dataset.value = 'gone';
      setTimeout(() => (el.remove(), resolve()), FADE_MS);
    });
  return {
    ready(waitForPlayer) {
      if (done) return done;
      if (!waitForPlayer) return (done = fade());
      el.dataset.value = 'ready';
      status.textContent = 'Press any key to start';
      const view = doc.defaultView!;
      done = new Promise<void>((resolve) => {
        const heard = (event: Event) => {
          event.preventDefault();
          event.stopImmediatePropagation(); // the key that starts reaches neither a menu nor the run
          start();
        };
        start = () => {
          start = () => {};
          for (const type of ['keydown', 'pointerdown', 'touchend']) view.removeEventListener(type, heard, true);
          void fade().then(resolve);
        };
        for (const type of ['keydown', 'pointerdown', 'touchend']) view.addEventListener(type, heard, true);
      });
      return done;
    },
    waiting: () => el.dataset.value === 'ready',
    start: () => start(),
    remove: () => el.remove(),
  };
}
