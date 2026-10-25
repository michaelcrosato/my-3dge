/**
 * @file The playground's preferences (docs/PLAYGROUND.md §8.3, PLAN.md WP 13.25): what its settings screen changes and
 * the page's store keeps across sessions (`createStore`, engine/app/store.ts, under `PREFS_PREFIX`): the camera mode
 * the page opens in, the settings of `PREF_SETTINGS` by path (the field of view, the mouse, the look, the quality, the
 * movement profile) and the audio buses' levels. The engine keeps the bindings in the same store
 * (`createEngine({ store })`).
 *
 * Only what the player changed is kept, never a default, so no number here restates a setting's schema.
 * `readPrefs(store)` reads them back, dropping what is not of their shape. `prefsQuery(prefs, search, scenes)` writes
 * them into the page's query before the engine starts, except where the query names that setting or a camera already
 * (a link wins, and the tests' and the `x` commands' pages, whose store starts empty, open as their URL says); each
 * kept setting is checked by the engine's own routes (`parseRoutes`) first, and one the schema refuses (a kept value
 * an older page wrote) is left out, so a stale preference never stops the page.
 *
 * Invariants: presentation only, but for the movement profile, a sim setting (`playground.movement`) that enters the
 * run's settings as the page opens, so the run's replay holds it. The store keeps nothing in the modes that leave a
 * player's saves alone: the page opens its store in `demo` while a replay plays.
 *
 * Game code, a page's: it imports only the engine's public API (engine/index.ts) and the playground's own files.
 *
 * @example
 * import { createStore, memoryBackend } from '../../../engine';
 * const store = createStore({ prefix: PREFS_PREFIX, backend: memoryBackend() });
 * savePrefs(store, { camera: 'first', settings: { 'cam.fov': 100 }, volumes: { music: 0.2 } });
 * const search = new URLSearchParams('?scene=site');
 * prefsQuery(readPrefs(store), search, ['playground:site']); // ['cam3', 'cam.fov']
 * search.toString(); // 'scene=site&cam3=first&cam.fov=100'
 * @see labs/playground/ui/prefs.test.ts
 */
import { parseRoutes, type Store } from '../../../engine';
import { PLAYGROUND_CAMERAS } from '../views';

/** The store's prefix: the playground's own, so other pages on the origin keep apart. */
export const PREFS_PREFIX = 'my3dge-playground:';

/** The key the preferences are kept under. */
export const PREFS_KEY = 'prefs';

/** The settings the settings screen offers and the store keeps, by path. */
export const PREF_SETTINGS = [
  'cam.fov',
  'input.sensitivity',
  'input.invert',
  'post.look',
  'quality',
  'gfx.governor',
  'playground.movement',
] as const;

/** One of `PREF_SETTINGS`. */
export type PrefSetting = (typeof PREF_SETTINGS)[number];

/** The audio buses the settings screen sets, master first (engine/audio/runtime/mixer.ts's). */
export const PREF_BUSES = ['master', 'effects', 'music', 'ambience'] as const;

/** What is kept (see the file comment). */
export interface Prefs {
  /** The camera mode the page opens in, by name (`first`); the page's own when absent. */
  camera?: string;
  /** The settings changed, by path. */
  settings: Partial<Record<PrefSetting, string | number | boolean>>;
  /** The buses' levels changed, 0 to 1. */
  volumes: Partial<Record<(typeof PREF_BUSES)[number], number>>;
}

/** No preferences: a first visit. */
export const NO_PREFS: Prefs = Object.freeze({ settings: {}, volumes: {} }) as Prefs;

/** The preferences `store` keeps, or none; whatever is not of their shape is dropped. */
export function readPrefs(store: Pick<Store, 'get'>): Prefs {
  const kept = store.get<Partial<Prefs> | null>(PREFS_KEY, null);
  const prefs: Prefs = { settings: {}, volumes: {} };
  if (!kept || typeof kept !== 'object') return prefs;
  if (PLAYGROUND_CAMERAS.some((mode) => mode.name === kept.camera)) prefs.camera = kept.camera;
  for (const path of PREF_SETTINGS) {
    const value = (kept.settings as Record<string, unknown> | undefined)?.[path];
    if (['string', 'number', 'boolean'].includes(typeof value))
      prefs.settings[path] = value as string | number | boolean;
  }
  for (const bus of PREF_BUSES) {
    const level = (kept.volumes as Record<string, unknown> | undefined)?.[bus];
    if (typeof level === 'number' && level >= 0 && level <= 1) prefs.volumes[bus] = level;
  }
  return prefs;
}

/** Keeps `prefs` in `store`; false when the store refused it. */
export function savePrefs(store: Pick<Store, 'set'>, prefs: Prefs): boolean {
  return store.set(PREFS_KEY, prefs);
}

/**
 * Writes `prefs` into `search` (see the file comment) and returns the keys it wrote: the camera's (`cam` or `cam3`)
 * when the query names no camera, then each kept setting the query lacks and the routes accept on `scenes`.
 */
export function prefsQuery(prefs: Prefs, search: URLSearchParams, scenes: readonly string[]): string[] {
  const wrote: string[] = [];
  const mode = PLAYGROUND_CAMERAS.find((one) => one.name === prefs.camera);
  if (mode && !search.has('cam') && !search.has('cam3')) {
    const [key, value] = mode.code.split('=');
    search.set(key, value);
    wrote.push(key);
  }
  for (const [path, value] of Object.entries(prefs.settings)) {
    if (search.has(path)) continue;
    try {
      parseRoutes(`?${new URLSearchParams({ [path]: String(value) })}`, { scenes });
    } catch {
      continue; // a value the schema refuses: left out, never a page that cannot start
    }
    search.set(path, String(value));
    wrote.push(path);
  }
  return wrote;
}
