/**
 * @file Tests the readable codec's decode (engine/anim/clip/readable.ts, WP 8.2). Offline: what a key pose decodes
 * to on a rest body (bone lengths, limb reach, the pelvis height, the blade's finger helpers), `keyAt`'s in-betweens
 * (linear, loops wrap, one-shots hold, format 2's fields too), `samplePose`'s arrays and `moveAt`. With the my-3d2dge
 * checkout (else deferred: no source): every frame at 30 fps of the 325 curated clips within 0.001 mm of the source
 * decoder (the oracle) and of the committed reference vectors, and the oracle reproducing those bit for bit.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { busy, clipOf, curatedClips, legacy, REST, standing } from '../../../tests/unit/anim/clip-fixtures';
import { CLIP_FPS, decodeLegacyClip, frameCount, framesSha256 } from '../../../tools/anim/legacy-readable';
import { PORT_DIR } from '../../../tools/cmd/port';
import { ROOT } from '../../../tools/x';
import { decodePose, keyAt, moveAt, POINT_COUNT, POINT_INDEX, POSE_POINTS, samplePose, type Clip } from './readable';

/** A decoded point. */
const at = (X: ArrayLike<number>, name: string) => [0, 1, 2].map((i) => X[POINT_INDEX[name] * 3 + i]);
/** The distance between two decoded points. */
const gap = (X: ArrayLike<number>, a: string, b: string) => Math.hypot(...at(X, a).map((v, i) => v - at(X, b)[i]));
/** The largest distance between matching points of two poses, all 36 included. */
function worst(A: ArrayLike<number>, B: ArrayLike<number>): number {
  let most = 0;
  for (let i = 0; i < A.length; i += 3)
    most = Math.max(most, Math.hypot(A[i] - B[i], A[i + 1] - B[i + 1], A[i + 2] - B[i + 2]));
  return most;
}

describe('the decode', () => {
  it('rebuilds 36 named points on the rest body, the pelvis at the hips’ share of standing height', () => {
    expect(POINT_COUNT).toBe(36);
    expect(POSE_POINTS.slice(0, 3)).toEqual(['pelvis', 'spine1', 'spine2']);
    const X = decodePose(REST, { ...standing(0), hips: [10, -20, 55] }, new Float64Array(108));
    expect(at(X, 'pelvis')).toEqual([10, -20, 55].map((v) => v * (REST.H0 / 100)));
    expect(X.every(Number.isFinite)).toBe(true);
  });

  it('keeps every bone at its rest length, and reaches as far as the bend allows', () => {
    const lower = REST.fore + REST.fist;
    for (const key of [standing(0), busy(0)]) {
      const X = decodePose(REST, key, new Float64Array(108));
      for (const s of ['L', 'R']) {
        expect(gap(X, `sh${s}`, `elbow${s}`)).toBeCloseTo(REST.up, 9);
        expect(gap(X, `elbow${s}`, `wrist${s}`)).toBeCloseTo(REST.fore, 9);
        expect(gap(X, `elbow${s}`, `fist${s}`)).toBeCloseTo(lower, 9);
        expect(gap(X, `hip${s}`, `knee${s}`)).toBeCloseTo(REST.thigh, 9);
        expect(gap(X, `knee${s}`, `ankle${s}`)).toBeCloseTo(REST.shin, 9);
        expect(gap(X, `ankle${s}`, `ball${s}`)).toBeCloseTo(REST.ab, 9);
      }
    }
    // a straight limb stops 0.01 mm short of full reach (the two-bone IK's own margin); a bent one at its reach
    const straight = decodePose(REST, standing(0), new Float64Array(108));
    expect(gap(straight, 'shR', 'fistR')).toBeCloseTo(REST.up + lower - 0.01, 9);
    const bent = decodePose(REST, { ...standing(0), armR: [0, 0, -100, 90, 0] }, new Float64Array(108));
    expect(gap(bent, 'shR', 'fistR')).toBeCloseTo(Math.hypot(REST.up, lower), 9);
  });

  it('points the right arm’s finger helpers along a blade, and the left one’s across the chest', () => {
    const X = decodePose(REST, { ...standing(0), blade: [0, 0, 100] }, new Float64Array(108));
    const [index, fist] = [at(X, 'indexR'), at(X, 'fistR')];
    expect(index.map((v, i) => v - fist[i])).toEqual([expect.closeTo(0, 9), expect.closeTo(0, 9), 20]);
    expect(at(X, 'indexL')[1] - at(X, 'fistL')[1]).toBeCloseTo(20, 9);
  });
});

describe('keyAt and samplePose', () => {
  const clip = clipOf([
    { ...standing(0), yaw: 0, handL: [0, 10, 20] },
    { ...standing(1), hips: [0, 0, 80], yaw: 90, handL: [40, 10, 0] },
  ]);

  it('in-betweens every number linearly, format 2’s included', () => {
    const k = keyAt(clip, 0.25);
    expect(k.hips).toEqual([0, 0, 95]);
    expect(k.yaw).toBe(22.5);
    expect(k.handL).toEqual([10, 10, 15]);
    expect(k.blade).toBeUndefined();
  });

  it('holds a one-shot’s ends and wraps a loop', () => {
    expect(keyAt(clip, 5).hips).toEqual([0, 0, 80]);
    expect(keyAt(clip, -1).hips).toEqual([0, 0, 100]);
    const loop = { ...clip, loop: true };
    expect(keyAt(loop, 1.25)).toEqual(keyAt(loop, 0.25));
    expect(keyAt(loop, -0.75)).toEqual(keyAt(loop, 0.25));
  });

  it('holds a field the next key leaves out', () => {
    const held = clipOf([{ ...standing(0), footL: [10, 0, 0] }, standing(1)]);
    expect(keyAt(held, 0.5).footL).toEqual([10, 0, 0]);
  });

  it('samples into a Float32Array as the source does, or into the array it is given', () => {
    const points = samplePose(REST, clip, 0.5);
    expect(points).toBeInstanceOf(Float32Array);
    expect(points).toHaveLength(108);
    const exact = samplePose(REST, clip, 0.5, new Float64Array(108));
    expect(exact).toBeInstanceOf(Float64Array);
    expect(worst(points, exact)).toBeLessThan(1e-3);
    expect(at(exact, 'pelvis')[2]).toBeCloseTo(0.9 * REST.H0, 9);
  });

  it('reports a travelling clip’s root motion in mm, and null for one that stays', () => {
    expect(moveAt(REST, clip, 0.5)).toBeNull();
    const travels = clipOf([
      { ...standing(0), root: [0, 0] },
      { ...standing(2), root: [200, -10] },
    ]);
    expect(moveAt(REST, travels, 1)).toEqual([REST.H0, (-5 * REST.H0) / 100]);
  });
});

describe('the curated library against the source decoder (it needs the my-3d2dge checkout)', () => {
  it('decodes every frame at 30 fps of all 325 clips within 0.001 mm of the oracle', (context) => {
    const { MR, sets } = legacy(context);
    const clips = curatedClips(sets);
    expect(clips).toHaveLength(325);
    const [mine, theirs] = [new Float64Array(108), new Float64Array(108)];
    let [frames, most] = [0, 0];
    for (const [, , clip, rest] of clips) {
      for (let f = 0; f < frameCount(clip.dur); f++) {
        samplePose(rest, clip, f / CLIP_FPS, mine);
        MR.pose(rest, clip, f / CLIP_FPS, theirs);
        most = Math.max(most, worst(mine, theirs));
        frames++;
      }
    }
    expect(frames).toBe(21116);
    expect(most).toBeLessThanOrEqual(0.001);
  });

  it('decodes within 0.001 mm of the committed reference vectors, which the oracle reproduces bit for bit', (context) => {
    const { MR, sets } = legacy(context);
    let [samples, most] = [0, 0];
    for (const [setName, set] of Object.entries(sets)) {
      const file = JSON.parse(readFileSync(join(ROOT, PORT_DIR, 'clips', `${setName}.json`), 'utf8')) as {
        clips: { clip: string; frames: number; sha256: string; samples: number[][] }[];
      };
      expect(file.clips.map((c) => c.clip)).toEqual(Object.keys(set.clips));
      for (const record of file.clips) {
        const clip = set.clips[record.clip] as unknown as Clip;
        const rest = set.sources[clip.src as string].rest as typeof REST;
        const frames = decodeLegacyClip(MR, set, record.clip);
        expect([frames.length / 108, framesSha256(frames)]).toEqual([record.frames, record.sha256]);
        for (const [frame, ...numbers] of record.samples) {
          const oracle = Array.from(frames.subarray(frame * 108, frame * 108 + 108));
          expect(numbers.map((v) => Math.fround(v))).toEqual(oracle);
          most = Math.max(most, worst(samplePose(rest, clip, frame / CLIP_FPS, new Float64Array(108)), numbers));
          samples++;
        }
      }
    }
    expect(samples).toBe(975);
    expect(most).toBeLessThanOrEqual(0.001);
  });
});
