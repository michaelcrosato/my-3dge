/**
 * @file Routes and deep links (PLAN.md §6.1: URL parameters are parsed once, here, and passed down; §8.1; WP 2.7):
 * what a page's query asks for. `parseRoutes(search, { scenes })` reads:
 * - `?scene=<name>`: one of the page's scenes (registered with engine/sim/scene.ts), by its id (`box:room`) or the
 *   name after its colon (`room`); the page's first scene when absent.
 * - `?seed=<n>`: the seed, a whole number from 0 (1 when absent).
 * - `?cam=<code>` or `?cam3=<code>`: the camera, as a camera code without its key (`?cam=iso,45,2`, `?cam3=orbit`;
 *   engine/gfx/cameras/codes.ts).
 * - `?replay=<name>`: a replay the page offers, played from step 0 in real time once the page is up.
 * - every other key is a setting, by its path, with its value as `x set` types it (`?box.room.speed=3`,
 *   `?gfx.resolution=full`): the settings schema checks each (engine/core/settings.ts), so `x set`, URL parameters
 *   and `__engine.set` reach the same settings the same way. `routeQuery` writes a query back.
 *
 * Invariants: an unknown key is an error naming the closest (a setting path or a route), like an unknown flag; a
 * malformed value is an error naming the fix (`APP_BAD_ROUTE`, `CORE_BAD_SETTING`, `GFX_BAD_CAMERA_CODE`); a query
 * with any problem gives no routes at all, never a page half-configured.
 *
 * @example
 * import { createRegistry } from '../core/registry';
 * import { defineScene } from '../sim/scene';
 * const registry = createRegistry();
 * defineScene('box:room', { setup: () => {} }, registry);
 * parseRoutes('?scene=room&seed=4&cam=topdown', { scenes: ['box:room'], registry }).scene; // 'box:room'
 * parseRoutes('?cam3=orbit', { scenes: ['box:room'], registry }).cam; // 'cam3=orbit'
 * routeQuery({ scene: 'room', settings: { 'time.scale': 0.5 } }); // '?scene=room&time.scale=0.5'
 * @see engine/app/routes.test.ts
 */
import { codeError, defineCodes, didYouMean } from '../core/log';
import { registry as sharedRegistry, type Registry } from '../core/registry';
import { createSettings, type SettingValue } from '../core/settings';
import { parseCameraCode } from '../gfx/cameras/codes';
import { getScene } from '../sim/scene';

/** The codes this module raises, with their fixes. */
export const ROUTE_CODES = defineCodes('app', {
  APP_BAD_ROUTE: {
    template: 'the URL parameter {key}={value} {problem}',
    fix: '{fix}',
  },
});

/** The keys that are routes, not settings. */
export const ROUTE_KEYS = ['scene', 'seed', 'cam', 'cam3', 'replay'] as const;

/** What a page's query asks for. */
export interface Routes {
  /** The scene id. */
  scene: string;
  seed: number;
  /** The camera code (`cam=iso`, `cam3=orbit`), when one was asked for. */
  cam?: string;
  /** The replay's name, when one was asked for. */
  replay?: string;
  /** Settings by path, typed. */
  settings: Record<string, SettingValue>;
}

/** What the routes are checked against: the page's scenes and the registry that declares them and the settings. */
export interface RouteOptions {
  /** The page's scene ids; the first is the default. */
  scenes: readonly string[];
  registry?: Registry;
}

/** Throws `APP_BAD_ROUTE`. */
function bad(key: string, value: string, problem: string, fix: string): never {
  throw codeError('APP_BAD_ROUTE', { key, value, problem, fix });
}

/** The scene `name` names among `scenes`: an id, or the name after its colon. */
function sceneOf(name: string | null, scenes: readonly string[], registry: Registry): string {
  if (!scenes.length)
    bad('scene', name ?? '', 'has no scene to pick: the page offers none', 'pass createEngine its scenes');
  if (name === null) return scenes[0];
  const found = scenes.find((id) => id === name || id.slice(id.indexOf(':') + 1) === name);
  if (!found) {
    const names = scenes.map((id) => id.slice(id.indexOf(':') + 1));
    bad('scene', name, `names no scene of this page${didYouMean(name, names)}`, `use one of ${names.join(', ')}`);
  }
  getScene(found, registry); // CORE_NO_ENTRY when the page lists a scene it never registered
  return found;
}

/** Reads a page's query (see the file comment). */
export function parseRoutes(search: string, options: RouteOptions): Routes {
  const registry = options.registry ?? sharedRegistry;
  const params = new URLSearchParams(search);
  const one = (key: string) => {
    const all = params.getAll(key);
    if (all.length > 1) bad(key, all.join(','), 'is given more than once', `give ${key} once`);
    return all[0] ?? null;
  };
  const scene = sceneOf(one('scene'), options.scenes, registry);
  const seedText = one('seed');
  if (seedText !== null && !/^(0|[1-9]\d*)$/.test(seedText)) {
    bad('seed', seedText, 'is not a whole number from 0', 'write a seed as digits: ?seed=3');
  }
  const seed = seedText === null ? 1 : Number(seedText);
  if (!Number.isSafeInteger(seed)) bad('seed', seedText ?? '', 'is too large', 'use a seed below 2^53');
  const [cam, cam3] = [one('cam'), one('cam3')];
  if (cam !== null && cam3 !== null) bad('cam3', cam3, 'comes with cam', 'give one camera: ?cam=… or ?cam3=…');
  const code = cam !== null ? `cam=${cam}` : cam3 !== null ? `cam3=${cam3}` : undefined;
  if (code !== undefined) parseCameraCode(code);
  const replay = one('replay') ?? undefined;
  if (replay !== undefined && !/^[a-z0-9][a-z0-9-]*$/.test(replay)) {
    bad(
      'replay',
      replay,
      'is not a replay name',
      'name a replay by its file name without .replay.json: ?replay=box-1-room',
    );
  }
  const store = createSettings({ registry });
  store.fromUrl(search, { reserved: [...ROUTE_KEYS] });
  const settings: Record<string, SettingValue> = {};
  for (const path of new Set([...params.keys()].filter((key) => !(ROUTE_KEYS as readonly string[]).includes(key)))) {
    settings[path] = store.get(path);
  }
  return { scene, seed, ...(code ? { cam: code } : {}), ...(replay ? { replay } : {}), settings };
}

/** A query for these routes: `?scene=room&cam=iso&time.scale=0.5` (keys in this order, settings last). */
export function routeQuery(routes: Partial<Omit<Routes, 'settings'>> & { settings?: Routes['settings'] }): string {
  const params = new URLSearchParams();
  if (routes.scene !== undefined) params.set('scene', routes.scene);
  if (routes.seed !== undefined) params.set('seed', String(routes.seed));
  if (routes.cam !== undefined) {
    const at = routes.cam.indexOf('=');
    params.set(at < 0 ? 'cam' : routes.cam.slice(0, at), at < 0 ? routes.cam : routes.cam.slice(at + 1));
  }
  if (routes.replay !== undefined) params.set('replay', routes.replay);
  for (const [path, value] of Object.entries(routes.settings ?? {})) {
    params.set(path, typeof value === 'string' ? value : JSON.stringify(value));
  }
  const text = params.toString().replaceAll('%2C', ',').replaceAll('%3A', ':');
  return text ? `?${text}` : '';
}
