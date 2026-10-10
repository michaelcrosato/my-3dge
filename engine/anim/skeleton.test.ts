/**
 * @file Unit tests for the humanoid skeleton (engine/anim/skeleton.ts): 23 joints in parent order with Appendix C's
 * names, the sockets, the rest offsets a build gives, and the lookups' errors.
 */
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../core/registry';
import { defineBuild, getBuild } from './builds';
import {
  createSkeleton,
  JOINT_COUNT,
  JOINT_INFO,
  JOINTS,
  jointIndex,
  PARENTS,
  SOCKET_JOINTS,
  socketIndex,
  SOCKETS,
} from './skeleton';

describe('the joint set', () => {
  it('is a root plus 23 joints, parents before children', () => {
    expect(JOINT_COUNT).toBe(23);
    expect(new Set(JOINTS).size).toBe(23);
    PARENTS.forEach((parent, j) => expect(parent).toBeLessThan(j));
    expect(PARENTS.filter((parent) => parent < 0)).toHaveLength(1);
    expect(PARENTS[jointIndex('spine0')]).toBe(jointIndex('pelvis'));
    expect(PARENTS[jointIndex('clavicleR')]).toBe(jointIndex('chest'));
    expect(PARENTS[jointIndex('thighL')]).toBe(jointIndex('pelvis'));
  });

  it("names the old rig's joints and all 36 mocap points (Appendix C)", () => {
    const rig = Object.values(JOINT_INFO).flatMap((info) => (info.rig ? [info.rig] : []));
    expect(rig.sort()).toEqual(
      [
        'hipL',
        'hipR',
        'kneeL',
        'kneeR',
        'footL',
        'footR',
        'hipC',
        'shC',
        'shL',
        'shR',
        'head',
        'elbowL',
        'elbowR',
        'handL',
        'handR',
      ].sort(),
    );
    const mocap = Object.values(JOINT_INFO).flatMap((info) => info.mocap);
    expect(new Set(mocap).size).toBe(36);
    const sided = [
      'clav',
      'sh',
      'elbow',
      'wrist',
      'index',
      'knuck',
      'pinky',
      'fist',
      'hip',
      'knee',
      'ankle',
      'ball',
      'toe',
    ];
    const points = ['pelvis', 'spine1', 'spine2', 'chest', 'neck', 'head', 'headTop', 'faceF', 'chestF', 'pelvisF'];
    for (const side of ['L', 'R']) points.push(...sided.map((point) => point + side));
    expect(mocap.sort()).toEqual(points.sort());
  });

  it('has the eight sockets, each on its joint', () => {
    expect([...SOCKETS]).toEqual(['weaponR', 'weaponL', 'headTop', 'eyeL', 'eyeR', 'contactL', 'contactR', 'back']);
    expect(SOCKET_JOINTS.weaponR).toBe('handR');
    expect(createSkeleton().socketJoints[socketIndex('contactL')]).toBe(jointIndex('footL'));
  });

  it('names the closest joint for a typo', () => {
    expect(() => jointIndex('forarmL' as never)).toThrow(/ANIM_UNKNOWN_JOINT.*"forarmL".*did you mean "forearmL"/);
    expect(() => jointIndex(23)).toThrow(/ANIM_UNKNOWN_JOINT.*0–22/);
    expect(() => jointIndex(1.5)).toThrow(/ANIM_UNKNOWN_JOINT/);
    expect(() => socketIndex('weapon' as never)).toThrow(/ANIM_UNKNOWN_JOINT.*socket/);
  });
});

describe('createSkeleton', () => {
  it('builds chibi by default, from an id or a build entry', () => {
    expect(createSkeleton().build.id).toBe('build:chibi');
    expect(createSkeleton('build:bulky').build).toBe(getBuild('build:bulky'));
    const reg = createRegistry();
    const tiny = defineBuild('build:tiny', { size: 0.5 }, reg);
    expect(createSkeleton(tiny).height).toBeCloseTo(createSkeleton().height / 2, 12);
  });

  it('lays out a T-pose: arms along ±X, legs down −Y, toes forward +Z', () => {
    const skeleton = createSkeleton('build:heroic');
    const offset = (name: (typeof JOINTS)[number]) =>
      Array.from(skeleton.offsets.slice(jointIndex(name) * 3, jointIndex(name) * 3 + 3));
    expect(offset('forearmL')).toEqual([0.34375, 0, 0]);
    expect(offset('handR')).toEqual([-0.3375, 0, 0]);
    expect(offset('shinL')).toEqual([0, -0.4625, 0]);
    expect(offset('spine0')).toEqual([0, 0, 0]);
    expect(offset('toeR')[2]).toBeGreaterThan(0);
    expect(skeleton.lengths[jointIndex('forearmL')]).toBe(0.34375);
  });

  it('keeps tips only on the leaf bones', () => {
    const skeleton = createSkeleton();
    const leaves = JOINTS.filter((_, j) => !PARENTS.includes(j));
    expect(leaves).toEqual(['head', 'handL', 'handR', 'toeL', 'toeR']);
    JOINTS.forEach((name, j) => {
      const tip = Math.hypot(...skeleton.tips.slice(j * 3, j * 3 + 3));
      expect(tip > 0).toBe(leaves.includes(name));
    });
  });
});
