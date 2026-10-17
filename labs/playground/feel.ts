/**
 * @file The playground's feel panel (docs/PLAYGROUND.md §3.4, PLAN.md WP 13.4): the engine's panel (engine/dev/feel/
 * panel.ts: sliders over the `movement.*` and `cam.*` settings, live, Copy as profile, Save the replay) on the page,
 * shown and hidden with F (`FEEL_KEY`), or open from the start with the view setting `playground.feel=on` (read when
 * the page opens). labs/playground/main.ts mounts it once the engine is up; the menu lists its key.
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

/** Mounts the panel on `document` over `inspector`: open when the query asks, F toggling it. Returns the panel. */
export function mountFeelPanel(document: Document, inspector: unknown, search: URLSearchParams): FeelPanel {
  const panel = createFeelPanel(document, inspector as FeelInspector);
  if (feelOpens(search)) panel.show();
  document.defaultView?.addEventListener('keydown', (event) => {
    if (event.code !== FEEL_KEY || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as { tagName?: string } | null;
    if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
    panel.toggle();
  });
  return panel;
}
