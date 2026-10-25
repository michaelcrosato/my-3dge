/**
 * @file The animation library on the box page (PLAN.md §10, WP 8.9): `loadLibrary(files)` registers every set of
 * `data/anim/sets/` the page loaded as text (labs/box/main.ts, through `import.meta.glob`, never a fetch), each as a
 * `clipset` entry (engine/anim/clip/clipsets.ts: its `_set.json` and its clip files joined, `clipSetFromFiles`), then
 * the mannequin, its build and body, from the Quaternius set (engine/gfx/puppets/bodies/mannequin.ts): what clip mode
 * (labs/box/scenes/clips.ts) plays and draws. The page calls it before it opens clip mode; no other scene loads it.
 * tests/pages/replay.ts calls it too, so clip mode's replays play in the sim page as here; Node registers the same
 * entries through tools/anim/library.ts. The lab pages register through here too (WP 10.8), so no page entry calls a
 * `define…` itself: `loadMannequin(text)`, the mannequin alone from the Quaternius set's `_set.json` text (labs/anim/,
 * labs/index/gallery.ts), and `registerEdit`, a clip's edited text played as a set of its own (labs/library/).
 *
 * Invariants: the sets register sorted by directory, each once (`defineClipSet` keeps a set registered already); the
 * module does nothing at its top level, so tools that import it in Node (`x describe`) load it as it is.
 *
 * Game code, a page's: it imports only engine/index.ts.
 *
 * @example
 * // const files = import.meta.glob<string>('../../data/anim/sets/*\/*.json', { query: '?raw', import: 'default' });
 * // await loadLibrary(files); // __engine.describe('clipset').ids: ['clipset:cmu', 'clipset:mesh2motion', …]
 */
import { clipSetFromFiles, defineClipSet, defineMannequin, getClipSet, parseClip } from '../../engine';

/** Registers the sets in `files` (path → its text, loaded on demand), then the mannequin from the Quaternius set. */
export async function loadLibrary(files: Readonly<Record<string, () => Promise<string>>>): Promise<string[]> {
  const dirs: Record<string, Record<string, string>> = {};
  const read = async ([path, load]: [string, () => Promise<string>]) => {
    const [dir, file] = path.split('/').slice(-2);
    (dirs[dir] ??= {})[file] = await load();
  };
  await Promise.all(Object.entries(files).map(read));
  const ids = Object.keys(dirs)
    .sort()
    .map((dir) => defineClipSet(clipSetFromFiles(dirs[dir], `data/anim/sets/${dir}`)).id);
  defineMannequin(getClipSet('clipset:quaternius'));
  return ids;
}

/** Registers the mannequin, its build and body, from the Quaternius set's `_set.json` text (the page's `?raw`). */
export function loadMannequin(text: string): void {
  defineMannequin(JSON.parse(text) as Parameters<typeof defineMannequin>[0]);
}

/**
 * Registers the clip `name` from its edited `text` as the set `set` of its own, with the sources of the set `from`
 * (`clipset:cmu`), and returns the clip's path to play (`lab1/<name>`). Throws what `parseClip` throws for bad text.
 */
export function registerEdit(set: string, from: string, name: string, text: string): string {
  defineClipSet({ set, sources: getClipSet(from).sources, clips: { [name]: parseClip(text, name) } });
  return `${set.toLowerCase()}/${name}`;
}
