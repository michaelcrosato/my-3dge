/**
 * @file The front end's links to another page of the playground (labs/playground/ui/frontEnd.ts, WP 13.33): a
 * recorded run (`replayLink`, `?replay=<name>`) and a Go to place picked off the block (`goToLink`,
 * `?scene=site&playground.spawn=<id>`, which the block's page runs as its first operation). Each keeps of the page's
 * query only the view a player chose (`VIEW_KEYS`), and Go to also `playground.title`: a scene, a replay, a check or
 * a spawn never carries over (a kept `?scene` beat the replay's own and failed with APP_OTHER_SCENE; a kept check
 * teleported the replay's player).
 *
 * Game code, a page's: it imports nothing.
 *
 * @example
 * replayLink({ pathname: '/', search: '?cam=iso&scene=gym' }, 'playground-gym'); // '/?cam=iso&replay=playground-gym'
 * @see labs/playground/ui/links.test.ts
 */

/** The query keys of the view a player chose, which a link to another page keeps (see the file comment). */
export const VIEW_KEYS: readonly string[] = ['post.look', 'cam', 'cam3', 'cam.wholeZoom'];

/** Where a link starts from: the page's `location`, or its path and query. */
export type Here = Pick<Location, 'pathname' | 'search'>;

/** The page at `now` with the query `changes`, keeping of its query only the `kept` keys. */
export function pageLink(now: Here, changes: Record<string, string>, kept: readonly string[]): string {
  const query = new URLSearchParams(now.search);
  const next = new URLSearchParams();
  for (const key of kept) if (query.has(key)) next.set(key, query.get(key)!);
  for (const [key, value] of Object.entries(changes)) next.set(key, value);
  return `${now.pathname}?${next}`;
}

/** The page playing the recorded run `id`, the view kept. */
export const replayLink = (now: Here, id: string): string => pageLink(now, { replay: id }, VIEW_KEYS);

/** The block's page opened at the Go to place `id` (spawns.ts), the view and the start menu's setting kept. */
export const goToLink = (now: Here, id: string): string =>
  pageLink(now, { scene: 'site', 'playground.spawn': id }, [...VIEW_KEYS, 'playground.title']);
