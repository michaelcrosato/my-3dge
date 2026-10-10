/**
 * @file Shared fixtures for the clip codec's tests (engine/anim/clip/*.test.ts, WP 8.2): a measured rest body, a
 * standing key pose and a clip builder for the offline tests, and, for those that need the my-3d2dge checkout, the
 * source's codec (the oracle) with its curated sets, loaded once per test file.
 *
 * Invariants: the rest body is the source's `QUATERNIUS` set's `UAL1` rest, copied as data (it is symmetric: L and R
 * mirror each other), so the offline tests decode on a real body without the source.
 *
 * @example
 * import { samplePose } from '../../../engine/anim/clip/readable';
 * const clip = clipOf([standing(0), { ...standing(1), hips: [0, 0, 80] }]);
 * samplePose(REST, clip, 0.5)[2]; // 825.03: the pelvis at 90% of REST.H0
 * @see engine/anim/clip/readable.test.ts
 */
import type { Clip, ClipKey } from '../../../engine/anim/clip/readable';
import type { RestBody } from '../../../engine/anim/clip/validate';
import {
  CURATED_SETS,
  loadLegacyReadable,
  readLegacySet,
  type LegacyReadable,
  type LegacySet,
} from '../../../tools/anim/legacy-readable';
import { requireSource, type SkippableTest } from '../../../tools/lib/source';

/** The source's `QUATERNIUS` `UAL1` rest body (mm, degrees). */
export const REST: RestBody = {
  H0: 916.7,
  hipZ: 932.1,
  ankleZ: 103.7,
  Pr: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  Cr: [
    [0.99948, 0, 0.03239],
    [0, 1, 0],
    [-0.03239, 0, 0.99948],
  ],
  Hr: [
    [0.99947, 0, -0.03252],
    [0, 1, 0],
    [0.03252, 0, 0.99947],
  ],
  hip: { L: [51.5, -89, 15.4], R: [51.5, 89, 15.4] },
  spine: [
    [34.5, 0, 133.8],
    [15.2, 0, 123.1],
    [-4.5, 0, 141.2],
    [-5.6, 0, 172.8],
  ],
  neckSeg: [15.6, 0, 81.1],
  clav: { L: [80.9, -18.8, -32.3], R: [80.9, 18.8, -32.3] },
  cv: { L: [-137.3, -173.1, -12.7], R: [-137.3, 173.1, -12.7] },
  topH: [0, 0, 256],
  faceH: [119.9, 0, 3.9],
  ...{ up: 274.44, fore: 272.64, knuck: 121.71, fist: 163.93, thigh: 400.31, shin: 429.48 },
  ...{ ab: 173.3, bt: 92.24, abPitch: 30.71, btPitch: 0, spineW: [0, 0, 0.25, 1], neckW: 0.45 },
};

/** A standing key at `t`: hips at standing height, everything upright, arms and legs hanging straight down. */
export const standing = (t: number): ClipKey => ({
  t,
  hips: [0, 0, 100],
  body: [0, 0, 0],
  chest: [0, 0, 0],
  head: [0, 0, 0],
  armL: [0, 0, -100, 0, 0],
  armR: [0, 0, -100, 0, 0],
  legL: [0, 0, -100, 0, 0],
  legR: [0, 0, -100, 0, 0],
});

/** A clip of `keys`, its length the last key's time unless `header` says otherwise. */
export const clipOf = (keys: ClipKey[], header: Partial<Clip> = {}): Clip => ({
  clip: 'Test',
  dur: keys[keys.length - 1].t,
  ...header,
  keys,
});

/** A key that exercises most of format 1: a lean, a turn, a punch, a bent knee, pointed feet and a blade. */
export const busy = (t: number): ClipKey => ({
  t,
  hips: [5, -3, 92],
  body: [20, 12, -6],
  chest: [-15, 25, 8],
  head: [30, -10, 4],
  shL: [12, 9],
  shR: [-20, 15],
  armL: [40, 60, -50, 90, 30],
  armR: [100, -10, 20, 15, -45],
  legL: [30, 20, -90, 60, 15],
  legR: [-20, 5, -100, 10, -20],
  footL: [25, 10, 15],
  footR: [-10, -5, 0],
  blade: [80, 10, 55],
});

/** The source's codec and its curated sets, loaded once. */
let loaded: { MR: LegacyReadable; sets: Record<string, LegacySet> } | undefined;

/** The oracle and the curated sets from the my-3d2dge checkout; the test is deferred (skipped) without it. */
export function legacy(test: SkippableTest): { source: string; MR: LegacyReadable; sets: Record<string, LegacySet> } {
  const source = requireSource('my-3d2dge', test);
  loaded ??= {
    MR: loadLegacyReadable(source),
    sets: Object.fromEntries(CURATED_SETS.map((name) => [name, readLegacySet(source, name)])),
  };
  return { source, ...loaded };
}

/** Every curated clip as `[set, name, clip, rest]`, for loops over the library. */
export function curatedClips(sets: Record<string, LegacySet>): [string, string, Clip, RestBody][] {
  return Object.entries(sets).flatMap(([setName, set]) =>
    Object.entries(set.clips).map(([name, clip]): [string, string, Clip, RestBody] => [
      setName,
      name,
      clip as unknown as Clip,
      set.sources[clip.src].rest as RestBody,
    ]),
  );
}
