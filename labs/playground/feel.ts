/**
 * @file The playground's feel panel (docs/PLAYGROUND.md §3.4, PLAN.md WP 13.4): the engine's panel (engine/dev/feel/
 * panel.ts: sliders over the `movement.*` and `cam.*` settings, live, Copy as profile, Save the replay) on the page,
 * shown and hidden with F (`FEEL_KEY`), or open from the start with the view setting `playground.feel=on` (read when
 * the page opens). labs/playground/main.ts mounts it once the engine is up; the controls sheet (ui/help.ts) lists its
 * key, and Tools in the start menu and pause opens it too. Here it wears the playground's theme (ui/theme.ts) and
 * gains a heading, a line on what it is for and a Close button (`[data-feel=close]`, after Reset), as the other panels
 * have; the engine's panel, and its look on every other page, stay as they are.
 *
 * Invariants: the panel changes the run only through the inspector's recorded `set`; the view setting never reaches
 * the hash.
 *
 * Game code, a page's: it imports only the engine's public API (engine/index.ts).
 *
 * @example
 * // const panel = mountFeelPanel(document, engine.inspector, search); // F toggles it
 * @see labs/playground/feel.test.ts
 */
import { createFeelPanel, defineSettings, type FeelInspector, type FeelPanel } from '../../engine';

/** The key that shows and hides the panel. */
export const FEEL_KEY = 'KeyF';

/** The playground's feel setting: whether the panel shows when the page opens. */
export const PLAYGROUND_FEEL_SETTINGS = defineSettings({
  'playground.feel': {
    type: 'string',
    enum: ['off', 'on'],
    default: 'off',
    view: true,
    when: 'scene',
    description: "The playground page's feel panel (labs/playground/feel.ts): 'on' shows it when the page opens; F shows and hides it.", // prettier-ignore
  },
});

/** Whether the query (`?playground.feel=on`) opens the panel. */
export const feelOpens = (search: URLSearchParams): boolean => search.get('playground.feel') === 'on';

/** The heading and the line the playground puts over the panel's buttons. */
export const FEEL_HEADING = Object.freeze({
  title: 'Tune the feel',
  text: 'The movement’s and the cameras’ numbers, live, each change recorded in the run. Copy as profile gives them as text to send back; Save the replay keeps the run.', // prettier-ignore
});

/**
 * Mounts the panel on `document` over `inspector`, headed and with a Close button (see the file comment): open when
 * the query asks, F toggling it unless `held` (a screen of the page's is open, under which the panel hides: F would
 * toggle it out of sight). Returns the panel.
 */
export function mountFeelPanel(
  document: Document,
  inspector: unknown,
  search: URLSearchParams,
  held: () => boolean = () => false,
): FeelPanel {
  const panel = createFeelPanel(document, inspector as FeelInspector);
  const make = (tag: string, text: string) => Object.assign(document.createElement(tag), { textContent: text });
  panel.root.prepend(make('h2', FEEL_HEADING.title), make('p', FEEL_HEADING.text)); // the panel redraws only its rows
  const close = Object.assign(make('button', 'Close (F)'), { type: 'button' });
  close.dataset.feel = 'close';
  close.addEventListener('click', () => panel.hide());
  panel.root.querySelector('[data-feel=reset]')?.after(close);
  if (feelOpens(search)) panel.show();
  document.defaultView?.addEventListener('keydown', (event) => {
    if (event.code !== FEEL_KEY || event.repeat || event.ctrlKey || event.metaKey || event.altKey || held()) return;
    const target = event.target as { tagName?: string } | null;
    if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
    panel.toggle();
  });
  return panel;
}
