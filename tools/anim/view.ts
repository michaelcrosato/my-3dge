/**
 * @file One clip of the library, looked at without a browser (PLAN.md §10.3 and §10.4, WP 8.5): `resolveClip` finds
 * `<set>/<clip>` (or a clip name only one set has) in `data/anim/sets/`; `bakeReport` bakes it on its own source's
 * rest body (engine/anim/clip/bake.ts) and measures FK parity against the format-1 decode at every frame and the
 * midpoints between; `clipSheet` draws it as a contact sheet of stick figures in SVG (engine/anim/sheet.ts). `x anim
 * show`, `bake` and `sheet` print them.
 *
 * Invariants: parity is over the 34 rigid points (index and pinky only aim the hand), in mm, as the baker's tests
 * measure it; a sheet's frames are spread evenly over the clip (a loop's last, its first again, left out), each
 * labelled with its time.
 *
 * @example
 * const ref = resolveClip('cmu/Walk_Loop');
 * [ref.set, ref.clip.keys.length > 5]; // ['cmu', true]
 * const report = bakeReport(ref);
 * [report.baked.frames, report.parity.mean < 1]; // [34, true]
 * clipSheet(ref, { frames: 4 }).svg.startsWith('<svg'); // true
 * @see tools/anim/view.test.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Vector3 } from 'three';
import { bakeClip, sampleBaked, type BakedClip } from '../../engine/anim/clip/bake';
import { POSE_POINTS, samplePose, type Clip } from '../../engine/anim/clip/readable';
import { restPoints, restSkeleton } from '../../engine/anim/clip/retarget';
import { parseClip, type ClipSet, type RestBody } from '../../engine/anim/clip/validate';
import { createWorldPose, forwardKinematics } from '../../engine/anim/fk';
import { Pose } from '../../engine/anim/pose';
import { animSheet, type Sheet, type SheetView } from '../../engine/anim/sheet';
import { catalogRows } from './find';
import { clipSlug, SET_FILE, SETS_DIR } from './repack';

/** A clip found in the library: its set's directory and header, its name, the clip and its rest body. */
export interface ClipRef {
  set: string;
  name: string;
  clip: Clip;
  rest: RestBody;
  header: Omit<ClipSet, 'clips'>;
}

/** Finds `<set>/<clip>`, or a clip name only one set has; errors name the closest choices. */
export function resolveClip(ref: string, setsDir: string = SETS_DIR): ClipRef {
  const [given, name] = ref.includes('/') ? (ref.split('/', 2) as [string, string]) : ['', ref];
  let set = given;
  if (!set) {
    const owners = catalogRows(setsDir).filter(({ row }) => row.name === name);
    if (owners.length !== 1) {
      const why = owners.length ? `is in ${owners.map((o) => o.set).join(' and ')}` : 'is in no set';
      throw new Error(`${name} ${why}: name it as <set>/${name} (x anim find ${name} lists the clips)`);
    }
    set = owners[0].set;
  }
  const file = join(setsDir, set, `${clipSlug(name)}.json`);
  if (!existsSync(join(setsDir, set, SET_FILE)))
    throw new Error(`no set ${set} in data/anim/sets/: x anim find lists the sets`);
  if (!existsSync(file)) throw new Error(`no clip ${name} in ${set}: x anim find ${name} lists the clips`);
  const clip = parseClip(readFileSync(file, 'utf8'), `${set}/${name}`);
  const header = JSON.parse(readFileSync(join(setsDir, set, SET_FILE), 'utf8')) as Omit<ClipSet, 'clips'>;
  const rest = header.sources?.[clip.src ?? '']?.rest;
  if (!rest) throw new Error(`${set}/${name}: its source ${clip.src} has no rest body in ${set}/${SET_FILE}`);
  return { set, name: clip.clip ?? name, clip, rest, header };
}

/** The 36 decode points of `baked` at `t`, by FK on its rest body's own skeleton (mm, rig frame). */
export function bakedPoints(baked: BakedClip, t: number, out = new Float64Array(108)): Float64Array {
  const [pose, hips, skeleton] = [new Pose(), new Vector3(), restSkeleton(baked.rest)];
  sampleBaked(baked, t, pose.local, hips);
  pose.rootPos.copy(hips).sub(new Vector3().fromArray(skeleton.offsets, 0));
  return restPoints(baked.rest, forwardKinematics(skeleton, pose, createWorldPose()), out);
}

/** A baked clip, its tracks' size in bytes and its FK parity with the decode (mean and worst, mm). */
export function bakeReport(ref: ClipRef) {
  const baked = bakeClip(ref.clip, ref.rest, ref.name);
  const bytes =
    baked.rotations.byteLength + baked.hips.byteLength + (baked.root?.byteLength ?? 0) + baked.times.byteLength;
  const rigid = POSE_POINTS.map((p, i) => (/^(index|pinky)/.test(p) ? -1 : i)).filter((i) => i >= 0);
  const [decoded, fk] = [new Float64Array(108), new Float64Array(108)];
  let [sum, count, worst, at] = [0, 0, 0, 0];
  const times = [...baked.times].flatMap((t, i) => (i ? [(baked.times[i - 1] + t) / 2, t] : [t]));
  for (const t of times) {
    samplePose(ref.rest, ref.clip, t, decoded);
    bakedPoints(baked, t, fk);
    for (const i of rigid) {
      const d = Math.hypot(
        decoded[i * 3] - fk[i * 3],
        decoded[i * 3 + 1] - fk[i * 3 + 1],
        decoded[i * 3 + 2] - fk[i * 3 + 2],
      );
      [sum, count] = [sum + d, count + 1];
      if (d > worst) [worst, at] = [d, t];
    }
  }
  return { baked, bytes, parity: { mean: sum / count, worst, at } };
}

/** The clip as a contact sheet: `frames` poses spread over it, each from `views`, on its rest body's skeleton. */
export function clipSheet(ref: ClipRef, options: { frames?: number; views?: SheetView[] } = {}): Sheet {
  const { frames = 8, views = ['front', 'side'] } = options;
  const baked = bakeClip(ref.clip, ref.rest, ref.name);
  const span = ref.clip.loop ? frames : Math.max(1, frames - 1);
  const poses = Array.from({ length: frames }, (_, i) => {
    const t = (baked.duration * i) / span;
    const [pose, hips, skeleton] = [new Pose(), new Vector3(), restSkeleton(ref.rest)];
    sampleBaked(baked, t, pose.local, hips);
    pose.rootPos.copy(hips).sub(new Vector3().fromArray(skeleton.offsets, 0));
    return { pose, label: `${t.toFixed(2)} s` };
  });
  return animSheet(poses, { skeleton: restSkeleton(ref.rest), views, title: `${ref.set}/${ref.name}` });
}
