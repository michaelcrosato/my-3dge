/**
 * @file The animation library in Node (PLAN.md §10, WP 8.9): `defineLibrary()` registers every set of
 * `data/anim/sets/` as a `clipset` entry, joined from its files as the box page joins them (`clipSetFromFiles`,
 * engine/anim/clip/clipsets.ts; labs/box/library.ts `loadLibrary`), sorted by directory, then the mannequin, its build
 * and body, from the Quaternius set (engine/gfx/puppets/bodies/mannequin.ts). The sim reads no files, so the Node hosts
 * that run scenes call it before they load one, as the box page does before clip mode (labs/box/scenes/clips.ts):
 * `x sim` and `x perf` (tools/lib/scenes.ts `loadScene`), `x replay`'s Node runtime (`nodeRuntime`), `x describe`'s
 * listing, and tests/e2e/parity.spec.ts, which replays clip mode's live play in Node. The other scenes never read the
 * sets, so registering them changes no other hash.
 *
 * Invariants: the registry ends with the page's entries (the same sets, ids and clips; `clipSetIds` the same order),
 * so a replay of clip mode gives one set of goldens in Node, in tests/pages/replay.html and in the box page. Reading
 * and parsing the library takes about a second, so a registry gets it once: a second call returns the ids again.
 *
 * @example
 * import { getClipSet } from '../../engine/anim/clip/clipsets';
 * libraryDirs().length; // 10: cmu, mesh2motion, quaternius, style100 and its six gaits
 * defineLibrary(); // ['clipset:cmu', 'clipset:mesh2motion', 'clipset:quaternius', 'clipset:style100', …]
 * getClipSet('clipset:quaternius').clips.Sword_Attack.dur; // 1.533, as x anim show quaternius/Sword_Attack prints it
 * @see tools/anim/library.test.ts
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { clipSetFromFiles, clipSetIds, defineClipSet, getClipSet } from '../../engine/anim/clip/clipsets';
import { registry as sharedRegistry, type Registry } from '../../engine/core/registry';
import { defineMannequin } from '../../engine/gfx/puppets/bodies/mannequin';
import { readSetDir, SET_FILE, SETS_DIR } from './repack';

/** The registries the library is in already. */
const defined = new WeakSet<Registry>();

/** The library's set directories (`cmu`, `quaternius`…): each directory of `root` with a set header, sorted. */
export function libraryDirs(root: string = SETS_DIR): string[] {
  return readdirSync(root)
    .filter((dir) => existsSync(join(root, dir, SET_FILE)))
    .sort();
}

/** Registers every set of the library, then the mannequin, into `registry` (once); returns the sets' ids. */
export function defineLibrary(registry: Registry = sharedRegistry): string[] {
  if (defined.has(registry)) return clipSetIds(registry);
  for (const dir of libraryDirs()) {
    defineClipSet(clipSetFromFiles(readSetDir(join(SETS_DIR, dir)), `data/anim/sets/${dir}`), { registry });
  }
  defineMannequin(getClipSet('clipset:quaternius', registry), { registry });
  defined.add(registry);
  return clipSetIds(registry);
}
