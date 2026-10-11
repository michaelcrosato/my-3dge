/**
 * @file Tests for the baker (WP 8.4): the frames on format 1's key grid, FK parity with the format-1 decode (exact on
 * a key, a mean of 1 mm or less over every set at 30 fps and the 60 Hz midpoints, and at each clip's own key times, the
 * worst cases in tests/baselines/anim-clips.json), the hand's roll, the singular poses, and the root's travel.
 */
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from '../../core/math';
import { createWorldPose, forwardKinematics, jointRotation } from '../fk';
import { Pose } from '../pose';
import { jointIndex, JOINT_COUNT } from '../skeleton';
import { busy, clipOf, REST, standing } from '../../../tests/unit/anim/clip-fixtures';
import {
  readBaseline,
  restParity,
  SET_DIRS,
  setOf,
  WRITING,
  writeBaseline,
} from '../../../tests/unit/anim/clip-parity';
import { bakeClip, BAKE_FPS, bakeTimes, frameAt, keyRotations, sampleBaked, travelAt } from './bake';
import { decodePose, keyAt, POINT_INDEX, POSE_POINTS, type ClipKey } from './readable';
import { restPoints, restSkeleton } from './retarget';

/** FK of key `k` on REST's own skeleton, as decode points (mm, rig frame), and the world pose. */
function bakedPoints(k: ClipKey) {
  const pose = new Pose();
  const hips = keyRotations(REST, keyAt(clipOf([k]), 0), pose.local);
  const skeleton = restSkeleton(REST);
  pose.rootPos.copy(hips).sub(new Vector3().fromArray(skeleton.offsets, 0));
  const world = forwardKinematics(skeleton, pose, createWorldPose());
  return { points: restPoints(REST, world, new Float64Array(108)), world, pose };
}

/** The largest distance (mm) between the rigid points of two decoded poses (index and pinky left out). */
function rigidError(a: Float64Array, b: Float64Array): number {
  let worst = 0;
  POSE_POINTS.forEach((p, i) => {
    if (p.startsWith('index') || p.startsWith('pinky')) return;
    worst = Math.max(worst, Math.hypot(a[i * 3] - b[i * 3], a[i * 3 + 1] - b[i * 3 + 1], a[i * 3 + 2] - b[i * 3 + 2]));
  });
  return worst;
}

/** The angle (degrees) between the hand's +Z and the decode's index-to-pinky line, across the forearm. */
function rollError(world: ReturnType<typeof createWorldPose>, decoded: Float64Array, side: 'L' | 'R'): number {
  const at = (p: string) => new Vector3(-decoded[POINT_INDEX[p] * 3 + 1], decoded[POINT_INDEX[p] * 3 + 2], decoded[POINT_INDEX[p] * 3]); // prettier-ignore
  const along = at(`fist${side}`)
    .sub(at(`wrist${side}`))
    .normalize();
  const across = at(`index${side}`).sub(at(`pinky${side}`));
  across.addScaledVector(along, -across.dot(along)).normalize();
  const z = new Vector3(0, 0, 1).applyQuaternion(jointRotation(world, `hand${side}`));
  return (z.angleTo(across) * 180) / Math.PI;
}

describe('bakeClip', () => {
  it('bakes 30 frames a second over the clip, both ends, a loop ending where it starts', () => {
    const clip = clipOf([standing(0), { ...standing(0.5), hips: [0, 0, 80] }, standing(1)], { loop: true });
    const baked = bakeClip(clip, REST);
    expect([baked.frames, baked.times[30], baked.duration, BAKE_FPS]).toEqual([31, 1, 1, 30]);
    expect(baked.hips[1]).toBeCloseTo(0.9167, 6);
    expect(baked.hips[15 * 3 + 1]).toBeCloseTo(0.8 * 0.9167, 6);
    expect([...baked.rotations.subarray(30 * JOINT_COUNT * 4)]).toEqual([...baked.rotations.subarray(0, JOINT_COUNT * 4)]); // prettier-ignore
    expect(frameAt(baked, 1.25)).toEqual([7, expect.closeTo(0.5, 6)]);
    expect(frameAt({ ...baked, loop: false }, 9)).toEqual([29, 1]);
  });

  it('keeps the frames on the key grid when the clip ends off it, with a last frame at its end', () => {
    expect([...bakeTimes(0.542)]).toEqual([...Array.from({ length: 17 }, (_, i) => i / 30), 0.542].map(Math.fround));
    expect(bakeTimes(1.534).length).toBe(47); // a grid frame within a millisecond of the end gives way to it
    expect([...bakeTimes(0)]).toEqual([0, 0]);
    // a clip as long as Sword_Regular_B (0.542 s) that strikes at 0.5 s: the strike is frame 15, where frames spaced
    // evenly over the clip would fall at 0.475 s and 0.508 s, either side of it
    const strikeKey: ClipKey = { ...busy(0.5), body: [160, -20, 10], armR: [-60, 40, 80, 120, 170] };
    const baked = bakeClip(clipOf([standing(0), strikeKey, standing(0.533)], { dur: 0.542 }), REST);
    const strike = new Float32Array(JOINT_COUNT * 4);
    keyRotations(REST, strikeKey, strike);
    for (let j = 0; j < JOINT_COUNT; j++) {
      const q = new Quaternion().fromArray(baked.rotations, (15 * JOINT_COUNT + j) * 4);
      expect(Math.abs(q.dot(new Quaternion().fromArray(strike, j * 4)))).toBeCloseTo(1, 6);
    }
    expect(frameAt(baked, 0.54)).toEqual([16, expect.closeTo((0.54 - 16 / 30) / (0.542 - 16 / 30), 4)]);
    expect(frameAt(baked, 0.5)).toEqual([15, expect.closeTo(0, 5)]);
  });

  it('rebuilds every rigid decode point of a key, on the rest body’s own skeleton, and the hand’s roll', () => {
    for (const k of [standing(0), busy(0)]) {
      const decoded = decodePose(REST, k, new Float64Array(108));
      const { points, world } = bakedPoints(k);
      expect(rigidError(points, decoded)).toBeLessThan(1e-3); // float32 rotations: a micron
      expect(rollError(world, decoded, 'L')).toBeLessThan(1e-3);
      expect(rollError(world, decoded, 'R')).toBeLessThan(1e-3);
    }
  });

  it('writes unit rotations, each frame on the side of the sphere of the frame before', () => {
    const clip = clipOf([busy(0), { ...busy(1), body: [200, -20, 10], armR: [-60, 40, 80, 120, 170] }]);
    const { rotations, frames } = bakeClip(clip, REST);
    for (let i = 0; i < frames; i++) {
      for (let j = 0; j < JOINT_COUNT; j++) {
        const q = new Quaternion().fromArray(rotations, (i * JOINT_COUNT + j) * 4);
        expect(q.length()).toBeCloseTo(1, 6);
        if (i) expect(q.dot(new Quaternion().fromArray(rotations, ((i - 1) * JOINT_COUNT + j) * 4))).toBeGreaterThan(0);
      }
    }
  });

  it('keeps a straight arm’s twist, which decoded points alone would lose', () => {
    const straight = (twist: number): ClipKey => ({ ...standing(0), armR: [20, 60, -40, 0, twist] });
    const [a, b] = [bakedPoints(straight(0)), bakedPoints(straight(90))];
    const [qa, qb] = [jointRotation(a.world, 'forearmR'), jointRotation(b.world, 'forearmR')];
    expect((qa.angleTo(qb) * 180) / Math.PI).toBeCloseTo(90, 3);
    for (const [k, baked] of [
      [straight(0), a],
      [straight(90), b],
    ] as const) {
      expect(rigidError(baked.points, decodePose(REST, k, new Float64Array(108)))).toBeLessThan(1e-3);
    }
  });

  it('handles the singular poses: a limb with no direction, a hand whose across runs along the forearm', () => {
    const folded = bakedPoints({ ...standing(0), armL: [0, 0, 0, 30, 10] });
    expect([...folded.pose.local].every(Number.isFinite)).toBe(true);
    const bone = (joint: 'upperArmL' | 'clavicleL') => new Vector3(1, 0, 0).applyQuaternion(jointRotation(folded.world, joint)); // prettier-ignore
    expect(bone('upperArmL').angleTo(bone('clavicleL'))).toBeLessThan(1e-6); // along its parent's bone
    // the right arm straight out along the chest's right: the hand keeps (within 6°) the forearm's roll, and a
    // degree either side of that line turns it by no more than 3°, where the across direction alone would spin it
    const hand = (up: number) => bakedPoints({ ...standing(0), armR: [0, 100, up, 0, 0] }).pose.getRotation('handR');
    expect(hand(0).angleTo(new Quaternion())).toBeLessThan(0.1);
    expect((hand(-1.75).angleTo(hand(1.75)) * 180) / Math.PI).toBeLessThan(3);
  });

  it('samples between frames as three.js’s mixer does, and carries a travelling loop on lap after lap', () => {
    const crawl = setOf('mesh2motion').clips['Crawl RM'];
    const baked = bakeClip(crawl, setOf('mesh2motion').sources![crawl.src!].rest, 'Crawl RM');
    const lap = travelAt(baked, baked.duration);
    expect(lap.z).toBeCloseTo((1.42 * baked.rest.H0) / 1000, 6);
    expect(
      travelAt(baked, baked.duration + 0.4)
        .sub(travelAt(baked, 0.4))
        .distanceTo(lap),
    ).toBeLessThan(1e-6);
    const [pose, hips] = [new Pose(), new Vector3()];
    sampleBaked(baked, baked.times[3], pose.local, hips);
    const frame = baked.rotations.subarray(3 * JOINT_COUNT * 4, 4 * JOINT_COUNT * 4);
    pose.local.forEach((v, i) => expect(v).toBeCloseTo(frame[i], 6));
    expect(jointIndex('pelvis')).toBe(0);
  });
});

describe('FK parity with the format-1 decode, every set (Done when: a mean of 1 mm or less)', () => {
  const baseline = readBaseline();
  const measured = Object.fromEntries(SET_DIRS.map((dir) => [dir, restParity(dir)]));
  const atKeys = Object.fromEntries(SET_DIRS.map((dir) => [dir, restParity(dir, 'keys')]));
  if (WRITING) {
    writeBaseline(
      'rest',
      measured,
      'FK of the baked tracks on each rest body’s own skeleton against the format-1 decode, over 34 points (index and pinky are roll hints, not rigid), at 30 fps and the 60 Hz midpoints. The frames lie on format 1’s key grid, every 1/30 s from 0 and a last one at the clip’s end (bake.ts `bakeTimes`), the times v1 sampled its clips at, so at a 30 fps sample the two agree to 5 µm (the rotations are float32). The worst cases are midpoints where a limb’s pole swings fast between two frames (a sword arm’s twist, a fist pulled across the chest), and the slerp between the frames takes another way than the decode’s in-between of the key numbers.',
    );
    writeBaseline(
      'restKeys',
      atKeys,
      'The same measure at each clip’s own key times (keys past a clip’s end, which neither reaches, left out). Format 1 writes a key’s time to the millisecond, so it lies up to a third of a millisecond from its frame (0.033 s for 1/30 s), 1% of a frame’s step. The worst cases are keys in the fastest swings, where that 1% is up to 35 mm: Victory’s right arm turns its twist by 175° toward the next key, so the decode itself moves 35 mm between 1.233 s and 1/30 s × 37; Sword_Regular_B’s sword arm swings into its last key, which the decode reaches at 0.533 s and the bake at its frame, 1/30 s × 16. At the frames the two agree to 5 µm.',
    );
  }

  it.each(SET_DIRS)('%s', (dir) => {
    for (const [parity, section] of [
      [measured[dir], 'rest'],
      [atKeys[dir], 'restKeys'],
    ] as const) {
      const recorded = baseline[section]?.sets[dir];
      expect(parity.mean, section).toBeLessThanOrEqual(1);
      expect(recorded, `no ${section} baseline for ${dir}: run with ANIM_CLIPS_BASELINE=write`).toBeDefined();
      expect(parity.mean).toBeCloseTo(recorded.mean, 2);
      expect(parity.worstClips.map((c) => c.clip)).toEqual(recorded.worstClips.map((c) => c.clip));
      expect(parity.worst.mm).toBeCloseTo(recorded.worst.mm, 0);
    }
  });
});
