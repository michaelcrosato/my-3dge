/**
 * @file The re-import's sources (PLAN.md §10, WP 8.8): where each set's originals come from, whether this repository
 * can reach them, and the fetch of Mesh2Motion's three `.glb` files into `.cache/anim/mesh2motion/` (never committed),
 * each at a pinned commit and checked against its sha256, through `curl` (tools/anim/zip.ts `fetchBytes`), which
 * follows the environment's proxy.
 *
 * - `mesh2motion`: the three files at Mesh2Motion/mesh2motion-app@653a969 on raw.githubusercontent.com (the
 *   repository's API and archives are not reachable here, its raw files are);
 * - `cmu`: the takes its catalog picks, fetched by range requests from the CMU archive as the importer reads them
 *   (tools/anim/cmu.ts `cmuGet`, `.cache/anim/cmu/`);
 * - `quaternius`: the four GLBs of the Universal Animation Library 2, which the owner supplies (ESC-0003): blocked;
 * - the 100STYLE sets: left out of the re-import until a defect touches them (WP 8.8's Done-when).
 *
 * @example
 * SET_SOURCES.quaternius.status; // 'blocked'
 * MESH2MOTION.commit.slice(0, 7); // '653a969'
 * // fetchMesh2Motion(root) puts the three files in .cache/anim/mesh2motion/ (online), once each
 * @see tools/anim/upgrade.test.ts
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchBytes } from './zip';

/** Whether a set's originals can be re-imported here, and why not when they cannot. */
export interface SetSource {
  status: 'available' | 'blocked' | 'out';
  why: string;
}

/** Every set's originals (a set not named here has none to re-import). */
export const SET_SOURCES: Record<string, SetSource> = {
  mesh2motion: { status: 'available', why: 'its three .glb files, fetched at a pinned commit (x anim fetch)' },
  cmu: { status: 'available', why: "its catalog's picks, fetched from the CMU archive by range requests" },
  quaternius: {
    status: 'blocked',
    why: 'the four GLBs of the Universal Animation Library 2 are the owner’s to supply (ESC-0003)',
  },
  ...Object.fromEntries(
    ['style100', 'style100_back', 'style100_backrun', 'style100_idle', 'style100_run', 'style100_side', 'style100_siderun'].map((set) => [set, { status: 'out', why: "100STYLE's sets wait for a defect that touches them (WP 8.8)" } as SetSource]), // prettier-ignore
  ),
};

/** Mesh2Motion's commit and its three files' sha256. */
export const MESH2MOTION = {
  repo: 'Mesh2Motion/mesh2motion-app',
  commit: '653a9698f5f315523072f1c3ff3496100401317b',
  files: {
    'human-base-animations.glb': '406eb0a8dc4ab366e623b79b6e3005a4951392e1bda78ae39c1099d31147733c',
    'human-addon-animations.glb': 'a0d64d555e0d492026b72d58bf8e16c5e86779295f9093e376dcc001915c2c95',
    'human-mocap-animations.glb': '814593d62522f5be8d6bd32df2a8fa3c7feb90a8e1a1ba43f4aaf0048555280d',
  } as Record<string, string>,
};

/** Where `x anim fetch` keeps Mesh2Motion's files. */
export const MESH2MOTION_CACHE = '.cache/anim/mesh2motion';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/**
 * Mesh2Motion's three files in `dir` (from the repository root `root`), fetched when missing or changed; each is
 * checked against its sha256, and a file that does not match is an error naming it and the fix.
 */
export function fetchMesh2Motion(root: string, dir = MESH2MOTION_CACHE, get = fetchBytes): string[] {
  mkdirSync(join(root, dir), { recursive: true });
  return Object.entries(MESH2MOTION.files).map(([file, want]) => {
    const path = join(root, dir, file);
    if (!existsSync(path) || sha256(readFileSync(path)) !== want) {
      const url = `https://raw.githubusercontent.com/${MESH2MOTION.repo}/${MESH2MOTION.commit}/static/animations/${file}`;
      const bytes = get(url);
      const got = sha256(bytes);
      if (got !== want)
        throw new Error(
          `${url} has sha256 ${got}, not ${want}: the file changed; check the commit in tools/anim/fetch.ts`,
        );
      writeFileSync(path, bytes);
    }
    return join(dir, file);
  });
}
