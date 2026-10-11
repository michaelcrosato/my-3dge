/**
 * @file Tests the legacy oracle's helpers (tools/anim/legacy-readable.ts, WP 8.2): the shortest float32 decimals the
 * clip vectors are written in, the frames sampled and counted, and the checksum of decoded frames. With the my-3d2dge
 * checkout (else deferred: no source): the oracle and the curated sets load in a `vm` context, 325 clips in all.
 * The oracle against the port is engine/anim/clip/readable.test.ts.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { requireSource } from '../lib/source';
import {
  CURATED_SETS,
  float32Number,
  frameCount,
  framesSha256,
  loadLegacyReadable,
  readLegacySet,
  sampledFrames,
} from './legacy-readable';

describe('the clip vectors’ numbers and frames', () => {
  it('write a float32 as its shortest decimal (9 digits at most), which reads back to the same float32', () => {
    const values = [0.1, 1 / 3, -123.456, 916.7, 1e-30, 3.4e38, 2 ** -149, 1468.9921875, -0.7236372];
    for (const value of values.map(Math.fround)) {
      const short = float32Number(value);
      expect(Math.fround(short)).toBe(value);
      expect(Number(short.toPrecision(9))).toBe(short);
    }
    expect(float32Number(Math.fround(0.1))).toBe(0.1);
    expect(float32Number(Math.fround(916.7))).toBe(916.7);
    expect(Object.is(float32Number(-0), -0)).toBe(true);
  });

  it('count a clip’s frames at 30 fps, and sample its first and the ones a third and two thirds in', () => {
    expect([frameCount(0), frameCount(2.5), frameCount(1.0166)]).toEqual([1, 76, 31]);
    expect([1, 2, 3, 4, 31, 76].map(sampledFrames)).toEqual([[0], [0], [0, 1], [0, 1, 2], [0, 10, 20], [0, 25, 50]]);
  });

  it('checksum decoded frames as their float32 bytes, little-endian', () => {
    const frames = new Float32Array([1, -2.5]);
    const bytes = Buffer.from([0, 0, 0x80, 0x3f, 0, 0, 0x20, 0xc0]);
    expect(framesSha256(frames)).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(framesSha256(new Float32Array([7, 1, -2.5]).subarray(1))).toBe(framesSha256(frames));
  });
});

describe('the oracle (it needs the my-3d2dge checkout)', () => {
  it('loads the source codec and its curated sets', (context) => {
    const source = requireSource('my-3d2dge', context);
    const MR = loadLegacyReadable(source);
    expect([MR.P, MR.POINTS.length, MR.POINTS[0]]).toEqual([36, 36, 'pelvis']);
    const counts = CURATED_SETS.map((name) => Object.keys(readLegacySet(source, name).clips).length);
    expect(counts).toEqual([88, 177, 60]);
  });
});
