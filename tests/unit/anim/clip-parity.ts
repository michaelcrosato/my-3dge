/**
 * @file The library's FK parity, measured for the baker's and the mannequin's tests (WP 8.4): every clip of every set
 * in `data/anim/sets/`, baked, played back and run through FK, against the format-1 decode (readable.ts), at 30
 * frames a second and at the 60 Hz midpoints between them. The numbers and the worst cases are recorded in
 * tests/baselines/anim-clips.json (`ANIM_CLIPS_BASELINE=write` rewrites it, with a reason in the commit).
 *
 * Two measures. `restParity`: the baked pose on the rest body's own skeleton (retarget.ts `restSkeleton`) against the
 * decode, over 34 points; index and pinky are left out, since the decode places them 2 cm either side of the fist
 * along the chest's right axis or the blade whatever way the hand points, so no rotation of the hand can hold them
 * (the hand's roll is checked instead, as the across direction made perpendicular to the forearm). `buildParity`: the
 * clip layer's pose on a build (the mannequin's) against the decode scaled by the hip-height ratio, over the 20
 * points a build's joints stand for.
 *
 * @example
 * const stats = restParity('quaternius'); // { clips: 103, samples: …, mean: 0.378, worst: { clip, t, point, mm } … }
 * @see engine/anim/clip/bake.test.ts
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bakeClip, sampleBaked } from '../../../engine/anim/clip/bake';
import { decodePose, keyAt, POINT_INDEX, POSE_POINTS } from '../../../engine/anim/clip/readable';
import { hipRatio, restPoints, restSkeleton, retargetPose } from '../../../engine/anim/clip/retarget';
import type { ClipSet } from '../../../engine/anim/clip/validate';
import { createWorldPose, forwardKinematics, jointPosition } from '../../../engine/anim/fk';
import { Pose } from '../../../engine/anim/pose';
import type { JointName, Skeleton } from '../../../engine/anim/skeleton';
import { Vector3 } from '../../../engine/core/math';
import { readSet, SETS_DIR } from '../../../tools/anim/repack';

/** Every set's directory under data/anim/sets/, sorted. */
export const SET_DIRS = readdirSync(SETS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const sets = new Map<string, ClipSet>();
/** The set in `dir`, joined once. */
export function setOf(dir: string): ClipSet {
  let set = sets.get(dir);
  if (!set) sets.set(dir, (set = readSet(dir)));
  return set;
}

/** A sample where two poses differ: the clip, the time, the point, by how much (mm). */
export interface Case {
  clip: string;
  t: number;
  point: string;
  mm: number;
}

/** One set's parity: how many clips and samples, the mean (mm), the worst sample, and the five worst clips. */
export interface Parity {
  clips: number;
  samples: number;
  mean: number;
  worst: Case;
  worstClips: Case[];
}

/** Sample times of a clip: 30 a second and the 60 Hz midpoints, as far as its length. */
const timesOf = (dur: number) => Array.from({ length: Math.floor(dur * 60 + 1e-9) + 1 }, (_, k) => k / 60);

/** Runs `measure(clip, t, decoded)` over every sample of every clip in `dir`; it returns (point, mm) pairs. */
function scan(
  dir: string,
  measure: (name: string, t: number, decoded: Float64Array) => Iterable<[string, number]>,
): Parity {
  const set = setOf(dir);
  const decoded = new Float64Array(108);
  let [sum, n] = [0, 0];
  const worstOf: Case[] = [];
  for (const [name, clip] of Object.entries(set.clips)) {
    const R = set.sources![clip.src!].rest;
    let worst: Case = { clip: name, t: 0, point: '', mm: -1 };
    for (const t of timesOf(clip.dur)) {
      decodePose(R, keyAt(clip, t), decoded);
      for (const [point, mm] of measure(name, t, decoded)) {
        [sum, n] = [sum + mm, n + 1];
        if (mm > worst.mm) worst = { clip: name, t, point, mm };
      }
    }
    worstOf.push(worst);
  }
  worstOf.sort((a, b) => b.mm - a.mm);
  const round = (c: Case): Case => ({ ...c, t: +c.t.toFixed(3), mm: +c.mm.toFixed(1) });
  return {
    clips: worstOf.length,
    samples: n,
    mean: +(sum / n).toFixed(3),
    worst: round(worstOf[0]),
    worstClips: worstOf.slice(0, 5).map(round),
  };
}

const RIGID = POSE_POINTS.filter((p) => !p.startsWith('index') && !p.startsWith('pinky'));

/** The baked pose on the rest skeleton against the decode (see the file comment). */
export function restParity(dir: string): Parity {
  const set = setOf(dir);
  const [pose, world, hips, points] = [new Pose(), createWorldPose(), new Vector3(), new Float64Array(108)];
  const bakes = new Map<string, ReturnType<typeof bakeClip>>();
  return scan(dir, function* (name, t, decoded) {
    const clip = set.clips[name];
    const R = set.sources![clip.src!].rest;
    let baked = bakes.get(name);
    if (!baked) bakes.set(name, (baked = bakeClip(clip, R, name)));
    const skeleton = restSkeleton(R);
    sampleBaked(baked, t, pose.local, hips);
    pose.rootPos.copy(hips).sub(new Vector3().fromArray(skeleton.offsets, 0));
    restPoints(R, forwardKinematics(skeleton, pose, world), points);
    for (const p of RIGID) {
      const i = POINT_INDEX[p] * 3;
      yield [p, Math.hypot(points[i] - decoded[i], points[i + 1] - decoded[i + 1], points[i + 2] - decoded[i + 2])];
    }
  });
}

/** The decode points a build's joints stand for. */
export const BUILD_POINTS: readonly [JointName, string][] = [
  ...(['pelvis', 'spine1', 'spine2', 'chest', 'neck', 'head'] as const).map((j): [JointName, string] => [j, j]),
  ...(['L', 'R'] as const).flatMap((s): [JointName, string][] => [
    [`clavicle${s}`, `clav${s}`],
    [`upperArm${s}`, `sh${s}`],
    [`forearm${s}`, `elbow${s}`],
    [`hand${s}`, `wrist${s}`],
    [`thigh${s}`, `hip${s}`],
    [`shin${s}`, `knee${s}`],
    [`foot${s}`, `ankle${s}`],
    [`toe${s}`, `ball${s}`],
  ]),
];

/** The retargeted pose (rotation copy, contact IK, lift) on `skeleton` against the decode scaled by the ratio. */
export function buildParity(dir: string, skeleton: Skeleton): Parity {
  const set = setOf(dir);
  const [pose, world, at] = [new Pose(), createWorldPose(), new Vector3()];
  const bakes = new Map<string, ReturnType<typeof bakeClip>>();
  return scan(dir, function* (name, t, decoded) {
    const clip = set.clips[name];
    let baked = bakes.get(name);
    if (!baked) bakes.set(name, (baked = bakeClip(clip, set.sources![clip.src!].rest, name)));
    const ratio = hipRatio(baked, skeleton);
    retargetPose(baked, t, skeleton, pose, { world });
    for (const [joint, p] of BUILD_POINTS) {
      jointPosition(world, joint, at);
      const i = POINT_INDEX[p] * 3;
      const [f, r, u] = [decoded[i] * ratio, decoded[i + 1] * ratio, decoded[i + 2] * ratio];
      yield [p, Math.hypot(at.z * 1000 - f, -at.x * 1000 - r, at.y * 1000 - u)];
    }
  });
}

/** The baseline file. */
export const BASELINE = join(import.meta.dirname, '../../baselines/anim-clips.json');

/** A section of the baseline: why its numbers are accepted, and each set's. */
export interface BaselineSection {
  reason: string;
  sets: Record<string, Parity>;
}

/** The recorded baseline (an empty one before the first write). */
export function readBaseline(): Record<string, BaselineSection> {
  try {
    return JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, BaselineSection>;
  } catch {
    return {};
  }
}

/** Whether this run rewrites the baseline (`ANIM_CLIPS_BASELINE=write`). */
export const WRITING = process.env.ANIM_CLIPS_BASELINE === 'write';

/** Writes `section` of the baseline (call it only when `WRITING`). */
export function writeBaseline(section: string, sets: Record<string, Parity>, reason: string): void {
  const all = { ...readBaseline(), [section]: { reason, sets } };
  // one line a case, as Prettier keeps them
  const text = JSON.stringify(all, null, 2).replace(/\{\n\s+("clip": [^\n]+)\n\s+("t": [^\n]+)\n\s+("point": [^\n]+)\n\s+("mm": [^\n]+)\n\s+\}/g, '{ $1 $2 $3 $4 }'); // prettier-ignore
  writeFileSync(BASELINE, `${text}\n`);
}
