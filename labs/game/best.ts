/**
 * @file The starter game's best round (PLAN.md WP 10.9): the fastest round won, kept across sessions in the engine's
 * store (engine/app/store.ts) under the game's own prefix. `bestOf(store)` reads it (null before a first win) and
 * `recordBest(store, seconds)` keeps a time that beats it, returning the best after. The page (labs/game/main.ts)
 * records each won round's time and shows the best in the HUD; a replay's page opens the store in its `demo` mode, so
 * a replay never sets a best.
 *
 * Game code, a page's: it imports only the engine's public API (engine/index.ts).
 *
 * @example
 * import { createStore } from '../../engine';
 * const store = createStore({ mode: 'demo' }); // in memory: nothing kept past the page
 * [recordBest(store, 14.2), recordBest(store, 16), recordBest(store, 9.5), bestOf(store)]; // [14.2, 14.2, 9.5, 9.5]
 * @see labs/game/best.test.ts
 */
import type { Store } from '../../engine';

/** The key the best round is kept under. */
export const BEST_KEY = 'best';

/** The fastest won round kept (s), or null: none yet, or a value that is no time. */
export function bestOf(store: Store): number | null {
  const best = store.get<unknown>(BEST_KEY, null);
  return typeof best === 'number' && best > 0 ? best : null;
}

/** Keeps `seconds` when it beats the best kept; returns the best after. */
export function recordBest(store: Store, seconds: number): number {
  const best = bestOf(store);
  if (best !== null && best <= seconds) return best;
  store.set(BEST_KEY, seconds);
  return seconds;
}
