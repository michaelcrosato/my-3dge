/**
 * @file Tests for retargeting (WP 8.4): the rest body's own skeleton and build, the rotation copy aligned at rest, the
 * pelvis by the hip-height ratio, contact IK for feet and hands, the lift, and three.js's `AnimationClip` played by an
 * `AnimationMixer` matching the clip layer's pose within 0.1 mm (Done when).
 */
import { AnimationClip, AnimationMixer, Bone, Object3D, Vector3 as ThreeVector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../core/registry';
import { Vector3 } from '../../core/math';
import { defineBuild } from '../builds';
import { createWorldPose, jointPosition, jointRotation, socketPosition, tipPosition } from '../fk';
import { Pose } from '../pose';
import { createSkeleton, JOINTS, PARENTS } from '../skeleton';
import { busy, clipOf, REST, standing } from '../../../tests/unit/anim/clip-fixtures';
import { setOf } from '../../../tests/unit/anim/clip-parity';
import { bakeClip } from './bake';
import { clipJSON, hipRatio, restBuild, restSkeleton, retargetPose, standingHipHeight } from './retarget';

const heroic = createSkeleton('build:heroic');
const stand = bakeClip(clipOf([standing(0), standing(1)]), REST);

describe('restSkeleton and restBuild', () => {
  it('measures the rest body’s bones, stands its pelvis at H0, and is made once', () => {
    const skeleton = restSkeleton(REST);
    expect(restSkeleton(REST)).toBe(skeleton);
    expect(standingHipHeight(skeleton)).toBeCloseTo((REST.H0 + REST.hip.L[2]) / 1000, 9); // the hip joints'
    expect(skeleton.lengths[JOINTS.indexOf('shinL')]).toBeCloseTo(REST.thigh / 1000, 9);
    expect(skeleton.lengths[JOINTS.indexOf('handR')]).toBeCloseTo(REST.fore / 1000, 9);
    expect(skeleton.height).toBeGreaterThan(1.7);
    expect(hipRatio(stand, skeleton)).toBe(1);
  });

  it('makes a valid build of the rest body’s proportions', () => {
    const build = defineBuild('build:test', restBuild(REST), createRegistry());
    expect([build.legUpper, build.armUpper, build.ankleHeight]).toEqual([0.40031, 0.27444, 0.1037]);
    expect(build.legUpper + build.legLower).toBeCloseTo((REST.thigh + REST.shin + REST.ankleZ) / 1000, 9);
    expect(build.headRadius).toBeCloseTo(0.128, 9);
  });
});

describe('retargetPose', () => {
  it('stands a build on its own hips: the pelvis by the hip-height ratio, the soles on the floor', () => {
    const world = createWorldPose();
    const pose = retargetPose(stand, 0.5, heroic, new Pose(), { world });
    const ratio = 0.925 / ((REST.H0 + REST.hip.L[2]) / 1000); // standing hip joints: the heroic legs over REST's
    expect(hipRatio(stand, heroic)).toBeCloseTo(ratio, 9);
    expect(jointPosition(world, 'pelvis').y).toBeCloseTo((REST.H0 / 1000) * ratio, 6);
    expect(pose.rootRot.w).toBe(1);
    // the ankle its own height over the floor, so the sole under it stands on it; the contact points, ahead on a sole
    // turned as the clip turns it, within 2 mm
    for (const s of ['L', 'R'] as const) {
      expect(jointPosition(world, `foot${s}`).y).toBeCloseTo(0.085, 6);
      expect(Math.abs(socketPosition(heroic, world, `contact${s}`).y)).toBeLessThan(0.002);
    }
  });

  it('copies the rotations: limbs as they are, the spine, neck, head and feet aligned to the rest body’s bones', () => {
    const baked = bakeClip(clipOf([busy(0)]), REST);
    const [source, target] = [createWorldPose(), createWorldPose()];
    retargetPose(baked, 0, restSkeleton(REST), new Pose(), { world: source, ik: false, lift: false });
    retargetPose(baked, 0, heroic, new Pose(), { world: target, ik: false, lift: false });
    for (const joint of ['upperArmL', 'forearmR', 'handR', 'thighL', 'shinR'] as const) {
      expect(jointRotation(target, joint).angleTo(jointRotation(source, joint))).toBeLessThan(1e-6);
    }
    const bone = (world: typeof source, joint: (typeof JOINTS)[number]) => {
      const child = JOINTS.indexOf(joint);
      return jointPosition(world, child).sub(jointPosition(world, PARENTS[child])).normalize();
    };
    for (const joint of ['spine2', 'chest', 'neck', 'head', 'toeL'] as const) {
      expect(bone(target, joint).angleTo(bone(source, joint))).toBeLessThan(1e-6);
    }
  });

  it('plants the feet with IK where the source’s soles are, scaled, on a build with other leg shares', () => {
    const chibi = createSkeleton('build:chibi');
    const baked = bakeClip(clipOf([{ ...busy(0), hips: [5, -3, 96] }]), REST);
    const [world, free] = [createWorldPose(), createWorldPose()];
    retargetPose(baked, 0, chibi, new Pose(), { world, lift: false });
    retargetPose(baked, 0, chibi, new Pose(), { world: free, ik: false, lift: false });
    const source = createWorldPose();
    retargetPose(baked, 0, restSkeleton(REST), new Pose(), { world: source, ik: false, lift: false });
    const ratio = hipRatio(baked, chibi);
    const want = jointPosition(source, 'footR').multiplyScalar(ratio);
    const fade = Math.min(1, Math.max(0, 1 - (jointPosition(source, 'footR').y - REST.ankleZ / 1000) / 0.3));
    want.y = want.y - (REST.ankleZ / 1000) * fade * ratio + 0.08 * fade;
    expect(jointPosition(world, 'footR').distanceTo(want)).toBeLessThan(1e-6);
    expect(jointPosition(free, 'footR').distanceTo(want)).toBeGreaterThan(0.005);
    expect(jointRotation(world, 'footR').angleTo(jointRotation(free, 'footR'))).toBeLessThan(1e-6);
  });

  it('reaches with a hand inside a contacts interval, and lifts a pose that dips below the floor', () => {
    const baked = bakeClip(clipOf([{ ...busy(0), hips: [0, 0, 20] }]), REST);
    const [world, source] = [createWorldPose(), createWorldPose()];
    retargetPose(baked, 0, restSkeleton(REST), new Pose(), { world: source, ik: false, lift: false });
    const contacts = [{ part: 'handL', from: 0, to: 1 }];
    retargetPose(baked, 0, heroic, new Pose(), { world, contacts });
    const ratio = hipRatio(baked, heroic);
    const lifted = jointPosition(world, 'handL').y - jointPosition(source, 'handL').y * ratio;
    expect(lifted).toBeGreaterThan(0);
    const reach = jointPosition(world, 'handL').sub(jointPosition(source, 'handL').multiplyScalar(ratio));
    expect(Math.hypot(reach.x, reach.z)).toBeLessThan(1e-6);
    let low = Infinity;
    for (let j = 0; j < JOINTS.length; j++) low = Math.min(low, world.positions[j * 3 + 1]);
    for (const j of ['toeL', 'toeR', 'handL', 'handR', 'head'] as const) low = Math.min(low, tipPosition(heroic, world, j).y); // prettier-ignore
    expect(low).toBeGreaterThan(-1e-9);
  });
});

describe('clipJSON: the baked clip as three.js’s AnimationClip', () => {
  it('played by an AnimationMixer, matches the clip layer’s pose within 0.1 mm (no contact IK)', () => {
    const set = setOf('quaternius');
    const clip = set.clips.Sword_Attack;
    const baked = bakeClip(clip, set.sources![clip.src!].rest, 'Sword_Attack');
    const three = AnimationClip.parse(clipJSON(baked, heroic));
    expect(three.tracks).toHaveLength(JOINTS.length + 1);
    // the puppets' bones: `root`, then one per joint at its rest offset (engine/gfx/puppets/draw.ts)
    const holder = new Object3D();
    const bones = [new Bone(), ...JOINTS.map(() => new Bone())];
    bones[0].name = 'root';
    holder.add(bones[0]);
    JOINTS.forEach((name, j) => {
      bones[j + 1].name = name;
      bones[j + 1].position.fromArray(heroic.offsets, j * 3);
      bones[PARENTS[j] + 1].add(bones[j + 1]);
    });
    const mixer = new AnimationMixer(holder);
    mixer.clipAction(three).play();
    const [world, at] = [createWorldPose(), new ThreeVector3()];
    let worst = 0;
    for (let t = 0; t <= baked.duration; t += 1 / 60) {
      mixer.setTime(t);
      holder.updateMatrixWorld(true);
      retargetPose(baked, t, heroic, new Pose(), { world, ik: false, lift: false });
      JOINTS.forEach((_, j) => {
        at.setFromMatrixPosition(bones[j + 1].matrixWorld);
        worst = Math.max(worst, at.distanceTo(new Vector3().fromArray(world.positions, j * 3)));
      });
    }
    expect(worst).toBeLessThan(1e-4);
  });
});
