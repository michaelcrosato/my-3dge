/**
 * @file The `anim` QA family's clips (PLAN.md §8.6 and §10, WP 8.6, I-13, I-29): every clip of the library under
 * `data/anim/sets/`, checked as data and as played, for tools/qa/anim.ts. Ids are `clip:<SET>/<Clip>`, and `set:<SET>`
 * for a set's own number; accepted exceptions go in tests/baselines/qa-anim-library.json, each with its reason.
 *
 * As data (`CLIP_DATA_METRICS`; cheap, so T1 checks every clip):
 * - `fitMean`, `fitWorst` (mm): the import's fit against the capture (`_set.json`'s `fit`) past a clip's limits,
 *   `CLIP_QA.fit` (`my-3d2dge:tools/mocap-test.mjs`: 40 mm on average, 300 at worst); for a `set:` id, `fitMean`
 *   is the set's average past 20 mm;
 * - the validator's warnings (engine/anim/clip/validate.ts `validateClip`), one metric per code, valued by the worst
 *   key and told in the validator's words: `limbCollapse` (radians a limb turns between keys), `twistPop` (radians
 *   a folded limb's twist jumps), `kneeRange` (radians outside the knee's range), `angleRange` (the largest stored
 *   angle past ±540°, radians) and `belowFloor` (metres the hips sink under the floor, on the clip's own rest body);
 * - `loopClosure` (metres): a loop's last key against its first, decoded on its rest body: the jump at its seam.
 *
 * As played (`CLIP_PLAY_METRICS`): the clip layer (engine/anim/clip/layer.ts) plays the clip at once, with no fade
 * and no rest before or after, in an animator of each build of `HUMANOIDS` and of the mannequin (`build:mannequin`,
 * the Quaternius set's rest body), through the state matrix (engine/anim/check.ts) at one facing (a clip plays in the
 * body's frame, so a turn changes no number): a one-shot to its end, holding it; a loop a quarter second past its seam.
 * Then `animCheckBody`'s checks (`nan`, `stretch`, `underFloor`, `reach`; on the first build, the run again
 * (`unstableHash`) and at half the step (`rateDrift`)), and `pop`, `jointLimit` and `twistJump` as the family
 * measures every body. Foot slide waits for format 2's `contacts` (WP 8.8): an in-place loop's feet slide over the
 * floor by design, and nothing else says when a foot should hold.
 *
 * Invariants: sets in directory order, clips in set order, builds in `clipBuilds` order, so the same tree gives the
 * same violations; `play` picks the clips to play (all that `keep` keeps by default; T1 plays a sample).
 *
 * @example
 * import { ROOT } from '../../x';
 * clipViolations(ROOT, (id) => id === 'clip:CMU/Walk_Loop'); // []: the CMU walk plays clean on every build
 * CLIP_DATA_METRICS.has('fitMean'); // true
 * @see tests/unit/data/anim/qa.test.ts
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getBuild } from '../../../engine/anim/builds';
import { Animator } from '../../../engine/anim/character';
import { animCheckBody, RUN_POINTS, runPoints, STATE_MATRIX, type AnimCheckName } from '../../../engine/anim/check';
import type { MatrixState } from '../../../engine/anim/check';
import { ClipLayer } from '../../../engine/anim/clip/layer';
import { ANGLE_ENTRIES, foldAngle } from '../../../engine/anim/clip/lens';
import { loadClipLibrary, type ClipLibrary } from '../../../engine/anim/clip/library';
import { decodePose, type Clip, type ClipKey } from '../../../engine/anim/clip/readable';
import { poseError, validateClip, type ClipCode, type ClipSet } from '../../../engine/anim/clip/validate';
import { defineMannequin } from '../../../engine/gfx/puppets/bodies/mannequin';
import { readSet } from '../../anim/repack';
import type { QaViolation } from '../../cmd/qa';
import { ANIM_QA, HUMANOIDS, limbs, motionTrack, pops, type Found } from '../anim';

/** The limits: a clip's fit (mean and worst) and a set's mean fit, mm; the seconds a loop plays past its seam. */
export const CLIP_QA = { fit: { mean: 40, worst: 300, set: 20 }, seam: 0.25 } as const;

/** The metrics measured on the data, every clip's in T1. */
export const CLIP_DATA_METRICS: ReadonlySet<string> = new Set(['fitMean', 'fitWorst', 'limbCollapse', 'twistPop', 'kneeRange', 'angleRange', 'belowFloor', 'loopClosure']); // prettier-ignore
/** The metrics measured by playing a clip. */
export const CLIP_PLAY_METRICS: ReadonlySet<string> = new Set(['nan', 'stretch', 'underFloor', 'reach', 'unstableHash', 'rateDrift', 'pop', 'jointLimit', 'twistJump']); // prettier-ignore

/** The metric each validator warning reports as. */
const WARNING_METRIC: Partial<Record<ClipCode, string>> = {
  ANIM_CLIP_LIMB_COLLAPSE: 'limbCollapse',
  ANIM_CLIP_TWIST_POP: 'twistPop',
  ANIM_CLIP_KNEE_RANGE: 'kneeRange',
  ANIM_CLIP_ANGLE_RANGE: 'angleRange',
  ANIM_CLIP_BELOW_FLOOR: 'belowFloor',
};
/** The metric each of `animCheckBody`'s checks reports as (tools/qa/anim.ts's names). */
const CHECK_METRIC: Readonly<Record<AnimCheckName, string>> = {
  ...{ finite: 'nan', length: 'stretch', rigid: 'stretch', floor: 'underFloor' },
  ...{ reach: 'reach', hash: 'unstableHash', rate: 'rateDrift' },
};
const DEG = Math.PI / 180;

/** Adds a finding to the violations, keeping the worst per id and metric. */
export type ClipReport = (id: string, metric: string, found: Found) => void;

/** The sets under `<root>/data/anim/sets/`, in directory order. */
export function librarySets(root: string): ClipSet[] {
  const dir = join(root, 'data', 'anim', 'sets');
  const sets = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  return sets.map((entry) => entry.name).sort().map((name) => readSet(name, dir)); // prettier-ignore
}

/** The builds every clip plays on: each of `HUMANOIDS`, and the mannequin, registered from `quaternius` once. */
export function clipBuilds(sets: readonly ClipSet[]): string[] {
  const quaternius = sets.find((set) => set.set === 'QUATERNIUS');
  if (quaternius) defineMannequin(quaternius);
  return [...HUMANOIDS.map((body) => body.build), ...(quaternius ? ['build:mannequin'] : [])];
}

/** What a validator warning measures (see the file comment), from the keys it names. */
function warningValue(clip: Clip, code: ClipCode, at: number, field: string, H0: number): number {
  const [key, next] = [clip.keys[at - 1], clip.keys[at]] as unknown as Record<string, number[]>[];
  const limb = key[field] ?? [];
  if (code === 'ANIM_CLIP_BELOW_FLOOR') return ((-key.hips[2] / 100) * H0) / 1000;
  if (code === 'ANIM_CLIP_TWIST_POP') return Math.abs(next[field][4] - limb[4]) * DEG;
  if (code === 'ANIM_CLIP_ANGLE_RANGE') {
    const values = (ANGLE_ENTRIES[field as keyof ClipKey] ?? []).map((i) => Math.abs([key[field]].flat()[i] ?? 0));
    return Math.max(...values) * DEG;
  }
  if (code === 'ANIM_CLIP_KNEE_RANGE') {
    const [bend, twist] = [limb[3], limb[4]];
    return (bend < 0 ? -bend : bend > 165 ? bend - 165 : Math.abs(foldAngle(twist)) - 120) * DEG;
  }
  const [a, b] = [limb.slice(0, 3), next[field].slice(0, 3)];
  const cos = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b) || 1);
  return Math.acos(Math.max(-1, Math.min(1, cos))); // ANIM_CLIP_LIMB_COLLAPSE: the turn between the keys
}

/** The data checks of every clip of `set` that `keep` keeps, and of the set itself (see the file comment). */
export function clipDataFindings(set: ClipSet, keep: (id: string) => boolean, report: ClipReport): void {
  const { mean, worst, set: setMean } = CLIP_QA.fit;
  const fits = Object.values(set.fit ?? {});
  const average = fits.reduce((sum, fit) => sum + fit[0], 0) / Math.max(1, fits.length);
  const fix = 'format 1 misses this capture (a hard-bent wrist, a curled spine): re-import it in format 2 (WP 8.8)';
  if (keep(`set:${set.set}`) && average > setMean) {
    report(`set:${set.set}`, 'fitMean', { value: average, message: `${set.set}: its clips stray ${average.toFixed(1)} mm from their captures on average (over ${setMean}); ${fix}` }); // prettier-ignore
  }
  const points = [new Float64Array(108), new Float64Array(108)];
  for (const [name, clip] of Object.entries(set.clips)) {
    const id = `clip:${set.set}/${name}`;
    if (!keep(id)) continue;
    const [m, w] = set.fit?.[name] ?? [0, 0];
    const strays = `${set.set}/${name} strays ${m} mm from its capture on average, ${w} at worst`;
    if (m > mean) report(id, 'fitMean', { value: m, message: `${strays} (over ${mean} on average); ${fix}` });
    if (w > worst) report(id, 'fitWorst', { value: w, message: `${strays} (over ${worst} at worst); ${fix}` });
    const rest = set.sources?.[clip.src ?? '']?.rest;
    if (!rest) continue; // a clip without its rest body is the provenance tests' to report
    for (const warning of validateClip(clip, `${set.set}/${name}`)) {
      const metric = WARNING_METRIC[warning.code] ?? warning.code;
      const value = warningValue(clip, warning.code, warning.key, warning.field, rest.H0);
      report(id, metric, { value, message: warning.message });
    }
    if (!clip.loop) continue;
    const [last, first] = [clip.keys[clip.keys.length - 1], clip.keys[0]];
    const seam = poseError(decodePose(rest, last, points[0]), decodePose(rest, first, points[1])) / 1000;
    if (seam > ANIM_QA.closure) {
      report(id, 'loopClosure', { value: seam, message: `${set.set}/${name}: its last key (t ${last.t}) is ${seam.toFixed(3)} m from its first, so the loop jumps at its seam; end it on its first pose` }); // prettier-ignore
    }
  }
}

/** Clip `name` of `library` as a state of the matrix: played at once, a one-shot held at its end. */
export function clipState(library: ClipLibrary, name: string): MatrixState {
  const clip = library.clip(name);
  return {
    seconds: clip.dur + (clip.loop ? CLIP_QA.seam : 0),
    script(animator) {
      const layer = new ClipLayer({ library, build: animator.body.build, dt: animator.body.dt });
      animator.use('clips', layer);
      layer.play(`${library.name}/${name}`, { fade: 0, hold: true });
      return () => {
        layer.step({ groundSpeed: 0 });
        return {};
      };
    },
  };
}

/** The played checks of clip `name` on each build, the first also run again and at half the step. */
export function clipPlayFindings(
  library: ClipLibrary,
  name: string,
  builds: readonly string[],
  report: ClipReport,
): void {
  const id = `clip:${library.name}/${name}`;
  builds.forEach((build, i) => {
    const make = (dt: number) => new Animator({ build, clock: 1, dt });
    const where = `${build}, ${library.name}/${name}`;
    const options = { states: { [id]: clipState(library, name) }, facings: [0], lead: 0, after: 0 };
    const result = animCheckBody(make, { ...options, hash: i === 0, rate: i === 0 ? STATE_MATRIX.rate : false });
    for (const p of result.problems) {
      report(id, CHECK_METRIC[p.check], { value: Number.isNaN(p.worst) ? 1 : p.worst, message: `${where}: ${p.message}` }); // prettier-ignore
    }
    const size = getBuild(build).size;
    for (const run of result.runs) {
      const world = runPoints(run).map((points, k) => points.map((p) => p.add(run.positions[k])));
      const { dt, positions } = run;
      report(id, 'pop', pops(motionTrack({ where, size, dt, names: RUN_POINTS, world, positions })));
      const { limit, twist } = limbs(run, where);
      report(id, 'jointLimit', limit);
      report(id, 'twistJump', twist);
    }
  });
}

/**
 * Every violation of the library's clips and sets whose ids `keep` keeps, the worst per id and metric, in id order;
 * only the clips `play` picks are played (see the file comment).
 */
export function clipViolations(
  root: string,
  keep: (id: string) => boolean = () => true,
  play: (id: string) => boolean = keep,
): QaViolation[] {
  const found = new Map<string, QaViolation>();
  const report: ClipReport = (id, metric, value) => {
    const key = `${id}\u0000${metric}`;
    if (value && value.value > (found.get(key)?.value ?? -Infinity)) {
      found.set(key, { id, metric, value: Math.round(value.value * 1e4) / 1e4, message: value.message });
    }
  };
  const sets = librarySets(root);
  const builds = clipBuilds(sets);
  for (const set of sets) {
    clipDataFindings(set, keep, report);
    const names = Object.keys(set.clips).filter((name) => keep(`clip:${set.set}/${name}`) && play(`clip:${set.set}/${name}`)); // prettier-ignore
    if (names.length === 0) continue;
    const library = loadClipLibrary(set);
    for (const name of names) clipPlayFindings(library, name, builds, report);
  }
  return [...found.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.metric < b.metric ? -1 : 1));
}
