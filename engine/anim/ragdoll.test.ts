/**
 * @file Unit tests for the humanoid's ragdoll (engine/anim/ragdoll.ts, PLAN.md WP 10.2): its eleven parts stand at their
 * joints, turned as their bones, their capsules joint to joint; its ten joints hold where the bones meet, the elbows
 * and knees hinged about the IK's hinges (turned as the parent bone is now), each resting at the T-pose; the layer lays
 * a body's own parts back on a body posed otherwise, every part's bone turned as its part and the pelvis where its part
 * is, the spine and neck shared out and the hands as their animation had them, faded by its weight; and a body lying
 * on its back or its face, whichever way it faces, rests lying so, facing so, its feet where it lies (to its sway),
 * and where, as measured (WP 12.2).
 * @see engine/anim/ragdoll.ts
 */
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from '../core/math';
import { Rng } from '../core/rng';
import { Animator } from './character';
import { jointPosition, jointRotation, type WorldPose } from './fk';
import { LIMBS } from './ik';
import { PART_NUMBERS, RAGDOLL_PARTS, ragdollOf, RagdollLayer, ragdollRest } from './ragdoll';
import { Reactions, type Lying } from './reactions';

/** An adult walking east at 1.5 m/s for half a second, at (2, 0, 3): a pose with bent knees and elbows. */
function walker(): Animator {
  const animator = new Animator({ build: 'build:adult', rng: new Rng(3) });
  for (let k = 0; k < 30; k++) animator.update({ velocity: new Vector3(1.5, 0, 0) }, { at: new Vector3(2, 0, 3), yaw: Math.PI / 2 }); // prettier-ignore
  return animator;
}

/** The parts' poses of a body posed as `world`, as a ragdoll's would read. */
const posesOf = (world: WorldPose) =>
  RAGDOLL_PARTS.flatMap(({ joint }) => [...jointPosition(world, joint).toArray(), ...jointRotation(world, joint).toArray()]); // prettier-ignore

const apart = (a: Vector3, b: Vector3) => a.distanceTo(b);
/** Where `ragdollRest` stood the adult lying on its back at (3, 0.5, −1) turned 1 rad, as measured on 2026-10-25 (WP 12.2). */
const RAGDOLL_AT: number[] = [3.004764518, 0.499346802, -0.988204613];
const turned = (a: Quaternion, b: Quaternion) => a.clone().normalize().angleTo(b.clone().normalize());

describe('the humanoid’s ragdoll', () => {
  it('stands its parts at their joints, their capsules joint to joint, and hinges the elbows and knees their way', () => {
    const { body } = walker();
    const { parts, joints } = ragdollOf(body.build, body.world);
    expect([parts.length, joints.length]).toEqual([11, 10]);
    RAGDOLL_PARTS.forEach(({ joint }, i) => {
      expect(apart(new Vector3(...parts[i].position), jointPosition(body.world, joint))).toBeLessThan(1e-9);
      expect(turned(new Quaternion(...parts[i].rotation), jointRotation(body.world, joint))).toBeLessThan(1e-6);
    });
    const thigh = parts[7].shapes[0];
    expect(apart(new Vector3(...thigh.from), jointPosition(body.world, 'thighL'))).toBeLessThan(1e-9);
    expect(apart(new Vector3(...thigh.to!), jointPosition(body.world, 'shinL'))).toBeLessThan(1e-9);
    expect(thigh.radius).toBeCloseTo(0.05, 9); // CHAIN.limb, the adult's size 1
    expect(parts[2].shapes).toEqual([expect.objectContaining({ radius: body.build.headRadius })]); // the head, a ball
    const knee = joints.find((j) => j.child === 8)!; // the left shin's
    expect([knee.parent, knee.kind.type, knee.rest]).toEqual([7, 'hinge', [0, 0, 0, 1]]);
    expect(apart(new Vector3(...knee.at), jointPosition(body.world, 'shinL'))).toBeLessThan(1e-9);
    const hinge = new Vector3(...LIMBS.footL.hinge).applyQuaternion(jointRotation(body.world, 'thighL'));
    expect(apart(new Vector3(...(knee.kind.type === 'hinge' ? knee.kind.axis : [0, 0, 0])), hinge)).toBeLessThan(1e-9);
    expect(joints.find((j) => j.child === 1)!.at).toEqual(jointPosition(body.world, 'spine2').toArray()); // the spine
  });

  it('lays a body’s parts back on a body posed otherwise: each bone as its part, the spine shared, faded by its weight', () => {
    const source = walker().body;
    const poses = posesOf(source.world);
    const animator = new Animator({ build: 'build:adult', rng: new Rng(9) });
    const layer = new RagdollLayer().attach(animator);
    layer.poses = poses;
    layer.weight = 1;
    animator.update({}, { at: new Vector3(-4, 0, 0), yaw: 1 }); // standing elsewhere, facing another way
    const { world } = animator.body;
    for (const { joint } of RAGDOLL_PARTS) {
      expect(turned(jointRotation(world, joint), jointRotation(source.world, joint))).toBeLessThan(1e-4);
    }
    expect(apart(jointPosition(world, 'pelvis'), jointPosition(source.world, 'pelvis'))).toBeLessThan(1e-6);
    expect(apart(jointPosition(world, 'chest'), jointPosition(source.world, 'chest'))).toBeLessThan(0.02); // the spine shared
    expect(apart(jointPosition(world, 'shinL'), jointPosition(source.world, 'shinL'))).toBeLessThan(1e-4);
    layer.weight = 0.5;
    animator.update({}, { at: new Vector3(-4, 0, 0), yaw: 1 });
    const half = jointPosition(animator.body.world, 'pelvis').x;
    expect(half).toBeGreaterThan(-4);
    expect(half).toBeLessThan(jointPosition(source.world, 'pelvis').x); // between the two
    layer.poses = [];
    animator.update({}, { at: new Vector3(-4, 0, 0), yaw: 1 });
    expect(jointPosition(animator.body.world, 'pelvis').x).toBeCloseTo(-4, 1); // nothing to lay
  });

  it('rests a body lying on its back or its face, whichever way it faces, lying so, facing so, its feet where it lies', () => {
    for (const lying of ['up', 'down'] as Lying[]) {
      for (const yaw of [0, 1, 2.5, -2]) {
        const animator = new Animator({ build: 'build:adult', rng: new Rng(1) });
        new Reactions().attach(animator).lying = lying;
        const at = new Vector3(3, 0.5, -1);
        for (let k = 0; k < 90; k++) animator.update({ down: 1 }, { at, yaw });
        const rest = ragdollRest(animator.body.build, posesOf(animator.body.world));
        expect([rest.lying, Math.abs(Math.atan2(Math.sin(rest.yaw - yaw), Math.cos(rest.yaw - yaw))) < 1e-6]).toEqual([lying, true]); // prettier-ignore
        expect(apart(rest.at, at)).toBeLessThan(0.03); // within its breathing and sway, ±2 cm
        expect(turned(rest.chest, jointRotation(animator.body.world, 'chest'))).toBeLessThan(1e-6);
      }
    }
  });

  it('rests where it was measured: the lying humanoid’s pelvis, the mean of its 4 s of breath and sway', () => {
    // characterization (WP 12.2): where `ragdollRest` stands a lying body, so that a change to how the lying pelvis is
    // measured shows here; a change meant to measure it otherwise measures these again, its reason in its commit
    const animator = new Animator({ build: 'build:adult', rng: new Rng(1) });
    new Reactions().attach(animator).lying = 'up';
    for (let k = 0; k < 90; k++) animator.update({ down: 1 }, { at: new Vector3(3, 0.5, -1), yaw: 1 });
    const rest = ragdollRest(animator.body.build, posesOf(animator.body.world));
    if (process.env.PRINT_RAGDOLL) console.log(JSON.stringify(rest.at.toArray()));
    expect(rest.at.toArray().map((x) => Math.round(x * 1e9) / 1e9)).toEqual(RAGDOLL_AT);
  });

  it('reads 7 numbers a part', () => {
    expect([PART_NUMBERS, RAGDOLL_PARTS.length]).toEqual([7, 11]);
  });
});
