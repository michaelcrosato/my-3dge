/**
 * @file Tests the importer half of the codec (engine/anim/clip/encode.ts, WP 8.5). Offline: a capture decoded from
 * known keys encodes back to those keys, `reduce` keeps the frames a straight in-between misses, `fitClip` stays
 * within its tolerance, and `measure` reads a rest body's proportions back from its own decoded pose. With the
 * my-3d2dge checkout (else deferred: no source): `measure`, `encodeClip` and `fitClip` give exactly what the source's
 * `MocapReadable.measure`, `encode` and `fit` give, the same bits, on captures decoded from curated clips.
 */
import { describe, expect, it } from 'vitest';
import { busy, clipOf, legacy, REST, standing } from '../../../tests/unit/anim/clip-fixtures';
import { capSample, encodeClip, encodePose, fitClip, measure, reduce, type Capture } from './encode';
import { clipText } from './lens';
import { moveAt, POINT_COUNT, samplePose, type Clip, type ClipKey } from './readable';
import { poseError, type RestBody } from './validate';

const SIZE = POINT_COUNT * 3;

/** A capture of `clip` decoded on `rest` at `fps`, every frame, as the importer's input (its root travel too). */
function captureOf(rest: RestBody, clip: Clip, fps = 30, name = clip.clip ?? 'Test'): Capture {
  const n = Math.max(1, Math.round(clip.dur * fps) + 1);
  const data = new Float32Array(n * SIZE);
  const move = clip.keys[0].root ? new Float32Array(n * 2) : null;
  for (let f = 0; f < n; f++) {
    data.set(samplePose(rest, clip, f / fps), f * SIZE);
    move?.set(moveAt(rest, clip, f / fps) ?? [0, 0], f * 2);
  }
  return { name, n, dur: (n - 1) / fps, loop: clip.loop ?? false, fps, data, move };
}

describe('the encode', () => {
  it('writes back the keys a pose was decoded from, to the format’s rounding', () => {
    for (const key of [standing(0), busy(0)]) {
      const X = samplePose(REST, clipOf([key]), 0, new Float64Array(SIZE));
      const back = encodePose(REST, X);
      for (const field of ['hips', 'body', 'chest', 'head', 'footL', 'footR'] as const) {
        expect(
          back[field]?.map((v) => v + 0),
          field,
        ).toEqual(key[field] ?? [0, 0, 0]);
      }
      const again = samplePose(REST, clipOf([{ t: 0, ...back } as ClipKey]), 0, new Float64Array(SIZE));
      expect(poseError(X, again)).toBeLessThan(12);
    }
  });

  it('samples a capture between its frames, loops wrapping', () => {
    const data = new Float32Array(3 * SIZE).map((_, i) => Math.floor(i / SIZE) * 10);
    const cap: Capture = { name: 'Ramp', n: 3, dur: 2, loop: false, fps: 1, data, move: null };
    expect(capSample(cap, 0.5)[0]).toBe(5);
    expect(capSample(cap, 9)[0]).toBe(20);
    expect(capSample({ ...cap, loop: true }, 2.5)[0]).toBe(5);
  });

  it('keeps the frames a straight in-between misses, and fits within its tolerance', () => {
    const clip = clipOf([standing(0), busy(0.5), standing(1)]);
    const cap = captureOf(REST, clip);
    const kf = reduce(cap, 30);
    expect(kf[0]).toBe(0);
    expect(kf.at(-1)).toBe(30);
    expect(kf).toContain(15);
    const { clip: fitted, max, mean } = fitClip(REST, cap, 30);
    expect(fitted.keys.length).toBeLessThan(cap.n);
    expect(max).toBeLessThan(30 + 20);
    expect(mean).toBeLessThan(10);
    expect(fitted).toMatchObject({ clip: 'Test', dur: 1, loop: false });
  });

  it('adds the catalog’s words and a blade aimed by the right fist', () => {
    const cap = captureOf(REST, clipOf([busy(0), busy(1)]));
    const clip = encodeClip(REST, cap, [0, 30], { tags: ['sword'], desc: 'A guard', blade: true });
    expect(Object.keys(clip)).toEqual(['clip', 'dur', 'loop', 'tags', 'desc', 'keys']);
    expect(clip.keys[0].blade).toEqual(expect.arrayContaining([expect.any(Number)]));
    expect(clip.keys.map((key) => key.t)).toEqual([0, 1]);
  });

  it('measures a rest body back from its own standing pose', () => {
    const cap = captureOf(REST, clipOf([standing(0), standing(1)]));
    const R = measure({ Stand: cap }, 'Stand');
    expect(Object.keys(R).slice(0, 4)).toEqual(['H0', 'hipZ', 'ankleZ', 'Pr']);
    expect(R.H0).toBe(REST.H0);
    for (const k of ['up', 'thigh', 'shin', 'ab', 'bt'] as const)
      expect(Math.abs(R[k] - REST[k]), k).toBeLessThan(0.02);
    expect(R.spineW).toHaveLength(4);
  });
});

/** The source's importer half: the oracle's own names (`my-3d2dge:src/mocap/readable.js`). */
interface LegacyEncode {
  measure(clips: Record<string, Capture>, tpose?: string): RestBody;
  encode(R: RestBody, cap: Capture, kf: number[], extra?: object): Clip;
  fit(R: RestBody, cap: Capture, tol: number, extra?: object): { clip: Clip; max: number; mean: number };
  reduce(cap: Capture, tol: number): number[];
}

describe('against the source (needs the my-3d2dge checkout)', () => {
  /** A few curated clips with a loop, a blade, root motion and a long one-shot among them. */
  const PICKS: [set: string, clip: string][] = [
    ['quaternius', 'Walk_Loop'],
    ['quaternius', 'Sword_Attack'],
    ['mesh2motion', 'Roll'],
    ['cmu', 'Cartwheel'],
    ['cmu', 'Boxing_Jab'],
  ];

  it('measures, encodes and fits exactly as the source does', (context) => {
    const { MR, sets } = legacy(context);
    const oracle = MR as unknown as LegacyEncode;
    const caps: Record<string, Capture> = {};
    for (const [setName, name] of PICKS) {
      const set = sets[setName];
      const clip = set.clips[name] as unknown as Clip;
      const rest = set.sources[clip.src ?? ''].rest as RestBody;
      const cap = captureOf(rest, clip, 30, name);
      caps[name] = cap;
      const extra = { blade: /Sword/.test(name), tags: clip.tags, desc: clip.desc };
      expect(reduce(cap, 30), name).toEqual(oracle.reduce(cap, 30));
      expect(encodeClip(rest, cap, [0, 7, cap.n - 1], extra), name).toEqual(
        oracle.encode(rest, cap, [0, 7, cap.n - 1], extra),
      );
      const [ours, theirs] = [fitClip(rest, cap, 30, extra), oracle.fit(rest, cap, 30, extra)];
      expect(clipText(ours.clip), name).toBe(MR.text(theirs.clip));
      expect([ours.max, ours.mean], name).toEqual([theirs.max, theirs.mean]);
    }
    expect(JSON.stringify(measure(caps, 'Walk_Loop'))).toBe(JSON.stringify(oracle.measure(caps, 'Walk_Loop')));
    expect(JSON.stringify(measure(caps))).toBe(JSON.stringify(oracle.measure(caps)));
  });
});
